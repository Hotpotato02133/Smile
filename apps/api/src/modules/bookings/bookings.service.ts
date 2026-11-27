import { HttpStatus, Injectable } from "@nestjs/common";
import {
  AppointmentStatus,
  BookingSource,
  type Prisma,
  type User,
} from "@prisma/client";
import {
  API_ERROR_CODES,
  evaluateClinicBookingEligibility,
} from "@smile/shared";
import { DomainException } from "../../common/exceptions/domain.exception";
import { PrismaService } from "../../infra/prisma.service";
import { AppointmentsService } from "../appointments/appointments.service";
import { assertClinicFeature } from "../auth/guards/clinic-quota.guard";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { SchedulingService } from "../scheduling/scheduling.service";
import { StorageService } from "../storage/storage.service";
import type {
  CancelMyAppointmentDto,
  ClaimWaitlistDto,
  CreateOnlineBookingDto,
  CreatePatientProfileDto,
  JoinWaitlistDto,
  RescheduleMyAppointmentDto,
  UpdateMedicalProfileDto,
} from "./bookings.schemas";

@Injectable()
export class BookingsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly appointmentsService: AppointmentsService,
    private readonly schedulingService: SchedulingService,
    private readonly realtime: RealtimeGateway,
    private readonly storageService: StorageService
  ) {}

  // ============================================================================
  // PUBLIC UNAUTHENTICATED SANITIZED QUERIES (Law #6 — Zero PHI)
  // ============================================================================

  async listPublicClinics() {
    const nowMs = Date.now();
    const clinics = await this.prisma.clinic.findMany({
      where: {
        status: { in: ["active", "trial", "past_due"] },
      },
      orderBy: { name: "asc" },
      take: 100,
    });

    return clinics.map((c) => {
      const eligibility = evaluateClinicBookingEligibility(
        {
          status: c.status,
          subscriptionEndsAt: c.subscriptionEndsAt.getTime(),
          gracePeriodEndsAt: c.gracePeriodEndsAt?.getTime() ?? null,
        },
        nowMs
      );
      return {
        id: c.id,
        name: c.name,
        slug: c.slug,
        tagline: c.tagline,
        logoStorageKey: c.logoStorageKey,
        primaryColorHex: c.primaryColorHex,
        city: c.city,
        province: c.province,
        address: c.address,
        phone: c.phone,
        isBookable: eligibility.isBookable,
      };
    });
  }

  async getPublicClinicBySlug(slug: string) {
    const clinic = await this.prisma.clinic.findUnique({
      where: { slug: slug.trim().toLowerCase() },
    });
    if (!clinic || clinic.status === "archived") {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Clinic not found.",
        HttpStatus.NOT_FOUND
      );
    }

    const nowMs = Date.now();
    const eligibility = evaluateClinicBookingEligibility(
      {
        status: clinic.status,
        subscriptionEndsAt: clinic.subscriptionEndsAt.getTime(),
        gracePeriodEndsAt: clinic.gracePeriodEndsAt?.getTime() ?? null,
      },
      nowMs
    );

    const [services, dentists] = await Promise.all([
      this.prisma.service.findMany({
        where: { clinicId: clinic.id, isActive: true },
        orderBy: [{ category: "asc" }, { name: "asc" }],
      }),
      this.prisma.dentist.findMany({
        where: { clinicId: clinic.id, isActive: true },
        select: {
          id: true,
          displayName: true,
          specialties: true,
          bio: true,
          calendarColorHex: true,
          weeklySchedule: true,
        },
        orderBy: { displayName: "asc" },
      }),
    ]);

    return {
      clinic: {
        id: clinic.id,
        name: clinic.name,
        slug: clinic.slug,
        tagline: clinic.tagline,
        logoStorageKey: clinic.logoStorageKey,
        primaryColorHex: clinic.primaryColorHex,
        email: clinic.email,
        phone: clinic.phone,
        address: clinic.address,
        city: clinic.city,
        province: clinic.province,
        timezone: clinic.timezone,
        slotIntervalMinutes: clinic.slotIntervalMinutes,
        cancellationWindowHours: clinic.cancellationWindowHours,
        requireBookingApproval: clinic.requireBookingApproval,
        operatingHours: clinic.operatingHours,
        featureFlags: clinic.featureFlags,
      },
      isBookable: eligibility.isBookable,
      unbookableReason: eligibility.reason,
      services,
      dentists,
    };
  }

  // ============================================================================
  // AUTHENTICATED PATIENT PORTAL & ONLINE BOOKING
  // ============================================================================

  private async getOwnedPatientIds(userId: string): Promise<string[]> {
    const selfProfiles = await this.prisma.patient.findMany({
      where: { userId },
      select: { id: true },
    });
    const selfIds = selfProfiles.map((p) => p.id);
    if (selfIds.length === 0) return [];

    const dependents = await this.prisma.patient.findMany({
      where: { guardianPatientId: { in: selfIds } },
      select: { id: true },
    });
    return Array.from(new Set([...selfIds, ...dependents.map((d) => d.id)]));
  }

  private async assertPatientOwnedByUser(
    userId: string,
    patientId: string
  ) {
    const patient = await this.prisma.patient.findUnique({
      where: { id: patientId },
    });
    if (!patient) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Patient profile not found.",
        HttpStatus.NOT_FOUND
      );
    }
    if (patient.userId === userId) return patient;
    if (patient.guardianPatientId) {
      const guardian = await this.prisma.patient.findUnique({
        where: { id: patient.guardianPatientId },
      });
      if (guardian?.userId === userId) return patient;
    }
    throw new DomainException(
      API_ERROR_CODES.FORBIDDEN,
      "You do not have permission to access this patient profile.",
      HttpStatus.FORBIDDEN
    );
  }

  async getPatientDashboard(user: User) {
    const patientIds = await this.getOwnedPatientIds(user.id);
    if (patientIds.length === 0) {
      return { profiles: [], appointments: [], waitlist: [] };
    }

    const [profiles, appointments, waitlist] = await Promise.all([
      this.prisma.patient.findMany({
        where: { id: { in: patientIds } },
        include: { clinic: { select: { id: true, name: true, slug: true } } },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.appointment.findMany({
        where: { patientId: { in: patientIds } },
        include: {
          clinic: {
            select: {
              id: true,
              name: true,
              slug: true,
              timezone: true,
              cancellationWindowHours: true,
            },
          },
          patient: { select: { id: true, firstName: true, lastName: true } },
          dentist: { select: { id: true, displayName: true } },
          chair: { select: { id: true, name: true, roomCode: true } },
          service: {
            select: {
              id: true,
              name: true,
              category: true,
              durationMinutes: true,
              pricePhp: true,
            },
          },
        },
        orderBy: { startTimeUtc: "desc" },
        take: 100,
      }),
      this.prisma.waitlistEntry.findMany({
        where: { patientId: { in: patientIds } },
        include: {
          clinic: { select: { id: true, name: true, slug: true } },
          service: { select: { id: true, name: true } },
          preferredDentist: { select: { id: true, displayName: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ]);

    return { profiles, appointments, waitlist };
  }

  async getMyClinicalSummary(user: User, patientId?: string) {
    const ownedIds = await this.getOwnedPatientIds(user.id);
    if (ownedIds.length === 0) {
      return { toothRecords: [], files: [], completedVisits: [] };
    }
    const targetIds =
      patientId && ownedIds.includes(patientId) ? [patientId] : ownedIds;

    const [toothRecords, files, completedVisits] = await Promise.all([
      this.prisma.toothRecord.findMany({
        where: { patientId: { in: targetIds } },
        include: {
          recordedByDentist: { select: { displayName: true } },
        },
        orderBy: { updatedAt: "desc" },
        take: 100,
      }),
      this.prisma.clinicalFile.findMany({
        where: { patientId: { in: targetIds } },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
      this.prisma.appointment.findMany({
        where: { patientId: { in: targetIds }, status: "completed" },
        include: {
          clinic: { select: { name: true, slug: true } },
          service: { select: { name: true } },
          dentist: { select: { displayName: true } },
        },
        orderBy: { startTimeUtc: "desc" },
        take: 30,
      }),
    ]);

    const enrichedFiles = await Promise.all(
      files.map(async (f) => ({
        ...f,
        url: await this.storageService.createPresignedGetUrl(f.storageKey, 300),
      }))
    );

    return {
      toothRecords: toothRecords.map((r) => ({
        ...r,
        recordedByDentistName: r.recordedByDentist.displayName,
      })),
      files: enrichedFiles,
      completedVisits,
    };
  }

  async getWaitlistEntryForClaim(user: User, waitlistId: string) {
    const entry = await this.prisma.waitlistEntry.findUnique({
      where: { id: waitlistId },
      include: {
        clinic: { select: { id: true, name: true, slug: true } },
        service: true,
        preferredDentist: { select: { id: true, displayName: true } },
      },
    });
    if (!entry) return null;
    await this.assertPatientOwnedByUser(user.id, entry.patientId);
    return entry;
  }

  async getMyProfilesForClinic(user: User, clinicId: string) {
    const ownedIds = await this.getOwnedPatientIds(user.id);
    if (ownedIds.length === 0) return [];
    return this.prisma.patient.findMany({
      where: { clinicId, id: { in: ownedIds } },
      orderBy: { createdAt: "asc" },
    });
  }

  async createPatientProfile(user: User, dto: CreatePatientProfileDto) {
    const clinic = await this.prisma.clinic.findUnique({
      where: { id: dto.clinicId },
    });
    if (!clinic) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Clinic not found.",
        HttpStatus.NOT_FOUND
      );
    }

    if (dto.guardianPatientId) {
      const guardian = await this.assertPatientOwnedByUser(
        user.id,
        dto.guardianPatientId
      );
      if (guardian.clinicId !== clinic.id) {
        throw new DomainException(
          API_ERROR_CODES.INVALID_INPUT,
          "Guardian profile must belong to the same clinic.",
          HttpStatus.BAD_REQUEST
        );
      }
    }

    return this.prisma.patient.create({
      data: {
        clinicId: clinic.id,
        userId: dto.guardianPatientId ? null : user.id,
        guardianPatientId: dto.guardianPatientId ?? null,
        firstName: dto.firstName,
        lastName: dto.lastName,
        dateOfBirth: dto.dateOfBirth,
        sex: dto.sex,
        phone: dto.phone,
        email: dto.email ?? user.email,
        address: dto.address ?? null,
        emergencyContactName: dto.emergencyContactName ?? null,
        emergencyContactPhone: dto.emergencyContactPhone ?? null,
        medicalHistory: (dto.medicalHistory ?? {
          allergies: [],
          conditions: [],
          isTakingBloodThinners: false,
          isPregnant: false,
          dentalAnxietyLevel: "none",
        }) as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async updateMedicalProfile(
    user: User,
    patientId: string,
    dto: UpdateMedicalProfileDto
  ) {
    await this.assertPatientOwnedByUser(user.id, patientId);
    return this.prisma.patient.update({
      where: { id: patientId },
      data: {
        ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
        ...(dto.address !== undefined ? { address: dto.address } : {}),
        ...(dto.emergencyContactName !== undefined
          ? { emergencyContactName: dto.emergencyContactName }
          : {}),
        ...(dto.emergencyContactPhone !== undefined
          ? { emergencyContactPhone: dto.emergencyContactPhone }
          : {}),
        medicalHistory: dto.medicalHistory as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async deleteDependentProfile(user: User, patientId: string) {
    const patient = await this.assertPatientOwnedByUser(user.id, patientId);
    if (!patient.guardianPatientId) {
      throw new DomainException(
        API_ERROR_CODES.INVALID_INPUT,
        "Only dependent profiles may be deleted.",
        HttpStatus.BAD_REQUEST
      );
    }

    const activeAppointments = await this.prisma.appointment.count({
      where: {
        patientId: patient.id,
        status: {
          in: ["pending_approval", "confirmed", "checked_in", "in_chair"],
        },
      },
    });
    if (activeAppointments > 0) {
      throw new DomainException(
        API_ERROR_CODES.CONFLICT,
        "Cannot delete a dependent profile with active upcoming appointments.",
        HttpStatus.CONFLICT
      );
    }

    await this.prisma.patient.delete({ where: { id: patient.id } });
    return { deleted: true };
  }

  async createOnlineBooking(user: User, dto: CreateOnlineBookingDto) {
    const clinic = await this.prisma.clinic.findUnique({
      where: { slug: dto.clinicSlug.trim().toLowerCase() },
    });
    if (!clinic) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Clinic not found.",
        HttpStatus.NOT_FOUND
      );
    }

    const patient = await this.assertPatientOwnedByUser(user.id, dto.patientId);
    if (patient.clinicId !== clinic.id) {
      throw new DomainException(
        API_ERROR_CODES.FORBIDDEN,
        "Patient profile does not belong to this clinic.",
        HttpStatus.FORBIDDEN
      );
    }

    const initialStatus = clinic.requireBookingApproval
      ? AppointmentStatus.pending_approval
      : AppointmentStatus.confirmed;

    return this.appointmentsService.bookSlotAtomically({
      clinic,
      patientId: patient.id,
      serviceId: dto.serviceId,
      dentistId: dto.dentistId,
      chairId: dto.chairId,
      dateKey: dto.dateKey,
      startTimeUtc: dto.startTimeUtc,
      status: initialStatus,
      bookingSource: BookingSource.patient_online,
      chiefComplaint: dto.chiefComplaint,
      createdByUserId: user.id,
      sessionId: dto.sessionId,
      enforceScheduleRules: true,
      allowEmergencyBuffer: false,
      minLeadMinutes: 15,
    });
  }

  async cancelMyAppointment(
    user: User,
    appointmentId: string,
    dto: CancelMyAppointmentDto
  ) {
    const appt = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { clinic: true },
    });
    if (!appt) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Appointment not found.",
        HttpStatus.NOT_FOUND
      );
    }

    await this.assertPatientOwnedByUser(user.id, appt.patientId);

    if (
      appt.status !== "pending_approval" &&
      appt.status !== "confirmed"
    ) {
      throw new DomainException(
        API_ERROR_CODES.INVALID_INPUT,
        `Cannot cancel an appointment with status "${appt.status}".`,
        HttpStatus.BAD_REQUEST
      );
    }

    const cutoffMs =
      appt.startTimeUtc.getTime() -
      appt.clinic.cancellationWindowHours * 60 * 60 * 1000;
    if (Date.now() > cutoffMs) {
      throw new DomainException(
        API_ERROR_CODES.FORBIDDEN,
        `Cancellations must be made at least ${appt.clinic.cancellationWindowHours} hours before the appointment.`,
        HttpStatus.FORBIDDEN
      );
    }

    const updated = await this.prisma.appointment.update({
      where: { id: appt.id },
      data: {
        status: AppointmentStatus.cancelled,
        cancellationReason: dto.reason ?? "Cancelled by patient",
      },
    });

    this.realtime.emitAppointmentChanged({
      clinicId: appt.clinicId,
      clinicSlug: appt.clinic.slug,
      appointmentId: updated.id,
      dateKey: updated.dateKey,
      status: updated.status,
      action: "cancelled",
    });

    return updated;
  }

  async rescheduleMyAppointment(
    user: User,
    appointmentId: string,
    dto: RescheduleMyAppointmentDto
  ) {
    const appt = await this.prisma.appointment.findUnique({
      where: { id: appointmentId },
      include: { clinic: true, service: true },
    });
    if (!appt) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Appointment not found.",
        HttpStatus.NOT_FOUND
      );
    }

    await this.assertPatientOwnedByUser(user.id, appt.patientId);

    const cutoffMs =
      appt.startTimeUtc.getTime() -
      appt.clinic.cancellationWindowHours * 60 * 60 * 1000;
    if (Date.now() > cutoffMs) {
      throw new DomainException(
        API_ERROR_CODES.FORBIDDEN,
        `Rescheduling must be done at least ${appt.clinic.cancellationWindowHours} hours before the appointment.`,
        HttpStatus.FORBIDDEN
      );
    }

    const nextDentistId = dto.dentistId ?? appt.dentistId;
    const nextChairId = dto.chairId ?? appt.chairId;

    const check = await this.schedulingService.verifySpecificPairAvailable({
      clinic: appt.clinic,
      service: appt.service,
      dateKey: dto.dateKey,
      dentistId: nextDentistId,
      chairId: nextChairId,
      startTimeUtc: dto.startTimeUtc,
      ignoreSessionId: dto.sessionId,
      ignoreAppointmentId: appt.id,
      enforceScheduleRules: true,
      allowEmergencyBuffer: false,
      minLeadMinutes: 15,
    });
    if (!check.ok) {
      throw new DomainException(
        API_ERROR_CODES.SLOT_UNAVAILABLE,
        check.reason ?? "Target reschedule slot is unavailable.",
        HttpStatus.CONFLICT
      );
    }

    return this.appointmentsService.rescheduleAppointment(
      {
        clinicId: appt.clinicId,
        clinic: appt.clinic,
        isSuperAdminOverride: false,
      },
      user,
      appt.id,
      {
        dateKey: dto.dateKey,
        startTimeUtc: dto.startTimeUtc,
        dentistId: nextDentistId,
        chairId: nextChairId,
      }
    );
  }

  async joinWaitlist(user: User, dto: JoinWaitlistDto) {
    const clinic = await this.prisma.clinic.findUnique({
      where: { slug: dto.clinicSlug.trim().toLowerCase() },
    });
    if (!clinic) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Clinic not found.",
        HttpStatus.NOT_FOUND
      );
    }

    assertClinicFeature(clinic, "waitlistAutomationEnabled");
    const patient = await this.assertPatientOwnedByUser(user.id, dto.patientId);

    const entry = await this.prisma.waitlistEntry.create({
      data: {
        clinicId: clinic.id,
        patientId: patient.id,
        serviceId: dto.serviceId,
        preferredDentistId: dto.preferredDentistId ?? null,
        preferredDateKey: dto.preferredDateKey,
        preferredTimeWindow: dto.preferredTimeWindow,
        status: "waiting",
      },
    });

    this.realtime.emitWaitlistUpdated({
      clinicId: clinic.id,
      dateKey: dto.preferredDateKey,
    });

    return entry;
  }

  async leaveWaitlist(user: User, waitlistId: string) {
    const entry = await this.prisma.waitlistEntry.findUnique({
      where: { id: waitlistId },
    });
    if (!entry) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Waitlist entry not found.",
        HttpStatus.NOT_FOUND
      );
    }
    await this.assertPatientOwnedByUser(user.id, entry.patientId);
    await this.prisma.waitlistEntry.delete({ where: { id: entry.id } });
    return { deleted: true };
  }

  async claimWaitlistSlot(
    user: User,
    waitlistId: string,
    dto: ClaimWaitlistDto
  ) {
    const entry = await this.prisma.waitlistEntry.findUnique({
      where: { id: waitlistId },
      include: { clinic: true },
    });
    if (!entry) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Waitlist entry not found.",
        HttpStatus.NOT_FOUND
      );
    }
    await this.assertPatientOwnedByUser(user.id, entry.patientId);

    if (entry.status !== "waiting" && entry.status !== "notified") {
      throw new DomainException(
        API_ERROR_CODES.CONFLICT,
        `This waitlist entry is already "${entry.status}".`,
        HttpStatus.CONFLICT
      );
    }

    const appointment = await this.appointmentsService.bookSlotAtomically({
      clinic: entry.clinic,
      patientId: entry.patientId,
      serviceId: entry.serviceId,
      dentistId: dto.dentistId,
      chairId: dto.chairId,
      dateKey: dto.dateKey,
      startTimeUtc: dto.startTimeUtc,
      status: AppointmentStatus.confirmed,
      bookingSource: BookingSource.waitlist_claim,
      createdByUserId: user.id,
      sessionId: dto.sessionId,
      enforceScheduleRules: true,
      allowEmergencyBuffer: false,
      minLeadMinutes: 15,
    });

    await this.prisma.waitlistEntry.update({
      where: { id: entry.id },
      data: { status: "claimed" },
    });

    this.realtime.emitWaitlistUpdated({
      clinicId: entry.clinicId,
      dateKey: entry.preferredDateKey,
    });

    return appointment;
  }
}
