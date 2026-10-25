import { getActiveBrowserUserId, readAccountCacheValue, writeAccountCacheValue } from "@/lib/browserAccountCache";
import { DASHBOARD_CACHE_KEYS } from "@/lib/dashboardCacheKeys";
import type { ChannelConnectionDetail } from "./publishModal.foundations";

const MAX_AGE_MS = 24 * 60 * 60 * 1_000;
const DASHBOARD_FIELDS: Record<string, string> = {
  gmb: "gmb", facebook: "facebook", instagram: "instagram", threads: "threads",
  linkedin: "linkedin", x: "x", tiktok: "tiktok", youtube_shorts: "youtubeShorts",
  pinterest: "pinterest", inr_search: "inrSearch",
};

type Snapshot<K extends string> = {
  channels: Record<K, boolean>;
  channelDetails: Record<K, ChannelConnectionDetail>;
};

export type BoosterChannelIdentitySeed = {
  actorUserId: string;
  accountId: string | null;
  channelDetails: Record<string, Pick<ChannelConnectionDetail, "type" | "label" | "href">>;
};

function record(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function publicText(value: unknown, maxLength = 500): string | null {
  return typeof value === "string" ? value.trim().slice(0, maxLength) || null : null;
}

function publicHref(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 2_048) return null;
  try {
    const url = new URL(value);
    if (!/^https?:$/.test(url.protocol) || url.username || url.password) return null;
    if ([...url.searchParams.keys()].some(key => /token|secret|password|authorization|api[_-]?key/i.test(key))) return null;
    return url.href;
  } catch { return null; }
}

/** Reuse dashboard identities at first paint without granting publication access. */
export function readBoosterChannelIdentitySeed<K extends string>(
  actorUserId: string,
  accountId: string | null,
  keys: readonly K[],
  seed?: BoosterChannelIdentitySeed,
): Partial<Record<K, ChannelConnectionDetail>> {
  const browserAccountId = getActiveBrowserUserId();
  if (!actorUserId || !accountId || seed?.actorUserId !== actorUserId || seed.accountId !== accountId ||
    (browserAccountId && browserAccountId !== accountId)) return {};
  const details: Partial<Record<K, ChannelConnectionDetail>> = {};
  for (const key of keys) {
    const detail = seed.channelDetails[key];
    if (!detail) continue;
    const label = publicText(detail.label);
    const href = publicHref(detail.href);
    if (label || href) details[key] = { type: publicText(detail.type, 50), label, href };
  }
  return details;
}

/** A background availability check must not erase an already known account name. */
export function mergeBoosterChannelDetails<K extends string>(
  keys: readonly K[],
  incoming: Record<K, ChannelConnectionDetail>,
  previous: Partial<Record<K, ChannelConnectionDetail>>,
  connected: Record<K, boolean>,
): Record<K, ChannelConnectionDetail> {
  const merged = { ...incoming };
  for (const key of keys) {
    const next = incoming[key];
    const known = previous[key];
    const generic = !next?.label || next.label === next.href || /^https?:\/\//i.test(next.label) || /^(?:compte|page|fiche|cha[iî]ne|site web)\b.*\b(?:connect[eé]e?|publi[eé]e?|indisponible)$/i.test(next.label);
    if (connected[key] && !next?.disabled && !next?.requiresReconnect && next?.connectionStatus !== "disconnected" && next?.connectionStatus !== "needs_update" &&
      known?.label && generic && (!next?.href || !known.href || next.href.replace(/\/$/, "") === known.href.replace(/\/$/, ""))) {
      merged[key] = { ...next, label: known.label, href: next.href || known.href || null };
    }
  }
  return merged;
}

function normalizeSnapshot<K extends string>(keys: readonly K[], channels: unknown, details: unknown): Snapshot<K> | null {
  const states = record(channels);
  const identities = record(details);
  if (!keys.length || !states || !identities) return null;
  const normalized = { channels: {} as Record<K, boolean>, channelDetails: {} as Record<K, ChannelConnectionDetail> };
  for (const key of keys) {
    const detail = record(identities[key]);
    if (typeof states[key] !== "boolean" || !detail || detail.availabilityError === true) return null;
    normalized.channels[key] = states[key];
    normalized.channelDetails[key] = {
      type: publicText(detail.type, 50),
      label: publicText(detail.label),
      href: publicHref(detail.href),
      connectionStatus: ["connected", "disconnected", "needs_update"].includes(String(detail.connectionStatus))
        ? String(detail.connectionStatus) : null,
      requiresReconnect: detail.requiresReconnect === true,
      disabled: detail.disabled === true,
    };
  }
  return normalized;
}

function scope(actorUserId: string, accountId: string | null): string | null {
  if (!actorUserId?.trim() || !accountId?.trim()) return null;
  return `${encodeURIComponent(accountId)}:actor:${encodeURIComponent(actorUserId)}`;
}

function contradictsNewerDashboard<K extends string>(accountId: string, cachedAt: number, channels: Record<K, boolean>): boolean {
  try {
    const raw = readAccountCacheValue(DASHBOARD_CACHE_KEYS.channelState, accountId);
    const dashboard = raw ? record(JSON.parse(raw)) : null;
    if (!dashboard || typeof dashboard.cachedAt !== "number" || dashboard.cachedAt < cachedAt) return false;
    const state = record(dashboard.state);
    if (!state) return false;
    return Object.keys(channels).some(key => {
      if (!channels[key as K]) return false;
      if (key === "site_web") return typeof state.siteWebSavedUrl === "string" && !state.siteWebSavedUrl.trim();
      const field = DASHBOARD_FIELDS[key];
      const connectedField = key === "facebook" ? "facebookPageConnected" : `${field}Connected`;
      return !!field && (state[connectedField] === false || state[`${field}AccountConnected`] === false ||
        (key === "gmb" && state.gmbConfigured === false) || state[`${field}RequiresUpdate`] === true ||
        state[`${field}ConnectionStatus`] === "disconnected" || state[`${field}ConnectionStatus`] === "needs_update");
    });
  } catch { return false; }
}

/** Last known presentation only. It never certifies that publishing is available. */
export function readBoosterConnectionSnapshot<K extends string>(actorUserId: string, accountId: string | null, keys: readonly K[]): Snapshot<K> | null {
  const cacheScope = scope(actorUserId, accountId);
  const browserAccountId = getActiveBrowserUserId();
  if (!cacheScope || !accountId || (browserAccountId && browserAccountId !== accountId)) return null;
  try {
    const raw = readAccountCacheValue(DASHBOARD_CACHE_KEYS.boosterConnections, cacheScope);
    const value = raw ? record(JSON.parse(raw)) : null;
    if (!value || value.version !== 1 || value.actorUserId !== actorUserId || value.accountId !== accountId) return null;
    const cachedAt = value.cachedAt;
    const now = Date.now();
    if (typeof cachedAt !== "number" || !Number.isFinite(cachedAt) || cachedAt <= 0 || cachedAt > now || now - cachedAt > MAX_AGE_MS) return null;
    const snapshot = normalizeSnapshot(keys, value.channels, value.channelDetails);
    return snapshot && !contradictsNewerDashboard(accountId, cachedAt, snapshot.channels) ? snapshot : null;
  } catch { return null; }
}

export function writeBoosterConnectionSnapshot<K extends string>(
  actorUserId: string,
  accountId: string | null,
  keys: readonly K[],
  channels: Record<K, boolean>,
  channelDetails: Record<K, ChannelConnectionDetail>,
): void {
  const cacheScope = scope(actorUserId, accountId);
  if (!cacheScope || !accountId || getActiveBrowserUserId() !== accountId) return;
  const snapshot = normalizeSnapshot(keys, channels, channelDetails);
  if (!snapshot) return;
  writeAccountCacheValue(DASHBOARD_CACHE_KEYS.boosterConnections, JSON.stringify({
    version: 1, actorUserId, accountId, cachedAt: Date.now(), ...snapshot,
  }), cacheScope);
}

/** Prepare the first opening from the same canonical endpoint used by Booster. */
export async function warmBoosterConnectionSnapshot(
  actorUserId: string,
  accountId: string | null,
  isCurrent: () => boolean = () => true,
): Promise<void> {
  const cacheScope = scope(actorUserId, accountId);
  if (!cacheScope || !accountId || !isCurrent() || getActiveBrowserUserId() !== accountId) return;
  const before = readAccountCacheValue(DASHBOARD_CACHE_KEYS.boosterConnections, cacheScope);
  try {
    const response = await fetch("/api/booster/connected-channels", {
      cache: "no-store", credentials: "include", signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) return;
    const result = await response.json();
    if (!isCurrent() || getActiveBrowserUserId() !== accountId || result?.ok !== true) return;
    // A foreground revalidation that finished in the meantime is newer.
    if (readAccountCacheValue(DASHBOARD_CACHE_KEYS.boosterConnections, cacheScope) !== before) return;
    const states = record(result.channels);
    if (!states) return;
    const keys = Object.keys(states);
    const snapshot = normalizeSnapshot(keys, states, result.channelDetails);
    if (!snapshot) return;
    const known = readBoosterConnectionSnapshot(actorUserId, accountId, keys);
    writeBoosterConnectionSnapshot(actorUserId, accountId, keys, snapshot.channels,
      mergeBoosterChannelDetails(keys, snapshot.channelDetails, known?.channelDetails ?? {}, snapshot.channels));
  } catch {
    // A failed prefetch must neither block navigation nor invalidate a good snapshot.
  }
}
