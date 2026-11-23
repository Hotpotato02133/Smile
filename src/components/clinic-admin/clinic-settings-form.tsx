"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "convex/react";
import { Lock, Save, Upload } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { useClinicAdminContext } from "@/components/clinic-admin/clinic-admin-shell";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import {
  DAY_NAMES,
  getErrorMessage,
  minutesToTimeInput,
  timeInputToMinutes,
} from "@/lib/format";
import { api } from "../../../convex/_generated/api";
import type { Doc, Id } from "../../../convex/_generated/dataModel";

type OperatingHourDay = {
  dayOfWeek: number;
  isOpen: boolean;
  openMinute: number;
  closeMinute: number;
};

const settingsSchema = z.object({
  name: z.string().min(2, "Clinic name is required"),
  tagline: z.string().optional(),
  primaryColorHex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex color like #0284c7"),
  email: z.string().email("Enter a valid email"),
  phone: z.string().min(6, "Phone is required"),
  address: z.string().min(3, "Address is required"),
  city: z.string().min(2, "City is required"),
  province: z.string().min(2, "Province is required"),
  timezone: z.string().min(2),
  slotIntervalMinutes: z.enum(["15", "30"]),
  cancellationWindowHours: z.coerce.number().min(0).max(168),
  emergencyBufferMinutesPerDay: z.coerce.number().min(0).max(240),
  requireBookingApproval: z.boolean(),
});

type SettingsFormInput = z.input<typeof settingsSchema>;
type SettingsFormValues = z.output<typeof settingsSchema>;

function ClinicSettingsEditor({
  clinic,
  logoUrl,
  isReadOnly,
}: {
  clinic: Doc<"clinics">;
  logoUrl: string | null;
  isReadOnly: boolean;
}) {
  const updateSettings = useMutation(api.clinicAdmin.updateClinicSettings);
  const generateLogoUploadUrl = useMutation(
    api.clinicAdmin.generateLogoUploadUrl
  );

  const [operatingHours, setOperatingHours] = useState<OperatingHourDay[]>(() =>
    clinic.operatingHours.map((d) => ({ ...d }))
  );
  const [logoStorageId, setLogoStorageId] = useState<
    Id<"_storage"> | undefined
  >(clinic.logoStorageId);
  const [logoSizeBytes, setLogoSizeBytes] = useState<number>(0);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  const form = useForm<SettingsFormInput, unknown, SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      name: clinic.name,
      tagline: clinic.tagline ?? "",
      primaryColorHex: clinic.primaryColorHex,
      email: clinic.email,
      phone: clinic.phone,
      address: clinic.address,
      city: clinic.city,
      province: clinic.province,
      timezone: clinic.timezone,
      slotIntervalMinutes: clinic.slotIntervalMinutes === 15 ? "15" : "30",
      cancellationWindowHours: clinic.cancellationWindowHours,
      emergencyBufferMinutesPerDay: clinic.emergencyBufferMinutesPerDay,
      requireBookingApproval: Boolean(clinic.requireBookingApproval),
    },
  });

  const watchedInterval = useWatch({
    control: form.control,
    name: "slotIntervalMinutes",
  });
  const watchedColor = useWatch({
    control: form.control,
    name: "primaryColorHex",
  });
  const watchedRequireApproval = useWatch({
    control: form.control,
    name: "requireBookingApproval",
  });

  const customBrandingEnabled = clinic.featureFlags.customBrandingEnabled;

  const updateDay = (dayOfWeek: number, patch: Partial<OperatingHourDay>) => {
    setOperatingHours((prev) =>
      prev.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, ...patch } : d))
    );
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 500 * 1024) {
      toast.error("Clinic logo must be 500 KB or smaller (WebP/PNG/JPEG).");
      return;
    }
    setUploadingLogo(true);
    try {
      const uploadUrl = await generateLogoUploadUrl({});
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "image/png" },
        body: file,
      });
      if (!res.ok) throw new Error("Upload failed.");
      const json = (await res.json()) as { storageId: Id<"_storage"> };
      setLogoStorageId(json.storageId);
      setLogoSizeBytes(file.size);
      toast.success("Logo uploaded. Click Save Settings to apply.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Logo upload failed."));
    } finally {
      setUploadingLogo(false);
    }
  };

  const onSubmit = async (values: SettingsFormValues) => {
    try {
      await updateSettings({
        name: values.name,
        tagline: values.tagline || undefined,
        primaryColorHex: values.primaryColorHex,
        logoStorageId,
        logoSizeBytes: logoSizeBytes || undefined,
        email: values.email,
        phone: values.phone,
        address: values.address,
        city: values.city,
        province: values.province,
        timezone: values.timezone,
        slotIntervalMinutes: Number(values.slotIntervalMinutes),
        cancellationWindowHours: values.cancellationWindowHours,
        emergencyBufferMinutesPerDay: values.emergencyBufferMinutesPerDay,
        requireBookingApproval: values.requireBookingApproval,
        operatingHours,
      });
      toast.success("Clinic settings and operating hours saved.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not save clinic settings."));
    }
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Clinic Settings & Operating Hours
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage public contact details, branding for{" "}
            <code>/c/{clinic.slug}</code>, scheduling policies, and weekly
            hours.
          </p>
        </div>

        <Button
          type="submit"
          disabled={isReadOnly || form.formState.isSubmitting || uploadingLogo}
        >
          <Save className="mr-1.5 size-4" />
          {form.formState.isSubmitting ? "Saving…" : "Save Settings"}
        </Button>
      </div>

      {/* Clinic Identity & Contact */}
      <Card>
        <CardHeader>
          <CardTitle>Clinic Profile & Location</CardTitle>
          <CardDescription>
            Displayed on your public patient booking portal and confirmation
            emails.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="set-name">Clinic Name</Label>
              <Input
                id="set-name"
                disabled={isReadOnly}
                {...form.register("name")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="set-tagline">Tagline</Label>
              <Input
                id="set-tagline"
                disabled={isReadOnly}
                placeholder="Gentle dental care for the whole family"
                {...form.register("tagline")}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="set-email">Public Email</Label>
              <Input
                id="set-email"
                type="email"
                disabled={isReadOnly}
                {...form.register("email")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="set-phone">Phone Number</Label>
              <Input
                id="set-phone"
                disabled={isReadOnly}
                {...form.register("phone")}
              />
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-3">
              <Label htmlFor="set-addr">Street Address</Label>
              <Input
                id="set-addr"
                disabled={isReadOnly}
                {...form.register("address")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="set-city">City</Label>
              <Input
                id="set-city"
                disabled={isReadOnly}
                {...form.register("city")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="set-prov">Province</Label>
              <Input
                id="set-prov"
                disabled={isReadOnly}
                {...form.register("province")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="set-tz">IANA Timezone</Label>
              <Input
                id="set-tz"
                disabled={isReadOnly}
                className="font-mono"
                {...form.register("timezone")}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Branding & Scheduling Policies */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-start justify-between gap-2">
            <div>
              <CardTitle>Portal Branding</CardTitle>
              <CardDescription>
                Accent color and logo for <code>/c/{clinic.slug}</code>
              </CardDescription>
            </div>
            {!customBrandingEnabled ? (
              <Badge variant="outline" className="gap-1">
                <Lock className="size-3" /> Pro Feature
              </Badge>
            ) : null}
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label htmlFor="set-color">Primary Brand Color</Label>
              <div className="flex items-center gap-2">
                <span
                  className="size-8 shrink-0 rounded-md border"
                  style={{ backgroundColor: watchedColor }}
                />
                <Input
                  id="set-color"
                  disabled={isReadOnly || !customBrandingEnabled}
                  className="font-mono"
                  {...form.register("primaryColorHex")}
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="set-logo">Clinic Logo (≤ 500 KB)</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="set-logo"
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  disabled={
                    isReadOnly || !customBrandingEnabled || uploadingLogo
                  }
                  onChange={handleLogoUpload}
                />
                {uploadingLogo ? (
                  <Upload className="size-4 animate-pulse text-muted-foreground" />
                ) : null}
              </div>
              {logoUrl ? (
                <p className="text-xs text-muted-foreground">
                  Logo uploaded and active.
                </p>
              ) : null}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Scheduling Policies</CardTitle>
            <CardDescription>
              Controls slot granularity and patient cancellation rules.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="space-y-1.5">
              <Label>Booking Slot Interval</Label>
              <Select
                disabled={isReadOnly}
                value={watchedInterval}
                onValueChange={(v) => {
                  if (v === "15" || v === "30") {
                    form.setValue("slotIntervalMinutes", v);
                  }
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="15">Every 15 minutes</SelectItem>
                  <SelectItem value="30">Every 30 minutes</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="set-cancel">Cancellation Notice (hours)</Label>
                <Input
                  id="set-cancel"
                  type="number"
                  min={0}
                  disabled={isReadOnly}
                  className="font-mono"
                  {...form.register("cancellationWindowHours")}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="set-emerg">Daily Emergency Buffer (mins)</Label>
                <Input
                  id="set-emerg"
                  type="number"
                  min={0}
                  disabled={isReadOnly}
                  className="font-mono"
                  {...form.register("emergencyBufferMinutesPerDay")}
                />
              </div>
            </div>

            <div className="flex items-start justify-between gap-3 rounded-lg border bg-muted/25 p-3">
              <div className="space-y-0.5">
                <Label htmlFor="set-approval" className="text-sm font-medium">
                  Require Front-Desk Approval for Online Bookings
                </Label>
                <p className="text-xs text-muted-foreground">
                  When enabled, patient online bookings enter{" "}
                  <code>pending_approval</code> and appear in the{" "}
                  <code>/front-desk</code> Pending Requests queue until approved
                  by reception.
                </p>
              </div>
              <Switch
                id="set-approval"
                disabled={isReadOnly}
                checked={watchedRequireApproval}
                onCheckedChange={(checked) =>
                  form.setValue("requireBookingApproval", checked)
                }
              />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* 7-Day Clinic Operating Hours */}
      <Card>
        <CardHeader>
          <CardTitle>Weekly Operating Hours</CardTitle>
          <CardDescription>
            Determines when the clinic is open for patient online booking and
            front-desk scheduling.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-2">
          {operatingHours.map((day) => (
            <div
              key={day.dayOfWeek}
              className="grid grid-cols-1 items-center gap-3 rounded-lg border px-3 py-2.5 sm:grid-cols-[140px_1fr]"
            >
              <div className="flex items-center gap-2.5">
                <Switch
                  disabled={isReadOnly}
                  checked={day.isOpen}
                  onCheckedChange={(checked) =>
                    updateDay(day.dayOfWeek, { isOpen: checked })
                  }
                />
                <span className="text-sm font-medium">
                  {DAY_NAMES[day.dayOfWeek]}
                </span>
              </div>

              {day.isOpen ? (
                <div className="flex flex-wrap items-center gap-2 text-xs">
                  <Input
                    type="time"
                    disabled={isReadOnly}
                    className="h-8 w-36 font-mono text-xs"
                    value={minutesToTimeInput(day.openMinute)}
                    onChange={(e) =>
                      updateDay(day.dayOfWeek, {
                        openMinute: timeInputToMinutes(
                          e.target.value,
                          day.openMinute
                        ),
                      })
                    }
                  />
                  <span className="text-muted-foreground">to</span>
                  <Input
                    type="time"
                    disabled={isReadOnly}
                    className="h-8 w-36 font-mono text-xs"
                    value={minutesToTimeInput(day.closeMinute)}
                    onChange={(e) =>
                      updateDay(day.dayOfWeek, {
                        closeMinute: timeInputToMinutes(
                          e.target.value,
                          day.closeMinute
                        ),
                      })
                    }
                  />
                </div>
              ) : (
                <span className="text-xs text-muted-foreground">Closed</span>
              )}
            </div>
          ))}
        </CardContent>
      </Card>
    </form>
  );
}

export function ClinicSettingsForm() {
  const { overrideClinicId, isReadOnly } = useClinicAdminContext();
  const workspace = useQuery(api.clinicAdmin.getClinicWorkspace, {
    overrideClinicId,
  });

  if (workspace === undefined) {
    return (
      <p className="text-sm text-muted-foreground">Loading clinic settings…</p>
    );
  }

  return (
    <ClinicSettingsEditor
      key={`${workspace.clinic._id}-${workspace.clinic.updatedAt}`}
      clinic={workspace.clinic}
      logoUrl={workspace.logoUrl}
      isReadOnly={isReadOnly}
    />
  );
}
