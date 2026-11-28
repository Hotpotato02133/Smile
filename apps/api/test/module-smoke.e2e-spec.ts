import { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import {
  AppointmentStatus,
  BillingCycle,
  BookingSource,
  ClinicStatus,
  PaymentStatus,
  ServiceCategory,
  StaffInvitationStatus,
  SubscriptionPlanCode,
  UserRole,
} from "@prisma/client";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/bootstrap";
import { PrismaService } from "../src/infra/prisma.service";
import { ClerkService } from "../src/modules/auth/clerk.service";

describe("Full-Module Parity & Smoke Suite (e2e)", () => {
  let app: INestApplication;

  const PLAN_ID = "22222222-2222-4222-8222-222222222222";
  const CLINIC_ID = "33333333-3333-4333-8333-333333333333";
  const DENTIST_ID = "44444444-4444-4444-8444-444444444444";
  const CHAIR_ID = "55555555-5555-4555-8555-555555555555";
  const SERVICE_ID = "66666666-6666-4666-8666-666666666666";
  const PATIENT_ID = "77777777-7777-4777-8777-777777777777";
  const APPT_ID = "88888888-8888-4888-8888-888888888888";

  const plan = {
    id: PLAN_ID,
    code: SubscriptionPlanCode.pro,
    name: "Smile Pro",
    description: "Pro tier",
    monthlyPricePhp: 2999,
    annualPricePhp: 29990,
    trialDays: 14,
    maxDentists: 10,
    maxChairs: 8,
    maxAppointmentsPerMonth: 2000,
    maxStorageBytes: BigInt(500 * 1024 * 1024),
    maxEmailsPerMonth: 1500,
    defaultFeatures: {
      odontogramEnabled: true,
      xrayStorageEnabled: true,
      waitlistAutomationEnabled: true,
      recallAutomationEnabled: true,
      customBrandingEnabled: true,
    },
    isActive: true,
  };

  const superAdmin = {
    id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    clerkId: "clerk_root",
    email: "root@smiledental.ph",
    firstName: "Root",
    lastName: "Owner",
    phone: "+639170000001",
    role: UserRole.super_admin,
    clinicId: null,
    isActive: true,
    createdAt: new Date(),
  };

  const clinicAdmin = {
    id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    clerkId: "clerk_admin",
    email: "admin@makatismile.ph",
    firstName: "Clara",
    lastName: "Santos",
    phone: "+639170000002",
    role: UserRole.clinic_admin,
    clinicId: CLINIC_ID,
    isActive: true,
    createdAt: new Date(),
  };

  const dentistUser = {
    id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    clerkId: "clerk_dentist",
    email: "dr.reyes@makatismile.ph",
    firstName: "Marco",
    lastName: "Reyes",
    phone: "+639170000003",
    role: UserRole.dentist,
    clinicId: CLINIC_ID,
    isActive: true,
    createdAt: new Date(),
  };

  const patientUser = {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    clerkId: "clerk_patient",
    email: "juan@example.com",
    firstName: "Juan",
    lastName: "Dela Cruz",
    phone: "+639170000004",
    role: UserRole.patient,
    clinicId: null,
    isActive: true,
    createdAt: new Date(),
  };

  const clinic = {
    id: CLINIC_ID,
    name: "Makati Smile Studio",
    slug: "makati-smile",
    tagline: "Gentle care",
    logoStorageKey: null,
    primaryColorHex: "#0284c7",
    email: "hello@makatismile.ph",
    phone: "+639171234567",
    address: "123 Ayala Ave",
    city: "Makati",
    province: "Metro Manila",
    timezone: "Asia/Manila",
    planId: PLAN_ID,
    status: ClinicStatus.active,
    billingCycle: BillingCycle.monthly,
    subscriptionStartsAt: new Date(Date.now() - 86_400_000),
    subscriptionEndsAt: new Date(Date.now() + 30 * 86_400_000),
    gracePeriodEndsAt: null,
    featureFlags: plan.defaultFeatures,
    operatingHours: Array.from({ length: 7 }, (_, dayOfWeek) => ({
      dayOfWeek,
      isOpen: true,
      openMinute: 480,
      closeMinute: 1080,
    })),
    slotIntervalMinutes: 30,
    cancellationWindowHours: 24,
    emergencyBufferMinutesPerDay: 0,
    requireBookingApproval: false,
    activeDentistCount: 1,
    activeChairCount: 1,
    currentMonthKey: "2026-11",
    currentMonthAppointmentCount: 12,
    currentMonthEmailCount: 25,
    storageUsedBytes: BigInt(2 * 1024 * 1024),
    lifetimeAppointmentCount: 120,
    createdAt: new Date(),
    updatedAt: new Date(),
    plan,
  };

  const dentist = {
    id: DENTIST_ID,
    clinicId: CLINIC_ID,
    userId: dentistUser.id,
    displayName: "Dr. Marco Reyes",
    licenseNumber: "PRC-123456",
    specialties: ["General Dentistry"],
    bio: "10 years experience",
    calendarColorHex: "#6C5CE7",
    defaultChairId: CHAIR_ID,
    weeklySchedule: Array.from({ length: 7 }, (_, dayOfWeek) => ({
      dayOfWeek,
      isWorking: true,
      startMinute: 540,
      endMinute: 1020,
    })),
    isActive: true,
    user: dentistUser,
    defaultChair: { id: CHAIR_ID, name: "Chair 1", roomCode: "RM-01" },
    timeOffs: [],
  };

  const chair = {
    id: CHAIR_ID,
    clinicId: CLINIC_ID,
    name: "Chair 1",
    roomCode: "RM-01",
    supportedCategoryTags: ["General"],
    isActive: true,
  };

  const service = {
    id: SERVICE_ID,
    clinicId: CLINIC_ID,
    name: "Oral Prophylaxis",
    category: ServiceCategory.Preventive,
    description: "Teeth cleaning",
    durationMinutes: 45,
    bufferMinutes: 15,
    pricePhp: 1500,
    requiresXray: false,
    requiredChairTag: null,
    isActive: true,
  };

  const patient = {
    id: PATIENT_ID,
    clinicId: CLINIC_ID,
    userId: patientUser.id,
    guardianPatientId: null,
    firstName: "Juan",
    lastName: "Dela Cruz",
    dateOfBirth: "1995-05-12",
    sex: "male",
    phone: "+639170000004",
    email: "juan@example.com",
    noShowCount: 0,
    medicalHistory: {
      allergies: ["Penicillin"],
      conditions: [],
      isTakingBloodThinners: false,
      isPregnant: false,
      dentalAnxietyLevel: "mild",
    },
    lastCleaningDate: null,
    nextRecallDate: null,
    createdAt: new Date(),
    clinic,
  };

  const futureStart = new Date(Date.now() + 48 * 3600_000);
  const futureEnd = new Date(futureStart.getTime() + 45 * 60_000);
  const futureBuf = new Date(futureStart.getTime() + 60 * 60_000);

  const sampleAppointmentBase = {
    id: APPT_ID,
    clinicId: CLINIC_ID,
    patientId: PATIENT_ID,
    dentistId: DENTIST_ID,
    chairId: CHAIR_ID,
    serviceId: SERVICE_ID,
    dateKey: "2026-12-10",
    startTimeUtc: futureStart,
    endTimeUtc: futureEnd,
    bufferEndTimeUtc: futureBuf,
    status: AppointmentStatus.confirmed,
    bookingSource: BookingSource.patient_online,
    chiefComplaint: "Routine cleaning",
    clinicalNotes: null,
    postVisitInstructions: null,
    cancellationReason: null,
    createdAt: new Date(),
    patient: {
      id: PATIENT_ID,
      clinicId: CLINIC_ID,
      userId: patientUser.id,
      guardianPatientId: null,
      firstName: "Juan",
      lastName: "Dela Cruz",
      dateOfBirth: "1995-05-12",
      sex: "male",
      phone: "+639170000004",
      email: "juan@example.com",
      noShowCount: 0,
      medicalHistory: patient.medicalHistory,
      lastCleaningDate: null,
      nextRecallDate: null,
      createdAt: new Date(),
    },
    dentist,
    chair,
    service,
  };

  const prismaMock: Record<string, unknown> = {
    user: {
      findUnique: jest.fn(async ({ where }: { where: { clerkId?: string } }) => {
        if (where.clerkId === "clerk_root") return superAdmin;
        if (where.clerkId === "clerk_admin") return clinicAdmin;
        if (where.clerkId === "clerk_dentist") return dentistUser;
        if (where.clerkId === "clerk_patient") return patientUser;
        return null;
      }),
      findMany: jest.fn(
        async (args?: { where?: { clinicId?: string } }) => {
          const all = [
            { ...superAdmin, clinic: null },
            {
              ...clinicAdmin,
              clinic: { id: CLINIC_ID, name: clinic.name, slug: clinic.slug },
            },
            {
              ...dentistUser,
              clinic: { id: CLINIC_ID, name: clinic.name, slug: clinic.slug },
            },
          ];
          if (args?.where?.clinicId) {
            return all.filter((u) => u.clinicId === args.where?.clinicId);
          }
          return all;
        }
      ),
      count: jest.fn(async () => 4),
      groupBy: jest.fn(async () => [
        { role: UserRole.super_admin, _count: { id: 1 } },
        { role: UserRole.clinic_admin, _count: { id: 1 } },
        { role: UserRole.dentist, _count: { id: 1 } },
        { role: UserRole.patient, _count: { id: 1 } },
      ]),
    },
    subscriptionPlan: {
      findUnique: jest.fn(async ({ where }: { where: { id?: string } }) =>
        where.id === PLAN_ID ? plan : null
      ),
      findMany: jest.fn(async () => [plan]),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        ...plan,
        ...data,
      })),
    },
    clinic: {
      findUnique: jest.fn(
        async ({ where }: { where: { id?: string; slug?: string } }) => {
          if (where.id === CLINIC_ID || where.slug === clinic.slug) {
            return {
              ...clinic,
              payments: [],
              users: [clinicAdmin, dentistUser],
              invitations: [],
            };
          }
          return null;
        }
      ),
      findMany: jest.fn(async () => [clinic]),
      aggregate: jest.fn(async () => ({
        _sum: {
          storageUsedBytes: clinic.storageUsedBytes,
          currentMonthEmailCount: clinic.currentMonthEmailCount,
        },
        _count: { id: 1 },
      })),
    },
    dentist: {
      findMany: jest.fn(async () => [dentist]),
      count: jest.fn(async () => 1),
    },
    dentistTimeOff: {
      findMany: jest.fn(async () => []),
    },
    chair: {
      findMany: jest.fn(async () => [chair]),
      count: jest.fn(async () => 1),
    },
    service: {
      findFirst: jest.fn(async () => service),
      findMany: jest.fn(async () => [service]),
      count: jest.fn(async () => 1),
    },
    patient: {
      findFirst: jest.fn(async () => sampleAppointmentBase.patient),
      findMany: jest.fn(async () => [
        {
          ...sampleAppointmentBase.patient,
          clinic: {
            id: clinic.id,
            name: clinic.name,
            slug: clinic.slug,
            city: clinic.city,
            primaryColorHex: clinic.primaryColorHex,
          },
        },
      ]),
    },
    appointment: {
      findMany: jest.fn(
        async (args?: { include?: { clinic?: unknown } }) => [
          args?.include?.clinic
            ? {
                ...sampleAppointmentBase,
                clinic: {
                  id: clinic.id,
                  name: clinic.name,
                  slug: clinic.slug,
                  address: clinic.address,
                  phone: clinic.phone,
                  timezone: clinic.timezone,
                  primaryColorHex: clinic.primaryColorHex,
                  cancellationWindowHours: clinic.cancellationWindowHours,
                },
              }
            : sampleAppointmentBase,
        ]
      ),
    },
    waitlistEntry: {
      findMany: jest.fn(async () => []),
    },
    toothRecord: {
      findMany: jest.fn(async () => []),
    },
    clinicalFile: {
      findMany: jest.fn(async () => []),
    },
    subscriptionPayment: {
      findMany: jest.fn(async () => [
        {
          id: "pay-1",
          clinicId: CLINIC_ID,
          planId: PLAN_ID,
          invoiceNumber: "INV-2026-000001",
          amountPhp: 2999,
          billingCycle: BillingCycle.monthly,
          paymentMethod: "gcash",
          status: PaymentStatus.paid,
          plan: { code: plan.code, name: plan.name },
          createdAt: new Date(),
        },
      ]),
      aggregate: jest.fn(async () => ({
        _sum: { amountPhp: 2999 },
        _count: { id: 1 },
      })),
      count: jest.fn(async () => 0),
    },
    staffInvitation: {
      findMany: jest.fn(async () => [
        {
          id: "inv-pending",
          clinicId: CLINIC_ID,
          email: "new.staff@makatismile.ph",
          role: "receptionist",
          status: StaffInvitationStatus.pending,
          expiresAt: new Date(Date.now() + 7 * 86_400_000),
          createdAt: new Date(),
        },
        {
          id: "inv-declined",
          clinicId: CLINIC_ID,
          email: "old.staff@makatismile.ph",
          role: "dentist",
          status: StaffInvitationStatus.declined,
          expiresAt: new Date(Date.now() - 86_400_000),
          createdAt: new Date(),
        },
      ]),
      findUnique: jest.fn(async ({ where }: { where: { token?: string } }) =>
        where.token === "valid-token-123"
          ? {
              id: "inv-pending",
              clinicId: CLINIC_ID,
              email: "new.staff@makatismile.ph",
              role: "receptionist",
              token: "valid-token-123",
              status: StaffInvitationStatus.pending,
              expiresAt: new Date(Date.now() + 7 * 86_400_000),
              createdAt: new Date(),
              clinic: {
                id: CLINIC_ID,
                name: clinic.name,
                slug: clinic.slug,
                primaryColorHex: clinic.primaryColorHex,
                city: clinic.city,
              },
              invitedByUser: {
                firstName: "Clara",
                lastName: "Santos",
                email: clinicAdmin.email,
              },
            }
          : null
      ),
      count: jest.fn(async () => 1),
    },
    platformMetricDaily: {
      findMany: jest.fn(async () => []),
    },
    systemAnnouncement: {
      findMany: jest.fn(async () => []),
      count: jest.fn(async () => 0),
    },
    platformAuditLog: {
      findMany: jest.fn(async () => [
        {
          id: "audit-1",
          actorUserId: superAdmin.id,
          actorRole: "super_admin",
          clinicId: CLINIC_ID,
          actionType: "CLINIC_CREATED",
          targetEntity: "clinics",
          targetId: CLINIC_ID,
          metadataJson: "{}",
          createdAt: new Date(),
          actorUser: superAdmin,
        },
      ]),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => ({
        id: "audit-new",
        ...data,
      })),
    },
    $transaction: jest.fn(async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> =>
      cb(prismaMock)
    ),
    $disconnect: jest.fn(),
  };

  const clerkServiceMock = {
    verifySessionToken: jest.fn(async (token: string) => {
      if (token === "root-token") {
        return { clerkId: "clerk_root", email: superAdmin.email, claims: {} };
      }
      if (token === "admin-token") {
        return { clerkId: "clerk_admin", email: clinicAdmin.email, claims: {} };
      }
      if (token === "dentist-token") {
        return { clerkId: "clerk_dentist", email: dentistUser.email, claims: {} };
      }
      if (token === "patient-token") {
        return { clerkId: "clerk_patient", email: patientUser.email, claims: {} };
      }
      throw new Error("Unauthorized");
    }),
    getClerkUserProfile: jest.fn(async () => null),
    syncPublicMetadata: jest.fn(async () => undefined),
  };

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.SUPER_ADMIN_EMAIL = "root@smiledental.ph";

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

  it("Super Admin endpoints return enriched clinic, user, plan (PUT), and analytics shapes", async () => {
    const clinicsRes = await request(app.getHttpServer())
      .get("/api/v1/super-admin/clinics")
      .set("Authorization", "Bearer root-token")
      .expect(200);
    expect(clinicsRes.body[0].planName).toBe("Smile Pro");
    expect(clinicsRes.body[0].planCode).toBe("pro");

    const detailRes = await request(app.getHttpServer())
      .get(`/api/v1/super-admin/clinics/${CLINIC_ID}`)
      .set("Authorization", "Bearer root-token")
      .expect(200);
    expect(detailRes.body.clinic.planId).toBe(PLAN_ID);
    expect(detailRes.body.staffCount).toBe(2);
    expect(Array.isArray(detailRes.body.pendingInvitations)).toBe(true);
    expect(detailRes.body.recentAuditLogs[0].actorName).toBe("Root Owner");

    const usersRes = await request(app.getHttpServer())
      .get("/api/v1/super-admin/users")
      .set("Authorization", "Bearer root-token")
      .expect(200);
    expect(usersRes.body.callerIsRootOwner).toBe(true);
    expect(usersRes.body.users[0].name).toBe("Root Owner");

    await request(app.getHttpServer())
      .put(`/api/v1/super-admin/plans/${PLAN_ID}`)
      .set("Authorization", "Bearer root-token")
      .send({
        code: "pro",
        name: "Smile Pro Updated",
        description: "Updated tier",
        monthlyPricePhp: 3199,
        annualPricePhp: 31990,
        trialDays: 14,
        maxDentists: 12,
        maxChairs: 10,
        maxAppointmentsPerMonth: 2500,
        maxStorageBytes: 500 * 1024 * 1024,
        maxEmailsPerMonth: 1500,
        defaultFeatures: plan.defaultFeatures,
      })
      .expect(200);

    const overviewRes = await request(app.getHttpServer())
      .get("/api/v1/super-admin/analytics/overview")
      .set("Authorization", "Bearer root-token")
      .expect(200);
    expect(overviewRes.body.statusDistribution).toHaveLength(5);
    expect(typeof overviewRes.body.completionRatePct).toBe("number");
    expect(typeof overviewRes.body.noShowRatePct).toBe("number");
    expect(typeof overviewRes.body.thirtyDayTotalBooked).toBe("number");

    const usageRes = await request(app.getHttpServer())
      .get("/api/v1/super-admin/analytics/free-tier-usage")
      .set("Authorization", "Bearer root-token")
      .expect(200);
    expect(usageRes.body.storage.topClinics).toHaveLength(1);
    expect(typeof usageRes.body.storage.percentUsed).toBe("number");
    expect(usageRes.body.emails.sentThisMonth).toBe(25);
    expect(usageRes.body.emails.monthlyLimit).toBe(3000);
    expect(usageRes.body.emails.topClinics).toHaveLength(1);
    expect(usageRes.body.clerkMau.activeLast30Days).toBe(4);
    expect(usageRes.body.clerkMau.monthlyLimit).toBe(10000);

    const leaderboardRes = await request(app.getHttpServer())
      .get("/api/v1/super-admin/analytics/leaderboard?limit=8")
      .set("Authorization", "Bearer root-token")
      .expect(200);
    expect(leaderboardRes.body[0].city).toBe("Makati");
    expect(leaderboardRes.body[0].maxDentists).toBe(10);
    expect(leaderboardRes.body[0].maxChairs).toBe(8);
    expect(leaderboardRes.body[0].maxAppointmentsPerMonth).toBe(2000);
  });

  it("Clinic Admin endpoints return enriched workspace, billing, dentists, and staff payloads", async () => {
    const workspaceRes = await request(app.getHttpServer())
      .get("/api/v1/clinic/workspace")
      .set("Authorization", "Bearer admin-token")
      .expect(200);
    expect(workspaceRes.body.counts).toEqual({
      activeChairs: 1,
      activeDentists: 1,
      activeServices: 1,
    });
    expect(workspaceRes.body.user.role).toBe("clinic_admin");
    expect(workspaceRes.body.logoUrl).toBeNull();

    const billingRes = await request(app.getHttpServer())
      .get("/api/v1/clinic/billing")
      .set("Authorization", "Bearer admin-token")
      .expect(200);
    expect(billingRes.body.availablePlans).toHaveLength(1);
    expect(billingRes.body.payments[0].planName).toBe("Smile Pro");

    const dentistsRes = await request(app.getHttpServer())
      .get("/api/v1/clinic/dentists")
      .set("Authorization", "Bearer admin-token")
      .expect(200);
    expect(dentistsRes.body.dentists).toHaveLength(1);
    expect(dentistsRes.body.dentists[0].timeOff).toEqual([]);
    expect(dentistsRes.body.chairs).toHaveLength(1);
    expect(dentistsRes.body.availableUsers).toHaveLength(1);

    const staffRes = await request(app.getHttpServer())
      .get("/api/v1/clinic/staff")
      .set("Authorization", "Bearer admin-token")
      .expect(200);
    expect(staffRes.body.staff).toHaveLength(2);
    expect(staffRes.body.pendingInvitations).toHaveLength(1);
    expect(staffRes.body.declinedInvitations).toHaveLength(1);
    expect(staffRes.body.historicalInvitations).toHaveLength(1);
  });

  it("Front Desk & Dentist Queue return workspace metadata and flattened appointments", async () => {
    const fdRes = await request(app.getHttpServer())
      .get("/api/v1/appointments/front-desk?dateKey=2026-12-10")
      .set("Authorization", "Bearer admin-token")
      .expect(200);
    expect(fdRes.body.clinic.slug).toBe("makati-smile");
    expect(fdRes.body.appointments[0].patientName).toBe("Juan Dela Cruz");
    expect(fdRes.body.appointments[0].hasMedicalAlert).toBe(true);
    expect(fdRes.body.appointments[0].referenceCode).toMatch(/^SM-/);

    const queueRes = await request(app.getHttpServer())
      .get(
        "/api/v1/appointments/dentist-queue?dateKey=2026-12-10&rangeStartKey=2026-12-07&rangeEndKey=2026-12-13"
      )
      .set("Authorization", "Bearer dentist-token")
      .expect(200);
    expect(queueRes.body.clinic.slug).toBe("makati-smile");
    expect(queueRes.body.user.role).toBe("dentist");
    expect(queueRes.body.hasLinkedDentistProfile).toBe(true);
    expect(queueRes.body.canSwitchDentist).toBe(false);
    expect(queueRes.body.queue[0].patientName).toBe("Juan Dela Cruz");
    expect(queueRes.body.queue[0].chairRoomCode).toBe("RM-01");
  });

  it("Public slot availability resolves both clinic UUID and slug, and Patient Dashboard + Invitations return expected shapes", async () => {
    const futureDateKey = new Date(Date.now() + 7 * 86_400_000)
      .toISOString()
      .slice(0, 10);

    const slotsByUuid = await request(app.getHttpServer())
      .get(
        `/api/v1/public/clinics/${CLINIC_ID}/slots?serviceId=${SERVICE_ID}&dateKey=${futureDateKey}&ignoreAppointmentId=${APPT_ID}&includeEmergencyBuffer=true`
      )
      .expect(200);
    expect(Array.isArray(slotsByUuid.body)).toBe(true);
    expect(slotsByUuid.body.length).toBeGreaterThan(0);

    const dashRes = await request(app.getHttpServer())
      .get("/api/v1/patient/dashboard")
      .set("Authorization", "Bearer patient-token")
      .expect(200);
    expect(dashRes.body.user.email).toBe("juan@example.com");
    expect(dashRes.body.featuredClinics).toHaveLength(1);
    expect(dashRes.body.appointments[0].clinicSlug).toBe("makati-smile");
    expect(dashRes.body.appointments[0].referenceCode).toMatch(/^SM-/);

    const profilesRes = await request(app.getHttpServer())
      .get(`/api/v1/patient/clinics/${CLINIC_ID}/profiles`)
      .set("Authorization", "Bearer patient-token")
      .expect(200);
    expect(profilesRes.body.user.email).toBe("juan@example.com");
    expect(profilesRes.body.user.firstName).toBe("Juan");
    expect(profilesRes.body.selfProfile.firstName).toBe("Juan");

    const summaryRes = await request(app.getHttpServer())
      .get(`/api/v1/patient/clinical-summary?patientId=${PATIENT_ID}`)
      .set("Authorization", "Bearer patient-token")
      .expect(200);
    expect(Array.isArray(summaryRes.body.clinicalFiles)).toBe(true);

    const inviteRes = await request(app.getHttpServer())
      .get("/api/v1/invitations/valid-token-123")
      .expect(200);
    expect(inviteRes.body.email).toBe("new.staff@makatismile.ph");
  });
});
