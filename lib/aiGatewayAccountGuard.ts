import "server-only";

import { Redis } from "@upstash/redis";

import { shouldBypassUpstashInCurrentEnv } from "@/lib/upstashMode";
import type { AiGenerationFeature } from "@/lib/aiGatewayPolicy";
import { estimateAiGatewayCostMicroUsd } from "@/lib/aiGatewayEconomics";

export class AiGatewayGuardUnavailableError extends Error {
  code = "ai_gateway_guard_unavailable" as const;
  retryAfterSeconds = 300;

  constructor(message = "La protection économique IA est momentanément indisponible. Merci de réessayer dans quelques minutes.") {
    super(message);
    this.name = "AiGatewayGuardUnavailableError";
  }
}

export class AiGatewayAccountLimitError extends Error {
  code = "ai_gateway_account_limit_reached" as const;
  retryAfterSeconds?: number;

  constructor(message = "La limite de sécurité IA de ce compte est atteinte. Merci de réessayer plus tard.", retryAfterSeconds?: number) {
    super(message);
    this.name = "AiGatewayAccountLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

type AiGatewayUsage = {
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
};

type GuardWindow = "day" | "month";

type GuardLimits = {
  dayAttempts: number;
  dayCalls: number;
  dayInputTokens: number;
  dayOutputTokens: number;
  dayCostMicroUsd: number;
  monthAttempts: number;
  monthCalls: number;
  monthInputTokens: number;
  monthOutputTokens: number;
  monthCostMicroUsd: number;
};

export type AiGatewayAccountAttemptReservation = {
  id: string;
  accountId: string;
  estimatedInputTokens: number;
  reservedOutputTokens: number;
  estimatedCostMicroUsd: number;
  state: "reserved" | "committed" | "rolled_back" | "bypassed";
};

const DEFAULT_LIMITS: GuardLimits = {
  dayAttempts: 600,
  dayCalls: 300,
  dayInputTokens: 2_000_000,
  dayOutputTokens: 250_000,
  // A Premium account may legitimately use its full daily media allowance:
  // 10 videos at the guarded $1.50 estimate plus 30 images at $0.065 ~= $16.95.
  // Keep headroom without weakening the independent SQL monthly quotas.
  dayCostMicroUsd: 20_000_000,
  monthAttempts: 12_000,
  monthCalls: 6000,
  monthInputTokens: 40_000_000,
  monthOutputTokens: 5_000_000,
  monthCostMicroUsd: 100_000_000,
};

const WINDOW_TTL_SECONDS: Record<GuardWindow, number> = {
  day: 2 * 24 * 60 * 60,
  month: 40 * 24 * 60 * 60,
};

// Les générations vidéo asynchrones du Gateway peuvent dépasser dix minutes.
// Garder la réservation économique jusqu'au commit évite qu'une vidéo lente
// disparaisse artificiellement du budget de sécurité du compte.
const ATTEMPT_RESERVATION_TTL_SECONDS = 30 * 60;

function cleanId(value: unknown): string {
  return typeof value === "string" ? value.trim().slice(0, 180) : "";
}

function positiveInt(value: unknown, fallback: number): number {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function getLimits(): GuardLimits {
  return {
    dayAttempts: positiveInt(process.env.AI_GATEWAY_MAX_ATTEMPTS_PER_ACCOUNT_DAY, DEFAULT_LIMITS.dayAttempts),
    dayCalls: positiveInt(process.env.AI_GATEWAY_MAX_CALLS_PER_ACCOUNT_DAY, DEFAULT_LIMITS.dayCalls),
    dayInputTokens: positiveInt(process.env.AI_GATEWAY_MAX_INPUT_TOKENS_PER_ACCOUNT_DAY, DEFAULT_LIMITS.dayInputTokens),
    dayOutputTokens: positiveInt(process.env.AI_GATEWAY_MAX_OUTPUT_TOKENS_PER_ACCOUNT_DAY, DEFAULT_LIMITS.dayOutputTokens),
    dayCostMicroUsd: positiveInt(process.env.AI_GATEWAY_MAX_COST_MICRO_USD_PER_ACCOUNT_DAY, DEFAULT_LIMITS.dayCostMicroUsd),
    monthAttempts: positiveInt(process.env.AI_GATEWAY_MAX_ATTEMPTS_PER_ACCOUNT_MONTH, DEFAULT_LIMITS.monthAttempts),
    monthCalls: positiveInt(process.env.AI_GATEWAY_MAX_CALLS_PER_ACCOUNT_MONTH, DEFAULT_LIMITS.monthCalls),
    monthInputTokens: positiveInt(process.env.AI_GATEWAY_MAX_INPUT_TOKENS_PER_ACCOUNT_MONTH, DEFAULT_LIMITS.monthInputTokens),
    monthOutputTokens: positiveInt(process.env.AI_GATEWAY_MAX_OUTPUT_TOKENS_PER_ACCOUNT_MONTH, DEFAULT_LIMITS.monthOutputTokens),
    monthCostMicroUsd: positiveInt(process.env.AI_GATEWAY_MAX_COST_MICRO_USD_PER_ACCOUNT_MONTH, DEFAULT_LIMITS.monthCostMicroUsd),
  };
}

function getRedis(): Redis | null {
  if (shouldBypassUpstashInCurrentEnv()) return null;
  const url = String(process.env.KV_REST_API_URL || "").trim();
  const token = String(process.env.KV_REST_API_TOKEN || "").trim();
  if (!url || !token) return null;
  const g = globalThis as typeof globalThis & { __inrcy_ai_gateway_guard_redis?: Redis };
  if (!g.__inrcy_ai_gateway_guard_redis) g.__inrcy_ai_gateway_guard_redis = new Redis({ url, token });
  return g.__inrcy_ai_gateway_guard_redis;
}

function getUtcWindowId(window: GuardWindow, now = new Date()): string {
  const year = now.getUTCFullYear();
  const month = String(now.getUTCMonth() + 1).padStart(2, "0");
  if (window === "month") return `${year}-${month}`;
  const day = String(now.getUTCDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

type GuardMetric =
  | "attempts"
  | "calls"
  | "failures"
  | "input"
  | "output"
  | "total"
  | "cost_microusd"
  | "reserved_calls"
  | "reserved_input"
  | "reserved_output"
  | "reserved_cost_microusd";

function buildKey(args: { window: GuardWindow; accountId: string; metric: GuardMetric }) {
  return `inrcy_aig:v2:${args.window}:${getUtcWindowId(args.window)}:${args.accountId}:${args.metric}`;
}

function reservationKey(accountId: string, reservationId: string) {
  return `inrcy_aig:v2:reservation:${accountId}:${reservationId}`;
}

async function ensureExpiry(redis: Redis, key: string, nextValue: number, window: GuardWindow) {
  if (nextValue === 1 || await redis.ttl(key) < 1) await redis.expire(key, WINDOW_TTL_SECONDS[window]);
}

function retrySeconds(window: GuardWindow) {
  return window === "day" ? 3600 : 6 * 3600;
}

function newReservationId() {
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

function windowKeys(window: GuardWindow, accountId: string) {
  return [
    buildKey({ window, accountId, metric: "attempts" }),
    buildKey({ window, accountId, metric: "calls" }),
    buildKey({ window, accountId, metric: "input" }),
    buildKey({ window, accountId, metric: "output" }),
    buildKey({ window, accountId, metric: "total" }),
    buildKey({ window, accountId, metric: "cost_microusd" }),
    buildKey({ window, accountId, metric: "reserved_calls" }),
    buildKey({ window, accountId, metric: "reserved_input" }),
    buildKey({ window, accountId, metric: "reserved_output" }),
    buildKey({ window, accountId, metric: "reserved_cost_microusd" }),
  ];
}

function reservationKeys(accountId: string, id: string) {
  return [
    ...windowKeys("day", accountId),
    ...windowKeys("month", accountId),
    reservationKey(accountId, id),
  ];
}

const RESERVE_ATTEMPT_SCRIPT = `
local estInput = tonumber(ARGV[1])
local resOutput = tonumber(ARGV[2])
local estCost = tonumber(ARGV[3])
local dayTtl = tonumber(ARGV[14])
local monthTtl = tonumber(ARGV[15])
local markerTtl = tonumber(ARGV[16])

local function num(key) return tonumber(redis.call('GET', key) or '0') end
local function ensureTtl(key, ttl)
  if redis.call('TTL', key) < 1 then redis.call('EXPIRE', key, ttl) end
end

local function check(base, attemptsLimit, callsLimit, inputLimit, outputLimit, costLimit, windowIndex)
  local attempts = num(KEYS[base])
  local calls = num(KEYS[base+1])
  local input = num(KEYS[base+2])
  local output = num(KEYS[base+3])
  local cost = num(KEYS[base+5])
  local resCalls = num(KEYS[base+6])
  local resInput = num(KEYS[base+7])
  local resOutputNow = num(KEYS[base+8])
  local resCost = num(KEYS[base+9])
  if attempts + 1 > attemptsLimit then return {0, windowIndex, 1} end
  if calls + resCalls + 1 > callsLimit then return {0, windowIndex, 2} end
  if input + resInput + estInput > inputLimit then return {0, windowIndex, 3} end
  if output + resOutputNow + resOutput > outputLimit then return {0, windowIndex, 4} end
  if cost + resCost + estCost > costLimit then return {0, windowIndex, 5} end
  return {1, windowIndex, 0}
end

local dayCheck = check(1, tonumber(ARGV[4]), tonumber(ARGV[5]), tonumber(ARGV[6]), tonumber(ARGV[7]), tonumber(ARGV[8]), 1)
if dayCheck[1] == 0 then return dayCheck end
local monthCheck = check(11, tonumber(ARGV[9]), tonumber(ARGV[10]), tonumber(ARGV[11]), tonumber(ARGV[12]), tonumber(ARGV[13]), 2)
if monthCheck[1] == 0 then return monthCheck end

local function reserve(base, ttl)
  redis.call('INCR', KEYS[base])
  redis.call('INCR', KEYS[base+6])
  redis.call('INCRBY', KEYS[base+7], estInput)
  redis.call('INCRBY', KEYS[base+8], resOutput)
  redis.call('INCRBY', KEYS[base+9], estCost)
  ensureTtl(KEYS[base], ttl)
  -- Les capacités réservées sont temporaires. En cas de crash avant commit/
  -- rollback, elles s'auto-nettoient après la durée maximale d'une requête.
  redis.call('EXPIRE', KEYS[base+6], markerTtl)
  redis.call('EXPIRE', KEYS[base+7], markerTtl)
  redis.call('EXPIRE', KEYS[base+8], markerTtl)
  redis.call('EXPIRE', KEYS[base+9], markerTtl)
end

reserve(1, dayTtl)
reserve(11, monthTtl)
redis.call('SET', KEYS[21], 'reserved', 'EX', markerTtl)
return {1, 0, 0}
`;

const COMMIT_ATTEMPT_SCRIPT = `
local actualInput = tonumber(ARGV[1])
local actualOutput = tonumber(ARGV[2])
local actualTotal = tonumber(ARGV[3])
local actualCost = tonumber(ARGV[4])
local estInput = tonumber(ARGV[5])
local resOutput = tonumber(ARGV[6])
local estCost = tonumber(ARGV[7])
local dayTtl = tonumber(ARGV[8])
local monthTtl = tonumber(ARGV[9])
local state = redis.call('GET', KEYS[21])
if state ~= 'reserved' then return 0 end

local function dec(key, amount)
  local current = tonumber(redis.call('GET', key) or '0')
  local nextValue = current - amount
  if nextValue > 0 then redis.call('SET', key, nextValue, 'KEEPTTL') else redis.call('DEL', key) end
end
local function ensureTtl(key, ttl)
  if redis.call('TTL', key) < 1 then redis.call('EXPIRE', key, ttl) end
end
local function commit(base, ttl)
  dec(KEYS[base+6], 1)
  dec(KEYS[base+7], estInput)
  dec(KEYS[base+8], resOutput)
  dec(KEYS[base+9], estCost)
  redis.call('INCR', KEYS[base+1])
  redis.call('INCRBY', KEYS[base+2], actualInput)
  redis.call('INCRBY', KEYS[base+3], actualOutput)
  redis.call('INCRBY', KEYS[base+4], actualTotal)
  redis.call('INCRBY', KEYS[base+5], actualCost)
  ensureTtl(KEYS[base+1], ttl)
  ensureTtl(KEYS[base+2], ttl)
  ensureTtl(KEYS[base+3], ttl)
  ensureTtl(KEYS[base+4], ttl)
  ensureTtl(KEYS[base+5], ttl)
end
commit(1, dayTtl)
commit(11, monthTtl)
redis.call('SET', KEYS[21], 'committed', 'EX', 3600)
return 1
`;

const ROLLBACK_ATTEMPT_SCRIPT = `
local estInput = tonumber(ARGV[1])
local resOutput = tonumber(ARGV[2])
local estCost = tonumber(ARGV[3])
local state = redis.call('GET', KEYS[21])
if state ~= 'reserved' then return 0 end
local function dec(key, amount)
  local current = tonumber(redis.call('GET', key) or '0')
  local nextValue = current - amount
  if nextValue > 0 then redis.call('SET', key, nextValue, 'KEEPTTL') else redis.call('DEL', key) end
end
local function rollback(base)
  dec(KEYS[base+6], 1)
  dec(KEYS[base+7], estInput)
  dec(KEYS[base+8], resOutput)
  dec(KEYS[base+9], estCost)
end
rollback(1)
rollback(11)
redis.call('SET', KEYS[21], 'rolled_back', 'EX', 3600)
return 1
`;

function limitMessage(windowIndex: number, metricCode: number) {
  const window = windowIndex === 2 ? "month" : "day";
  const suffix = window === "day" ? "quotidienne" : "mensuelle";
  const metric = metricCode === 1
    ? "tentatives"
    : metricCode === 2
      ? "appels"
      : metricCode === 3
        ? "tokens d'entrée"
        : metricCode === 4
          ? "tokens de sortie"
          : "coût de sécurité";
  return {
    window,
    message: `La limite ${suffix} de sécurité IA (${metric}) de ce compte est atteinte. Réessayez plus tard.`,
  } as const;
}

/**
 * Réserve atomiquement une vraie tentative HTTP et sa capacité estimée.
 * Les requêtes concurrentes ne peuvent plus toutes franchir le même plafond.
 */
export async function reserveAiGatewayAccountAttempt(
  accountIdRaw: unknown,
  estimate: { estimatedInputTokens?: number; reservedOutputTokens?: number; estimatedCostMicroUsd?: number } = {},
): Promise<AiGatewayAccountAttemptReservation | null> {
  const accountId = cleanId(accountIdRaw);
  if (!accountId) return null;
  const redis = getRedis();
  if (!redis) {
    if (shouldBypassUpstashInCurrentEnv()) return null;
    throw new AiGatewayGuardUnavailableError();
  }

  const limits = getLimits();
  const estimatedInputTokens = Math.max(0, Math.floor(Number(estimate.estimatedInputTokens || 0)));
  const reservedOutputTokens = Math.max(0, Math.floor(Number(estimate.reservedOutputTokens || 0)));
  const estimatedCostMicroUsd = Math.max(1, Math.floor(Number(estimate.estimatedCostMicroUsd || 0)));
  const id = newReservationId();
  const keys = reservationKeys(accountId, id);

  let result: Array<number | string>;
  try {
    result = await (redis as any).eval(
      RESERVE_ATTEMPT_SCRIPT,
      keys,
      [
        estimatedInputTokens,
        reservedOutputTokens,
        estimatedCostMicroUsd,
        limits.dayAttempts,
        limits.dayCalls,
        limits.dayInputTokens,
        limits.dayOutputTokens,
        limits.dayCostMicroUsd,
        limits.monthAttempts,
        limits.monthCalls,
        limits.monthInputTokens,
        limits.monthOutputTokens,
        limits.monthCostMicroUsd,
        WINDOW_TTL_SECONDS.day,
        WINDOW_TTL_SECONDS.month,
        ATTEMPT_RESERVATION_TTL_SECONDS,
      ],
    ) as Array<number | string>;
  } catch (error) {
    console.error("[ai-gateway-guard] atomic reservation unavailable; guard enforcement is unavailable", {
      accountId,
      message: error instanceof Error ? error.message : String(error),
    });
    throw new AiGatewayGuardUnavailableError();
  }

  if (Number(result?.[0]) !== 1) {
    const { window, message } = limitMessage(Number(result?.[1] || 1), Number(result?.[2] || 1));
    throw new AiGatewayAccountLimitError(message, retrySeconds(window));
  }

  return {
    id,
    accountId,
    estimatedInputTokens,
    reservedOutputTokens,
    estimatedCostMicroUsd,
    state: "reserved",
  };
}

export async function commitAiGatewayAccountAttempt(args: {
  reservation: AiGatewayAccountAttemptReservation | null | undefined;
  feature: AiGenerationFeature;
  model: string;
  usage: AiGatewayUsage;
  /**
   * Image and video models are billed per image / second instead of tokens.
   * Their caller supplies the media estimate explicitly so the global economic
   * guard does not silently record a zero-cost call.
   */
  actualCostMicroUsd?: number;
}): Promise<void> {
  const reservation = args.reservation;
  if (!reservation || reservation.state !== "reserved") return;
  const redis = getRedis();
  if (!redis) {
    reservation.state = "bypassed";
    return;
  }

  const safeUsage: AiGatewayUsage = {
    inputTokens: Math.max(0, Math.floor(Number(args.usage.inputTokens || 0))),
    outputTokens: Math.max(0, Math.floor(Number(args.usage.outputTokens || 0))),
    totalTokens: Math.max(0, Math.floor(Number(args.usage.totalTokens || 0))),
  };
  const explicitCost = Number(args.actualCostMicroUsd);
  const costMicroUsd = Number.isFinite(explicitCost) && explicitCost >= 0
    ? Math.floor(explicitCost)
    : estimateAiGatewayCostMicroUsd(args.model, safeUsage);
  const keys = reservationKeys(reservation.accountId, reservation.id);

  const committed = Number(await (redis as any).eval(
    COMMIT_ATTEMPT_SCRIPT,
    keys,
    [
      safeUsage.inputTokens,
      safeUsage.outputTokens,
      safeUsage.totalTokens,
      costMicroUsd,
      reservation.estimatedInputTokens,
      reservation.reservedOutputTokens,
      reservation.estimatedCostMicroUsd,
      WINDOW_TTL_SECONDS.day,
      WINDOW_TTL_SECONDS.month,
    ],
  ));
  if (committed === 1) reservation.state = "committed";

  // Dimensions de diagnostic non critiques, après le commit économique atomique.
  const featureKey = `inrcy_aig:v2:day:${getUtcWindowId("day")}:${reservation.accountId}:feature:${args.feature}`;
  const modelKey = `inrcy_aig:v2:day:${getUtcWindowId("day")}:${reservation.accountId}:model:${args.model}`;
  await Promise.all([
    redis.incr(featureKey).then(async (next) => ensureExpiry(redis, featureKey, Number(next), "day")),
    redis.incr(modelKey).then(async (next) => ensureExpiry(redis, modelKey, Number(next), "day")),
  ]);
}

export async function rollbackAiGatewayAccountAttempt(
  reservation: AiGatewayAccountAttemptReservation | null | undefined,
): Promise<void> {
  if (!reservation || reservation.state !== "reserved") return;
  const redis = getRedis();
  if (!redis) {
    reservation.state = "bypassed";
    return;
  }
  const rolledBack = Number(await (redis as any).eval(
    ROLLBACK_ATTEMPT_SCRIPT,
    reservationKeys(reservation.accountId, reservation.id),
    [reservation.estimatedInputTokens, reservation.reservedOutputTokens, reservation.estimatedCostMicroUsd],
  ));
  if (rolledBack === 1) reservation.state = "rolled_back";
}

export async function recordAiGatewayAccountFailure(args: { accountId: unknown; feature: AiGenerationFeature; model: string; status?: number }): Promise<void> {
  const accountId = cleanId(args.accountId);
  if (!accountId) return;
  const redis = getRedis();
  if (!redis) return;
  for (const window of ["day", "month"] as const) {
    const key = buildKey({ window, accountId, metric: "failures" });
    const next = Number(await redis.incr(key));
    await ensureExpiry(redis, key, next, window);
  }
  const status = Number(args.status || 0);
  if (status > 0) {
    const key = `inrcy_aig:v2:day:${getUtcWindowId("day")}:${accountId}:failure_status:${status}`;
    const next = Number(await redis.incr(key));
    await ensureExpiry(redis, key, next, "day");
  }
}
