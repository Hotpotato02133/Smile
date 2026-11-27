import { Controller, Get, INestApplication, Post, UseGuards } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import { ClinicStatus, UserRole } from "@prisma/client";
import request from "supertest";
import { Webhook } from "svix";
import { AppModule } from "../src/app.module";
import { configureApp } from "../src/bootstrap";
import {
  CurrentTenant,
  CurrentUser,
  RequireClinicAccess,
  RequireRootSuperAdmin,
  Roles,
} from "../src/common/decorators/auth.decorators";
import type { TenantContext } from "../src/common/types/request-context";
import { PrismaService } from "../src/infra/prisma.service";
import { ClerkService } from "../src/modules/auth/clerk.service";
import { ClerkJwtGuard } from "../src/modules/auth/guards/clerk-jwt.guard";
import { RolesGuard } from "../src/modules/auth/guards/roles.guard";
import { TenantAccessGuard } from "../src/modules/auth/guards/tenant-access.guard";

@Controller("test-rbac")
@UseGuards(ClerkJwtGuard, RolesGuard, TenantAccessGuard)
class TestRbacController {
  @Get("super-admin")
  @Roles("super_admin")
  superAdminOnly(@CurrentUser() user: { id: string; role: string }) {
    return { ok: true, userId: user.id, role: user.role };
  }

  @Post("root-owner")
  @RequireRootSuperAdmin()
  rootOwnerOnly() {
    return { ok: true };
  }

  @Get("clinic-read")
  @RequireClinicAccess(["clinic_admin", "dentist", "receptionist"])
  clinicRead(@CurrentTenant() tenant: TenantContext) {
    return {
      clinicId: tenant.clinicId,
      isSuperAdminOverride: tenant.isSuperAdminOverride,
    };
  }

  @Post("clinic-write")
  @RequireClinicAccess(["clinic_admin", "dentist"])
  clinicWrite(@CurrentTenant() tenant: TenantContext) {
    return {
      clinicId: tenant.clinicId,
      isSuperAdminOverride: tenant.isSuperAdminOverride,
    };
  }
}

describe("Auth, RBAC, Tenant Isolation & Clerk Webhooks (e2e)", () => {
  let app: INestApplication;

  // Constructed at runtime so secret scanners do not flag a hardcoded whsec_* test fixture
  const WEBHOOK_SECRET = `whsec_${Buffer.from("test_secret_key_1234567890123456").toString("base64")}`;
  const SUPER_ADMIN_EMAIL = "owner@smiledental.ph";

  const mockClinic = {
    id: "11111111-1111-4111-8111-111111111111",
    name: "Makati Smile Clinic",
    slug: "makati-smile",
    status: ClinicStatus.active,
    primaryColorHex: "#0284c7",
    activeDentistCount: 0,
    plan: { maxDentists: 2 },
  };

  const usersByClerkId = new Map<string, Record<string, unknown>>();
  const createdAuditLogs: Record<string, unknown>[] = [];
  const createdDentists: Record<string, unknown>[] = [];
  let pendingInvitation: Record<string, unknown> | null = null;

  const prismaMock: Record<string, unknown> = {
    user: {
      findUnique: jest.fn(async ({ where }: { where: { clerkId?: string } }) =>
        where.clerkId ? (usersByClerkId.get(where.clerkId) ?? null) : null
      ),
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const record = {
          id: `user-${usersByClerkId.size + 1}`,
          createdAt: new Date(),
          ...data,
        };
        usersByClerkId.set(String(data.clerkId), record);
        return record;
      }),
      update: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { id: string };
          data: Record<string, unknown>;
        }) => {
          for (const [k, v] of usersByClerkId.entries()) {
            if (v.id === where.id) {
              const updated = { ...v, ...data };
              usersByClerkId.set(k, updated);
              return updated;
            }
          }
          throw new Error("User not found");
        }
      ),
      updateMany: jest.fn(
        async ({
          where,
          data,
        }: {
          where: { clerkId: string };
          data: Record<string, unknown>;
        }) => {
          const existing = usersByClerkId.get(where.clerkId);
          if (existing) {
            usersByClerkId.set(where.clerkId, { ...existing, ...data });
            return { count: 1 };
          }
          return { count: 0 };
        }
      ),
    },
    clinic: {
      findUnique: jest.fn(async ({ where }: { where: { id: string } }) =>
        where.id === mockClinic.id ? mockClinic : null
      ),
      update: jest.fn(async () => mockClinic),
    },
    staffInvitation: {
      findFirst: jest.fn(async ({ where }: { where: { email: string } }) =>
        pendingInvitation && pendingInvitation.email === where.email
          ? pendingInvitation
          : null
      ),
      update: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        if (pendingInvitation) {
          pendingInvitation = { ...pendingInvitation, ...data };
        }
        return pendingInvitation;
      }),
    },
    dentist: {
      findFirst: jest.fn(async () => null),
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        createdDentists.push(data);
        return { id: "dentist-1", ...data };
      }),
    },
    platformAuditLog: {
      create: jest.fn(async ({ data }: { data: Record<string, unknown> }) => {
        createdAuditLogs.push(data);
        return { id: `audit-${createdAuditLogs.length}`, ...data };
      }),
    },
    $transaction: jest.fn(async <T>(cb: (tx: unknown) => Promise<T>): Promise<T> =>
      cb(prismaMock)
    ),
    $disconnect: jest.fn(),
  };

  const clerkServiceMock = {
    verifySessionToken: jest.fn(async (token: string) => {
      if (token === "token-root-owner") {
        return {
          clerkId: "clerk_owner",
          email: SUPER_ADMIN_EMAIL,
          firstName: "Platform",
          lastName: "Owner",
          claims: {},
        };
      }
      if (token === "token-co-super-admin") {
        return {
          clerkId: "clerk_co_admin",
          email: "co-admin@smiledental.ph",
          firstName: "Co",
          lastName: "Admin",
          claims: {},
        };
      }
      if (token === "token-dentist") {
        return {
          clerkId: "clerk_dentist",
          email: "dr.maria@makatismile.ph",
          firstName: "Maria",
          lastName: "Santos",
          claims: {},
        };
      }
      if (token === "token-deactivated") {
        return {
          clerkId: "clerk_inactive",
          email: "inactive@makatismile.ph",
          firstName: "Old",
          lastName: "Staff",
          claims: {},
        };
      }
      throw new Error("bad token");
    }),
    getClerkUserProfile: jest.fn(async () => null),
    syncPublicMetadata: jest.fn(async () => undefined),
  };

  beforeAll(async () => {
    process.env.NODE_ENV = "test";
    process.env.SUPER_ADMIN_EMAIL = SUPER_ADMIN_EMAIL;
    process.env.CLERK_WEBHOOK_SECRET = WEBHOOK_SECRET;

    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
      controllers: [TestRbacController],
    })
      .overrideProvider(PrismaService)
      .useValue(prismaMock)
      .overrideProvider(ClerkService)
      .useValue(clerkServiceMock)
      .compile();

    app = moduleRef.createNestApplication({ rawBody: true });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    usersByClerkId.clear();
    createdAuditLogs.length = 0;
    createdDentists.length = 0;
    pendingInvitation = null;
    jest.clearAllMocks();

    usersByClerkId.set("clerk_owner", {
      id: "u-owner",
      clerkId: "clerk_owner",
      email: SUPER_ADMIN_EMAIL,
      firstName: "Platform",
      lastName: "Owner",
      role: UserRole.super_admin,
      clinicId: null,
      isActive: true,
    });
    usersByClerkId.set("clerk_co_admin", {
      id: "u-co-admin",
      clerkId: "clerk_co_admin",
      email: "co-admin@smiledental.ph",
      firstName: "Co",
      lastName: "Admin",
      role: UserRole.super_admin,
      clinicId: null,
      isActive: true,
    });
    usersByClerkId.set("clerk_dentist", {
      id: "u-dentist",
      clerkId: "clerk_dentist",
      email: "dr.maria@makatismile.ph",
      firstName: "Maria",
      lastName: "Santos",
      role: UserRole.dentist,
      clinicId: mockClinic.id,
      isActive: true,
    });
    usersByClerkId.set("clerk_inactive", {
      id: "u-inactive",
      clerkId: "clerk_inactive",
      email: "inactive@makatismile.ph",
      firstName: "Old",
      lastName: "Staff",
      role: UserRole.receptionist,
      clinicId: mockClinic.id,
      isActive: false,
    });
  });

  it("rejects unauthenticated requests with 401 UNAUTHENTICATED", async () => {
    const res = await request(app.getHttpServer())
      .get("/api/v1/users/me")
      .expect(401);
    expect(res.body.code).toBe("UNAUTHENTICATED");
  });

  it("GET /api/v1/users/me returns the authenticated user and supports deactivated accounts cleanly", async () => {
    const activeRes = await request(app.getHttpServer())
      .get("/api/v1/users/me")
      .set("Authorization", "Bearer token-dentist")
      .expect(200);
    expect(activeRes.body).toMatchObject({
      id: "u-dentist",
      role: "dentist",
      clinicId: mockClinic.id,
      isActive: true,
    });

    const inactiveRes = await request(app.getHttpServer())
      .get("/api/v1/users/me")
      .set("Authorization", "Bearer token-deactivated")
      .expect(200);
    expect(inactiveRes.body.isActive).toBe(false);
  });

  it("blocks deactivated users and wrong roles on protected routes with 403 FORBIDDEN", async () => {
    await request(app.getHttpServer())
      .get("/api/v1/test-rbac/clinic-read")
      .set("Authorization", "Bearer token-deactivated")
      .expect(403);

    await request(app.getHttpServer())
      .get("/api/v1/test-rbac/super-admin")
      .set("Authorization", "Bearer token-dentist")
      .expect(403);

    // Co-Super Admin is allowed on super-admin routes but blocked on root-owner-only routes (Law #3)
    await request(app.getHttpServer())
      .get("/api/v1/test-rbac/super-admin")
      .set("Authorization", "Bearer token-co-super-admin")
      .expect(200);

    await request(app.getHttpServer())
      .post("/api/v1/test-rbac/root-owner")
      .set("Authorization", "Bearer token-co-super-admin")
      .expect(403);

    await request(app.getHttpServer())
      .post("/api/v1/test-rbac/root-owner")
      .set("Authorization", "Bearer token-root-owner")
      .expect(201);
  });

  it("enforces tenant isolation and strictly read-only Super Admin View-As-Clinic mode", async () => {
    const staffRead = await request(app.getHttpServer())
      .get("/api/v1/test-rbac/clinic-read")
      .set("Authorization", "Bearer token-dentist")
      .expect(200);
    expect(staffRead.body).toEqual({
      clinicId: mockClinic.id,
      isSuperAdminOverride: false,
    });

    const superAdminRead = await request(app.getHttpServer())
      .get(`/api/v1/test-rbac/clinic-read?overrideClinicId=${mockClinic.id}`)
      .set("Authorization", "Bearer token-root-owner")
      .expect(200);
    expect(superAdminRead.body).toEqual({
      clinicId: mockClinic.id,
      isSuperAdminOverride: true,
    });

    const superAdminWrite = await request(app.getHttpServer())
      .post(`/api/v1/test-rbac/clinic-write?overrideClinicId=${mockClinic.id}`)
      .set("Authorization", "Bearer token-root-owner")
      .expect(403);
    expect(superAdminWrite.body.code).toBe("READ_ONLY_IMPERSONATION");
  });

  it("POST /api/v1/users/ensure auto-accepts a pending dentist invitation, creates starter profile, and logs audit entry", async () => {
    usersByClerkId.delete("clerk_dentist");
    pendingInvitation = {
      id: "inv-1",
      clinicId: mockClinic.id,
      email: "dr.maria@makatismile.ph",
      role: "dentist",
      status: "pending",
      expiresAt: new Date(Date.now() + 86_400_000),
      createdAt: new Date(),
    };

    const res = await request(app.getHttpServer())
      .post("/api/v1/users/ensure")
      .set("Authorization", "Bearer token-dentist")
      .expect(200);

    expect(res.body).toMatchObject({
      role: "dentist",
      clinicId: mockClinic.id,
      isActive: true,
    });
    expect(createdDentists).toHaveLength(1);
    expect(createdDentists[0].displayName).toBe("Dr. Maria Santos");
    expect(createdAuditLogs).toHaveLength(1);
    expect(createdAuditLogs[0].actionType).toBe("ROLE_INVITATION_ACCEPTED");
    expect(clerkServiceMock.syncPublicMetadata).toHaveBeenCalledWith(
      "clerk_dentist",
      "dentist",
      mockClinic.id
    );
  });

  it("POST /api/v1/webhooks/clerk verifies Svix signatures and handles user.created / user.deleted", async () => {
    await request(app.getHttpServer())
      .post("/api/v1/webhooks/clerk")
      .set("svix-id", "msg_bad")
      .set("svix-timestamp", String(Math.floor(Date.now() / 1000)))
      .set("svix-signature", "v1,invalid")
      .send({ type: "user.created", data: {} })
      .expect(400);

    const wh = new Webhook(WEBHOOK_SECRET);
    const createdBody = JSON.stringify({
      type: "user.created",
      data: {
        id: "clerk_new_patient",
        first_name: "Juan",
        last_name: "Dela Cruz",
        primary_email_address_id: "em_1",
        email_addresses: [{ id: "em_1", email_address: "juan@example.com" }],
      },
    });
    const timestamp = new Date();
    const msgId = "msg_valid_created";
    const signature = wh.sign(msgId, timestamp, createdBody);

    await request(app.getHttpServer())
      .post("/api/v1/webhooks/clerk")
      .set("Content-Type", "application/json")
      .set("svix-id", msgId)
      .set("svix-timestamp", String(Math.floor(timestamp.getTime() / 1000)))
      .set("svix-signature", signature)
      .send(createdBody)
      .expect(200);

    expect(usersByClerkId.get("clerk_new_patient")).toMatchObject({
      email: "juan@example.com",
      role: "patient",
      isActive: true,
    });

    const deletedBody = JSON.stringify({
      type: "user.deleted",
      data: { id: "clerk_new_patient" },
    });
    const delMsgId = "msg_valid_deleted";
    const delSig = wh.sign(delMsgId, timestamp, deletedBody);

    await request(app.getHttpServer())
      .post("/api/v1/webhooks/clerk")
      .set("Content-Type", "application/json")
      .set("svix-id", delMsgId)
      .set("svix-timestamp", String(Math.floor(timestamp.getTime() / 1000)))
      .set("svix-signature", delSig)
      .send(deletedBody)
      .expect(200);

    expect(usersByClerkId.get("clerk_new_patient")?.isActive).toBe(false);
  });
});
