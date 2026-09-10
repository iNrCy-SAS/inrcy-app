import { createHash } from "node:crypto";

import { INR_CALENDAR_GOOGLE_SOURCE } from "./inrCalendarGoogleSyncConstants.ts";

export const CALENDAR_REMINDER_IDEMPOTENCY_SCOPE = "calendar_reminder_email_v1";
export const CALENDAR_REMINDER_LOCK_TTL_MS = 7 * 24 * 60 * 60 * 1000;
export const CALENDAR_REMINDER_MANUAL_ONLY_POLICY = "manual_only";

type ReminderEventIdentityInput = {
  id: string;
  startAt: string;
  meta: unknown;
};

type ReminderDeliveryKeyInput = ReminderEventIdentityInput & {
  recipientKey: string;
  offsetMinutes: number;
};

function safeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function clean(value: unknown) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function fingerprint(value: string) {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

/**
 * Finds the identity of the real appointment rather than the identity of an
 * iNrCalendar mirror row. This deliberately collapses legacy duplicate rows
 * which still point to the same booking or source Google event.
 */
export function calendarReminderEventIdentity(input: ReminderEventIdentityInput) {
  const meta = safeObject(input.meta);
  const google = safeObject(meta.google);
  const inrcy = safeObject(meta.inrcy);
  const privateMeta = safeObject(meta.private);

  const bookingNonce =
    clean(google.bookingNonce) ||
    clean(meta.bookingNonce) ||
    clean(inrcy.bookingNonce) ||
    clean(privateMeta.bookingNonce);
  if (bookingNonce) return `booking:${bookingNonce}`;

  const sourceCalendarId = clean(google.sourceCalendarId);
  const sourceEventId = clean(google.sourceEventId);
  if (sourceCalendarId && sourceEventId) {
    return `source:${sourceCalendarId}:${sourceEventId}`;
  }

  const googleCalendarId = clean(google.calendarId);
  const googleEventId = clean(google.eventId);
  if (googleCalendarId && googleEventId) {
    return `google:${googleCalendarId}:${googleEventId}`;
  }

  const appointmentIdentity =
    clean(meta.appointmentIdentity) || clean(inrcy.appointmentIdentity);
  if (appointmentIdentity) return `appointment:${appointmentIdentity}`;

  return `agenda:${clean(input.id)}`;
}

/**
 * Contains no e-mail address or customer data: only a one-way digest is kept
 * in the durable idempotency table.
 */
export function buildCalendarReminderDeliveryKey(input: ReminderDeliveryKeyInput) {
  const canonicalEvent = calendarReminderEventIdentity(input);
  const occurrence = clean(input.startAt);
  const recipient = clean(input.recipientKey);
  const offset = Number.isFinite(input.offsetMinutes)
    ? Math.max(0, Math.round(input.offsetMinutes))
    : 0;
  const digest = fingerprint(
    [canonicalEvent, occurrence, recipient, String(offset)].join("\n"),
  );
  return `v1:${digest}`;
}

export function calendarReminderDeliveryFingerprint(input: ReminderDeliveryKeyInput) {
  return buildCalendarReminderDeliveryKey(input).slice(3);
}

/**
 * Google appointments already own their delivery lifecycle. They must never
 * enter the generic iNrCalendar reminder cron, even if a stale mirror row
 * still contains `enabled: true` from a previous synchronization version.
 */
export function shouldRunAutomaticCalendarReminders(metaInput: unknown) {
  const meta = safeObject(metaInput);
  const reminders = safeObject(meta.reminders);
  return !(
    clean(meta.source) === INR_CALENDAR_GOOGLE_SOURCE ||
    clean(reminders.deliveryPolicy) === CALENDAR_REMINDER_MANUAL_ONLY_POLICY
  );
}
