import { readUiCacheValue, writeUiCacheValue } from "./dashboard.client-cache";
import { buildBubbleAccessMap, createDefaultBubbleAccessMap, type AppBubbleAccessMap } from "@/lib/bubbleAccess";
import type { ModuleStatus, Ownership } from "./dashboard.types";
import type { InrstatsChannelBlock } from "@/lib/inrstats/channelBlocks";
import type { InrBadgeProfileSummary } from "@/lib/inrBadge";
import type { ConnectionDisplayStatus } from "@/lib/connectionVersions";

export const FORCED_SERVER_CACHE_CHECK_DEDUP_MS = 30_000;
export const AUTO_DAILY_REFRESH_DEDUP_MS = 5 * 60_000;
export const CHANNEL_REFRESH_DEDUP_MS = 30_000;
export const GENERATOR_POWER_SETTLE_MS = 700;
export const GENERATOR_POWER_CACHE_KEY = "inrcy_generator_power_percent_v1";
export const GENERATOR_POWER_SNAPSHOT_CACHE_KEY = "inrcy_generator_power_snapshot_v1";
export const GENERATOR_ACTIVE_CACHE_KEY = "inrcy_generator_active_v1";
export const SITE_BUBBLE_PROGRESS_CACHE_KEY = "inrcy_site_bubble_progress_v1";
export const DASHBOARD_CHANNEL_STATE_CACHE_KEY = "inrcy_dashboard_channel_state_v1";
export const BUBBLE_ACCESS_CACHE_KEY = "inrcy_bubble_access_map_v1";
export const INR_SEARCH_PUBLIC_ORIGIN = ((process.env.NEXT_PUBLIC_INRSEARCH_PUBLIC_ORIGIN || "https://app.inrcy.com").replace(/\/$/, "") === "https://inrcy.com" ? "https://app.inrcy.com" : (process.env.NEXT_PUBLIC_INRSEARCH_PUBLIC_ORIGIN || "https://app.inrcy.com").replace(/\/$/, ""));

export function getRuntimeInrSearchOrigin() {
  if (typeof window !== "undefined" && ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname)) {
    return window.location.origin;
  }
  return INR_SEARCH_PUBLIC_ORIGIN;
}

export type SiteBubbleProgress = { status: ModuleStatus; text: string };
export type SiteBubbleProgressCache = Partial<Record<"site_inrcy" | "site_web", SiteBubbleProgress>>;
export type GeneratorPowerSnapshot = {
  power: number;
  completedStepKeys: string[];
  nextStepKey: string | null;
  remainingSteps: number;
};
export type ChannelRefreshToken = { generation: number; scopeGeneration: number };
export type ChannelRefreshOptions = {
  force?: boolean;
  forceFresh?: boolean;
  dedupeMs?: number;
  responseToken?: ChannelRefreshToken;
};
export type ChannelStatsRefreshResult = { preferredBlock: InrstatsChannelBlock | null; syncAt: number };
export type GeneratorChannelRefreshResult = { block: unknown | null; syncAt: number };

export function createUnverifiedBubbleAccessMap(): AppBubbleAccessMap {
  const accessMap = createDefaultBubbleAccessMap();

  // Site iNrCy is a Supabase-controlled entitlement. A browser cache must
  // never be able to grant it before the authoritative API has answered.
  accessMap.site_inrcy = false;
  return accessMap;
}

export function readCachedBubbleAccessMap(): AppBubbleAccessMap {
  try {
    const raw = readUiCacheValue(BUBBLE_ACCESS_CACHE_KEY);
    if (!raw) return createUnverifiedBubbleAccessMap();
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return createUnverifiedBubbleAccessMap();
    const rows = Object.entries(parsed as Record<string, unknown>).map(([bubble_key, enabled]) => ({
      bubble_key,
      enabled: Boolean(enabled),
    }));
    const accessMap = buildBubbleAccessMap(rows);

    // Keep the UI fail-closed until /api/bubble-access/ensure confirms access.
    accessMap.site_inrcy = false;
    return accessMap;
  } catch {
    return createUnverifiedBubbleAccessMap();
  }
}

export function readCachedSiteInrcyDisplayAccess(): boolean {
  try {
    const raw = readUiCacheValue(BUBBLE_ACCESS_CACHE_KEY);
    if (!raw) return false;
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return false;

    // Display-only continuity: this value may keep the last confirmed visual
    // state while Supabase is being checked, but it never unlocks an action.
    return parsed.site_inrcy === true;
  } catch {
    return false;
  }
}

export function writeCachedBubbleAccessMap(accessMap: AppBubbleAccessMap) {
  try {
    writeUiCacheValue(BUBBLE_ACCESS_CACHE_KEY, JSON.stringify(accessMap));
  } catch {
    // ignore browser storage failures
  }
}

export const EMPTY_INRBADGE_PROFILE: InrBadgeProfileSummary = {
  userId: "",
  logoUrl: "",
  companyLegalName: "",
  firstName: "",
  lastName: "",
  phone: "",
  contactEmail: "",
};

export function normalizeCachedString(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function sanitizeCachedInrBadgeProfile(value: unknown): InrBadgeProfileSummary {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  return {
    userId: normalizeCachedString(source.userId),
    logoUrl: normalizeCachedString(source.logoUrl),
    companyLegalName: normalizeCachedString(source.companyLegalName),
    firstName: normalizeCachedString(source.firstName),
    lastName: normalizeCachedString(source.lastName),
    phone: normalizeCachedString(source.phone),
    contactEmail: normalizeCachedString(source.contactEmail),
  };
}

export function isEmptyInrBadgeProfile(profile: InrBadgeProfileSummary) {
  return !profile.userId && !profile.logoUrl && !profile.companyLegalName && !profile.firstName && !profile.lastName && !profile.phone && !profile.contactEmail;
}

export function isModuleStatus(value: unknown): value is ModuleStatus {
  return value === "connected" || value === "available" || value === "reconnect" || value === "coming";
}

export function readCachedSiteBubbleProgress(): SiteBubbleProgressCache {
  try {
    const raw = readUiCacheValue(SITE_BUBBLE_PROGRESS_CACHE_KEY);
    const cache: SiteBubbleProgressCache = {};
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        for (const key of ["site_inrcy", "site_web"] as const) {
          const entry = parsed[key] as Record<string, unknown> | undefined;
          if (!entry || typeof entry !== "object" || Array.isArray(entry)) continue;
          if (!isModuleStatus(entry.status) || typeof entry.text !== "string") continue;
          cache[key] = { status: entry.status, text: entry.text };
        }
      }
    }

    // Compatibility with accounts whose detailed channel cache predates the
    // dedicated bubble-progress snapshot. This remains account-scoped.
    const channelState = readCachedDashboardChannelState();
    const addFallback = (key: "site_inrcy" | "site_web", urlKey: string, ga4Key: string, gscKey: string) => {
      if (cache[key]) return;
      const hasUrl = typeof channelState?.[urlKey] === "string" && channelState[urlKey].trim().length > 0;
      const progress = (hasUrl ? 1 : 0) +
        (hasUrl && channelState?.[ga4Key] === true ? 1 : 0) +
        (hasUrl && channelState?.[gscKey] === true ? 1 : 0);
      cache[key] = {
        status: hasUrl ? "connected" : "available",
        text: `${hasUrl ? "Connecté" : "À configurer"} ${progress}/3`,
      };
    };
    addFallback("site_inrcy", "siteInrcySavedUrl", "siteInrcyGa4Connected", "siteInrcyGscConnected");
    addFallback("site_web", "siteWebSavedUrl", "siteWebGa4Connected", "siteWebGscConnected");

    if (!readCachedSiteInrcyDisplayAccess()) {
      delete cache.site_inrcy;
    }
    return cache;
  } catch {
    return {};
  }
}

export function readCachedGeneratorPowerPercent(): number | null {
  try {
    const raw = readUiCacheValue(GENERATOR_POWER_CACHE_KEY);
    if (!raw) return null;
    const value = Number(raw);
    if (!Number.isFinite(value)) return null;
    return Math.max(0, Math.min(100, Math.round(value)));
  } catch {
    return null;
  }
}

export function sanitizeGeneratorPowerSnapshot(value: unknown): GeneratorPowerSnapshot | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const power = Number(source.power);
  const remainingSteps = Number(source.remainingSteps);
  if (!Number.isFinite(power) || !Number.isFinite(remainingSteps)) return null;

  return {
    power: Math.max(0, Math.min(100, Math.round(power))),
    completedStepKeys: Array.isArray(source.completedStepKeys)
      ? source.completedStepKeys.map((key) => String(key || "").trim()).filter(Boolean)
      : [],
    nextStepKey:
      typeof source.nextStepKey === "string" && source.nextStepKey.trim()
        ? source.nextStepKey.trim()
        : null,
    remainingSteps: Math.max(0, Math.round(remainingSteps)),
  };
}

export function readCachedGeneratorPowerSnapshot(): GeneratorPowerSnapshot | null {
  try {
    const raw = readUiCacheValue(GENERATOR_POWER_SNAPSHOT_CACHE_KEY);
    if (!raw) return null;
    return sanitizeGeneratorPowerSnapshot(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function writeCachedGeneratorPowerSnapshot(snapshot: GeneratorPowerSnapshot) {
  try {
    writeUiCacheValue(GENERATOR_POWER_SNAPSHOT_CACHE_KEY, JSON.stringify(snapshot));
  } catch {
    // ignore browser storage failures
  }
}

export function readCachedGeneratorIsActive(): boolean | null {
  try {
    const raw = readUiCacheValue(GENERATOR_ACTIVE_CACHE_KEY);
    if (raw === "true") return true;
    if (raw === "false") return false;
    return null;
  } catch {
    return null;
  }
}

export function readCachedDashboardChannelState(): Record<string, any> | null {
  try {
    const raw = readUiCacheValue(DASHBOARD_CHANNEL_STATE_CACHE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as any;
    const state = parsed?.state && typeof parsed.state === "object" ? parsed.state : parsed;
    if (!state || typeof state !== "object" || Array.isArray(state)) return null;
    return state as Record<string, any>;
  } catch {
    return null;
  }
}

export function readCachedInrBadgeProfile() {
  try {
    const state = readCachedDashboardChannelState();
    if (!state || !state.inrBadgeProfile) return { ...EMPTY_INRBADGE_PROFILE };
    const profile = sanitizeCachedInrBadgeProfile(state.inrBadgeProfile);
    return isEmptyInrBadgeProfile(profile) ? { ...EMPTY_INRBADGE_PROFILE } : profile;
  } catch {
    return { ...EMPTY_INRBADGE_PROFILE };
  }
}

export function readCachedInrSearchConnected(): boolean | null {
  try {
    const state = readCachedDashboardChannelState();
    return typeof state?.inrSearchConnected === "boolean" ? state.inrSearchConnected : null;
  } catch {
    return null;
  }
}

export function readCachedInrSearchDirectoryEnabled(): boolean | null {
  try {
    const state = readCachedDashboardChannelState();
    return typeof state?.inrSearchDirectoryEnabled === "boolean" ? state.inrSearchDirectoryEnabled : null;
  } catch {
    return null;
  }
}

export function readCachedDashboardOptionalBoolean(key: string): boolean | null {
  try {
    const state = readCachedDashboardChannelState();
    return typeof state?.[key] === "boolean" ? state[key] : null;
  } catch {
    return null;
  }
}

export function readCachedDashboardBoolean(key: string): boolean {
  return readCachedDashboardOptionalBoolean(key) ?? false;
}

export function readCachedDashboardString(key: string): string {
  try {
    const state = readCachedDashboardChannelState();
    return typeof state?.[key] === "string" ? state[key] : "";
  } catch {
    return "";
  }
}

export function writeCachedDashboardChannelState(state: Record<string, any>) {
  try {
    writeUiCacheValue(DASHBOARD_CHANNEL_STATE_CACHE_KEY, JSON.stringify({ cachedAt: Date.now(), state }));
  } catch {
    // ignore browser storage failures
  }
}

export function isConnectionStatus(value: unknown): value is ConnectionDisplayStatus {
  return value === "connected" || value === "disconnected" || value === "needs_update";
}

export function isOwnership(value: unknown): value is Ownership {
  return value === "none" || value === "rented" || value === "sold";
}

export function sanitizeMailAccountsConnectedCount(value: unknown) {
  const count = Number(value);
  if (!Number.isFinite(count)) return 0;
  return Math.max(0, Math.min(4, Math.round(count)));
}

export function readCachedMailAccountsConnectedCount(): number | null {
  try {
    const state = readCachedDashboardChannelState();
    if (state && Object.prototype.hasOwnProperty.call(state, "mailAccountsConnectedCount")) {
      return sanitizeMailAccountsConnectedCount(state.mailAccountsConnectedCount);
    }
  } catch {
    // ignore malformed dashboard cache
  }

  return null;
}

export function mergeCachedDashboardChannelState(patch: Record<string, any>) {
  try {
    writeCachedDashboardChannelState({
      ...(readCachedDashboardChannelState() ?? {}),
      ...patch,
    });
  } catch {
    // ignore browser storage failures
  }
}
