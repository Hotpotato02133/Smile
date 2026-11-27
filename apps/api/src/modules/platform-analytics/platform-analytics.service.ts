import { Injectable } from "@nestjs/common";
import { PaymentStatus, StaffInvitationStatus } from "@prisma/client";
import {
  DAY_MS,
  toManilaDateKey,
  toManilaMonthKey,
} from "../../common/utils/manila-time";
import { PrismaService } from "../../infra/prisma.service";

const R2_FREE_STORAGE_BYTES = 10 * 1024 * 1024 * 1024; // 10 GB Cloudflare R2 free allowance
const RESEND_FREE_MONTHLY_EMAILS = 3000;
const CLERK_FREE_MAU_LIMIT = 10000;

@Injectable()
export class PlatformAnalyticsService {
  constructor(private readonly prisma: PrismaService) {}

  async getDashboardOverview() {
    const now = new Date();
    const nowMs = now.getTime();
    const currentMonthKey = toManilaMonthKey(now);
    const monthStart = new Date(
      Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1, 0, 0, 0, 0)
    );
    const expiringCutoff = new Date(nowMs + 7 * DAY_MS);
    const thirtyDaysAgoKey = toManilaDateKey(nowMs - 29 * DAY_MS);
    const todayKey = toManilaDateKey(nowMs);

    const [
      clinics,
      plans,
      paidThisMonthAgg,
      pendingPaymentsCount,
      recentMetrics,
      activeAnnouncementsCount,
      pendingInvitationsCount,
      usersGrouped,
    ] = await Promise.all([
      this.prisma.clinic.findMany({
        include: { plan: true },
        take: 500,
      }),
      this.prisma.subscriptionPlan.findMany({
        orderBy: { monthlyPricePhp: "asc" },
      }),
      this.prisma.subscriptionPayment.aggregate({
        where: {
          status: PaymentStatus.paid,
          paidAt: { gte: monthStart },
        },
        _sum: { amountPhp: true },
        _count: { id: true },
      }),
      this.prisma.subscriptionPayment.count({
        where: { status: PaymentStatus.pending },
      }),
      this.prisma.platformMetricDaily.findMany({
        where: { dateKey: { gte: thirtyDaysAgoKey } },
        orderBy: { dateKey: "desc" },
        take: 31,
      }),
      this.prisma.systemAnnouncement.count({
        where: {
          isActive: true,
          OR: [{ expiresAt: null }, { expiresAt: { gte: now } }],
        },
      }),
      this.prisma.staffInvitation.count({
        where: {
          status: StaffInvitationStatus.pending,
          expiresAt: { gte: now },
        },
      }),
      this.prisma.user.groupBy({
        by: ["role"],
        where: { NOT: { clerkId: { startsWith: "pending:" } } },
        _count: { id: true },
      }),
    ]);

    let activePaidClinics = 0;
    let trialClinics = 0;
    let pastDueClinics = 0;
    let suspendedClinics = 0;
    let archivedClinics = 0;
    let convertedPaidClinics = 0;
    let mrrPhp = 0;
    let currentMonthAppointments = 0;
    let lifetimeAppointments = 0;

    const planBuckets = new Map<
      string,
      { code: string; name: string; count: number; mrrPhp: number }
    >(
      plans.map((p) => [
        p.id,
        { code: p.code, name: p.name, count: 0, mrrPhp: 0 },
      ])
    );

    const renewalQueue: Array<{
      id: string;
      name: string;
      slug: string;
      email: string;
      status: string;
      billingCycle: string;
      subscriptionEndsAt: Date;
      planId: string;
      planName: string;
      monthlyPricePhp: number;
      annualPricePhp: number;
    }> = [];

    for (const clinic of clinics) {
      const clinicMrr =
        clinic.status === "active" || clinic.status === "past_due"
          ? clinic.billingCycle === "annual"
            ? Math.round(clinic.plan.annualPricePhp / 12)
            : clinic.billingCycle === "monthly"
              ? clinic.plan.monthlyPricePhp
              : 0
          : 0;

      mrrPhp += clinicMrr;
      if (clinic.currentMonthKey === currentMonthKey) {
        currentMonthAppointments += clinic.currentMonthAppointmentCount;
      }
      lifetimeAppointments += clinic.lifetimeAppointmentCount;

      if (clinic.status === "active") activePaidClinics++;
      else if (clinic.status === "trial") trialClinics++;
      else if (clinic.status === "past_due") pastDueClinics++;
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

      if (
        clinic.status !== "archived" &&
        (clinic.status === "past_due" || clinic.subscriptionEndsAt <= expiringCutoff)
      ) {
        renewalQueue.push({
          id: clinic.id,
          name: clinic.name,
          slug: clinic.slug,
          email: clinic.email,
          status: clinic.status,
          billingCycle: clinic.billingCycle,
          subscriptionEndsAt: clinic.subscriptionEndsAt,
          planId: clinic.planId,
          planName: clinic.plan.name,
          monthlyPricePhp: clinic.plan.monthlyPricePhp,
          annualPricePhp: clinic.plan.annualPricePhp,
        });
      }
    }

    renewalQueue.sort(
      (a, b) => a.subscriptionEndsAt.getTime() - b.subscriptionEndsAt.getTime()
    );

    const nonArchived = clinics.length - archivedClinics;
    const trialToPaidConversionPct =
      nonArchived > 0
        ? Math.round((convertedPaidClinics / nonArchived) * 1000) / 10
        : 0;

    let patients = 0;
    let clinicStaff = 0;
    let superAdmins = 0;
    for (const row of usersGrouped) {
      if (row.role === "patient") patients += row._count.id;
      else if (row.role === "super_admin") superAdmins += row._count.id;
      else clinicStaff += row._count.id;
    }

    const todayRow = recentMetrics.find((m) => m.dateKey === todayKey);
    const thirtyDayBooked = recentMetrics.reduce(
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

    return {
      totalClinics: clinics.length,
      activePaidClinics,
      trialClinics,
      pastDueClinics,
      suspendedClinics,
      archivedClinics,
      trialToPaidConversionPct,
      totalUsers: patients + clinicStaff + superAdmins,
      userBreakdown: { patients, clinicStaff, superAdmins },
      mrrPhp,
      arrPhp: mrrPhp * 12,
      collectedThisMonthPhp: paidThisMonthAgg._sum.amountPhp ?? 0,
      paidInvoicesThisMonthCount: paidThisMonthAgg._count.id,
      pendingPaymentsCount,
      currentMonthAppointments,
      lifetimeAppointments,
      todayAppointments: todayRow?.totalAppointmentsBooked ?? 0,
      thirtyDayStats: {
        booked: thirtyDayBooked,
        completed: thirtyDayCompleted,
        cancelled: thirtyDayCancelled,
        noShow: thirtyDayNoShow,
        completionRatePct:
          thirtyDayBooked > 0
            ? Math.round((thirtyDayCompleted / thirtyDayBooked) * 100)
            : 0,
        noShowRatePct:
          thirtyDayBooked > 0
            ? Math.round((thirtyDayNoShow / thirtyDayBooked) * 100)
            : 0,
      },
      activeAnnouncementsCount,
      pendingInvitationsCount,
      planDistribution: Array.from(planBuckets.values()),
      renewalQueue: renewalQueue.slice(0, 50),
      lastRollupAt: recentMetrics[0]?.updatedAt ?? null,
    };
  }

  async getDailyMetricsSeries(days = 30) {
    const clampedDays = Math.min(Math.max(days, 7), 90);
    const startKey = toManilaDateKey(Date.now() - (clampedDays - 1) * DAY_MS);

    const rows = await this.prisma.platformMetricDaily.findMany({
      where: { dateKey: { gte: startKey } },
      orderBy: { dateKey: "asc" },
      take: clampedDays,
    });

    return rows.map((row) => ({
      ...row,
      totalStorageUsedBytes: Number(row.totalStorageUsedBytes),
    }));
  }

  async getClinicLeaderboard(limit = 10) {
    const take = Math.min(Math.max(limit, 1), 50);
    const clinics = await this.prisma.clinic.findMany({
      where: { status: { not: "archived" } },
      include: { plan: { select: { code: true, name: true } } },
      orderBy: [
        { currentMonthAppointmentCount: "desc" },
        { lifetimeAppointmentCount: "desc" },
      ],
      take,
    });

    return clinics.map((c) => ({
      id: c.id,
      name: c.name,
      slug: c.slug,
      status: c.status,
      planName: c.plan.name,
      currentMonthAppointmentCount: c.currentMonthAppointmentCount,
      lifetimeAppointmentCount: c.lifetimeAppointmentCount,
      activeDentistCount: c.activeDentistCount,
      activeChairCount: c.activeChairCount,
      storageUsedBytes: Number(c.storageUsedBytes),
    }));
  }

  async getFreeTierUsage() {
    const currentMonthKey = toManilaMonthKey();
    const [clinicAgg, emailAgg, totalUsers] = await Promise.all([
      this.prisma.clinic.aggregate({
        _sum: { storageUsedBytes: true },
        _count: { id: true },
      }),
      this.prisma.clinic.aggregate({
        where: { currentMonthKey },
        _sum: { currentMonthEmailCount: true },
      }),
      this.prisma.user.count({
        where: { NOT: { clerkId: { startsWith: "pending:" } } },
      }),
    ]);

    const storageUsedBytes = Number(clinicAgg._sum.storageUsedBytes ?? BigInt(0));
    const emailsUsedThisMonth = emailAgg._sum.currentMonthEmailCount ?? 0;

    return {
      storage: {
        usedBytes: storageUsedBytes,
        limitBytes: R2_FREE_STORAGE_BYTES,
        usagePct:
          Math.round((storageUsedBytes / R2_FREE_STORAGE_BYTES) * 10000) / 100,
      },
      emails: {
        usedThisMonth: emailsUsedThisMonth,
        limitPerMonth: RESEND_FREE_MONTHLY_EMAILS,
        usagePct:
          Math.round((emailsUsedThisMonth / RESEND_FREE_MONTHLY_EMAILS) * 1000) /
          10,
      },
      users: {
        totalActive: totalUsers,
        limitMau: CLERK_FREE_MAU_LIMIT,
        usagePct:
          Math.round((totalUsers / CLERK_FREE_MAU_LIMIT) * 1000) / 10,
      },
      totalClinics: clinicAgg._count.id,
    };
  }
}
