export type CanonicalAppointmentEvent = {
  id?: string;
  iCalUID?: string;
  hangoutLink?: string;
  start?: { dateTime?: string; date?: string };
  originalStartTime?: { dateTime?: string; date?: string };
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
  };
  extendedProperties?: {
    private?: Record<string, string>;
  };
};

function clean(value: unknown) {
  return String(value || "").trim();
}

function normalized(value: unknown) {
  return clean(value).toLowerCase();
}

function appointmentStart(event: CanonicalAppointmentEvent) {
  return clean(
    event.start?.dateTime ||
      event.start?.date ||
      event.originalStartTime?.dateTime ||
      event.originalStartTime?.date,
  );
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
