import type {
  AppointmentStatus,
  DentalAnxietyLevel,
  MedicalHistory,
  PatientSex,
  ToothCondition,
  ToothSurface,
  TreatmentStatus,
  WaitlistStatus,
} from "@smile/shared";
import type { Id } from "@/lib/api";

export interface PatientProfileItem {
  _id: Id<"patients">;
  id?: string;
  clinicId: Id<"clinics">;
  clinicName: string;
  clinicSlug: string;
  isDependent: boolean;
  userId?: Id<"users"> | null;
  guardianPatientId?: Id<"patients"> | null;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  sex: PatientSex;
  email?: string;
  phone: string;
  address?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  medicalHistory: MedicalHistory & { dentalAnxietyLevel: DentalAnxietyLevel };
  lastCleaningDate?: string | null;
  nextRecallDate?: string | null;
  noShowCount: number;
  createdAt: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface PatientAppointmentItem {
  _id: Id<"appointments">;
  id?: string;
  referenceCode: string;
  clinicId: Id<"clinics">;
  clinicName: string;
  clinicSlug: string;
  clinicAddress: string;
  clinicPhone: string;
  clinicTimezone: string;
  clinicPrimaryColorHex: string;
  cancellationWindowHours: number;
  patientId: Id<"patients">;
  patientName: string;
  isDependent: boolean;
  dentistId: Id<"dentists">;
  dentistName: string;
  chairId: Id<"chairs">;
  chairName: string;
  serviceId: Id<"services">;
  serviceName: string;
  serviceCategory: string;
  durationMinutes: number;
  pricePhp: number;
  dateKey: string;
  startTimeUtc: number;
  endTimeUtc: number;
  bufferEndTimeUtc: number;
  status: AppointmentStatus;
  bookingSource: string;
  chiefComplaint?: string | null;
  clinicalNotes?: string | null;
  postVisitInstructions?: string | null;
  cancellationReason?: string | null;
  canModify: boolean;
  createdAt: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface PatientWaitlistItem {
  _id: Id<"waitlist">;
  id?: string;
  clinicId: Id<"clinics">;
  clinicName: string;
  clinicSlug: string;
  patientId: Id<"patients">;
  patientName: string;
  isDependent: boolean;
  serviceId: Id<"services">;
  serviceName: string;
  preferredDentistId?: Id<"dentists"> | null;
  preferredDentistName?: string | null;
  preferredDateKey: string;
  preferredTimeWindow: "morning" | "afternoon" | "any";
  status: WaitlistStatus;
  createdAt: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface FeaturedClinicItem {
  _id: Id<"clinics">;
  id?: string;
  name: string;
  slug: string;
  tagline?: string | null;
  city: string;
  province: string;
  primaryColorHex: string;
  logoUrl?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface PatientAnnouncementItem {
  _id: Id<"systemAnnouncements">;
  id?: string;
  title: string;
  message: string;
  severity: "info" | "warning" | "critical";
  createdAt: number;
}

export interface PatientDashboardData {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  user?: any;
  profiles: PatientProfileItem[];
  appointments: PatientAppointmentItem[];
  waitlist: PatientWaitlistItem[];
  featuredClinics: FeaturedClinicItem[];
  announcements: PatientAnnouncementItem[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface PatientClinicalSummary {
  patientId?: Id<"patients">;
  toothRecords: Array<{
    _id: Id<"toothRecords">;
    toothNumber: number;
    surface?: ToothSurface | null;
    condition: ToothCondition;
    treatmentStatus: TreatmentStatus;
    notes?: string | null;
    recordedByDentistName?: string;
    updatedAt: number;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  }>;
  files: Array<{
    _id: Id<"clinicalFiles">;
    fileName: string;
    fileType: "xray_periapical" | "xray_panoramic" | "intraoral_photo" | "consent_form";
    sizeBytes: number;
    createdAt: number;
    url: string | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  }>;
  clinicalFiles: Array<{
    _id: Id<"clinicalFiles">;
    fileName: string;
    fileType: "xray_periapical" | "xray_panoramic" | "intraoral_photo" | "consent_form";
    sizeBytes: number;
    createdAt: number;
    url: string | null;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    [key: string]: any;
  }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  completedVisits: any[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

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
