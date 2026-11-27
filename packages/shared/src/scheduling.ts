import type { ClinicStatus } from "./enums";

/** 5-minute temporary slot lock TTL in milliseconds. */
export const SLOT_LOCK_DURATION_MS = 5 * 60 * 1000;

/** 3-day grace period for past_due clinics (Law #4). */
export const GRACE_PERIOD_MS = 3 * 24 * 60 * 60 * 1000;

/** Free-tier clinical file size ceiling: 500 KB per compressed X-ray/photo. */
export const MAX_CLINICAL_FILE_BYTES = 500 * 1024;

export interface AvailableSlotDto {
  startTimeUtc: number;
  endTimeUtc: number;
  bufferEndTimeUtc: number;
  startMinute: number;
  endMinute: number;
  dentistId: string;
  dentistName: string;
  chairId: string;
  chairName: string;
  isEmergencyBufferSlot: boolean;
}

export interface ClinicSubscriptionState {
  status: ClinicStatus;
  subscriptionEndsAt: number;
  gracePeriodEndsAt?: number | null;
}

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
    // Fallback to Asia/Manila (UTC+8)
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

/** Evaluates whether a clinic may accept new online bookings (Law #4). */
export function evaluateClinicBookingEligibility(
  clinic: ClinicSubscriptionState,
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

/** Evaluates whether a clinic staff workspace is strictly read-only (Law #4 + impersonation). */
export function evaluateClinicReadOnlyState(
  clinic: ClinicSubscriptionState,
  now: number,
  isSuperAdminOverride = false
): { isReadOnly: boolean; readOnlyReason: string | null } {
  if (isSuperAdminOverride) {
    return {
      isReadOnly: true,
      readOnlyReason: "Super Admin View-As-Clinic mode is strictly read-only.",
    };
  }
  if (clinic.status === "suspended" || clinic.status === "archived") {
    return {
      isReadOnly: true,
      readOnlyReason: `Clinic is ${clinic.status}. Schedule viewing is enabled while new writes are paused.`,
    };
  }
  if (clinic.status === "trial" && now > clinic.subscriptionEndsAt) {
    return {
      isReadOnly: true,
      readOnlyReason:
        "The free trial has ended. Upgrade the subscription to resume editing.",
    };
  }
  if (clinic.status === "active" && now > clinic.subscriptionEndsAt) {
    return {
      isReadOnly: true,
      readOnlyReason:
        "The subscription period has ended. Renew to resume editing.",
    };
  }
  if (clinic.status === "past_due") {
    const graceEnd =
      clinic.gracePeriodEndsAt ?? clinic.subscriptionEndsAt + GRACE_PERIOD_MS;
    if (now > graceEnd) {
      return {
        isReadOnly: true,
        readOnlyReason:
          "The 3-day grace period has expired. The clinic is now in read-only mode.",
      };
    }
  }
  return { isReadOnly: false, readOnlyReason: null };
}
