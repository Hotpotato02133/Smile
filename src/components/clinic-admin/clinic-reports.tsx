"use client";

import { useQuery } from "convex/react";
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
import { useClinicAdminContext } from "@/components/clinic-admin/clinic-admin-shell";
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
import { formatPhp, formatShortDateKey } from "@/lib/format";
import { api } from "../../../convex/_generated/api";

const outcomesChartConfig = {
  completedCount: {
    label: "Completed",
    color: "var(--chart-2)",
  },
  cancelledCount: {
    label: "Cancelled",
    color: "var(--chart-3)",
  },
  noShowCount: {
    label: "No-Show",
    color: "var(--chart-4)",
  },
} satisfies ChartConfig;

const revenueChartConfig = {
  estimatedRevenuePhp: {
    label: "Estimated Revenue (PHP)",
    color: "var(--chart-1)",
  },
} satisfies ChartConfig;

export function ClinicReports() {
  const { overrideClinicId } = useClinicAdminContext();
  const [days, setDays] = useState(30);

  const metrics = useQuery(api.clinicAdmin.getClinicDailyMetrics, {
    overrideClinicId,
    days,
  });

  if (metrics === undefined) {
    return (
      <p className="text-sm text-muted-foreground">Loading clinic reports…</p>
    );
  }

  const { rows, totals } = metrics;
  const completionRate =
    totals.totalBooked > 0
      ? Math.round((totals.completedCount / totals.totalBooked) * 100)
      : 0;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Clinic Performance Reports
          </h1>
          <p className="text-sm text-muted-foreground">
            Pre-aggregated daily clinic metrics from{" "}
            <code>clinicMetricsDaily</code>.
          </p>
        </div>

        <div className="flex items-center gap-1 rounded-lg border p-0.5">
          {[14, 30, 90].map((d) => (
            <Button
              key={d}
              size="sm"
              variant={days === d ? "secondary" : "ghost"}
              className="h-7 px-2.5 text-xs"
              onClick={() => setDays(d)}
            >
              {d}d
            </Button>
          ))}
        </div>
      </div>

      {/* KPI Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Total Booked ({days}d)</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-2xl font-semibold tabular-nums">
              {totals.totalBooked.toLocaleString()}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {totals.newPatientsCount} new patient(s)
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Completion Rate</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-2xl font-semibold tabular-nums">
              {completionRate}%
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {totals.completedCount.toLocaleString()} completed visits
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Cancellations & No-Shows</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-2xl font-semibold tabular-nums">
              {totals.cancelledCount + totals.noShowCount}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {totals.cancelledCount} cancelled · {totals.noShowCount} no-show
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Estimated Production ({days}d)</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-2xl font-semibold tabular-nums">
              {formatPhp(totals.estimatedRevenuePhp)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Based on completed service prices
            </p>
          </CardContent>
        </Card>
      </div>

      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No daily metric snapshots recorded yet for the last {days} days.
            Snapshots populate automatically as appointments are booked and the
            daily rollup cron runs.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Estimated Revenue Trend</CardTitle>
              <CardDescription>Daily PHP production over {days} days</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer
                config={revenueChartConfig}
                className="h-[260px] w-full"
              >
                <AreaChart
                  data={rows}
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
                  <Area
                    type="monotone"
                    dataKey="estimatedRevenuePhp"
                    stroke="var(--color-estimatedRevenuePhp)"
                    fill="var(--color-estimatedRevenuePhp)"
                    fillOpacity={0.18}
                    strokeWidth={2}
                  />
                </AreaChart>
              </ChartContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Appointment Outcomes</CardTitle>
              <CardDescription>Completed, cancelled, and no-show breakdown</CardDescription>
            </CardHeader>
            <CardContent>
              <ChartContainer
                config={outcomesChartConfig}
                className="h-[260px] w-full"
              >
                <BarChart
                  data={rows}
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
                    dataKey="completedCount"
                    stackId="a"
                    fill="var(--color-completedCount)"
                  />
                  <Bar
                    dataKey="cancelledCount"
                    stackId="a"
                    fill="var(--color-cancelledCount)"
                  />
                  <Bar
                    dataKey="noShowCount"
                    stackId="a"
                    fill="var(--color-noShowCount)"
                    radius={[4, 4, 0, 0]}
                  />
                </BarChart>
              </ChartContainer>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}
