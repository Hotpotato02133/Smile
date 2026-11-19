"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "convex/react";
import { Check, Pencil, Plus } from "lucide-react";
import { useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardFooter,
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
import { api } from "../../../convex/_generated/api";
import type { Doc } from "../../../convex/_generated/dataModel";

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

  const [dialogOpen, setDialogOpen] = useState(false);
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Subscription Plans
          </h1>
          <p className="text-sm text-muted-foreground">
            Configure PHP pricing, dentist/chair/appointment quotas, and default
            clinical feature gates.
          </p>
        </div>
        <Button onClick={openCreate}>
          <Plus className="mr-1.5 size-4" />
          Add Plan Tier
        </Button>
      </div>

      {plans === undefined ? (
        <p className="text-sm text-muted-foreground">Loading plans…</p>
      ) : plans.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No subscription plans found. Run{" "}
            <code>npx convex run seed:initializePlatform</code> or add a plan
            tier above.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {plans.map((plan) => (
            <Card key={plan._id} className="flex flex-col">
              <CardHeader>
                <div className="flex items-center justify-between gap-2">
                  <Badge variant="outline" className="font-mono uppercase">
                    {plan.code}
                  </Badge>
                  <Badge variant={plan.isActive ? "secondary" : "destructive"}>
                    {plan.isActive ? "Active" : "Disabled"}
                  </Badge>
                </div>
                <CardTitle className="mt-2">{plan.name}</CardTitle>
                <CardDescription>{plan.description}</CardDescription>
              </CardHeader>

              <CardContent className="flex-1 space-y-4">
                <div>
                  <p className="font-mono text-3xl font-semibold tabular-nums">
                    {formatPhp(plan.monthlyPricePhp)}
                    <span className="text-sm font-normal text-muted-foreground">
                      /mo
                    </span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {formatPhp(plan.annualPricePhp)}/yr
                    {plan.trialDays > 0 ? ` · ${plan.trialDays}-day trial` : ""}
                  </p>
                </div>

                <div className="space-y-1.5 rounded-lg border bg-muted/30 p-3 text-xs">
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Dentists</span>
                    <span className="font-mono font-medium">
                      Up to {plan.maxDentists}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Operatory Chairs</span>
                    <span className="font-mono font-medium">
                      Up to {plan.maxChairs}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Monthly Appts</span>
                    <span className="font-mono font-medium">
                      {plan.maxAppointmentsPerMonth.toLocaleString()}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">X-Ray Storage</span>
                    <span className="font-mono font-medium">
                      {formatBytes(plan.maxStorageBytes)}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-muted-foreground">Monthly Emails</span>
                    <span className="font-mono font-medium">
                      {plan.maxEmailsPerMonth.toLocaleString()}
                    </span>
                  </div>
                </div>

                <div className="space-y-1 text-xs">
                  {[
                    ["Odontogram", plan.defaultFeatures.odontogramEnabled],
                    ["X-Ray Vault", plan.defaultFeatures.xrayStorageEnabled],
                    [
                      "Waitlist Blast",
                      plan.defaultFeatures.waitlistAutomationEnabled,
                    ],
                    [
                      "6-Month Recall",
                      plan.defaultFeatures.recallAutomationEnabled,
                    ],
                    [
                      "Custom Branding",
                      plan.defaultFeatures.customBrandingEnabled,
                    ],
                  ].map(([label, enabled]) => (
                    <div
                      key={String(label)}
                      className={`flex items-center gap-1.5 ${
                        enabled ? "text-foreground" : "text-muted-foreground/50 line-through"
                      }`}
                    >
                      <Check className="size-3.5 shrink-0" />
                      <span>{String(label)}</span>
                    </div>
                  ))}
                </div>
              </CardContent>

              <CardFooter>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={() => openEdit(plan)}
                >
                  <Pencil className="mr-1.5 size-3.5" />
                  Edit Plan & Quotas
                </Button>
              </CardFooter>
            </Card>
          ))}
        </div>
      )}

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl">
          <DialogHeader>
            <DialogTitle>
              {editingPlan ? `Edit ${editingPlan.name}` : "Create Subscription Plan"}
            </DialogTitle>
            <DialogDescription>
              Quotas are enforced inside Convex mutations via{" "}
              <code>assertClinicCanWrite</code>.
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
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="plan-desc">Description</Label>
              <Input id="plan-desc" {...form.register("description")} />
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="plan-mo">Monthly (PHP)</Label>
                <Input
                  id="plan-mo"
                  type="number"
                  className="font-mono"
                  {...form.register("monthlyPricePhp")}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="plan-yr">Annual (PHP)</Label>
                <Input
                  id="plan-yr"
                  type="number"
                  className="font-mono"
                  {...form.register("annualPricePhp")}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="plan-trial">Trial Days</Label>
                <Input
                  id="plan-trial"
                  type="number"
                  className="font-mono"
                  {...form.register("trialDays")}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-3">
              <div className="space-y-1.5">
                <Label htmlFor="plan-dentists">Max Dentists</Label>
                <Input
                  id="plan-dentists"
                  type="number"
                  className="font-mono"
                  {...form.register("maxDentists")}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="plan-chairs">Max Chairs</Label>
                <Input
                  id="plan-chairs"
                  type="number"
                  className="font-mono"
                  {...form.register("maxChairs")}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="plan-appts">Max Appts / Mo</Label>
                <Input
                  id="plan-appts"
                  type="number"
                  className="font-mono"
                  {...form.register("maxAppointmentsPerMonth")}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="plan-storage">Max Storage (MB)</Label>
                <Input
                  id="plan-storage"
                  type="number"
                  className="font-mono"
                  {...form.register("maxStorageMb")}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="plan-emails">Max Emails / Mo</Label>
                <Input
                  id="plan-emails"
                  type="number"
                  className="font-mono"
                  {...form.register("maxEmailsPerMonth")}
                />
              </div>
            </div>

            <div className="space-y-2 rounded-lg border p-3">
              <p className="text-xs font-semibold">Default Feature Flags</p>
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
                <div key={field} className="flex items-center justify-between text-xs">
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
              <Button type="submit" disabled={form.formState.isSubmitting}>
                {form.formState.isSubmitting ? "Saving…" : "Save Plan"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
