import {
  MedicalHistorySchema,
  PatientSexSchema,
  TimeWindowSchema,
} from "@smile/shared";
import { z } from "zod";

export const createPatientProfileSchema = z.object({
  clinicId: z.string().uuid(),
  profileKind: z.enum(["self", "dependent"]).optional(),
  guardianPatientId: z.string().uuid().optional(),
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sex: PatientSexSchema,
  phone: z.string().trim().min(5).max(40),
  email: z.string().trim().email().transform((s) => s.toLowerCase()).optional(),
  address: z.string().trim().max(250).optional(),
  emergencyContactName: z.string().trim().max(120).optional(),
  emergencyContactPhone: z.string().trim().max(40).optional(),
  medicalHistory: MedicalHistorySchema.optional(),
});

export const updateMedicalProfileSchema = z.object({
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().min(1).max(80).optional(),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  sex: PatientSexSchema.optional(),
  email: z.string().trim().email().transform((s) => s.toLowerCase()).nullable().optional(),
  phone: z.string().trim().min(5).max(40).optional(),
  address: z.string().trim().max(250).nullable().optional(),
  emergencyContactName: z.string().trim().max(120).nullable().optional(),
  emergencyContactPhone: z.string().trim().max(40).nullable().optional(),
  medicalHistory: MedicalHistorySchema,
});

export const onlineBookingPatientProfileSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sex: PatientSexSchema,
  phone: z.string().trim().min(5).max(40),
  email: z
    .string()
    .trim()
    .email()
    .transform((s) => s.toLowerCase())
    .optional(),
  address: z.string().trim().max(250).optional(),
  emergencyContactName: z.string().trim().max(120).optional(),
  emergencyContactPhone: z.string().trim().max(40).optional(),
  medicalHistory: MedicalHistorySchema.optional(),
});

export const createOnlineBookingSchema = z
  .object({
    clinicSlug: z.string().trim().min(2).optional(),
    clinicId: z.string().uuid().optional(),
    patientId: z.string().uuid().optional(),
    bookingFor: z.enum(["self", "dependent"]).optional(),
    existingPatientId: z.string().uuid().optional(),
    patientProfile: onlineBookingPatientProfileSchema.optional(),
    lockId: z.string().optional(),
    serviceId: z.string().uuid(),
    dentistId: z.string().uuid(),
    chairId: z.string().uuid(),
    dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    startTimeUtc: z.number().int().positive(),
    sessionId: z.string().trim().min(4).max(120),
    chiefComplaint: z.string().trim().max(500).optional(),
  })
  .refine((d) => Boolean(d.clinicSlug || d.clinicId), {
    message: "Either clinicSlug or clinicId is required.",
    path: ["clinicSlug"],
  })
  .refine(
    (d) => Boolean(d.patientId || d.existingPatientId || d.patientProfile),
    {
      message: "Either patientId or patientProfile is required.",
      path: ["patientProfile"],
    }
  );

export const cancelMyAppointmentSchema = z.object({
  reason: z.string().trim().max(500).optional(),
});

export const rescheduleMyAppointmentSchema = z.object({
  dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTimeUtc: z.number().int().positive(),
  dentistId: z.string().uuid().optional(),
  chairId: z.string().uuid().optional(),
  sessionId: z.string().trim().min(4).max(120).optional(),
});

export const joinWaitlistSchema = z
  .object({
    clinicSlug: z.string().trim().min(2).optional(),
    clinicId: z.string().uuid().optional(),
    patientId: z.string().uuid(),
    serviceId: z.string().uuid(),
    preferredDentistId: z.string().uuid().optional(),
    preferredDateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    preferredTimeWindow: TimeWindowSchema.default("any"),
  })
  .refine((d) => Boolean(d.clinicSlug || d.clinicId), {
    message: "Either clinicSlug or clinicId is required.",
    path: ["clinicSlug"],
  });

export const claimWaitlistSchema = z.object({
  dentistId: z.string().uuid(),
  chairId: z.string().uuid(),
  dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTimeUtc: z.number().int().positive(),
  sessionId: z.string().trim().min(4).max(120).optional(),
});

export type CreatePatientProfileDto = z.infer<typeof createPatientProfileSchema>;
export type UpdateMedicalProfileDto = z.infer<typeof updateMedicalProfileSchema>;
export type CreateOnlineBookingDto = z.infer<typeof createOnlineBookingSchema>;
export type CancelMyAppointmentDto = z.infer<typeof cancelMyAppointmentSchema>;
export type RescheduleMyAppointmentDto = z.infer<
  typeof rescheduleMyAppointmentSchema
>;
export type JoinWaitlistDto = z.infer<typeof joinWaitlistSchema>;
export type ClaimWaitlistDto = z.infer<typeof claimWaitlistSchema>;
