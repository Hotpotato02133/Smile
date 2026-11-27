import {
  ClinicalFileTypeSchema,
  ToothConditionSchema,
  ToothSurfaceSchema,
  TreatmentStatusSchema,
} from "@smile/shared";
import { z } from "zod";

export const recordToothConditionSchema = z.object({
  toothNumber: z
    .number()
    .int()
    .refine((n) => (n >= 1 && n <= 32) || (n >= 51 && n <= 85), {
      message: "Tooth number must be 1-32 (adult) or 51-85 (pediatric).",
    }),
  surface: ToothSurfaceSchema.default("WholeTooth"),
  condition: ToothConditionSchema,
  treatmentStatus: TreatmentStatusSchema,
  notes: z.string().trim().max(1000).optional(),
  appointmentId: z.string().uuid().optional(),
  dentistId: z.string().uuid().optional(),
});

export const setPatientRecallSchema = z.object({
  lastCleaningDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  nextRecallDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const confirmClinicalFileSchema = z.object({
  patientId: z.string().uuid(),
  appointmentId: z.string().uuid().optional(),
  storageKey: z.string().trim().min(10).max(300),
  fileName: z.string().trim().min(1).max(160),
  fileType: ClinicalFileTypeSchema,
});

export type RecordToothConditionDto = z.infer<typeof recordToothConditionSchema>;
export type SetPatientRecallDto = z.infer<typeof setPatientRecallSchema>;
export type ConfirmClinicalFileDto = z.infer<typeof confirmClinicalFileSchema>;
