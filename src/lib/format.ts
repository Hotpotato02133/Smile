import { ConvexError } from "convex/values";

const phpFormatter = new Intl.NumberFormat("en-PH", {
  style: "currency",
  currency: "PHP",
  maximumFractionDigits: 0,
});

const dateFormatter = new Intl.DateTimeFormat("en-PH", {
  year: "numeric",
  month: "short",
  day: "numeric",
});

const dateTimeFormatter = new Intl.DateTimeFormat("en-PH", {
  year: "numeric",
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatPhp(amount: number): string {
  return phpFormatter.format(amount);
}

export function formatBytes(bytes: number): string {
  if (bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  const idx = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1
  );
  const value = bytes / 1024 ** idx;
  return `${value >= 100 || idx === 0 ? Math.round(value) : value.toFixed(1)} ${units[idx]}`;
}

export function formatDate(timestampMs: number): string {
  return dateFormatter.format(new Date(timestampMs));
}

export function formatDateTime(timestampMs: number): string {
  return dateTimeFormatter.format(new Date(timestampMs));
}

export function formatShortDateKey(dateKey: string): string {
  const [year, month, day] = dateKey.split("-").map(Number);
  if (!year || !month || !day) return dateKey;
  return new Intl.DateTimeFormat("en-PH", {
    month: "short",
    day: "numeric",
  }).format(new Date(Date.UTC(year, month - 1, day)));
}

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function getErrorMessage(error: unknown, fallback = "Something went wrong."): string {
  if (error instanceof ConvexError) {
    const data = error.data as { message?: string } | string | undefined;
    if (typeof data === "string") return data;
    if (data && typeof data === "object" && typeof data.message === "string") {
      return data.message;
    }
  }
  if (error instanceof Error && error.message) {
    return error.message;
  }
  return fallback;
}

export function getErrorCode(error: unknown): string | null {
  if (error instanceof ConvexError) {
    const data = error.data as { code?: string } | undefined;
    if (data && typeof data === "object" && typeof data.code === "string") {
      return data.code;
    }
  }
  return null;
}

export const DAY_NAMES = [
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

export const DAY_SHORT_NAMES = [
  "Sun",
  "Mon",
  "Tue",
  "Wed",
  "Thu",
  "Fri",
  "Sat",
] as const;

/** Converts minutes from midnight (0–1439) to `"HH:MM"` for `<input type="time">`. */
export function minutesToTimeInput(minutes: number): string {
  const clamped = Math.max(0, Math.min(1439, Math.round(minutes)));
  const hh = String(Math.floor(clamped / 60)).padStart(2, "0");
  const mm = String(clamped % 60).padStart(2, "0");
  return `${hh}:${mm}`;
}

/** Converts `"HH:MM"` to integer minutes from midnight (0–1439). */
export function timeInputToMinutes(value: string, fallback = 540): number {
  const [hStr, mStr] = value.split(":");
  const h = Number(hStr);
  const m = Number(mStr);
  if (Number.isNaN(h) || Number.isNaN(m)) return fallback;
  return Math.max(0, Math.min(1439, h * 60 + m));
}

/** Formats minutes from midnight as `"9:00 AM"`. */
export function formatMinutes12h(minutes: number): string {
  const clamped = Math.max(0, Math.min(1439, Math.round(minutes)));
  const h24 = Math.floor(clamped / 60);
  const m = clamped % 60;
  const suffix = h24 >= 12 ? "PM" : "AM";
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${String(m).padStart(2, "0")} ${suffix}`;
}

/** Returns today's `"YYYY-MM-DD"` in the given IANA timezone. */
export function getTodayDateKeyInTimeZone(timeZone = "Asia/Manila"): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    });
    const parts = formatter.formatToParts(new Date());
    const year = parts.find((p) => p.type === "year")?.value ?? "2026";
    const month = parts.find((p) => p.type === "month")?.value ?? "01";
    const day = parts.find((p) => p.type === "day")?.value ?? "01";
    return `${year}-${month}-${day}`;
  } catch {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  }
}

/** Converts a `"YYYY-MM-DD"` calendar key to a local Date at 00:00:00 (safe for DayPicker). */
export function dateKeyToLocalDate(dateKey: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const dt = new Date(year, month - 1, day, 0, 0, 0, 0);
  if (
    dt.getFullYear() !== year ||
    dt.getMonth() !== month - 1 ||
    dt.getDate() !== day
  ) {
    return null;
  }
  return dt;
}

/** Groups consecutive clinic operating days sharing identical hours for clean display. */
export function formatOperatingHoursGroups(
  hours: Array<{
    dayOfWeek: number;
    isOpen: boolean;
    openMinute: number;
    closeMinute: number;
  }>
): Array<{ days: string; hours: string }> {
  // Order Mon(1)..Sat(6), Sun(0)
  const order = [1, 2, 3, 4, 5, 6, 0];
  const byDay = new Map(hours.map((h) => [h.dayOfWeek, h]));
  const openEntries = order
    .map((day) => byDay.get(day))
    .filter((h): h is NonNullable<typeof h> => Boolean(h && h.isOpen));

  if (openEntries.length === 0) return [];

  const groups: Array<{ dayNums: number[]; openMinute: number; closeMinute: number }> = [];
  for (const entry of openEntries) {
    const prev = groups[groups.length - 1];
    const prevIdx = prev ? order.indexOf(prev.dayNums[prev.dayNums.length - 1]) : -1;
    const currIdx = order.indexOf(entry.dayOfWeek);
    if (
      prev &&
      currIdx === prevIdx + 1 &&
      prev.openMinute === entry.openMinute &&
      prev.closeMinute === entry.closeMinute
    ) {
      prev.dayNums.push(entry.dayOfWeek);
    } else {
      groups.push({
        dayNums: [entry.dayOfWeek],
        openMinute: entry.openMinute,
        closeMinute: entry.closeMinute,
      });
    }
  }

  return groups.map((g) => {
    const first = DAY_SHORT_NAMES[g.dayNums[0]];
    const last = DAY_SHORT_NAMES[g.dayNums[g.dayNums.length - 1]];
    const days =
      g.dayNums.length === 1
        ? first
        : g.dayNums.length === 2
          ? `${first}, ${last}`
          : `${first}–${last}`;
    return {
      days,
      hours: `${formatMinutes12h(g.openMinute)} – ${formatMinutes12h(g.closeMinute)}`,
    };
  });
}
