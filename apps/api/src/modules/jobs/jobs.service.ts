import { Injectable } from "@nestjs/common";
import {
  AppointmentStatus,
  ClinicStatus,
  PaymentStatus,
} from "@prisma/client";
import {
  type ClinicFeatureFlags,
  getLocalDateKeyAndMinute,
  GRACE_PERIOD_MS,
  localDateMinuteToUtc,
} from "@smile/shared";
import {
  DAY_MS,
  toManilaDateKey,
  toManilaMonthKey,
} from "../../common/utils/manila-time";
import { PrismaService } from "../../infra/prisma.service";
import { AuditService } from "../audit/audit.service";
import { NotificationsService } from "../notifications/notifications.service";

@Injectable()
export class JobsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly notifications: NotificationsService
  ) {}

  /**
   * Daily Cron 1 (00:05 UTC): Expire trials/subscriptions -> past_due (3-day grace),
   * suspend expired past_due clinics, and reset monthly counters on month rollover.
   */
  async sweepSubscriptions() {
    const now = new Date();
    const nowMs = now.getTime();
    const currentMonthKey = toManilaMonthKey(now);

    const [expiredActiveOrTrial, pastDueClinics, staleMonthClinics, systemActor] =
      await Promise.all([
        this.prisma.clinic.findMany({
          where: {
            status: { in: [ClinicStatus.trial, ClinicStatus.active] },
            subscriptionEndsAt: { lte: now },
          },
          take: 500,
        }),
        this.prisma.clinic.findMany({
          where: { status: ClinicStatus.past_due },
          take: 500,
        }),
        this.prisma.clinic.findMany({
          where: { currentMonthKey: { not: currentMonthKey } },
          select: { id: true },
          take: 500,
        }),
        this.prisma.user.findFirst({
          where: { role: "super_admin", isActive: true },
        }),
      ]);

    let transitionedToPastDue = 0;
    let transitionedToSuspended = 0;

    for (const clinic of expiredActiveOrTrial) {
      const gracePeriodEndsAt = new Date(nowMs + GRACE_PERIOD_MS);
      await this.prisma.clinic.update({
        where: { id: clinic.id },
        data: { status: ClinicStatus.past_due, gracePeriodEndsAt },
      });
      transitionedToPastDue++;

      await this.notifications
        .sendSubscriptionStatusAlert({
          clinicId: clinic.id,
          clinicName: clinic.name,
          clinicEmail: clinic.email,
          newStatus: "past_due",
          subscriptionEndsAt: clinic.subscriptionEndsAt,
          gracePeriodEndsAt,
        })
        .catch(() => undefined);

      if (systemActor) {
        await this.auditService.record({
          actorUserId: systemActor.id,
          actorRole: "system_cron",
          clinicId: clinic.id,
          actionType: "CLINIC_AUTO_PAST_DUE",
          targetEntity: "clinics",
          targetId: clinic.id,
          metadata: {
            clinicName: clinic.name,
            previousStatus: clinic.status,
            gracePeriodEndsAt: gracePeriodEndsAt.toISOString(),
          },
        });
      }
    }

    for (const clinic of pastDueClinics) {
      const graceEndMs =
        clinic.gracePeriodEndsAt?.getTime() ??
        clinic.subscriptionEndsAt.getTime() + GRACE_PERIOD_MS;
      if (nowMs <= graceEndMs) continue;

      await this.prisma.clinic.update({
        where: { id: clinic.id },
        data: { status: ClinicStatus.suspended },
      });
      transitionedToSuspended++;

      await this.notifications
        .sendSubscriptionStatusAlert({
          clinicId: clinic.id,
          clinicName: clinic.name,
          clinicEmail: clinic.email,
          newStatus: "suspended",
          subscriptionEndsAt: clinic.subscriptionEndsAt,
        })
        .catch(() => undefined);

      if (systemActor) {
        await this.auditService.record({
          actorUserId: systemActor.id,
          actorRole: "system_cron",
          clinicId: clinic.id,
          actionType: "CLINIC_AUTO_SUSPENDED",
          targetEntity: "clinics",
          targetId: clinic.id,
          metadata: { clinicName: clinic.name, graceEndMs },
        });
      }
    }

    let monthlyCountersReset = 0;
    if (staleMonthClinics.length > 0) {
      const reset = await this.prisma.clinic.updateMany({
        where: { id: { in: staleMonthClinics.map((c) => c.id) } },
        data: {
          currentMonthKey,
          currentMonthAppointmentCount: 0,
          currentMonthEmailCount: 0,
        },
      });
      monthlyCountersReset = reset.count;
    }

    return {
      transitionedToPastDue,
      transitionedToSuspended,
      monthlyCountersReset,
    };
  }

  /**
   * Daily Cron 2 (16:15 UTC): Pre-aggregates yesterday's `clinic_metrics_daily`
   * and `platform_metrics_daily` snapshots for Recharts dashboards.
   */
  async rollupDailyAnalytics(targetDateKey?: string) {
    const nowMs = Date.now();
    const dateKey = targetDateKey?.trim() || toManilaDateKey(nowMs - DAY_MS);
    const dayStartUtc = new Date(`${dateKey}T00:00:00+08:00`);
    const dayEndUtc = new Date(dayStartUtc.getTime() + DAY_MS);

    const [clinics, paidTodayAgg] = await Promise.all([
      this.prisma.clinic.findMany({ include: { plan: true } }),
      this.prisma.subscriptionPayment.aggregate({
        where: {
          status: PaymentStatus.paid,
          paidAt: { gte: dayStartUtc, lt: dayEndUtc },
        },
        _sum: { amountPhp: true },
      }),
    ]);

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
    let totalStorageUsedBytes = BigInt(0);
    let totalEmailsSentToday = 0;
    const monthKeyForDate = dateKey.slice(0, 7);

    for (const clinic of clinics) {
      if (clinic.status === "active" || clinic.status === "past_due") {
        mrrPhp +=
          clinic.billingCycle === "annual"
            ? Math.round(clinic.plan.annualPricePhp / 12)
            : clinic.billingCycle === "monthly"
              ? clinic.plan.monthlyPricePhp
              : 0;
      }
      totalStorageUsedBytes += clinic.storageUsedBytes;
      if (clinic.currentMonthKey === monthKeyForDate) {
        totalEmailsSentToday += clinic.currentMonthEmailCount;
      }
      if (clinic.status === "active") activePaidClinics++;
      else if (clinic.status === "trial") trialClinics++;
      else if (clinic.status === "past_due") pastDueClinics++;
      else if (clinic.status === "suspended") suspendedClinics++;

      const tz = clinic.timezone || "Asia/Manila";
      const clinicDateKey =
        targetDateKey?.trim() ||
        getLocalDateKeyAndMinute(nowMs - DAY_MS, tz).dateKey;
      const clinicDayStart = new Date(localDateMinuteToUtc(clinicDateKey, 0, tz));
      const clinicDayEnd = new Date(
        localDateMinuteToUtc(clinicDateKey, 1439, tz) + 60_000
      );

      const [dayAppts, newPatients] = await Promise.all([
        this.prisma.appointment.findMany({
          where: { clinicId: clinic.id, dateKey: clinicDateKey },
          include: { service: { select: { pricePhp: true } } },
        }),
        this.prisma.patient.count({
          where: {
            clinicId: clinic.id,
            createdAt: { gte: clinicDayStart, lt: clinicDayEnd },
          },
        }),
      ]);

      let cCompleted = 0;
      let cCancelled = 0;
      let cNoShow = 0;
      let cRevenue = 0;
      for (const a of dayAppts) {
        if (a.status === "completed") {
          cCompleted++;
          cRevenue += a.service.pricePhp;
        } else if (a.status === "cancelled") {
          cCancelled++;
        } else if (a.status === "no_show") {
          cNoShow++;
        }
      }

      await this.prisma.clinicMetricDaily.upsert({
        where: {
          clinicId_dateKey: { clinicId: clinic.id, dateKey: clinicDateKey },
        },
        update: {
          totalBooked: dayAppts.length,
          completedCount: cCompleted,
          cancelledCount: cCancelled,
          noShowCount: cNoShow,
          estimatedRevenuePhp: cRevenue,
          newPatientsCount: newPatients,
        },
        create: {
          clinicId: clinic.id,
          dateKey: clinicDateKey,
          totalBooked: dayAppts.length,
          completedCount: cCompleted,
          cancelledCount: cCancelled,
          noShowCount: cNoShow,
          estimatedRevenuePhp: cRevenue,
          newPatientsCount: newPatients,
        },
      });

      totalAppointmentsBooked += dayAppts.length;
      completedAppointments += cCompleted;
      cancelledAppointments += cCancelled;
      noShowAppointments += cNoShow;
      newPatientsRegistered += newPatients;
    }

    await this.prisma.platformMetricDaily.upsert({
      where: { dateKey },
      update: {
        totalClinics: clinics.length,
        activePaidClinics,
        trialClinics,
        pastDueClinics,
        suspendedClinics,
        mrrPhp,
        arrPhp: mrrPhp * 12,
        revenueCollectedTodayPhp: paidTodayAgg._sum.amountPhp ?? 0,
        totalAppointmentsBooked,
        completedAppointments,
        cancelledAppointments,
        noShowAppointments,
        newPatientsRegistered,
        totalStorageUsedBytes,
        totalEmailsSentToday,
      },
      create: {
        dateKey,
        totalClinics: clinics.length,
        activePaidClinics,
        trialClinics,
        pastDueClinics,
        suspendedClinics,
        mrrPhp,
        arrPhp: mrrPhp * 12,
        revenueCollectedTodayPhp: paidTodayAgg._sum.amountPhp ?? 0,
        totalAppointmentsBooked,
        completedAppointments,
        cancelledAppointments,
        noShowAppointments,
        newPatientsRegistered,
        totalStorageUsedBytes,
        totalEmailsSentToday,
      },
    });

    return {
      dateKey,
      clinicsProcessed: clinics.length,
      mrrPhp,
      totalAppointmentsBooked,
    };
  }

  /**
   * Daily Cron 3 (01:00 UTC): Sends 24-hour appointment reminders for tomorrow's visits.
   */
  async dispatch24hReminders() {
    const tomorrowKey = toManilaDateKey(Date.now() + DAY_MS);
    const appts = await this.prisma.appointment.findMany({
      where: {
        dateKey: tomorrowKey,
        status: AppointmentStatus.confirmed,
        reminder24hSent: false,
      },
      include: {
        clinic: true,
        patient: true,
        service: true,
        dentist: true,
      },
      take: 200,
    });

    let sent = 0;
    for (const appt of appts) {
      if (!appt.patient.email) continue;
      const dateTimeLabel = new Intl.DateTimeFormat("en-PH", {
        timeZone: appt.clinic.timezone || "Asia/Manila",
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
      }).format(appt.startTimeUtc);

      const res = await this.notifications.send24hAppointmentReminder({
        clinicId: appt.clinicId,
        clinicName: appt.clinic.name,
        clinicAddress: appt.clinic.address,
        clinicPhone: appt.clinic.phone,
        primaryColorHex: appt.clinic.primaryColorHex,
        patientEmail: appt.patient.email,
        patientName: `${appt.patient.firstName} ${appt.patient.lastName}`.trim(),
        serviceName: appt.service.name,
        dentistName: appt.dentist.displayName,
        dateTimeLabel,
      });

      if (res.sent) {
        await this.prisma.appointment.update({
          where: { id: appt.id },
          data: { reminder24hSent: true },
        });
        sent++;
      }
    }

    return { tomorrowKey, scanned: appts.length, sent };
  }

  /**
   * Daily Cron 4 (01:30 UTC): Dispatches 6-month Oral Prophylaxis hygiene recall emails.
   */
  async dispatchHygieneRecalls() {
    const todayKey = toManilaDateKey();
    const patients = await this.prisma.patient.findMany({
      where: {
        nextRecallDate: todayKey,
        email: { not: null },
      },
      include: { clinic: true },
      take: 200,
    });

    let sent = 0;
    for (const patient of patients) {
      const flags = patient.clinic.featureFlags as unknown as ClinicFeatureFlags;
      if (
        !flags?.recallAutomationEnabled ||
        patient.clinic.status === "suspended" ||
        patient.clinic.status === "archived" ||
        !patient.email
      ) {
        continue;
      }

      const res = await this.notifications.sendHygieneRecall({
        clinicId: patient.clinicId,
        clinicName: patient.clinic.name,
        clinicSlug: patient.clinic.slug,
        clinicPhone: patient.clinic.phone,
        primaryColorHex: patient.clinic.primaryColorHex,
        patientEmail: patient.email,
        patientName: `${patient.firstName} ${patient.lastName}`.trim(),
        lastCleaningDate: patient.lastCleaningDate,
      });

      if (res.sent) sent++;
    }

    return { todayKey, scanned: patients.length, sent };
  }
}
