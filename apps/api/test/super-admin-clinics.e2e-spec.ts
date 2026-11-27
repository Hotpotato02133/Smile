import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  BillingCycle,
  ClinicStatus,
  PaymentStatus,
  SubscriptionPlanCode,
  UserRole,
} from "@prisma/client";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/bootstrap";
import { PrismaService } from "../src/infra/prisma.service";
import { ClerkService } from "../src/modules/auth/clerk.service";

describe("Phase 3: Super Admin, Billing, Quotas & Clinic Suspension (e2e)", () => {
  let app: INestApplication;

  const PLAN_STARTER_ID = "22222222-2222-4222-8222-222222222222";
  const CLINIC_ID = "33333333-3333-4333-8333-333333333333";

  const starterPlan = {
    id: PLAN_STARTER_ID,
    code: SubscriptionPlanCode.starter,
    name: "Smile Starter",
    description: "Starter tier",
    monthlyPricePhp: 1499,
    annualPricePhp: 14990,
    trialDays: 0,
    maxDentists: 2,
    maxChairs: 2,
    maxAppointmentsPerMonth: 300,
    maxStorageBytes: BigInt(150 * 1024 * 1024),
    maxEmailsPerMonth: 400,
    defaultFeatures: {
      odontogramEnabled: true,
      xrayStorageEnabled: true,
      waitlistAutomationEnabled: false,
      recallAutomationEnabled: false,
      customBrandingEnabled: false,
    },
    isActive: true,
  };

  let clinicRecord: Record<string, unknown>;
  const auditLogs: Record<string, unknown>[] = [];
  const seededServices: Record<string, unknown>[] = [];
  const payments: Record<string, unknown>[] = [];
  const invitations: Record<string, unknown>[] = [];

  const superAdminUser = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    clerkId: "clerk_super",
    email: "owner@smiledental.ph",
    firstName: "Platform",
    lastName: "Owner",
    role: UserRole.super_admin,
    clinicId: null,
    isActive: true,
  };

  const clinicAdminUser = {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    clerkId: "clerk_cadmin",
    email: "admin@makatismile.ph",
    firstName: "Clinic",
    lastName: "Admin",
    role: UserRole.clinic_admin,
    clinicId: CLINIC_ID,
    isActive: true,
  };

  const prismaMock: Record<string, unknown> = {
    user: {
      findUnique: jest.fn(async ({ where }: { where: { clerkId?: string } }) => {
        if (where.clerkId === "clerk_super") return superAdminUser;
        if (where.clerkId === "clerk_cadmin") return clinicAdminUser;
        return null;
      }),
      groupBy: jest.fn(async () => [
        { role: UserRole.super_admin, _count: { id: 1 } },
        { role: UserRole.clinic_admin, _count: { id: 1 } },
      ]),
    },
    subscriptionPlan: {
      findUnique: jest.fn(async ({ where }: { where: { id?: string } }) =>
        where.id === PLAN_STARTER_ID ? starterPlan : null
      ),
      findMany: jest.fn(async () => [starterPlan]),
    },
    clinic: {
      findUnique: jest.fn(
        async ({ where }: { where: { id?: string; slug?: string } }) => {
          if (where.id === CLINIC_ID) return clinicRecord;
          if (where.slug && clinicRecord && clinicRecord.slug === where.slug) {
            return clinicRecord;
          }
          return null;
        }
      ),
      findMany: jest.fn(async () => [{ ...clinicRecord, plan: starterPlan }]),
      aggregate: jest.fn(async () => ({
        _sum: { currentMonthEmailCount: 0, storageUsedBytes: BigInt(0) },
        _count: { id: 1 },
      })),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        clinicRecord = {
          id: CLINIC_ID,
          activeDentistCount: 0,
          activeChairCount: 0,
          currentMonthAppointmentCount: 0,
          currentMonthEmailCount: 0,
          storageUsedBytes: BigInt(0),
          lifetimeAppointmentCount: 0,
          slotIntervalMinutes: 30,
          cancellationWindowHours: 24,
          emergencyBufferMinutesPerDay: 0,
          requireBookingApproval: false,
          gracePeriodEndsAt: null,
          createdAt: new Date(),
          updatedAt: new Date(),
          ...data,
          plan: starterPlan,
        };
        return clinicRecord;
      }),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const next = { ...clinicRecord };
        for (const [key, val] of Object.entries(data)) {
          if (
            val &&
            typeof val === "object" &&
            "increment" in (val as Record<string, unknown>)
          ) {
            next[key] =
              Number(next[key] ?? 0) +
              Number((val as { increment: number }).increment);
          } else {
            next[key] = val;
          }
        }
        clinicRecord = { ...next, plan: starterPlan };
        return clinicRecord;
      }),
    },
    service: {
      createMany: jest.fn(async ({ data }: { data: Record<string, unknown>[] }) => {
        seededServices.push(...data);
        return { count: data.length };
      }),
      count: jest.fn(async () => seededServices.length),
    },
    dentist: {
      count: jest.fn(async () => 1),
    },
    chair: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "chair-1",
        ...data,
      })),
      count: jest.fn(async () => 1),
    },
    staffInvitation: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const inv = { id: `inv-${invitations.length + 1}`, ...data };
        invitations.push(inv);
        return inv;
      }),
      count: jest.fn(async () => invitations.length),
    },
    subscriptionPayment: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const p = { id: `pay-${payments.length + 1}`, ...data };
        payments.push(p);
        return p;
      }),
      aggregate: jest.fn(async () => ({
        _sum: {
          amountPhp: payments
            .filter((p) => p.status === PaymentStatus.paid)
            .reduce((s, p) => s + Number(p.amountPhp ?? 0), 0),
        },
        _count: { id: payments.length },
      })),
      count: jest.fn(async () => 0),
    },
    platformMetricDaily: {
      findMany: jest.fn(async () => []),
    },
    systemAnnouncement: {
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
    },
    platformAuditLog: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        auditLogs.push(data);
        return { id: `audit-${auditLogs.length}`, ...data };
      }),
    },
    $transaction: jest.fn(async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> =>
      cb(prismaMock)
    ),
    $disconnect: jest.fn(),
  };

  const clerkServiceMock = {
    verifySessionToken: jest.fn(async (token: string) => {
      if (token === "super-token") {
        return { clerkId: "clerk_super", email: superAdminUser.email, claims: {} };
      }
      if (token === "clinic-admin-token") {
        return {
          clerkId: "clerk_cadmin",
          email: clinicAdminUser.email,
          claims: {},
        };
      }
      throw new Error("Unauthorized");
    }),
    getClerkUserProfile: jest.fn(async () => null),
    syncPublicMetadata: jest.fn(async () => undefined),
  };

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.SUPER_ADMIN_EMAIL = "owner@smiledental.ph";

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(ClerkService)
      .useValue(clerkServiceMock)
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    auditLogs.length = 0;
    seededServices.length = 0;
    payments.length = 0;
    invitations.length = 0;
    clinicRecord = {
      id: CLINIC_ID,
      name: "Makati Smile Clinic",
      slug: "makati-smile",
      email: "hello@makatismile.ph",
      phone: "+639171234567",
      address: "123 Ayala Ave",
      city: "Makati",
      province: "Metro Manila",
      timezone: "Asia/Manila",
      primaryColorHex: "#0284c7",
      planId: PLAN_STARTER_ID,
      status: ClinicStatus.active,
      billingCycle: BillingCycle.monthly,
      subscriptionStartsAt: new Date(Date.now() - 86_400_000),
      subscriptionEndsAt: new Date(Date.now() + 30 * 86_400_000),
      gracePeriodEndsAt: null,
      featureFlags: starterPlan.defaultFeatures,
      activeDentistCount: 1,
      activeChairCount: 1,
      currentMonthKey: "2026-11",
      currentMonthAppointmentCount: 10,
      currentMonthEmailCount: 5,
      storageUsedBytes: BigInt(1024),
      lifetimeAppointmentCount: 50,
      plan: starterPlan,
    };
  });

  it("Super Admin provisions a new clinic, seeds default services, invites admin, and logs audit", async () => {
    const res = await request(app.getHttpServer())
      .post("/api/v1/super-admin/clinics")
      .set("Authorization", "Bearer super-token")
      .send({
        name: "BGC Dental Studio",
        slug: "bgc-dental-studio",
        email: "care@bgcdental.ph",
        phone: "+639170001111",
        address: "High Street",
        city: "Taguig",
        province: "Metro Manila",
        planId: PLAN_STARTER_ID,
        billingCycle: "monthly",
        adminInviteEmail: "owner@bgcdental.ph",
      })
      .expect(201);

    expect(res.body.clinic.slug).toBe("bgc-dental-studio");
    expect(typeof res.body.clinic.storageUsedBytes).toBe("number");
    expect(seededServices.length).toBeGreaterThanOrEqual(6);
    expect(invitations).toHaveLength(1);
    expect(auditLogs.some((a) => a.actionType === "CLINIC_CREATED")).toBe(true);
  });

  it("enforces Starter plan maxChairs quota (403 QUOTA_EXCEEDED) once limit is reached", async () => {
    // Clinic starts with activeChairCount = 1, maxChairs = 2 -> first chair succeeds
    await request(app.getHttpServer())
      .post("/api/v1/clinic/chairs")
      .set("Authorization", "Bearer clinic-admin-token")
      .send({ name: "Operatory Chair 2", roomCode: "RM-02" })
      .expect(201);

    expect(clinicRecord.activeChairCount).toBe(2);

    // Second chair exceeds Starter plan maxChairs = 2 -> 403 QUOTA_EXCEEDED
    const blocked = await request(app.getHttpServer())
      .post("/api/v1/clinic/chairs")
      .set("Authorization", "Bearer clinic-admin-token")
      .send({ name: "Operatory Chair 3", roomCode: "RM-03" })
      .expect(403);

    expect(blocked.body.code).toBe("QUOTA_EXCEEDED");
  });

  it("Super Admin records a paid subscription payment, activates clinic, and computes MRR overview", async () => {
    clinicRecord.status = ClinicStatus.past_due;

    const payRes = await request(app.getHttpServer())
      .post("/api/v1/super-admin/payments")
      .set("Authorization", "Bearer super-token")
      .send({
        clinicId: CLINIC_ID,
        planId: PLAN_STARTER_ID,
        amountPhp: 1499,
        billingCycle: "monthly",
        paymentMethod: "gcash",
        referenceNumber: "GCASH-998877",
        periodStart: new Date().toISOString(),
        periodEnd: new Date(Date.now() + 30 * 86_400_000).toISOString(),
        status: "paid",
      })
      .expect(201);

    expect(payRes.body.invoiceNumber).toMatch(/^INV-\d{4}-\d{6}$/);
    expect(clinicRecord.status).toBe(ClinicStatus.active);
    expect(
      auditLogs.some((a) => a.actionType === "SUBSCRIPTION_PAYMENT_RECORDED")
    ).toBe(true);

    const overviewRes = await request(app.getHttpServer())
      .get("/api/v1/super-admin/analytics/overview")
      .set("Authorization", "Bearer super-token")
      .expect(200);

    expect(overviewRes.body.mrrPhp).toBe(1499);
    expect(overviewRes.body.arrPhp).toBe(1499 * 12);
    expect(overviewRes.body.collectedThisMonthPhp).toBe(1499);
  });

  it("Super Admin suspends a clinic -> clinic staff enters Read-Only mode (403 CLINIC_READ_ONLY on writes)", async () => {
    await request(app.getHttpServer())
      .patch(`/api/v1/super-admin/clinics/${CLINIC_ID}/status`)
      .set("Authorization", "Bearer super-token")
      .send({ status: "suspended", reason: "Overdue invoice" })
      .expect(200);

    expect(clinicRecord.status).toBe(ClinicStatus.suspended);
    expect(auditLogs.some((a) => a.actionType === "CLINIC_SUSPENDED")).toBe(true);

    // Workspace read still works and reports isReadOnly = true
    const ws = await request(app.getHttpServer())
      .get("/api/v1/clinic/workspace")
      .set("Authorization", "Bearer clinic-admin-token")
      .expect(200);
    expect(ws.body.isReadOnly).toBe(true);

    // Mutations are blocked with 403 CLINIC_READ_ONLY
    const blockedWrite = await request(app.getHttpServer())
      .post("/api/v1/clinic/chairs")
      .set("Authorization", "Bearer clinic-admin-token")
      .send({ name: "Blocked Chair", roomCode: "RM-99" })
      .expect(403);
    expect(blockedWrite.body.code).toBe("CLINIC_READ_ONLY");
  });
});
