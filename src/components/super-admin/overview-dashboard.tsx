"use client";

import { useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowUpRight,
  Building2,
  CalendarCheck2,
  Coins,
  HardDrive,
  Mail,
  TrendingUp,
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
import { ClinicStatusBadge } from "@/components/super-admin/status-badges";
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
  formatPhp,
  formatShortDateKey,
} from "@/lib/format";
import { api } from "../../../convex/_generated/api";

const mrrChartConfig = {
  mrrPhp: {
    label: "MRR (PHP)",
    color: "var(--chart-1)",
  },
  revenueCollectedTodayPhp: {
    label: "Daily Collected (PHP)",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig;

const planChartConfig = {
  count: {
    label: "Clinics",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

const appointmentsChartConfig = {
  completedAppointments: {
    label: "Completed",
    color: "var(--chart-2)",
  },
  cancelledAppointments: {
    label: "Cancelled",
    color: "var(--chart-3)",
  },
  noShowAppointments: {
    label: "No-Show",
    color: "var(--chart-4)",
  },
} satisfies ChartConfig;

function QuotaBar({
  label,
  valueText,
  percent,
}: {
  label: string;
  valueText: string;
  percent: number;
}) {
  const barColor =
    percent >= 85
      ? "bg-rose-500"
      : percent >= 65
        ? "bg-amber-500"
        : "bg-sky-600 dark:bg-sky-400";

  return (
    <div className="space-y-1.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-foreground">{label}</span>
        <span className="font-mono tabular-nums text-muted-foreground">
          {valueText} ({percent}%)
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
        <div
          className={`h-full rounded-full transition-all ${barColor}`}
          style={{ width: `${Math.min(100, Math.max(percent, 1))}%` }}
        />
      </div>
    </div>
  );
}

export function OverviewDashboard() {
  const [windowDays, setWindowDays] = useState<number>(30);
  const overview = useQuery(api.platformAnalytics.getDashboardOverview, {});
  const dailySeries = useQuery(api.platformAnalytics.getDailyMetricsSeries, {
    days: windowDays,
  });
  const leaderboard = useQuery(api.platformAnalytics.getClinicLeaderboard, {
    limit: 8,
  });
  const freeTier = useQuery(api.platformAnalytics.getFreeTierUsage, {});

  if (
    overview === undefined ||
    dailySeries === undefined ||
    leaderboard === undefined ||
    freeTier === undefined
  ) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <div className="h-4 w-28 animate-pulse rounded bg-muted" />
            </CardHeader>
            <CardContent>
              <div className="h-8 w-36 animate-pulse rounded bg-muted" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header Row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Platform Overview
          </h1>
          <p className="text-sm text-muted-foreground">
            Live SaaS revenue, tenant health, and zero-cost free-tier guardrails.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="outline" render={<Link href="/super-admin/billing" />}>
            Record Payment
          </Button>
          <Button render={<Link href="/super-admin/clinics" />}>
            Provision Clinic
          </Button>
        </div>
      </div>

      {/* Top KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardDescription>Monthly Recurring Revenue</CardDescription>
            <TrendingUp className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="font-mono text-2xl font-semibold tabular-nums">
              {formatPhp(overview.mrrPhp)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              ARR {formatPhp(overview.arrPhp)}
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardDescription>Collected This Month</CardDescription>
            <Coins className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="font-mono text-2xl font-semibold tabular-nums">
              {formatPhp(overview.collectedThisMonthPhp)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Verified paid invoices in ledger
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardDescription>Dental Clinics</CardDescription>
            <Building2 className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="font-mono text-2xl font-semibold tabular-nums">
              {overview.totalClinics}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {overview.activePaidClinics} active · {overview.trialClinics} trial ·{" "}
              {overview.pastDueClinics} past due · {overview.suspendedClinics}{" "}
              suspended
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-2">
            <CardDescription>Appointments (This Month)</CardDescription>
            <CalendarCheck2 className="size-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <p className="font-mono text-2xl font-semibold tabular-nums">
              {overview.currentMonthAppointments.toLocaleString()}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {overview.lifetimeAppointments.toLocaleString()} lifetime across all
              tenants
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Charts Row 1: MRR Trend & Plan Distribution */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle>MRR & Revenue Trend</CardTitle>
              <CardDescription>
                Pre-aggregated daily snapshots from <code>platformMetricsDaily</code>
              </CardDescription>
            </div>
            <div className="flex items-center gap-1 rounded-lg border p-0.5">
              {[14, 30, 90].map((d) => (
                <Button
                  key={d}
                  size="sm"
                  variant={windowDays === d ? "secondary" : "ghost"}
                  className="h-7 px-2.5 text-xs"
                  onClick={() => setWindowDays(d)}
                >
                  {d}d
                </Button>
              ))}
            </div>
          </CardHeader>
          <CardContent>
            <ChartContainer config={mrrChartConfig} className="h-[260px] w-full">
              <AreaChart
                data={dailySeries}
                margin={{ left: 8, right: 8, top: 8, bottom: 0 }}
              >
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
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
                  fillOpacity={0.18}
                  strokeWidth={2}
                />
                <Area
                  type="monotone"
                  dataKey="revenueCollectedTodayPhp"
                  stroke="var(--color-revenueCollectedTodayPhp)"
                  fill="var(--color-revenueCollectedTodayPhp)"
                  fillOpacity={0.12}
                  strokeWidth={2}
                />
              </AreaChart>
            </ChartContainer>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Clinics by Plan</CardTitle>
            <CardDescription>Tenant distribution across tiers</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer config={planChartConfig} className="h-[260px] w-full">
              <BarChart
                data={overview.planDistribution}
                margin={{ left: 0, right: 8, top: 8, bottom: 0 }}
              >
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
                <XAxis
                  dataKey="name"
                  tickLine={false}
                  axisLine={false}
                  tickMargin={8}
                />
                <YAxis
                  allowDecimals={false}
                  tickLine={false}
                  axisLine={false}
                  width={32}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <Bar
                  dataKey="count"
                  fill="var(--color-count)"
                  radius={[6, 6, 0, 0]}
                />
              </BarChart>
            </ChartContainer>
          </CardContent>
        </Card>
      </div>

      {/* Row 2: Free-Tier Gauges, Appointment Outcomes, and Renewal Queue */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <HardDrive className="size-4 text-muted-foreground" />
              Free-Tier Resource Gauges
            </CardTitle>
            <CardDescription>
              Keep total platform usage safely under $0/mo provider ceilings.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <QuotaBar
              label="Convex File Storage (X-Rays & Receipts)"
              valueText={`${formatBytes(freeTier.storage.usedBytes)} / ${formatBytes(freeTier.storage.limitBytes)}`}
              percent={freeTier.storage.percentUsed}
            />
            <QuotaBar
              label="Resend Monthly Email Pool"
              valueText={`${freeTier.emails.sentThisMonth.toLocaleString()} / ${freeTier.emails.monthlyLimit.toLocaleString()}`}
              percent={freeTier.emails.percentUsed}
            />

            <div className="space-y-2 border-t pt-3">
              <p className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Mail className="size-3.5" /> Top Storage Consumers
              </p>
              {freeTier.storage.topClinics.length === 0 ? (
                <p className="text-xs text-muted-foreground">
                  No clinics provisioned yet.
                </p>
              ) : (
                <div className="space-y-1.5">
                  {freeTier.storage.topClinics.map((c) => (
                    <div
                      key={c._id}
                      className="flex items-center justify-between text-xs"
                    >
                      <span className="truncate pr-2">{c.name}</span>
                      <span className="font-mono tabular-nums text-muted-foreground">
                        {formatBytes(c.storageUsedBytes)}
                      </span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Appointment Outcomes</CardTitle>
            <CardDescription>Completed, cancelled, and no-show trend</CardDescription>
          </CardHeader>
          <CardContent>
            <ChartContainer
              config={appointmentsChartConfig}
              className="h-[230px] w-full"
            >
              <BarChart
                data={dailySeries}
                margin={{ left: 0, right: 8, top: 8, bottom: 0 }}
              >
                <CartesianGrid vertical={false} strokeDasharray="3 3" />
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
                  width={32}
                />
                <ChartTooltip content={<ChartTooltipContent />} />
                <ChartLegend content={<ChartLegendContent />} />
                <Bar
                  dataKey="completedAppointments"
                  stackId="a"
                  fill="var(--color-completedAppointments)"
                  radius={[0, 0, 0, 0]}
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
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle className="flex items-center gap-2">
                <AlertTriangle className="size-4 text-amber-600" />
                Renewal Queue
              </CardTitle>
              <CardDescription>
                Expiring within 7 days or currently past due
              </CardDescription>
            </div>
            <Badge variant="outline">{overview.renewalQueue.length}</Badge>
          </CardHeader>
          <CardContent>
            {overview.renewalQueue.length === 0 ? (
              <p className="py-6 text-center text-xs text-muted-foreground">
                All active clinics are in good standing.
              </p>
            ) : (
              <div className="space-y-3">
                {overview.renewalQueue.slice(0, 5).map((clinic) => (
                  <div
                    key={clinic._id}
                    className="flex items-center justify-between gap-2 rounded-lg border p-2.5"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">{clinic.name}</p>
                      <p className="text-xs text-muted-foreground">
                        {clinic.planName} · Ends {formatDate(clinic.subscriptionEndsAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <ClinicStatusBadge status={clinic.status} />
                      <Button
                        size="sm"
                        variant="outline"
                        render={<Link href="/super-admin/billing" />}
                      >
                        Renew
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      {/* Clinic Leaderboard */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <div>
            <CardTitle>Clinic Leaderboard</CardTitle>
            <CardDescription>
              Ranked by monthly appointment volume, quota usage, and storage.
            </CardDescription>
          </div>
          <Button
            size="sm"
            variant="outline"
            render={<Link href="/super-admin/clinics" />}
          >
            Manage All Clinics
          </Button>
        </CardHeader>
        <CardContent>
          {leaderboard.length === 0 ? (
            <div className="rounded-lg border border-dashed py-10 text-center text-sm text-muted-foreground">
              No dental clinics provisioned yet. Click{" "}
              <Link
                href="/super-admin/clinics"
                className="font-medium text-foreground underline underline-offset-4"
              >
                Provision Clinic
              </Link>{" "}
              to onboard your first tenant.
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Clinic</TableHead>
                  <TableHead>Plan</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Dentists</TableHead>
                  <TableHead className="text-right">Chairs</TableHead>
                  <TableHead className="text-right">Monthly Appts</TableHead>
                  <TableHead className="text-right">Storage</TableHead>
                  <TableHead className="text-right">Inspect</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {leaderboard.map((row) => (
                  <TableRow key={row._id}>
                    <TableCell>
                      <div className="font-medium">{row.name}</div>
                      <div className="text-xs text-muted-foreground">
                        /c/{row.slug} · {row.city}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{row.planName}</Badge>
                    </TableCell>
                    <TableCell>
                      <ClinicStatusBadge status={row.status} />
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {row.activeDentistCount}/{row.maxDentists}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {row.activeChairCount}/{row.maxChairs}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {row.currentMonthAppointmentCount.toLocaleString()}/
                      {row.maxAppointmentsPerMonth.toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-mono tabular-nums">
                      {formatBytes(row.storageUsedBytes)}
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        size="sm"
                        variant="ghost"
                        render={<Link href={`/admin?viewAsClinicId=${row._id}`} />}
                      >
                        View As
                        <ArrowUpRight className="ml-1 size-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
