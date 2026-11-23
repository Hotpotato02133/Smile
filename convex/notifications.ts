import { v } from "convex/values";
import { Resend } from "resend";
import { internal } from "./_generated/api";
import type { Doc } from "./_generated/dataModel";
import {
  internalAction,
  internalMutation,
  internalQuery,
} from "./_generated/server";
import {
  appointmentReminder24hEmail,
  bookingConfirmationEmail,
  hygieneRecallEmail,
  roleInvitationEmail,
  subscriptionExpiryAlertEmail,
  waitlistOpeningEmail,
} from "./emails/templates";
import { toManilaMonthKey } from "./lib/audit";

/** Global monthly Resend free-tier ceiling (3,000 emails/mo). */
const GLOBAL_MONTHLY_EMAIL_LIMIT = 3000;

export type EmailDispatchResult = {
  sent: boolean;
  reason?: string;
  id?: string | null;
};

type QuotaReservationResult = {
  allowed: boolean;
  reason:
    | "CLINIC_NOT_FOUND"
    | "CLINIC_QUOTA_EXCEEDED"
    | "PLATFORM_POOL_EXHAUSTED"
    | null;
};

function formatClinicDateTime(
  timestampMs: number,
  timeZone = "Asia/Manila"
): string {
  try {
    return new Intl.DateTimeFormat("en-PH", {
      timeZone,
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(timestampMs));
  } catch {
    return new Intl.DateTimeFormat("en-PH", {
      timeZone: "Asia/Manila",
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(timestampMs));
  }
}

function getAppBaseUrl(): string {
  return (process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000").replace(
    /\/+$/,
    ""
  );
}

/**
 * Atomically checks and increments both the clinic's monthly email quota and the
 * platform's global 3,000/mo free-tier ceiling before dispatching via Resend.
 */
export const reserveEmailQuota = internalMutation({
  args: { clinicId: v.id("clinics") },
  handler: async (ctx, args): Promise<QuotaReservationResult> => {
    const clinic = await ctx.db.get(args.clinicId);
    if (!clinic) return { allowed: false, reason: "CLINIC_NOT_FOUND" };

    const now = Date.now();
    const currentMonthKey = toManilaMonthKey(now);
    let clinicCount = clinic.currentMonthEmailCount;

    if (clinic.currentMonthKey !== currentMonthKey) {
      clinicCount = 0;
      await ctx.db.patch(clinic._id, {
        currentMonthKey,
        currentMonthAppointmentCount: 0,
        currentMonthEmailCount: 0,
        updatedAt: now,
      });
    }

    const plan = await ctx.db.get(clinic.planId);
    const clinicLimit = plan?.maxEmailsPerMonth ?? 100;
    if (clinicCount >= clinicLimit) {
      return { allowed: false, reason: "CLINIC_QUOTA_EXCEEDED" };
    }

    const allClinics = await ctx.db.query("clinics").collect();
    const globalCount = allClinics.reduce(
      (sum, c) =>
        sum +
        (c.currentMonthKey === currentMonthKey ? c.currentMonthEmailCount : 0),
      0
    );
    if (globalCount >= GLOBAL_MONTHLY_EMAIL_LIMIT) {
      return { allowed: false, reason: "PLATFORM_POOL_EXHAUSTED" };
    }

    await ctx.db.patch(clinic._id, {
      currentMonthEmailCount: clinicCount + 1,
      updatedAt: now,
    });

    return { allowed: true, reason: null };
  },
});

type AppointmentEmailContext = {
  appt: Doc<"appointments">;
  clinic: Doc<"clinics">;
  patient: Doc<"patients">;
  service: Doc<"services">;
  dentist: Doc<"dentists">;
  chair: Doc<"chairs">;
} | null;

export const getAppointmentEmailContext = internalQuery({
  args: { appointmentId: v.id("appointments") },
  handler: async (ctx, args): Promise<AppointmentEmailContext> => {
    const appt = await ctx.db.get(args.appointmentId);
    if (!appt) return null;
    const [clinic, patient, service, dentist, chair] = await Promise.all([
      ctx.db.get(appt.clinicId),
      ctx.db.get(appt.patientId),
      ctx.db.get(appt.serviceId),
      ctx.db.get(appt.dentistId),
      ctx.db.get(appt.chairId),
    ]);
    if (!clinic || !patient || !service || !dentist || !chair) return null;
    return { appt, clinic, patient, service, dentist, chair };
  },
});

/** Low-level Resend dispatch action with strict per-clinic & global quota enforcement. */
export const sendClinicEmail = internalAction({
  args: {
    clinicId: v.id("clinics"),
    to: v.string(),
    subject: v.string(),
    html: v.string(),
    text: v.string(),
    skipQuotaCheck: v.optional(v.boolean()),
  },
  handler: async (ctx, args): Promise<EmailDispatchResult> => {
    const recipient = args.to.trim().toLowerCase();
    if (!recipient || !recipient.includes("@")) {
      return { sent: false, reason: "INVALID_RECIPIENT" };
    }

    const apiKey = process.env.RESEND_API_KEY?.trim();
    if (!apiKey) {
      return { sent: false, reason: "RESEND_NOT_CONFIGURED" };
    }

    if (!args.skipQuotaCheck) {
      const quota: QuotaReservationResult = await ctx.runMutation(
        internal.notifications.reserveEmailQuota,
        { clinicId: args.clinicId }
      );
      if (!quota.allowed) {
        return { sent: false, reason: quota.reason ?? "QUOTA_EXCEEDED" };
      }
    }

    const resend = new Resend(apiKey);
    const from =
      process.env.RESEND_FROM_EMAIL?.trim() ||
      "Smile Dental <onboarding@resend.dev>";

    const result = await resend.emails.send({
      from,
      to: recipient,
      subject: args.subject,
      html: args.html,
      text: args.text,
    });

    if (result.error) {
      return { sent: false, reason: result.error.message };
    }
    return { sent: true, id: result.data?.id ?? null };
  },
});

export const sendBookingConfirmation = internalAction({
  args: { appointmentId: v.id("appointments") },
  handler: async (ctx, args): Promise<EmailDispatchResult> => {
    const data: AppointmentEmailContext = await ctx.runQuery(
      internal.notifications.getAppointmentEmailContext,
      { appointmentId: args.appointmentId }
    );
    if (!data || !data.patient.email) {
      return { sent: false, reason: "NO_PATIENT_EMAIL" };
    }

    const template = bookingConfirmationEmail({
      clinicName: data.clinic.name,
      primaryColorHex: data.clinic.primaryColorHex,
      clinicAddress: `${data.clinic.address}, ${data.clinic.city}, ${data.clinic.province}`,
      clinicPhone: data.clinic.phone,
      cancellationWindowHours: data.clinic.cancellationWindowHours,
      patientName: `${data.patient.firstName} ${data.patient.lastName}`,
      serviceName: data.service.name,
      dentistName: data.dentist.displayName,
      chairName: data.chair.name,
      formattedDateTime: formatClinicDateTime(
        data.appt.startTimeUtc,
        data.clinic.timezone
      ),
      referenceCode: `SML-${data.appt._id.slice(-6).toUpperCase()}`,
    });

    return await ctx.runAction(internal.notifications.sendClinicEmail, {
      clinicId: data.clinic._id,
      to: data.patient.email,
      subject: template.subject,
      html: template.html,
      text: template.text,
    });
  },
});

export const sendAppointmentReminder24h = internalAction({
  args: { appointmentId: v.id("appointments") },
  handler: async (ctx, args): Promise<EmailDispatchResult> => {
    const data: AppointmentEmailContext = await ctx.runQuery(
      internal.notifications.getAppointmentEmailContext,
      { appointmentId: args.appointmentId }
    );
    if (!data || !data.patient.email) {
      return { sent: false, reason: "NO_PATIENT_EMAIL" };
    }

    const template = appointmentReminder24hEmail({
      clinicName: data.clinic.name,
      primaryColorHex: data.clinic.primaryColorHex,
      clinicAddress: `${data.clinic.address}, ${data.clinic.city}, ${data.clinic.province}`,
      clinicPhone: data.clinic.phone,
      patientName: `${data.patient.firstName} ${data.patient.lastName}`,
      serviceName: data.service.name,
      dentistName: data.dentist.displayName,
      formattedDateTime: formatClinicDateTime(
        data.appt.startTimeUtc,
        data.clinic.timezone
      ),
    });

    return await ctx.runAction(internal.notifications.sendClinicEmail, {
      clinicId: data.clinic._id,
      to: data.patient.email,
      subject: template.subject,
      html: template.html,
      text: template.text,
    });
  },
});

export const sendHygieneRecall = internalAction({
  args: {
    clinicId: v.id("clinics"),
    clinicName: v.string(),
    clinicSlug: v.string(),
    clinicPhone: v.string(),
    primaryColorHex: v.string(),
    patientName: v.string(),
    patientEmail: v.string(),
    lastCleaningDate: v.optional(v.string()),
  },
  handler: async (ctx, args): Promise<EmailDispatchResult> => {
    const template = hygieneRecallEmail({
      clinicName: args.clinicName,
      primaryColorHex: args.primaryColorHex,
      clinicPhone: args.clinicPhone,
      bookingUrl: `${getAppBaseUrl()}/c/${args.clinicSlug}`,
      patientName: args.patientName,
      lastCleaningDate: args.lastCleaningDate,
    });

    return await ctx.runAction(internal.notifications.sendClinicEmail, {
      clinicId: args.clinicId,
      to: args.patientEmail,
      subject: template.subject,
      html: template.html,
      text: template.text,
    });
  },
});

export const sendWaitlistOpeningBlast = internalAction({
  args: {
    clinicId: v.id("clinics"),
    clinicName: v.string(),
    clinicSlug: v.string(),
    primaryColorHex: v.string(),
    waitlistId: v.id("waitlist"),
    patientName: v.string(),
    patientEmail: v.string(),
    serviceName: v.string(),
    dateKey: v.string(),
  },
  handler: async (ctx, args): Promise<EmailDispatchResult> => {
    const claimUrl = `${getAppBaseUrl()}/c/${args.clinicSlug}?waitlistId=${args.waitlistId}&date=${encodeURIComponent(args.dateKey)}`;
    const template = waitlistOpeningEmail({
      clinicName: args.clinicName,
      primaryColorHex: args.primaryColorHex,
      patientName: args.patientName,
      serviceName: args.serviceName,
      dateKey: args.dateKey,
      claimUrl,
    });

    return await ctx.runAction(internal.notifications.sendClinicEmail, {
      clinicId: args.clinicId,
      to: args.patientEmail,
      subject: template.subject,
      html: template.html,
      text: template.text,
    });
  },
});

export const sendSubscriptionStatusAlert = internalAction({
  args: {
    clinicId: v.id("clinics"),
    clinicName: v.string(),
    clinicEmail: v.string(),
    newStatus: v.union(v.literal("past_due"), v.literal("suspended")),
    subscriptionEndsAt: v.number(),
    gracePeriodEndsAt: v.optional(v.number()),
  },
  handler: async (ctx, args): Promise<EmailDispatchResult> => {
    const template = subscriptionExpiryAlertEmail({
      clinicName: args.clinicName,
      newStatus: args.newStatus,
      subscriptionEndsAtFormatted: formatClinicDateTime(args.subscriptionEndsAt),
      graceEndsAtFormatted: args.gracePeriodEndsAt
        ? formatClinicDateTime(args.gracePeriodEndsAt)
        : undefined,
    });

    return await ctx.runAction(internal.notifications.sendClinicEmail, {
      clinicId: args.clinicId,
      to: args.clinicEmail,
      subject: template.subject,
      html: template.html,
      text: template.text,
      skipQuotaCheck: true,
    });
  },
});

type InvitationEmailContext = {
  invitation: Doc<"staffInvitations">;
  clinic: Doc<"clinics"> | null;
  inviterName: string;
} | null;

export const getInvitationEmailContext = internalQuery({
  args: { invitationId: v.id("staffInvitations") },
  handler: async (ctx, args): Promise<InvitationEmailContext> => {
    const invitation = await ctx.db.get(args.invitationId);
    if (!invitation) return null;

    const [clinic, inviter] = await Promise.all([
      invitation.clinicId ? ctx.db.get(invitation.clinicId) : Promise.resolve(null),
      ctx.db.get(invitation.invitedByUserId),
    ]);

    const inviterName = inviter
      ? `${inviter.firstName} ${inviter.lastName}`.trim() || inviter.email
      : "Smile Administrator";

    return { invitation, clinic, inviterName };
  },
});

export const markInvitationEmailStatus = internalMutation({
  args: {
    invitationId: v.id("staffInvitations"),
    emailStatus: v.union(
      v.literal("queued"),
      v.literal("sent"),
      v.literal("failed"),
      v.literal("skipped")
    ),
    emailError: v.optional(v.string()),
  },
  handler: async (ctx, args) => {
    const existing = await ctx.db.get(args.invitationId);
    if (!existing) return;
    await ctx.db.patch(args.invitationId, {
      emailStatus: args.emailStatus,
      emailError: args.emailError,
    });
  },
});

/** Dispatches a branded role invitation email (supports Super Admin, Clinic Admin, Dentist, Receptionist). */
export const sendRoleInvitationEmail = internalAction({
  args: {
    invitationId: v.id("staffInvitations"),
  },
  handler: async (ctx, args): Promise<EmailDispatchResult> => {
    const context: InvitationEmailContext = await ctx.runQuery(
      internal.notifications.getInvitationEmailContext,
      { invitationId: args.invitationId }
    );
    if (!context || !context.invitation.token) {
      return { sent: false, reason: "INVITATION_NOT_FOUND" };
    }

    const { invitation, clinic, inviterName } = context;
    const baseUrl = getAppBaseUrl();
    const acceptUrl = `${baseUrl}/invite/${invitation.token}`;
    const declineUrl = `${baseUrl}/invite/${invitation.token}?action=decline`;

    const template = roleInvitationEmail({
      recipientEmail: invitation.email,
      role: invitation.role,
      scopeName: clinic?.name ?? "Smile Dental SaaS Platform",
      accentHex: clinic?.primaryColorHex ?? "#6C5CE7",
      inviterName,
      inviterNote: invitation.inviterNote,
      expiresFormatted: formatClinicDateTime(invitation.expiresAt),
      acceptUrl,
      declineUrl,
    });

    const apiKey = process.env.RESEND_API_KEY?.trim();
    if (!apiKey) {
      await ctx.runMutation(internal.notifications.markInvitationEmailStatus, {
        invitationId: args.invitationId,
        emailStatus: "skipped",
        emailError: "RESEND_API_KEY not configured — share invite link manually.",
      });
      return { sent: false, reason: "RESEND_NOT_CONFIGURED" };
    }

    let dispatchResult: EmailDispatchResult;
    if (clinic) {
      dispatchResult = await ctx.runAction(internal.notifications.sendClinicEmail, {
        clinicId: clinic._id,
        to: invitation.email,
        subject: template.subject,
        html: template.html,
        text: template.text,
        skipQuotaCheck: true,
      });
    } else {
      const resend = new Resend(apiKey);
      const from =
        process.env.RESEND_FROM_EMAIL?.trim() ||
        "Smile Dental <onboarding@resend.dev>";
      const res = await resend.emails.send({
        from,
        to: invitation.email,
        subject: template.subject,
        html: template.html,
        text: template.text,
      });
      dispatchResult = res.error
        ? { sent: false, reason: res.error.message }
        : { sent: true, id: res.data?.id ?? null };
    }

    await ctx.runMutation(internal.notifications.markInvitationEmailStatus, {
      invitationId: args.invitationId,
      emailStatus: dispatchResult.sent ? "sent" : "failed",
      emailError: dispatchResult.sent
        ? undefined
        : dispatchResult.reason ?? "Email dispatch failed.",
    });

    return dispatchResult;
  },
});
