import { createHash } from "node:crypto";

import {
  INR_CALENDAR_GOOGLE_GUEST_EMAILS_PROPERTY,
  INR_CALENDAR_GOOGLE_SOURCE,
} from "./inrCalendarGoogleSyncConstants.ts";
import { CALENDAR_REMINDER_MANUAL_ONLY_POLICY } from "./calendarReminderDeliveryPolicy.ts";
import { canonicalVisioAppointmentIdentity } from "./visioAppointmentIdentity.ts";

export type InrCalendarGoogleEvent = {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  updated?: string;
  htmlLink?: string;
  hangoutLink?: string;
  colorId?: string;
  organizer?: { email?: string; displayName?: string; self?: boolean };
  attendees?: Array<{
    email?: string;
    displayName?: string;
    organizer?: boolean;
    self?: boolean;
    responseStatus?: string;
  }>;
  start?: { dateTime?: string; date?: string; timeZone?: string };
  end?: { dateTime?: string; date?: string; timeZone?: string };
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
  };
  extendedProperties?: {
    private?: Record<string, string>;
  };
};

export type InrCalendarGoogleRow = {
  id: string;
  user_id: string;
  title: string;
  description: string | null;
  location: string | null;
  start_at: string;
  end_at: string;
  all_day: boolean;
  meta: Record<string, unknown>;
};

function cleanString(value: unknown) {
  return String(value ?? "").trim();
}

function safeObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function normalizeEmail(value: unknown) {
  const email = cleanString(value).toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

function parsedMirroredGuestEmails(value: unknown) {
  try {
    const parsed = JSON.parse(cleanString(value));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function bookingEmailFromDescription(event: InrCalendarGoogleEvent) {
  const isBooking = cleanString(event.extendedProperties?.private?.inrcyBooking);
  if (!isBooking) return "";
  return normalizeEmail(
    cleanString(event.description).match(
      /(?:^|\r?\n)\s*E-mail\s*:\s*([^\s\r\n]+)\s*(?=\r?\n|$)/i,
    )?.[1],
  );
}

function googleReminderGuests(input: {
  event: InrCalendarGoogleEvent;
  calendarId: string;
  internalEmails?: string[];
}) {
  const privateProperties = input.event.extendedProperties?.private || {};
  const internal = new Set(
    [
      input.calendarId,
      privateProperties.sourceCalendarId,
      privateProperties.assignedMemberEmail,
      ...(input.internalEmails || []),
    ]
      .map(normalizeEmail)
      .filter(Boolean),
  );
  const candidates = [
    {
      email: input.event.organizer?.email,
      displayName: input.event.organizer?.displayName,
      declined: false,
      self: input.event.organizer?.self,
    },
    ...(input.event.attendees || []).map((attendee) => ({
      email: attendee.email,
      displayName: attendee.displayName,
      declined: String(attendee.responseStatus || "").toLowerCase() === "declined",
      self: attendee.self,
    })),
    ...parsedMirroredGuestEmails(
      privateProperties[INR_CALENDAR_GOOGLE_GUEST_EMAILS_PROPERTY],
    ).map((email) => ({ email, displayName: "", declined: false, self: false })),
    {
      email: bookingEmailFromDescription(input.event),
      displayName: "",
      declined: false,
      self: false,
    },
  ];
  const guests = new Map<string, { email: string; display_name?: string }>();

  for (const candidate of candidates) {
    const email = normalizeEmail(candidate.email);
    if (
      !email ||
      candidate.self ||
      candidate.declined ||
      internal.has(email) ||
      email.endsWith("@inrcy.com") ||
      email.endsWith("@admin-inrcy.com") ||
      email.endsWith("@group.calendar.google.com") ||
      email.endsWith("@resource.calendar.google.com")
    ) {
      continue;
    }
    const displayName = cleanString(candidate.displayName);
    const previous = guests.get(email);
    guests.set(email, {
      email,
      ...(displayName || previous?.display_name
        ? { display_name: displayName || previous?.display_name }
        : {}),
    });
  }

  return Array.from(guests.values()).sort((left, right) =>
    left.email.localeCompare(right.email),
  );
}

function strictDateOnly(value: unknown) {
  const text = cleanString(value);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return "";
  const parsed = new Date(`${text}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === text
    ? text
    : "";
}

export function buildInrCalendarGoogleEventId(
  calendarIdInput: string,
  eventIdInput: string,
) {
  const calendarId = cleanString(calendarIdInput);
  const eventId = cleanString(eventIdInput);
  if (!calendarId || !eventId) {
    throw new Error("inrcalendar_google_event_identity_required");
  }

  const hash = createHash("sha256")
    .update(`inrcy-inrcalendar-google:v1:${calendarId}:${eventId}`, "utf8")
    .digest("hex")
    .slice(0, 32);
  const versioned = `${hash.slice(0, 12)}5${hash.slice(13)}`;
  const variantNibble = (8 + (Number.parseInt(versioned[16], 16) % 4)).toString(16);
  const normalized = `${versioned.slice(0, 16)}${variantNibble}${versioned.slice(17)}`;
  return `${normalized.slice(0, 8)}-${normalized.slice(8, 12)}-${normalized.slice(12, 16)}-${normalized.slice(16, 20)}-${normalized.slice(20)}`;
}

export function buildInrCalendarCanonicalEventId(
  calendarIdInput: string,
  appointmentIdentityInput: string,
) {
  const calendarId = cleanString(calendarIdInput);
  const appointmentIdentity = cleanString(appointmentIdentityInput);
  if (!calendarId || !appointmentIdentity) {
    throw new Error("inrcalendar_canonical_appointment_identity_required");
  }

  return buildInrCalendarGoogleEventId(
    calendarId,
    `canonical:v2:${appointmentIdentity}`,
  );
}

export function getInrCalendarGoogleEventRange(event: InrCalendarGoogleEvent) {
  const startDateTime = cleanString(event.start?.dateTime);
  const endDateTime = cleanString(event.end?.dateTime);
  if (startDateTime || endDateTime) {
    const startTime = Date.parse(startDateTime);
    const endTime = Date.parse(endDateTime);
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime) || endTime <= startTime) {
      return null;
    }
    return {
      startAt: new Date(startTime).toISOString(),
      endAt: new Date(endTime).toISOString(),
      allDay: false,
    };
  }

  const startDate = strictDateOnly(event.start?.date);
  const endDate = strictDateOnly(event.end?.date);
  if (!startDate || !endDate || endDate <= startDate) return null;
  return {
    startAt: `${startDate}T00:00:00.000Z`,
    endAt: `${endDate}T00:00:00.000Z`,
    allDay: true,
  };
}

function eventMeetUrl(event: InrCalendarGoogleEvent) {
  return cleanString(
    event.hangoutLink ||
      event.conferenceData?.entryPoints?.find(
        (entry) => entry.entryPointType === "video",
      )?.uri ||
      event.extendedProperties?.private?.sourceMeetUrl,
  );
}

export function buildInrCalendarGoogleRow(input: {
  event: InrCalendarGoogleEvent;
  calendarId: string;
  adminUserId: string;
  internalEmails?: string[];
  canonicalIdentity?: string;
  previous?: {
    start_at?: string | null;
    end_at?: string | null;
    meta?: unknown;
  } | null;
}): InrCalendarGoogleRow | null {
  const calendarId = cleanString(input.calendarId);
  const adminUserId = cleanString(input.adminUserId);
  const eventId = cleanString(input.event.id);
  if (
    !calendarId ||
    !adminUserId ||
    !eventId ||
    cleanString(input.event.status).toLowerCase() === "cancelled"
  ) {
    return null;
  }

  const range = getInrCalendarGoogleEventRange(input.event);
  if (!range) return null;

  const privateProperties = input.event.extendedProperties?.private || {};
  const appointmentStatus =
    cleanString(privateProperties.inrcyAppointmentStatus) || null;
  const canonicalIdentity =
    cleanString(input.canonicalIdentity) ||
    canonicalVisioAppointmentIdentity(input.event);
  const htmlLink = cleanString(input.event.htmlLink);
  const meetUrl = eventMeetUrl(input.event);
  const previousMeta = safeObject(input.previous?.meta);
  const previousReminders = safeObject(previousMeta.reminders);
  const previousGoogle = safeObject(previousMeta.google);
  const timeChanged = Boolean(
    input.previous &&
      (cleanString(input.previous.start_at) !== range.startAt ||
        cleanString(input.previous.end_at) !== range.endAt),
  );
  const guests = googleReminderGuests({
    event: input.event,
    calendarId,
    internalEmails: input.internalEmails,
  });

  return {
    id: buildInrCalendarCanonicalEventId(calendarId, canonicalIdentity),
    user_id: adminUserId,
    title: cleanString(input.event.summary) || "(Sans titre)",
    description: cleanString(input.event.description) || null,
    location: cleanString(input.event.location) || null,
    start_at: range.startAt,
    end_at: range.endAt,
    all_day: range.allDay,
    meta: {
      ...previousMeta,
      source: INR_CALENDAR_GOOGLE_SOURCE,
      appointmentIdentity: canonicalIdentity,
      appointmentStatus,
      status: "confirmed",
      kind: "agenda",
      readOnly: true,
      guests,
      reminders: {
        ...previousReminders,
        // A Google/site booking sends its invitation once at creation. The
        // generic iNrCalendar cron must never turn guests into reminder
        // recipients; another link can only leave through the manual action.
        enabled: false,
        deliveryPolicy: CALENDAR_REMINDER_MANUAL_ONLY_POLICY,
        inAppMinutesBefore: Number(previousReminders.inAppMinutesBefore ?? 120),
        emailMinutesBefore: Number(previousReminders.emailMinutesBefore ?? 1440),
        mailAccountId:
          typeof previousReminders.mailAccountId === "string"
            ? previousReminders.mailAccountId
            : null,
        lastInAppReminderAt: timeChanged
          ? null
          : typeof previousReminders.lastInAppReminderAt === "string"
            ? previousReminders.lastInAppReminderAt
            : null,
        lastEmailReminderAt: timeChanged
          ? null
          : typeof previousReminders.lastEmailReminderAt === "string"
            ? previousReminders.lastEmailReminderAt
            : null,
        emailSentAtByRecipient: timeChanged
          ? {}
          : safeObject(previousReminders.emailSentAtByRecipient),
      },
      google: {
        ...previousGoogle,
        provider: "google",
        calendarId,
        eventId,
        updated: cleanString(input.event.updated) || null,
        status: cleanString(input.event.status) || "confirmed",
        htmlLink: htmlLink || null,
        meetUrl: meetUrl || null,
        colorId: cleanString(input.event.colorId) || null,
        appointmentStatus,
        sourceCalendarId: cleanString(privateProperties.sourceCalendarId) || null,
        sourceEventId: cleanString(privateProperties.sourceEventId) || null,
        assignedMemberId: cleanString(privateProperties.assignedMemberId) || null,
        assignedMemberEmail: cleanString(privateProperties.assignedMemberEmail) || null,
        bookingNonce: cleanString(privateProperties.bookingNonce) || null,
        canonicalIdentity,
      },
    },
  };
}
