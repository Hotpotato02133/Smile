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

  async getFrontDeskWorkspace(tenant: TenantContext, dateKey?: string) {
    const targetDate = dateKey?.trim() || toManilaDateKey();
    const [appointments, dentists, chairs, services, waitlist] =
      await Promise.all([
        this.prisma.appointment.findMany({
          where: { clinicId: tenant.clinicId, dateKey: targetDate },
          include: {
            patient: {
              select: {
                id: true,
                firstName: true,
                lastName: true,
                phone: true,
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
      ]);

    return {
      dateKey: targetDate,
      appointments,
      dentists,
      chairs,
      services,
      waitlist,
    };
  }

  async getDentistQueue(
    tenant: TenantContext,
    actor: User,
    params: { dateKey?: string; dentistId?: string }
  ) {
    const targetDate = params.dateKey?.trim() || toManilaDateKey();
    const dentists = await this.prisma.dentist.findMany({
      where: { clinicId: tenant.clinicId, isActive: true },
      orderBy: { displayName: "asc" },
    });

    const ownDentist = dentists.find((d) => d.userId === actor.id);
    const selectedDentistId =
      params.dentistId ?? ownDentist?.id ?? dentists[0]?.id ?? null;

    const appointments = selectedDentistId
      ? await this.prisma.appointment.findMany({
          where: {
            clinicId: tenant.clinicId,
            dentistId: selectedDentistId,
            dateKey: targetDate,
          },
          include: {
            patient: true,
            chair: { select: { id: true, name: true, roomCode: true } },
            service: true,
          },
          orderBy: { startTimeUtc: "asc" },
        })
      : [];

    return {
      dateKey: targetDate,
      selectedDentistId,
      dentists,
      appointments,
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
}
