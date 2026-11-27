"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  ArrowUpRight,
  BellRing,
  Calendar,
  CalendarCheck2,
  CalendarPlus,
  CheckCircle2,
  Clock3,
  Download,
  HeartPulse,
  MapPin,
  Search,
  Sparkles,
  Stethoscope,
  Users,
} from "lucide-react";
import { cn } from "cn";
import { buildGoogleCalendarUrl, downloadIcsFile } from "@/lib/calendar-export";
import {
  formatDateTime,
  formatPhp,
  formatShortDateKey,
} from "@/lib/format";
import {
  APPT_STATUS_META,
  hasCriticalMedicalFlags,
  type PatientDashboardData,
  type PatientNavTab,
} from "@/components/patient/types";

interface OverviewViewProps {
  data: PatientDashboardData;
  nowMs: number;
  onNavigate: (tab: PatientNavTab) => void;
  onQuickAddFamily: () => void;
}

const FLOW_STAGES = [
  { key: "confirmed", label: "Confirmed" },
  { key: "checked_in", label: "Checked In" },
  { key: "in_chair", label: "In Chair" },
  { key: "completed", label: "Completed" },
] as const;

function getFlowStepIndex(status: string): number {
  if (status === "pending_approval") return 0;
  if (status === "confirmed") return 0;
  if (status === "checked_in") return 1;
  if (status === "in_chair") return 2;
  if (status === "completed") return 3;
  return 0;
}

export function OverviewView({
  data,
  nowMs,
  onNavigate,
  onQuickAddFamily,
}: OverviewViewProps) {
  const [clinicQuery, setClinicQuery] = useState("");

  const upcoming = useMemo(
    () =>
      data.appointments
        .filter(
          (a) =>
            a.status === "checked_in" ||
            a.status === "in_chair" ||
            ((a.status === "confirmed" || a.status === "pending_approval") &&
              a.endTimeUtc >= nowMs)
        )
        .sort((a, b) => a.startTimeUtc - b.startTimeUtc),
    [data.appointments, nowMs]
  );

  const nextVisit = upcoming[0] ?? null;

  const notifiedWaitlist = useMemo(
    () => data.waitlist.filter((w) => w.status === "notified"),
    [data.waitlist]
  );

  const activeWaitlistCount = useMemo(
    () =>
      data.waitlist.filter(
        (w) => w.status === "waiting" || w.status === "notified"
      ).length,
    [data.waitlist]
  );

  const upcomingRecall = useMemo(() => {
    const withRecall = data.profiles
      .filter((p) => p.nextRecallDate)
      .sort((a, b) =>
        (a.nextRecallDate ?? "").localeCompare(b.nextRecallDate ?? "")
      );
    return withRecall[0] ?? null;
  }, [data.profiles]);

  const medicalAlertProfiles = useMemo(
    () => data.profiles.filter((p) => hasCriticalMedicalFlags(p)),
    [data.profiles]
  );

  const filteredClinics = useMemo(() => {
    const q = clinicQuery.trim().toLowerCase();
    if (!q) return data.featuredClinics;
    return data.featuredClinics.filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.city.toLowerCase().includes(q) ||
        c.province.toLowerCase().includes(q)
    );
  }, [clinicQuery, data.featuredClinics]);

  const greetingName = data.user.firstName || "there";

  return (
    <div className="flex flex-col gap-6">
      {/* Header Row */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="font-heading text-2xl font-bold tracking-[-0.025em] text-slate-950 sm:text-[1.75rem]">
            Welcome back, {greetingName}
          </h1>
          <p className="mt-1 text-sm text-slate-600 sm:text-[15px]">
            {nextVisit
              ? `Next visit: ${nextVisit.serviceName} with ${nextVisit.dentistName} on ${formatDateTime(nextVisit.startTimeUtc)}.`
              : "You have no upcoming visits yet—choose a verified Smile clinic below to book in 4 quick steps."}
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <button
            type="button"
            onClick={onQuickAddFamily}
            className="inline-flex h-10 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-800 transition-colors hover:bg-[#F5F7FA] cursor-pointer"
          >
            <Users className="size-4 text-slate-600" aria-hidden="true" />
            <span>Add Family Profile</span>
          </button>
          <Link
            href="/clinics"
            className="inline-flex h-10 items-center gap-1.5 rounded-full bg-[#6C5CE7] px-5 text-sm font-semibold text-white transition-colors hover:bg-[#5B4BD6]"
          >
            <span>Book Appointment</span>
            <ArrowUpRight className="size-4" aria-hidden="true" />
          </Link>
        </div>
      </div>

      {/* Urgent Waitlist Opening Alert Banner */}
      {notifiedWaitlist.length > 0 ? (
        <div className="flex flex-col gap-3 rounded-[20px] border border-[#6C5CE7]/25 bg-[#EFEBFF] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-3">
            <span className="inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-[#6C5CE7] text-white">
              <BellRing className="size-4" aria-hidden="true" />
            </span>
            <div>
              <p className="font-heading text-sm font-bold text-slate-950">
                A cancellation slot just opened for you!
              </p>
              <p className="mt-0.5 text-sm text-slate-700">
                {notifiedWaitlist[0].clinicName} has an opening for{" "}
                <strong>{notifiedWaitlist[0].serviceName}</strong> on{" "}
                {formatShortDateKey(notifiedWaitlist[0].preferredDateKey)}.
              </p>
            </div>
          </div>
          <Link
            href={`/c/${notifiedWaitlist[0].clinicSlug}?waitlistId=${notifiedWaitlist[0]._id}&date=${encodeURIComponent(notifiedWaitlist[0].preferredDateKey)}`}
            className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full bg-[#6C5CE7] px-4 text-xs font-semibold text-white transition-colors hover:bg-[#5B4BD6]"
          >
            <span>Claim Slot Now</span>
            <ArrowUpRight className="size-3.5" aria-hidden="true" />
          </Link>
        </div>
      ) : null}

      {/* Unified Hairline-Divided Metric Strip (App-Screens §5) */}
      <div className="grid grid-cols-2 divide-y divide-slate-200/80 overflow-hidden rounded-[20px] border border-slate-200/80 bg-white sm:grid-cols-4 sm:divide-x sm:divide-y-0">
        <button
          type="button"
          onClick={() => onNavigate("appointments")}
          className="flex flex-col items-start px-5 py-4 text-left transition-colors hover:bg-[#F7FAFD] cursor-pointer"
        >
          <span className="text-[13px] font-medium text-slate-600">
            Upcoming Visits
          </span>
          <span className="mt-1.5 font-heading text-2xl font-bold tabular-nums text-slate-950">
            {upcoming.length}
          </span>
          <span className="mt-0.5 text-xs text-slate-500">
            {data.appointments.length} total recorded
          </span>
        </button>

        <button
          type="button"
          onClick={() => onNavigate("family")}
          className="flex flex-col items-start px-5 py-4 text-left transition-colors hover:bg-[#F7FAFD] cursor-pointer"
        >
          <span className="text-[13px] font-medium text-slate-600">
            Family &amp; Self Profiles
          </span>
          <span className="mt-1.5 font-heading text-2xl font-bold tabular-nums text-slate-950">
            {data.profiles.length}
          </span>
          <span className="mt-0.5 text-xs text-slate-500">
            {data.profiles.filter((p) => p.isDependent).length} dependent
            {data.profiles.filter((p) => p.isDependent).length === 1 ? "" : "s"}
          </span>
        </button>

        <button
          type="button"
          onClick={() => onNavigate("records")}
          className="flex flex-col items-start px-5 py-4 text-left transition-colors hover:bg-[#F7FAFD] cursor-pointer"
        >
          <span className="text-[13px] font-medium text-slate-600">
            Next Hygiene Recall
          </span>
          <span className="mt-1.5 font-heading text-2xl font-bold tabular-nums text-slate-950">
            {upcomingRecall?.nextRecallDate
              ? formatShortDateKey(upcomingRecall.nextRecallDate)
              : "—"}
          </span>
          <span className="mt-0.5 text-xs text-slate-500">
            {upcomingRecall
              ? upcomingRecall.clinicName
              : "Set after 1st cleaning"}
          </span>
        </button>

        <button
          type="button"
          onClick={() => onNavigate("waitlist")}
          className="flex flex-col items-start px-5 py-4 text-left transition-colors hover:bg-[#F7FAFD] cursor-pointer"
        >
          <span className="text-[13px] font-medium text-slate-600">
            Waitlist Requests
          </span>
          <span className="mt-1.5 font-heading text-2xl font-bold tabular-nums text-slate-950">
            {activeWaitlistCount}
          </span>
          <span className="mt-0.5 text-xs text-slate-500">
            {notifiedWaitlist.length > 0
              ? `${notifiedWaitlist.length} opening notified`
              : "Standby alerts active"}
          </span>
        </button>
      </div>

      {/* Main 2-Column Workspace Grid */}
      <div className="grid grid-cols-1 gap-5 lg:grid-cols-12 lg:items-start">
        {/* Left Main Column: Next Visit Spotlight OR Quick-Book Clinic Directory */}
        <div className="flex flex-col gap-5 lg:col-span-7">
          {nextVisit ? (
            <div className="rounded-[24px] border border-slate-200/80 bg-white p-5 sm:p-6">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold",
                      APPT_STATUS_META[nextVisit.status].badgeClass
                    )}
                  >
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        APPT_STATUS_META[nextVisit.status].dotClass
                      )}
                    />
                    {APPT_STATUS_META[nextVisit.status].label}
                  </span>
                  <span className="rounded-full bg-[#F5F7FA] px-2.5 py-1 font-mono text-xs font-medium text-slate-700">
                    {nextVisit.referenceCode}
                  </span>
                  {nextVisit.isDependent ? (
                    <span className="rounded-full bg-[#EFEBFF] px-2.5 py-1 text-xs font-semibold text-[#4F3EC7]">
                      Dependent: {nextVisit.patientName}
                    </span>
                  ) : null}
                </div>
                <span className="font-heading text-base font-bold tabular-nums text-slate-950">
                  {formatPhp(nextVisit.pricePhp)}
                </span>
              </div>

              <div className="mt-4">
                <h2 className="font-heading text-xl font-bold tracking-tight text-slate-950">
                  {nextVisit.serviceName}
                </h2>
                <p className="mt-1 text-sm font-medium text-slate-700">
                  {nextVisit.clinicName}
                </p>
              </div>

              {/* Details Grid */}
              <div className="mt-4 grid grid-cols-1 gap-2.5 rounded-2xl bg-[#F7FAFD] p-4 text-sm text-slate-700 sm:grid-cols-2">
                <div className="flex items-center gap-2">
                  <Calendar className="size-4 shrink-0 text-[#6C5CE7]" aria-hidden="true" />
                  <span className="font-medium text-slate-900">
                    {formatDateTime(nextVisit.startTimeUtc)}
                  </span>
                </div>
                <div className="flex items-center gap-2">
                  <Stethoscope className="size-4 shrink-0 text-[#6C5CE7]" aria-hidden="true" />
                  <span>
                    {nextVisit.dentistName} · {nextVisit.chairName}
                  </span>
                </div>
                <div className="flex items-center gap-2 sm:col-span-2">
                  <MapPin className="size-4 shrink-0 text-[#6C5CE7]" aria-hidden="true" />
                  <span>{nextVisit.clinicAddress}</span>
                </div>
              </div>

              {/* Live Visit Status Progress Track */}
              <div className="mt-5">
                <div className="grid grid-cols-4 gap-2">
                  {FLOW_STAGES.map((stage, idx) => {
                    const currentStep = getFlowStepIndex(nextVisit.status);
                    const isReached = idx <= currentStep;
                    return (
                      <div key={stage.key} className="flex flex-col gap-1.5">
                        <div
                          className={cn(
                            "h-1.5 rounded-full transition-colors",
                            isReached ? "bg-[#6C5CE7]" : "bg-slate-200"
                          )}
                        />
                        <span
                          className={cn(
                            "text-[11px] font-medium sm:text-xs",
                            isReached ? "text-slate-900" : "text-slate-400"
                          )}
                        >
                          {stage.label}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Calendar & Quick Actions */}
              <div className="mt-5 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-4">
                <div className="flex flex-wrap gap-2">
                  <a
                    href={buildGoogleCalendarUrl({
                      title: `${nextVisit.serviceName} — ${nextVisit.clinicName}`,
                      description: `Dentist: ${nextVisit.dentistName}\nChair: ${nextVisit.chairName}\nRef: ${nextVisit.referenceCode}`,
                      location: nextVisit.clinicAddress,
                      startTimeUtc: nextVisit.startTimeUtc,
                      endTimeUtc: nextVisit.endTimeUtc,
                      uid: `${nextVisit._id}@smile-dental.app`,
                    })}
                    target="_blank"
                    rel="noreferrer"
                    className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#F5F7FA] px-3.5 text-xs font-semibold text-slate-800 transition-colors hover:bg-[#EAF1F8]"
                  >
                    <CalendarPlus className="size-3.5 text-[#6C5CE7]" aria-hidden="true" />
                    <span>Google Calendar</span>
                  </a>
                  <button
                    type="button"
                    onClick={() =>
                      downloadIcsFile(
                        {
                          title: `${nextVisit.serviceName} — ${nextVisit.clinicName}`,
                          description: `Dentist: ${nextVisit.dentistName}\nChair: ${nextVisit.chairName}\nRef: ${nextVisit.referenceCode}`,
                          location: nextVisit.clinicAddress,
                          startTimeUtc: nextVisit.startTimeUtc,
                          endTimeUtc: nextVisit.endTimeUtc,
                          uid: `${nextVisit._id}@smile-dental.app`,
                        },
                        `${nextVisit.referenceCode}.ics`
                      )
                    }
                    className="inline-flex h-9 items-center gap-1.5 rounded-full bg-[#F5F7FA] px-3.5 text-xs font-semibold text-slate-800 transition-colors hover:bg-[#EAF1F8] cursor-pointer"
                  >
                    <Download className="size-3.5 text-[#6C5CE7]" aria-hidden="true" />
                    <span>Download .ICS</span>
                  </button>
                </div>

                <button
                  type="button"
                  onClick={() => onNavigate("appointments")}
                  className="inline-flex items-center gap-1 text-xs font-semibold text-[#5B4BD6] hover:text-[#4332B8] cursor-pointer"
                >
                  <span>Manage all visits</span>
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </button>
              </div>
            </div>
          ) : (
            /* Rich Guided Onboarding & Quick-Book Card when 0 Upcoming Visits */
            <div className="rounded-[24px] border border-slate-200/80 bg-white p-5 sm:p-6">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <span className="inline-flex items-center gap-1.5 rounded-full bg-[#EEF7FD] px-3 py-1 text-xs font-semibold text-[#4F3EC7]">
                    <Sparkles className="size-3.5" aria-hidden="true" />
                    <span>Ready to book online</span>
                  </span>
                  <h2 className="mt-2.5 font-heading text-xl font-bold tracking-tight text-slate-950">
                    Schedule your next dental visit
                  </h2>
                  <p className="mt-1 text-sm text-slate-600">
                    Pick any verified Smile clinic below—live dentist &amp; chair
                    availability with a 5-minute checkout lock.
                  </p>
                </div>
              </div>

              {/* Search Clinics Right Inside Dashboard */}
              <div className="relative mt-4">
                <Search
                  className="pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2 text-slate-400"
                  aria-hidden="true"
                />
                <input
                  type="search"
                  value={clinicQuery}
                  onChange={(e) => setClinicQuery(e.target.value)}
                  placeholder="Search dental clinic by name, city, or province…"
                  className="h-10 w-full rounded-full border border-slate-200 bg-[#F8FAFC] pl-10 pr-4 text-sm text-slate-900 placeholder:text-slate-400 focus:border-[#6C5CE7] focus:bg-white focus:outline-none"
                />
              </div>

              {/* Live Bookable Clinics List */}
              <div className="mt-4 space-y-2.5">
                {filteredClinics.length === 0 ? (
                  <div className="rounded-2xl bg-[#F7F9FC] p-6 text-center">
                    <p className="text-sm font-medium text-slate-800">
                      {data.featuredClinics.length === 0
                        ? "No dental clinics are published yet."
                        : "No clinics match your search."}
                    </p>
                    <p className="mt-1 text-xs text-slate-600">
                      {data.featuredClinics.length === 0
                        ? "Once a clinic is onboarded on Smile, it will appear here for instant online booking."
                        : "Try clearing your search or browse the full clinic directory."}
                    </p>
                    <Link
                      href="/clinics"
                      className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-full bg-slate-950 px-4 text-xs font-semibold text-white hover:bg-[#6C5CE7]"
                    >
                      <span>Open Clinic Directory</span>
                      <ArrowUpRight className="size-3.5" aria-hidden="true" />
                    </Link>
                  </div>
                ) : (
                  filteredClinics.slice(0, 4).map((clinic) => (
                    <div
                      key={clinic._id}
                      className="flex flex-col gap-3 rounded-2xl bg-[#F7FAFD] p-4 transition-colors hover:bg-[#EEF7FD] sm:flex-row sm:items-center sm:justify-between"
                    >
                      <div className="flex min-w-0 items-center gap-3">
                        <span
                          className="flex size-10 shrink-0 items-center justify-center rounded-xl font-heading text-sm font-bold text-white"
                          style={{ backgroundColor: clinic.primaryColorHex }}
                        >
                          {clinic.name.slice(0, 1).toUpperCase()}
                        </span>
                        <div className="min-w-0">
                          <p className="truncate font-heading text-sm font-bold text-slate-950">
                            {clinic.name}
                          </p>
                          <p className="truncate text-xs text-slate-600">
                            {clinic.city}, {clinic.province} ·{" "}
                            {clinic.activeDentistCount} dentist
                            {clinic.activeDentistCount === 1 ? "" : "s"} ·{" "}
                            {clinic.activeChairCount} chair
                            {clinic.activeChairCount === 1 ? "" : "s"}
                          </p>
                        </div>
                      </div>
                      <Link
                        href={`/c/${clinic.slug}`}
                        className="inline-flex h-9 shrink-0 items-center justify-center gap-1.5 rounded-full bg-slate-950 px-4 text-xs font-semibold text-white transition-colors hover:bg-[#6C5CE7]"
                      >
                        <span>Book Slot</span>
                        <ArrowUpRight className="size-3.5" aria-hidden="true" />
                      </Link>
                    </div>
                  ))
                )}
              </div>

              {filteredClinics.length > 4 ? (
                <div className="mt-4 flex justify-end">
                  <Link
                    href="/clinics"
                    className="inline-flex items-center gap-1 text-xs font-semibold text-[#5B4BD6] hover:text-[#4332B8]"
                  >
                    <span>Browse all {filteredClinics.length} clinics</span>
                    <ArrowRight className="size-3.5" aria-hidden="true" />
                  </Link>
                </div>
              ) : null}
            </div>
          )}

          {/* Compact 4-Step How Booking Works Guide */}
          <div className="rounded-[24px] border border-slate-200/80 bg-white p-5 sm:p-6">
            <div className="flex items-center justify-between gap-2">
              <h3 className="font-heading text-base font-bold text-slate-950">
                Your 4-step online booking flow
              </h3>
              <span className="text-xs font-medium text-slate-500">
                Zero double-books
              </span>
            </div>
            <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
              {[
                {
                  title: "Pick Procedure",
                  desc: "See transparent PHP rates & chair time.",
                },
                {
                  title: "Lock Dentist + Chair",
                  desc: "5-minute hold prevents slot collisions.",
                },
                {
                  title: "Choose Self or Family",
                  desc: "Attach allergies & medical intake safely.",
                },
                {
                  title: "Instant .ICS & Recall",
                  desc: "Calendar invite + 6-month cleaning alert.",
                },
              ].map((step) => (
                <div
                  key={step.title}
                  className="flex items-start gap-2.5 rounded-2xl bg-[#F7F9FC] p-3.5"
                >
                  <CheckCircle2
                    className="mt-0.5 size-4 shrink-0 text-[#6C5CE7]"
                    aria-hidden="true"
                  />
                  <div>
                    <p className="font-heading text-sm font-bold text-slate-900">
                      {step.title}
                    </p>
                    <p className="mt-0.5 text-xs text-slate-600">{step.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right Secondary Column: Care Readiness, Medical Alerts & Family */}
        <div className="flex flex-col gap-5 lg:col-span-5">
          {/* Health & Medical Safety Card */}
          <div className="rounded-[24px] border border-slate-200/80 bg-white p-5 sm:p-6">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <HeartPulse
                  className="size-4 text-[#6C5CE7]"
                  aria-hidden="true"
                />
                <h3 className="font-heading text-base font-bold text-slate-950">
                  Health &amp; Allergy Readiness
                </h3>
              </div>
              <button
                type="button"
                onClick={() => onNavigate("family")}
                className="text-xs font-semibold text-[#5B4BD6] hover:text-[#4332B8] cursor-pointer"
              >
                Manage
              </button>
            </div>

            {data.profiles.length === 0 ? (
              <div className="mt-4 rounded-2xl bg-[#EEF7FD] p-4">
                <p className="text-sm font-semibold text-slate-900">
                  Pre-fill your medical intake before your visit
                </p>
                <p className="mt-1 text-xs leading-relaxed text-slate-700">
                  Save allergies (Lidocaine, Penicillin, Latex), blood thinners,
                  and anxiety preferences once so your dentist sees critical
                  alerts chairside.
                </p>
                <button
                  type="button"
                  onClick={onQuickAddFamily}
                  className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-full bg-slate-950 px-4 text-xs font-semibold text-white transition-colors hover:bg-[#6C5CE7] cursor-pointer"
                >
                  <span>Complete Intake Profile</span>
                  <ArrowRight className="size-3.5" aria-hidden="true" />
                </button>
              </div>
            ) : (
              <div className="mt-4 space-y-3">
                {medicalAlertProfiles.length > 0 ? (
                  <div className="rounded-2xl border border-rose-200/90 bg-rose-50/70 p-3.5">
                    <div className="flex items-center gap-2 text-xs font-bold text-rose-800">
                      <AlertTriangle className="size-4" aria-hidden="true" />
                      <span>
                        Chairside safety alerts active on{" "}
                        {medicalAlertProfiles.length} profile
                        {medicalAlertProfiles.length === 1 ? "" : "s"}
                      </span>
                    </div>
                    <p className="mt-1 text-xs text-rose-700">
                      Dentists automatically see your recorded allergy,
                      blood-thinner, or anxiety alerts before treatment starts.
                    </p>
                  </div>
                ) : (
                  <div className="rounded-2xl bg-[#F7FAFD] p-3.5 text-xs text-slate-700">
                    All {data.profiles.length} saved profile
                    {data.profiles.length === 1 ? "" : "s"} currently report no
                    critical allergy or blood-thinner flags.
                  </div>
                )}

                <div className="divide-y divide-slate-100">
                  {data.profiles.slice(0, 3).map((profile) => {
                    const hasAlerts = hasCriticalMedicalFlags(profile);
                    return (
                      <div
                        key={profile._id}
                        className="flex items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0"
                      >
                        <div className="min-w-0">
                          <p className="truncate text-sm font-semibold text-slate-900">
                            {profile.firstName} {profile.lastName}{" "}
                            {profile.isDependent ? (
                              <span className="ml-1 rounded-full bg-[#EFEBFF] px-2 py-0.5 text-[11px] font-semibold text-[#4F3EC7]">
                                Dependent
                              </span>
                            ) : null}
                          </p>
                          <p className="truncate text-xs text-slate-500">
                            {profile.clinicName}
                          </p>
                        </div>
                        <span
                          className={cn(
                            "shrink-0 rounded-full px-2.5 py-0.5 text-[11px] font-semibold",
                            hasAlerts
                              ? "bg-rose-50 text-rose-700"
                              : "bg-emerald-50 text-emerald-700"
                          )}
                        >
                          {hasAlerts ? "Alert Flags Set" : "Intake Ready"}
                        </span>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* 6-Month Hygiene Recall & Records Card */}
          <div className="rounded-[24px] border border-slate-200/80 bg-white p-5 sm:p-6">
            <div className="flex items-center justify-between gap-2">
              <div className="flex items-center gap-2">
                <CalendarCheck2
                  className="size-4 text-[#6C5CE7]"
                  aria-hidden="true"
                />
                <h3 className="font-heading text-base font-bold text-slate-950">
                  6-Month Hygiene Recall
                </h3>
              </div>
              <button
                type="button"
                onClick={() => onNavigate("records")}
                className="text-xs font-semibold text-[#5B4BD6] hover:text-[#4332B8] cursor-pointer"
              >
                Dental Records
              </button>
            </div>

            {upcomingRecall ? (
              <div className="mt-4 rounded-2xl bg-[#F7FAFD] p-4">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-xs font-medium text-slate-600">
                    Next Cleaning Due ({upcomingRecall.firstName})
                  </span>
                  <span className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-0.5 text-xs font-bold text-[#4F3EC7]">
                    <Clock3 className="size-3" aria-hidden="true" />
                    {upcomingRecall.nextRecallDate}
                  </span>
                </div>
                <p className="mt-1.5 text-xs text-slate-600">
                  {upcomingRecall.lastCleaningDate
                    ? `Last cleaning: ${upcomingRecall.lastCleaningDate} at ${upcomingRecall.clinicName}.`
                    : `Tracked with ${upcomingRecall.clinicName}.`}
                </p>
                {upcomingRecall.clinicSlug ? (
                  <Link
                    href={`/c/${upcomingRecall.clinicSlug}`}
                    className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-[#5B4BD6] hover:underline"
                  >
                    <span>Book Oral Prophylaxis</span>
                    <ArrowUpRight className="size-3.5" aria-hidden="true" />
                  </Link>
                ) : null}
              </div>
            ) : (
              <p className="mt-3 text-sm leading-relaxed text-slate-600">
                After your first completed Oral Prophylaxis cleaning, Smile
                automatically schedules a 6-month recall tracker and sends a
                friendly reminder email.
              </p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
