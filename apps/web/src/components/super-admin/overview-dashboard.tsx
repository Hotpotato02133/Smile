"use client";

import { useApiQueryState, useMutation } from "@/lib/api";
import {
  AlertTriangle,
  ArrowUpRight,
  Bell,
  Building2,
  CalendarPlus,
  HardDrive,
  Mail,
  Plus,
  RefreshCw,
} from "lucide-react";
import Link from "next/link";
import { useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  XAxis,
  YAxis,
} from "recharts";
import { toast } from "sonner";
import { ClinicStatusBadge } from "@/components/super-admin/status-badges";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  type ChartConfig,
  ChartContainer,
  ChartLegend,
  ChartLegendContent,
  ChartTooltip,
  ChartTooltipContent,
} from "@/components/ui/chart";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  formatBytes,
  formatDate,
  formatDateTime,
  formatPhp,
  formatShortDateKey,
  getErrorMessage,
} from "@/lib/format";
import { cn } from "@/lib/utils";
import { api } from "@/lib/api";
import type { Id } from "@/lib/api";

const mrrChartConfig = {
  mrrPhp: {
    label: "Monthly Recurring Revenue",
    color: "#6C5CE7",
  },
  revenueCollectedTodayPhp: {
    label: "Daily Collected",
    color: "#0EA5E9",
  },
} satisfies ChartConfig;

const growthChartConfig = {
  totalClinics: {
    label: "Total Clinics",
    color: "#6C5CE7",
  },
  activePaidClinics: {
    label: "Active Paid Clinics",
    color: "#10B981",
  },
} satisfies ChartConfig;

const distributionChartConfig = {
  count: {
    label: "Clinics",
    color: "#6C5CE7",
  },
} satisfies ChartConfig;

const appointmentsChartConfig = {
  completedAppointments: {
    label: "Completed",
    color: "#10B981",
  },
  cancelledAppointments: {
    label: "Cancelled",
    color: "#F59E0B",
  },
  noShowAppointments: {
    label: "No-Show",
    color: "#EF4444",
  },
} satisfies ChartConfig;

function QuotaBar({
  label,
  valueText,
  percent,
  accentClass = "bg-[#6C5CE7]",
}: {
  label: string;
  valueText: string;
  percent: number;
  accentClass?: string;
}) {
  const barColor =
    percent >= 85
      ? "bg-rose-500"
      : percent >= 65
        ? "bg-amber-500"
        : accentClass;

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="font-medium text-slate-800">{label}</span>
        <span className="shrink-0 tabular-nums text-slate-500">
          <span className="font-semibold text-slate-900">{valueText}</span> ·{" "}
          {percent}%
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full transition-[width] ${barColor}`}
          style={{
            width: `${percent === 0 ? 0 : Math.min(100, Math.max(percent, 1.5))}%`,
          }}
        />
      </div>
    </div>
  );
}

export function OverviewDashboard() {
  const [windowDays, setWindowDays] = useState<number>(30);
  const [trendMode, setTrendMode] = useState<"revenue" | "clinics">("revenue");
  const [distributionMode, setDistributionMode] = useState<"plan" | "status">(
    "plan"
  );
  const [consumerTab, setConsumerTab] = useState<"storage" | "emails">(
    "storage"
  );
  const [rollingUp, setRollingUp] = useState(false);
  const [busyRenewalId, setBusyRenewalId] = useState<string | null>(null);

  const overviewQuery = useApiQueryState(
    api.platformAnalytics.getDashboardOverview,
    {}
  );
  const dailySeriesQuery = useApiQueryState(
    api.platformAnalytics.getDailyMetricsSeries,
    { days: windowDays }
  );
  const leaderboardQuery = useApiQueryState(
    api.platformAnalytics.getClinicLeaderboard,
    { limit: 8 }
  );
  const freeTierQuery = useApiQueryState(
    api.platformAnalytics.getFreeTierUsage,
    {}
  );
  const overview = overviewQuery.data;
  const dailySeries = dailySeriesQuery.data;
  const leaderboard = leaderboardQuery.data;
  const freeTier = freeTierQuery.data;
  const loadError =
    overviewQuery.error ??
    dailySeriesQuery.error ??
    leaderboardQuery.error ??
    freeTierQuery.error;
  const handleRetryAll = () => {
    void Promise.all([
      overviewQuery.refetch(),
      dailySeriesQuery.refetch(),
      leaderboardQuery.refetch(),
      freeTierQuery.refetch(),
    ]);
  };
  const triggerRollup = useMutation(api.superAdmin.triggerDailyRollup);
  const extendSubscription = useMutation(
    api.superAdmin.extendClinicSubscription
  );
  const sendRenewalReminder = useMutation(api.superAdmin.sendRenewalReminder);

  const handleQuickExtend = async (clinicId: Id<"clinics">, name: string) => {
    setBusyRenewalId(`ext:${clinicId}`);
    try {
      const res = await extendSubscription({
        clinicId,
        extraDays: 7,
        reason: "Quick +7d extension from Overview Renewal Queue",
      });
      toast.success(
        `Extended ${name} by +7 days (ends ${formatDate(res.subscriptionEndsAt)}).`
      );
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not extend subscription."));
    } finally {
      setBusyRenewalId(null);
    }
  };

  const handleQuickRemind = async (clinicId: Id<"clinics">, name: string) => {
    setBusyRenewalId(`rem:${clinicId}`);
    try {
      const res = await sendRenewalReminder({ clinicId });
      toast.success(`Renewal reminder queued for ${name} (${res.sentTo}).`);
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not send renewal reminder."));
    } finally {
      setBusyRenewalId(null);
    }
  };

  const handleSyncSnapshot = async () => {
    setRollingUp(true);
    try {
      const res = await triggerRollup({});
      toast.success(
        `Refreshed snapshot for ${res.dateKey} (${res.clinicsRolledUp} clinic${res.clinicsRolledUp === 1 ? "" : "s"}).`
      );
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not refresh platform metrics."));
    } finally {
      setRollingUp(false);
    }
  };

  if (
    loadError &&
    (overview === undefined ||
      dailySeries === undefined ||
      leaderboard === undefined ||
      freeTier === undefined)
  ) {
    return (
      <div className="flex min-h-[260px] flex-col items-center justify-center gap-3 rounded-2xl border border-amber-200/80 bg-amber-50/50 p-6 text-center">
        <AlertTriangle className="size-6 text-amber-600" />
        <div className="space-y-1">
          <h2 className="text-base font-semibold text-slate-950">
            Could not load Platform Overview
          </h2>
          <p className="max-w-md text-xs text-slate-600">
            {getErrorMessage(
              loadError,
              "Unable to reach the Smile API backend. Make sure the API server is running and try again."
            )}
          </p>
        </div>
        <Button
          type="button"
          size="sm"
          onClick={handleRetryAll}
          className="h-9 rounded-full bg-[#6C5CE7] px-4 text-xs font-semibold text-white hover:bg-[#5B4BD6]"
        >
          <RefreshCw className="mr-1.5 size-3.5" />
          Retry
        </Button>
      </div>
    );
  }

  if (
    overview === undefined ||
    dailySeries === undefined ||
    leaderboard === undefined ||
    freeTier === undefined
  ) {
    return (
      <div className="space-y-5">
        <div className="h-14 w-72 animate-pulse rounded-2xl bg-slate-100" />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }).map((_, i) => (
            <div
              key={i}
              className="h-28 animate-pulse rounded-2xl bg-slate-100"
            />
          ))}
        </div>
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="h-72 animate-pulse rounded-2xl bg-slate-100 lg:col-span-2" />
          <div className="h-72 animate-pulse rounded-2xl bg-slate-100" />
        </div>
      </div>
    );
  }

  const hasRevenueData = dailySeries.some(
    (d) => d.mrrPhp > 0 || d.revenueCollectedTodayPhp > 0
  );
  const hasAppointmentSeries = dailySeries.some(
    (d) =>
      d.completedAppointments > 0 ||
      d.cancelledAppointments > 0 ||
      d.noShowAppointments > 0
  );
  const distributionData =
    distributionMode === "plan"
      ? overview.planDistribution.map((p) => ({
          label: p.name.replace(/^Smile\s+/i, ""),
          count: p.count,
        }))
      : overview.statusDistribution.map((s) => ({
          label: s.label,
          count: s.count,
        }));
  const hasDistributionData = distributionData.some((d) => d.count > 0);

  // Dynamic single-line platform finding answering the screen's main question
  const headlineFinding =
    overview.totalClinics === 0
      ? "No dental clinics onboarded yet — provision your first clinic to begin tracking MRR and utilization."
      : overview.renewalQueue.length > 0
        ? `${overview.activePaidClinics} active clinic${overview.activePaidClinics === 1 ? "" : "s"} · ${overview.renewalQueue.length} renewal${overview.renewalQueue.length === 1 ? "" : "s"} due within 7 days or past due.`
        : `${overview.activePaidClinics} active and ${overview.trialClinics} trial clinic${overview.trialClinics === 1 ? "" : "s"} in good standing · ${overview.completionRatePct}% 30-day completion rate.`;

  return (
    <div className="flex flex-col gap-6">
      {/* Header Row */}
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div className="space-y-1">
          <h1 className="text-2xl font-bold tracking-tight text-slate-950">
            Platform Overview
          </h1>
          <p className="text-sm text-slate-600">{headlineFinding}</p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            disabled={rollingUp}
            onClick={handleSyncSnapshot}
            className="h-9 rounded-full border-slate-200 px-3.5 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            <RefreshCw
              className={cn("mr-1.5 size-3.5", rollingUp && "animate-spin")}
            />
            {rollingUp ? "Syncing…" : "Sync Snapshot"}
          </Button>
          <Button
            variant="outline"
            size="sm"
            render={<Link href="/super-admin/users" />}
            className="h-9 rounded-full border-slate-200 px-4 text-xs font-semibold text-slate-800 hover:bg-slate-50"
          >
            Invite User
          </Button>
          <Button
            variant="outline"
            size="sm"
            render={<Link href="/super-admin/billing" />}
            className="h-9 rounded-full border-slate-200 px-4 text-xs font-semibold text-slate-800 hover:bg-slate-50"
          >
            Record Payment
          </Button>
          <Button
            size="sm"
            render={<Link href="/super-admin/clinics" />}
            className="h-9 rounded-full bg-[#6C5CE7] px-4 text-xs font-semibold text-white hover:bg-[#5B4BD6]"
          >
            <Plus className="mr-1 size-3.5" />
            Provision Clinic
          </Button>
        </div>
      </div>

      {/* Unified 5-Column KPI Strip (Split by quiet 1px dividers) */}
      <section
        aria-label="Platform key metrics"
        className="grid grid-cols-1 divide-y divide-slate-200/80 overflow-hidden rounded-2xl border border-slate-200/80 bg-[#F8FAFC] sm:grid-cols-2 sm:divide-y-0 xl:grid-cols-5 xl:divide-x"
      >
        {/* Lead Figure: MRR */}
        <div className="flex flex-col justify-between p-5 sm:border-b sm:border-r sm:border-slate-200/80 xl:border-b-0 xl:border-r-0">
          <span className="text-xs font-medium text-slate-500">
            Monthly Recurring Revenue
          </span>
          <p className="mt-2 text-3xl font-bold tracking-tight tabular-nums text-slate-950">
            {formatPhp(overview.mrrPhp)}
          </p>
          <p className="mt-1.5 text-xs text-slate-500 tabular-nums">
            ARR {formatPhp(overview.arrPhp)}
          </p>
        </div>

        {/* Collected This Month */}
        <div className="flex flex-col justify-between p-5 sm:border-b sm:border-slate-200/80 xl:border-b-0">
          <span className="text-xs font-medium text-slate-500">
            Collected This Month
          </span>
          <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums text-slate-950">
            {formatPhp(overview.collectedThisMonthPhp)}
          </p>
          <p className="mt-1.5 text-xs text-slate-500 tabular-nums">
            {overview.paidInvoicesThisMonthCount} paid invoice
            {overview.paidInvoicesThisMonthCount === 1 ? "" : "s"}
            {overview.pendingPaymentsCount > 0 ? (
              <span className="ml-1.5 font-medium text-amber-700">
                · {overview.pendingPaymentsCount} pending
              </span>
            ) : null}
          </p>
        </div>

        {/* Dental Clinics + Trial-to-Paid Conversion */}
        <div className="flex flex-col justify-between p-5 sm:border-b sm:border-r sm:border-slate-200/80 xl:border-b-0 xl:border-r-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">
              Dental Clinics
            </span>
            <span className="text-[11px] font-semibold tabular-nums text-emerald-700">
              {overview.trialToPaidConversionPct}% paid
            </span>
          </div>
          <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums text-slate-950">
            {overview.totalClinics.toLocaleString()}
          </p>
          <p className="mt-1.5 text-xs text-slate-500 tabular-nums">
            <span className="font-medium text-emerald-700">
              {overview.activePaidClinics} active
            </span>{" "}
            · {overview.trialClinics} trial ·{" "}
            <span
              className={
                overview.pastDueClinics > 0
                  ? "font-medium text-amber-700"
                  : undefined
              }
            >
              {overview.pastDueClinics} past due
            </span>{" "}
            ·{" "}
            <span
              className={
                overview.suspendedClinics > 0
                  ? "font-medium text-rose-700"
                  : undefined
              }
            >
              {overview.suspendedClinics} suspended
            </span>
          </p>
        </div>

        {/* Appointments (Today / 30d + Completion & No-Show %) */}
        <div className="flex flex-col justify-between p-5 sm:border-b sm:border-slate-200/80 xl:border-b-0">
          <div className="flex items-center justify-between gap-2">
            <span className="text-xs font-medium text-slate-500">
              Bookings (Month)
            </span>
            <span className="text-[11px] font-medium tabular-nums text-slate-500">
              Today: {overview.todayAppointments}
            </span>
          </div>
          <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums text-slate-950">
            {overview.currentMonthAppointments.toLocaleString()}
          </p>
          <p className="mt-1.5 text-xs text-slate-500 tabular-nums">
            {overview.thirtyDayTotalBooked > 0 ? (
              <>
                <span className="font-medium text-emerald-700">
                  {overview.completionRatePct}% completed
                </span>{" "}
                ·{" "}
                <span
                  className={
                    overview.noShowRatePct >= 15
                      ? "font-medium text-rose-700"
                      : undefined
                  }
                >
                  {overview.noShowRatePct}% no-show
                </span>
              </>
            ) : (
              <span>
                {overview.lifetimeAppointments.toLocaleString()} lifetime across
                tenants
              </span>
            )}
          </p>
        </div>

        {/* Total Platform Users */}
        <div className="flex flex-col justify-between p-5">
          <span className="text-xs font-medium text-slate-500">
            Total Users
          </span>
          <p className="mt-2 text-2xl font-semibold tracking-tight tabular-nums text-slate-950">
            {overview.totalUsers.toLocaleString()}
          </p>
          <p className="mt-1.5 text-xs text-slate-500 tabular-nums">
            {overview.userBreakdown.clinicStaff} staff ·{" "}
            {overview.userBreakdown.patients} patients ·{" "}
            {overview.userBreakdown.superAdmins} owner
          </p>
        </div>
      </section>

      {/* Charts Row 1: MRR / Clinic Growth Trend + Clinic Distribution */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12">
        <section className="flex flex-col rounded-2xl border border-slate-200/80 bg-white p-5 lg:col-span-8">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <h2 className="text-base font-semibold text-slate-950">
                {trendMode === "revenue"
                  ? "MRR & Collected Revenue"
                  : "Clinic Growth Trend"}
              </h2>
              <p className="text-xs text-slate-500">
                {trendMode === "revenue"
                  ? "Daily recurring run rate versus verified payments"
                  : "Total provisioned tenants versus active paid clinics"}
                {overview.lastRollupAt
                  ? ` · Last rollup ${formatDateTime(overview.lastRollupAt)}`
                  : ""}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-0.5 rounded-full border border-slate-200/80 bg-[#F6F8FB] p-0.5">
                {(
                  [
                    ["revenue", "MRR"],
                    ["clinics", "Clinics"],
                  ] as const
                ).map(([mode, label]) => (
                  <button
                    key={mode}
                    type="button"
                    onClick={() => setTrendMode(mode)}
                    className={cn(
                      "h-7 rounded-full px-3 text-xs font-semibold transition-colors cursor-pointer",
                      trendMode === mode
                        ? "bg-white text-slate-950 shadow-xs"
                        : "text-slate-600 hover:text-slate-950"
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="inline-flex w-fit items-center gap-0.5 rounded-full border border-slate-200/80 bg-[#F6F8FB] p-0.5">
                {[14, 30, 90].map((d) => (
                  <button
                    key={d}
                    type="button"
                    onClick={() => setWindowDays(d)}
                    className={cn(
                      "h-7 rounded-full px-3 text-xs font-semibold transition-colors cursor-pointer",
                      windowDays === d
                        ? "bg-white text-slate-950 shadow-xs"
                        : "text-slate-600 hover:text-slate-950"
                    )}
                  >
                    {d}d
                  </button>
                ))}
              </div>
            </div>
          </div>

          <div className="relative mt-4 flex-1">
            {trendMode === "revenue" ? (
              !hasRevenueData ? (
                <div className="flex h-[240px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-[#F8FAFC] px-6 text-center">
                  <p className="text-sm font-semibold text-slate-800">
                    No subscription revenue recorded in the last {windowDays}{" "}
                    days
                  </p>
                  <p className="mt-1 max-w-sm text-xs text-slate-500">
                    Provision a clinic on a paid plan or log a verified GCash /
                    bank transfer invoice to populate this revenue curve.
                  </p>
                  <Button
                    size="sm"
                    variant="outline"
                    render={<Link href="/super-admin/billing" />}
                    className="mt-4 h-8 rounded-full border-slate-200 bg-white px-4 text-xs font-semibold"
                  >
                    Record first payment
                  </Button>
                </div>
              ) : (
                <ChartContainer
                  config={mrrChartConfig}
                  className="h-[240px] w-full"
                >
                  <AreaChart
                    data={dailySeries}
                    margin={{ left: 4, right: 8, top: 8, bottom: 0 }}
                  >
                    <CartesianGrid
                      vertical={false}
                      stroke="#E2E8F0"
                      strokeDasharray="3 3"
                    />
                    <XAxis
                      dataKey="dateKey"
                      tickLine={false}
                      axisLine={false}
                      tickMargin={8}
                      tickFormatter={formatShortDateKey}
                    />
                    <YAxis
                      tickLine={false}
                      axisLine={false}
                      width={64}
                      tickFormatter={(v) => `₱${Number(v).toLocaleString()}`}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <ChartLegend content={<ChartLegendContent />} />
                    <Area
                      type="monotone"
                      dataKey="mrrPhp"
                      stroke="var(--color-mrrPhp)"
                      fill="var(--color-mrrPhp)"
                      fillOpacity={0.14}
                      strokeWidth={2}
                    />
                    <Area
                      type="monotone"
                      dataKey="revenueCollectedTodayPhp"
                      stroke="var(--color-revenueCollectedTodayPhp)"
                      fill="var(--color-revenueCollectedTodayPhp)"
                      fillOpacity={0.1}
                      strokeWidth={2}
                    />
                  </AreaChart>
                </ChartContainer>
              )
            ) : !dailySeries.some((d) => d.totalClinics > 0) ? (
              <div className="flex h-[240px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-[#F8FAFC] px-6 text-center">
                <p className="text-sm font-semibold text-slate-800">
                  No clinic growth data yet
                </p>
                <p className="mt-1 max-w-sm text-xs text-slate-500">
                  Provision your first dental clinic to track tenant growth and
                  paid conversions over time.
                </p>
              </div>
            ) : (
              <ChartContainer
                config={growthChartConfig}
                className="h-[240px] w-full"
              >
                <AreaChart
                  data={dailySeries}
                  margin={{ left: 4, right: 8, top: 8, bottom: 0 }}
                >
                  <CartesianGrid
                    vertical={false}
                    stroke="#E2E8F0"
                    strokeDasharray="3 3"
                  />
                  <XAxis
                    dataKey="dateKey"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    tickFormatter={formatShortDateKey}
                  />
                  <YAxis
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                    width={36}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Area
                    type="monotone"
                    dataKey="totalClinics"
                    stroke="var(--color-totalClinics)"
                    fill="var(--color-totalClinics)"
                    fillOpacity={0.14}
                    strokeWidth={2}
                  />
                  <Area
                    type="monotone"
                    dataKey="activePaidClinics"
                    stroke="var(--color-activePaidClinics)"
                    fill="var(--color-activePaidClinics)"
                    fillOpacity={0.12}
                    strokeWidth={2}
                  />
                </AreaChart>
              </ChartContainer>
            )}
          </div>
        </section>

        {/* Clinic Distribution (Toggleable: By Plan / By Status) */}
        <section className="flex flex-col rounded-2xl border border-slate-200/80 bg-white p-5 lg:col-span-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h2 className="text-base font-semibold text-slate-950">
                Clinic Distribution
              </h2>
              <p className="text-xs text-slate-500">
                Tenants by subscription tier or status
              </p>
            </div>
            <div className="inline-flex shrink-0 items-center rounded-full border border-slate-200/80 bg-[#F6F8FB] p-0.5">
              {(["plan", "status"] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setDistributionMode(mode)}
                  className={cn(
                    "h-7 rounded-full px-2.5 text-xs font-semibold capitalize transition-colors cursor-pointer",
                    distributionMode === mode
                      ? "bg-white text-slate-950 shadow-xs"
                      : "text-slate-600 hover:text-slate-950"
                  )}
                >
                  {mode}
                </button>
              ))}
            </div>
          </div>

          <div className="mt-4 flex-1">
            {!hasDistributionData ? (
              <div className="flex h-[240px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-[#F8FAFC] px-4 text-center">
                <Building2 className="size-6 text-slate-300" />
                <p className="mt-2 text-sm font-semibold text-slate-800">
                  0 clinics provisioned
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Distribution across plans and lifecycle gates appears here
                  once clinics are onboarded.
                </p>
              </div>
            ) : (
              <ChartContainer
                config={distributionChartConfig}
                className="h-[240px] w-full"
              >
                <BarChart
                  data={distributionData}
                  margin={{ left: 0, right: 8, top: 8, bottom: 0 }}
                >
                  <CartesianGrid
                    vertical={false}
                    stroke="#E2E8F0"
                    strokeDasharray="3 3"
                  />
                  <XAxis
                    dataKey="label"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                  />
                  <YAxis
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                    width={28}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <Bar
                    dataKey="count"
                    fill="var(--color-count)"
                    radius={[6, 6, 0, 0]}
                    maxBarSize={44}
                  />
                </BarChart>
              </ChartContainer>
            )}
          </div>
        </section>
      </div>

      {/* Row 2: Free-Tier Gauges, Appointment Outcomes, and Renewal Queue */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-3">
        {/* Free-Tier Resource Gauges */}
        <section className="flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-5">
          <div>
            <h2 className="text-base font-semibold text-slate-950">
              Free-Tier Resource Gauges
            </h2>
            <p className="text-xs text-slate-500">
              Monitor usage against $0/mo Cloudflare R2, Resend, and Clerk limits
            </p>

            <div className="mt-5 space-y-4">
              <QuotaBar
                label="Cloudflare R2 Storage (X-Rays & Receipts)"
                valueText={`${formatBytes(freeTier.storage.usedBytes)} / ${formatBytes(freeTier.storage.limitBytes)}`}
                percent={freeTier.storage.percentUsed}
                accentClass="bg-[#6C5CE7]"
              />
              <QuotaBar
                label="Resend Monthly Email Pool"
                valueText={`${freeTier.emails.sentThisMonth.toLocaleString()} / ${freeTier.emails.monthlyLimit.toLocaleString()}`}
                percent={freeTier.emails.percentUsed}
                accentClass="bg-sky-600"
              />
              <QuotaBar
                label="Clerk Monthly Active Users (MAU)"
                valueText={`${freeTier.clerkMau.activeLast30Days.toLocaleString()} / ${freeTier.clerkMau.monthlyLimit.toLocaleString()}`}
                percent={freeTier.clerkMau.percentUsed}
                accentClass="bg-emerald-600"
              />
            </div>

            <div className="mt-5 border-t border-slate-100 pt-4">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-700">
                  {consumerTab === "storage" ? (
                    <HardDrive className="size-3.5 text-slate-500" />
                  ) : (
                    <Mail className="size-3.5 text-slate-500" />
                  )}
                  {consumerTab === "storage"
                    ? "Top Storage Consumers"
                    : "Top Email Consumers"}
                </span>
                <div className="inline-flex rounded-full border border-slate-200/80 bg-[#F6F8FB] p-0.5 text-[11px]">
                  <button
                    type="button"
                    onClick={() => setConsumerTab("storage")}
                    className={cn(
                      "rounded-full px-2 py-0.5 font-semibold transition-colors cursor-pointer",
                      consumerTab === "storage"
                        ? "bg-white text-slate-950 shadow-xs"
                        : "text-slate-500"
                    )}
                  >
                    Storage
                  </button>
                  <button
                    type="button"
                    onClick={() => setConsumerTab("emails")}
                    className={cn(
                      "rounded-full px-2 py-0.5 font-semibold transition-colors cursor-pointer",
                      consumerTab === "emails"
                        ? "bg-white text-slate-950 shadow-xs"
                        : "text-slate-500"
                    )}
                  >
                    Emails
                  </button>
                </div>
              </div>

              <div className="mt-3 space-y-2">
                {consumerTab === "storage" ? (
                  freeTier.storage.topClinics.length === 0 ? (
                    <p className="text-xs text-slate-500">
                      No clinics provisioned yet.
                    </p>
                  ) : (
                    freeTier.storage.topClinics.map((c) => (
                      <div
                        key={c._id}
                        className="flex items-center justify-between gap-2 text-xs"
                      >
                        <span className="truncate font-medium text-slate-700">
                          {c.name}
                        </span>
                        <span className="shrink-0 tabular-nums text-slate-500">
                          {formatBytes(c.storageUsedBytes)}
                        </span>
                      </div>
                    ))
                  )
                ) : freeTier.emails.topClinics.length === 0 ? (
                  <p className="text-xs text-slate-500">
                    No clinics provisioned yet.
                  </p>
                ) : (
                  freeTier.emails.topClinics.map((c) => (
                    <div
                      key={c._id}
                      className="flex items-center justify-between gap-2 text-xs"
                    >
                      <span className="truncate font-medium text-slate-700">
                        {c.name}
                      </span>
                      <span className="shrink-0 tabular-nums text-slate-500">
                        {c.currentMonthEmailCount.toLocaleString()} sent
                      </span>
                    </div>
                  ))
                )}
              </div>
            </div>
          </div>
        </section>

        {/* Appointment Outcomes */}
        <section className="flex flex-col rounded-2xl border border-slate-200/80 bg-white p-5">
          <div>
            <h2 className="text-base font-semibold text-slate-950">
              Appointment Outcomes
            </h2>
            <p className="text-xs text-slate-500">
              Completed, cancelled, and no-show visits ({windowDays}d)
            </p>
          </div>

          <div className="mt-4 flex-1">
            {!hasAppointmentSeries ? (
              <div className="flex h-[220px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-[#F8FAFC] px-4 text-center">
                <p className="text-sm font-semibold text-slate-800">
                  No visit outcomes logged yet
                </p>
                <p className="mt-1 text-xs text-slate-500">
                  Daily completed, cancelled, and no-show bars appear once
                  clinics start checking in appointments.
                </p>
              </div>
            ) : (
              <ChartContainer
                config={appointmentsChartConfig}
                className="h-[220px] w-full"
              >
                <BarChart
                  data={dailySeries}
                  margin={{ left: 0, right: 8, top: 8, bottom: 0 }}
                >
                  <CartesianGrid
                    vertical={false}
                    stroke="#E2E8F0"
                    strokeDasharray="3 3"
                  />
                  <XAxis
                    dataKey="dateKey"
                    tickLine={false}
                    axisLine={false}
                    tickMargin={8}
                    tickFormatter={formatShortDateKey}
                  />
                  <YAxis
                    allowDecimals={false}
                    tickLine={false}
                    axisLine={false}
                    width={28}
                  />
                  <ChartTooltip content={<ChartTooltipContent />} />
                  <ChartLegend content={<ChartLegendContent />} />
                  <Bar
                    dataKey="completedAppointments"
                    stackId="a"
                    fill="var(--color-completedAppointments)"
                  />
                  <Bar
                    dataKey="cancelledAppointments"
                    stackId="a"
                    fill="var(--color-cancelledAppointments)"
                  />
                  <Bar
                    dataKey="noShowAppointments"
                    stackId="a"
                    fill="var(--color-noShowAppointments)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ChartContainer>
            )}
          </div>
        </section>

        {/* Renewal Queue */}
        <section className="flex flex-col justify-between rounded-2xl border border-slate-200/80 bg-white p-5">
          <div>
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="flex items-center gap-1.5 text-base font-semibold text-slate-950">
                  {overview.renewalQueue.length > 0 ? (
                    <AlertTriangle className="size-4 text-amber-600" />
                  ) : null}
                  Renewal Queue
                </h2>
                <p className="text-xs text-slate-500">
                  Expiring within 7 days or currently past due
                </p>
              </div>
              <Badge
                variant="outline"
                className={cn(
                  "rounded-full px-2.5 py-0.5 text-xs font-semibold tabular-nums",
                  overview.renewalQueue.length > 0
                    ? "border-amber-200 bg-amber-50 text-amber-900"
                    : "border-slate-200 text-slate-600"
                )}
              >
                {overview.renewalQueue.length}
              </Badge>
            </div>

            <div className="mt-4">
              {overview.renewalQueue.length === 0 ? (
                <div className="flex h-[180px] flex-col items-center justify-center rounded-xl border border-dashed border-slate-200 bg-[#F8FAFC] px-4 text-center">
                  <p className="text-sm font-semibold text-slate-800">
                    All clinics in good standing
                  </p>
                  <p className="mt-1 text-xs text-slate-500">
                    Tenants within 7 days of expiry or in their 3-day grace
                    period will surface here.
                  </p>
                </div>
              ) : (
                <div className="space-y-2.5">
                  {overview.renewalQueue.slice(0, 4).map((clinic) => (
                    <div
                      key={clinic._id}
                      className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-[#F8FAFC] p-3"
                    >
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-950">
                          {clinic.name}
                        </p>
                        <p className="text-xs text-slate-500">
                          {clinic.planName} · Ends{" "}
                          {formatDate(clinic.subscriptionEndsAt)}
                        </p>
                      </div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <ClinicStatusBadge status={clinic.status} />
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busyRenewalId === `ext:${clinic._id}`}
                          onClick={() =>
                            handleQuickExtend(clinic._id, clinic.name)
                          }
                          title="Extend trial/subscription by +7 days"
                          className="h-7 rounded-full border-slate-200 bg-white px-2.5 text-xs font-semibold"
                        >
                          <CalendarPlus className="mr-1 size-3" />
                          +7d
                        </Button>
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={busyRenewalId === `rem:${clinic._id}`}
                          onClick={() =>
                            handleQuickRemind(clinic._id, clinic.name)
                          }
                          title="Send renewal reminder email"
                          className="h-7 rounded-full border-slate-200 bg-white px-2.5 text-xs font-semibold"
                        >
                          <Bell className="mr-1 size-3" />
                          Remind
                        </Button>
                        <Button
                          size="sm"
                          variant="outline"
                          render={
                            <Link
                              href={`/super-admin/billing?renewClinicId=${clinic._id}`}
                            />
                          }
                          className="h-7 rounded-full border-slate-200 bg-white px-3 text-xs font-semibold"
                        >
                          Renew
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          {overview.renewalQueue.length > 4 ? (
            <div className="mt-3 pt-2 text-right">
              <Link
                href="/super-admin/billing"
                className="text-xs font-semibold text-[#6C5CE7] hover:underline"
              >
                View all {overview.renewalQueue.length} renewals →
              </Link>
            </div>
          ) : null}
        </section>
      </div>

      {/* Clinic Leaderboard — Desktop Table + Mobile Card Stack */}
      <section className="rounded-2xl border border-slate-200/80 bg-white p-5">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h2 className="text-base font-semibold text-slate-950">
              Clinic Leaderboard
            </h2>
            <p className="text-xs text-slate-500">
              Ranked by monthly appointment volume, quota usage, and file
              storage
            </p>
          </div>
          <Button
            size="sm"
            variant="outline"
            render={<Link href="/super-admin/clinics" />}
            className="h-8 w-fit rounded-full border-slate-200 px-3.5 text-xs font-semibold"
          >
            Manage All Clinics
          </Button>
        </div>

        <div className="mt-4">
          {leaderboard.length === 0 ? (
            <div className="rounded-xl border border-dashed border-slate-200 bg-[#F8FAFC] px-4 py-10 text-center text-sm text-slate-600">
              No dental clinics provisioned yet. Click{" "}
              <Link
                href="/super-admin/clinics"
                className="font-semibold text-[#6C5CE7] underline underline-offset-4"
              >
                Provision Clinic
              </Link>{" "}
              to onboard your first tenant.
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
                      <TableHead className="text-right">Dentists</TableHead>
                      <TableHead className="text-right">Chairs</TableHead>
                      <TableHead className="text-right">Monthly Appts</TableHead>
                      <TableHead className="text-right">Storage</TableHead>
                      <TableHead className="text-right">
                        Read-Only Inspect
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {leaderboard.map((row) => (
                      <TableRow key={row._id}>
                        <TableCell>
                          <div className="font-semibold text-slate-950">
                            {row.name}
                          </div>
                          <div className="text-xs text-slate-500">
                            <span className="font-mono">/c/{row.slug}</span> ·{" "}
                            {row.city}
                          </div>
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant="secondary"
                            className="rounded-full bg-slate-100 text-slate-700"
                          >
                            {row.planName}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <ClinicStatusBadge status={row.status} />
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          {row.activeDentistCount}/{row.maxDentists}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm">
                          {row.activeChairCount}/{row.maxChairs}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm font-medium">
                          {row.currentMonthAppointmentCount.toLocaleString()}/
                          {row.maxAppointmentsPerMonth.toLocaleString()}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-sm text-slate-600">
                          {formatBytes(row.storageUsedBytes)}
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="inline-flex items-center justify-end gap-1">
                            <Button
                              size="sm"
                              variant="ghost"
                              render={
                                <Link href={`/admin?viewAsClinicId=${row._id}`} />
                              }
                              className="h-7 rounded-full px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                            >
                              Admin
                              <ArrowUpRight className="ml-0.5 size-3" />
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              render={
                                <Link
                                  href={`/front-desk?viewAsClinicId=${row._id}`}
                                />
                              }
                              className="h-7 rounded-full px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                            >
                              Desk
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              render={
                                <Link href={`/staff?viewAsClinicId=${row._id}`} />
                              }
                              className="h-7 rounded-full px-2.5 text-xs font-semibold text-slate-700 hover:bg-slate-100"
                            >
                              Staff
                            </Button>
                          </div>
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Mobile Card Stack */}
              <div className="space-y-3 md:hidden">
                {leaderboard.map((row) => (
                  <div
                    key={row._id}
                    className="rounded-xl border border-slate-200/80 bg-[#F8FAFC] p-3.5"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate text-sm font-semibold text-slate-950">
                          {row.name}
                        </p>
                        <p className="text-xs text-slate-500">
                          <span className="font-mono">/c/{row.slug}</span> ·{" "}
                          {row.city}
                        </p>
                      </div>
                      <ClinicStatusBadge status={row.status} />
                    </div>

                    <div className="mt-3 grid grid-cols-3 gap-2 rounded-lg bg-white p-2.5 text-center border border-slate-200/60">
                      <div>
                        <p className="text-[11px] text-slate-500">Dentists</p>
                        <p className="text-xs font-semibold tabular-nums text-slate-900">
                          {row.activeDentistCount}/{row.maxDentists}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] text-slate-500">Appts</p>
                        <p className="text-xs font-semibold tabular-nums text-slate-900">
                          {row.currentMonthAppointmentCount}/
                          {row.maxAppointmentsPerMonth}
                        </p>
                      </div>
                      <div>
                        <p className="text-[11px] text-slate-500">Storage</p>
                        <p className="text-xs font-semibold tabular-nums text-slate-900">
                          {formatBytes(row.storageUsedBytes)}
                        </p>
                      </div>
                    </div>

                    <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                      <Badge
                        variant="secondary"
                        className="rounded-full bg-white text-[11px] text-slate-700"
                      >
                        {row.planName}
                      </Badge>
                      <div className="flex items-center gap-1.5">
                        <Link
                          href={`/admin?viewAsClinicId=${row._id}`}
                          className="inline-flex h-7 items-center rounded-full border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-700"
                        >
                          Admin
                        </Link>
                        <Link
                          href={`/front-desk?viewAsClinicId=${row._id}`}
                          className="inline-flex h-7 items-center rounded-full border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-700"
                        >
                          Desk
                        </Link>
                        <Link
                          href={`/staff?viewAsClinicId=${row._id}`}
                          className="inline-flex h-7 items-center rounded-full border border-slate-200 bg-white px-2.5 text-[11px] font-semibold text-slate-700"
                        >
                          Staff
                        </Link>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}
