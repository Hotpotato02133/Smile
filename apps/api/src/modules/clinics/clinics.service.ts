import { HttpStatus, Injectable } from "@nestjs/common";
import {
  EmailDeliveryStatus,
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
import { NotificationsService } from "../notifications/notifications.service";
import { StorageService } from "../storage/storage.service";
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
  if (category === "Oral Surgery" || category === "OralSurgery") {
    return ServiceCategory.OralSurgery;
  }
  return category as ServiceCategory;
}

export function serializeServiceCategory(category: ServiceCategory | string): string {
  if (category === ServiceCategory.OralSurgery || category === "OralSurgery") {
    return "Oral Surgery";
  }
  return String(category);
}

function serializeService<T extends { category: ServiceCategory }>(service: T) {
  return {
    ...service,
    category: serializeServiceCategory(service.category),
  };
}

@Injectable()
export class ClinicsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly clerkService: ClerkService,
    private readonly notifications: NotificationsService,
    private readonly storageService: StorageService
  ) {}

  async getWorkspace(tenant: TenantContext, actor: User) {
    const now = new Date();
    const [
      plan,
      announcements,
      activeChairs,
      activeDentists,
      activeServices,
    ] = await Promise.all([
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
      this.prisma.chair.count({
        where: { clinicId: tenant.clinicId, isActive: true },
      }),
      this.prisma.dentist.count({
        where: { clinicId: tenant.clinicId, isActive: true },
      }),
      this.prisma.service.count({
        where: { clinicId: tenant.clinicId, isActive: true },
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

    const logoUrl = tenant.clinic.logoStorageKey
      ? this.storageService.getPublicUrl(tenant.clinic.logoStorageKey)
      : null;

    return {
      clinic: serializeClinic(tenant.clinic),
      plan: plan ? serializePlan(plan) : null,
      logoUrl,
      counts: {
        activeChairs,
        activeDentists,
        activeServices,
      },
      user: {
        id: actor.id,
        email: actor.email,
        firstName: actor.firstName,
        lastName: actor.lastName,
        role: actor.role,
      },
      ...readOnlyState,
      isSuperAdminOverride: tenant.isSuperAdminOverride,
      announcements,
    };
  }

  async getBillingSummary(tenant: TenantContext) {
    const [plan, payments, availablePlans] = await Promise.all([
      this.prisma.subscriptionPlan.findUnique({
        where: { id: tenant.clinic.planId },
      }),
      this.prisma.subscriptionPayment.findMany({
        where: { clinicId: tenant.clinicId },
        include: { plan: { select: { code: true, name: true } } },
        orderBy: { createdAt: "desc" },
        take: 30,
      }),
      this.prisma.subscriptionPlan.findMany({
        where: { isActive: true },
        orderBy: { monthlyPricePhp: "asc" },
      }),
    ]);

    const now = new Date();
    const readOnlyState = evaluateClinicReadOnlyState(
      {
        status: tenant.clinic.status,
        subscriptionEndsAt: tenant.clinic.subscriptionEndsAt.getTime(),
        gracePeriodEndsAt: tenant.clinic.gracePeriodEndsAt?.getTime() ?? null,
      },
      now.getTime(),
      tenant.isSuperAdminOverride
    );

    const serializedPlan = plan ? serializePlan(plan) : null;
    const enrichedPayments = await Promise.all(
      payments.map(async (p) => ({
        ...p,
        clinicName: tenant.clinic.name,
        clinicSlug: tenant.clinic.slug,
        planName: p.plan.name,
        planCode: p.plan.code,
        receiptUrl:
          p.receiptStorageKey && this.storageService.isConfigured
            ? await this.storageService
                .createPresignedGetUrl(p.receiptStorageKey, 300)
                .catch(() => null)
            : null,
      }))
    );

    return {
      clinic: serializeClinic(tenant.clinic),
      plan: serializedPlan,
      currentPlan: serializedPlan,
      ...readOnlyState,
      availablePlans: availablePlans.map(serializePlan),
      payments: enrichedPayments,
    };
  }

  async getDailyMetrics(tenant: TenantContext, days = 30) {
    const clampedDays = Math.min(Math.max(days, 7), 90);
    const startKey = toManilaDateKey(Date.now() - (clampedDays - 1) * DAY_MS);

    const [daily, recentAppts] = await Promise.all([
      this.prisma.clinicMetricDaily.findMany({
        where: {
          clinicId: tenant.clinicId,
          dateKey: { gte: startKey },
        },
        orderBy: { dateKey: "asc" },
        take: clampedDays,
      }),
      this.prisma.appointment.findMany({
        where: {
          clinicId: tenant.clinicId,
          dateKey: { gte: startKey },
        },
        include: {
          service: { select: { id: true, name: true, pricePhp: true } },
          dentist: { select: { id: true, displayName: true, calendarColorHex: true } },
        },
      }),
    ]);

    const totalBooked =
      daily.reduce((s, d) => s + d.totalBooked, 0) || recentAppts.length;
    const totalCompleted =
      daily.reduce((s, d) => s + d.completedCount, 0) ||
      recentAppts.filter((a) => a.status === "completed").length;
    const totalNoShows =
      daily.reduce((s, d) => s + d.noShowCount, 0) ||
      recentAppts.filter((a) => a.status === "no_show").length;
    const totalCancelled =
      daily.reduce((s, d) => s + d.cancelledCount, 0) ||
      recentAppts.filter((a) => a.status === "cancelled").length;
    const totalRevenuePhp =
      daily.reduce((s, d) => s + d.estimatedRevenuePhp, 0) ||
      recentAppts
        .filter((a) => a.status === "completed")
        .reduce((s, a) => s + a.service.pricePhp, 0);
    const totalNewPatients = daily.reduce((s, d) => s + d.newPatientsCount, 0);

    const denom = Math.max(totalBooked, 1);
    const completionRate = Math.round((totalCompleted / denom) * 1000) / 10;
    const noShowRate = Math.round((totalNoShows / denom) * 1000) / 10;
    const cancellationRate = Math.round((totalCancelled / denom) * 1000) / 10;

    const serviceMap = new Map<
      string,
      { serviceId: string; name: string; count: number; revenuePhp: number }
    >();
    const dentistMap = new Map<
      string,
      {
        dentistId: string;
        displayName: string;
        colorHex: string;
        total: number;
        completed: number;
      }
    >();

    for (const appt of recentAppts) {
      const sEntry = serviceMap.get(appt.serviceId) ?? {
        serviceId: appt.serviceId,
        name: appt.service.name,
        count: 0,
        revenuePhp: 0,
      };
      sEntry.count += 1;
      if (appt.status === "completed") {
        sEntry.revenuePhp += appt.service.pricePhp;
      }
      serviceMap.set(appt.serviceId, sEntry);

      const dEntry = dentistMap.get(appt.dentistId) ?? {
        dentistId: appt.dentistId,
        displayName: appt.dentist.displayName,
        colorHex: appt.dentist.calendarColorHex,
        total: 0,
        completed: 0,
      };
      dEntry.total += 1;
      if (appt.status === "completed") {
        dEntry.completed += 1;
      }
      dentistMap.set(appt.dentistId, dEntry);
    }

    const rows = daily;

    return {
      rows,
      daily,
      timeZone: tenant.clinic.timezone || "Asia/Manila",
      totals: {
        totalBooked,
        completedCount: totalCompleted,
        noShowCount: totalNoShows,
        cancelledCount: totalCancelled,
        estimatedRevenuePhp: totalRevenuePhp,
        newPatientsCount: totalNewPatients,
      },
      rates: {
        completionRate,
        noShowRate,
        cancellationRate,
        completionRatePct: completionRate,
        noShowRatePct: noShowRate,
        cancellationRatePct: cancellationRate,
      },
      topServices: Array.from(serviceMap.values())
        .sort((a, b) => b.count - a.count)
        .slice(0, 8),
      dentistUtilization: Array.from(dentistMap.values()).sort(
        (a, b) => b.total - a.total
      ),
      includesLiveToday: true,
    };
  }

  async updateSettings(
    tenant: TenantContext,
    actor: User,
    dto: UpdateClinicSettingsDto
  ) {
    if (dto.slug && dto.slug !== tenant.clinic.slug) {
      const slugConflict = await this.prisma.clinic.findFirst({
        where: { slug: dto.slug, id: { not: tenant.clinicId } },
        select: { id: true },
      });
      if (slugConflict) {
        throw new DomainException(
          API_ERROR_CODES.CONFLICT,
          `Clinic slug "${dto.slug}" is already taken.`,
          HttpStatus.CONFLICT
        );
      }
    }

    if (dto.logoStorageKey) {
      const expectedPrefix = `public/logos/${tenant.clinicId}/`;
      if (!dto.logoStorageKey.startsWith(expectedPrefix)) {
        throw new DomainException(
          API_ERROR_CODES.INVALID_INPUT,
          "Logo storage key does not belong to this clinic.",
          HttpStatus.BAD_REQUEST
        );
      }
      if (this.storageService.isConfigured) {
        const meta = await this.storageService
          .headObject(dto.logoStorageKey, "public")
          .catch(() => null);
        if (!meta || !meta.exists) {
          throw new DomainException(
            API_ERROR_CODES.INVALID_INPUT,
            "Uploaded logo file was not found in storage.",
            HttpStatus.BAD_REQUEST
          );
        }
        if (meta.sizeBytes > 500 * 1024) {
          throw new DomainException(
            API_ERROR_CODES.FILE_TOO_LARGE,
            "Clinic logo exceeds the 500 KB maximum file size.",
            HttpStatus.PAYLOAD_TOO_LARGE
          );
        }
      }
    }

    return this.prisma.$transaction(async (tx) => {
      const updated = await tx.clinic.update({
        where: { id: tenant.clinicId },
        data: {
          ...(dto.name !== undefined ? { name: dto.name } : {}),
          ...(dto.slug !== undefined ? { slug: dto.slug } : {}),
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
    const [dentistsRaw, chairs, clinicUsers] = await Promise.all([
      this.prisma.dentist.findMany({
        where: { clinicId: tenant.clinicId },
        include: {
          user: {
            select: {
              id: true,
              clerkId: true,
              email: true,
              firstName: true,
              lastName: true,
              isActive: true,
            },
          },
          defaultChair: { select: { id: true, name: true, roomCode: true } },
          timeOffs: {
            where: { endTimeUtc: { gte: new Date() } },
            orderBy: { startTimeUtc: "asc" },
            take: 20,
          },
        },
        orderBy: { displayName: "asc" },
      }),
      this.prisma.chair.findMany({
        where: { clinicId: tenant.clinicId },
        orderBy: { name: "asc" },
      }),
      this.prisma.user.findMany({
        where: {
          clinicId: tenant.clinicId,
          role: { in: ["dentist", "clinic_admin"] },
          isActive: true,
        },
        select: {
          id: true,
          clerkId: true,
          email: true,
          firstName: true,
          lastName: true,
          role: true,
          isActive: true,
        },
        orderBy: { firstName: "asc" },
      }),
    ]);

    const linkedUserIds = new Set(dentistsRaw.map((d) => d.userId));
    const availableUsers = clinicUsers
      .filter((u) => !u.clerkId.startsWith("pending:") && !linkedUserIds.has(u.id))
      .map((u) => ({
        ...u,
        name: `${u.firstName} ${u.lastName}`.trim() || u.email,
      }));

    return {
      dentists: dentistsRaw.map((d) => ({
        ...d,
        email: d.user?.email,
        userEmail: d.user?.email ?? null,
        defaultChairName: d.defaultChair?.name ?? null,
        isPendingAccount: Boolean(d.user?.clerkId?.startsWith("pending:")),
        timeOff: d.timeOffs,
        upcomingTimeOff: d.timeOffs,
      })),
      chairs,
      availableUsers,
    };
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

    const result = await this.prisma.$transaction(async (tx) => {
      let targetUserId = dto.userId;
      let createdInvitation: {
        id: string;
        email: string;
        token: string | null;
        expiresAt: Date;
      } | null = null;

      if (targetUserId) {
        const linkedUser = await tx.user.findFirst({
          where: { id: targetUserId, clinicId: tenant.clinicId },
        });
        if (!linkedUser) {
          throw new DomainException(
            API_ERROR_CODES.FORBIDDEN,
            "Selected user does not belong to this clinic.",
            HttpStatus.FORBIDDEN
          );
        }
      } else {
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
          if (
            existingUser.role === "super_admin" ||
            (existingUser.clinicId && existingUser.clinicId !== tenant.clinicId)
          ) {
            throw new DomainException(
              API_ERROR_CODES.FORBIDDEN,
              "This email is already assigned to another workspace or platform role.",
              HttpStatus.FORBIDDEN
            );
          }
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

          createdInvitation = await tx.staffInvitation.create({
            data: {
              clinicId: tenant.clinicId,
              email: dto.email,
              role: "dentist",
              token: generateInviteToken(),
              invitedByUserId: actor.id,
              status: StaffInvitationStatus.pending,
              emailStatus: EmailDeliveryStatus.queued,
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

      return { dentist, createdInvitation };
    });

    if (result.createdInvitation?.token) {
      const inviterName =
        `${actor.firstName} ${actor.lastName}`.trim() || actor.email;
      await this.notifications
        .sendRoleInvitationEmail({
          invitationId: result.createdInvitation.id,
          clinicId: tenant.clinicId,
          recipientEmail: result.createdInvitation.email,
          role: "dentist",
          scopeName: tenant.clinic.name,
          accentHex: tenant.clinic.primaryColorHex,
          inviterName,
          token: result.createdInvitation.token,
          expiresAt: result.createdInvitation.expiresAt,
        })
        .catch(() => undefined);
    }

    return result.dentist;
  }

  async updateDentist(
    tenant: TenantContext,
    actor: User,
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
    if (actor.role === "dentist" && existing.userId !== actor.id) {
      throw new DomainException(
        API_ERROR_CODES.FORBIDDEN,
        "Dentists can only modify their own schedule profile.",
        HttpStatus.FORBIDDEN
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

    if (actor.role === "dentist" && dentist.userId !== actor.id) {
      throw new DomainException(
        API_ERROR_CODES.FORBIDDEN,
        "Dentists can only create time-off blocks for their own schedule.",
        HttpStatus.FORBIDDEN
      );
    }

    const [created, overlappingCount] = await Promise.all([
      this.prisma.dentistTimeOff.create({
        data: {
          clinicId: tenant.clinicId,
          dentistId: dentist.id,
          startTimeUtc: dto.startTimeUtc,
          endTimeUtc: dto.endTimeUtc,
          reason: dto.reason,
          createdByUserId: actor.id,
        },
      }),
      this.prisma.appointment.count({
        where: {
          clinicId: tenant.clinicId,
          dentistId: dentist.id,
          status: { notIn: ["cancelled", "no_show", "completed"] },
          startTimeUtc: { lt: dto.endTimeUtc },
          endTimeUtc: { gt: dto.startTimeUtc },
        },
      }),
    ]);

    return {
      ...created,
      overlappingCount,
    };
  }

  async deleteDentistTimeOff(
    tenant: TenantContext,
    actor: User,
    timeOffId: string
  ) {
    const existing = await this.prisma.dentistTimeOff.findFirst({
      where: { id: timeOffId, clinicId: tenant.clinicId },
      include: { dentist: { select: { userId: true } } },
    });
    if (!existing) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Time-off block not found.",
        HttpStatus.NOT_FOUND
      );
    }
    if (actor.role === "dentist" && existing.dentist.userId !== actor.id) {
      throw new DomainException(
        API_ERROR_CODES.FORBIDDEN,
        "Dentists can only remove their own time-off blocks.",
        HttpStatus.FORBIDDEN
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

      const upcomingAppointmentsCount = !nextActive
        ? await tx.appointment.count({
            where: {
              clinicId: tenant.clinicId,
              chairId,
              status: { in: ["pending_approval", "confirmed", "checked_in", "in_chair"] },
              startTimeUtc: { gte: new Date() },
            },
          })
        : 0;

      return {
        ...updated,
        upcomingAppointmentsCount,
      };
    });
  }

  // ============================================================================
  // SERVICES
  // ============================================================================

  async listServices(tenant: TenantContext) {
    const rows = await this.prisma.service.findMany({
      where: { clinicId: tenant.clinicId },
      orderBy: [{ category: "asc" }, { name: "asc" }],
    });
    return rows.map(serializeService);
  }

  async createService(tenant: TenantContext, dto: CreateServiceDto) {
    const created = await this.prisma.service.create({
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
    return serializeService(created);
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

    const updated = await this.prisma.service.update({
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
    return serializeService(updated);
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
    const updated = await this.prisma.service.update({
      where: { id: serviceId },
      data: { isActive: !existing.isActive },
    });
    return serializeService(updated);
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

  async listStaff(tenant: TenantContext, actor: User) {
    const [membersRaw, invitations] = await Promise.all([
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
        where: { clinicId: tenant.clinicId },
        include: {
          invitedByUser: {
            select: { email: true, firstName: true, lastName: true },
          },
        },
        orderBy: { createdAt: "desc" },
        take: 100,
      }),
    ]);

    const members = membersRaw
      .filter((m) => !m.clerkId.startsWith("pending:"))
      .map((m) => ({
        ...m,
        name: `${m.firstName} ${m.lastName}`.trim() || m.email,
      }));

    const enrichedInvitations = invitations.map((i) => ({
      ...i,
      clinicName: tenant.clinic.name,
      inviterName: i.invitedByUser
        ? `${i.invitedByUser.firstName} ${i.invitedByUser.lastName}`.trim() ||
          i.invitedByUser.email
        : "",
    }));

    const pendingInvitations = enrichedInvitations.filter(
      (i) => i.status === StaffInvitationStatus.pending
    );
    const declinedInvitations = enrichedInvitations.filter(
      (i) => i.status === StaffInvitationStatus.declined
    );
    const historicalInvitations = enrichedInvitations.filter(
      (i) => i.status !== StaffInvitationStatus.pending
    );

    return {
      currentUserId: actor.id,
      members,
      staff: members,
      invitations: enrichedInvitations,
      pendingInvitations,
      declinedInvitations,
      historicalInvitations,
    };
  }

  async inviteStaff(
    tenant: TenantContext,
    actor: User,
    dto: InviteClinicStaffDto
  ) {
    const invitation = await this.prisma.$transaction(async (tx) => {
      const row = await tx.staffInvitation.create({
        data: {
          clinicId: tenant.clinicId,
          email: dto.email,
          role: dto.role,
          token: generateInviteToken(),
          inviterNote: dto.inviterNote ?? null,
          invitedByUserId: actor.id,
          status: StaffInvitationStatus.pending,
          emailStatus: EmailDeliveryStatus.queued,
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
          targetId: row.id,
          metadata: { email: row.email, role: row.role },
        },
        tx
      );

      return row;
    });

    const inviterName =
      `${actor.firstName} ${actor.lastName}`.trim() || actor.email;
    const delivery = await this.notifications.sendRoleInvitationEmail({
      invitationId: invitation.id,
      clinicId: tenant.clinicId,
      recipientEmail: invitation.email,
      role: invitation.role,
      scopeName: tenant.clinic.name,
      accentHex: tenant.clinic.primaryColorHex,
      inviterName,
      inviterNote: invitation.inviterNote,
      token: invitation.token!,
      expiresAt: invitation.expiresAt,
    });

    return {
      ...invitation,
      clinicName: tenant.clinic.name,
      inviterName,
      emailStatus: delivery.emailStatus,
      emailError: delivery.emailError,
    };
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
      },
    });
    if (!inv || inv.status === StaffInvitationStatus.accepted) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Resendable invitation not found.",
        HttpStatus.NOT_FOUND
      );
    }
    const token = inv.token ?? generateInviteToken();
    const expiresAt = new Date(Date.now() + 7 * DAY_MS);
    const updated = await this.prisma.staffInvitation.update({
      where: { id: inv.id },
      data: {
        token,
        status: StaffInvitationStatus.pending,
        declineReason: null,
        respondedAt: null,
        emailStatus: EmailDeliveryStatus.queued,
        emailError: null,
        expiresAt,
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

    const inviterName =
      `${actor.firstName} ${actor.lastName}`.trim() || actor.email;
    const delivery = await this.notifications.sendRoleInvitationEmail({
      invitationId: updated.id,
      clinicId: tenant.clinicId,
      recipientEmail: updated.email,
      role: updated.role,
      scopeName: tenant.clinic.name,
      accentHex: tenant.clinic.primaryColorHex,
      inviterName,
      inviterNote: updated.inviterNote,
      token,
      expiresAt,
    });

    return {
      ...updated,
      clinicName: tenant.clinic.name,
      inviterName,
      emailStatus: delivery.emailStatus,
      emailError: delivery.emailError,
    };
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

    const result = await this.prisma.$transaction(async (tx) => {
      const row = await tx.user.update({
        where: { id: target.id },
        data: { isActive: !target.isActive },
      });

      let deactivatedDentistProfile = false;
      if (!row.isActive) {
        const linkedDentist = await tx.dentist.findFirst({
          where: { clinicId: tenant.clinicId, userId: target.id, isActive: true },
        });
        if (linkedDentist) {
          await tx.dentist.update({
            where: { id: linkedDentist.id },
            data: { isActive: false },
          });
          await tx.clinic.update({
            where: { id: tenant.clinicId },
            data: {
              activeDentistCount: Math.max(0, tenant.clinic.activeDentistCount - 1),
            },
          });
          deactivatedDentistProfile = true;
        }
      }

      await this.auditService.record(
        {
          actorUserId: actor.id,
          actorRole: actor.role,
          clinicId: tenant.clinicId,
          actionType: row.isActive ? "STAFF_REACTIVATED" : "STAFF_DEACTIVATED",
          targetEntity: "users",
          targetId: target.id,
          metadata: {
            email: target.email,
            role: target.role,
            deactivatedDentistProfile,
          },
        },
        tx
      );
      return { row, deactivatedDentistProfile };
    });

    await this.clerkService.syncPublicMetadata(
      result.row.clerkId,
      result.row.role,
      result.row.clinicId
    );
    return {
      ...result.row,
      deactivatedDentistProfile: result.deactivatedDentistProfile,
    };
  }
}
