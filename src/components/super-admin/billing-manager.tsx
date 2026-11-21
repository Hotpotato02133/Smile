"use client";

import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQuery } from "convex/react";
import {
  CheckCircle2,
  ExternalLink,
  Plus,
  Receipt,
  RotateCcw,
  Search,
  Upload,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

const MAX_IMAGE_RECEIPT_BYTES = 500 * 1024; // 500 KB zero-cost storage rule (AGENTS.md §3)
const MAX_PDF_RECEIPT_BYTES = 1024 * 1024; // 1 MB max for PDF receipts

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
  if (Number.isNaN(base.getTime())) return startDateStr;
  base.setUTCDate(base.getUTCDate() + days);
  return toDateInputValue(base);
}

/** Client-side WebP/JPEG compression so receipt images stay under 500 KB (AGENTS.md §3). */
async function compressReceiptImage(file: File): Promise<Blob> {
  if (!file.type.startsWith("image/") || file.size <= MAX_IMAGE_RECEIPT_BYTES) {
    return file;
  }

  const bitmap = await createImageBitmap(file);
  const maxDimension = 1600;
  const scale = Math.min(
    1,
    maxDimension / Math.max(bitmap.width, bitmap.height)
  );
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) return file;
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const qualities = [0.8, 0.65, 0.5];
  for (const quality of qualities) {
    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, "image/webp", quality)
    );
    if (blob && blob.size <= MAX_IMAGE_RECEIPT_BYTES) {
      return blob;
    }
  }

  const fallback = await new Promise<Blob | null>((resolve) =>
    canvas.toBlob(resolve, "image/jpeg", 0.5)
  );
  return fallback ?? file;
}

export function BillingManager() {
  const [statusFilter, setStatusFilter] = useState<"all" | PaymentStatus>(
    "all"
  );
  const [searchTerm, setSearchTerm] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [uploadingReceipt, setUploadingReceipt] = useState(false);
  const [receiptStorageId, setReceiptStorageId] = useState<
    Id<"_storage"> | undefined
  >(undefined);
  const [receiptFileName, setReceiptFileName] = useState<string>("");
  const handledRenewParamRef = useRef(false);

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

  // Avoid calling `new Date()` during SSR/prerender (Next.js 16 rule)
  const form = useForm<RecordPaymentFormInput, unknown, RecordPaymentFormValues>({
    resolver: zodResolver(recordPaymentSchema),
    defaultValues: {
      clinicId: "",
      planId: "",
      billingCycle: "monthly",
      amountPhp: 1499,
      paymentMethod: "gcash",
      referenceNumber: "",
      periodStartDate: "",
      periodEndDate: "",
      status: "paid",
      notes: "",
    },
  });

  const watchedClinicId = useWatch({ control: form.control, name: "clinicId" });
  const watchedPlanId = useWatch({ control: form.control, name: "planId" });
  const watchedCycle = useWatch({
    control: form.control,
    name: "billingCycle",
  });
  const watchedStart = useWatch({
    control: form.control,
    name: "periodStartDate",
  });
  const watchedPaymentMethod = useWatch({
    control: form.control,
    name: "paymentMethod",
  });
  const watchedStatus = useWatch({ control: form.control, name: "status" });

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

  const openForClinic = useCallback(
    (
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
    },
    [clinics, plans, form]
  );

  // Support deep link `/super-admin/billing?renewClinicId=<id>` from Overview / Clinic sheet
  useEffect(() => {
    if (handledRenewParamRef.current || !clinics || !plans) return;
    const params = new URLSearchParams(window.location.search);
    const renewClinicId = params.get("renewClinicId");
    if (!renewClinicId) return;
    const match = clinics.find((c) => c._id === renewClinicId);
    if (!match) return;
    handledRenewParamRef.current = true;
    const timer = window.setTimeout(() => {
      openForClinic(match._id, match.planId, match.billingCycle);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [clinics, plans, openForClinic]);

  const handleReceiptUpload = async (
    e: React.ChangeEvent<HTMLInputElement>
  ) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const isImage = file.type.startsWith("image/");
    if (!isImage && file.size > MAX_PDF_RECEIPT_BYTES) {
      toast.error("PDF receipts must be 1 MB or smaller.");
      return;
    }

    setUploadingReceipt(true);
    try {
      const payload = isImage ? await compressReceiptImage(file) : file;
      if (isImage && payload.size > MAX_IMAGE_RECEIPT_BYTES) {
        toast.error("Could not compress image under 500 KB. Try a smaller file.");
        return;
      }

      const uploadUrl = await generateReceiptUploadUrl({});
      const res = await fetch(uploadUrl, {
        method: "POST",
        headers: {
          "Content-Type": payload.type || file.type || "application/octet-stream",
        },
        body: payload,
      });
      if (!res.ok) throw new Error("Upload failed.");
      const json = (await res.json()) as { storageId: Id<"_storage"> };
      setReceiptStorageId(json.storageId);
      setReceiptFileName(
        `${file.name} (${Math.round(payload.size / 1024)} KB)`
      );
      toast.success("Compressed receipt uploaded to Convex File Storage.");
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

  const filteredPayments = useMemo(() => {
    const list = payments ?? [];
    const term = searchTerm.trim().toLowerCase();
    if (!term) return list;
    return list.filter(
      (p) =>
        p.invoiceNumber.toLowerCase().includes(term) ||
        p.clinicName.toLowerCase().includes(term) ||
        (p.referenceNumber ?? "").toLowerCase().includes(term)
    );
  }, [payments, searchTerm]);

  const paidTotalPhp = filteredPayments
    .filter((p) => p.status === "paid")
    .reduce((sum, p) => sum + p.amountPhp, 0);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-slate-950">
            Billing &amp; Invoices
          </h1>
          <p className="text-sm text-slate-600">
            Verify GCash, Maya, Bank Transfer, and manual SaaS renewals with
            zero gateway fees.
          </p>
        </div>
        <Button
          onClick={() => openForClinic()}
          className="h-9 w-fit rounded-full bg-[#6C5CE7] px-4 text-xs font-semibold text-white hover:bg-[#5B4BD6]"
        >
          <Plus className="mr-1.5 size-4" />
          Record Payment
        </Button>
      </div>

      {/* Unified Summary Strip */}
      <section className="grid grid-cols-1 divide-y divide-slate-200/80 overflow-hidden rounded-2xl border border-slate-200/80 bg-[#F8FAFC] sm:grid-cols-3 sm:divide-x sm:divide-y-0">
        <div className="p-5">
          <p className="text-xs font-medium text-slate-500">
            Verified Paid (Filtered View)
          </p>
          <p className="mt-2 text-2xl font-bold tracking-tight tabular-nums text-slate-950">
            {formatPhp(paidTotalPhp)}
          </p>
        </div>
        <div className="p-5">
          <p className="text-xs font-medium text-slate-500">
            Collected This Month
          </p>
          <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums text-slate-950">
            {formatPhp(overview?.collectedThisMonthPhp ?? 0)}
          </p>
        </div>
        <div className="p-5">
          <p className="text-xs font-medium text-slate-500">
            Renewals Due (≤ 7d / Past Due)
          </p>
          <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums text-slate-950">
            {overview?.renewalQueue.length ?? 0}
          </p>
        </div>
      </section>

      <Tabs defaultValue="ledger">
        <TabsList className="rounded-full bg-[#F6F8FB] p-1">
          <TabsTrigger value="ledger" className="rounded-full px-4 text-xs">
            Invoice Ledger
          </TabsTrigger>
          <TabsTrigger value="renewals" className="rounded-full px-4 text-xs">
            Renewal Queue ({overview?.renewalQueue.length ?? 0})
          </TabsTrigger>
        </TabsList>

        <TabsContent value="ledger" className="mt-4">
          <section className="rounded-2xl border border-slate-200/80 bg-white p-4 sm:p-5">
            <div className="flex flex-col gap-3 md:flex-row md:items-center md:justify-between">
              <div>
                <h2 className="text-base font-semibold text-slate-950">
                  Subscription Invoices
                </h2>
                <p className="text-xs text-slate-500">
                  Recording a paid invoice extends the clinic&apos;s billing
                  window and restores suspended tenants immediately.
                </p>
              </div>
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
                <div className="relative w-full sm:w-56">
                  <Search className="pointer-events-none absolute top-2.5 left-3 size-4 text-slate-400" />
                  <Input
                    value={searchTerm}
                    onChange={(e) => setSearchTerm(e.target.value)}
                    placeholder="Invoice #, clinic, ref…"
                    className="h-9 rounded-full border-slate-200 bg-[#F8FAFC] pl-9 text-xs"
                  />
                </div>
                <Select
                  value={statusFilter}
                  onValueChange={(v) =>
                    setStatusFilter((v ?? "all") as "all" | PaymentStatus)
                  }
                >
                  <SelectTrigger className="h-9 w-full rounded-full sm:w-36">
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
              </div>
            </div>

            <div className="mt-5">
              {payments === undefined ? (
                <div className="space-y-2.5">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <div
                      key={i}
                      className="h-14 animate-pulse rounded-xl bg-slate-100"
                    />
                  ))}
                </div>
              ) : filteredPayments.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-[#F8FAFC] py-12 text-center text-sm text-slate-500">
                  No subscription invoices match the current filter.
                </div>
              ) : (
                <>
                  {/* Desktop Table */}
                  <div className="hidden overflow-x-auto md:block">
                    <Table>
                      <TableHeader>
                        <TableRow className="hover:bg-transparent">
                          <TableHead>Invoice</TableHead>
                          <TableHead>Clinic</TableHead>
                          <TableHead>Plan &amp; Period</TableHead>
                          <TableHead>Method</TableHead>
                          <TableHead className="text-right">Amount</TableHead>
                          <TableHead>Status</TableHead>
                          <TableHead className="text-right">Actions</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {filteredPayments.map((payment) => (
                          <TableRow key={payment._id}>
                            <TableCell>
                              <div className="font-mono text-xs font-semibold text-slate-900">
                                {payment.invoiceNumber}
                              </div>
                              <div className="text-[11px] text-slate-500">
                                {formatDate(payment.createdAt)}
                              </div>
                            </TableCell>
                            <TableCell>
                              <div className="font-semibold text-slate-950">
                                {payment.clinicName}
                              </div>
                              {payment.referenceNumber ? (
                                <div className="font-mono text-[11px] text-slate-500">
                                  Ref: {payment.referenceNumber}
                                </div>
                              ) : null}
                            </TableCell>
                            <TableCell>
                              <div className="flex items-center gap-1.5">
                                <Badge
                                  variant="secondary"
                                  className="rounded-full bg-slate-100 text-slate-700"
                                >
                                  {payment.planName}
                                </Badge>
                                <span className="text-xs capitalize text-slate-500">
                                  {payment.billingCycle}
                                </span>
                              </div>
                              <div className="mt-0.5 text-[11px] text-slate-500">
                                {formatDate(payment.periodStart)} –{" "}
                                {formatDate(payment.periodEnd)}
                              </div>
                            </TableCell>
                            <TableCell className="text-xs text-slate-700">
                              {
                                PAYMENT_METHOD_LABELS[
                                  payment.paymentMethod as PaymentMethod
                                ]
                              }
                            </TableCell>
                            <TableCell className="text-right text-sm font-semibold tabular-nums text-slate-950">
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
                                    className="h-7 rounded-full px-2.5 text-xs"
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
                                    className="h-7 rounded-full px-3 text-xs font-semibold"
                                  >
                                    <CheckCircle2 className="mr-1 size-3.5 text-emerald-600" />
                                    Mark Paid
                                  </Button>
                                ) : (
                                  <Button
                                    size="sm"
                                    variant="ghost"
                                    onClick={() =>
                                      handleQuickStatus(payment._id, "refunded")
                                    }
                                    className="h-7 rounded-full px-2.5 text-xs text-slate-600"
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
                  </div>

                  {/* Mobile Invoice Cards */}
                  <div className="space-y-3 md:hidden">
                    {filteredPayments.map((payment) => (
                      <div
                        key={payment._id}
                        className="rounded-xl border border-slate-200/80 bg-[#F8FAFC] p-4"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="font-mono text-xs font-semibold text-slate-700">
                              {payment.invoiceNumber}
                            </p>
                            <p className="truncate text-sm font-semibold text-slate-950">
                              {payment.clinicName}
                            </p>
                          </div>
                          <PaymentStatusBadge status={payment.status} />
                        </div>

                        <div className="mt-2.5 flex items-baseline justify-between">
                          <span className="text-xs text-slate-500">
                            {payment.planName} ·{" "}
                            {
                              PAYMENT_METHOD_LABELS[
                                payment.paymentMethod as PaymentMethod
                              ]
                            }
                          </span>
                          <span className="text-base font-bold tabular-nums text-slate-950">
                            {formatPhp(payment.amountPhp)}
                          </span>
                        </div>

                        <p className="mt-1 text-[11px] text-slate-500">
                          {formatDate(payment.periodStart)} –{" "}
                          {formatDate(payment.periodEnd)}
                          {payment.referenceNumber
                            ? ` · Ref ${payment.referenceNumber}`
                            : ""}
                        </p>

                        <div className="mt-3 flex flex-wrap items-center justify-end gap-2 border-t border-slate-200/70 pt-2.5">
                          {payment.receiptUrl ? (
                            <a
                              href={payment.receiptUrl}
                              target="_blank"
                              rel="noreferrer"
                              className="inline-flex h-7 items-center gap-1 rounded-full border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700"
                            >
                              <Receipt className="size-3" />
                              Receipt
                            </a>
                          ) : null}
                          {payment.status !== "paid" ? (
                            <Button
                              size="sm"
                              onClick={() =>
                                handleQuickStatus(payment._id, "paid")
                              }
                              className="h-7 rounded-full bg-slate-950 px-3 text-xs font-semibold text-white"
                            >
                              Mark Paid
                            </Button>
                          ) : (
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() =>
                                handleQuickStatus(payment._id, "refunded")
                              }
                              className="h-7 rounded-full border-slate-200 bg-white px-3 text-xs"
                            >
                              Refund
                            </Button>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </section>
        </TabsContent>

        <TabsContent value="renewals" className="mt-4">
          <section className="rounded-2xl border border-slate-200/80 bg-white p-4 sm:p-5">
            <div>
              <h2 className="text-base font-semibold text-slate-950">
                Clinics Due for Renewal
              </h2>
              <p className="text-xs text-slate-500">
                Tenants whose subscription or trial ends within 7 days, plus
                past-due clinics inside their grace period.
              </p>
            </div>

            <div className="mt-4">
              {!overview || overview.renewalQueue.length === 0 ? (
                <div className="rounded-xl border border-dashed border-slate-200 bg-[#F8FAFC] py-12 text-center text-sm text-slate-500">
                  No upcoming renewals or overdue accounts.
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
                          <TableHead>Ends</TableHead>
                          <TableHead className="text-right">
                            Monthly Rate
                          </TableHead>
                          <TableHead className="text-right">Action</TableHead>
                        </TableRow>
                      </TableHeader>
                      <TableBody>
                        {overview.renewalQueue.map((clinic) => (
                          <TableRow key={clinic._id}>
                            <TableCell>
                              <div className="font-semibold text-slate-950">
                                {clinic.name}
                              </div>
                              <div className="font-mono text-xs text-slate-500">
                                /c/{clinic.slug}
                              </div>
                            </TableCell>
                            <TableCell>
                              <Badge
                                variant="secondary"
                                className="rounded-full bg-slate-100 text-slate-700"
                              >
                                {clinic.planName}
                              </Badge>
                            </TableCell>
                            <TableCell>
                              <ClinicStatusBadge status={clinic.status} />
                            </TableCell>
                            <TableCell className="text-xs tabular-nums text-slate-600">
                              {formatDate(clinic.subscriptionEndsAt)}
                            </TableCell>
                            <TableCell className="text-right text-sm font-semibold tabular-nums text-slate-950">
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
                                className="h-8 rounded-full bg-[#6C5CE7] px-3.5 text-xs font-semibold text-white hover:bg-[#5B4BD6]"
                              >
                                Record Renewal
                              </Button>
                            </TableCell>
                          </TableRow>
                        ))}
                      </TableBody>
                    </Table>
                  </div>

                  {/* Mobile Renewal Cards */}
                  <div className="space-y-3 md:hidden">
                    {overview.renewalQueue.map((clinic) => (
                      <div
                        key={clinic._id}
                        className="rounded-xl border border-slate-200/80 bg-[#F8FAFC] p-4"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="truncate text-sm font-semibold text-slate-950">
                              {clinic.name}
                            </p>
                            <p className="text-xs text-slate-500">
                              {clinic.planName} · Ends{" "}
                              {formatDate(clinic.subscriptionEndsAt)}
                            </p>
                          </div>
                          <ClinicStatusBadge status={clinic.status} />
                        </div>
                        <div className="mt-3 flex items-center justify-between">
                          <span className="text-sm font-bold tabular-nums text-slate-950">
                            {formatPhp(clinic.monthlyPricePhp)}/mo
                          </span>
                          <Button
                            size="sm"
                            onClick={() =>
                              openForClinic(
                                clinic._id,
                                clinic.planId,
                                clinic.billingCycle
                              )
                            }
                            className="h-8 rounded-full bg-[#6C5CE7] px-3.5 text-xs font-semibold text-white"
                          >
                            Record Renewal
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          </section>
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
                  className="tabular-nums"
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
                    <SelectItem value="pending">
                      Pending Verification
                    </SelectItem>
                    <SelectItem value="overdue">Overdue</SelectItem>
                    <SelectItem value="refunded">Refunded</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pay-receipt">
                Payment Receipt (auto-compressed ≤ 500 KB for images)
              </Label>
              <div className="flex items-center gap-2">
                <Input
                  id="pay-receipt"
                  type="file"
                  accept="image/*,application/pdf"
                  disabled={uploadingReceipt}
                  onChange={handleReceiptUpload}
                />
                {uploadingReceipt ? (
                  <Upload className="size-4 animate-pulse text-slate-400" />
                ) : null}
              </div>
              {receiptFileName ? (
                <p className="text-xs font-medium text-emerald-700">
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
                className="bg-[#6C5CE7] text-white hover:bg-[#5B4BD6]"
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
