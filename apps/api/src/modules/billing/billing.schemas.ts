import {
  ClinicFeatureFlagsSchema,
  PaymentBillingCycleSchema,
  PaymentMethodSchema,
  PaymentStatusSchema,
  SubscriptionPlanCodeSchema,
} from "@smile/shared";
import { z } from "zod";

export const upsertPlanSchema = z.object({
  code: SubscriptionPlanCodeSchema,
  name: z.string().trim().min(2).max(100),
  description: z.string().trim().min(2).max(500),
  monthlyPricePhp: z.number().int().min(0),
  annualPricePhp: z.number().int().min(0),
  trialDays: z.number().int().min(0).max(90),
  maxDentists: z.number().int().min(1),
  maxChairs: z.number().int().min(1),
  maxAppointmentsPerMonth: z.number().int().min(1),
  maxStorageBytes: z.number().int().positive(),
  maxEmailsPerMonth: z.number().int().positive(),
  defaultFeatures: ClinicFeatureFlagsSchema,
  isActive: z.boolean().default(true),
});

export const recordPaymentSchema = z
  .object({
    clinicId: z.string().uuid(),
    planId: z.string().uuid(),
    amountPhp: z.number().int().min(0),
    billingCycle: PaymentBillingCycleSchema,
    paymentMethod: PaymentMethodSchema,
    referenceNumber: z.string().trim().max(120).optional(),
    receiptStorageKey: z.string().trim().max(300).optional(),
    periodStart: z.coerce.date(),
    periodEnd: z.coerce.date(),
    status: PaymentStatusSchema,
    notes: z.string().trim().max(1000).optional(),
    syncDefaultFeatures: z.boolean().default(true),
  })
  .refine((data) => data.periodEnd.getTime() > data.periodStart.getTime(), {
    message: "periodEnd must be after periodStart",
    path: ["periodEnd"],
  });

export const updatePaymentStatusSchema = z.object({
  status: PaymentStatusSchema,
  notes: z.string().trim().max(1000).optional(),
});

export type UpsertPlanDto = z.infer<typeof upsertPlanSchema>;
export type RecordPaymentDto = z.infer<typeof recordPaymentSchema>;
export type UpdatePaymentStatusDto = z.infer<typeof updatePaymentStatusSchema>;
