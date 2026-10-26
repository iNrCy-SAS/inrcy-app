import "server-only";

import { Redis } from "@upstash/redis";
import type { DashboardEdition } from "./dashboardEdition.ts";
import { hasInrAssistantPremiumAccess, type InrAssistantComplexity } from "./inrAssistantPolicy.ts";
import { shouldBypassUpstashInCurrentEnv } from "./upstashMode.ts";

const QUOTA_TTL_SECONDS = 40 * 24 * 60 * 60;

export type InrAssistantRequestQuota = {
  billingAccountId: string;
  requestId: string;
  windowId: string;
  solReserved: boolean;
  trackingAvailable: boolean;
};

// Both keys share a cluster hash tag. A pending cheap request earns no Sol
// allowance; only a successful finalization counts it in the denominator.
const RESERVE_REQUEST_SCRIPT = `
local existingSol = redis.call('HGET', KEYS[2], 'sol')
if existingSol then return tonumber(existingSol) end
local total = tonumber(redis.call('HGET', KEYS[1], 'requests') or '0')
local sol = tonumber(redis.call('HGET', KEYS[1], 'sol') or '0')
if not total or not sol or total < 0 or sol < 0 or sol > total or total ~= math.floor(total) or sol ~= math.floor(sol) then
  return redis.error_reply('invalid assistant quota counters')
end
local grant = 0
if tonumber(ARGV[1]) == 1 and (sol + 1) * 5 <= total + 1 then
  grant = 1
  redis.call('HINCRBY', KEYS[1], 'requests', 1)
  redis.call('HINCRBY', KEYS[1], 'sol', 1)
end
redis.call('HSET', KEYS[2], 'sol', grant, 'state', 'pending')
redis.call('EXPIRE', KEYS[2], tonumber(ARGV[2]))
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
return grant
`;

const FINALIZE_REQUEST_SCRIPT = `
local state = redis.call('HGET', KEYS[2], 'state')
if state ~= 'pending' then return 0 end
local sol = redis.call('HGET', KEYS[2], 'sol')
if sol ~= '1' and tonumber(ARGV[1]) == 1 then
  redis.call('HINCRBY', KEYS[1], 'requests', 1)
end
-- A Sol attempt keeps both its numerator and denominator even after failure.
-- Cheap failures never manufacture allowance for future Sol requests.
redis.call('HSET', KEYS[2], 'state', 'done')
redis.call('EXPIRE', KEYS[2], tonumber(ARGV[2]))
redis.call('EXPIRE', KEYS[1], tonumber(ARGV[2]))
return 1
`;

function getRedis(): Redis | null {
  if (shouldBypassUpstashInCurrentEnv()) return null;
  const url = String(process.env.KV_REST_API_URL || "").trim();
  const token = String(process.env.KV_REST_API_TOKEN || "").trim();
  if (!url || !token) return null;
  const global = globalThis as typeof globalThis & { __inrcy_assistant_quota_redis?: Redis };
  if (!global.__inrcy_assistant_quota_redis) global.__inrcy_assistant_quota_redis = new Redis({ url, token });
  return global.__inrcy_assistant_quota_redis;
}

function checkedId(value: string, label: string): string {
  const id = String(value || "").trim();
  if (!id || id.length > 180) throw new Error(`Invalid assistant ${label}.`);
  return id;
}

function keys(quota: InrAssistantRequestQuota): [string, string] {
  const tag = `${encodeURIComponent(quota.billingAccountId)}:${quota.windowId}`;
  const prefix = `inrcy_assistant:v1:{${tag}}`;
  return [`${prefix}:usage`, `${prefix}:request:${encodeURIComponent(quota.requestId)}`];
}

/** Called exactly once per admitted user request, with a server-generated requestId. */
export async function reserveInrAssistantRequest(args: {
  billingAccountId: string;
  requestId: string;
  edition: DashboardEdition;
  complexity: InrAssistantComplexity;
  now?: Date;
}): Promise<InrAssistantRequestQuota> {
  const now = args.now ?? new Date();
  if (!Number.isFinite(now.getTime())) throw new Error("Invalid assistant quota date.");
  const quota: InrAssistantRequestQuota = {
    billingAccountId: checkedId(args.billingAccountId, "billing account"),
    requestId: checkedId(args.requestId, "request ID"),
    windowId: `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`,
    solReserved: false,
    trackingAvailable: false,
  };
  try {
    const redis = getRedis();
    if (!redis) return quota;
    const eligible = args.complexity === "complex" && hasInrAssistantPremiumAccess(args.edition);
    const granted = Number(await redis.eval(RESERVE_REQUEST_SCRIPT, keys(quota), [Number(eligible), QUOTA_TTL_SECONDS]));
    if (granted !== 0 && granted !== 1) throw new Error("Unexpected assistant quota response.");
    quota.trackingAvailable = true;
    // Recheck eligibility even if a caller accidentally reused a request ID after a plan change.
    quota.solReserved = eligible && granted === 1;
  } catch {
    // Economic engines remain available; an unavailable counter can never unlock Sol.
    console.warn("[inr-assistant-quota] allowance unavailable; using economical models");
  }
  return quota;
}

/** Finalize only after an actual response; repeated calls are idempotent in Redis. */
export async function finalizeInrAssistantRequest(
  quota: InrAssistantRequestQuota,
  outcome: { success: boolean },
): Promise<void> {
  if (!quota.trackingAvailable) return;
  try {
    const redis = getRedis();
    if (!redis) return;
    await redis.eval(FINALIZE_REQUEST_SCRIPT, keys(quota), [Number(outcome.success), QUOTA_TTL_SECONDS]);
  } catch {
    // Missing a cheap success undercounts the denominator and is conservative.
    // A Sol reservation is already durably debited before the provider is called.
    console.warn("[inr-assistant-quota] finalization unavailable; reserved allowance retained");
  }
}
