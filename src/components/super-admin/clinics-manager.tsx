"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowUpRight,
  ExternalLink,
  MailPlus,
  Plus,
  Search,
  Settings2,
  ShieldAlert,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import {
  type ClinicStatus,
  ClinicStatusBadge,
} from "@/components/super-admin/status-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  formatBytes,
  formatDate,
  formatPhp,
  getErrorMessage,
  slugify,
} from "@/lib/format";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

const createClinicSchema = z.object({
  name: z.string().min(2, "Clinic name is required"),
  slug: z
    .string()
    .min(2, "Slug is required")
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Use lowercase letters, numbers, and hyphens"),
  tagline: z.string().optional(),
  primaryColorHex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex color like #0284c7"),
  email: z.string().email("Enter a valid clinic email"),
  ownerEmail: z.string().email("Enter a valid admin email").or(z.literal("")),
  phone: z.string().min(6, "Phone number is required"),
  address: z.string().min(3, "Address is required"),
  city: z.string().min(2, "City is required"),
  province: z.string().min(2, "Province is required"),
  planId: z.string().min(1, "Select a subscription plan"),
  billingCycle: z.enum(["trial", "monthly", "annual"]),
});

type CreateClinicFormValues = z.infer<typeof createClinicSchema>;

type FeatureFlags = {
  odontogramEnabled: boolean;
  xrayStorageEnabled: boolean;
  waitlistAutomationEnabled: boolean;
  recallAutomationEnabled: boolean;
  customBrandingEnabled: boolean;
};

const FEATURE_META: {
  key: keyof FeatureFlags;
  label: string;
  description: string;
}[] = [
  {
    key: "odontogramEnabled",
    label: "32-Tooth SVG Odontogram",
    description: "Interactive tooth surface charting for dentists",
  },
  {
    key: "xrayStorageEnabled",
    label: "X-Ray & Photo Vault",
    description: "Compressed Convex File Storage uploads",
  },
  {
    key: "waitlistAutomationEnabled",
    label: "Waitlist Cancellation Blast",
    description: "Automatic emails when slots open up",
  },
  {
    key: "recallAutomationEnabled",
    label: "6-Month Hygiene Recall",
    description: "Automated semi-annual cleaning reminders",
  },
  {
    key: "customBrandingEnabled",
    label: "Custom Clinic Branding",
    description: "Custom brand colors and logo on /c/[slug]",
  },
];

function ProvisionClinicDialog({
  plans,
}: {
  plans: {
    _id: Id<"subscriptionPlans">;
    code: string;
    name: string;
    monthlyPricePhp: number;
  }[];
}) {
  const [open, setOpen] = useState(false);
  const createClinic = useMutation(api.superAdmin.createClinic);

  const defaultPlanId = plans[0]?._id ?? "";

  const form = useForm<CreateClinicFormValues>({
    resolver: zodResolver(createClinicSchema),
    defaultValues: {
      name: "",
      slug: "",
      tagline: "",
      primaryColorHex: "#0284c7",
      email: "",
      ownerEmail: "",
      phone: "",
      address: "",
      city: "",
      province: "",
      planId: defaultPlanId,
      billingCycle: "trial",
    },
  });

  const watchedPlanId = useWatch({ control: form.control, name: "planId" });
  const watchedBillingCycle = useWatch({
    control: form.control,
    name: "billingCycle",
  });

  const onSubmit = async (values: CreateClinicFormValues) => {
    try {
      const result = await createClinic({
        name: values.name,
        slug: values.slug,
        tagline: values.tagline || undefined,
        primaryColorHex: values.primaryColorHex,
        email: values.email,
        phone: values.phone,
        address: values.address,
        city: values.city,
        province: values.province,
        planId: values.planId as Id<"subscriptionPlans">,
        billingCycle: values.billingCycle,
        ownerEmail: values.ownerEmail || undefined,
      });
      toast.success(`Provisioned clinic /c/${result.slug} with default services.`);
      form.reset();
      setOpen(false);
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to provision clinic."));
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}>
        <Plus className="mr-1.5 size-4" />
        Provision Clinic
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>Provision New Dental Clinic</DialogTitle>
          <DialogDescription>
            Creates the tenant record, seeds the default 6-service dental catalog,
            and issues a Clinic Admin invitation.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="clinic-name">Clinic Name</Label>
              <Input
                id="clinic-name"
                placeholder="Smile Care Dental Iligan"
                {...form.register("name", {
                  onChange: (e) => {
                    if (!form.getFieldState("slug").isDirty) {
                      form.setValue("slug", slugify(e.target.value));
                    }
                  },
                })}
              />
              {form.formState.errors.name ? (
                <p className="text-xs text-destructive">
                  {form.formState.errors.name.message}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="clinic-slug">Public Slug (/c/slug)</Label>
              <Input
                id="clinic-slug"
                placeholder="smile-care-iligan"
                {...form.register("slug")}
              />
              {form.formState.errors.slug ? (
                <p className="text-xs text-destructive">
                  {form.formState.errors.slug.message}
                </p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5 sm:col-span-2">
              <Label htmlFor="clinic-tagline">Tagline (optional)</Label>
              <Input
                id="clinic-tagline"
                placeholder="Gentle family & cosmetic dentistry"
                {...form.register("tagline")}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="clinic-color">Brand Color</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="clinic-color"
                  className="font-mono"
                  {...form.register("primaryColorHex")}
                />
              </div>
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="clinic-email">Clinic Contact Email</Label>
              <Input
                id="clinic-email"
                type="email"
                placeholder="hello@smilecare.ph"
                {...form.register("email")}
              />
              {form.formState.errors.email ? (
                <p className="text-xs text-destructive">
                  {form.formState.errors.email.message}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="owner-email">Clinic Admin Invite Email</Label>
              <Input
                id="owner-email"
                type="email"
                placeholder="dr.santos@smilecare.ph (defaults to clinic email)"
                {...form.register("ownerEmail")}
              />
              {form.formState.errors.ownerEmail ? (
                <p className="text-xs text-destructive">
                  {form.formState.errors.ownerEmail.message}
                </p>
              ) : null}
            </div>
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="clinic-phone">Phone</Label>
              <Input
                id="clinic-phone"
                placeholder="+63 917 555 0100"
                {...form.register("phone")}
              />
              {form.formState.errors.phone ? (
                <p className="text-xs text-destructive">
                  {form.formState.errors.phone.message}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="clinic-city">City</Label>
              <Input
                id="clinic-city"
                placeholder="Iligan City"
                {...form.register("city")}
              />
              {form.formState.errors.city ? (
                <p className="text-xs text-destructive">
                  {form.formState.errors.city.message}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="clinic-province">Province</Label>
              <Input
                id="clinic-province"
                placeholder="Lanao del Norte"
                {...form.register("province")}
              />
              {form.formState.errors.province ? (
                <p className="text-xs text-destructive">
                  {form.formState.errors.province.message}
                </p>
              ) : null}
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="clinic-address">Street Address</Label>
            <Input
              id="clinic-address"
              placeholder="2F Medical Arts Bldg, Quezon Ave"
              {...form.register("address")}
            />
            {form.formState.errors.address ? (
              <p className="text-xs text-destructive">
                {form.formState.errors.address.message}
              </p>
            ) : null}
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>Subscription Plan</Label>
              <Select
                value={watchedPlanId}
                onValueChange={(val) => {
                  if (val) form.setValue("planId", val, { shouldValidate: true });
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose plan" />
                </SelectTrigger>
                <SelectContent>
                  {plans.map((plan) => (
                    <SelectItem key={plan._id} value={plan._id}>
                      {plan.name} ({formatPhp(plan.monthlyPricePhp)}/mo)
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.formState.errors.planId ? (
                <p className="text-xs text-destructive">
                  {form.formState.errors.planId.message}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label>Initial Billing Cycle</Label>
              <Select
                value={watchedBillingCycle}
                onValueChange={(val) => {
                  if (val === "trial" || val === "monthly" || val === "annual") {
                    form.setValue("billingCycle", val);
                  }
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="trial">14-Day Free Trial</SelectItem>
                  <SelectItem value="monthly">Monthly (30 days)</SelectItem>
                  <SelectItem value="annual">Annual (365 days)</SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>

          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              onClick={() => setOpen(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={form.formState.isSubmitting || plans.length === 0}>
              {form.formState.isSubmitting ? "Provisioning…" : "Create Clinic"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ClinicDetailSheet({
  clinicId,
  onClose,
  plans,
}: {
  clinicId: Id<"clinics"> | null;
  onClose: () => void;
  plans: {
    _id: Id<"subscriptionPlans">;
    code: string;
    name: string;
    monthlyPricePhp: number;
  }[];
}) {
  const detail = useQuery(
    api.superAdmin.getClinicDetail,
    clinicId ? { clinicId } : "skip"
  );
  const updateStatus = useMutation(api.superAdmin.updateClinicStatus);
  const changePlan = useMutation(api.superAdmin.changeClinicPlan);
  const updateFeatures = useMutation(api.superAdmin.updateClinicFeatures);
  const inviteAdmin = useMutation(api.superAdmin.inviteClinicAdmin);

  const [statusReason, setStatusReason] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [syncFeatures, setSyncFeatures] = useState(true);
  const [busy, setBusy] = useState(false);

  const handleStatusChange = async (newStatus: ClinicStatus) => {
    if (!clinicId) return;
    setBusy(true);
    try {
      await updateStatus({
        clinicId,
        status: newStatus,
        reason: statusReason || undefined,
      });
      toast.success(`Clinic status updated to ${newStatus.replace("_", " ")}.`);
      setStatusReason("");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not update clinic status."));
    } finally {
      setBusy(false);
    }
  };

  const handlePlanChange = async (planId: string) => {
    if (!clinicId || !detail) return;
    setBusy(true);
    try {
      await changePlan({
        clinicId,
        planId: planId as Id<"subscriptionPlans">,
        billingCycle: detail.clinic.billingCycle,
        syncDefaultFeatures: syncFeatures,
      });
      toast.success("Clinic subscription plan updated.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not change plan."));
    } finally {
      setBusy(false);
    }
  };

  const handleFeatureToggle = async (
    key: keyof FeatureFlags,
    checked: boolean
  ) => {
    if (!clinicId || !detail) return;
    const next: FeatureFlags = {
      ...detail.clinic.featureFlags,
      [key]: checked,
    };
    try {
      await updateFeatures({ clinicId, featureFlags: next });
      toast.success("Feature override saved.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not update feature flags."));
    }
  };

  const handleInviteAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!clinicId || !inviteEmail.trim()) return;
    setBusy(true);
    try {
      await inviteAdmin({ clinicId, email: inviteEmail.trim() });
      toast.success(`Invitation created for ${inviteEmail.trim()}.`);
      setInviteEmail("");
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to send invitation."));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={clinicId !== null} onOpenChange={(v) => !v && onClose()}>
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-lg">
        {detail === undefined ? (
          <div className="p-6 text-sm text-muted-foreground">
            Loading clinic details…
          </div>
        ) : (
          <div className="flex flex-col gap-5 p-4 pt-2">
            <SheetHeader className="p-0">
              <div className="flex items-center gap-2">
                <span
                  className="size-3 rounded-full border"
                  style={{ backgroundColor: detail.clinic.primaryColorHex }}
                />
                <SheetTitle>{detail.clinic.name}</SheetTitle>
                <ClinicStatusBadge status={detail.clinic.status} />
              </div>
              <SheetDescription>
                /c/{detail.clinic.slug} · {detail.clinic.city},{" "}
                {detail.clinic.province} · {detail.staffCount} staff account(s)
              </SheetDescription>
            </SheetHeader>

            {/* Quick Inspection Links */}
            <div className="flex flex-wrap gap-2">
              <Button
                size="sm"
                variant="outline"
                render={<Link href={`/admin?viewAsClinicId=${detail.clinic._id}`} />}
              >
                View As Clinic (Read-Only)
                <ArrowUpRight className="ml-1 size-3.5" />
              </Button>
              <Button
                size="sm"
                variant="outline"
                render={<Link href={`/c/${detail.clinic.slug}`} />}
              >
                Public Portal
                <ExternalLink className="ml-1 size-3.5" />
              </Button>
            </div>

            <Separator />

            {/* Subscription Lifecycle Gate */}
            <div className="space-y-3">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold">Tenant Status Gate</h3>
                <span className="text-xs text-muted-foreground">
                  Ends {formatDate(detail.clinic.subscriptionEndsAt)}
                </span>
              </div>
              <Input
                placeholder="Optional audit reason (e.g. Unpaid invoice #INV-2026-00012)"
                value={statusReason}
                onChange={(e) => setStatusReason(e.target.value)}
              />
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    "active",
                    "trial",
                    "past_due",
                    "suspended",
                    "archived",
                  ] as ClinicStatus[]
                ).map((st) => (
                  <Button
                    key={st}
                    size="sm"
                    variant={
                      detail.clinic.status === st
                        ? "default"
                        : st === "suspended"
                          ? "destructive"
                          : "outline"
                    }
                    disabled={busy || detail.clinic.status === st}
                    onClick={() => handleStatusChange(st)}
                  >
                    {st === "suspended" ? (
                      <ShieldAlert className="mr-1 size-3.5" />
                    ) : null}
                    {st.replace("_", " ")}
                  </Button>
                ))}
              </div>
              <p className="text-xs text-muted-foreground">
                Setting <strong>suspended</strong> or <strong>archived</strong>{" "}
                immediately places staff into Read-Only Mode and blocks public
                bookings on <code>/c/{detail.clinic.slug}</code>.
              </p>
            </div>

            <Separator />

            {/* Plan Switcher */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Subscription Plan</h3>
              <Select
                value={detail.clinic.planId}
                onValueChange={(val) => {
                  if (val && val !== detail.clinic.planId) {
                    void handlePlanChange(val);
                  }
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {plans.map((p) => (
                    <SelectItem key={p._id} value={p._id}>
                      {p.name} — {formatPhp(p.monthlyPricePhp)}/mo
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <div className="flex items-center justify-between text-xs">
                <span className="text-muted-foreground">
                  Reset feature flags to plan defaults on switch
                </span>
                <Switch
                  checked={syncFeatures}
                  onCheckedChange={setSyncFeatures}
                />
              </div>
            </div>

            <Separator />

            {/* Feature Flag Overrides */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Per-Clinic Feature Flags</h3>
              <div className="space-y-2.5">
                {FEATURE_META.map((feat) => (
                  <div
                    key={feat.key}
                    className="flex items-center justify-between gap-3 rounded-lg border p-2.5"
                  >
                    <div>
                      <p className="text-xs font-medium">{feat.label}</p>
                      <p className="text-[11px] text-muted-foreground">
                        {feat.description}
                      </p>
                    </div>
                    <Switch
                      checked={detail.clinic.featureFlags[feat.key]}
                      onCheckedChange={(checked) =>
                        handleFeatureToggle(feat.key, checked)
                      }
                    />
                  </div>
                ))}
              </div>
            </div>

            <Separator />

            {/* Clinic Admin Invitations */}
            <div className="space-y-3">
              <h3 className="text-sm font-semibold">Clinic Admin Invitations</h3>
              <form onSubmit={handleInviteAdmin} className="flex gap-2">
                <Input
                  type="email"
                  placeholder="admin@clinic.ph"
                  value={inviteEmail}
                  onChange={(e) => setInviteEmail(e.target.value)}
                />
                <Button type="submit" size="sm" disabled={busy || !inviteEmail.trim()}>
                  <MailPlus className="mr-1.5 size-3.5" />
                  Invite
                </Button>
              </form>
              {detail.pendingInvitations.length > 0 ? (
                <div className="space-y-1.5">
                  {detail.pendingInvitations.map((inv) => (
                    <div
                      key={inv._id}
                      className="flex items-center justify-between rounded-md bg-muted/60 px-2.5 py-1.5 text-xs"
                    >
                      <span>{inv.email}</span>
                      <span className="text-muted-foreground">
                        Expires {formatDate(inv.expiresAt)}
                      </span>
                    </div>
                  ))}
                </div>
              ) : (
                <p className="text-xs text-muted-foreground">
                  No pending invitations.
                </p>
              )}
            </div>
          </div>
        )}
      </SheetContent>
    </Sheet>
  );
}

export function ClinicsManager() {
  const [statusFilter, setStatusFilter] = useState<"all" | ClinicStatus>("all");
  const [search, setSearch] = useState("");
  const [selectedClinicId, setSelectedClinicId] =
    useState<Id<"clinics"> | null>(null);

  const clinics = useQuery(api.superAdmin.listClinics, {
    status: statusFilter === "all" ? undefined : statusFilter,
    search: search.trim() || undefined,
  });
  const plans = useQuery(api.subscriptions.listPlans, {});

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Dental Clinics
          </h1>
          <p className="text-sm text-muted-foreground">
            Provision tenants, enforce subscription status gates, and override
            feature flags.
          </p>
        </div>
        <ProvisionClinicDialog plans={plans ?? []} />
      </div>

      <Card>
        <CardHeader className="gap-4">
          <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
            <Tabs
              value={statusFilter}
              onValueChange={(val) =>
                setStatusFilter(val as "all" | ClinicStatus)
              }
            >
              <TabsList className="flex-wrap">
                <TabsTrigger value="all">All</TabsTrigger>
                <TabsTrigger value="active">Active</TabsTrigger>
                <TabsTrigger value="trial">Trial</TabsTrigger>
                <TabsTrigger value="past_due">Past Due</TabsTrigger>
                <TabsTrigger value="suspended">Suspended</TabsTrigger>
                <TabsTrigger value="archived">Archived</TabsTrigger>
              </TabsList>
            </Tabs>

            <div className="relative w-full md:w-72">
              <Search className="pointer-events-none absolute top-2.5 left-2.5 size-4 text-muted-foreground" />
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search clinic, slug, city…"
                className="pl-8"
              />
            </div>
          </div>
          <CardTitle className="sr-only">Clinic directory</CardTitle>
          <CardDescription className="sr-only">
            Tenant roster and quota usage
          </CardDescription>
        </CardHeader>

        <CardContent>
          {clinics === undefined ? (
            <div className="py-10 text-center text-sm text-muted-foreground">
              Loading clinics…
            </div>
          ) : clinics.length === 0 ? (
            <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
              No clinics match the current filter.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Clinic</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Renewal Date</TableHead>
                  <TableHead className="text-right">Quotas (D/C/Appt)</TableHead>
                  <TableHead className="text-right">Storage</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {clinics.map((clinic) => (
                  <TableRow key={clinic._id}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: clinic.primaryColorHex }}
                        />
                        <div>
                          <div className="font-medium">{clinic.name}</div>
                          <div className="text-xs text-muted-foreground">
                            /c/{clinic.slug} · {clinic.city}
                          </div>
                        </div>
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">
                        {clinic.plan?.name ?? "Unknown"}
                      </Badge>
                      <div className="mt-0.5 text-[11px] capitalize text-muted-foreground">
                        {clinic.billingCycle}
                      </div>
                    </TableCell>
                    <TableCell>
                      <ClinicStatusBadge status={clinic.status} />
                    </TableCell>
                    <TableCell className="text-xs text-muted-foreground">
                      {formatDate(clinic.subscriptionEndsAt)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {clinic.activeDentistCount}/{clinic.plan?.maxDentists ?? "-"} ·{" "}
                      {clinic.activeChairCount}/{clinic.plan?.maxChairs ?? "-"} ·{" "}
                      {clinic.currentMonthAppointmentCount}/
                      {clinic.plan?.maxAppointmentsPerMonth ?? "-"}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs tabular-nums">
                      {formatBytes(clinic.storageUsedBytes)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex justify-end gap-1">
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => setSelectedClinicId(clinic._id)}
                        >
                          <Settings2 className="mr-1 size-3.5" />
                          Manage
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      <ClinicDetailSheet
        clinicId={selectedClinicId}
        onClose={() => setSelectedClinicId(null)}
        plans={plans ?? []}
      />
    </div>
  );
}
