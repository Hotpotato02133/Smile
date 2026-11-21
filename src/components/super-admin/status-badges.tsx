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
  { label: string; className: string; dotClass: string }
> = {
  active: {
    label: "Active",
    className: "border-emerald-200/80 bg-emerald-50 text-emerald-800",
    dotClass: "bg-emerald-500",
  },
  trial: {
    label: "Trial",
    className: "border-sky-200/80 bg-[#EEF7FD] text-sky-900",
    dotClass: "bg-sky-500",
  },
  past_due: {
    label: "Past Due",
    className: "border-amber-200/80 bg-amber-50 text-amber-900",
    dotClass: "bg-amber-500",
  },
  suspended: {
    label: "Suspended",
    className: "border-rose-200/80 bg-rose-50 text-rose-800",
    dotClass: "bg-rose-500",
  },
  archived: {
    label: "Archived",
    className: "border-slate-200 bg-slate-100 text-slate-600",
    dotClass: "bg-slate-400",
  },
};

const PAYMENT_STATUS_STYLE: Record<
  PaymentStatus,
  { label: string; className: string; dotClass: string }
> = {
  paid: {
    label: "Paid",
    className: "border-emerald-200/80 bg-emerald-50 text-emerald-800",
    dotClass: "bg-emerald-500",
  },
  pending: {
    label: "Pending",
    className: "border-amber-200/80 bg-amber-50 text-amber-900",
    dotClass: "bg-amber-500",
  },
  overdue: {
    label: "Overdue",
    className: "border-rose-200/80 bg-rose-50 text-rose-800",
    dotClass: "bg-rose-500",
  },
  refunded: {
    label: "Refunded",
    className: "border-slate-200 bg-slate-100 text-slate-600",
    dotClass: "bg-slate-400",
  },
};

const SEVERITY_STYLE: Record<
  AnnouncementSeverity,
  { label: string; className: string }
> = {
  info: {
    label: "Info",
    className: "border-sky-200/80 bg-[#EEF7FD] text-sky-900",
  },
  warning: {
    label: "Warning",
    className: "border-amber-200/80 bg-amber-50 text-amber-900",
  },
  critical: {
    label: "Critical",
    className: "border-rose-200/80 bg-rose-50 text-rose-800",
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
    <Badge
      variant="outline"
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${cfg.className}`}
    >
      <span className={`size-1.5 rounded-full ${cfg.dotClass}`} aria-hidden="true" />
      {cfg.label}
    </Badge>
  );
}

export function PaymentStatusBadge({ status }: { status: PaymentStatus }) {
  const cfg = PAYMENT_STATUS_STYLE[status];
  return (
    <Badge
      variant="outline"
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${cfg.className}`}
    >
      <span className={`size-1.5 rounded-full ${cfg.dotClass}`} aria-hidden="true" />
      {cfg.label}
    </Badge>
  );
}

export function SeverityBadge({ severity }: { severity: AnnouncementSeverity }) {
  const cfg = SEVERITY_STYLE[severity];
  return (
    <Badge
      variant="outline"
      className={`rounded-full px-2.5 py-0.5 text-[11px] font-semibold ${cfg.className}`}
    >
      {cfg.label}
    </Badge>
  );
}
