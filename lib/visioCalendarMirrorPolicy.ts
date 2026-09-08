import { INR_CALENDAR_GOOGLE_GUEST_EMAILS_PROPERTY } from "./inrCalendarGoogleSyncConstants.ts";

export const TEAM_CALENDAR_MIRROR_KEY = "inrcyTeamMirror";
export const TEAM_CALENDAR_MIRROR_VALUE = "v1";
export const PENDING_SIGNUP_REMINDER_SUMMARY = "inscription a traiter";

export type TeamCalendarMember = {
  id: string;
  name: string;
  email: string;
  calendarId: string;
};

export type TeamCalendarDate = {
  dateTime?: string;
  date?: string;
  timeZone?: string;
};

export type TeamCalendarEvent = {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  visibility?: string;
  transparency?: string;
  eventType?: string;
  updated?: string;
  htmlLink?: string;
  hangoutLink?: string;
  colorId?: string;
  start?: TeamCalendarDate;
  end?: TeamCalendarDate;
  originalStartTime?: TeamCalendarDate;
  organizer?: { email?: string; displayName?: string; self?: boolean };
  attendees?: Array<{
    email?: string;
    displayName?: string;
    organizer?: boolean;
    self?: boolean;
    responseStatus?: string;
  }>;
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
  };
  extendedProperties?: {
    private?: Record<string, string>;
  };
};

export type TeamCalendarMirrorInput = {
  event: TeamCalendarEvent;
  member: TeamCalendarMember;
  sharedCalendarId: string;
  mirrorEventId: string;
  fingerprint: string;
};

function normalized(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function validEmail(value: unknown) {
  const email = normalized(value);
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : "";
}

export function teamCalendarSourceGuestEmails(
  event: TeamCalendarEvent,
  internalEmails: string[] = [],
) {
  const seen = new Set<string>();
  const internal = new Set(internalEmails.map(validEmail).filter(Boolean));
  const emails: string[] = [];
  const candidates = [
    event.organizer?.email,
    ...(event.attendees || [])
      .filter(
        (attendee) =>
          !attendee.self &&
          String(attendee.responseStatus || "").toLowerCase() !== "declined",
      )
      .map((attendee) => attendee.email),
  ];

  for (const candidate of candidates) {
    const email = validEmail(candidate);
    if (
      !email ||
      seen.has(email) ||
      internal.has(email) ||
      email.endsWith("@inrcy.com") ||
      email.endsWith("@admin-inrcy.com") ||
      email.endsWith("@group.calendar.google.com") ||
      email.endsWith("@resource.calendar.google.com")
    ) {
      continue;
    }
    seen.add(email);
    emails.push(email);
  }

  return emails.sort();
}

function serializedSourceGuestEmails(event: TeamCalendarEvent, internalEmails: string[]) {
  const emails = teamCalendarSourceGuestEmails(event, internalEmails);
  while (emails.length > 0 && JSON.stringify(emails).length > 900) emails.pop();
  return emails.length > 0 ? JSON.stringify(emails) : "";
}

function normalizedCalendarLabel(value: unknown) {
  return normalized(value)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

export function pendingSignupReminderProspectUserId(event: TeamCalendarEvent) {
  if (
    event.status === "cancelled" ||
    normalizedCalendarLabel(event.summary) !== PENDING_SIGNUP_REMINDER_SUMMARY ||
    event.extendedProperties?.private?.inrcyBooking ||
    event.extendedProperties?.private?.[TEAM_CALENDAR_MIRROR_KEY]
  ) {
    return "";
  }

  const match = String(event.description || "").match(
    /(?:^|\r?\n)\s*User ID\s*:\s*([^\r\n]+?)\s*(?=\r?\n|$)/i,
  );
  return String(match?.[1] || "").trim();
}

export function isPendingSignupReminderForProspect(
  event: TeamCalendarEvent,
  prospectUserId: string,
) {
  const eventProspectUserId = pendingSignupReminderProspectUserId(event);
  return Boolean(
    eventProspectUserId &&
      eventProspectUserId === String(prospectUserId || "").trim(),
  );
}

export function teamCalendarMirrorSourceKey(calendarId: string, eventId: string) {
  return `${calendarId.trim()}\n${eventId.trim()}`;
}

export function teamCalendarEventMeetUrl(event: TeamCalendarEvent) {
  return String(
    event.hangoutLink ||
      event.conferenceData?.entryPoints?.find(
        (entry) => entry.entryPointType === "video",
      )?.uri ||
      event.extendedProperties?.private?.sourceMeetUrl ||
      "",
  ).trim();
}

export function isTeamCalendarEventDeclined(
  event: TeamCalendarEvent,
  memberEmail: string,
) {
  const email = normalized(memberEmail);
  return Boolean(
    event.attendees?.some(
      (attendee) =>
        (attendee.self || normalized(attendee.email) === email) &&
        attendee.responseStatus === "declined",
    ),
  );
}

export function shouldMirrorTeamCalendarEvent(input: {
  event: TeamCalendarEvent;
  memberEmail: string;
  sharedCalendarId: string;
}) {
  const { event } = input;
  if (!event.id || event.status === "cancelled") return false;
  if (event.extendedProperties?.private?.[TEAM_CALENDAR_MIRROR_KEY]) return false;
  if (normalized(event.organizer?.email) === normalized(input.sharedCalendarId)) {
    return false;
  }
  if (isTeamCalendarEventDeclined(event, input.memberEmail)) return false;
  if (["birthday", "workingLocation"].includes(String(event.eventType || ""))) {
    return false;
  }
  const hasStart = Boolean(
    event.start?.dateTime ||
      event.start?.date ||
      event.originalStartTime?.dateTime ||
      event.originalStartTime?.date,
  );
  const hasEnd = Boolean(
    event.end?.dateTime ||
      event.end?.date ||
      event.originalStartTime?.dateTime ||
      event.originalStartTime?.date,
  );
  return hasStart && hasEnd;
}

export function teamCalendarMirrorContentSignature(event: TeamCalendarEvent) {
  const properties = event.extendedProperties?.private || {};
  return JSON.stringify({
    summary: event.summary || "",
    description: event.description || "",
    location: event.location || "",
    colorId: event.colorId || "",
    visibility: event.visibility || "",
    transparency: event.transparency || "",
    start: event.start || null,
    end: event.end || null,
    mirrorVersion: properties[TEAM_CALENDAR_MIRROR_KEY] || "",
    sourceCalendarId: properties.sourceCalendarId || "",
    sourceEventId: properties.sourceEventId || "",
    sourceFingerprint: properties.sourceFingerprint || "",
    assignedMemberId: properties.assignedMemberId || "",
    guestEmails: properties[INR_CALENDAR_GOOGLE_GUEST_EMAILS_PROPERTY] || "",
  });
}

export function buildTeamCalendarMirrorBody(input: TeamCalendarMirrorInput) {
  const { event, member, sharedCalendarId, mirrorEventId, fingerprint } = input;
  const sourcePrivate = event.extendedProperties?.private || {};
  const isPrivate =
    event.visibility === "private" ||
    event.visibility === "confidential" ||
    event.eventType === "fromGmail";
  const meetUrl = teamCalendarEventMeetUrl(event);
  const sourceSummary = String(event.summary || "Rendez-vous").trim();
  const sourceDescription = isPrivate ? "" : String(event.description || "").trim();
  const sourceGuestEmails = isPrivate
    ? ""
    : serializedSourceGuestEmails(event, [
        member.email,
        member.calendarId,
        sharedCalendarId,
      ]);
  const details = [
    `Responsable iNrCy : ${member.name}`,
    "Vue synchronisée : modifiez le rendez-vous dans l’agenda du responsable.",
    sourceDescription,
    meetUrl ? `Google Meet : ${meetUrl}` : "",
  ].filter(Boolean);

  return {
    id: mirrorEventId,
    status: "confirmed",
    summary: isPrivate
      ? `Indisponible — ${member.name}`
      : `[${member.name}] ${sourceSummary}`,
    description: details.join("\n\n"),
    location: isPrivate ? "" : String(event.location || "").trim(),
    colorId: event.colorId,
    // A normal source event must keep its details visible to readers of the
    // shared team calendar. Sensitive source events are still redacted above
    // and remain private.
    visibility: isPrivate ? "private" : "default",
    transparency: event.transparency || "opaque",
    start: event.start || event.originalStartTime,
    end: event.end || event.originalStartTime,
    reminders: { useDefault: false, overrides: [] },
    extendedProperties: {
      private: {
        ...(sourcePrivate.inrcyBooking
          ? { inrcyBooking: sourcePrivate.inrcyBooking }
          : {}),
        ...(sourcePrivate.bookingNonce
          ? { bookingNonce: sourcePrivate.bookingNonce }
          : {}),
        ...(sourcePrivate.prospectUserId
          ? { prospectUserId: sourcePrivate.prospectUserId }
          : {}),
        ...(sourceGuestEmails
          ? { [INR_CALENDAR_GOOGLE_GUEST_EMAILS_PROPERTY]: sourceGuestEmails }
          : {}),
        [TEAM_CALENDAR_MIRROR_KEY]: TEAM_CALENDAR_MIRROR_VALUE,
        sourceCalendarId: member.calendarId,
        sourceEventId: String(event.id || ""),
        sourceEventUpdated: String(event.updated || ""),
        sourceFingerprint: fingerprint,
        sourceHtmlLink: String(event.htmlLink || ""),
        sourceMeetUrl: meetUrl,
        assignedMemberId: member.id,
        assignedMemberEmail: member.email,
        sharedCalendarId,
      },
    },
  };
}
