export type CanonicalAppointmentEvent = {
  id?: string;
  iCalUID?: string;
  hangoutLink?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  originalStartTime?: { dateTime?: string; date?: string };
  organizer?: { email?: string };
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
  };
  extendedProperties?: {
    private?: Record<string, string>;
  };
};

export type SharedVisioDeduplicationOptions = {
  /** Calendar that is being scanned when `event` is a source event. */
  sourceCalendarId?: string;
  /** Source event id when the caller already resolved it. */
  sourceEventId?: string;
  /** Effective owner used for external invitations without a booking nonce. */
  assignedMemberId?: string;
  /** Internal organizers that must never be collapsed by the external-slot fallback. */
  managedOrganizerEmails?: string[];
};

function clean(value: unknown) {
  return String(value || "").trim();
}

function normalized(value: unknown) {
  return clean(value).toLowerCase();
}

function normalizedInstant(value: unknown) {
  const raw = clean(value);
  if (!raw) return "";
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp)
    ? new Date(timestamp).toISOString()
    : raw.toLowerCase();
}

function normalizedAppointmentTitle(value: unknown) {
  return clean(value)
    .replace(/^\[[^\]]+\]\s*/, "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
}

function isManagedOrganizer(
  organizer: string,
  managedOrganizerEmails: string[],
) {
  if (!organizer) return true;
  if (
    organizer.endsWith("@inrcy.com") ||
    organizer.endsWith("@admin-inrcy.com") ||
    organizer.endsWith("@group.calendar.google.com") ||
    organizer.endsWith("@resource.calendar.google.com")
  ) {
    return true;
  }
  return managedOrganizerEmails.includes(organizer);
}

function appointmentStart(event: CanonicalAppointmentEvent) {
  return clean(
    event.start?.dateTime ||
      event.start?.date ||
      event.originalStartTime?.dateTime ||
      event.originalStartTime?.date,
  );
}

function appointmentEnd(event: CanonicalAppointmentEvent) {
  return clean(event.end?.dateTime || event.end?.date);
}

function appointmentMeetUrl(event: CanonicalAppointmentEvent) {
  const raw = clean(
    event.hangoutLink ||
      event.conferenceData?.entryPoints?.find(
        (entry) => entry.entryPointType === "video",
      )?.uri ||
      event.extendedProperties?.private?.sourceMeetUrl,
  );
  if (!raw) return "";
  try {
    const url = new URL(raw);
    url.hash = "";
    url.search = "";
    return url.toString().replace(/\/$/, "").toLowerCase();
  } catch {
    return raw.replace(/[?#].*$/, "").replace(/\/$/, "").toLowerCase();
  }
}

/**
 * Stable identity for the real appointment, independent from its Google
 * mirror or iNrCalendar row. Recurring occurrences deliberately include the
 * occurrence start so two dates from the same series never collapse together.
 */
export function canonicalVisioAppointmentIdentity(
  event: CanonicalAppointmentEvent,
) {
  const properties = event.extendedProperties?.private || {};
  const logicalAppointmentId = normalized(properties.inrcyLogicalAppointmentId);
  if (logicalAppointmentId) return `logical:${logicalAppointmentId}`;

  const prospectUserId = normalized(properties.prospectUserId);
  if (prospectUserId) return `prospect:${prospectUserId}`;

  const bookingNonce = normalized(properties.bookingNonce);
  if (bookingNonce) return `booking:${bookingNonce}`;

  const start = appointmentStart(event);
  const sourceICalUID = normalized(properties.sourceICalUID || event.iCalUID);
  if (sourceICalUID && start) return `ical:${sourceICalUID}:${start}`;

  const meetUrl = appointmentMeetUrl(event);
  if (meetUrl && start) return `meet:${meetUrl}:${start}`;

  const sourceCalendarId = normalized(properties.sourceCalendarId);
  const sourceEventId = clean(properties.sourceEventId || event.id);
  if (sourceCalendarId && sourceEventId && start) {
    return `source:${sourceCalendarId}:${sourceEventId}:${start}`;
  }
  if (sourceEventId && start) return `event:${sourceEventId}:${start}`;
  return `event:${sourceCalendarId}:${sourceEventId}`;
}

/**
 * Identity used only while reconciling the shared team calendar.
 *
 * Google can expose a single source event through two generations of mirror:
 * current mirrors carry `sourceEventId`, while legacy mirrors may only carry
 * their own shared-calendar id and a different iCalUID.  For independent
 * external invitations (notably webinar providers such as Livestorm), the
 * provider can emit several different iCalUIDs for the same slot.  In that
 * case we use a conservative owner + exact slot + title + organizer key so a
 * second copy cannot create a second case for the same professional.  The
 * external key is evaluated first so the source event and its mirror use the
 * same key even when their Google ids differ.
 */
export function sharedVisioMirrorDeduplicationIdentity(
  event: CanonicalAppointmentEvent & { summary?: string },
  options: SharedVisioDeduplicationOptions = {},
) {
  const properties = event.extendedProperties?.private || {};
  const logicalAppointmentId = normalized(properties.inrcyLogicalAppointmentId);
  if (logicalAppointmentId) return `logical:${logicalAppointmentId}`;

  const prospectUserId = normalized(properties.prospectUserId);
  if (prospectUserId) return `prospect:${prospectUserId}`;

  const bookingNonce = normalized(properties.bookingNonce);
  if (bookingNonce) return `booking:${bookingNonce}`;

  const start = normalizedInstant(appointmentStart(event));
  const end = normalizedInstant(appointmentEnd(event));
  const isMirror = properties.inrcyTeamMirror === "v1";
  const sourceCalendarId = normalized(
    properties.sourceCalendarId || options.sourceCalendarId,
  );
  const sourceEventId = clean(
    properties.sourceEventId ||
      options.sourceEventId ||
      (!isMirror && options.sourceCalendarId ? event.id : ""),
  );

  const organizer = normalized(
    properties.sourceOrganizerEmail || event.organizer?.email,
  );
  const assignedMemberId = normalized(
    properties.assignedMemberId || options.assignedMemberId,
  );
  const managedOrganizerEmails = (options.managedOrganizerEmails || [])
    .map(normalized)
    .filter(Boolean);
  const title = normalizedAppointmentTitle(event.summary);
  if (
    sourceCalendarId &&
    assignedMemberId &&
    organizer &&
    start &&
    end &&
    title &&
    !isManagedOrganizer(organizer, managedOrganizerEmails)
  ) {
    return `external-slot:${sourceCalendarId}:${assignedMemberId}:${start}:${end}:${organizer}:${title}`;
  }

  if (sourceCalendarId && sourceEventId && start) {
    return `source:${sourceCalendarId}:${sourceEventId}:${start}`;
  }

  return canonicalVisioAppointmentIdentity(event);
}
