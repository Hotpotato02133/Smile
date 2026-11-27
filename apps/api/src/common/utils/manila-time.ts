import { randomBytes } from "node:crypto";
import type { OperatingHoursDay, WeeklyScheduleDay } from "@smile/shared";

export const DAY_MS = 24 * 60 * 60 * 1000;
const MANILA_OFFSET_MS = 8 * 60 * 60 * 1000;

/** Formats a Date or epoch ms as `"YYYY-MM"` in Asia/Manila (UTC+8). */
export function toManilaMonthKey(dateOrMs: Date | number = Date.now()): string {
  const ms = typeof dateOrMs === "number" ? dateOrMs : dateOrMs.getTime();
  const d = new Date(ms + MANILA_OFFSET_MS);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

/** Formats a Date or epoch ms as `"YYYY-MM-DD"` in Asia/Manila (UTC+8). */
export function toManilaDateKey(dateOrMs: Date | number = Date.now()): string {
  const ms = typeof dateOrMs === "number" ? dateOrMs : dateOrMs.getTime();
  const d = new Date(ms + MANILA_OFFSET_MS);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/** Generates a cryptographically random 48-char hex invitation token. */
export function generateInviteToken(): string {
  return randomBytes(24).toString("hex");
}

/** Generates a human-friendly unique invoice number (e.g. `INV-2026-48219`). */
export function generateInvoiceNumber(now = new Date()): string {
  const year = now.getUTCFullYear();
  const suffix = randomBytes(3).readUIntBE(0, 3).toString().padStart(6, "0").slice(-6);
  return `INV-${year}-${suffix}`;
}

export const DEFAULT_OPERATING_HOURS: OperatingHoursDay[] = [
  { dayOfWeek: 0, isOpen: false, openMinute: 540, closeMinute: 1020 },
  { dayOfWeek: 1, isOpen: true, openMinute: 540, closeMinute: 1080 },
  { dayOfWeek: 2, isOpen: true, openMinute: 540, closeMinute: 1080 },
  { dayOfWeek: 3, isOpen: true, openMinute: 540, closeMinute: 1080 },
  { dayOfWeek: 4, isOpen: true, openMinute: 540, closeMinute: 1080 },
  { dayOfWeek: 5, isOpen: true, openMinute: 540, closeMinute: 1080 },
  { dayOfWeek: 6, isOpen: true, openMinute: 540, closeMinute: 960 },
];

export const DEFAULT_DENTIST_SCHEDULE: WeeklyScheduleDay[] = [
  { dayOfWeek: 0, isWorking: false, startMinute: 540, endMinute: 1020 },
  {
    dayOfWeek: 1,
    isWorking: true,
    startMinute: 540,
    endMinute: 1020,
    breakStartMinute: 720,
    breakEndMinute: 780,
  },
  {
    dayOfWeek: 2,
    isWorking: true,
    startMinute: 540,
    endMinute: 1020,
    breakStartMinute: 720,
    breakEndMinute: 780,
  },
  {
    dayOfWeek: 3,
    isWorking: true,
    startMinute: 540,
    endMinute: 1020,
    breakStartMinute: 720,
    breakEndMinute: 780,
  },
  {
    dayOfWeek: 4,
    isWorking: true,
    startMinute: 540,
    endMinute: 1020,
    breakStartMinute: 720,
    breakEndMinute: 780,
  },
  {
    dayOfWeek: 5,
    isWorking: true,
    startMinute: 540,
    endMinute: 1020,
    breakStartMinute: 720,
    breakEndMinute: 780,
  },
  { dayOfWeek: 6, isWorking: true, startMinute: 540, endMinute: 900 },
];
