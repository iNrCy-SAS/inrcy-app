import "server-only";

import { createHash, randomUUID } from "node:crypto";
import { Redis } from "@upstash/redis";
import { optionalEnv } from "@/lib/env";
import { shouldBypassUpstashInCurrentEnv } from "@/lib/upstashMode";

const LEASE_SECONDS = 180;
const SAFE_REPLAY_MS = 23 * 60 * 60 * 1_000;
const ATTEMPT_METADATA = "inrcy_checkout_attempt";
const RENEW = "-- checkout-renew\nif redis.call('GET', KEYS[1]) ~= ARGV[1] then return 0 end; redis.call('EXPIRE', KEYS[1], ARGV[2]); return 1";
const RELEASE = "-- checkout-release\nif redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) end; return 0";
const SAVE = "-- checkout-save\nif redis.call('GET', KEYS[1]) ~= ARGV[1] or redis.call('GET', KEYS[2]) ~= ARGV[1] then return 0 end; redis.call('SET', KEYS[3], ARGV[2]); return 1";

export class CheckoutGuardError extends Error {
  constructor(public readonly code: string, public readonly status: 409 | 503 = 409) {
    super(code);
    this.name = "CheckoutGuardError";
  }
}

type Row = Record<string, unknown>;
type StripeGet = (path: string) => Promise<unknown>;
type StripePost = (path: string, params: URLSearchParams, options?: { idempotencyKey?: string | null }) => Promise<unknown>;
type Attempt = {
  version: 1;
  userId: string;
  customerId: string;
  id: string;
  fingerprint: string;
  params: string;
  createdAt: number;
  sessionId?: string;
};
export type GuardedCheckoutSession = { id: string; url: string; reused: boolean; trialEndUnix: number | null };
export type CheckoutSessionInput = {
  customerId: string;
  params: URLSearchParams;
  /** Stable original trial deadline, before Checkout's technical 48-hour extension. */
  trialSourceEndUnix?: number | null;
  get: StripeGet;
  post: StripePost;
  isCommercialPrice: (priceId: string) => boolean;
  assertNoLiveSubscription: () => Promise<void>;
};
export type StripeCheckoutGuard = {
  assertOwned: () => Promise<void>;
  resolveSession: (input: CheckoutSessionInput) => Promise<GuardedCheckoutSession>;
};

function row(value: unknown): Row {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new CheckoutGuardError("CHECKOUT_STATE_UNCERTAIN");
  return value as Row;
}
function id(value: unknown): string {
  return typeof value === "string" ? value : value && typeof value === "object" ? String((value as Row).id || "") : "";
}
function hash(value: string) { return createHash("sha256").update(value).digest("hex"); }
function key(kind: string, value: string) { return `stripe-checkout:v1:${kind}:${hash(value)}`; }
function canonical(params: URLSearchParams, trialSourceEndUnix?: number | null) {
  const copy = new URLSearchParams(params);
  copy.delete(`metadata[${ATTEMPT_METADATA}]`);
  if (trialSourceEndUnix != null) {
    const effectiveTrialEnd = Number(copy.get("subscription_data[trial_end]"));
    if (!Number.isSafeInteger(trialSourceEndUnix) || trialSourceEndUnix <= 0
      || !Number.isSafeInteger(effectiveTrialEnd) || effectiveTrialEnd < trialSourceEndUnix) throw new CheckoutGuardError("CHECKOUT_STATE_UNCERTAIN");
    // The stored Stripe parameters remain exact; only intent comparison ignores volatile grace seconds.
    copy.set("subscription_data[trial_end]", String(trialSourceEndUnix));
    copy.delete("subscription_data[metadata][trial_behavior]");
  }
  copy.sort();
  return copy.toString();
}
function redisClient() {
  const url = optionalEnv("KV_REST_API_URL", "").trim();
  const token = optionalEnv("KV_REST_API_TOKEN", "").trim();
  if (shouldBypassUpstashInCurrentEnv() || !url || !token) throw new CheckoutGuardError("CHECKOUT_GUARD_UNAVAILABLE", 503);
  return new Redis({ url, token });
}

/** All account/customer reads and writes belong in work, after this distributed lock. */
export async function withStripeCheckoutGuard<T>(userId: string, work: (guard: StripeCheckoutGuard) => Promise<T>): Promise<T> {
  if (!userId) throw new CheckoutGuardError("CHECKOUT_STATE_UNCERTAIN");
  const redis = redisClient();
  const token = randomUUID();
  const locks: string[] = [];
  const accountKey = key("account", userId);
  const unavailable = () => new CheckoutGuardError("CHECKOUT_GUARD_UNAVAILABLE", 503);
  async function acquire(lockKey: string) {
    let acquired;
    try { acquired = await redis.set(lockKey, token, { nx: true, ex: LEASE_SECONDS }); }
    catch { throw unavailable(); }
    if (acquired !== "OK") throw new CheckoutGuardError("CHECKOUT_IN_PROGRESS");
    locks.push(lockKey);
  }
  async function assertOwned() {
    for (const lockKey of locks) {
      let renewed;
      try { renewed = await redis.eval(RENEW, [lockKey], [token, LEASE_SECONDS]); }
      catch { throw unavailable(); }
      if (Number(renewed) !== 1) throw new CheckoutGuardError("CHECKOUT_LOCK_LOST");
    }
  }
  let resolved = false;
  async function resolveSession(input: CheckoutSessionInput): Promise<GuardedCheckoutSession> {
    if (resolved) throw new CheckoutGuardError("CHECKOUT_STATE_UNCERTAIN");
    resolved = true;
    const { customerId, params, get, post, isCommercialPrice, assertNoLiveSubscription } = input;
    const priceId = params.get("line_items[0][price]") || "";
    if (!/^cus_[\w]+$/.test(customerId) || params.get("customer") !== customerId || params.get("mode") !== "subscription"
      || params.get("client_reference_id") !== userId || params.get("metadata[user_id]") !== userId
      || params.get("line_items[0][quantity]") !== "1" || !isCommercialPrice(priceId)) throw new CheckoutGuardError("CHECKOUT_STATE_UNCERTAIN");
    const customerKey = key("customer", customerId);
    const attemptKey = key("attempt", customerId);
    await assertOwned();
    await acquire(customerKey);
    await assertOwned();
    await assertNoLiveSubscription();

    async function save(attempt: Attempt) {
      let saved;
      try { saved = await redis.eval(SAVE, [accountKey, customerKey, attemptKey], [token, JSON.stringify(attempt)]); }
      catch { throw unavailable(); }
      if (Number(saved) !== 1) throw new CheckoutGuardError("CHECKOUT_LOCK_LOST");
    }
    function validateSession(value: unknown): Row {
      const session = row(value);
      if (!/^cs_[\w]+$/.test(id(session.id)) || id(session.customer) !== customerId
        || session.mode !== "subscription" || session.client_reference_id !== userId
        || row(session.metadata).user_id !== userId || !["open", "expired", "complete"].includes(String(session.status))) {
        throw new CheckoutGuardError("CHECKOUT_STATE_UNCERTAIN");
      }
      return session;
    }
    async function list(extra: Record<string, string>): Promise<Row[]> {
      const result: Row[] = [];
      let cursor = "";
      for (let page = 0; page < 3; page++) {
        await assertOwned();
        const query = new URLSearchParams({ customer: customerId, limit: "100", ...extra });
        if (cursor) query.set("starting_after", cursor);
        const response = row(await get(`/checkout/sessions?${query}`));
        if (!Array.isArray(response.data) || typeof response.has_more !== "boolean") throw new CheckoutGuardError("CHECKOUT_STATE_UNCERTAIN");
        const items = response.data.map(row);
        if (items.some((session) => id(session.customer) !== customerId)) throw new CheckoutGuardError("CHECKOUT_STATE_UNCERTAIN");
        result.push(...items);
        if (!response.has_more) return result;
        const next = id(items.at(-1)?.id);
        if (!next || next === cursor) throw new CheckoutGuardError("CHECKOUT_STATE_UNCERTAIN");
        cursor = next;
      }
      throw new CheckoutGuardError("CHECKOUT_STATE_UNCERTAIN");
    }
    async function commercial(session: Row): Promise<boolean> {
      if (session.mode === "payment" || session.mode === "setup") return false;
      if (session.mode !== "subscription") throw new CheckoutGuardError("CHECKOUT_STATE_UNCERTAIN");
      const response = row(await get(`/checkout/sessions/${encodeURIComponent(id(session.id))}/line_items?limit=100`));
      if (!Array.isArray(response.data) || response.has_more !== false) throw new CheckoutGuardError("CHECKOUT_STATE_UNCERTAIN");
      const items = response.data.map(row);
      const metadata = session.metadata && typeof session.metadata === "object" ? session.metadata as Row : {};
      const ours = items.some((item) => isCommercialPrice(id(item.price))) || ["Standard", "Premium"].includes(String(metadata.plan));
      if (!ours) return false;
      validateSession(session);
      if (items.length !== 1 || items[0].quantity !== 1 || !isCommercialPrice(id(items[0].price))) throw new CheckoutGuardError("CHECKOUT_STATE_UNCERTAIN");
      return true;
    }
    async function expire(session: Row) {
      await assertOwned();
      const expired = validateSession(await post(`/checkout/sessions/${encodeURIComponent(id(session.id))}/expire`, new URLSearchParams()));
      if (expired.id !== session.id || expired.status !== "expired") throw new CheckoutGuardError("CHECKOUT_STATE_UNCERTAIN");
      await assertOwned();
    }
    async function finish(session: Row, canonicalParams: string, reused: boolean): Promise<GuardedCheckoutSession> {
      await assertOwned();
      await assertNoLiveSubscription();
      const current = validateSession(await get(`/checkout/sessions/${encodeURIComponent(id(session.id))}`));
      if (current.status !== "open") throw new CheckoutGuardError("CHECKOUT_ALREADY_COMPLETED");
      if (typeof current.url !== "string" || !current.url.startsWith("https://")) throw new CheckoutGuardError("CHECKOUT_STATE_UNCERTAIN");
      await assertOwned();
      const trial = new URLSearchParams(canonicalParams).get("subscription_data[trial_end]");
      const trialEndUnix = trial === null ? null : Number(trial);
      if (trialEndUnix !== null && (!Number.isSafeInteger(trialEndUnix) || trialEndUnix <= 0)) throw new CheckoutGuardError("CHECKOUT_STATE_UNCERTAIN");
      return { id: id(current.id), url: current.url, reused, trialEndUnix };
    }

    let stored: unknown;
    try { stored = await redis.get(attemptKey); } catch { throw unavailable(); }
    let attempt: Attempt | null = null;
    if (stored !== null) {
      try { if (typeof stored === "string") stored = JSON.parse(stored); } catch { throw new CheckoutGuardError("CHECKOUT_STATE_UNCERTAIN"); }
      const candidate = row(stored);
      if (candidate.version !== 1 || candidate.userId !== userId || candidate.customerId !== customerId
        || typeof candidate.id !== "string" || typeof candidate.params !== "string" || typeof candidate.fingerprint !== "string"
        || typeof candidate.createdAt !== "number" || !Number.isFinite(candidate.createdAt)
        || (candidate.sessionId !== undefined && typeof candidate.sessionId !== "string")) throw new CheckoutGuardError("CHECKOUT_STATE_UNCERTAIN");
      attempt = candidate as Attempt;
    }
    const fingerprint = hash(canonical(params, input.trialSourceEndUnix));
    let tracked: Row | null = null;
    if (attempt?.sessionId) {
      tracked = validateSession(await get(`/checkout/sessions/${encodeURIComponent(attempt.sessionId)}`));
    } else if (attempt) {
      const recent = await list({ "created[gte]": String(Math.floor(attempt.createdAt / 1_000) - 60) });
      const matches = recent.filter((session) => (session.metadata as Row | undefined)?.[ATTEMPT_METADATA] === attempt!.id);
      if (matches.length > 1) throw new CheckoutGuardError("CHECKOUT_STATE_UNCERTAIN");
      if (matches.length === 1) {
        tracked = validateSession(matches[0]);
        attempt.sessionId = id(tracked.id);
        await save(attempt);
      }
    }
    if (tracked?.status === "complete") {
      const subscriptionId = id(tracked.subscription);
      if (!/^sub_[\w]+$/.test(subscriptionId)) throw new CheckoutGuardError("CHECKOUT_ALREADY_COMPLETED");
      const subscription = row(await get(`/subscriptions/${subscriptionId}`));
      if (id(subscription.customer) !== customerId || !["canceled", "incomplete_expired"].includes(String(subscription.status))) throw new CheckoutGuardError("CHECKOUT_ALREADY_COMPLETED");
    }
    const open: Row[] = [];
    for (const session of await list({ status: "open" })) {
      if (session.status !== "open") throw new CheckoutGuardError("CHECKOUT_STATE_UNCERTAIN");
      if (await commercial(session)) open.push(session);
      if (open.length > 20) throw new CheckoutGuardError("CHECKOUT_STATE_UNCERTAIN");
    }
    if (tracked?.status === "open" && !open.some((session) => session.id === tracked!.id)) throw new CheckoutGuardError("CHECKOUT_STATE_UNCERTAIN");

    // An uncertain POST must never be replaced by a new intent, even after its lease expires.
    if (attempt && !tracked) {
      if (attempt.fingerprint !== fingerprint || Date.now() - attempt.createdAt >= SAFE_REPLAY_MS || open.length) throw new CheckoutGuardError("CHECKOUT_PENDING_RECONCILIATION");
    } else {
      const reusable = tracked?.status === "open" && attempt?.fingerprint === fingerprint ? tracked : null;
      for (const session of open) if (session.id !== reusable?.id) await expire(session);
      if (reusable) return finish(reusable, attempt!.params, true);
      attempt = {
        version: 1, userId, customerId, id: randomUUID(), fingerprint,
        params: params.toString(), createdAt: Date.now(),
      };
      const createParams = new URLSearchParams(attempt.params);
      createParams.set(`metadata[${ATTEMPT_METADATA}]`, attempt.id);
      attempt.params = createParams.toString();
      await save(attempt);
    }
    await assertNoLiveSubscription();
    await assertOwned();
    // No TTL on this marker: a lost Stripe response stays fenced until reconciled.
    const created = validateSession(await post("/checkout/sessions", new URLSearchParams(attempt.params), {
      idempotencyKey: `checkout-guard-v1-${attempt.id}`,
    }));
    if ((created.metadata as Row)[ATTEMPT_METADATA] !== attempt.id) throw new CheckoutGuardError("CHECKOUT_STATE_UNCERTAIN");
    attempt.sessionId = id(created.id);
    await save(attempt);
    return finish(created, attempt.params, false);
  }
  try {
    await acquire(accountKey);
    const result = await work({ assertOwned, resolveSession });
    await assertOwned();
    return result;
  } finally {
    for (const lockKey of locks.reverse()) {
      try { await redis.eval(RELEASE, [lockKey], [token]); } catch { /* Expiry releases only the lease, never the attempt marker. */ }
    }
  }
}
