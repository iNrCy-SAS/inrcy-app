import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { Redis } from "@upstash/redis";

import { encryptToken, tryDecryptToken } from "@/lib/oauthCrypto";
import { optionalEnv, requireEnv } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendMonitoringMail } from "@/lib/txMailer";
import {
  TEAM_CALENDAR_MIRROR_KEY,
  TEAM_CALENDAR_MIRROR_VALUE,
  buildTeamCalendarMirrorBody,
  isPendingSignupReminderForProspect,
  pendingSignupReminderProspectUserId,
  shouldMirrorTeamCalendarEvent,
  teamCalendarEventMeetUrl,
  teamCalendarMirrorContentSignature,
  teamCalendarMirrorSourceKey,
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
        meetUrl: teamCalendarEventMeetUrl(event),
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

async function listSharedCalendarEvents(
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

async function removePendingSignupRemindersForProspect(
  claims: VisioBookingClaims,
) {
  const signupTime = new Date(claims.iat * 1_000);
  const timeMin = new Date(signupTime.getTime() - 24 * 60 * 60_000);
  const timeMax = new Date(signupTime.getTime() + 24 * 60 * 60_000);
  const events = await listSharedCalendarEvents(timeMin, timeMax, false);
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
    const sharedEvents = await listSharedCalendarEvents(timeMin, timeMax);
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

    for (const member of getVisioTeamMembers()) {
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
          const outcome = await upsertTeamMirrorEvent({
            event,
            member,
            existing: existingMirror,
          });
          result[outcome] += 1;
        } catch (error) {
          result.errors.push({ memberId: member.id, code: visioGoogleErrorCode(error) });
        }
      }

      for (const mirror of mirrors) {
        const properties = mirror.extendedProperties?.private || {};
        if (properties.assignedMemberId !== member.id || mirror.status === "cancelled") {
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

async function getExistingBooking(eventId: string) {
  const sharedEvent = await getCalendarEvent(getVisioSharedCalendarId(), eventId);
  if (sharedEvent && sharedEvent.status !== "cancelled") return sharedEvent;

  for (const member of getVisioTeamMembers()) {
    try {
      const event = await getCalendarEvent(member.calendarId, eventId);
      if (
        event &&
        event.status !== "cancelled" &&
        event.extendedProperties?.private?.[PRIVATE_BOOKING_COMPANION_KEY] !==
          PRIVATE_BOOKING_COMPANION_VALUE
      ) {
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
    `Interlocuteur iNrCy : ${PUBLIC_BOOKING_ASSIGNEE}`,
    "Source : inscription validée sur inrcy.com",
  ].filter(Boolean);

  const privateProperties = {
    [PRIVATE_BOOKING_KEY]: PRIVATE_BOOKING_VALUE,
    bookingNonce: input.claims.nonce,
    prospectUserId: input.claims.sub,
    assignedMemberId: input.member.id,
    assignedMemberEmail: input.member.email,
  };

  const baseBody = {
    id: input.eventId,
    summary: `Présentation iNrCy — ${prospect.company || prospect.name}`,
    description: contactLines.join("\n"),
    location: "Google Meet",
    colorId: optionalEnv("INRCY_VISIO_BOOKED_COLOR_ID", "9"),
    visibility: "private",
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
  };

  let event: GoogleCalendarEvent;
  let createdPublicEvent = true;
  try {
    let memberEvent: GoogleCalendarEvent;
    try {
      memberEvent = await googleCalendarRequest<GoogleCalendarEvent>(
        `/calendars/${encodeCalendarId(input.member.calendarId)}/events?conferenceDataVersion=1&sendUpdates=none`,
        {
          method: "POST",
          body: JSON.stringify({
            ...baseBody,
            description: [
              ...contactLines,
              `Responsable interne : ${input.member.name}`,
            ].join("\n"),
            conferenceData: {
              createRequest: {
                requestId: conferenceRequestId(input.claims.nonce),
                conferenceSolutionKey: { type: "hangoutsMeet" },
              },
            },
            extendedProperties: {
              private: {
                ...privateProperties,
                [PRIVATE_BOOKING_COMPANION_KEY]:
                  PRIVATE_BOOKING_COMPANION_VALUE,
              },
            },
          }),
        },
      );
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.startsWith("visio_google_api_failed:409:")
      ) {
        const existingMemberEvent = await getCalendarEvent(
          input.member.calendarId,
          input.eventId,
        );
        if (!existingMemberEvent) throw new Error("visio_booking_cancelled");
        assertMatchingBookingEvent(existingMemberEvent, input.claims);
        memberEvent = existingMemberEvent;
      } else {
        throw error;
      }
    }

    memberEvent = await waitForMeetConference(
      input.member.calendarId,
      input.eventId,
      memberEvent,
    );
    event = await googleCalendarRequest<GoogleCalendarEvent>(
      `/calendars/${encodeCalendarId(getVisioSharedCalendarId())}/events?conferenceDataVersion=1&sendUpdates=all`,
      {
        method: "POST",
        body: JSON.stringify({
          ...baseBody,
          conferenceData: memberEvent.conferenceData,
          attendees: [{ email: prospect.email, displayName: prospect.name }],
        }),
      },
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("visio_google_api_failed:409:")
    ) {
      const existingSharedEvent = await getCalendarEvent(
        getVisioSharedCalendarId(),
        input.eventId,
      );
      if (!existingSharedEvent) throw new Error("visio_booking_cancelled");
      assertMatchingBookingEvent(existingSharedEvent, input.claims);
      event = existingSharedEvent;
      createdPublicEvent = false;
    } else if (
      error instanceof Error &&
      (error.message.startsWith("visio_google_api_failed:403:") ||
        error.message.startsWith("visio_google_api_failed:404:"))
    ) {
      console.warn(
        `[visio-booking] agenda personnel ${input.member.id} non modifiable; repli sur l’agenda partagé`,
      );
      event = await googleCalendarRequest<GoogleCalendarEvent>(
        `/calendars/${encodeCalendarId(getVisioSharedCalendarId())}/events?conferenceDataVersion=1&sendUpdates=all`,
        {
          method: "POST",
          body: JSON.stringify({
            ...baseBody,
            conferenceData: {
              createRequest: {
                requestId: conferenceRequestId(input.claims.nonce),
                conferenceSolutionKey: { type: "hangoutsMeet" },
              },
            },
            attendees: [
              { email: input.member.email, displayName: PUBLIC_BOOKING_ASSIGNEE },
              { email: prospect.email, displayName: prospect.name },
            ],
          }),
        },
      );
    } else {
      throw error;
    }
  }

  const confirmation = confirmationFromEvent(event, input.start);
  if (createdPublicEvent) {
    await sendMonitoringMail({
      to: getInternalAlertRecipients("INRCY_VISIO_BOOKING_ALERT_EMAIL"),
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
    const existing = await getExistingBooking(eventId);
    if (existing) {
      return finalizeBookedVisio(
        claims,
        confirmationFromEvent(existing, start),
      );
    }
    const slotLock = await acquireBookingLock(`slot:${start.toISOString()}`);
    try {
      const existingAfterLock = await getExistingBooking(eventId);
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
      const [busyByCalendar, events] = await Promise.all([
        readFreeBusy(members, start, spacingEnd),
        listAllBookingEvents(loadRangeStart, loadRangeEnd),
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
        const confirmation = await createGoogleBookingEvent({
          eventId,
          start,
          member,
          claims,
        });
        return finalizeBookedVisio(claims, confirmation);
      } catch (error) {
        if (
          error instanceof Error &&
          error.message.startsWith("visio_google_api_failed:409:")
        ) {
          const racedEvent = await getExistingBooking(eventId);
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

export const VISIO_BOOKING_GOOGLE_SCOPES = [
  "https://www.googleapis.com/auth/calendar.events",
  "https://www.googleapis.com/auth/calendar.freebusy",
  "https://www.googleapis.com/auth/userinfo.email",
] as const;

export const VISIO_BOOKING_INTEGRATION = {
  source: INTEGRATION_SOURCE,
  product: INTEGRATION_PRODUCT,
} as const;
