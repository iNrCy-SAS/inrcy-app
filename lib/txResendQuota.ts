import "server-only";
import { createHash } from "node:crypto";
import { Redis } from "@upstash/redis";
import { shouldBypassUpstashInCurrentEnv } from "@/lib/upstashMode";
import type { ResendQuotaScope } from "./resendFailurePolicy";

export type TxResendQuotaState = {
  scope: ResendQuotaScope;
  observedAt: string;
  retryAt: string;
  retryAtIsEstimate: boolean;
  storage: "shared" | "instance";
};
export type TxResendQuotaStatus = {
  state: TxResendQuotaState | null;
  storage: "shared" | "instance" | "unavailable";
};
type QuotaGlobals = typeof globalThis & {
  __inrcy_tx_resend_quota_redis?: Redis;
  __inrcy_tx_resend_quota_local?: Map<string, TxResendQuotaState>;
};

function keyFor(apiKey: string) {
  const accountScope = String(process.env.RESEND_QUOTA_SCOPE_ID || "").trim();
  const fingerprint = createHash("sha256").update(accountScope ? `account:${accountScope}` : `key:${apiKey}`).digest("hex").slice(0, 32);
  return `tx-resend:quota:${fingerprint}`;
}
function localStates() {
  return ((globalThis as QuotaGlobals).__inrcy_tx_resend_quota_local ||= new Map());
}
function redisClient() {
  if (shouldBypassUpstashInCurrentEnv()) return null;
  const url = String(process.env.KV_REST_API_URL || "").trim();
  const token = String(process.env.KV_REST_API_TOKEN || "").trim();
  if (!url || !token) return null;
  return ((globalThis as QuotaGlobals).__inrcy_tx_resend_quota_redis ||= new Redis({
    url, token, retry: false, signal: () => AbortSignal.timeout(350),
  }));
}
function validState(value: unknown): value is TxResendQuotaState {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TxResendQuotaState>;
  return (candidate.scope === "daily" || candidate.scope === "monthly") &&
    typeof candidate.retryAt === "string" && Number.isFinite(Date.parse(candidate.retryAt)) &&
    typeof candidate.observedAt === "string" && Number.isFinite(Date.parse(candidate.observedAt)) &&
    typeof candidate.retryAtIsEstimate === "boolean";
}

/** Shared across serverless instances when Redis is available; no email payload is stored. */
export async function readTxResendQuotaStatus(apiKey: string): Promise<TxResendQuotaStatus> {
  if (!apiKey) return { state: null, storage: "unavailable" };
  const key = keyFor(apiKey), now = Date.now(), local = localStates().get(key);
  const redis = redisClient();
  if (redis) {
    try {
      const stored = await redis.get<TxResendQuotaState>(key);
      if (validState(stored) && Date.parse(stored.retryAt) > now) {
        const state = { ...stored, storage: "shared" as const };
        localStates().set(key, state);
        return { state, storage: "shared" };
      }
      if (local && Date.parse(local.retryAt) > now) return { state: { ...local, storage: "instance" }, storage: "instance" };
      localStates().delete(key);
      return { state: null, storage: "shared" };
    } catch {
      // Report degraded persistence explicitly instead of claiming a global circuit.
    }
  }
  if (local && Date.parse(local.retryAt) > now) return { state: { ...local, storage: "instance" }, storage: "instance" };
  localStates().delete(key);
  return { state: null, storage: redis ? "unavailable" : "instance" };
}

export async function readTxResendQuotaState(apiKey: string): Promise<TxResendQuotaState | null> {
  return (await readTxResendQuotaStatus(apiKey)).state;
}

export async function rememberTxResendQuota(apiKey: string, observation: Omit<TxResendQuotaState, "storage">): Promise<TxResendQuotaState> {
  const key = keyFor(apiKey);
  const ttl = Math.max(1, Math.ceil((Date.parse(observation.retryAt) - Date.now()) / 1000));
  let state: TxResendQuotaState = { ...observation, storage: "instance" };
  localStates().set(key, state);
  const redis = redisClient();
  if (redis) {
    try {
      await redis.set(key, { ...observation, storage: "shared" }, { ex: ttl });
      state = { ...observation, storage: "shared" };
      localStates().set(key, state);
    } catch {
      // A known quota still blocks this instance; callers can see it is not shared.
    }
  }
  return state;
}
