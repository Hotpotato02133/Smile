import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  AppointmentStatus,
  BillingCycle,
  ClinicStatus,
  ServiceCategory,
  SubscriptionPlanCode,
  UserRole,
} from "@prisma/client";
import { localDateMinuteToUtc } from "@smile/shared";
import { io as createSocketClient } from "socket.io-client";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/bootstrap";
import {
  DEFAULT_DENTIST_SCHEDULE,
  DEFAULT_OPERATING_HOURS,
} from "../src/common/utils/manila-time";
import { PrismaService } from "../src/infra/prisma.service";
import { ClerkService } from "../src/modules/auth/clerk.service";
import { SlotLockService } from "../src/modules/scheduling/slot-lock.service";

describe("Phase 4: Concurrency Booking, Interval Slot Locks & Real-Time Socket.IO (e2e)", () => {
  let app: INestApplication;
  let slotLockService: SlotLockService;
  let baseUrl: string;

  const CLINIC_ID = "44444444-4444-4444-8444-444444444444";
  const PLAN_ID = "55555555-5555-4555-8555-555555555555";
  const DENTIST_ID = "66666666-6666-4666-8666-666666666666";
  const CHAIR_ID = "77777777-7777-4777-8777-777777777777";
  const SERVICE_ID = "88888888-8888-4888-8888-888888888888";
  const PATIENT_ID = "99999999-9999-4999-8999-999999999999";

  // Pick a guaranteed future Monday so weekday schedule is open
  const FUTURE_MONDAY = "2027-01-04";
  const SLOT_0900_UTC = localDateMinuteToUtc(FUTURE_MONDAY, 540, "Asia/Manila");
  const SLOT_0930_UTC = localDateMinuteToUtc(FUTURE_MONDAY, 570, "Asia/Manila");
  const SLOT_1000_UTC = localDateMinuteToUtc(FUTURE_MONDAY, 600, "Asia/Manila");

  const plan = {
    id: PLAN_ID,
    code: SubscriptionPlanCode.pro,
    name: "Smile Pro",
    monthlyPricePhp: 2999,
    annualPricePhp: 29990,
    maxDentists: 8,
    maxChairs: 8,
    maxAppointmentsPerMonth: 1500,
    maxStorageBytes: BigInt(400 * 1024 * 1024),
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

  const clinic = {
    id: CLINIC_ID,
    name: "BGC Dental",
    slug: "bgc-dental",
    email: "care@bgcdental.ph",
    phone: "+639171112222",
    address: "High Street",
    city: "Taguig",
    province: "Metro Manila",
    timezone: "Asia/Manila",
    primaryColorHex: "#0284c7",
    planId: PLAN_ID,
    status: ClinicStatus.active,
    billingCycle: BillingCycle.monthly,
    subscriptionStartsAt: new Date(Date.now() - 86_400_000),
    subscriptionEndsAt: new Date(Date.now() + 90 * 86_400_000),
    gracePeriodEndsAt: null,
    featureFlags: plan.defaultFeatures,
    activeDentistCount: 1,
    activeChairCount: 1,
    currentMonthKey: "2026-11",
    currentMonthAppointmentCount: 0,
    currentMonthEmailCount: 0,
    storageUsedBytes: BigInt(0),
    lifetimeAppointmentCount: 0,
    slotIntervalMinutes: 30,
    cancellationWindowHours: 24,
    emergencyBufferMinutesPerDay: 0,
    requireBookingApproval: false,
    operatingHours: DEFAULT_OPERATING_HOURS,
  };

  const dentist = {
    id: DENTIST_ID,
    clinicId: CLINIC_ID,
    userId: "u-dentist",
    displayName: "Dr. Maria Santos",
    licenseNumber: "PRC-12345",
    specialties: ["General Dentistry"],
    calendarColorHex: "#0284c7",
    defaultChairId: CHAIR_ID,
    weeklySchedule: DEFAULT_DENTIST_SCHEDULE,
    isActive: true,
  };

  const chair = {
    id: CHAIR_ID,
    clinicId: CLINIC_ID,
    name: "Operatory 1",
    roomCode: "OP-1",
    supportedCategoryTags: ["General"],
    isActive: true,
  };

  // 45-min procedure + 15-min sterilization buffer = 60-min total block
  const service = {
    id: SERVICE_ID,
    clinicId: CLINIC_ID,
    name: "Composite Filling",
    category: ServiceCategory.Restorative,
    description: "Tooth-colored filling",
    durationMinutes: 45,
    bufferMinutes: 15,
    pricePhp: 1500,
    requiresXray: false,
    requiredChairTag: null,
    isActive: true,
  };

  const patientUser = {
    id: "u-patient-1",
    clerkId: "clerk_patient",
    email: "patient@example.com",
    firstName: "Juan",
    lastName: "Cruz",
    role: UserRole.patient,
    clinicId: null,
    isActive: true,
  };

  const receptionistUser = {
    id: "u-receptionist-1",
    clerkId: "clerk_recep",
    email: "frontdesk@bgcdental.ph",
    firstName: "Ana",
    lastName: "Reyes",
    role: UserRole.receptionist,
    clinicId: CLINIC_ID,
    isActive: true,
  };

  const patientProfile = {
    id: PATIENT_ID,
    clinicId: CLINIC_ID,
    userId: patientUser.id,
    guardianPatientId: null,
    firstName: "Juan",
    lastName: "Cruz",
    dateOfBirth: "1995-05-01",
    sex: "male",
    phone: "+639179998888",
  };

  interface StoredAppt {
    id: string;
    clinicId: string;
    patientId: string;
    dentistId: string;
    chairId: string;
    serviceId: string;
    dateKey: string;
    startTimeUtc: Date;
    endTimeUtc: Date;
    bufferEndTimeUtc: Date;
    status: AppointmentStatus;
    service?: typeof service;
  }

  const appointments: StoredAppt[] = [];
  // Simulates PostgreSQL row-level FOR UPDATE lock serialization inside $transaction
  let txMutex: Promise<void> = Promise.resolve();

  const prismaMock: Record<string, unknown> = {
    $queryRaw: jest.fn(async () => [{ id: "locked" }]),
    $transaction: jest.fn(async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> => {
      let release!: () => void;
      const prev = txMutex;
      txMutex = new Promise<void>((resolve) => {
        release = resolve;
      });
      await prev;
      try {
        return await cb(prismaMock);
      } finally {
        release();
      }
    }),
    $disconnect: jest.fn(),
    user: {
      findUnique: jest.fn(async ({ where }: { where: { clerkId?: string } }) => {
        if (where.clerkId === "clerk_patient") return patientUser;
        if (where.clerkId === "clerk_recep") return receptionistUser;
        return null;
      }),
    },
    subscriptionPlan: {
      findUnique: jest.fn(async ({ where }: { where: { id?: string } }) =>
        where.id === PLAN_ID ? plan : null
      ),
    },
    clinic: {
      findUnique: jest.fn(
        async ({ where }: { where: { id?: string; slug?: string } }) => {
          if (where.id === CLINIC_ID || where.slug === clinic.slug) return clinic;
          return null;
        }
      ),
      update: jest.fn(async () => clinic),
    },
    dentist: {
      findMany: jest.fn(async () => [dentist]),
      findUnique: jest.fn(async ({ where }: { where: { id?: string } }) =>
        where.id === DENTIST_ID ? dentist : null
      ),
    },
    chair: {
      findMany: jest.fn(async () => [chair]),
      findUnique: jest.fn(async ({ where }: { where: { id?: string } }) =>
        where.id === CHAIR_ID ? chair : null
      ),
    },
    service: {
      findFirst: jest.fn(async ({ where }: { where: { id?: string } }) =>
        where.id === SERVICE_ID ? service : null
      ),
      findUnique: jest.fn(async ({ where }: { where: { id?: string } }) =>
        where.id === SERVICE_ID ? service : null
      ),
      findMany: jest.fn(async () => [service]),
    },
    dentistTimeOff: {
      findMany: jest.fn(async () => []),
    },
    patient: {
      findUnique: jest.fn(async ({ where }: { where: { id?: string } }) =>
        where.id === PATIENT_ID ? patientProfile : null
      ),
      findFirst: jest.fn(async ({ where }: { where: { id?: string } }) =>
        where.id === PATIENT_ID ? patientProfile : null
      ),
      update: jest.fn(async () => patientProfile),
    },
    appointment: {
      findMany: jest.fn(async ({ where }: { where: Record<string, unknown> }) => {
        const startFilter = (where.startTimeUtc as { lt?: Date } | undefined)?.lt;
        const endFilter = (where.bufferEndTimeUtc as { gt?: Date } | undefined)?.gt;
        return appointments.filter((a) => {
          if (a.status === "cancelled" || a.status === "no_show") return false;
          if (startFilter && endFilter) {
            return a.startTimeUtc < startFilter && a.bufferEndTimeUtc > endFilter;
          }
          return a.dateKey === where.dateKey;
        });
      }),
      findFirst: jest.fn(async ({ where }: { where: { id?: string } }) => {
        const found = appointments.find((a) => a.id === where.id);
        return found ? { ...found, service } : null;
      }),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row: StoredAppt = {
          id: `appt-${appointments.length + 1}`,
          clinicId: String(data.clinicId),
          patientId: String(data.patientId),
          dentistId: String(data.dentistId),
          chairId: String(data.chairId),
          serviceId: String(data.serviceId),
          dateKey: String(data.dateKey),
          startTimeUtc: data.startTimeUtc as Date,
          endTimeUtc: data.endTimeUtc as Date,
          bufferEndTimeUtc: data.bufferEndTimeUtc as Date,
          status: data.status as AppointmentStatus,
        };
        appointments.push(row);
        return row;
      }),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          const idx = appointments.findIndex((a) => a.id === where.id);
          if (idx === -1) throw new Error("Not found");
          appointments[idx] = { ...appointments[idx], ...data };
          return appointments[idx];
        }
      ),
    },
    platformAuditLog: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => data),
    },
  };

  const clerkServiceMock = {
    verifySessionToken: jest.fn(async (token: string) => {
      if (token === "patient-token") {
        return { clerkId: "clerk_patient", email: patientUser.email, claims: {} };
      }
      if (token === "recep-token") {
        return {
          clerkId: "clerk_recep",
          email: receptionistUser.email,
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
    await app.listen(0);
    const addr = app.getHttpServer().address() as { port: number };
    baseUrl = `http://127.0.0.1:${addr.port}`;
    slotLockService = app.get(SlotLockService);
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    appointments.length = 0;
    slotLockService.clearMemoryLocks();
  });

  it("blocks partially overlapping variable-duration slot locks (09:00-10:00 vs 09:30-10:30) and releases session lock on switch", async () => {
    // Session A acquires 09:00-10:00 (45m + 15m sterilization buffer)
    await request(app.getHttpServer())
      .post("/api/v1/public/clinics/bgc-dental/slot-locks")
      .send({
        serviceId: SERVICE_ID,
        dateKey: FUTURE_MONDAY,
        startTimeUtc: SLOT_0900_UTC,
        dentistId: DENTIST_ID,
        chairId: CHAIR_ID,
        sessionId: "session-alpha",
      })
      .expect(201);

    // Session B attempts overlapping 09:30-10:30 -> must return 409 Conflict!
    const overlapRes = await request(app.getHttpServer())
      .post("/api/v1/public/clinics/bgc-dental/slot-locks")
      .send({
        serviceId: SERVICE_ID,
        dateKey: FUTURE_MONDAY,
        startTimeUtc: SLOT_0930_UTC,
        dentistId: DENTIST_ID,
        chairId: CHAIR_ID,
        sessionId: "session-beta",
      })
      .expect(409);
    expect(overlapRes.body.code).toBe("SLOT_UNAVAILABLE");

    // Session A switches to 10:00-11:00 -> atomically releases 09:00 lock
    await request(app.getHttpServer())
      .post("/api/v1/public/clinics/bgc-dental/slot-locks")
      .send({
        serviceId: SERVICE_ID,
        dateKey: FUTURE_MONDAY,
        startTimeUtc: SLOT_1000_UTC,
        dentistId: DENTIST_ID,
        chairId: CHAIR_ID,
        sessionId: "session-alpha",
      })
      .expect(201);

    // Now Session B can cleanly acquire 09:00-10:00
    await request(app.getHttpServer())
      .post("/api/v1/public/clinics/bgc-dental/slot-locks")
      .send({
        serviceId: SERVICE_ID,
        dateKey: FUTURE_MONDAY,
        startTimeUtc: SLOT_0900_UTC,
        dentistId: DENTIST_ID,
        chairId: CHAIR_ID,
        sessionId: "session-beta",
      })
      .expect(201);
  });

  it("Concurrency Proof: 5 simultaneous bookings for one slot produce exactly 1 HTTP 201 and 4 HTTP 409 Conflict", async () => {
    const requests = Array.from({ length: 5 }, (_, idx) =>
      request(app.getHttpServer())
        .post("/api/v1/patient/bookings")
        .set("Authorization", "Bearer patient-token")
        .send({
          clinicSlug: "bgc-dental",
          patientId: PATIENT_ID,
          serviceId: SERVICE_ID,
          dentistId: DENTIST_ID,
          chairId: CHAIR_ID,
          dateKey: FUTURE_MONDAY,
          startTimeUtc: SLOT_0900_UTC,
          sessionId: `race-session-${idx}`,
        })
    );

    const responses = await Promise.all(requests);
    const created = responses.filter((r) => r.status === 201);
    const conflicts = responses.filter((r) => r.status === 409);

    expect(created).toHaveLength(1);
    expect(conflicts).toHaveLength(4);
    expect(appointments).toHaveLength(1);
  });

  it("Socket.IO enforces JWT room auth and pushes real-time check-in updates to clinic:<clinicId>", async () => {
    // Seed one confirmed appointment first
    const booking = await request(app.getHttpServer())
      .post("/api/v1/patient/bookings")
      .set("Authorization", "Bearer patient-token")
      .send({
        clinicSlug: "bgc-dental",
        patientId: PATIENT_ID,
        serviceId: SERVICE_ID,
        dentistId: DENTIST_ID,
        chairId: CHAIR_ID,
        dateKey: FUTURE_MONDAY,
        startTimeUtc: SLOT_0900_UTC,
        sessionId: "ws-seed-session",
      })
      .expect(201);

    // Connect unauthenticated socket -> rejected from clinic room
    const anonSocket = createSocketClient(baseUrl, {
      transports: ["websocket"],
    });
    await new Promise<void>((resolve) => anonSocket.on("connect", () => resolve()));
    const denied = await new Promise<{ ok: boolean; code?: string }>((resolve) =>
      anonSocket.emit("join:clinic", {}, resolve)
    );
    expect(denied.ok).toBe(false);
    anonSocket.disconnect();

    // Connect authenticated receptionist socket -> joins clinic room
    const staffSocket = createSocketClient(baseUrl, {
      transports: ["websocket"],
      auth: { token: "recep-token" },
    });
    await new Promise<void>((resolve) => staffSocket.on("connect", () => resolve()));

    const joined = await new Promise<{ ok: boolean; room?: string }>((resolve) =>
      staffSocket.emit("join:clinic", {}, resolve)
    );
    expect(joined).toEqual({ ok: true, room: `clinic:${CLINIC_ID}` });

    const eventPromise = new Promise<Record<string, unknown>>((resolve) => {
      staffSocket.once("appointment.changed", (payload: Record<string, unknown>) =>
        resolve(payload)
      );
    });

    await request(app.getHttpServer())
      .patch(`/api/v1/appointments/${booking.body.id}/status`)
      .set("Authorization", "Bearer recep-token")
      .send({ status: "checked_in" })
      .expect(200);

    const event = await eventPromise;
    expect(event).toMatchObject({
      appointmentId: booking.body.id,
      status: "checked_in",
      action: "status_changed",
    });

    staffSocket.disconnect();
  });
});
