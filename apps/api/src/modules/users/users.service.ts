import { Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  type Prisma,
  StaffInvitationStatus,
  type User,
  UserRole,
} from "@prisma/client";
import type { WeeklyScheduleDay } from "@smile/shared";
import type { VerifiedClerkIdentity } from "../../common/types/request-context";
import type { AppEnv } from "../../config/env";
import { PrismaService } from "../../infra/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ClerkService } from "../auth/clerk.service";

const DEFAULT_DENTIST_SCHEDULE: WeeklyScheduleDay[] = [
  { dayOfWeek: 0, isWorking: false, startMinute: 540, endMinute: 1020 },
  {
    dayOfWeek: 1,
    isWorking: true,
    startMinute: 540,
    endMinute: 1020,
    breakStartMinute: 720,
    breakEndMinute: 780,
  },
  {
    dayOfWeek: 2,
    isWorking: true,
    startMinute: 540,
    endMinute: 1020,
    breakStartMinute: 720,
    breakEndMinute: 780,
  },
  {
    dayOfWeek: 3,
    isWorking: true,
    startMinute: 540,
    endMinute: 1020,
    breakStartMinute: 720,
    breakEndMinute: 780,
  },
  {
    dayOfWeek: 4,
    isWorking: true,
    startMinute: 540,
    endMinute: 1020,
    breakStartMinute: 720,
    breakEndMinute: 780,
  },
  {
    dayOfWeek: 5,
    isWorking: true,
    startMinute: 540,
    endMinute: 1020,
    breakStartMinute: 720,
    breakEndMinute: 780,
  },
  { dayOfWeek: 6, isWorking: true, startMinute: 540, endMinute: 900 },
];

export interface UpsertFromClerkInput {
  clerkId: string;
  email: string;
  firstName: string;
  lastName: string;
  phone?: string;
  avatarUrl?: string;
}

export interface CurrentUserResponse {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: UserRole;
  clinicId: string | null;
  isActive: boolean;
}

@Injectable()
export class UsersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly clerkService: ClerkService,
    private readonly configService: ConfigService<AppEnv, true>
  ) {}

  private getSuperAdminEmail(): string | undefined {
    return this.configService
      .get("SUPER_ADMIN_EMAIL", { infer: true })
      ?.trim()
      .toLowerCase();
  }

  toCurrentUserResponse(user: User | null): CurrentUserResponse | null {
    if (!user) return null;
    return {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
      role: user.role,
      clinicId: user.clinicId ?? null,
      isActive: user.isActive,
    };
  }

  private async ensureStarterDentistProfile(
    tx: Prisma.TransactionClient,
    params: {
      clinicId: string;
      userId: string;
      firstName: string;
      lastName: string;
    }
  ): Promise<void> {
    const clinic = await tx.clinic.findUnique({
      where: { id: params.clinicId },
      include: { plan: true },
    });
    if (!clinic) return;

    const existing = await tx.dentist.findFirst({
      where: { clinicId: clinic.id, userId: params.userId },
    });
    if (existing) return;

    if (clinic.activeDentistCount >= clinic.plan.maxDentists) {
      return;
    }

    const fullName = `${params.firstName} ${params.lastName}`.trim() || "Dentist";
    const displayName = /^dr\.?\s/i.test(fullName) ? fullName : `Dr. ${fullName}`;

    await tx.dentist.create({
      data: {
        clinicId: clinic.id,
        userId: params.userId,
        displayName,
        licenseNumber: "PENDING-PRC",
        specialties: ["General Dentistry"],
        calendarColorHex: clinic.primaryColorHex,
        weeklySchedule: DEFAULT_DENTIST_SCHEDULE as unknown as Prisma.InputJsonValue,
        isActive: true,
      },
    });

    await tx.clinic.update({
      where: { id: clinic.id },
      data: { activeDentistCount: { increment: 1 } },
    });
  }

  private async findLatestValidClinicInvitation(
    tx: Prisma.TransactionClient,
    email: string,
    now: Date
  ) {
    if (!email) return null;
    return tx.staffInvitation.findFirst({
      where: {
        email,
        status: StaffInvitationStatus.pending,
        role: { not: "super_admin" },
        clinicId: { not: null },
        expiresAt: { gte: now },
      },
      orderBy: { createdAt: "desc" },
    });
  }

  /**
   * Called by the Clerk webhook (`POST /api/v1/webhooks/clerk`).
   * Upserts the `users` row and resolves role priority:
   * SUPER_ADMIN_EMAIL > pending clinic invitation > pre-created pending staff > existing > patient.
   */
  async upsertFromClerk(
    input: UpsertFromClerkInput
  ): Promise<{ id: string; role: UserRole; clinicId: string | null }> {
    const now = new Date();
    const email = input.email.trim().toLowerCase();
    const superAdminEmail = this.getSuperAdminEmail();

    const result = await this.prisma.$transaction(async (tx) => {
      const existingByClerk = await tx.user.findUnique({
        where: { clerkId: input.clerkId },
      });

      const existingByPendingEmail = existingByClerk
        ? null
        : await tx.user.findFirst({
            where: {
              email,
              clerkId: { startsWith: "pending:" },
            },
          });

      const existing = existingByClerk ?? existingByPendingEmail;

      let role: UserRole = existing?.role ?? UserRole.patient;
      let clinicId: string | null = existing?.clinicId ?? null;
      let acceptedInvitation: {
        id: string;
        role: "clinic_admin" | "dentist" | "receptionist";
        clinicId: string;
        email: string;
      } | null = null;

      if (superAdminEmail && email === superAdminEmail) {
        role = UserRole.super_admin;
        clinicId = null;
      } else {
        const clinicInvite = await this.findLatestValidClinicInvitation(tx, email, now);
        if (
          clinicInvite &&
          clinicInvite.clinicId &&
          clinicInvite.role !== "super_admin"
        ) {
          role = clinicInvite.role as UserRole;
          clinicId = clinicInvite.clinicId;
          await tx.staffInvitation.update({
            where: { id: clinicInvite.id },
            data: {
              status: StaffInvitationStatus.accepted,
              respondedAt: now,
            },
          });
          acceptedInvitation = {
            id: clinicInvite.id,
            role: clinicInvite.role,
            clinicId: clinicInvite.clinicId,
            email: clinicInvite.email,
          };
        }
      }

      const savedUser = existing
        ? await tx.user.update({
            where: { id: existing.id },
            data: {
              clerkId: input.clerkId,
              email,
              firstName: input.firstName,
              lastName: input.lastName,
              phone: input.phone ?? null,
              avatarUrl: input.avatarUrl ?? null,
              role,
              clinicId,
              isActive: existingByPendingEmail ? true : existing.isActive,
            },
          })
        : await tx.user.create({
            data: {
              clerkId: input.clerkId,
              email,
              firstName: input.firstName,
              lastName: input.lastName,
              phone: input.phone ?? null,
              avatarUrl: input.avatarUrl ?? null,
              role,
              clinicId,
              isActive: true,
            },
          });

      if (acceptedInvitation) {
        if (acceptedInvitation.role === "dentist") {
          await this.ensureStarterDentistProfile(tx, {
            clinicId: acceptedInvitation.clinicId,
            userId: savedUser.id,
            firstName: input.firstName,
            lastName: input.lastName,
          });
        }
        await this.auditService.record(
          {
            actorUserId: savedUser.id,
            actorRole: acceptedInvitation.role,
            clinicId: acceptedInvitation.clinicId,
            actionType: "ROLE_INVITATION_ACCEPTED",
            targetEntity: "staff_invitations",
            targetId: acceptedInvitation.id,
            metadata: {
              email: acceptedInvitation.email,
              role: acceptedInvitation.role,
              via: "clerk_webhook",
            },
          },
          tx
        );
      }

      return {
        id: savedUser.id,
        role: savedUser.role,
        clinicId: savedUser.clinicId ?? null,
      };
    });

    await this.clerkService.syncPublicMetadata(
      input.clerkId,
      result.role,
      result.clinicId
    );

    return result;
  }

  /** Soft-deactivates user on Clerk deletion while preserving clinical audit trails. */
  async deactivateFromClerk(clerkId: string): Promise<void> {
    await this.prisma.user.updateMany({
      where: { clerkId },
      data: { isActive: false },
    });
  }

  /**
   * Idempotently ensures the current authenticated Clerk user exists in PostgreSQL.
   * Mirrors `convex/users.ts:ensureCurrentUser` for local dev & webhook lag resilience.
   */
  async ensureCurrentUser(
    identity: VerifiedClerkIdentity
  ): Promise<{
    id: string;
    role: UserRole;
    clinicId: string | null;
    isActive: boolean;
  }> {
    const now = new Date();
    const superAdminEmail = this.getSuperAdminEmail();

    const existing = await this.prisma.user.findUnique({
      where: { clerkId: identity.clerkId },
    });

    if (existing) {
      if (!existing.isActive) {
        return {
          id: existing.id,
          role: existing.role,
          clinicId: existing.clinicId ?? null,
          isActive: false,
        };
      }

      const existingEmail = existing.email.trim().toLowerCase();

      if (
        superAdminEmail &&
        existingEmail === superAdminEmail &&
        existing.role !== UserRole.super_admin
      ) {
        await this.prisma.user.update({
          where: { id: existing.id },
          data: { role: UserRole.super_admin, clinicId: null },
        });
        await this.clerkService.syncPublicMetadata(
          identity.clerkId,
          UserRole.super_admin,
          null
        );
        return {
          id: existing.id,
          role: UserRole.super_admin,
          clinicId: null,
          isActive: true,
        };
      }

      if (existing.role === UserRole.patient && existingEmail) {
        const promoted = await this.prisma.$transaction(async (tx) => {
          const invite = await this.findLatestValidClinicInvitation(
            tx,
            existingEmail,
            now
          );
          if (!invite || !invite.clinicId || invite.role === "super_admin") {
            return null;
          }

          await tx.user.update({
            where: { id: existing.id },
            data: {
              role: invite.role as UserRole,
              clinicId: invite.clinicId,
            },
          });
          await tx.staffInvitation.update({
            where: { id: invite.id },
            data: {
              status: StaffInvitationStatus.accepted,
              respondedAt: now,
            },
          });

          if (invite.role === "dentist") {
            await this.ensureStarterDentistProfile(tx, {
              clinicId: invite.clinicId,
              userId: existing.id,
              firstName: existing.firstName,
              lastName: existing.lastName,
            });
          }

          await this.auditService.record(
            {
              actorUserId: existing.id,
              actorRole: invite.role,
              clinicId: invite.clinicId,
              actionType: "ROLE_INVITATION_ACCEPTED",
              targetEntity: "staff_invitations",
              targetId: invite.id,
              metadata: {
                email: invite.email,
                role: invite.role,
                via: "ensure_current_user",
              },
            },
            tx
          );

          return {
            id: existing.id,
            role: invite.role as UserRole,
            clinicId: invite.clinicId,
            isActive: true,
          };
        });

        if (promoted) {
          await this.clerkService.syncPublicMetadata(
            identity.clerkId,
            promoted.role,
            promoted.clinicId
          );
          return promoted;
        }
      }

      return {
        id: existing.id,
        role: existing.role,
        clinicId: existing.clinicId ?? null,
        isActive: true,
      };
    }

    // Pull authoritative email/name from Clerk Backend API when default session JWT omits them
    const profile = !identity.email
      ? await this.clerkService.getClerkUserProfile(identity.clerkId)
      : null;

    const email = (identity.email ?? profile?.email ?? "").trim().toLowerCase();
    const firstName = identity.firstName ?? profile?.firstName ?? "Patient";
    const lastName = identity.lastName ?? profile?.lastName ?? "";
    const phone = identity.phone ?? profile?.phone;
    const avatarUrl = identity.avatarUrl ?? profile?.avatarUrl;

    const created = await this.upsertFromClerk({
      clerkId: identity.clerkId,
      email,
      firstName,
      lastName,
      phone,
      avatarUrl,
    });

    return {
      ...created,
      isActive: true,
    };
  }
}
