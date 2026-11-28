import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import { EmailDeliveryStatus } from "@prisma/client";
import { Queue, Worker } from "bullmq";
import { toManilaMonthKey } from "../../common/utils/manila-time";
import type { AppEnv } from "../../config/env";
import { PrismaService } from "../../infra/prisma.service";
import {
  appointmentReminder24hEmail,
  hygieneRecallEmail,
  roleInvitationEmail,
  subscriptionExpiryAlertEmail,
} from "./email-templates";
import {
  type EmailDispatchResult,
  EmailTransportService,
  type SendRawEmailInput,
} from "./email-transport.service";

const GLOBAL_MONTHLY_EMAIL_LIMIT = 3000;
const EMAIL_QUEUE_NAME = "smile-emails";

interface EmailJobPayload extends SendRawEmailInput {
  clinicId?: string;
}

@Injectable()
export class NotificationsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(NotificationsService.name);
  private queue: Queue<EmailJobPayload> | null = null;
  private worker: Worker<EmailJobPayload> | null = null;

  constructor(
    private readonly configService: ConfigService<AppEnv, true>,
    private readonly prisma: PrismaService,
    private readonly transport: EmailTransportService
  ) {}

  onModuleInit(): void {
    const enableWorker = this.configService.get("ENABLE_BULLMQ_WORKER", {
      infer: true,
    });
    const redisUrl = this.configService.get("REDIS_URL", { infer: true })?.trim();

    if (!enableWorker || !redisUrl) {
      return;
    }

    const connection = { url: redisUrl, maxRetriesPerRequest: null };
    this.queue = new Queue<EmailJobPayload>(EMAIL_QUEUE_NAME, {
      connection,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 5000 },
        removeOnComplete: 100,
        removeOnFail: 200,
      },
    });

    this.worker = new Worker<EmailJobPayload>(
      EMAIL_QUEUE_NAME,
      async (job) => {
        const result = await this.dispatchWithQuota(job.data);
        if (!result.sent && result.reason !== "EMAIL_PROVIDER_NOT_CONFIGURED") {
          throw new Error(result.reason ?? "Email delivery failed");
        }
        return result;
      },
      {
        connection,
        concurrency: 2,
        // Conservative intervals to minimize Redis commands on free plans
        drainDelay: 30,
        stalledInterval: 120_000,
      }
    );

    this.worker.on("failed", (job, err) => {
      this.logger.warn(`BullMQ email job ${job?.id} failed: ${err.message}`);
    });
  }

  async onModuleDestroy(): Promise<void> {
    if (this.worker) await this.worker.close().catch(() => undefined);
    if (this.queue) await this.queue.close().catch(() => undefined);
  }

  private getAppBaseUrl(): string {
    return this.configService
      .get("APP_BASE_URL", { infer: true })
      .replace(/\/+$/, "");
  }

  async reserveEmailQuota(clinicId: string): Promise<{
    allowed: boolean;
    reason: string | null;
  }> {
    const clinic = await this.prisma.clinic.findUnique({
      where: { id: clinicId },
      include: { plan: true },
    });
    if (!clinic) return { allowed: false, reason: "CLINIC_NOT_FOUND" };

    const currentMonthKey = toManilaMonthKey();
    const effectiveCount =
      clinic.currentMonthKey === currentMonthKey
        ? clinic.currentMonthEmailCount
        : 0;

    if (effectiveCount >= clinic.plan.maxEmailsPerMonth) {
      return { allowed: false, reason: "CLINIC_QUOTA_EXCEEDED" };
    }

    const globalAgg = await this.prisma.clinic.aggregate({
      where: { currentMonthKey },
      _sum: { currentMonthEmailCount: true },
    });
    const globalCount = globalAgg._sum.currentMonthEmailCount ?? 0;
    if (globalCount >= GLOBAL_MONTHLY_EMAIL_LIMIT) {
      return { allowed: false, reason: "PLATFORM_POOL_EXHAUSTED" };
    }

    await this.prisma.clinic.update({
      where: { id: clinic.id },
      data: {
        currentMonthKey,
        currentMonthEmailCount: effectiveCount + 1,
        ...(clinic.currentMonthKey !== currentMonthKey
          ? { currentMonthAppointmentCount: 0 }
          : {}),
      },
    });

    return { allowed: true, reason: null };
  }

  private async dispatchWithQuota(
    payload: EmailJobPayload
  ): Promise<EmailDispatchResult> {
    if (payload.clinicId) {
      const quota = await this.reserveEmailQuota(payload.clinicId);
      if (!quota.allowed) {
        return { sent: false, reason: quota.reason ?? "QUOTA_EXCEEDED" };
      }
    }
    return this.transport.send(payload);
  }

  /**
   * Enqueues via BullMQ when worker mode is enabled (local Docker / always-on VM);
   * otherwise dispatches directly in-process so Render Free + Upstash Free spends 0 idle commands.
   */
  async enqueueOrSend(payload: EmailJobPayload): Promise<EmailDispatchResult> {
    if (this.queue) {
      const job = await this.queue.add("send-email", payload);
      return { sent: true, id: job.id ?? null };
    }
    return this.dispatchWithQuota(payload);
  }

  async sendSubscriptionStatusAlert(params: {
    clinicId: string;
    clinicName: string;
    clinicEmail: string;
    newStatus: "past_due" | "suspended";
    subscriptionEndsAt: Date;
    gracePeriodEndsAt?: Date;
  }): Promise<EmailDispatchResult> {
    const formatPhDate = (d: Date) =>
      d.toLocaleDateString("en-PH", {
        year: "numeric",
        month: "short",
        day: "numeric",
        timeZone: "Asia/Manila",
      });

    const template = subscriptionExpiryAlertEmail({
      clinicName: params.clinicName,
      newStatus: params.newStatus,
      subscriptionEndsAtFormatted: formatPhDate(params.subscriptionEndsAt),
      graceEndsAtFormatted: params.gracePeriodEndsAt
        ? formatPhDate(params.gracePeriodEndsAt)
        : undefined,
    });

    return this.enqueueOrSend({
      to: params.clinicEmail,
      subject: template.subject,
      html: template.html,
      text: template.text,
      fromName: "Smile Dental Platform",
    });
  }

  async send24hAppointmentReminder(params: {
    clinicId: string;
    clinicName: string;
    clinicAddress: string;
    clinicPhone: string;
    primaryColorHex: string;
    patientEmail: string;
    patientName: string;
    serviceName: string;
    dentistName: string;
    dateTimeLabel: string;
  }): Promise<EmailDispatchResult> {
    const template = appointmentReminder24hEmail({
      clinicName: params.clinicName,
      clinicAddress: params.clinicAddress,
      clinicPhone: params.clinicPhone,
      primaryColorHex: params.primaryColorHex,
      patientName: params.patientName,
      serviceName: params.serviceName,
      dentistName: params.dentistName,
      formattedDateTime: params.dateTimeLabel,
    });

    return this.enqueueOrSend({
      clinicId: params.clinicId,
      to: params.patientEmail,
      subject: template.subject,
      html: template.html,
      text: template.text,
      fromName: params.clinicName,
    });
  }

  async sendHygieneRecall(params: {
    clinicId: string;
    clinicName: string;
    clinicSlug: string;
    clinicPhone: string;
    primaryColorHex: string;
    patientEmail: string;
    patientName: string;
    lastCleaningDate?: string | null;
  }): Promise<EmailDispatchResult> {
    const template = hygieneRecallEmail({
      clinicName: params.clinicName,
      clinicPhone: params.clinicPhone,
      primaryColorHex: params.primaryColorHex,
      patientName: params.patientName,
      lastCleaningDate: params.lastCleaningDate ?? undefined,
      bookingUrl: `${this.getAppBaseUrl()}/c/${params.clinicSlug}`,
    });

    return this.enqueueOrSend({
      clinicId: params.clinicId,
      to: params.patientEmail,
      subject: template.subject,
      html: template.html,
      text: template.text,
      fromName: params.clinicName,
    });
  }

  async sendRoleInvitationEmail(params: {
    invitationId: string;
    clinicId?: string | null;
    recipientEmail: string;
    role: "super_admin" | "clinic_admin" | "dentist" | "receptionist";
    scopeName: string;
    accentHex?: string | null;
    inviterName: string;
    inviterNote?: string | null;
    token: string;
    expiresAt: Date;
  }): Promise<{
    emailStatus: EmailDeliveryStatus;
    emailError: string | null;
    result: EmailDispatchResult;
  }> {
    const baseUrl = this.getAppBaseUrl();
    const encodedToken = encodeURIComponent(params.token);
    const acceptUrl = `${baseUrl}/invite/${encodedToken}`;
    const declineUrl = `${baseUrl}/invite/${encodedToken}?action=decline`;
    const expiresFormatted = params.expiresAt.toLocaleDateString("en-PH", {
      year: "numeric",
      month: "short",
      day: "numeric",
      timeZone: "Asia/Manila",
    });

    const template = roleInvitationEmail({
      recipientEmail: params.recipientEmail,
      role: params.role,
      scopeName: params.scopeName,
      accentHex: params.accentHex || "#6C5CE7",
      inviterName: params.inviterName,
      inviterNote: params.inviterNote ?? undefined,
      expiresFormatted,
      acceptUrl,
      declineUrl,
    });

    const result = await this.enqueueOrSend({
      clinicId: params.clinicId ?? undefined,
      to: params.recipientEmail,
      subject: template.subject,
      html: template.html,
      text: template.text,
      fromName:
        params.role === "super_admin"
          ? "Smile Dental Platform"
          : params.scopeName,
    });

    const emailStatus: EmailDeliveryStatus = result.sent
      ? EmailDeliveryStatus.sent
      : result.reason === "EMAIL_PROVIDER_NOT_CONFIGURED"
        ? EmailDeliveryStatus.skipped
        : EmailDeliveryStatus.failed;
    const emailError = result.sent ? null : (result.reason ?? "Email delivery failed");

    try {
      await this.prisma.staffInvitation.update({
        where: { id: params.invitationId },
        data: { emailStatus, emailError },
      });
    } catch {
      // Non-fatal in mock/unit environments where staffInvitation.update isn't mocked
    }

    return { emailStatus, emailError, result };
  }

  async sendWaitlistOpeningOffer(params: {
    clinicId: string;
    clinicName: string;
    clinicSlug: string;
    primaryColorHex: string;
    patientEmail: string;
    patientName: string;
    serviceName: string;
    preferredDateKey: string;
    waitlistId: string;
  }): Promise<EmailDispatchResult> {
    const claimUrl = `${this.getAppBaseUrl()}/c/${params.clinicSlug}?waitlistId=${encodeURIComponent(params.waitlistId)}`;
    const accent = params.primaryColorHex || "#6C5CE7";
    const subject = `An opening is available at ${params.clinicName} (${params.preferredDateKey})`;
    const text = `Hi ${params.patientName},\n\nA slot has opened up for ${params.serviceName} on ${params.preferredDateKey} at ${params.clinicName}.\nClaim it online: ${claimUrl}\n`;
    const html = `<div style="font-family:system-ui,-apple-system,sans-serif;max-width:560px;margin:0 auto;padding:24px;color:#0f172a">
      <div style="border-top:4px solid ${accent};padding-top:16px">
        <h2 style="margin:0 0 8px">${params.clinicName}</h2>
        <p>Hi ${params.patientName},</p>
        <p>Good news! A dental slot is now open for <strong>${params.serviceName}</strong> on <strong>${params.preferredDateKey}</strong>.</p>
        <p style="margin:24px 0"><a href="${claimUrl}" style="display:inline-block;background:${accent};color:#ffffff;padding:12px 20px;border-radius:999px;text-decoration:none;font-weight:600">Claim Open Slot</a></p>
        <p style="font-size:12px;color:#64748b">Slots are claimed first-come, first-served.</p>
      </div>
    </div>`;

    return this.enqueueOrSend({
      clinicId: params.clinicId,
      to: params.patientEmail,
      subject,
      html,
      text,
      fromName: params.clinicName,
    });
  }
}
