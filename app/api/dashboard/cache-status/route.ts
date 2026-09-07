import { NextResponse } from "next/server";
import { createSupabaseServer } from "@/lib/supabaseServer";
import { resolveActiveInrcyAccountId } from "@/lib/multicompte/server";
import { DASHBOARD_CHANNEL_KEYS, type DashboardChannelKey } from "@/lib/dashboardChannels";
import { buildStatsConnectionSignature } from "@/lib/stats/connectionSignature";
import { getSimpleFrenchErrorMessage } from "@/lib/userFacingErrors";

const CACHE_TTL_MS = 12 * 60 * 60 * 1000;
const PERIODS = [7, 30] as const;

type PeriodKey = (typeof PERIODS)[number];
type AnyRec = Record<string, unknown>;
type ChannelStatus = {
  syncedAt: number;
  channels: Record<DashboardChannelKey, number>;
};

 type PeriodStatus = ChannelStatus;
 type GeneratorStatus = ChannelStatus;

const INCLUDE_TO_CHANNEL: Record<string, DashboardChannelKey> = {
  site_inrcy: "site_inrcy",
  site_web: "site_web",
  gmb: "gmb",
  facebook: "facebook",
  instagram: "instagram",
  linkedin: "linkedin",
  x: "x",
  twitter: "x",
  tiktok: "tiktok",
};

function emptyChannelStatus(): ChannelStatus {
  return {
    syncedAt: 0,
    channels: DASHBOARD_CHANNEL_KEYS.reduce((acc, channel) => {
      acc[channel] = 0;
      return acc;
    }, {} as Record<DashboardChannelKey, number>),
  };
}

function asRecord(value: unknown): AnyRec {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as AnyRec) : {};
}

function toTs(value: unknown): number {
  const raw = typeof value === "string" || typeof value === "number" ? new Date(value).getTime() : Number.NaN;
  return Number.isFinite(raw) ? raw : 0;
}

function inferSnapshotTs(row: AnyRec): number {
  const payload = asRecord(row.payload);
  const meta = asRecord(payload.meta);
  const generatedAt = toTs(meta.generatedAt);
  if (generatedAt > 0) return generatedAt;

  const expiresAt = toTs(row.expires_at);
  if (expiresAt > 0) return Math.max(0, expiresAt - CACHE_TTL_MS);
  return 0;
}

function inferChannelTs(payload: AnyRec, channel: DashboardChannelKey, fallbackTs: number): number {
  const blocks = asRecord(payload.blocks);
  const blockSyncAt = Number(asRecord(blocks[channel]).syncAt);
  if (Number.isFinite(blockSyncAt) && blockSyncAt > 0) return blockSyncAt;

  const overviews = asRecord(payload.overviews);
  const overviewMeta = asRecord(asRecord(overviews[channel]).meta);
  const overviewTs = toTs(overviewMeta.generatedAt);
  if (overviewTs > 0) return overviewTs;

  return fallbackTs;
}

function inferChannelFromRangeKey(rangeKey: string): DashboardChannelKey | null {
  const match = rangeKey.match(/(?:^|\|)include=([^|]+)(?:\||$)/);
  if (!match) return null;
  return INCLUDE_TO_CHANNEL[match[1] || ""] ?? null;
}

export async function GET() {
  try {
    const supabase = await createSupabaseServer();
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (!user) {
      return NextResponse.json({ error: "Non authentifié." }, { status: 401 });
    }

    const activeUserId = await resolveActiveInrcyAccountId(supabase, user.id);

    const nowIso = new Date().toISOString();
    const { data: rows = [] } = await supabase
      .from("stats_cache")
      .select("source, range_key, payload, expires_at")
      .eq("user_id", activeUserId)
      .in("source", ["metrics_summary", "overview"])
      .gt("expires_at", nowIso);

    const currentConnectionSignature = await buildStatsConnectionSignature(supabase, activeUserId);
    let latestGeneratorConnectionSignature: string | null = null;
    let latestGeneratorCacheTs = 0;

    let generatorSyncedAt = 0;
    const generator: GeneratorStatus = emptyChannelStatus();
    const inrstats: Record<PeriodKey, PeriodStatus> = {
      7: emptyChannelStatus(),
      30: emptyChannelStatus(),
    };

    for (const row of Array.isArray(rows) ? rows : []) {
      const rec = asRecord(row);
      const source = String(rec.source ?? "");
      const ts = inferSnapshotTs(rec);
      if (ts <= 0) continue;

      if (source === "metrics_summary") {
        if (ts > generatorSyncedAt) generatorSyncedAt = ts;
        generator.syncedAt = Math.max(generator.syncedAt, ts);
        const payload = asRecord(rec.payload);
        if (ts >= latestGeneratorCacheTs) {
          latestGeneratorCacheTs = ts;
          const meta = asRecord(payload.meta);
          latestGeneratorConnectionSignature = typeof meta.connectionSignature === "string" ? meta.connectionSignature : null;
        }
        const blocks = asRecord(payload.generatorBlocks);
        for (const channel of DASHBOARD_CHANNEL_KEYS) {
          const blockSyncAt = Number(asRecord(blocks[channel]).syncAt);
          generator.channels[channel] = Math.max(
            generator.channels[channel],
            Number.isFinite(blockSyncAt) && blockSyncAt > 0 ? blockSyncAt : ts,
          );
        }
        continue;
      }

      if (source !== "overview") continue;
      const rangeKey = String(rec.range_key ?? "");
      const match = rangeKey.match(/(?:^|\|)days=(\d+)(?:\||$)/);
      const period = match ? Number(match[1]) : 0;
      if (period !== 7 && period !== 30) continue;

      const periodStatus = inrstats[period];
      periodStatus.syncedAt = Math.max(periodStatus.syncedAt, ts);

      if (ts > generatorSyncedAt) generatorSyncedAt = ts;
      generator.syncedAt = Math.max(generator.syncedAt, ts);

      const payload = asRecord(rec.payload);
      const rangeChannel = inferChannelFromRangeKey(rangeKey);
      if (rangeChannel) {
        const channelTs = inferChannelTs(payload, rangeChannel, ts);
        periodStatus.channels[rangeChannel] = Math.max(
          periodStatus.channels[rangeChannel],
          channelTs,
        );
        generator.channels[rangeChannel] = Math.max(generator.channels[rangeChannel], channelTs);
        continue;
      }

      for (const channel of DASHBOARD_CHANNEL_KEYS) {
        const channelTs = inferChannelTs(payload, channel, ts);
        periodStatus.channels[channel] = Math.max(
          periodStatus.channels[channel],
          channelTs,
        );
        generator.channels[channel] = Math.max(generator.channels[channel], channelTs);
      }
    }

    const generatorNeedsRefresh = latestGeneratorConnectionSignature !== currentConnectionSignature;

    return NextResponse.json({
      generator: { syncedAt: generatorSyncedAt, channels: generator.channels },
      inrstats,
      connections: {
        signature: currentConnectionSignature,
        cachedGeneratorSignature: latestGeneratorConnectionSignature,
        needsRefresh: generatorNeedsRefresh,
      },
      checkedAt: new Date().toISOString(),
    });
  } catch (error) {
    return NextResponse.json(
      { error: getSimpleFrenchErrorMessage(error, "Impossible de lire l'état du cache.") },
      { status: 500 },
    );
  }
}
