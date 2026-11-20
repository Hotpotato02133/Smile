"use client";

import { useMutation } from "convex/react";
import { useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  BellRing,
  Calendar,
  Clock3,
  Trash2,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import { formatShortDateKey, getErrorMessage } from "@/lib/format";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import type { PatientDashboardData } from "@/components/patient/types";

interface WaitlistViewProps {
  data: PatientDashboardData;
}

const WAITLIST_BADGE: Record<
  string,
  { label: string; className: string }
> = {
  notified: {
    label: "Slot Opened — Action Needed",
    className: "bg-[#6C5CE7] text-white",
  },
  waiting: {
    label: "Standing By",
    className: "bg-[#EEF7FD] text-sky-900",
  },
  claimed: {
    label: "Claimed",
    className: "bg-emerald-50 text-emerald-800",
  },
  expired: {
    label: "Withdrawn / Expired",
    className: "bg-slate-100 text-slate-600",
  },
};

export function WaitlistView({ data }: WaitlistViewProps) {
  const leaveWaitlist = useMutation(api.patientPortal.leaveWaitlist);
  const [withdrawingId, setWithdrawingId] = useState<Id<"waitlist"> | null>(
    null
  );

  const handleWithdraw = async (waitlistId: Id<"waitlist">) => {
    setWithdrawingId(waitlistId);
    try {
      await leaveWaitlist({ waitlistId });
      toast.success("Waitlist request removed.");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not update waitlist entry."));
    } finally {
      setWithdrawingId(null);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-[-0.025em] text-slate-950">
            Standby Waitlist
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            When a booked day is full at a Smile Pro clinic, join standby to get
            notified the instant another patient cancels.
          </p>
        </div>
        <Link
          href="/clinics"
          className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full bg-slate-950 px-5 text-sm font-semibold text-white transition-colors hover:bg-[#6C5CE7]"
        >
          <span>Browse Clinics</span>
          <ArrowUpRight className="size-4" aria-hidden="true" />
        </Link>
      </div>

      {data.waitlist.length === 0 ? (
        <div className="rounded-[24px] border border-slate-200/80 bg-white px-6 py-12 text-center">
          <span className="mx-auto inline-flex size-11 items-center justify-center rounded-2xl bg-[#EEF7FD] text-[#6C5CE7]">
            <BellRing className="size-5" aria-hidden="true" />
          </span>
          <h2 className="mt-4 font-heading text-base font-bold text-slate-950">
            No active waitlist alerts
          </h2>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-slate-600">
            If your preferred dentist or day is fully booked on a clinic&apos;s
            booking page, tap &ldquo;Join Standby Waitlist&rdquo; and we will
            alert you right here and by email when an opening appears.
          </p>
        </div>
      ) : (
        <div className="space-y-3">
          {data.waitlist.map((entry) => {
            const badge = WAITLIST_BADGE[entry.status] ?? {
              label: entry.status,
              className: "bg-slate-100 text-slate-700",
            };
            const isNotified = entry.status === "notified";
            const canWithdraw =
              entry.status === "waiting" || entry.status === "notified";

            return (
              <div
                key={entry._id}
                className={cn(
                  "flex flex-col gap-4 rounded-[24px] border p-5 sm:flex-row sm:items-center sm:justify-between",
                  isNotified
                    ? "border-[#6C5CE7]/40 bg-[#F5F3FF]"
                    : "border-slate-200/80 bg-white"
                )}
              >
                <div className="space-y-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "rounded-full px-3 py-0.5 text-xs font-semibold",
                        badge.className
                      )}
                    >
                      {badge.label}
                    </span>
                    <span className="text-xs font-medium text-slate-500">
                      For {entry.patientName}
                    </span>
                  </div>
                  <h2 className="font-heading text-base font-bold text-slate-950">
                    {entry.serviceName} · {entry.clinicName}
                  </h2>
                  <div className="flex flex-wrap items-center gap-4 text-xs text-slate-600">
                    <span className="inline-flex items-center gap-1.5">
                      <Calendar className="size-3.5 text-[#6C5CE7]" aria-hidden="true" />
                      Target date: {formatShortDateKey(entry.preferredDateKey)} (
                      {entry.preferredDateKey})
                    </span>
                    <span className="inline-flex items-center gap-1.5 capitalize">
                      <Clock3 className="size-3.5 text-[#6C5CE7]" aria-hidden="true" />
                      {entry.preferredTimeWindow} preference
                    </span>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {isNotified ? (
                    <Link
                      href={`/c/${entry.clinicSlug}`}
                      className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#6C5CE7] px-4 text-xs font-semibold text-white transition-colors hover:bg-[#5B4BD6]"
                    >
                      <span>Claim Open Slot</span>
                      <ArrowUpRight className="size-3.5" aria-hidden="true" />
                    </Link>
                  ) : null}

                  {canWithdraw ? (
                    <button
                      type="button"
                      disabled={withdrawingId === entry._id}
                      onClick={() => handleWithdraw(entry._id)}
                      className="inline-flex h-9 items-center gap-1.5 rounded-full bg-white px-3.5 text-xs font-semibold text-slate-700 border border-slate-200 hover:bg-rose-50 hover:text-rose-700 hover:border-rose-200 disabled:opacity-50 cursor-pointer"
                    >
                      <Trash2 className="size-3.5" aria-hidden="true" />
                      <span>
                        {withdrawingId === entry._id ? "Removing…" : "Leave"}
                      </span>
                    </button>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
