import "server-only";

import { createHash, createHmac, randomUUID, timingSafeEqual } from "node:crypto";

import { Redis } from "@upstash/redis";

import { optionalEnv } from "@/lib/env";
import {
  createVisioGoogleCalendarWatch,
  getVisioPublicCalendarId,
  getVisioSharedCalendarId,
  getVisioTeamMembers,
} from "@/lib/visioBookingGoogle";

const WATCH_TTL_SECONDS = 6 * 24 * 60 * 60;
const WATCH_RENEWAL_WINDOW_MS = 24 * 60 * 60_000;

type WatchState = {
  channelId: string;
  resourceId: string;
  expirationMs: number;
};

export type VisioCalendarWatchResult = {
  ok: boolean;
  configured: boolean;
  created: number;
  active: number;
  errors: Array<{ calendarId: string; code: string }>;
};

function watchSecret() {
  return (
    optionalEnv("INRCY_VISIO_GOOGLE_WEBHOOK_SECRET", "").trim() ||
    optionalEnv("VERCEL_CRON_SECRET", "").trim() ||
    optionalEnv("CRON_SECRET", "").trim()
  );
}

function webhookOrigin() {
  const configured = (
    optionalEnv("INRCY_VISIO_GOOGLE_WEBHOOK_ORIGIN", "").trim() ||
    optionalEnv("NEXT_PUBLIC_APP_URL", "").trim() ||
    optionalEnv("NEXT_PUBLIC_SITE_URL", "").trim()
  ).replace(/\/$/, "");
  if (/^https:\/\//i.test(configured) && !/localhost|127\.0\.0\.1/i.test(configured)) {
    return configured;
  }
  const vercelHost = optionalEnv("VERCEL_PROJECT_PRODUCTION_URL", "").trim();
  return vercelHost ? `https://${vercelHost.replace(/^https?:\/\//i, "")}` : "";
}

function watchRedis() {
  const url = optionalEnv("KV_REST_API_URL", "").trim();
  const token = optionalEnv("KV_REST_API_TOKEN", "").trim();
  if (!url || !token) return null;
  const cache = globalThis as typeof globalThis & {
    __inrcy_visio_watch_redis?: Redis;
  };
  cache.__inrcy_visio_watch_redis ||= new Redis({ url, token });
  return cache.__inrcy_visio_watch_redis;
}

function stateKey(calendarId: string) {
  const digest = createHash("sha256").update(calendarId, "utf8").digest("hex");
  return `inrcy:visio-calendar-watch:${digest}`;
}

function calendarWatchToken(calendarId: string) {
  const secret = watchSecret();
  if (!secret) throw new Error("visio_calendar_watch_secret_missing");
  const payload = Buffer.from(calendarId, "utf8").toString("base64url");
  const signature = createHmac("sha256", secret)
    .update(payload, "utf8")
    .digest("base64url");
  return `${payload}.${signature}`;
}

export function calendarIdFromVisioWatchToken(tokenValue: unknown) {
  const token = String(tokenValue || "").trim();
  const secret = watchSecret();
  const [payload, signature, extra] = token.split(".");
  if (!secret || !payload || !signature || extra) return "";
  const expected = createHmac("sha256", secret)
    .update(payload, "utf8")
    .digest("base64url");
  const actualBytes = Buffer.from(signature, "utf8");
  const expectedBytes = Buffer.from(expected, "utf8");
  if (
    actualBytes.length !== expectedBytes.length ||
    !timingSafeEqual(actualBytes, expectedBytes)
  ) {
    return "";
  }
  try {
    return Buffer.from(payload, "base64url").toString("utf8").trim();
  } catch {
    return "";
  }
}

function watchedCalendarIds() {
  return [...new Set([
    getVisioSharedCalendarId(),
    getVisioPublicCalendarId(),
    ...getVisioTeamMembers().map((member) => member.calendarId),
  ].map((value) => value.trim()).filter(Boolean))];
}

function asWatchState(value: unknown): WatchState | null {
  let candidate = value;
  if (typeof candidate === "string") {
    try {
      candidate = JSON.parse(candidate);
    } catch {
      return null;
    }
  }
  if (!candidate || typeof candidate !== "object") return null;
  const row = candidate as Partial<WatchState>;
  const expirationMs = Number(row.expirationMs || 0);
  if (!row.channelId || !row.resourceId || !Number.isFinite(expirationMs)) {
    return null;
  }
  return {
    channelId: String(row.channelId),
    resourceId: String(row.resourceId),
    expirationMs,
  };
}

function watchErrorCode(error: unknown) {
  const message = error instanceof Error ? error.message : "unknown_error";
  const status = message.match(/^visio_google_api_failed:(\d{3}):/)?.[1];
  return status ? `google_${status}` : message.split(":")[0].slice(0, 100);
}

export async function ensureVisioCalendarWatches(): Promise<VisioCalendarWatchResult> {
  const origin = webhookOrigin();
  const redis = watchRedis();
  const secret = watchSecret();
  const result: VisioCalendarWatchResult = {
    ok: true,
    configured: Boolean(origin && redis && secret),
    created: 0,
    active: 0,
    errors: [],
  };
  if (!result.configured || !redis) return result;

  for (const calendarId of watchedCalendarIds()) {
    try {
      const current = asWatchState(await redis.get(stateKey(calendarId)));
      if (
        current &&
        current.expirationMs > Date.now() + WATCH_RENEWAL_WINDOW_MS
      ) {
        result.active += 1;
        continue;
      }

      const channelId = randomUUID();
      const watch = await createVisioGoogleCalendarWatch({
        calendarId,
        channelId,
        address: `${origin}/api/webhooks/google-calendar`,
        token: calendarWatchToken(calendarId),
        ttlSeconds: WATCH_TTL_SECONDS,
      });
      const resourceId = String(watch.resourceId || "").trim();
      const expirationMs = Number(watch.expiration || 0);
      if (!resourceId || !Number.isFinite(expirationMs) || expirationMs <= Date.now()) {
        throw new Error("visio_calendar_watch_response_invalid");
      }
      await redis.set(
        stateKey(calendarId),
        { channelId, resourceId, expirationMs },
        { ex: WATCH_TTL_SECONDS },
      );
      result.created += 1;
    } catch (error) {
      result.errors.push({ calendarId, code: watchErrorCode(error) });
    }
  }
  result.ok = result.errors.length === 0;
  return result;
}

export function isWatchedVisioCalendar(calendarId: string) {
  const normalized = calendarId.trim().toLowerCase();
  return watchedCalendarIds().some(
    (candidate) => candidate.trim().toLowerCase() === normalized,
  );
}

