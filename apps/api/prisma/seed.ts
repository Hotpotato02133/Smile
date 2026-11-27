import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, SubscriptionPlanCode } from "@prisma/client";
import { Pool } from "pg";

const MB = BigInt(1024 * 1024);

const PLANS = [
  {
    code: SubscriptionPlanCode.trial,
    name: "Free 14-Day Trial",
    description: "Try Smile free for 14 days.",
    monthlyPricePhp: 0,
    annualPricePhp: 0,
    trialDays: 14,
    maxDentists: 1,
    maxChairs: 1,
    maxAppointmentsPerMonth: 50,
    maxStorageBytes: BigInt(50) * MB,
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
    code: SubscriptionPlanCode.starter,
    name: "Smile Starter",
    description: "For small clinics getting started.",
    monthlyPricePhp: 1499,
    annualPricePhp: 14990,
    trialDays: 0,
    maxDentists: 2,
    maxChairs: 2,
    maxAppointmentsPerMonth: 300,
    maxStorageBytes: BigInt(150) * MB,
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
    code: SubscriptionPlanCode.pro,
    name: "Smile Pro Clinic",
    description: "Full Odontogram, X-ray vault and recall automation.",
    monthlyPricePhp: 2999,
    annualPricePhp: 29990,
    trialDays: 0,
    maxDentists: 8,
    maxChairs: 8,
    maxAppointmentsPerMonth: 1500,
    maxStorageBytes: BigInt(400) * MB,
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

async function main(): Promise<void> {
  const connectionString =
    process.env.DIRECT_URL?.trim() || process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL or DIRECT_URL must be set before seeding.");
  }

  const pool = new Pool({ connectionString });
  const adapter = new PrismaPg(pool);
  const prisma = new PrismaClient({ adapter });

  try {
    let createdOrUpdated = 0;
    for (const plan of PLANS) {
      await prisma.subscriptionPlan.upsert({
        where: { code: plan.code },
        update: {
          name: plan.name,
          description: plan.description,
          monthlyPricePhp: plan.monthlyPricePhp,
          annualPricePhp: plan.annualPricePhp,
          trialDays: plan.trialDays,
          maxDentists: plan.maxDentists,
          maxChairs: plan.maxChairs,
          maxAppointmentsPerMonth: plan.maxAppointmentsPerMonth,
          maxStorageBytes: plan.maxStorageBytes,
          maxEmailsPerMonth: plan.maxEmailsPerMonth,
          defaultFeatures: plan.defaultFeatures,
          isActive: plan.isActive,
        },
        create: {
          ...plan,
        },
      });
      createdOrUpdated++;
    }
    console.log(`Seed complete: ${createdOrUpdated} subscription plans ready.`);
  } finally {
    await prisma.$disconnect();
    await pool.end();
  }
}

main().catch((error) => {
  console.error("Failed to seed database:", error);
  process.exit(1);
});
