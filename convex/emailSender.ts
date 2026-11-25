"use node";

import { v } from "convex/values";
import nodemailer from "nodemailer";
import { internalAction } from "./_generated/server";

export type SmtpDispatchResult = {
  sent: boolean;
  reason?: string;
  id?: string | null;
};

/**
 * Sends transactional email via Gmail SMTP using a Google App Password ($0/mo, no custom domain).
 * Runs in the Convex Node.js runtime because `nodemailer` requires Node TCP/TLS sockets.
 */
export const sendViaGmailSmtp = internalAction({
  args: {
    to: v.string(),
    subject: v.string(),
    html: v.string(),
    text: v.string(),
    fromName: v.optional(v.string()),
  },
  handler: async (_ctx, args): Promise<SmtpDispatchResult> => {
    const gmailUser = process.env.GMAIL_USER?.trim();
    const gmailAppPassword = process.env.GMAIL_APP_PASSWORD?.replace(/\s+/g, "");

    if (!gmailUser || !gmailAppPassword) {
      return {
        sent: false,
        reason: "GMAIL_SMTP_NOT_CONFIGURED",
      };
    }

    const displayName = (
      args.fromName?.trim() ||
      process.env.GMAIL_FROM_NAME?.trim() ||
      "Smile Dental"
    ).replace(/[\r\n"]/g, "");

    const transporter = nodemailer.createTransport({
      host: "smtp.gmail.com",
      port: 465,
      secure: true,
      auth: {
        user: gmailUser,
        pass: gmailAppPassword,
      },
    });

    try {
      const info = await transporter.sendMail({
        from: `"${displayName}" <${gmailUser}>`,
        to: args.to,
        subject: args.subject,
        html: args.html,
        text: args.text,
      });

      return {
        sent: true,
        id: info.messageId ?? null,
      };
    } catch (err) {
      const rawMessage =
        err instanceof Error ? err.message : "Gmail SMTP delivery failed.";
      if (rawMessage.includes("535") || rawMessage.includes("Invalid login")) {
        return {
          sent: false,
          reason:
            "Gmail rejected login (535). Verify GMAIL_USER and ensure GMAIL_APP_PASSWORD is a valid 16-character Google App Password (with 2-Step Verification enabled).",
        };
      }
      return {
        sent: false,
        reason: rawMessage,
      };
    }
  },
});
