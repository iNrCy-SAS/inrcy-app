import { INR_CALENDAR_GOOGLE_GUEST_EMAILS_PROPERTY } from "./inrCalendarGoogleSyncConstants.ts";

export const TEAM_CALENDAR_MIRROR_KEY = "inrcyTeamMirror";
export const TEAM_CALENDAR_MIRROR_VALUE = "v1";
export const PENDING_SIGNUP_REMINDER_SUMMARY = "inscription a traiter";
export const PENDING_SIGNUP_ASSIGNMENT_KEY = "inrcySignupAssignment";
export const PENDING_SIGNUP_ASSIGNMENT_VALUE = "v1";

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
  iCalUID?: string;
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
    optional?: boolean;
    resource?: boolean;
    additionalGuests?: number;
    comment?: string;
  }>;
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
  };
  reminders?: {
    useDefault?: boolean;
    overrides?: Array<{ method?: string; minutes?: number }>;
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

export type TeamCalendarReplicaReconciliationDecision =
  | "stable"
  | "repair"
  | "replica_changed";

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
  const normalizedSummary = normalizedCalendarLabel(event.summary);
  const privateProperties = event.extendedProperties?.private || {};
  if (
    event.status === "cancelled" ||
    privateProperties.inrcyBooking ||
    (privateProperties[TEAM_CALENDAR_MIRROR_KEY] &&
      privateProperties[PENDING_SIGNUP_ASSIGNMENT_KEY] !==
        PENDING_SIGNUP_ASSIGNMENT_VALUE)
  ) {
    return "";
  }

  const isSanitizedSignupReminder =
    privateProperties[PENDING_SIGNUP_ASSIGNMENT_KEY] ===
      PENDING_SIGNUP_ASSIGNMENT_VALUE &&
    Boolean(String(privateProperties.prospectUserId || "").trim());
  const isRawSignupReminder =
    normalizedSummary.startsWith("inscription") &&
    /(?:^|\r?\n)\s*Nouvelle inscription iNrCy\s*(?=\r?\n|$)/i.test(
      String(event.description || ""),
    );
  if (!isSanitizedSignupReminder && !isRawSignupReminder) return "";

  const storedProspectUserId = String(
    privateProperties.prospectUserId || "",
  ).trim();
  if (storedProspectUserId) return storedProspectUserId;

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

export function teamCalendarExternalAttendees(
  event: TeamCalendarEvent,
  internalEmails: string[] = [],
) {
  const internal = new Set(internalEmails.map(validEmail).filter(Boolean));
  const seen = new Set<string>();

  return (event.attendees || []).flatMap((attendee) => {
    const email = validEmail(attendee.email);
    if (
      !email ||
      seen.has(email) ||
      internal.has(email) ||
      email.endsWith("@inrcy.com") ||
      email.endsWith("@admin-inrcy.com")
    ) {
      return [];
    }
    seen.add(email);
    return [{
      email,
      ...(attendee.displayName ? { displayName: attendee.displayName } : {}),
      ...(attendee.responseStatus
        ? { responseStatus: attendee.responseStatus }
        : {}),
      ...(typeof attendee.optional === "boolean"
        ? { optional: attendee.optional }
        : {}),
      ...(typeof attendee.resource === "boolean"
        ? { resource: attendee.resource }
        : {}),
      ...(typeof attendee.additionalGuests === "number"
        ? { additionalGuests: attendee.additionalGuests }
        : {}),
      ...(attendee.comment ? { comment: attendee.comment } : {}),
    }];
  });
}

export function shouldMirrorTeamCalendarEvent(input: {
  event: TeamCalendarEvent;
  memberEmail: string;
  memberCalendarId?: string;
  managedCalendarIds?: string[];
  sharedCalendarId: string;
}) {
  const { event } = input;
  if (!event.id || event.status === "cancelled") return false;
  if (event.extendedProperties?.private?.inrcyCalendarReplica === "v1") {
    return false;
  }
  if (event.extendedProperties?.private?.[TEAM_CALENDAR_MIRROR_KEY]) return false;
  if (normalized(event.organizer?.email) === normalized(input.sharedCalendarId)) {
    return false;
  }
  const organizerEmail = normalized(event.organizer?.email);
  const currentMemberAddresses = new Set(
    [input.memberEmail, input.memberCalendarId].map(normalized).filter(Boolean),
  );
  const managedCalendarIds = new Set(
    (input.managedCalendarIds || []).map(normalized).filter(Boolean),
  );
  // Google exposes the same event in every attendee's calendar. When another
  // managed team member is the organizer, that attendee copy must not create a
  // second shared mirror with a false owner.
  if (
    organizerEmail &&
    managedCalendarIds.has(organizerEmail) &&
    !currentMemberAddresses.has(organizerEmail)
  ) {
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
  const normalizedDate = (date: TeamCalendarDate | undefined) =>
    date
      ? {
          dateTime: String(date.dateTime || "").trim(),
          date: String(date.date || "").trim(),
          timeZone: String(date.timeZone || "").trim(),
        }
      : null;
  const reminders = event.reminders
    ? {
        useDefault: event.reminders.useDefault ?? null,
        // Google omits an empty overrides array in event responses. Keep that
        // representation equivalent to the empty array sent by iNrCy so an
        // unchanged replica is not patched on every reconciliation pass.
        overrides: event.reminders.overrides ?? [],
      }
    : null;
  const conferenceEntryPoints = (event.conferenceData?.entryPoints || [])
    .map((entryPoint) => ({
      entryPointType: String(entryPoint.entryPointType || "").trim(),
      uri: String(entryPoint.uri || "").trim(),
    }))
    .filter((entryPoint) => entryPoint.entryPointType || entryPoint.uri)
    .sort((left, right) =>
      `${left.entryPointType}\n${left.uri}`.localeCompare(
        `${right.entryPointType}\n${right.uri}`,
      ),
    );
  return JSON.stringify({
    summary: event.summary || "",
    description: event.description || "",
    location: event.location || "",
    colorId: event.colorId || "",
    visibility: event.visibility || "default",
    transparency: event.transparency || "opaque",
    start: normalizedDate(event.start),
    end: normalizedDate(event.end),
    reminders,
    mirrorVersion: properties[TEAM_CALENDAR_MIRROR_KEY] || "",
    sourceCalendarId: properties.sourceCalendarId || "",
    sourceEventId: properties.sourceEventId || "",
    sourceICalUID: properties.sourceICalUID || "",
    sourceFingerprint: properties.sourceFingerprint || "",
    sourceOrganizerEmail: properties.sourceOrganizerEmail || "",
    sourceCalendarIsOrganizer: properties.sourceCalendarIsOrganizer || "",
    assignedMemberId: properties.assignedMemberId || "",
    assignedMemberEmail: properties.assignedMemberEmail || "",
    logicalAppointmentId: properties.inrcyLogicalAppointmentId || "",
    appointmentStatus: properties.inrcyAppointmentStatus || "",
    appointmentOrigin: properties.inrcyAppointmentOrigin || "",
    appointmentLifecycleVersion:
      properties.inrcyAppointmentLifecycleVersion || "",
    calendarReplica: properties.inrcyCalendarReplica || "",
    canonicalEventId: properties.inrcyCanonicalEventId || "",
    replicaFingerprint: properties.inrcyReplicaFingerprint || "",
    sourceMeetUrl: properties.sourceMeetUrl || "",
    // Conference payloads also contain Google-managed metadata. Replica
    // equality only depends on the usable entry points and not their order.
    conferenceData: conferenceEntryPoints.length ? conferenceEntryPoints : null,
    guestEmails: properties[INR_CALENDAR_GOOGLE_GUEST_EMAILS_PROPERTY] || "",
  });
}

export function teamCalendarReplicaReconciliationDecision(input: {
  storedFingerprint?: string;
  actualFingerprint?: string;
  canonicalFingerprint: string;
  contentMatchesCanonical: boolean;
}): TeamCalendarReplicaReconciliationDecision {
  const storedFingerprint = String(input.storedFingerprint || "").trim();
  const actualFingerprint = String(input.actualFingerprint || "").trim();
  const canonicalFingerprint = String(
    input.canonicalFingerprint || "",
  ).trim();
  if (!storedFingerprint) return "repair";
  if (input.contentMatchesCanonical) return "stable";
  // A replica can be returned by Google from an older snapshot immediately
  // after iNrCy moved or recoloured the canonical event. If its base
  // fingerprint is no longer the canonical one, the canonical event wins;
  // otherwise the stale replica could restore the former date/status.
  if (
    canonicalFingerprint &&
    storedFingerprint !== canonicalFingerprint
  ) {
    return "repair";
  }
  if (actualFingerprint !== storedFingerprint) {
    return "replica_changed";
  }
  return "repair";
}

export function hasAutomaticGoogleCalendarReminders(event: TeamCalendarEvent) {
  const reminders = event.reminders;
  return !reminders ||
    reminders.useDefault !== false ||
    (Array.isArray(reminders.overrides) && reminders.overrides.length > 0);
}

export function buildTeamCalendarMirrorBody(input: TeamCalendarMirrorInput) {
  const { event, member, sharedCalendarId, mirrorEventId, fingerprint } = input;
  const sourcePrivate = event.extendedProperties?.private || {};
  const isPrivate =
    event.visibility === "private" ||
    event.visibility === "confidential" ||
    event.eventType === "fromGmail";
  const meetUrl = teamCalendarEventMeetUrl(event);
  const sourceOrganizerEmail = validEmail(event.organizer?.email);
  const sourceCalendarIsOrganizer = [member.email, member.calendarId]
    .map(normalized)
    .filter(Boolean)
    .includes(sourceOrganizerEmail);
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
        sourceICalUID: String(event.iCalUID || ""),
        sourceEventUpdated: String(event.updated || ""),
        sourceFingerprint: fingerprint,
        sourceOrganizerEmail,
        sourceCalendarIsOrganizer: sourceCalendarIsOrganizer ? "true" : "false",
        sourceHtmlLink: String(event.htmlLink || ""),
        sourceMeetUrl: meetUrl,
        assignedMemberId: member.id,
        assignedMemberEmail: member.email,
        sharedCalendarId,
      },
    },
  };
}
