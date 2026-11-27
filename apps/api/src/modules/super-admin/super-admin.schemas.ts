import {
  AnnouncementAudienceSchema,
  AnnouncementSeveritySchema,
  BillingCycleSchema,
  ClinicFeatureFlagsSchema,
  ClinicStatusSchema,
  OperatingHoursDaySchema,
  StaffInvitationRoleSchema,
  UserRoleSchema,
} from "@smile/shared";
import { z } from "zod";

export const createClinicSchema = z.object({
  name: z.string().trim().min(2).max(140),
  slug: z
    .string()
    .trim()
    .toLowerCase()
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "Slug must be lowercase alphanumeric with hyphens"),
  tagline: z.string().trim().max(200).optional(),
  primaryColorHex: z
    .string()
    .regex(/^#[0-9a-fA-F]{6}$/, "Must be a 6-digit hex color")
    .default("#0284c7"),
  email: z.string().trim().email().transform((s) => s.toLowerCase()),
  phone: z.string().trim().min(5).max(40),
  address: z.string().trim().min(3).max(250),
  city: z.string().trim().min(2).max(100),
  province: z.string().trim().min(2).max(100),
  timezone: z.string().trim().default("Asia/Manila"),
  planId: z.string().uuid(),
  billingCycle: BillingCycleSchema.default("trial"),
  status: ClinicStatusSchema.optional(),
  durationDays: z.number().int().min(1).max(730).optional(),
  adminInviteEmail: z
    .string()
    .trim()
    .email()
    .transform((s) => s.toLowerCase())
    .optional(),
  seedDefaultServices: z.boolean().default(true),
});

export const updateClinicDetailsSchema = z.object({
  name: z.string().trim().min(2).max(140).optional(),
  tagline: z.string().trim().max(200).nullable().optional(),
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

export const updateClinicStatusSchema = z.object({
  status: ClinicStatusSchema,
  reason: z.string().trim().max(500).optional(),
});

export const changeClinicPlanSchema = z.object({
  planId: z.string().uuid(),
  billingCycle: BillingCycleSchema.optional(),
  syncDefaultFeatures: z.boolean().default(true),
});

export const updateClinicFeaturesSchema = z.object({
  featureFlags: ClinicFeatureFlagsSchema,
});

export const extendClinicSubscriptionSchema = z.object({
  days: z.number().int().min(1).max(730),
  reactivateIfSuspended: z.boolean().default(true),
  reason: z.string().trim().max(500).optional(),
});

export const createRoleInvitationSchema = z.object({
  email: z.string().trim().email().transform((s) => s.toLowerCase()),
  role: StaffInvitationRoleSchema,
  clinicId: z.string().uuid().optional(),
  inviterNote: z.string().trim().max(500).optional(),
  expiresInDays: z.number().int().min(1).max(30).default(7),
});

export const updateUserRoleOrStatusSchema = z.object({
  role: UserRoleSchema.optional(),
  clinicId: z.string().uuid().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const createAnnouncementSchema = z.object({
  title: z.string().trim().min(2).max(160),
  message: z.string().trim().min(2).max(2000),
  severity: AnnouncementSeveritySchema,
  targetAudience: AnnouncementAudienceSchema,
  expiresAt: z.coerce.date().nullable().optional(),
});

export const updateAnnouncementSchema = createAnnouncementSchema.partial().extend({
  isActive: z.boolean().optional(),
});

export type CreateClinicDto = z.infer<typeof createClinicSchema>;
export type UpdateClinicDetailsDto = z.infer<typeof updateClinicDetailsSchema>;
export type UpdateClinicStatusDto = z.infer<typeof updateClinicStatusSchema>;
export type ChangeClinicPlanDto = z.infer<typeof changeClinicPlanSchema>;
export type UpdateClinicFeaturesDto = z.infer<typeof updateClinicFeaturesSchema>;
export type ExtendClinicSubscriptionDto = z.infer<typeof extendClinicSubscriptionSchema>;
export type CreateRoleInvitationDto = z.infer<typeof createRoleInvitationSchema>;
export type UpdateUserRoleOrStatusDto = z.infer<typeof updateUserRoleOrStatusSchema>;
export type CreateAnnouncementDto = z.infer<typeof createAnnouncementSchema>;
export type UpdateAnnouncementDto = z.infer<typeof updateAnnouncementSchema>;
