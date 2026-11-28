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
import { serializeServiceCategory } from "../clinics/clinics.service";
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

  async listPublicClinics(search?: string) {
    const nowMs = Date.now();
    const q = search?.trim();
    const clinics = await this.prisma.clinic.findMany({
      where: {
        status: { in: ["active", "trial", "past_due"] },
        ...(q
          ? {
              OR: [
                { name: { contains: q, mode: "insensitive" } },
                { city: { contains: q, mode: "insensitive" } },
                { province: { contains: q, mode: "insensitive" } },
                { address: { contains: q, mode: "insensitive" } },
                { tagline: { contains: q, mode: "insensitive" } },
              ],
            }
          : {}),
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
        logoUrl: c.logoStorageKey
          ? this.storageService.getPublicUrl(c.logoStorageKey)
          : null,
        primaryColorHex: c.primaryColorHex,
        city: c.city,
        province: c.province,
        address: c.address,
        phone: c.phone,
        activeDentistCount: c.activeDentistCount,
        activeChairCount: c.activeChairCount,
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

    const [servicesRaw, dentists] = await Promise.all([
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

    const services = servicesRaw.map((s) => ({
      ...s,
      category: serializeServiceCategory(s.category),
    }));

    return {
      clinic: {
        id: clinic.id,
        name: clinic.name,
        slug: clinic.slug,
        tagline: clinic.tagline,
        logoStorageKey: clinic.logoStorageKey,
        logoUrl: clinic.logoStorageKey
          ? this.storageService.getPublicUrl(clinic.logoStorageKey)
          : null,
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
        activeDentistCount: clinic.activeDentistCount,
        activeChairCount: clinic.activeChairCount,
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
    const now = new Date();
    const [patientIds, featuredClinicsRaw, announcements] = await Promise.all([
      this.getOwnedPatientIds(user.id),
      this.prisma.clinic.findMany({
        where: { status: { in: ["active", "trial", "past_due"] } },
        orderBy: { name: "asc" },
        take: 12,
      }),
      this.prisma.systemAnnouncement.findMany({
        where: {
          isActive: true,
          targetAudience: "all_users",
          OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
        },
        orderBy: { createdAt: "desc" },
        take: 5,
      }),
    ]);

    const featuredClinics = featuredClinicsRaw.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      tagline: c.tagline,
      city: c.city,
      province: c.province,
      primaryColorHex: c.primaryColorHex,
      activeDentistCount: c.activeDentistCount,
      activeChairCount: c.activeChairCount,
      logoUrl: c.logoStorageKey
        ? this.storageService.getPublicUrl(c.logoStorageKey)
        : null,
    }));

    if (patientIds.length === 0) {
      return {
        user,
        profiles: [],
        appointments: [],
        waitlist: [],
        featuredClinics,
        announcements,
      };
    }

    const [profilesRaw, appointmentsRaw, waitlistRaw] = await Promise.all([
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
              address: true,
              phone: true,
              timezone: true,
              primaryColorHex: true,
              cancellationWindowHours: true,
            },
          },
          patient: {
            select: {
              id: true,
              firstName: true,
              lastName: true,
              guardianPatientId: true,
            },
          },
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
          patient: {
            select: { firstName: true, lastName: true, guardianPatientId: true },
          },
          service: { select: { id: true, name: true } },
          preferredDentist: { select: { id: true, displayName: true } },
        },
        orderBy: { createdAt: "desc" },
        take: 50,
      }),
    ]);

    const nowMs = now.getTime();
    const profiles = profilesRaw.map((p) => ({
      ...p,
      clinicName: p.clinic.name,
      clinicSlug: p.clinic.slug,
      isDependent: Boolean(p.guardianPatientId),
    }));

    const appointments = appointmentsRaw.map((a) => {
      const cutoffMs =
        a.startTimeUtc.getTime() - a.clinic.cancellationWindowHours * 3600_000;
      return {
        ...a,
        referenceCode: `SM-${a.id.slice(0, 8).toUpperCase()}`,
        clinicName: a.clinic.name,
        clinicSlug: a.clinic.slug,
        clinicAddress: a.clinic.address,
        clinicPhone: a.clinic.phone,
        clinicTimezone: a.clinic.timezone,
        clinicPrimaryColorHex: a.clinic.primaryColorHex,
        cancellationWindowHours: a.clinic.cancellationWindowHours,
        patientName: `${a.patient.firstName} ${a.patient.lastName}`.trim(),
        isDependent: Boolean(a.patient.guardianPatientId),
        dentistName: a.dentist.displayName,
        chairName: a.chair.name,
        serviceName: a.service.name,
        serviceCategory: a.service.category,
        durationMinutes: a.service.durationMinutes,
        pricePhp: a.service.pricePhp,
        canModify:
          (a.status === "pending_approval" || a.status === "confirmed") &&
          nowMs <= cutoffMs,
      };
    });

    const waitlist = waitlistRaw.map((w) => ({
      ...w,
      clinicName: w.clinic.name,
      clinicSlug: w.clinic.slug,
      patientName: `${w.patient.firstName} ${w.patient.lastName}`.trim(),
      isDependent: Boolean(w.patient.guardianPatientId),
      serviceName: w.service.name,
      preferredDentistName: w.preferredDentist?.displayName ?? null,
    }));

    return {
      user,
      profiles,
      appointments,
      waitlist,
      featuredClinics,
      announcements,
    };
  }

  async getMyClinicalSummary(user: User, patientId?: string) {
    const ownedIds = await this.getOwnedPatientIds(user.id);
    if (ownedIds.length === 0) {
      return {
        toothRecords: [],
        files: [],
        clinicalFiles: [],
        completedVisits: [],
        clinicName: null,
        clinicSlug: null,
        nextRecallDate: null,
        lastCleaningDate: null,
      };
    }
    const targetIds =
      patientId && ownedIds.includes(patientId) ? [patientId] : ownedIds;

    const [targetPatient, toothRecords, files, completedVisits] = await Promise.all([
      this.prisma.patient.findFirst({
        where: { id: targetIds[0] },
        include: { clinic: { select: { name: true, slug: true } } },
      }),
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
      clinicName: targetPatient?.clinic?.name ?? null,
      clinicSlug: targetPatient?.clinic?.slug ?? null,
      nextRecallDate: targetPatient?.nextRecallDate ?? null,
      lastCleaningDate: targetPatient?.lastCleaningDate ?? null,
      toothRecords: toothRecords.map((r) => ({
        ...r,
        recordedByDentistName: r.recordedByDentist.displayName,
      })),
      files: enrichedFiles,
      clinicalFiles: enrichedFiles,
      completedVisits,
    };
  }

  async getWaitlistEntryForClaim(user: User, waitlistId: string) {
    const entry = await this.prisma.waitlistEntry.findUnique({
      where: { id: waitlistId },
      include: {
        clinic: { select: { id: true, name: true, slug: true } },
        patient: { select: { id: true, firstName: true, lastName: true } },
        service: true,
        preferredDentist: { select: { id: true, displayName: true } },
      },
    });
    if (!entry) return null;
    await this.assertPatientOwnedByUser(user.id, entry.patientId);
    return {
      ...entry,
      serviceName: entry.service.name,
      patientName: `${entry.patient.firstName} ${entry.patient.lastName}`.trim(),
    };
  }

  async getMyProfilesForClinic(user: User, clinicId: string) {
    const [clinicSelfProfile, fallbackSelfProfile] = await Promise.all([
      this.prisma.patient.findFirst({
        where: { clinicId, userId: user.id, guardianPatientId: null },
        orderBy: { createdAt: "asc" },
      }),
      this.prisma.patient.findFirst({
        where: { userId: user.id, guardianPatientId: null },
        orderBy: { createdAt: "desc" },
      }),
    ]);

    const dependents = clinicSelfProfile
      ? await this.prisma.patient.findMany({
          where: { clinicId, guardianPatientId: clinicSelfProfile.id },
          orderBy: { createdAt: "asc" },
        })
      : [];

    return {
      selfProfile: clinicSelfProfile,
      fallbackSelfProfile: clinicSelfProfile ? null : fallbackSelfProfile,
      dependents,
      user: {
        firstName: user.firstName ?? "",
        lastName: user.lastName ?? "",
        email: user.email ?? "",
        phone: user.phone ?? "",
      },
    };
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

    const defaultMedicalHistory = {
      allergies: [],
      conditions: [],
      isTakingBloodThinners: false,
      isPregnant: false,
      dentalAnxietyLevel: "none" as const,
    };

    const isDependent =
      dto.profileKind === "dependent" || Boolean(dto.guardianPatientId);

    let guardianId: string | null = dto.guardianPatientId ?? null;
    if (guardianId) {
      const guardian = await this.assertPatientOwnedByUser(
        user.id,
        guardianId
      );
      if (guardian.clinicId !== clinic.id) {
        throw new DomainException(
          API_ERROR_CODES.INVALID_INPUT,
          "Guardian profile must belong to the same clinic.",
          HttpStatus.BAD_REQUEST
        );
      }
    } else if (isDependent) {
      let guardian = await this.prisma.patient.findFirst({
        where: { clinicId: clinic.id, userId: user.id, guardianPatientId: null },
      });
      if (!guardian) {
        guardian = await this.prisma.patient.create({
          data: {
            clinicId: clinic.id,
            userId: user.id,
            firstName: user.firstName || "Patient",
            lastName: user.lastName || "",
            dateOfBirth: "1990-01-01",
            sex: "other",
            phone: user.phone || dto.phone,
            email: user.email,
            medicalHistory: defaultMedicalHistory as unknown as Prisma.InputJsonValue,
          },
        });
      }
      guardianId = guardian.id;
    }

    if (!isDependent) {
      const existingSelf = await this.prisma.patient.findFirst({
        where: { clinicId: clinic.id, userId: user.id, guardianPatientId: null },
      });
      const selfRecord = existingSelf
        ? await this.prisma.patient.update({
            where: { id: existingSelf.id },
            data: {
              firstName: dto.firstName,
              lastName: dto.lastName,
              dateOfBirth: dto.dateOfBirth,
              sex: dto.sex,
              phone: dto.phone,
              email: dto.email ?? existingSelf.email ?? user.email,
              address: dto.address ?? null,
              emergencyContactName: dto.emergencyContactName ?? null,
              emergencyContactPhone: dto.emergencyContactPhone ?? null,
              medicalHistory: (dto.medicalHistory ??
                defaultMedicalHistory) as unknown as Prisma.InputJsonValue,
            },
          })
        : await this.prisma.patient.create({
            data: {
              clinicId: clinic.id,
              userId: user.id,
              guardianPatientId: null,
              firstName: dto.firstName,
              lastName: dto.lastName,
              dateOfBirth: dto.dateOfBirth,
              sex: dto.sex,
              phone: dto.phone,
              email: dto.email ?? user.email,
              address: dto.address ?? null,
              emergencyContactName: dto.emergencyContactName ?? null,
              emergencyContactPhone: dto.emergencyContactPhone ?? null,
              medicalHistory: (dto.medicalHistory ??
                defaultMedicalHistory) as unknown as Prisma.InputJsonValue,
            },
          });

      await this.prisma.user
        .update({
          where: { id: user.id },
          data: {
            firstName: dto.firstName,
            lastName: dto.lastName,
            phone: dto.phone,
          },
        })
        .catch(() => undefined);

      return selfRecord;
    }

    return this.prisma.patient.create({
      data: {
        clinicId: clinic.id,
        userId: null,
        guardianPatientId: guardianId,
        firstName: dto.firstName,
        lastName: dto.lastName,
        dateOfBirth: dto.dateOfBirth,
        sex: dto.sex,
        phone: dto.phone,
        email: dto.email ?? null,
        address: dto.address ?? null,
        emergencyContactName: dto.emergencyContactName ?? null,
        emergencyContactPhone: dto.emergencyContactPhone ?? null,
        medicalHistory: (dto.medicalHistory ??
          defaultMedicalHistory) as unknown as Prisma.InputJsonValue,
      },
    });
  }

  async updateMedicalProfile(
    user: User,
    patientId: string,
    dto: UpdateMedicalProfileDto
  ) {
    const patient = await this.assertPatientOwnedByUser(user.id, patientId);
    const updated = await this.prisma.patient.update({
      where: { id: patientId },
      data: {
        ...(dto.firstName !== undefined ? { firstName: dto.firstName } : {}),
        ...(dto.lastName !== undefined ? { lastName: dto.lastName } : {}),
        ...(dto.dateOfBirth !== undefined ? { dateOfBirth: dto.dateOfBirth } : {}),
        ...(dto.sex !== undefined ? { sex: dto.sex } : {}),
        ...(dto.email !== undefined ? { email: dto.email } : {}),
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

    if (patient.userId === user.id && !patient.guardianPatientId) {
      await this.prisma.user
        .update({
          where: { id: user.id },
          data: {
            ...(dto.firstName !== undefined ? { firstName: dto.firstName } : {}),
            ...(dto.lastName !== undefined ? { lastName: dto.lastName } : {}),
            ...(dto.phone !== undefined ? { phone: dto.phone } : {}),
          },
        })
        .catch(() => undefined);
    }

    return updated;
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
    const clinic = dto.clinicId
      ? await this.prisma.clinic.findUnique({ where: { id: dto.clinicId } })
      : await this.prisma.clinic.findUnique({
          where: { slug: dto.clinicSlug!.trim().toLowerCase() },
        });
    if (!clinic) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Clinic not found.",
        HttpStatus.NOT_FOUND
      );
    }

    const defaultMedicalHistory = {
      allergies: [],
      conditions: [],
      isTakingBloodThinners: false,
      isPregnant: false,
      dentalAnxietyLevel: "none" as const,
    };

    let patient: { id: string; clinicId: string; firstName: string; lastName: string };

    if (dto.patientId) {
      const existing = await this.assertPatientOwnedByUser(user.id, dto.patientId);
      if (existing.clinicId !== clinic.id) {
        throw new DomainException(
          API_ERROR_CODES.FORBIDDEN,
          "Patient profile does not belong to this clinic.",
          HttpStatus.FORBIDDEN
        );
      }
      patient = existing;
    } else if (dto.bookingFor === "dependent") {
      if (dto.existingPatientId) {
        const existingDep = await this.assertPatientOwnedByUser(
          user.id,
          dto.existingPatientId
        );
        if (existingDep.clinicId !== clinic.id) {
          throw new DomainException(
            API_ERROR_CODES.FORBIDDEN,
            "Dependent profile does not belong to this clinic.",
            HttpStatus.FORBIDDEN
          );
        }
        patient = dto.patientProfile
          ? await this.prisma.patient.update({
              where: { id: existingDep.id },
              data: {
                firstName: dto.patientProfile.firstName,
                lastName: dto.patientProfile.lastName,
                dateOfBirth: dto.patientProfile.dateOfBirth,
                sex: dto.patientProfile.sex,
                phone: dto.patientProfile.phone,
                email: dto.patientProfile.email ?? existingDep.email,
                address: dto.patientProfile.address ?? null,
                emergencyContactName:
                  dto.patientProfile.emergencyContactName ?? null,
                emergencyContactPhone:
                  dto.patientProfile.emergencyContactPhone ?? null,
                medicalHistory: (dto.patientProfile.medicalHistory ??
                  defaultMedicalHistory) as unknown as Prisma.InputJsonValue,
              },
            })
          : existingDep;
      } else {
        if (!dto.patientProfile) {
          throw new DomainException(
            API_ERROR_CODES.INVALID_INPUT,
            "Patient profile details are required for a new dependent.",
            HttpStatus.BAD_REQUEST
          );
        }
        let guardian = await this.prisma.patient.findFirst({
          where: { clinicId: clinic.id, userId: user.id, guardianPatientId: null },
        });
        if (!guardian) {
          guardian = await this.prisma.patient.create({
            data: {
              clinicId: clinic.id,
              userId: user.id,
              firstName: user.firstName || "Patient",
              lastName: user.lastName || "",
              dateOfBirth: "1990-01-01",
              sex: "other",
              phone: user.phone || dto.patientProfile.phone,
              email: user.email,
              medicalHistory: defaultMedicalHistory as unknown as Prisma.InputJsonValue,
            },
          });
        }
        patient = await this.prisma.patient.create({
          data: {
            clinicId: clinic.id,
            userId: null,
            guardianPatientId: guardian.id,
            firstName: dto.patientProfile.firstName,
            lastName: dto.patientProfile.lastName,
            dateOfBirth: dto.patientProfile.dateOfBirth,
            sex: dto.patientProfile.sex,
            phone: dto.patientProfile.phone,
            email: dto.patientProfile.email ?? null,
            address: dto.patientProfile.address ?? null,
            emergencyContactName: dto.patientProfile.emergencyContactName ?? null,
            emergencyContactPhone:
              dto.patientProfile.emergencyContactPhone ?? null,
            medicalHistory: (dto.patientProfile.medicalHistory ??
              defaultMedicalHistory) as unknown as Prisma.InputJsonValue,
          },
        });
      }
    } else {
      const existingSelf = await this.prisma.patient.findFirst({
        where: { clinicId: clinic.id, userId: user.id, guardianPatientId: null },
      });
      if (existingSelf && dto.patientProfile) {
        patient = await this.prisma.patient.update({
          where: { id: existingSelf.id },
          data: {
            firstName: dto.patientProfile.firstName,
            lastName: dto.patientProfile.lastName,
            dateOfBirth: dto.patientProfile.dateOfBirth,
            sex: dto.patientProfile.sex,
            phone: dto.patientProfile.phone,
            email: dto.patientProfile.email ?? user.email,
            address: dto.patientProfile.address ?? null,
            emergencyContactName: dto.patientProfile.emergencyContactName ?? null,
            emergencyContactPhone:
              dto.patientProfile.emergencyContactPhone ?? null,
            medicalHistory: (dto.patientProfile.medicalHistory ??
              defaultMedicalHistory) as unknown as Prisma.InputJsonValue,
          },
        });
      } else if (existingSelf) {
        patient = existingSelf;
      } else if (dto.patientProfile) {
        patient = await this.prisma.patient.create({
          data: {
            clinicId: clinic.id,
            userId: user.id,
            firstName: dto.patientProfile.firstName,
            lastName: dto.patientProfile.lastName,
            dateOfBirth: dto.patientProfile.dateOfBirth,
            sex: dto.patientProfile.sex,
            phone: dto.patientProfile.phone,
            email: dto.patientProfile.email ?? user.email,
            address: dto.patientProfile.address ?? null,
            emergencyContactName: dto.patientProfile.emergencyContactName ?? null,
            emergencyContactPhone:
              dto.patientProfile.emergencyContactPhone ?? null,
            medicalHistory: (dto.patientProfile.medicalHistory ??
              defaultMedicalHistory) as unknown as Prisma.InputJsonValue,
          },
        });
      } else {
        throw new DomainException(
          API_ERROR_CODES.INVALID_INPUT,
          "Patient profile details are required to complete booking.",
          HttpStatus.BAD_REQUEST
        );
      }

      if (dto.patientProfile) {
        await this.prisma.user
          .update({
            where: { id: user.id },
            data: {
              firstName: dto.patientProfile.firstName,
              lastName: dto.patientProfile.lastName,
              phone: dto.patientProfile.phone,
            },
          })
          .catch(() => undefined);
      }
    }

    const initialStatus = clinic.requireBookingApproval
      ? AppointmentStatus.pending_approval
      : AppointmentStatus.confirmed;

    const created = await this.appointmentsService.bookSlotAtomically({
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

    const [service, dentist, chair] = await Promise.all([
      this.prisma.service.findFirst({
        where: { id: created.serviceId, clinicId: clinic.id },
        select: { name: true, pricePhp: true },
      }),
      this.prisma.dentist.findUnique({
        where: { id: created.dentistId },
        select: { displayName: true },
      }),
      this.prisma.chair.findUnique({
        where: { id: created.chairId },
        select: { name: true },
      }),
    ]);

    return {
      ...created,
      appointmentId: created.id,
      referenceCode: `SM-${created.id.slice(0, 8).toUpperCase()}`,
      patientName: `${patient.firstName} ${patient.lastName}`.trim(),
      clinicName: clinic.name,
      clinicAddress: `${clinic.address}, ${clinic.city}, ${clinic.province}`,
      clinicPhone: clinic.phone,
      cancellationWindowHours: clinic.cancellationWindowHours,
      serviceName: service?.name ?? "Dental Visit",
      pricePhp: service?.pricePhp ?? 0,
      dentistName: dentist?.displayName ?? "Assigned Dentist",
      chairName: chair?.name ?? "Operatory Chair",
    };
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

    const featureFlags = appt.clinic.featureFlags as Record<string, unknown> | null;
    return {
      ...updated,
      waitlistEnabled: Boolean(featureFlags?.waitlistAutomationEnabled),
    };
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

    const rescheduled = await this.appointmentsService.rescheduleAppointment(
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

    const dentist = await this.prisma.dentist.findUnique({
      where: { id: rescheduled.dentistId },
      select: { displayName: true },
    });

    return {
      ...rescheduled,
      dentistName: dentist?.displayName ?? "",
    };
  }

  async joinWaitlist(user: User, dto: JoinWaitlistDto) {
    const clinic = dto.clinicId
      ? await this.prisma.clinic.findUnique({ where: { id: dto.clinicId } })
      : await this.prisma.clinic.findUnique({
          where: { slug: dto.clinicSlug!.trim().toLowerCase() },
        });
    if (!clinic) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Clinic not found.",
        HttpStatus.NOT_FOUND
      );
    }

    assertClinicFeature(clinic, "waitlistAutomationEnabled");

    const [service, preferredDentist] = await Promise.all([
      this.prisma.service.findFirst({
        where: { id: dto.serviceId, clinicId: clinic.id, isActive: true },
        select: { id: true },
      }),
      dto.preferredDentistId
        ? this.prisma.dentist.findFirst({
            where: { id: dto.preferredDentistId, clinicId: clinic.id, isActive: true },
            select: { id: true },
          })
        : Promise.resolve(null),
    ]);
    if (!service) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Dental service not found in this clinic.",
        HttpStatus.NOT_FOUND
      );
    }
    if (dto.preferredDentistId && !preferredDentist) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Preferred dentist not found in this clinic.",
        HttpStatus.NOT_FOUND
      );
    }

    let patient;
    if (dto.patientId) {
      patient = await this.assertPatientOwnedByUser(user.id, dto.patientId);
      if (patient.clinicId !== clinic.id) {
        throw new DomainException(
          API_ERROR_CODES.FORBIDDEN,
          "Patient profile does not belong to this clinic.",
          HttpStatus.FORBIDDEN
        );
      }
    } else {
      patient = await this.prisma.patient.findFirst({
        where: { clinicId: clinic.id, userId: user.id, guardianPatientId: null },
      });
      if (!patient) {
        patient = await this.prisma.patient.create({
          data: {
            clinicId: clinic.id,
            userId: user.id,
            firstName: user.firstName || "Patient",
            lastName: user.lastName || "",
            dateOfBirth: "1990-01-01",
            sex: "other",
            phone: user.phone || "0000000000",
            email: user.email,
            medicalHistory: {
              allergies: [],
              conditions: [],
              isTakingBloodThinners: false,
              isPregnant: false,
              dentalAnxietyLevel: "none",
            } as unknown as Prisma.InputJsonValue,
          },
        });
      }
    }

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
      include: {
        clinic: true,
        patient: { select: { firstName: true, lastName: true } },
        service: { select: { name: true, pricePhp: true } },
      },
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

    const resolvedDateKey =
      dto.dateKey ??
      this.appointmentsService.getDateKeyForClinic(
        dto.startTimeUtc,
        entry.clinic.timezone || "Asia/Manila"
      );

    const appointment = await this.appointmentsService.bookSlotAtomically({
      clinic: entry.clinic,
      patientId: entry.patientId,
      serviceId: entry.serviceId,
      dentistId: dto.dentistId,
      chairId: dto.chairId,
      dateKey: resolvedDateKey,
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

    const [dentist, chair] = await Promise.all([
      this.prisma.dentist.findUnique({
        where: { id: appointment.dentistId },
        select: { displayName: true },
      }),
      this.prisma.chair.findUnique({
        where: { id: appointment.chairId },
        select: { name: true },
      }),
    ]);

    return {
      ...appointment,
      appointmentId: appointment.id,
      referenceCode: `SM-${appointment.id.slice(0, 8).toUpperCase()}`,
      patientName: `${entry.patient.firstName} ${entry.patient.lastName}`.trim(),
      clinicName: entry.clinic.name,
      clinicAddress: entry.clinic.address,
      clinicPhone: entry.clinic.phone,
      cancellationWindowHours: entry.clinic.cancellationWindowHours,
      serviceName: entry.service.name,
      pricePhp: entry.service.pricePhp,
      dentistName: dentist?.displayName ?? "",
      chairName: chair?.name ?? "",
      startTimeUtc: appointment.startTimeUtc.getTime(),
      endTimeUtc: appointment.endTimeUtc.getTime(),
    };
  }
}
