"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "convex/react";
import {
  CheckCircle2,
  ExternalLink,
  Plus,
  Receipt,
  RotateCcw,
  Upload,
} from "lucide-react";
import { useEffect, useState } from "react";
import { useForm, useWatch } from "react-hook-form";
import { toast } from "sonner";
import { z } from "zod";
import {
  ClinicStatusBadge,
  PAYMENT_METHOD_LABELS,
  type PaymentMethod,
  type PaymentStatus,
  PaymentStatusBadge,
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDate, formatPhp, getErrorMessage } from "@/lib/format";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";

const recordPaymentSchema = z.object({
  clinicId: z.string().min(1, "Select a clinic"),
  planId: z.string().min(1, "Select a plan"),
  billingCycle: z.enum(["monthly", "annual"]),
  amountPhp: z.coerce.number().min(0, "Amount must be 0 or more"),
  paymentMethod: z.enum([
    "gcash",
    "maya",
    "bank_transfer",
    "card",
    "cash",
    "manual_waiver",
  ]),
  referenceNumber: z.string().optional(),
  periodStartDate: z.string().min(1, "Period start is required"),
  periodEndDate: z.string().min(1, "Period end is required"),
  status: z.enum(["paid", "pending", "overdue", "refunded"]),
  notes: z.string().optional(),
});

type RecordPaymentFormInput = z.input<typeof recordPaymentSchema>;
type RecordPaymentFormValues = z.output<typeof recordPaymentSchema>;

function toDateInputValue(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDaysToInput(startDateStr: string, days: number): string {
  const base = new Date(`${startDateStr}T00:00:00Z`);
  if (Number.isNaN(base.getTime())) return toDateInputValue(new Date());
  base.setUTCDate(base.getUTCDate() + days);
  return toDateInputValue(base);
}

export function BillingManager() {
  const [statusFilter, setStatusFilter] = useState<"all" | PaymentStatus>("all");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [receiptStorageId, setReceiptStorageId] = useState<
    Id<"_storage"> | undefined
  >(undefined);
  const [receiptFileName, setReceiptFileName] = useState<string>("");

  const payments = useQuery(api.subscriptions.listPayments, {
    status: statusFilter === "all" ? undefined : statusFilter,
    limit: 100,
  });
  const clinics = useQuery(api.superAdmin.listClinics, {});
  const plans = useQuery(api.subscriptions.listPlans, {});
  const overview = useQuery(api.platformAnalytics.getDashboardOverview, {});

  const recordPayment = useMutation(api.subscriptions.recordPayment);
  const updatePaymentStatus = useMutation(api.subscriptions.updatePaymentStatus);
  const generateReceiptUploadUrl = useMutation(
    api.subscriptions.generateReceiptUploadUrl
  );

  const todayStr = toDateInputValue(new Date());

  const form = useForm<RecordPaymentFormInput, unknown, RecordPaymentFormValues>({
    resolver: zodResolver(recordPaymentSchema),
    defaultValues: {
      clinicId: "",
      planId: "",
      billingCycle: "monthly",
      amountPhp: 1499,
      paymentMethod: "gcash",
      referenceNumber: "",
      periodStartDate: todayStr,
      periodEndDate: addDaysToInput(todayStr, 30),
      status: "paid",
      notes: "",
    },
  });

  const watchedClinicId = useWatch({ control: form.control, name: "clinicId" });
  const watchedPlanId = useWatch({ control: form.control, name: "planId" });
  const watchedCycle = useWatch({ control: form.control, name: "billingCycle" });
  const watchedStart = useWatch({
    control: form.control,
    name: "periodStartDate",
  });
  const watchedPaymentMethod = useWatch({
    control: form.control,
    name: "paymentMethod",
  });
  const watchedStatus = useWatch({ control: form.control, name: "status" });

  // Auto-fill PHP price & end date when plan or billing cycle changes
  useEffect(() => {
    if (!plans || !watchedPlanId) return;
    const plan = plans.find((p) => p._id === watchedPlanId);
    if (!plan) return;
    const price =
      watchedCycle === "annual" ? plan.annualPricePhp : plan.monthlyPricePhp;
    form.setValue("amountPhp", price);
  }, [plans, watchedPlanId, watchedCycle, form]);

  useEffect(() => {
    if (!watchedStart) return;
    const days = watchedCycle === "annual" ? 365 : 30;
    form.setValue("periodEndDate", addDaysToInput(watchedStart, days));
  }, [watchedStart, watchedCycle, form]);

  const openForClinic = (
    clinicId?: Id<"clinics">,
    planId?: Id<"subscriptionPlans">,
    billingCycle?: "monthly" | "annual" | "trial"
  ) => {
    const start = toDateInputValue(new Date());
    const cycle: "monthly" | "annual" =
      billingCycle === "annual" ? "annual" : "monthly";
    const resolvedPlanId =
      planId ??
      plans?.find((p) => p.code === "starter")?._id ??
      plans?.[0]?._id ??
      "";
    const plan = plans?.find((p) => p._id === resolvedPlanId);

    form.reset({
      clinicId: clinicId ?? clinics?.[0]?._id ?? "",
      planId: resolvedPlanId,
      billingCycle: cycle,
      amountPhp: plan
        ? cycle === "annual"
          ? plan.annualPricePhp
          : plan.monthlyPricePhp
        : 1499,
      paymentMethod: "gcash",
      referenceNumber: "",
      periodStartDate: start,
      periodEndDate: addDaysToInput(start, cycle === "annual" ? 365 : 30),
      status: "paid",
      notes: "",
    });
    setReceiptStorageId(undefined);
    setReceiptFileName("");
    setDialogOpen(true);
  };

  const handleReceiptUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Receipt file must be 2 MB or smaller.");
      return;
    }
    setUploadingReceipt(true);
    try {
      const uploadUrl = await generateReceiptUploadUrl({});
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: { "Content-Type": file.type || "application/octet-stream" },
        body: file,
      });
      if (!res.ok) throw new Error("Upload failed.");
      const json = (await res.json()) as { storageId: Id<"_storage"> };
      setReceiptStorageId(json.storageId);
      setReceiptFileName(file.name);
      toast.success("Receipt uploaded to Convex File Storage.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Receipt upload failed."));
    } finally {
      setUploadingReceipt(false);
    }
  };

  const onSubmit = async (values: RecordPaymentFormValues) => {
    try {
      const periodStart = Date.parse(`${values.periodStartDate}T00:00:00Z`);
      const periodEnd = Date.parse(`${values.periodEndDate}T23:59:59Z`);

      const res = await recordPayment({
        clinicId: values.clinicId as Id<"clinics">,
        planId: values.planId as Id<"subscriptionPlans">,
        amountPhp: values.amountPhp,
        billingCycle: values.billingCycle,
        paymentMethod: values.paymentMethod,
        referenceNumber: values.referenceNumber || undefined,
        receiptStorageId,
        periodStart,
        periodEnd,
        status: values.status,
        notes: values.notes || undefined,
      });

      toast.success(
        `Invoice ${res.invoiceNumber} recorded${values.status === "paid" ? " & subscription activated" : ""}.`
      );
      setDialogOpen(false);
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to record payment."));
    }
  };

  const handleQuickStatus = async (
    paymentId: Id<"subscriptionPayments">,
    status: PaymentStatus
  ) => {
    try {
      await updatePaymentStatus({ paymentId, status });
      toast.success(`Invoice marked as ${status}.`);
    } catch (err) {
      toast.error(getErrorMessage(err, "Failed to update invoice status."));
    }
  };

  const paidTotalPhp = (payments ?? [])
    .filter((p) => p.status === "paid")
    .reduce((sum, p) => sum + p.amountPhp, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Billing & Subscription Ledger
          </h1>
          <p className="text-sm text-muted-foreground">
            Verify GCash, Maya, Bank Transfer, and manual SaaS renewals with
            zero gateway fees.
          </p>
        </div>
        <Button onClick={() => openForClinic()}>
          <Plus className="mr-1.5 size-4" />
          Record Payment
        </Button>
      </div>

      {/* Quick Summary Strip */}
      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Verified Paid (Current View)</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-2xl font-semibold tabular-nums">
              {formatPhp(paidTotalPhp)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Collected This Month</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-2xl font-semibold tabular-nums">
              {formatPhp(overview?.collectedThisMonthPhp ?? 0)}
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Renewals Due (≤ 7d / Past Due)</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-2xl font-semibold tabular-nums">
              {overview?.renewalQueue.length ?? 0}
            </p>
          </CardContent>
        </Card>
      </div>

      <Tabs defaultValue="ledger">
        <TabsList>
          <TabsTrigger value="ledger">Invoice Ledger</TabsTrigger>
          <TabsTrigger value="renewals">
            Renewal Queue ({overview?.renewalQueue.length ?? 0})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ledger" className="mt-4">
          <Card>
            <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle>Subscription Invoices</CardTitle>
                <CardDescription>
                  Recording a paid invoice automatically extends the clinic&apos;s
                  subscription window and restores suspended tenants.
                </CardDescription>
              </div>
              <Select
                value={statusFilter}
                onValueChange={(v) =>
                  setStatusFilter((v ?? "all") as "all" | PaymentStatus)
                }
              >
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All statuses</SelectItem>
                  <SelectItem value="paid">Paid</SelectItem>
                  <SelectItem value="pending">Pending</SelectItem>
                  <SelectItem value="overdue">Overdue</SelectItem>
                  <SelectItem value="refunded">Refunded</SelectItem>
                </SelectContent>
              </Select>
            </CardHeader>

            <CardContent>
              {payments === undefined ? (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Loading invoices…
                </p>
              ) : payments.length === 0 ? (
                <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
                  No subscription invoices recorded yet.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Invoice</TableHead>
                      <TableHead>Clinic</TableHead>
                      <TableHead>Plan & Period</TableHead>
                      <TableHead>Method</TableHead>
                      <TableHead className="text-right">Amount</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead className="text-right">Actions</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {payments.map((payment) => (
                      <TableRow key={payment._id}>
                        <TableCell>
                          <div className="font-mono text-xs font-medium">
                            {payment.invoiceNumber}
                          </div>
                          <div className="text-[11px] text-muted-foreground">
                            {formatDate(payment.createdAt)}
                          </div>
                        </TableCell>
                        <TableCell>
                          <div className="font-medium">{payment.clinicName}</div>
                          {payment.referenceNumber ? (
                            <div className="font-mono text-[11px] text-muted-foreground">
                              Ref: {payment.referenceNumber}
                            </div>
                          ) : null}
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1.5">
                            <Badge variant="secondary">{payment.planName}</Badge>
                            <span className="text-xs capitalize text-muted-foreground">
                              {payment.billingCycle}
                            </span>
                          </div>
                          <div className="mt-0.5 text-[11px] text-muted-foreground">
                            {formatDate(payment.periodStart)} –{" "}
                            {formatDate(payment.periodEnd)}
                          </div>
                        </TableCell>
                        <TableCell className="text-xs">
                          {PAYMENT_METHOD_LABELS[payment.paymentMethod as PaymentMethod]}
                        </TableCell>
                        <TableCell className="text-right font-mono font-medium tabular-nums">
                          {formatPhp(payment.amountPhp)}
                        </TableCell>
                        <TableCell>
                          <PaymentStatusBadge status={payment.status} />
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex items-center justify-end gap-1">
                            {payment.receiptUrl ? (
                              <Button
                                size="sm"
                                variant="ghost"
                                render={
                                  <a
                                    href={payment.receiptUrl}
                                    target="_blank"
                                    rel="noreferrer"
                                  />
                                }
                              >
                                <Receipt className="mr-1 size-3.5" />
                                Receipt
                                <ExternalLink className="ml-1 size-3" />
                              </Button>
                            ) : null}
                            {payment.status !== "paid" ? (
                              <Button
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  handleQuickStatus(payment._id, "paid")
                                }
                              >
                                <CheckCircle2 className="mr-1 size-3.5" />
                                Mark Paid
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                variant="ghost"
                                onClick={() =>
                                  handleQuickStatus(payment._id, "refunded")
                                }
                              >
                                <RotateCcw className="mr-1 size-3.5" />
                                Refund
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="renewals" className="mt-4">
          <Card>
            <CardHeader>
              <CardTitle>Clinics Due for Renewal</CardTitle>
              <CardDescription>
                Tenants whose subscription or trial ends within 7 days, plus
                past-due clinics inside their grace period.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {!overview || overview.renewalQueue.length === 0 ? (
                <div className="rounded-lg border border-dashed py-12 text-center text-sm text-muted-foreground">
                  No upcoming renewals or overdue accounts.
                </div>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Clinic</TableHead>
                      <TableHead>Plan</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Ends</TableHead>
                      <TableHead className="text-right">Monthly Rate</TableHead>
                      <TableHead className="text-right">Action</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {overview.renewalQueue.map((clinic) => (
                      <TableRow key={clinic._id}>
                        <TableCell>
                          <div className="font-medium">{clinic.name}</div>
                          <div className="text-xs text-muted-foreground">
                            /c/{clinic.slug}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary">{clinic.planName}</Badge>
                        </TableCell>
                        <TableCell>
                          <ClinicStatusBadge status={clinic.status} />
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {formatDate(clinic.subscriptionEndsAt)}
                        </TableCell>
                        <TableCell className="text-right font-mono tabular-nums">
                          {formatPhp(clinic.monthlyPricePhp)}
                        </TableCell>
                        <TableCell className="text-right">
                          <Button
                            size="sm"
                            onClick={() =>
                              openForClinic(
                                clinic._id,
                                clinic.planId,
                                clinic.billingCycle
                              )
                            }
                          >
                            Record Renewal
                          </Button>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>

      {/* Record Payment Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Record Subscription Payment</DialogTitle>
            <DialogDescription>
              Log a GCash, Maya, Bank Transfer, or cash invoice. Marking as Paid
              activates the tenant immediately.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-4">
            <div className="space-y-1.5">
              <Label>Dental Clinic</Label>
              <Select
                value={watchedClinicId}
                onValueChange={(v) => {
                  if (v) form.setValue("clinicId", v, { shouldValidate: true });
                }}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Select clinic" />
                </SelectTrigger>
                <SelectContent>
                  {(clinics ?? []).map((c) => (
                    <SelectItem key={c._id} value={c._id}>
                      {c.name} (/c/{c.slug})
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {form.formState.errors.clinicId ? (
                <p className="text-xs text-destructive">
                  {form.formState.errors.clinicId.message}
                </p>
              ) : null}
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label>Subscription Plan</Label>
                <Select
                  value={watchedPlanId}
                  onValueChange={(v) => {
                    if (v) form.setValue("planId", v, { shouldValidate: true });
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select plan" />
                  </SelectTrigger>
                  <SelectContent>
                    {(plans ?? []).map((p) => (
                      <SelectItem key={p._id} value={p._id}>
                        {p.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                <Label>Billing Cycle</Label>
                <Select
                  value={watchedCycle}
                  onValueChange={(v) => {
                    if (v === "monthly" || v === "annual") {
                      form.setValue("billingCycle", v);
                    }
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="monthly">Monthly</SelectItem>
                    <SelectItem value="annual">Annual</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pay-amount">Amount (PHP)</Label>
                <Input
                  id="pay-amount"
                  type="number"
                  min={0}
                  step={1}
                  className="font-mono"
                  {...form.register("amountPhp")}
                />
              </div>

              <div className="space-y-1.5">
                <Label>Payment Method</Label>
                <Select
                  value={watchedPaymentMethod}
                  onValueChange={(v) => {
                    if (v) form.setValue("paymentMethod", v as PaymentMethod);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="gcash">GCash</SelectItem>
                    <SelectItem value="maya">Maya</SelectItem>
                    <SelectItem value="bank_transfer">Bank Transfer</SelectItem>
                    <SelectItem value="card">Card</SelectItem>
                    <SelectItem value="cash">Cash</SelectItem>
                    <SelectItem value="manual_waiver">Manual Waiver</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="period-start">Period Start</Label>
                <Input
                  id="period-start"
                  type="date"
                  {...form.register("periodStartDate")}
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="period-end">Period End</Label>
                <Input
                  id="period-end"
                  type="date"
                  {...form.register("periodEndDate")}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pay-ref">Reference Number</Label>
                <Input
                  id="pay-ref"
                  placeholder="GCash / Bank Ref #"
                  {...form.register("referenceNumber")}
                />
              </div>
              <div className="space-y-1.5">
                <Label>Invoice Status</Label>
                <Select
                  value={watchedStatus}
                  onValueChange={(v) => {
                    if (v) form.setValue("status", v as PaymentStatus);
                  }}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="paid">Paid (Activates Clinic)</SelectItem>
                    <SelectItem value="pending">Pending Verification</SelectItem>
                    <SelectItem value="overdue">Overdue</SelectItem>
                    <SelectItem value="refunded">Refunded</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pay-receipt">Payment Receipt (optional, ≤ 2 MB)</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="pay-receipt"
                  type="file"
                  accept="image/*,application/pdf"
                  disabled={uploadingReceipt}
                  onChange={handleReceiptUpload}
                />
                {uploadingReceipt ? (
                  <Upload className="size-4 animate-pulse text-muted-foreground" />
                ) : null}
              </div>
              {receiptFileName ? (
                <p className="text-xs text-emerald-700 dark:text-emerald-400">
                  Uploaded: {receiptFileName}
                </p>
              ) : null}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pay-notes">Notes (optional)</Label>
              <Input
                id="pay-notes"
                placeholder="Verified via BPI online banking"
                {...form.register("notes")}
              />
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
                disabled={form.formState.isSubmitting || uploadingReceipt}
              >
                {form.formState.isSubmitting ? "Saving…" : "Save Invoice"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
