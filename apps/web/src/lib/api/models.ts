import type {
  AnnouncementAudience,
  AnnouncementSeverity,
  AppointmentStatus,
  AvailableSlotDto,
  BillingCycle,
  BookingSource,
  ClinicFeatureFlags,
  ClinicStatus,
  ClinicalFileType,
  EmailDeliveryStatus,
  MedicalHistory,
  OperatingHoursDay,
  PatientSex,
  PaymentBillingCycle,
  PaymentMethod,
  PaymentStatus,
  ServiceCategory,
  StaffInvitationRole,
  StaffInvitationStatus,
  SubscriptionPlanCode,
  TimeWindow,
  ToothCondition,
  ToothSurface,
  TreatmentStatus,
  UserRole,
  WaitlistStatus,
  WeeklyScheduleDay,
} from "@smile/shared";
import type { CalendarAppointmentItem } from "@/components/front-desk/master-calendar";
import type { Id } from "./types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyRecord = Record<string, any>;

export interface SubscriptionPlanDoc {
  _id: Id<"subscriptionPlans">;
  id: string;
  code: SubscriptionPlanCode;
  name: string;
  description: string;
  monthlyPricePhp: number;
  annualPricePhp: number;
  trialDays: number;
  maxDentists: number;
  maxChairs: number;
  maxAppointmentsPerMonth: number;
  maxStorageBytes: number;
  maxEmailsPerMonth: number;
  defaultFeatures: ClinicFeatureFlags;
  isActive: boolean;
}

export interface ClinicDoc {
  _id: Id<"clinics">;
  id: string;
  name: string;
  slug: string;
  tagline?: string;
  logoStorageId?: Id<"_storage">;
  logoStorageKey?: string | null;
  primaryColorHex: string;
  email: string;
  phone: string;
  address: string;
  city: string;
  province: string;
  timezone: string;
  ownerUserId?: Id<"users">;
  planId: Id<"subscriptionPlans">;
  status: ClinicStatus;
  billingCycle: BillingCycle;
  trialEndsAt?: number;
  subscriptionStartsAt: number;
  subscriptionEndsAt: number;
  gracePeriodEndsAt?: number;
  featureFlags: ClinicFeatureFlags;
  activeDentistCount: number;
  activeChairCount: number;
  currentMonthKey: string;
  currentMonthAppointmentCount: number;
  currentMonthEmailCount: number;
  storageUsedBytes: number;
  lifetimeAppointmentCount: number;
  slotIntervalMinutes: number;
  cancellationWindowHours: number;
  emergencyBufferMinutesPerDay: number;
  requireBookingApproval?: boolean;
  operatingHours: OperatingHoursDay[];
  createdAt: number;
  updatedAt: number;
}

export interface ChairDoc {
  _id: Id<"chairs">;
  id: string;
  clinicId: Id<"clinics">;
  name: string;
  roomCode: string;
  supportedCategoryTags: string[];
  isActive: boolean;
}

export interface ServiceDoc {
  _id: Id<"services">;
  id: string;
  clinicId: Id<"clinics">;
  name: string;
  category: ServiceCategory;
  description: string;
  durationMinutes: number;
  bufferMinutes: number;
  pricePhp: number;
  requiresXray: boolean;
  requiredChairTag?: string;
  isActive: boolean;
}

export interface PatientDoc {
  _id: Id<"patients">;
  id: string;
  clinicId: Id<"clinics">;
  userId?: Id<"users">;
  guardianPatientId?: Id<"patients">;
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  sex: PatientSex;
  email?: string;
  phone: string;
  address?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
  medicalHistory: MedicalHistory;
  lastCleaningDate?: string;
  nextRecallDate?: string;
  noShowCount: number;
  createdAt: number;
  hasMedicalAlert?: boolean;
}

export interface SystemAnnouncementDoc {
  _id: Id<"systemAnnouncements">;
  id: string;
  title: string;
  message: string;
  severity: AnnouncementSeverity;
  targetAudience: AnnouncementAudience;
  isActive: boolean;
  expiresAt?: number;
  createdByUserId: Id<"users">;
  createdAt: number;
}

export interface DentistDoc {
  _id: Id<"dentists">;
  id: string;
  clinicId: Id<"clinics">;
  userId: Id<"users">;
  displayName: string;
  licenseNumber: string;
  specialties: string[];
  bio?: string;
  calendarColorHex: string;
  defaultChairId?: Id<"chairs">;
  weeklySchedule: WeeklyScheduleDay[];
  isActive: boolean;
  timeOff: AnyRecord[];
  upcomingTimeOff?: AnyRecord[];
  timeOffs?: AnyRecord[];
  email?: string;
}

export interface UserDoc {
  _id: Id<"users">;
  id: string;
  clerkId?: string;
  name: string;
  email: string;
  firstName: string;
  lastName: string;
  phone: string;
  avatarUrl?: string;
  role: UserRole;
  clinicId: Id<"clinics"> | null;
  clinicName?: string | null;
  isActive: boolean;
  isRootOwner: boolean;
  lastLoginAt?: number;
  createdAt: number;
}

export interface StaffInvitationDoc {
  _id: Id<"staffInvitations">;
  id: string;
  clinicId?: Id<"clinics"> | null;
  clinicName: string | null;
  email: string;
  role: StaffInvitationRole;
  token?: string;
  inviterNote?: string;
  invitedByUserId: Id<"users">;
  status: StaffInvitationStatus | "expired";
  declineReason?: string;
  emailStatus?: EmailDeliveryStatus;
  emailError?: string;
  respondedAt?: number;
  expiresAt: number;
  createdAt: number;
}

export interface PaymentDoc {
  _id: Id<"subscriptionPayments">;
  id: string;
  clinicId: Id<"clinics">;
  planId: Id<"subscriptionPlans">;
  invoiceNumber: string;
  amountPhp: number;
  billingCycle: PaymentBillingCycle;
  paymentMethod: PaymentMethod;
  referenceNumber?: string;
  receiptStorageId?: Id<"_storage">;
  receiptStorageKey?: string | null;
  receiptUrl?: string | null;
  periodStart: number;
  periodEnd: number;
  status: PaymentStatus;
  notes?: string;
  recordedByUserId: Id<"users">;
  paidAt?: number;
  createdAt: number;
  clinicName: string;
  clinicSlug: string;
  planName: string;
  planCode: SubscriptionPlanCode;
}

export interface DocMap {
  subscriptionPlans: SubscriptionPlanDoc;
  clinics: ClinicDoc;
  chairs: ChairDoc;
  services: ServiceDoc;
  patients: PatientDoc;
  systemAnnouncements: SystemAnnouncementDoc;
  dentists: DentistDoc;
  users: UserDoc;
  staffInvitations: StaffInvitationDoc;
  subscriptionPayments: PaymentDoc;
}

export type Doc<T extends keyof DocMap> = DocMap[T];

export interface PublicClinicSummary {
  _id: Id<"clinics">;
  id: string;
  name: string;
  slug: string;
  tagline?: string | null;
  logoUrl?: string | null;
  primaryColorHex: string;
  city: string;
  province: string;
  address: string;
  phone: string;
  isBookable: boolean;
  operatingHours?: OperatingHoursDay[];
  serviceCount?: number;
  dentistCount?: number;
  startingPricePhp?: number | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface PublicDentistSummary {
  _id: Id<"dentists">;
  id: string;
  displayName: string;
  specialties: string[];
  bio?: string | null;
  calendarColorHex: string;
  weeklySchedule: WeeklyScheduleDay[];
  workingDays: number[];
}

export interface PublicClinicPortal {
  clinic: ClinicDoc & {
    logoUrl?: string | null;
    isBookable: boolean;
    blockedReason: string | null;
    waitlistAutomationEnabled: boolean;
  };
  isBookable: boolean;
  unbookableReason?: string | null;
  services: ServiceDoc[];
  dentists: PublicDentistSummary[];
}

export type AvailableSlot = AvailableSlotDto;

export interface AvailableSlotsResult {
  isBookable: boolean;
  blockedReason: string | null;
  slots: AvailableSlot[];
}

export interface MyClinicProfilesResult {
  selfProfile: PatientDoc | null;
  fallbackSelfProfile?: PatientDoc | null;
  dependents: PatientDoc[];
  user: {
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
  };
}

export interface ClinicDailyMetricsResult {
  rows: AnyRecord[];
  totals: AnyRecord;
  rates: AnyRecord;
  includesLiveToday: boolean;
  timeZone: string;
  topServices: AnyRecord[];
  dentistUtilization: AnyRecord[];
}

export interface DentistsListResult {
  dentists: Array<DentistDoc & AnyRecord>;
  chairs: ChairDoc[];
  availableUsers: UserDoc[];
}

export interface DentistTimeOffResult {
  dentistId: string | null;
  dentistName: string | null;
  blocks: AnyRecord[];
}

export interface TimeOffConflictsResult {
  conflicts: AnyRecord[];
}

export interface PlatformUsersListResult {
  callerIsRootOwner: boolean;
  users: Array<UserDoc & AnyRecord>;
}

export interface InvitationPublicDetails {
  _id: Id<"staffInvitations">;
  id: string;
  email: string;
  role: StaffInvitationRole;
  status: StaffInvitationStatus | "expired";
  inviterNote?: string | null;
  inviterName: string;
  clinic: {
    _id?: Id<"clinics">;
    id: string;
    name: string;
    slug: string;
    primaryColorHex: string;
    city: string;
  } | null;
  expiresAt: number;
  createdAt: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface AuditLogItem {
  _id: Id<"platformAuditLogs">;
  id: string;
  actorUserId: Id<"users">;
  actorRole: string;
  actorName: string;
  actorEmail: string;
  clinicId?: Id<"clinics"> | null;
  clinicName?: string | null;
  actionType: string;
  targetEntity: string;
  targetId: string;
  metadataJson: string;
  createdAt: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface ToothRecordItem {
  _id: Id<"toothRecords">;
  id: string;
  toothNumber: number;
  surface?: ToothSurface;
  condition: ToothCondition;
  treatmentStatus: TreatmentStatus;
  notes?: string;
  appointmentId?: Id<"appointments">;
  recordedByDentistId: Id<"dentists">;
  recordedByDentistName: string;
  updatedAt: number;
}

export interface ClinicalFileItem {
  _id: Id<"clinicalFiles">;
  id: string;
  fileName: string;
  fileType: ClinicalFileType;
  sizeBytes: number;
  createdAt: number;
  url: string | null;
}

export interface WaitlistItem {
  _id: Id<"waitlist">;
  id: string;
  clinicId: Id<"clinics">;
  patientId: Id<"patients">;
  serviceId: Id<"services">;
  preferredDentistId?: Id<"dentists"> | null;
  preferredDateKey: string;
  preferredTimeWindow: TimeWindow;
  status: WaitlistStatus;
  createdAt: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface AppointmentItem {
  _id: Id<"appointments">;
  id: string;
  clinicId: Id<"clinics">;
  patientId: Id<"patients">;
  dentistId: Id<"dentists">;
  chairId: Id<"chairs">;
  serviceId: Id<"services">;
  dateKey: string;
  startTimeUtc: number;
  endTimeUtc: number;
  bufferEndTimeUtc: number;
  status: AppointmentStatus;
  bookingSource: BookingSource;
  chiefComplaint?: string | null;
  clinicalNotes?: string | null;
  postVisitInstructions?: string | null;
  cancellationReason?: string | null;
  createdAt: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface FrontDeskWorkspaceData {
  dateKey: string;
  appointments: CalendarAppointmentItem[];
  pendingRequests: CalendarAppointmentItem[];
  dentists: Array<DentistDoc & AnyRecord>;
  chairs: ChairDoc[];
  services: ServiceDoc[];
  waitlist: WaitlistItem[];
  announcements?: SystemAnnouncementDoc[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface DentistQueueData {
  dateKey: string;
  selectedDentistId: string | null;
  hasLinkedDentistProfile: boolean;
  canSwitchDentist: boolean;
  dentists: Array<DentistDoc & AnyRecord>;
  appointments: AppointmentItem[];
  queue: AppointmentItem[];
  announcements?: SystemAnnouncementDoc[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface PlatformDashboardOverviewData {
  totalClinics: number;
  activePaidClinics: number;
  trialClinics: number;
  pastDueClinics: number;
  suspendedClinics: number;
  archivedClinics: number;
  trialToPaidConversionPct: number;
  totalUsers: number;
  userBreakdown: { patients: number; clinicStaff: number; superAdmins: number };
  mrrPhp: number;
  arrPhp: number;
  collectedThisMonthPhp: number;
  paidInvoicesThisMonthCount: number;
  pendingPaymentsCount: number;
  currentMonthAppointments: number;
  lifetimeAppointments: number;
  todayAppointments: number;
  planDistribution: Array<{ code: string; name: string; count: number; mrrPhp: number }>;
  statusDistribution: Array<{ status: string; label: string; count: number }>;
  renewalQueue: Array<ClinicDoc & AnyRecord>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface FreeTierUsageData {
  storage: {
    usedBytes: number;
    limitBytes: number;
    usagePct: number;
    percentUsed: number;
    topClinics: Array<{ _id: Id<"clinics">; name: string; slug: string; storageUsedBytes: number }>;
  };
  emails: {
    usedThisMonth: number;
    sentThisMonth: number;
    limitPerMonth: number;
    monthlyLimit: number;
    usagePct: number;
    percentUsed: number;
    topClinics: Array<{ _id: Id<"clinics">; name: string; slug: string; currentMonthEmailCount: number }>;
  };
  users: {
    totalActive: number;
    limitMau: number;
    usagePct: number;
    percentUsed: number;
  };
  clerkMau: {
    activeLast30Days: number;
    monthlyLimit: number;
    percentUsed: number;
  };
  totalClinics: number;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface PatientChartData {
  patient: PatientDoc;
  odontogramEnabled: boolean;
  xrayStorageEnabled: boolean;
  isSuperAdminOverride: boolean;
  toothRecords: ToothRecordItem[];
  files: ClinicalFileItem[];
  recentAppointments: Array<{
    _id: Id<"appointments">;
    dateKey: string;
    startTimeUtc: number;
    status: AppointmentStatus;
    chiefComplaint: string | null;
    clinicalNotes: string | null;
    postVisitInstructions: string | null;
    serviceName: string;
    dentistName: string;
  }>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}

export interface ClinicDetailData extends ClinicDoc {
  clinic: ClinicDoc;
  staffCount: number;
  plan?: SubscriptionPlanDoc;
  payments: PaymentDoc[];
  users: UserDoc[];
  invitations: StaffInvitationDoc[];
  pendingInvitations: StaffInvitationDoc[];
  recentAuditLogs: AuditLogItem[];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  [key: string]: any;
}
