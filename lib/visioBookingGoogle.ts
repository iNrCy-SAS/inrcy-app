import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { Redis } from "@upstash/redis";

import { encryptToken, tryDecryptToken } from "@/lib/oauthCrypto";
import { optionalEnv, requireEnv } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendMonitoringMail } from "@/lib/txMailer";
import {
  buildPublicVisioBookingContent,
  buildSingleAssigneeVisioAttendees,
} from "@/lib/visioBookingEventPolicy";
import {
  TEAM_CALENDAR_MIRROR_KEY,
  TEAM_CALENDAR_MIRROR_VALUE,
  buildTeamCalendarMirrorBody,
  isPendingSignupReminderForProspect,
  pendingSignupReminderProspectUserId,
  shouldMirrorTeamCalendarEvent,
  teamCalendarExternalAttendees,
  teamCalendarEventMeetUrl,
  teamCalendarMirrorContentSignature,
  teamCalendarMirrorSourceKey,
  teamCalendarSourceGuestEmails,
  type TeamCalendarEvent,
} from "@/lib/visioCalendarMirrorPolicy";
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
  parseLocalDateTime,
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
const PRIVATE_BOOKING_COMPANION_KEY = "inrcyBookingCompanion";
const PRIVATE_BOOKING_COMPANION_VALUE = "assigned-member";
const PRIVATE_BOOKING_PUBLIC_VALUE = "public-organizer";
const PRIVATE_BOOKING_SINGLE_EVENT_KEY = "inrcyBookingSingleEvent";
const PRIVATE_BOOKING_SINGLE_EVENT_VALUE = "v2";
const PRIVATE_SIGNUP_ASSIGNMENT_KEY = "inrcySignupAssignment";
const PRIVATE_SIGNUP_ASSIGNMENT_VALUE = "v1";
const PUBLIC_BOOKING_ASSIGNEE = "Équipe iNrCy";
const REQUIRED_INTERNAL_ALERT_EMAIL = "compte@inrcy.com";
const TEAM_MIRROR_DEFAULT_PAST_DAYS = 30;
const TEAM_MIRROR_DEFAULT_FUTURE_DAYS = 365;
const BOOKING_LOCK_TTL_SECONDS = 120;
const REDIS_COMPARE_DELETE_SCRIPT =
  "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]); end; return 0;";

type GoogleIntegrationRow = {
  id: string;
  user_id: string;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  expires_at: string | null;
  status: string | null;
};

type GoogleCalendarEvent = TeamCalendarEvent;

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

export type VisioCalendarAccess = {
  id: string;
  name: string;
  email: string;
  calendarId: string;
  readable: boolean;
  accessRole: string | null;
  writable: boolean;
  error?: string;
};

export type VisioTeamCalendarSyncResult = {
  ok: boolean;
  startedAt: string;
  finishedAt: string;
  range: { timeMin: string; timeMax: string };
  scanned: number;
  created: number;
  updated: number;
  cancelled: number;
  unchanged: number;
  skipped: number;
  locked: boolean;
  errors: Array<{ memberId: string; code: string }>;
};

export type VisioTeamAppointment = {
  id: string;
  identity: string;
  title: string;
  start: string;
  end: string;
  allDay: boolean;
  meetUrl: string;
  calendarUrl: string;
  currentMemberId: string;
  currentMemberName: string;
  sourceType: "booking" | "calendar";
};

export type VisioTeamReassignmentActor = {
  userId: string;
  email: string;
  name: string;
};

export type VisioTeamReassignmentResult = {
  appointment: VisioTeamAppointment;
  previousMemberId: string;
  targetMemberId: string;
  publicOrganizerPreserved: boolean;
  notificationsSent: false;
};

export type VisioTeamRescheduleResult = {
  appointment: VisioTeamAppointment;
  previousStart: string;
  previousEnd: string;
  googleUpdatesRequested: boolean;
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

export function getVisioBookingMinimumLeadDays() {
  return boundedInteger("INRCY_VISIO_MINIMUM_LEAD_DAYS", 1, 1, 7);
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

export function getVisioPublicCalendarId() {
  return optionalEnv(
    "INRCY_VISIO_PUBLIC_CALENDAR_ID",
    "contact@admin-inrcy.com",
  ).trim();
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

export async function getVisioBookingIntegrationAccountId() {
  const integration = await readGoogleIntegration();
  return String(integration.user_id || "").trim();
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
  retryUnauthorized = true,
  transientAttempt = 0,
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

  if (response.status === 401 && retryUnauthorized) {
    await getGoogleAccessToken(true);
    return googleCalendarRequest<T>(path, init, false, transientAttempt);
  }

  if (
    [429, 500, 502, 503, 504].includes(response.status) &&
    transientAttempt < 2
  ) {
    const retryAfterSeconds = Number(response.headers.get("retry-after") || 0);
    const delayMs = retryAfterSeconds > 0
      ? Math.min(3_000, retryAfterSeconds * 1_000)
      : [300, 900][transientAttempt];
    await new Promise((resolve) => setTimeout(resolve, delayMs));
    return googleCalendarRequest<T>(
      path,
      init,
      retryUnauthorized,
      transientAttempt + 1,
    );
  }

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    throw new Error(`visio_google_api_failed:${response.status}:${detail.slice(0, 240)}`);
  }
  return (await response.json()) as T;
}

export async function createVisioGoogleCalendarWatch(input: {
  calendarId: string;
  channelId: string;
  address: string;
  token: string;
  ttlSeconds: number;
}) {
  return googleCalendarRequest<{
    id?: string;
    resourceId?: string;
    expiration?: string;
  }>(
    `/calendars/${encodeCalendarId(input.calendarId)}/events/watch`,
    {
      method: "POST",
      body: JSON.stringify({
        id: input.channelId,
        type: "web_hook",
        address: input.address,
        token: input.token,
        params: { ttl: String(input.ttlSeconds) },
      }),
    },
  );
}

function visioGoogleErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : "unknown_error";
  const match = message.match(/^visio_google_api_failed:(\d{3}):/);
  if (match) return `google_${match[1]}`;
  return message.split(":")[0].slice(0, 80) || "unknown_error";
}

async function listGoogleCalendarEvents(input: {
  calendarId: string;
  timeMin: Date;
  timeMax: Date;
  privateExtendedProperty?: string;
  showDeleted?: boolean;
}) {
  const events: GoogleCalendarEvent[] = [];
  let pageToken = "";
  do {
    const params = new URLSearchParams({
      timeMin: input.timeMin.toISOString(),
      timeMax: input.timeMax.toISOString(),
      singleEvents: "true",
      showDeleted: input.showDeleted ? "true" : "false",
      maxResults: "2500",
      orderBy: "startTime",
      timeZone: VISIO_BOOKING_TIMEZONE,
    });
    if (input.privateExtendedProperty) {
      params.set("privateExtendedProperty", input.privateExtendedProperty);
    }
    if (pageToken) params.set("pageToken", pageToken);
    const payload = await googleCalendarRequest<{
      items?: GoogleCalendarEvent[];
      nextPageToken?: string;
    }>(
      `/calendars/${encodeCalendarId(input.calendarId)}/events?${params.toString()}`,
    );
    events.push(
      ...(input.showDeleted
        ? payload.items || []
        : (payload.items || []).filter((event) => event.status !== "cancelled")),
    );
    pageToken = String(payload.nextPageToken || "");
  } while (pageToken);
  return events;
}

async function readCalendarAccessRole(calendarId: string) {
  const params = new URLSearchParams({
    timeMin: new Date(Date.now() - 24 * 60 * 60_000).toISOString(),
    singleEvents: "true",
    showDeleted: "false",
    maxResults: "1",
  });
  const entry = await googleCalendarRequest<{ accessRole?: string }>(
    `/calendars/${encodeCalendarId(calendarId)}/events?${params.toString()}`,
  );
  return String(entry.accessRole || "") || null;
}

export async function getVisioTeamCalendarAccess() {
  const members = getVisioTeamMembers();

  return Promise.all(
    members.map(async (member): Promise<VisioCalendarAccess> => {
      try {
        const accessRole = await readCalendarAccessRole(member.calendarId);
        return {
          ...member,
          readable: true,
          accessRole,
          writable: accessRole === "owner" || accessRole === "writer",
        };
      } catch (error) {
        return {
          ...member,
          readable: false,
          accessRole: null,
          writable: false,
          error: visioGoogleErrorCode(error),
        };
      }
    }),
  );
}

export async function getVisioSharedCalendarAccess(): Promise<VisioCalendarAccess> {
  const calendarId = getVisioSharedCalendarId();
  try {
    const accessRole = await readCalendarAccessRole(calendarId);
    return {
      id: "shared",
      name: "Agenda partagé iNrCy",
      email: "",
      calendarId,
      readable: true,
      accessRole,
      writable: accessRole === "owner" || accessRole === "writer",
    };
  } catch (error) {
    return {
      id: "shared",
      name: "Agenda partagé iNrCy",
      email: "",
      calendarId,
      readable: false,
      accessRole: null,
      writable: false,
      error: visioGoogleErrorCode(error),
    };
  }
}

function teamMirrorEventId(calendarId: string, eventId: string) {
  return `tm${createHash("sha256")
    .update(teamCalendarMirrorSourceKey(calendarId, eventId), "utf8")
    .digest("hex")
    .slice(0, 40)}`;
}

function teamMirrorEventIdForSource(
  member: VisioTeamMember,
  event: GoogleCalendarEvent,
) {
  return teamMirrorEventId(member.calendarId, String(event.id || ""));
}

async function releaseRedisLock(redis: Redis, key: string, value: string) {
  await redis.eval(REDIS_COMPARE_DELETE_SCRIPT, [key], [value]);
}

function teamMirrorFingerprint(event: GoogleCalendarEvent, member: VisioTeamMember) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        memberId: member.id,
        summary: event.summary || "",
        description: event.description || "",
        location: event.location || "",
        visibility: event.visibility || "",
        transparency: event.transparency || "",
        colorId: event.colorId || "",
        start: event.start || null,
        end: event.end || null,
        organizerEmail: normalizedCalendarId(event.organizer?.email),
        iCalUID: String(event.iCalUID || ""),
        meetUrl: teamCalendarEventMeetUrl(event),
        guestEmails: teamCalendarSourceGuestEmails(
          event,
          getVisioManagedCalendarAddresses(),
        ),
      }),
      "utf8",
    )
    .digest("hex");
}

function mirrorSourceKey(event: GoogleCalendarEvent) {
  const properties = event.extendedProperties?.private || {};
  const calendarId = String(properties.sourceCalendarId || "");
  const eventId = String(properties.sourceEventId || "");
  return calendarId && eventId
    ? teamCalendarMirrorSourceKey(calendarId, eventId)
    : "";
}

export async function listVisioSharedCalendarEvents(
  timeMin: Date,
  timeMax: Date,
  showDeleted = true,
) {
  return listGoogleCalendarEvents({
    calendarId: getVisioSharedCalendarId(),
    timeMin,
    timeMax,
    showDeleted,
  });
}

async function upsertTeamMirrorEvent(input: {
  event: GoogleCalendarEvent;
  member: VisioTeamMember;
  existing?: GoogleCalendarEvent;
  mirrorEventId?: string;
}) {
  if (!input.event.id) throw new Error("visio_team_mirror_source_id_missing");
  const sharedCalendarId = getVisioSharedCalendarId();
  const fingerprint = teamMirrorFingerprint(input.event, input.member);
  const existingFingerprint =
    input.existing?.extendedProperties?.private?.sourceFingerprint || "";
  const mirrorEventId =
    input.existing?.id ||
    input.mirrorEventId ||
    teamMirrorEventIdForSource(input.member, input.event);
  const body = buildTeamCalendarMirrorBody({
    event: input.event,
    member: input.member,
    sharedCalendarId,
    mirrorEventId,
    fingerprint,
  });
  if (
    input.existing?.id &&
    input.existing.status !== "cancelled" &&
    existingFingerprint === fingerprint &&
    teamCalendarMirrorContentSignature(input.existing) ===
      teamCalendarMirrorContentSignature(body)
  ) {
    return "unchanged" as const;
  }

  if (input.existing?.id) {
    await googleCalendarRequest<GoogleCalendarEvent>(
      `/calendars/${encodeCalendarId(sharedCalendarId)}/events/${encodeURIComponent(input.existing.id)}?sendUpdates=none`,
      { method: "PATCH", body: JSON.stringify(body) },
    );
    return "updated" as const;
  }

  try {
    await googleCalendarRequest<GoogleCalendarEvent>(
      `/calendars/${encodeCalendarId(sharedCalendarId)}/events?sendUpdates=none`,
      { method: "POST", body: JSON.stringify(body) },
    );
    return "created" as const;
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("visio_google_api_failed:409:")
    ) {
      const existing = await googleCalendarRequest<GoogleCalendarEvent>(
        `/calendars/${encodeCalendarId(sharedCalendarId)}/events/${encodeURIComponent(mirrorEventId)}`,
      );
      const properties = existing.extendedProperties?.private || {};
      if (
        properties[TEAM_CALENDAR_MIRROR_KEY] !== TEAM_CALENDAR_MIRROR_VALUE ||
        properties.sourceCalendarId !== input.member.calendarId ||
        properties.sourceEventId !== input.event.id
      ) {
        throw new Error("visio_team_mirror_id_conflict");
      }
      await googleCalendarRequest<GoogleCalendarEvent>(
        `/calendars/${encodeCalendarId(sharedCalendarId)}/events/${encodeURIComponent(mirrorEventId)}?sendUpdates=none`,
        { method: "PATCH", body: JSON.stringify(body) },
      );
      return existing.status === "cancelled" ? "created" as const : "updated" as const;
    }
    throw error;
  }
}

async function cancelSharedCalendarEvent(event: GoogleCalendarEvent) {
  if (!event.id || event.status === "cancelled") return false;
  await googleCalendarRequest<GoogleCalendarEvent>(
    `/calendars/${encodeCalendarId(getVisioSharedCalendarId())}/events/${encodeURIComponent(event.id)}?sendUpdates=none`,
    {
      method: "PATCH",
      body: JSON.stringify({ status: "cancelled" }),
    },
  );
  return true;
}

async function findPendingSignupReminder(claims: VisioBookingClaims) {
  const signupTime = new Date(claims.iat * 1_000);
  const timeMin = new Date(signupTime.getTime() - 7 * 24 * 60 * 60_000);
  const timeMax = new Date(
    Math.max(Date.now(), signupTime.getTime()) +
      (getVisioBookingHorizonDays() + 7) * 24 * 60 * 60_000,
  );
  const events = await listVisioSharedCalendarEvents(timeMin, timeMax, false);
  return events.find((event) =>
    isPendingSignupReminderForProspect(event, claims.sub),
  ) || null;
}

async function removePendingSignupRemindersForProspect(
  claims: VisioBookingClaims,
) {
  const signupTime = new Date(claims.iat * 1_000);
  const timeMin = new Date(signupTime.getTime() - 24 * 60 * 60_000);
  const timeMax = new Date(signupTime.getTime() + 24 * 60 * 60_000);
  const events = await listVisioSharedCalendarEvents(timeMin, timeMax, false);
  let removed = 0;

  for (const event of events) {
    if (!isPendingSignupReminderForProspect(event, claims.sub)) continue;
    if (await cancelSharedCalendarEvent(event)) removed += 1;
  }
  return removed;
}

async function finalizeBookedVisio(
  claims: VisioBookingClaims,
  confirmation: VisioBookingConfirmation,
) {
  await removePendingSignupRemindersForProspect(claims).catch((error: unknown) => {
    console.error(
      "[visio-booking][signup-reminder-cleanup]",
      error instanceof Error ? error.message : "cleanup_failed",
    );
  });
  return confirmation;
}

type TeamCalendarSyncLock = {
  acquired: boolean;
  release: () => Promise<void>;
};

async function acquireTeamCalendarSyncLock(): Promise<TeamCalendarSyncLock> {
  const redis = getBookingRedis();
  const key = "inrcy:visio-booking:team-calendar-sync";
  const value = randomUUID();
  if (!redis) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("visio_team_calendar_sync_lock_unavailable");
    }
    const globalCache = globalThis as typeof globalThis & {
      __inrcy_visio_team_sync_lock?: { value: string; expiresAt: number };
    };
    if (
      globalCache.__inrcy_visio_team_sync_lock &&
      globalCache.__inrcy_visio_team_sync_lock.expiresAt > Date.now()
    ) {
      return { acquired: false, release: async () => undefined };
    }
    globalCache.__inrcy_visio_team_sync_lock = {
      value,
      expiresAt: Date.now() + 240_000,
    };
    return {
      acquired: true,
      release: async () => {
        if (globalCache.__inrcy_visio_team_sync_lock?.value === value) {
          delete globalCache.__inrcy_visio_team_sync_lock;
        }
      },
    };
  }

  const acquired = (await redis.set(key, value, { nx: true, ex: 240 })) === "OK";
  return {
    acquired,
    release: async () => {
      if (acquired) await releaseRedisLock(redis, key, value);
    },
  };
}

export async function syncVisioTeamCalendarsToShared(input?: {
  now?: Date;
  pastDays?: number;
  futureDays?: number;
}): Promise<VisioTeamCalendarSyncResult> {
  const startedAt = new Date();
  const now = input?.now || startedAt;
  const pastDays = Math.min(
    365,
    Math.max(1, input?.pastDays ?? TEAM_MIRROR_DEFAULT_PAST_DAYS),
  );
  const futureDays = Math.min(
    730,
    Math.max(7, input?.futureDays ?? TEAM_MIRROR_DEFAULT_FUTURE_DAYS),
  );
  const timeMin = new Date(now.getTime() - pastDays * 24 * 60 * 60_000);
  const timeMax = new Date(now.getTime() + futureDays * 24 * 60 * 60_000);
  const result: VisioTeamCalendarSyncResult = {
    ok: true,
    startedAt: startedAt.toISOString(),
    finishedAt: "",
    range: { timeMin: timeMin.toISOString(), timeMax: timeMax.toISOString() },
    scanned: 0,
    created: 0,
    updated: 0,
    cancelled: 0,
    unchanged: 0,
    skipped: 0,
    locked: false,
    errors: [],
  };

  const syncLock = await acquireTeamCalendarSyncLock();
  if (!syncLock.acquired) {
    result.locked = true;
    result.finishedAt = new Date().toISOString();
    return result;
  }

  try {
    const sharedEvents = await listVisioSharedCalendarEvents(timeMin, timeMax);
    const mirrors = sharedEvents.filter(
      (event) =>
        event.extendedProperties?.private?.[TEAM_CALENDAR_MIRROR_KEY] ===
        TEAM_CALENDAR_MIRROR_VALUE,
    );
    const bookedProspectIds = new Set(
      sharedEvents
        .filter(
          (event) =>
            event.status !== "cancelled" &&
            event.extendedProperties?.private?.[PRIVATE_BOOKING_KEY] ===
              PRIVATE_BOOKING_VALUE,
        )
        .map((event) =>
          String(event.extendedProperties?.private?.prospectUserId || "").trim(),
        )
        .filter(Boolean),
    );
    const mirrorBySource = new Map(
      mirrors
        .map((event) => [mirrorSourceKey(event), event] as const)
        .filter(([key]) => Boolean(key)),
    );
    const sharedCalendarId = getVisioSharedCalendarId();

    const teamMembers = getVisioTeamMembers();
    const memberById = new Map(teamMembers.map((member) => [member.id, member]));
    const assignmentCounts = sharedEvents.reduce<Record<string, number>>(
      (counts, event) => {
        if (event.status === "cancelled") return counts;
        const memberId = String(
          event.extendedProperties?.private?.assignedMemberId || "",
        );
        if (memberById.has(memberId)) {
          counts[memberId] = (counts[memberId] || 0) + 1;
        }
        return counts;
      },
      {},
    );

    // A signup reminder is attributed before the prospect chooses a slot. The
    // same reminder will later be converted into the real appointment, so the
    // assignment stays unique and no second calendar object is introduced.
    for (const reminder of sharedEvents) {
      const prospectUserId = pendingSignupReminderProspectUserId(reminder);
      const currentMemberId = String(
        reminder.extendedProperties?.private?.assignedMemberId || "",
      );
      if (!prospectUserId || memberById.has(currentMemberId) || !reminder.id) {
        continue;
      }
      const assignedMember = [...teamMembers].sort(
        (left, right) =>
          (assignmentCounts[left.id] || 0) - (assignmentCounts[right.id] || 0) ||
          left.id.localeCompare(right.id),
      )[0];
      if (!assignedMember) continue;
      try {
        await patchCalendarEventWithoutUpdates(sharedCalendarId, reminder.id, {
          summary: `Inscription - A traiter — ${assignedMember.name}`,
          extendedProperties: {
            private: {
              ...(reminder.extendedProperties?.private || {}),
              [PRIVATE_SIGNUP_ASSIGNMENT_KEY]: PRIVATE_SIGNUP_ASSIGNMENT_VALUE,
              assignedMemberId: assignedMember.id,
              assignedMemberEmail: assignedMember.email,
              prospectUserId,
            },
          },
        });
        assignmentCounts[assignedMember.id] =
          (assignmentCounts[assignedMember.id] || 0) + 1;
        result.updated += 1;
      } catch (error) {
        result.errors.push({
          memberId: "shared",
          code: visioGoogleErrorCode(error),
        });
      }
    }
    const managedCalendarIds = getVisioManagedCalendarAddresses();
    for (const member of teamMembers) {
      let sourceEvents: GoogleCalendarEvent[];
      try {
        sourceEvents = await listGoogleCalendarEvents({
          calendarId: member.calendarId,
          timeMin,
          timeMax,
          showDeleted: true,
        });
      } catch (error) {
        result.errors.push({ memberId: member.id, code: visioGoogleErrorCode(error) });
        continue;
      }

      const seenSourceKeys = new Set<string>();
      for (const event of sourceEvents) {
        result.scanned += 1;
        const privateProperties = event.extendedProperties?.private || {};
        if (
          event.status !== "cancelled" &&
          privateProperties[PRIVATE_BOOKING_KEY] === PRIVATE_BOOKING_VALUE &&
          privateProperties.prospectUserId
        ) {
          bookedProspectIds.add(privateProperties.prospectUserId);
        }
        const sourceKey = event.id
          ? teamCalendarMirrorSourceKey(member.calendarId, event.id)
          : "";
        if (sourceKey) seenSourceKeys.add(sourceKey);
        const existingMirror = sourceKey ? mirrorBySource.get(sourceKey) : undefined;
        if (
          privateProperties[PRIVATE_BOOKING_COMPANION_KEY] ===
          PRIVATE_BOOKING_COMPANION_VALUE
        ) {
          try {
            if (existingMirror && (await cancelSharedCalendarEvent(existingMirror))) {
              result.cancelled += 1;
            } else {
              result.skipped += 1;
            }
          } catch (error) {
            result.errors.push({
              memberId: member.id,
              code: visioGoogleErrorCode(error),
            });
          }
          continue;
        }
        if (
          !shouldMirrorTeamCalendarEvent({
            event,
            memberEmail: member.email,
            memberCalendarId: member.calendarId,
            managedCalendarIds,
            sharedCalendarId,
          })
        ) {
          try {
            if (existingMirror && (await cancelSharedCalendarEvent(existingMirror))) {
              result.cancelled += 1;
            } else {
              result.skipped += 1;
            }
          } catch (error) {
            result.errors.push({
              memberId: member.id,
              code: visioGoogleErrorCode(error),
            });
          }
          continue;
        }

        try {
          const assignedMember = memberById.get(
            String(privateProperties.assignedMemberId || ""),
          );
          const organizerMember = managedMemberForAddress(event.organizer?.email);
          const isBooking =
            privateProperties[PRIVATE_BOOKING_KEY] === PRIVATE_BOOKING_VALUE;
          const responsibleMember = isBooking
            ? assignedMember || organizerMember || member
            : organizerMember || assignedMember || member;
          const mirrorMember = {
            ...responsibleMember,
            // Keep the real source calendar even when a public booking is
            // assigned internally to another team member.
            calendarId: member.calendarId,
          };
          const outcome = await upsertTeamMirrorEvent({
            event,
            member: mirrorMember,
            existing: existingMirror,
          });
          result[outcome] += 1;
        } catch (error) {
          result.errors.push({ memberId: member.id, code: visioGoogleErrorCode(error) });
        }
      }

      for (const mirror of mirrors) {
        const properties = mirror.extendedProperties?.private || {};
        if (
          properties.sourceCalendarId !== member.calendarId ||
          mirror.status === "cancelled"
        ) {
          continue;
        }
        const sourceKey = mirrorSourceKey(mirror);
        if (!sourceKey || seenSourceKeys.has(sourceKey)) continue;
        try {
          if (await cancelSharedCalendarEvent(mirror)) result.cancelled += 1;
        } catch (error) {
          result.errors.push({ memberId: member.id, code: visioGoogleErrorCode(error) });
        }
      }
    }

    for (const event of sharedEvents) {
      const prospectUserId = pendingSignupReminderProspectUserId(event);
      if (!prospectUserId || !bookedProspectIds.has(prospectUserId)) continue;
      try {
        if (await cancelSharedCalendarEvent(event)) result.cancelled += 1;
      } catch (error) {
        result.errors.push({ memberId: "shared", code: visioGoogleErrorCode(error) });
      }
    }

    result.ok = result.errors.length === 0;
    result.finishedAt = new Date().toISOString();
    return result;
  } finally {
    await syncLock.release().catch(() => undefined);
  }
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
  return listGoogleCalendarEvents({
    calendarId: getVisioSharedCalendarId(),
    timeMin,
    timeMax,
    privateExtendedProperty: `${PRIVATE_BOOKING_KEY}=${PRIVATE_BOOKING_VALUE}`,
  });
}

async function listAllBookingEvents(timeMin: Date, timeMax: Date) {
  const members = getVisioTeamMembers();
  const [memberEventLists, sharedEvents] = await Promise.all([
    Promise.all(
      members.map((member) =>
        listGoogleCalendarEvents({
          calendarId: member.calendarId,
          timeMin,
          timeMax,
          privateExtendedProperty: `${PRIVATE_BOOKING_KEY}=${PRIVATE_BOOKING_VALUE}`,
        }).catch((error: unknown) => {
          throw new Error(
            `visio_member_booking_list_failed:${member.id}:${visioGoogleErrorCode(error)}`,
          );
        }),
      ),
    ),
    listBookingEvents(timeMin, timeMax),
  ]);

  const unique = new Map<string, GoogleCalendarEvent>();
  for (const event of memberEventLists.flat()) {
    const key = String(
      event.extendedProperties?.private?.bookingNonce || event.id || randomUUID(),
    );
    unique.set(key, event);
  }
  for (const event of sharedEvents) {
    const key = String(
      event.extendedProperties?.private?.bookingNonce || event.id || randomUUID(),
    );
    if (!unique.has(key)) unique.set(key, event);
  }
  return [...unique.values()];
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
  const minimumLeadDays = getVisioBookingMinimumLeadDays();
  const localNow = getLocalDateTimeParts(now);
  const candidates: Array<{ date: string; start: Date }> = [];

  for (let offset = 0; offset <= horizonDays; offset += 1) {
    const date = addLocalDays(localNow, offset);
    for (const hour of VISIO_BOOKING_START_HOURS) {
      const start = zonedDateTimeToUtc({ ...date, hour });
      if (isAllowedVisioStart({ start, now, horizonDays, minimumLeadDays })) {
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
    listAllBookingEvents(rangeStart, rangeEnd),
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

function bookingCompanionEventId(nonce: string) {
  return createHash("sha256")
    .update(`signup-visio-companion:${nonce}`, "utf8")
    .digest("hex")
    .slice(0, 40);
}

function conferenceRequestId(nonce: string) {
  return createHash("sha256").update(`meet:${nonce}`, "utf8").digest("hex").slice(0, 32);
}

function getMeetUrl(event: GoogleCalendarEvent) {
  return teamCalendarEventMeetUrl(event);
}

function confirmationFromEvent(
  event: GoogleCalendarEvent,
  fallbackStart: Date,
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
    assignedTo: PUBLIC_BOOKING_ASSIGNEE,
    meetUrl: getMeetUrl(event),
    calendarUrl: String(
      event.extendedProperties?.private?.sourceHtmlLink || event.htmlLink || "",
    ),
  };
}

async function getCalendarEvent(calendarId: string, eventId: string) {
  try {
    return await googleCalendarRequest<GoogleCalendarEvent>(
      `/calendars/${encodeCalendarId(calendarId)}/events/${encodeURIComponent(eventId)}`,
    );
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.startsWith("visio_google_api_failed:404:") ||
        error.message.startsWith("visio_google_api_failed:410:"))
    ) {
      return null;
    }
    throw error;
  }
}

async function getExistingBooking(
  eventId: string,
  claims?: VisioBookingClaims,
) {
  const sharedEvent = await getCalendarEvent(getVisioSharedCalendarId(), eventId);
  if (sharedEvent && sharedEvent.status !== "cancelled") {
    if (claims) assertMatchingBookingEvent(sharedEvent, claims);
    return sharedEvent;
  }

  if (claims) {
    const signupTime = new Date(claims.iat * 1_000);
    const candidates = await listBookingEvents(
      new Date(signupTime.getTime() - 7 * 24 * 60 * 60_000),
      new Date(
        Math.max(Date.now(), signupTime.getTime()) +
          (getVisioBookingHorizonDays() + 7) * 24 * 60 * 60_000,
      ),
    );
    const existing = candidates.find((event) => {
      const properties = event.extendedProperties?.private || {};
      return (
        event.status !== "cancelled" &&
        properties.bookingNonce === claims.nonce &&
        properties.prospectUserId === claims.sub
      );
    });
    if (existing) return existing;
  }

  const publicEvent = await getCalendarEvent(getVisioPublicCalendarId(), eventId);
  if (publicEvent && publicEvent.status !== "cancelled") {
    if (claims) assertMatchingBookingEvent(publicEvent, claims);
    return publicEvent;
  }

  for (const member of getVisioTeamMembers()) {
    try {
      const event = await getCalendarEvent(member.calendarId, eventId);
      if (
        event &&
        event.status !== "cancelled" &&
        event.extendedProperties?.private?.[PRIVATE_BOOKING_COMPANION_KEY] !==
          PRIVATE_BOOKING_COMPANION_VALUE
      ) {
        if (claims) assertMatchingBookingEvent(event, claims);
        return event;
      }
    } catch (error) {
      if (
        error instanceof Error &&
        (error.message.startsWith("visio_google_api_failed:403:") ||
          error.message.startsWith("visio_google_api_failed:404:"))
      ) {
        continue;
      }
      throw error;
    }
  }

  return null;
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

async function acquireBookingLock(lockKey: string): Promise<BookingLock> {
  const key = `inrcy:visio-booking:${lockKey}`;
  const value = randomUUID();
  const redis = getBookingRedis();
  if (redis) {
    const result = await redis.set(key, value, {
      nx: true,
      ex: BOOKING_LOCK_TTL_SECONDS,
    });
    if (result !== "OK") throw new Error("visio_slot_busy");
    return {
      release: async () => {
        await releaseRedisLock(redis, key, value);
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
  locks.set(key, Date.now() + BOOKING_LOCK_TTL_SECONDS * 1_000);
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

function getInternalAlertRecipients(environmentName: string) {
  const configuredRecipients = optionalEnv(environmentName, "")
    .split(/[;,]/)
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean);
  return Array.from(
    new Set([REQUIRED_INTERNAL_ALERT_EMAIL, ...configuredRecipients]),
  ).join(", ");
}

function assertMatchingBookingEvent(
  event: GoogleCalendarEvent,
  claims: VisioBookingClaims,
) {
  const properties = event.extendedProperties?.private || {};
  if (
    event.status === "cancelled" ||
    properties[PRIVATE_BOOKING_KEY] !== PRIVATE_BOOKING_VALUE ||
    properties.bookingNonce !== claims.nonce ||
    properties.prospectUserId !== claims.sub
  ) {
    throw new Error(
      event.status === "cancelled"
        ? "visio_booking_cancelled"
        : "visio_booking_id_conflict",
    );
  }
}

async function waitForMeetConference(
  calendarId: string,
  eventId: string,
  initialEvent: GoogleCalendarEvent,
) {
  let event = initialEvent;
  for (const delayMs of [0, 250, 500, 1_000, 1_500]) {
    if (event.conferenceData && getMeetUrl(event)) return event;
    if (delayMs) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    const refreshed = await getCalendarEvent(calendarId, eventId);
    if (!refreshed || refreshed.status === "cancelled") {
      throw new Error("visio_booking_cancelled");
    }
    event = refreshed;
  }
  throw new Error("visio_meet_conference_pending");
}

async function createGoogleBookingEvent(input: {
  eventId: string;
  start: Date;
  member: VisioTeamMember;
  claims: VisioBookingClaims;
  pendingReminder?: GoogleCalendarEvent | null;
}) {
  const prospect = await readProspect(input.claims);
  const sharedCalendarId = getVisioSharedCalendarId();
  const pendingReminder =
    input.pendingReminder === undefined
      ? await findPendingSignupReminder(input.claims)
      : input.pendingReminder;
  const masterEventId = String(pendingReminder?.id || input.eventId);
  const end = new Date(
    input.start.getTime() + VISIO_BOOKING_DURATION_MINUTES * 60_000,
  );
  const internalContactLines = [
    `Professionnel : ${prospect.name}`,
    prospect.company ? `Société : ${prospect.company}` : "",
    `E-mail : ${prospect.email}`,
    prospect.phone ? `Téléphone : ${prospect.phone}` : "",
    `Interlocuteur iNrCy : ${input.member.name}`,
    "Source : inscription validée sur inrcy.com",
  ].filter(Boolean);
  const publicContent = buildPublicVisioBookingContent({
    prospect,
    assignedMember: input.member,
  });

  const privateProperties = {
    [PRIVATE_BOOKING_KEY]: PRIVATE_BOOKING_VALUE,
    [PRIVATE_BOOKING_SINGLE_EVENT_KEY]: PRIVATE_BOOKING_SINGLE_EVENT_VALUE,
    [TEAM_CALENDAR_MIRROR_KEY]: TEAM_CALENDAR_MIRROR_VALUE,
    bookingNonce: input.claims.nonce,
    prospectUserId: input.claims.sub,
    assignedMemberId: input.member.id,
    assignedMemberEmail: input.member.email,
    sourceCalendarId: sharedCalendarId,
    sourceEventId: masterEventId,
    sourceOrganizerEmail: sharedCalendarId,
    sourceCalendarIsOrganizer: "true",
    sharedCalendarId,
  };

  const attendees = buildSingleAssigneeVisioAttendees({
    teamMembers: getVisioTeamMembers(),
    assignedMemberId: input.member.id,
    externalAttendees: [
      { email: prospect.email, displayName: prospect.name, optional: false },
    ],
  });

  const eventBody = {
    ...publicContent,
    colorId: optionalEnv("INRCY_VISIO_BOOKED_COLOR_ID", "9"),
    visibility: "default",
    guestsCanInviteOthers: false,
    guestsCanModify: false,
    guestsCanSeeOtherGuests: false,
    start: {
      dateTime: input.start.toISOString(),
      timeZone: VISIO_BOOKING_TIMEZONE,
    },
    end: {
      dateTime: end.toISOString(),
      timeZone: VISIO_BOOKING_TIMEZONE,
    },
    reminders: {
      useDefault: false,
      overrides: [
        { method: "email", minutes: 24 * 60 },
        { method: "popup", minutes: 60 },
      ],
    },
    extendedProperties: {
      private: privateProperties,
    },
    attendees,
    conferenceData: getMeetUrl(pendingReminder || {})
      ? pendingReminder?.conferenceData
      : {
          createRequest: {
            requestId: conferenceRequestId(input.claims.nonce),
            conferenceSolutionKey: { type: "hangoutsMeet" },
          },
        },
  };

  let event: GoogleCalendarEvent;
  let createdMasterEvent = true;
  if (pendingReminder?.id) {
    if (!isPendingSignupReminderForProspect(pendingReminder, input.claims.sub)) {
      throw new Error("visio_booking_id_conflict");
    }
    event = await googleCalendarRequest<GoogleCalendarEvent>(
      `/calendars/${encodeCalendarId(sharedCalendarId)}/events/${encodeURIComponent(
        pendingReminder.id,
      )}?conferenceDataVersion=1&sendUpdates=all`,
      { method: "PATCH", body: JSON.stringify(eventBody) },
    );
  } else {
    try {
      event = await googleCalendarRequest<GoogleCalendarEvent>(
        `/calendars/${encodeCalendarId(sharedCalendarId)}/events?conferenceDataVersion=1&sendUpdates=all`,
        {
          method: "POST",
          body: JSON.stringify({ ...eventBody, id: masterEventId }),
        },
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("visio_google_api_failed:409:")
      ) {
        const existingMaster = await getCalendarEvent(
          sharedCalendarId,
          masterEventId,
        );
        if (!existingMaster) throw new Error("visio_booking_cancelled");
        assertMatchingBookingEvent(existingMaster, input.claims);
        event = existingMaster;
        createdMasterEvent = false;
      } else {
        throw error;
      }
    }
  }

  event = await waitForMeetConference(sharedCalendarId, masterEventId, event);

  const confirmation = confirmationFromEvent(event, input.start);
  if (createdMasterEvent) {
    await sendMonitoringMail({
      to: getInternalAlertRecipients("INRCY_VISIO_BOOKING_ALERT_EMAIL"),
      subject: `Nouveau rendez-vous visio iNrCy — ${prospect.company || prospect.name}`,
      text: [
        "Un rendez-vous de présentation a été réservé après une inscription.",
        `Date : ${confirmation.dateLabel} à ${confirmation.timeLabel}`,
        `Attribué à : ${input.member.name}`,
        ...internalContactLines.slice(0, 4),
        confirmation.meetUrl ? `Google Meet : ${confirmation.meetUrl}` : "",
      ].filter(Boolean).join("\n"),
    }).catch((error: unknown) => {
      console.error(
        "[visio-booking][monitoring-mail]",
        error instanceof Error ? error.message : "send_failed",
      );
    });
  }
  return confirmation;
}

export async function bookVisioSlot(
  claims: VisioBookingClaims,
  startValue: unknown,
  now = new Date(),
) {
  const start = new Date(String(startValue || ""));
  const horizonDays = getVisioBookingHorizonDays();
  const minimumLeadDays = getVisioBookingMinimumLeadDays();
  if (!isAllowedVisioStart({ start, now, horizonDays, minimumLeadDays })) {
    throw new Error("visio_slot_invalid");
  }

  const eventId = bookingEventId(claims.nonce);
  const identityLock = await acquireBookingLock(`identity:${eventId}`);
  try {
    const members = getVisioTeamMembers();
    const existing = await getExistingBooking(eventId, claims);
    if (existing) {
      return finalizeBookedVisio(
        claims,
        confirmationFromEvent(existing, start),
      );
    }
    const slotLock = await acquireBookingLock(`slot:${start.toISOString()}`);
    try {
      const existingAfterLock = await getExistingBooking(eventId, claims);
      if (existingAfterLock) {
        return finalizeBookedVisio(
          claims,
          confirmationFromEvent(existingAfterLock, start),
        );
      }
      const spacingEnd = new Date(
        start.getTime() + VISIO_BOOKING_SPACING_MINUTES * 60_000,
      );
      const loadRangeStart = new Date(now.getTime() - 30 * 24 * 60 * 60_000);
      const loadRangeEnd = new Date(
        now.getTime() + (horizonDays + 2) * 24 * 60 * 60_000,
      );
      const [busyByCalendar, events, pendingReminder] = await Promise.all([
        readFreeBusy(members, start, spacingEnd),
        listAllBookingEvents(loadRangeStart, loadRangeEnd),
        findPendingSignupReminder(claims),
      ]);

      if (countEventsAtStart(events, start) >= VISIO_BOOKING_MAX_CONCURRENT) {
        throw new Error("visio_slot_unavailable");
      }
      const effectiveBusy = addInternalBookingsToBusyPeriods(
        members,
        busyByCalendar,
        events,
      );
      const preassignedMemberId = String(
        pendingReminder?.extendedProperties?.private?.assignedMemberId || "",
      );
      const preassignedMember = members.find(
        (candidate) => candidate.id === preassignedMemberId,
      );
      const member =
        (preassignedMember && isMemberFree(preassignedMember, effectiveBusy, start)
          ? preassignedMember
          : null) || chooseBalancedMember({
        members,
        busyByCalendar: effectiveBusy,
        bookingCountByMember: countEventsByMember(events),
        start,
      });
      if (!member) throw new Error("visio_slot_unavailable");

      try {
        const confirmation = await createGoogleBookingEvent({
          eventId,
          start,
          member,
          claims,
          pendingReminder,
        });
        return finalizeBookedVisio(claims, confirmation);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.startsWith("visio_google_api_failed:409:")
        ) {
          const racedEvent = await getExistingBooking(eventId, claims);
          if (racedEvent) {
            return finalizeBookedVisio(
              claims,
              confirmationFromEvent(racedEvent, start),
            );
          }
        }
        throw error;
      }
    } finally {
      await slotLock.release().catch(() => undefined);
    }
  } finally {
    await identityLock.release().catch(() => undefined);
  }
}

function normalizedCalendarId(value: unknown) {
  return String(value || "").trim().toLowerCase();
}

function getVisioManagedCalendarAddresses() {
  return [...new Set([
    getVisioSharedCalendarId(),
    getVisioPublicCalendarId(),
    ...getVisioTeamMembers().flatMap((member) => [member.email, member.calendarId]),
  ].map(normalizedCalendarId).filter(Boolean))];
}

function managedMemberForAddress(address: unknown) {
  const normalized = normalizedCalendarId(address);
  return getVisioTeamMembers().find(
    (member) =>
      normalizedCalendarId(member.calendarId) === normalized ||
      normalizedCalendarId(member.email) === normalized,
  ) || null;
}

function eventOrganizerMatchesMember(
  event: GoogleCalendarEvent,
  member: VisioTeamMember,
) {
  const organizer = normalizedCalendarId(event.organizer?.email);
  return Boolean(
    organizer &&
      [member.calendarId, member.email]
        .map(normalizedCalendarId)
        .includes(organizer),
  );
}

function appointmentDateValue(event: GoogleCalendarEvent, edge: "start" | "end") {
  const value = event[edge]?.dateTime || event[edge]?.date || "";
  return String(value).trim();
}

function cleanAppointmentTitle(value: unknown) {
  return String(value || "Rendez-vous")
    .trim()
    .replace(/^\[[^\]]+\]\s*/, "") || "Rendez-vous";
}

function appointmentIdentity(event: GoogleCalendarEvent) {
  const properties = event.extendedProperties?.private || {};
  const nonce = String(properties.bookingNonce || "").trim();
  if (nonce) return `booking:${nonce}`;
  const sourceICalUID = String(properties.sourceICalUID || "").trim().toLowerCase();
  if (sourceICalUID) return `ical:${sourceICalUID}`;
  const meetUrl = teamCalendarEventMeetUrl(event).toLowerCase();
  const start = appointmentDateValue(event, "start");
  if (meetUrl && start) return `meet:${meetUrl}:${start}`;
  const sourceEventId = String(properties.sourceEventId || event.id || "").trim();
  if (sourceEventId && start) return `event:${sourceEventId}:${start}`;
  return `source:${String(properties.sourceCalendarId || "")}:${String(
    sourceEventId,
  )}`;
}

function memberForMirrorEvent(event: GoogleCalendarEvent) {
  const members = getVisioTeamMembers();
  const properties = event.extendedProperties?.private || {};
  const assignedMemberId = String(properties.assignedMemberId || "").trim();
  const assignedMember = members.find((member) => member.id === assignedMemberId);
  const isBooking = properties[PRIVATE_BOOKING_KEY] === PRIVATE_BOOKING_VALUE;
  if (isBooking && assignedMember) return assignedMember;

  const organizerMember = managedMemberForAddress(properties.sourceOrganizerEmail);
  if (organizerMember) return organizerMember;
  if (assignedMember) return assignedMember;

  const sourceCalendarId = normalizedCalendarId(properties.sourceCalendarId);
  return members.find(
    (member) => normalizedCalendarId(member.calendarId) === sourceCalendarId,
  ) || null;
}

function teamAppointmentFromMirror(event: GoogleCalendarEvent): VisioTeamAppointment | null {
  if (
    !event.id ||
    event.status === "cancelled" ||
    event.extendedProperties?.private?.[TEAM_CALENDAR_MIRROR_KEY] !==
      TEAM_CALENDAR_MIRROR_VALUE
  ) {
    return null;
  }
  const start = appointmentDateValue(event, "start");
  const end = appointmentDateValue(event, "end");
  if (!start || !end) return null;
  const allDay = Boolean(event.start?.date && !event.start?.dateTime);
  const title = cleanAppointmentTitle(event.summary);
  const normalizedTitle = title
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .trim()
    .toLowerCase();
  if (
    allDay ||
    event.visibility === "private" ||
    event.visibility === "confidential" ||
    normalizedTitle === "inscription a traiter" ||
    normalizedTitle.startsWith("indisponible ")
  ) {
    return null;
  }
  const member = memberForMirrorEvent(event);
  const properties = event.extendedProperties?.private || {};
  return {
    id: event.id,
    identity: appointmentIdentity(event),
    title,
    start,
    end,
    allDay,
    meetUrl: teamCalendarEventMeetUrl(event),
    calendarUrl: String(properties.sourceHtmlLink || event.htmlLink || "").trim(),
    currentMemberId: member?.id || "",
    currentMemberName: member?.name || "Non attribué",
    sourceType:
      properties[PRIVATE_BOOKING_KEY] === PRIVATE_BOOKING_VALUE
        ? "booking"
        : "calendar",
  };
}

function isActiveTeamAppointmentMirror(
  event: GoogleCalendarEvent | null,
): event is GoogleCalendarEvent {
  return Boolean(
    event?.id &&
      event.status !== "cancelled" &&
      event.extendedProperties?.private?.[TEAM_CALENDAR_MIRROR_KEY] ===
        TEAM_CALENDAR_MIRROR_VALUE,
  );
}

async function resolveActiveTeamAppointmentMirror(input: {
  mirrorEventId: string;
  identity?: string;
  start?: string;
}) {
  const exactMirror = await getCalendarEvent(
    getVisioSharedCalendarId(),
    input.mirrorEventId,
  );
  if (isActiveTeamAppointmentMirror(exactMirror)) return exactMirror;

  const identity = String(input.identity || "").trim();
  const startMs = new Date(String(input.start || "")).getTime();
  if (!identity || !Number.isFinite(startMs)) return null;

  const nearbyMirrors = await listVisioSharedCalendarEvents(
    new Date(startMs - 24 * 60 * 60_000),
    new Date(startMs + 24 * 60 * 60_000),
    false,
  );
  let recovered: GoogleCalendarEvent | null = null;
  for (const event of nearbyMirrors) {
    if (
      !isActiveTeamAppointmentMirror(event) ||
      appointmentIdentity(event) !== identity
    ) {
      continue;
    }
    if (!recovered || shouldPreferAppointmentMirror(event, recovered)) {
      recovered = event;
    }
  }
  return recovered;
}

function shouldPreferAppointmentMirror(
  candidate: GoogleCalendarEvent,
  current: GoogleCalendarEvent,
) {
  const publicCalendarId = normalizedCalendarId(getVisioPublicCalendarId());
  const candidateProperties = candidate.extendedProperties?.private || {};
  const currentProperties = current.extendedProperties?.private || {};
  const candidateIsBooking =
    candidateProperties[PRIVATE_BOOKING_KEY] === PRIVATE_BOOKING_VALUE;
  const currentIsBooking =
    currentProperties[PRIVATE_BOOKING_KEY] === PRIVATE_BOOKING_VALUE;
  if (candidateIsBooking !== currentIsBooking) return candidateIsBooking;

  const candidateIsOrganizer =
    candidateProperties.sourceCalendarIsOrganizer === "true";
  const currentIsOrganizer =
    currentProperties.sourceCalendarIsOrganizer === "true";
  if (candidateIsOrganizer !== currentIsOrganizer) return candidateIsOrganizer;

  const candidateIsPublic =
    normalizedCalendarId(candidateProperties.sourceCalendarId) === publicCalendarId;
  const currentIsPublic =
    normalizedCalendarId(currentProperties.sourceCalendarId) === publicCalendarId;
  if (candidateIsPublic !== currentIsPublic) {
    // Automatic bookings deliberately keep the public organizer. For ordinary
    // events, a non-public source is safer for legacy mirrors that do not yet
    // carry organizer metadata (the public copy is often only an attendee).
    return candidateIsBooking ? candidateIsPublic : !candidateIsPublic;
  }
  return String(candidate.updated || "") > String(current.updated || "");
}

export async function listVisioTeamAppointments(input?: {
  now?: Date;
  pastDays?: number;
  futureDays?: number;
  refresh?: boolean;
}) {
  const now = input?.now || new Date();
  const pastDays = Math.min(30, Math.max(0, input?.pastDays ?? 0));
  const futureDays = Math.min(365, Math.max(7, input?.futureDays ?? 90));
  if (input?.refresh === true) {
    await syncVisioTeamCalendarsToShared({
      now,
      pastDays: Math.max(1, pastDays),
      futureDays,
    }).catch((error: unknown) => {
      console.error(
        "[visio-booking][team-appointments-refresh]",
        error instanceof Error ? error.message : "refresh_failed",
      );
    });
  }

  const events = await listVisioSharedCalendarEvents(
    new Date(now.getTime() - pastDays * 24 * 60 * 60_000),
    new Date(now.getTime() + futureDays * 24 * 60 * 60_000),
    false,
  );
  const byIdentity = new Map<string, GoogleCalendarEvent>();
  for (const event of events) {
    if (
      event.extendedProperties?.private?.[TEAM_CALENDAR_MIRROR_KEY] !==
      TEAM_CALENDAR_MIRROR_VALUE
    ) {
      continue;
    }
    const key = appointmentIdentity(event);
    const current = byIdentity.get(key);
    if (!current || shouldPreferAppointmentMirror(event, current)) {
      byIdentity.set(key, event);
    }
  }

  return [...byIdentity.values()]
    .map(teamAppointmentFromMirror)
    .filter((appointment): appointment is VisioTeamAppointment => Boolean(appointment))
    .sort((left, right) => left.start.localeCompare(right.start));
}

async function patchCalendarEvent(
  calendarId: string,
  eventId: string,
  body: Record<string, unknown>,
  sendUpdates: "all" | "none",
) {
  return googleCalendarRequest<GoogleCalendarEvent>(
    `/calendars/${encodeCalendarId(calendarId)}/events/${encodeURIComponent(
      eventId,
    )}?conferenceDataVersion=1&sendUpdates=${sendUpdates}`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
}

async function patchCalendarEventWithoutUpdates(
  calendarId: string,
  eventId: string,
  body: Record<string, unknown>,
) {
  return patchCalendarEvent(calendarId, eventId, body, "none");
}

async function patchCalendarEventWithUpdates(
  calendarId: string,
  eventId: string,
  body: Record<string, unknown>,
) {
  return patchCalendarEvent(calendarId, eventId, body, "all");
}

async function moveCalendarEventWithoutUpdates(
  sourceCalendarId: string,
  eventId: string,
  destinationCalendarId: string,
) {
  const params = new URLSearchParams({
    destination: destinationCalendarId,
    sendUpdates: "none",
  });
  return googleCalendarRequest<GoogleCalendarEvent>(
    `/calendars/${encodeCalendarId(sourceCalendarId)}/events/${encodeURIComponent(
      eventId,
    )}/move?${params.toString()}`,
    { method: "POST" },
  );
}

async function cancelCalendarEventWithoutUpdates(
  calendarId: string,
  eventId: string,
) {
  try {
    await patchCalendarEventWithoutUpdates(calendarId, eventId, {
      attendees: [],
      status: "cancelled",
    });
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.startsWith("visio_google_api_failed:404:") ||
        error.message.startsWith("visio_google_api_failed:410:"))
    ) {
      return;
    }
    throw error;
  }
}

async function cancelDuplicateAppointmentMirrors(
  keepMirrorId: string,
  reference: GoogleCalendarEvent,
) {
  const startMs = eventStartMs(reference);
  if (!startMs) return;
  const referenceIdentity = appointmentIdentity(reference);
  const events = await listVisioSharedCalendarEvents(
    new Date(startMs - 24 * 60 * 60_000),
    new Date(startMs + 24 * 60 * 60_000),
    false,
  );
  for (const event of events) {
    if (
      !event.id ||
      event.id === keepMirrorId ||
      event.extendedProperties?.private?.[TEAM_CALENDAR_MIRROR_KEY] !==
        TEAM_CALENDAR_MIRROR_VALUE ||
      appointmentIdentity(event) !== referenceIdentity
    ) {
      continue;
    }
    await cancelSharedCalendarEvent(event);
  }
}

type BookingCompanionMatch = {
  member: VisioTeamMember;
  event: GoogleCalendarEvent;
};

async function findBookingCompanions(bookingNonce: string) {
  const companionId = bookingCompanionEventId(bookingNonce);
  const matches: BookingCompanionMatch[] = [];
  for (const member of getVisioTeamMembers()) {
    const event = await getCalendarEvent(member.calendarId, companionId);
    if (
      event &&
      event.status !== "cancelled" &&
      event.extendedProperties?.private?.[PRIVATE_BOOKING_COMPANION_KEY] ===
        PRIVATE_BOOKING_COMPANION_VALUE &&
      event.extendedProperties?.private?.bookingNonce === bookingNonce
    ) {
      matches.push({ member, event });
    }
  }
  return matches;
}

async function createMissingBookingCompanion(input: {
  publicEvent: GoogleCalendarEvent;
  bookingNonce: string;
  targetMember: VisioTeamMember;
}) {
  const properties = input.publicEvent.extendedProperties?.private || {};
  return googleCalendarRequest<GoogleCalendarEvent>(
    `/calendars/${encodeCalendarId(
      input.targetMember.calendarId,
    )}/events?conferenceDataVersion=1&sendUpdates=none`,
    {
      method: "POST",
      body: JSON.stringify({
        id: bookingCompanionEventId(input.bookingNonce),
        summary: input.publicEvent.summary,
        description: [
          String(input.publicEvent.description || "").trim(),
          `Responsable interne : ${input.targetMember.name}`,
        ].filter(Boolean).join("\n"),
        location: input.publicEvent.location,
        colorId: input.publicEvent.colorId,
        visibility: "private",
        start: input.publicEvent.start,
        end: input.publicEvent.end,
        conferenceData: input.publicEvent.conferenceData,
        reminders: { useDefault: false, overrides: [] },
        extendedProperties: {
          private: {
            ...properties,
            assignedMemberId: input.targetMember.id,
            assignedMemberEmail: input.targetMember.email,
            [PRIVATE_BOOKING_COMPANION_KEY]: PRIVATE_BOOKING_COMPANION_VALUE,
          },
        },
      }),
    },
  );
}

async function reassignAutomaticBooking(input: {
  mirror: GoogleCalendarEvent;
  targetMember: VisioTeamMember;
}) {
  const properties = input.mirror.extendedProperties?.private || {};
  const bookingNonce = String(properties.bookingNonce || "").trim();
  if (!bookingNonce) throw new Error("visio_team_assignment_booking_nonce_missing");

  if (
    properties[PRIVATE_BOOKING_SINGLE_EVENT_KEY] ===
      PRIVATE_BOOKING_SINGLE_EVENT_VALUE &&
    input.mirror.id
  ) {
    const publicContent = buildPublicVisioBookingContent({
      prospect: {
        name: cleanAppointmentTitle(input.mirror.summary),
        company: cleanAppointmentTitle(input.mirror.summary),
      },
      assignedMember: input.targetMember,
    });
    return patchCalendarEventWithoutUpdates(
      getVisioSharedCalendarId(),
      input.mirror.id,
      {
        description: publicContent.description,
        attendees: buildSingleAssigneeVisioAttendees({
          teamMembers: getVisioTeamMembers(),
          assignedMemberId: input.targetMember.id,
          currentAttendees: input.mirror.attendees,
        }),
        extendedProperties: {
          private: {
            ...properties,
            assignedMemberId: input.targetMember.id,
            assignedMemberEmail: input.targetMember.email,
          },
        },
      },
    );
  }

  const publicCalendarId = getVisioPublicCalendarId();
  const publicEventId =
    normalizedCalendarId(properties.sourceCalendarId) ===
      normalizedCalendarId(publicCalendarId) && properties.sourceEventId
      ? String(properties.sourceEventId)
      : bookingEventId(bookingNonce);
  let publicEvent = await getCalendarEvent(publicCalendarId, publicEventId);
  if (
    !publicEvent ||
    publicEvent.status === "cancelled" ||
    publicEvent.extendedProperties?.private?.bookingNonce !== bookingNonce
  ) {
    throw new Error("visio_team_assignment_public_event_missing");
  }

  const companions = await findBookingCompanions(bookingNonce);
  const targetUsesPublicCalendar =
    normalizedCalendarId(input.targetMember.calendarId) ===
    normalizedCalendarId(publicCalendarId);

  if (targetUsesPublicCalendar) {
    // The public event itself is already owned by this calendar and is the
    // unique Meet host. Any private companion would only be a duplicate.
    for (const match of companions) {
      if (!match.event.id || !eventOrganizerMatchesMember(match.event, match.member)) {
        continue;
      }
      await cancelCalendarEventWithoutUpdates(
        match.member.calendarId,
        String(match.event.id),
      );
    }
  } else {
    const currentCompanion =
      companions.find(
        (match) =>
          normalizedCalendarId(match.member.calendarId) ===
            normalizedCalendarId(input.targetMember.calendarId) &&
          eventOrganizerMatchesMember(match.event, match.member),
      ) ||
      companions.find((match) => eventOrganizerMatchesMember(match.event, match.member)) ||
      null;

    // Old incidents may have created independent companion events in several
    // internal calendars. Keep only the organizer copy selected above.
    for (const match of companions) {
      if (
        !match.event.id ||
        match === currentCompanion ||
        !eventOrganizerMatchesMember(match.event, match.member)
      ) {
        continue;
      }
      await cancelCalendarEventWithoutUpdates(
        match.member.calendarId,
        String(match.event.id),
      );
    }

    let companionEvent: GoogleCalendarEvent;
    if (!currentCompanion) {
      companionEvent = await createMissingBookingCompanion({
        publicEvent,
        bookingNonce,
        targetMember: input.targetMember,
      });
    } else if (
      normalizedCalendarId(currentCompanion.member.calendarId) ===
      normalizedCalendarId(input.targetMember.calendarId)
    ) {
      companionEvent = currentCompanion.event;
    } else {
      if ((currentCompanion.event.attendees || []).length > 0) {
        await patchCalendarEventWithoutUpdates(
          currentCompanion.member.calendarId,
          String(currentCompanion.event.id),
          { attendees: [] },
        );
      }
      companionEvent = await moveCalendarEventWithoutUpdates(
        currentCompanion.member.calendarId,
        String(currentCompanion.event.id),
        input.targetMember.calendarId,
      );
    }

    companionEvent = await patchCalendarEventWithoutUpdates(
      input.targetMember.calendarId,
      String(companionEvent.id),
      {
        attendees: [],
        extendedProperties: {
          private: {
            ...(companionEvent.extendedProperties?.private || {}),
            assignedMemberId: input.targetMember.id,
            assignedMemberEmail: input.targetMember.email,
            [PRIVATE_BOOKING_COMPANION_KEY]: PRIVATE_BOOKING_COMPANION_VALUE,
          },
        },
      },
    );
  }

  publicEvent = await patchCalendarEventWithoutUpdates(
    publicCalendarId,
    String(publicEvent.id),
    {
      extendedProperties: {
        private: {
          ...(publicEvent.extendedProperties?.private || {}),
          assignedMemberId: input.targetMember.id,
          assignedMemberEmail: input.targetMember.email,
          [PRIVATE_BOOKING_COMPANION_KEY]: PRIVATE_BOOKING_PUBLIC_VALUE,
        },
      },
    },
  );

  await upsertTeamMirrorEvent({
    event: publicEvent,
    member: { ...input.targetMember, calendarId: publicCalendarId },
    existing: input.mirror,
  });
  const updatedMirror = await getCalendarEvent(
    getVisioSharedCalendarId(),
    String(input.mirror.id),
  );
  if (!updatedMirror) throw new Error("visio_team_assignment_mirror_missing");
  await cancelDuplicateAppointmentMirrors(String(updatedMirror.id), updatedMirror);
  return updatedMirror;
}

async function reassignCalendarAppointment(input: {
  mirror: GoogleCalendarEvent;
  targetMember: VisioTeamMember;
}) {
  const properties = input.mirror.extendedProperties?.private || {};
  let sourceCalendarId = String(properties.sourceCalendarId || "").trim();
  let sourceEventId = String(properties.sourceEventId || "").trim();
  if (!sourceCalendarId || !sourceEventId) {
    throw new Error("visio_team_assignment_source_missing");
  }

  let sourceEvent = await getCalendarEvent(sourceCalendarId, sourceEventId);
  if (sourceEvent && sourceEvent.status !== "cancelled") {
    const organizerCalendarId = String(sourceEvent.organizer?.email || "").trim();
    const organizerMember = managedMemberForAddress(organizerCalendarId);
    if (
      organizerMember &&
      normalizedCalendarId(organizerMember.calendarId) !==
        normalizedCalendarId(sourceCalendarId)
    ) {
      const organizerEvent = await getCalendarEvent(
        organizerMember.calendarId,
        sourceEventId,
      );
      if (organizerEvent && organizerEvent.status !== "cancelled") {
        sourceCalendarId = organizerMember.calendarId;
        sourceEventId = String(organizerEvent.id || sourceEventId);
        sourceEvent = organizerEvent;
      } else {
        // The attendee copy still exists but the former source reference no
        // longer points at the organizer copy. Fall back to the stable
        // appointment identity below instead of trying to move an attendee.
        sourceEvent = null;
      }
    } else if (organizerCalendarId && !organizerMember) {
      throw new Error("visio_team_assignment_external_organizer");
    }
  }

  if (!sourceEvent || sourceEvent.status === "cancelled") {
    const referenceIdentity = appointmentIdentity(input.mirror);
    const startMs = eventStartMs(input.mirror);
    if (startMs) {
      for (const member of getVisioTeamMembers()) {
        let candidates: GoogleCalendarEvent[] = [];
        try {
          candidates = await listGoogleCalendarEvents({
            calendarId: member.calendarId,
            timeMin: new Date(startMs - 24 * 60 * 60_000),
            timeMax: new Date(startMs + 24 * 60 * 60_000),
            showDeleted: false,
          });
        } catch (error) {
          if (
            error instanceof Error &&
            (error.message.startsWith("visio_google_api_failed:403:") ||
              error.message.startsWith("visio_google_api_failed:404:"))
          ) {
            continue;
          }
          throw error;
        }
        const recovered = candidates.find(
          (event) =>
            Boolean(event.id) &&
            event.status !== "cancelled" &&
            eventOrganizerMatchesMember(event, member) &&
            appointmentIdentity(event) === referenceIdentity,
        );
        if (recovered?.id) {
          sourceCalendarId = member.calendarId;
          sourceEventId = recovered.id;
          sourceEvent = recovered;
          break;
        }
      }
    }
  }

  if (!sourceEvent || sourceEvent.status === "cancelled") {
    throw new Error("visio_team_assignment_source_missing");
  }

  const sourceMember = managedMemberForAddress(sourceCalendarId);
  if (!sourceMember) {
    throw new Error("visio_team_assignment_external_organizer");
  }

  const externalAttendees = teamCalendarExternalAttendees(
    sourceEvent,
    getVisioManagedCalendarAddresses(),
  );
  let movedEvent = sourceEvent;
  if (
    normalizedCalendarId(sourceCalendarId) !==
    normalizedCalendarId(input.targetMember.calendarId)
  ) {
    // Remove every internal attendee copy before changing the organizer. This
    // prevents the same Meet from remaining visible in both the former owner
    // and the new owner's calendars. External guests (the professional) stay.
    sourceEvent = await patchCalendarEventWithoutUpdates(
      sourceCalendarId,
      sourceEventId,
      { attendees: externalAttendees },
    );
    movedEvent = await moveCalendarEventWithoutUpdates(
      sourceCalendarId,
      String(sourceEvent.id || sourceEventId),
      input.targetMember.calendarId,
    );
  }
  movedEvent = await patchCalendarEventWithoutUpdates(
    input.targetMember.calendarId,
    String(movedEvent.id),
    {
      attendees: externalAttendees,
      extendedProperties: {
        private: {
          ...(movedEvent.extendedProperties?.private || {}),
          assignedMemberId: input.targetMember.id,
          assignedMemberEmail: input.targetMember.email,
        },
      },
    },
  );

  await upsertTeamMirrorEvent({
    event: movedEvent,
    member: input.targetMember,
    existing: input.mirror,
  });
  const updatedMirror = await getCalendarEvent(
    getVisioSharedCalendarId(),
    String(input.mirror.id),
  );
  if (!updatedMirror) throw new Error("visio_team_assignment_mirror_missing");
  await cancelDuplicateAppointmentMirrors(String(updatedMirror.id), updatedMirror);
  return updatedMirror;
}

type TimedEventSchedule = {
  previousStart: string;
  previousEnd: string;
  start: NonNullable<GoogleCalendarEvent["start"]>;
  end: NonNullable<GoogleCalendarEvent["end"]>;
  changed: boolean;
};

function buildTimedEventSchedule(
  event: GoogleCalendarEvent,
  newStart: Date,
): TimedEventSchedule {
  if (event.start?.date || event.end?.date) {
    throw new Error("visio_team_reschedule_all_day");
  }
  const previousStartDate = new Date(String(event.start?.dateTime || ""));
  const previousEndDate = new Date(String(event.end?.dateTime || ""));
  const previousStartMs = previousStartDate.getTime();
  const previousEndMs = previousEndDate.getTime();
  if (
    !Number.isFinite(previousStartMs) ||
    !Number.isFinite(previousEndMs) ||
    previousEndMs <= previousStartMs ||
    !Number.isFinite(newStart.getTime())
  ) {
    throw new Error("visio_team_reschedule_invalid");
  }

  const newEnd = new Date(newStart.getTime() + previousEndMs - previousStartMs);
  return {
    previousStart: previousStartDate.toISOString(),
    previousEnd: previousEndDate.toISOString(),
    start: {
      dateTime: newStart.toISOString(),
      timeZone: event.start?.timeZone || VISIO_BOOKING_TIMEZONE,
    },
    end: {
      dateTime: newEnd.toISOString(),
      timeZone: event.end?.timeZone || VISIO_BOOKING_TIMEZONE,
    },
    changed: previousStartMs !== newStart.getTime(),
  };
}

function eventWithSchedule(
  event: GoogleCalendarEvent,
  schedule: Pick<TimedEventSchedule, "start" | "end">,
): GoogleCalendarEvent {
  return { ...event, start: schedule.start, end: schedule.end };
}

async function stageRescheduledMirror(input: {
  mirror: GoogleCalendarEvent;
  sourceEvent: GoogleCalendarEvent;
  member: VisioTeamMember;
  schedule: TimedEventSchedule;
}) {
  await upsertTeamMirrorEvent({
    event: eventWithSchedule(input.sourceEvent, input.schedule),
    member: input.member,
    existing: input.mirror,
  });
  const updatedMirror = await getCalendarEvent(
    getVisioSharedCalendarId(),
    String(input.mirror.id),
  );
  if (!updatedMirror) throw new Error("visio_team_assignment_mirror_missing");
  return updatedMirror;
}

async function restoreMirrorSchedule(input: {
  mirror: GoogleCalendarEvent;
  sourceEvent: GoogleCalendarEvent;
  member: VisioTeamMember;
}) {
  try {
    const currentMirror = await getCalendarEvent(
      getVisioSharedCalendarId(),
      String(input.mirror.id),
    );
    await upsertTeamMirrorEvent({
      event: input.sourceEvent,
      member: input.member,
      existing: currentMirror || input.mirror,
    });
  } catch (error) {
    console.error(
      "[visio-booking][team-reschedule-mirror-rollback]",
      error instanceof Error ? error.message : "rollback_failed",
    );
  }
}

async function restoreEventSchedule(input: {
  calendarId: string;
  event: GoogleCalendarEvent;
}) {
  if (!input.event.id || !input.event.start || !input.event.end) return;
  try {
    await patchCalendarEventWithoutUpdates(input.calendarId, input.event.id, {
      start: input.event.start,
      end: input.event.end,
    });
  } catch (error) {
    console.error(
      "[visio-booking][team-reschedule-source-rollback]",
      error instanceof Error ? error.message : "rollback_failed",
    );
  }
}

async function rescheduleAutomaticBooking(input: {
  mirror: GoogleCalendarEvent;
  member: VisioTeamMember;
  newStart: Date;
}) {
  const properties = input.mirror.extendedProperties?.private || {};
  const bookingNonce = String(properties.bookingNonce || "").trim();
  if (!bookingNonce) throw new Error("visio_team_assignment_booking_nonce_missing");

  if (
    properties[PRIVATE_BOOKING_SINGLE_EVENT_KEY] ===
      PRIVATE_BOOKING_SINGLE_EVENT_VALUE &&
    input.mirror.id
  ) {
    const schedule = buildTimedEventSchedule(input.mirror, input.newStart);
    if (!schedule.changed) {
      return { mirror: input.mirror, ...schedule, googleUpdatesRequested: false };
    }
    const master = await patchCalendarEventWithUpdates(
      getVisioSharedCalendarId(),
      input.mirror.id,
      { start: schedule.start, end: schedule.end },
    );
    return { mirror: master, ...schedule, googleUpdatesRequested: true };
  }

  const publicCalendarId = getVisioPublicCalendarId();
  const publicEventId =
    normalizedCalendarId(properties.sourceCalendarId) ===
      normalizedCalendarId(publicCalendarId) && properties.sourceEventId
      ? String(properties.sourceEventId)
      : bookingEventId(bookingNonce);
  const publicEvent = await getCalendarEvent(publicCalendarId, publicEventId);
  if (
    !publicEvent?.id ||
    publicEvent.status === "cancelled" ||
    publicEvent.extendedProperties?.private?.bookingNonce !== bookingNonce
  ) {
    throw new Error("visio_team_assignment_public_event_missing");
  }

  const schedule = buildTimedEventSchedule(publicEvent, input.newStart);
  if (!schedule.changed) {
    return { mirror: input.mirror, ...schedule, googleUpdatesRequested: false };
  }

  const memberUsesPublicCalendar =
    normalizedCalendarId(input.member.calendarId) ===
    normalizedCalendarId(publicCalendarId);
  const companions = memberUsesPublicCalendar
    ? []
    : (await findBookingCompanions(bookingNonce)).filter(
        (match) =>
          normalizedCalendarId(match.member.calendarId) ===
            normalizedCalendarId(input.member.calendarId) &&
          eventOrganizerMatchesMember(match.event, match.member),
      );
  let stagedMirror: GoogleCalendarEvent | null = null;
  try {
    for (const companion of companions) {
      if (!companion.event.id) continue;
      await patchCalendarEventWithoutUpdates(
        companion.member.calendarId,
        companion.event.id,
        { start: schedule.start, end: schedule.end },
      );
    }

    stagedMirror = await stageRescheduledMirror({
      mirror: input.mirror,
      sourceEvent: publicEvent,
      member: { ...input.member, calendarId: publicCalendarId },
      schedule,
    });

    await patchCalendarEventWithUpdates(publicCalendarId, publicEvent.id, {
      start: schedule.start,
      end: schedule.end,
    });
  } catch (error) {
    for (const companion of companions) {
      await restoreEventSchedule({
        calendarId: companion.member.calendarId,
        event: companion.event,
      });
    }
    await restoreMirrorSchedule({
      mirror: stagedMirror || input.mirror,
      sourceEvent: publicEvent,
      member: { ...input.member, calendarId: publicCalendarId },
    });
    throw error;
  }

  await cancelDuplicateAppointmentMirrors(
    String(stagedMirror.id),
    stagedMirror,
  ).catch((error: unknown) => {
    console.error(
      "[visio-booking][team-reschedule-duplicate-cleanup]",
      error instanceof Error ? error.message : "cleanup_failed",
    );
  });
  return { mirror: stagedMirror, ...schedule, googleUpdatesRequested: true };
}

async function rescheduleCalendarAppointment(input: {
  mirror: GoogleCalendarEvent;
  member: VisioTeamMember;
  newStart: Date;
}) {
  const properties = input.mirror.extendedProperties?.private || {};
  const sourceCalendarId = String(properties.sourceCalendarId || "").trim();
  const sourceEventId = String(properties.sourceEventId || "").trim();
  if (!sourceCalendarId || !sourceEventId) {
    throw new Error("visio_team_assignment_source_missing");
  }
  const sourceEvent = await getCalendarEvent(sourceCalendarId, sourceEventId);
  if (!sourceEvent?.id || sourceEvent.status === "cancelled") {
    throw new Error("visio_team_assignment_source_missing");
  }
  if (!eventOrganizerMatchesMember(sourceEvent, input.member)) {
    throw new Error("visio_team_assignment_external_organizer");
  }

  const schedule = buildTimedEventSchedule(sourceEvent, input.newStart);
  if (!schedule.changed) {
    return { mirror: input.mirror, ...schedule, googleUpdatesRequested: false };
  }

  let stagedMirror: GoogleCalendarEvent | null = null;
  try {
    stagedMirror = await stageRescheduledMirror({
      mirror: input.mirror,
      sourceEvent,
      member: input.member,
      schedule,
    });
    await patchCalendarEventWithUpdates(sourceCalendarId, sourceEvent.id, {
      start: schedule.start,
      end: schedule.end,
    });
  } catch (error) {
    await restoreMirrorSchedule({
      mirror: stagedMirror || input.mirror,
      sourceEvent,
      member: input.member,
    });
    throw error;
  }

  await cancelDuplicateAppointmentMirrors(
    String(stagedMirror.id),
    stagedMirror,
  ).catch((error: unknown) => {
    console.error(
      "[visio-booking][team-reschedule-duplicate-cleanup]",
      error instanceof Error ? error.message : "cleanup_failed",
    );
  });
  return { mirror: stagedMirror, ...schedule, googleUpdatesRequested: true };
}

async function recordVisioTeamReassignment(input: {
  actor: VisioTeamReassignmentActor;
  mirrorId: string;
  previousMemberId: string;
  targetMemberId: string;
  sourceType: "booking" | "calendar";
}) {
  const { error } = await supabaseAdmin.from("app_events").insert({
    user_id: input.actor.userId,
    module: "visio_booking_admin",
    type: "appointment_reassigned",
    payload: {
      mirrorEventId: input.mirrorId,
      previousMemberId: input.previousMemberId,
      targetMemberId: input.targetMemberId,
      sourceType: input.sourceType,
      actorEmail: input.actor.email,
      actorName: input.actor.name,
      notificationsSent: false,
      reassignedAt: new Date().toISOString(),
    },
  });
  if (error) {
    console.error("[visio-booking][team-reassignment-audit]", error.message);
  }
}

async function recordVisioTeamReschedule(input: {
  actor: VisioTeamReassignmentActor;
  mirrorId: string;
  memberId: string;
  sourceType: "booking" | "calendar";
  previousStart: string;
  previousEnd: string;
  newStart: string;
  newEnd: string;
  googleUpdatesRequested: boolean;
}) {
  const { error } = await supabaseAdmin.from("app_events").insert({
    user_id: input.actor.userId,
    module: "visio_booking_admin",
    type: "appointment_rescheduled",
    payload: {
      mirrorEventId: input.mirrorId,
      memberId: input.memberId,
      sourceType: input.sourceType,
      previousStart: input.previousStart,
      previousEnd: input.previousEnd,
      newStart: input.newStart,
      newEnd: input.newEnd,
      actorEmail: input.actor.email,
      actorName: input.actor.name,
      googleUpdatesRequested: input.googleUpdatesRequested,
      rescheduledAt: new Date().toISOString(),
    },
  });
  if (error) {
    console.error("[visio-booking][team-reschedule-audit]", error.message);
  }
}

export async function reassignVisioTeamAppointment(input: {
  mirrorEventId: string;
  appointmentIdentity?: string;
  appointmentStart?: string;
  targetMemberId: string;
  actor: VisioTeamReassignmentActor;
}): Promise<VisioTeamReassignmentResult> {
  const mirrorEventId = String(input.mirrorEventId || "").trim();
  const targetMember = getVisioTeamMembers().find(
    (member) => member.id === String(input.targetMemberId || "").trim(),
  );
  if (!mirrorEventId || !targetMember) {
    throw new Error("visio_team_assignment_invalid");
  }

  const calendarMutationLock = await acquireTeamCalendarSyncLock();
  if (!calendarMutationLock.acquired) {
    throw new Error("visio_team_assignment_sync_busy");
  }
  try {
    const mirror = await resolveActiveTeamAppointmentMirror({
      mirrorEventId,
      identity: input.appointmentIdentity,
      start: input.appointmentStart,
    });
    if (!mirror?.id) {
      throw new Error("visio_team_assignment_mirror_missing");
    }
    const activeMirrorEventId = mirror.id;
    const lockIdentity = createHash("sha256")
      .update(String(input.appointmentIdentity || activeMirrorEventId), "utf8")
      .digest("hex")
      .slice(0, 32);
    const lock = await acquireBookingLock(`reassign:${lockIdentity}`);
    try {
      const previousMemberId = memberForMirrorEvent(mirror)?.id || "";
      const isBooking =
        mirror.extendedProperties?.private?.[PRIVATE_BOOKING_KEY] ===
        PRIVATE_BOOKING_VALUE;
      const updatedMirror = isBooking
        ? await reassignAutomaticBooking({ mirror, targetMember })
        : await reassignCalendarAppointment({ mirror, targetMember });
      const appointment = teamAppointmentFromMirror(updatedMirror);
      if (!appointment) throw new Error("visio_team_assignment_mirror_missing");

      await recordVisioTeamReassignment({
        actor: input.actor,
        mirrorId: activeMirrorEventId,
        previousMemberId,
        targetMemberId: targetMember.id,
        sourceType: isBooking ? "booking" : "calendar",
      });
      return {
        appointment,
        previousMemberId,
        targetMemberId: targetMember.id,
        publicOrganizerPreserved: isBooking,
        notificationsSent: false,
      };
    } finally {
      await lock.release().catch(() => undefined);
    }
  } finally {
    await calendarMutationLock.release().catch(() => undefined);
  }
}

export async function rescheduleVisioTeamAppointment(input: {
  mirrorEventId: string;
  appointmentIdentity?: string;
  appointmentStart?: string;
  newStartLocal: string;
  actor: VisioTeamReassignmentActor;
}): Promise<VisioTeamRescheduleResult> {
  const mirrorEventId = String(input.mirrorEventId || "").trim();
  const newStart = parseLocalDateTime(input.newStartLocal);
  if (!mirrorEventId || !newStart) {
    throw new Error("visio_team_reschedule_invalid");
  }

  const calendarMutationLock = await acquireTeamCalendarSyncLock();
  if (!calendarMutationLock.acquired) {
    throw new Error("visio_team_assignment_sync_busy");
  }
  try {
    const mirror = await resolveActiveTeamAppointmentMirror({
      mirrorEventId,
      identity: input.appointmentIdentity,
      start: input.appointmentStart,
    });
    if (!mirror?.id) {
      throw new Error("visio_team_assignment_mirror_missing");
    }

    const activeMirrorEventId = mirror.id;
    const lockIdentity = createHash("sha256")
      .update(String(input.appointmentIdentity || activeMirrorEventId), "utf8")
      .digest("hex")
      .slice(0, 32);
    const lock = await acquireBookingLock(`reschedule:${lockIdentity}`);
    try {
      const member = memberForMirrorEvent(mirror);
      if (!member) throw new Error("visio_team_assignment_invalid");
      const isBooking =
        mirror.extendedProperties?.private?.[PRIVATE_BOOKING_KEY] ===
        PRIVATE_BOOKING_VALUE;

      // Re-apply the current assignee first. Besides keeping exactly one owner,
      // this repairs legacy attendee copies and stale source references before
      // any date change is staged.
      const normalizedMirror = isBooking
        ? await reassignAutomaticBooking({ mirror, targetMember: member })
        : await reassignCalendarAppointment({ mirror, targetMember: member });
      const result = isBooking
        ? await rescheduleAutomaticBooking({
            mirror: normalizedMirror,
            member,
            newStart,
          })
        : await rescheduleCalendarAppointment({
            mirror: normalizedMirror,
            member,
            newStart,
          });
      const appointment = teamAppointmentFromMirror(result.mirror);
      if (!appointment) throw new Error("visio_team_assignment_mirror_missing");

      await recordVisioTeamReschedule({
        actor: input.actor,
        mirrorId: activeMirrorEventId,
        memberId: member.id,
        sourceType: isBooking ? "booking" : "calendar",
        previousStart: result.previousStart,
        previousEnd: result.previousEnd,
        newStart: appointment.start,
        newEnd: appointment.end,
        googleUpdatesRequested: result.googleUpdatesRequested,
      });
      return {
        appointment,
        previousStart: result.previousStart,
        previousEnd: result.previousEnd,
        googleUpdatesRequested: result.googleUpdatesRequested,
      };
    } finally {
      await lock.release().catch(() => undefined);
    }
  } finally {
    await calendarMutationLock.release().catch(() => undefined);
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
