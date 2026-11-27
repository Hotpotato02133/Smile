import { v } from "convex/values";
import type { Doc, Id } from "./_generated/dataModel";
import { query } from "./_generated/server";
import { DAY_MS, toManilaDateKey, toManilaMonthKey } from "./lib/audit";
import { requireSuperAdmin } from "./lib/permissions";

const CONVEX_FREE_STORAGE_BYTES = 1024 * 1024 * 1024; // 1 GB Convex File Storage ceiling
const RESEND_FREE_MONTHLY_EMAILS = 3000; // 3,000 emails/mo Resend ceiling
const CLERK_FREE_MAU_LIMIT = 10000; // 10,000 Monthly Active Users Clerk free ceiling

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
    const currentMonthKey = toManilaMonthKey(now);
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
      pendingInvitations,
      usersRows,
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
      ctx.db
        .query("staffInvitations")
        .withIndex("by_status_and_created", (q) => q.eq("status", "pending"))
        .take(100),
      ctx.db.query("users").take(2000),
    ]);

    const planMap = new Map<Id<"subscriptionPlans">, Doc<"subscriptionPlans">>(
      plans.map((p) => [p._id, p])
    );

    let activePaidClinics = 0;
    let trialClinics = 0;
    let pastDueCount = 0;
    let suspendedClinics = 0;
    let archivedClinics = 0;
    let convertedPaidClinics = 0;
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
      if (clinic.currentMonthKey === currentMonthKey) {
        currentMonthAppointments += clinic.currentMonthAppointmentCount;
      }
      lifetimeAppointments += clinic.lifetimeAppointmentCount;

      if (clinic.status === "active") activePaidClinics++;
      else if (clinic.status === "trial") trialClinics++;
      else if (clinic.status === "past_due") pastDueCount++;
      else if (clinic.status === "suspended") suspendedClinics++;
      else if (clinic.status === "archived") archivedClinics++;

      if (
        clinic.status !== "archived" &&
        clinic.billingCycle !== "trial" &&
        (clinic.status === "active" || clinic.status === "past_due")
      ) {
        convertedPaidClinics++;
      }

      const bucket = planBuckets.get(clinic.planId);
      if (bucket) {
        bucket.count += 1;
        bucket.mrrPhp += clinicMrr;
      }
    }

    const nonArchivedClinics = clinics.length - archivedClinics;
    const trialToPaidConversionPct =
      nonArchivedClinics > 0
        ? Math.round((convertedPaidClinics / nonArchivedClinics) * 1000) / 10
        : 0;

    let totalUsers = 0;
    let patientUsersCount = 0;
    let clinicStaffUsersCount = 0;
    let superAdminUsersCount = 0;
    for (const u of usersRows) {
      if (u.clerkId.startsWith("pending:")) continue;
      totalUsers++;
      if (u.role === "patient") patientUsersCount++;
      else if (u.role === "super_admin") superAdminUsersCount++;
      else clinicStaffUsersCount++;
    }

    let collectedThisMonthPhp = 0;
    let paidInvoicesThisMonthCount = 0;
    for (const p of paidThisMonth) {
      if (p.status === "paid") {
        collectedThisMonthPhp += p.amountPhp;
        paidInvoicesThisMonthCount++;
      }
    }

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

    let activeAnnouncementsCount = 0;
    for (const a of activeAnnouncements) {
      if (!a.expiresAt || a.expiresAt >= now) activeAnnouncementsCount++;
    }
    let pendingInvitationsCount = 0;
    for (const inv of pendingInvitations) {
      if (inv.expiresAt >= now) pendingInvitationsCount++;
    }

    // Deduplicate renewal queue (expiring within 7 days OR currently past_due, excluding archived)
    const renewalMap = new Map<Id<"clinics">, Doc<"clinics">>();
    for (const c of [...pastDueClinics, ...expiringByDate]) {
      if (c.status !== "archived") {
        renewalMap.set(c._id, c);
      }
    }

    const renewalQueue = Array.from(renewalMap.values())
      .sort((a, b) => a.subscriptionEndsAt - b.subscriptionEndsAt)
      .slice(0, 50)
      .map((clinic) => {
        const plan = planMap.get(clinic.planId);
        return {
          _id: clinic._id,
          name: clinic.name,
          slug: clinic.slug,
          email: clinic.email,
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
      trialToPaidConversionPct,
      totalUsers,
      userBreakdown: {
        patients: patientUsersCount,
        clinicStaff: clinicStaffUsersCount,
        superAdmins: superAdminUsersCount,
      },
      mrrPhp,
      arrPhp: mrrPhp * 12,
      collectedThisMonthPhp,
      paidInvoicesThisMonthCount,
      pendingPaymentsCount: pendingPayments.length,
      pendingInvitationsCount,
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
      .take(120);

    const series = rows.map((row) => ({
      dateKey: row.dateKey,
      mrrPhp: row.mrrPhp,
      revenueCollectedTodayPhp: row.revenueCollectedTodayPhp,
      totalClinics: row.totalClinics,
      activePaidClinics: row.activePaidClinics,
      trialClinics: row.trialClinics,
      completedAppointments: row.completedAppointments,
      cancelledAppointments: row.cancelledAppointments,
      noShowAppointments: row.noShowAppointments,
      totalAppointmentsBooked: row.totalAppointmentsBooked,
    }));

    // If today's daily rollup cron hasn't run yet, append a real live projection point
    if (!series.some((s) => s.dateKey === todayKey)) {
      const todayStartUtc = Date.parse(`${todayKey}T00:00:00+08:00`);
      const todayEndUtc = todayStartUtc + DAY_MS;

      const [clinics, plans, paidToday] = await Promise.all([
        ctx.db.query("clinics").take(500),
        ctx.db.query("subscriptionPlans").take(50),
        ctx.db
          .query("subscriptionPayments")
          .withIndex("by_paid_at", (q) =>
            q.gte("paidAt", todayStartUtc).lt("paidAt", todayEndUtc)
          )
          .take(200),
      ]);
      const planMap = new Map(plans.map((p) => [p._id, p]));
      let mrrPhp = 0;
      let activePaidClinics = 0;
      let trialClinics = 0;
      for (const c of clinics) {
        mrrPhp += monthlyContributionPhp(c, planMap.get(c.planId));
        if (c.status === "active") activePaidClinics++;
        else if (c.status === "trial") trialClinics++;
      }

      let revenueCollectedTodayPhp = 0;
      for (const p of paidToday) {
        if (p.status === "paid") revenueCollectedTodayPhp += p.amountPhp;
      }

      let totalAppointmentsBooked = 0;
      let completedAppointments = 0;
      let cancelledAppointments = 0;
      let noShowAppointments = 0;
      for (const c of clinics.slice(0, 100)) {
        const dayAppts = await ctx.db
          .query("appointments")
          .withIndex("by_clinic_and_date", (q) =>
            q.eq("clinicId", c._id).eq("dateKey", todayKey)
          )
          .take(200);
        for (const a of dayAppts) {
          totalAppointmentsBooked++;
          if (a.status === "completed") completedAppointments++;
          else if (a.status === "cancelled") cancelledAppointments++;
          else if (a.status === "no_show") noShowAppointments++;
        }
      }

      series.push({
        dateKey: todayKey,
        mrrPhp,
        revenueCollectedTodayPhp,
        totalClinics: clinics.length,
        activePaidClinics,
        trialClinics,
        completedAppointments,
        cancelledAppointments,
        noShowAppointments,
        totalAppointmentsBooked,
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
    const currentMonthKey = toManilaMonthKey(Date.now());
    const [clinics, plans] = await Promise.all([
      ctx.db.query("clinics").take(500),
      ctx.db.query("subscriptionPlans").take(50),
    ]);
    const planMap = new Map(plans.map((p) => [p._id, p]));

    const normalized = clinics.map((clinic) => ({
      clinic,
      monthlyAppts:
        clinic.currentMonthKey === currentMonthKey
          ? clinic.currentMonthAppointmentCount
          : 0,
      monthlyEmails:
        clinic.currentMonthKey === currentMonthKey
          ? clinic.currentMonthEmailCount
          : 0,
    }));

    return normalized
      .sort(
        (a, b) =>
          b.monthlyAppts - a.monthlyAppts ||
          b.clinic.lifetimeAppointmentCount - a.clinic.lifetimeAppointmentCount
      )
      .slice(0, limit)
      .map(({ clinic, monthlyAppts, monthlyEmails }) => {
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
          currentMonthAppointmentCount: monthlyAppts,
          maxAppointmentsPerMonth: plan?.maxAppointmentsPerMonth ?? 0,
          lifetimeAppointmentCount: clinic.lifetimeAppointmentCount,
          storageUsedBytes: clinic.storageUsedBytes,
          maxStorageBytes: plan?.maxStorageBytes ?? 0,
          currentMonthEmailCount: monthlyEmails,
        };
      });
  },
});

export const getFreeTierUsage = query({
  args: {},
  handler: async (ctx) => {
    await requireSuperAdmin(ctx);

    const now = Date.now();
    const currentMonthKey = toManilaMonthKey(now);
    const thirtyDaysAgo = now - 30 * DAY_MS;

    const [clinics, users] = await Promise.all([
      ctx.db.query("clinics").take(500),
      ctx.db.query("users").take(2500),
    ]);

    let totalStorageBytes = 0;
    let totalEmailsThisMonth = 0;
    for (const c of clinics) {
      totalStorageBytes += c.storageUsedBytes;
      if (c.currentMonthKey === currentMonthKey) {
        totalEmailsThisMonth += c.currentMonthEmailCount;
      }
    }

    let totalActiveAccounts = 0;
    let mauCount = 0;
    for (const u of users) {
      if (u.clerkId.startsWith("pending:") || !u.isActive) continue;
      totalActiveAccounts++;
      const lastActivity = Math.max(u.lastLoginAt ?? 0, u.createdAt);
      if (lastActivity >= thirtyDaysAgo) {
        mauCount++;
      }
    }

    const topStorageClinics = [...clinics]
      .sort((a, b) => b.storageUsedBytes - a.storageUsedBytes)
      .slice(0, 5)
      .map((c) => ({
        _id: c._id,
        name: c.name,
        slug: c.slug,
        storageUsedBytes: c.storageUsedBytes,
      }));

    const topEmailClinics = clinics
      .map((c) => ({
        _id: c._id,
        name: c.name,
        slug: c.slug,
        currentMonthEmailCount:
          c.currentMonthKey === currentMonthKey ? c.currentMonthEmailCount : 0,
      }))
      .sort((a, b) => b.currentMonthEmailCount - a.currentMonthEmailCount)
      .slice(0, 5);

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
      clerkMau: {
        activeLast30Days: mauCount,
        totalActiveAccounts,
        monthlyLimit: CLERK_FREE_MAU_LIMIT,
        percentUsed: Math.min(
          100,
          Number(((mauCount / CLERK_FREE_MAU_LIMIT) * 100).toFixed(2))
        ),
      },
    };
  },
});
