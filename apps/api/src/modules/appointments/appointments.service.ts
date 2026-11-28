import { HttpStatus, Injectable } from "@nestjs/common";
import {
  type Appointment,
  AppointmentStatus,
  BookingSource,
  type Clinic,
  type Prisma,
  ServiceCategory,
  type User,
} from "@prisma/client";
import {
  API_ERROR_CODES,
  evaluateClinicBookingEligibility,
  evaluateClinicReadOnlyState,
  getLocalDateKeyAndMinute,
} from "@smile/shared";
import { DomainException } from "../../common/exceptions/domain.exception";
import type { TenantContext } from "../../common/types/request-context";
import { toManilaDateKey, toManilaMonthKey } from "../../common/utils/manila-time";
import { PrismaService } from "../../infra/prisma.service";
import { AuditService } from "../audit/audit.service";
import { assertClinicCanWriteResource } from "../auth/guards/clinic-quota.guard";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { SchedulingService } from "../scheduling/scheduling.service";
import { SlotLockService } from "../scheduling/slot-lock.service";
import {
  serializeClinic,
  serializePlan,
} from "../super-admin/super-admin.service";
import type {
  CreateWalkInBookingDto,
  RescheduleAppointmentDto,
  StaffAddWaitlistDto,
  TransitionAppointmentStatusDto,
  UpdateClinicalNotesDto,
  UpdateWaitlistStatusDto,
} from "./appointments.schemas";

const ALLOWED_TRANSITIONS: Record<AppointmentStatus, AppointmentStatus[]> = {
  pending_approval: ["confirmed", "cancelled"],
  confirmed: ["checked_in", "cancelled", "no_show"],
  checked_in: ["in_chair", "confirmed", "cancelled", "no_show"],
  in_chair: ["completed", "cancelled"],
  completed: [],
  cancelled: [],
  no_show: [],
};

function isPostgresExclusionError(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  const err = error as {
    code?: string;
    meta?: { code?: string };
    message?: string;
  };
  if (err.code === "23P01" || err.meta?.code === "23P01") return true;
  if (
    typeof err.message === "string" &&
    (err.message.includes("23P01") ||
      err.message.includes("appointments_no_dentist_overlap_excl") ||
      err.message.includes("appointments_no_chair_overlap_excl"))
  ) {
    return true;
  }
  return false;
}

function addSixMonthsDateKey(dateKey: string): string {
  const [y, m, d] = dateKey.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1 + 6, d));
  const yy = dt.getUTCFullYear();
  const mm = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(dt.getUTCDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

export interface BookSlotAtomicParams {
  clinic: Clinic;
  patientId: string;
  serviceId: string;
  dentistId: string;
  chairId: string;
  dateKey: string;
  startTimeUtc: number;
  status: AppointmentStatus;
  bookingSource: BookingSource;
  chiefComplaint?: string;
  createdByUserId?: string;
  sessionId?: string;
  enforceScheduleRules: boolean;
  allowEmergencyBuffer: boolean;
  minLeadMinutes: number;
}

@Injectable()
export class AppointmentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly schedulingService: SchedulingService,
    private readonly slotLockService: SlotLockService,
    private readonly auditService: AuditService,
    private readonly realtime: RealtimeGateway
  ) {}

  /**
   * Core Law #5 concurrency-safe booking transaction:
   *  1. Acquires deterministic PostgreSQL row locks (`FOR UPDATE`) in canonical order
   *     (`dentists` THEN `chairs`) to eliminate deadlocks.
   *  2. Enforces Law #4 subscription status & monthly appointment quota.
   *  3. Verifies dual-resource availability (appointments, time-off, foreign Redis locks).
   *  4. Inserts appointment — protected additionally by Postgres `EXCLUDE USING GIST`
   *     (`23P01` -> HTTP `409 Conflict`).
   *  5. Releases caller's Redis slot lock and emits real-time Socket.IO event.
   */
  async bookSlotAtomically(params: BookSlotAtomicParams): Promise<Appointment> {
    const now = new Date();
    const nowMs = now.getTime();
    const currentMonthKey = toManilaMonthKey(now);

    try {
      const appointment = await this.prisma.$transaction(async (tx) => {
        // Canonical lock ordering: ALWAYS lock dentist row first, then chair row
        await tx.$queryRaw`SELECT id FROM "dentists" WHERE id = ${params.dentistId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "chairs" WHERE id = ${params.chairId}::uuid FOR UPDATE`;

        const [freshClinic, plan, service, patient] = await Promise.all([
          tx.clinic.findUnique({ where: { id: params.clinic.id } }),
          tx.subscriptionPlan.findUnique({ where: { id: params.clinic.planId } }),
          tx.service.findFirst({
            where: {
              id: params.serviceId,
              clinicId: params.clinic.id,
              isActive: true,
            },
          }),
          tx.patient.findFirst({
            where: { id: params.patientId, clinicId: params.clinic.id },
          }),
        ]);

        if (!freshClinic || !plan) {
          throw new DomainException(
            API_ERROR_CODES.NOT_FOUND,
            "Clinic or subscription plan not found.",
            HttpStatus.NOT_FOUND
          );
        }
        if (!service) {
          throw new DomainException(
            API_ERROR_CODES.NOT_FOUND,
            "Dental service not found.",
            HttpStatus.NOT_FOUND
          );
        }
        if (!patient) {
          throw new DomainException(
            API_ERROR_CODES.NOT_FOUND,
            "Patient profile not found in this clinic.",
            HttpStatus.NOT_FOUND
          );
        }

        const effectiveMonthlyCount =
          freshClinic.currentMonthKey === currentMonthKey
            ? freshClinic.currentMonthAppointmentCount
            : 0;

        assertClinicCanWriteResource(
          {
            ...freshClinic,
            currentMonthAppointmentCount: effectiveMonthlyCount,
          },
          plan,
          "appointment",
          nowMs
        );

        const check = await this.schedulingService.verifySpecificPairAvailable({
          clinic: freshClinic,
          service,
          dateKey: params.dateKey,
          dentistId: params.dentistId,
          chairId: params.chairId,
          startTimeUtc: params.startTimeUtc,
          ignoreSessionId: params.sessionId,
          enforceScheduleRules: params.enforceScheduleRules,
          allowEmergencyBuffer: params.allowEmergencyBuffer,
          minLeadMinutes: params.minLeadMinutes,
          tx,
        });

        if (!check.ok) {
          throw new DomainException(
            API_ERROR_CODES.SLOT_UNAVAILABLE,
            check.reason ??
              "This time slot is no longer available. Please select another slot.",
            HttpStatus.CONFLICT
          );
        }

        const created = await tx.appointment.create({
          data: {
            clinicId: freshClinic.id,
            patientId: patient.id,
            dentistId: params.dentistId,
            chairId: params.chairId,
            serviceId: service.id,
            dateKey: params.dateKey,
            startTimeUtc: new Date(params.startTimeUtc),
            endTimeUtc: new Date(check.endTimeUtc),
            bufferEndTimeUtc: new Date(check.bufferEndTimeUtc),
            status: params.status,
            bookingSource: params.bookingSource,
            chiefComplaint: params.chiefComplaint ?? null,
            createdByUserId: params.createdByUserId ?? null,
          },
        });

        await tx.clinic.update({
          where: { id: freshClinic.id },
          data: {
            currentMonthKey,
            currentMonthAppointmentCount: effectiveMonthlyCount + 1,
            lifetimeAppointmentCount: { increment: 1 },
          },
        });

        return created;
      });

      if (params.sessionId) {
        await this.slotLockService.releaseSessionLocks(
          params.clinic.id,
          params.dateKey,
          params.sessionId
        );
      }

      this.realtime.emitAppointmentChanged({
        clinicId: params.clinic.id,
        clinicSlug: params.clinic.slug,
        appointmentId: appointment.id,
        dateKey: appointment.dateKey,
        status: appointment.status,
        action: "created",
      });

      return appointment;
    } catch (error) {
      if (isPostgresExclusionError(error)) {
        throw new DomainException(
          API_ERROR_CODES.SLOT_UNAVAILABLE,
          "This time slot was just booked concurrently. Please select another slot.",
          HttpStatus.CONFLICT
        );
      }
      throw error;
    }
  }

  private enrichAppointmentItem<
    T extends {
      id: string;
      patient: {
        firstName: string;
        lastName: string;
        phone: string;
        email?: string | null;
        noShowCount?: number;
        medicalHistory?: unknown;
      };
      dentist?: {
        displayName: string;
        calendarColorHex: string;
      };
      chair: {
        name: string;
        roomCode: string;
      };
      service: {
        name: string;
        category: ServiceCategory;
        durationMinutes: number;
        bufferMinutes: number;
        pricePhp: number;
      };
    },
  >(a: T) {
    const mh = a.patient.medicalHistory as
      | {
          allergies?: string[];
          isTakingBloodThinners?: boolean;
          isPregnant?: boolean;
          dentalAnxietyLevel?: string;
        }
      | null
      | undefined;
    const hasMedicalAlert = Boolean(
      mh &&
        ((mh.allergies?.length ?? 0) > 0 ||
          mh.isTakingBloodThinners ||
          mh.isPregnant ||
          mh.dentalAnxietyLevel === "severe")
    );
    return {
      ...a,
      referenceCode: `SM-${a.id.slice(0, 8).toUpperCase()}`,
      patientName: `${a.patient.firstName} ${a.patient.lastName}`.trim(),
      patientPhone: a.patient.phone,
      patientEmail: a.patient.email ?? null,
      noShowCount: a.patient.noShowCount ?? 0,
      ...(a.dentist
        ? {
            dentistName: a.dentist.displayName,
            dentistColorHex: a.dentist.calendarColorHex,
          }
        : {}),
      chairName: a.chair.name,
      chairRoomCode: a.chair.roomCode,
      serviceName: a.service.name,
      serviceCategory: a.service.category,
      durationMinutes: a.service.durationMinutes,
      bufferMinutes: a.service.bufferMinutes,
      pricePhp: a.service.pricePhp,
      hasMedicalAlert,
      medicalSummary: mh
        ? {
            allergies: mh.allergies ?? [],
            isTakingBloodThinners: Boolean(mh.isTakingBloodThinners),
            isPregnant: Boolean(mh.isPregnant),
            dentalAnxietyLevel: mh.dentalAnxietyLevel ?? "none",
          }
        : null,
    };
  }

  async getFrontDeskWorkspace(
    tenant: TenantContext,
    actor: User,
    dateKey?: string
  ) {
    const targetDate = dateKey?.trim() || toManilaDateKey();
    const now = new Date();
    const [plan, appointmentsRaw, dentists, chairs, services, waitlist, announcements] =
      await Promise.all([
        this.prisma.subscriptionPlan.findUnique({
          where: { id: tenant.clinic.planId },
        }),
        this.prisma.appointment.findMany({
          where: { clinicId: tenant.clinicId, dateKey: targetDate },
          include: {
            patient: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                phone: true,
                email: true,
                noShowCount: true,
                medicalHistory: true,
              },
            },
            dentist: {
              select: { id: true, displayName: true, calendarColorHex: true },
            },
            chair: { select: { id: true, name: true, roomCode: true } },
            service: {
              select: {
                id: true,
                name: true,
                category: true,
                durationMinutes: true,
                bufferMinutes: true,
                pricePhp: true,
              },
            },
          },
          orderBy: { startTimeUtc: "asc" },
        }),
        this.prisma.dentist.findMany({
          where: { clinicId: tenant.clinicId, isActive: true },
          orderBy: { displayName: "asc" },
        }),
        this.prisma.chair.findMany({
          where: { clinicId: tenant.clinicId, isActive: true },
          orderBy: { name: "asc" },
        }),
        this.prisma.service.findMany({
          where: { clinicId: tenant.clinicId, isActive: true },
          orderBy: { name: "asc" },
        }),
        this.prisma.waitlistEntry.findMany({
          where: {
            clinicId: tenant.clinicId,
            preferredDateKey: targetDate,
            status: { in: ["waiting", "notified"] },
          },
          include: {
            patient: {
              select: { id: true, firstName: true, lastName: true, phone: true },
            },
            service: { select: { id: true, name: true, durationMinutes: true } },
            preferredDentist: { select: { id: true, displayName: true } },
          },
          orderBy: { createdAt: "asc" },
        }),
        this.prisma.systemAnnouncement.findMany({
          where: {
            isActive: true,
            targetAudience: { in: ["all_users", "all_clinic_staff"] },
            OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
          },
          orderBy: { createdAt: "desc" },
          take: 5,
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

    const appointments = appointmentsRaw.map((a) => this.enrichAppointmentItem(a));

    return {
      dateKey: targetDate,
      clinic: serializeClinic(tenant.clinic),
      plan: plan ? serializePlan(plan) : null,
      ...readOnlyState,
      isSuperAdminOverride: tenant.isSuperAdminOverride,
      user: {
        id: actor.id,
        role: actor.role,
        firstName: actor.firstName,
        lastName: actor.lastName,
        email: actor.email,
      },
      appointments,
      pendingRequests: appointments.filter((a) => a.status === "pending_approval"),
      dentists,
      chairs,
      services,
      waitlist,
      announcements,
    };
  }

  async getDentistQueue(
    tenant: TenantContext,
    actor: User,
    params: {
      dateKey?: string;
      rangeStartKey?: string;
      rangeEndKey?: string;
      dentistId?: string;
    }
  ) {
    const targetDate = params.dateKey?.trim() || toManilaDateKey();
    const rangeStart = params.rangeStartKey?.trim();
    const rangeEnd = params.rangeEndKey?.trim();
    const now = new Date();

    const [plan, dentists, announcements] = await Promise.all([
      this.prisma.subscriptionPlan.findUnique({
        where: { id: tenant.clinic.planId },
      }),
      this.prisma.dentist.findMany({
        where: { clinicId: tenant.clinicId, isActive: true },
        orderBy: { displayName: "asc" },
      }),
      this.prisma.systemAnnouncement.findMany({
        where: {
          isActive: true,
          targetAudience: { in: ["all_users", "all_clinic_staff"] },
          OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
    ]);

    const ownDentist = dentists.find((d) => d.userId === actor.id);
    const hasLinkedDentistProfile = Boolean(ownDentist);
    const canSwitchDentist =
      actor.role === "clinic_admin" || tenant.isSuperAdminOverride;
    const selectedDentistId = canSwitchDentist
      ? (params.dentistId ?? ownDentist?.id ?? dentists[0]?.id ?? null)
      : (ownDentist?.id ?? null);

    const appointmentsRaw = selectedDentistId
      ? await this.prisma.appointment.findMany({
          where: {
            clinicId: tenant.clinicId,
            dentistId: selectedDentistId,
            dateKey:
              rangeStart && rangeEnd
                ? { gte: rangeStart, lte: rangeEnd }
                : targetDate,
          },
          include: {
            patient: true,
            dentist: {
              select: { id: true, displayName: true, calendarColorHex: true },
            },
            chair: { select: { id: true, name: true, roomCode: true } },
            service: true,
          },
          orderBy: { startTimeUtc: "asc" },
        })
      : [];

    const readOnlyState = evaluateClinicReadOnlyState(
      {
        status: tenant.clinic.status,
        subscriptionEndsAt: tenant.clinic.subscriptionEndsAt.getTime(),
        gracePeriodEndsAt: tenant.clinic.gracePeriodEndsAt?.getTime() ?? null,
      },
      now.getTime(),
      tenant.isSuperAdminOverride
    );

    const appointments = appointmentsRaw.map((a) => this.enrichAppointmentItem(a));

    return {
      dateKey: targetDate,
      clinic: serializeClinic(tenant.clinic),
      plan: plan ? serializePlan(plan) : null,
      ...readOnlyState,
      isSuperAdminOverride: tenant.isSuperAdminOverride,
      user: {
        id: actor.id,
        role: actor.role,
        firstName: actor.firstName,
        lastName: actor.lastName,
        email: actor.email,
      },
      selectedDentistId,
      hasLinkedDentistProfile,
      canSwitchDentist,
      dentists,
      appointments,
      queue: appointments,
      announcements,
    };
  }

  async searchPatients(tenant: TenantContext, query?: string) {
    const q = query?.trim();
    return this.prisma.patient.findMany({
      where: {
        clinicId: tenant.clinicId,
        ...(q
          ? {
              OR: [
                { firstName: { contains: q, mode: "insensitive" } },
                { lastName: { contains: q, mode: "insensitive" } },
                { phone: { contains: q, mode: "insensitive" } },
                { email: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 30,
    });
  }

  async createWalkInBooking(
    tenant: TenantContext,
    actor: User,
    dto: CreateWalkInBookingDto
  ) {
    let patientId = dto.patientId;
    if (!patientId && dto.newPatient) {
      const created = await this.prisma.patient.create({
        data: {
          clinicId: tenant.clinicId,
          firstName: dto.newPatient.firstName,
          lastName: dto.newPatient.lastName,
          dateOfBirth: dto.newPatient.dateOfBirth,
          sex: dto.newPatient.sex,
          phone: dto.newPatient.phone,
          email: dto.newPatient.email ?? null,
          medicalHistory: (dto.newPatient.medicalHistory ?? {
            allergies: [],
            conditions: [],
            isTakingBloodThinners: false,
            isPregnant: false,
            dentalAnxietyLevel: "none",
          }) as unknown as Prisma.InputJsonValue,
        },
      });
      patientId = created.id;
    }

    return this.bookSlotAtomically({
      clinic: tenant.clinic,
      patientId: patientId!,
      serviceId: dto.serviceId,
      dentistId: dto.dentistId,
      chairId: dto.chairId,
      dateKey: dto.dateKey,
      startTimeUtc: dto.startTimeUtc,
      status: dto.initialStatus,
      bookingSource: dto.bookingSource,
      chiefComplaint: dto.chiefComplaint,
      createdByUserId: actor.id,
      enforceScheduleRules: false,
      allowEmergencyBuffer: true,
      minLeadMinutes: -5,
    });
  }

  async transitionStatus(
    tenant: TenantContext,
    actor: User,
    appointmentId: string,
    dto: TransitionAppointmentStatusDto
  ) {
    const existing = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, clinicId: tenant.clinicId },
      include: { service: true },
    });
    if (!existing) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Appointment not found.",
        HttpStatus.NOT_FOUND
      );
    }

    if (
      existing.status !== dto.status &&
      !ALLOWED_TRANSITIONS[existing.status].includes(dto.status)
    ) {
      throw new DomainException(
        API_ERROR_CODES.INVALID_INPUT,
        `Cannot transition appointment from "${existing.status}" to "${dto.status}".`,
        HttpStatus.BAD_REQUEST
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const row = await tx.appointment.update({
        where: { id: existing.id },
        data: {
          status: dto.status,
          ...(dto.cancellationReason !== undefined
            ? { cancellationReason: dto.cancellationReason }
            : {}),
          ...(dto.clinicalNotes !== undefined
            ? { clinicalNotes: dto.clinicalNotes }
            : {}),
          ...(dto.postVisitInstructions !== undefined
            ? { postVisitInstructions: dto.postVisitInstructions }
            : {}),
        },
      });

      if (dto.status === AppointmentStatus.no_show) {
        await tx.patient.update({
          where: { id: existing.patientId },
          data: { noShowCount: { increment: 1 } },
        });
      }

      if (
        dto.status === AppointmentStatus.completed &&
        existing.service.category === ServiceCategory.Preventive
      ) {
        await tx.patient.update({
          where: { id: existing.patientId },
          data: {
            lastCleaningDate: existing.dateKey,
            nextRecallDate: addSixMonthsDateKey(existing.dateKey),
          },
        });
      }

      await this.auditService.record(
        {
          actorUserId: actor.id,
          actorRole: actor.role,
          clinicId: tenant.clinicId,
          actionType: "APPOINTMENT_STATUS_TRANSITIONED",
          targetEntity: "appointments",
          targetId: existing.id,
          metadata: {
            previousStatus: existing.status,
            nextStatus: dto.status,
            cancellationReason: dto.cancellationReason ?? null,
          },
        },
        tx
      );

      return row;
    });

    this.realtime.emitAppointmentChanged({
      clinicId: tenant.clinicId,
      clinicSlug: tenant.clinic.slug,
      appointmentId: updated.id,
      dateKey: updated.dateKey,
      status: updated.status,
      action:
        dto.status === AppointmentStatus.cancelled
          ? "cancelled"
          : "status_changed",
    });

    return updated;
  }

  async rescheduleAppointment(
    tenant: TenantContext,
    actor: User,
    appointmentId: string,
    dto: RescheduleAppointmentDto
  ) {
    const existing = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, clinicId: tenant.clinicId },
      include: { service: true },
    });
    if (!existing) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Appointment not found.",
        HttpStatus.NOT_FOUND
      );
    }

    if (
      existing.status === "completed" ||
      existing.status === "cancelled" ||
      existing.status === "no_show"
    ) {
      throw new DomainException(
        API_ERROR_CODES.INVALID_INPUT,
        `Cannot reschedule an appointment with status "${existing.status}".`,
        HttpStatus.BAD_REQUEST
      );
    }

    const nextDentistId = dto.dentistId ?? existing.dentistId;
    const nextChairId = dto.chairId ?? existing.chairId;

    try {
      const updated = await this.prisma.$transaction(async (tx) => {
        await tx.$queryRaw`SELECT id FROM "dentists" WHERE id = ${nextDentistId}::uuid FOR UPDATE`;
        await tx.$queryRaw`SELECT id FROM "chairs" WHERE id = ${nextChairId}::uuid FOR UPDATE`;

        const check = await this.schedulingService.verifySpecificPairAvailable({
          clinic: tenant.clinic,
          service: existing.service,
          dateKey: dto.dateKey,
          dentistId: nextDentistId,
          chairId: nextChairId,
          startTimeUtc: dto.startTimeUtc,
          ignoreAppointmentId: existing.id,
          enforceScheduleRules: false,
          allowEmergencyBuffer: true,
          tx,
        });

        if (!check.ok) {
          throw new DomainException(
            API_ERROR_CODES.SLOT_UNAVAILABLE,
            check.reason ?? "Target reschedule slot is unavailable.",
            HttpStatus.CONFLICT
          );
        }

        const row = await tx.appointment.update({
          where: { id: existing.id },
          data: {
            dentistId: nextDentistId,
            chairId: nextChairId,
            dateKey: dto.dateKey,
            startTimeUtc: new Date(dto.startTimeUtc),
            endTimeUtc: new Date(check.endTimeUtc),
            bufferEndTimeUtc: new Date(check.bufferEndTimeUtc),
          },
        });

        await this.auditService.record(
          {
            actorUserId: actor.id,
            actorRole: actor.role,
            clinicId: tenant.clinicId,
            actionType: "APPOINTMENT_RESCHEDULED",
            targetEntity: "appointments",
            targetId: existing.id,
            metadata: {
              previousDateKey: existing.dateKey,
              nextDateKey: dto.dateKey,
              nextStartTimeUtc: dto.startTimeUtc,
            },
          },
          tx
        );

        return row;
      });

      this.realtime.emitAppointmentChanged({
        clinicId: tenant.clinicId,
        clinicSlug: tenant.clinic.slug,
        appointmentId: updated.id,
        dateKey: updated.dateKey,
        status: updated.status,
        action: "rescheduled",
      });

      return updated;
    } catch (error) {
      if (isPostgresExclusionError(error)) {
        throw new DomainException(
          API_ERROR_CODES.SLOT_UNAVAILABLE,
          "Target reschedule slot conflicts with another booking.",
          HttpStatus.CONFLICT
        );
      }
      throw error;
    }
  }

  async updateClinicalNotes(
    tenant: TenantContext,
    appointmentId: string,
    dto: UpdateClinicalNotesDto
  ) {
    const existing = await this.prisma.appointment.findFirst({
      where: { id: appointmentId, clinicId: tenant.clinicId },
    });
    if (!existing) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Appointment not found.",
        HttpStatus.NOT_FOUND
      );
    }

    return this.prisma.appointment.update({
      where: { id: existing.id },
      data: {
        ...(dto.clinicalNotes !== undefined
          ? { clinicalNotes: dto.clinicalNotes }
          : {}),
        ...(dto.postVisitInstructions !== undefined
          ? { postVisitInstructions: dto.postVisitInstructions }
          : {}),
      },
    });
  }

  async addWaitlistEntry(tenant: TenantContext, dto: StaffAddWaitlistDto) {
    const eligibility = evaluateClinicBookingEligibility(
      {
        status: tenant.clinic.status,
        subscriptionEndsAt: tenant.clinic.subscriptionEndsAt.getTime(),
        gracePeriodEndsAt: tenant.clinic.gracePeriodEndsAt?.getTime() ?? null,
      },
      Date.now()
    );
    if (!eligibility.isBookable) {
      throw new DomainException(
        API_ERROR_CODES.CLINIC_READ_ONLY,
        eligibility.reason ?? "Clinic is read-only.",
        HttpStatus.FORBIDDEN
      );
    }

    const entry = await this.prisma.waitlistEntry.create({
      data: {
        clinicId: tenant.clinicId,
        patientId: dto.patientId,
        serviceId: dto.serviceId,
        preferredDentistId: dto.preferredDentistId ?? null,
        preferredDateKey: dto.preferredDateKey,
        preferredTimeWindow: dto.preferredTimeWindow,
        status: "waiting",
      },
    });

    this.realtime.emitWaitlistUpdated({
      clinicId: tenant.clinicId,
      dateKey: dto.preferredDateKey,
    });

    return entry;
  }

  async updateWaitlistStatus(
    tenant: TenantContext,
    waitlistId: string,
    dto: UpdateWaitlistStatusDto
  ) {
    const existing = await this.prisma.waitlistEntry.findFirst({
      where: { id: waitlistId, clinicId: tenant.clinicId },
    });
    if (!existing) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Waitlist entry not found.",
        HttpStatus.NOT_FOUND
      );
    }

    const updated = await this.prisma.waitlistEntry.update({
      where: { id: existing.id },
      data: { status: dto.status },
    });

    this.realtime.emitWaitlistUpdated({
      clinicId: tenant.clinicId,
      dateKey: existing.preferredDateKey,
    });

    return updated;
  }

  /** Helper used by patient self-reschedule to compute local dateKey if needed. */
  getDateKeyForClinic(utcMs: number, timeZone: string): string {
    return getLocalDateKeyAndMinute(utcMs, timeZone).dateKey;
  }

  async getDentistTimeOff(
    tenant: TenantContext,
    actor: User,
    dentistId?: string
  ) {
    const resolvedDentist = dentistId
      ? await this.prisma.dentist.findFirst({
          where: { id: dentistId, clinicId: tenant.clinicId },
        })
      : await this.prisma.dentist.findFirst({
          where: { userId: actor.id, clinicId: tenant.clinicId },
        });
    if (!resolvedDentist) return [];
    return this.prisma.dentistTimeOff.findMany({
      where: {
        clinicId: tenant.clinicId,
        dentistId: resolvedDentist.id,
        endTimeUtc: { gte: new Date() },
      },
      orderBy: { startTimeUtc: "asc" },
      take: 50,
    });
  }

  async checkTimeOffConflicts(
    tenant: TenantContext,
    actor: User,
    params: { dentistId?: string; startTimeUtc: number; endTimeUtc: number }
  ) {
    const resolvedDentist = params.dentistId
      ? await this.prisma.dentist.findFirst({
          where: { id: params.dentistId, clinicId: tenant.clinicId },
        })
      : await this.prisma.dentist.findFirst({
          where: { userId: actor.id, clinicId: tenant.clinicId },
        });
    if (
      !resolvedDentist ||
      !Number.isFinite(params.startTimeUtc) ||
      !Number.isFinite(params.endTimeUtc)
    ) {
      return [];
    }
    return this.prisma.appointment.findMany({
      where: {
        clinicId: tenant.clinicId,
        dentistId: resolvedDentist.id,
        status: { notIn: ["cancelled", "no_show"] },
        startTimeUtc: { lt: new Date(params.endTimeUtc) },
        endTimeUtc: { gt: new Date(params.startTimeUtc) },
      },
      include: {
        patient: { select: { firstName: true, lastName: true } },
        service: { select: { name: true } },
      },
      orderBy: { startTimeUtc: "asc" },
    });
  }

  async createMyTimeOff(
    tenant: TenantContext,
    actor: User,
    body: {
      dentistId?: string;
      startTimeUtc: number | string;
      endTimeUtc: number | string;
      reason: string;
    }
  ) {
    const resolvedDentist = body.dentistId
      ? await this.prisma.dentist.findFirst({
          where: { id: body.dentistId, clinicId: tenant.clinicId },
        })
      : await this.prisma.dentist.findFirst({
          where: { userId: actor.id, clinicId: tenant.clinicId },
        });
    if (!resolvedDentist) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Dentist profile not found in this clinic.",
        HttpStatus.NOT_FOUND
      );
    }
    const start = new Date(body.startTimeUtc);
    const end = new Date(body.endTimeUtc);
    if (end.getTime() <= start.getTime()) {
      throw new DomainException(
        API_ERROR_CODES.INVALID_INPUT,
        "endTimeUtc must be after startTimeUtc.",
        HttpStatus.BAD_REQUEST
      );
    }
    return this.prisma.dentistTimeOff.create({
      data: {
        clinicId: tenant.clinicId,
        dentistId: resolvedDentist.id,
        startTimeUtc: start,
        endTimeUtc: end,
        reason: body.reason?.trim() || "Time off",
        createdByUserId: actor.id,
      },
    });
  }

  async removeMyTimeOff(tenant: TenantContext, timeOffId: string) {
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
    await this.prisma.dentistTimeOff.delete({ where: { id: existing.id } });
    return { deleted: true };
  }
}
