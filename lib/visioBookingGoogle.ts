import "server-only";

import { createHash, randomUUID } from "node:crypto";

import { Redis } from "@upstash/redis";

import { encryptToken, tryDecryptToken } from "@/lib/oauthCrypto";
import { optionalEnv, requireEnv } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendMonitoringMail, sendTxMail } from "@/lib/txMailer";
import {
  acquireExecutionIdempotencyLock,
  completeExecutionIdempotencyLockOrThrow,
} from "@/lib/executionIdempotency";
import {
  buildPendingSignupCalendarContent,
  buildVisioAppointmentCalendarContent,
  buildPublicVisioBookingContent,
  buildSingleAssigneeVisioAttendees,
  readVisioAppointmentPublicDetails,
} from "@/lib/visioBookingEventPolicy";
import {
  VISIO_APPOINTMENT_ORIGIN_KEY,
  VISIO_APPOINTMENT_STATUS_KEY,
  VISIO_APPOINTMENT_STATUS_LABELS,
  VISIO_APPOINTMENT_STATUSES,
  canManuallyTransitionVisioAppointment,
  cancellationStatusFor,
  isVisioAppointmentOrigin,
  isVisioAppointmentStatus,
  lifecyclePrivateProperties,
  scheduledStatusForOrigin,
  visioAppointmentColorId,
  visioAppointmentOriginForStatus,
  visioAppointmentStatusAfterColorChange,
  type VisioAppointmentOrigin,
  type VisioAppointmentStatus,
} from "@/lib/visioAppointmentLifecycle";
import {
  canonicalVisioAppointmentIdentity,
  sharedVisioMirrorDeduplicationIdentity,
} from "@/lib/visioAppointmentIdentity";
import {
  VISIO_BOOKING_MANUAL_RESEND_LOCK_TTL_MS,
  VISIO_BOOKING_MANUAL_RESEND_SCOPE,
  buildVisioBookingLinkMail,
  buildVisioBookingManualResendKey,
  visioBookingManualResendFingerprint,
} from "@/lib/visioBookingDeliveryPolicy";
import {
  PENDING_SIGNUP_ASSIGNMENT_KEY,
  PENDING_SIGNUP_ASSIGNMENT_VALUE,
  TEAM_CALENDAR_MIRROR_KEY,
  TEAM_CALENDAR_MIRROR_VALUE,
  buildTeamCalendarMirrorBody,
  hasAutomaticGoogleCalendarReminders,
  isPendingSignupReminderForProspect,
  pendingSignupReminderProspectUserId,
  shouldMirrorTeamCalendarEvent,
  teamCalendarExternalAttendees,
  teamCalendarEventMeetUrl,
  teamCalendarMirrorContentSignature,
  teamCalendarReplicaReconciliationDecision,
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
const PRIVATE_CALENDAR_REPLICA_KEY = "inrcyCalendarReplica";
const PRIVATE_CALENDAR_REPLICA_VALUE = "v1";
const PRIVATE_CANONICAL_EVENT_ID_KEY = "inrcyCanonicalEventId";
const PRIVATE_REPLICA_FINGERPRINT_KEY = "inrcyReplicaFingerprint";
const PRIVATE_LOGICAL_APPOINTMENT_KEY = "inrcyLogicalAppointmentId";
const PUBLIC_BOOKING_ASSIGNEE = "Équipe iNrCy";
const REQUIRED_INTERNAL_ALERT_EMAIL = "compte@inrcy.com";
const TEAM_MIRROR_DEFAULT_PAST_DAYS = 30;
const TEAM_MIRROR_DEFAULT_FUTURE_DAYS = 365;
const BOOKING_LOCK_TTL_SECONDS = 120;
const TEAM_CALENDAR_MUTATION_LOCK_WAIT_MS = 8_000;
const TEAM_CALENDAR_MUTATION_LOCK_RETRY_MS = 250;
const MANAGED_REPLICA_CREATE_CONCURRENCY = 6;
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
  reconciliation: {
    canonicalCacheHits: number;
    canonicalFetches: number;
    replicaFanouts: number;
    missingReplicaChecks: number;
  };
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
  status: VisioAppointmentStatus;
  statusLabel: string;
  colorId: string;
  origin: VisioAppointmentOrigin;
  managedLifecycle: boolean;
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

export type VisioTeamStatusResult = {
  appointment: VisioTeamAppointment;
  previousStatus: VisioAppointmentStatus;
  status: VisioAppointmentStatus;
  notificationsSent: false;
};

export type VisioBookingManualResendResult = {
  appointment: VisioTeamAppointment;
  sent: true;
  idempotent: boolean;
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

async function cancelDuplicatePendingSignupReminders(
  events: GoogleCalendarEvent[],
) {
  const canonicalByProspect = new Map<string, GoogleCalendarEvent>();
  let cancelled = 0;

  for (const event of events) {
    const prospectUserId = pendingSignupReminderProspectUserId(event);
    if (!prospectUserId) continue;
    const current = canonicalByProspect.get(prospectUserId);
    if (!current) {
      canonicalByProspect.set(prospectUserId, event);
      continue;
    }

    const keepCurrent =
      String(current.updated || "") > String(event.updated || "") ||
      (String(current.updated || "") === String(event.updated || "") &&
        String(current.id || "") < String(event.id || ""));
    const duplicate = keepCurrent ? event : current;
    const canonical = keepCurrent ? current : event;
    if (await cancelSharedCalendarEvent(duplicate)) {
      duplicate.status = "cancelled";
      cancelled += 1;
    }
    canonicalByProspect.set(prospectUserId, canonical);
  }

  return cancelled;
}

function preferredActiveAppointmentMirrors(
  events: GoogleCalendarEvent[],
) {
  const preferred = new Map<string, GoogleCalendarEvent>();
  for (const event of events) {
    if (
      !event.id ||
      event.status === "cancelled" ||
      event.extendedProperties?.private?.[TEAM_CALENDAR_MIRROR_KEY] !==
        TEAM_CALENDAR_MIRROR_VALUE
    ) {
      continue;
    }
    const identity = sharedVisioMirrorDeduplicationIdentity(event);
    const current = preferred.get(identity);
    if (!current || shouldPreferAppointmentMirror(event, current)) {
      preferred.set(identity, event);
    }
  }
  return preferred;
}

async function isCalendarSourceActive(sourceKey: string) {
  const [calendarId, eventId] = sourceKey.split("\n");
  if (!calendarId || !eventId) return false;
  const event = await getCalendarEvent(calendarId, eventId);
  return Boolean(event && event.status !== "cancelled");
}

async function reconcileSharedAppointmentDuplicates(
  timeMin: Date,
  timeMax: Date,
) {
  const events = await listVisioSharedCalendarEvents(timeMin, timeMax, false);
  const preferred = preferredActiveAppointmentMirrors(events);
  let cancelled = 0;

  for (const event of events) {
    if (
      !event.id ||
      event.status === "cancelled" ||
      event.extendedProperties?.private?.[TEAM_CALENDAR_MIRROR_KEY] !==
        TEAM_CALENDAR_MIRROR_VALUE
    ) {
      continue;
    }
    const canonical = preferred.get(
      sharedVisioMirrorDeduplicationIdentity(event),
    );
    if (!canonical?.id || canonical.id === event.id) continue;
    if (await cancelSharedCalendarEvent(event)) cancelled += 1;
  }

  return cancelled;
}

async function findPendingSignupReminder(claims: VisioBookingClaims) {
  const signupTime = new Date(claims.iat * 1_000);
  const timeMin = new Date(signupTime.getTime() - 7 * 24 * 60 * 60_000);
  const timeMax = new Date(
    Math.max(Date.now(), signupTime.getTime()) +
      (getVisioBookingHorizonDays() + 7) * 24 * 60 * 60_000,
  );
  const events = await listVisioSharedCalendarEvents(timeMin, timeMax, false);
  return (
    events.find(
      (event) =>
        isPendingSignupReminderForProspect(event, claims.sub) &&
        lifecycleStatusForEvent(event) === "signup_pending",
    ) || null
  );
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
    if (
      !isPendingSignupReminderForProspect(event, claims.sub) ||
      lifecycleStatusForEvent(event) !== "signup_pending"
    ) {
      continue;
    }
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

async function acquireTeamCalendarSyncLock(options?: {
  waitMs?: number;
  retryMs?: number;
}): Promise<TeamCalendarSyncLock> {
  const redis = getBookingRedis();
  const key = "inrcy:visio-booking:team-calendar-sync";
  const value = randomUUID();
  const waitMs = Math.max(0, options?.waitMs || 0);
  const retryMs = Math.max(50, options?.retryMs || 250);
  const deadline = Date.now() + waitMs;
  const waitBeforeRetry = async () => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    await new Promise((resolve) =>
      setTimeout(resolve, Math.min(retryMs, remaining)),
    );
    return true;
  };
  if (!redis) {
    if (process.env.NODE_ENV === "production") {
      throw new Error("visio_team_calendar_sync_lock_unavailable");
    }
    const globalCache = globalThis as typeof globalThis & {
      __inrcy_visio_team_sync_lock?: { value: string; expiresAt: number };
    };
    while (
      globalCache.__inrcy_visio_team_sync_lock &&
      globalCache.__inrcy_visio_team_sync_lock.expiresAt > Date.now()
    ) {
      if (!(await waitBeforeRetry())) {
        return { acquired: false, release: async () => undefined };
      }
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

  let acquired = false;
  while (!acquired) {
    acquired = (await redis.set(key, value, { nx: true, ex: 240 })) === "OK";
    if (acquired || !(await waitBeforeRetry())) break;
  }
  return {
    acquired,
    release: async () => {
      if (acquired) await releaseRedisLock(redis, key, value);
    },
  };
}

function acquireTeamCalendarMutationLock() {
  return acquireTeamCalendarSyncLock({
    waitMs: TEAM_CALENDAR_MUTATION_LOCK_WAIT_MS,
    retryMs: TEAM_CALENDAR_MUTATION_LOCK_RETRY_MS,
  });
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
    reconciliation: {
      canonicalCacheHits: 0,
      canonicalFetches: 0,
      replicaFanouts: 0,
      missingReplicaChecks: 0,
    },
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
    const sharedCalendarId = getVisioSharedCalendarId();

    // An interrupted signup flow used to be able to leave several reminder
    // blocks for the same professional. Keep exactly one before assigning it.
    result.cancelled += await cancelDuplicatePendingSignupReminders(sharedEvents);

    // Repair historical site bookings silently. Older versions attached
    // Google e-mail/popup reminders to the event; keeping this in the minute
    // synchronizer makes the migration self-healing without notifying guests.
    for (let index = 0; index < sharedEvents.length; index += 1) {
      const event = sharedEvents[index];
      if (
        !event.id ||
        event.status === "cancelled" ||
        event.extendedProperties?.private?.[PRIVATE_BOOKING_KEY] !==
          PRIVATE_BOOKING_VALUE ||
        !hasAutomaticGoogleCalendarReminders(event)
      ) {
        continue;
      }
      try {
        sharedEvents[index] = await patchCalendarEventWithoutUpdates(
          sharedCalendarId,
          event.id,
          { reminders: { useDefault: false, overrides: [] } },
        );
        result.updated += 1;
      } catch (error) {
        result.errors.push({
          memberId: "shared",
          code: visioGoogleErrorCode(error),
        });
      }
    }
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
    const canonicalSourceByIdentity = new Map(
      [...preferredActiveAppointmentMirrors(sharedEvents)].flatMap(
        ([identity, mirror]) => {
          const sourceKey = mirrorSourceKey(mirror);
          return sourceKey ? [[identity, sourceKey] as const] : [];
        },
      ),
    );
    const canonicalSourceActive = new Map<string, boolean>();
    const teamMembers = getVisioTeamMembers();
    const memberById = new Map(teamMembers.map((member) => [member.id, member]));
    // Historical mirrors must not weigh several times in the fair-assignment
    // calculation. Count the canonical appointment once, regardless of how
    // many Google copies existed before reconciliation.
    const canonicalAssignmentEvents = new Map<string, GoogleCalendarEvent>();
    for (const event of sharedEvents) {
      if (event.status === "cancelled") continue;
      const identity = sharedVisioMirrorDeduplicationIdentity(event);
      const current = canonicalAssignmentEvents.get(identity);
      if (!current || shouldPreferAppointmentMirror(event, current)) {
        canonicalAssignmentEvents.set(identity, event);
      }
    }
    const assignmentCounts = [...canonicalAssignmentEvents.values()].reduce<
      Record<string, number>
    >(
      (counts, event) => {
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
      if (!prospectUserId || !reminder.id) {
        continue;
      }
      const existingMember = memberById.get(currentMemberId);
      const assignedMember =
        existingMember ||
        [...teamMembers].sort(
          (left, right) =>
            (assignmentCounts[left.id] || 0) -
              (assignmentCounts[right.id] || 0) ||
            left.id.localeCompare(right.id),
        )[0];
      if (!assignedMember) continue;
      const safeContent = buildPendingSignupCalendarContent({
        event: reminder,
        assignedMember,
      });
      const reminderProperties = reminder.extendedProperties?.private || {};
      const pendingStatus: VisioAppointmentStatus =
        reminderProperties[VISIO_APPOINTMENT_STATUS_KEY] ===
        "signup_cancelled"
          ? "signup_cancelled"
          : "signup_pending";
      const pendingLifecycle = lifecyclePrivateProperties({
        status: pendingStatus,
        origin: "signup_without_appointment",
      });
      const needsSanitizing =
        !existingMember ||
        reminder.summary !== safeContent.summary ||
        reminder.description !== safeContent.description ||
        reminder.colorId !== visioAppointmentColorId(pendingStatus) ||
        Boolean(String(reminder.location || "").trim()) ||
        Boolean(reminder.attendees?.length) ||
        hasAutomaticGoogleCalendarReminders(reminder) ||
        reminderProperties[PENDING_SIGNUP_ASSIGNMENT_KEY] !==
          PENDING_SIGNUP_ASSIGNMENT_VALUE ||
        reminderProperties.prospectUserId !== prospectUserId ||
        reminderProperties[VISIO_APPOINTMENT_STATUS_KEY] !== pendingStatus ||
        reminderProperties[VISIO_APPOINTMENT_ORIGIN_KEY] !==
          "signup_without_appointment";
      if (!needsSanitizing) continue;
      try {
        const updatedReminder = await patchCalendarEventWithoutUpdates(
          sharedCalendarId,
          reminder.id,
          {
            ...safeContent,
            colorId: visioAppointmentColorId(pendingStatus),
            attendees: [],
            extendedProperties: {
              private: {
                ...reminderProperties,
                ...pendingLifecycle,
                [PENDING_SIGNUP_ASSIGNMENT_KEY]:
                  PENDING_SIGNUP_ASSIGNMENT_VALUE,
                [TEAM_CALENDAR_MIRROR_KEY]: TEAM_CALENDAR_MIRROR_VALUE,
                [PRIVATE_LOGICAL_APPOINTMENT_KEY]: `prospect:${prospectUserId}`,
                assignedMemberId: assignedMember.id,
                assignedMemberEmail: assignedMember.email,
                prospectUserId,
                sourceCalendarId: sharedCalendarId,
                sourceEventId: reminder.id,
                sourceOrganizerEmail: sharedCalendarId,
                sourceCalendarIsOrganizer: "true",
                sharedCalendarId,
              },
            },
          },
        );
        Object.assign(reminder, updatedReminder);
        if (!existingMember) {
          assignmentCounts[assignedMember.id] =
            (assignmentCounts[assignedMember.id] || 0) + 1;
        }
        result.updated += 1;
      } catch (error) {
        result.errors.push({
          memberId: "shared",
          code: visioGoogleErrorCode(error),
        });
      }
    }

    const managedCalendarIds = getVisioManagedCalendarAddresses();
    const managedCanonicalByReplicaId = new Map<string, GoogleCalendarEvent>();
    const managedCanonicalById = new Map<
      string,
      GoogleCalendarEvent | null
    >();
    for (const canonical of sharedEvents) {
      if (
        canonical.id &&
        canonical.status !== "cancelled" &&
        isManagedLifecycleEvent(canonical)
      ) {
        const replicaId = calendarReplicaEventId(canonical);
        if (replicaId) managedCanonicalByReplicaId.set(replicaId, canonical);
        managedCanonicalById.set(canonical.id, canonical);
      }
    }
    const fullySyncedManagedCanonicalIds = new Set<string>();
    const failedManagedCanonicalIds = new Set<string>();
    const seenManagedReplicaKeys = new Set<string>();
    const successfullyListedMemberIds = new Set<string>();
    const managedReplicaKey = (memberId: string, canonicalEventId: string) =>
      `${memberId}:${canonicalEventId}`;
    const sourceEventsByMemberId = new Map<string, GoogleCalendarEvent[]>();
    for (const member of teamMembers) {
      try {
        const sourceEvents = await listGoogleCalendarEvents({
          calendarId: member.calendarId,
          timeMin,
          timeMax,
          showDeleted: true,
        });
        sourceEventsByMemberId.set(member.id, sourceEvents);
        successfullyListedMemberIds.add(member.id);
      } catch (error) {
        result.errors.push({ memberId: member.id, code: visioGoogleErrorCode(error) });
      }
    }

    // Index every member snapshot before mutating Google. This preserves a
    // tombstone even when another member replica is needed to reveal its
    // canonical, and bounds out-of-window canonical reads to one per id.
    const canonicalIdsToLoad = new Set<string>();
    for (const sourceEvents of sourceEventsByMemberId.values()) {
      for (const event of sourceEvents) {
        const privateProperties = event.extendedProperties?.private || {};
        const canonicalEventId = String(
          privateProperties[PRIVATE_CANONICAL_EVENT_ID_KEY] || "",
        ).trim();
        if (
          privateProperties[PRIVATE_CALENDAR_REPLICA_KEY] ===
            PRIVATE_CALENDAR_REPLICA_VALUE &&
          canonicalEventId
        ) {
          const recoveredCanonical = event.id
            ? managedCanonicalByReplicaId.get(event.id)
            : undefined;
          if (
            recoveredCanonical?.id &&
            logicalAppointmentId(recoveredCanonical) &&
            logicalAppointmentId(recoveredCanonical) === logicalAppointmentId(event)
          ) {
            managedCanonicalById.set(canonicalEventId, recoveredCanonical);
          } else if (!managedCanonicalById.has(canonicalEventId)) {
            canonicalIdsToLoad.add(canonicalEventId);
          }
        }
      }
    }
    await Promise.all(
      [...canonicalIdsToLoad].map(async (canonicalEventId) => {
        result.reconciliation.canonicalFetches += 1;
        try {
          const canonical = await getCalendarEvent(
            sharedCalendarId,
            canonicalEventId,
          );
          managedCanonicalById.set(canonicalEventId, canonical);
          if (canonical?.id && canonical.status !== "cancelled") {
            managedCanonicalById.set(canonical.id, canonical);
            const replicaId = calendarReplicaEventId(canonical);
            if (replicaId) managedCanonicalByReplicaId.set(replicaId, canonical);
          }
        } catch (error) {
          failedManagedCanonicalIds.add(canonicalEventId);
          result.errors.push({
            memberId: "shared",
            code: visioGoogleErrorCode(error),
          });
        }
      }),
    );

    // The parallel reads above can discover a recovered canonical only after
    // another replica already resolved its former canonical id as missing.
    // Re-run the deterministic replica-id aliasing once every read has settled
    // so an old id never restores over the recovered canonical.
    for (const sourceEvents of sourceEventsByMemberId.values()) {
      for (const event of sourceEvents) {
        const privateProperties = event.extendedProperties?.private || {};
        const canonicalEventId = String(
          privateProperties[PRIVATE_CANONICAL_EVENT_ID_KEY] || "",
        ).trim();
        if (
          privateProperties[PRIVATE_CALENDAR_REPLICA_KEY] !==
            PRIVATE_CALENDAR_REPLICA_VALUE ||
          !canonicalEventId
        ) {
          continue;
        }
        const recoveredCanonical = event.id
          ? managedCanonicalByReplicaId.get(event.id)
          : undefined;
        if (
          recoveredCanonical?.id &&
          logicalAppointmentId(recoveredCanonical) &&
          logicalAppointmentId(recoveredCanonical) === logicalAppointmentId(event)
        ) {
          managedCanonicalById.set(canonicalEventId, recoveredCanonical);
          failedManagedCanonicalIds.delete(canonicalEventId);
        }
      }
    }

    for (const member of teamMembers) {
      const sourceEvents = sourceEventsByMemberId.get(member.id);
      if (!sourceEvents) continue;

      const seenSourceKeys = new Set<string>();
      for (const event of sourceEvents) {
        result.scanned += 1;
        const privateProperties = event.extendedProperties?.private || {};
        const replicaCanonicalEventId = String(
          privateProperties[PRIVATE_CANONICAL_EVENT_ID_KEY] || "",
        ).trim();
        if (
          privateProperties[PRIVATE_CALENDAR_REPLICA_KEY] ===
            PRIVATE_CALENDAR_REPLICA_VALUE &&
          replicaCanonicalEventId
        ) {
          seenManagedReplicaKeys.add(
            managedReplicaKey(member.id, replicaCanonicalEventId),
          );
        }
        // A deleted single event can come back from Google as a tombstone
        // stripped of its extended properties. The deterministic replica id
        // still lets us map that action to the one shared appointment. A
        // deletion therefore becomes the matching red business status; the
        // canonical event itself is never destroyed.
        const deletedReplicaCanonical =
          event.id && event.status === "cancelled"
            ? managedCanonicalByReplicaId.get(event.id)
            : undefined;
        if (deletedReplicaCanonical?.id) {
          try {
            const currentStatus = lifecycleStatusForEvent(
              deletedReplicaCanonical,
            );
            const isAlreadyCancelled =
              currentStatus === "signup_cancelled" ||
              currentStatus === "appointment_cancelled";
            const updatedCanonical = isAlreadyCancelled
              ? deletedReplicaCanonical
              : await patchCalendarEventWithoutUpdates(
                  sharedCalendarId,
                  deletedReplicaCanonical.id,
                  {
                    ...lifecycleEventBody(
                      deletedReplicaCanonical,
                      cancellationStatusFor(currentStatus),
                    ),
                    reminders: { useDefault: false, overrides: [] },
                  },
                );
            const normalized =
              (await syncManagedCalendarReplicas(updatedCanonical)) ||
              updatedCanonical;
            Object.assign(deletedReplicaCanonical, normalized);
            const normalizedCanonicalId = String(
              normalized.id || updatedCanonical.id || "",
            ).trim();
            if (normalizedCanonicalId) {
              managedCanonicalById.set(normalizedCanonicalId, normalized);
              fullySyncedManagedCanonicalIds.add(normalizedCanonicalId);
            }
            result.reconciliation.replicaFanouts += 1;
            result.updated += 1;
          } catch (error) {
            result.errors.push({
              memberId: member.id,
              code: visioGoogleErrorCode(error),
            });
          }
          continue;
        }
        if (
          privateProperties[PRIVATE_CALENDAR_REPLICA_KEY] ===
          PRIVATE_CALENDAR_REPLICA_VALUE
        ) {
          try {
            const outcome = await reconcileManagedCalendarReplica(
              event,
              member,
              managedCanonicalById,
              failedManagedCanonicalIds,
              fullySyncedManagedCanonicalIds,
              result.reconciliation,
            );
            result[outcome] += 1;
          } catch (error) {
            result.errors.push({
              memberId: member.id,
              code: visioGoogleErrorCode(error),
            });
          }
          continue;
        }
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
            let cleaned = false;
            if (event.id && event.status !== "cancelled") {
              await cancelCalendarEventWithoutUpdates(member.calendarId, event.id);
              result.cancelled += 1;
              cleaned = true;
            }
            if (existingMirror && (await cancelSharedCalendarEvent(existingMirror))) {
              result.cancelled += 1;
              cleaned = true;
            }
            if (!cleaned) result.skipped += 1;
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
          const identity = sharedVisioMirrorDeduplicationIdentity(event, {
            sourceCalendarId: member.calendarId,
            sourceEventId: String(event.id || ""),
            assignedMemberId: String(
              privateProperties.assignedMemberId || member.id,
            ),
            managedOrganizerEmails: managedCalendarIds,
          });
          const canonicalSourceKey = canonicalSourceByIdentity.get(identity);
          if (canonicalSourceKey && canonicalSourceKey !== sourceKey) {
            let canonicalIsActive = canonicalSourceActive.get(canonicalSourceKey);
            if (canonicalIsActive === undefined) {
              canonicalIsActive = await isCalendarSourceActive(canonicalSourceKey);
              canonicalSourceActive.set(canonicalSourceKey, canonicalIsActive);
            }
            if (canonicalIsActive) {
              if (existingMirror && (await cancelSharedCalendarEvent(existingMirror))) {
                result.cancelled += 1;
              } else {
                result.skipped += 1;
              }
              continue;
            }
            canonicalSourceByIdentity.delete(identity);
          }

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
          canonicalSourceByIdentity.set(identity, sourceKey);
          canonicalSourceActive.set(sourceKey, true);
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

    // Stable replicas were already present in the paginated member listings.
    // Only probe deterministic ids that were absent, including for a canonical
    // discovered outside the shared-calendar window through another replica.
    const missingReplicaCanonicalsById = new Map(
      [...managedCanonicalById.values()].flatMap((canonical) =>
        canonical?.id ? [[canonical.id, canonical] as const] : [],
      ),
    );
    const missingReplicaPairs: Array<{
      canonical: GoogleCalendarEvent;
      member: VisioTeamMember;
    }> = [];
    for (const canonical of missingReplicaCanonicalsById.values()) {
      if (
        !canonical.id ||
        canonical.status === "cancelled" ||
        fullySyncedManagedCanonicalIds.has(canonical.id)
      ) {
        continue;
      }
      for (const member of teamMembers) {
        if (
          !successfullyListedMemberIds.has(member.id) ||
          seenManagedReplicaKeys.has(managedReplicaKey(member.id, canonical.id))
        ) {
          continue;
        }
        missingReplicaPairs.push({ canonical, member });
      }
    }
    for (
      let index = 0;
      index < missingReplicaPairs.length;
      index += MANAGED_REPLICA_CREATE_CONCURRENCY
    ) {
      const attempts = await Promise.all(
        missingReplicaPairs
          .slice(index, index + MANAGED_REPLICA_CREATE_CONCURRENCY)
          .map(async ({ canonical, member }) => {
            if (
              !canonical.id ||
              fullySyncedManagedCanonicalIds.has(canonical.id)
            ) {
              return { kind: "skipped" as const, canonical, member };
            }
            result.reconciliation.missingReplicaChecks += 1;
            try {
              await createManagedCalendarReplica(canonical, member);
              return { kind: "created" as const, canonical, member };
            } catch (error) {
              return isVisioGoogleConflict(error)
                ? { kind: "conflict" as const, canonical, member }
                : { kind: "failed" as const, canonical, member, error };
            }
          }),
      );
      for (const attempt of attempts) {
        const { canonical, member } = attempt;
        if (attempt.kind === "skipped") continue;
        if (attempt.kind === "created") {
          result.created += 1;
          continue;
        }
        if (attempt.kind === "failed") {
          result.errors.push({
            memberId: member.id,
            code: visioGoogleErrorCode(attempt.error),
          });
          continue;
        }
        if (!canonical.id || fullySyncedManagedCanonicalIds.has(canonical.id)) {
          continue;
        }
        try {
          const replicaId = calendarReplicaEventId(canonical);
          const existing = replicaId
            ? await getCalendarEvent(member.calendarId, replicaId)
            : null;
          if (!existing) {
            throw new Error("visio_calendar_replica_conflict_missing");
          }
          const existingProperties = existing?.extendedProperties?.private || {};
          const isManagedReplica =
            existingProperties[PRIVATE_CALENDAR_REPLICA_KEY] ===
              PRIVATE_CALENDAR_REPLICA_VALUE &&
            Boolean(existingProperties[PRIVATE_CANONICAL_EVENT_ID_KEY]);
          if (!isManagedReplica && existing.status !== "cancelled") {
            throw new Error("visio_calendar_replica_id_conflict");
          }
          const replicaForReconciliation = isManagedReplica
            ? existing
            : {
                ...existing,
                extendedProperties: {
                  private:
                    managedCalendarReplicaBody(canonical, member)
                      .extendedProperties.private,
                },
              };
          const outcome = await reconcileManagedCalendarReplica(
            replicaForReconciliation,
            member,
            managedCanonicalById,
            failedManagedCanonicalIds,
            fullySyncedManagedCanonicalIds,
            result.reconciliation,
          );
          result[outcome] += 1;
        } catch (error) {
          result.errors.push({
            memberId: member.id,
            code: visioGoogleErrorCode(error),
          });
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

    // Re-read after all upserts: if a legacy race or two independent source
    // events still represent the same logical appointment, retain only the
    // strongest canonical mirror. No guest update is emitted.
    result.cancelled += await reconcileSharedAppointmentDuplicates(
      timeMin,
      timeMax,
    );

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
    if (claims && !isReusableBookingForProspect(sharedEvent, claims)) {
      assertMatchingBookingEvent(sharedEvent, claims);
    }
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
    const matchingProspect = candidates.filter((event) => {
      const properties = event.extendedProperties?.private || {};
      return (
        event.status !== "cancelled" &&
        properties.prospectUserId === claims.sub
      );
    });
    const existing =
      matchingProspect.find(
        (event) =>
          event.extendedProperties?.private?.bookingNonce === claims.nonce,
      ) || matchingProspect[0];
    if (existing && isReusableBookingForProspect(existing, claims)) {
      return existing;
    }
  }

  const publicEvent = await getCalendarEvent(getVisioPublicCalendarId(), eventId);
  if (publicEvent && publicEvent.status !== "cancelled") {
    if (claims && !isReusableBookingForProspect(publicEvent, claims)) {
      assertMatchingBookingEvent(publicEvent, claims);
    }
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
        if (claims && !isReusableBookingForProspect(event, claims)) {
          assertMatchingBookingEvent(event, claims);
        }
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

async function readProspectByUserId(userId: string, fallbackEmail = "") {
  const { data, error } = await supabaseAdmin
    .from("profiles")
    .select("first_name,last_name,company_legal_name,phone,contact_email,admin_email")
    .eq("user_id", userId)
    .maybeSingle();
  if (error) throw new Error(`visio_profile_read_failed:${error.message}`);
  const row = (data || {}) as Record<string, unknown>;
  const firstName = String(row.first_name || "").trim();
  const lastName = String(row.last_name || "").trim();
  const email = String(
    row.contact_email || row.admin_email || fallbackEmail || "",
  ).trim().toLowerCase();
  return {
    firstName,
    lastName,
    name: [firstName, lastName].filter(Boolean).join(" ") || email,
    company: String(row.company_legal_name || "").trim(),
    phone: String(row.phone || "").trim(),
    email,
  };
}

async function readProspect(claims: VisioBookingClaims) {
  return readProspectByUserId(claims.sub, claims.email);
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
    prospect: {
      ...prospect,
      firstName: prospect.firstName,
      lastName: prospect.lastName,
      email: prospect.email,
      phone: prospect.phone,
    },
    assignedMember: input.member,
  });
  // This function is reached only when the professional actively confirms a
  // slot from the public signup journey. A yellow waiting event may already
  // exist, but reusing that same Google object must not make the booking look
  // like an appointment positioned later by an administrator. Public direct
  // bookings are always dark blue; the admin reschedule path below is the
  // only path that turns yellow into light blue.
  const bookingOrigin: VisioAppointmentOrigin = "signup_with_appointment";
  const bookingStatus = scheduledStatusForOrigin(bookingOrigin);

  const privateProperties = {
    [PRIVATE_BOOKING_KEY]: PRIVATE_BOOKING_VALUE,
    [PRIVATE_BOOKING_SINGLE_EVENT_KEY]: PRIVATE_BOOKING_SINGLE_EVENT_VALUE,
    [TEAM_CALENDAR_MIRROR_KEY]: TEAM_CALENDAR_MIRROR_VALUE,
    bookingNonce: input.claims.nonce,
    prospectUserId: input.claims.sub,
    ...lifecyclePrivateProperties({
      status: bookingStatus,
      origin: bookingOrigin,
    }),
    [PRIVATE_LOGICAL_APPOINTMENT_KEY]: `prospect:${input.claims.sub}`,
    assignedMemberId: input.member.id,
    assignedMemberEmail: input.member.email,
    sourceCalendarId: sharedCalendarId,
    sourceEventId: masterEventId,
    sourceOrganizerEmail: sharedCalendarId,
    sourceCalendarIsOrganizer: "true",
    sharedCalendarId,
  };

  const attendees = buildSingleAssigneeVisioAttendees({
    teamMembers: [],
    assignedMemberId: input.member.id,
    externalAttendees: [
      { email: prospect.email, displayName: prospect.name, optional: false },
    ],
  });

  const eventBody = {
    ...publicContent,
    colorId: visioAppointmentColorId(bookingStatus),
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
      overrides: [],
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
  event = (await syncManagedCalendarReplicas(event)) || event;

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

async function convertPendingSignupToScheduledAppointment(input: {
  event: GoogleCalendarEvent;
  start: NonNullable<GoogleCalendarEvent["start"]>;
  end: NonNullable<GoogleCalendarEvent["end"]>;
}) {
  if (!input.event.id || lifecycleStatusForEvent(input.event) !== "signup_pending") {
    throw new Error("visio_team_assignment_mirror_missing");
  }
  if (!input.start.dateTime || !input.end.dateTime) {
    throw new Error("visio_team_reschedule_all_day");
  }

  const publicContent = await managedAppointmentPublicContent(input.event);
  const details = readVisioAppointmentPublicDetails(publicContent);
  const professionalEmail = String(details.email || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(professionalEmail)) {
    throw new Error("visio_team_reschedule_professional_email_missing");
  }

  const properties = input.event.extendedProperties?.private || {};
  const prospectUserId = String(properties.prospectUserId || "").trim();
  const bookingNonce = `admin-${createHash("sha256")
    .update(
      prospectUserId || logicalAppointmentId(input.event) || input.event.id,
      "utf8",
    )
    .digest("hex")
    .slice(0, 32)}`;
  const status: VisioAppointmentStatus =
    "appointment_scheduled_from_signup";
  const body = {
    ...publicContent,
    start: input.start,
    end: input.end,
    colorId: visioAppointmentColorId(status),
    attendees: [
      {
        email: professionalEmail,
        displayName: [details.firstName, details.lastName]
          .filter(Boolean)
          .join(" "),
      },
    ],
    reminders: { useDefault: false, overrides: [] },
    extendedProperties: {
      private: {
        ...properties,
        [PRIVATE_BOOKING_KEY]: PRIVATE_BOOKING_VALUE,
        [PRIVATE_BOOKING_SINGLE_EVENT_KEY]:
          PRIVATE_BOOKING_SINGLE_EVENT_VALUE,
        [PRIVATE_LOGICAL_APPOINTMENT_KEY]: logicalAppointmentId(input.event),
        bookingNonce,
        ...lifecyclePrivateProperties({
          status,
          origin: "signup_without_appointment",
        }),
      },
    },
    ...(teamCalendarEventMeetUrl(input.event)
      ? {}
      : {
          conferenceData: {
            createRequest: {
              requestId: conferenceRequestId(bookingNonce),
              conferenceSolutionKey: { type: "hangoutsMeet" },
            },
          },
        }),
  };

  const updated = await googleCalendarRequest<GoogleCalendarEvent>(
    `/calendars/${encodeCalendarId(
      getVisioSharedCalendarId(),
    )}/events/${encodeURIComponent(
      input.event.id,
    )}?conferenceDataVersion=1&sendUpdates=all`,
    { method: "PATCH", body: JSON.stringify(body) },
  );
  return waitForMeetConference(
    getVisioSharedCalendarId(),
    input.event.id,
    updated,
  );
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

function lifecycleStatusForEvent(
  event: GoogleCalendarEvent,
  fallback: VisioAppointmentStatus = "appointment_scheduled_from_signup",
): VisioAppointmentStatus {
  const properties = event.extendedProperties?.private || {};
  if (isVisioAppointmentStatus(properties[VISIO_APPOINTMENT_STATUS_KEY])) {
    return properties[VISIO_APPOINTMENT_STATUS_KEY];
  }
  if (pendingSignupReminderProspectUserId(event)) return "signup_pending";
  if (properties[PRIVATE_BOOKING_KEY] === PRIVATE_BOOKING_VALUE) {
    const origin = isVisioAppointmentOrigin(properties[VISIO_APPOINTMENT_ORIGIN_KEY])
      ? properties[VISIO_APPOINTMENT_ORIGIN_KEY]
      : properties.bookingNonce &&
          event.id &&
          event.id !== bookingEventId(properties.bookingNonce)
        ? "signup_without_appointment"
        : "signup_with_appointment";
    return scheduledStatusForOrigin(origin);
  }
  return fallback;
}

function lifecycleOriginForEvent(
  event: GoogleCalendarEvent,
  status = lifecycleStatusForEvent(event),
): VisioAppointmentOrigin {
  const value =
    event.extendedProperties?.private?.[VISIO_APPOINTMENT_ORIGIN_KEY];
  return isVisioAppointmentOrigin(value)
    ? value
    : visioAppointmentOriginForStatus(status);
}

function logicalAppointmentId(event: GoogleCalendarEvent) {
  const properties = event.extendedProperties?.private || {};
  const explicit = String(properties[PRIVATE_LOGICAL_APPOINTMENT_KEY] || "").trim();
  if (explicit) return explicit;
  const prospectUserId = String(properties.prospectUserId || "").trim();
  if (prospectUserId) return `prospect:${prospectUserId}`;
  const bookingNonce = String(properties.bookingNonce || "").trim();
  if (bookingNonce) return `booking:${bookingNonce}`;
  const sourceCalendarId = String(
    properties.sourceCalendarId || event.organizer?.email || "",
  ).trim();
  const sourceEventId = String(properties.sourceEventId || event.id || "").trim();
  return sourceCalendarId && sourceEventId
    ? `calendar:${sourceCalendarId}:${sourceEventId}`
    : "";
}

function calendarReplicaEventId(event: GoogleCalendarEvent) {
  const logicalId = logicalAppointmentId(event);
  if (!logicalId) return "";
  return `vr${createHash("sha256")
    .update(`visio-calendar-replica:${logicalId}`, "utf8")
    .digest("hex")
    .slice(0, 40)}`;
}

function calendarReplicaFingerprint(
  event: GoogleCalendarEvent,
  status = lifecycleStatusForEvent(event),
) {
  return createHash("sha256")
    .update(
      JSON.stringify({
        summary: String(event.summary || "").trim(),
        description: String(event.description || "").trim(),
        location: String(event.location || "").trim(),
        start: event.start || null,
        end: event.end || null,
        transparency: event.transparency || "opaque",
        lifecycleStatus: status,
        colorId: String(event.colorId || visioAppointmentColorId(status)),
      }),
      "utf8",
    )
    .digest("hex");
}

function isManagedLifecycleEvent(event: GoogleCalendarEvent) {
  const properties = event.extendedProperties?.private || {};
  return Boolean(
    isVisioAppointmentStatus(properties[VISIO_APPOINTMENT_STATUS_KEY]) ||
      properties[PRIVATE_BOOKING_KEY] === PRIVATE_BOOKING_VALUE ||
      pendingSignupReminderProspectUserId(event),
  );
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
  return canonicalVisioAppointmentIdentity(event);
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
  const status = lifecycleStatusForEvent(event);
  const origin = lifecycleOriginForEvent(event, status);
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
    status,
    statusLabel: VISIO_APPOINTMENT_STATUS_LABELS[status],
    colorId: visioAppointmentColorId(status),
    origin,
    managedLifecycle: isManagedLifecycleEvent(event),
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
  const updatedOrder = String(candidate.updated || "").localeCompare(
    String(current.updated || ""),
  );
  if (updatedOrder !== 0) return updatedOrder > 0;
  return String(candidate.id || "") < String(current.id || "");
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
    const key = sharedVisioMirrorDeduplicationIdentity(event);
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
  sendUpdates: "none",
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

function lifecycleEventBody(
  event: GoogleCalendarEvent,
  status = lifecycleStatusForEvent(event),
) {
  const origin = lifecycleOriginForEvent(event, status);
  return {
    colorId: visioAppointmentColorId(status),
    extendedProperties: {
      private: {
        ...(event.extendedProperties?.private || {}),
        ...lifecyclePrivateProperties({ status, origin }),
        [PRIVATE_LOGICAL_APPOINTMENT_KEY]: logicalAppointmentId(event),
      },
    },
  };
}

async function managedAppointmentPublicContent(event: GoogleCalendarEvent) {
  const parsed = readVisioAppointmentPublicDetails(event);
  const parsedContent = buildVisioAppointmentCalendarContent(parsed);
  const hasProfessionalEmail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(
    String(parsed.email || "").trim(),
  );
  if (
    event.summary === parsedContent.summary &&
    event.description === parsedContent.description &&
    !String(event.location || "").trim() &&
    hasProfessionalEmail
  ) {
    return parsedContent;
  }

  const prospectUserId = String(
    event.extendedProperties?.private?.prospectUserId || "",
  ).trim();
  if (!prospectUserId) return parsedContent;

  const fallbackEmail =
    (hasProfessionalEmail ? parsed.email : "") ||
    teamCalendarExternalAttendees(event, getVisioManagedCalendarAddresses())[0]
      ?.email ||
    "";
  const profile = await readProspectByUserId(prospectUserId, fallbackEmail);
  return buildVisioAppointmentCalendarContent({
    firstName: profile.firstName || parsed.firstName,
    lastName: profile.lastName || parsed.lastName,
    email: profile.email || parsed.email,
    company: profile.company || parsed.company,
    phone: profile.phone || parsed.phone,
  });
}

function managedCalendarReplicaBody(
  canonical: GoogleCalendarEvent,
  member: VisioTeamMember,
) {
  if (!canonical.id || !canonical.start || !canonical.end) {
    throw new Error("visio_calendar_replica_source_invalid");
  }
  const status = lifecycleStatusForEvent(canonical);
  const origin = lifecycleOriginForEvent(canonical, status);
  const logicalId = logicalAppointmentId(canonical);
  const replicaFingerprint = calendarReplicaFingerprint({
    ...canonical,
    colorId: visioAppointmentColorId(status),
    extendedProperties: {
      private: {
        ...(canonical.extendedProperties?.private || {}),
        ...lifecyclePrivateProperties({ status, origin }),
      },
    },
  });
  return {
    id: calendarReplicaEventId(canonical),
    status: "confirmed",
    summary: String(canonical.summary || "Inscription iNrCy - Professionnel").trim(),
    description: String(canonical.description || "").trim(),
    location: String(canonical.location || "").trim(),
    colorId: visioAppointmentColorId(status),
    visibility: "default",
    transparency: canonical.transparency || "opaque",
    start: canonical.start,
    end: canonical.end,
    ...(canonical.conferenceData
      ? { conferenceData: canonical.conferenceData }
      : {}),
    reminders: { useDefault: false, overrides: [] },
    extendedProperties: {
      private: {
        ...(canonical.extendedProperties?.private || {}),
        ...lifecyclePrivateProperties({ status, origin }),
        [PRIVATE_LOGICAL_APPOINTMENT_KEY]: logicalId,
        [PRIVATE_CALENDAR_REPLICA_KEY]: PRIVATE_CALENDAR_REPLICA_VALUE,
        [PRIVATE_CANONICAL_EVENT_ID_KEY]: canonical.id,
        [PRIVATE_REPLICA_FINGERPRINT_KEY]: replicaFingerprint,
        sourceCalendarId: getVisioSharedCalendarId(),
        sourceEventId: canonical.id,
        sourceOrganizerEmail: getVisioSharedCalendarId(),
        sourceCalendarIsOrganizer: "true",
        assignedMemberId: String(
          canonical.extendedProperties?.private?.assignedMemberId || member.id,
        ),
        assignedMemberEmail: String(
          canonical.extendedProperties?.private?.assignedMemberEmail || member.email,
        ),
        sharedCalendarId: getVisioSharedCalendarId(),
        sourceMeetUrl: teamCalendarEventMeetUrl(canonical),
      },
    },
  };
}

function isVisioGoogleConflict(error: unknown) {
  return (
    error instanceof Error &&
    error.message.startsWith("visio_google_api_failed:409:")
  );
}

async function createManagedCalendarReplica(
  canonical: GoogleCalendarEvent,
  member: VisioTeamMember,
) {
  const body = managedCalendarReplicaBody(canonical, member);
  await googleCalendarRequest<GoogleCalendarEvent>(
    `/calendars/${encodeCalendarId(member.calendarId)}/events?conferenceDataVersion=1&sendUpdates=none`,
    { method: "POST", body: JSON.stringify(body) },
  );
  return "created" as const;
}

async function upsertManagedCalendarReplica(
  canonical: GoogleCalendarEvent,
  member: VisioTeamMember,
  existingReplica?: GoogleCalendarEvent | null,
) {
  const body = managedCalendarReplicaBody(canonical, member);
  const replicaId = String(body.id || "");
  if (!replicaId) throw new Error("visio_calendar_replica_id_missing");
  const existing =
    existingReplica === undefined
      ? await getCalendarEvent(member.calendarId, replicaId)
      : existingReplica;
  if (
    existing &&
    existing.status !== "cancelled" &&
    teamCalendarMirrorContentSignature(existing) ===
      teamCalendarMirrorContentSignature(body)
  ) {
    return "unchanged" as const;
  }
  if (existing?.id) {
    await patchCalendarEventWithoutUpdates(member.calendarId, existing.id, body);
    return "updated" as const;
  }
  try {
    return await createManagedCalendarReplica(canonical, member);
  } catch (error) {
    if (isVisioGoogleConflict(error)) {
      await patchCalendarEventWithoutUpdates(member.calendarId, replicaId, body);
      return "updated" as const;
    }
    throw error;
  }
}

function recoveredManagedCanonicalEventId(replica: GoogleCalendarEvent) {
  const logicalId = logicalAppointmentId(replica);
  if (!logicalId) throw new Error("visio_calendar_replica_identity_missing");
  return `vc${createHash("sha256")
    .update(`visio-canonical-recovery:${logicalId}`, "utf8")
    .digest("hex")
    .slice(0, 40)}`;
}

async function restoreManagedCanonicalFromReplica(input: {
  replica: GoogleCalendarEvent;
  cancelledCanonical?: GoogleCalendarEvent | null;
}) {
  const { replica } = input;
  const properties = { ...(replica.extendedProperties?.private || {}) };
  const previousStatus = lifecycleStatusForEvent(replica);
  const status: VisioAppointmentStatus =
    previousStatus === "signup_cancelled" ||
    previousStatus === "appointment_cancelled"
      ? previousStatus
      : cancellationStatusFor(previousStatus);
  const origin = lifecycleOriginForEvent(replica, previousStatus);
  const publicContent = await managedAppointmentPublicContent(replica);
  const details = readVisioAppointmentPublicDetails(publicContent);
  const professionalEmail = String(details.email || "").trim().toLowerCase();
  const shouldKeepProfessional =
    status !== "signup_cancelled" &&
    /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(professionalEmail);

  delete properties[PRIVATE_CALENDAR_REPLICA_KEY];
  delete properties[PRIVATE_CANONICAL_EVENT_ID_KEY];
  delete properties[PRIVATE_REPLICA_FINGERPRINT_KEY];

  const buildBody = (eventId: string) => ({
    status: "confirmed",
    ...publicContent,
    colorId: visioAppointmentColorId(status),
    visibility: "default",
    transparency: replica.transparency || "opaque",
    guestsCanInviteOthers: false,
    guestsCanModify: false,
    guestsCanSeeOtherGuests: false,
    start: replica.start,
    end: replica.end,
    ...(replica.conferenceData
      ? { conferenceData: replica.conferenceData }
      : {}),
    attendees: shouldKeepProfessional
      ? [
          {
            email: professionalEmail,
            displayName: [details.firstName, details.lastName]
              .filter(Boolean)
              .join(" "),
          },
        ]
      : [],
    reminders: { useDefault: false, overrides: [] },
    extendedProperties: {
      private: {
        ...properties,
        ...lifecyclePrivateProperties({ status, origin }),
        [TEAM_CALENDAR_MIRROR_KEY]: TEAM_CALENDAR_MIRROR_VALUE,
        [PRIVATE_LOGICAL_APPOINTMENT_KEY]: logicalAppointmentId(replica),
        sourceCalendarId: getVisioSharedCalendarId(),
        sourceEventId: eventId,
        sourceOrganizerEmail: getVisioSharedCalendarId(),
        sourceCalendarIsOrganizer: "true",
        sharedCalendarId: getVisioSharedCalendarId(),
        sourceMeetUrl: teamCalendarEventMeetUrl(replica),
      },
    },
  });

  const cancelledCanonicalId = String(input.cancelledCanonical?.id || "").trim();
  if (cancelledCanonicalId) {
    try {
      return await patchCalendarEventWithoutUpdates(
        getVisioSharedCalendarId(),
        cancelledCanonicalId,
        buildBody(cancelledCanonicalId),
      );
    } catch (error) {
      if (
        !(error instanceof Error) ||
        (!error.message.startsWith("visio_google_api_failed:404:") &&
          !error.message.startsWith("visio_google_api_failed:410:"))
      ) {
        throw error;
      }
    }
  }

  const recoveredId = recoveredManagedCanonicalEventId(replica);
  const body = buildBody(recoveredId);
  try {
    return await googleCalendarRequest<GoogleCalendarEvent>(
      `/calendars/${encodeCalendarId(
        getVisioSharedCalendarId(),
      )}/events?conferenceDataVersion=1&sendUpdates=none`,
      {
        method: "POST",
        body: JSON.stringify({ ...body, id: recoveredId }),
      },
    );
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.startsWith("visio_google_api_failed:409:")
    ) {
      return patchCalendarEventWithoutUpdates(
        getVisioSharedCalendarId(),
        recoveredId,
        body,
      );
    }
    throw error;
  }
}

function isReusableBookingForProspect(
  event: GoogleCalendarEvent,
  claims: VisioBookingClaims,
) {
  const properties = event.extendedProperties?.private || {};
  if (
    properties[PRIVATE_BOOKING_KEY] !== PRIVATE_BOOKING_VALUE ||
    properties.prospectUserId !== claims.sub
  ) {
    return false;
  }
  const status = lifecycleStatusForEvent(event);
  if (status === "signup_cancelled" || status === "appointment_cancelled") {
    throw new Error("visio_booking_cancelled");
  }
  return true;
}

async function syncManagedCalendarReplicas(canonical: GoogleCalendarEvent) {
  if (!canonical.id || canonical.status === "cancelled") return;
  const storedStatus = lifecycleStatusForEvent(canonical);
  const origin = lifecycleOriginForEvent(canonical, storedStatus);
  const status = visioAppointmentStatusAfterColorChange({
    currentStatus: storedStatus,
    origin,
    colorId: canonical.colorId,
  });
  const properties = canonical.extendedProperties?.private || {};
  const publicContent = await managedAppointmentPublicContent(canonical);
  const externalAttendees = teamCalendarExternalAttendees(
    canonical,
    getVisioManagedCalendarAddresses(),
  );
  const attendeeSignature = (attendees: GoogleCalendarEvent["attendees"]) =>
    (attendees || [])
      .map((attendee) => String(attendee.email || "").trim().toLowerCase())
      .filter(Boolean)
      .sort()
      .join("\n");
  const needsNormalizing =
    canonical.summary !== publicContent.summary ||
    canonical.description !== publicContent.description ||
    Boolean(String(canonical.location || "").trim()) ||
    canonical.colorId !== visioAppointmentColorId(status) ||
    properties[VISIO_APPOINTMENT_STATUS_KEY] !== status ||
    properties[VISIO_APPOINTMENT_ORIGIN_KEY] !== origin ||
    properties[PRIVATE_LOGICAL_APPOINTMENT_KEY] !==
      logicalAppointmentId(canonical) ||
    attendeeSignature(canonical.attendees) !==
      attendeeSignature(externalAttendees) ||
    hasAutomaticGoogleCalendarReminders(canonical);
  const normalized = needsNormalizing
    ? await patchCalendarEventWithoutUpdates(
        getVisioSharedCalendarId(),
        canonical.id,
        {
          ...publicContent,
          ...lifecycleEventBody(canonical, status),
          attendees: externalAttendees,
          reminders: { useDefault: false, overrides: [] },
        },
      )
    : canonical;
  await Promise.all(
    getVisioTeamMembers().map((member) =>
      upsertManagedCalendarReplica(normalized, member),
    ),
  );
  return normalized;
}

async function reconcileManagedCalendarReplica(
  replica: GoogleCalendarEvent,
  member: VisioTeamMember,
  managedCanonicalById: Map<string, GoogleCalendarEvent | null>,
  failedManagedCanonicalIds: Set<string>,
  fullySyncedManagedCanonicalIds: Set<string>,
  reconciliation: VisioTeamCalendarSyncResult["reconciliation"],
) {
  const properties = replica.extendedProperties?.private || {};
  const canonicalEventId = String(
    properties[PRIVATE_CANONICAL_EVENT_ID_KEY] || "",
  ).trim();
  if (
    properties[PRIVATE_CALENDAR_REPLICA_KEY] !==
      PRIVATE_CALENDAR_REPLICA_VALUE ||
    !canonicalEventId
  ) {
    return "skipped" as const;
  }
  if (failedManagedCanonicalIds.has(canonicalEventId)) {
    return "skipped" as const;
  }

  let canonical: GoogleCalendarEvent | null | undefined =
    managedCanonicalById.get(canonicalEventId);
  if (managedCanonicalById.has(canonicalEventId)) {
    reconciliation.canonicalCacheHits += 1;
  } else {
    reconciliation.canonicalFetches += 1;
    canonical = await getCalendarEvent(
      getVisioSharedCalendarId(),
      canonicalEventId,
    );
    managedCanonicalById.set(canonicalEventId, canonical);
    if (canonical?.id) {
      managedCanonicalById.set(canonical.id, canonical);
    }
  }
  if (!canonical?.id || canonical.status === "cancelled") {
    const restored = await restoreManagedCanonicalFromReplica({
      replica,
      cancelledCanonical: canonical,
    });
    const normalized = (await syncManagedCalendarReplicas(restored)) || restored;
    managedCanonicalById.set(canonicalEventId, normalized);
    fullySyncedManagedCanonicalIds.add(canonicalEventId);
    if (normalized.id) {
      managedCanonicalById.set(normalized.id, normalized);
      fullySyncedManagedCanonicalIds.add(normalized.id);
    }
    reconciliation.replicaFanouts += 1;
    return "updated" as const;
  }

  const currentStatus = lifecycleStatusForEvent(canonical);
  const origin = lifecycleOriginForEvent(canonical, currentStatus);
  const storedFingerprint = String(
    properties[PRIVATE_REPLICA_FINGERPRINT_KEY] || "",
  ).trim();
  const requestedStatus =
    replica.status === "cancelled"
      ? cancellationStatusFor(currentStatus)
      : visioAppointmentStatusAfterColorChange({
          currentStatus,
          origin,
          colorId: replica.colorId,
        });
  const actualFingerprint = calendarReplicaFingerprint(
    replica,
    requestedStatus,
  );
  const scheduleChanged =
    Boolean(replica.start && replica.end) &&
    (JSON.stringify(replica.start) !== JSON.stringify(canonical.start) ||
      JSON.stringify(replica.end) !== JSON.stringify(canonical.end));
  const replicaChanged =
    Boolean(storedFingerprint) && actualFingerprint !== storedFingerprint;
  const canonicalRequestedStatus = visioAppointmentStatusAfterColorChange({
    currentStatus,
    origin,
    colorId: canonical.colorId,
  });

  // An unchanged replica is also the previous snapshot of the canonical
  // event. If the yellow shared case has moved while that snapshot did not,
  // the user positioned the appointment directly in the shared calendar.
  // Complete the same one-time Meet + guest transition as the admin tool.
  if (
    storedFingerprint &&
    !replicaChanged &&
    scheduleChanged &&
    currentStatus === "signup_pending" &&
    canonicalRequestedStatus === currentStatus &&
    canonical.start &&
    canonical.end
  ) {
    const scheduled = await convertPendingSignupToScheduledAppointment({
      event: canonical,
      start: canonical.start,
      end: canonical.end,
    });
    const normalized = (await syncManagedCalendarReplicas(scheduled)) || scheduled;
    managedCanonicalById.set(canonical.id, normalized);
    fullySyncedManagedCanonicalIds.add(canonical.id);
    reconciliation.replicaFanouts += 1;
    return "updated" as const;
  }

  const desiredReplica = managedCalendarReplicaBody(canonical, member);
  const canonicalFingerprint = String(
    desiredReplica.extendedProperties.private[
      PRIVATE_REPLICA_FINGERPRINT_KEY
    ] || "",
  ).trim();
  const decision = teamCalendarReplicaReconciliationDecision({
    storedFingerprint,
    actualFingerprint,
    canonicalFingerprint,
    contentMatchesCanonical:
      teamCalendarMirrorContentSignature(replica) ===
      teamCalendarMirrorContentSignature(desiredReplica),
  });
  if (decision === "stable") {
    return "unchanged" as const;
  }
  if (decision === "repair") {
    if (fullySyncedManagedCanonicalIds.has(canonical.id)) {
      return "unchanged" as const;
    }
    const normalized =
      (await syncManagedCalendarReplicas(canonical)) || canonical;
    managedCanonicalById.set(canonical.id, normalized);
    fullySyncedManagedCanonicalIds.add(canonical.id);
    reconciliation.replicaFanouts += 1;
    return "updated" as const;
  }

  const statusChanged = requestedStatus !== currentStatus;
  const [replicaPublicContent, canonicalPublicContent] = await Promise.all([
    managedAppointmentPublicContent(replica),
    managedAppointmentPublicContent(canonical),
  ]);
  const publicContentChanged =
    replicaPublicContent.summary !== canonicalPublicContent.summary ||
    replicaPublicContent.description !== canonicalPublicContent.description;

  // Moving the yellow case in an individual calendar has the same meaning as
  // positioning it from the attribution tool. Reuse the one canonical event,
  // create its Meet if needed, and send the professional one initial invite.
  if (
    scheduleChanged &&
    requestedStatus === "signup_pending" &&
    replica.start &&
    replica.end
  ) {
    const scheduled = await convertPendingSignupToScheduledAppointment({
      event: {
        ...canonical,
        ...replicaPublicContent,
        start: replica.start,
        end: replica.end,
      },
      start: replica.start,
      end: replica.end,
    });
    const normalized = (await syncManagedCalendarReplicas(scheduled)) || scheduled;
    managedCanonicalById.set(canonical.id, normalized);
    fullySyncedManagedCanonicalIds.add(canonical.id);
    reconciliation.replicaFanouts += 1;
    return "updated" as const;
  }

  const updated =
    scheduleChanged || statusChanged || publicContentChanged
      ? await patchCalendarEventWithoutUpdates(
          getVisioSharedCalendarId(),
          canonical.id,
          {
            ...(publicContentChanged ? replicaPublicContent : {}),
            ...(scheduleChanged
              ? { start: replica.start, end: replica.end }
              : {}),
            ...(statusChanged
              ? lifecycleEventBody(canonical, requestedStatus)
              : {}),
            reminders: { useDefault: false, overrides: [] },
          },
        )
      : canonical;
  const normalized = (await syncManagedCalendarReplicas(updated)) || updated;
  managedCanonicalById.set(canonical.id, normalized);
  fullySyncedManagedCanonicalIds.add(canonical.id);
  reconciliation.replicaFanouts += 1;
  return "updated" as const;
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
  const referenceIdentity = sharedVisioMirrorDeduplicationIdentity(reference);
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
      sharedVisioMirrorDeduplicationIdentity(event) !== referenceIdentity
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
    const updated = await patchCalendarEventWithoutUpdates(
      getVisioSharedCalendarId(),
      input.mirror.id,
      {
        attendees: buildSingleAssigneeVisioAttendees({
          teamMembers: [],
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
    return (await syncManagedCalendarReplicas(updated)) || updated;
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

  if (
    input.mirror.id &&
    normalizedCalendarId(sourceCalendarId) ===
      normalizedCalendarId(getVisioSharedCalendarId()) &&
    sourceEventId === input.mirror.id &&
    isManagedLifecycleEvent(input.mirror)
  ) {
    const updated = await patchCalendarEventWithoutUpdates(
      getVisioSharedCalendarId(),
      input.mirror.id,
      {
        extendedProperties: {
          private: {
            ...properties,
            assignedMemberId: input.targetMember.id,
            assignedMemberEmail: input.targetMember.email,
          },
        },
      },
    );
    return (await syncManagedCalendarReplicas(updated)) || updated;
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
    const master = await patchCalendarEventWithoutUpdates(
      getVisioSharedCalendarId(),
      input.mirror.id,
      { start: schedule.start, end: schedule.end },
    );
    const normalized = (await syncManagedCalendarReplicas(master)) || master;
    return {
      mirror: normalized,
      ...schedule,
      googleUpdatesRequested: false,
    };
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

    await patchCalendarEventWithoutUpdates(publicCalendarId, publicEvent.id, {
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
  return { mirror: stagedMirror, ...schedule, googleUpdatesRequested: false };
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

  const isSharedManagedEvent =
    input.mirror.id &&
    normalizedCalendarId(sourceCalendarId) ===
      normalizedCalendarId(getVisioSharedCalendarId()) &&
    sourceEventId === input.mirror.id &&
    isManagedLifecycleEvent(input.mirror);
  if (isSharedManagedEvent) {
    const schedule = buildTimedEventSchedule(input.mirror, input.newStart);
    const currentStatus = lifecycleStatusForEvent(input.mirror);
    const becomesAppointment = currentStatus === "signup_pending";
    if (!schedule.changed && !becomesAppointment) {
      return {
        mirror: input.mirror,
        ...schedule,
        googleUpdatesRequested: false,
      };
    }

    let updated = becomesAppointment
      ? await convertPendingSignupToScheduledAppointment({
          event: input.mirror,
          start: schedule.start,
          end: schedule.end,
        })
      : await patchCalendarEventWithoutUpdates(
          getVisioSharedCalendarId(),
          String(input.mirror.id),
          {
            start: schedule.start,
            end: schedule.end,
            reminders: { useDefault: false, overrides: [] },
          },
        );
    updated = (await syncManagedCalendarReplicas(updated)) || updated;
    return {
      mirror: updated,
      ...schedule,
      googleUpdatesRequested: becomesAppointment,
    };
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
    await patchCalendarEventWithoutUpdates(sourceCalendarId, sourceEvent.id, {
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
  return { mirror: stagedMirror, ...schedule, googleUpdatesRequested: false };
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

async function recordVisioTeamStatusChange(input: {
  actor: VisioTeamReassignmentActor;
  mirrorId: string;
  previousStatus: VisioAppointmentStatus;
  status: VisioAppointmentStatus;
}) {
  const { error } = await supabaseAdmin.from("app_events").insert({
    user_id: input.actor.userId,
    module: "visio_booking_admin",
    type: "appointment_status_changed",
    payload: {
      mirrorEventId: input.mirrorId,
      previousStatus: input.previousStatus,
      status: input.status,
      actorEmail: input.actor.email,
      actorName: input.actor.name,
      notificationsSent: false,
      changedAt: new Date().toISOString(),
    },
  });
  if (error) {
    console.error("[visio-booking][team-status-audit]", error.message);
  }
}

async function recordVisioBookingManualResend(input: {
  actor: VisioTeamReassignmentActor;
  mirrorId: string;
  appointmentFingerprint: string;
  recipientFingerprint: string;
}) {
  const { error } = await supabaseAdmin.from("app_events").insert({
    user_id: input.actor.userId,
    module: "visio_booking_admin",
    type: "appointment_link_resent",
    payload: {
      mirrorEventId: input.mirrorId,
      appointmentFingerprint: input.appointmentFingerprint,
      recipientFingerprint: input.recipientFingerprint,
      actorEmail: input.actor.email,
      actorName: input.actor.name,
      deliveryMode: "manual_only",
      resentAt: new Date().toISOString(),
    },
  });
  if (error) {
    console.error("[visio-booking][manual-link-resend-audit]", error.message);
  }
}

async function bookingDeliveryEvent(mirror: GoogleCalendarEvent) {
  const properties = mirror.extendedProperties?.private || {};
  const sourceCalendarId = String(properties.sourceCalendarId || "").trim();
  const sourceEventId = String(properties.sourceEventId || "").trim();
  if (
    !sourceCalendarId ||
    !sourceEventId ||
    (normalizedCalendarId(sourceCalendarId) ===
      normalizedCalendarId(getVisioSharedCalendarId()) &&
      sourceEventId === mirror.id)
  ) {
    return mirror;
  }

  const source = await getCalendarEvent(sourceCalendarId, sourceEventId);
  const mirrorNonce = String(properties.bookingNonce || "").trim();
  const sourceNonce = String(
    source?.extendedProperties?.private?.bookingNonce || "",
  ).trim();
  return source?.id && source.status !== "cancelled" &&
    (!mirrorNonce || sourceNonce === mirrorNonce)
    ? source
    : mirror;
}

export async function resendVisioBookingLink(input: {
  mirrorEventId: string;
  appointmentIdentity?: string;
  appointmentStart?: string;
  deliveryKey: string;
  actor: VisioTeamReassignmentActor;
}): Promise<VisioBookingManualResendResult> {
  const mirrorEventId = String(input.mirrorEventId || "").trim();
  if (!mirrorEventId || !String(input.deliveryKey || "").trim()) {
    throw new Error("visio_booking_manual_resend_invalid");
  }

  const mirror = await resolveActiveTeamAppointmentMirror({
    mirrorEventId,
    identity: input.appointmentIdentity,
    start: input.appointmentStart,
  });
  if (!mirror?.id) throw new Error("visio_team_assignment_mirror_missing");

  const properties = mirror.extendedProperties?.private || {};
  if (properties[PRIVATE_BOOKING_KEY] !== PRIVATE_BOOKING_VALUE) {
    throw new Error("visio_booking_manual_resend_not_booking");
  }
  const canonicalIdentity = appointmentIdentity(mirror);
  if (
    input.appointmentIdentity &&
    String(input.appointmentIdentity).trim() !== canonicalIdentity
  ) {
    throw new Error("visio_team_assignment_mirror_missing");
  }

  const appointment = teamAppointmentFromMirror(mirror);
  if (!appointment) throw new Error("visio_team_assignment_mirror_missing");
  const deliveryEvent = await bookingDeliveryEvent(mirror);
  const recipients = teamCalendarExternalAttendees(
    deliveryEvent,
    getVisioManagedCalendarAddresses(),
  ).filter(
    (attendee) =>
      String(attendee.responseStatus || "").toLowerCase() !== "declined",
  );
  if (recipients.length === 0) {
    throw new Error("visio_booking_manual_resend_recipient_missing");
  }
  if (recipients.length !== 1) {
    throw new Error("visio_booking_manual_resend_recipient_ambiguous");
  }

  const meetUrl = teamCalendarEventMeetUrl(deliveryEvent) || appointment.meetUrl;
  const mail = buildVisioBookingLinkMail({
    start: appointment.start,
    end: appointment.end,
    meetUrl,
  });
  const idempotencyKey = buildVisioBookingManualResendKey({
    appointmentIdentity: canonicalIdentity,
    deliveryKey: input.deliveryKey,
  });
  const appointmentFingerprint = visioBookingManualResendFingerprint({
    appointmentIdentity: canonicalIdentity,
    deliveryKey: input.deliveryKey,
  });
  const recipientFingerprint = createHash("sha256")
    .update(recipients[0].email.toLowerCase(), "utf8")
    .digest("hex");
  const claim = await acquireExecutionIdempotencyLock({
    supabase: supabaseAdmin,
    userId: input.actor.userId,
    scope: VISIO_BOOKING_MANUAL_RESEND_SCOPE,
    idempotencyKey,
    ttlMs: VISIO_BOOKING_MANUAL_RESEND_LOCK_TTL_MS,
    metadata: {
      mirrorEventId: mirror.id,
      appointmentFingerprint,
      recipientFingerprint,
      deliveryMode: "manual_only",
    },
  });
  if (claim.state === "completed") {
    return { appointment, sent: true, idempotent: true };
  }
  if (claim.state === "running") {
    throw new Error("visio_booking_manual_resend_in_progress");
  }
  if (claim.state === "unavailable" || !claim.lock?.id) {
    throw new Error("visio_booking_manual_resend_idempotency_unavailable");
  }

  try {
    await sendTxMail({ to: recipients[0].email, ...mail });
  } catch (error) {
    console.error(
      "[visio-booking][manual-link-resend-delivery]",
      error instanceof Error ? error.message : "send_failed",
    );
    // The SMTP outcome may be uncertain. Keep the durable claim in `running`
    // so an automatic/network retry cannot send the same message twice.
    throw new Error("visio_booking_manual_resend_delivery_failed");
  }

  try {
    await completeExecutionIdempotencyLockOrThrow({
      supabase: supabaseAdmin,
      lockId: claim.lock.id,
      result: { ok: true, sentAt: new Date().toISOString() },
      metadata: {
        mirrorEventId: mirror.id,
        appointmentFingerprint,
        recipientFingerprint,
        deliveryMode: "manual_only",
      },
    });
  } catch (error) {
    console.error(
      "[visio-booking][manual-link-resend-commit]",
      error instanceof Error ? error.message : "commit_failed",
    );
    throw new Error("visio_booking_manual_resend_commit_uncertain");
  }

  await recordVisioBookingManualResend({
    actor: input.actor,
    mirrorId: mirror.id,
    appointmentFingerprint,
    recipientFingerprint,
  });
  return { appointment, sent: true, idempotent: false };
}

export async function updateVisioTeamAppointmentStatus(input: {
  mirrorEventId: string;
  appointmentIdentity?: string;
  appointmentStart?: string;
  status: VisioAppointmentStatus;
  actor: VisioTeamReassignmentActor;
}): Promise<VisioTeamStatusResult> {
  const mirrorEventId = String(input.mirrorEventId || "").trim();
  if (
    !mirrorEventId ||
    !VISIO_APPOINTMENT_STATUSES.includes(input.status)
  ) {
    throw new Error("visio_team_status_invalid");
  }

  const calendarMutationLock = await acquireTeamCalendarMutationLock();
  if (!calendarMutationLock.acquired) {
    throw new Error("visio_team_assignment_sync_busy");
  }
  try {
    const mirror = await resolveActiveTeamAppointmentMirror({
      mirrorEventId,
      identity: input.appointmentIdentity,
      start: input.appointmentStart,
    });
    if (!mirror?.id || !isManagedLifecycleEvent(mirror)) {
      throw new Error("visio_team_assignment_mirror_missing");
    }

    const lockIdentity = createHash("sha256")
      .update(String(input.appointmentIdentity || mirror.id), "utf8")
      .digest("hex")
      .slice(0, 32);
    const lock = await acquireBookingLock(`status:${lockIdentity}`);
    try {
      const previousStatus = lifecycleStatusForEvent(mirror);
      const origin = lifecycleOriginForEvent(mirror, previousStatus);
      if (
        input.status !== previousStatus &&
        !canManuallyTransitionVisioAppointment(
          previousStatus,
          input.status,
          origin,
        )
      ) {
        throw new Error("visio_team_status_transition_invalid");
      }

      const updated =
        input.status === previousStatus
          ? mirror
          : await patchCalendarEventWithoutUpdates(
              getVisioSharedCalendarId(),
              mirror.id,
              {
                ...lifecycleEventBody(mirror, input.status),
                reminders: { useDefault: false, overrides: [] },
              },
            );
      const normalized =
        (await syncManagedCalendarReplicas(updated)) || updated;
      const appointment = teamAppointmentFromMirror(normalized);
      if (!appointment) {
        throw new Error("visio_team_assignment_mirror_missing");
      }
      if (input.status !== previousStatus) {
        await recordVisioTeamStatusChange({
          actor: input.actor,
          mirrorId: mirror.id,
          previousStatus,
          status: input.status,
        });
      }
      return {
        appointment,
        previousStatus,
        status: input.status,
        notificationsSent: false,
      };
    } finally {
      await lock.release().catch(() => undefined);
    }
  } finally {
    await calendarMutationLock.release().catch(() => undefined);
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

  const calendarMutationLock = await acquireTeamCalendarMutationLock();
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

  const calendarMutationLock = await acquireTeamCalendarMutationLock();
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
