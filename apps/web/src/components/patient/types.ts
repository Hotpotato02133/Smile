import type { FunctionReturnType } from "convex/server";
import type { api } from "../../../convex/_generated/api";

export type PatientDashboardData = FunctionReturnType<
  typeof api.patientPortal.getDashboardData
>;
export type PatientProfileItem = PatientDashboardData["profiles"][number];
export type PatientAppointmentItem = PatientDashboardData["appointments"][number];
export type PatientWaitlistItem = PatientDashboardData["waitlist"][number];
export type FeaturedClinicItem = PatientDashboardData["featuredClinics"][number];
export type PatientAnnouncementItem = PatientDashboardData["announcements"][number];

export type PatientClinicalSummary = FunctionReturnType<
  typeof api.patientPortal.getMyClinicalSummary
>;

export type PatientNavTab =
  | "overview"
  | "appointments"
  | "family"
  | "records"
  | "waitlist";

export const APPT_STATUS_META: Record<
  PatientAppointmentItem["status"],
  { label: string; badgeClass: string; dotClass: string }
> = {
  pending_approval: {
    label: "Pending",
    badgeClass: "bg-amber-50 text-amber-800 border-amber-200/80",
    dotClass: "bg-amber-500",
  },
  confirmed: {
    label: "Confirmed",
    badgeClass: "bg-[#EEF7FD] text-sky-900 border-sky-200/80",
    dotClass: "bg-sky-500",
  },
  checked_in: {
    label: "Checked In",
    badgeClass: "bg-[#EFEBFF] text-[#4F3EC7] border-[#6C5CE7]/25",
    dotClass: "bg-[#6C5CE7]",
  },
  in_chair: {
    label: "In Chair",
    badgeClass: "bg-emerald-50 text-emerald-800 border-emerald-200/80",
    dotClass: "bg-emerald-500",
  },
  completed: {
    label: "Completed",
    badgeClass: "bg-emerald-50 text-emerald-800 border-emerald-200/80",
    dotClass: "bg-emerald-600",
  },
  cancelled: {
    label: "Cancelled",
    badgeClass: "bg-slate-100 text-slate-600 border-slate-200/80",
    dotClass: "bg-slate-400",
  },
  no_show: {
    label: "No-Show",
    badgeClass: "bg-rose-50 text-rose-700 border-rose-200/80",
    dotClass: "bg-rose-500",
  },
};

export const TOOTH_CONDITION_META: Record<
  string,
  { label: string; fillClass: string; badgeClass: string }
> = {
  sound: {
    label: "Healthy / Sound",
    fillClass: "bg-slate-50 border-slate-200 text-slate-700",
    badgeClass: "bg-slate-100 text-slate-700",
  },
  caries: {
    label: "Caries / Decay",
    fillClass: "bg-rose-100 border-rose-400 text-rose-900",
    badgeClass: "bg-rose-50 text-rose-700 border-rose-200",
  },
  composite_filling: {
    label: "Composite Filling",
    fillClass: "bg-sky-100 border-sky-400 text-sky-900",
    badgeClass: "bg-sky-50 text-sky-800 border-sky-200",
  },
  amalgam_filling: {
    label: "Amalgam Filling",
    fillClass: "bg-slate-200 border-slate-400 text-slate-900",
    badgeClass: "bg-slate-100 text-slate-800 border-slate-300",
  },
  crown: {
    label: "Dental Crown",
    fillClass: "bg-amber-100 border-amber-400 text-amber-900",
    badgeClass: "bg-amber-50 text-amber-800 border-amber-200",
  },
  root_canal: {
    label: "Root Canal",
    fillClass: "bg-[#EFEBFF] border-[#6C5CE7] text-[#4332B8]",
    badgeClass: "bg-[#EFEBFF] text-[#4F3EC7] border-[#6C5CE7]/30",
  },
  extraction_needed: {
    label: "Extraction Planned",
    fillClass: "bg-orange-100 border-orange-500 text-orange-950",
    badgeClass: "bg-orange-50 text-orange-800 border-orange-200",
  },
  missing: {
    label: "Missing Tooth",
    fillClass: "bg-slate-100 border-dashed border-slate-300 text-slate-400",
    badgeClass: "bg-slate-100 text-slate-600 border-slate-200",
  },
  implant: {
    label: "Dental Implant",
    fillClass: "bg-teal-100 border-teal-500 text-teal-900",
    badgeClass: "bg-teal-50 text-teal-800 border-teal-200",
  },
};

export function hasCriticalMedicalFlags(profile: PatientProfileItem): boolean {
  const mh = profile.medicalHistory;
  return (
    mh.allergies.length > 0 ||
    mh.isTakingBloodThinners ||
    mh.isPregnant ||
    mh.dentalAnxietyLevel === "severe"
  );
}
