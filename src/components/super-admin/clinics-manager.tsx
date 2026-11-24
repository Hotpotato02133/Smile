"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "convex/react";
import {
  ArrowUpRight,
  Building2,
  CalendarPlus,
  Check,
  Copy,
  CreditCard,
  ExternalLink,
  MailPlus,
  Plus,
  Search,
  Settings2,
  ShieldAlert,
  Sparkles,
  Trash2,
} from "lucide-react";
import Link from "next/link";
import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import {
  type ClinicStatus,
  ClinicStatusBadge,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
  PaymentStatusBadge,
} from "@/components/super-admin/status-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  formatBytes,
  formatDate,
  formatDateTime,
  formatPhp,
  getErrorMessage,
  slugify,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

const createClinicSchema = z.object({
  name: z.string().min(2, "Clinic name is required"),
  slug: z
    .string()
    .min(2, "Slug is required")
    .regex(
      /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
      "Use lowercase letters, numbers, and hyphens"
    ),
  tagline: z.string().optional(),
  primaryColorHex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex color like #6C5CE7"),
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

const editClinicSchema = z.object({
  name: z.string().min(2, "Clinic name is required"),
  tagline: z.string().optional(),
  primaryColorHex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Use a 6-digit hex color"),
  email: z.string().email("Enter a valid clinic email"),
  phone: z.string().min(6, "Phone number is required"),
  address: z.string().min(3, "Address is required"),
  city: z.string().min(2, "City is required"),
  province: z.string().min(2, "Province is required"),
  slotIntervalMinutes: z.enum(["15", "30"]),
  cancellationWindowHours: z.coerce.number().min(0).max(168),
});

type EditClinicFormInput = z.input<typeof editClinicSchema>;
type EditClinicFormValues = z.output<typeof editClinicSchema>;

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

const STATUS_TABS: { value: "all" | ClinicStatus; label: string }[] = [
  { value: "all", label: "All" },
  { value: "active", label: "Active" },
  { value: "trial", label: "Trial" },
  { value: "past_due", label: "Past Due" },
  { value: "suspended", label: "Suspended" },
  { value: "archived", label: "Archived" },
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
  const ensurePlans = useMutation(api.superAdmin.ensureDefaultPlans);
  const [seeding, setSeeding] = useState(false);
  const [provisionedResult, setProvisionedResult] = useState<{
    slug: string;
    inviteUrl: string | null;
  } | null>(null);
  const [copiedInvite, setCopiedInvite] = useState(false);

  const defaultPlanId = plans[0]?._id ?? "";

  const form = useForm<CreateClinicFormValues>({
    resolver: zodResolver(createClinicSchema),
    defaultValues: {
      name: "",
      slug: "",
      tagline: "",
      primaryColorHex: "#6C5CE7",
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
  const watchedSlug = useWatch({ control: form.control, name: "slug" });
  const watchedColor = useWatch({
    control: form.control,
    name: "primaryColorHex",
  });

  useEffect(() => {
    if (!watchedPlanId && plans.length > 0) {
      form.setValue("planId", plans[0]._id);
    }
  }, [plans, watchedPlanId, form]);

  const handleSeedPlans = async () => {
    setSeeding(true);
    try {
      const res = await ensurePlans({});
      toast.success(
        res.plansCreated > 0
          ? `Seeded ${res.plansCreated} default subscription plans.`
          : "Default subscription plans are already configured."
      );
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to seed plans."));
    } finally {
      setSeeding(false);
    }
  };

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
      const inviteUrl = result.ownerInviteToken
        ? `${window.location.origin}/invite/${result.ownerInviteToken}`
        : null;
      toast.success(
        `Provisioned /c/${result.slug} with default chair OP-1 & 6 dental services.`
      );
      form.reset();
      if (inviteUrl) {
        setCopiedInvite(false);
        setProvisionedResult({ slug: result.slug, inviteUrl });
      } else {
        setOpen(false);
      }
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to provision clinic."));
    }
  };

  const handleCopyInviteLink = async () => {
    if (!provisionedResult?.inviteUrl) return;
    try {
      await navigator.clipboard.writeText(provisionedResult.inviteUrl);
      setCopiedInvite(true);
      toast.success("Clinic Admin invitation link copied.");
    } catch {
      toast.error("Could not copy link to clipboard.");
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) {
          setProvisionedResult(null);
          setCopiedInvite(false);
        }
      }}
    >
      <DialogTrigger
        render={
          <Button className="h-9 rounded-full bg-[#6C5CE7] px-4 text-xs font-semibold text-white hover:bg-[#5B4BD6]" />
        }
      >
        <Plus className="mr-1.5 size-4" />
        Provision Clinic
      </DialogTrigger>
      <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
        <DialogHeader>
          <DialogTitle>
            {provisionedResult
              ? "Clinic Provisioned Successfully"
              : "Provision New Dental Clinic"}
          </DialogTitle>
          <DialogDescription>
            {provisionedResult
              ? "Share or copy the Clinic Admin invitation link below. An email has also been queued via Resend."
              : "Creates the tenant, seeds Operatory Chair 1 (OP-1), the 6-service dental catalog, and operating hours, and sends a 7-day Clinic Admin invitation."}
          </DialogDescription>
        </DialogHeader>

        {provisionedResult ? (
          <div className="space-y-4">
            <div className="rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-xs text-emerald-950">
              <p className="font-semibold">
                Tenant <span className="font-mono">/c/{provisionedResult.slug}</span>{" "}
                is ready!
              </p>
              <p className="mt-1 text-emerald-900/80">
                Operatory Chair 1 (OP-1) and 6 standard dental procedures have
                been seeded automatically.
              </p>
            </div>

            {provisionedResult.inviteUrl ? (
              <div className="space-y-1.5">
                <Label>Clinic Admin Invitation Link</Label>
                <div className="flex items-center gap-2">
                  <Input
                    readOnly
                    value={provisionedResult.inviteUrl}
                    className="font-mono text-xs"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    onClick={handleCopyInviteLink}
                    className="shrink-0"
                  >
                    {copiedInvite ? (
                      <>
                        <Check className="mr-1.5 size-3.5 text-emerald-600" />
                        Copied
                      </>
                    ) : (
                      <>
                        <Copy className="mr-1.5 size-3.5" />
                        Copy
                      </>
                    )}
                  </Button>
                </div>
              </div>
            ) : null}

            <DialogFooter>
              <Button
                type="button"
                onClick={() => {
                  setProvisionedResult(null);
                  setOpen(false);
                }}
                className="bg-[#6C5CE7] text-white hover:bg-[#5B4BD6]"
              >
                Done
              </Button>
            </DialogFooter>
          </div>
        ) : (
        <>

        {plans.length === 0 ? (
          <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
            <p className="font-semibold">No subscription plans found</p>
            <p className="mt-1 text-xs text-amber-900/80">
              Seed the default Free 14-Day Trial, Smile Starter, and Smile Pro
              Clinic plans before onboarding a clinic.
            </p>
            <Button
              type="button"
              size="sm"
              disabled={seeding}
              onClick={handleSeedPlans}
              className="mt-3 h-8 rounded-full bg-amber-900 px-3.5 text-xs text-white hover:bg-amber-800"
            >
              <Sparkles className="mr-1.5 size-3.5" />
              {seeding ? "Seeding…" : "Seed Default Plans"}
            </Button>
          </div>
        ) : null}

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
              <Label htmlFor="clinic-slug">Public Slug</Label>
              <Input
                id="clinic-slug"
                placeholder="smile-care-iligan"
                className="font-mono text-xs"
                {...form.register("slug")}
              />
              {watchedSlug ? (
                <p className="text-[11px] text-slate-500">
                  Booking URL:{" "}
                  <span className="font-mono text-slate-700">
                    /c/{watchedSlug}
                  </span>
                </p>
              ) : null}
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
                <input
                  type="color"
                  aria-label="Pick brand color"
                  value={
                    /^#[0-9a-fA-F]{6}$/.test(watchedColor)
                      ? watchedColor
                      : "#6C5CE7"
                  }
                  onChange={(e) =>
                    form.setValue("primaryColorHex", e.target.value, {
                      shouldValidate: true,
                    })
                  }
                  className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border border-slate-200 bg-white p-1"
                />
                <Input
                  id="clinic-color"
                  className="font-mono text-xs"
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
                placeholder="dr.santos@smilecare.ph (optional)"
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
            <Button
              type="submit"
              disabled={form.formState.isSubmitting || plans.length === 0}
              className="bg-[#6C5CE7] text-white hover:bg-[#5B4BD6]"
            >
              {form.formState.isSubmitting ? "Provisioning…" : "Create Clinic"}
            </Button>
          </DialogFooter>
        </form>
        </>
        )}
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
  const revokeInvite = useMutation(api.superAdmin.revokeInvitation);
  const updateDetails = useMutation(api.superAdmin.updateClinicDetails);
  const extendSub = useMutation(api.superAdmin.extendClinicSubscription);

  const [statusReason, setStatusReason] = useState("");
  const [inviteEmail, setInviteEmail] = useState("");
  const [syncFeatures, setSyncFeatures] = useState(true);
  const [planOverride, setPlanOverride] = useState<string | null>(null);
  const [cycleOverride, setCycleOverride] = useState<
    "trial" | "monthly" | "annual" | null
  >(null);
  const [busy, setBusy] = useState(false);

  const selectedPlanId = planOverride ?? detail?.clinic.planId ?? "";
  const selectedCycle = cycleOverride ?? detail?.clinic.billingCycle ?? "monthly";

  const editForm = useForm<EditClinicFormInput, unknown, EditClinicFormValues>({
    resolver: zodResolver(editClinicSchema),
    defaultValues: {
      name: "",
      tagline: "",
      primaryColorHex: "#6C5CE7",
      email: "",
      phone: "",
      address: "",
      city: "",
      province: "",
      slotIntervalMinutes: "30",
      cancellationWindowHours: 24,
    },
  });

  const watchedEditColor = useWatch({
    control: editForm.control,
    name: "primaryColorHex",
  });
  const watchedSlotInterval = useWatch({
    control: editForm.control,
    name: "slotIntervalMinutes",
  });

  useEffect(() => {
    if (!detail) return;
    editForm.reset({
      name: detail.clinic.name,
      tagline: detail.clinic.tagline ?? "",
      primaryColorHex: detail.clinic.primaryColorHex,
      email: detail.clinic.email,
      phone: detail.clinic.phone,
      address: detail.clinic.address,
      city: detail.clinic.city,
      province: detail.clinic.province,
      slotIntervalMinutes: detail.clinic.slotIntervalMinutes === 15 ? "15" : "30",
      cancellationWindowHours: detail.clinic.cancellationWindowHours,
    });
  }, [detail, editForm]);

  const handleStatusChange = async (newStatus: ClinicStatus) => {
    if (!clinicId) return;
    if (
      (newStatus === "suspended" || newStatus === "archived") &&
      typeof window !== "undefined"
    ) {
      const confirmed = window.confirm(
        `Set ${detail?.clinic.name ?? "this clinic"} to "${newStatus}"? Clinic staff will immediately be restricted to Read-Only Mode and public bookings on /c/${detail?.clinic.slug ?? ""} will be blocked.`
      );
      if (!confirmed) return;
    }
    setBusy(true);
    try {
      const res = await updateStatus({
        clinicId,
        status: newStatus,
        reason: statusReason || undefined,
      });
      if (newStatus === "active" && res.isSubscriptionExpired) {
        toast.warning(
          "Clinic marked active, but its subscription end date is in the past. Record a payment or extend days to prevent auto past-due."
        );
      } else {
        toast.success(
          `Clinic status updated to ${newStatus.replace("_", " ")}.`
        );
      }
      setStatusReason("");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not update clinic status."));
    } finally {
      setBusy(false);
    }
  };

  const handleApplyPlanAndCycle = async () => {
    if (!clinicId || !selectedPlanId) return;
    setBusy(true);
    try {
      await changePlan({
        clinicId,
        planId: selectedPlanId as Id<"subscriptionPlans">,
        billingCycle: selectedCycle,
        syncDefaultFeatures: syncFeatures,
      });
      setPlanOverride(null);
      setCycleOverride(null);
      toast.success("Plan and billing cycle updated.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not update plan."));
    } finally {
      setBusy(false);
    }
  };

  const handleExtendDays = async (days: number) => {
    if (!clinicId) return;
    setBusy(true);
    try {
      const res = await extendSub({
        clinicId,
        extraDays: days,
        reason: `Super Admin manual +${days}d extension`,
      });
      toast.success(
        `Extended subscription by ${days} days (ends ${formatDate(res.subscriptionEndsAt)}).`
      );
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not extend subscription."));
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

  const handleRevokeInvite = async (invitationId: Id<"staffInvitations">) => {
    setBusy(true);
    try {
      await revokeInvite({ invitationId });
      toast.success("Pending invitation revoked.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to revoke invitation."));
    } finally {
      setBusy(false);
    }
  };

  const handleSaveDetails = async (values: EditClinicFormValues) => {
    if (!clinicId) return;
    try {
      await updateDetails({
        clinicId,
        name: values.name,
        tagline: values.tagline || undefined,
        primaryColorHex: values.primaryColorHex,
        email: values.email,
        phone: values.phone,
        address: values.address,
        city: values.city,
        province: values.province,
        slotIntervalMinutes: Number(values.slotIntervalMinutes),
        cancellationWindowHours: values.cancellationWindowHours,
      });
      toast.success("Clinic profile updated.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to update clinic profile."));
    }
  };

  return (
    <Sheet
      open={clinicId !== null}
      onOpenChange={(v) => {
        if (!v) {
          setPlanOverride(null);
          setCycleOverride(null);
          onClose();
        }
      }}
    >
      <SheetContent side="right" className="w-full overflow-y-auto sm:max-w-xl">
        {detail === undefined ? (
          <div className="space-y-4 p-6">
            <div className="h-6 w-48 animate-pulse rounded-lg bg-slate-100" />
            <div className="h-24 w-full animate-pulse rounded-xl bg-slate-100" />
            <div className="h-44 w-full animate-pulse rounded-xl bg-slate-100" />
          </div>
        ) : (
          <div className="flex flex-col gap-5 p-5">
            <SheetHeader className="p-0 text-left">
              <div className="flex flex-wrap items-center gap-2 pr-8">
                <span
                  className="size-3 shrink-0 rounded-full border border-slate-200"
                  style={{ backgroundColor: detail.clinic.primaryColorHex }}
                />
                <SheetTitle className="text-lg font-bold text-slate-950">
                  {detail.clinic.name}
                </SheetTitle>
                <ClinicStatusBadge status={detail.clinic.status} />
              </div>
              <SheetDescription className="text-xs text-slate-500">
                <span className="font-mono">/c/{detail.clinic.slug}</span> ·{" "}
                {detail.clinic.city}, {detail.clinic.province} ·{" "}
                {detail.staffCount} staff account
                {detail.staffCount === 1 ? "" : "s"}
              </SheetDescription>
            </SheetHeader>

            {/* Read-Only Multi-Portal Impersonation Strip (Law #3 / Spec §1.2) */}
            <div className="rounded-xl border border-slate-200/80 bg-[#F8FAFC] p-3">
              <p className="text-[11px] font-semibold text-slate-500">
                Read-Only Impersonation &amp; Portals
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button
                  size="sm"
                  variant="outline"
                  render={
                    <Link href={`/admin?viewAsClinicId=${detail.clinic._id}`} />
                  }
                  className="h-7 rounded-full border-slate-200 bg-white px-3 text-xs font-semibold"
                >
                  Clinic Admin
                  <ArrowUpRight className="ml-1 size-3" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  render={
                    <Link
                      href={`/front-desk?viewAsClinicId=${detail.clinic._id}`}
                    />
                  }
                  className="h-7 rounded-full border-slate-200 bg-white px-3 text-xs font-semibold"
                >
                  Front Desk
                  <ArrowUpRight className="ml-1 size-3" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  render={
                    <Link href={`/staff?viewAsClinicId=${detail.clinic._id}`} />
                  }
                  className="h-7 rounded-full border-slate-200 bg-white px-3 text-xs font-semibold"
                >
                  Dentist Staff
                  <ArrowUpRight className="ml-1 size-3" />
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  render={<Link href={`/c/${detail.clinic.slug}`} />}
                  className="h-7 rounded-full border-slate-200 bg-white px-3 text-xs font-semibold"
                >
                  Public Booking
                  <ExternalLink className="ml-1 size-3" />
                </Button>
              </div>
            </div>

            <Tabs defaultValue="controls" className="w-full">
              <TabsList className="grid w-full grid-cols-3 rounded-xl bg-[#F6F8FB] p-1">
                <TabsTrigger value="controls" className="rounded-lg text-xs">
                  Controls
                </TabsTrigger>
                <TabsTrigger value="details" className="rounded-lg text-xs">
                  Clinic Info
                </TabsTrigger>
                <TabsTrigger value="activity" className="rounded-lg text-xs">
                  Billing &amp; Logs
                </TabsTrigger>
              </TabsList>

              {/* TAB 1: Lifecycle, Plan, Features & Invites */}
              <TabsContent value="controls" className="mt-4 space-y-5">
                {/* Tenant Status Gate */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-950">
                      Tenant Status Gate
                    </h3>
                    <span className="text-xs tabular-nums text-slate-500">
                      Ends {formatDate(detail.clinic.subscriptionEndsAt)}
                    </span>
                  </div>
                  <Input
                    placeholder="Optional audit reason (e.g. Unpaid invoice #INV-2026-00012)"
                    value={statusReason}
                    onChange={(e) => setStatusReason(e.target.value)}
                  />
                  <div className="flex flex-wrap gap-1.5">
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
                        className="h-8 rounded-full px-3 text-xs capitalize"
                      >
                        {st === "suspended" ? (
                          <ShieldAlert className="mr-1 size-3.5" />
                        ) : null}
                        {st.replace("_", " ")}
                      </Button>
                    ))}
                  </div>
                  <p className="text-xs text-slate-500">
                    Setting <strong>suspended</strong> or{" "}
                    <strong>archived</strong> immediately puts clinic staff into
                    Read-Only Mode and blocks public bookings on{" "}
                    <span className="font-mono">/c/{detail.clinic.slug}</span>.
                  </p>
                </div>

                <Separator />

                {/* Plan, Billing Cycle & Quick Extensions */}
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-slate-950">
                    Subscription Plan &amp; Cycle
                  </h3>
                  <div className="grid gap-2.5 sm:grid-cols-2">
                    <Select
                      value={selectedPlanId}
                      onValueChange={(val) => {
                        if (val) setPlanOverride(val);
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue placeholder="Choose plan" />
                      </SelectTrigger>
                      <SelectContent>
                        {plans.map((p) => (
                          <SelectItem key={p._id} value={p._id}>
                            {p.name} — {formatPhp(p.monthlyPricePhp)}/mo
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>

                    <Select
                      value={selectedCycle}
                      onValueChange={(val) => {
                        if (
                          val === "trial" ||
                          val === "monthly" ||
                          val === "annual"
                        ) {
                          setCycleOverride(val);
                        }
                      }}
                    >
                      <SelectTrigger className="w-full">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="trial">Trial</SelectItem>
                        <SelectItem value="monthly">Monthly</SelectItem>
                        <SelectItem value="annual">Annual</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-slate-600">
                      Reset feature flags to plan defaults on save
                    </span>
                    <Switch
                      checked={syncFeatures}
                      onCheckedChange={setSyncFeatures}
                    />
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <span className="inline-flex items-center gap-1 text-xs text-slate-500">
                        <CalendarPlus className="size-3.5" />
                        Extend:
                      </span>
                      {[7, 14, 30].map((days) => (
                        <Button
                          key={days}
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busy}
                          onClick={() => handleExtendDays(days)}
                          className="h-7 rounded-full px-2.5 text-xs"
                        >
                          +{days}d
                        </Button>
                      ))}
                    </div>

                    <Button
                      type="button"
                      size="sm"
                      disabled={
                        busy ||
                        (selectedPlanId === detail.clinic.planId &&
                          selectedCycle === detail.clinic.billingCycle)
                      }
                      onClick={handleApplyPlanAndCycle}
                      className="h-8 rounded-full bg-slate-950 px-4 text-xs font-semibold text-white hover:bg-slate-800"
                    >
                      Save Plan
                    </Button>
                  </div>
                </div>

                <Separator />

                {/* Per-Clinic Feature Flags */}
                <div className="space-y-3">
                  <h3 className="text-sm font-semibold text-slate-950">
                    Per-Clinic Feature Flags
                  </h3>
                  <div className="space-y-2">
                    {FEATURE_META.map((feat) => (
                      <div
                        key={feat.key}
                        className="flex items-center justify-between gap-3 rounded-xl border border-slate-200/80 bg-[#F8FAFC] p-3"
                      >
                        <div>
                          <p className="text-xs font-semibold text-slate-900">
                            {feat.label}
                          </p>
                          <p className="text-[11px] text-slate-500">
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
                  <h3 className="text-sm font-semibold text-slate-950">
                    Clinic Admin Invitations
                  </h3>
                  <form onSubmit={handleInviteAdmin} className="flex gap-2">
                    <Input
                      type="email"
                      placeholder="admin@clinic.ph"
                      value={inviteEmail}
                      onChange={(e) => setInviteEmail(e.target.value)}
                    />
                    <Button
                      type="submit"
                      size="sm"
                      disabled={busy || !inviteEmail.trim()}
                      className="shrink-0 rounded-xl bg-slate-950 text-white hover:bg-slate-800"
                    >
                      <MailPlus className="mr-1.5 size-3.5" />
                      Invite
                    </Button>
                  </form>
                  {detail.pendingInvitations.length > 0 ? (
                    <div className="space-y-1.5">
                      {detail.pendingInvitations.map((inv) => (
                        <div
                          key={inv._id}
                          className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-[#F8FAFC] px-3 py-2 text-xs"
                        >
                          <div className="min-w-0">
                            <p className="truncate font-medium text-slate-900">
                              {inv.email}
                            </p>
                            <p className="text-[11px] text-slate-500">
                              Expires {formatDate(inv.expiresAt)}
                            </p>
                          </div>
                          <Button
                            type="button"
                            size="sm"
                            variant="ghost"
                            disabled={busy}
                            onClick={() => handleRevokeInvite(inv._id)}
                            className="h-7 rounded-full px-2.5 text-xs text-rose-700 hover:bg-rose-50 hover:text-rose-800"
                          >
                            <Trash2 className="mr-1 size-3" />
                            Revoke
                          </Button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-slate-500">
                      No pending Clinic Admin invitations.
                    </p>
                  )}
                </div>
              </TabsContent>

              {/* TAB 2: Edit Clinic Profile & Policies */}
              <TabsContent value="details" className="mt-4">
                <form
                  onSubmit={editForm.handleSubmit(handleSaveDetails)}
                  className="space-y-4"
                >
                  <div className="space-y-1.5">
                    <Label htmlFor="edit-name">Clinic Name</Label>
                    <Input id="edit-name" {...editForm.register("name")} />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-3">
                    <div className="space-y-1.5 sm:col-span-2">
                      <Label htmlFor="edit-tagline">Tagline</Label>
                      <Input
                        id="edit-tagline"
                        {...editForm.register("tagline")}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-color">Brand Color</Label>
                      <div className="flex items-center gap-2">
                        <input
                          type="color"
                          aria-label="Edit brand color"
                          value={
                            /^#[0-9a-fA-F]{6}$/.test(watchedEditColor)
                              ? watchedEditColor
                              : "#6C5CE7"
                          }
                          onChange={(e) =>
                            editForm.setValue(
                              "primaryColorHex",
                              e.target.value,
                              { shouldValidate: true }
                            )
                          }
                          className="h-9 w-10 shrink-0 cursor-pointer rounded-lg border border-slate-200 bg-white p-1"
                        />
                        <Input
                          id="edit-color"
                          className="font-mono text-xs"
                          {...editForm.register("primaryColorHex")}
                        />
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-email">Contact Email</Label>
                      <Input
                        id="edit-email"
                        type="email"
                        {...editForm.register("email")}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-phone">Phone</Label>
                      <Input id="edit-phone" {...editForm.register("phone")} />
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label htmlFor="edit-address">Street Address</Label>
                    <Input id="edit-address" {...editForm.register("address")} />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-city">City</Label>
                      <Input id="edit-city" {...editForm.register("city")} />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-province">Province</Label>
                      <Input
                        id="edit-province"
                        {...editForm.register("province")}
                      />
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label>Slot Interval</Label>
                      <Select
                        value={watchedSlotInterval}
                        onValueChange={(val) => {
                          if (val === "15" || val === "30") {
                            editForm.setValue("slotIntervalMinutes", val);
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
                    <div className="space-y-1.5">
                      <Label htmlFor="edit-cancel">
                        Cancellation Window (hrs)
                      </Label>
                      <Input
                        id="edit-cancel"
                        type="number"
                        min={0}
                        max={168}
                        {...editForm.register("cancellationWindowHours")}
                      />
                    </div>
                  </div>

                  <div className="pt-2">
                    <Button
                      type="submit"
                      disabled={editForm.formState.isSubmitting}
                      className="w-full rounded-full bg-[#6C5CE7] text-white hover:bg-[#5B4BD6]"
                    >
                      {editForm.formState.isSubmitting
                        ? "Saving changes…"
                        : "Save Clinic Profile"}
                    </Button>
                  </div>
                </form>
              </TabsContent>

              {/* TAB 3: Recent Payments & Audit Logs */}
              <TabsContent value="activity" className="mt-4 space-y-5">
                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-950">
                      Recent Subscription Invoices
                    </h3>
                    <Button
                      size="sm"
                      variant="outline"
                      render={
                        <Link
                          href={`/super-admin/billing?renewClinicId=${detail.clinic._id}`}
                        />
                      }
                      className="h-7 rounded-full px-3 text-xs font-semibold"
                    >
                      <CreditCard className="mr-1 size-3" />
                      Record Payment
                    </Button>
                  </div>

                  {detail.payments.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-500">
                      No subscription invoices recorded for this clinic yet.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {detail.payments.map((pay) => (
                        <div
                          key={pay._id}
                          className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-[#F8FAFC] p-3 text-xs"
                        >
                          <div className="min-w-0">
                            <p className="font-mono font-semibold text-slate-900">
                              {pay.invoiceNumber}
                            </p>
                            <p className="text-[11px] text-slate-500">
                              {
                                PAYMENT_METHOD_LABELS[
                                  pay.paymentMethod as PaymentMethod
                                ]
                              }{" "}
                              · {formatDate(pay.periodStart)} –{" "}
                              {formatDate(pay.periodEnd)}
                            </p>
                          </div>
                          <div className="flex shrink-0 flex-col items-end gap-1">
                            <span className="font-semibold tabular-nums text-slate-950">
                              {formatPhp(pay.amountPhp)}
                            </span>
                            <PaymentStatusBadge status={pay.status} />
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>

                <Separator />

                <div className="space-y-2.5">
                  <div className="flex items-center justify-between">
                    <h3 className="text-sm font-semibold text-slate-950">
                      Recent Audit Trail
                    </h3>
                    <Link
                      href="/super-admin/audit-logs"
                      className="text-xs font-semibold text-[#6C5CE7] hover:underline"
                    >
                      Full Explorer →
                    </Link>
                  </div>

                  {detail.recentAuditLogs.length === 0 ? (
                    <p className="rounded-xl border border-dashed border-slate-200 p-4 text-center text-xs text-slate-500">
                      No audit events logged yet.
                    </p>
                  ) : (
                    <div className="space-y-2">
                      {detail.recentAuditLogs.map((log) => (
                        <div
                          key={log._id}
                          className="rounded-xl border border-slate-200/80 bg-[#F8FAFC] p-3 text-xs"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <Badge
                              variant="outline"
                              className="rounded-full bg-white font-mono text-[10px]"
                            >
                              {log.actionType}
                            </Badge>
                            <span className="text-[11px] text-slate-500">
                              {formatDateTime(log.createdAt)}
                            </span>
                          </div>
                          <p className="mt-1 text-[11px] text-slate-600">
                            Target:{" "}
                            <span className="font-mono">{log.targetEntity}</span>{" "}
                            · Actor role: {log.actorRole}
                          </p>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </TabsContent>
            </Tabs>
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-950">
            Dental Clinics
          </h1>
          <p className="text-sm text-slate-600">
            Provision tenants, enforce subscription status gates, inspect
            portals, and override feature flags.
          </p>
        </div>
        <ProvisionClinicDialog plans={plans ?? []} />
      </div>

      {/* Filter & Search Toolbar */}
      <section className="rounded-2xl border border-slate-200/80 bg-white p-4 sm:p-5">
        <div className="flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex gap-1.5 overflow-x-auto pb-1 lg:pb-0">
            {STATUS_TABS.map((tab) => {
              const active = statusFilter === tab.value;
              return (
                <button
                  key={tab.value}
                  type="button"
                  onClick={() => setStatusFilter(tab.value)}
                  className={cn(
                    "shrink-0 rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer",
                    active
                      ? "bg-slate-950 text-white"
                      : "border border-slate-200/80 bg-[#F8FAFC] text-slate-600 hover:text-slate-950"
                  )}
                >
                  {tab.label}
                </button>
              );
            })}
          </div>

          <div className="relative w-full lg:w-72">
            <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search clinic, slug, city…"
              className="h-9 rounded-full border-slate-200 bg-[#F8FAFC] pl-9 text-sm"
            />
          </div>
        </div>

        <div className="mt-5">
          {clinics === undefined ? (
            <div className="space-y-2.5">
              {Array.from({ length: 4 }).map((_, i) => (
                <div
                  key={i}
                  className="h-14 animate-pulse rounded-xl bg-slate-100"
                />
              ))}
            </div>
          ) : clinics.length === 0 ? (
            <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-[#F8FAFC] px-4 py-12 text-center">
              <Building2 className="size-7 text-slate-300" />
              <p className="mt-2 text-sm font-semibold text-slate-800">
                No clinics match this filter
              </p>
              <p className="mt-1 text-xs text-slate-500">
                Adjust your search or click Provision Clinic to onboard a new
                dental practice.
              </p>
            </div>
          ) : (
            <>
              {/* Desktop Table */}
              <div className="hidden overflow-x-auto md:block">
                <Table>
                  <TableHeader>
                    <TableRow className="hover:bg-transparent">
                      <TableHead>Clinic</TableHead>
                      <TableHead>Plan</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Renewal Date</TableHead>
                      <TableHead className="text-right">
                        Quotas (D / C / Appt)
                      </TableHead>
                      <TableHead className="text-right">Storage</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {clinics.map((clinic) => (
                      <TableRow key={clinic._id}>
                        <TableCell>
                          <div className="flex items-center gap-2.5">
                            <span
                              className="size-2.5 shrink-0 rounded-full"
                              style={{
                                backgroundColor: clinic.primaryColorHex,
                              }}
                            />
                            <div>
                              <div className="font-semibold text-slate-950">
                                {clinic.name}
                              </div>
                              <div className="text-xs text-slate-500">
                                <span className="font-mono">
                                  /c/{clinic.slug}
                                </span>{" "}
                                · {clinic.city}
                              </div>
                            </div>
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="secondary"
                            className="rounded-full bg-slate-100 text-slate-700"
                          >
                            {clinic.plan?.name ?? "Unknown"}
                          </Badge>
                          <div className="mt-0.5 text-[11px] capitalize text-slate-500">
                            {clinic.billingCycle}
                          </div>
                        </TableCell>
                        <TableCell>
                          <ClinicStatusBadge status={clinic.status} />
                        </TableCell>
                        <TableCell className="text-xs tabular-nums text-slate-600">
                          {formatDate(clinic.subscriptionEndsAt)}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums text-slate-700">
                          {clinic.activeDentistCount}/
                          {clinic.plan?.maxDentists ?? "–"} ·{" "}
                          {clinic.activeChairCount}/
                          {clinic.plan?.maxChairs ?? "–"} ·{" "}
                          {clinic.currentMonthAppointmentCount}/
                          {clinic.plan?.maxAppointmentsPerMonth ?? "–"}
                        </TableCell>
                        <TableCell className="text-right text-xs tabular-nums text-slate-600">
                          {formatBytes(clinic.storageUsedBytes)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-1.5">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => setSelectedClinicId(clinic._id)}
                              className="h-8 rounded-full border-slate-200 px-3 text-xs font-semibold"
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
              </div>

              {/* Mobile Card List */}
              <div className="space-y-3 md:hidden">
                {clinics.map((clinic) => (
                  <div
                    key={clinic._id}
                    className="rounded-xl border border-slate-200/80 bg-[#F8FAFC] p-4"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex min-w-0 items-center gap-2">
                        <span
                          className="size-2.5 shrink-0 rounded-full"
                          style={{ backgroundColor: clinic.primaryColorHex }}
                        />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-950">
                            {clinic.name}
                          </p>
                          <p className="truncate text-xs text-slate-500">
                            <span className="font-mono">/c/{clinic.slug}</span>{" "}
                            · {clinic.city}
                          </p>
                        </div>
                      </div>
                      <ClinicStatusBadge status={clinic.status} />
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg border border-slate-200/60 bg-white p-2.5 text-center">
                      <div>
                        <p className="text-[11px] text-slate-500">Plan</p>
                        <p className="truncate text-xs font-semibold text-slate-900">
                          {clinic.plan?.name.replace(/^Smile\s+/i, "") ?? "–"}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] text-slate-500">Renewal</p>
                        <p className="text-xs font-semibold tabular-nums text-slate-900">
                          {formatDate(clinic.subscriptionEndsAt)}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] text-slate-500">Appts</p>
                        <p className="text-xs font-semibold tabular-nums text-slate-900">
                          {clinic.currentMonthAppointmentCount}/
                          {clinic.plan?.maxAppointmentsPerMonth ?? "–"}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 flex items-center justify-between gap-2">
                      <span className="text-xs tabular-nums text-slate-500">
                        Storage: {formatBytes(clinic.storageUsedBytes)}
                      </span>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setSelectedClinicId(clinic._id)}
                        className="h-8 rounded-full border-slate-200 bg-white px-3.5 text-xs font-semibold"
                      >
                        <Settings2 className="mr-1 size-3.5" />
                        Manage
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      <ClinicDetailSheet
        clinicId={selectedClinicId}
        onClose={() => setSelectedClinicId(null)}
        plans={plans ?? []}
      />
    </div>
  );
}
