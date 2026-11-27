import { z } from "zod";

export const UserRoleSchema = z.enum([
  "super_admin",
  "clinic_admin",
  "dentist",
  "receptionist",
  "patient",
]);
export type UserRole = z.infer<typeof UserRoleSchema>;

export const StaffInvitationRoleSchema = z.enum([
  "super_admin",
  "clinic_admin",
  "dentist",
  "receptionist",
]);
export type StaffInvitationRole = z.infer<typeof StaffInvitationRoleSchema>;

export const StaffInvitationStatusSchema = z.enum([
  "pending",
  "accepted",
  "declined",
  "revoked",
]);
export type StaffInvitationStatus = z.infer<typeof StaffInvitationStatusSchema>;

export const EmailDeliveryStatusSchema = z.enum([
  "queued",
  "sent",
  "failed",
  "skipped",
]);
export type EmailDeliveryStatus = z.infer<typeof EmailDeliveryStatusSchema>;

export const SubscriptionPlanCodeSchema = z.enum([
  "trial",
  "starter",
  "pro",
  "enterprise",
]);
export type SubscriptionPlanCode = z.infer<typeof SubscriptionPlanCodeSchema>;

export const ClinicStatusSchema = z.enum([
  "trial",
  "active",
  "past_due",
  "suspended",
  "archived",
]);
export type ClinicStatus = z.infer<typeof ClinicStatusSchema>;

export const BillingCycleSchema = z.enum(["monthly", "annual", "trial"]);
export type BillingCycle = z.infer<typeof BillingCycleSchema>;

export const PaymentBillingCycleSchema = z.enum(["monthly", "annual"]);
export type PaymentBillingCycle = z.infer<typeof PaymentBillingCycleSchema>;

export const PaymentMethodSchema = z.enum([
  "gcash",
  "maya",
  "bank_transfer",
  "card",
  "cash",
  "manual_waiver",
]);
export type PaymentMethod = z.infer<typeof PaymentMethodSchema>;

export const PaymentStatusSchema = z.enum([
  "paid",
  "pending",
  "overdue",
  "refunded",
]);
export type PaymentStatus = z.infer<typeof PaymentStatusSchema>;

export const ServiceCategorySchema = z.enum([
  "Preventive",
  "Restorative",
  "Cosmetic",
  "Orthodontics",
  "Endodontics",
  "Oral Surgery",
  "Emergency",
]);
export type ServiceCategory = z.infer<typeof ServiceCategorySchema>;

export const AppointmentStatusSchema = z.enum([
  "pending_approval",
  "confirmed",
  "checked_in",
  "in_chair",
  "completed",
  "cancelled",
  "no_show",
]);
export type AppointmentStatus = z.infer<typeof AppointmentStatusSchema>;

export const BookingSourceSchema = z.enum([
  "patient_online",
  "front_desk_walk_in",
  "front_desk_phone",
  "dentist_followup",
  "waitlist_claim",
]);
export type BookingSource = z.infer<typeof BookingSourceSchema>;

export const PatientSexSchema = z.enum(["male", "female", "other"]);
export type PatientSex = z.infer<typeof PatientSexSchema>;

export const DentalAnxietyLevelSchema = z.enum([
  "none",
  "mild",
  "moderate",
  "severe",
]);
export type DentalAnxietyLevel = z.infer<typeof DentalAnxietyLevelSchema>;

export const ToothSurfaceSchema = z.enum([
  "Mesial",
  "Distal",
  "Occlusal",
  "Buccal",
  "Lingual",
  "WholeTooth",
]);
export type ToothSurface = z.infer<typeof ToothSurfaceSchema>;

export const ToothConditionSchema = z.enum([
  "sound",
  "caries",
  "composite_filling",
  "amalgam_filling",
  "crown",
  "root_canal",
  "extraction_needed",
  "missing",
  "implant",
]);
export type ToothCondition = z.infer<typeof ToothConditionSchema>;

export const TreatmentStatusSchema = z.enum([
  "existing",
  "planned",
  "completed",
]);
export type TreatmentStatus = z.infer<typeof TreatmentStatusSchema>;

export const ClinicalFileTypeSchema = z.enum([
  "xray_periapical",
  "xray_panoramic",
  "intraoral_photo",
  "consent_form",
]);
export type ClinicalFileType = z.infer<typeof ClinicalFileTypeSchema>;

export const TimeWindowSchema = z.enum(["morning", "afternoon", "any"]);
export type TimeWindow = z.infer<typeof TimeWindowSchema>;

export const WaitlistStatusSchema = z.enum([
  "waiting",
  "notified",
  "claimed",
  "expired",
]);
export type WaitlistStatus = z.infer<typeof WaitlistStatusSchema>;

export const AnnouncementSeveritySchema = z.enum([
  "info",
  "warning",
  "critical",
]);
export type AnnouncementSeverity = z.infer<typeof AnnouncementSeveritySchema>;

export const AnnouncementAudienceSchema = z.enum([
  "all_clinic_staff",
  "clinic_admins_only",
  "all_users",
]);
export type AnnouncementAudience = z.infer<typeof AnnouncementAudienceSchema>;

export const ClinicFeatureFlagsSchema = z.object({
  odontogramEnabled: z.boolean(),
  xrayStorageEnabled: z.boolean(),
  waitlistAutomationEnabled: z.boolean(),
  recallAutomationEnabled: z.boolean(),
  customBrandingEnabled: z.boolean(),
});
export type ClinicFeatureFlags = z.infer<typeof ClinicFeatureFlagsSchema>;
export type ClinicFeatureFlag = keyof ClinicFeatureFlags;

export const OperatingHoursDaySchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  isOpen: z.boolean(),
  openMinute: z.number().int().min(0).max(1439),
  closeMinute: z.number().int().min(0).max(1439),
});
export type OperatingHoursDay = z.infer<typeof OperatingHoursDaySchema>;

export const WeeklyScheduleDaySchema = z.object({
  dayOfWeek: z.number().int().min(0).max(6),
  isWorking: z.boolean(),
  startMinute: z.number().int().min(0).max(1439),
  endMinute: z.number().int().min(0).max(1439),
  breakStartMinute: z.number().int().min(0).max(1439).optional(),
  breakEndMinute: z.number().int().min(0).max(1439).optional(),
});
export type WeeklyScheduleDay = z.infer<typeof WeeklyScheduleDaySchema>;

export const MedicalHistorySchema = z.object({
  allergies: z.array(z.string()),
  conditions: z.array(z.string()),
  isTakingBloodThinners: z.boolean(),
  isPregnant: z.boolean(),
  dentalAnxietyLevel: DentalAnxietyLevelSchema,
  notes: z.string().optional(),
});
export type MedicalHistory = z.infer<typeof MedicalHistorySchema>;
