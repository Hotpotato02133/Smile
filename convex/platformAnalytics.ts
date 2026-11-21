import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { DAY_MS, toManilaDateKey } from "./lib/audit";
import { requireSuperAdmin } from "./lib/permissions";

const CONVEX_FREE_STORAGE_BYTES = 1024 * 1024 * 1024; // 1 GB Convex File Storage ceiling
const RESEND_FREE_MONTHLY_EMAILS = 3000; // 3,000 emails/mo Resend ceiling

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

export const getDashboardOverview = query({
  args: {},
  handler: async (ctx) => {
    await requireSuperAdmin(ctx);

    const now = Date.now();
    const monthStart = new Date(now);
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);
    const monthStartMs = monthStart.getTime();
    const expiringCutoff = now + 7 * DAY_MS;
    const thirtyDaysAgoKey = toManilaDateKey(now - 29 * DAY_MS);
    const todayKey = toManilaDateKey(now);

    const [
      clinics,
      plans,
      paidThisMonth,
      expiringByDate,
      pastDueClinics,
      recentMetrics,
      pendingPayments,
      activeAnnouncements,
    ] = await Promise.all([
      ctx.db.query("clinics").take(500),
      ctx.db.query("subscriptionPlans").take(50),
      ctx.db
        .query("subscriptionPayments")
        .withIndex("by_paid_at", (q) => q.gte("paidAt", monthStartMs))
        .take(500),
      ctx.db
        .query("clinics")
        .withIndex("by_subscription_end", (q) =>
          q.lte("subscriptionEndsAt", expiringCutoff)
        )
        .take(200),
      ctx.db
        .query("clinics")
        .withIndex("by_status", (q) => q.eq("status", "past_due"))
        .take(200),
      ctx.db
        .query("platformMetricsDaily")
        .withIndex("by_date", (q) => q.gte("dateKey", thirtyDaysAgoKey))
        .order("desc")
        .take(31),
      ctx.db
        .query("subscriptionPayments")
        .withIndex("by_status", (q) => q.eq("status", "pending"))
        .take(100),
      ctx.db
        .query("systemAnnouncements")
        .withIndex("by_active", (q) => q.eq("isActive", true))
        .take(50),
    ]);

    const planMap = new Map<Id<"subscriptionPlans">, Doc<"subscriptionPlans">>(
      plans.map((p) => [p._id, p])
    );

    let activePaidClinics = 0;
    let trialClinics = 0;
    let pastDueCount = 0;
    let suspendedClinics = 0;
    let archivedClinics = 0;
    let mrrPhp = 0;
    let currentMonthAppointments = 0;
    let lifetimeAppointments = 0;

    const planBuckets = new Map<
      string,
      { code: string; name: string; count: number; mrrPhp: number }
    >();
    for (const plan of plans) {
      planBuckets.set(plan._id, {
        code: plan.code,
        name: plan.name,
        count: 0,
        mrrPhp: 0,
      });
    }

    for (const clinic of clinics) {
      const plan = planMap.get(clinic.planId);
      const clinicMrr = monthlyContributionPhp(clinic, plan);
      mrrPhp += clinicMrr;
      currentMonthAppointments += clinic.currentMonthAppointmentCount;
      lifetimeAppointments += clinic.lifetimeAppointmentCount;

      if (clinic.status === "active") activePaidClinics++;
      else if (clinic.status === "trial") trialClinics++;
      else if (clinic.status === "past_due") pastDueCount++;
      else if (clinic.status === "suspended") suspendedClinics++;
      else if (clinic.status === "archived") archivedClinics++;

      const bucket = planBuckets.get(clinic.planId);
      if (bucket) {
        bucket.count += 1;
        bucket.mrrPhp += clinicMrr;
      }
    }

    const paidInvoicesThisMonth = paidThisMonth.filter((p) => p.status === "paid");
    const collectedThisMonthPhp = paidInvoicesThisMonth.reduce(
      (sum, p) => sum + p.amountPhp,
      0
    );

    const todayRow = recentMetrics.find((m) => m.dateKey === todayKey);
    const todayAppointments = todayRow?.totalAppointmentsBooked ?? 0;
    const thirtyDayTotalBooked = recentMetrics.reduce(
      (sum, m) => sum + m.totalAppointmentsBooked,
      0
    );
    const thirtyDayCompleted = recentMetrics.reduce(
      (sum, m) => sum + m.completedAppointments,
      0
    );
    const thirtyDayCancelled = recentMetrics.reduce(
      (sum, m) => sum + m.cancelledAppointments,
      0
    );
    const thirtyDayNoShow = recentMetrics.reduce(
      (sum, m) => sum + m.noShowAppointments,
      0
    );
    const completionRatePct =
      thirtyDayTotalBooked > 0
        ? Math.round((thirtyDayCompleted / thirtyDayTotalBooked) * 100)
        : 0;
    const noShowRatePct =
      thirtyDayTotalBooked > 0
        ? Math.round((thirtyDayNoShow / thirtyDayTotalBooked) * 100)
        : 0;
    const lastRollupAt = recentMetrics[0]?.updatedAt ?? null;
    const activeAnnouncementsCount = activeAnnouncements.filter(
      (a) => !a.expiresAt || a.expiresAt >= now
    ).length;

    // Deduplicate renewal queue (expiring within 7 days OR currently past_due, excluding archived)
    const renewalMap = new Map<Id<"clinics">, Doc<"clinics">>();
    for (const c of [...pastDueClinics, ...expiringByDate]) {
      if (c.status !== "archived") {
        renewalMap.set(c._id, c);
      }
    }

    const renewalQueue = Array.from(renewalMap.values())
      .sort((a, b) => a.subscriptionEndsAt - b.subscriptionEndsAt)
      .slice(0, 10)
      .map((clinic) => {
        const plan = planMap.get(clinic.planId);
        return {
          _id: clinic._id,
          name: clinic.name,
          slug: clinic.slug,
          status: clinic.status,
          billingCycle: clinic.billingCycle,
          subscriptionEndsAt: clinic.subscriptionEndsAt,
          planId: clinic.planId,
          planName: plan?.name ?? "Unknown",
          monthlyPricePhp: plan?.monthlyPricePhp ?? 0,
          annualPricePhp: plan?.annualPricePhp ?? 0,
        };
      });

    return {
      totalClinics: clinics.length,
      activePaidClinics,
      trialClinics,
      pastDueClinics: pastDueCount,
      suspendedClinics,
      archivedClinics,
      mrrPhp,
      arrPhp: mrrPhp * 12,
      collectedThisMonthPhp,
      paidInvoicesThisMonthCount: paidInvoicesThisMonth.length,
      pendingPaymentsCount: pendingPayments.length,
      activeAnnouncementsCount,
      currentMonthAppointments,
      lifetimeAppointments,
      todayAppointments,
      thirtyDayTotalBooked,
      thirtyDayCompleted,
      thirtyDayCancelled,
      thirtyDayNoShow,
      completionRatePct,
      noShowRatePct,
      lastRollupAt,
      planDistribution: Array.from(planBuckets.values()),
      statusDistribution: [
        { status: "active", label: "Active", count: activePaidClinics },
        { status: "trial", label: "Trial", count: trialClinics },
        { status: "past_due", label: "Past Due", count: pastDueCount },
        { status: "suspended", label: "Suspended", count: suspendedClinics },
        { status: "archived", label: "Archived", count: archivedClinics },
      ],
      renewalQueue,
    };
  },
});

export const getDailyMetricsSeries = query({
  args: { days: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);

    const days = Math.min(Math.max(args.days ?? 30, 7), 90);
    const now = Date.now();
    const startKey = toManilaDateKey(now - (days - 1) * DAY_MS);
    const todayKey = toManilaDateKey(now);

    const rows = await ctx.db
      .query("platformMetricsDaily")
      .withIndex("by_date", (q) => q.gte("dateKey", startKey))
      .order("asc")
      .collect();

    const series = rows.map((row) => ({
      dateKey: row.dateKey,
      mrrPhp: row.mrrPhp,
      revenueCollectedTodayPhp: row.revenueCollectedTodayPhp,
      totalClinics: row.totalClinics,
      activePaidClinics: row.activePaidClinics,
      completedAppointments: row.completedAppointments,
      cancelledAppointments: row.cancelledAppointments,
      noShowAppointments: row.noShowAppointments,
      totalAppointmentsBooked: row.totalAppointmentsBooked,
    }));

    // If today's daily rollup cron hasn't run yet, append a live projection point from clinics
    if (!series.some((s) => s.dateKey === todayKey)) {
      const [clinics, plans] = await Promise.all([
        ctx.db.query("clinics").collect(),
        ctx.db.query("subscriptionPlans").collect(),
      ]);
      const planMap = new Map(plans.map((p) => [p._id, p]));
      const mrrPhp = clinics.reduce(
        (sum, c) => sum + monthlyContributionPhp(c, planMap.get(c.planId)),
        0
      );
      series.push({
        dateKey: todayKey,
        mrrPhp,
        revenueCollectedTodayPhp: 0,
        totalClinics: clinics.length,
        activePaidClinics: clinics.filter((c) => c.status === "active").length,
        completedAppointments: 0,
        cancelledAppointments: 0,
        noShowAppointments: 0,
        totalAppointmentsBooked: 0,
      });
    }

    return series;
  },
});

export const getClinicLeaderboard = query({
  args: { limit: v.optional(v.number()) },
  handler: async (ctx, args) => {
    await requireSuperAdmin(ctx);

    const limit = Math.min(Math.max(args.limit ?? 10, 1), 50);
    const [clinics, plans] = await Promise.all([
      ctx.db.query("clinics").collect(),
      ctx.db.query("subscriptionPlans").collect(),
    ]);
    const planMap = new Map(plans.map((p) => [p._id, p]));

    return clinics
      .sort(
        (a, b) =>
          b.currentMonthAppointmentCount - a.currentMonthAppointmentCount ||
          b.lifetimeAppointmentCount - a.lifetimeAppointmentCount
      )
      .slice(0, limit)
      .map((clinic) => {
        const plan = planMap.get(clinic.planId);
        return {
          _id: clinic._id,
          name: clinic.name,
          slug: clinic.slug,
          city: clinic.city,
          status: clinic.status,
          planName: plan?.name ?? "Unknown",
          planCode: plan?.code ?? "trial",
          activeDentistCount: clinic.activeDentistCount,
          maxDentists: plan?.maxDentists ?? 0,
          activeChairCount: clinic.activeChairCount,
          maxChairs: plan?.maxChairs ?? 0,
          currentMonthAppointmentCount: clinic.currentMonthAppointmentCount,
          maxAppointmentsPerMonth: plan?.maxAppointmentsPerMonth ?? 0,
          lifetimeAppointmentCount: clinic.lifetimeAppointmentCount,
          storageUsedBytes: clinic.storageUsedBytes,
          maxStorageBytes: plan?.maxStorageBytes ?? 0,
          currentMonthEmailCount: clinic.currentMonthEmailCount,
        };
      });
  },
});

export const getFreeTierUsage = query({
  args: {},
  handler: async (ctx) => {
    await requireSuperAdmin(ctx);

    const clinics = await ctx.db.query("clinics").collect();

    const totalStorageBytes = clinics.reduce(
      (sum, c) => sum + c.storageUsedBytes,
      0
    );
    const totalEmailsThisMonth = clinics.reduce(
      (sum, c) => sum + c.currentMonthEmailCount,
      0
    );

    const topStorageClinics = [...clinics]
      .sort((a, b) => b.storageUsedBytes - a.storageUsedBytes)
      .slice(0, 5)
      .map((c) => ({
        _id: c._id,
        name: c.name,
        slug: c.slug,
        storageUsedBytes: c.storageUsedBytes,
      }));

    const topEmailClinics = [...clinics]
      .sort((a, b) => b.currentMonthEmailCount - a.currentMonthEmailCount)
      .slice(0, 5)
      .map((c) => ({
        _id: c._id,
        name: c.name,
        slug: c.slug,
        currentMonthEmailCount: c.currentMonthEmailCount,
      }));

    return {
      storage: {
        usedBytes: totalStorageBytes,
        limitBytes: CONVEX_FREE_STORAGE_BYTES,
        percentUsed: Math.min(
          100,
          Number(((totalStorageBytes / CONVEX_FREE_STORAGE_BYTES) * 100).toFixed(2))
        ),
        topClinics: topStorageClinics,
      },
      emails: {
        sentThisMonth: totalEmailsThisMonth,
        monthlyLimit: RESEND_FREE_MONTHLY_EMAILS,
        percentUsed: Math.min(
          100,
          Number(
            ((totalEmailsThisMonth / RESEND_FREE_MONTHLY_EMAILS) * 100).toFixed(2)
          )
        ),
        topClinics: topEmailClinics,
      },
    };
  },
});
