"use client";

import { useQuery } from "convex/react";
import {
  Armchair,
  ArrowRight,
  BriefcaseMedical,
  CalendarCheck2,
  CheckCircle2,
  Circle,
  ExternalLink,
  HardDrive,
  Mail,
  Stethoscope,
} from "lucide-react";
import Link from "next/link";
import { useClinicAdminContext } from "@/components/clinic-admin/clinic-admin-shell";
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
import { formatBytes, formatDate } from "@/lib/format";
import { api } from "../../../convex/_generated/api";

function QuotaCard({
  title,
  used,
  limit,
  usedLabel,
  limitLabel,
  icon: Icon,
  href,
}: {
  title: string;
  used: number;
  limit: number;
  usedLabel: string;
  limitLabel: string;
  icon: React.ComponentType<{ className?: string }>;
  href?: string;
}) {
  const pct = limit > 0 ? Math.min(100, Math.round((used / limit) * 100)) : 0;
  const barColor =
    pct >= 90
      ? "bg-rose-500"
      : pct >= 70
        ? "bg-amber-500"
        : "bg-sky-600 dark:bg-sky-400";

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardDescription>{title}</CardDescription>
        <Icon className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent className="space-y-2.5">
        <div className="flex items-baseline justify-between">
          <p className="font-mono text-2xl font-semibold tabular-nums">
            {usedLabel}
          </p>
          <span className="font-mono text-xs text-muted-foreground">
            / {limitLabel}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full transition-all ${barColor}`}
            style={{ width: `${Math.max(pct, used > 0 ? 4 : 0)}%` }}
          />
        </div>
        {href ? (
          <Link
            href={href}
            className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            Manage <ArrowRight className="size-3" />
          </Link>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function ClinicOverview() {
  const { overrideClinicId, buildHref } = useClinicAdminContext();
  const workspace = useQuery(api.clinicAdmin.getClinicWorkspace, {
    overrideClinicId,
  });

  if (workspace === undefined) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i}>
            <CardHeader className="pb-2">
              <div className="h-4 w-24 animate-pulse rounded bg-muted" />
            </CardHeader>
            <CardContent>
              <div className="h-8 w-32 animate-pulse rounded bg-muted" />
            </CardContent>
          </Card>
        ))}
      </div>
    );
  }

  const { clinic, plan, counts } = workspace;

  const setupSteps = [
    {
      label: "Configure at least 1 active Operatory Chair",
      done: counts.activeChairs > 0,
      href: buildHref("/admin/chairs"),
      detail: `${counts.activeChairs} active`,
    },
    {
      label: "Add at least 1 Dentist & weekly shift schedule",
      done: counts.activeDentists > 0,
      href: buildHref("/admin/dentists"),
      detail: `${counts.activeDentists} active`,
    },
    {
      label: "Review Dental Services catalog & sterilization buffers",
      done: counts.activeServices > 0,
      href: buildHref("/admin/services"),
      detail: `${counts.activeServices} active`,
    },
    {
      label: "Confirm clinic operating hours & cancellation window",
      done: clinic.operatingHours.some((d) => d.isOpen),
      href: buildHref("/admin/settings"),
      detail: `${clinic.slotIntervalMinutes}-min intervals`,
    },
  ];

  const completedSteps = setupSteps.filter((s) => s.done).length;

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-2xl font-semibold tracking-tight">
              {clinic.name}
            </h1>
            <ClinicStatusBadge status={clinic.status} />
            {plan ? <Badge variant="secondary">{plan.name}</Badge> : null}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            {clinic.address}, {clinic.city}, {clinic.province} · Subscription
            valid until {formatDate(clinic.subscriptionEndsAt)}
          </p>
        </div>

        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            render={<Link href={`/c/${clinic.slug}`} />}
          >
            Public Booking Portal
            <ExternalLink className="ml-1.5 size-3.5" />
          </Button>
          <Button render={<Link href={buildHref("/admin/dentists")} />}>
            Manage Dentists
          </Button>
        </div>
      </div>

      {/* Plan Quota Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <QuotaCard
          title="Active Dentists"
          used={clinic.activeDentistCount}
          limit={plan?.maxDentists ?? 0}
          usedLabel={String(clinic.activeDentistCount)}
          limitLabel={String(plan?.maxDentists ?? 0)}
          icon={Stethoscope}
          href={buildHref("/admin/dentists")}
        />
        <QuotaCard
          title="Operatory Chairs"
          used={clinic.activeChairCount}
          limit={plan?.maxChairs ?? 0}
          usedLabel={String(clinic.activeChairCount)}
          limitLabel={String(plan?.maxChairs ?? 0)}
          icon={Armchair}
          href={buildHref("/admin/chairs")}
        />
        <QuotaCard
          title="Monthly Appointments"
          used={clinic.currentMonthAppointmentCount}
          limit={plan?.maxAppointmentsPerMonth ?? 0}
          usedLabel={clinic.currentMonthAppointmentCount.toLocaleString()}
          limitLabel={(plan?.maxAppointmentsPerMonth ?? 0).toLocaleString()}
          icon={CalendarCheck2}
          href={buildHref("/admin/reports")}
        />
        <QuotaCard
          title="X-Ray & File Storage"
          used={clinic.storageUsedBytes}
          limit={plan?.maxStorageBytes ?? 0}
          usedLabel={formatBytes(clinic.storageUsedBytes)}
          limitLabel={formatBytes(plan?.maxStorageBytes ?? 0)}
          icon={HardDrive}
        />
        <QuotaCard
          title="Monthly Emails"
          used={clinic.currentMonthEmailCount}
          limit={plan?.maxEmailsPerMonth ?? 0}
          usedLabel={clinic.currentMonthEmailCount.toLocaleString()}
          limitLabel={(plan?.maxEmailsPerMonth ?? 0).toLocaleString()}
          icon={Mail}
        />
      </div>

      {/* Readiness & Feature Entitlements */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader className="flex flex-row items-center justify-between">
            <div>
              <CardTitle>Clinic Scheduling Readiness</CardTitle>
              <CardDescription>
                Complete these items so dual-resource (Dentist + Chair) online
                booking works on <code>/c/{clinic.slug}</code>.
              </CardDescription>
            </div>
            <Badge variant="outline">
              {completedSteps}/{setupSteps.length} ready
            </Badge>
          </CardHeader>
          <CardContent className="space-y-2.5">
            {setupSteps.map((step) => (
              <Link
                key={step.label}
                href={step.href}
                className="flex items-center justify-between gap-3 rounded-lg border p-3 transition-colors hover:bg-muted/50"
              >
                <div className="flex items-center gap-3">
                  {step.done ? (
                    <CheckCircle2 className="size-4 shrink-0 text-emerald-600 dark:text-emerald-400" />
                  ) : (
                    <Circle className="size-4 shrink-0 text-muted-foreground" />
                  )}
                  <span className="text-sm font-medium">{step.label}</span>
                </div>
                <span className="text-xs text-muted-foreground">
                  {step.detail}
                </span>
              </Link>
            ))}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <BriefcaseMedical className="size-4 text-muted-foreground" />
              Enabled Plan Features
            </CardTitle>
            <CardDescription>
              Feature entitlements active for your clinic
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            {(
              [
                ["odontogramEnabled", "32-Tooth SVG Odontogram"],
                ["xrayStorageEnabled", "X-Ray & Photo Vault"],
                ["waitlistAutomationEnabled", "Waitlist Cancellation Blast"],
                ["recallAutomationEnabled", "6-Month Hygiene Recall"],
                ["customBrandingEnabled", "Custom Branding & Logo"],
              ] as const
            ).map(([key, label]) => {
              const enabled = clinic.featureFlags[key];
              return (
                <div
                  key={key}
                  className="flex items-center justify-between rounded-md border px-3 py-2 text-xs"
                >
                  <span>{label}</span>
                  <Badge variant={enabled ? "secondary" : "outline"}>
                    {enabled ? "Included" : "Upgrade"}
                  </Badge>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
