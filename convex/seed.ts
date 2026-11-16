import { internalMutation } from "./_generated/server";

const MB = 1024 * 1024;

const PLANS = [
  {
    code: "trial",
    name: "Free 14-Day Trial",
    description: "Try Smile free for 14 days.",
    monthlyPricePhp: 0,
    annualPricePhp: 0,
    trialDays: 14,
    maxDentists: 1,
    maxChairs: 1,
    maxAppointmentsPerMonth: 50,
    maxStorageBytes: 50 * MB,
    maxEmailsPerMonth: 100,
    defaultFeatures: {
      odontogramEnabled: true,
      xrayStorageEnabled: false,
      waitlistAutomationEnabled: false,
      recallAutomationEnabled: false,
      customBrandingEnabled: false,
    },
    isActive: true,
  },
  {
    code: "starter",
    name: "Smile Starter",
    description: "For small clinics getting started.",
    monthlyPricePhp: 1499,
    annualPricePhp: 14990,
    trialDays: 0,
    maxDentists: 2,
    maxChairs: 2,
    maxAppointmentsPerMonth: 300,
    maxStorageBytes: 150 * MB,
    maxEmailsPerMonth: 400,
    defaultFeatures: {
      odontogramEnabled: true,
      xrayStorageEnabled: true,
      waitlistAutomationEnabled: false,
      recallAutomationEnabled: false,
      customBrandingEnabled: false,
    },
    isActive: true,
  },
  {
    code: "pro",
    name: "Smile Pro Clinic",
    description: "Full Odontogram, X-ray vault and recall automation.",
    monthlyPricePhp: 2999,
    annualPricePhp: 29990,
    trialDays: 0,
    maxDentists: 8,
    maxChairs: 8,
    maxAppointmentsPerMonth: 1500,
    maxStorageBytes: 400 * MB,
    maxEmailsPerMonth: 1000,
    defaultFeatures: {
      odontogramEnabled: true,
      xrayStorageEnabled: true,
      waitlistAutomationEnabled: true,
      recallAutomationEnabled: true,
      customBrandingEnabled: true,
    },
    isActive: true,
  },
] as const;

/**
 * Idempotent platform seed. Run with:
 *   npx convex run seed:initializePlatform
 * (internal: not callable from clients).
 */
export const initializePlatform = internalMutation({
  args: {},
  handler: async (ctx) => {
    let created = 0;
    for (const plan of PLANS) {
      const existing = await ctx.db
        .query("subscriptionPlans")
        .withIndex("by_code", (q) => q.eq("code", plan.code))
        .unique();
      if (!existing) {
        await ctx.db.insert("subscriptionPlans", plan);
        created++;
      }
    }
    return { plansCreated: created };
  },
});
