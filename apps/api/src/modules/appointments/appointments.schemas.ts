import {
  AppointmentStatusSchema,
  BookingSourceSchema,
  MedicalHistorySchema,
  PatientSexSchema,
  TimeWindowSchema,
  WaitlistStatusSchema,
} from "@smile/shared";
import { z } from "zod";

export const walkInPatientSchema = z
  .object({
    firstName: z.string().trim().min(1).max(80),
    lastName: z.string().trim().min(1).max(80),
    dateOfBirth: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    sex: PatientSexSchema,
    phone: z.string().trim().min(5).max(40),
    email: z.string().trim().email().transform((s) => s.toLowerCase()).optional(),
    medicalHistory: MedicalHistorySchema.optional(),
    allergies: z.array(z.string().trim()).optional(),
    conditions: z.array(z.string().trim()).optional(),
    isTakingBloodThinners: z.boolean().optional(),
    isPregnant: z.boolean().optional(),
    dentalAnxietyLevel: z.enum(["none", "mild", "moderate", "severe"]).optional(),
    notes: z.string().trim().max(1000).optional(),
  })
  .transform((p) => {
    const medicalHistory = p.medicalHistory ?? {
      allergies: p.allergies ?? [],
      conditions: p.conditions ?? [],
      isTakingBloodThinners: Boolean(p.isTakingBloodThinners),
      isPregnant: Boolean(p.isPregnant),
      dentalAnxietyLevel: p.dentalAnxietyLevel ?? ("none" as const),
      notes: p.notes,
    };
    return {
      firstName: p.firstName,
      lastName: p.lastName,
      dateOfBirth: p.dateOfBirth,
      sex: p.sex,
      phone: p.phone,
      email: p.email,
      medicalHistory,
    };
  });

export const createWalkInBookingSchema = z
  .object({
    patientId: z.string().uuid().optional(),
    existingPatientId: z.string().uuid().optional(),
    waitlistId: z.string().uuid().optional(),
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
  .refine((d) => Boolean(d.patientId || d.existingPatientId || d.newPatient), {
    message: "Either patientId or newPatient details are required.",
    path: ["patientId"],
  })
  .transform((d) => ({
    ...d,
    patientId: d.patientId ?? d.existingPatientId,
  }));

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

export const createMyTimeOffSchema = z
  .object({
    dentistId: z.string().uuid().optional(),
    startTimeUtc: z.coerce.date(),
    endTimeUtc: z.coerce.date(),
    reason: z.string().trim().min(2).max(300).default("Time off"),
  })
  .refine((d) => d.endTimeUtc.getTime() > d.startTimeUtc.getTime(), {
    message: "endTimeUtc must be after startTimeUtc.",
    path: ["endTimeUtc"],
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
export type CreateMyTimeOffDto = z.infer<typeof createMyTimeOffSchema>;
