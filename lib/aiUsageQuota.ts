import "server-only";

import { createHash } from "node:crypto";
import { Redis } from "@upstash/redis";
import { NextResponse } from "next/server";

import { requireEnv } from "@/lib/env";
import { shouldBypassUpstashInCurrentEnv } from "@/lib/upstashMode";
import { ADMIN_USER_IDS } from "@/lib/roles";
import type { MailAttachmentRef } from "@/lib/mailAttachmentRefs";

type AiQuotaAction = "booster" | "template" | "mail" | "review_reply" | "agent_stats" | "agent_publish" | "transcription";

export type InrAgentQuotaHorizonDays = 7 | 15 | 30;

type ReserveAiCreditsArgs = {
  supabase: any;
  userId: string;
  action: AiQuotaAction;
  credits: number;
};

type ReserveInrAgentEditorialCreditsArgs = {
  supabase: any;
  userId: string;
  credits: number;
  horizonDays: InrAgentQuotaHorizonDays | number;
  idempotencyKey: string;
};

export type AiCreditReservation = {
  id: string;
  userId: string;
  action: AiQuotaAction;
  credits: number;
  state: "reserved" | "committed" | "rolled_back" | "bypassed";
  quotaScope?: "general" | "inr_agent_editorial";
  horizonDays?: InrAgentQuotaHorizonDays;
  idempotencyDigest?: string;
};

export type AiCreditReservationResult = {
  reservation: AiCreditReservation | null;
  errorResponse: NextResponse | null;
};

// Quota produit : il mesure des unités d'action utilisateur, jamais le nombre
// de canaux ni les sous-appels techniques. Une action texte vaut 1 unité, une
// action avec compréhension image 2, une action vidéo 3.
export const AI_QUOTA_UNIT_MODEL = {
  text: 1,
  image: 2,
  video: 3,
  channelCountMultiplier: false,
} as const;

const DEFAULT_AI_QUOTA_LIMITS = {
  week: 200,
  month: 500,
} as const;

const AI_QUOTA_PERIODS = {
  week: 7 * 24 * 60 * 60,
  month: 30 * 24 * 60 * 60,
} as const;

// L'enveloppe iNr'Agent est volontairement indépendante du quota
// hebdomadaire général. Elle couvre largement le maximum de trois créneaux
// par semaine, même si chacun coûte trois unités vidéo, tout en arrêtant une
// éventuelle boucle bien avant qu'elle puisse vider le quota mensuel.
const DEFAULT_INR_AGENT_QUOTA_LIMITS: Record<InrAgentQuotaHorizonDays, number> = {
  7: 18,
  15: 36,
  30: 72,
};

const INR_AGENT_RESERVATION_SECONDS = 30 * 60;
const INR_AGENT_IDEMPOTENCY_SECONDS = 90 * 24 * 60 * 60;

type QuotaPeriod = keyof typeof DEFAULT_AI_QUOTA_LIMITS;
const QUOTA_PERIODS: QuotaPeriod[] = ["week", "month"];

function positiveInt(value: unknown, fallback: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

export function getAiQuotaLimits() {
  return {
    week: positiveInt(process.env.AI_QUOTA_CREDITS_WEEK, DEFAULT_AI_QUOTA_LIMITS.week),
    month: positiveInt(process.env.AI_QUOTA_CREDITS_MONTH, DEFAULT_AI_QUOTA_LIMITS.month),
  } as const;
}

export function normalizeInrAgentQuotaHorizonDays(
  value: unknown,
): InrAgentQuotaHorizonDays {
  const parsed = Number(value);
  return parsed === 7 || parsed === 30 ? parsed : 15;
}

export function getInrAgentQuotaPolicy(horizonValue: unknown) {
  const horizonDays = normalizeInrAgentQuotaHorizonDays(horizonValue);
  const monthlyLimit = getAiQuotaLimits().month;
  const configuredLimit = positiveInt(
    process.env[`AI_QUOTA_CREDITS_INR_AGENT_${horizonDays}_DAYS`],
    DEFAULT_INR_AGENT_QUOTA_LIMITS[horizonDays],
  );
  return {
    horizonDays,
    cycleSeconds: horizonDays * 24 * 60 * 60,
    // Le plafond mensuel partagé reste toujours l'autorité supérieure.
    limit: Math.min(monthlyLimit, configuredLimit),
    monthlyLimit,
  } as const;
}

function getRedis() {
  const url = requireEnv("KV_REST_API_URL");
  const token = requireEnv("KV_REST_API_TOKEN");
  const g = globalThis as any;
  if (!g.__inrcy_redis) g.__inrcy_redis = new Redis({ url, token });
  return g.__inrcy_redis as Redis;
}

export async function isAdminUserForAi(supabase: any, userId: string) {
  if (!userId) return false;
  if (ADMIN_USER_IDS.includes(userId as any)) return true;
  try {
    const { data } = await supabase.from("profiles").select("role").eq("user_id", userId).maybeSingle();
    return String((data as any)?.role || "") === "admin";
  } catch {
    return false;
  }
}

function quotaKey(kind: "used" | "reserved", period: QuotaPeriod, userId: string) {
  return `inrcy_aiq:v2:${kind}:${period}:${userId}`;
}

function reservationKey(userId: string, reservationId: string) {
  return `inrcy_aiq:v2:reservation:${userId}:${reservationId}`;
}

function inrAgentQuotaKey(
  kind: "used" | "reserved",
  horizonDays: InrAgentQuotaHorizonDays,
  userId: string,
) {
  return `inrcy_aiq:v3:inr_agent:${kind}:${horizonDays}d:${userId}`;
}

function inrAgentReservationKey(userId: string, reservationId: string) {
  return `inrcy_aiq:v3:inr_agent:reservation:${userId}:${reservationId}`;
}

function inrAgentIdempotencyDigest(value: string) {
  return createHash("sha256").update(value).digest("hex");
}

function inrAgentChargeKey(userId: string, digest: string) {
  return `inrcy_aiq:v3:inr_agent:charge:${userId}:${digest}`;
}

function buildQuotaError(period: QuotaPeriod) {
  if (period === "week") return "Vous avez atteint votre quota IA hebdomadaire sur ce compte. Réessayez après le prochain renouvellement.";
  return "Vous avez atteint votre quota IA mensuel sur ce compte. Réessayez après le prochain renouvellement ou contactez iNrCy.";
}

function newReservationId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

const RESERVE_SCRIPT = `
local credits = tonumber(ARGV[1])
local markerTtl = tonumber(ARGV[2])
for i=1,2 do
  local used = tonumber(redis.call('GET', KEYS[i]) or '0')
  local reserved = tonumber(redis.call('GET', KEYS[i+2]) or '0')
  local limit = tonumber(ARGV[i+2])
  if used + reserved + credits > limit then
    local ttl = redis.call('TTL', KEYS[i])
    if ttl < 1 then ttl = redis.call('TTL', KEYS[i+2]) end
    if ttl < 1 then ttl = tonumber(ARGV[i+4]) end
    return {0, i, used, reserved, ttl}
  end
end
for i=1,2 do
  local nextReserved = redis.call('INCRBY', KEYS[i+2], credits)
  redis.call('EXPIRE', KEYS[i+2], markerTtl)
end
redis.call('SET', KEYS[5], 'reserved', 'EX', markerTtl)
return {1, 0, 0, 0, markerTtl}
`;

const COMMIT_SCRIPT = `
local credits = tonumber(ARGV[1])
local state = redis.call('GET', KEYS[5])
if state ~= 'reserved' then return 0 end
for i=1,2 do
  local reserved = tonumber(redis.call('GET', KEYS[i+2]) or '0')
  local nextReserved = reserved - credits
  if nextReserved > 0 then redis.call('SET', KEYS[i+2], nextReserved, 'KEEPTTL') else redis.call('DEL', KEYS[i+2]) end
  local nextUsed = redis.call('INCRBY', KEYS[i], credits)
  if nextUsed == credits or redis.call('TTL', KEYS[i]) < 1 then redis.call('EXPIRE', KEYS[i], tonumber(ARGV[i+1])) end
end
redis.call('SET', KEYS[5], 'committed', 'EX', 3600)
return 1
`;

const ROLLBACK_SCRIPT = `
local credits = tonumber(ARGV[1])
local state = redis.call('GET', KEYS[3])
if state ~= 'reserved' then return 0 end
for i=1,2 do
  local reserved = tonumber(redis.call('GET', KEYS[i]) or '0')
  local nextReserved = reserved - credits
  if nextReserved > 0 then redis.call('SET', KEYS[i], nextReserved, 'KEEPTTL') else redis.call('DEL', KEYS[i]) end
end
redis.call('SET', KEYS[3], 'rolled_back', 'EX', 3600)
return 1
`;

const RESERVE_INR_AGENT_SCRIPT = `
local credits = tonumber(ARGV[1])
local markerTtl = tonumber(ARGV[2])
local chargeState = redis.call('GET', KEYS[6])
if chargeState == 'committed' then
  local ttl = redis.call('TTL', KEYS[6])
  return {2, 0, 0, ttl}
end
if chargeState then
  local ttl = redis.call('TTL', KEYS[6])
  if ttl < 1 then ttl = markerTtl end
  return {3, 0, 0, ttl}
end

local monthUsed = tonumber(redis.call('GET', KEYS[1]) or '0')
local monthReserved = tonumber(redis.call('GET', KEYS[2]) or '0')
local monthLimit = tonumber(ARGV[3])
if monthUsed + monthReserved + credits > monthLimit then
  local ttl = redis.call('TTL', KEYS[1])
  if ttl < 1 then ttl = redis.call('TTL', KEYS[2]) end
  if ttl < 1 then ttl = tonumber(ARGV[5]) end
  return {0, 1, monthUsed, monthReserved, ttl}
end

local agentUsed = tonumber(redis.call('GET', KEYS[3]) or '0')
local agentReserved = tonumber(redis.call('GET', KEYS[4]) or '0')
local agentLimit = tonumber(ARGV[4])
if agentUsed + agentReserved + credits > agentLimit then
  local ttl = redis.call('TTL', KEYS[3])
  if ttl < 1 then ttl = redis.call('TTL', KEYS[4]) end
  if ttl < 1 then ttl = tonumber(ARGV[6]) end
  return {0, 2, agentUsed, agentReserved, ttl}
end

redis.call('INCRBY', KEYS[2], credits)
redis.call('EXPIRE', KEYS[2], markerTtl)
redis.call('INCRBY', KEYS[4], credits)
redis.call('EXPIRE', KEYS[4], markerTtl)
redis.call('SET', KEYS[5], 'reserved', 'EX', markerTtl)
redis.call('SET', KEYS[6], 'reserved:' .. ARGV[7], 'EX', markerTtl)
return {1, 0, 0, markerTtl}
`;

const COMMIT_INR_AGENT_SCRIPT = `
local credits = tonumber(ARGV[1])
local expectedCharge = 'reserved:' .. ARGV[5]
if redis.call('GET', KEYS[5]) ~= 'reserved' then return 0 end
if redis.call('GET', KEYS[6]) ~= expectedCharge then return 0 end

local monthReserved = tonumber(redis.call('GET', KEYS[2]) or '0') - credits
if monthReserved > 0 then redis.call('SET', KEYS[2], monthReserved, 'KEEPTTL') else redis.call('DEL', KEYS[2]) end
local agentReserved = tonumber(redis.call('GET', KEYS[4]) or '0') - credits
if agentReserved > 0 then redis.call('SET', KEYS[4], agentReserved, 'KEEPTTL') else redis.call('DEL', KEYS[4]) end

local monthUsed = redis.call('INCRBY', KEYS[1], credits)
if monthUsed == credits or redis.call('TTL', KEYS[1]) < 1 then redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2])) end
local agentUsed = redis.call('INCRBY', KEYS[3], credits)
if agentUsed == credits or redis.call('TTL', KEYS[3]) < 1 then redis.call('EXPIRE', KEYS[3], tonumber(ARGV[3])) end

redis.call('SET', KEYS[5], 'committed', 'EX', 3600)
redis.call('SET', KEYS[6], 'committed', 'EX', tonumber(ARGV[4]))
return 1
`;

const ROLLBACK_INR_AGENT_SCRIPT = `
local credits = tonumber(ARGV[1])
local expectedCharge = 'reserved:' .. ARGV[2]
if redis.call('GET', KEYS[5]) ~= 'reserved' then return 0 end
if redis.call('GET', KEYS[6]) ~= expectedCharge then return 0 end

local monthReserved = tonumber(redis.call('GET', KEYS[2]) or '0') - credits
if monthReserved > 0 then redis.call('SET', KEYS[2], monthReserved, 'KEEPTTL') else redis.call('DEL', KEYS[2]) end
local agentReserved = tonumber(redis.call('GET', KEYS[4]) or '0') - credits
if agentReserved > 0 then redis.call('SET', KEYS[4], agentReserved, 'KEEPTTL') else redis.call('DEL', KEYS[4]) end
redis.call('SET', KEYS[5], 'rolled_back', 'EX', 3600)
redis.call('DEL', KEYS[6])
return 1
`;

function quotaKeys(userId: string, id: string) {
  const used = QUOTA_PERIODS.map((period) => quotaKey("used", period, userId));
  const reserved = QUOTA_PERIODS.map((period) => quotaKey("reserved", period, userId));
  return { used, reserved, marker: reservationKey(userId, id) };
}

function inrAgentQuotaKeys(
  userId: string,
  id: string,
  horizonDays: InrAgentQuotaHorizonDays,
  idempotencyDigest: string,
) {
  return {
    monthUsed: quotaKey("used", "month", userId),
    monthReserved: quotaKey("reserved", "month", userId),
    agentUsed: inrAgentQuotaKey("used", horizonDays, userId),
    agentReserved: inrAgentQuotaKey("reserved", horizonDays, userId),
    marker: inrAgentReservationKey(userId, id),
    charge: inrAgentChargeKey(userId, idempotencyDigest),
  };
}

function inrAgentRedisKeys(keys: ReturnType<typeof inrAgentQuotaKeys>) {
  return [
    keys.monthUsed,
    keys.monthReserved,
    keys.agentUsed,
    keys.agentReserved,
    keys.marker,
    keys.charge,
  ];
}

export async function reserveAiCredits(args: ReserveAiCreditsArgs): Promise<AiCreditReservationResult> {
  if (!args.userId || await isAdminUserForAi(args.supabase, args.userId)) {
    return { reservation: null, errorResponse: null };
  }

  if (shouldBypassUpstashInCurrentEnv()) {
    if (process.env.NODE_ENV !== "production") {
      return { reservation: null, errorResponse: null };
    }
    return {
      reservation: null,
      errorResponse: NextResponse.json(
        {
          error: "La protection de quota IA est momentanément indisponible. Merci de réessayer dans quelques minutes.",
          user_message: "La protection de quota IA est momentanément indisponible. Merci de réessayer dans quelques minutes.",
          code: "ai_quota_unavailable",
          error_code: "ai_quota_unavailable",
        },
        { status: 503, headers: { "Retry-After": "5" } },
      ),
    };
  }

  const credits = Math.max(1, Math.floor(args.credits || 1));
  const id = newReservationId();
  const reservation: AiCreditReservation = { id, userId: args.userId, action: args.action, credits, state: "reserved", quotaScope: "general" };

  try {
    const redis = getRedis();
    const limits = getAiQuotaLimits();
    const keys = quotaKeys(args.userId, id);
    const result = await (redis as any).eval(
      RESERVE_SCRIPT,
      [...keys.used, ...keys.reserved, keys.marker],
      [credits, 15 * 60, limits.week, limits.month, AI_QUOTA_PERIODS.week, AI_QUOTA_PERIODS.month],
    ) as Array<number | string>;

    if (Number(result?.[0]) !== 1) {
      const periodIndex = Math.max(1, Math.min(2, Number(result?.[1]) || 1)) - 1;
      const period = QUOTA_PERIODS[periodIndex];
      const used = Number(result?.[2] || 0);
      const reserved = Number(result?.[3] || 0);
      const retryAfter = Math.max(60, Number(result?.[4] || AI_QUOTA_PERIODS[period]));
      const limit = limits[period];
      return {
        reservation: null,
        errorResponse: NextResponse.json({
          error: buildQuotaError(period),
          user_message: buildQuotaError(period),
          code: "ai_quota_reached",
          error_code: "ai_quota_reached",
          quota_period: period,
          quota_limit: limit,
          quota_used: used,
          quota_reserved: reserved,
          quota_remaining: Math.max(0, limit - used - reserved),
          credits_requested: credits,
          quota_unit: "ai_action_unit",
          quota_model: "media_weighted_action",
          channel_count_multiplier: false,
          action_unit_cost: credits,
        }, { status: 429, headers: { "Retry-After": String(retryAfter) } }),
      };
    }

    return { reservation, errorResponse: null };
  } catch (error) {
    console.error("[ai-quota] reservation unavailable; quota enforcement is unavailable", {
      action: args.action,
      message: error instanceof Error ? error.message : String(error),
    });
    return {
      reservation: null,
      errorResponse: NextResponse.json(
        {
          error: "La protection de quota IA est momentanément indisponible. Merci de réessayer dans quelques minutes.",
          user_message: "La protection de quota IA est momentanément indisponible. Merci de réessayer dans quelques minutes.",
          code: "ai_quota_unavailable",
          error_code: "ai_quota_unavailable",
        },
        { status: 503, headers: { "Retry-After": "5" } },
      ),
    };
  }
}

export async function reserveInrAgentEditorialCredits(
  args: ReserveInrAgentEditorialCreditsArgs,
): Promise<AiCreditReservationResult> {
  if (!args.userId || await isAdminUserForAi(args.supabase, args.userId)) {
    return { reservation: null, errorResponse: null };
  }

  if (shouldBypassUpstashInCurrentEnv()) {
    if (process.env.NODE_ENV !== "production") {
      return { reservation: null, errorResponse: null };
    }
    return {
      reservation: null,
      errorResponse: NextResponse.json(
        {
          error: "La protection de quota iNr’Agent est momentanément indisponible. Merci de réessayer dans quelques minutes.",
          user_message: "La protection de quota iNr’Agent est momentanément indisponible. Merci de réessayer dans quelques minutes.",
          code: "ai_quota_unavailable",
          error_code: "ai_quota_unavailable",
        },
        { status: 503, headers: { "Retry-After": "5" } },
      ),
    };
  }

  const credits = Math.max(1, Math.floor(args.credits || 1));
  const policy = getInrAgentQuotaPolicy(args.horizonDays);
  const id = newReservationId();
  const idempotencyDigest = inrAgentIdempotencyDigest(args.idempotencyKey);
  const reservation: AiCreditReservation = {
    id,
    userId: args.userId,
    action: "agent_publish",
    credits,
    state: "reserved",
    quotaScope: "inr_agent_editorial",
    horizonDays: policy.horizonDays,
    idempotencyDigest,
  };

  try {
    const redis = getRedis();
    const keys = inrAgentQuotaKeys(
      args.userId,
      id,
      policy.horizonDays,
      idempotencyDigest,
    );
    const result = await (redis as any).eval(
      RESERVE_INR_AGENT_SCRIPT,
      inrAgentRedisKeys(keys),
      [
        credits,
        INR_AGENT_RESERVATION_SECONDS,
        policy.monthlyLimit,
        policy.limit,
        AI_QUOTA_PERIODS.month,
        policy.cycleSeconds,
        id,
      ],
    ) as Array<number | string>;

    const status = Number(result?.[0]);
    if (status === 2) {
      reservation.state = "bypassed";
      return { reservation, errorResponse: null };
    }
    if (status === 3) {
      const retryAfter = Math.max(5, Number(result?.[3] || 30));
      return {
        reservation: null,
        errorResponse: NextResponse.json(
          {
            error: "Ce créneau iNr’Agent est déjà en cours de préparation.",
            user_message: "Ce créneau iNr’Agent est déjà en cours de préparation.",
            code: "inr_agent_preparation_in_progress",
            error_code: "inr_agent_preparation_in_progress",
          },
          { status: 409, headers: { "Retry-After": String(retryAfter) } },
        ),
      };
    }
    if (status !== 1) {
      const quotaKind = Number(result?.[1]) === 1 ? "month" : "inr_agent";
      const used = Number(result?.[2] || 0);
      const reserved = Number(result?.[3] || 0);
      const fallbackTtl = quotaKind === "month"
        ? AI_QUOTA_PERIODS.month
        : policy.cycleSeconds;
      const retryAfter = Math.max(60, Number(result?.[4] || fallbackTtl));
      const limit = quotaKind === "month" ? policy.monthlyLimit : policy.limit;
      const message = quotaKind === "month"
        ? buildQuotaError("month")
        : `Vous avez atteint le quota iNr’Agent de ${policy.horizonDays} jours sur ce compte. Réessayez après le prochain renouvellement.`;
      const code = quotaKind === "month" ? "ai_quota_reached" : "inr_agent_quota_reached";
      return {
        reservation: null,
        errorResponse: NextResponse.json({
          error: message,
          user_message: message,
          code,
          error_code: code,
          quota_period: quotaKind === "month" ? "month" : `inr_agent_${policy.horizonDays}_days`,
          quota_limit: limit,
          quota_used: used,
          quota_reserved: reserved,
          quota_remaining: Math.max(0, limit - used - reserved),
          credits_requested: credits,
          quota_unit: "ai_action_unit",
          quota_model: "media_weighted_action",
          channel_count_multiplier: false,
          action_unit_cost: credits,
          shared_monthly_quota: true,
          weekly_quota_affected: false,
          horizon_days: policy.horizonDays,
        }, { status: 429, headers: { "Retry-After": String(retryAfter) } }),
      };
    }

    return { reservation, errorResponse: null };
  } catch (error) {
    console.error("[ai-quota] iNrAgent reservation unavailable", {
      action: "agent_publish",
      message: error instanceof Error ? error.message : String(error),
    });
    return {
      reservation: null,
      errorResponse: NextResponse.json(
        {
          error: "La protection de quota iNr’Agent est momentanément indisponible. Merci de réessayer dans quelques minutes.",
          user_message: "La protection de quota iNr’Agent est momentanément indisponible. Merci de réessayer dans quelques minutes.",
          code: "ai_quota_unavailable",
          error_code: "ai_quota_unavailable",
        },
        { status: 503, headers: { "Retry-After": "5" } },
      ),
    };
  }
}

export async function commitAiCredits(reservation: AiCreditReservation | null | undefined): Promise<void> {
  if (!reservation || reservation.state !== "reserved") return;
  try {
    const redis = getRedis();
    if (
      reservation.quotaScope === "inr_agent_editorial" &&
      reservation.horizonDays &&
      reservation.idempotencyDigest
    ) {
      const policy = getInrAgentQuotaPolicy(reservation.horizonDays);
      const keys = inrAgentQuotaKeys(
        reservation.userId,
        reservation.id,
        policy.horizonDays,
        reservation.idempotencyDigest,
      );
      await (redis as any).eval(
        COMMIT_INR_AGENT_SCRIPT,
        inrAgentRedisKeys(keys),
        [
          reservation.credits,
          AI_QUOTA_PERIODS.month,
          policy.cycleSeconds,
          INR_AGENT_IDEMPOTENCY_SECONDS,
          reservation.id,
        ],
      );
      reservation.state = "committed";
      return;
    }
    const keys = quotaKeys(reservation.userId, reservation.id);
    await (redis as any).eval(
      COMMIT_SCRIPT,
      [...keys.used, ...keys.reserved, keys.marker],
      [reservation.credits, AI_QUOTA_PERIODS.week, AI_QUOTA_PERIODS.month],
    );
    reservation.state = "committed";
  } catch (error) {
    console.warn("[ai-quota] commit unavailable", { action: reservation.action, message: error instanceof Error ? error.message : String(error) });
  }
}

export async function rollbackAiCredits(reservation: AiCreditReservation | null | undefined): Promise<void> {
  if (!reservation || reservation.state !== "reserved") return;
  try {
    const redis = getRedis();
    if (
      reservation.quotaScope === "inr_agent_editorial" &&
      reservation.horizonDays &&
      reservation.idempotencyDigest
    ) {
      const keys = inrAgentQuotaKeys(
        reservation.userId,
        reservation.id,
        reservation.horizonDays,
        reservation.idempotencyDigest,
      );
      await (redis as any).eval(
        ROLLBACK_INR_AGENT_SCRIPT,
        inrAgentRedisKeys(keys),
        [reservation.credits, reservation.id],
      );
      reservation.state = "rolled_back";
      return;
    }
    const keys = quotaKeys(reservation.userId, reservation.id);
    await (redis as any).eval(ROLLBACK_SCRIPT, [...keys.reserved, keys.marker], [reservation.credits]);
    reservation.state = "rolled_back";
  } catch (error) {
    console.warn("[ai-quota] rollback unavailable", { action: reservation.action, message: error instanceof Error ? error.message : String(error) });
  }
}


function attachmentKind(ref: MailAttachmentRef) {
  const name = String(ref?.name || ref?.path || "").toLowerCase();
  const type = String(ref?.type || "").toLowerCase();
  if (type.startsWith("video/") || /\.(mp4|mov|webm|m4v)$/i.test(name)) return "video" as const;
  if (type.startsWith("image/") || /\.(png|jpe?g|webp|gif)$/i.test(name)) return "image" as const;
  return "document" as const;
}

export function computeMailAiCredits(refs: MailAttachmentRef[]) {
  const kinds = refs.map(attachmentKind);
  if (kinds.includes("video")) return 3;
  if (kinds.includes("image")) return 2;
  return 1;
}

export function computeTemplateAiCredits(refs: MailAttachmentRef[]) {
  const kinds = refs.map(attachmentKind);
  if (kinds.includes("video")) return 3;
  if (kinds.includes("image")) return 2;
  return 1;
}

export function computeBoosterAiCredits(args: { mediaType?: unknown; imagesForAI?: Array<unknown>; videoForAI?: unknown }) {
  const mediaType = args.mediaType === "video" ? "video" : "images";
  const hasVideo = mediaType === "video" && !!args.videoForAI;
  const hasImages = Array.isArray(args.imagesForAI) && args.imagesForAI.length > 0;
  if (hasVideo) return AI_QUOTA_UNIT_MODEL.video;
  if (hasImages) return AI_QUOTA_UNIT_MODEL.image;
  return AI_QUOTA_UNIT_MODEL.text;
}

export function computeReviewReplyAiCredits(_args: { rating?: unknown; comment?: unknown; existingReply?: unknown }) {
  return 1;
}
