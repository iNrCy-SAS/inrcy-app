import { readAccountCacheValue, writeAccountCacheValue } from "@/lib/browserAccountCache";
import { getDefaultSnapshotDate } from "@/lib/stats/snapshotWindow";
import type { InrstatsChannelBlocksByChannel } from "@/lib/inrstats/channelBlocks";

export type CubeKey =
  | "site_inrcy"
  | "site_web"
  | "gmb"
  | "facebook"
  | "instagram"
  | "linkedin"
  | "x"
  | "tiktok"
  | "youtube_shorts"
  | "pinterest";

export type DailyRefreshBulkPayload = {
  period: number;
  overviews?: Record<CubeKey, unknown>;
  opportunities?: {
    total?: number;
    byCube?: Partial<Record<CubeKey, number>>;
  };
  profile?: {
    lead_conversion_rate?: number;
    avg_basket?: number;
  };
  estimatedByCube?: Partial<Record<CubeKey, number>>;
  capturedLeadsByCube?: {
    week?: Partial<Record<CubeKey, number>>;
    month?: Partial<Record<CubeKey, number>>;
  };
  blocks?: InrstatsChannelBlocksByChannel;
  meta?: {
    generatedAt?: string;
    snapshotDate?: string | null;
    live?: boolean;
    connectionSignature?: string;
  };
};

export type DailyStatsRefreshBootstrapResponse = {
  ok: boolean;
  ran: boolean;
  inProgress: boolean;
  snapshotDate: string | null;
  syncAt: number;
  generator?: any;
  inrstats?: Record<string, DailyRefreshBulkPayload>;
};

export async function runDailyStatsRefreshBootstrap(options?: { announce?: boolean; force?: boolean }): Promise<DailyStatsRefreshBootstrapResponse> {
  const res = await fetch("/api/stats/daily-refresh", {
    method: "POST",
    cache: "no-store",
    credentials: "include",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ action: "run", announce: options?.announce === true, force: options?.force === true }),
  });

  const json = (await res.json().catch(() => null)) as DailyStatsRefreshBootstrapResponse | null;
  if (!res.ok) {
    const message = typeof (json as any)?.error === "string" ? (json as any).error : `daily refresh bootstrap failed: ${res.status}`;
    throw new Error(message);
  }

  return json ?? {
    ok: false,
    ran: false,
    inProgress: false,
    snapshotDate: null,
    syncAt: Date.now(),
  };
}


const DAILY_BOOTSTRAP_UI_STATE_KEY = "inrcy_daily_stats_bootstrap_ui_v1";
const DASHBOARD_SERVER_CACHE_UI_STATE_KEY = "inrcy_dashboard_server_cache_check_ui_v1";
const STATS_SERVER_CACHE_UI_STATE_KEY = "inrcy_stats_server_cache_check_ui_v1";

export const UI_BOOTSTRAP_REUSE_TTL_MS = 10 * 60 * 1000;
// Keep the lightweight server cache check effectively always eligible across sessions/devices.
// An in-memory 60s guard still prevents spam inside a single open tab.
export const UI_SERVER_SYNC_REUSE_TTL_MS = 0;

type UiCheckState = {
  checkedAt: number;
  snapshotDate: string | null;
  syncAt?: number;
};

function expectedSnapshotDate() {
  return getDefaultSnapshotDate();
}

function readUiCheckState(key: string): UiCheckState | null {
  try {
    const raw = readAccountCacheValue(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UiCheckState;
    const checkedAt = Number(parsed?.checkedAt);
    return {
      checkedAt: Number.isFinite(checkedAt) ? checkedAt : 0,
      snapshotDate: typeof parsed?.snapshotDate === "string" ? parsed.snapshotDate : null,
      syncAt: Number.isFinite(Number(parsed?.syncAt)) ? Number(parsed?.syncAt) : undefined,
    };
  } catch {
    return null;
  }
}

function writeUiCheckState(key: string, value: UiCheckState) {
  try {
    writeAccountCacheValue(key, JSON.stringify(value));
  } catch {
    // ignore browser storage failures
  }
}

function wasCheckRecordedRecently(key: string, snapshotDate = expectedSnapshotDate(), ttlMs = UI_BOOTSTRAP_REUSE_TTL_MS) {
  const state = readUiCheckState(key);
  if (!state) return false;
  if ((state.snapshotDate ?? null) !== (snapshotDate ?? null)) return false;
  return Date.now() - state.checkedAt < ttlMs;
}

export function wasDailyStatsRefreshBootstrapCheckedRecently(options?: {
  snapshotDate?: string | null;
  ttlMs?: number;
}) {
  return wasCheckRecordedRecently(
    DAILY_BOOTSTRAP_UI_STATE_KEY,
    options?.snapshotDate ?? expectedSnapshotDate(),
    options?.ttlMs ?? UI_BOOTSTRAP_REUSE_TTL_MS,
  );
}

export function markDailyStatsRefreshBootstrapChecked(options?: {
  snapshotDate?: string | null;
  checkedAt?: number;
  syncAt?: number;
}) {
  const checkedAt = Number.isFinite(Number(options?.checkedAt)) ? Number(options?.checkedAt) : Date.now();
  writeUiCheckState(DAILY_BOOTSTRAP_UI_STATE_KEY, {
    checkedAt,
    snapshotDate: options?.snapshotDate ?? expectedSnapshotDate(),
    syncAt: Number.isFinite(Number(options?.syncAt)) ? Number(options?.syncAt) : checkedAt,
  });
}

export function wasServerCacheSyncCheckedRecently(
  scope: "dashboard" | "stats",
  options?: { snapshotDate?: string | null; ttlMs?: number }
) {
  const key = scope === "dashboard" ? DASHBOARD_SERVER_CACHE_UI_STATE_KEY : STATS_SERVER_CACHE_UI_STATE_KEY;
  return wasCheckRecordedRecently(
    key,
    options?.snapshotDate ?? expectedSnapshotDate(),
    options?.ttlMs ?? UI_SERVER_SYNC_REUSE_TTL_MS,
  );
}

export function markServerCacheSyncChecked(
  scope: "dashboard" | "stats",
  options?: { snapshotDate?: string | null; checkedAt?: number; syncAt?: number }
) {
  const key = scope === "dashboard" ? DASHBOARD_SERVER_CACHE_UI_STATE_KEY : STATS_SERVER_CACHE_UI_STATE_KEY;
  const checkedAt = Number.isFinite(Number(options?.checkedAt)) ? Number(options?.checkedAt) : Date.now();
  writeUiCheckState(key, {
    checkedAt,
    snapshotDate: options?.snapshotDate ?? expectedSnapshotDate(),
    syncAt: Number.isFinite(Number(options?.syncAt)) ? Number(options?.syncAt) : checkedAt,
  });
}
