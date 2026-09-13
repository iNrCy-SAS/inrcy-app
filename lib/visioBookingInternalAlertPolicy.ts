import { createHash } from "node:crypto";

export const VISIO_BOOKING_INTERNAL_ALERT_SCOPE =
  "visio_booking_internal_alert_v1";
export const VISIO_BOOKING_INTERNAL_ALERT_LOCK_TTL_MS = 10 * 60 * 1000;
export const VISIO_BOOKING_INTERNAL_ALERT_MAX_ATTEMPTS = 12;
export const REQUIRED_VISIO_BOOKING_INTERNAL_ALERT_EMAIL = "compte@inrcy.com";

export type VisioBookingInternalAlertPayload = {
  googleEventId: string;
  prospectUserId: string;
  recipient: string;
  assignedMemberId: string;
  assignedMemberName: string;
  prospectName: string;
  company: string;
  prospectEmail: string;
  prospectPhone: string;
  dateLabel: string;
  timeLabel: string;
  meetUrl: string;
  calendarUrl: string;
  subject: string;
  text: string;
};

function clean(value: unknown) {
  return String(value || "").trim();
}

function normalizedEmail(value: unknown) {
  const email = clean(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function digest(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function buildVisioBookingInternalAlertRecipients(input: {
  assignedMemberEmail?: unknown;
  configuredRecipients?: unknown;
}) {
  const configured = Array.isArray(input.configuredRecipients)
    ? input.configuredRecipients
    : clean(input.configuredRecipients).split(/[;,]/);
  return Array.from(
    new Set(
      [
        REQUIRED_VISIO_BOOKING_INTERNAL_ALERT_EMAIL,
        input.assignedMemberEmail,
        ...configured,
      ]
        .map(normalizedEmail)
        .filter(Boolean),
    ),
  );
}

export function buildVisioBookingInternalAlertDeliveryKey(input: {
  googleEventId: unknown;
  recipient: unknown;
}) {
  const googleEventId = clean(input.googleEventId);
  const recipient = normalizedEmail(input.recipient);
  if (!googleEventId || !recipient) {
    throw new Error("visio_booking_internal_alert_invalid");
  }
  return `v1:${digest(`${googleEventId}\n${recipient}`)}`;
}

export function buildVisioBookingInternalAlertPayload(input: {
  googleEventId: unknown;
  prospectUserId: unknown;
  recipient: unknown;
  assignedMemberId: unknown;
  assignedMemberName: unknown;
  prospectName: unknown;
  company?: unknown;
  prospectEmail: unknown;
  prospectPhone?: unknown;
  dateLabel: unknown;
  timeLabel: unknown;
  meetUrl?: unknown;
  calendarUrl?: unknown;
}): VisioBookingInternalAlertPayload {
  const googleEventId = clean(input.googleEventId);
  const prospectUserId = clean(input.prospectUserId);
  const recipient = normalizedEmail(input.recipient);
  const assignedMemberName = clean(input.assignedMemberName) || "Équipe iNrCy";
  const prospectName = clean(input.prospectName) || "Professionnel iNrCy";
  const company = clean(input.company);
  const prospectEmail = normalizedEmail(input.prospectEmail);
  const dateLabel = clean(input.dateLabel);
  const timeLabel = clean(input.timeLabel);
  if (
    !googleEventId ||
    !prospectUserId ||
    !recipient ||
    !prospectEmail ||
    !dateLabel ||
    !timeLabel
  ) {
    throw new Error("visio_booking_internal_alert_invalid");
  }

  const meetUrl = clean(input.meetUrl);
  const calendarUrl = clean(input.calendarUrl);
  const subject = `Nouveau rendez-vous visio iNrCy — ${company || prospectName}`;
  const text = [
    "Un rendez-vous de présentation a été réservé après une inscription.",
    `Date : ${dateLabel} à ${timeLabel}`,
    `Attribué à : ${assignedMemberName}`,
    `Professionnel : ${prospectName}`,
    company ? `Société : ${company}` : "",
    `E-mail : ${prospectEmail}`,
    clean(input.prospectPhone) ? `Téléphone : ${clean(input.prospectPhone)}` : "",
    meetUrl ? `Google Meet : ${meetUrl}` : "",
    !meetUrl && calendarUrl ? `Google Agenda : ${calendarUrl}` : "",
  ]
    .filter(Boolean)
    .join("\n");

  return {
    googleEventId,
    prospectUserId,
    recipient,
    assignedMemberId: clean(input.assignedMemberId),
    assignedMemberName,
    prospectName,
    company,
    prospectEmail,
    prospectPhone: clean(input.prospectPhone),
    dateLabel,
    timeLabel,
    meetUrl,
    calendarUrl,
    subject,
    text,
  };
}

export function readVisioBookingInternalAlertPayload(
  value: unknown,
): VisioBookingInternalAlertPayload | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  try {
    return buildVisioBookingInternalAlertPayload({
      googleEventId: row.googleEventId,
      prospectUserId: row.prospectUserId,
      recipient: row.recipient,
      assignedMemberId: row.assignedMemberId,
      assignedMemberName: row.assignedMemberName,
      prospectName: row.prospectName,
      company: row.company,
      prospectEmail: row.prospectEmail,
      prospectPhone: row.prospectPhone,
      dateLabel: row.dateLabel,
      timeLabel: row.timeLabel,
      meetUrl: row.meetUrl,
      calendarUrl: row.calendarUrl,
    });
  } catch {
    return null;
  }
}

export function visioBookingInternalAlertAttemptCount(metadata: unknown) {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) return 0;
  const count = Number((metadata as Record<string, unknown>).attemptCount || 0);
  return Number.isFinite(count) ? Math.max(0, Math.floor(count)) : 0;
}

export function visioBookingInternalAlertRetryAt(input: {
  attemptCount: number;
  deliveryKey: string;
  now?: Date;
}) {
  const attempt = Math.max(1, Math.floor(input.attemptCount));
  const baseMs = Math.min(6 * 60 * 60 * 1000, 60_000 * 2 ** (attempt - 1));
  const jitterMs = Number.parseInt(digest(input.deliveryKey).slice(0, 6), 16) % 30_001;
  return new Date((input.now || new Date()).getTime() + baseMs + jitterMs);
}

export function smtpAcceptedVisioBookingRecipient(
  recipient: string,
  accepted: unknown,
) {
  const expected = normalizedEmail(recipient);
  if (!expected || !Array.isArray(accepted)) return false;
  return accepted.some((value) => normalizedEmail(value) === expected);
}

export function visioBookingInternalAlertErrorCode(error: unknown) {
  const raw = error instanceof Error ? error.message : String(error || "send_failed");
  return raw
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9:_-]+/g, "_")
    .slice(0, 120) || "send_failed";
}
