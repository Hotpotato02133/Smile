import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import nodemailer from "nodemailer";
import { Resend } from "resend";
import type { AppEnv } from "../../config/env";

export interface SendRawEmailInput {
  to: string;
  subject: string;
  html: string;
  text: string;
  fromName?: string;
}

export interface EmailDispatchResult {
  sent: boolean;
  provider?: "resend" | "gmail_smtp";
  id?: string | null;
  reason?: string;
}

@Injectable()
export class EmailTransportService {
  private readonly logger = new Logger(EmailTransportService.name);

  constructor(private readonly configService: ConfigService<AppEnv, true>) {}

  private async sendViaResend(
    apiKey: string,
    from: string,
    input: SendRawEmailInput
  ): Promise<EmailDispatchResult> {
    try {
      const resend = new Resend(apiKey);
      const { data, error } = await resend.emails.send({
        from,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      });
      if (error) {
        this.logger.warn(`Resend delivery rejected (${input.to}): ${error.message}`);
        return { sent: false, provider: "resend", reason: error.message };
      }
      return { sent: true, provider: "resend", id: data?.id ?? null };
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "Resend delivery failed";
      this.logger.warn(`Resend delivery failed (${input.to}): ${reason}`);
      return { sent: false, provider: "resend", reason };
    }
  }

  private async sendViaGmail(
    gmailUser: string,
    gmailPass: string,
    input: SendRawEmailInput
  ): Promise<EmailDispatchResult> {
    const displayName = (
      input.fromName?.trim() ||
      this.configService.get("GMAIL_FROM_NAME", { infer: true }).trim() ||
      "Smile Dental"
    ).replace(/[\r\n"]/g, "");

    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: { user: gmailUser, pass: gmailPass },
    });

    try {
      const info = await transporter.sendMail({
        from: `"${displayName}" <${gmailUser}>`,
        to: input.to,
        subject: input.subject,
        html: input.html,
        text: input.text,
      });
      return { sent: true, provider: "gmail_smtp", id: info.messageId ?? null };
    } catch (error) {
      const reason =
        error instanceof Error ? error.message : "Gmail SMTP delivery failed";
      this.logger.warn(`Gmail SMTP delivery failed (${input.to}): ${reason}`);
      return { sent: false, provider: "gmail_smtp", reason };
    }
  }

  async send(input: SendRawEmailInput): Promise<EmailDispatchResult> {
    const resendApiKey = this.configService
      .get("RESEND_API_KEY", { infer: true })
      ?.trim();
    const resendFrom = this.configService
      .get("RESEND_FROM_EMAIL", { infer: true })
      .trim();
    const gmailUser = this.configService
      .get("GMAIL_USER", { infer: true })
      ?.trim();
    const gmailPass = this.configService
      .get("GMAIL_APP_PASSWORD", { infer: true })
      ?.replace(/\s+/g, "");

    const hasResend = Boolean(resendApiKey);
    const hasGmail = Boolean(gmailUser && gmailPass);
    const isResendSandbox = /@resend\.dev\b/i.test(resendFrom);

    // Prefer Gmail SMTP over Resend's sandbox sender (onboarding@resend.dev only allows
    // sending to the Resend account owner, whereas Gmail SMTP delivers to any recipient).
    if (hasGmail && (!hasResend || isResendSandbox)) {
      const gmailResult = await this.sendViaGmail(gmailUser!, gmailPass!, input);
      if (gmailResult.sent || !hasResend) {
        return gmailResult;
      }
      return this.sendViaResend(resendApiKey!, resendFrom, input);
    }

    if (hasResend) {
      const resendResult = await this.sendViaResend(
        resendApiKey!,
        resendFrom,
        input
      );
      if (resendResult.sent || !hasGmail) {
        return resendResult;
      }
      return this.sendViaGmail(gmailUser!, gmailPass!, input);
    }

    if (hasGmail) {
      return this.sendViaGmail(gmailUser!, gmailPass!, input);
    }

    return { sent: false, reason: "EMAIL_PROVIDER_NOT_CONFIGURED" };
  }
}
