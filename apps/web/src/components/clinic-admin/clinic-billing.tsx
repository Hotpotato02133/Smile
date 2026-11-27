"use client";

import { useQuery } from "@/lib/api";
import {
  AlertTriangle,
  Armchair,
  CalendarCheck2,
  Check,
  CreditCard,
  ExternalLink,
  HardDrive,
  Mail,
  ReceiptText,
  ShieldAlert,
  Stethoscope,
} from "lucide-react";
import Link from "next/link";
import { useClinicAdminContext } from "@/components/clinic-admin/clinic-admin-shell";
import {
  ClinicStatusBadge,
  PAYMENT_METHOD_LABELS,
  PaymentStatusBadge,
} from "@/components/super-admin/status-badges";
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
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { formatBytes, formatDate, formatPhp } from "@/lib/format";
import { api } from "@/lib/api";

function QuotaMeter({
  label,
  used,
  limit,
  usedLabel,
  limitLabel,
  icon: Icon,
  manageHref,
}: {
  label: string;
  used: number;
  limit: number;
  usedLabel: string;
  limitLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  manageHref?: string;
}) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const atLimit = limit > 0 && used >= limit;
  const barColor = atLimit
    ? "bg-rose-500"
    : pct >= 85
      ? "bg-amber-500"
      : "bg-sky-600 dark:bg-sky-400";

  return (
    <div className="space-y-2 rounded-lg border p-3.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-sm font-medium">
          <Icon className="size-4 text-muted-foreground" />
          <span>{label}</span>
        </div>
        <div className="flex items-center gap-2">
          {atLimit ? (
            <Badge variant="destructive" className="text-[10px]">
              Limit Reached
            </Badge>
          ) : (
            <span className="font-mono text-xs text-muted-foreground">
              {pct}%
            </span>
          )}
        </div>
      </div>

      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${Math.max(pct, used > 0 ? 3 : 0)}%` }}
        />
      </div>

      <div className="flex items-center justify-between text-xs text-muted-foreground">
        <span className="font-mono">
          {usedLabel} / {limitLabel}
        </span>
        {manageHref ? (
          <Link
            href={manageHref}
            className="font-medium text-foreground underline-offset-4 hover:underline"
          >
            Manage
          </Link>
        ) : null}
      </div>
    </div>
  );
}

export function ClinicBillingPanel() {
  const { overrideClinicId, buildHref } = useClinicAdminContext();
  const billing = useQuery(api.clinicAdmin.getClinicBillingSummary, {
    overrideClinicId,
  });

  if (billing === undefined) {
    return (
      <div className="space-y-4">
        <div className="h-8 w-56 animate-pulse rounded bg-muted" />
        <div className="grid gap-4 md:grid-cols-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <Card key={i}>
              <CardHeader>
                <div className="h-4 w-28 animate-pulse rounded bg-muted" />
              </CardHeader>
              <CardContent>
                <div className="h-8 w-36 animate-pulse rounded bg-muted" />
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    );
  }

  const { clinic, currentPlan, availablePlans, payments, isReadOnly, readOnlyReason } =
    billing;

  const billingCycleLabel =
    clinic.billingCycle === "annual"
      ? "Annual"
      : clinic.billingCycle === "monthly"
        ? "Monthly"
        : "Free Trial";

  const activeRatePhp =
    clinic.billingCycle === "annual"
      ? (currentPlan?.annualPricePhp ?? 0)
      : clinic.billingCycle === "monthly"
        ? (currentPlan?.monthlyPricePhp ?? 0)
        : 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              Subscription &amp; Billing
            </h1>
            <ClinicStatusBadge status={clinic.status} />
            {currentPlan ? (
              <Badge variant="secondary">{currentPlan.name}</Badge>
            ) : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            Track your active plan tier, live resource quotas, renewal dates,
            and invoice payment history.
          </p>
        </div>
      </div>

      {/* Status Alert when Past Due or Read-Only */}
      {clinic.status === "past_due" && !isReadOnly ? (
        <Alert>
          <AlertTriangle className="size-4" />
          <AlertTitle>Subscription Past Due — Grace Period Active</AlertTitle>
          <AlertDescription>
            Your subscription ended on {formatDate(clinic.subscriptionEndsAt)}.
            Your clinic remains operational until{" "}
            <strong>
              {formatDate(
                clinic.gracePeriodEndsAt ??
                  clinic.subscriptionEndsAt + 3 * 24 * 60 * 60 * 1000
              )}
            </strong>
            . Please settle your renewal via GCash, Maya, or Bank Transfer with
            the Smile platform administrator to prevent Read-Only suspension.
          </AlertDescription>
        </Alert>
      ) : null}

      {isReadOnly && readOnlyReason ? (
        <Alert variant="destructive">
          <ShieldAlert className="size-4" />
          <AlertTitle>Workspace Currently in Read-Only Mode</AlertTitle>
          <AlertDescription>
            {readOnlyReason} Clinical charts and past records remain accessible
            for viewing; renew your subscription to resume editing and online
            bookings on <code>/c/{clinic.slug}</code>.
          </AlertDescription>
        </Alert>
      ) : null}

      {/* Subscription Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardDescription>Current Plan Tier</CardDescription>
            <CreditCard className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="text-xl font-semibold">
              {currentPlan?.name ?? "Custom Plan"}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {currentPlan?.description ?? "Multi-tenant clinic subscription"}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Billing Cycle &amp; Rate</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-2xl font-semibold tabular-nums">
              {activeRatePhp > 0 ? formatPhp(activeRatePhp) : "₱0"}
              <span className="ml-1 font-sans text-xs font-normal text-muted-foreground">
                / {billingCycleLabel.toLowerCase()}
              </span>
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Cycle started {formatDate(clinic.subscriptionStartsAt)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>
              {clinic.status === "trial" ? "Trial Ends" : "Next Renewal Date"}
            </CardDescription>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-2xl font-semibold tabular-nums">
              {formatDate(clinic.subscriptionEndsAt)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {clinic.gracePeriodEndsAt
                ? `Grace window until ${formatDate(clinic.gracePeriodEndsAt)}`
                : "Contact platform billing for plan upgrades or manual renewal"}
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Live Quota Progress Bars */}
      <Card>
        <CardHeader>
          <CardTitle>Live Plan Resource Quotas</CardTitle>
          <CardDescription>
            Real-time utilization against your{" "}
            <strong>{currentPlan?.name ?? "current"}</strong> plan limits.
            Mutations automatically guard against exceeding plan caps.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          <QuotaMeter
            label="Active Dentists"
            used={clinic.activeDentistCount}
            limit={currentPlan?.maxDentists ?? 0}
            usedLabel={String(clinic.activeDentistCount)}
            limitLabel={String(currentPlan?.maxDentists ?? 0)}
            icon={Stethoscope}
            manageHref={buildHref("/admin/dentists")}
          />
          <QuotaMeter
            label="Operatory Chairs"
            used={clinic.activeChairCount}
            limit={currentPlan?.maxChairs ?? 0}
            usedLabel={String(clinic.activeChairCount)}
            limitLabel={String(currentPlan?.maxChairs ?? 0)}
            icon={Armchair}
            manageHref={buildHref("/admin/chairs")}
          />
          <QuotaMeter
            label="Monthly Appointments"
            used={clinic.currentMonthAppointmentCount}
            limit={currentPlan?.maxAppointmentsPerMonth ?? 0}
            usedLabel={clinic.currentMonthAppointmentCount.toLocaleString()}
            limitLabel={(
              currentPlan?.maxAppointmentsPerMonth ?? 0
            ).toLocaleString()}
            icon={CalendarCheck2}
            manageHref={buildHref("/admin/reports")}
          />
          <QuotaMeter
            label="X-Ray & File Storage"
            used={clinic.storageUsedBytes}
            limit={currentPlan?.maxStorageBytes ?? 0}
            usedLabel={formatBytes(clinic.storageUsedBytes)}
            limitLabel={formatBytes(currentPlan?.maxStorageBytes ?? 0)}
            icon={HardDrive}
            manageHref={buildHref("/admin/settings")}
          />
          <QuotaMeter
            label="Monthly Emails (Resend)"
            used={clinic.currentMonthEmailCount}
            limit={currentPlan?.maxEmailsPerMonth ?? 0}
            usedLabel={clinic.currentMonthEmailCount.toLocaleString()}
            limitLabel={(
              currentPlan?.maxEmailsPerMonth ?? 0
            ).toLocaleString()}
            icon={Mail}
          />
        </CardContent>
      </Card>

      {/* Invoice & Payment History */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <ReceiptText className="size-4 text-muted-foreground" />
            Invoice &amp; Payment History
          </CardTitle>
          <CardDescription>
            Recorded subscription invoices, payment methods (GCash, Maya, Bank
            Transfer, Card), and uploaded official receipts.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {payments.length === 0 ? (
            <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
              No subscription invoices recorded yet for this clinic.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Invoice #</TableHead>
                    <TableHead>Plan &amp; Period</TableHead>
                    <TableHead>Method / Ref</TableHead>
                    <TableHead className="text-right">Amount</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Paid Date</TableHead>
                    <TableHead className="text-right">Receipt</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {payments.map((payment) => (
                    <TableRow key={payment._id}>
                      <TableCell className="font-mono text-xs font-semibold">
                        {payment.invoiceNumber}
                      </TableCell>
                      <TableCell>
                        <div className="text-sm font-medium">
                          {payment.planName}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          {formatDate(payment.periodStart)} –{" "}
                          {formatDate(payment.periodEnd)} (
                          {payment.billingCycle})
                        </div>
                      </TableCell>
                      <TableCell className="text-xs">
                        <div>
                          {PAYMENT_METHOD_LABELS[payment.paymentMethod]}
                        </div>
                        {payment.referenceNumber ? (
                          <div className="font-mono text-[11px] text-muted-foreground">
                            Ref: {payment.referenceNumber}
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right font-mono font-semibold tabular-nums">
                        {formatPhp(payment.amountPhp)}
                      </TableCell>
                      <TableCell>
                        <PaymentStatusBadge status={payment.status} />
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground">
                        {payment.paidAt
                          ? formatDate(payment.paidAt)
                          : formatDate(payment.createdAt)}
                      </TableCell>
                      <TableCell className="text-right">
                        {payment.receiptUrl ? (
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 text-xs"
                            render={
                              <a
                                href={payment.receiptUrl}
                                target="_blank"
                                rel="noreferrer"
                              />
                            }
                          >
                            View
                            <ExternalLink className="ml-1 size-3" />
                          </Button>
                        ) : (
                          <span className="text-xs text-muted-foreground">
                            —
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Plan Comparison */}
      {availablePlans.length > 0 ? (
        <Card>
          <CardHeader>
            <CardTitle>Available Subscription Tiers</CardTitle>
            <CardDescription>
              Compare limits and clinical entitlements. Reach out to your Smile
              platform administrator to switch plans or extend your cycle.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
            {availablePlans.map((plan) => {
              const isCurrent = plan._id === clinic.planId;
              return (
                <div
                  key={plan._id}
                  className={`flex flex-col justify-between rounded-xl border p-4 ${
                    isCurrent
                      ? "border-primary bg-primary/[0.03] ring-1 ring-primary/20"
                      : ""
                  }`}
                >
                  <div className="space-y-3">
                    <div className="flex items-center justify-between gap-2">
                      <h3 className="font-semibold">{plan.name}</h3>
                      {isCurrent ? (
                        <Badge variant="default" className="text-[10px]">
                          Current Plan
                        </Badge>
                      ) : null}
                    </div>
                    <div>
                      <p className="font-mono text-2xl font-semibold tabular-nums">
                        {formatPhp(plan.monthlyPricePhp)}
                        <span className="font-sans text-xs font-normal text-muted-foreground">
                          /mo
                        </span>
                      </p>
                      {plan.annualPricePhp > 0 ? (
                        <p className="text-xs text-muted-foreground">
                          or {formatPhp(plan.annualPricePhp)}/year
                        </p>
                      ) : null}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {plan.description}
                    </p>
                    <ul className="space-y-1.5 border-t pt-3 text-xs">
                      <li className="flex items-center gap-1.5">
                        <Check className="size-3.5 text-emerald-600" />
                        Up to {plan.maxDentists} dentists &amp; {plan.maxChairs}{" "}
                        chairs
                      </li>
                      <li className="flex items-center gap-1.5">
                        <Check className="size-3.5 text-emerald-600" />
                        {plan.maxAppointmentsPerMonth.toLocaleString()}{" "}
                        appointments/mo
                      </li>
                      <li className="flex items-center gap-1.5">
                        <Check className="size-3.5 text-emerald-600" />
                        {formatBytes(plan.maxStorageBytes)} X-ray storage
                      </li>
                      <li className="flex items-center gap-1.5">
                        <Check className="size-3.5 text-emerald-600" />
                        {plan.maxEmailsPerMonth.toLocaleString()} emails/mo
                      </li>
                      {plan.defaultFeatures.customBrandingEnabled ? (
                        <li className="flex items-center gap-1.5">
                          <Check className="size-3.5 text-emerald-600" />
                          Custom branding &amp; logo
                        </li>
                      ) : null}
                      {plan.defaultFeatures.waitlistAutomationEnabled ? (
                        <li className="flex items-center gap-1.5">
                          <Check className="size-3.5 text-emerald-600" />
                          Waitlist &amp; recall automation
                        </li>
                      ) : null}
                    </ul>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
