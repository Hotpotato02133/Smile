import { v } from "convex/values";
import { internal } from "./_generated/api";
import type { Doc, Id } from "./_generated/dataModel";
import { internalMutation } from "./_generated/server";
import {
  DAY_MS,
  GRACE_PERIOD_MS,
  toManilaDateKey,
  toManilaMonthKey,
} from "./lib/audit";

function monthlyContributionPhp(
  clinic: Doc<"clinics">,
  plan: Doc<"subscriptionPlans"> | undefined
): number {
  if (!plan || (clinic.status !== "active" && clinic.status !== "past_due")) {
    return 0;
  }
  if (clinic.billingCycle === "annual") {
    return Math.round(plan.annualPricePhp / 12);
  }
  if (clinic.billingCycle === "monthly") {
    return plan.monthlyPricePhp;
  }
  return 0;
}

/**
 * Daily cron 1: Transitions expired trials/active subscriptions to `past_due` (3-day grace),
 * suspends `past_due` clinics after their grace window expires, resets monthly counters on
 * calendar rollover, and fires renewal/suspension alert emails via Resend.
 */
export const sweepSubscriptions = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const currentMonthKey = toManilaMonthKey(now);

    const [expiredByDate, pastDueClinics, allClinics] = await Promise.all([
      ctx.db
        .query("clinics")
        .withIndex("by_subscription_end", (q) => q.lte("subscriptionEndsAt", now))
        .collect(),
      ctx.db
        .query("clinics")
        .withIndex("by_status", (q) => q.eq("status", "past_due"))
        .collect(),
      ctx.db.query("clinics").collect(),
    ]);

    let transitionedToPastDue = 0;
    let transitionedToSuspended = 0;
    let monthlyCountersReset = 0;

    // 1. Expired trial / active -> past_due (with 3-day grace period)
    for (const clinic of expiredByDate) {
      if (clinic.status !== "trial" && clinic.status !== "active") continue;
      const gracePeriodEndsAt = now + GRACE_PERIOD_MS;
      await ctx.db.patch(clinic._id, {
        status: "past_due",
        gracePeriodEndsAt,
        updatedAt: now,
      });
      transitionedToPastDue++;

      await ctx.scheduler.runAfter(
        0,
        internal.notifications.sendSubscriptionStatusAlert,
        {
          clinicId: clinic._id,
          clinicName: clinic.name,
          clinicEmail: clinic.email,
          newStatus: "past_due",
          subscriptionEndsAt: clinic.subscriptionEndsAt,
          gracePeriodEndsAt,
        }
      );
    }

    // 2. Grace-period expired past_due -> suspended (Read-Only Mode)
    for (const clinic of pastDueClinics) {
      const graceEnd =
        clinic.gracePeriodEndsAt ?? clinic.subscriptionEndsAt + GRACE_PERIOD_MS;
      if (now <= graceEnd) continue;

      await ctx.db.patch(clinic._id, {
        status: "suspended",
        updatedAt: now,
      });
      transitionedToSuspended++;

      await ctx.scheduler.runAfter(
        0,
        internal.notifications.sendSubscriptionStatusAlert,
        {
          clinicId: clinic._id,
          clinicName: clinic.name,
          clinicEmail: clinic.email,
          newStatus: "suspended",
          subscriptionEndsAt: clinic.subscriptionEndsAt,
        }
      );
    }

    // 3. Roll over monthly appointment & email quota counters on the 1st of a new month
    for (const clinic of allClinics) {
      if (clinic.currentMonthKey !== currentMonthKey) {
        await ctx.db.patch(clinic._id, {
          currentMonthKey,
          currentMonthAppointmentCount: 0,
          currentMonthEmailCount: 0,
          updatedAt: now,
        });
        monthlyCountersReset++;
      }
    }

    return {
      transitionedToPastDue,
      transitionedToSuspended,
      monthlyCountersReset,
    };
  },
});

/**
 * Daily cron 2: Pre-aggregates daily snapshots into `clinicMetricsDaily` and
 * `platformMetricsDaily` so dashboards never execute full-table scans.
 */
export const rollupDailyAnalytics = internalMutation({
  args: { targetDateKey: v.optional(v.string()) },
  handler: async (ctx, args) => {
    const now = Date.now();
    // Default to yesterday in Asia/Manila so the full 24h day is closed out
    const dateKey = args.targetDateKey ?? toManilaDateKey(now - DAY_MS);

    const [clinics, plans] = await Promise.all([
      ctx.db.query("clinics").collect(),
      ctx.db.query("subscriptionPlans").collect(),
    ]);
    const planMap = new Map<Id<"subscriptionPlans">, Doc<"subscriptionPlans">>(
      plans.map((p) => [p._id, p])
    );

    const dayStartUtc = Date.parse(`${dateKey}T00:00:00+08:00`);
    const dayEndUtc = dayStartUtc + DAY_MS;

    const paidToday = await ctx.db
      .query("subscriptionPayments")
      .withIndex("by_paid_at", (q) =>
        q.gte("paidAt", dayStartUtc).lt("paidAt", dayEndUtc)
      )
      .collect();
    const revenueCollectedTodayPhp = paidToday
      .filter((p) => p.status === "paid")
      .reduce((sum, p) => sum + p.amountPhp, 0);

    let activePaidClinics = 0;
    let trialClinics = 0;
    let pastDueClinics = 0;
    let suspendedClinics = 0;
    let mrrPhp = 0;
    let totalAppointmentsBooked = 0;
    let completedAppointments = 0;
    let cancelledAppointments = 0;
    let noShowAppointments = 0;
    let newPatientsRegistered = 0;
    let totalStorageUsedBytes = 0;
    const totalEmailsSentToday = 0;

    for (const clinic of clinics) {
      const plan = planMap.get(clinic.planId);
      mrrPhp += monthlyContributionPhp(clinic, plan);
      totalStorageUsedBytes += clinic.storageUsedBytes;

      if (clinic.status === "active") activePaidClinics++;
      else if (clinic.status === "trial") trialClinics++;
      else if (clinic.status === "past_due") pastDueClinics++;
      else if (clinic.status === "suspended") suspendedClinics++;

      const [dayAppts, clinicServices, clinicPatients] = await Promise.all([
        ctx.db
          .query("appointments")
          .withIndex("by_clinic_and_date", (q) =>
            q.eq("clinicId", clinic._id).eq("dateKey", dateKey)
          )
          .collect(),
        ctx.db
          .query("services")
          .withIndex("by_clinic_and_category", (q) => q.eq("clinicId", clinic._id))
          .collect(),
        ctx.db
          .query("patients")
          .withIndex("by_clinic_and_phone", (q) => q.eq("clinicId", clinic._id))
          .collect(),
      ]);

      const servicePriceMap = new Map(
        clinicServices.map((s) => [s._id, s.pricePhp])
      );

      const completedCount = dayAppts.filter(
        (a) => a.status === "completed"
      ).length;
      const cancelledCount = dayAppts.filter(
        (a) => a.status === "cancelled"
      ).length;
      const noShowCount = dayAppts.filter((a) => a.status === "no_show").length;
      const estimatedRevenuePhp = dayAppts
        .filter((a) => a.status === "completed")
        .reduce((sum, a) => sum + (servicePriceMap.get(a.serviceId) ?? 0), 0);
      const newPatientsCount = clinicPatients.filter(
        (p) => p.createdAt >= dayStartUtc && p.createdAt < dayEndUtc
      ).length;

      totalAppointmentsBooked += dayAppts.length;
      completedAppointments += completedCount;
      cancelledAppointments += cancelledCount;
      noShowAppointments += noShowCount;
      newPatientsRegistered += newPatientsCount;

      const existingClinicRow = await ctx.db
        .query("clinicMetricsDaily")
        .withIndex("by_clinic_and_date", (q) =>
          q.eq("clinicId", clinic._id).eq("dateKey", dateKey)
        )
        .unique();

      const clinicSnapshot = {
        clinicId: clinic._id,
        dateKey,
        totalBooked: dayAppts.length,
        completedCount,
        cancelledCount,
        noShowCount,
        estimatedRevenuePhp,
        newPatientsCount,
      };
      if (existingClinicRow) {
        await ctx.db.patch(existingClinicRow._id, clinicSnapshot);
      } else {
        await ctx.db.insert("clinicMetricsDaily", clinicSnapshot);
      }
    }

    const existingPlatformRow = await ctx.db
      .query("platformMetricsDaily")
      .withIndex("by_date", (q) => q.eq("dateKey", dateKey))
      .unique();

    const platformSnapshot = {
      dateKey,
      totalClinics: clinics.length,
      activePaidClinics,
      trialClinics,
      pastDueClinics,
      suspendedClinics,
      mrrPhp,
      arrPhp: mrrPhp * 12,
      revenueCollectedTodayPhp,
      totalAppointmentsBooked,
      completedAppointments,
      cancelledAppointments,
      noShowAppointments,
      newPatientsRegistered,
      totalStorageUsedBytes,
      totalEmailsSentToday,
      updatedAt: now,
    };

    if (existingPlatformRow) {
      await ctx.db.patch(existingPlatformRow._id, platformSnapshot);
    } else {
      await ctx.db.insert("platformMetricsDaily", platformSnapshot);
    }

    return { dateKey, clinicsRolledUp: clinics.length };
  },
});

/**
 * Daily cron 3: Dispatches 24-hour email reminders for tomorrow's confirmed appointments.
 */
export const dispatch24hReminders = internalMutation({
  args: {},
  handler: async (ctx) => {
    const tomorrowKey = toManilaDateKey(Date.now() + DAY_MS);

    const [activeClinics, trialClinics, pastDueClinics] = await Promise.all([
      ctx.db
        .query("clinics")
        .withIndex("by_status", (q) => q.eq("status", "active"))
        .collect(),
      ctx.db
        .query("clinics")
        .withIndex("by_status", (q) => q.eq("status", "trial"))
        .collect(),
      ctx.db
        .query("clinics")
        .withIndex("by_status", (q) => q.eq("status", "past_due"))
        .collect(),
    ]);

    const eligibleClinics = [...activeClinics, ...trialClinics, ...pastDueClinics];
    let scheduled = 0;

    for (const clinic of eligibleClinics) {
      const tomorrowAppts = await ctx.db
        .query("appointments")
        .withIndex("by_clinic_and_date", (q) =>
          q.eq("clinicId", clinic._id).eq("dateKey", tomorrowKey)
        )
        .collect();

      for (const appt of tomorrowAppts) {
        if (appt.status !== "confirmed" || appt.reminder24hSent) continue;
        await ctx.db.patch(appt._id, {
          reminder24hSent: true,
          updatedAt: Date.now(),
        });
        await ctx.scheduler.runAfter(
          0,
          internal.notifications.sendAppointmentReminder24h,
          { appointmentId: appt._id }
        );
        scheduled++;
      }
    }

    return { tomorrowKey, remindersScheduled: scheduled };
  },
});

/**
 * Daily cron 4: Checks `patients.by_clinic_and_recall` for patients due for their
 * 6-month Oral Prophylaxis cleaning today and sends recall invitations via Resend.
 */
export const dispatchHygieneRecalls = internalMutation({
  args: {},
  handler: async (ctx) => {
    const todayKey = toManilaDateKey(Date.now());
    const activeClinics = await ctx.db
      .query("clinics")
      .withIndex("by_status", (q) => q.eq("status", "active"))
      .collect();

    let recallsScheduled = 0;

    for (const clinic of activeClinics) {
      if (!clinic.featureFlags.recallAutomationEnabled) continue;

      const duePatients = await ctx.db
        .query("patients")
        .withIndex("by_clinic_and_recall", (q) =>
          q.eq("clinicId", clinic._id).eq("nextRecallDate", todayKey)
        )
        .collect();

      for (const patient of duePatients) {
        // Clear nextRecallDate so the patient is not emailed repeatedly
        await ctx.db.patch(patient._id, { nextRecallDate: undefined });
        if (!patient.email) continue;

        await ctx.scheduler.runAfter(
          0,
          internal.notifications.sendHygieneRecall,
          {
            clinicId: clinic._id,
            clinicName: clinic.name,
            clinicSlug: clinic.slug,
            clinicPhone: clinic.phone,
            primaryColorHex: clinic.primaryColorHex,
            patientName: `${patient.firstName} ${patient.lastName}`,
            patientEmail: patient.email,
            lastCleaningDate: patient.lastCleaningDate,
          }
        );
        recallsScheduled++;
      }
    }

    return { todayKey, recallsScheduled };
  },
});

/**
 * Daily cron 5: Safety-net sweep deleting any orphaned expired `slotLocks`
 * and expiring past-date `waitlist` entries (`waiting` or `notified`).
 */
export const cleanupExpiredSlotLocks = internalMutation({
  args: {},
  handler: async (ctx) => {
    const now = Date.now();
    const todayKey = toManilaDateKey(now);

    const [expiredLocks, staleWaiting, staleNotified] = await Promise.all([
      ctx.db
        .query("slotLocks")
        .withIndex("by_expires", (q) => q.lte("expiresAtUtc", now))
        .take(500),
      ctx.db
        .query("waitlist")
        .withIndex("by_status_and_date", (q) =>
          q.eq("status", "waiting").lt("preferredDateKey", todayKey)
        )
        .take(250),
      ctx.db
        .query("waitlist")
        .withIndex("by_status_and_date", (q) =>
          q.eq("status", "notified").lt("preferredDateKey", todayKey)
        )
        .take(250),
    ]);

    for (const lock of expiredLocks) {
      await ctx.db.delete(lock._id);
    }

    const staleWaitlist = [...staleWaiting, ...staleNotified];
    for (const entry of staleWaitlist) {
      await ctx.db.patch(entry._id, { status: "expired" });
    }

    return {
      deleted: expiredLocks.length,
      waitlistExpired: staleWaitlist.length,
    };
  },
});
