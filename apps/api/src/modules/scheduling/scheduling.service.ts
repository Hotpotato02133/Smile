import { HttpStatus, Injectable } from "@nestjs/common";
import type { Clinic, Prisma, Service } from "@prisma/client";
import {
  API_ERROR_CODES,
  type AvailableSlotDto,
  evaluateClinicBookingEligibility,
  getDayOfWeekFromDateKey,
  getEmergencyBufferWindow,
  getLocalDateKeyAndMinute,
  intervalsOverlap,
  localDateMinuteToUtc,
  type OperatingHoursDay,
  parseDateKey,
  type WeeklyScheduleDay,
} from "@smile/shared";
import { DomainException } from "../../common/exceptions/domain.exception";
import { PrismaService } from "../../infra/prisma.service";
import { RealtimeGateway } from "../realtime/realtime.gateway";
import { SlotLockService } from "./slot-lock.service";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

@Injectable()
export class SchedulingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly slotLockService: SlotLockService,
    private readonly realtime: RealtimeGateway
  ) {}

  private async resolveClinicBySlugOrId(identifier: string): Promise<Clinic | null> {
    const clean = identifier.trim();
    if (!clean) return null;
    if (UUID_RE.test(clean)) {
      return this.prisma.clinic.findUnique({ where: { id: clean } });
    }
    return this.prisma.clinic.findUnique({ where: { slug: clean.toLowerCase() } });
  }

  async computeAvailableSlots(params: {
    clinic: Clinic;
    service: Service;
    dateKey: string;
    preferredDentistId?: string;
    ignoreSessionId?: string;
    ignoreAppointmentId?: string;
    includeEmergencyBuffer?: boolean;
    tx?: Prisma.TransactionClient;
  }): Promise<AvailableSlotDto[]> {
    const {
      clinic,
      service,
      dateKey,
      preferredDentistId,
      ignoreSessionId,
      ignoreAppointmentId,
      includeEmergencyBuffer = false,
      tx,
    } = params;
    const db = tx ?? this.prisma;
    const nowMs = Date.now();

    if (!parseDateKey(dateKey)) return [];
    const eligibility = evaluateClinicBookingEligibility(
      {
        status: clinic.status,
        subscriptionEndsAt: clinic.subscriptionEndsAt.getTime(),
        gracePeriodEndsAt: clinic.gracePeriodEndsAt?.getTime() ?? null,
      },
      nowMs
    );
    if (!eligibility.isBookable) return [];
    if (!service.isActive || service.clinicId !== clinic.id) return [];

    const dayOfWeek = getDayOfWeekFromDateKey(dateKey);
    const operatingHours = clinic.operatingHours as unknown as OperatingHoursDay[];
    const clinicDay = operatingHours.find((h) => h.dayOfWeek === dayOfWeek);
    if (!clinicDay || !clinicDay.isOpen) return [];

    const emergencyWindow = getEmergencyBufferWindow(
      clinicDay,
      clinic.emergencyBufferMinutesPerDay
    );

    const durationMinutes = service.durationMinutes;
    const totalBlockMinutes = durationMinutes + service.bufferMinutes;
    const slotInterval =
      clinic.slotIntervalMinutes > 0 ? clinic.slotIntervalMinutes : 30;
    const timeZone = clinic.timezone || "Asia/Manila";

    const dayStartUtc = localDateMinuteToUtc(dateKey, 0, timeZone);
    const dayEndUtc = localDateMinuteToUtc(dateKey, 1439, timeZone) + 60_000;

    const [activeDentists, activeChairs, dayAppointments, activeLocks, clinicTimeOff] =
      await Promise.all([
        db.dentist.findMany({
          where: { clinicId: clinic.id, isActive: true },
        }),
        db.chair.findMany({
          where: { clinicId: clinic.id, isActive: true },
        }),
        db.appointment.findMany({
          where: {
            clinicId: clinic.id,
            dateKey,
            status: { notIn: ["cancelled", "no_show"] },
          },
        }),
        this.slotLockService.listActiveLocks(clinic.id, dateKey, nowMs),
        db.dentistTimeOff.findMany({
          where: {
            clinicId: clinic.id,
            startTimeUtc: { lt: new Date(dayEndUtc) },
            endTimeUtc: { gt: new Date(dayStartUtc) },
          },
        }),
      ]);

    const eligibleDentists = activeDentists.filter((d) => {
      if (preferredDentistId && d.id !== preferredDentistId) return false;
      const schedule = d.weeklySchedule as unknown as WeeklyScheduleDay[];
      const shift = schedule.find((w) => w.dayOfWeek === dayOfWeek);
      return Boolean(shift && shift.isWorking);
    });

    const requiredTag = service.requiredChairTag?.trim().toLowerCase();
    const eligibleChairs = activeChairs.filter((c) => {
      if (!requiredTag) return true;
      return c.supportedCategoryTags.some(
        (tag) => tag.trim().toLowerCase() === requiredTag
      );
    });

    if (eligibleDentists.length === 0 || eligibleChairs.length === 0) {
      return [];
    }

    const blockingAppointments = dayAppointments.filter(
      (a) => !ignoreAppointmentId || a.id !== ignoreAppointmentId
    );
    const blockingLocks = activeLocks.filter(
      (l) => !ignoreSessionId || l.lockedBySessionId !== ignoreSessionId
    );

    const minBookableUtc = includeEmergencyBuffer
      ? nowMs - 5 * 60 * 1000
      : nowMs + 15 * 60 * 1000;
    const slots: AvailableSlotDto[] = [];

    for (
      let candidateMinute = clinicDay.openMinute;
      candidateMinute + durationMinutes <= clinicDay.closeMinute;
      candidateMinute += slotInterval
    ) {
      const slotEndMinute = candidateMinute + durationMinutes;
      const isEmergencyBufferSlot = Boolean(
        emergencyWindow &&
          intervalsOverlap(
            candidateMinute,
            slotEndMinute,
            emergencyWindow.startMinute,
            emergencyWindow.endMinute
          )
      );
      if (isEmergencyBufferSlot && !includeEmergencyBuffer) {
        continue;
      }

      const slotStartUtc = localDateMinuteToUtc(dateKey, candidateMinute, timeZone);
      if (slotStartUtc < minBookableUtc) continue;

      const slotEndUtc = slotStartUtc + durationMinutes * 60_000;
      const slotBufferEndUtc = slotStartUtc + totalBlockMinutes * 60_000;

      let assignedPair: {
        dentist: (typeof eligibleDentists)[number];
        chair: (typeof eligibleChairs)[number];
      } | null = null;

      for (const dentist of eligibleDentists) {
        const schedule = dentist.weeklySchedule as unknown as WeeklyScheduleDay[];
        const shift = schedule.find((w) => w.dayOfWeek === dayOfWeek);
        if (!shift || !shift.isWorking) continue;

        if (candidateMinute < shift.startMinute || slotEndMinute > shift.endMinute) {
          continue;
        }

        if (
          shift.breakStartMinute !== undefined &&
          shift.breakEndMinute !== undefined &&
          intervalsOverlap(
            candidateMinute,
            slotEndMinute,
            shift.breakStartMinute,
            shift.breakEndMinute
          )
        ) {
          continue;
        }

        const hasTimeOff = clinicTimeOff.some(
          (t) =>
            t.dentistId === dentist.id &&
            intervalsOverlap(
              slotStartUtc,
              slotEndUtc,
              t.startTimeUtc.getTime(),
              t.endTimeUtc.getTime()
            )
        );
        if (hasTimeOff) continue;

        const dentistBusy =
          blockingAppointments.some(
            (a) =>
              a.dentistId === dentist.id &&
              intervalsOverlap(
                a.startTimeUtc.getTime(),
                a.bufferEndTimeUtc.getTime(),
                slotStartUtc,
                slotBufferEndUtc
              )
          ) ||
          blockingLocks.some(
            (l) =>
              l.dentistId === dentist.id &&
              intervalsOverlap(
                l.startTimeUtc,
                l.bufferEndTimeUtc,
                slotStartUtc,
                slotBufferEndUtc
              )
          );
        if (dentistBusy) continue;

        const orderedChairs = dentist.defaultChairId
          ? [
              ...eligibleChairs.filter((c) => c.id === dentist.defaultChairId),
              ...eligibleChairs.filter((c) => c.id !== dentist.defaultChairId),
            ]
          : eligibleChairs;

        const freeChair = orderedChairs.find((chair) => {
          const chairBusy =
            blockingAppointments.some(
              (a) =>
                a.chairId === chair.id &&
                intervalsOverlap(
                  a.startTimeUtc.getTime(),
                  a.bufferEndTimeUtc.getTime(),
                  slotStartUtc,
                  slotBufferEndUtc
                )
            ) ||
            blockingLocks.some(
              (l) =>
                l.chairId === chair.id &&
                intervalsOverlap(
                  l.startTimeUtc,
                  l.bufferEndTimeUtc,
                  slotStartUtc,
                  slotBufferEndUtc
                )
            );
          return !chairBusy;
        });

        if (freeChair) {
          assignedPair = { dentist, chair: freeChair };
          break;
        }
      }

      if (assignedPair) {
        slots.push({
          startTimeUtc: slotStartUtc,
          endTimeUtc: slotEndUtc,
          bufferEndTimeUtc: slotBufferEndUtc,
          startMinute: candidateMinute,
          endMinute: slotEndMinute,
          dentistId: assignedPair.dentist.id,
          dentistName: assignedPair.dentist.displayName,
          chairId: assignedPair.chair.id,
          chairName: assignedPair.chair.name,
          isEmergencyBufferSlot,
        });
      }
    }

    return slots;
  }

  async verifySpecificPairAvailable(params: {
    clinic: Clinic;
    service: Service;
    dateKey: string;
    dentistId: string;
    chairId: string;
    startTimeUtc: number;
    ignoreSessionId?: string;
    ignoreAppointmentId?: string;
    enforceScheduleRules?: boolean;
    allowEmergencyBuffer?: boolean;
    minLeadMinutes?: number;
    tx?: Prisma.TransactionClient;
  }): Promise<{
    ok: boolean;
    reason?: string;
    endTimeUtc: number;
    bufferEndTimeUtc: number;
  }> {
    const {
      clinic,
      service,
      dateKey,
      dentistId,
      chairId,
      startTimeUtc,
      ignoreSessionId,
      ignoreAppointmentId,
      enforceScheduleRules = false,
      allowEmergencyBuffer = false,
      minLeadMinutes = 0,
      tx,
    } = params;
    const db = tx ?? this.prisma;

    const endTimeUtc = startTimeUtc + service.durationMinutes * 60_000;
    const bufferEndTimeUtc =
      startTimeUtc + (service.durationMinutes + service.bufferMinutes) * 60_000;
    const nowMs = Date.now();

    if (enforceScheduleRules) {
      if (!parseDateKey(dateKey)) {
        return {
          ok: false,
          reason: "Invalid appointment date.",
          endTimeUtc,
          bufferEndTimeUtc,
        };
      }
      if (startTimeUtc < nowMs + minLeadMinutes * 60_000) {
        return {
          ok: false,
          reason: "Selected time slot is in the past. Please choose an upcoming time.",
          endTimeUtc,
          bufferEndTimeUtc,
        };
      }
      const timeZone = clinic.timezone || "Asia/Manila";
      const local = getLocalDateKeyAndMinute(startTimeUtc, timeZone);
      if (local.dateKey !== dateKey) {
        return {
          ok: false,
          reason: "Selected time does not match the chosen appointment date.",
          endTimeUtc,
          bufferEndTimeUtc,
        };
      }
      const dayOfWeek = getDayOfWeekFromDateKey(dateKey);
      const operatingHours = clinic.operatingHours as unknown as OperatingHoursDay[];
      const clinicDay = operatingHours.find((h) => h.dayOfWeek === dayOfWeek);
      if (
        !clinicDay ||
        !clinicDay.isOpen ||
        local.minuteOfDay < clinicDay.openMinute ||
        local.minuteOfDay + service.durationMinutes > clinicDay.closeMinute
      ) {
        return {
          ok: false,
          reason: "Selected time is outside this clinic's operating hours.",
          endTimeUtc,
          bufferEndTimeUtc,
        };
      }
      if (!allowEmergencyBuffer) {
        const emergencyWindow = getEmergencyBufferWindow(
          clinicDay,
          clinic.emergencyBufferMinutesPerDay
        );
        if (
          emergencyWindow &&
          intervalsOverlap(
            local.minuteOfDay,
            local.minuteOfDay + service.durationMinutes,
            emergencyWindow.startMinute,
            emergencyWindow.endMinute
          )
        ) {
          return {
            ok: false,
            reason:
              "This time block is reserved for the clinic's daily emergency walk-in buffer.",
            endTimeUtc,
            bufferEndTimeUtc,
          };
        }
      }
    }

    const [dentist, chair, overlappingAppts, activeLocks, timeOffRows] =
      await Promise.all([
        db.dentist.findUnique({ where: { id: dentistId } }),
        db.chair.findUnique({ where: { id: chairId } }),
        db.appointment.findMany({
          where: {
            clinicId: clinic.id,
            status: { notIn: ["cancelled", "no_show"] },
            ...(ignoreAppointmentId ? { id: { not: ignoreAppointmentId } } : {}),
            OR: [{ dentistId }, { chairId }],
            startTimeUtc: { lt: new Date(bufferEndTimeUtc) },
            bufferEndTimeUtc: { gt: new Date(startTimeUtc) },
          },
          take: 1,
        }),
        this.slotLockService.listActiveLocks(clinic.id, dateKey, nowMs),
        db.dentistTimeOff.findMany({
          where: {
            clinicId: clinic.id,
            dentistId,
            startTimeUtc: { lt: new Date(endTimeUtc) },
            endTimeUtc: { gt: new Date(startTimeUtc) },
          },
          take: 1,
        }),
      ]);

    if (!dentist || dentist.clinicId !== clinic.id || !dentist.isActive) {
      return {
        ok: false,
        reason: "Selected dentist is unavailable.",
        endTimeUtc,
        bufferEndTimeUtc,
      };
    }
    if (!chair || chair.clinicId !== clinic.id || !chair.isActive) {
      return {
        ok: false,
        reason: "Selected operatory chair is unavailable.",
        endTimeUtc,
        bufferEndTimeUtc,
      };
    }

    if (enforceScheduleRules) {
      const timeZone = clinic.timezone || "Asia/Manila";
      const local = getLocalDateKeyAndMinute(startTimeUtc, timeZone);
      const dayOfWeek = getDayOfWeekFromDateKey(dateKey);
      const schedule = dentist.weeklySchedule as unknown as WeeklyScheduleDay[];
      const shift = schedule.find((w) => w.dayOfWeek === dayOfWeek);
      const slotEndMinute = local.minuteOfDay + service.durationMinutes;
      if (
        !shift ||
        !shift.isWorking ||
        local.minuteOfDay < shift.startMinute ||
        slotEndMinute > shift.endMinute
      ) {
        return {
          ok: false,
          reason: "Selected dentist is not scheduled to work during this time.",
          endTimeUtc,
          bufferEndTimeUtc,
        };
      }
      if (
        shift.breakStartMinute !== undefined &&
        shift.breakEndMinute !== undefined &&
        intervalsOverlap(
          local.minuteOfDay,
          slotEndMinute,
          shift.breakStartMinute,
          shift.breakEndMinute
        )
      ) {
        return {
          ok: false,
          reason: "Selected time overlaps the dentist's scheduled break.",
          endTimeUtc,
          bufferEndTimeUtc,
        };
      }
    }

    const requiredTag = service.requiredChairTag?.trim().toLowerCase();
    if (
      requiredTag &&
      !chair.supportedCategoryTags.some(
        (t) => t.trim().toLowerCase() === requiredTag
      )
    ) {
      return {
        ok: false,
        reason: "Selected operatory chair is not equipped for this procedure.",
        endTimeUtc,
        bufferEndTimeUtc,
      };
    }

    if (timeOffRows.length > 0) {
      return {
        ok: false,
        reason: "The dentist is on scheduled leave during this time.",
        endTimeUtc,
        bufferEndTimeUtc,
      };
    }

    if (overlappingAppts.length > 0) {
      return {
        ok: false,
        reason:
          "This time slot was just booked by another patient. Please pick another slot.",
        endTimeUtc,
        bufferEndTimeUtc,
      };
    }

    const conflictingLock = activeLocks.find(
      (l) =>
        (!ignoreSessionId || l.lockedBySessionId !== ignoreSessionId) &&
        (l.dentistId === dentistId || l.chairId === chairId) &&
        intervalsOverlap(
          l.startTimeUtc,
          l.bufferEndTimeUtc,
          startTimeUtc,
          bufferEndTimeUtc
        )
    );
    if (conflictingLock) {
      return {
        ok: false,
        reason:
          "This time slot is temporarily held by another patient. Please choose another time.",
        endTimeUtc,
        bufferEndTimeUtc,
      };
    }

    return { ok: true, endTimeUtc, bufferEndTimeUtc };
  }

  async getPublicAvailableSlots(params: {
    slug: string;
    serviceId: string;
    dateKey: string;
    preferredDentistId?: string;
    sessionId?: string;
    ignoreAppointmentId?: string;
    includeEmergencyBuffer?: boolean;
  }) {
    const clinic = await this.resolveClinicBySlugOrId(params.slug);
    if (!clinic) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Clinic not found.",
        HttpStatus.NOT_FOUND
      );
    }

    const service = await this.prisma.service.findFirst({
      where: { id: params.serviceId, clinicId: clinic.id, isActive: true },
    });
    if (!service) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Dental service not found.",
        HttpStatus.NOT_FOUND
      );
    }

    return this.computeAvailableSlots({
      clinic,
      service,
      dateKey: params.dateKey,
      preferredDentistId: params.preferredDentistId,
      ignoreSessionId: params.sessionId,
      ignoreAppointmentId: params.ignoreAppointmentId,
      includeEmergencyBuffer: Boolean(params.includeEmergencyBuffer),
    });
  }

  async acquirePublicSlotLock(params: {
    slug: string;
    serviceId: string;
    dateKey: string;
    startTimeUtc: number;
    dentistId?: string;
    chairId?: string;
    sessionId: string;
  }) {
    const sessionId = params.sessionId.trim();
    const clinic = await this.resolveClinicBySlugOrId(params.slug);
    if (!clinic) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Clinic not found.",
        HttpStatus.NOT_FOUND
      );
    }

    const service = await this.prisma.service.findFirst({
      where: { id: params.serviceId, clinicId: clinic.id, isActive: true },
    });
    if (!service) {
      throw new DomainException(
        API_ERROR_CODES.NOT_FOUND,
        "Dental service not found.",
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
    if (!eligibility.isBookable) {
      throw new DomainException(
        API_ERROR_CODES.CLINIC_READ_ONLY,
        eligibility.reason ?? "Online booking is currently unavailable.",
        HttpStatus.FORBIDDEN
      );
    }

    let chosenDentistId = params.dentistId;
    let chosenChairId = params.chairId;
    let endTimeUtc = params.startTimeUtc + service.durationMinutes * 60_000;
    let bufferEndTimeUtc =
      params.startTimeUtc +
      (service.durationMinutes + service.bufferMinutes) * 60_000;

    if (chosenDentistId && chosenChairId) {
      const check = await this.verifySpecificPairAvailable({
        clinic,
        service,
        dateKey: params.dateKey,
        dentistId: chosenDentistId,
        chairId: chosenChairId,
        startTimeUtc: params.startTimeUtc,
        ignoreSessionId: sessionId,
        enforceScheduleRules: true,
        minLeadMinutes: 15,
      });
      if (!check.ok) {
        const fallback = await this.computeAvailableSlots({
          clinic,
          service,
          dateKey: params.dateKey,
          preferredDentistId: params.dentistId,
          ignoreSessionId: sessionId,
        });
        const match = fallback.find((s) => s.startTimeUtc === params.startTimeUtc);
        if (!match) {
          throw new DomainException(
            API_ERROR_CODES.SLOT_UNAVAILABLE,
            check.reason ??
              "This time slot is no longer available. Please select another slot.",
            HttpStatus.CONFLICT
          );
        }
        chosenDentistId = match.dentistId;
        chosenChairId = match.chairId;
        endTimeUtc = match.endTimeUtc;
        bufferEndTimeUtc = match.bufferEndTimeUtc;
      } else {
        endTimeUtc = check.endTimeUtc;
        bufferEndTimeUtc = check.bufferEndTimeUtc;
      }
    } else {
      const available = await this.computeAvailableSlots({
        clinic,
        service,
        dateKey: params.dateKey,
        preferredDentistId: params.dentistId,
        ignoreSessionId: sessionId,
      });
      const match = available.find((s) => s.startTimeUtc === params.startTimeUtc);
      if (!match) {
        throw new DomainException(
          API_ERROR_CODES.SLOT_UNAVAILABLE,
          "This time slot is no longer available. Please select another slot.",
          HttpStatus.CONFLICT
        );
      }
      chosenDentistId = match.dentistId;
      chosenChairId = match.chairId;
      endTimeUtc = match.endTimeUtc;
      bufferEndTimeUtc = match.bufferEndTimeUtc;
    }

    const acquired = await this.slotLockService.acquireAtomicIntervalLock({
      clinicId: clinic.id,
      dateKey: params.dateKey,
      dentistId: chosenDentistId,
      chairId: chosenChairId,
      startTimeUtc: params.startTimeUtc,
      bufferEndTimeUtc,
      sessionId,
      nowMs,
    });

    if (!acquired.ok) {
      throw new DomainException(
        API_ERROR_CODES.SLOT_UNAVAILABLE,
        "This time slot was just held by another patient. Please pick another slot.",
        HttpStatus.CONFLICT
      );
    }

    const [dentist, chair] = await Promise.all([
      this.prisma.dentist.findUnique({ where: { id: chosenDentistId } }),
      this.prisma.chair.findUnique({ where: { id: chosenChairId } }),
    ]);

    this.realtime.emitSlotLockChanged({
      clinicId: clinic.id,
      clinicSlug: clinic.slug,
      dateKey: params.dateKey,
    });

    return {
      lockId: acquired.lock.lockId,
      dentistId: chosenDentistId,
      dentistName: dentist?.displayName ?? "Assigned Dentist",
      chairId: chosenChairId,
      chairName: chair?.name ?? "Operatory Chair",
      startTimeUtc: params.startTimeUtc,
      endTimeUtc,
      bufferEndTimeUtc,
      expiresAtUtc: acquired.lock.expiresAtUtc,
      serverNowUtc: nowMs,
    };
  }

  async releasePublicSessionLock(
    slug: string,
    dateKey: string,
    sessionId: string
  ) {
    const clinic = await this.resolveClinicBySlugOrId(slug);
    if (!clinic) {
      return { released: 0 };
    }
    const released = await this.slotLockService.releaseSessionLocks(
      clinic.id,
      dateKey,
      sessionId
    );
    if (released > 0) {
      this.realtime.emitSlotLockChanged({
        clinicId: clinic.id,
        clinicSlug: clinic.slug,
        dateKey,
      });
    }
    return { released };
  }
}
