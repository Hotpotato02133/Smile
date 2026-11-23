import { ConvexError, v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { type MutationCtx, mutation, query } from "./_generated/server";
import {
  DAY_MS,
  generateInviteToken,
  recordAuditLog,
  toManilaMonthKey,
} from "./lib/audit";
import {
  assertClinicCanWrite,
  assertClinicFeatureEnabled,
  type ClinicResourceType,
  getClinicReadOnlyState,
  requireClinicAccess,
} from "./lib/permissions";
import {
  getDayOfWeekFromDateKey,
  getLocalDateKeyAndMinute,
  localDateMinuteToUtc,
  parseDateKey,
} from "./lib/scheduling";
import { DEFAULT_SERVICE_CATALOG } from "./lib/serviceCatalog";

const weeklyScheduleDayValidator = v.object({
  dayOfWeek: v.number(),
  isWorking: v.boolean(),
  startMinute: v.number(),
  endMinute: v.number(),
  breakStartMinute: v.optional(v.number()),
  breakEndMinute: v.optional(v.number()),
});

const operatingHoursDayValidator = v.object({
  dayOfWeek: v.number(),
  isOpen: v.boolean(),
  openMinute: v.number(),
  closeMinute: v.number(),
});

const serviceCategoryValidator = v.union(
  v.literal("Preventive"),
  v.literal("Restorative"),
  v.literal("Cosmetic"),
  v.literal("Orthodontics"),
  v.literal("Endodontics"),
  v.literal("Oral Surgery"),
  v.literal("Emergency")
);

const HEX_COLOR_REGEX = /^#[0-9a-fA-F]{6}$/;
const SLUG_REGEX = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_LOGO_BYTES = 500 * 1024;

function isValidIanaTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Guard for all Clinic Admin write mutations: blocks Super Admin read-only impersonation and enforces Law #4/quotas. */
async function requireClinicAdminWrite(
  ctx: MutationCtx,
  resourceType: ClinicResourceType
) {
  const access = await requireClinicAccess(ctx, ["clinic_admin"]);
  if (access.isSuperAdminOverride || access.user.role === "super_admin") {
    throw new ConvexError({
      code: "READ_ONLY_IMPERSONATION",
      message: "Super Admin View-As-Clinic mode is strictly read-only.",
    });
  }
  const clinic = await assertClinicCanWrite(ctx, access.clinicId, resourceType);
  return { ...access, clinic };
}

function validateWeeklySchedule(
  schedule: {
    dayOfWeek: number;
    isWorking: boolean;
    startMinute: number;
    endMinute: number;
    breakStartMinute?: number;
    breakEndMinute?: number;
  }[]
) {
  if (schedule.length !== 7) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: "Weekly schedule must include all 7 days (Sunday through Saturday).",
    });
  }
  const seenDays = new Set<number>();
  for (const day of schedule) {
    if (!Number.isInteger(day.dayOfWeek) || day.dayOfWeek < 0 || day.dayOfWeek > 6) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Day of week must be an integer between 0 (Sun) and 6 (Sat).",
      });
    }
    if (seenDays.has(day.dayOfWeek)) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Weekly schedule cannot contain duplicate days of the week.",
      });
    }
    seenDays.add(day.dayOfWeek);

    if (!day.isWorking) continue;
    if (
      day.startMinute < 0 ||
      day.endMinute > 1439 ||
      day.endMinute <= day.startMinute
    ) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Shift end time must be after start time (00:00–23:59).",
      });
    }
    const hasBreakStart = day.breakStartMinute !== undefined;
    const hasBreakEnd = day.breakEndMinute !== undefined;
    if (hasBreakStart !== hasBreakEnd) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Specify both break start and break end times, or disable the break.",
      });
    }
    if (
      day.breakStartMinute !== undefined &&
      day.breakEndMinute !== undefined
    ) {
      if (
        day.breakEndMinute <= day.breakStartMinute ||
        day.breakStartMinute < day.startMinute ||
        day.breakEndMinute > day.endMinute
      ) {
        throw new ConvexError({
          code: "INVALID_INPUT",
          message: "Lunch break must fall inside the dentist's working shift.",
        });
      }
    }
  }
}

function validateOperatingHours(
  hours: {
    dayOfWeek: number;
    isOpen: boolean;
    openMinute: number;
    closeMinute: number;
  }[]
) {
  if (hours.length !== 7) {
    throw new ConvexError({
      code: "INVALID_INPUT",
      message: "Operating hours must specify all 7 days of the week.",
    });
  }
  const seenDays = new Set<number>();
  for (const day of hours) {
    if (!Number.isInteger(day.dayOfWeek) || day.dayOfWeek < 0 || day.dayOfWeek > 6) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Operating day must be an integer between 0 (Sun) and 6 (Sat).",
      });
    }
    if (seenDays.has(day.dayOfWeek)) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Operating hours cannot contain duplicate days of the week.",
      });
    }
    seenDays.add(day.dayOfWeek);
    if (!day.isOpen) continue;
    if (
      day.openMinute < 0 ||
      day.closeMinute > 1439 ||
      day.closeMinute <= day.openMinute
    ) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Closing time must be after opening time (00:00–23:59) for open days.",
      });
    }
  }
}

function listDateKeysBetween(startKey: string, endKey: string): string[] {
  const start = parseDateKey(startKey);
  const end = parseDateKey(endKey);
  if (!start || !end) return [];
  const startMs = Date.UTC(start.year, start.month - 1, start.day);
  const endMs = Date.UTC(end.year, end.month - 1, end.day);
  if (endMs < startMs) return [];
  const out: string[] = [];
  for (let ms = startMs; ms <= endMs && out.length < 120; ms += DAY_MS) {
    const d = new Date(ms);
    const y = d.getUTCFullYear();
    const m = String(d.getUTCMonth() + 1).padStart(2, "0");
    const day = String(d.getUTCDate()).padStart(2, "0");
    out.push(`${y}-${m}-${day}`);
  }
  return out;
}

// ============================================================================
// 1. WORKSPACE OVERVIEW, BILLING & LOCAL REPORTS
// ============================================================================

export const getClinicWorkspace = query({
  args: { overrideClinicId: v.optional(v.id("clinics")) },
  handler: async (ctx, args) => {
    const { user, clinic, clinicId, isSuperAdminOverride } =
      await requireClinicAccess(ctx, ["clinic_admin"], args.overrideClinicId);

    const now = Date.now();
    const [
      plan,
      activeDentists,
      inactiveDentists,
      activeChairs,
      inactiveChairs,
      services,
      staffUsers,
      pendingInvitations,
      activeAnnouncements,
      logoUrl,
    ] = await Promise.all([
      ctx.db.get(clinic.planId),
      ctx.db
        .query("dentists")
        .withIndex("by_clinic", (q) =>
          q.eq("clinicId", clinicId).eq("isActive", true)
        )
        .collect(),
      ctx.db
        .query("dentists")
        .withIndex("by_clinic", (q) =>
          q.eq("clinicId", clinicId).eq("isActive", false)
        )
        .collect(),
      ctx.db
        .query("chairs")
        .withIndex("by_clinic", (q) =>
          q.eq("clinicId", clinicId).eq("isActive", true)
        )
        .collect(),
      ctx.db
        .query("chairs")
        .withIndex("by_clinic", (q) =>
          q.eq("clinicId", clinicId).eq("isActive", false)
        )
        .collect(),
      ctx.db
        .query("services")
        .withIndex("by_clinic_and_category", (q) => q.eq("clinicId", clinicId))
        .collect(),
      ctx.db
        .query("users")
        .withIndex("by_clinic_and_role", (q) => q.eq("clinicId", clinicId))
        .collect(),
      ctx.db
        .query("staffInvitations")
        .withIndex("by_clinic", (q) =>
          q.eq("clinicId", clinicId).eq("status", "pending")
        )
        .collect(),
      ctx.db
        .query("systemAnnouncements")
        .withIndex("by_active", (q) => q.eq("isActive", true))
        .order("desc")
        .collect(),
      clinic.logoStorageId ? ctx.storage.getUrl(clinic.logoStorageId) : null,
    ]);

    const visibleAnnouncements = activeAnnouncements.filter(
      (a) =>
        (!a.expiresAt || a.expiresAt >= now) &&
        (a.targetAudience === "all_users" ||
          a.targetAudience === "all_clinic_staff" ||
          a.targetAudience === "clinic_admins_only")
    );

    const readOnlyState = getClinicReadOnlyState(
      clinic,
      now,
      isSuperAdminOverride
    );

    const currentMonthKey = toManilaMonthKey(now);
    const isCurrentMonth = clinic.currentMonthKey === currentMonthKey;
    const effectiveMonthlyAppointments = isCurrentMonth
      ? clinic.currentMonthAppointmentCount
      : 0;
    const effectiveMonthlyEmails = isCurrentMonth
      ? clinic.currentMonthEmailCount
      : 0;

    return {
      user: {
        _id: user._id,
        email: user.email,
        firstName: user.firstName,
        lastName: user.lastName,
        role: user.role,
      },
      clinic: {
        ...clinic,
        currentMonthAppointmentCount: effectiveMonthlyAppointments,
        currentMonthEmailCount: effectiveMonthlyEmails,
      },
      plan,
      logoUrl,
      isSuperAdminOverride,
      isReadOnly: readOnlyState.isReadOnly,
      readOnlyReason: readOnlyState.readOnlyReason,
      announcements: visibleAnnouncements,
      counts: {
        activeDentists: activeDentists.length,
        totalDentists: activeDentists.length + inactiveDentists.length,
        activeChairs: activeChairs.length,
        totalChairs: activeChairs.length + inactiveChairs.length,
        activeServices: services.filter((s) => s.isActive).length,
        totalServices: services.length,
        staffCount: staffUsers.filter((u) => !u.clerkId.startsWith("pending:")).length,
        pendingInvites: pendingInvitations.filter((i) => i.expiresAt >= now).length,
      },
    };
  },
});

export const getClinicBillingSummary = query({
  args: { overrideClinicId: v.optional(v.id("clinics")) },
  handler: async (ctx, args) => {
    const { clinic, clinicId, isSuperAdminOverride } =
      await requireClinicAccess(ctx, ["clinic_admin"], args.overrideClinicId);

    const now = Date.now();
    const [currentPlan, allPlans, paymentRows] = await Promise.all([
      ctx.db.get(clinic.planId),
      ctx.db.query("subscriptionPlans").take(25),
      ctx.db
        .query("subscriptionPayments")
        .withIndex("by_clinic", (q) => q.eq("clinicId", clinicId))
        .order("desc")
        .take(50),
    ]);

    const planMap = new Map<Id<"subscriptionPlans">, Doc<"subscriptionPlans">>(
      allPlans.map((p) => [p._id, p])
    );

    const availablePlans: Doc<"subscriptionPlans">[] = [];
    for (const p of allPlans) {
      if (p.isActive || p._id === clinic.planId) {
        availablePlans.push(p);
      }
    }
    availablePlans.sort((a, b) => a.monthlyPricePhp - b.monthlyPricePhp);

    const payments = await Promise.all(
      paymentRows.map(async (payment) => {
        const plan = planMap.get(payment.planId);
        const receiptUrl = payment.receiptStorageId
          ? await ctx.storage.getUrl(payment.receiptStorageId)
          : null;
        return {
          ...payment,
          planName: plan?.name ?? "Subscription Plan",
          planCode: plan?.code ?? "starter",
          receiptUrl,
        };
      })
    );

    const readOnlyState = getClinicReadOnlyState(
      clinic,
      now,
      isSuperAdminOverride
    );

    const currentMonthKey = toManilaMonthKey(now);
    const isCurrentMonth = clinic.currentMonthKey === currentMonthKey;

    return {
      clinic: {
        ...clinic,
        currentMonthAppointmentCount: isCurrentMonth
          ? clinic.currentMonthAppointmentCount
          : 0,
        currentMonthEmailCount: isCurrentMonth
          ? clinic.currentMonthEmailCount
          : 0,
      },
      currentPlan,
      availablePlans,
      payments,
      isReadOnly: readOnlyState.isReadOnly,
      readOnlyReason: readOnlyState.readOnlyReason,
    };
  },
});

export const getClinicDailyMetrics = query({
  args: {
    overrideClinicId: v.optional(v.id("clinics")),
    days: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { clinic, clinicId } = await requireClinicAccess(
      ctx,
      ["clinic_admin"],
      args.overrideClinicId
    );

    const now = Date.now();
    const timeZone = clinic.timezone || "Asia/Manila";
    const days = Math.min(Math.max(args.days ?? 30, 7), 90);
    const todayKey = getLocalDateKeyAndMinute(now, timeZone).dateKey;
    const startKey = getLocalDateKeyAndMinute(
      now - (days - 1) * DAY_MS,
      timeZone
    ).dateKey;

    const rangeStartUtc = localDateMinuteToUtc(startKey, 0, timeZone);
    const rangeEndUtc = localDateMinuteToUtc(todayKey, 1439, timeZone) + 60_000;

    const [
      metricRows,
      rangeAppointments,
      clinicServices,
      activeDentists,
      inactiveDentists,
      timeOffRows,
    ] = await Promise.all([
      ctx.db
        .query("clinicMetricsDaily")
        .withIndex("by_clinic_and_date", (q) =>
          q.eq("clinicId", clinicId).gte("dateKey", startKey)
        )
        .order("asc")
        .take(120),
      ctx.db
        .query("appointments")
        .withIndex("by_clinic_and_date", (q) =>
          q
            .eq("clinicId", clinicId)
            .gte("dateKey", startKey)
            .lte("dateKey", todayKey)
        )
        .take(2000),
      ctx.db
        .query("services")
        .withIndex("by_clinic_and_category", (q) => q.eq("clinicId", clinicId))
        .take(200),
      ctx.db
        .query("dentists")
        .withIndex("by_clinic", (q) =>
          q.eq("clinicId", clinicId).eq("isActive", true)
        )
        .take(100),
      ctx.db
        .query("dentists")
        .withIndex("by_clinic", (q) =>
          q.eq("clinicId", clinicId).eq("isActive", false)
        )
        .take(100),
      ctx.db
        .query("dentistTimeOff")
        .withIndex("by_clinic_and_time", (q) =>
          q
            .eq("clinicId", clinicId)
            .gte("startTimeUtc", rangeStartUtc - 30 * DAY_MS)
            .lte("startTimeUtc", rangeEndUtc)
        )
        .take(300),
    ]);

    const serviceMap = new Map<Id<"services">, Doc<"services">>(
      clinicServices.map((s) => [s._id, s])
    );

    // Build rows from pre-aggregated `clinicMetricsDaily` and include live today snapshot
    // if the daily midnight cron has not closed out today yet.
    const rows = metricRows.map((r) => ({
      dateKey: r.dateKey,
      totalBooked: r.totalBooked,
      completedCount: r.completedCount,
      cancelledCount: r.cancelledCount,
      noShowCount: r.noShowCount,
      estimatedRevenuePhp: r.estimatedRevenuePhp,
      newPatientsCount: r.newPatientsCount,
    }));

    let includesLiveToday = false;
    const hasTodayRow = rows.some((r) => r.dateKey === todayKey);
    let todayBooked = 0;
    let todayCompleted = 0;
    let todayCancelled = 0;
    let todayNoShow = 0;
    let todayRevenue = 0;

    if (!hasTodayRow) {
      for (const appt of rangeAppointments) {
        if (appt.dateKey !== todayKey) continue;
        todayBooked++;
        if (appt.status === "completed") {
          todayCompleted++;
          todayRevenue += serviceMap.get(appt.serviceId)?.pricePhp ?? 0;
        } else if (appt.status === "cancelled") {
          todayCancelled++;
        } else if (appt.status === "no_show") {
          todayNoShow++;
        }
      }
      if (todayBooked > 0) {
        rows.push({
          dateKey: todayKey,
          totalBooked: todayBooked,
          completedCount: todayCompleted,
          cancelledCount: todayCancelled,
          noShowCount: todayNoShow,
          estimatedRevenuePhp: todayRevenue,
          newPatientsCount: 0,
        });
        includesLiveToday = true;
      }
    }

    const totals = rows.reduce(
      (acc, r) => ({
        totalBooked: acc.totalBooked + r.totalBooked,
        completedCount: acc.completedCount + r.completedCount,
        cancelledCount: acc.cancelledCount + r.cancelledCount,
        noShowCount: acc.noShowCount + r.noShowCount,
        estimatedRevenuePhp: acc.estimatedRevenuePhp + r.estimatedRevenuePhp,
        newPatientsCount: acc.newPatientsCount + r.newPatientsCount,
      }),
      {
        totalBooked: 0,
        completedCount: 0,
        cancelledCount: 0,
        noShowCount: 0,
        estimatedRevenuePhp: 0,
        newPatientsCount: 0,
      }
    );

    const completionRate =
      totals.totalBooked > 0
        ? Math.round((totals.completedCount / totals.totalBooked) * 1000) / 10
        : 0;
    const noShowRate =
      totals.totalBooked > 0
        ? Math.round((totals.noShowCount / totals.totalBooked) * 1000) / 10
        : 0;
    const cancellationRate =
      totals.totalBooked > 0
        ? Math.round((totals.cancelledCount / totals.totalBooked) * 1000) / 10
        : 0;

    // Top Services breakdown across the selected date window
    const serviceAgg = new Map<
      Id<"services">,
      {
        serviceId: Id<"services">;
        name: string;
        category: string;
        bookingCount: number;
        completedCount: number;
        noShowCount: number;
        estimatedRevenuePhp: number;
      }
    >();

    for (const appt of rangeAppointments) {
      const svc = serviceMap.get(appt.serviceId);
      const entry = serviceAgg.get(appt.serviceId) ?? {
        serviceId: appt.serviceId,
        name: svc?.name ?? "Dental Procedure",
        category: svc?.category ?? "Preventive",
        bookingCount: 0,
        completedCount: 0,
        noShowCount: 0,
        estimatedRevenuePhp: 0,
      };
      entry.bookingCount++;
      if (appt.status === "completed") {
        entry.completedCount++;
        entry.estimatedRevenuePhp += svc?.pricePhp ?? 0;
      } else if (appt.status === "no_show") {
        entry.noShowCount++;
      }
      serviceAgg.set(appt.serviceId, entry);
    }

    const totalServiceBookings = rangeAppointments.length;
    const topServices = Array.from(serviceAgg.values())
      .sort(
        (a, b) =>
          b.estimatedRevenuePhp - a.estimatedRevenuePhp ||
          b.bookingCount - a.bookingCount
      )
      .slice(0, 8)
      .map((s) => ({
        ...s,
        sharePct:
          totalServiceBookings > 0
            ? Math.round((s.bookingCount / totalServiceBookings) * 1000) / 10
            : 0,
      }));

    // Dentist Utilization breakdown (booked minutes vs scheduled shift minutes)
    const dateKeysInWindow = listDateKeysBetween(startKey, todayKey);
    const apptsByDentist = new Map<Id<"dentists">, Doc<"appointments">[]>();
    for (const appt of rangeAppointments) {
      const list = apptsByDentist.get(appt.dentistId) ?? [];
      list.push(appt);
      apptsByDentist.set(appt.dentistId, list);
    }

    const timeOffByDentist = new Map<Id<"dentists">, Doc<"dentistTimeOff">[]>();
    for (const row of timeOffRows) {
      if (row.endTimeUtc <= rangeStartUtc || row.startTimeUtc >= rangeEndUtc) {
        continue;
      }
      const list = timeOffByDentist.get(row.dentistId) ?? [];
      list.push(row);
      timeOffByDentist.set(row.dentistId, list);
    }

    const dentistsForReport: Doc<"dentists">[] = [
      ...activeDentists,
      ...inactiveDentists.filter((d) => apptsByDentist.has(d._id)),
    ];

    const dentistUtilization = dentistsForReport
      .map((dentist) => {
        const dentistTimeOff = timeOffByDentist.get(dentist._id) ?? [];
        let scheduledMinutes = 0;

        for (const dk of dateKeysInWindow) {
          const dow = getDayOfWeekFromDateKey(dk);
          const clinicDay = clinic.operatingHours.find(
            (h) => h.dayOfWeek === dow
          );
          if (!clinicDay || !clinicDay.isOpen) continue;
          const shift = dentist.weeklySchedule.find(
            (w) => w.dayOfWeek === dow
          );
          if (!shift || !shift.isWorking) continue;

          const effStart = Math.max(shift.startMinute, clinicDay.openMinute);
          const effEnd = Math.min(shift.endMinute, clinicDay.closeMinute);
          if (effEnd <= effStart) continue;

          let dayMinutes = effEnd - effStart;
          if (
            shift.breakStartMinute !== undefined &&
            shift.breakEndMinute !== undefined
          ) {
            const bStart = Math.max(shift.breakStartMinute, effStart);
            const bEnd = Math.min(shift.breakEndMinute, effEnd);
            if (bEnd > bStart) {
              dayMinutes -= bEnd - bStart;
            }
          }

          if (dentistTimeOff.length > 0 && dayMinutes > 0) {
            const shiftStartUtc = localDateMinuteToUtc(dk, effStart, timeZone);
            const shiftEndUtc = localDateMinuteToUtc(dk, effEnd, timeZone);
            let offMinutes = 0;
            for (const block of dentistTimeOff) {
              const overlapStart = Math.max(shiftStartUtc, block.startTimeUtc);
              const overlapEnd = Math.min(shiftEndUtc, block.endTimeUtc);
              if (overlapEnd > overlapStart) {
                offMinutes += Math.round((overlapEnd - overlapStart) / 60_000);
              }
            }
            dayMinutes = Math.max(0, dayMinutes - offMinutes);
          }

          scheduledMinutes += dayMinutes;
        }

        const dentistAppts = apptsByDentist.get(dentist._id) ?? [];
        let bookedAppointments = 0;
        let completedAppointments = 0;
        let noShowCount = 0;
        let bookedMinutes = 0;
        let estimatedRevenuePhp = 0;

        for (const appt of dentistAppts) {
          bookedAppointments++;
          if (appt.status === "completed") {
            completedAppointments++;
            estimatedRevenuePhp += serviceMap.get(appt.serviceId)?.pricePhp ?? 0;
          } else if (appt.status === "no_show") {
            noShowCount++;
          }
          if (appt.status !== "cancelled" && appt.status !== "no_show") {
            bookedMinutes += Math.max(
              0,
              Math.round((appt.endTimeUtc - appt.startTimeUtc) / 60_000)
            );
          }
        }

        const utilizationPct =
          scheduledMinutes > 0
            ? Math.min(
                100,
                Math.round((bookedMinutes / scheduledMinutes) * 1000) / 10
              )
            : 0;

        return {
          dentistId: dentist._id,
          displayName: dentist.isActive
            ? dentist.displayName
            : `${dentist.displayName} (Inactive)`,
          calendarColorHex: dentist.calendarColorHex,
          bookedAppointments,
          completedAppointments,
          noShowCount,
          bookedMinutes,
          scheduledMinutes,
          utilizationPct,
          estimatedRevenuePhp,
        };
      })
      .sort(
        (a, b) =>
          b.utilizationPct - a.utilizationPct ||
          b.estimatedRevenuePhp - a.estimatedRevenuePhp
      );

    return {
      rows,
      totals,
      rates: {
        completionRate,
        noShowRate,
        cancellationRate,
      },
      includesLiveToday,
      timeZone,
      topServices,
      dentistUtilization,
    };
  },
});

// ============================================================================
// 2. DENTISTS, WEEKLY SHIFT SCHEDULES & TIME OFF
// ============================================================================

export const listDentists = query({
  args: { overrideClinicId: v.optional(v.id("clinics")) },
  handler: async (ctx, args) => {
    const { clinicId } = await requireClinicAccess(
      ctx,
      ["clinic_admin"],
      args.overrideClinicId
    );

    const [activeDentists, inactiveDentists, chairs, timeOffRows, clinicUsers] =
      await Promise.all([
        ctx.db
          .query("dentists")
          .withIndex("by_clinic", (q) =>
            q.eq("clinicId", clinicId).eq("isActive", true)
          )
          .collect(),
        ctx.db
          .query("dentists")
          .withIndex("by_clinic", (q) =>
            q.eq("clinicId", clinicId).eq("isActive", false)
          )
          .collect(),
        ctx.db
          .query("chairs")
          .withIndex("by_clinic", (q) =>
            q.eq("clinicId", clinicId).eq("isActive", true)
          )
          .collect(),
        ctx.db
          .query("dentistTimeOff")
          .withIndex("by_clinic_and_time", (q) => q.eq("clinicId", clinicId))
          .order("desc")
          .take(100),
        ctx.db
          .query("users")
          .withIndex("by_clinic_and_role", (q) => q.eq("clinicId", clinicId))
          .collect(),
      ]);

    const dentists = [...activeDentists, ...inactiveDentists];
    const chairMap = new Map<Id<"chairs">, Doc<"chairs">>(
      chairs.map((c) => [c._id, c])
    );
    const userMap = new Map<Id<"users">, Doc<"users">>(
      clinicUsers.map((u) => [u._id, u])
    );
    const linkedUserIds = new Set(dentists.map((d) => d.userId));

    const now = Date.now();
    const upcomingTimeOffByDentist = new Map<
      Id<"dentists">,
      Doc<"dentistTimeOff">[]
    >();
    for (const row of timeOffRows) {
      if (row.endTimeUtc < now - DAY_MS) continue;
      const list = upcomingTimeOffByDentist.get(row.dentistId) ?? [];
      list.push(row);
      upcomingTimeOffByDentist.set(row.dentistId, list);
    }

    return {
      dentists: dentists.map((d) => {
        const linkedUser = userMap.get(d.userId);
        const defaultChair = d.defaultChairId
          ? chairMap.get(d.defaultChairId)
          : null;
        return {
          ...d,
          userEmail: linkedUser?.email ?? "",
          isPendingAccount: linkedUser?.clerkId.startsWith("pending:") ?? false,
          defaultChairName: defaultChair?.name ?? null,
          timeOff: upcomingTimeOffByDentist.get(d._id) ?? [],
        };
      }),
      availableUsers: clinicUsers
        .filter(
          (u) =>
            !linkedUserIds.has(u._id) &&
            !u.clerkId.startsWith("pending:") &&
            (u.role === "dentist" || u.role === "clinic_admin")
        )
        .map((u) => ({
          _id: u._id,
          email: u.email,
          name: `${u.firstName} ${u.lastName}`.trim() || u.email,
          role: u.role,
        })),
      chairs: chairs.map((c) => ({
        _id: c._id,
        name: c.name,
        roomCode: c.roomCode,
      })),
    };
  },
});

export const createDentist = mutation({
  args: {
    displayName: v.string(),
    userId: v.optional(v.id("users")),
    inviteEmail: v.optional(v.string()),
    licenseNumber: v.string(),
    specialties: v.array(v.string()),
    bio: v.optional(v.string()),
    calendarColorHex: v.string(),
    defaultChairId: v.optional(v.id("chairs")),
    weeklySchedule: v.array(weeklyScheduleDayValidator),
  },
  handler: async (ctx, args) => {
    // Enforces clinic status AND maxDentists plan quota (throws QUOTA_EXCEEDED)
    const { user: actor, clinic, clinicId } = await requireClinicAdminWrite(
      ctx,
      "dentist"
    );

    const displayName = args.displayName.trim();
    const licenseNumber = args.licenseNumber.trim();
    if (displayName.length < 2) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Dentist display name must be at least 2 characters.",
      });
    }
    if (!licenseNumber) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "PRC / dental license number is required.",
      });
    }
    validateWeeklySchedule(args.weeklySchedule);

    if (args.defaultChairId) {
      const chair = await ctx.db.get(args.defaultChairId);
      if (!chair || chair.clinicId !== clinicId) {
        throw new ConvexError({
          code: "NOT_FOUND",
          message: "Selected default operatory chair does not belong to this clinic.",
        });
      }
    }

    const now = Date.now();
    let targetUserId: Id<"users">;

    if (args.userId) {
      const targetUser = await ctx.db.get(args.userId);
      if (!targetUser || targetUser.clinicId !== clinicId) {
        throw new ConvexError({
          code: "FORBIDDEN",
          message: "Selected staff user does not belong to this clinic.",
        });
      }
      const existingProfile = await ctx.db
        .query("dentists")
        .withIndex("by_user", (q) => q.eq("userId", args.userId!))
        .unique();
      if (existingProfile) {
        throw new ConvexError({
          code: "CONFLICT",
          message: "This staff user already has a dentist profile.",
        });
      }
      targetUserId = targetUser._id;
    } else {
      const email = args.inviteEmail?.trim().toLowerCase();
      if (!email || !email.includes("@")) {
        throw new ConvexError({
          code: "INVALID_INPUT",
          message: "Select an existing clinic user or provide a dentist email to invite.",
        });
      }
      const existingByEmail = await ctx.db
        .query("users")
        .withIndex("by_email", (q) => q.eq("email", email))
        .first();

      if (existingByEmail) {
        if (existingByEmail.clinicId && existingByEmail.clinicId !== clinicId) {
          throw new ConvexError({
            code: "CONFLICT",
            message: "This email is already assigned to another clinic.",
          });
        }
        const existingProfile = await ctx.db
          .query("dentists")
          .withIndex("by_user", (q) => q.eq("userId", existingByEmail._id))
          .unique();
        if (existingProfile) {
          throw new ConvexError({
            code: "CONFLICT",
            message: "A dentist profile already exists for this email.",
          });
        }
        targetUserId = existingByEmail._id;
      } else {
        const nameParts = displayName.replace(/^Dr\.?\s*/i, "").split(/\s+/);
        const firstName = nameParts[0] || "Dr.";
        const lastName = nameParts.slice(1).join(" ") || "Dentist";
        targetUserId = await ctx.db.insert("users", {
          clerkId: `pending:${clinicId}:${email}`,
          email,
          firstName,
          lastName,
          role: "dentist",
          clinicId,
          isActive: false, // Inactive until real Clerk webhook activates on sign-up
          createdAt: now,
        });
      }

      const existingInvites = await ctx.db
        .query("staffInvitations")
        .withIndex("by_email_and_status", (q) =>
          q.eq("email", email).eq("status", "pending")
        )
        .collect();
      for (const inv of existingInvites) {
        if (inv.clinicId === clinicId) {
          await ctx.db.patch(inv._id, { status: "revoked" });
        }
      }

      const token = generateInviteToken();
      const invitationId = await ctx.db.insert("staffInvitations", {
        clinicId,
        email,
        role: "dentist",
        token,
        invitedByUserId: actor._id,
        status: "pending",
        emailStatus: "queued",
        expiresAt: now + 7 * DAY_MS,
        createdAt: now,
      });

      await ctx.scheduler.runAfter(
        0,
        internal.notifications.sendRoleInvitationEmail,
        { invitationId }
      );
    }

    const color = HEX_COLOR_REGEX.test(args.calendarColorHex.trim())
      ? args.calendarColorHex.trim()
      : "#0284c7";

    const dentistId = await ctx.db.insert("dentists", {
      clinicId,
      userId: targetUserId,
      displayName,
      licenseNumber,
      specialties: args.specialties
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
      bio: args.bio?.trim() || undefined,
      calendarColorHex: color,
      defaultChairId: args.defaultChairId,
      weeklySchedule: args.weeklySchedule,
      isActive: true,
    });

    await ctx.db.patch(clinicId, {
      activeDentistCount: clinic.activeDentistCount + 1,
      updatedAt: now,
    });

    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      clinicId,
      actionType: "DENTIST_CREATED",
      targetEntity: "dentists",
      targetId: dentistId,
      metadata: { displayName, licenseNumber },
    });

    return { dentistId };
  },
});

export const updateDentist = mutation({
  args: {
    dentistId: v.id("dentists"),
    displayName: v.string(),
    licenseNumber: v.string(),
    specialties: v.array(v.string()),
    bio: v.optional(v.string()),
    calendarColorHex: v.string(),
    defaultChairId: v.optional(v.id("chairs")),
    weeklySchedule: v.array(weeklyScheduleDayValidator),
  },
  handler: async (ctx, args) => {
    const { user: actor, clinicId } = await requireClinicAdminWrite(ctx, "staff");

    const dentist = await ctx.db.get(args.dentistId);
    if (!dentist || dentist.clinicId !== clinicId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Dentist not found." });
    }

    const displayName = args.displayName.trim();
    const licenseNumber = args.licenseNumber.trim();
    if (displayName.length < 2) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Dentist display name must be at least 2 characters.",
      });
    }
    if (!licenseNumber) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "PRC / dental license number is required.",
      });
    }

    validateWeeklySchedule(args.weeklySchedule);

    if (args.defaultChairId) {
      const chair = await ctx.db.get(args.defaultChairId);
      if (!chair || chair.clinicId !== clinicId) {
        throw new ConvexError({
          code: "NOT_FOUND",
          message: "Selected default chair does not belong to this clinic.",
        });
      }
    }

    const color = HEX_COLOR_REGEX.test(args.calendarColorHex.trim())
      ? args.calendarColorHex.trim()
      : dentist.calendarColorHex;

    await ctx.db.patch(args.dentistId, {
      displayName,
      licenseNumber,
      specialties: args.specialties
        .map((s) => s.trim())
        .filter((s) => s.length > 0),
      bio: args.bio?.trim() || undefined,
      calendarColorHex: color,
      defaultChairId: args.defaultChairId,
      weeklySchedule: args.weeklySchedule,
    });

    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      clinicId,
      actionType: "DENTIST_UPDATED",
      targetEntity: "dentists",
      targetId: args.dentistId,
      metadata: { displayName, licenseNumber },
    });

    return { dentistId: args.dentistId };
  },
});

export const toggleDentistActive = mutation({
  args: {
    dentistId: v.id("dentists"),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { user: actor, clinic, clinicId } = await requireClinicAdminWrite(
      ctx,
      args.isActive ? "dentist" : "staff"
    );

    const dentist = await ctx.db.get(args.dentistId);
    if (!dentist || dentist.clinicId !== clinicId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Dentist not found." });
    }
    if (dentist.isActive === args.isActive) {
      return { dentistId: args.dentistId, isActive: args.isActive };
    }

    await ctx.db.patch(args.dentistId, { isActive: args.isActive });
    await ctx.db.patch(clinicId, {
      activeDentistCount: Math.max(
        0,
        clinic.activeDentistCount + (args.isActive ? 1 : -1)
      ),
      updatedAt: Date.now(),
    });

    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      clinicId,
      actionType: args.isActive ? "DENTIST_REACTIVATED" : "DENTIST_DEACTIVATED",
      targetEntity: "dentists",
      targetId: args.dentistId,
      metadata: { displayName: dentist.displayName },
    });

    return { dentistId: args.dentistId, isActive: args.isActive };
  },
});

export const addDentistTimeOff = mutation({
  args: {
    dentistId: v.id("dentists"),
    startTimeUtc: v.number(),
    endTimeUtc: v.number(),
    reason: v.string(),
  },
  handler: async (ctx, args) => {
    const { user: actor, clinicId } = await requireClinicAdminWrite(ctx, "staff");

    const dentist = await ctx.db.get(args.dentistId);
    if (!dentist || dentist.clinicId !== clinicId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Dentist not found." });
    }
    if (args.endTimeUtc <= args.startTimeUtc) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Time-off end must be after start.",
      });
    }

    const overlappingCandidates = await ctx.db
      .query("appointments")
      .withIndex("by_dentist_and_start", (q) =>
        q
          .eq("dentistId", args.dentistId)
          .gte("startTimeUtc", args.startTimeUtc - 12 * 60 * 60 * 1000)
          .lt("startTimeUtc", args.endTimeUtc)
      )
      .take(200);
    const overlappingCount = overlappingCandidates.filter(
      (a) =>
        a.clinicId === clinicId &&
        a.status !== "cancelled" &&
        a.status !== "no_show" &&
        a.status !== "completed" &&
        a.startTimeUtc < args.endTimeUtc &&
        a.endTimeUtc > args.startTimeUtc
    ).length;

    const reason = args.reason.trim() || "Scheduled leave";
    const timeOffId = await ctx.db.insert("dentistTimeOff", {
      clinicId,
      dentistId: args.dentistId,
      startTimeUtc: args.startTimeUtc,
      endTimeUtc: args.endTimeUtc,
      reason,
      createdByUserId: actor._id,
    });

    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      clinicId,
      actionType: "DENTIST_TIME_OFF_CREATED",
      targetEntity: "dentistTimeOff",
      targetId: timeOffId,
      metadata: {
        dentistId: args.dentistId,
        startTimeUtc: args.startTimeUtc,
        endTimeUtc: args.endTimeUtc,
        reason,
        overlappingAppointmentCount: overlappingCount,
      },
    });

    return { timeOffId, overlappingCount };
  },
});

export const deleteDentistTimeOff = mutation({
  args: { timeOffId: v.id("dentistTimeOff") },
  handler: async (ctx, args) => {
    const { clinicId } = await requireClinicAdminWrite(ctx, "staff");
    const row = await ctx.db.get(args.timeOffId);
    if (!row || row.clinicId !== clinicId) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Time-off block not found.",
      });
    }
    await ctx.db.delete(args.timeOffId);
    return { deleted: true };
  },
});

// ============================================================================
// 3. OPERATORY CHAIRS
// ============================================================================

export const listChairs = query({
  args: { overrideClinicId: v.optional(v.id("clinics")) },
  handler: async (ctx, args) => {
    const { clinicId } = await requireClinicAccess(
      ctx,
      ["clinic_admin"],
      args.overrideClinicId
    );

    const [activeChairs, inactiveChairs] = await Promise.all([
      ctx.db
        .query("chairs")
        .withIndex("by_clinic", (q) =>
          q.eq("clinicId", clinicId).eq("isActive", true)
        )
        .collect(),
      ctx.db
        .query("chairs")
        .withIndex("by_clinic", (q) =>
          q.eq("clinicId", clinicId).eq("isActive", false)
        )
        .collect(),
    ]);

    return [...activeChairs, ...inactiveChairs];
  },
});

export const createChair = mutation({
  args: {
    name: v.string(),
    roomCode: v.string(),
    supportedCategoryTags: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    // Enforces maxChairs plan quota (throws QUOTA_EXCEEDED)
    const { user: actor, clinic, clinicId } = await requireClinicAdminWrite(
      ctx,
      "chair"
    );

    const name = args.name.trim();
    const roomCode = args.roomCode.trim().toUpperCase();
    if (name.length < 2 || !roomCode) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Chair name and room code are required.",
      });
    }

    const [activeChairs, inactiveChairs] = await Promise.all([
      ctx.db
        .query("chairs")
        .withIndex("by_clinic", (q) =>
          q.eq("clinicId", clinicId).eq("isActive", true)
        )
        .collect(),
      ctx.db
        .query("chairs")
        .withIndex("by_clinic", (q) =>
          q.eq("clinicId", clinicId).eq("isActive", false)
        )
        .collect(),
    ]);
    if (
      [...activeChairs, ...inactiveChairs].some(
        (c) => c.roomCode.trim().toUpperCase() === roomCode
      )
    ) {
      throw new ConvexError({
        code: "CONFLICT",
        message: `Room code "${roomCode}" is already assigned to another chair in this clinic.`,
      });
    }

    const chairId = await ctx.db.insert("chairs", {
      clinicId,
      name,
      roomCode,
      supportedCategoryTags: args.supportedCategoryTags
        .map((t) => t.trim())
        .filter(Boolean),
      isActive: true,
    });

    await ctx.db.patch(clinicId, {
      activeChairCount: clinic.activeChairCount + 1,
      updatedAt: Date.now(),
    });

    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      clinicId,
      actionType: "CHAIR_CREATED",
      targetEntity: "chairs",
      targetId: chairId,
      metadata: { name, roomCode },
    });

    return { chairId };
  },
});

export const updateChair = mutation({
  args: {
    chairId: v.id("chairs"),
    name: v.string(),
    roomCode: v.string(),
    supportedCategoryTags: v.array(v.string()),
  },
  handler: async (ctx, args) => {
    const { user: actor, clinicId } = await requireClinicAdminWrite(ctx, "staff");
    const chair = await ctx.db.get(args.chairId);
    if (!chair || chair.clinicId !== clinicId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Chair not found." });
    }

    const name = args.name.trim();
    const roomCode = args.roomCode.trim().toUpperCase();
    if (name.length < 2 || !roomCode) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Chair name and room code are required.",
      });
    }

    const [activeChairs, inactiveChairs] = await Promise.all([
      ctx.db
        .query("chairs")
        .withIndex("by_clinic", (q) =>
          q.eq("clinicId", clinicId).eq("isActive", true)
        )
        .collect(),
      ctx.db
        .query("chairs")
        .withIndex("by_clinic", (q) =>
          q.eq("clinicId", clinicId).eq("isActive", false)
        )
        .collect(),
    ]);
    if (
      [...activeChairs, ...inactiveChairs].some(
        (c) =>
          c._id !== args.chairId &&
          c.roomCode.trim().toUpperCase() === roomCode
      )
    ) {
      throw new ConvexError({
        code: "CONFLICT",
        message: `Room code "${roomCode}" is already assigned to another chair in this clinic.`,
      });
    }

    await ctx.db.patch(args.chairId, {
      name,
      roomCode,
      supportedCategoryTags: args.supportedCategoryTags
        .map((t) => t.trim())
        .filter(Boolean),
    });

    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      clinicId,
      actionType: "CHAIR_UPDATED",
      targetEntity: "chairs",
      targetId: args.chairId,
      metadata: { name, roomCode },
    });

    return { chairId: args.chairId };
  },
});

export const toggleChairActive = mutation({
  args: {
    chairId: v.id("chairs"),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { user: actor, clinic, clinicId } = await requireClinicAdminWrite(
      ctx,
      args.isActive ? "chair" : "staff"
    );

    const chair = await ctx.db.get(args.chairId);
    if (!chair || chair.clinicId !== clinicId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Chair not found." });
    }
    if (chair.isActive === args.isActive) {
      return {
        chairId: args.chairId,
        isActive: args.isActive,
        upcomingAppointmentsCount: 0,
      };
    }

    const now = Date.now();
    let upcomingAppointmentsCount = 0;
    if (!args.isActive) {
      const upcoming = await ctx.db
        .query("appointments")
        .withIndex("by_chair_and_start", (q) =>
          q.eq("chairId", args.chairId).gte("startTimeUtc", now)
        )
        .take(100);
      for (const appt of upcoming) {
        if (
          appt.clinicId === clinicId &&
          appt.status !== "cancelled" &&
          appt.status !== "no_show" &&
          appt.status !== "completed"
        ) {
          upcomingAppointmentsCount++;
        }
      }
    }

    await ctx.db.patch(args.chairId, { isActive: args.isActive });
    await ctx.db.patch(clinicId, {
      activeChairCount: Math.max(
        0,
        clinic.activeChairCount + (args.isActive ? 1 : -1)
      ),
      updatedAt: now,
    });

    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      clinicId,
      actionType: args.isActive ? "CHAIR_REACTIVATED" : "CHAIR_DEACTIVATED",
      targetEntity: "chairs",
      targetId: args.chairId,
      metadata: {
        name: chair.name,
        roomCode: chair.roomCode,
        upcomingAppointmentsCount,
      },
    });

    return {
      chairId: args.chairId,
      isActive: args.isActive,
      upcomingAppointmentsCount,
    };
  },
});

// ============================================================================
// 4. DENTAL SERVICES CATALOG
// ============================================================================

export const listServices = query({
  args: { overrideClinicId: v.optional(v.id("clinics")) },
  handler: async (ctx, args) => {
    const { clinicId } = await requireClinicAccess(
      ctx,
      ["clinic_admin"],
      args.overrideClinicId
    );

    return await ctx.db
      .query("services")
      .withIndex("by_clinic_and_category", (q) => q.eq("clinicId", clinicId))
      .collect();
  },
});

export const createService = mutation({
  args: {
    name: v.string(),
    category: serviceCategoryValidator,
    description: v.string(),
    durationMinutes: v.number(),
    bufferMinutes: v.number(),
    pricePhp: v.number(),
    requiresXray: v.boolean(),
    requiredChairTag: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user: actor, clinicId } = await requireClinicAdminWrite(ctx, "staff");

    const name = args.name.trim();
    const description = args.description.trim();
    if (name.length < 2 || description.length < 2) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Procedure name and description must be at least 2 characters.",
      });
    }
    if (args.durationMinutes < 5 || args.bufferMinutes < 0 || args.pricePhp < 0) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Duration must be at least 5 minutes and buffer/price cannot be negative.",
      });
    }

    const serviceId = await ctx.db.insert("services", {
      clinicId,
      name,
      category: args.category,
      description,
      durationMinutes: args.durationMinutes,
      bufferMinutes: args.bufferMinutes,
      pricePhp: args.pricePhp,
      requiresXray: args.requiresXray,
      requiredChairTag: args.requiredChairTag?.trim() || undefined,
      isActive: true,
    });

    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      clinicId,
      actionType: "SERVICE_CREATED",
      targetEntity: "services",
      targetId: serviceId,
      metadata: { name, category: args.category, pricePhp: args.pricePhp },
    });

    return { serviceId };
  },
});

export const updateService = mutation({
  args: {
    serviceId: v.id("services"),
    name: v.string(),
    category: serviceCategoryValidator,
    description: v.string(),
    durationMinutes: v.number(),
    bufferMinutes: v.number(),
    pricePhp: v.number(),
    requiresXray: v.boolean(),
    requiredChairTag: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const { user: actor, clinicId } = await requireClinicAdminWrite(ctx, "staff");
    const service = await ctx.db.get(args.serviceId);
    if (!service || service.clinicId !== clinicId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Service not found." });
    }

    const name = args.name.trim();
    const description = args.description.trim();
    if (name.length < 2 || description.length < 2) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Procedure name and description must be at least 2 characters.",
      });
    }
    if (args.durationMinutes < 5 || args.bufferMinutes < 0 || args.pricePhp < 0) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Duration must be at least 5 minutes and buffer/price cannot be negative.",
      });
    }

    await ctx.db.patch(args.serviceId, {
      name,
      category: args.category,
      description,
      durationMinutes: args.durationMinutes,
      bufferMinutes: args.bufferMinutes,
      pricePhp: args.pricePhp,
      requiresXray: args.requiresXray,
      requiredChairTag: args.requiredChairTag?.trim() || undefined,
    });

    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      clinicId,
      actionType: "SERVICE_UPDATED",
      targetEntity: "services",
      targetId: args.serviceId,
      metadata: { name, category: args.category, pricePhp: args.pricePhp },
    });

    return { serviceId: args.serviceId };
  },
});

export const toggleServiceActive = mutation({
  args: {
    serviceId: v.id("services"),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { user: actor, clinicId } = await requireClinicAdminWrite(ctx, "staff");
    const service = await ctx.db.get(args.serviceId);
    if (!service || service.clinicId !== clinicId) {
      throw new ConvexError({ code: "NOT_FOUND", message: "Service not found." });
    }
    await ctx.db.patch(args.serviceId, { isActive: args.isActive });

    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      clinicId,
      actionType: args.isActive ? "SERVICE_REACTIVATED" : "SERVICE_DEACTIVATED",
      targetEntity: "services",
      targetId: args.serviceId,
      metadata: { name: service.name },
    });

    return { serviceId: args.serviceId, isActive: args.isActive };
  },
});

export const seedDefaultServices = mutation({
  args: {},
  handler: async (ctx) => {
    const { clinicId } = await requireClinicAdminWrite(ctx, "staff");
    const existing = await ctx.db
      .query("services")
      .withIndex("by_clinic_and_category", (q) => q.eq("clinicId", clinicId))
      .collect();
    const existingNames = new Set(existing.map((s) => s.name.toLowerCase()));

    let created = 0;
    for (const svc of DEFAULT_SERVICE_CATALOG) {
      if (existingNames.has(svc.name.toLowerCase())) continue;
      await ctx.db.insert("services", {
        clinicId,
        name: svc.name,
        category: svc.category,
        description: svc.description,
        durationMinutes: svc.durationMinutes,
        bufferMinutes: svc.bufferMinutes,
        pricePhp: svc.pricePhp,
        requiresXray: svc.requiresXray,
        requiredChairTag:
          "requiredChairTag" in svc ? svc.requiredChairTag : undefined,
        isActive: true,
      });
      created++;
    }
    return { created };
  },
});

// ============================================================================
// 5. STAFF & INVITATIONS
// ============================================================================

export const listStaff = query({
  args: { overrideClinicId: v.optional(v.id("clinics")) },
  handler: async (ctx, args) => {
    const { user, clinicId } = await requireClinicAccess(
      ctx,
      ["clinic_admin"],
      args.overrideClinicId
    );

    const [users, pendingInvitations, acceptedInvitations, declinedInvitations] =
      await Promise.all([
        ctx.db
          .query("users")
          .withIndex("by_clinic_and_role", (q) => q.eq("clinicId", clinicId))
          .collect(),
        ctx.db
          .query("staffInvitations")
          .withIndex("by_clinic", (q) =>
            q.eq("clinicId", clinicId).eq("status", "pending")
          )
          .collect(),
        ctx.db
          .query("staffInvitations")
          .withIndex("by_clinic", (q) =>
            q.eq("clinicId", clinicId).eq("status", "accepted")
          )
          .collect(),
        ctx.db
          .query("staffInvitations")
          .withIndex("by_clinic", (q) =>
            q.eq("clinicId", clinicId).eq("status", "declined")
          )
          .order("desc")
          .take(10),
      ]);

    const realStaff = [];
    for (const u of users) {
      if (u.clerkId.startsWith("pending:")) continue;
      realStaff.push({
        _id: u._id,
        email: u.email,
        firstName: u.firstName,
        lastName: u.lastName,
        role: u.role,
        isActive: u.isActive,
        lastLoginAt: u.lastLoginAt ?? null,
        createdAt: u.createdAt,
      });
    }

    return {
      currentUserId: user._id,
      staff: realStaff,
      pendingInvitations: pendingInvitations.sort(
        (a, b) => b.createdAt - a.createdAt
      ),
      declinedInvitations,
      acceptedCount: acceptedInvitations.length,
    };
  },
});

export const inviteStaff = mutation({
  args: {
    email: v.string(),
    role: v.union(
      v.literal("clinic_admin"),
      v.literal("dentist"),
      v.literal("receptionist")
    ),
  },
  handler: async (ctx, args) => {
    // Enforce maxDentists upfront when inviting a dentist so acceptance never silently skips profile creation
    const { user: actor, clinicId } = await requireClinicAdminWrite(
      ctx,
      args.role === "dentist" ? "dentist" : "staff"
    );

    const email = args.email.trim().toLowerCase();
    if (!email || !email.includes("@")) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Provide a valid staff email address.",
      });
    }

    const existingUsers = await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", email))
      .take(5);
    for (const existingUser of existingUsers) {
      if (existingUser.clinicId && existingUser.clinicId !== clinicId) {
        throw new ConvexError({
          code: "CONFLICT",
          message: "This email is already assigned to another dental clinic.",
        });
      }
      if (
        existingUser.clinicId === clinicId &&
        !existingUser.clerkId.startsWith("pending:") &&
        existingUser.isActive &&
        existingUser.role === args.role
      ) {
        throw new ConvexError({
          code: "CONFLICT",
          message: "This person is already an active staff member with this role.",
        });
      }
    }

    const now = Date.now();
    const existingPending = await ctx.db
      .query("staffInvitations")
      .withIndex("by_email_and_status", (q) =>
        q.eq("email", email).eq("status", "pending")
      )
      .collect();

    for (const inv of existingPending) {
      if (inv.clinicId === clinicId) {
        await ctx.db.patch(inv._id, { status: "revoked" });
      }
    }

    const token = generateInviteToken();
    const invitationId = await ctx.db.insert("staffInvitations", {
      clinicId,
      email,
      role: args.role,
      token,
      invitedByUserId: actor._id,
      status: "pending",
      emailStatus: "queued",
      expiresAt: now + 7 * DAY_MS,
      createdAt: now,
    });

    await ctx.scheduler.runAfter(
      0,
      internal.notifications.sendRoleInvitationEmail,
      { invitationId }
    );

    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      clinicId,
      actionType: "STAFF_INVITED",
      targetEntity: "staffInvitations",
      targetId: invitationId,
      metadata: { email, role: args.role },
    });

    return { invitationId, token };
  },
});

export const resendStaffInvitation = mutation({
  args: { invitationId: v.id("staffInvitations") },
  handler: async (ctx, args) => {
    const { user: actor, clinicId } = await requireClinicAdminWrite(ctx, "staff");
    const inv = await ctx.db.get(args.invitationId);
    if (!inv || inv.clinicId !== clinicId) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Invitation not found.",
      });
    }
    if (inv.status !== "pending") {
      throw new ConvexError({
        code: "INVALID_STATE",
        message: `Cannot resend an invitation that is already ${inv.status}.`,
      });
    }

    const now = Date.now();
    const token = inv.token || generateInviteToken();
    await ctx.db.patch(args.invitationId, {
      token,
      emailStatus: "queued",
      emailError: undefined,
      expiresAt: now + 7 * DAY_MS,
    });

    await ctx.scheduler.runAfter(
      0,
      internal.notifications.sendRoleInvitationEmail,
      { invitationId: args.invitationId }
    );

    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      clinicId,
      actionType: "STAFF_INVITATION_RESENT",
      targetEntity: "staffInvitations",
      targetId: args.invitationId,
      metadata: { email: inv.email, role: inv.role },
    });

    return { invitationId: args.invitationId, token };
  },
});

export const revokeStaffInvitation = mutation({
  args: { invitationId: v.id("staffInvitations") },
  handler: async (ctx, args) => {
    const { user: actor, clinicId } = await requireClinicAdminWrite(ctx, "staff");
    const inv = await ctx.db.get(args.invitationId);
    if (!inv || inv.clinicId !== clinicId) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Invitation not found.",
      });
    }

    await ctx.db.patch(args.invitationId, { status: "revoked" });
    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      clinicId,
      actionType: "STAFF_INVITATION_REVOKED",
      targetEntity: "staffInvitations",
      targetId: args.invitationId,
      metadata: { email: inv.email, role: inv.role },
    });

    return { revoked: true };
  },
});

export const toggleStaffActive = mutation({
  args: {
    userId: v.id("users"),
    isActive: v.boolean(),
  },
  handler: async (ctx, args) => {
    const { user: actor, clinic, clinicId } = await requireClinicAdminWrite(
      ctx,
      "staff"
    );
    if (args.userId === actor._id) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "You cannot deactivate your own account.",
      });
    }
    const target = await ctx.db.get(args.userId);
    if (!target || target.clinicId !== clinicId) {
      throw new ConvexError({
        code: "NOT_FOUND",
        message: "Staff member not found.",
      });
    }

    const now = Date.now();
    await ctx.db.patch(args.userId, { isActive: args.isActive });

    // Cascade deactivation to any active linked dentist profile so patients cannot book a deactivated staff dentist
    let deactivatedDentistProfile = false;
    if (!args.isActive) {
      const linkedDentists = await ctx.db
        .query("dentists")
        .withIndex("by_user", (q) => q.eq("userId", args.userId))
        .take(5);
      let activeCountDelta = 0;
      for (const d of linkedDentists) {
        if (d.clinicId === clinicId && d.isActive) {
          await ctx.db.patch(d._id, { isActive: false });
          activeCountDelta++;
          deactivatedDentistProfile = true;
          await recordAuditLog(ctx, {
            actorUserId: actor._id,
            actorRole: actor.role,
            clinicId,
            actionType: "DENTIST_DEACTIVATED",
            targetEntity: "dentists",
            targetId: d._id,
            metadata: {
              displayName: d.displayName,
              reason: "Cascaded from staff account deactivation",
            },
          });
        }
      }
      if (activeCountDelta > 0) {
        await ctx.db.patch(clinicId, {
          activeDentistCount: Math.max(
            0,
            clinic.activeDentistCount - activeCountDelta
          ),
          updatedAt: now,
        });
      }
    }

    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      clinicId,
      actionType: args.isActive ? "STAFF_REACTIVATED" : "STAFF_DEACTIVATED",
      targetEntity: "users",
      targetId: args.userId,
      metadata: {
        email: target.email,
        role: target.role,
        deactivatedDentistProfile,
      },
    });

    return {
      userId: args.userId,
      isActive: args.isActive,
      deactivatedDentistProfile,
    };
  },
});

// ============================================================================
// 6. CLINIC SETTINGS, BRANDING & OPERATING HOURS
// ============================================================================

export const generateLogoUploadUrl = mutation({
  args: {
    fileSizeBytes: v.optional(v.number()),
  },
  handler: async (ctx, args) => {
    const { clinic } = await requireClinicAdminWrite(ctx, "storage");
    assertClinicFeatureEnabled(clinic, "customBrandingEnabled");

    if (args.fileSizeBytes !== undefined) {
      if (args.fileSizeBytes <= 0 || args.fileSizeBytes > MAX_LOGO_BYTES) {
        throw new ConvexError({
          code: "FILE_TOO_LARGE",
          message: "Clinic logo must be 500 KB or smaller.",
        });
      }
      const plan = await ctx.db.get(clinic.planId);
      const oldLogoMeta = clinic.logoStorageId
        ? await ctx.db.system.get("_storage", clinic.logoStorageId)
        : null;
      const oldLogoBytes = oldLogoMeta?.size ?? 0;
      const projectedBytes = Math.max(
        0,
        clinic.storageUsedBytes - oldLogoBytes + args.fileSizeBytes
      );
      if (plan && projectedBytes > plan.maxStorageBytes) {
        throw new ConvexError({
          code: "QUOTA_EXCEEDED",
          message: "Uploading this logo would exceed your clinic's storage quota.",
        });
      }
    }

    return await ctx.storage.generateUploadUrl();
  },
});

export const updateClinicSettings = mutation({
  args: {
    name: v.string(),
    slug: v.optional(v.string()),
    tagline: v.optional(v.string()),
    primaryColorHex: v.string(),
    logoStorageId: v.optional(v.id("_storage")),
    logoSizeBytes: v.optional(v.number()),
    removeLogo: v.optional(v.boolean()),
    email: v.string(),
    phone: v.string(),
    address: v.string(),
    city: v.string(),
    province: v.string(),
    timezone: v.string(),
    slotIntervalMinutes: v.number(),
    cancellationWindowHours: v.number(),
    emergencyBufferMinutesPerDay: v.number(),
    requireBookingApproval: v.optional(v.boolean()),
    operatingHours: v.array(operatingHoursDayValidator),
  },
  handler: async (ctx, args) => {
    const { user: actor, clinic, clinicId } = await requireClinicAdminWrite(
      ctx,
      "staff"
    );

    const name = args.name.trim();
    if (name.length < 2) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: "Clinic name must be at least 2 characters.",
      });
    }

    const timeZone = args.timezone.trim() || "Asia/Manila";
    if (!isValidIanaTimeZone(timeZone)) {
      throw new ConvexError({
        code: "INVALID_INPUT",
        message: `Invalid IANA timezone "${timeZone}". Example: Asia/Manila`,
      });
    }

    validateOperatingHours(args.operatingHours);

    // Optional public slug update with strict format + global uniqueness check
    let nextSlug = clinic.slug;
    if (args.slug !== undefined) {
      const cleanedSlug = args.slug.trim().toLowerCase();
      if (!SLUG_REGEX.test(cleanedSlug) || cleanedSlug.length < 2) {
        throw new ConvexError({
          code: "INVALID_INPUT",
          message:
            "Public slug must be at least 2 characters using lowercase letters, numbers, and hyphens only.",
        });
      }
      if (cleanedSlug !== clinic.slug) {
        const existingWithSlug = await ctx.db
          .query("clinics")
          .withIndex("by_slug", (q) => q.eq("slug", cleanedSlug))
          .unique();
        if (existingWithSlug && existingWithSlug._id !== clinicId) {
          throw new ConvexError({
            code: "SLUG_TAKEN",
            message: `Public booking URL "/c/${cleanedSlug}" is already taken by another clinic.`,
          });
        }
        nextSlug = cleanedSlug;
      }
    }

    const nextColor = HEX_COLOR_REGEX.test(args.primaryColorHex.trim())
      ? args.primaryColorHex.trim()
      : clinic.primaryColorHex;

    const isUploadingNewLogo =
      !args.removeLogo &&
      args.logoStorageId !== undefined &&
      args.logoStorageId !== clinic.logoStorageId;
    const isRemovingLogo = Boolean(args.removeLogo && clinic.logoStorageId);

    const changingBranding =
      nextColor.toLowerCase() !== clinic.primaryColorHex.toLowerCase() ||
      isUploadingNewLogo ||
      isRemovingLogo;

    if (changingBranding) {
      assertClinicFeatureEnabled(clinic, "customBrandingEnabled");
    }

    let nextLogoStorageId: Id<"_storage"> | undefined = clinic.logoStorageId;
    let nextStorageUsedBytes = clinic.storageUsedBytes;

    if (isUploadingNewLogo && args.logoStorageId) {
      const newLogoStorageId = args.logoStorageId;
      const discardNewLogo = async () => {
        try {
          await ctx.storage.delete(newLogoStorageId);
        } catch {
          // Safe to ignore if already removed
        }
      };

      const newMeta = await ctx.db.system.get("_storage", newLogoStorageId);
      if (!newMeta) {
        throw new ConvexError({
          code: "NOT_FOUND",
          message: "Uploaded logo could not be verified in storage. Please retry.",
        });
      }
      if (newMeta.size <= 0 || newMeta.size > MAX_LOGO_BYTES) {
        await discardNewLogo();
        throw new ConvexError({
          code: "FILE_TOO_LARGE",
          message: "Clinic logo exceeded the 500 KB limit and was discarded.",
        });
      }

      const oldMeta = clinic.logoStorageId
        ? await ctx.db.system.get("_storage", clinic.logoStorageId)
        : null;
      const oldBytes = oldMeta?.size ?? 0;
      const projectedBytes = Math.max(
        0,
        clinic.storageUsedBytes - oldBytes + newMeta.size
      );
      const plan = await ctx.db.get(clinic.planId);
      if (plan && projectedBytes > plan.maxStorageBytes) {
        await discardNewLogo();
        throw new ConvexError({
          code: "QUOTA_EXCEEDED",
          message: "Uploading this logo would exceed your clinic's storage quota.",
        });
      }

      if (clinic.logoStorageId) {
        try {
          await ctx.storage.delete(clinic.logoStorageId);
        } catch {
          // Old blob already missing
        }
      }

      nextLogoStorageId = newLogoStorageId;
      nextStorageUsedBytes = projectedBytes;
    } else if (isRemovingLogo && clinic.logoStorageId) {
      const oldMeta = await ctx.db.system.get("_storage", clinic.logoStorageId);
      const oldBytes = oldMeta?.size ?? 0;
      try {
        await ctx.storage.delete(clinic.logoStorageId);
      } catch {
        // Already removed
      }
      nextLogoStorageId = undefined;
      nextStorageUsedBytes = Math.max(0, clinic.storageUsedBytes - oldBytes);
    }

    await ctx.db.patch(clinicId, {
      name,
      slug: nextSlug,
      tagline: args.tagline?.trim() || undefined,
      primaryColorHex: nextColor,
      logoStorageId: nextLogoStorageId,
      storageUsedBytes: nextStorageUsedBytes,
      email: args.email.trim().toLowerCase(),
      phone: args.phone.trim(),
      address: args.address.trim(),
      city: args.city.trim(),
      province: args.province.trim(),
      timezone: timeZone,
      slotIntervalMinutes: args.slotIntervalMinutes === 15 ? 15 : 30,
      cancellationWindowHours: Math.max(0, args.cancellationWindowHours),
      emergencyBufferMinutesPerDay: Math.max(
        0,
        args.emergencyBufferMinutesPerDay
      ),
      requireBookingApproval:
        args.requireBookingApproval !== undefined
          ? args.requireBookingApproval
          : clinic.requireBookingApproval ?? false,
      operatingHours: args.operatingHours,
      updatedAt: Date.now(),
    });

    await recordAuditLog(ctx, {
      actorUserId: actor._id,
      actorRole: actor.role,
      clinicId,
      actionType: "CLINIC_SETTINGS_UPDATED",
      targetEntity: "clinics",
      targetId: clinicId,
      metadata: {
        name,
        slug: nextSlug,
        slugChanged: nextSlug !== clinic.slug,
        timezone: timeZone,
        slotIntervalMinutes: args.slotIntervalMinutes === 15 ? 15 : 30,
        requireBookingApproval:
          args.requireBookingApproval ?? clinic.requireBookingApproval ?? false,
      },
    });

    return { clinicId, slug: nextSlug };
  },
});
