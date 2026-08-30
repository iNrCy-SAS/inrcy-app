import "server-only";

import { randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";

import { optionalEnv } from "@/lib/env";
import { log } from "@/lib/observability/logger";
import {
  deliverSignupFailureAlert,
  type SignupFailureAlertClaim,
  type SignupFailureAlertClaimDecision,
} from "@/lib/signupFailureAlertDelivery";
import type { SignupFailureAlertInput } from "@/lib/signupFailureAlertPolicy";
import { sendMonitoringMail } from "@/lib/txMailer";
import { shouldBypassUpstashInCurrentEnv } from "@/lib/upstashMode";

type GlobalWithSignupFailureAlert = typeof globalThis & {
  __inrcy_signup_failure_alert_redis?: Redis;
  __inrcy_signup_failure_alert_local?: Map<string, LocalClaimState>;
};

type LocalClaimState = {
  state: "pending" | "sent";
  expiresAt: number;
  token?: string;
};

const CLAIM_TTL_SECONDS = 120;
const DEFAULT_DEDUPE_SECONDS = 15 * 60;

function getLocalClaims() {
  const globalCache = globalThis as GlobalWithSignupFailureAlert;
  return (globalCache.__inrcy_signup_failure_alert_local ||= new Map());
}

function getDedupeSeconds() {
  const configured = Number(optionalEnv("INRCY_SIGNUP_FAILURE_ALERT_DEDUPE_SECONDS", "900"));
  if (!Number.isFinite(configured)) return DEFAULT_DEDUPE_SECONDS;
  return Math.min(24 * 60 * 60, Math.max(60, Math.floor(configured)));
}

function getRedis() {
  if (shouldBypassUpstashInCurrentEnv()) return null;
  const url = optionalEnv("KV_REST_API_URL", "").trim();
  const token = optionalEnv("KV_REST_API_TOKEN", "").trim();
  if (!url || !token) return null;

  const globalCache = globalThis as GlobalWithSignupFailureAlert;
  if (!globalCache.__inrcy_signup_failure_alert_redis) {
    globalCache.__inrcy_signup_failure_alert_redis = new Redis({ url, token });
  }
  return globalCache.__inrcy_signup_failure_alert_redis;
}

function localClaim(key: string): SignupFailureAlertClaimDecision {
  const claims = getLocalClaims();
  const now = Date.now();

  if (claims.size > 2_000) {
    for (const [candidate, value] of claims) {
      if (value.expiresAt <= now) claims.delete(candidate);
    }
  }

  const current = claims.get(key);
  if (current && current.expiresAt > now) {
    return current.state === "sent" ? { status: "sent" } : { status: "pending" };
  }

  const token = `pending:${randomUUID()}`;
  claims.set(key, {
    state: "pending",
    expiresAt: now + CLAIM_TTL_SECONDS * 1_000,
    token,
  });
  return { status: "acquired", claim: { key, remote: false, token } };
}

async function claimAlert(fingerprint: string): Promise<SignupFailureAlertClaimDecision> {
  const key = `signup-failure-alert:v1:${fingerprint}`;
  const local = getLocalClaims().get(key);
  if (local && local.expiresAt > Date.now()) {
    return local.state === "sent" ? { status: "sent" } : { status: "pending" };
  }

  const redis = getRedis();

  if (redis) {
    const token = `pending:${randomUUID()}`;
    try {
      const result = await redis.set(key, token, {
        nx: true,
        ex: CLAIM_TTL_SECONDS,
      });
      if (result === "OK") {
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

      getLocalClaims().set(key, {
        state: "pending",
        expiresAt: Date.now() + CLAIM_TTL_SECONDS * 1_000,
        token: existing.startsWith("pending:") ? existing : undefined,
      });
      return { status: "pending" };
    } catch (error) {
      log.warn("signup_failure_alert_dedupe_fallback", {
        error_code: error instanceof Error ? error.name : "redis_unavailable",
      });
    }
  }

  return localClaim(key);
}

async function commitAlert(claim: SignupFailureAlertClaim) {
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
      // Le mail est déjà parti : l'état distribué doit refléter ce fait même si le lease a expiré.
      await redis.set(claim.key, "sent", { ex: dedupeSeconds });
    }
  } catch (error) {
    log.warn("signup_failure_alert_dedupe_commit_failed", {
      error_code: error instanceof Error ? error.name : "redis_unavailable",
    });
  }
}

async function releaseAlert(claim: SignupFailureAlertClaim) {
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
  } catch (error) {
    log.warn("signup_failure_alert_dedupe_release_failed", {
      error_code: error instanceof Error ? error.name : "redis_unavailable",
    });
  }
}

export async function sendSignupFailureAlert(input: SignupFailureAlertInput) {
  return deliverSignupFailureAlert(input, {
    destination: optionalEnv(
      "INRCY_SIGNUP_FAILURE_ALERT_EMAIL",
      optionalEnv("INRCY_NEW_USER_ALERT_EMAIL", "compte@inrcy.com"),
    ),
    claim: claimAlert,
    commit: commitAlert,
    release: releaseAlert,
    sendMail: sendMonitoringMail,
  });
}
