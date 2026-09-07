import { readAccountCacheValue, removeAccountCacheValue, writeAccountCacheValue } from "@/lib/browserAccountCache";
import { type InrstatsChannelBlock } from "@/lib/inrstats/channelBlocks";
import { getDefaultSnapshotDate } from "@/lib/stats/snapshotWindow";
import { type CubeKey, type CubeState, type Overview, type Period } from "./stats.shared.types";
import { safeNum } from "./stats.shared.core";

export const AVAILABLE_PERIODS: Period[] = [7, 14, 30, 60];

export function cubeSessionKey(period: Period) {
  return `inrcy_stats_cube_snapshot_v1:${period}`;
}

export function summarySessionKey(period: Period) {
  return `inrcy_stats_summary_snapshot_v2:${period}`;
}

export function readUiCacheValue(key: string): string | null {
  return readAccountCacheValue(key);
}

export function writeUiCacheValue(key: string, value: string) {
  writeAccountCacheValue(key, value);
}

export function removeUiCacheValue(key: string) {
  removeAccountCacheValue(key);
}

const CUBE_KEYS: CubeKey[] = ["inrbadge", "inr_search", "mails", "site_inrcy", "site_web", "gmb", "facebook", "instagram", "linkedin", "x", "tiktok", "youtube_shorts", "pinterest"];
const REMOTE_STATS_CUBE_KEYS: CubeKey[] = CUBE_KEYS.filter((key) => key !== "mails" && key !== "inrbadge" && key !== "inr_search");

export function hasCapturedLeadsBlocks(blocks: Partial<Record<CubeKey, InrstatsChannelBlock>> | undefined) {
  if (!blocks || typeof blocks !== "object") return false;
  return REMOTE_STATS_CUBE_KEYS.every((key) => {
    const leads = blocks[key]?.capturedLeads;
    return Number.isFinite(Number(leads?.week)) && Number.isFinite(Number(leads?.month));
  });
}

export function expectedUiSnapshotDate() {
  return getDefaultSnapshotDate();
}

export function getStatsLastChannelSyncAt() {
  const raw = readUiCacheValue("inrcy_stats_last_channel_sync_v1");
  const n = raw ? Number(raw) : NaN;
  return Number.isFinite(n) ? n : 0;
}

export function getOverviewSnapshotDate(overviews: unknown): string | null {
  if (!overviews || typeof overviews !== "object") return null;
  for (const overview of Object.values(overviews as Record<string, unknown>)) {
    const snapshotDate = typeof (overview as any)?.meta?.snapshotDate === "string"
      ? (overview as any).meta.snapshotDate
      : null;
    if (snapshotDate) return snapshotDate;
  }
  return null;
}

export function parseCachedCubeSnapshot(raw: string | null): { syncedAt: number; overviews: Record<CubeKey, Overview>; snapshotDate: string | null; blocks?: Partial<Record<CubeKey, InrstatsChannelBlock>> } | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as any;
    if (parsed && typeof parsed === "object" && parsed.overviews && typeof parsed.overviews === "object") {
      return {
        syncedAt: safeNum(parsed.syncedAt),
        overviews: parsed.overviews as Record<CubeKey, Overview>,
        snapshotDate: typeof parsed.snapshotDate === "string" ? parsed.snapshotDate : getOverviewSnapshotDate(parsed.overviews),
        blocks: parsed.blocks && typeof parsed.blocks === "object" ? (parsed.blocks as Partial<Record<CubeKey, InrstatsChannelBlock>>) : undefined,
      };
    }
    if (parsed && typeof parsed === "object") {
      return {
        syncedAt: 0,
        overviews: parsed as Record<CubeKey, Overview>,
        snapshotDate: getOverviewSnapshotDate(parsed),
        blocks: parsed.blocks && typeof parsed.blocks === "object" ? (parsed.blocks as Partial<Record<CubeKey, InrstatsChannelBlock>>) : undefined,
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function parseCachedSummarySnapshot(raw: string | null): {
  syncedAt: number;
  total?: number;
  byCube?: Partial<Record<CubeKey, number>>;
  profile?: { lead_conversion_rate?: number; avg_basket?: number };
  estimatedByCube?: Partial<Record<CubeKey, number>>;
  snapshotDate?: string | null;
} | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as any;
    if (parsed && typeof parsed === "object") {
      return {
        syncedAt: safeNum(parsed.syncedAt),
        total: parsed.total,
        byCube: parsed.byCube,
        profile: parsed.profile,
        estimatedByCube: parsed.estimatedByCube,
        snapshotDate: typeof parsed.snapshotDate === "string" ? parsed.snapshotDate : null,
      };
    }
  } catch {
    return null;
  }
  return null;
}

export function getLocalPeriodSyncAt(period: Period): number {
  const cubeSync = parseCachedCubeSnapshot(readUiCacheValue(cubeSessionKey(period)))?.syncedAt || 0;
  const summarySync = parseCachedSummarySnapshot(readUiCacheValue(summarySessionKey(period)))?.syncedAt || 0;
  return Math.max(cubeSync, summarySync);
}

export function hasFreshLocalPeriodSnapshot(period: Period) {
  const lastChannelSyncAt = getStatsLastChannelSyncAt();
  const cachedCube = parseCachedCubeSnapshot(readUiCacheValue(cubeSessionKey(period)));
  const cachedSummary = parseCachedSummarySnapshot(readUiCacheValue(summarySessionKey(period)));
  const snapshotDate = expectedUiSnapshotDate();
  return Boolean(
    cachedCube?.overviews &&
    hasCapturedLeadsBlocks(cachedCube.blocks) &&
    cachedSummary &&
    cachedCube.syncedAt >= lastChannelSyncAt &&
    cachedSummary.syncedAt >= lastChannelSyncAt &&
    cachedCube.snapshotDate === snapshotDate &&
    cachedSummary.snapshotDate === snapshotDate
  );
}

export function emptyCubeState(): Record<CubeKey, CubeState> {
  return {
    inrbadge: { ov: null, loading: false, capturedLeads: { week: 0, month: 0 } },
    inr_search: { ov: null, loading: false, capturedLeads: { week: 0, month: 0 } },
    site_inrcy: { ov: null, loading: true, capturedLeads: { week: 0, month: 0 } },
    site_web: { ov: null, loading: true, capturedLeads: { week: 0, month: 0 } },
    gmb: { ov: null, loading: true, capturedLeads: { week: 0, month: 0 } },
    facebook: { ov: null, loading: true, capturedLeads: { week: 0, month: 0 } },
    instagram: { ov: null, loading: true, capturedLeads: { week: 0, month: 0 } },
    linkedin: { ov: null, loading: true, capturedLeads: { week: 0, month: 0 } },
    x: { ov: null, loading: true, capturedLeads: { week: 0, month: 0 } },
    mails: { ov: null, loading: false, capturedLeads: { week: 0, month: 0 } },
    tiktok: { ov: null, loading: true, capturedLeads: { week: 0, month: 0 } },
    youtube_shorts: { ov: null, loading: false, capturedLeads: { week: 0, month: 0 } },
    pinterest: { ov: null, loading: false, capturedLeads: { week: 0, month: 0 } },
  };
}
