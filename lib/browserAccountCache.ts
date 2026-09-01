import {
  ACTIVE_INRCY_ACCOUNT_COOKIE,
  ACTIVE_INRCY_ACCOUNT_EVENT,
  ACTIVE_INRCY_ACCOUNT_STORAGE_KEY,
} from "@/lib/multicompte/constants";

export const ACTIVE_USER_COOKIE = ACTIVE_INRCY_ACCOUNT_COOKIE;
const ACTIVE_USER_STORAGE_KEY = ACTIVE_INRCY_ACCOUNT_STORAGE_KEY;

const ACCOUNT_CACHE_BASE_KEYS = [
  "inrcy_stats_last_channel_sync_v1",
  "inrcy_stats_last_channel_syncs_v1",
  "inrcy_generator_kpis_v1",
  "inrcy_opp30_total_v1",
  "inrcy_ui_balance_v1",
  "inrcy_docs_v1",
  "inrcy_crm_important_ids",
  "inrcy_crm_notes_by_id",
  "inrcy_profile_preview_v1",
  "inrcy_stats_server_cache_check_ui_v1",
  "inrcy_dashboard_server_cache_check_ui_v1",
  "inrcy_daily_stats_bootstrap_ui_v1",
  "inrcy_dashboard_channel_state_v1",
  "inrcy_generator_power_percent_v1",
  "inrcy_generator_power_snapshot_v1",
  "inrcy_generator_active_v1",
  "inrcy_site_bubble_progress_v1",
  "inrcy_bubble_access_map_v1",
  "inrcy_dashboard_notifications_v1",
  "inrcy_inr_agent_pending_count_v1",
  "inrcy_dashboard_completion_state_v1",
] as const;

const ACCOUNT_CACHE_PREFIXES = [
  "inrcy_stats_cube_snapshot_v1:",
  "inrcy_stats_summary_snapshot_v2:",
  "inrcy_stats_mail_snapshot_v1:",
  "inrcy_stats_mail_snapshot_v2:",
  "inrcy_stats_mail_snapshot_v3:",
  "inrcy_module_snapshot_v1:",
] as const;

function canUseWindow() {
  return typeof window !== "undefined";
}

function readCookie(name: string): string | null {
  if (!canUseWindow()) return null;
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = document.cookie.match(new RegExp(`(?:^|; )${escaped}=([^;]*)`));
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1] ?? null;
  }
}

function writeCookie(name: string, value: string | null) {
  if (!canUseWindow()) return;
  const secure = window.location.protocol === "https:" ? "; Secure" : "";
  if (!value) {
    document.cookie = `${name}=; Path=/; Max-Age=0; SameSite=Lax${secure}`;
    return;
  }
  document.cookie = `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=${60 * 60 * 24 * 30}; SameSite=Lax${secure}`;
}

export function getActiveBrowserUserId(): string | null {
  if (!canUseWindow()) return null;

  const cookieValue = readCookie(ACTIVE_USER_COOKIE);
  if (cookieValue) return cookieValue;

  try {
    const stored = window.localStorage.getItem(ACTIVE_USER_STORAGE_KEY);
    return stored || null;
  } catch {
    return null;
  }
}


export function resolveActiveBrowserUserId(authUserId: string): string {
  const activeUserId = getActiveBrowserUserId();
  const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
  return activeUserId && uuidPattern.test(activeUserId) ? activeUserId : authUserId;
}

export function setActiveBrowserUserId(userId: string | null) {
  if (!canUseWindow()) return;

  const previousUserId = getActiveBrowserUserId();

  if (!userId) {
    try {
      window.localStorage.removeItem(ACTIVE_USER_STORAGE_KEY);
    } catch {
      // ignore
    }
    writeCookie(ACTIVE_USER_COOKIE, null);
  } else {
    try {
      window.localStorage.setItem(ACTIVE_USER_STORAGE_KEY, userId);
    } catch {
      // ignore
    }
    writeCookie(ACTIVE_USER_COOKIE, userId);
  }

  if (previousUserId !== userId) {
    window.dispatchEvent(
      new CustomEvent(ACTIVE_INRCY_ACCOUNT_EVENT, {
        detail: { activeUserId: userId },
      }),
    );
  }
}

export function accountScopedStorageKey(baseKey: string, userId = getActiveBrowserUserId()): string | null {
  if (!userId) return null;
  return `${baseKey}:uid:${userId}`;
}

export function readAccountCacheValue(baseKey: string, userId = getActiveBrowserUserId()): string | null {
  if (!canUseWindow()) return null;
  const scopedKey = accountScopedStorageKey(baseKey, userId);
  if (!scopedKey) return null;

  try {
    const sessionValue = window.sessionStorage.getItem(scopedKey);
    if (sessionValue !== null) return sessionValue;
  } catch {
    // ignore
  }

  try {
    return window.localStorage.getItem(scopedKey);
  } catch {
    return null;
  }
}

export function writeAccountCacheValue(baseKey: string, value: string, userId = getActiveBrowserUserId()) {
  if (!canUseWindow()) return;
  const scopedKey = accountScopedStorageKey(baseKey, userId);
  if (!scopedKey) return;

  try {
    window.sessionStorage.setItem(scopedKey, value);
  } catch {
    // ignore
  }

  try {
    window.localStorage.setItem(scopedKey, value);
  } catch {
    // ignore
  }
}

export function removeAccountCacheValue(baseKey: string, userId = getActiveBrowserUserId()) {
  if (!canUseWindow()) return;
  const scopedKey = accountScopedStorageKey(baseKey, userId);
  if (!scopedKey) return;

  try {
    window.sessionStorage.removeItem(scopedKey);
  } catch {
    // ignore
  }

  try {
    window.localStorage.removeItem(scopedKey);
  } catch {
    // ignore
  }
}

function purgeStorage(storage: Storage) {
  const keysToDelete: string[] = [];
  for (let i = 0; i < storage.length; i += 1) {
    const key = storage.key(i);
    if (!key) continue;

    if (
      ACCOUNT_CACHE_BASE_KEYS.includes(key as (typeof ACCOUNT_CACHE_BASE_KEYS)[number]) ||
      ACCOUNT_CACHE_PREFIXES.some((prefix) => key.startsWith(prefix)) ||
      ACCOUNT_CACHE_BASE_KEYS.some((baseKey) => key.startsWith(`${baseKey}:uid:`))
    ) {
      keysToDelete.push(key);
    }
  }

  for (const key of keysToDelete) {
    try {
      storage.removeItem(key);
    } catch {
      // ignore
    }
  }
}

export function purgeAllBrowserAccountCaches() {
  if (!canUseWindow()) return;

  try {
    purgeStorage(window.sessionStorage);
  } catch {
    // ignore
  }

  try {
    purgeStorage(window.localStorage);
  } catch {
    // ignore
  }
}
