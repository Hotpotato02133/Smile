import {
  OperatingHoursDaySchema,
  ServiceCategorySchema,
  WeeklyScheduleDaySchema,
} from "@smile/shared";
import { z } from "zod";

export const updateClinicSettingsSchema = z.object({
  name: z.string().trim().min(2).max(140).optional(),
  tagline: z.string().trim().max(200).nullable().optional(),
  logoStorageKey: z.string().trim().max(300).nullable().optional(),
  primaryColorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  email: z.string().trim().email().transform((s) => s.toLowerCase()).optional(),
  phone: z.string().trim().min(5).max(40).optional(),
  address: z.string().trim().min(3).max(250).optional(),
  city: z.string().trim().min(2).max(100).optional(),
  province: z.string().trim().min(2).max(100).optional(),
  timezone: z.string().trim().min(2).optional(),
  slotIntervalMinutes: z.number().int().refine((v) => v === 15 || v === 30).optional(),
  cancellationWindowHours: z.number().int().min(0).max(168).optional(),
  emergencyBufferMinutesPerDay: z.number().int().min(0).max(240).optional(),
  requireBookingApproval: z.boolean().optional(),
  operatingHours: z.array(OperatingHoursDaySchema).length(7).optional(),
});

export const createDentistSchema = z.object({
  userId: z.string().uuid().optional(),
  email: z.string().trim().email().transform((s) => s.toLowerCase()).optional(),
  firstName: z.string().trim().min(1).max(80).optional(),
  lastName: z.string().trim().max(80).optional(),
  displayName: z.string().trim().min(2).max(120),
  licenseNumber: z.string().trim().min(2).max(60),
  specialties: z.array(z.string().trim().min(1)).min(1),
  bio: z.string().trim().max(1000).optional(),
  calendarColorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).default("#0284c7"),
  defaultChairId: z.string().uuid().nullable().optional(),
  weeklySchedule: z.array(WeeklyScheduleDaySchema).length(7).optional(),
});

export const updateDentistSchema = z.object({
  displayName: z.string().trim().min(2).max(120).optional(),
  licenseNumber: z.string().trim().min(2).max(60).optional(),
  specialties: z.array(z.string().trim().min(1)).min(1).optional(),
  bio: z.string().trim().max(1000).nullable().optional(),
  calendarColorHex: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  defaultChairId: z.string().uuid().nullable().optional(),
  weeklySchedule: z.array(WeeklyScheduleDaySchema).length(7).optional(),
});

export const addDentistTimeOffSchema = z
  .object({
    startTimeUtc: z.coerce.date(),
    endTimeUtc: z.coerce.date(),
    reason: z.string().trim().min(2).max(300),
  })
  .refine((d) => d.endTimeUtc.getTime() > d.startTimeUtc.getTime(), {
    message: "endTimeUtc must be after startTimeUtc",
    path: ["endTimeUtc"],
  });

export const createChairSchema = z.object({
  name: z.string().trim().min(2).max(120),
  roomCode: z.string().trim().min(1).max(30),
  supportedCategoryTags: z.array(z.string().trim().min(1)).default(["General"]),
});

export const updateChairSchema = createChairSchema.partial();

export const createServiceSchema = z.object({
  name: z.string().trim().min(2).max(140),
  category: ServiceCategorySchema,
  description: z.string().trim().min(2).max(600),
  durationMinutes: z.number().int().min(5).max(480),
  bufferMinutes: z.number().int().min(0).max(120),
  pricePhp: z.number().int().min(0),
  requiresXray: z.boolean().default(false),
  requiredChairTag: z.string().trim().max(60).nullable().optional(),
});

export const updateServiceSchema = createServiceSchema.partial();

export const inviteClinicStaffSchema = z.object({
  email: z.string().trim().email().transform((s) => s.toLowerCase()),
  role: z.enum(["clinic_admin", "dentist", "receptionist"]),
  inviterNote: z.string().trim().max(500).optional(),
  expiresInDays: z.number().int().min(1).max(30).default(7),
});

export type UpdateClinicSettingsDto = z.infer<typeof updateClinicSettingsSchema>;
export type CreateDentistDto = z.infer<typeof createDentistSchema>;
export type UpdateDentistDto = z.infer<typeof updateDentistSchema>;
export type AddDentistTimeOffDto = z.infer<typeof addDentistTimeOffSchema>;
export type CreateChairDto = z.infer<typeof createChairSchema>;
export type UpdateChairDto = z.infer<typeof updateChairSchema>;
export type CreateServiceDto = z.infer<typeof createServiceSchema>;
export type UpdateServiceDto = z.infer<typeof updateServiceSchema>;
export type InviteClinicStaffDto = z.infer<typeof inviteClinicStaffSchema>;
