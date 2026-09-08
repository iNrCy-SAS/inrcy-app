import { createHash } from "node:crypto";

import { INR_CALENDAR_GOOGLE_SOURCE } from "./inrCalendarGoogleSyncConstants.ts";

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
  const htmlLink = cleanString(input.event.htmlLink);
  const meetUrl = eventMeetUrl(input.event);

  return {
    id: buildInrCalendarGoogleEventId(calendarId, eventId),
    user_id: adminUserId,
    title: cleanString(input.event.summary) || "(Sans titre)",
    description: cleanString(input.event.description) || null,
    location: cleanString(input.event.location) || null,
    start_at: range.startAt,
    end_at: range.endAt,
    all_day: range.allDay,
    meta: {
      source: INR_CALENDAR_GOOGLE_SOURCE,
      status: "confirmed",
      kind: "agenda",
      readOnly: true,
      reminders: {
        enabled: false,
        inAppMinutesBefore: 120,
        emailMinutesBefore: 1440,
        mailAccountId: null,
        lastInAppReminderAt: null,
        lastEmailReminderAt: null,
        emailSentAtByRecipient: {},
      },
      google: {
        provider: "google",
        calendarId,
        eventId,
        updated: cleanString(input.event.updated) || null,
        status: cleanString(input.event.status) || "confirmed",
        htmlLink: htmlLink || null,
        meetUrl: meetUrl || null,
        colorId: cleanString(input.event.colorId) || null,
        sourceCalendarId: cleanString(privateProperties.sourceCalendarId) || null,
        sourceEventId: cleanString(privateProperties.sourceEventId) || null,
        assignedMemberId: cleanString(privateProperties.assignedMemberId) || null,
        assignedMemberEmail: cleanString(privateProperties.assignedMemberEmail) || null,
        bookingNonce: cleanString(privateProperties.bookingNonce) || null,
      },
    },
  };
}

