/** Read-only reporting values. Never derive performance from budget or AI projections. */
export type AdsCampaignMetrics = {
  period: "last_30_days";
  source: "google" | "meta" | "linkedin";
  impressions: number;
  clicks: number;
  spendEuros: number;
  conversions: number | null;
  fetchedAt: string;
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function nonNegativeNumber(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (typeof value === "string" && !/^\d+(?:\.\d+)?$/.test(value)) return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : null;
}

/** Google Ads REST uses ProtoJSON: selected scalar metrics equal to zero may be omitted. */
function googleScalarMetric(metrics: Record<string, unknown>, key: string): number | null {
  return Object.hasOwn(metrics, key) ? nonNegativeNumber(metrics[key]) : 0;
}

/** A missing report row means "no data", not zero performance. */
export function parseGoogleAdsMetrics(payload: unknown, fetchedAt: string): AdsCampaignMetrics | null {
  const rows = record(payload).results;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const metrics = record(record(rows[0]).metrics);
  const selected = ["impressions", "clicks", "costMicros", "conversions"];
  if (!selected.some((key) => Object.hasOwn(metrics, key))) {
    throw new Error("Rapport Google Ads incomplet.");
  }
  const impressions = googleScalarMetric(metrics, "impressions");
  const clicks = googleScalarMetric(metrics, "clicks");
  const costMicros = googleScalarMetric(metrics, "costMicros");
  const conversions = googleScalarMetric(metrics, "conversions");
  if (impressions === null || clicks === null || costMicros === null || conversions === null) {
    throw new Error("Rapport Google Ads incomplet.");
  }
  return {
    period: "last_30_days", source: "google", impressions, clicks,
    spendEuros: costMicros / 1_000_000, conversions, fetchedAt,
  };
}

export function parseMetaAdsMetrics(payload: unknown, fetchedAt: string): AdsCampaignMetrics | null {
  const rows = record(payload).data;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const metrics = record(rows[0]);
  const impressions = nonNegativeNumber(metrics.impressions);
  const clicks = nonNegativeNumber(metrics.clicks);
  const spendEuros = nonNegativeNumber(metrics.spend);
  if (impressions === null || clicks === null || spendEuros === null) {
    throw new Error("Rapport Meta Ads incomplet.");
  }
  // A Meta "conversion" depends on the configured action type and attribution
  // window. Do not collapse heterogeneous actions into a misleading number.
  return {
    period: "last_30_days", source: "meta", impressions, clicks,
    spendEuros, conversions: null, fetchedAt,
  };
}

export function parseLinkedInAdsMetrics(
  payload: unknown,
  fetchedAt: string,
  campaignUrn: string,
): AdsCampaignMetrics | null {
  const rows = record(payload).elements;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  let impressions = 0;
  let clicks = 0;
  let spendEuros = 0;
  let conversions = 0;
  for (const value of rows) {
    const row = record(value);
    const pivots = Array.isArray(row.pivotValues) ? row.pivotValues : [];
    if (pivots.length !== 1 || pivots[0] !== campaignUrn) throw new Error("Rapport LinkedIn Ads incohérent.");
    if (!["impressions", "clicks", "landingPageClicks", "costInLocalCurrency", "externalWebsiteConversions"]
      .some((key) => Object.hasOwn(row, key))) throw new Error("Rapport LinkedIn Ads incomplet.");
    const rowImpressions = Object.hasOwn(row, "impressions") ? nonNegativeNumber(row.impressions) : 0;
    const rowClicks = Object.hasOwn(row, "clicks") ? nonNegativeNumber(row.clicks)
      : Object.hasOwn(row, "landingPageClicks") ? nonNegativeNumber(row.landingPageClicks) : 0;
    const rowSpend = Object.hasOwn(row, "costInLocalCurrency") ? nonNegativeNumber(row.costInLocalCurrency) : 0;
    const rowConversions = Object.hasOwn(row, "externalWebsiteConversions")
      ? nonNegativeNumber(row.externalWebsiteConversions) : 0;
    if (rowImpressions === null || rowClicks === null || rowSpend === null || rowConversions === null) {
      throw new Error("Rapport LinkedIn Ads incomplet.");
    }
    impressions += rowImpressions;
    clicks += rowClicks;
    spendEuros += rowSpend;
    conversions += rowConversions;
  }
  return { period: "last_30_days", source: "linkedin", impressions, clicks, spendEuros, conversions, fetchedAt };
}

export function googleCampaignId(resources: unknown, accountId: string): string | null {
  const value = record(resources).campaignResourceName;
  const match = typeof value === "string" ? value.match(/^customers\/(\d+)\/campaigns\/(\d+)$/) : null;
  return match && match[1] === accountId ? match[2] : null;
}

export function metaCampaignId(resources: unknown, accountId: string): string | null {
  const value = record(resources);
  const campaignId = value.campaignId;
  return value.provider === "meta" && value.adAccountId === accountId &&
    typeof campaignId === "string" && /^\d+$/.test(campaignId) ? campaignId : null;
}
