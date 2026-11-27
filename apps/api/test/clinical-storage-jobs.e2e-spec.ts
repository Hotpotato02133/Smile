import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  BillingCycle,
  ClinicStatus,
  SubscriptionPlanCode,
  UserRole,
} from "@prisma/client";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/bootstrap";
import { PrismaService } from "../src/infra/prisma.service";
import { ClerkService } from "../src/modules/auth/clerk.service";
import { EmailTransportService } from "../src/modules/notifications/email-transport.service";
import { StorageService } from "../src/modules/storage/storage.service";

describe("Phase 5: Odontogram, Zero-Trust R2 Storage & Internal Cron Jobs (e2e)", () => {
  let app: INestApplication;

  const CLINIC_ID = "12121212-1212-4121-8121-121212121212";
  const PLAN_ID = "13131313-1313-4131-8131-131313131313";
  const PATIENT_ID = "14141414-1414-4141-8141-141414141414";
  const DENTIST_ID = "15151515-1515-4151-8151-151515151515";
  const CRON_SECRET = "super-secret-cron-token-123456";

  const proPlan = {
    id: PLAN_ID,
    code: SubscriptionPlanCode.pro,
    name: "Smile Pro",
    monthlyPricePhp: 2999,
    annualPricePhp: 29990,
    maxDentists: 8,
    maxChairs: 8,
    maxAppointmentsPerMonth: 1500,
    maxStorageBytes: BigInt(10 * 1024 * 1024),
    maxEmailsPerMonth: 1000,
    defaultFeatures: {
      odontogramEnabled: true,
      xrayStorageEnabled: true,
      waitlistAutomationEnabled: true,
      recallAutomationEnabled: true,
      customBrandingEnabled: true,
    },
    isActive: true,
  };

  let clinic: Record<string, unknown>;
  const toothRecords: Record<string, unknown>[] = [];
  const clinicalFiles: Record<string, unknown>[] = [];
  const auditLogs: Record<string, unknown>[] = [];
  const upsertedPlatformMetrics: Record<string, unknown>[] = [];

  const dentistUser = {
    id: "u-dentist-5",
    clerkId: "clerk_dentist_5",
    email: "dr.elena@clinic.ph",
    firstName: "Elena",
    lastName: "Cruz",
    role: UserRole.dentist,
    clinicId: CLINIC_ID,
    isActive: true,
  };

  const storageMock = {
    buildClinicalKey: jest.fn(
      (cid: string, pid: string, name: string) =>
        `private/clinical/${cid}/${pid}/mock-${name}`
    ),
    createPresignedPutUrl: jest.fn(async ({ storageKey }: { storageKey: string }) => ({
      uploadUrl: `https://r2.example.com/put/${storageKey}`,
      storageKey,
      expiresInSeconds: 300,
    })),
    createPresignedGetUrl: jest.fn(
      async (key: string) => `https://r2.example.com/get/${key}?sig=shortlived`
    ),
    headObject: jest.fn(),
    deleteObject: jest.fn(async () => undefined),
  };

  const emailTransportMock = {
    send: jest.fn(async () => ({ sent: true, provider: "resend", id: "em_1" })),
  };

  const prismaMock: Record<string, unknown> = {
    $transaction: jest.fn(async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> =>
      cb(prismaMock)
    ),
    $disconnect: jest.fn(),
    user: {
      findUnique: jest.fn(async ({ where }: { where: { clerkId?: string } }) =>
        where.clerkId === "clerk_dentist_5" ? dentistUser : null
      ),
      findFirst: jest.fn(async () => ({
        id: "u-sys-admin",
        role: UserRole.super_admin,
        isActive: true,
      })),
    },
    subscriptionPlan: {
      findUnique: jest.fn(async () => proPlan),
    },
    clinic: {
      findUnique: jest.fn(async () => clinic),
      findMany: jest.fn(async ({ where }: { where?: Record<string, unknown> }) => {
        if (where?.status === ClinicStatus.past_due) {
          return clinic.status === ClinicStatus.past_due ? [clinic] : [];
        }
        if (where?.currentMonthKey) return [];
        return [{ ...clinic, plan: proPlan }];
      }),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const next = { ...clinic };
        for (const [k, v] of Object.entries(data)) {
          if (v && typeof v === "object" && "increment" in (v as Record<string, unknown>)) {
            next[k] = BigInt(next[k] as bigint) + BigInt((v as { increment: bigint }).increment);
          } else {
            next[k] = v;
          }
        }
        clinic = next;
        return clinic;
      }),
      updateMany: jest.fn(async () => ({ count: 0 })),
      aggregate: jest.fn(async () => ({ _sum: { currentMonthEmailCount: 0 } })),
    },
    dentist: {
      findFirst: jest.fn(async () => ({
        id: DENTIST_ID,
        clinicId: CLINIC_ID,
        userId: dentistUser.id,
        displayName: "Dr. Elena Cruz",
        isActive: true,
      })),
    },
    patient: {
      findFirst: jest.fn(async ({ where }: { where: { id?: string } }) =>
        where.id === PATIENT_ID
          ? {
              id: PATIENT_ID,
              clinicId: CLINIC_ID,
              firstName: "Marco",
              lastName: "Silva",
              medicalHistory: { allergies: ["Latex"], conditions: [] },
            }
          : null
      ),
      count: jest.fn(async () => 2),
      findMany: jest.fn(async () => []),
    },
    toothRecord: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const rec = {
          id: `tooth-${toothRecords.length + 1}`,
          updatedAt: new Date(),
          recordedByDentist: { id: DENTIST_ID, displayName: "Dr. Elena Cruz" },
          ...data,
        };
        toothRecords.push(rec);
        return rec;
      }),
      findMany: jest.fn(async () => toothRecords),
    },
    clinicalFile: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const file = {
          id: `file-${clinicalFiles.length + 1}`,
          createdAt: new Date(),
          ...data,
        };
        clinicalFiles.push(file);
        return file;
      }),
      findMany: jest.fn(async () => clinicalFiles),
      findFirst: jest.fn(async ({ where }: { where: { id?: string } }) =>
        clinicalFiles.find((f) => f.id === where.id) ?? null
      ),
      delete: jest.fn(async ({ where }: { where: { id: string } }) => {
        const idx = clinicalFiles.findIndex((f) => f.id === where.id);
        if (idx >= 0) clinicalFiles.splice(idx, 1);
      }),
    },
    appointment: {
      findMany: jest.fn(async () => []),
    },
    subscriptionPayment: {
      aggregate: jest.fn(async () => ({ _sum: { amountPhp: 2999 } })),
    },
    clinicMetricDaily: {
      upsert: jest.fn(async ({ create }: { create: Record<string, unknown> }) => create),
    },
    platformMetricDaily: {
      upsert: jest.fn(async ({ create }: { create: Record<string, unknown> }) => {
        upsertedPlatformMetrics.push(create);
        return create;
      }),
    },
    platformAuditLog: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        auditLogs.push(data);
        return data;
      }),
    },
  };

  const clerkServiceMock = {
    verifySessionToken: jest.fn(async (token: string) => {
      if (token === "dentist-token") {
        return { clerkId: "clerk_dentist_5", email: dentistUser.email, claims: {} };
      }
      throw new Error("Unauthorized");
    }),
    getClerkUserProfile: jest.fn(async () => null),
    syncPublicMetadata: jest.fn(async () => undefined),
  };

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.CRON_SECRET = CRON_SECRET;

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(ClerkService)
      .useValue(clerkServiceMock)
      .overrideProvider(StorageService)
      .useValue(storageMock)
      .overrideProvider(EmailTransportService)
      .useValue(emailTransportMock)
      .compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    toothRecords.length = 0;
    clinicalFiles.length = 0;
    auditLogs.length = 0;
    upsertedPlatformMetrics.length = 0;
    jest.clearAllMocks();

    clinic = {
      id: CLINIC_ID,
      name: "Cebu Dental Care",
      slug: "cebu-dental",
      email: "care@cebudental.ph",
      timezone: "Asia/Manila",
      planId: PLAN_ID,
      status: ClinicStatus.active,
      billingCycle: BillingCycle.monthly,
      subscriptionStartsAt: new Date(Date.now() - 86_400_000),
      subscriptionEndsAt: new Date(Date.now() + 30 * 86_400_000),
      gracePeriodEndsAt: null,
      featureFlags: proPlan.defaultFeatures,
      storageUsedBytes: BigInt(0),
      currentMonthKey: "2026-11",
      currentMonthAppointmentCount: 0,
      currentMonthEmailCount: 0,
      plan: proPlan,
    };
  });

  it("Zero-Trust R2 Upload: rejects >500KB blobs via HeadObject and increments storageUsedBytes on valid upload", async () => {
    // Presign rejects >500KB upfront
    const oversizedPresign = await request(app.getHttpServer())
      .post("/api/v1/storage/clinical/presign-upload")
      .set("Authorization", "Bearer dentist-token")
      .send({
        patientId: PATIENT_ID,
        fileName: "huge-xray.webp",
        contentType: "image/webp",
        fileSizeBytes: 600 * 1024,
      })
      .expect(400);
    expect(oversizedPresign.body.code).toBe("FILE_TOO_LARGE");

    // Valid presign succeeds
    const presign = await request(app.getHttpServer())
      .post("/api/v1/storage/clinical/presign-upload")
      .set("Authorization", "Bearer dentist-token")
      .send({
        patientId: PATIENT_ID,
        fileName: "molar-14.webp",
        contentType: "image/webp",
        fileSizeBytes: 180_000,
      })
      .expect(201);

    // Simulate client cheating and uploading a 700 KB object -> HeadObject catches and deletes it!
    storageMock.headObject.mockResolvedValueOnce({
      exists: true,
      sizeBytes: 700 * 1024,
    });
    const cheated = await request(app.getHttpServer())
      .post("/api/v1/clinical/files/confirm")
      .set("Authorization", "Bearer dentist-token")
      .send({
        patientId: PATIENT_ID,
        storageKey: presign.body.storageKey,
        fileName: "molar-14.webp",
        fileType: "xray_periapical",
      })
      .expect(400);
    expect(cheated.body.code).toBe("FILE_TOO_LARGE");
    expect(storageMock.deleteObject).toHaveBeenCalledWith(
      presign.body.storageKey,
      "private"
    );

    // Legitimate 180 KB object -> HeadObject confirms and updates storageUsedBytes
    storageMock.headObject.mockResolvedValueOnce({
      exists: true,
      sizeBytes: 180_000,
    });
    await request(app.getHttpServer())
      .post("/api/v1/clinical/files/confirm")
      .set("Authorization", "Bearer dentist-token")
      .send({
        patientId: PATIENT_ID,
        storageKey: presign.body.storageKey,
        fileName: "molar-14.webp",
        fileType: "xray_periapical",
      })
      .expect(201);

    expect(clinic.storageUsedBytes).toBe(BigInt(180_000));
  });

  it("32-Tooth Odontogram: records tooth condition and returns chart with short-lived presigned X-ray URLs", async () => {
    await request(app.getHttpServer())
      .post(`/api/v1/clinical/patients/${PATIENT_ID}/tooth-records`)
      .set("Authorization", "Bearer dentist-token")
      .send({
        toothNumber: 14,
        surface: "Occlusal",
        condition: "caries",
        treatmentStatus: "planned",
        notes: "Deep occlusal caries; composite filling planned",
      })
      .expect(201);

    const chart = await request(app.getHttpServer())
      .get(`/api/v1/clinical/patients/${PATIENT_ID}/chart`)
      .set("Authorization", "Bearer dentist-token")
      .expect(200);

    expect(chart.body.odontogramEnabled).toBe(true);
    expect(chart.body.toothRecords).toHaveLength(1);
    expect(chart.body.toothRecords[0].toothNumber).toBe(14);
  });

  it("Internal Cron Security & Execution: rejects bad X-Cron-Secret (401) and executes sweep + rollup with valid secret", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/internal/cron/sweep-subscriptions")
      .set("X-Cron-Secret", "wrong-secret")
      .expect(401);

    // Make clinic expired trial -> sweep transitions to past_due and sends email alert
    clinic.status = ClinicStatus.trial;
    clinic.subscriptionEndsAt = new Date(Date.now() - 3600_000);

    const sweepRes = await request(app.getHttpServer())
      .post("/api/v1/internal/cron/sweep-subscriptions")
      .set("X-Cron-Secret", CRON_SECRET)
      .expect(200);

    expect(sweepRes.body.transitionedToPastDue).toBe(1);
    expect(clinic.status).toBe(ClinicStatus.past_due);
    expect(emailTransportMock.send).toHaveBeenCalledTimes(1);
    expect(auditLogs.some((a) => a.actionType === "CLINIC_AUTO_PAST_DUE")).toBe(
      true
    );

    const rollupRes = await request(app.getHttpServer())
      .post("/api/v1/internal/cron/rollup-daily-analytics?dateKey=2026-11-26")
      .set("X-Cron-Secret", CRON_SECRET)
      .expect(200);

    expect(rollupRes.body.dateKey).toBe("2026-11-26");
    expect(upsertedPlatformMetrics).toHaveLength(1);
  });
});
