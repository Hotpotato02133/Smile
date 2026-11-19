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
