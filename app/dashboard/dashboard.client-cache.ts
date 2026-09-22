import { readAccountCacheValue, writeAccountCacheValue } from "@/lib/browserAccountCache";
import { DASHBOARD_CHANNEL_KEYS, type DashboardChannelKey } from "@/lib/dashboardChannels";
import { createEmptyChannelBlock, createEmptyChannelBlocks, type InrstatsChannelBlock, type InrstatsChannelBlocksByChannel } from "@/lib/inrstats/channelBlocks";
import { getDefaultSnapshotDate } from "@/lib/stats/snapshotWindow";
import { createEmptyGeneratorChannelBlocks, summarizeGeneratorChannelBlocks, type GeneratorChannelBlock, type GeneratorChannelBlocksByChannel } from "@/lib/generator/channelBlocks";

export type StatsWarmPeriod = 7 | 14 | 30 | 60;

type ChannelSyncMap = Partial<Record<DashboardChannelKey, number>>;

const CHANNEL_SYNC_MAP_KEY = "inrcy_stats_last_channel_syncs_v1";

export function statsCubeSessionKey(period: StatsWarmPeriod) {
  return `inrcy_stats_cube_snapshot_v1:${period}`;
}

export function statsSummarySessionKey(period: StatsWarmPeriod) {
  return `inrcy_stats_summary_snapshot_v2:${period}`;
}

export function readUiCacheValue(key: string, accountId?: string | null): string | null {
  return readAccountCacheValue(key, accountId === undefined ? undefined : accountId);
}

export function writeUiCacheValue(key: string, value: string) {
  writeAccountCacheValue(key, value);
}

function readLegacyLastChannelSyncAt() {
  const raw = readUiCacheValue("inrcy_stats_last_channel_sync_v1");
  const n = raw ? Number(raw) : Number.NaN;
  return Number.isFinite(n) ? n : 0;
}

export function readChannelSyncMap(): ChannelSyncMap {
  try {
    const raw = readUiCacheValue(CHANNEL_SYNC_MAP_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    const out: ChannelSyncMap = {};
    for (const channel of DASHBOARD_CHANNEL_KEYS) {
      const value = Number(parsed[channel]);
      if (Number.isFinite(value) && value > 0) {
        out[channel] = value;
      }
    }
    return out;
  } catch {
    return {};
  }
}

export function writeChannelSyncMap(syncs: ChannelSyncMap) {
  try {
    writeUiCacheValue(CHANNEL_SYNC_MAP_KEY, JSON.stringify(syncs));
  } catch {
    // ignore browser storage failures
  }
}

export function markChannelsSynced(channels: DashboardChannelKey[], at?: number) {
  if (!Array.isArray(channels) || !channels.length) return;
  const syncAt = Number.isFinite(Number(at)) ? Number(at) : Date.now();
  const next = { ...readChannelSyncMap() };
  for (const channel of channels) {
    next[channel] = syncAt;
  }
  writeChannelSyncMap(next);
  try {
    writeUiCacheValue("inrcy_stats_last_channel_sync_v1", String(syncAt));
  } catch {
    // ignore
  }
}

export function getChannelSyncAt(channel: DashboardChannelKey) {
  const value = Number(readChannelSyncMap()[channel]);
  return Number.isFinite(value) ? value : 0;
}

export function getLastChannelSyncAt() {
  const maxMapSync = Object.values(readChannelSyncMap()).reduce((max, value) => {
    const syncAt = Number(value);
    return Number.isFinite(syncAt) ? Math.max(max, syncAt) : max;
  }, 0);
  return Math.max(readLegacyLastChannelSyncAt(), maxMapSync);
}

export function expectedUiSnapshotDate() {
  return getDefaultSnapshotDate();
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

export function readGeneratorCache(): { syncedAt: number; payload: any | null; snapshotDate: string | null } | null {
  try {
    const raw = readUiCacheValue("inrcy_generator_kpis_v1");
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === "object" && "payload" in parsed) {
      return {
        syncedAt: Number.isFinite(Number((parsed as any).syncedAt)) ? Number((parsed as any).syncedAt) : 0,
        payload: (parsed as any).payload ?? null,
        snapshotDate: typeof (parsed as any).snapshotDate === "string" ? (parsed as any).snapshotDate : (typeof (parsed as any)?.payload?.meta?.snapshotDate === "string" ? (parsed as any).payload.meta.snapshotDate : null),
      };
    }
    return { syncedAt: 0, payload: parsed, snapshotDate: typeof (parsed as any)?.meta?.snapshotDate === "string" ? (parsed as any).meta.snapshotDate : null };
  } catch {
    return null;
  }
}

export function readCachedOppTotal() {
  try {
    const raw = readUiCacheValue("inrcy_opp30_total_v1");
    const n = raw ? Number(raw) : Number.NaN;
    return Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}


export function readCachedGeneratorChannelSyncAt(channel: DashboardChannelKey): number {
  try {
    const blocks = readCachedGeneratorChannelBlocks();
    const syncAt = Number(blocks?.[channel]?.syncAt);
    return Number.isFinite(syncAt) ? syncAt : 0;
  } catch {
    return 0;
  }
}

export function readCachedGeneratorChannelBlocks(): GeneratorChannelBlocksByChannel | null {
  try {
    const payload = readGeneratorCache()?.payload as { generatorBlocks?: unknown } | null;
    const blocks = payload?.generatorBlocks;
    if (blocks && typeof blocks === "object" && !Array.isArray(blocks)) {
      return blocks as GeneratorChannelBlocksByChannel;
    }
  } catch {
    // ignore malformed generator cache entries
  }
  return null;
}

export function getInitialGeneratorKpis() {
  const payload = readGeneratorCache()?.payload;
  return (payload as any)?.leads ? payload : null;
}

export function getInitialOppTotal() {
  const payload = readGeneratorCache()?.payload as any;
  const oppMonth = Number(payload?.details?.opportunities?.month);
  if (Number.isFinite(oppMonth)) return oppMonth;
  return readCachedOppTotal();
}

export function readSnapshotSyncAt(key: string): number {
  try {
    const raw = readUiCacheValue(key);
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as any;
    const syncedAt = Number(parsed?.syncedAt);
    return Number.isFinite(syncedAt) ? syncedAt : 0;
  } catch {
    return 0;
  }
}

export function readCachedChannelBlocks(periods: StatsWarmPeriod[] = [30, 7]): InrstatsChannelBlocksByChannel | null {
  for (const period of periods) {
    try {
      const raw = readUiCacheValue(statsCubeSessionKey(period));
      if (!raw) continue;
      const parsed = JSON.parse(raw) as { blocks?: unknown } | null;
      const blocks = parsed?.blocks;
      if (blocks && typeof blocks === "object" && !Array.isArray(blocks)) {
        return normalizeCachedChannelBlocks(blocks);
      }
    } catch {
      // ignore malformed cache entries
    }
  }
  return null;
}

export function readCachedChannelSyncAt(period: StatsWarmPeriod, channel: DashboardChannelKey): number {
  try {
    const raw = readUiCacheValue(statsCubeSessionKey(period));
    if (!raw) return 0;
    const parsed = JSON.parse(raw) as { blocks?: unknown; overviews?: Record<string, unknown> } | null;
    const blockSync = Number((parsed?.blocks as any)?.[channel]?.syncAt);
    if (Number.isFinite(blockSync) && blockSync > 0) return blockSync;

    const generatedAt = typeof (parsed?.overviews?.[channel] as any)?.meta?.generatedAt === "string"
      ? (parsed?.overviews?.[channel] as any).meta.generatedAt
      : null;
    const overviewSync = generatedAt ? Date.parse(generatedAt) : Number.NaN;
    return Number.isFinite(overviewSync) ? overviewSync : 0;
  } catch {
    return 0;
  }
}

export function readInrStatsPeriodSyncAt(period: StatsWarmPeriod): number {
  return Math.max(
    readSnapshotSyncAt(statsCubeSessionKey(period)),
    readSnapshotSyncAt(statsSummarySessionKey(period)),
  );
}

export function hasFreshLocalGeneratorSnapshot() {
  const cached = readGeneratorCache();
  const lastChannelSyncAt = getLastChannelSyncAt();
  return Boolean(
    (cached as any)?.payload?.leads &&
    (cached as any).syncedAt >= lastChannelSyncAt &&
    (cached as any).snapshotDate === expectedUiSnapshotDate()
  );
}


function toNonNegativeInt(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

function normalizeCachedChannelBlock(channel: DashboardChannelKey, raw: unknown): InrstatsChannelBlock {
  const empty = createEmptyChannelBlock(channel);
  const block = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Partial<InrstatsChannelBlock>
    : {};
  const connection = block.connection && typeof block.connection === "object"
    ? { ...empty.connection, ...block.connection }
    : empty.connection;
  return {
    ...empty,
    ...block,
    channel,
    periodDays: Number.isFinite(Number(block.periodDays)) ? Number(block.periodDays) : empty.periodDays,
    connection,
    overview: block.overview ?? empty.overview,
    opportunities: toNonNegativeInt(block.opportunities),
    capturedLeads: {
      week: toNonNegativeInt(block.capturedLeads?.week),
      month: toNonNegativeInt(block.capturedLeads?.month),
    },
    estimatedValue: toNonNegativeInt(block.estimatedValue),
    syncAt: Number.isFinite(Number(block.syncAt)) ? Number(block.syncAt) : null,
    snapshotDate: typeof block.snapshotDate === "string" ? block.snapshotDate : null,
    live: Boolean(block.live),
    error: typeof block.error === "string" && block.error.trim() ? block.error : null,
  };
}

function normalizeCachedChannelBlocks(raw: unknown): InrstatsChannelBlocksByChannel {
  const source = raw && typeof raw === "object" && !Array.isArray(raw)
    ? raw as Partial<Record<DashboardChannelKey, unknown>>
    : {};
  return DASHBOARD_CHANNEL_KEYS.reduce((acc, channel) => {
    acc[channel] = normalizeCachedChannelBlock(channel, source[channel]);
    return acc;
  }, {} as InrstatsChannelBlocksByChannel);
}

function sumGeneratorOpportunitiesByCube(byCube: Partial<Record<DashboardChannelKey, unknown>>) {
  return DASHBOARD_CHANNEL_KEYS.reduce((sum, channel) => {
    const n = Number(byCube[channel]);
    return sum + (Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0);
  }, 0);
}

function isGeneratorBlockActiveFromStatsBlock(block: InrstatsChannelBlock | null | undefined) {
  const connection = block?.connection;
  if (!connection) return undefined;
  if (connection.requiresUpdate || connection.connectionStatus === "needs_update") return false;
  if (block?.channel === "site_inrcy" || block?.channel === "site_web") {
    return Boolean(connection.statsConnected);
  }
  return Boolean(connection.connected);
}

export function syncGeneratorOpportunitiesFromStatsSummary(params: {
  byCube: Partial<Record<DashboardChannelKey, unknown>>;
  estimatedByCube?: Partial<Record<DashboardChannelKey, unknown>>;
  profile?: unknown;
  syncedAt?: number;
  snapshotDate?: string | null;
  channelBlocks?: Partial<Record<DashboardChannelKey, InrstatsChannelBlock | null | undefined>>;
}) {
  const byCube = params.byCube || {};
  const effectiveByCube: Partial<Record<DashboardChannelKey, unknown>> = { ...byCube };
  for (const channel of DASHBOARD_CHANNEL_KEYS) {
    if (isGeneratorBlockActiveFromStatsBlock(params.channelBlocks?.[channel]) === false) {
      effectiveByCube[channel] = 0;
    }
  }
  const total = sumGeneratorOpportunitiesByCube(effectiveByCube);
  const nextSyncedAt = Number.isFinite(Number(params.syncedAt)) ? Number(params.syncedAt) : Date.now();

  try {
    writeUiCacheValue("inrcy_opp30_total_v1", String(total));
  } catch {
    // ignore browser storage failures
  }

  try {
    const cached = readGeneratorCache();
    const currentPayload = cached?.payload && typeof cached.payload === "object" ? cached.payload as Record<string, any> : null;

    // Ne crée pas un faux cache Générateur à partir d'iNrStats si le dashboard n'a jamais chargé ses KPIs.
    // On évite ainsi d'afficher des leads à 0 par erreur sur un nouvel appareil.
    if (!currentPayload) return;

    const currentBlocks = readCachedGeneratorChannelBlocks() || createEmptyGeneratorChannelBlocks();
    const generatorBlocks = { ...currentBlocks } as GeneratorChannelBlocksByChannel;
    const resolvedSnapshotDate = typeof params.snapshotDate === "string"
      ? params.snapshotDate
      : (typeof currentPayload?.meta?.snapshotDate === "string" ? currentPayload.meta.snapshotDate : cached?.snapshotDate ?? null);

    const emptyBlocks = createEmptyGeneratorChannelBlocks();
    for (const channel of DASHBOARD_CHANNEL_KEYS) {
      const currentBlock = generatorBlocks[channel] || emptyBlocks[channel];
      const activeFromStats = isGeneratorBlockActiveFromStatsBlock(params.channelBlocks?.[channel]);
      const shouldClearChannel = activeFromStats === false;
      const opportunity = shouldClearChannel
        ? 0
        : Math.max(0, Math.round(Number(effectiveByCube[channel] ?? currentBlock?.opportunities?.month ?? 0)));
      const estimatedRaw = Number(params.estimatedByCube?.[channel]);
      const estimatedValue = shouldClearChannel
        ? 0
        : Number.isFinite(estimatedRaw)
          ? Math.max(0, Math.round(estimatedRaw))
          : currentBlock.estimatedValue;
      generatorBlocks[channel] = {
        ...currentBlock,
        leads: shouldClearChannel ? { today: 0, week: 0, month: 0 } : currentBlock.leads,
        opportunities: { month: opportunity },
        estimatedValue,
        live: shouldClearChannel ? false : currentBlock.live,
        error: shouldClearChannel ? null : currentBlock.error,
        syncAt: nextSyncedAt,
        snapshotDate: resolvedSnapshotDate,
      };
    }

    const baseDays = Number(currentPayload?.details?.opportunities?.baseDays);
    const generatorTotals = summarizeGeneratorChannelBlocks({
      blocks: generatorBlocks,
      monthDays: Number.isFinite(baseDays) && baseDays > 0 ? baseDays : 30,
      weekDays: 7,
      todayDays: 2,
    });

    const currentMeta = currentPayload?.meta && typeof currentPayload.meta === "object" ? currentPayload.meta as Record<string, any> : {};
    const nextPayload = {
      ...currentPayload,
      leads: generatorTotals.leads,
      estimatedValue: generatorTotals.estimatedValue,
      generatorBlocks,
      details: {
        ...(currentPayload?.details && typeof currentPayload.details === "object" ? currentPayload.details : {}),
        opportunities: generatorTotals.opportunities,
        profile: params.profile ?? currentPayload?.details?.profile ?? null,
      },
      meta: {
        ...currentMeta,
        snapshotDate: resolvedSnapshotDate,
      },
    };

    writeUiCacheValue(
      "inrcy_generator_kpis_v1",
      JSON.stringify({
        syncedAt: nextSyncedAt,
        snapshotDate: resolvedSnapshotDate,
        payload: nextPayload,
      })
    );
  } catch {
    // ignore cache merge failures
  }
}

export function mergeGeneratorChannelBlockIntoCachedKpis(params: {
  channel: DashboardChannelKey;
  block: GeneratorChannelBlock;
  syncedAt?: number;
  snapshotDate?: string | null;
  live?: boolean;
  profile?: unknown;
}) {
  const { channel, block, syncedAt, snapshotDate, live, profile } = params;
  const nextSyncedAt = Number.isFinite(Number(syncedAt)) ? Number(syncedAt) : Date.now();

  try {
    const cached = readGeneratorCache();
    const currentPayload = cached?.payload && typeof cached.payload === "object" ? cached.payload as Record<string, any> : {};
    const currentBlocks = readCachedGeneratorChannelBlocks() || createEmptyGeneratorChannelBlocks();
    const generatorBlocks: GeneratorChannelBlocksByChannel = { ...currentBlocks, [channel]: block };
    const baseDays = Number(currentPayload?.details?.opportunities?.baseDays);
    const generatorTotals = summarizeGeneratorChannelBlocks({
      blocks: generatorBlocks,
      monthDays: Number.isFinite(baseDays) && baseDays > 0 ? baseDays : 30,
      weekDays: 7,
      todayDays: 2,
    });

    const currentMeta = currentPayload?.meta && typeof currentPayload.meta === "object" ? currentPayload.meta as Record<string, any> : {};
    const resolvedSnapshotDate = typeof snapshotDate === "string" ? snapshotDate : block.snapshotDate ?? currentMeta.snapshotDate ?? cached?.snapshotDate ?? null;

    const nextPayload = {
      ...currentPayload,
      leads: generatorTotals.leads,
      estimatedValue: generatorTotals.estimatedValue,
      generatorBlocks,
      details: {
        ...(currentPayload?.details && typeof currentPayload.details === "object" ? currentPayload.details : {}),
        opportunities: generatorTotals.opportunities,
        profile: profile ?? currentPayload?.details?.profile ?? null,
      },
      meta: {
        ...currentMeta,
        snapshotDate: resolvedSnapshotDate,
        live: typeof live === "boolean" ? live : Boolean(block.live ?? currentMeta.live ?? false),
      },
    };

    writeUiCacheValue(
      "inrcy_generator_kpis_v1",
      JSON.stringify({
        syncedAt: nextSyncedAt,
        snapshotDate: resolvedSnapshotDate,
        payload: nextPayload,
      })
    );
  } catch {
    // ignore cache merge failures
  }
}

export function mergeChannelBlockIntoCachedSnapshots(params: {
  period: StatsWarmPeriod;
  channel: DashboardChannelKey;
  block: InrstatsChannelBlock;
  overview?: unknown;
  syncedAt?: number;
  snapshotDate?: string | null;
}) {
  const { period, channel, block, overview, syncedAt, snapshotDate } = params;
  const nextSyncedAt = Number.isFinite(Number(syncedAt)) ? Number(syncedAt) : Date.now();
  const nextSnapshotDate = typeof snapshotDate === "string" ? snapshotDate : block.snapshotDate ?? null;

  try {
    const raw = readUiCacheValue(statsCubeSessionKey(period));
    const parsed = raw ? JSON.parse(raw) as { overviews?: Record<string, unknown>; blocks?: unknown } : null;
    const overviews = parsed?.overviews && typeof parsed.overviews === "object" && !Array.isArray(parsed.overviews)
      ? { ...parsed.overviews }
      : {};
    if (overview !== undefined) {
      overviews[channel] = overview;
    }

    const existingBlocks = parsed?.blocks && typeof parsed.blocks === "object" && !Array.isArray(parsed.blocks)
      ? normalizeCachedChannelBlocks(parsed.blocks)
      : createEmptyChannelBlocks();

    writeUiCacheValue(
      statsCubeSessionKey(period),
      JSON.stringify({
        syncedAt: nextSyncedAt,
        snapshotDate: nextSnapshotDate,
        overviews,
        blocks: { ...existingBlocks, [channel]: block },
      })
    );
  } catch {
    // ignore cache merge failures
  }

  try {
    const raw = readUiCacheValue(statsSummarySessionKey(period));
    const parsed = raw ? JSON.parse(raw) as { byCube?: Record<string, unknown>; estimatedByCube?: Record<string, unknown>; profile?: unknown } : null;
    const byCube = parsed?.byCube && typeof parsed.byCube === "object" && !Array.isArray(parsed.byCube)
      ? { ...parsed.byCube }
      : {};
    const estimatedByCube = parsed?.estimatedByCube && typeof parsed.estimatedByCube === "object" && !Array.isArray(parsed.estimatedByCube)
      ? { ...parsed.estimatedByCube }
      : {};

    byCube[channel] = Math.max(0, Math.round(block.opportunities || 0));
    estimatedByCube[channel] = Math.max(0, Math.round(block.estimatedValue || 0));

    const total = Object.values(byCube).reduce<number>((sum, value) => {
      const numeric = Number(value);
      return sum + (Number.isFinite(numeric) ? numeric : 0);
    }, 0);

    writeUiCacheValue(
      statsSummarySessionKey(period),
      JSON.stringify({
        syncedAt: nextSyncedAt,
        snapshotDate: nextSnapshotDate,
        total: Math.max(0, Math.round(total)),
        byCube,
        profile: parsed?.profile ?? {},
        estimatedByCube,
      })
    );
  } catch {
    // ignore cache merge failures
  }
}
