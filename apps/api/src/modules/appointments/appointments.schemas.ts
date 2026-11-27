import {
  AppointmentStatusSchema,
  BookingSourceSchema,
  MedicalHistorySchema,
  PatientSexSchema,
  TimeWindowSchema,
  WaitlistStatusSchema,
} from "@smile/shared";
import { z } from "zod";

export const walkInPatientSchema = z.object({
  firstName: z.string().trim().min(1).max(80),
  lastName: z.string().trim().min(1).max(80),
  dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  sex: PatientSexSchema,
  phone: z.string().trim().min(5).max(40),
  email: z.string().trim().email().transform((s) => s.toLowerCase()).optional(),
  medicalHistory: MedicalHistorySchema.optional(),
});

export const createWalkInBookingSchema = z
  .object({
    patientId: z.string().uuid().optional(),
    newPatient: walkInPatientSchema.optional(),
    serviceId: z.string().uuid(),
    dentistId: z.string().uuid(),
    chairId: z.string().uuid(),
    dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    startTimeUtc: z.number().int().positive(),
    bookingSource: BookingSourceSchema.default("front_desk_walk_in"),
    chiefComplaint: z.string().trim().max(500).optional(),
    initialStatus: z
      .enum(["confirmed", "checked_in"])
      .default("confirmed"),
  })
  .refine((d) => Boolean(d.patientId || d.newPatient), {
    message: "Either patientId or newPatient details are required.",
    path: ["patientId"],
  });

export const transitionAppointmentStatusSchema = z.object({
  status: AppointmentStatusSchema,
  cancellationReason: z.string().trim().max(500).optional(),
  clinicalNotes: z.string().trim().max(4000).optional(),
  postVisitInstructions: z.string().trim().max(4000).optional(),
});

export const rescheduleAppointmentSchema = z.object({
  dateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  startTimeUtc: z.number().int().positive(),
  dentistId: z.string().uuid().optional(),
  chairId: z.string().uuid().optional(),
});

export const updateClinicalNotesSchema = z.object({
  clinicalNotes: z.string().trim().max(4000).optional(),
  postVisitInstructions: z.string().trim().max(4000).optional(),
});

export const staffAddWaitlistSchema = z.object({
  patientId: z.string().uuid(),
  serviceId: z.string().uuid(),
  preferredDentistId: z.string().uuid().optional(),
  preferredDateKey: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  preferredTimeWindow: TimeWindowSchema.default("any"),
});

export const updateWaitlistStatusSchema = z.object({
  status: WaitlistStatusSchema,
});

export type CreateWalkInBookingDto = z.infer<typeof createWalkInBookingSchema>;
export type TransitionAppointmentStatusDto = z.infer<
  typeof transitionAppointmentStatusSchema
>;
export type RescheduleAppointmentDto = z.infer<
  typeof rescheduleAppointmentSchema
>;
export type UpdateClinicalNotesDto = z.infer<typeof updateClinicalNotesSchema>;
export type StaffAddWaitlistDto = z.infer<typeof staffAddWaitlistSchema>;
export type UpdateWaitlistStatusDto = z.infer<typeof updateWaitlistStatusSchema>;
