import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import type { GeneratorChannelBlock } from "@/lib/generator/channelBlocks";
import type { CubeKey, Overview } from "@/lib/metrics/computeMetrics";

const LINKEDIN: CubeKey = "linkedin";

type AnyRec = Record<string, unknown>;

export type LinkedInStatsFallback = {
  block: GeneratorChannelBlock;
  connectionSignature: string | null;
  source: "metrics_summary";
};

function asRecord(value: unknown): AnyRec {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as AnyRec) : {};
}

function toNonNegativeInt(value: unknown) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.round(n)) : 0;
}

function toOptionalSyncAt(value: unknown): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? n : null;
}

const LINKEDIN_SIGNAL_KEYS = [
  "messages",
  "conversations",
  "impressions",
  "impressionCount",
  "uniqueImpressionsCount",
  "viewerImpressions",
  "engagements",
  "likes",
  "likeCount",
  "comments",
  "commentCount",
  "shares",
  "shareCount",
  "clicks",
  "clickCount",
  "linkClickCount",
  "premiumCtaClickCount",
  "pageClicks",
  "profileViews",
  "profileViewFromContentCount",
  "pageViews",
  "postsPublished",
  "postSaveCount",
  "postSendCount",
] as const;

function sumLinkedInMetricSignals(metrics: unknown) {
  const m = asRecord(metrics);
  const totals = asRecord(m.totals);
  let total = 0;

  for (const key of LINKEDIN_SIGNAL_KEYS) {
    total += toNonNegativeInt(totals[key]);
    total += toNonNegativeInt(m[key]);
  }

  return total;
}

function linkedInRawHasError(value: unknown): boolean {
  if (!value || typeof value !== "object") return false;
  if (Array.isArray(value)) return value.some((entry) => String(entry || "").trim().length > 0);
  const rec = value as AnyRec;
  if (typeof rec.error === "string" && rec.error.trim()) return true;
  if (Array.isArray(rec.errors) && rec.errors.some((entry) => String(entry || "").trim())) return true;
  return Object.values(rec).some((entry) => linkedInRawHasError(entry));
}

export function hasUsableLinkedInMetrics(metrics: unknown) {
  const m = asRecord(metrics);
  if (!Object.keys(m).length) return false;
  if (typeof m.error === "string" && m.error.trim()) return false;
  if (sumLinkedInMetricSignals(m) > 0) return true;

  // Followers seuls + erreurs API = stats partielles, pas un vrai snapshot à 0.
  // Followers seuls sans erreur peuvent seulement servir de potentiel, pas de demandes captées.
  return false;
}

function normalizeGeneratorBlock(raw: unknown): GeneratorChannelBlock | null {
  const block = asRecord(raw);
  if (!Object.keys(block).length) return null;

  const leads = asRecord(block.leads);
  const opportunities = asRecord(block.opportunities);
  const normalized: GeneratorChannelBlock = {
    channel: LINKEDIN,
    leads: {
      today: toNonNegativeInt(leads.today),
      week: toNonNegativeInt(leads.week),
      month: toNonNegativeInt(leads.month),
    },
    opportunities: {
      month: toNonNegativeInt(opportunities.month),
    },
    estimatedValue: toNonNegativeInt(block.estimatedValue),
    syncAt: toOptionalSyncAt(block.syncAt),
    snapshotDate: typeof block.snapshotDate === "string" ? block.snapshotDate : null,
    live: Boolean(block.live),
    error: typeof block.error === "string" && block.error.trim() ? block.error.trim() : null,
  };

  if (normalized.error) return null;
  if (!hasUsableLinkedInFallbackBlock(normalized)) return null;
  return normalized;
}

export function hasUsableLinkedInFallbackBlock(block: GeneratorChannelBlock | null | undefined) {
  return Boolean(
    block &&
      (toNonNegativeInt(block.opportunities?.month) > 0 ||
        toNonNegativeInt(block.leads?.week) > 0 ||
        toNonNegativeInt(block.leads?.month) > 0)
  );
}

export async function readLastGoodLinkedInGeneratorBlock(params: {
  supabase: SupabaseClient;
  userId: string;
  connectionSignature?: string | null;
  limit?: number;
}): Promise<LinkedInStatsFallback | null> {
  const wantedSignature = typeof params.connectionSignature === "string" && params.connectionSignature.trim()
    ? params.connectionSignature.trim()
    : null;

  try {
    const { data: rows = [] } = await params.supabase
      .from("stats_cache")
      .select("payload, expires_at")
      .eq("user_id", params.userId)
      .eq("source", "metrics_summary")
      .order("expires_at", { ascending: false })
      .limit(Math.max(1, params.limit ?? 25));

    for (const row of Array.isArray(rows) ? rows : []) {
      const payload = asRecord(asRecord(row).payload);
      if (!Object.keys(payload).length) continue;

      const meta = asRecord(payload.meta);
      const rowSignature = typeof meta.connectionSignature === "string" && meta.connectionSignature.trim()
        ? meta.connectionSignature.trim()
        : null;

      // Protection anti-mauvais compte : si on connait la signature actuelle,
      // on ne reprend qu'un cache produit avec exactement les mêmes connexions.
      if (wantedSignature && rowSignature !== wantedSignature) continue;

      const blocks = asRecord(payload.generatorBlocks);
      const block = normalizeGeneratorBlock(blocks.linkedin);
      if (!block) continue;

      return {
        block,
        connectionSignature: rowSignature,
        source: "metrics_summary",
      };
    }
  } catch {
    // Best effort only: no fallback if the cache table is unavailable.
  }

  return null;
}

export function isLinkedInOverviewTemporarilyUnavailable(overview: Overview | null | undefined) {
  if (!overview) return true;
  const node = asRecord(asRecord(overview.sources).linkedin);
  if (node.connected === false) return false;
  const metrics = node.metrics;
  if (metrics === null || metrics === undefined) return true;

  // LinkedIn renvoie parfois une réponse techniquement OK, mais avec uniquement
  // des compteurs à zéro ou des sous-appels vides. Dans ce cas les calculs
  // retombent à 0 et peuvent écraser un bon snapshot quelques secondes après
  // une reconnexion. On considère donc cette réponse comme temporairement
  // indisponible quand aucun signal métier exploitable n'est présent.
  return !hasUsableLinkedInMetrics(metrics);
}

export function shouldUseLinkedInStatsFallback(params: {
  overview: Overview | null | undefined;
  statsConnected: boolean;
  currentOpportunity: unknown;
  currentWeekLeads: unknown;
  currentMonthLeads: unknown;
  fallback: LinkedInStatsFallback | null | undefined;
}) {
  if (!params.statsConnected) return false;
  if (!hasUsableLinkedInFallbackBlock(params.fallback?.block)) return false;
  if (!isLinkedInOverviewTemporarilyUnavailable(params.overview)) return false;

  // Une panne LinkedIn peut vider les opportunités OU les demandes captées.
  // Si un ancien bloc exploitable existe, on le reprend tant que l'overview LinkedIn
  // courante est temporairement indisponible.
  return (
    toNonNegativeInt(params.currentOpportunity) === 0 ||
    toNonNegativeInt(params.currentWeekLeads) === 0 ||
    toNonNegativeInt(params.currentMonthLeads) === 0
  );
}

function recomputeOpportunityTotals(opportunities: AnyRec) {
  const byCube = asRecord(opportunities.byCube) as Partial<Record<CubeKey, number>>;
  const total = (["site_inrcy", "site_web", "gmb", "facebook", "instagram", "linkedin", "x"] as CubeKey[])
    .reduce((sum, cube) => sum + toNonNegativeInt(byCube[cube]), 0);
  const baseDays = Math.max(1, toNonNegativeInt(opportunities.baseDays) || 30);

  opportunities.total = total;
  opportunities.month = total;
  opportunities.week = Math.max(0, Math.round((total / baseDays) * 7));
  opportunities.today = Math.max(0, Math.round((total / baseDays) * 2));
  opportunities.confidence = total >= 30 ? "high" : total >= 10 ? "medium" : "low";
}

export function applyLinkedInFallbackToStatsRecords(params: {
  overviews: Partial<Record<CubeKey, Overview>>;
  opportunities: AnyRec;
  capturedLeadsByCube: {
    week: Partial<Record<CubeKey, number>>;
    month: Partial<Record<CubeKey, number>>;
  };
  estimatedByCube: Partial<Record<CubeKey, number>>;
  statsConnected: boolean;
  fallback: LinkedInStatsFallback | null | undefined;
  leadConversionRate?: unknown;
  avgBasket?: unknown;
}) {
  const byCube = asRecord(params.opportunities.byCube) as Partial<Record<CubeKey, number>>;
  const currentOpportunity = byCube.linkedin;
  const currentWeekLeads = params.capturedLeadsByCube.week.linkedin;
  const currentMonthLeads = params.capturedLeadsByCube.month.linkedin;

  const shouldPreserve = shouldUseLinkedInStatsFallback({
    overview: params.overviews.linkedin ?? null,
    statsConnected: params.statsConnected,
    currentOpportunity,
    currentWeekLeads,
    currentMonthLeads,
    fallback: params.fallback,
  });

  if (!shouldPreserve || !params.fallback?.block) return false;

  const fallbackBlock = params.fallback.block;
  const fallbackOpportunity = toNonNegativeInt(fallbackBlock.opportunities.month);
  const fallbackWeekLeads = toNonNegativeInt(fallbackBlock.leads.week);
  const fallbackMonthLeads = toNonNegativeInt(fallbackBlock.leads.month);
  const fallbackEstimated = toNonNegativeInt(fallbackBlock.estimatedValue);
  const rate = Number(params.leadConversionRate);
  const basket = Number(params.avgBasket);

  byCube.linkedin = fallbackOpportunity;
  params.opportunities.byCube = byCube;
  recomputeOpportunityTotals(params.opportunities);

  params.capturedLeadsByCube.week.linkedin = fallbackWeekLeads;
  params.capturedLeadsByCube.month.linkedin = fallbackMonthLeads;
  params.estimatedByCube.linkedin = fallbackEstimated > 0
    ? fallbackEstimated
    : Math.max(0, Math.round(fallbackOpportunity * ((Number.isFinite(rate) ? rate : 0) / 100) * (Number.isFinite(basket) ? basket : 0)));

  return true;
}
