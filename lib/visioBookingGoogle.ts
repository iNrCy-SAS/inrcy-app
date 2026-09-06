import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { Redis } from "@upstash/redis";

import { encryptToken, tryDecryptToken } from "@/lib/oauthCrypto";
import { optionalEnv, requireEnv } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendMonitoringMail } from "@/lib/txMailer";
import {
  VISIO_BOOKING_DURATION_MINUTES,
  VISIO_BOOKING_MAX_CONCURRENT,
  VISIO_BOOKING_SPACING_MINUTES,
  VISIO_BOOKING_START_HOURS,
  VISIO_BOOKING_TIMEZONE,
  addLocalDays,
  chooseBalancedMember,
  getLocalDateTimeParts,
  isAllowedVisioStart,
  isMemberFree,
  localDateKey,
  zonedDateTimeToUtc,
  type BusyPeriod,
  type VisioTeamMember,
} from "@/lib/visioBookingPolicy";
import type { VisioBookingClaims } from "@/lib/visioBookingToken";

const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const INTEGRATION_SOURCE = "internal_staff";
const INTEGRATION_PRODUCT = "visio_booking";
const PRIVATE_BOOKING_KEY = "inrcyBooking";
const PRIVATE_BOOKING_VALUE = "signup-visio";

type GoogleIntegrationRow = {
  id: string;
  user_id: string;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  expires_at: string | null;
  status: string | null;
};

type GoogleCalendarEvent = {
  id?: string;
  status?: string;
  htmlLink?: string;
  hangoutLink?: string;
  summary?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
  conferenceData?: {
    entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
  };
  extendedProperties?: {
    private?: Record<string, string>;
  };
};

export type VisioAvailabilityDay = {
  date: string;
  label: string;
  slots: Array<{ start: string; label: string }>;
};

export type VisioBookingConfirmation = {
  start: string;
  end: string;
  dateLabel: string;
  timeLabel: string;
  assignedTo: string;
  meetUrl: string;
  calendarUrl: string;
};

function boundedInteger(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(optionalEnv(name, String(fallback)));
  return Number.isFinite(parsed)
    ? Math.min(max, Math.max(min, Math.floor(parsed)))
    : fallback;
}

export function getVisioBookingHorizonDays() {
  return boundedInteger("INRCY_VISIO_HORIZON_DAYS", 21, 7, 60);
}

export function getVisioBookingMinimumLeadHours() {
  return boundedInteger("INRCY_VISIO_MINIMUM_LEAD_HOURS", 24, 1, 168);
}

export function getVisioTeamMembers(): VisioTeamMember[] {
  return [
    {
      id: "oceane",
      name: "Océane",
      email: optionalEnv("INRCY_VISIO_OCEANE_EMAIL", "oceane.pinceloup@inrcy.com"),
      calendarId: optionalEnv(
        "INRCY_VISIO_OCEANE_CALENDAR_ID",
        "oceane.pinceloup@inrcy.com",
      ),
    },
    {
      id: "apolline",
      name: "Apolline",
      email: optionalEnv("INRCY_VISIO_APOLLINE_EMAIL", "apolline.benedyczak@inrcy.com"),
      calendarId: optionalEnv(
        "INRCY_VISIO_APOLLINE_CALENDAR_ID",
        "apolline.benedyczak@inrcy.com",
      ),
    },
    {
      id: "jimmy",
      name: "Jimmy",
      email: optionalEnv("INRCY_VISIO_JIMMY_EMAIL", "jimmy.wright@inrcy.com"),
      calendarId: optionalEnv(
        "INRCY_VISIO_JIMMY_CALENDAR_ID",
        "contact@admin-inrcy.com",
      ),
    },
  ].map((member) => ({
    ...member,
    email: member.email.trim().toLowerCase(),
    calendarId: member.calendarId.trim(),
  }));
}

export function getVisioSharedCalendarId() {
  return requireEnv("INRCY_VISIO_SHARED_CALENDAR_ID").trim();
}

function encodeCalendarId(value: string) {
  return encodeURIComponent(value);
}

async function readGoogleIntegration() {
  const { data, error } = await supabaseAdmin
    .from("integrations")
    .select("id,user_id,access_token_enc,refresh_token_enc,expires_at,status")
    .eq("provider", "google")
    .eq("source", INTEGRATION_SOURCE)
    .eq("product", INTEGRATION_PRODUCT)
    .eq("status", "connected")
    .order("updated_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) throw new Error(`visio_google_integration_read_failed:${error.message}`);
  if (!data) throw new Error("visio_google_not_connected");
  return data as GoogleIntegrationRow;
}

async function refreshGoogleAccessToken(row: GoogleIntegrationRow) {
  const refreshToken = tryDecryptToken(row.refresh_token_enc);
  if (!refreshToken) throw new Error("visio_google_refresh_token_missing");

  const response = await fetch(GOOGLE_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: requireEnv("GOOGLE_CLIENT_ID"),
      client_secret: requireEnv("GOOGLE_CLIENT_SECRET"),
      refresh_token: refreshToken,
      grant_type: "refresh_token",
    }),
    cache: "no-store",
  });
  const payload = (await response.json().catch(() => ({}))) as {
    access_token?: string;
    expires_in?: number;
    error?: string;
  };
  if (!response.ok || !payload.access_token) {
    throw new Error(`visio_google_refresh_failed:${payload.error || response.status}`);
  }

  const expiresAt = new Date(
    Date.now() + Math.max(60, Number(payload.expires_in || 3600)) * 1_000,
  ).toISOString();
  const { error } = await supabaseAdmin
    .from("integrations")
    .update({
      access_token_enc: encryptToken(payload.access_token),
      expires_at: expiresAt,
      status: "connected",
      updated_at: new Date().toISOString(),
    })
    .eq("id", row.id)
    .eq("user_id", row.user_id);
  if (error) throw new Error(`visio_google_token_store_failed:${error.message}`);
  return payload.access_token;
}

async function getGoogleAccessToken(forceRefresh = false) {
  const row = await readGoogleIntegration();
  const accessToken = tryDecryptToken(row.access_token_enc);
  const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (!forceRefresh && accessToken && expiresAt > Date.now() + 60_000) {
    return accessToken;
  }
  return refreshGoogleAccessToken(row);
}

async function googleCalendarRequest<T>(
  path: string,
  init?: RequestInit,
  retry = true,
): Promise<T> {
  const accessToken = await getGoogleAccessToken(false);
  const response = await fetch(`${GOOGLE_CALENDAR_API}${path}`, {
    ...init,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${accessToken}`,
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(init?.headers || {}),
    },
    cache: "no-store",
  });

  if (response.status === 401 && retry) {
    const refreshed = await getGoogleAccessToken(true);
    const retried = await fetch(`${GOOGLE_CALENDAR_API}${path}`, {
      ...init,
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${refreshed}`,
        ...(init?.body ? { "Content-Type": "application/json" } : {}),
        ...(init?.headers || {}),
      },
      cache: "no-store",
    });
    if (retried.ok) return (await retried.json()) as T;
    const detail = await retried.text().catch(() => "");
    throw new Error(`visio_google_api_failed:${retried.status}:${detail.slice(0, 240)}`);
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`visio_google_api_failed:${response.status}:${detail.slice(0, 240)}`);
  }
  return (await response.json()) as T;
}

async function readFreeBusy(
  members: VisioTeamMember[],
  timeMin: Date,
  timeMax: Date,
) {
  const payload = await googleCalendarRequest<{
    calendars?: Record<string, { busy?: BusyPeriod[]; errors?: unknown[] }>;
  }>("/freeBusy", {
    method: "POST",
    body: JSON.stringify({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      timeZone: VISIO_BOOKING_TIMEZONE,
      items: members.map((member) => ({ id: member.calendarId })),
    }),
  });

  const busyByCalendar: Record<string, BusyPeriod[]> = {};
  for (const member of members) {
    const calendar = payload.calendars?.[member.calendarId];
    if (!calendar || (calendar.errors && calendar.errors.length > 0)) {
      throw new Error(`visio_calendar_unavailable:${member.id}`);
    }
    busyByCalendar[member.calendarId] = calendar.busy || [];
  }
  return busyByCalendar;
}

async function listBookingEvents(timeMin: Date, timeMax: Date) {
  const calendarId = getVisioSharedCalendarId();
  const events: GoogleCalendarEvent[] = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({
      timeMin: timeMin.toISOString(),
      timeMax: timeMax.toISOString(),
      singleEvents: "true",
      showDeleted: "false",
      maxResults: "2500",
      privateExtendedProperty: `${PRIVATE_BOOKING_KEY}=${PRIVATE_BOOKING_VALUE}`,
    });
    if (pageToken) params.set("pageToken", pageToken);
    const payload = await googleCalendarRequest<{
      items?: GoogleCalendarEvent[];
      nextPageToken?: string;
    }>(`/calendars/${encodeCalendarId(calendarId)}/events?${params.toString()}`);
    events.push(...(payload.items || []).filter((event) => event.status !== "cancelled"));
    pageToken = String(payload.nextPageToken || "");
  } while (pageToken);
  return events;
}

function eventStartMs(event: GoogleCalendarEvent) {
  const value = event.start?.dateTime || event.start?.date || "";
  const time = new Date(value).getTime();
  return Number.isFinite(time) ? time : 0;
}

function eventMemberId(event: GoogleCalendarEvent) {
  return String(event.extendedProperties?.private?.assignedMemberId || "");
}

function countEventsAtStart(events: GoogleCalendarEvent[], start: Date) {
  return events.filter((event) => eventStartMs(event) === start.getTime()).length;
}

function countEventsByMember(events: GoogleCalendarEvent[]) {
  return events.reduce<Record<string, number>>((counts, event) => {
    const memberId = eventMemberId(event);
    if (memberId) counts[memberId] = (counts[memberId] || 0) + 1;
    return counts;
  }, {});
}

function addInternalBookingsToBusyPeriods(
  members: VisioTeamMember[],
  busyByCalendar: Record<string, BusyPeriod[]>,
  events: GoogleCalendarEvent[],
) {
  const calendarIdByMember = new Map(
    members.map((member) => [member.id, member.calendarId]),
  );
  const augmented = Object.fromEntries(
    Object.entries(busyByCalendar).map(([calendarId, periods]) => [
      calendarId,
      [...periods],
    ]),
  ) as Record<string, BusyPeriod[]>;

  for (const event of events) {
    const startMs = eventStartMs(event);
    const calendarId = calendarIdByMember.get(eventMemberId(event));
    if (!startMs || !calendarId) continue;
    augmented[calendarId] ||= [];
    augmented[calendarId].push({
      start: new Date(startMs).toISOString(),
      end: new Date(
        startMs + VISIO_BOOKING_SPACING_MINUTES * 60_000,
      ).toISOString(),
    });
  }
  return augmented;
}

function formatFrenchDate(start: Date) {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: VISIO_BOOKING_TIMEZONE,
    weekday: "long",
    day: "numeric",
    month: "long",
    year: "numeric",
  }).format(start);
}

function formatFrenchTime(start: Date) {
  return new Intl.DateTimeFormat("fr-FR", {
    timeZone: VISIO_BOOKING_TIMEZONE,
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).format(start).replace(":", "h");
}

export async function getVisioAvailability(now = new Date()) {
  const members = getVisioTeamMembers();
  const horizonDays = getVisioBookingHorizonDays();
  const minimumLeadHours = getVisioBookingMinimumLeadHours();
  const localNow = getLocalDateTimeParts(now);
  const candidates: Array<{ date: string; start: Date }> = [];

  for (let offset = 0; offset <= horizonDays; offset += 1) {
    const date = addLocalDays(localNow, offset);
    for (const hour of VISIO_BOOKING_START_HOURS) {
      const start = zonedDateTimeToUtc({ ...date, hour });
      if (isAllowedVisioStart({ start, now, horizonDays, minimumLeadHours })) {
        candidates.push({ date: localDateKey(date), start });
      }
    }
  }
  if (candidates.length === 0) return [] as VisioAvailabilityDay[];

  const rangeStart = candidates[0].start;
  const rangeEnd = new Date(
    candidates[candidates.length - 1].start.getTime() +
      VISIO_BOOKING_SPACING_MINUTES * 60_000,
  );
  const [busyByCalendar, events] = await Promise.all([
    readFreeBusy(members, rangeStart, rangeEnd),
    listBookingEvents(rangeStart, rangeEnd),
  ]);

  const effectiveBusy = addInternalBookingsToBusyPeriods(
    members,
    busyByCalendar,
    events,
  );
  const grouped = new Map<string, VisioAvailabilityDay>();
  for (const candidate of candidates) {
    const capacityUsed = countEventsAtStart(events, candidate.start);
    const hasFreeMember = members.some((member) =>
      isMemberFree(member, effectiveBusy, candidate.start),
    );
    if (capacityUsed >= VISIO_BOOKING_MAX_CONCURRENT || !hasFreeMember) continue;

    const day = grouped.get(candidate.date) || {
      date: candidate.date,
      label: formatFrenchDate(candidate.start),
      slots: [],
    };
    day.slots.push({
      start: candidate.start.toISOString(),
      label: formatFrenchTime(candidate.start),
    });
    grouped.set(candidate.date, day);
  }
  return [...grouped.values()];
}

function bookingEventId(nonce: string) {
  return createHash("sha256").update(`signup-visio:${nonce}`, "utf8").digest("hex").slice(0, 40);
}

function conferenceRequestId(nonce: string) {
  return createHash("sha256").update(`meet:${nonce}`, "utf8").digest("hex").slice(0, 32);
}

function getMeetUrl(event: GoogleCalendarEvent) {
  return String(
    event.hangoutLink ||
      event.conferenceData?.entryPoints?.find(
        (entry) => entry.entryPointType === "video",
      )?.uri ||
      "",
  );
}

function confirmationFromEvent(
  event: GoogleCalendarEvent,
  fallbackStart: Date,
  assignedTo: string,
): VisioBookingConfirmation {
  const start = new Date(event.start?.dateTime || fallbackStart.toISOString());
  const end = new Date(
    event.end?.dateTime || start.getTime() + VISIO_BOOKING_DURATION_MINUTES * 60_000,
  );
  return {
    start: start.toISOString(),
    end: end.toISOString(),
    dateLabel: formatFrenchDate(start),
    timeLabel: formatFrenchTime(start),
    assignedTo,
    meetUrl: getMeetUrl(event),
    calendarUrl: String(event.htmlLink || ""),
  };
}

async function getExistingBooking(eventId: string) {
  try {
    return await googleCalendarRequest<GoogleCalendarEvent>(
      `/calendars/${encodeCalendarId(getVisioSharedCalendarId())}/events/${encodeURIComponent(eventId)}`,
    );
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("visio_google_api_failed:404:")) {
      return null;
    }
    throw error;
  }
}

type BookingLock = { release: () => Promise<void> };

function getBookingRedis() {
  const url = optionalEnv("KV_REST_API_URL", "").trim();
  const token = optionalEnv("KV_REST_API_TOKEN", "").trim();
  if (!url || !token) return null;
  const globalCache = globalThis as typeof globalThis & { __inrcy_visio_redis?: Redis };
  if (!globalCache.__inrcy_visio_redis) {
    globalCache.__inrcy_visio_redis = new Redis({ url, token });
  }
  return globalCache.__inrcy_visio_redis;
}

async function acquireBookingLock(start: Date): Promise<BookingLock> {
  const key = `inrcy:visio-booking:slot-lock:${start.toISOString()}`;
  const value = randomUUID();
  const redis = getBookingRedis();
  if (redis) {
    const result = await redis.set(key, value, { nx: true, ex: 30 });
    if (result !== "OK") throw new Error("visio_slot_busy");
    return {
      release: async () => {
        if ((await redis.get<string>(key)) === value) await redis.del(key);
      },
    };
  }

  if (process.env.NODE_ENV === "production") {
    throw new Error("visio_booking_lock_unavailable");
  }
  const globalCache = globalThis as typeof globalThis & {
    __inrcy_visio_local_locks?: Map<string, number>;
  };
  const locks = globalCache.__inrcy_visio_local_locks || new Map<string, number>();
  globalCache.__inrcy_visio_local_locks = locks;
  const existing = locks.get(key) || 0;
  if (existing > Date.now()) throw new Error("visio_slot_busy");
  locks.set(key, Date.now() + 30_000);
  return {
    release: async () => {
      locks.delete(key);
    },
  };
}

async function readProspect(claims: VisioBookingClaims) {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("first_name,last_name,company_legal_name,phone,contact_email,admin_email")
    .eq("user_id", claims.sub)
    .maybeSingle();
  if (error) throw new Error(`visio_profile_read_failed:${error.message}`);
  const row = (data || {}) as Record<string, unknown>;
  const firstName = String(row.first_name || "").trim();
  const lastName = String(row.last_name || "").trim();
  return {
    firstName,
    lastName,
    name: [firstName, lastName].filter(Boolean).join(" ") || claims.email,
    company: String(row.company_legal_name || "").trim(),
    phone: String(row.phone || "").trim(),
    email: claims.email,
  };
}

async function createGoogleBookingEvent(input: {
  eventId: string;
  start: Date;
  member: VisioTeamMember;
  claims: VisioBookingClaims;
}) {
  const prospect = await readProspect(input.claims);
  const end = new Date(
    input.start.getTime() + VISIO_BOOKING_DURATION_MINUTES * 60_000,
  );
  const contactLines = [
    `Professionnel : ${prospect.name}`,
    prospect.company ? `Société : ${prospect.company}` : "",
    `E-mail : ${prospect.email}`,
    prospect.phone ? `Téléphone : ${prospect.phone}` : "",
    `Rendez-vous attribué à : ${input.member.name}`,
    "Source : inscription validée sur inrcy.com",
  ].filter(Boolean);

  const event = await googleCalendarRequest<GoogleCalendarEvent>(
    `/calendars/${encodeCalendarId(getVisioSharedCalendarId())}/events?conferenceDataVersion=1&sendUpdates=all`,
    {
      method: "POST",
      body: JSON.stringify({
        id: input.eventId,
        summary: `Présentation iNrCy — ${prospect.company || prospect.name}`,
        description: contactLines.join("\n"),
        location: "Google Meet",
        colorId: optionalEnv("INRCY_VISIO_PENDING_COLOR_ID", "5"),
        visibility: "private",
        guestsCanInviteOthers: false,
        guestsCanModify: false,
        start: {
          dateTime: input.start.toISOString(),
          timeZone: VISIO_BOOKING_TIMEZONE,
        },
        end: {
          dateTime: end.toISOString(),
          timeZone: VISIO_BOOKING_TIMEZONE,
        },
        attendees: [
          { email: input.member.email, displayName: input.member.name },
          { email: prospect.email, displayName: prospect.name },
        ],
        conferenceData: {
          createRequest: {
            requestId: conferenceRequestId(input.claims.nonce),
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
        reminders: {
          useDefault: false,
          overrides: [
            { method: "email", minutes: 24 * 60 },
            { method: "popup", minutes: 60 },
          ],
        },
        extendedProperties: {
          private: {
            [PRIVATE_BOOKING_KEY]: PRIVATE_BOOKING_VALUE,
            bookingNonce: input.claims.nonce,
            prospectUserId: input.claims.sub,
            assignedMemberId: input.member.id,
            assignedMemberEmail: input.member.email,
          },
        },
      }),
    },
  );

  const confirmation = confirmationFromEvent(event, input.start, input.member.name);
  const alertDestination = optionalEnv(
    "INRCY_VISIO_BOOKING_ALERT_EMAIL",
    "compte@inrcy.com",
  );
  await sendMonitoringMail({
    to: alertDestination,
    subject: `Nouveau rendez-vous visio iNrCy — ${prospect.company || prospect.name}`,
    text: [
      "Un rendez-vous de présentation a été réservé après une inscription.",
      `Date : ${confirmation.dateLabel} à ${confirmation.timeLabel}`,
      `Attribué à : ${input.member.name}`,
      ...contactLines.slice(0, 4),
      confirmation.meetUrl ? `Google Meet : ${confirmation.meetUrl}` : "",
    ].filter(Boolean).join("\n"),
  }).catch((error: unknown) => {
    console.error(
      "[visio-booking][monitoring-mail]",
      error instanceof Error ? error.message : "send_failed",
    );
  });
  return confirmation;
}

export async function bookVisioSlot(
  claims: VisioBookingClaims,
  startValue: unknown,
  now = new Date(),
) {
  const start = new Date(String(startValue || ""));
  const horizonDays = getVisioBookingHorizonDays();
  const minimumLeadHours = getVisioBookingMinimumLeadHours();
  if (!isAllowedVisioStart({ start, now, horizonDays, minimumLeadHours })) {
    throw new Error("visio_slot_invalid");
  }

  const eventId = bookingEventId(claims.nonce);
  const existing = await getExistingBooking(eventId);
  if (existing) {
    const memberId = eventMemberId(existing);
    const member = getVisioTeamMembers().find((candidate) => candidate.id === memberId);
    return confirmationFromEvent(existing, start, member?.name || "l’équipe iNrCy");
  }

  const lock = await acquireBookingLock(start);
  try {
    const members = getVisioTeamMembers();
    const spacingEnd = new Date(
      start.getTime() + VISIO_BOOKING_SPACING_MINUTES * 60_000,
    );
    const loadRangeStart = new Date(now.getTime() - 30 * 24 * 60 * 60_000);
    const loadRangeEnd = new Date(
      now.getTime() + (horizonDays + 2) * 24 * 60 * 60_000,
    );
    const [busyByCalendar, events] = await Promise.all([
      readFreeBusy(members, start, spacingEnd),
      listBookingEvents(loadRangeStart, loadRangeEnd),
    ]);

    if (countEventsAtStart(events, start) >= VISIO_BOOKING_MAX_CONCURRENT) {
      throw new Error("visio_slot_unavailable");
    }
    const member = chooseBalancedMember({
      members,
      busyByCalendar: addInternalBookingsToBusyPeriods(
        members,
        busyByCalendar,
        events,
      ),
      bookingCountByMember: countEventsByMember(events),
      start,
    });
    if (!member) throw new Error("visio_slot_unavailable");

    try {
      return await createGoogleBookingEvent({ eventId, start, member, claims });
    } catch (error) {
      if (error instanceof Error && error.message.startsWith("visio_google_api_failed:409:")) {
        const racedEvent = await getExistingBooking(eventId);
        if (racedEvent) {
          const racedMemberId = eventMemberId(racedEvent);
          const racedMember = members.find((candidate) => candidate.id === racedMemberId);
          return confirmationFromEvent(
            racedEvent,
            start,
            racedMember?.name || "l’équipe iNrCy",
          );
        }
      }
      throw error;
    }
  } finally {
    await lock.release().catch(() => undefined);
  }
}

export const VISIO_BOOKING_GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/userinfo.email",
] as const;

export const VISIO_BOOKING_INTEGRATION = {
  source: INTEGRATION_SOURCE,
  product: INTEGRATION_PRODUCT,
} as const;
