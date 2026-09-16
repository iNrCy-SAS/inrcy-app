import { createHash } from "node:crypto";

import {
  buildVisioAppointmentCalendarContent,
  type VisioAppointmentPublicDetails,
} from "./visioBookingEventPolicy.ts";
import {
  lifecyclePrivateProperties,
  visioAppointmentColorId,
} from "./visioAppointmentLifecycle.ts";
import {
  PENDING_SIGNUP_ASSIGNMENT_KEY,
  PENDING_SIGNUP_ASSIGNMENT_VALUE,
  TEAM_CALENDAR_MIRROR_KEY,
  TEAM_CALENDAR_MIRROR_VALUE,
} from "./visioCalendarMirrorPolicy.ts";
import { VISIO_BOOKING_TIMEZONE } from "./visioBookingPolicy.ts";

const PENDING_SIGNUP_DURATION_MS = 60 * 60_000;

export type PendingSignupReminderInput = VisioAppointmentPublicDetails & {
  userId: string;
  calendarId: string;
  createdAt: Date | string;
};

export function pendingSignupReminderEventId(userId: string) {
  const normalizedUserId = String(userId || "").trim();
  if (!normalizedUserId) throw new Error("visio_pending_signup_user_id_missing");

  // Google event ids accept lowercase hexadecimal characters. A deterministic
  // id turns retries and the Gmail fallback into one recoverable operation.
  return createHash("sha256")
    .update(`inrcy:visio:pending-signup:${normalizedUserId}`)
    .digest("hex")
    .slice(0, 40);
}

export function buildPendingSignupReminderCalendarEvent(
  input: PendingSignupReminderInput,
) {
  const userId = String(input.userId || "").trim();
  const calendarId = String(input.calendarId || "").trim();
  const start = input.createdAt instanceof Date
    ? new Date(input.createdAt.getTime())
    : new Date(input.createdAt);
  if (!userId) throw new Error("visio_pending_signup_user_id_missing");
  if (!calendarId) throw new Error("visio_pending_signup_calendar_id_missing");
  if (!Number.isFinite(start.getTime())) {
    throw new Error("visio_pending_signup_created_at_invalid");
  }

  const eventId = pendingSignupReminderEventId(userId);
  const end = new Date(start.getTime() + PENDING_SIGNUP_DURATION_MS);
  const content = buildVisioAppointmentCalendarContent({
    firstName: input.firstName,
    lastName: input.lastName,
    email: input.email,
    company: input.company,
    phone: input.phone,
  });

  return {
    id: eventId,
    status: "confirmed",
    ...content,
    colorId: visioAppointmentColorId("signup_pending"),
    visibility: "default",
    transparency: "opaque",
    start: {
      dateTime: start.toISOString(),
      timeZone: VISIO_BOOKING_TIMEZONE,
    },
    end: {
      dateTime: end.toISOString(),
      timeZone: VISIO_BOOKING_TIMEZONE,
    },
    attendees: [],
    reminders: { useDefault: false, overrides: [] as never[] },
    extendedProperties: {
      private: {
        ...lifecyclePrivateProperties({
          status: "signup_pending",
          origin: "signup_without_appointment",
        }),
        [PENDING_SIGNUP_ASSIGNMENT_KEY]: PENDING_SIGNUP_ASSIGNMENT_VALUE,
        [TEAM_CALENDAR_MIRROR_KEY]: TEAM_CALENDAR_MIRROR_VALUE,
        inrcyLogicalAppointmentId: `prospect:${userId}`,
        prospectUserId: userId,
        sourceCalendarId: calendarId,
        sourceEventId: eventId,
        sourceOrganizerEmail: calendarId,
        sourceCalendarIsOrganizer: "true",
        sharedCalendarId: calendarId,
      },
    },
  };
}
