export type EmailTemplateOutput = {
  subject: string;
  html: string;
  text: string;
};

function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function wrapLayout(
  accentHex: string,
  clinicName: string,
  heading: string,
  bodyHtml: string,
  footerNote: string
): string {
  const safeColor = /^#[0-9a-fA-F]{6}$/.test(accentHex) ? accentHex : "#0284c7";
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" /></head>
<body style="margin:0;padding:24px;background:#f8fafc;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;color:#0f172a;">
  <div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:12px;overflow:hidden;">
    <div style="height:6px;background:${safeColor};"></div>
    <div style="padding:24px;">
      <p style="margin:0 0 8px;font-size:12px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#64748b;">${escapeHtml(clinicName)}</p>
      <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;color:#0f172a;">${escapeHtml(heading)}</h1>
      <div style="font-size:14px;line-height:1.6;color:#334155;">${bodyHtml}</div>
      <hr style="border:none;border-top:1px solid #e2e8f0;margin:24px 0 16px;" />
      <p style="margin:0;font-size:12px;color:#64748b;">${escapeHtml(footerNote)}</p>
    </div>
  </div>
</body>
</html>`;
}

export function bookingConfirmationEmail(params: {
  clinicName: string;
  primaryColorHex: string;
  clinicAddress: string;
  clinicPhone: string;
  cancellationWindowHours: number;
  patientName: string;
  serviceName: string;
  dentistName: string;
  chairName: string;
  formattedDateTime: string;
  referenceCode: string;
}): EmailTemplateOutput {
  const subject = `Appointment Confirmed (${params.referenceCode}) — ${params.clinicName}`;
  const bodyHtml = `
    <p>Hi ${escapeHtml(params.patientName)},</p>
    <p>Your dental appointment at <strong>${escapeHtml(params.clinicName)}</strong> is confirmed.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f8fafc;border-radius:8px;">
      <tr><td style="padding:8px 12px;color:#64748b;">Reference</td><td style="padding:8px 12px;font-weight:600;font-family:monospace;">${escapeHtml(params.referenceCode)}</td></tr>
      <tr><td style="padding:8px 12px;color:#64748b;">Procedure</td><td style="padding:8px 12px;font-weight:600;">${escapeHtml(params.serviceName)}</td></tr>
      <tr><td style="padding:8px 12px;color:#64748b;">Date &amp; Time</td><td style="padding:8px 12px;font-weight:600;">${escapeHtml(params.formattedDateTime)}</td></tr>
      <tr><td style="padding:8px 12px;color:#64748b;">Dentist</td><td style="padding:8px 12px;">${escapeHtml(params.dentistName)} (${escapeHtml(params.chairName)})</td></tr>
      <tr><td style="padding:8px 12px;color:#64748b;">Location</td><td style="padding:8px 12px;">${escapeHtml(params.clinicAddress)}</td></tr>
    </table>
    <p style="font-size:13px;color:#475569;">Please arrive 10 minutes early. Need to reschedule? Let us know at least ${params.cancellationWindowHours} hours ahead at ${escapeHtml(params.clinicPhone)}.</p>
  `;
  return {
    subject,
    html: wrapLayout(
      params.primaryColorHex,
      params.clinicName,
      "Your Dental Appointment is Confirmed",
      bodyHtml,
      `Sent by Smile Dental Scheduling on behalf of ${params.clinicName}.`
    ),
    text: `Hi ${params.patientName},\n\nYour appointment at ${params.clinicName} is confirmed.\nReference: ${params.referenceCode}\nProcedure: ${params.serviceName}\nDate & Time: ${params.formattedDateTime}\nDentist: ${params.dentistName} (${params.chairName})\nAddress: ${params.clinicAddress}\n\nCancellation policy: ${params.cancellationWindowHours} hours notice. Phone: ${params.clinicPhone}`,
  };
}

export function appointmentReminder24hEmail(params: {
  clinicName: string;
  primaryColorHex: string;
  clinicAddress: string;
  clinicPhone: string;
  patientName: string;
  serviceName: string;
  dentistName: string;
  formattedDateTime: string;
}): EmailTemplateOutput {
  const subject = `Reminder: Dental Visit Tomorrow at ${params.clinicName}`;
  const bodyHtml = `
    <p>Hi ${escapeHtml(params.patientName)},</p>
    <p>This is a friendly reminder of your upcoming dental appointment tomorrow:</p>
    <ul style="padding-left:18px;margin:12px 0;">
      <li><strong>Procedure:</strong> ${escapeHtml(params.serviceName)}</li>
      <li><strong>When:</strong> ${escapeHtml(params.formattedDateTime)}</li>
      <li><strong>Dentist:</strong> ${escapeHtml(params.dentistName)}</li>
      <li><strong>Where:</strong> ${escapeHtml(params.clinicAddress)}</li>
    </ul>
    <p>If you cannot make it, please call ${escapeHtml(params.clinicPhone)} so we can offer the slot to another patient.</p>
  `;
  return {
    subject,
    html: wrapLayout(
      params.primaryColorHex,
      params.clinicName,
      "24-Hour Appointment Reminder",
      bodyHtml,
      `Questions? Call ${params.clinicName} at ${params.clinicPhone}.`
    ),
    text: `Hi ${params.patientName},\n\nReminder: ${params.serviceName} with ${params.dentistName} on ${params.formattedDateTime} at ${params.clinicName} (${params.clinicAddress}). Phone: ${params.clinicPhone}.`,
  };
}

export function hygieneRecallEmail(params: {
  clinicName: string;
  primaryColorHex: string;
  clinicPhone: string;
  bookingUrl: string;
  patientName: string;
  lastCleaningDate?: string;
}): EmailTemplateOutput {
  const subject = `Time for Your 6-Month Dental Cleaning — ${params.clinicName}`;
  const bodyHtml = `
    <p>Hi ${escapeHtml(params.patientName)},</p>
    <p>It has been 6 months since your last Oral Prophylaxis${params.lastCleaningDate ? ` (${escapeHtml(params.lastCleaningDate)})` : ""}. Regular cleanings keep your teeth and gums healthy and catch small issues early.</p>
    <p style="margin:20px 0;">
      <a href="${escapeHtml(params.bookingUrl)}" style="display:inline-block;padding:10px 18px;background:${escapeHtml(params.primaryColorHex)};color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">Book Your Cleaning Online</a>
    </p>
    <p style="font-size:13px;color:#475569;">Or call us at ${escapeHtml(params.clinicPhone)}.</p>
  `;
  return {
    subject,
    html: wrapLayout(
      params.primaryColorHex,
      params.clinicName,
      "6-Month Hygiene Recall",
      bodyHtml,
      `Sent by ${params.clinicName} via Smile Dental Scheduling.`
    ),
    text: `Hi ${params.patientName},\n\nIt's time for your 6-month dental cleaning at ${params.clinicName}. Book online: ${params.bookingUrl} or call ${params.clinicPhone}.`,
  };
}

export function waitlistOpeningEmail(params: {
  clinicName: string;
  primaryColorHex: string;
  patientName: string;
  serviceName: string;
  dateKey: string;
  claimUrl: string;
}): EmailTemplateOutput {
  const subject = `Slot Opened on ${params.dateKey} — ${params.clinicName}`;
  const bodyHtml = `
    <p>Hi ${escapeHtml(params.patientName)},</p>
    <p>Good news! A slot just opened up on <strong>${escapeHtml(params.dateKey)}</strong> at <strong>${escapeHtml(params.clinicName)}</strong> for <strong>${escapeHtml(params.serviceName)}</strong>.</p>
    <p style="margin:20px 0;">
      <a href="${escapeHtml(params.claimUrl)}" style="display:inline-block;padding:10px 18px;background:${escapeHtml(params.primaryColorHex)};color:#ffffff;text-decoration:none;border-radius:8px;font-weight:600;">Claim Available Slot Now</a>
    </p>
    <p style="font-size:12px;color:#64748b;">Slots are claimed first-come, first-served with a 5-minute real-time lock during checkout.</p>
  `;
  return {
    subject,
    html: wrapLayout(
      params.primaryColorHex,
      params.clinicName,
      "An Earlier Appointment Slot Opened",
      bodyHtml,
      `Waitlist notification from ${params.clinicName}.`
    ),
    text: `Hi ${params.patientName},\n\nA slot opened on ${params.dateKey} at ${params.clinicName} for ${params.serviceName}. Claim it now: ${params.claimUrl}`,
  };
}

export function subscriptionExpiryAlertEmail(params: {
  clinicName: string;
  newStatus: "past_due" | "suspended";
  subscriptionEndsAtFormatted: string;
  graceEndsAtFormatted?: string;
}): EmailTemplateOutput {
  const isSuspended = params.newStatus === "suspended";
  const subject = isSuspended
    ? `Action Required: ${params.clinicName} is Now in Read-Only Mode`
    : `Renewal Reminder: ${params.clinicName} Subscription Past Due`;

  const bodyHtml = isSuspended
    ? `<p>Your clinic <strong>${escapeHtml(params.clinicName)}</strong> has entered <strong>Read-Only Mode</strong> after its grace period ended.</p>
       <p>Existing clinical charts and odontograms remain viewable, while new bookings on your public portal are paused. Please settle your subscription renewal to restore full access immediately.</p>`
    : `<p>Your subscription for <strong>${escapeHtml(params.clinicName)}</strong> ended on <strong>${escapeHtml(params.subscriptionEndsAtFormatted)}</strong> and is now in a 3-day grace period${params.graceEndsAtFormatted ? ` (until <strong>${escapeHtml(params.graceEndsAtFormatted)}</strong>)` : ""}.</p>
       <p>Please submit your GCash, Maya, or Bank Transfer renewal to keep online bookings uninterrupted.</p>`;

  return {
    subject,
    html: wrapLayout(
      isSuspended ? "#dc2626" : "#d97706",
      "Smile Dental SaaS Platform",
      isSuspended ? "Clinic Subscription Suspended" : "Subscription Renewal Notice",
      bodyHtml,
      "Reply to your platform administrator with your payment reference to renew."
    ),
    text: isSuspended
      ? `${params.clinicName} is now in Read-Only Mode. Existing clinical charts remain viewable, while new online bookings are paused until renewal.`
      : `${params.clinicName} subscription ended on ${params.subscriptionEndsAtFormatted} and entered its 3-day grace period. Please renew to avoid interruption.`,
  };
}

export function subscriptionPaymentReceiptEmail(params: {
  clinicName: string;
  invoiceNumber: string;
  planName: string;
  billingCycle: "monthly" | "annual";
  amountPhp: number;
  paymentMethodLabel: string;
  referenceNumber?: string;
  periodStartFormatted: string;
  periodEndFormatted: string;
  receiptUrl?: string | null;
}): EmailTemplateOutput {
  const formattedAmount = `₱${params.amountPhp.toLocaleString("en-PH")}`;
  const subject = `Payment Receipt ${params.invoiceNumber} — ${params.clinicName}`;
  const receiptButton = params.receiptUrl
    ? `<p style="margin:20px 0 8px;">
         <a href="${escapeHtml(params.receiptUrl)}" style="display:inline-block;padding:10px 18px;background:#6C5CE7;color:#ffffff;text-decoration:none;border-radius:9999px;font-weight:600;font-size:13px;">Download Attached Receipt</a>
       </p>`
    : "";

  const bodyHtml = `
    <p>Hello ${escapeHtml(params.clinicName)} Team,</p>
    <p>Thank you! Your Smile Dental SaaS subscription payment has been verified and your clinic is active.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f8fafc;border-radius:8px;">
      <tr><td style="padding:8px 12px;color:#64748b;">Invoice #</td><td style="padding:8px 12px;font-weight:600;font-family:monospace;">${escapeHtml(params.invoiceNumber)}</td></tr>
      <tr><td style="padding:8px 12px;color:#64748b;">Plan</td><td style="padding:8px 12px;font-weight:600;">${escapeHtml(params.planName)} (${escapeHtml(params.billingCycle)})</td></tr>
      <tr><td style="padding:8px 12px;color:#64748b;">Amount Paid</td><td style="padding:8px 12px;font-weight:700;color:#0f172a;">${escapeHtml(formattedAmount)}</td></tr>
      <tr><td style="padding:8px 12px;color:#64748b;">Method</td><td style="padding:8px 12px;">${escapeHtml(params.paymentMethodLabel)}${params.referenceNumber ? ` (Ref: ${escapeHtml(params.referenceNumber)})` : ""}</td></tr>
      <tr><td style="padding:8px 12px;color:#64748b;">Coverage Period</td><td style="padding:8px 12px;">${escapeHtml(params.periodStartFormatted)} – ${escapeHtml(params.periodEndFormatted)}</td></tr>
    </table>
    ${receiptButton}
    <p style="font-size:13px;color:#475569;">You can view all invoices and live plan quotas anytime inside <strong>Clinic Admin → Subscription &amp; Billing</strong>.</p>
  `;

  return {
    subject,
    html: wrapLayout(
      "#6C5CE7",
      "Smile Dental SaaS Platform",
      "Subscription Payment Verified",
      bodyHtml,
      `Official digital invoice record ${params.invoiceNumber} from Smile Dental SaaS.`
    ),
    text: `Payment Receipt ${params.invoiceNumber}\nClinic: ${params.clinicName}\nPlan: ${params.planName} (${params.billingCycle})\nAmount Paid: ${formattedAmount}\nMethod: ${params.paymentMethodLabel}${params.referenceNumber ? ` (Ref: ${params.referenceNumber})` : ""}\nCoverage: ${params.periodStartFormatted} – ${params.periodEndFormatted}${params.receiptUrl ? `\nReceipt: ${params.receiptUrl}` : ""}`,
  };
}

export function subscriptionRenewalReminderEmail(params: {
  clinicName: string;
  planName: string;
  status: string;
  amountPhp: number;
  billingCycle: string;
  endsAtFormatted: string;
  customNote?: string;
}): EmailTemplateOutput {
  const isTrial = params.status === "trial";
  const formattedRate = `₱${params.amountPhp.toLocaleString("en-PH")}`;
  const subject = isTrial
    ? `Your Smile Free Trial for ${params.clinicName} Ends ${params.endsAtFormatted}`
    : `Upcoming Subscription Renewal — ${params.clinicName}`;

  const noteHtml = params.customNote
    ? `<div style="margin:14px 0;padding:12px 14px;background:#f8fafc;border-left:3px solid #6C5CE7;border-radius:6px;font-size:13px;color:#334155;">
         ${escapeHtml(params.customNote)}
       </div>`
    : "";

  const bodyHtml = `
    <p>Hello ${escapeHtml(params.clinicName)} Team,</p>
    <p>This is a friendly reminder that your <strong>${escapeHtml(params.planName)}</strong> ${isTrial ? "trial" : "subscription"} is scheduled to end on <strong>${escapeHtml(params.endsAtFormatted)}</strong>.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f8fafc;border-radius:8px;">
      <tr><td style="padding:8px 12px;color:#64748b;">Current Plan</td><td style="padding:8px 12px;font-weight:600;">${escapeHtml(params.planName)}</td></tr>
      <tr><td style="padding:8px 12px;color:#64748b;">Status</td><td style="padding:8px 12px;text-transform:capitalize;">${escapeHtml(params.status.replace("_", " "))}</td></tr>
      <tr><td style="padding:8px 12px;color:#64748b;">Renewal Rate</td><td style="padding:8px 12px;font-weight:600;">${escapeHtml(formattedRate)} / ${escapeHtml(params.billingCycle)}</td></tr>
      <tr><td style="padding:8px 12px;color:#64748b;">Renewal Date</td><td style="padding:8px 12px;font-weight:600;">${escapeHtml(params.endsAtFormatted)}</td></tr>
    </table>
    ${noteHtml}
    <p style="font-size:13px;color:#475569;">Reply with your GCash, Maya, or Bank Transfer confirmation so we can extend your billing cycle without interrupting patient online bookings.</p>
  `;

  return {
    subject,
    html: wrapLayout(
      "#d97706",
      "Smile Dental SaaS Platform",
      isTrial ? "Your Free Trial is Ending Soon" : "Subscription Renewal Reminder",
      bodyHtml,
      "Sent by your Smile Dental SaaS Platform Administrator."
    ),
    text: `Hello ${params.clinicName},\n\nYour ${params.planName} ${isTrial ? "trial" : "subscription"} ends on ${params.endsAtFormatted} (Rate: ${formattedRate}/${params.billingCycle}).${params.customNote ? `\n\nNote: ${params.customNote}` : ""}\n\nPlease settle your renewal via GCash, Maya, or Bank Transfer to avoid interruption.`,
  };
}

const INVITE_ROLE_LABELS: Record<
  "super_admin" | "clinic_admin" | "dentist" | "receptionist",
  { label: string; summary: string }
> = {
  super_admin: {
    label: "Super Admin",
    summary:
      "Full SaaS platform oversight, clinic provisioning, billing ledger, and audit controls.",
  },
  clinic_admin: {
    label: "Clinic Admin",
    summary:
      "Manage clinic dentists, operatory chairs, dental services, branding, staff, and reports.",
  },
  dentist: {
    label: "Dentist",
    summary:
      "View your daily chair queue, chart the 32-tooth interactive Odontogram, and manage X-rays.",
  },
  receptionist: {
    label: "Receptionist",
    summary:
      "Operate the front-desk calendar, live patient check-in board, walk-ins, and waitlist.",
  },
};

export function roleInvitationEmail(params: {
  recipientEmail: string;
  role: "super_admin" | "clinic_admin" | "dentist" | "receptionist";
  scopeName: string;
  accentHex: string;
  inviterName: string;
  inviterNote?: string;
  expiresFormatted: string;
  acceptUrl: string;
  declineUrl: string;
}): EmailTemplateOutput {
  const roleMeta = INVITE_ROLE_LABELS[params.role];
  const isPlatform = params.role === "super_admin";
  const subject = isPlatform
    ? `You're invited to join Smile Dental as a ${roleMeta.label}`
    : `You're invited to join ${params.scopeName} on Smile as a ${roleMeta.label}`;

  const noteBlock = params.inviterNote
    ? `<div style="margin:16px 0;padding:12px 14px;background:#f8fafc;border-left:3px solid ${escapeHtml(params.accentHex)};border-radius:6px;font-size:13px;color:#334155;">
         <strong style="display:block;margin-bottom:4px;color:#0f172a;">Note from ${escapeHtml(params.inviterName)}:</strong>
         ${escapeHtml(params.inviterNote)}
       </div>`
    : "";

  const bodyHtml = `
    <p>Hello,</p>
    <p><strong>${escapeHtml(params.inviterName)}</strong> has invited you to join <strong>${escapeHtml(params.scopeName)}</strong> on the <strong>Smile Dental Scheduling System</strong> as a <strong>${escapeHtml(roleMeta.label)}</strong>.</p>
    <table style="width:100%;border-collapse:collapse;margin:16px 0;background:#f8fafc;border-radius:8px;">
      <tr><td style="padding:8px 12px;color:#64748b;width:120px;">Assigned Role</td><td style="padding:8px 12px;font-weight:600;color:#0f172a;">${escapeHtml(roleMeta.label)}</td></tr>
      <tr><td style="padding:8px 12px;color:#64748b;">Workspace</td><td style="padding:8px 12px;font-weight:600;color:#0f172a;">${escapeHtml(params.scopeName)}</td></tr>
      <tr><td style="padding:8px 12px;color:#64748b;">Invited Email</td><td style="padding:8px 12px;font-family:monospace;font-size:12px;color:#334155;">${escapeHtml(params.recipientEmail)}</td></tr>
      <tr><td style="padding:8px 12px;color:#64748b;">Expires</td><td style="padding:8px 12px;color:#334155;">${escapeHtml(params.expiresFormatted)}</td></tr>
    </table>
    <p style="font-size:13px;color:#475569;">${escapeHtml(roleMeta.summary)}</p>
    ${noteBlock}
    <div style="margin:24px 0 16px;">
      <a href="${escapeHtml(params.acceptUrl)}" style="display:inline-block;padding:12px 22px;background:${escapeHtml(params.accentHex)};color:#ffffff;text-decoration:none;border-radius:9999px;font-weight:600;font-size:14px;">Review &amp; Accept Invitation</a>
    </div>
    <p style="margin:0 0 16px;font-size:13px;">
      Not expecting this invite? <a href="${escapeHtml(params.declineUrl)}" style="color:#64748b;text-decoration:underline;">Decline this invitation</a>.
    </p>
    <p style="font-size:12px;color:#64748b;">For security, only an account signed in with <strong>${escapeHtml(params.recipientEmail)}</strong> can accept this role assignment.</p>
  `;

  return {
    subject,
    html: wrapLayout(
      params.accentHex,
      isPlatform ? "Smile Dental SaaS Platform" : params.scopeName,
      `You're Invited as a ${roleMeta.label}`,
      bodyHtml,
      `If the button above does not work, copy and open this link: ${params.acceptUrl}`
    ),
    text: `Hello,\n\n${params.inviterName} has invited you to join ${params.scopeName} on Smile Dental as a ${roleMeta.label}.\n\nAssigned Role: ${roleMeta.label}\nWorkspace: ${params.scopeName}\nInvited Email: ${params.recipientEmail}\nExpires: ${params.expiresFormatted}\n${params.inviterNote ? `\nNote: ${params.inviterNote}\n` : ""}\nAccept invitation: ${params.acceptUrl}\nDecline invitation: ${params.declineUrl}\n\nSign in or sign up with ${params.recipientEmail} to activate your role.`,
  };
}
