"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "@/lib/api";
import { Check, Pencil, Plus, Sparkles } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
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
import { Switch } from "@/components/ui/switch";
import { formatBytes, formatPhp, getErrorMessage } from "@/lib/format";
import { api } from "@/lib/api";
import type { Doc } from "@/lib/api";

const MB = 1024 * 1024;

const planSchema = z.object({
  code: z.enum(["trial", "starter", "pro", "enterprise"]),
  name: z.string().min(2, "Plan name is required"),
  description: z.string().min(4, "Description is required"),
  monthlyPricePhp: z.coerce.number().min(0),
  annualPricePhp: z.coerce.number().min(0),
  trialDays: z.coerce.number().min(0).max(90),
  maxDentists: z.coerce.number().min(1),
  maxChairs: z.coerce.number().min(1),
  maxAppointmentsPerMonth: z.coerce.number().min(1),
  maxStorageMb: z.coerce.number().min(10),
  maxEmailsPerMonth: z.coerce.number().min(10),
  odontogramEnabled: z.boolean(),
  xrayStorageEnabled: z.boolean(),
  waitlistAutomationEnabled: z.boolean(),
  recallAutomationEnabled: z.boolean(),
  customBrandingEnabled: z.boolean(),
  isActive: z.boolean(),
});

type PlanFormInput = z.input<typeof planSchema>;
type PlanFormValues = z.output<typeof planSchema>;

export function PlansManager() {
  const plans = useQuery(api.subscriptions.listPlans, {});
  const upsertPlan = useMutation(api.subscriptions.upsertPlan);
  const ensureDefaultPlans = useMutation(api.superAdmin.ensureDefaultPlans);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [seeding, setSeeding] = useState(false);
  const [editingPlan, setEditingPlan] = useState<Doc<"subscriptionPlans"> | null>(
    null
  );

  const form = useForm<PlanFormInput, unknown, PlanFormValues>({
    resolver: zodResolver(planSchema),
    defaultValues: {
      code: "enterprise",
      name: "Smile Enterprise",
      description: "High-volume multi-chair dental clinic tier.",
      monthlyPricePhp: 5999,
      annualPricePhp: 59990,
      trialDays: 0,
      maxDentists: 20,
      maxChairs: 15,
      maxAppointmentsPerMonth: 5000,
      maxStorageMb: 600,
      maxEmailsPerMonth: 1500,
      odontogramEnabled: true,
      xrayStorageEnabled: true,
      waitlistAutomationEnabled: true,
      recallAutomationEnabled: true,
      customBrandingEnabled: true,
      isActive: true,
    },
  });

  const watched = useWatch({ control: form.control });

  const handleSeedDefaults = async () => {
    setSeeding(true);
    try {
      const res = await ensureDefaultPlans({});
      toast.success(
        res.plansCreated > 0
          ? `Created ${res.plansCreated} default plans (Trial, Starter, Pro).`
          : "All default plans already exist."
      );
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to seed plans."));
    } finally {
      setSeeding(false);
    }
  };

  const openEdit = (plan: Doc<"subscriptionPlans">) => {
    setEditingPlan(plan);
    form.reset({
      code: plan.code,
      name: plan.name,
      description: plan.description,
      monthlyPricePhp: plan.monthlyPricePhp,
      annualPricePhp: plan.annualPricePhp,
      trialDays: plan.trialDays,
      maxDentists: plan.maxDentists,
      maxChairs: plan.maxChairs,
      maxAppointmentsPerMonth: plan.maxAppointmentsPerMonth,
      maxStorageMb: Math.round(plan.maxStorageBytes / MB),
      maxEmailsPerMonth: plan.maxEmailsPerMonth,
      odontogramEnabled: plan.defaultFeatures.odontogramEnabled,
      xrayStorageEnabled: plan.defaultFeatures.xrayStorageEnabled,
      waitlistAutomationEnabled: plan.defaultFeatures.waitlistAutomationEnabled,
      recallAutomationEnabled: plan.defaultFeatures.recallAutomationEnabled,
      customBrandingEnabled: plan.defaultFeatures.customBrandingEnabled,
      isActive: plan.isActive,
    });
    setDialogOpen(true);
  };

  const openCreate = () => {
    setEditingPlan(null);
    form.reset({
      code: "enterprise",
      name: "Smile Enterprise",
      description: "High-volume multi-chair dental clinic tier.",
      monthlyPricePhp: 5999,
      annualPricePhp: 59990,
      trialDays: 0,
      maxDentists: 20,
      maxChairs: 15,
      maxAppointmentsPerMonth: 5000,
      maxStorageMb: 600,
      maxEmailsPerMonth: 1500,
      odontogramEnabled: true,
      xrayStorageEnabled: true,
      waitlistAutomationEnabled: true,
      recallAutomationEnabled: true,
      customBrandingEnabled: true,
      isActive: true,
    });
    setDialogOpen(true);
  };

  const onSubmit = async (values: PlanFormValues) => {
    try {
      await upsertPlan({
        planId: editingPlan?._id,
        code: values.code,
        name: values.name,
        description: values.description,
        monthlyPricePhp: values.monthlyPricePhp,
        annualPricePhp: values.annualPricePhp,
        trialDays: values.trialDays,
        maxDentists: values.maxDentists,
        maxChairs: values.maxChairs,
        maxAppointmentsPerMonth: values.maxAppointmentsPerMonth,
        maxStorageBytes: values.maxStorageMb * MB,
        maxEmailsPerMonth: values.maxEmailsPerMonth,
        defaultFeatures: {
          odontogramEnabled: values.odontogramEnabled,
          xrayStorageEnabled: values.xrayStorageEnabled,
          waitlistAutomationEnabled: values.waitlistAutomationEnabled,
          recallAutomationEnabled: values.recallAutomationEnabled,
          customBrandingEnabled: values.customBrandingEnabled,
        },
        isActive: values.isActive,
      });
      toast.success(
        editingPlan ? `Updated ${values.name}.` : `Created ${values.name}.`
      );
      setDialogOpen(false);
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to save subscription plan."));
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-950">
            Subscription Plans
          </h1>
          <p className="text-sm text-slate-600">
            Configure PHP pricing, dentist and chair quotas, and default
            clinical feature gates.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {plans && plans.length < 3 ? (
            <Button
              variant="outline"
              size="sm"
              disabled={seeding}
              onClick={handleSeedDefaults}
              className="h-9 rounded-full border-slate-200 px-3.5 text-xs font-semibold"
            >
              <Sparkles className="mr-1.5 size-3.5 text-[#6C5CE7]" />
              {seeding ? "Seeding…" : "Seed Default Plans"}
            </Button>
          ) : null}
          <Button
            onClick={openCreate}
            className="h-9 rounded-full bg-[#6C5CE7] px-4 text-xs font-semibold text-white hover:bg-[#5B4BD6]"
          >
            <Plus className="mr-1.5 size-4" />
            Add Plan Tier
          </Button>
        </div>
      </div>

      {plans === undefined ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div
              key={i}
              className="h-96 animate-pulse rounded-2xl bg-slate-100"
            />
          ))}
        </div>
      ) : plans.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-slate-200 bg-[#F8FAFC] px-6 py-14 text-center">
          <p className="text-sm font-semibold text-slate-800">
            No subscription plans configured yet
          </p>
          <p className="mt-1 max-w-md text-xs text-slate-500">
            Initialize the default Smile tiers (Free 14-Day Trial, Smile
            Starter, and Smile Pro Clinic) in one click or add a custom tier.
          </p>
          <Button
            type="button"
            disabled={seeding}
            onClick={handleSeedDefaults}
            className="mt-4 h-9 rounded-full bg-[#6C5CE7] px-4 text-xs font-semibold text-white hover:bg-[#5B4BD6]"
          >
            <Sparkles className="mr-1.5 size-3.5" />
            {seeding ? "Seeding…" : "Seed Default Plans"}
          </Button>
        </div>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-3">
          {plans.map((plan) => {
            const annualSavings =
              plan.monthlyPricePhp > 0 && plan.annualPricePhp > 0
                ? plan.monthlyPricePhp * 12 - plan.annualPricePhp
                : 0;
            return (
              <article
                key={plan._id}
                className="flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-5"
              >
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-2">
                    <Badge
                      variant="outline"
                      className="rounded-full border-slate-200 bg-[#F8FAFC] font-mono text-[11px] uppercase text-slate-700"
                    >
                      {plan.code}
                    </Badge>
                    <Badge
                      variant="outline"
                      className={
                        plan.isActive
                          ? "rounded-full border-emerald-200 bg-emerald-50 text-[11px] font-semibold text-emerald-800"
                          : "rounded-full border-rose-200 bg-rose-50 text-[11px] font-semibold text-rose-800"
                      }
                    >
                      {plan.isActive ? "Active" : "Disabled"}
                    </Badge>
                  </div>

                  <div>
                    <h2 className="text-lg font-bold text-slate-950">
                      {plan.name}
                    </h2>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {plan.description}
                    </p>
                  </div>

                  <div>
                    <p className="text-3xl font-bold tracking-tight tabular-nums text-slate-950">
                      {formatPhp(plan.monthlyPricePhp)}
                      <span className="text-sm font-normal text-slate-500">
                        /mo
                      </span>
                    </p>
                    <p className="mt-0.5 text-xs tabular-nums text-slate-500">
                      {formatPhp(plan.annualPricePhp)}/yr
                      {annualSavings > 0
                        ? ` · Save ${formatPhp(annualSavings)}/yr`
                        : ""}
                      {plan.trialDays > 0
                        ? ` · ${plan.trialDays}-day trial`
                        : ""}
                    </p>
                  </div>

                  <div className="space-y-1.5 rounded-xl border border-slate-200/75 bg-[#F8FAFC] p-3.5 text-xs">
                    <div className="flex justify-between">
                      <span className="text-slate-500">Dentists</span>
                      <span className="font-semibold tabular-nums text-slate-900">
                        Up to {plan.maxDentists}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Operatory Chairs</span>
                      <span className="font-semibold tabular-nums text-slate-900">
                        Up to {plan.maxChairs}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Monthly Appts</span>
                      <span className="font-semibold tabular-nums text-slate-900">
                        {plan.maxAppointmentsPerMonth.toLocaleString()}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">X-Ray Storage</span>
                      <span className="font-semibold tabular-nums text-slate-900">
                        {formatBytes(plan.maxStorageBytes)}
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-slate-500">Monthly Emails</span>
                      <span className="font-semibold tabular-nums text-slate-900">
                        {plan.maxEmailsPerMonth.toLocaleString()}
                      </span>
                    </div>
                  </div>

                  <div className="space-y-1.5 text-xs">
                    {(
                      [
                        ["32-Tooth Odontogram", plan.defaultFeatures.odontogramEnabled],
                        ["X-Ray & Photo Vault", plan.defaultFeatures.xrayStorageEnabled],
                        [
                          "Waitlist Cancellation Blast",
                          plan.defaultFeatures.waitlistAutomationEnabled,
                        ],
                        [
                          "6-Month Hygiene Recall",
                          plan.defaultFeatures.recallAutomationEnabled,
                        ],
                        [
                          "Custom Clinic Branding",
                          plan.defaultFeatures.customBrandingEnabled,
                        ],
                      ] as const
                    ).map(([label, enabled]) => (
                      <div
                        key={label}
                        className={`flex items-center gap-2 ${
                          enabled
                            ? "font-medium text-slate-800"
                            : "text-slate-400 line-through"
                        }`}
                      >
                        <Check
                          className={`size-3.5 shrink-0 ${
                            enabled ? "text-[#6C5CE7]" : "text-slate-300"
                          }`}
                        />
                        <span>{label}</span>
                      </div>
                    ))}
                  </div>
                </div>

                <div className="mt-5 pt-4 border-t border-slate-100">
                  <Button
                    variant="outline"
                    className="h-9 w-full rounded-full border-slate-200 text-xs font-semibold text-slate-800 hover:bg-slate-50"
                    onClick={() => openEdit(plan)}
                  >
                    <Pencil className="mr-1.5 size-3.5" />
                    Edit Plan &amp; Quotas
                  </Button>
                </div>
              </article>
            );
          })}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {editingPlan
                ? `Edit ${editingPlan.name}`
                : "Create Subscription Plan"}
            </DialogTitle>
            <DialogDescription>
              Resource ceilings and feature gates apply automatically across all
              clinics assigned to this tier.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Plan Code</Label>
                <Select
                  value={watched.code}
                  disabled={editingPlan !== null}
                  onValueChange={(v) => {
                    if (
                      v === "trial" ||
                      v === "starter" ||
                      v === "pro" ||
                      v === "enterprise"
                    ) {
                      form.setValue("code", v);
                    }
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="trial">trial</SelectItem>
                    <SelectItem value="starter">starter</SelectItem>
                    <SelectItem value="pro">pro</SelectItem>
                    <SelectItem value="enterprise">enterprise</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="plan-name">Display Name</Label>
                <Input id="plan-name" {...form.register("name")} />
                {form.formState.errors.name ? (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.name.message}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="plan-desc">Description</Label>
              <Input id="plan-desc" {...form.register("description")} />
              {form.formState.errors.description ? (
                <p className="text-xs text-destructive">
                  {form.formState.errors.description.message}
                </p>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="plan-mo">Monthly (PHP)</Label>
                <Input
                  id="plan-mo"
                  type="number"
                  className="tabular-nums"
                  {...form.register("monthlyPricePhp")}
                />
                {form.formState.errors.monthlyPricePhp ? (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.monthlyPricePhp.message}
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="plan-yr">Annual (PHP)</Label>
                <Input
                  id="plan-yr"
                  type="number"
                  className="tabular-nums"
                  {...form.register("annualPricePhp")}
                />
                {form.formState.errors.annualPricePhp ? (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.annualPricePhp.message}
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="plan-trial">Trial Days</Label>
                <Input
                  id="plan-trial"
                  type="number"
                  className="tabular-nums"
                  {...form.register("trialDays")}
                />
                {form.formState.errors.trialDays ? (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.trialDays.message}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="plan-dentists">Max Dentists</Label>
                <Input
                  id="plan-dentists"
                  type="number"
                  className="tabular-nums"
                  {...form.register("maxDentists")}
                />
                {form.formState.errors.maxDentists ? (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.maxDentists.message}
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="plan-chairs">Max Chairs</Label>
                <Input
                  id="plan-chairs"
                  type="number"
                  className="tabular-nums"
                  {...form.register("maxChairs")}
                />
                {form.formState.errors.maxChairs ? (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.maxChairs.message}
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="plan-appts">Max Appts / Mo</Label>
                <Input
                  id="plan-appts"
                  type="number"
                  className="tabular-nums"
                  {...form.register("maxAppointmentsPerMonth")}
                />
                {form.formState.errors.maxAppointmentsPerMonth ? (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.maxAppointmentsPerMonth.message}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="plan-storage">Max Storage (MB)</Label>
                <Input
                  id="plan-storage"
                  type="number"
                  className="tabular-nums"
                  {...form.register("maxStorageMb")}
                />
                {form.formState.errors.maxStorageMb ? (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.maxStorageMb.message}
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="plan-emails">Max Emails / Mo</Label>
                <Input
                  id="plan-emails"
                  type="number"
                  className="tabular-nums"
                  {...form.register("maxEmailsPerMonth")}
                />
                {form.formState.errors.maxEmailsPerMonth ? (
                  <p className="text-xs text-destructive">
                    {form.formState.errors.maxEmailsPerMonth.message}
                  </p>
                ) : null}
              </div>
            </div>

            <div className="space-y-2.5 rounded-xl border border-slate-200/80 bg-[#F8FAFC] p-3.5">
              <p className="text-xs font-semibold text-slate-900">
                Default Feature Flags
              </p>
              {(
                [
                  ["odontogramEnabled", "32-Tooth SVG Odontogram"],
                  ["xrayStorageEnabled", "X-Ray & Intraoral Photo Vault"],
                  ["waitlistAutomationEnabled", "Waitlist Cancellation Blast"],
                  ["recallAutomationEnabled", "6-Month Hygiene Recall"],
                  ["customBrandingEnabled", "Custom Clinic Branding"],
                  ["isActive", "Plan Active for New Sign-ups"],
                ] as const
              ).map(([field, label]) => (
                <div
                  key={field}
                  className="flex items-center justify-between text-xs text-slate-700"
                >
                  <span>{label}</span>
                  <Switch
                    checked={Boolean(watched[field])}
                    onCheckedChange={(checked) => form.setValue(field, checked)}
                  />
                </div>
              ))}
            </div>

            <DialogFooter>
              <Button
                type="button"
                variant="outline"
                onClick={() => setDialogOpen(false)}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={form.formState.isSubmitting}
                className="bg-[#6C5CE7] text-white hover:bg-[#5B4BD6]"
              >
                {form.formState.isSubmitting ? "Saving…" : "Save Plan"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
