"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@/lib/api";
import {
  AlertTriangle,
  ExternalLink,
  Lock,
  Save,
  Trash2,
  Upload,
  Wand2,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { useClinicAdminContext } from "@/components/clinic-admin/clinic-admin-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
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
  getErrorCode,
  getErrorMessage,
  minutesToTimeInput,
  slugify,
  timeInputToMinutes,
} from "@/lib/format";
import { api } from "@/lib/api";
import type { Doc, Id } from "@/lib/api";

const MAX_LOGO_BYTES = 500 * 1024;

const COMMON_TIMEZONES = [
  "Asia/Manila",
  "Asia/Singapore",
  "Asia/Hong_Kong",
  "Asia/Tokyo",
  "Asia/Seoul",
  "Australia/Sydney",
  "America/Los_Angeles",
  "America/New_York",
  "Europe/London",
  "UTC",
] as const;

type OperatingHourDay = {
  dayOfWeek: number;
  isOpen: boolean;
  openMinute: number;
  closeMinute: number;
};

const settingsSchema = z.object({
  name: z.string().min(2, "Clinic name must be at least 2 characters"),
  slug: z
    .string()
    .min(2, "Public URL slug must be at least 2 characters")
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Use lowercase letters, numbers, and hyphens only (e.g. bright-smile-makati)"
    ),
  tagline: z.string().optional(),
  primaryColorHex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex color like #0284c7"),
  email: z.string().email("Enter a valid email address"),
  phone: z.string().min(6, "Phone number is required"),
  address: z.string().min(3, "Street address is required"),
  city: z.string().min(2, "City is required"),
  province: z.string().min(2, "Province is required"),
  timezone: z.string().min(2, "Valid IANA timezone is required"),
  slotIntervalMinutes: z.enum(["15", "30"]),
  cancellationWindowHours: z.coerce
    .number()
    .min(0, "Cannot be negative")
    .max(168, "Max 168 hours (7 days)"),
  emergencyBufferMinutesPerDay: z.coerce
    .number()
    .min(0, "Cannot be negative")
    .max(240, "Max 240 minutes per day"),
  requireBookingApproval: z.boolean(),
});

type SettingsFormInput = z.input<typeof settingsSchema>;
type SettingsFormValues = z.output<typeof settingsSchema>;

/** Compresses oversized image logos client-side to WebP/JPEG within the 500 KB guardrail. */
async function compressLogoImage(file: File): Promise<Blob> {
  if (file.size <= MAX_LOGO_BYTES) return file;

  const bitmap = await createImageBitmap(file);
  const maxDim = 512;
  const scale = Math.min(1, maxDim / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("Could not initialize image compressor.");
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const tryEncode = (type: string, quality: number) =>
    new Promise<Blob | null>((resolve) =>
      canvas.toBlob((blob) => resolve(blob), type, quality)
    );

  for (const quality of [0.85, 0.72, 0.58]) {
    const webp = await tryEncode("image/webp", quality);
    if (webp && webp.size <= MAX_LOGO_BYTES) return webp;
    const jpeg = await tryEncode("image/jpeg", quality);
    if (jpeg && jpeg.size <= MAX_LOGO_BYTES) return jpeg;
  }

  throw new Error(
    "Logo could not be compressed under 500 KB. Please choose a smaller image."
  );
}

function ClinicSettingsEditor({
  clinic,
  logoUrl,
  isReadOnly,
  buildHref,
}: {
  clinic: Doc<"clinics">;
  logoUrl: string | null;
  isReadOnly: boolean;
  buildHref: (path: string) => string;
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
  const [logoPreviewUrl, setLogoPreviewUrl] = useState<string | null>(logoUrl);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [logoSizeBytes, setLogoSizeBytes] = useState<number>(0);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [quotaBanner, setQuotaBanner] = useState<string | null>(null);

  const form = useForm<SettingsFormInput, unknown, SettingsFormValues>({
    resolver: zodResolver(settingsSchema),
    defaultValues: {
      name: clinic.name,
      slug: clinic.slug,
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

  const watchedName = useWatch({ control: form.control, name: "name" });
  const watchedSlug = useWatch({ control: form.control, name: "slug" });
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
  const errors = form.formState.errors;

  const updateDay = (dayOfWeek: number, patch: Partial<OperatingHourDay>) => {
    setOperatingHours((prev) =>
      prev.map((d) => (d.dayOfWeek === dayOfWeek ? { ...d, ...patch } : d))
    );
  };

  const handleLogoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingLogo(true);
    try {
      const compressed = await compressLogoImage(file);
      const contentType = compressed.type || "image/webp";
      const { uploadUrl, storageKey } = await generateLogoUploadUrl({
        fileName: file.name || "clinic-logo.webp",
        contentType,
        fileSizeBytes: compressed.size,
      });
      const res = await fetch(uploadUrl, {
        method: "PUT",
        headers: { "Content-Type": contentType },
        body: compressed,
      });
      if (!res.ok) throw new Error("Upload failed.");
      setLogoStorageId(storageKey);
      setLogoSizeBytes(compressed.size);
      setRemoveLogo(false);
      setLogoPreviewUrl(URL.createObjectURL(compressed));
      setQuotaBanner(null);
      toast.success("Logo uploaded. Click Save Settings to apply.");
    } catch (err) {
      const msg = getErrorMessage(err, "Logo upload failed.");
      if (getErrorCode(err) === "QUOTA_EXCEEDED") {
        setQuotaBanner(msg);
      }
      toast.error(msg);
    } finally {
      setUploadingLogo(false);
      e.target.value = "";
    }
  };

  const handleRemoveLogo = () => {
    setLogoStorageId(undefined);
    setLogoPreviewUrl(null);
    setLogoSizeBytes(0);
    setRemoveLogo(true);
    toast.info("Logo marked for removal. Click Save Settings to confirm.");
  };

  const onSubmit = async (values: SettingsFormValues) => {
    try {
      await updateSettings({
        name: values.name,
        slug: values.slug,
        tagline: values.tagline || undefined,
        primaryColorHex: values.primaryColorHex,
        logoStorageId: removeLogo ? undefined : logoStorageId,
        logoSizeBytes: logoSizeBytes || undefined,
        removeLogo,
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
      setQuotaBanner(null);
      toast.success("Clinic settings and operating hours saved.");
    } catch (err) {
      const msg = getErrorMessage(err, "Could not save clinic settings.");
      if (getErrorCode(err) === "QUOTA_EXCEEDED") {
        setQuotaBanner(msg);
      }
      toast.error(msg);
    }
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Clinic Settings &amp; Operating Hours
          </h1>
          <p className="text-sm text-muted-foreground">
            Manage public contact details, booking slug{" "}
            <code>/c/{watchedSlug || clinic.slug}</code>, branding, policies,
            and weekly hours.
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

      {quotaBanner ? (
        <Alert variant="destructive">
          <AlertTriangle className="size-4" />
          <AlertTitle>Storage Quota Reached</AlertTitle>
          <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
            <span>{quotaBanner}</span>
            <Button
              size="sm"
              variant="outline"
              className="h-7 text-xs"
              render={<Link href={buildHref("/admin/billing")} />}
            >
              View Plan &amp; Storage
            </Button>
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Clinic Identity & Contact */}
      <Card>
        <CardHeader>
          <CardTitle>Clinic Profile &amp; Location</CardTitle>
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
              {errors.name ? (
                <p className="text-xs text-destructive">{errors.name.message}</p>
              ) : null}
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

          <div className="space-y-1.5">
            <div className="flex items-center justify-between gap-2">
              <Label htmlFor="set-slug">Public Booking Portal Slug</Label>
              <Link
                href={`/c/${clinic.slug}`}
                target="_blank"
                className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
              >
                Open <code>/c/{clinic.slug}</code>
                <ExternalLink className="size-3" />
              </Link>
            </div>
            <div className="flex items-center gap-2">
              <div className="flex flex-1 items-center rounded-md border bg-muted/30">
                <span className="px-3 font-mono text-xs text-muted-foreground">
                  /c/
                </span>
                <Input
                  id="set-slug"
                  disabled={isReadOnly}
                  className="border-0 bg-transparent pl-0 font-mono focus-visible:ring-0"
                  placeholder="bright-smile-makati"
                  {...form.register("slug")}
                />
              </div>
              <Button
                type="button"
                size="sm"
                variant="outline"
                disabled={isReadOnly}
                onClick={() =>
                  form.setValue("slug", slugify(watchedName || clinic.name), {
                    shouldValidate: true,
                  })
                }
              >
                <Wand2 className="mr-1 size-3.5" />
                From Name
              </Button>
            </div>
            {errors.slug ? (
              <p className="text-xs text-destructive">{errors.slug.message}</p>
            ) : (
              <p className="text-xs text-muted-foreground">
                Changing your slug updates your public patient booking link
                immediately.
              </p>
            )}
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
              {errors.email ? (
                <p className="text-xs text-destructive">
                  {errors.email.message}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="set-phone">Phone Number</Label>
              <Input
                id="set-phone"
                disabled={isReadOnly}
                {...form.register("phone")}
              />
              {errors.phone ? (
                <p className="text-xs text-destructive">
                  {errors.phone.message}
                </p>
              ) : null}
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
              {errors.address ? (
                <p className="text-xs text-destructive">
                  {errors.address.message}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="set-city">City</Label>
              <Input
                id="set-city"
                disabled={isReadOnly}
                {...form.register("city")}
              />
              {errors.city ? (
                <p className="text-xs text-destructive">{errors.city.message}</p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="set-prov">Province</Label>
              <Input
                id="set-prov"
                disabled={isReadOnly}
                {...form.register("province")}
              />
              {errors.province ? (
                <p className="text-xs text-destructive">
                  {errors.province.message}
                </p>
              ) : null}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="set-tz">IANA Timezone</Label>
              <Input
                id="set-tz"
                list="iana-timezones"
                disabled={isReadOnly}
                className="font-mono"
                {...form.register("timezone")}
              />
              <datalist id="iana-timezones">
                {COMMON_TIMEZONES.map((tz) => (
                  <option key={tz} value={tz} />
                ))}
              </datalist>
              {errors.timezone ? (
                <p className="text-xs text-destructive">
                  {errors.timezone.message}
                </p>
              ) : null}
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
                Accent color and logo for{" "}
                <code>/c/{watchedSlug || clinic.slug}</code>
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
              {errors.primaryColorHex ? (
                <p className="text-xs text-destructive">
                  {errors.primaryColorHex.message}
                </p>
              ) : null}
            </div>

            <div className="space-y-2">
              <Label htmlFor="set-logo">Clinic Logo (auto-compressed ≤ 500 KB)</Label>
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

              {logoPreviewUrl ? (
                <div className="flex items-center justify-between gap-3 rounded-lg border bg-muted/25 p-2.5">
                  <div className="flex items-center gap-3">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={logoPreviewUrl}
                      alt={`${clinic.name} logo preview`}
                      className="size-10 rounded-md border bg-background object-contain p-0.5"
                    />
                    <span className="text-xs text-muted-foreground">
                      {logoStorageId !== clinic.logoStorageId
                        ? "New logo staged — click Save Settings to apply."
                        : "Logo active on public booking portal."}
                    </span>
                  </div>
                  {!isReadOnly && customBrandingEnabled ? (
                    <Button
                      type="button"
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-destructive hover:text-destructive"
                      onClick={handleRemoveLogo}
                    >
                      <Trash2 className="mr-1 size-3.5" />
                      Remove
                    </Button>
                  ) : null}
                </div>
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
                  max={168}
                  disabled={isReadOnly}
                  className="font-mono"
                  {...form.register("cancellationWindowHours")}
                />
                {errors.cancellationWindowHours ? (
                  <p className="text-xs text-destructive">
                    {errors.cancellationWindowHours.message}
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="set-emerg">Daily Emergency Buffer (mins)</Label>
                <Input
                  id="set-emerg"
                  type="number"
                  min={0}
                  max={240}
                  disabled={isReadOnly}
                  className="font-mono"
                  {...form.register("emergencyBufferMinutesPerDay")}
                />
                {errors.emergencyBufferMinutesPerDay ? (
                  <p className="text-xs text-destructive">
                    {errors.emergencyBufferMinutesPerDay.message}
                  </p>
                ) : null}
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
  const { overrideClinicId, isReadOnly, buildHref } = useClinicAdminContext();
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
      buildHref={buildHref}
    />
  );
}
