"use client";

import { Badge } from "@/components/ui/badge";

export type ClinicStatus =
  | "trial"
  | "active"
  | "past_due"
  | "suspended"
  | "archived";

export type PaymentStatus = "paid" | "pending" | "overdue" | "refunded";

export type PaymentMethod =
  | "gcash"
  | "maya"
  | "bank_transfer"
  | "card"
  | "cash"
  | "manual_waiver";

export type AnnouncementSeverity = "info" | "warning" | "critical";

const CLINIC_STATUS_STYLE: Record<
  ClinicStatus,
  { label: string; className: string }
> = {
  active: {
    label: "Active",
    className:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  trial: {
    label: "Trial",
    className:
      "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  past_due: {
    label: "Past Due",
    className:
      "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  },
  suspended: {
    label: "Suspended",
    className:
      "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  },
  archived: {
    label: "Archived",
    className: "border-border bg-muted text-muted-foreground",
  },
};

const PAYMENT_STATUS_STYLE: Record<
  PaymentStatus,
  { label: string; className: string }
> = {
  paid: {
    label: "Paid",
    className:
      "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300",
  },
  pending: {
    label: "Pending",
    className:
      "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  },
  overdue: {
    label: "Overdue",
    className:
      "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  },
  refunded: {
    label: "Refunded",
    className: "border-border bg-muted text-muted-foreground",
  },
};

const SEVERITY_STYLE: Record<
  AnnouncementSeverity,
  { label: string; className: string }
> = {
  info: {
    label: "Info",
    className:
      "border-sky-500/30 bg-sky-500/10 text-sky-700 dark:text-sky-300",
  },
  warning: {
    label: "Warning",
    className:
      "border-amber-500/30 bg-amber-500/10 text-amber-800 dark:text-amber-300",
  },
  critical: {
    label: "Critical",
    className:
      "border-rose-500/30 bg-rose-500/10 text-rose-700 dark:text-rose-300",
  },
};

export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  gcash: "GCash",
  maya: "Maya",
  bank_transfer: "Bank Transfer",
  card: "Card",
  cash: "Cash",
  manual_waiver: "Manual Waiver",
};

export function ClinicStatusBadge({ status }: { status: ClinicStatus }) {
  const cfg = CLINIC_STATUS_STYLE[status];
  return (
    <Badge variant="outline" className={cfg.className}>
      {cfg.label}
    </Badge>
  );
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const cfg = PAYMENT_STATUS_STYLE[status];
  return (
    <Badge variant="outline" className={cfg.className}>
      {cfg.label}
    </Badge>
  );
}

export function SeverityBadge({ severity }: { severity: AnnouncementSeverity }) {
  const cfg = SEVERITY_STYLE[severity];
  return (
    <Badge variant="outline" className={cfg.className}>
      {cfg.label}
    </Badge>
  );
}
