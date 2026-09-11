import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";

import { optionalEnv } from "@/lib/env";
import {
  deliverLoginFailureAlert,
  getLoginFailureCounterKey,
  resetLoginFailureCounters,
  type LoginFailureMailClaim,
  type LoginFailureMailClaimDecision,
} from "@/lib/loginFailureAlertDelivery";
import {
  LOGIN_FAILURE_CATEGORIES,
  createLoginTelemetryFingerprint,
  normalizeLoginEmail,
  resolveUniqueLoginIdentity,
  type LoginFailureCategory,
  type LoginFailureMailInput,
  type LoginFailureSignal,
  type LoginIdentityProfile,
  type LoginIdentitySubscription,
} from "@/lib/loginFailureAlertPolicy";
import { log } from "@/lib/observability/logger";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { sendMonitoringMailWithResult } from "@/lib/txMailer";
import { shouldBypassUpstashInCurrentEnv } from "@/lib/upstashMode";

const REQUIRED_ALERT_RECIPIENT = "contact@inrcy.com";
const FORBIDDEN_ALERT_RECIPIENT = "compte@inrcy.com";
const DEFAULT_WINDOW_SECONDS = 15 * 60;
const DEFAULT_DEDUPE_SECONDS = 24 * 60 * 60;
const CLAIM_TTL_SECONDS = 120;
const DEFAULT_GLOBAL_MAIL_LIMIT = 20;
const IDENTITY_QUERY_LIMIT = 20;
const PROFILE_SELECT =
  "user_id,admin_email,contact_email,first_name,last_name,company_legal_name,phone";

type LocalCounter = { count: number; expiresAt: number };
type LocalClaim = {
  state: "pending" | "sent";
  expiresAt: number;
  token?: string;
};

type LoginFailureGlobal = typeof globalThis & {
  __inrcy_login_failure_redis?: Redis;
  __inrcy_login_failure_counters?: Map<string, LocalCounter>;
  __inrcy_login_failure_claims?: Map<string, LocalClaim>;
  __inrcy_login_failure_fingerprint_secret?: string;
};

class LoginFailureMonitoringError extends Error {
  constructor(public readonly safeCode: string) {
    super(safeCode);
    this.name = "LoginFailureMonitoringError";
  }
}

function boundedIntegerEnv(name: string, fallback: number, min: number, max: number) {
  const parsed = Number(optionalEnv(name, String(fallback)));
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.floor(parsed)));
}

function getWindowSeconds() {
  return boundedIntegerEnv(
    "INRCY_LOGIN_FAILURE_WINDOW_SECONDS",
    DEFAULT_WINDOW_SECONDS,
    60,
    60 * 60,
  );
}

function getDedupeSeconds() {
  return boundedIntegerEnv(
    "INRCY_LOGIN_FAILURE_DEDUPE_SECONDS",
    DEFAULT_DEDUPE_SECONDS,
    5 * 60,
    7 * 24 * 60 * 60,
  );
}

function getGlobalMailLimit() {
  return boundedIntegerEnv(
    "INRCY_LOGIN_FAILURE_GLOBAL_MAIL_LIMIT_PER_HOUR",
    DEFAULT_GLOBAL_MAIL_LIMIT,
    1,
    100,
  );
}

function getRedis() {
  if (shouldBypassUpstashInCurrentEnv()) return null;
  const url = optionalEnv("KV_REST_API_URL", "").trim();
  const token = optionalEnv("KV_REST_API_TOKEN", "").trim();
  if (!url || !token) return null;

  const cache = globalThis as LoginFailureGlobal;
  if (!cache.__inrcy_login_failure_redis) {
    cache.__inrcy_login_failure_redis = new Redis({ url, token });
  }
  return cache.__inrcy_login_failure_redis;
}

function getLocalCounters() {
  const cache = globalThis as LoginFailureGlobal;
  return (cache.__inrcy_login_failure_counters ||= new Map());
}

function getLocalClaims() {
  const cache = globalThis as LoginFailureGlobal;
  return (cache.__inrcy_login_failure_claims ||= new Map());
}

function cleanupLocalState(now = Date.now()) {
  const counters = getLocalCounters();
  const claims = getLocalClaims();
  if (counters.size + claims.size < 4_000) return;
  for (const [key, state] of counters) {
    if (state.expiresAt <= now) counters.delete(key);
  }
  for (const [key, state] of claims) {
    if (state.expiresAt <= now) claims.delete(key);
  }
}

function alertClaimKey(userId: string, category: LoginFailureCategory) {
  return `login-failure-mail:v1:${userId}:${category}`;
}

function incrementLocalCounter(key: string, ttlSeconds: number) {
  const counters = getLocalCounters();
  const now = Date.now();
  cleanupLocalState(now);
  const current = counters.get(key);
  const state = !current || current.expiresAt <= now
    ? { count: 0, expiresAt: now + ttlSeconds * 1_000 }
    : current;
  state.count += 1;
  counters.set(key, state);
  return state.count;
}

async function incrementFailureCounter(input: LoginFailureMailInput) {
  const key = getLoginFailureCounterKey(input.userId, input.category);
  const ttlSeconds = getWindowSeconds();
  const redis = getRedis();
  if (redis) {
    try {
      const count = await redis.eval(
        "local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('EXPIRE', KEYS[1], ARGV[1]); end; return count;",
        [key],
        [String(ttlSeconds)],
      );
      return Math.max(1, Number(count) || 1);
    } catch {
      log.warn("login_failure_redis_fallback", { operation: "increment" });
    }
  }
  return incrementLocalCounter(key, ttlSeconds);
}

function claimLocally(key: string): LoginFailureMailClaimDecision {
  const claims = getLocalClaims();
  const now = Date.now();
  cleanupLocalState(now);
  const existing = claims.get(key);
  if (existing && existing.expiresAt > now) {
    return existing.state === "sent" ? { status: "sent" } : { status: "pending" };
  }

  const token = `pending:${randomUUID()}`;
  claims.set(key, {
    state: "pending",
    expiresAt: now + CLAIM_TTL_SECONDS * 1_000,
    token,
  });
  return { status: "acquired", claim: { key, remote: false, token } };
}

async function claimAlert(input: LoginFailureMailInput): Promise<LoginFailureMailClaimDecision> {
  const key = alertClaimKey(input.userId, input.category);
  const local = getLocalClaims().get(key);
  if (local && local.expiresAt > Date.now()) {
    return local.state === "sent" ? { status: "sent" } : { status: "pending" };
  }

  const redis = getRedis();
  if (redis) {
    const token = `pending:${randomUUID()}`;
    try {
      const acquired = await redis.set(key, token, { nx: true, ex: CLAIM_TTL_SECONDS });
      if (acquired === "OK") {
        getLocalClaims().set(key, {
          state: "pending",
          expiresAt: Date.now() + CLAIM_TTL_SECONDS * 1_000,
          token,
        });
        return { status: "acquired", claim: { key, remote: true, token } };
      }

      const existing = String((await redis.get<string>(key)) || "");
      if (existing === "sent") {
        getLocalClaims().set(key, {
          state: "sent",
          expiresAt: Date.now() + getDedupeSeconds() * 1_000,
        });
        return { status: "sent" };
      }
      return { status: "pending" };
    } catch {
      log.warn("login_failure_redis_fallback", { operation: "claim" });
    }
  }

  return claimLocally(key);
}

async function commitAlert(claim: LoginFailureMailClaim) {
  const dedupeSeconds = getDedupeSeconds();
  getLocalClaims().set(claim.key, {
    state: "sent",
    expiresAt: Date.now() + dedupeSeconds * 1_000,
  });
  if (!claim.remote) return;

  const redis = getRedis();
  if (!redis) return;
  try {
    const committed = await redis.eval(
      "local current = redis.call('GET', KEYS[1]); if current == ARGV[1] then redis.call('SET', KEYS[1], 'sent', 'EX', ARGV[2]); return 1; end; if current == 'sent' then return 1; end; return 0;",
      [claim.key],
      [claim.token, String(dedupeSeconds)],
    );
    if (Number(committed) !== 1) {
      await redis.set(claim.key, "sent", { ex: dedupeSeconds });
    }
  } catch {
    log.warn("login_failure_redis_commit_failed", { operation: "commit" });
  }
}

async function releaseAlert(claim: LoginFailureMailClaim) {
  const local = getLocalClaims().get(claim.key);
  if (local?.state === "pending" && local.token === claim.token) {
    getLocalClaims().delete(claim.key);
  }
  if (!claim.remote) return;

  const redis = getRedis();
  if (!redis) return;
  try {
    await redis.eval(
      "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]); end; return 0;",
      [claim.key],
      [claim.token],
    );
  } catch {
    log.warn("login_failure_redis_release_failed", { operation: "release" });
  }
}

async function reserveGlobalCapacity() {
  const limit = getGlobalMailLimit();
  const key = "login-failure-mail-cap:v1:global";
  const redis = getRedis();
  if (redis) {
    try {
      const count = await redis.eval(
        "local count = redis.call('INCR', KEYS[1]); if count == 1 then redis.call('EXPIRE', KEYS[1], 3600); end; return count;",
        [key],
        [],
      );
      return Number(count) <= limit;
    } catch {
      log.warn("login_failure_redis_fallback", { operation: "global_capacity" });
    }
  }
  return incrementLocalCounter(key, 60 * 60) <= limit;
}

function getAlertRecipients() {
  const configured = optionalEnv("INRCY_LOGIN_FAILURE_ALERT_EMAIL", "")
    .split(/[;,]/)
    .map((value) => normalizeLoginEmail(value))
    .filter((value) => value && value !== FORBIDDEN_ALERT_RECIPIENT);
  return Array.from(new Set([REQUIRED_ALERT_RECIPIENT, ...configured])).join(", ");
}

function getFingerprintSecret() {
  const cache = globalThis as LoginFailureGlobal;
  if (cache.__inrcy_login_failure_fingerprint_secret) {
    return cache.__inrcy_login_failure_fingerprint_secret;
  }
  const configured =
    optionalEnv("INRCY_LOGIN_FAILURE_HMAC_SECRET", "").trim() ||
    optionalEnv("SUPABASE_SERVICE_ROLE_KEY", "").trim() ||
    optionalEnv("ADMIN_SECRET", "").trim();
  cache.__inrcy_login_failure_fingerprint_secret = configured
    ? createHash("sha256").update(`inrcy-login-monitor\0${configured}`).digest("hex")
    : randomUUID();
  return cache.__inrcy_login_failure_fingerprint_secret;
}

export function fingerprintLoginTelemetryValue(value: string) {
  return createLoginTelemetryFingerprint(value, getFingerprintSecret());
}

function escapeIlikeLiteral(value: string) {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}

function safeProviderCode(error: unknown) {
  const code = String((error as { code?: unknown } | null)?.code || "provider_error")
    .trim()
    .toLowerCase();
  return /^[a-z0-9._-]{1,80}$/.test(code) ? code : "provider_error";
}

async function resolveAccount(email: string) {
  const exactPattern = escapeIlikeLiteral(email);
  const [byAdmin, byProfileContact, bySubscriptionContact] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select(PROFILE_SELECT)
      .ilike("admin_email", exactPattern)
      .limit(IDENTITY_QUERY_LIMIT),
    supabaseAdmin
      .from("profiles")
      .select(PROFILE_SELECT)
      .ilike("contact_email", exactPattern)
      .limit(IDENTITY_QUERY_LIMIT),
    supabaseAdmin
      .from("subscriptions")
      .select("user_id,contact_email")
      .ilike("contact_email", exactPattern)
      .limit(IDENTITY_QUERY_LIMIT),
  ]);

  for (const result of [byAdmin, byProfileContact, bySubscriptionContact]) {
    if (result.error) {
      throw new LoginFailureMonitoringError(
        `identity_lookup_${safeProviderCode(result.error)}`,
      );
    }
  }

  return resolveUniqueLoginIdentity({
    email,
    profilesByAdminEmail: (byAdmin.data || []) as LoginIdentityProfile[],
    profilesByContactEmail: (byProfileContact.data || []) as LoginIdentityProfile[],
    subscriptionsByContactEmail: (bySubscriptionContact.data || []) as LoginIdentitySubscription[],
  });
}

async function loadCanonicalAccount(
  userId: string,
  fallbackProfile: LoginIdentityProfile | null,
) {
  const [authResult, profileResult] = await Promise.all([
    supabaseAdmin.auth.admin.getUserById(userId),
    supabaseAdmin.from("profiles").select(PROFILE_SELECT).eq("user_id", userId).maybeSingle(),
  ]);
  if (authResult.error || !authResult.data?.user) {
    throw new LoginFailureMonitoringError(
      `auth_lookup_${safeProviderCode(authResult.error)}`,
    );
  }
  if (profileResult.error) {
    throw new LoginFailureMonitoringError(
      `profile_lookup_${safeProviderCode(profileResult.error)}`,
    );
  }

  const canonicalEmail = normalizeLoginEmail(authResult.data.user.email);
  if (!canonicalEmail) throw new LoginFailureMonitoringError("canonical_email_missing");
  return {
    authUser: authResult.data.user,
    profile: (profileResult.data || fallbackProfile || null) as LoginIdentityProfile | null,
    canonicalEmail,
  };
}

async function sendRequiredMonitoringMail(mail: {
  to: string;
  subject: string;
  text: string;
  html: string;
}) {
  const delivery = await sendMonitoringMailWithResult(mail);
  const accepted = Array.isArray(delivery?.accepted)
    ? delivery.accepted.map((value: unknown) => normalizeLoginEmail(value))
    : [];
  if (!accepted.includes(REQUIRED_ALERT_RECIPIENT)) {
    throw new LoginFailureMonitoringError("required_recipient_rejected");
  }
}

export async function processLoginFailureSignal(
  signal: Extract<LoginFailureSignal, { kind: "failure" }>,
  context: { emailFingerprint: string; ipFingerprint: string },
) {
  const resolution = await resolveAccount(signal.email);
  if (resolution.status !== "matched") {
    log.info("login_failure_identity_unresolved", {
      category: signal.category,
      error_code: signal.errorCode,
      status_code: signal.errorStatus ?? undefined,
      identity_status: resolution.status,
      candidate_count: resolution.status === "ambiguous" ? resolution.candidateCount : 0,
      email_fingerprint: context.emailFingerprint,
      ip_fingerprint: context.ipFingerprint,
    });
    return { status: resolution.status } as const;
  }

  const account = await loadCanonicalAccount(resolution.userId, resolution.profile);
  if (signal.category === "emailUnconfirmed" && account.authUser.email_confirmed_at) {
    log.info("login_failure_signal_not_confirmed_by_server", {
      user_id: resolution.userId,
      category: signal.category,
      error_code: signal.errorCode,
      email_fingerprint: context.emailFingerprint,
      ip_fingerprint: context.ipFingerprint,
    });
    return { status: "server_state_mismatch" } as const;
  }

  const profile = account.profile || {};
  const input: LoginFailureMailInput = {
    category: signal.category,
    errorCode: signal.errorCode,
    errorStatus: signal.errorStatus,
    failureCount: 0,
    occurredAt: new Date().toISOString(),
    userId: resolution.userId,
    canonicalEmail: account.canonicalEmail,
    firstName: String(profile.first_name || ""),
    lastName: String(profile.last_name || ""),
    companyName: String(profile.company_legal_name || ""),
    phone: String(profile.phone || ""),
    createdAt: account.authUser.created_at || null,
    lastSignInAt: account.authUser.last_sign_in_at || null,
    emailConfirmedAt: account.authUser.email_confirmed_at || null,
    matchSources: resolution.sources,
  };

  const outcome = await deliverLoginFailureAlert(input, {
    increment: incrementFailureCounter,
    claim: claimAlert,
    commit: commitAlert,
    release: releaseAlert,
    reserveGlobalCapacity,
    destination: getAlertRecipients(),
    sendMail: sendRequiredMonitoringMail,
  });

  const logContext = {
    user_id: resolution.userId,
    category: signal.category,
    error_code: signal.errorCode,
    status_code: signal.errorStatus ?? undefined,
    failure_count: "failureCount" in outcome ? outcome.failureCount : null,
    threshold: "threshold" in outcome ? outcome.threshold : null,
    outcome: outcome.status,
    email_fingerprint: context.emailFingerprint,
    ip_fingerprint: context.ipFingerprint,
  };
  if (outcome.status === "sent") log.warn("login_failure_alert_sent", logContext);
  else if (outcome.status === "globally_limited") {
    log.warn("login_failure_alert_globally_limited", logContext);
  } else log.info("login_failure_signal_processed", logContext);

  return outcome;
}

export async function clearLoginFailureCountersForUser(userId: string) {
  await resetLoginFailureCounters(userId, LOGIN_FAILURE_CATEGORIES, {
    clearLocal: (keys) => {
      const counters = getLocalCounters();
      for (const key of keys) counters.delete(key);
    },
    clearRemote: async (keys) => {
      const redis = getRedis();
      if (!redis) return;
      try {
        await Promise.all(keys.map((key) => redis.del(key)));
      } catch {
        log.warn("login_failure_redis_reset_failed", { user_id: userId });
      }
    },
  });
  log.info("login_failure_counters_cleared", { user_id: userId });
}

export function getLoginFailureMonitoringSafeCode(error: unknown) {
  if (error instanceof LoginFailureMonitoringError) return error.safeCode;
  const name = error instanceof Error ? error.name.trim().toLowerCase() : "";
  return /^[a-z0-9._-]{1,80}$/.test(name) ? name : "monitoring_error";
}
