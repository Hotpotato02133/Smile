import type { Doc, Id } from "../_generated/dataModel";
import type { MutationCtx, QueryCtx } from "../_generated/server";
import { GRACE_PERIOD_MS } from "./audit";

type Ctx = QueryCtx | MutationCtx;

export const SLOT_LOCK_DURATION_MS = 5 * 60 * 1000; // 5 minutes

export type AvailableSlot = {
  startTimeUtc: number;
  endTimeUtc: number;
  bufferEndTimeUtc: number;
  startMinute: number;
  endMinute: number;
  dentistId: Id<"dentists">;
  dentistName: string;
  chairId: Id<"chairs">;
  chairName: string;
  isEmergencyBufferSlot: boolean;
};

/**
 * Computes the daily emergency buffer block `[startMinute, endMinute)` reserved
 * at the end of the clinic's open hours for walk-in / emergency triage.
 */
export function getEmergencyBufferWindow(
  clinicDay: { isOpen: boolean; openMinute: number; closeMinute: number } | undefined,
  emergencyBufferMinutesPerDay: number
): { startMinute: number; endMinute: number } | null {
  if (!clinicDay || !clinicDay.isOpen) return null;
  const mins = Math.max(0, Math.round(emergencyBufferMinutesPerDay));
  if (mins <= 0) return null;
  const startMinute = Math.max(clinicDay.openMinute, clinicDay.closeMinute - mins);
  if (startMinute >= clinicDay.closeMinute) return null;
  return { startMinute, endMinute: clinicDay.closeMinute };
}

/** Checks whether two half-open intervals [aStart, aEnd) and [bStart, bEnd) overlap. */
export function intervalsOverlap(
  aStart: number,
  aEnd: number,
  bStart: number,
  bEnd: number
): boolean {
  return aStart < bEnd && aEnd > bStart;
}

/** Parses `"YYYY-MM-DD"` into `{ year, month, day }`, or returns null if invalid. */
export function parseDateKey(
  dateKey: string
): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const probe = new Date(Date.UTC(year, month - 1, day));
  if (
    probe.getUTCFullYear() !== year ||
    probe.getUTCMonth() !== month - 1 ||
    probe.getUTCDate() !== day
  ) {
    return null;
  }
  return { year, month, day };
}

/** Returns 0 (Sun) to 6 (Sat) for a calendar `"YYYY-MM-DD"` dateKey. */
export function getDayOfWeekFromDateKey(dateKey: string): number {
  const parsed = parseDateKey(dateKey);
  if (!parsed) return 0;
  return new Date(Date.UTC(parsed.year, parsed.month - 1, parsed.day)).getUTCDay();
}

/**
 * Computes the UTC offset in milliseconds of `timeZone` at a given UTC epoch ms.
 * Uses standard `Intl.DateTimeFormat` so it runs cleanly in Convex V8 with any IANA zone.
 */
function getTimeZoneOffsetMs(utcMs: number, timeZone: string): number {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    const parts = formatter.formatToParts(new Date(utcMs));
    const lookup = (type: string) =>
      Number(parts.find((p) => p.type === type)?.value ?? 0);
    const hour = lookup("hour") === 24 ? 0 : lookup("hour");
    const asUtc = Date.UTC(
      lookup("year"),
      lookup("month") - 1,
      lookup("day"),
      hour,
      lookup("minute"),
      lookup("second")
    );
    return asUtc - utcMs;
  } catch {
    // Fallback to Asia/Manila (UTC+8) if an invalid timezone string is stored
    return 8 * 60 * 60 * 1000;
  }
}

/** Converts `(dateKey "YYYY-MM-DD", minuteOfDay 0..1439)` in `timeZone` to UTC epoch ms. */
export function localDateMinuteToUtc(
  dateKey: string,
  minuteOfDay: number,
  timeZone: string
): number {
  const parsed = parseDateKey(dateKey);
  if (!parsed) {
    throw new Error(`Invalid dateKey: ${dateKey}`);
  }
  const hours = Math.floor(minuteOfDay / 60);
  const mins = minuteOfDay % 60;
  const wallAsUtc = Date.UTC(
    parsed.year,
    parsed.month - 1,
    parsed.day,
    hours,
    mins,
    0,
    0
  );
  // Two-pass offset lookup handles DST transitions cleanly
  const offset1 = getTimeZoneOffsetMs(wallAsUtc, timeZone);
  const guess = wallAsUtc - offset1;
  const offset2 = getTimeZoneOffsetMs(guess, timeZone);
  return wallAsUtc - offset2;
}

/** Converts a UTC epoch ms timestamp into local `{ dateKey, minuteOfDay }` in `timeZone`. */
export function getLocalDateKeyAndMinute(
  utcMs: number,
  timeZone: string
): { dateKey: string; minuteOfDay: number } {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
    });
    const parts = formatter.formatToParts(new Date(utcMs));
    const lookup = (type: string) =>
      Number(parts.find((p) => p.type === type)?.value ?? 0);
    const year = lookup("year");
    const month = String(lookup("month")).padStart(2, "0");
    const day = String(lookup("day")).padStart(2, "0");
    const hour = lookup("hour") === 24 ? 0 : lookup("hour");
    const minute = lookup("minute");
    return {
      dateKey: `${year}-${month}-${day}`,
      minuteOfDay: hour * 60 + minute,
    };
  } catch {
    const d = new Date(utcMs + 8 * 60 * 60 * 1000);
    const year = d.getUTCFullYear();
    const month = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    return {
      dateKey: `${year}-${month}-${day}`,
      minuteOfDay: d.getUTCHours() * 60 + d.getUTCMinutes(),
    };
  }
}

/** Classifies a clinic-local minute of day (0..1439) into morning (<12:00) or afternoon (>=12:00). */
export function classifyTimeWindow(minuteOfDay: number): "morning" | "afternoon" {
  return minuteOfDay < 12 * 60 ? "morning" : "afternoon";
}

/** Checks whether a clinic is currently allowed to accept new online bookings (Law #4). */
export function getClinicBookingEligibility(
  clinic: Doc<"clinics">,
  now: number
): { isBookable: boolean; reason: string | null } {
  if (clinic.status === "suspended" || clinic.status === "archived") {
    return {
      isBookable: false,
      reason: "This clinic is currently not accepting online bookings.",
    };
  }
  if (
    (clinic.status === "trial" || clinic.status === "active") &&
    now > clinic.subscriptionEndsAt
  ) {
    return {
      isBookable: false,
      reason: "This clinic's booking portal is temporarily unavailable.",
    };
  }
  if (clinic.status === "past_due") {
    const graceEnd =
      clinic.gracePeriodEndsAt ?? clinic.subscriptionEndsAt + GRACE_PERIOD_MS;
    if (now > graceEnd) {
      return {
        isBookable: false,
        reason: "This clinic is currently not accepting online bookings.",
      };
    }
  }
  return { isBookable: true, reason: null };
}

/**
 * Dual-resource dental slot calculation engine (Dentist + Operatory Chair + Sterilization Buffer).
 * Uses strictly indexed queries (`by_clinic`, `by_clinic_and_date`, `by_clinic_and_expires`, `by_clinic_and_time`).
 */
export async function computeAvailableSlots(
  ctx: Ctx,
  params: {
    clinic: Doc<"clinics">;
    service: Doc<"services">;
    dateKey: string;
    preferredDentistId?: Id<"dentists">;
    ignoreSessionId?: string;
    ignoreAppointmentId?: Id<"appointments">;
    includeEmergencyBuffer?: boolean;
  }
): Promise<AvailableSlot[]> {
  const {
    clinic,
    service,
    dateKey,
    preferredDentistId,
    ignoreSessionId,
    ignoreAppointmentId,
    includeEmergencyBuffer = false,
  } = params;
  const now = Date.now();

  if (!parseDateKey(dateKey)) return [];
  if (!getClinicBookingEligibility(clinic, now).isBookable) return [];
  if (!service.isActive || service.clinicId !== clinic._id) return [];

  const dayOfWeek = getDayOfWeekFromDateKey(dateKey);
  const clinicDay = clinic.operatingHours.find((h) => h.dayOfWeek === dayOfWeek);
  if (!clinicDay || !clinicDay.isOpen) return [];

  const emergencyWindow = getEmergencyBufferWindow(
    clinicDay,
    clinic.emergencyBufferMinutesPerDay
  );

  const durationMinutes = service.durationMinutes;
  const totalBlockMinutes = durationMinutes + service.bufferMinutes;
  const slotInterval = clinic.slotIntervalMinutes > 0 ? clinic.slotIntervalMinutes : 30;
  const timeZone = clinic.timezone || "Asia/Manila";

  const dayStartUtc = localDateMinuteToUtc(dateKey, 0, timeZone);
  const dayEndUtc = localDateMinuteToUtc(dateKey, 1439, timeZone) + 60_000;

  // Fetch all clinic resources & existing commitments in parallel via compound clinicId indexes
  const [activeDentists, activeChairs, dayAppointments, activeLocks, clinicTimeOff] =
    await Promise.all([
      ctx.db
        .query("dentists")
        .withIndex("by_clinic", (q) =>
          q.eq("clinicId", clinic._id).eq("isActive", true)
        )
        .collect(),
      ctx.db
        .query("chairs")
        .withIndex("by_clinic", (q) =>
          q.eq("clinicId", clinic._id).eq("isActive", true)
        )
        .collect(),
      ctx.db
        .query("appointments")
        .withIndex("by_clinic_and_date", (q) =>
          q.eq("clinicId", clinic._id).eq("dateKey", dateKey)
        )
        .collect(),
      ctx.db
        .query("slotLocks")
        .withIndex("by_clinic_and_expires", (q) =>
          q.eq("clinicId", clinic._id).gt("expiresAtUtc", now)
        )
        .collect(),
      ctx.db
        .query("dentistTimeOff")
        .withIndex("by_clinic_and_time", (q) =>
          q
            .eq("clinicId", clinic._id)
            .gte("startTimeUtc", dayStartUtc - 365 * 24 * 60 * 60 * 1000)
            .lte("startTimeUtc", dayEndUtc)
        )
        .order("desc")
        .take(250),
    ]);

  // Filter eligible dentists working on this dayOfWeek
  const eligibleDentists = activeDentists.filter((d) => {
    if (preferredDentistId && d._id !== preferredDentistId) return false;
    const shift = d.weeklySchedule.find((w) => w.dayOfWeek === dayOfWeek);
    return Boolean(shift && shift.isWorking);
  });

  // Filter eligible chairs supporting service.requiredChairTag (or all active chairs if unset)
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

  // Active commitments (excluding cancelled appointments and caller's own session lock)
  const blockingAppointments = dayAppointments.filter(
    (a) =>
      a.status !== "cancelled" &&
      a.status !== "no_show" &&
      a._id !== ignoreAppointmentId
  );
  const blockingLocks = activeLocks.filter(
    (l) => !ignoreSessionId || l.lockedBySessionId !== ignoreSessionId
  );
  const overlappingDayTimeOff = clinicTimeOff.filter(
    (t) => t.endTimeUtc > dayStartUtc && t.startTimeUtc < dayEndUtc
  );

  // Small lead time for online self-service; staff walk-in lookup includes immediate slots
  const minBookableUtc = includeEmergencyBuffer
    ? now - 5 * 60 * 1000
    : now + 15 * 60 * 1000;
  const slots: AvailableSlot[] = [];

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

    let assignedPair: { dentist: Doc<"dentists">; chair: Doc<"chairs"> } | null =
      null;

    for (const dentist of eligibleDentists) {
      const shift = dentist.weeklySchedule.find((w) => w.dayOfWeek === dayOfWeek);
      if (!shift || !shift.isWorking) continue;

      // Must fit inside dentist's shift
      if (candidateMinute < shift.startMinute || slotEndMinute > shift.endMinute) {
        continue;
      }

      // Must not overlap dentist's lunch break
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

      // Must not overlap dentist time-off
      const hasTimeOff = overlappingDayTimeOff.some(
        (t) =>
          t.dentistId === dentist._id &&
          intervalsOverlap(slotStartUtc, slotEndUtc, t.startTimeUtc, t.endTimeUtc)
      );
      if (hasTimeOff) continue;

      // Dentist must have zero overlapping appointments or active locks (including buffer)
      const dentistBusy =
        blockingAppointments.some(
          (a) =>
            a.dentistId === dentist._id &&
            intervalsOverlap(
              a.startTimeUtc,
              a.bufferEndTimeUtc,
              slotStartUtc,
              slotBufferEndUtc
            )
        ) ||
        blockingLocks.some(
          (l) =>
            l.dentistId === dentist._id &&
            intervalsOverlap(
              l.startTimeUtc,
              l.bufferEndTimeUtc,
              slotStartUtc,
              slotBufferEndUtc
            )
        );
      if (dentistBusy) continue;

      // Prefer the dentist's defaultChairId when eligible and free
      const orderedChairs = dentist.defaultChairId
        ? [
            ...eligibleChairs.filter((c) => c._id === dentist.defaultChairId),
            ...eligibleChairs.filter((c) => c._id !== dentist.defaultChairId),
          ]
        : eligibleChairs;

      const freeChair = orderedChairs.find((chair) => {
        const chairBusy =
          blockingAppointments.some(
            (a) =>
              a.chairId === chair._id &&
              intervalsOverlap(
                a.startTimeUtc,
                a.bufferEndTimeUtc,
                slotStartUtc,
                slotBufferEndUtc
              )
          ) ||
          blockingLocks.some(
            (l) =>
              l.chairId === chair._id &&
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
        dentistId: assignedPair.dentist._id,
        dentistName: assignedPair.dentist.displayName,
        chairId: assignedPair.chair._id,
        chairName: assignedPair.chair.name,
        isEmergencyBufferSlot,
      });
    }
  }

  return slots;
}

/**
 * ACID verification inside a mutation before locking or booking a specific `(dentistId, chairId, startTimeUtc)`.
 * Ensures BOTH dentist and chair have zero overlapping appointments, locks, or time-off.
 */
export async function verifySpecificPairAvailable(
  ctx: Ctx,
  params: {
    clinic: Doc<"clinics">;
    service: Doc<"services">;
    dateKey: string;
    dentistId: Id<"dentists">;
    chairId: Id<"chairs">;
    startTimeUtc: number;
    ignoreSessionId?: string;
    ignoreAppointmentId?: Id<"appointments">;
    enforceScheduleRules?: boolean;
    allowEmergencyBuffer?: boolean;
    minLeadMinutes?: number;
  }
): Promise<{
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
  } = params;

  const endTimeUtc = startTimeUtc + service.durationMinutes * 60_000;
  const bufferEndTimeUtc =
    startTimeUtc + (service.durationMinutes + service.bufferMinutes) * 60_000;
  const now = Date.now();

  if (enforceScheduleRules) {
    if (!parseDateKey(dateKey)) {
      return { ok: false, reason: "Invalid appointment date.", endTimeUtc, bufferEndTimeUtc };
    }
    if (startTimeUtc < now + minLeadMinutes * 60_000) {
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
    const clinicDay = clinic.operatingHours.find((h) => h.dayOfWeek === dayOfWeek);
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

  const [dentist, chair, dayAppointments, activeLocks, timeOffRows] =
    await Promise.all([
      ctx.db.get(dentistId),
      ctx.db.get(chairId),
      ctx.db
        .query("appointments")
        .withIndex("by_clinic_and_date", (q) =>
          q.eq("clinicId", clinic._id).eq("dateKey", dateKey)
        )
        .collect(),
      ctx.db
        .query("slotLocks")
        .withIndex("by_clinic_and_expires", (q) =>
          q.eq("clinicId", clinic._id).gt("expiresAtUtc", now)
        )
        .collect(),
      ctx.db
        .query("dentistTimeOff")
        .withIndex("by_dentist_and_time", (q) =>
          q
            .eq("dentistId", dentistId)
            .gte("startTimeUtc", startTimeUtc - 365 * 24 * 60 * 60 * 1000)
            .lte("startTimeUtc", endTimeUtc)
        )
        .order("desc")
        .take(250),
    ]);

  if (!dentist || dentist.clinicId !== clinic._id || !dentist.isActive) {
    return { ok: false, reason: "Selected dentist is unavailable.", endTimeUtc, bufferEndTimeUtc };
  }
  if (!chair || chair.clinicId !== clinic._id || !chair.isActive) {
    return { ok: false, reason: "Selected operatory chair is unavailable.", endTimeUtc, bufferEndTimeUtc };
  }

  if (enforceScheduleRules) {
    const timeZone = clinic.timezone || "Asia/Manila";
    const local = getLocalDateKeyAndMinute(startTimeUtc, timeZone);
    const dayOfWeek = getDayOfWeekFromDateKey(dateKey);
    const shift = dentist.weeklySchedule.find((w) => w.dayOfWeek === dayOfWeek);
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

  const hasTimeOff = timeOffRows.some(
    (t) =>
      t.clinicId === clinic._id &&
      intervalsOverlap(startTimeUtc, endTimeUtc, t.startTimeUtc, t.endTimeUtc)
  );
  if (hasTimeOff) {
    return {
      ok: false,
      reason: "The dentist is on scheduled leave during this time.",
      endTimeUtc,
      bufferEndTimeUtc,
    };
  }

  const conflictingAppointment = dayAppointments.find(
    (a) =>
      a.status !== "cancelled" &&
      a.status !== "no_show" &&
      a._id !== ignoreAppointmentId &&
      (a.dentistId === dentistId || a.chairId === chairId) &&
      intervalsOverlap(
        a.startTimeUtc,
        a.bufferEndTimeUtc,
        startTimeUtc,
        bufferEndTimeUtc
      )
  );
  if (conflictingAppointment) {
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
