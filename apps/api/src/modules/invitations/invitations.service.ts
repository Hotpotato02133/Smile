import { HttpStatus, Injectable } from "@nestjs/common";
import {
  type Prisma,
  StaffInvitationStatus,
  UserRole,
} from "@prisma/client";
import { API_ERROR_CODES } from "@smile/shared";
import { DomainException } from "../../common/exceptions/domain.exception";
import type { AuthContext } from "../../common/types/request-context";
import { DEFAULT_DENTIST_SCHEDULE } from "../../common/utils/manila-time";
import { PrismaService } from "../../infra/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ClerkService } from "../auth/clerk.service";

const ROLE_HOME_PATH = {
  super_admin: "/super-admin",
  clinic_admin: "/admin",
  dentist: "/staff",
  receptionist: "/front-desk",
  patient: "/patient",
} as const;

@Injectable()
export class InvitationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly clerkService: ClerkService
  ) {}

  /** Public sanitized lookup for `/invite/[token]` (never exposes sensitive data). */
  async getByToken(token: string) {
    const cleanToken = token.trim();
    if (!cleanToken) return null;

    const invitation = await this.prisma.staffInvitation.findUnique({
      where: { token: cleanToken },
      include: {
        clinic: {
          select: {
            id: true,
            name: true,
            slug: true,
            primaryColorHex: true,
            city: true,
          },
        },
        invitedByUser: {
          select: { firstName: true, lastName: true },
        },
      },
    });
    if (!invitation) return null;

    const now = Date.now();
    const isExpired =
      invitation.status === StaffInvitationStatus.pending &&
      invitation.expiresAt.getTime() < now;

    return {
      id: invitation.id,
      email: invitation.email,
      role: invitation.role,
      status: isExpired ? "expired" : invitation.status,
      inviterNote: invitation.inviterNote,
      inviterName: `${invitation.invitedByUser.firstName} ${invitation.invitedByUser.lastName}`.trim(),
      clinic: invitation.clinic,
      expiresAt: invitation.expiresAt,
      createdAt: invitation.createdAt,
    };
  }

  async acceptByToken(token: string, auth: AuthContext) {
    const cleanToken = token.trim();
    const invitation = await this.prisma.staffInvitation.findUnique({
      where: { token: cleanToken },
    });
    if (!invitation) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Invitation link is invalid or no longer exists.",
        HttpStatus.NOT_FOUND
      );
    }

    const now = new Date();
    const clerkProfile = !auth.identity.email
      ? await this.clerkService.getClerkUserProfile(auth.identity.clerkId)
      : null;
    const callerEmail = (
      auth.user?.email ??
      auth.identity.email ??
      clerkProfile?.email ??
      ""
    )
      .trim()
      .toLowerCase();

    if (!callerEmail || callerEmail !== invitation.email.trim().toLowerCase()) {
      throw new DomainException(
        API_ERROR_CODES.FORBIDDEN,
        "This invitation was issued to a different email address. Please sign in with the invited email.",
        HttpStatus.FORBIDDEN
      );
    }

    if (invitation.status === StaffInvitationStatus.accepted) {
      return {
        role: invitation.role,
        clinicId: invitation.clinicId,
        homePath: ROLE_HOME_PATH[invitation.role],
        alreadyAccepted: true,
      };
    }

    if (invitation.status !== StaffInvitationStatus.pending) {
      throw new DomainException(
        API_ERROR_CODES.CONFLICT,
        `This invitation has already been ${invitation.status}.`,
        HttpStatus.CONFLICT
      );
    }

    if (invitation.expiresAt.getTime() < now.getTime()) {
      throw new DomainException(
        API_ERROR_CODES.CONFLICT,
        "This invitation link has expired. Ask an administrator to resend it.",
        HttpStatus.CONFLICT
      );
    }

    const firstName =
      auth.user?.firstName ?? auth.identity.firstName ?? clerkProfile?.firstName ?? "Staff";
    const lastName =
      auth.user?.lastName ?? auth.identity.lastName ?? clerkProfile?.lastName ?? "";

    const result = await this.prisma.$transaction(async (tx) => {
      const targetRole = invitation.role as UserRole;
      const targetClinicId =
        targetRole === UserRole.super_admin ? null : invitation.clinicId;

      const user = auth.user
        ? await tx.user.update({
            where: { id: auth.user.id },
            data: {
              role: targetRole,
              clinicId: targetClinicId,
              isActive: true,
            },
          })
        : await tx.user.create({
            data: {
              clerkId: auth.identity.clerkId,
              email: callerEmail,
              firstName,
              lastName,
              phone: auth.identity.phone ?? clerkProfile?.phone ?? null,
              avatarUrl: auth.identity.avatarUrl ?? clerkProfile?.avatarUrl ?? null,
              role: targetRole,
              clinicId: targetClinicId,
              isActive: true,
            },
          });

      await tx.staffInvitation.update({
        where: { id: invitation.id },
        data: {
          status: StaffInvitationStatus.accepted,
          respondedAt: now,
        },
      });

      if (targetRole === UserRole.dentist && targetClinicId) {
        const clinic = await tx.clinic.findUnique({
          where: { id: targetClinicId },
          include: { plan: true },
        });
        if (clinic && clinic.activeDentistCount < clinic.plan.maxDentists) {
          const existingDentist = await tx.dentist.findFirst({
            where: { clinicId: clinic.id, userId: user.id },
          });
          if (!existingDentist) {
            const fullName = `${firstName} ${lastName}`.trim() || "Dentist";
            const displayName = /^dr\.?\s/i.test(fullName)
              ? fullName
              : `Dr. ${fullName}`;
            await tx.dentist.create({
              data: {
                clinicId: clinic.id,
                userId: user.id,
                displayName,
                licenseNumber: "PENDING-PRC",
                specialties: ["General Dentistry"],
                calendarColorHex: clinic.primaryColorHex,
                weeklySchedule:
                  DEFAULT_DENTIST_SCHEDULE as unknown as Prisma.InputJsonValue,
                isActive: true,
              },
            });
            await tx.clinic.update({
              where: { id: clinic.id },
              data: { activeDentistCount: { increment: 1 } },
            });
          }
        }
      }

      await this.auditService.record(
        {
          actorUserId: user.id,
          actorRole: targetRole,
          clinicId: targetClinicId,
          actionType: "ROLE_INVITATION_ACCEPTED",
          targetEntity: "staff_invitations",
          targetId: invitation.id,
          metadata: {
            email: invitation.email,
            role: invitation.role,
            via: "invite_token_page",
          },
        },
        tx
      );

      return {
        role: invitation.role,
        clinicId: targetClinicId,
        homePath: ROLE_HOME_PATH[invitation.role],
        alreadyAccepted: false,
      };
    });

    await this.clerkService.syncPublicMetadata(
      auth.identity.clerkId,
      result.role,
      result.clinicId
    );

    return result;
  }

  async declineByToken(token: string, auth: AuthContext, reason?: string) {
    const invitation = await this.prisma.staffInvitation.findUnique({
      where: { token: token.trim() },
    });
    if (!invitation) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Invitation not found.",
        HttpStatus.NOT_FOUND
      );
    }

    if (invitation.status !== StaffInvitationStatus.pending) {
      throw new DomainException(
        API_ERROR_CODES.CONFLICT,
        `This invitation has already been ${invitation.status}.`,
        HttpStatus.CONFLICT
      );
    }

    const updated = await this.prisma.staffInvitation.update({
      where: { id: invitation.id },
      data: {
        status: StaffInvitationStatus.declined,
        declineReason: reason?.trim() || null,
        respondedAt: new Date(),
      },
    });

    if (auth.user) {
      await this.auditService.record({
        actorUserId: auth.user.id,
        actorRole: auth.user.role,
        clinicId: invitation.clinicId,
        actionType: "ROLE_INVITATION_DECLINED",
        targetEntity: "staff_invitations",
        targetId: invitation.id,
        metadata: { email: invitation.email, reason: reason ?? null },
      });
    }

    return { declined: true, id: updated.id };
  }
}
