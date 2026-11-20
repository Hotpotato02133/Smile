"use client";

import { useMutation } from "convex/react";
import { useMemo, useState } from "react";
import Link from "next/link";
import {
  ArrowUpRight,
  Calendar,
  CalendarPlus,
  ClipboardList,
  Download,
  MapPin,
  Phone,
  Search,
  Stethoscope,
  XCircle,
} from "lucide-react";
import { toast } from "sonner";
import { cn } from "cn";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { buildGoogleCalendarUrl, downloadIcsFile } from "@/lib/calendar-export";
import { formatDateTime, formatPhp, getErrorMessage } from "@/lib/format";
import { api } from "../../../convex/_generated/api";
import {
  APPT_STATUS_META,
  type PatientAppointmentItem,
  type PatientDashboardData,
} from "@/components/patient/types";

interface AppointmentsViewProps {
  data: PatientDashboardData;
}

export function AppointmentsView({ data }: AppointmentsViewProps) {
  const cancelAppointment = useMutation(api.publicBooking.cancelMyAppointment);

  const [tab, setTab] = useState<"upcoming" | "history">("upcoming");
  const [selectedPatientFilter, setSelectedPatientFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [cancelTarget, setCancelTarget] = useState<PatientAppointmentItem | null>(
    null
  );
  const [cancelReason, setCancelReason] = useState("");
  const [submittingCancel, setSubmittingCancel] = useState(false);

  const uniquePeople = useMemo(() => {
    const map = new Map<string, string>();
    for (const a of data.appointments) {
      map.set(a.patientId, a.isDependent ? `${a.patientName} (Dependent)` : a.patientName);
    }
    return Array.from(map.entries());
  }, [data.appointments]);

  const upcoming = useMemo(
    () =>
      data.appointments
        .filter(
          (a) =>
            a.status !== "cancelled" &&
            a.status !== "completed" &&
            a.status !== "no_show"
        )
        .sort((a, b) => a.startTimeUtc - b.startTimeUtc),
    [data.appointments]
  );

  const history = useMemo(
    () =>
      data.appointments
        .filter(
          (a) =>
            a.status === "cancelled" ||
            a.status === "completed" ||
            a.status === "no_show"
        )
        .sort((a, b) => b.startTimeUtc - a.startTimeUtc),
    [data.appointments]
  );

  const activeList = useMemo(() => {
    const base = tab === "upcoming" ? upcoming : history;
    const term = search.trim().toLowerCase();
    return base.filter((item) => {
      if (
        selectedPatientFilter !== "all" &&
        item.patientId !== selectedPatientFilter
      ) {
        return false;
      }
      if (!term) return true;
      return (
        item.clinicName.toLowerCase().includes(term) ||
        item.serviceName.toLowerCase().includes(term) ||
        item.dentistName.toLowerCase().includes(term) ||
        item.referenceCode.toLowerCase().includes(term)
      );
    });
  }, [tab, upcoming, history, selectedPatientFilter, search]);

  const handleConfirmCancel = async () => {
    if (!cancelTarget) return;
    setSubmittingCancel(true);
    try {
      await cancelAppointment({
        appointmentId: cancelTarget._id,
        reason: cancelReason.trim() || undefined,
      });
      toast.success("Appointment cancelled. Waitlisted patients have been notified.");
      setCancelTarget(null);
      setCancelReason("");
    } catch (err) {
      toast.error(getErrorMessage(err, "Could not cancel appointment."));
    } finally {
      setSubmittingCancel(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      {/* Page Title Row */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-[-0.025em] text-slate-950">
            Appointments
          </h1>
          <p className="mt-1 text-sm text-slate-600">
            Track live check-in status, export calendar invites, and review
            post-visit aftercare notes across all Smile clinics.
          </p>
        </div>
        <Link
          href="/clinics"
          className="inline-flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full bg-[#6C5CE7] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#5B4BD6]"
        >
          <span>Book New Visit</span>
          <ArrowUpRight className="size-4" aria-hidden="true" />
        </Link>
      </div>

      {/* Controls Bar: Segmented Track + Search + Family Filter */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div
          role="tablist"
          aria-label="Appointment views"
          className="inline-flex w-fit items-center rounded-full bg-[#F4F6FA] p-1"
        >
          <button
            type="button"
            role="tab"
            aria-selected={tab === "upcoming"}
            onClick={() => setTab("upcoming")}
            className={cn(
              "rounded-full px-4 py-1.5 text-xs font-semibold transition-colors cursor-pointer",
              tab === "upcoming"
                ? "bg-white text-slate-950 shadow-xs"
                : "text-slate-600 hover:text-slate-950"
            )}
          >
            Upcoming ({upcoming.length})
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === "history"}
            onClick={() => setTab("history")}
            className={cn(
              "rounded-full px-4 py-1.5 text-xs font-semibold transition-colors cursor-pointer",
              tab === "history"
                ? "bg-white text-slate-950 shadow-xs"
                : "text-slate-600 hover:text-slate-950"
            )}
          >
            History ({history.length})
          </button>
        </div>

        <div className="relative w-full sm:w-72">
          <Search
            className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate-400"
            aria-hidden="true"
          />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search clinic, dentist, or ref…"
            className="h-9 w-full rounded-full border border-slate-200 bg-white pl-9 pr-4 text-xs text-slate-900 placeholder:text-slate-400 focus:border-[#6C5CE7] focus:outline-none"
          />
        </div>
      </div>

      {/* Optional Family Member Filter Pills */}
      {uniquePeople.length > 1 ? (
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setSelectedPatientFilter("all")}
            className={cn(
              "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer",
              selectedPatientFilter === "all"
                ? "bg-slate-950 text-white"
                : "bg-[#F4F6FA] text-slate-700 hover:bg-[#EAF1F8]"
            )}
          >
            All Family Members
          </button>
          {uniquePeople.map(([id, label]) => (
            <button
              key={id}
              type="button"
              onClick={() => setSelectedPatientFilter(id)}
              className={cn(
                "rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors cursor-pointer",
                selectedPatientFilter === id
                  ? "bg-slate-950 text-white"
                  : "bg-[#F4F6FA] text-slate-700 hover:bg-[#EAF1F8]"
              )}
            >
              {label}
            </button>
          ))}
        </div>
      ) : null}

      {/* Appointment Cards */}
      {activeList.length === 0 ? (
        <div className="rounded-[24px] border border-slate-200/80 bg-white px-6 py-12 text-center">
          <p className="font-heading text-base font-bold text-slate-950">
            {tab === "upcoming"
              ? "No upcoming appointments scheduled"
              : "No past visits recorded yet"}
          </p>
          <p className="mx-auto mt-1.5 max-w-md text-sm text-slate-600">
            {tab === "upcoming"
              ? "Browse active Smile dental clinics to reserve a dual-resource dentist and chair time slot."
              : "Completed and cancelled visits will appear here along with post-visit dentist aftercare notes."}
          </p>
          {tab === "upcoming" ? (
            <Link
              href="/clinics"
              className="mt-5 inline-flex h-10 items-center gap-1.5 rounded-full bg-slate-950 px-5 text-sm font-semibold text-white transition-colors hover:bg-[#6C5CE7]"
            >
              <span>Browse Dental Clinics</span>
              <ArrowUpRight className="size-4" aria-hidden="true" />
            </Link>
          ) : null}
        </div>
      ) : (
        <div className="space-y-4">
          {activeList.map((appt) => {
            const meta = APPT_STATUS_META[appt.status];
            const calEvent = {
              title: `${appt.serviceName} — ${appt.clinicName}`,
              description: `Dentist: ${appt.dentistName}\nChair: ${appt.chairName}\nRef: ${appt.referenceCode}`,
              location: appt.clinicAddress,
              startTimeUtc: appt.startTimeUtc,
              endTimeUtc: appt.endTimeUtc,
              uid: `${appt._id}@smile-dental.app`,
            };
            const canCancel =
              tab === "upcoming" &&
              appt.status !== "in_chair" &&
              appt.status !== "checked_in";

            return (
              <article
                key={appt._id}
                className="rounded-[24px] border border-slate-200/80 bg-white p-5 sm:p-6"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                  <div className="space-y-1.5">
                    <div className="flex flex-wrap items-center gap-2">
                      <span
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                          meta.badgeClass
                        )}
                      >
                        <span className={cn("size-1.5 rounded-full", meta.dotClass)} />
                        {meta.label}
                      </span>
                      <span className="rounded-full bg-[#F5F7FA] px-2.5 py-0.5 font-mono text-xs font-medium text-slate-700">
                        {appt.referenceCode}
                      </span>
                      <span className="rounded-full bg-[#F5F7FA] px-2.5 py-0.5 text-xs font-medium text-slate-700">
                        {appt.serviceCategory}
                      </span>
                      {appt.isDependent ? (
                        <span className="rounded-full bg-[#EFEBFF] px-2.5 py-0.5 text-xs font-semibold text-[#4F3EC7]">
                          Dependent: {appt.patientName}
                        </span>
                      ) : null}
                    </div>

                    <h2 className="font-heading text-lg font-bold tracking-tight text-slate-950">
                      {appt.serviceName} ·{" "}
                      <span className="text-slate-700">{appt.clinicName}</span>
                    </h2>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm text-slate-600">
                      <span className="inline-flex items-center gap-1.5 font-medium text-slate-900">
                        <Calendar className="size-3.5 text-[#6C5CE7]" aria-hidden="true" />
                        {formatDateTime(appt.startTimeUtc)} ({appt.durationMinutes}m)
                      </span>
                      <span className="inline-flex items-center gap-1.5">
                        <Stethoscope className="size-3.5 text-[#6C5CE7]" aria-hidden="true" />
                        {appt.dentistName} ({appt.chairName})
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-slate-500">
                      <span className="inline-flex items-center gap-1">
                        <MapPin className="size-3.5" aria-hidden="true" />
                        {appt.clinicAddress}
                      </span>
                      {appt.clinicPhone ? (
                        <span className="inline-flex items-center gap-1">
                          <Phone className="size-3.5" aria-hidden="true" />
                          {appt.clinicPhone}
                        </span>
                      ) : null}
                    </div>
                  </div>

                  <div className="text-left sm:text-right">
                    <p className="font-heading text-lg font-bold tabular-nums text-slate-950">
                      {formatPhp(appt.pricePhp)}
                    </p>
                    <p className="text-xs text-slate-500">
                      {appt.cancellationWindowHours}h cancel policy
                    </p>
                  </div>
                </div>

                {/* Chief Complaint or Post-Visit Care Instructions */}
                {appt.chiefComplaint || appt.postVisitInstructions || appt.cancellationReason ? (
                  <div className="mt-4 space-y-2">
                    {appt.chiefComplaint ? (
                      <div className="rounded-xl bg-[#F7FAFD] px-3.5 py-2.5 text-xs text-slate-700">
                        <span className="font-semibold text-slate-900">
                          Visit note:{" "}
                        </span>
                        {appt.chiefComplaint}
                      </div>
                    ) : null}
                    {appt.postVisitInstructions ? (
                      <div className="rounded-xl border border-emerald-200/80 bg-emerald-50/70 px-3.5 py-3 text-xs text-emerald-950">
                        <p className="flex items-center gap-1.5 font-semibold text-emerald-900">
                          <ClipboardList className="size-3.5" aria-hidden="true" />
                          Dentist Post-Visit Aftercare Instructions
                        </p>
                        <p className="mt-1 leading-relaxed">
                          {appt.postVisitInstructions}
                        </p>
                      </div>
                    ) : null}
                    {appt.cancellationReason && appt.status === "cancelled" ? (
                      <div className="rounded-xl bg-slate-100 px-3.5 py-2 text-xs text-slate-600">
                        Cancellation note: {appt.cancellationReason}
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {/* Footer Actions */}
                <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4">
                  <div className="flex flex-wrap gap-2">
                    {tab === "upcoming" ? (
                      <>
                        <a
                          href={buildGoogleCalendarUrl(calEvent)}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[#F5F7FA] px-3.5 text-xs font-semibold text-slate-800 transition-colors hover:bg-[#EAF1F8]"
                        >
                          <CalendarPlus className="size-3.5 text-[#6C5CE7]" aria-hidden="true" />
                          <span>Google Calendar</span>
                        </a>
                        <button
                          type="button"
                          onClick={() =>
                            downloadIcsFile(calEvent, `${appt.referenceCode}.ics`)
                          }
                          className="inline-flex h-8 items-center gap-1.5 rounded-full bg-[#F5F7FA] px-3.5 text-xs font-semibold text-slate-800 transition-colors hover:bg-[#EAF1F8] cursor-pointer"
                        >
                          <Download className="size-3.5 text-[#6C5CE7]" aria-hidden="true" />
                          <span>.ICS</span>
                        </button>
                      </>
                    ) : null}

                    {appt.clinicSlug ? (
                      <Link
                        href={`/c/${appt.clinicSlug}`}
                        className="inline-flex h-8 items-center gap-1 rounded-full bg-[#EFEBFF] px-3.5 text-xs font-semibold text-[#4F3EC7] transition-colors hover:bg-[#6C5CE7] hover:text-white"
                      >
                        <span>Book Again</span>
                        <ArrowUpRight className="size-3.5" aria-hidden="true" />
                      </Link>
                    ) : null}
                  </div>

                  {canCancel ? (
                    <button
                      type="button"
                      onClick={() => {
                        setCancelTarget(appt);
                        setCancelReason("");
                      }}
                      className="inline-flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-semibold text-rose-700 transition-colors hover:bg-rose-50 cursor-pointer"
                    >
                      <XCircle className="size-3.5" aria-hidden="true" />
                      <span>Cancel Visit</span>
                    </button>
                  ) : null}
                </div>
              </article>
            );
          })}
        </div>
      )}

      {/* Cancel Appointment Dialog */}
      <Dialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null);
        }}
      >
        <DialogContent className="sm:max-w-md rounded-[24px]">
          <DialogHeader>
            <DialogTitle className="font-heading text-lg font-bold">
              Cancel dental appointment?
            </DialogTitle>
            <DialogDescription>
              {cancelTarget ? (
                <>
                  Cancelling{" "}
                  <strong>
                    {cancelTarget.serviceName} ({cancelTarget.referenceCode})
                  </strong>{" "}
                  at {cancelTarget.clinicName}. Online cancellation requires at
                  least {cancelTarget.cancellationWindowHours} hours notice.
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-2 py-2">
            <label
              htmlFor="cancel-reason"
              className="text-xs font-semibold text-slate-700"
            >
              Reason for cancellation (optional)
            </label>
            <input
              id="cancel-reason"
              type="text"
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="e.g., Schedule conflict, feeling unwell…"
              className="h-10 w-full rounded-xl border border-slate-200 bg-[#F8FAFC] px-3.5 text-sm text-slate-900 focus:border-[#6C5CE7] focus:bg-white focus:outline-none"
            />
          </div>

          <DialogFooter className="gap-2 sm:gap-2">
            <button
              type="button"
              onClick={() => setCancelTarget(null)}
              className="inline-flex h-10 items-center justify-center rounded-full bg-[#F5F7FA] px-4 text-sm font-semibold text-slate-800 hover:bg-[#EAF1F8] cursor-pointer"
            >
              Keep Appointment
            </button>
            <button
              type="button"
              disabled={submittingCancel}
              onClick={handleConfirmCancel}
              className="inline-flex h-10 items-center justify-center rounded-full bg-rose-600 px-5 text-sm font-semibold text-white hover:bg-rose-700 disabled:opacity-50 cursor-pointer"
            >
              {submittingCancel ? "Cancelling…" : "Confirm Cancellation"}
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
