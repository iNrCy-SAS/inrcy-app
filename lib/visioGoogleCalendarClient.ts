import "server-only";

import { encryptToken, tryDecryptToken } from "@/lib/oauthCrypto";
import { requireEnv } from "@/lib/env";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { createScopedTokenCache } from "@/lib/visioGoogleTokenScope";
import { calendarEventMutationTarget, createScopedCalendarEventCache } from "@/lib/visioCalendarEventScope";
import { googleCalendarErrorReason, googleCalendarRetryDelayMs, isTransientGoogleCalendarFailure } from "@/lib/googleCalendarRetryPolicy";
import { VISIO_BOOKING_TIMEZONE } from "@/lib/visioBookingPolicy";
import type { TeamCalendarEvent } from "@/lib/visioCalendarMirrorPolicy";

/** Google transport and request-scoped caches shared by booking and calendar synchronization. */
type GoogleCalendarEvent = TeamCalendarEvent;

const GOOGLE_CALENDAR_API = "https://www.googleapis.com/calendar/v3";
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_ACCESS_TOKEN_CACHE_MAX_MS = 30_000;
export const INTEGRATION_SOURCE = "internal_staff";
export const INTEGRATION_PRODUCT = "visio_booking";
type GoogleIntegrationRow = {
  id: string;
  user_id: string;
  access_token_enc: string | null;
  refresh_token_enc: string | null;
  expires_at: string | null;
  status: string | null;
};

export function encodeCalendarId(value: string) {
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

  const expiresAtMs =
    Date.now() + Math.max(60, Number(payload.expires_in || 3600)) * 1_000;
  const expiresAt = new Date(expiresAtMs).toISOString();
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
  return {
    value: payload.access_token,
    validUntilMs: Math.min(expiresAtMs - 60_000, Date.now() + GOOGLE_ACCESS_TOKEN_CACHE_MAX_MS),
  };
}

async function loadGoogleAccessToken(forceRefresh: boolean) {
  const row = await readGoogleIntegration();
  const accessToken = tryDecryptToken(row.access_token_enc);
  const expiresAt = row.expires_at ? new Date(row.expires_at).getTime() : 0;
  if (!forceRefresh && accessToken && expiresAt > Date.now() + 60_000) {
    return {
      value: accessToken,
      validUntilMs: Math.min(expiresAt - 60_000, Date.now() + GOOGLE_ACCESS_TOKEN_CACHE_MAX_MS),
    };
  }
  return refreshGoogleAccessToken(row);
}

export const googleAccessTokenCache = createScopedTokenCache(loadGoogleAccessToken);
export const googleCalendarEventCache = createScopedCalendarEventCache<GoogleCalendarEvent>();

async function getGoogleAccessToken(forceRefresh = false) {
  return googleAccessTokenCache.get(forceRefresh);
}

export async function googleCalendarRequest<T>(
  path: string,
  init?: RequestInit,
  retryUnauthorized = true,
  transientAttempt = 0,
): Promise<T> {
  const mutation = calendarEventMutationTarget(path, init?.method, init?.body);
  if (mutation?.eventId) {
    googleCalendarEventCache.invalidate(mutation.calendarId, mutation.eventId);
    if (mutation.resultCalendarId !== mutation.calendarId) {
      googleCalendarEventCache.invalidate(mutation.resultCalendarId, mutation.eventId);
    }
  }
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

  if (!response.ok) {
    const detail = await response.text().catch(() => "");
    if (
      transientAttempt < 3 &&
      isTransientGoogleCalendarFailure({
        status: response.status,
        responseBody: detail,
      })
    ) {
      await new Promise((resolve) => setTimeout(
        resolve,
        googleCalendarRetryDelayMs({
          attempt: transientAttempt,
          retryAfter: response.headers.get("retry-after"),
        }),
      ));
      return googleCalendarRequest<T>(
        path,
        init,
        retryUnauthorized,
        transientAttempt + 1,
      );
    }
    const reason = googleCalendarErrorReason(detail);
    throw new Error(
      `visio_google_api_failed:${response.status}:${reason ? `${reason}:` : ""}${detail.slice(0, 240)}`,
    );
  }
  const payload = await response.json();
  if (mutation && payload && typeof payload.id === "string") {
    googleCalendarEventCache.remember(mutation.resultCalendarId, payload);
  }
  return payload as T;
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

export function visioGoogleErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : "unknown_error";
  const match = message.match(/^visio_google_api_failed:(\d{3}):/);
  if (match) return `google_${match[1]}`;
  return message.split(":")[0].slice(0, 80) || "unknown_error";
}

export async function listGoogleCalendarEvents(input: {
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
  for (const event of events) {
    googleCalendarEventCache.remember(input.calendarId, event);
  }
  return events;
}

export async function readCalendarAccessRole(calendarId: string) {
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

export async function getCalendarEvent(
  calendarId: string,
  eventId: string,
  options?: { fresh?: boolean },
) {
  if (options?.fresh) googleCalendarEventCache.invalidate(calendarId, eventId);
  return googleCalendarEventCache.get(calendarId, eventId, async () => {
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
  });
}

