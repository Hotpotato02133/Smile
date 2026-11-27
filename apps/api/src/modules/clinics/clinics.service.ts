import { HttpStatus, Injectable } from "@nestjs/common";
import {
  type Prisma,
  ServiceCategory,
  StaffInvitationStatus,
  type User,
} from "@prisma/client";
import {
  API_ERROR_CODES,
  DEFAULT_SERVICE_CATALOG,
  evaluateClinicReadOnlyState,
} from "@smile/shared";
import { DomainException } from "../../common/exceptions/domain.exception";
import type { TenantContext } from "../../common/types/request-context";
import {
  DAY_MS,
  DEFAULT_DENTIST_SCHEDULE,
  generateInviteToken,
  toManilaDateKey,
} from "../../common/utils/manila-time";
import { PrismaService } from "../../infra/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ClerkService } from "../auth/clerk.service";
import { assertClinicCanWriteResource } from "../auth/guards/clinic-quota.guard";
import {
  serializeClinic,
  serializePlan,
} from "../super-admin/super-admin.service";
import type {
  AddDentistTimeOffDto,
  CreateChairDto,
  CreateDentistDto,
  CreateServiceDto,
  InviteClinicStaffDto,
  UpdateChairDto,
  UpdateClinicSettingsDto,
  UpdateDentistDto,
  UpdateServiceDto,
} from "./clinics.schemas";

function mapCategoryToPrisma(category: string): ServiceCategory {
  if (category === "Oral Surgery") return ServiceCategory.OralSurgery;
  return category as ServiceCategory;
}

@Injectable()
export class ClinicsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly clerkService: ClerkService
  ) {}

  async getWorkspace(tenant: TenantContext, actor: User) {
    const now = new Date();
    const [plan, announcements] = await Promise.all([
      this.prisma.subscriptionPlan.findUnique({
        where: { id: tenant.clinic.planId },
      }),
      this.prisma.systemAnnouncement.findMany({
        where: {
          isActive: true,
          OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
          targetAudience: {
            in:
              actor.role === "clinic_admin" || actor.role === "super_admin"
                ? ["all_users", "all_clinic_staff", "clinic_admins_only"]
                : ["all_users", "all_clinic_staff"],
          },
        },
        orderBy: { createdAt: "desc" },
        take: 10,
      }),
    ]);

    const readOnlyState = evaluateClinicReadOnlyState(
      {
        status: tenant.clinic.status,
        subscriptionEndsAt: tenant.clinic.subscriptionEndsAt.getTime(),
        gracePeriodEndsAt: tenant.clinic.gracePeriodEndsAt?.getTime() ?? null,
      },
      now.getTime(),
      tenant.isSuperAdminOverride
    );

    return {
      clinic: serializeClinic(tenant.clinic),
      plan: plan ? serializePlan(plan) : null,
      ...readOnlyState,
      isSuperAdminOverride: tenant.isSuperAdminOverride,
      announcements,
    };
  }

  async getBillingSummary(tenant: TenantContext) {
    const [plan, payments] = await Promise.all([
      this.prisma.subscriptionPlan.findUnique({
        where: { id: tenant.clinic.planId },
      }),
      this.prisma.subscriptionPayment.findMany({
        where: { clinicId: tenant.clinicId },
        include: { plan: { select: { code: true, name: true } } },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
    ]);

    return {
      clinic: serializeClinic(tenant.clinic),
      plan: plan ? serializePlan(plan) : null,
      payments,
    };
  }

  async getDailyMetrics(tenant: TenantContext, days = 30) {
    const clampedDays = Math.min(Math.max(days, 7), 90);
    const startKey = toManilaDateKey(Date.now() - (clampedDays - 1) * DAY_MS);

    return this.prisma.clinicMetricDaily.findMany({
      where: {
        clinicId: tenant.clinicId,
        dateKey: { gte: startKey },
      },
      orderBy: { dateKey: "asc" },
      take: clampedDays,
    });
  }

  async updateSettings(
    tenant: TenantContext,
    actor: User,
    dto: UpdateClinicSettingsDto
  ) {
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.clinic.update({
        where: { id: tenant.clinicId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.tagline !== undefined ? { tagline: dto.tagline } : {}),
          ...(dto.logoStorageKey !== undefined
            ? { logoStorageKey: dto.logoStorageKey }
            : {}),
          ...(dto.primaryColorHex !== undefined
            ? { primaryColorHex: dto.primaryColorHex }
            : {}),
          ...(dto.email !== undefined ? { email: dto.email } : {}),
          ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
          ...(dto.address !== undefined ? { address: dto.address } : {}),
          ...(dto.city !== undefined ? { city: dto.city } : {}),
          ...(dto.province !== undefined ? { province: dto.province } : {}),
          ...(dto.timezone !== undefined ? { timezone: dto.timezone } : {}),
          ...(dto.slotIntervalMinutes !== undefined
            ? { slotIntervalMinutes: dto.slotIntervalMinutes }
            : {}),
          ...(dto.cancellationWindowHours !== undefined
            ? { cancellationWindowHours: dto.cancellationWindowHours }
            : {}),
          ...(dto.emergencyBufferMinutesPerDay !== undefined
            ? { emergencyBufferMinutesPerDay: dto.emergencyBufferMinutesPerDay }
            : {}),
          ...(dto.requireBookingApproval !== undefined
            ? { requireBookingApproval: dto.requireBookingApproval }
            : {}),
          ...(dto.operatingHours !== undefined
            ? {
                operatingHours:
                  dto.operatingHours as unknown as Prisma.InputJsonValue,
              }
            : {}),
        },
        include: { plan: true },
      });

      await this.auditService.record(
        {
          actorUserId: actor.id,
          actorRole: actor.role,
          clinicId: tenant.clinicId,
          actionType: "CLINIC_SETTINGS_UPDATED",
          targetEntity: "clinics",
          targetId: tenant.clinicId,
          metadata: { changedFields: Object.keys(dto) },
        },
        tx
      );

      return serializeClinic(updated);
    });
  }

  // ============================================================================
  // DENTISTS & TIME OFF
  // ============================================================================

  async listDentists(tenant: TenantContext) {
    return this.prisma.dentist.findMany({
      where: { clinicId: tenant.clinicId },
      include: {
        user: {
          select: { id: true, email: true, firstName: true, lastName: true, isActive: true },
        },
        defaultChair: { select: { id: true, name: true, roomCode: true } },
        timeOffs: {
          where: { endTimeUtc: { gte: new Date() } },
          orderBy: { startTimeUtc: "asc" },
          take: 20,
        },
      },
      orderBy: { displayName: "asc" },
    });
  }

  async createDentist(
    tenant: TenantContext,
    actor: User,
    dto: CreateDentistDto
  ) {
    if (dto.defaultChairId) {
      const chair = await this.prisma.chair.findFirst({
        where: { id: dto.defaultChairId, clinicId: tenant.clinicId },
      });
      if (!chair) {
        throw new DomainException(
          API_ERROR_CODES.NOT_FOUND,
          "Default chair not found in this clinic.",
          HttpStatus.NOT_FOUND
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      let targetUserId = dto.userId;

      if (!targetUserId) {
        if (!dto.email) {
          throw new DomainException(
            API_ERROR_CODES.INVALID_INPUT,
            "Either userId or email is required to create a dentist profile.",
            HttpStatus.BAD_REQUEST
          );
        }

        const existingUser = await tx.user.findFirst({
          where: { email: dto.email },
        });
        if (existingUser) {
          targetUserId = existingUser.id;
        } else {
          const placeholder = await tx.user.create({
            data: {
              clerkId: `pending:${generateInviteToken()}`,
              email: dto.email,
              firstName: dto.firstName ?? dto.displayName,
              lastName: dto.lastName ?? "",
              role: "dentist",
              clinicId: tenant.clinicId,
              isActive: true,
            },
          });
          targetUserId = placeholder.id;

          await tx.staffInvitation.create({
            data: {
              clinicId: tenant.clinicId,
              email: dto.email,
              role: "dentist",
              token: generateInviteToken(),
              invitedByUserId: actor.id,
              status: StaffInvitationStatus.pending,
              expiresAt: new Date(Date.now() + 7 * DAY_MS),
            },
          });
        }
      }

      const dentist = await tx.dentist.create({
        data: {
          clinicId: tenant.clinicId,
          userId: targetUserId,
          displayName: dto.displayName,
          licenseNumber: dto.licenseNumber,
          specialties: dto.specialties,
          bio: dto.bio ?? null,
          calendarColorHex: dto.calendarColorHex,
          defaultChairId: dto.defaultChairId ?? null,
          weeklySchedule: (dto.weeklySchedule ??
            DEFAULT_DENTIST_SCHEDULE) as unknown as Prisma.InputJsonValue,
          isActive: true,
        },
      });

      await tx.clinic.update({
        where: { id: tenant.clinicId },
        data: { activeDentistCount: { increment: 1 } },
      });

      await this.auditService.record(
        {
          actorUserId: actor.id,
          actorRole: actor.role,
          clinicId: tenant.clinicId,
          actionType: "DENTIST_CREATED",
          targetEntity: "dentists",
          targetId: dentist.id,
          metadata: { displayName: dentist.displayName, licenseNumber: dentist.licenseNumber },
        },
        tx
      );

      return dentist;
    });
  }

  async updateDentist(
    tenant: TenantContext,
    dentistId: string,
    dto: UpdateDentistDto
  ) {
    const existing = await this.prisma.dentist.findFirst({
      where: { id: dentistId, clinicId: tenant.clinicId },
    });
    if (!existing) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Dentist not found.",
        HttpStatus.NOT_FOUND
      );
    }

    return this.prisma.dentist.update({
      where: { id: dentistId },
      data: {
        ...(dto.displayName !== undefined ? { displayName: dto.displayName } : {}),
        ...(dto.licenseNumber !== undefined
          ? { licenseNumber: dto.licenseNumber }
          : {}),
        ...(dto.specialties !== undefined ? { specialties: dto.specialties } : {}),
        ...(dto.bio !== undefined ? { bio: dto.bio } : {}),
        ...(dto.calendarColorHex !== undefined
          ? { calendarColorHex: dto.calendarColorHex }
          : {}),
        ...(dto.defaultChairId !== undefined
          ? { defaultChairId: dto.defaultChairId }
          : {}),
        ...(dto.weeklySchedule !== undefined
          ? {
              weeklySchedule:
                dto.weeklySchedule as unknown as Prisma.InputJsonValue,
            }
          : {}),
      },
    });
  }

  async toggleDentistActive(
    tenant: TenantContext,
    actor: User,
    dentistId: string
  ) {
    const existing = await this.prisma.dentist.findFirst({
      where: { id: dentistId, clinicId: tenant.clinicId },
    });
    if (!existing) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Dentist not found.",
        HttpStatus.NOT_FOUND
      );
    }

    const nextActive = !existing.isActive;
    if (nextActive) {
      const plan = await this.prisma.subscriptionPlan.findUnique({
        where: { id: tenant.clinic.planId },
      });
      if (plan) {
        assertClinicCanWriteResource(tenant.clinic, plan, "dentist");
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.dentist.update({
        where: { id: dentistId },
        data: { isActive: nextActive },
      });

      await tx.clinic.update({
        where: { id: tenant.clinicId },
        data: {
          activeDentistCount: nextActive
            ? { increment: 1 }
            : Math.max(0, tenant.clinic.activeDentistCount - 1),
        },
      });

      await this.auditService.record(
        {
          actorUserId: actor.id,
          actorRole: actor.role,
          clinicId: tenant.clinicId,
          actionType: nextActive ? "DENTIST_ACTIVATED" : "DENTIST_DEACTIVATED",
          targetEntity: "dentists",
          targetId: dentistId,
          metadata: { displayName: existing.displayName },
        },
        tx
      );

      return updated;
    });
  }

  async addDentistTimeOff(
    tenant: TenantContext,
    actor: User,
    dentistId: string,
    dto: AddDentistTimeOffDto
  ) {
    const dentist = await this.prisma.dentist.findFirst({
      where: { id: dentistId, clinicId: tenant.clinicId },
    });
    if (!dentist) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Dentist not found.",
        HttpStatus.NOT_FOUND
      );
    }

    return this.prisma.dentistTimeOff.create({
      data: {
        clinicId: tenant.clinicId,
        dentistId: dentist.id,
        startTimeUtc: dto.startTimeUtc,
        endTimeUtc: dto.endTimeUtc,
        reason: dto.reason,
        createdByUserId: actor.id,
      },
    });
  }

  async deleteDentistTimeOff(tenant: TenantContext, timeOffId: string) {
    const existing = await this.prisma.dentistTimeOff.findFirst({
      where: { id: timeOffId, clinicId: tenant.clinicId },
    });
    if (!existing) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Time-off block not found.",
        HttpStatus.NOT_FOUND
      );
    }
    await this.prisma.dentistTimeOff.delete({ where: { id: timeOffId } });
    return { deleted: true };
  }

  // ============================================================================
  // CHAIRS
  // ============================================================================

  async listChairs(tenant: TenantContext) {
    return this.prisma.chair.findMany({
      where: { clinicId: tenant.clinicId },
      orderBy: { name: "asc" },
    });
  }

  async createChair(tenant: TenantContext, actor: User, dto: CreateChairDto) {
    return this.prisma.$transaction(async (tx) => {
      const chair = await tx.chair.create({
        data: {
          clinicId: tenant.clinicId,
          name: dto.name,
          roomCode: dto.roomCode,
          supportedCategoryTags: dto.supportedCategoryTags,
          isActive: true,
        },
      });

      await tx.clinic.update({
        where: { id: tenant.clinicId },
        data: { activeChairCount: { increment: 1 } },
      });

      await this.auditService.record(
        {
          actorUserId: actor.id,
          actorRole: actor.role,
          clinicId: tenant.clinicId,
          actionType: "CHAIR_CREATED",
          targetEntity: "chairs",
          targetId: chair.id,
          metadata: { name: chair.name, roomCode: chair.roomCode },
        },
        tx
      );

      return chair;
    });
  }

  async updateChair(
    tenant: TenantContext,
    chairId: string,
    dto: UpdateChairDto
  ) {
    const existing = await this.prisma.chair.findFirst({
      where: { id: chairId, clinicId: tenant.clinicId },
    });
    if (!existing) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Operatory chair not found.",
        HttpStatus.NOT_FOUND
      );
    }

    return this.prisma.chair.update({
      where: { id: chairId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.roomCode !== undefined ? { roomCode: dto.roomCode } : {}),
        ...(dto.supportedCategoryTags !== undefined
          ? { supportedCategoryTags: dto.supportedCategoryTags }
          : {}),
      },
    });
  }

  async toggleChairActive(
    tenant: TenantContext,
    actor: User,
    chairId: string
  ) {
    const existing = await this.prisma.chair.findFirst({
      where: { id: chairId, clinicId: tenant.clinicId },
    });
    if (!existing) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Operatory chair not found.",
        HttpStatus.NOT_FOUND
      );
    }

    const nextActive = !existing.isActive;
    if (nextActive) {
      const plan = await this.prisma.subscriptionPlan.findUnique({
        where: { id: tenant.clinic.planId },
      });
      if (plan) {
        assertClinicCanWriteResource(tenant.clinic, plan, "chair");
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.chair.update({
        where: { id: chairId },
        data: { isActive: nextActive },
      });

      await tx.clinic.update({
        where: { id: tenant.clinicId },
        data: {
          activeChairCount: nextActive
            ? { increment: 1 }
            : Math.max(0, tenant.clinic.activeChairCount - 1),
        },
      });

      await this.auditService.record(
        {
          actorUserId: actor.id,
          actorRole: actor.role,
          clinicId: tenant.clinicId,
          actionType: nextActive ? "CHAIR_ACTIVATED" : "CHAIR_DEACTIVATED",
          targetEntity: "chairs",
          targetId: chairId,
          metadata: { name: existing.name },
        },
        tx
      );

      return updated;
    });
  }

  // ============================================================================
  // SERVICES
  // ============================================================================

  async listServices(tenant: TenantContext) {
    return this.prisma.service.findMany({
      where: { clinicId: tenant.clinicId },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
  }

  async createService(tenant: TenantContext, dto: CreateServiceDto) {
    return this.prisma.service.create({
      data: {
        clinicId: tenant.clinicId,
        name: dto.name,
        category: mapCategoryToPrisma(dto.category),
        description: dto.description,
        durationMinutes: dto.durationMinutes,
        bufferMinutes: dto.bufferMinutes,
        pricePhp: dto.pricePhp,
        requiresXray: dto.requiresXray,
        requiredChairTag: dto.requiredChairTag ?? null,
        isActive: true,
      },
    });
  }

  async updateService(
    tenant: TenantContext,
    serviceId: string,
    dto: UpdateServiceDto
  ) {
    const existing = await this.prisma.service.findFirst({
      where: { id: serviceId, clinicId: tenant.clinicId },
    });
    if (!existing) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Dental service not found.",
        HttpStatus.NOT_FOUND
      );
    }

    return this.prisma.service.update({
      where: { id: serviceId },
      data: {
        ...(dto.name !== undefined ? { name: dto.name } : {}),
        ...(dto.category !== undefined
          ? { category: mapCategoryToPrisma(dto.category) }
          : {}),
        ...(dto.description !== undefined ? { description: dto.description } : {}),
        ...(dto.durationMinutes !== undefined
          ? { durationMinutes: dto.durationMinutes }
          : {}),
        ...(dto.bufferMinutes !== undefined
          ? { bufferMinutes: dto.bufferMinutes }
          : {}),
        ...(dto.pricePhp !== undefined ? { pricePhp: dto.pricePhp } : {}),
        ...(dto.requiresXray !== undefined
          ? { requiresXray: dto.requiresXray }
          : {}),
        ...(dto.requiredChairTag !== undefined
          ? { requiredChairTag: dto.requiredChairTag }
          : {}),
      },
    });
  }

  async toggleServiceActive(tenant: TenantContext, serviceId: string) {
    const existing = await this.prisma.service.findFirst({
      where: { id: serviceId, clinicId: tenant.clinicId },
    });
    if (!existing) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Dental service not found.",
        HttpStatus.NOT_FOUND
      );
    }
    return this.prisma.service.update({
      where: { id: serviceId },
      data: { isActive: !existing.isActive },
    });
  }

  async seedDefaultServices(tenant: TenantContext) {
    const existing = await this.prisma.service.findMany({
      where: { clinicId: tenant.clinicId },
      select: { name: true },
    });
    const existingNames = new Set(existing.map((s) => s.name.toLowerCase()));
    const toCreate = DEFAULT_SERVICE_CATALOG.filter(
      (item) => !existingNames.has(item.name.toLowerCase())
    );
    if (toCreate.length === 0) {
      return { created: 0 };
    }
    await this.prisma.service.createMany({
      data: toCreate.map((item) => ({
        clinicId: tenant.clinicId,
        name: item.name,
        category: mapCategoryToPrisma(item.category),
        description: item.description,
        durationMinutes: item.durationMinutes,
        bufferMinutes: item.bufferMinutes,
        pricePhp: item.pricePhp,
        requiresXray: item.requiresXray,
        requiredChairTag: item.requiredChairTag ?? null,
        isActive: true,
      })),
    });
    return { created: toCreate.length };
  }

  // ============================================================================
  // STAFF & CLINIC INVITATIONS
  // ============================================================================

  async listStaff(tenant: TenantContext) {
    const [members, invitations] = await Promise.all([
      this.prisma.user.findMany({
        where: {
          clinicId: tenant.clinicId,
          role: { in: ["clinic_admin", "dentist", "receptionist"] },
        },
        select: {
          id: true,
          clerkId: true,
          email: true,
          firstName: true,
          lastName: true,
          phone: true,
          role: true,
          isActive: true,
          lastLoginAt: true,
          createdAt: true,
        },
        orderBy: { createdAt: "desc" },
      }),
      this.prisma.staffInvitation.findMany({
        where: {
          clinicId: tenant.clinicId,
          status: StaffInvitationStatus.pending,
        },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    return {
      members: members.filter((m) => !m.clerkId.startsWith("pending:")),
      invitations,
    };
  }

  async inviteStaff(
    tenant: TenantContext,
    actor: User,
    dto: InviteClinicStaffDto
  ) {
    return this.prisma.$transaction(async (tx) => {
      const invitation = await tx.staffInvitation.create({
        data: {
          clinicId: tenant.clinicId,
          email: dto.email,
          role: dto.role,
          token: generateInviteToken(),
          inviterNote: dto.inviterNote ?? null,
          invitedByUserId: actor.id,
          status: StaffInvitationStatus.pending,
          expiresAt: new Date(Date.now() + dto.expiresInDays * DAY_MS),
        },
      });

      await this.auditService.record(
        {
          actorUserId: actor.id,
          actorRole: actor.role,
          clinicId: tenant.clinicId,
          actionType: "STAFF_INVITATION_CREATED",
          targetEntity: "staff_invitations",
          targetId: invitation.id,
          metadata: { email: invitation.email, role: invitation.role },
        },
        tx
      );

      return invitation;
    });
  }

  async resendStaffInvitation(
    tenant: TenantContext,
    actor: User,
    invitationId: string
  ) {
    const inv = await this.prisma.staffInvitation.findFirst({
      where: {
        id: invitationId,
        clinicId: tenant.clinicId,
        status: StaffInvitationStatus.pending,
      },
    });
    if (!inv) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Pending invitation not found.",
        HttpStatus.NOT_FOUND
      );
    }
    const updated = await this.prisma.staffInvitation.update({
      where: { id: inv.id },
      data: {
        token: inv.token ?? generateInviteToken(),
        expiresAt: new Date(Date.now() + 7 * DAY_MS),
      },
    });
    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      clinicId: tenant.clinicId,
      actionType: "STAFF_INVITATION_RESENT",
      targetEntity: "staff_invitations",
      targetId: inv.id,
      metadata: { email: inv.email, role: inv.role },
    });
    return updated;
  }

  async revokeStaffInvitation(
    tenant: TenantContext,
    actor: User,
    invitationId: string
  ) {
    const inv = await this.prisma.staffInvitation.findFirst({
      where: { id: invitationId, clinicId: tenant.clinicId },
    });
    if (!inv) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Invitation not found.",
        HttpStatus.NOT_FOUND
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.staffInvitation.update({
        where: { id: inv.id },
        data: { status: StaffInvitationStatus.revoked, respondedAt: new Date() },
      });
      await this.auditService.record(
        {
          actorUserId: actor.id,
          actorRole: actor.role,
          clinicId: tenant.clinicId,
          actionType: "STAFF_INVITATION_REVOKED",
          targetEntity: "staff_invitations",
          targetId: inv.id,
          metadata: { email: inv.email, role: inv.role },
        },
        tx
      );
      return updated;
    });
  }

  async toggleStaffActive(
    tenant: TenantContext,
    actor: User,
    targetUserId: string
  ) {
    if (targetUserId === actor.id) {
      throw new DomainException(
        API_ERROR_CODES.INVALID_INPUT,
        "You cannot deactivate your own account.",
        HttpStatus.BAD_REQUEST
      );
    }

    const target = await this.prisma.user.findFirst({
      where: { id: targetUserId, clinicId: tenant.clinicId },
    });
    if (!target) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Staff member not found in this clinic.",
        HttpStatus.NOT_FOUND
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.user.update({
        where: { id: target.id },
        data: { isActive: !target.isActive },
      });

      await this.auditService.record(
        {
          actorUserId: actor.id,
          actorRole: actor.role,
          clinicId: tenant.clinicId,
          actionType: row.isActive ? "STAFF_REACTIVATED" : "STAFF_DEACTIVATED",
          targetEntity: "users",
          targetId: target.id,
          metadata: { email: target.email, role: target.role },
        },
        tx
      );
      return row;
    });

    await this.clerkService.syncPublicMetadata(
      updated.clerkId,
      updated.role,
      updated.clinicId
    );
    return updated;
  }
}
