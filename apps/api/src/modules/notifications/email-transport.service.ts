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

  async send(input: SendRawEmailInput): Promise<EmailDispatchResult> {
    const resendApiKey = this.configService
      .get("RESEND_API_KEY", { infer: true })
      ?.trim();
    const resendFrom = this.configService
      .get("RESEND_FROM_EMAIL", { infer: true })
      .trim();

    if (resendApiKey) {
      try {
        const resend = new Resend(resendApiKey);
        const { data, error } = await resend.emails.send({
          from: resendFrom,
          to: input.to,
          subject: input.subject,
          html: input.html,
          text: input.text,
        });
        if (error) {
          return { sent: false, provider: "resend", reason: error.message };
        }
        return { sent: true, provider: "resend", id: data?.id ?? null };
      } catch (error) {
        return {
          sent: false,
          provider: "resend",
          reason:
            error instanceof Error ? error.message : "Resend delivery failed",
        };
      }
    }

    const gmailUser = this.configService
      .get("GMAIL_USER", { infer: true })
      ?.trim();
    const gmailPass = this.configService
      .get("GMAIL_APP_PASSWORD", { infer: true })
      ?.replace(/\s+/g, "");

    if (gmailUser && gmailPass) {
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
        this.logger.warn(
          `Gmail SMTP delivery failed: ${
            error instanceof Error ? error.message : "unknown"
          }`
        );
        return {
          sent: false,
          provider: "gmail_smtp",
          reason:
            error instanceof Error ? error.message : "Gmail SMTP delivery failed",
        };
      }
    }

    return { sent: false, reason: "EMAIL_PROVIDER_NOT_CONFIGURED" };
  }
}
