import { HttpStatus, Injectable } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
  type Clinic,
  ClinicStatus,
  type Prisma,
  ServiceCategory,
  StaffInvitationStatus,
  type SubscriptionPlan,
  type User,
} from "@prisma/client";
import {
  API_ERROR_CODES,
  DEFAULT_SERVICE_CATALOG,
  GRACE_PERIOD_MS,
} from "@smile/shared";
import { DomainException } from "../../common/exceptions/domain.exception";
import {
  DAY_MS,
  DEFAULT_OPERATING_HOURS,
  generateInviteToken,
  toManilaMonthKey,
} from "../../common/utils/manila-time";
import type { AppEnv } from "../../config/env";
import { PrismaService } from "../../infra/prisma.service";
import { AuditService } from "../audit/audit.service";
import { ClerkService } from "../auth/clerk.service";
import { JobsService } from "../jobs/jobs.service";
import { NotificationsService } from "../notifications/notifications.service";
import type {
  ChangeClinicPlanDto,
  CreateAnnouncementDto,
  CreateClinicDto,
  CreateRoleInvitationDto,
  ExtendClinicSubscriptionDto,
  UpdateAnnouncementDto,
  UpdateClinicDetailsDto,
  UpdateClinicFeaturesDto,
  UpdateClinicStatusDto,
  UpdateUserRoleOrStatusDto,
} from "./super-admin.schemas";

function mapServiceCategoryToPrisma(category: string): ServiceCategory {
  if (category === "Oral Surgery") return ServiceCategory.OralSurgery;
  return category as ServiceCategory;
}

export function serializePlan(plan: SubscriptionPlan) {
  return {
    ...plan,
    maxStorageBytes: Number(plan.maxStorageBytes),
  };
}

export function serializeClinic(clinic: Clinic & { plan?: SubscriptionPlan }) {
  return {
    ...clinic,
    storageUsedBytes: Number(clinic.storageUsedBytes),
    ...(clinic.plan ? { plan: serializePlan(clinic.plan) } : {}),
  };
}

@Injectable()
export class SuperAdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly clerkService: ClerkService,
    private readonly configService: ConfigService<AppEnv, true>,
    private readonly jobsService: JobsService,
    private readonly notifications: NotificationsService
  ) {}

  private isRootOwner(user: User): boolean {
    const ownerEmail = this.configService
      .get("SUPER_ADMIN_EMAIL", { infer: true })
      ?.trim()
      .toLowerCase();
    return Boolean(
      user.role === "super_admin" &&
        ownerEmail &&
        user.email.trim().toLowerCase() === ownerEmail
    );
  }

  async listClinics(filters: {
    status?: ClinicStatus;
    planId?: string;
    search?: string;
  }) {
    const where: Prisma.ClinicWhereInput = {};
    if (filters.status) where.status = filters.status;
    if (filters.planId) where.planId = filters.planId;
    if (filters.search?.trim()) {
      const q = filters.search.trim();
      where.OR = [
        { name: { contains: q, mode: "insensitive" } },
        { slug: { contains: q, mode: "insensitive" } },
        { city: { contains: q, mode: "insensitive" } },
        { email: { contains: q, mode: "insensitive" } },
      ];
    }

    const clinics = await this.prisma.clinic.findMany({
      where,
      include: { plan: true },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
    return clinics.map(serializeClinic);
  }

  async getClinicDetail(clinicId: string) {
    const clinic = await this.prisma.clinic.findUnique({
      where: { id: clinicId },
      include: {
        plan: true,
        payments: {
          orderBy: { createdAt: "desc" },
          take: 20,
          include: { plan: true },
        },
        users: {
          where: { role: { not: "patient" } },
          select: {
            id: true,
            email: true,
            firstName: true,
            lastName: true,
            role: true,
            isActive: true,
            createdAt: true,
          },
        },
        invitations: {
          where: { status: StaffInvitationStatus.pending },
          orderBy: { createdAt: "desc" },
          take: 20,
        },
      },
    });
    if (!clinic) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Clinic not found.",
        HttpStatus.NOT_FOUND
      );
    }

    return {
      ...serializeClinic(clinic),
      payments: clinic.payments.map((p) => ({
        ...p,
        plan: serializePlan(p.plan),
      })),
    };
  }

  async createClinic(actor: User, dto: CreateClinicDto) {
    const now = new Date();

    const [existingSlug, plan] = await Promise.all([
      this.prisma.clinic.findUnique({ where: { slug: dto.slug } }),
      this.prisma.subscriptionPlan.findUnique({ where: { id: dto.planId } }),
    ]);

    if (existingSlug) {
      throw new DomainException(
        API_ERROR_CODES.CONFLICT,
        `Clinic slug "${dto.slug}" is already taken.`,
        HttpStatus.CONFLICT
      );
    }
    if (!plan) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Subscription plan not found.",
        HttpStatus.NOT_FOUND
      );
    }

    const status: ClinicStatus =
      dto.status ?? (dto.billingCycle === "trial" ? "trial" : "active");
    const defaultDays =
      dto.billingCycle === "annual"
        ? 365
        : dto.billingCycle === "trial"
          ? Math.max(plan.trialDays || 14, 1)
          : 30;
    const durationDays = dto.durationDays ?? defaultDays;
    const subscriptionEndsAt = new Date(now.getTime() + durationDays * DAY_MS);
    const trialEndsAt = status === "trial" ? subscriptionEndsAt : null;

    return this.prisma.$transaction(async (tx) => {
      const clinic = await tx.clinic.create({
        data: {
          name: dto.name,
          slug: dto.slug,
          tagline: dto.tagline ?? null,
          primaryColorHex: dto.primaryColorHex,
          email: dto.email,
          phone: dto.phone,
          address: dto.address,
          city: dto.city,
          province: dto.province,
          timezone: dto.timezone,
          planId: plan.id,
          status,
          billingCycle: dto.billingCycle,
          trialEndsAt,
          subscriptionStartsAt: now,
          subscriptionEndsAt,
          featureFlags: plan.defaultFeatures as Prisma.InputJsonValue,
          currentMonthKey: toManilaMonthKey(now),
          operatingHours: DEFAULT_OPERATING_HOURS as unknown as Prisma.InputJsonValue,
        },
        include: { plan: true },
      });

      if (dto.seedDefaultServices) {
        await tx.service.createMany({
          data: DEFAULT_SERVICE_CATALOG.map((item) => ({
            clinicId: clinic.id,
            name: item.name,
            category: mapServiceCategoryToPrisma(item.category),
            description: item.description,
            durationMinutes: item.durationMinutes,
            bufferMinutes: item.bufferMinutes,
            pricePhp: item.pricePhp,
            requiresXray: item.requiresXray,
            requiredChairTag: item.requiredChairTag ?? null,
            isActive: true,
          })),
        });
      }

      let invitation = null;
      if (dto.adminInviteEmail) {
        invitation = await tx.staffInvitation.create({
          data: {
            clinicId: clinic.id,
            email: dto.adminInviteEmail,
            role: "clinic_admin",
            token: generateInviteToken(),
            invitedByUserId: actor.id,
            status: StaffInvitationStatus.pending,
            expiresAt: new Date(now.getTime() + 7 * DAY_MS),
          },
        });
      }

      await this.auditService.record(
        {
          actorUserId: actor.id,
          actorRole: actor.role,
          clinicId: clinic.id,
          actionType: "CLINIC_CREATED",
          targetEntity: "clinics",
          targetId: clinic.id,
          metadata: {
            name: clinic.name,
            slug: clinic.slug,
            planCode: plan.code,
            status: clinic.status,
            adminInviteEmail: dto.adminInviteEmail ?? null,
          },
        },
        tx
      );

      return {
        clinic: serializeClinic(clinic),
        invitation,
      };
    });
  }

  async updateClinicDetails(
    actor: User,
    clinicId: string,
    dto: UpdateClinicDetailsDto
  ) {
    const existing = await this.prisma.clinic.findUnique({ where: { id: clinicId } });
    if (!existing) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Clinic not found.",
        HttpStatus.NOT_FOUND
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.clinic.update({
        where: { id: clinicId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.tagline !== undefined ? { tagline: dto.tagline } : {}),
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
            ? { operatingHours: dto.operatingHours as unknown as Prisma.InputJsonValue }
            : {}),
        },
        include: { plan: true },
      });

      await this.auditService.record(
        {
          actorUserId: actor.id,
          actorRole: actor.role,
          clinicId,
          actionType: "CLINIC_DETAILS_UPDATED",
          targetEntity: "clinics",
          targetId: clinicId,
          metadata: { changedFields: Object.keys(dto) },
        },
        tx
      );

      return serializeClinic(updated);
    });
  }

  async updateClinicStatus(
    actor: User,
    clinicId: string,
    dto: UpdateClinicStatusDto
  ) {
    const existing = await this.prisma.clinic.findUnique({ where: { id: clinicId } });
    if (!existing) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Clinic not found.",
        HttpStatus.NOT_FOUND
      );
    }

    const nowMs = Date.now();
    const gracePeriodEndsAt =
      dto.status === "past_due"
        ? new Date(nowMs + GRACE_PERIOD_MS)
        : dto.status === "active" || dto.status === "trial"
          ? null
          : existing.gracePeriodEndsAt;

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.clinic.update({
        where: { id: clinicId },
        data: {
          status: dto.status,
          gracePeriodEndsAt,
        },
        include: { plan: true },
      });

      const actionType =
        dto.status === "suspended"
          ? "CLINIC_SUSPENDED"
          : dto.status === "archived"
            ? "CLINIC_ARCHIVED"
            : "CLINIC_STATUS_UPDATED";

      await this.auditService.record(
        {
          actorUserId: actor.id,
          actorRole: actor.role,
          clinicId,
          actionType,
          targetEntity: "clinics",
          targetId: clinicId,
          metadata: {
            previousStatus: existing.status,
            nextStatus: dto.status,
            reason: dto.reason ?? null,
          },
        },
        tx
      );

      return serializeClinic(updated);
    });
  }

  async changeClinicPlan(actor: User, clinicId: string, dto: ChangeClinicPlanDto) {
    const [clinic, plan] = await Promise.all([
      this.prisma.clinic.findUnique({ where: { id: clinicId } }),
      this.prisma.subscriptionPlan.findUnique({ where: { id: dto.planId } }),
    ]);
    if (!clinic) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Clinic not found.",
        HttpStatus.NOT_FOUND
      );
    }
    if (!plan) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Subscription plan not found.",
        HttpStatus.NOT_FOUND
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.clinic.update({
        where: { id: clinicId },
        data: {
          planId: plan.id,
          ...(dto.billingCycle ? { billingCycle: dto.billingCycle } : {}),
          ...(dto.syncDefaultFeatures
            ? { featureFlags: plan.defaultFeatures as Prisma.InputJsonValue }
            : {}),
        },
        include: { plan: true },
      });

      await this.auditService.record(
        {
          actorUserId: actor.id,
          actorRole: actor.role,
          clinicId,
          actionType: "CLINIC_PLAN_CHANGED",
          targetEntity: "clinics",
          targetId: clinicId,
          metadata: {
            previousPlanId: clinic.planId,
            nextPlanId: plan.id,
            planCode: plan.code,
            syncDefaultFeatures: dto.syncDefaultFeatures,
          },
        },
        tx
      );

      return serializeClinic(updated);
    });
  }

  async updateClinicFeatures(
    actor: User,
    clinicId: string,
    dto: UpdateClinicFeaturesDto
  ) {
    const clinic = await this.prisma.clinic.findUnique({ where: { id: clinicId } });
    if (!clinic) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Clinic not found.",
        HttpStatus.NOT_FOUND
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.clinic.update({
        where: { id: clinicId },
        data: {
          featureFlags: dto.featureFlags as unknown as Prisma.InputJsonValue,
        },
        include: { plan: true },
      });

      await this.auditService.record(
        {
          actorUserId: actor.id,
          actorRole: actor.role,
          clinicId,
          actionType: "CLINIC_FEATURES_UPDATED",
          targetEntity: "clinics",
          targetId: clinicId,
          metadata: { featureFlags: dto.featureFlags },
        },
        tx
      );

      return serializeClinic(updated);
    });
  }

  async extendClinicSubscription(
    actor: User,
    clinicId: string,
    dto: ExtendClinicSubscriptionDto
  ) {
    const clinic = await this.prisma.clinic.findUnique({ where: { id: clinicId } });
    if (!clinic) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Clinic not found.",
        HttpStatus.NOT_FOUND
      );
    }

    const baseMs = Math.max(Date.now(), clinic.subscriptionEndsAt.getTime());
    const nextEnd = new Date(baseMs + dto.days * DAY_MS);
    const shouldReactivate =
      dto.reactivateIfSuspended &&
      (clinic.status === "past_due" || clinic.status === "suspended");

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.clinic.update({
        where: { id: clinicId },
        data: {
          subscriptionEndsAt: nextEnd,
          ...(clinic.status === "trial" ? { trialEndsAt: nextEnd } : {}),
          ...(shouldReactivate
            ? { status: ClinicStatus.active, gracePeriodEndsAt: null }
            : {}),
        },
        include: { plan: true },
      });

      await this.auditService.record(
        {
          actorUserId: actor.id,
          actorRole: actor.role,
          clinicId,
          actionType: "SUBSCRIPTION_EXTENDED",
          targetEntity: "clinics",
          targetId: clinicId,
          metadata: {
            days: dto.days,
            newSubscriptionEndsAt: nextEnd.toISOString(),
            reason: dto.reason ?? null,
          },
        },
        tx
      );

      return serializeClinic(updated);
    });
  }

  async listAllUsers() {
    const users = await this.prisma.user.findMany({
      include: { clinic: { select: { id: true, name: true, slug: true } } },
      orderBy: { createdAt: "desc" },
      take: 500,
    });
    return users.filter((u) => !u.clerkId.startsWith("pending:"));
  }

  async updateUserRoleOrStatus(
    actor: User,
    targetUserId: string,
    dto: UpdateUserRoleOrStatusDto
  ) {
    const target = await this.prisma.user.findUnique({
      where: { id: targetUserId },
    });
    if (!target) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "User not found.",
        HttpStatus.NOT_FOUND
      );
    }

    const touchesSuperAdmin =
      target.role === "super_admin" || dto.role === "super_admin";
    if (touchesSuperAdmin && !this.isRootOwner(actor)) {
      throw new DomainException(
        API_ERROR_CODES.FORBIDDEN,
        "Only the primary Platform Owner (SUPER_ADMIN_EMAIL) may grant or revoke Super Admin accounts.",
        HttpStatus.FORBIDDEN
      );
    }

    if (target.id === actor.id && dto.isActive === false) {
      throw new DomainException(
        API_ERROR_CODES.INVALID_INPUT,
        "You cannot deactivate your own Super Admin account.",
        HttpStatus.BAD_REQUEST
      );
    }

    const nextRole = dto.role ?? target.role;
    const nextClinicId =
      nextRole === "super_admin" || nextRole === "patient"
        ? null
        : dto.clinicId !== undefined
          ? dto.clinicId
          : target.clinicId;

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.user.update({
        where: { id: targetUserId },
        data: {
          role: nextRole,
          clinicId: nextClinicId,
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });

      await this.auditService.record(
        {
          actorUserId: actor.id,
          actorRole: actor.role,
          clinicId: nextClinicId,
          actionType: "USER_ROLE_OR_STATUS_UPDATED",
          targetEntity: "users",
          targetId: targetUserId,
          metadata: {
            previousRole: target.role,
            nextRole,
            previousActive: target.isActive,
            nextActive: row.isActive,
          },
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

  async listAllInvitations(status?: StaffInvitationStatus) {
    return this.prisma.staffInvitation.findMany({
      where: status ? { status } : undefined,
      include: {
        clinic: { select: { id: true, name: true, slug: true } },
        invitedByUser: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
      },
      orderBy: { createdAt: "desc" },
      take: 200,
    });
  }

  async createRoleInvitation(actor: User, dto: CreateRoleInvitationDto) {
    if (dto.role === "super_admin" && !this.isRootOwner(actor)) {
      throw new DomainException(
        API_ERROR_CODES.FORBIDDEN,
        "Only the primary Platform Owner (SUPER_ADMIN_EMAIL) may invite Super Admin accounts.",
        HttpStatus.FORBIDDEN
      );
    }

    if (dto.role !== "super_admin") {
      if (!dto.clinicId) {
        throw new DomainException(
          API_ERROR_CODES.INVALID_INPUT,
          "clinicId is required for clinic-scoped staff invitations.",
          HttpStatus.BAD_REQUEST
        );
      }
      const clinic = await this.prisma.clinic.findUnique({
        where: { id: dto.clinicId },
      });
      if (!clinic) {
        throw new DomainException(
          API_ERROR_CODES.NOT_FOUND,
          "Target clinic not found.",
          HttpStatus.NOT_FOUND
        );
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const invitation = await tx.staffInvitation.create({
        data: {
          clinicId: dto.role === "super_admin" ? null : dto.clinicId!,
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
          clinicId: invitation.clinicId,
          actionType: "ROLE_INVITATION_CREATED",
          targetEntity: "staff_invitations",
          targetId: invitation.id,
          metadata: { email: invitation.email, role: invitation.role },
        },
        tx
      );

      return invitation;
    });
  }

  async revokeInvitation(actor: User, invitationId: string) {
    const inv = await this.prisma.staffInvitation.findUnique({
      where: { id: invitationId },
    });
    if (!inv) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Invitation not found.",
        HttpStatus.NOT_FOUND
      );
    }
    if (inv.role === "super_admin" && !this.isRootOwner(actor)) {
      throw new DomainException(
        API_ERROR_CODES.FORBIDDEN,
        "Only the primary Platform Owner may revoke Super Admin invitations.",
        HttpStatus.FORBIDDEN
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.staffInvitation.update({
        where: { id: invitationId },
        data: { status: StaffInvitationStatus.revoked, respondedAt: new Date() },
      });

      await this.auditService.record(
        {
          actorUserId: actor.id,
          actorRole: actor.role,
          clinicId: inv.clinicId,
          actionType: "ROLE_INVITATION_REVOKED",
          targetEntity: "staff_invitations",
          targetId: inv.id,
          metadata: { email: inv.email, role: inv.role },
        },
        tx
      );
      return updated;
    });
  }

  async listAnnouncements() {
    return this.prisma.systemAnnouncement.findMany({
      orderBy: { createdAt: "desc" },
      take: 100,
    });
  }

  async createAnnouncement(actor: User, dto: CreateAnnouncementDto) {
    return this.prisma.$transaction(async (tx) => {
      const row = await tx.systemAnnouncement.create({
        data: {
          title: dto.title,
          message: dto.message,
          severity: dto.severity,
          targetAudience: dto.targetAudience,
          expiresAt: dto.expiresAt ?? null,
          createdByUserId: actor.id,
          isActive: true,
        },
      });
      await this.auditService.record(
        {
          actorUserId: actor.id,
          actorRole: actor.role,
          actionType: "ANNOUNCEMENT_CREATED",
          targetEntity: "system_announcements",
          targetId: row.id,
          metadata: { title: row.title, severity: row.severity },
        },
        tx
      );
      return row;
    });
  }

  async updateAnnouncement(
    actor: User,
    id: string,
    dto: UpdateAnnouncementDto
  ) {
    const existing = await this.prisma.systemAnnouncement.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Announcement not found.",
        HttpStatus.NOT_FOUND
      );
    }
    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.systemAnnouncement.update({
        where: { id },
        data: {
          ...(dto.title !== undefined ? { title: dto.title } : {}),
          ...(dto.message !== undefined ? { message: dto.message } : {}),
          ...(dto.severity !== undefined ? { severity: dto.severity } : {}),
          ...(dto.targetAudience !== undefined
            ? { targetAudience: dto.targetAudience }
            : {}),
          ...(dto.expiresAt !== undefined ? { expiresAt: dto.expiresAt } : {}),
          ...(dto.isActive !== undefined ? { isActive: dto.isActive } : {}),
        },
      });
      await this.auditService.record(
        {
          actorUserId: actor.id,
          actorRole: actor.role,
          actionType: "ANNOUNCEMENT_UPDATED",
          targetEntity: "system_announcements",
          targetId: id,
          metadata: { isActive: updated.isActive },
        },
        tx
      );
      return updated;
    });
  }

  async deleteAnnouncement(actor: User, id: string) {
    const existing = await this.prisma.systemAnnouncement.findUnique({
      where: { id },
    });
    if (!existing) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Announcement not found.",
        HttpStatus.NOT_FOUND
      );
    }
    await this.prisma.$transaction(async (tx) => {
      await tx.systemAnnouncement.delete({ where: { id } });
      await this.auditService.record(
        {
          actorUserId: actor.id,
          actorRole: actor.role,
          actionType: "ANNOUNCEMENT_DELETED",
          targetEntity: "system_announcements",
          targetId: id,
          metadata: { title: existing.title },
        },
        tx
      );
    });
    return { deleted: true };
  }

  async listAuditLogs(params: {
    clinicId?: string;
    actorUserId?: string;
    actionType?: string;
    limit?: number;
    offset?: number;
  }) {
    const take = Math.min(Math.max(params.limit ?? 50, 1), 200);
    const skip = Math.max(params.offset ?? 0, 0);
    const where: Prisma.PlatformAuditLogWhereInput = {};
    if (params.clinicId) where.clinicId = params.clinicId;
    if (params.actorUserId) where.actorUserId = params.actorUserId;
    if (params.actionType) where.actionType = params.actionType;

    const [items, total] = await Promise.all([
      this.prisma.platformAuditLog.findMany({
        where,
        include: {
          actorUser: {
            select: { id: true, email: true, firstName: true, lastName: true, role: true },
          },
          clinic: { select: { id: true, name: true, slug: true } },
        },
        orderBy: { createdAt: "desc" },
        take,
        skip,
      }),
      this.prisma.platformAuditLog.count({ where }),
    ]);

    return { items, total, limit: take, offset: skip };
  }

  async listAuditActors() {
    const grouped = await this.prisma.platformAuditLog.groupBy({
      by: ["actorUserId"],
      orderBy: { actorUserId: "asc" },
      take: 100,
    });
    const ids = grouped.map((g) => g.actorUserId);
    if (ids.length === 0) return [];
    return this.prisma.user.findMany({
      where: { id: { in: ids } },
      select: { id: true, email: true, firstName: true, lastName: true, role: true },
    });
  }

  async sendRenewalReminder(actor: User, clinicId: string) {
    const clinic = await this.prisma.clinic.findUnique({ where: { id: clinicId } });
    if (!clinic) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Clinic not found.",
        HttpStatus.NOT_FOUND
      );
    }
    const dispatch = await this.notifications.sendSubscriptionStatusAlert({
      clinicId: clinic.id,
      clinicName: clinic.name,
      clinicEmail: clinic.email,
      newStatus: clinic.status === "suspended" ? "suspended" : "past_due",
      subscriptionEndsAt: clinic.subscriptionEndsAt,
      gracePeriodEndsAt: clinic.gracePeriodEndsAt ?? undefined,
    });
    await this.auditService.record({
      actorUserId: actor.id,
      actorRole: actor.role,
      clinicId: clinic.id,
      actionType: "RENEWAL_REMINDER_SENT",
      targetEntity: "clinics",
      targetId: clinic.id,
      metadata: { sent: dispatch.sent, email: clinic.email },
    });
    return { sent: dispatch.sent, reason: dispatch.reason };
  }

  async resendInvitation(actor: User, invitationId: string) {
    const inv = await this.prisma.staffInvitation.findUnique({
      where: { id: invitationId },
    });
    if (!inv || inv.status !== StaffInvitationStatus.pending) {
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
      clinicId: inv.clinicId,
      actionType: "ROLE_INVITATION_RESENT",
      targetEntity: "staff_invitations",
      targetId: inv.id,
      metadata: { email: inv.email, role: inv.role },
    });
    return updated;
  }

  async ensureDefaultPlans() {
    const MB = BigInt(1024 * 1024);
    const defaults = [
      {
        code: "trial" as const,
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
        code: "starter" as const,
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
        code: "pro" as const,
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
    ];
    let created = 0;
    for (const plan of defaults) {
      const existing = await this.prisma.subscriptionPlan.findUnique({
        where: { code: plan.code },
      });
      if (!existing) {
        await this.prisma.subscriptionPlan.create({ data: plan });
        created++;
      }
    }
    return { plansCreated: created };
  }

  async triggerDailyRollup(dateKey?: string) {
    return this.jobsService.rollupDailyAnalytics(dateKey);
  }
}
