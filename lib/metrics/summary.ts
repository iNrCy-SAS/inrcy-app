import 'server-only';

import type { SupabaseClient } from '@supabase/supabase-js';
import { buildSnapshotWindow } from '@/lib/stats/snapshotWindow';
import { buildStatsConnectionSignature } from '@/lib/stats/connectionSignature';
import { createInrcyPublishedActivityLoader } from '@/lib/stats/buildOverview.activity';
import { hasUsableLinkedInFallbackBlock, readLastGoodLinkedInGeneratorBlock, shouldUseLinkedInStatsFallback } from '@/lib/linkedinStatsFallback';
import { buildGeneratorChannelBlocks, summarizeGeneratorChannelBlocks, type GeneratorChannelBlocksByChannel } from '@/lib/generator/channelBlocks';
import {
  EMPTY_CUBE_RECORD,
  computeHistoryFromOverviews,
  computeOpportunitiesFromOverviews,
  fetchCubeOverviews,
  invalidateOverviewCache,
  toInrstatsSnapshot,
  type CubeKey,
  type Overview,
} from '@/lib/metrics/computeMetrics';

type AnyRec = Record<string, unknown>;

type ProfileMetrics = {
  lead_conversion_rate: number;
  avg_basket: number;
};

export type MetricsSummary = {
  leads: {
    month: number;
    week: number;
    today: number;
    byTool: Record<CubeKey, number>;
  };
  estimatedValue: number;
  generatorBlocks: GeneratorChannelBlocksByChannel;
  details: {
    opportunities: ReturnType<typeof toInrstatsSnapshot>;
    profile: ProfileMetrics;
  };
  meta: {
    source: 'api/metrics/summary';
    generatedAt: string;
    snapshotDate: string | null;
    live: boolean;
    connectionSignature?: string;
  };
};

function asRecord(v: unknown): Record<string, unknown> {
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
}

function pickFirst<T>(...vals: Array<T | null | undefined>): T | null {
  for (const v of vals) if (v !== null && v !== undefined) return v;
  return null;
}

function toNumber(v: unknown, fallback = 0): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function safeJsonValue<T>(v: unknown, fallback: T): T {
  return v !== null && v !== undefined ? (v as T) : fallback;
}

async function repairLinkedInCachedSummary(args: {
  supabase: SupabaseClient;
  userId: string;
  payload: MetricsSummary;
  connectionSignature: string;
  monthDays: number;
  weekDays: number;
  todayDays: number;
}): Promise<MetricsSummary> {
  const blocks = args.payload.generatorBlocks;
  if (hasUsableLinkedInFallbackBlock(blocks?.linkedin)) return args.payload;

  const fallback = await readLastGoodLinkedInGeneratorBlock({
    supabase: args.supabase,
    userId: args.userId,
    connectionSignature: args.connectionSignature,
  });

  if (!hasUsableLinkedInFallbackBlock(fallback?.block)) return args.payload;

  const generatorBlocks: GeneratorChannelBlocksByChannel = {
    ...blocks,
    linkedin: {
      ...fallback!.block,
      error: null,
    },
  };
  const totals = summarizeGeneratorChannelBlocks({
    blocks: generatorBlocks,
    monthDays: args.monthDays,
    weekDays: args.weekDays,
    todayDays: args.todayDays,
  });

  return {
    ...args.payload,
    leads: totals.leads,
    estimatedValue: totals.estimatedValue,
    generatorBlocks,
    details: {
      ...args.payload.details,
      opportunities: totals.opportunities,
    },
    meta: {
      ...args.payload.meta,
      connectionSignature: args.connectionSignature,
    },
  };
}

async function buildSummaryConnectionsKey(supabase: SupabaseClient, userId: string): Promise<string> {
  return buildStatsConnectionSignature(supabase, userId);
}

async function getProfile(
  supabase: SupabaseClient,
  userId: string,
  debug?: AnyRec
): Promise<ProfileMetrics> {
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw new Error(`Supabase profiles error: ${error.message}`);

  const row = (data as unknown) || null;
  if (debug) {
    debug.profiles_found = row ? 1 : 0;
    debug.profile_fields = row ? Object.keys(asRecord(row)) : [];
  }

  const r = asRecord(row);
  return {
    lead_conversion_rate: toNumber(
      pickFirst(r['lead_conversion_rate'], r['tx_conversion'], r['conversion_rate'], r['leadConversionRate']),
      0
    ),
    avg_basket: toNumber(
      pickFirst(r['avg_basket'], r['panier_moyen'], r['average_basket'], r['avgBasket']),
      0
    ),
  };
}

export async function buildMetricsSummary(args: {
  supabase: SupabaseClient;
  userId: string;
  origin: string;
  getHeaders?: () => HeadersInit | undefined;
  monthDays?: number;
  weekDays?: number;
  todayDays?: number;
  debug?: AnyRec;
  fresh?: boolean;
  snapshotDate?: string | null;
  profileOverride?: ProfileMetrics;
  monthOverviewsOverride?: Partial<Record<CubeKey, Overview>>;
  weekOverviewsOverride?: Partial<Record<CubeKey, Overview>>;
}): Promise<MetricsSummary> {
  const {
    supabase,
    userId,
    origin,
    getHeaders,
    monthDays = 30,
    weekDays = 7,
    todayDays = 2,
    debug,
    fresh = false,
    snapshotDate,
    profileOverride,
    monthOverviewsOverride,
    weekOverviewsOverride,
  } = args;

  const safe = async <T,>(key: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch (e: unknown) {
      if (debug) {
        const errors = (debug.errors = asRecord(debug.errors));
        errors[String(key)] = e instanceof Error ? e.message : String(e);
      }
      return fallback;
    }
  };

  if (debug) {
    debug.windows = { monthDays, weekDays, todayDays, fresh };
  }

  if (fresh) {
    invalidateOverviewCache();
  }

  const dateWindow = buildSnapshotWindow({ days: monthDays, fresh, snapshotDate });
  const connectionSignature = await buildSummaryConnectionsKey(supabase, userId);

  let cacheRangeKey: string | null = null;

  if (!fresh) {
    cacheRangeKey = `month=${monthDays}|week=${weekDays}|today=${todayDays}|snapshot=${dateWindow.snapshotDate || 'live'}|conn=${connectionSignature}`;
    try {
      const nowIso = new Date().toISOString();
      const { data: cacheHit } = await supabase
        .from('stats_cache')
        .select('payload, expires_at')
        .eq('user_id', userId)
        .eq('source', 'metrics_summary')
        .eq('range_key', cacheRangeKey)
        .gt('expires_at', nowIso)
        .order('expires_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      const payload = safeJsonValue<MetricsSummary | null>(asRecord(cacheHit)['payload'], null);
      if (payload) {
        return await repairLinkedInCachedSummary({
          supabase,
          userId,
          payload,
          connectionSignature,
          monthDays,
          weekDays,
          todayDays,
        });
      }
    } catch {}
  }

  const inrcyPublishedActivityLoader = createInrcyPublishedActivityLoader({ supabase, userId });
  const [profile, monthOverviews, weekOverviews] = await Promise.all([
    profileOverride
      ? Promise.resolve(profileOverride)
      : safe('profile', () => getProfile(supabase, userId, debug), {
          lead_conversion_rate: 0,
          avg_basket: 0,
        }),
    monthOverviewsOverride
      ? Promise.resolve(monthOverviewsOverride)
      : safe('overviews_30d', () => fetchCubeOverviews({ origin, days: monthDays, getHeaders, bypassCache: fresh, supabase, userId, snapshotDate: dateWindow.snapshotDate, inrcyPublishedActivityLoader }), {}),
    weekOverviewsOverride
      ? Promise.resolve(weekOverviewsOverride)
      : safe('overviews_7d', () => fetchCubeOverviews({ origin, days: weekDays, getHeaders, bypassCache: fresh, supabase, userId, snapshotDate: dateWindow.snapshotDate, inrcyPublishedActivityLoader }), {}),
  ]);

  const [oppResolved, history30Resolved, history7Resolved] = await Promise.all([
    safe(
      'opportunities',
      async () => {
        const snapshot = toInrstatsSnapshot(computeOpportunitiesFromOverviews(monthOverviews, monthDays));
        return {
          ...snapshot,
          today: Math.max(0, Math.round((snapshot.total / Math.max(1, monthDays)) * todayDays)),
          week: Math.max(0, Math.round((snapshot.total / Math.max(1, monthDays)) * weekDays)),
          month: snapshot.total,
        };
      },
      {
        baseDays: monthDays,
        today: 0,
        week: 0,
        month: 0,
        total: 0,
        confidence: 'low' as const,
        byCube: { ...EMPTY_CUBE_RECORD },
      }
    ),
    safe(
      'history_30d',
      async () => computeHistoryFromOverviews(monthOverviews, monthDays),
      {
        days: monthDays,
        total: 0,
        perTool: { ...EMPTY_CUBE_RECORD },
        model: 'captured_v2.0',
      }
    ),
    safe(
      'history_7d',
      async () => computeHistoryFromOverviews(weekOverviews, weekDays),
      {
        days: weekDays,
        total: 0,
        perTool: { ...EMPTY_CUBE_RECORD },
        model: 'captured_v2.0',
      }
    ),
  ]);

  const generatedAt = new Date().toISOString();
  const generatorBlocks = buildGeneratorChannelBlocks({
    monthLeadsByCube: history30Resolved.perTool || { ...EMPTY_CUBE_RECORD },
    weekLeadsByCube: history7Resolved.perTool || { ...EMPTY_CUBE_RECORD },
    opportunitiesByCube: oppResolved.byCube || { ...EMPTY_CUBE_RECORD },
    leadConversionRate: profile.lead_conversion_rate,
    avgBasket: profile.avg_basket,
    generatedAt,
    snapshotDate: dateWindow.snapshotDate,
    live: dateWindow.live,
  });

  const linkedInFallback = await readLastGoodLinkedInGeneratorBlock({
    supabase,
    userId,
    connectionSignature,
  });
  const linkedInConnected = Boolean(
    (monthOverviews.linkedin as Overview | undefined)?.sources?.linkedin?.connected ||
      (weekOverviews.linkedin as Overview | undefined)?.sources?.linkedin?.connected
  );
  if (shouldUseLinkedInStatsFallback({
    overview: (monthOverviews.linkedin as Overview | undefined) ?? null,
    statsConnected: linkedInConnected,
    currentOpportunity: oppResolved.byCube?.linkedin,
    currentWeekLeads: history7Resolved.perTool?.linkedin,
    currentMonthLeads: history30Resolved.perTool?.linkedin,
    fallback: linkedInFallback,
  }) && linkedInFallback?.block) {
    const syncAt = Date.parse(generatedAt);
    generatorBlocks.linkedin = {
      ...generatorBlocks.linkedin,
      leads: { ...linkedInFallback.block.leads },
      opportunities: { month: Math.max(0, Math.round(Number(linkedInFallback.block.opportunities.month || 0))) },
      estimatedValue: Math.max(0, Math.round(Number(linkedInFallback.block.estimatedValue || 0))),
      syncAt: Number.isFinite(syncAt) ? syncAt : generatorBlocks.linkedin.syncAt,
      snapshotDate: dateWindow.snapshotDate ?? linkedInFallback.block.snapshotDate ?? null,
      live: Boolean(dateWindow.live),
      error: null,
    };
  }

  const generatorTotals = summarizeGeneratorChannelBlocks({
    blocks: generatorBlocks,
    monthDays,
    weekDays,
    todayDays,
  });

  const payload: MetricsSummary = {
    leads: generatorTotals.leads,
    estimatedValue: generatorTotals.estimatedValue,
    generatorBlocks,
    details: {
      opportunities: generatorTotals.opportunities,
      profile,
    },
    meta: {
      source: 'api/metrics/summary',
      generatedAt,
      snapshotDate: dateWindow.snapshotDate,
      live: dateWindow.live,
      connectionSignature,
    },
  };

  try {
    // Keep the shared generator/iNrStats snapshot warm for a very short period
    // so another device catches up quickly without waiting for hours.
    const rangeKey = cacheRangeKey ?? `month=${monthDays}|week=${weekDays}|today=${todayDays}|snapshot=${dateWindow.snapshotDate || 'live'}|conn=${connectionSignature}`;
    const expiresAt = new Date(Date.now() + 12 * 60 * 60 * 1000).toISOString();
    await supabase.from('stats_cache').upsert(
      {
        user_id: userId,
        source: 'metrics_summary',
        range_key: rangeKey,
        payload,
        expires_at: expiresAt,
      },
      { onConflict: 'user_id,source,range_key' },
    );
  } catch {}

  return payload;
}
