"use client";

import { useQuery } from "@/lib/api";
import { useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  XAxis,
  YAxis,
} from "recharts";
import { useClinicAdminContext } from "@/components/clinic-admin/clinic-admin-shell";
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
import { formatPhp, formatShortDateKey } from "@/lib/format";
import { api } from "@/lib/api";

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

const utilizationChartConfig = {
  utilizationPct: {
    label: "Utilization (%)",
    color: "var(--chart-2)",
  },
} satisfies ChartConfig;

function formatHours(minutes: number): string {
  const hrs = minutes / 60;
  return `${hrs >= 10 ? Math.round(hrs) : hrs.toFixed(1)}h`;
}

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

  const {
    rows,
    totals,
    rates,
    includesLiveToday,
    timeZone,
    topServices,
    dentistUtilization,
  } = metrics;

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              Clinic Performance Reports
            </h1>
            {includesLiveToday ? (
              <Badge variant="secondary" className="text-[11px]">
                Includes Live Today
              </Badge>
            ) : null}
          </div>
          <p className="text-sm text-muted-foreground">
            Daily metrics from <code>clinicMetricsDaily</code> with top dental
            services and dentist shift utilization ({timeZone}).
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
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
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
              {rates.completionRate}%
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {totals.completedCount.toLocaleString()} completed visits
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>No-Show Rate</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-2xl font-semibold tabular-nums">
              {rates.noShowRate}%
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {totals.noShowCount.toLocaleString()} no-show(s)
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Cancellations</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-2xl font-semibold tabular-nums">
              {totals.cancelledCount.toLocaleString()}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {rates.cancellationRate}% cancellation rate
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Estimated Revenue ({days}d)</CardDescription>
          </CardHeader>
          <CardContent>
            <p className="font-mono text-2xl font-semibold tabular-nums">
              {formatPhp(totals.estimatedRevenuePhp)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              Completed service prices
            </p>
          </CardContent>
        </Card>
      </div>

      {/* Daily Trend Charts */}
      {rows.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center text-sm text-muted-foreground">
            No appointment activity recorded yet for the last {days} days. Daily
            charts populate automatically from <code>clinicMetricsDaily</code>{" "}
            and live same-day bookings.
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle>Estimated Revenue Trend</CardTitle>
              <CardDescription>
                Daily PHP production over {days} days
              </CardDescription>
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
              <CardDescription>
                Completed, cancelled, and no-show breakdown
              </CardDescription>
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

      {/* Top Services & Dentist Utilization */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Top Dental Services ({days}d)</CardTitle>
            <CardDescription>
              Ranked by estimated completed PHP production and booking share.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {topServices.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                No service bookings recorded in the last {days} days.
              </p>
            ) : (
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Procedure</TableHead>
                      <TableHead className="text-right">Booked</TableHead>
                      <TableHead className="text-right">Done</TableHead>
                      <TableHead className="text-right">Est. Revenue</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {topServices.map((svc) => (
                      <TableRow key={svc.serviceId}>
                        <TableCell>
                          <div className="font-medium">{svc.name}</div>
                          <div className="mt-1 flex items-center gap-2">
                            <Badge
                              variant="secondary"
                              className="text-[10px]"
                            >
                              {svc.category}
                            </Badge>
                            <span className="font-mono text-[11px] text-muted-foreground">
                              {svc.sharePct}% share
                            </span>
                          </div>
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          {svc.bookingCount}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs tabular-nums">
                          {svc.completedCount}
                        </TableCell>
                        <TableCell className="text-right font-mono text-xs font-semibold tabular-nums">
                          {formatPhp(svc.estimatedRevenuePhp)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Dentist Shift Utilization ({days}d)</CardTitle>
            <CardDescription>
              Booked clinical hours vs. scheduled shift capacity (net of lunch
              breaks and time off).
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {dentistUtilization.length === 0 ? (
              <p className="py-8 text-center text-sm text-muted-foreground">
                Add active dentists with weekly shifts to track utilization.
              </p>
            ) : (
              <>
                <ChartContainer
                  config={utilizationChartConfig}
                  className="h-[190px] w-full"
                >
                  <BarChart
                    data={dentistUtilization}
                    layout="vertical"
                    margin={{ left: 4, right: 16, top: 4, bottom: 4 }}
                  >
                    <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                    <XAxis
                      type="number"
                      domain={[0, 100]}
                      tickLine={false}
                      axisLine={false}
                      tickFormatter={(v) => `${v}%`}
                    />
                    <YAxis
                      type="category"
                      dataKey="displayName"
                      width={120}
                      tickLine={false}
                      axisLine={false}
                      tick={{ fontSize: 11 }}
                    />
                    <ChartTooltip content={<ChartTooltipContent />} />
                    <Bar dataKey="utilizationPct" radius={[0, 4, 4, 0]}>
                      {dentistUtilization.map((d) => (
                        <Cell
                          key={d.dentistId}
                          fill={d.calendarColorHex || "var(--chart-2)"}
                        />
                      ))}
                    </Bar>
                  </BarChart>
                </ChartContainer>

                <div className="overflow-x-auto">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>Dentist</TableHead>
                        <TableHead className="text-right">Hours</TableHead>
                        <TableHead className="text-right">Util %</TableHead>
                        <TableHead className="text-right">Visits</TableHead>
                        <TableHead className="text-right">Production</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {dentistUtilization.map((d) => (
                        <TableRow key={d.dentistId}>
                          <TableCell className="font-medium">
                            <div className="flex items-center gap-2">
                              <span
                                className="size-2.5 shrink-0 rounded-full"
                                style={{ backgroundColor: d.calendarColorHex }}
                              />
                              <span className="truncate">{d.displayName}</span>
                            </div>
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs text-muted-foreground tabular-nums">
                            {formatHours(d.bookedMinutes)} /{" "}
                            {formatHours(d.scheduledMinutes)}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs font-semibold tabular-nums">
                            {d.utilizationPct}%
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs tabular-nums">
                            {d.completedAppointments}/{d.bookedAppointments}
                          </TableCell>
                          <TableCell className="text-right font-mono text-xs font-semibold tabular-nums">
                            {formatPhp(d.estimatedRevenuePhp)}
                          </TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              </>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
