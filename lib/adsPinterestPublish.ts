import { assessAdsChannelDraft, type PinterestAdsDraft } from "./adsChannelDrafts.ts";
import { missingPinterestAdsScopes, type PinterestAdsAccount } from "./adsPinterestPolicy.ts";
import type { PinterestResolvedTargeting } from "./adsPinterestLocations.ts";

/** Keep the reviewed tracking query on both the Pin and the paid ad. */
export function pinterestDestinationUrl(destinationUrl: string, trackingParameters: string): string {
  const tracking = trackingParameters.trim().replace(/^[?&]+/, "");
  if (!tracking) return destinationUrl;
  if (tracking.length > 500 || /[\[\]\r\n#?]/.test(tracking)
    || tracking.split("&").some((part) => !/^[^=&\s]+=[^&]*$/.test(part))) {
    throw new Error("Les balises de suivi Pinterest doivent être des paramètres URL au format nom=valeur&nom=valeur.");
  }
  const destination = new URL(destinationUrl);
  for (const [name, value] of new URLSearchParams(tracking)) destination.searchParams.set(name, value);
  return destination.toString();
}

/** A batch HTTP 200 may still contain an item-level failure. */
export function assertPinterestBatchStatus(payload: unknown, expectedId: string, expectedStatus: "ACTIVE" | "PAUSED"): void {
  const object = (value: unknown): Record<string, unknown> => value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const items = object(payload).items;
  const item = Array.isArray(items) && items.length === 1 ? object(items[0]) : {};
  const data = object(item.data);
  const exceptions = item.exceptions;
  if ((Array.isArray(exceptions) && exceptions.length) || data.id !== expectedId || data.status !== expectedStatus) {
    throw new Error(`Pinterest n’a pas confirmé le statut ${expectedStatus} de la ressource ${expectedId}. Vérifiez la campagne dans Pinterest Ads Manager.`);
  }
}

/**
 * Pinterest v5 campaign preparation only. This module has no HTTP side effects.
 * Pinterest supports a native DRAFT state that cannot serve or accrue costs;
 * PAUSED is not equivalent because some campaign fields become immutable.
 * A campaign alone is not an ad: targeting, an ad group and a verified Pin or
 * catalog still require separate provider-backed checks before activation.
 *
 * https://developers.pinterest.com/docs/work-with-ads/create-campaigns-and-ad-groups/
 * https://developers.pinterest.com/docs/work-with-ads/try-out-campaign-objective-type-simplification/
 */
export const PINTEREST_ADS_CREATION_PATHS = {
  campaigns: (adAccountId: string) => `/v5/ad_accounts/${adAccountId}/campaigns`,
  adGroups: (adAccountId: string) => `/v5/ad_accounts/${adAccountId}/ad_groups`,
  ads: (adAccountId: string) => `/v5/ad_accounts/${adAccountId}/ads`,
} as const;

export type PinterestLiveObjective = "AWARENESS" | "CONSIDERATION";
export type PinterestLivePlacementGroup = "ALL" | "SEARCH" | "BROWSE" | "OTHER";

type PinterestLiveSettings = {
  objectiveType?: unknown;
  intendedPromotionType?: unknown;
  creativeType?: unknown;
  targetingMode?: unknown;
  /** Reserved for a future UI contract; never silently accept a new placement. */
  placementGroup?: unknown;
  placementIntent?: unknown;
  placement?: unknown;
  keywords?: unknown;
  keywordIds?: unknown;
};

type PinterestLiveCampaignBodyInput = {
  name: string;
  objectiveType: PinterestLiveObjective;
  dailySpendCap?: number;
  lifetimeSpendCap?: number;
  flexibleDaily?: boolean;
  startTime?: number | null;
  adAccountId?: string;
  endTime: number;
};

type PinterestLiveAdGroupBodyInput = {
  name: string;
  campaignId: string;
  objectiveType: PinterestLiveObjective;
  bidInMicroCurrency: number | null;
  bidStrategyType?: "MAX_BID" | "AUTOMATIC_BID";
  placementGroup?: PinterestLivePlacementGroup;
  targetingSpec: PinterestResolvedTargeting;
};

type PinterestAdOnlyPinBodyInput = {
  title: string;
  description: string;
  destinationUrl: string;
  imageUrl: string;
};

type PinterestLiveAdBodyInput = {
  name: string;
  adGroupId: string;
  pinId: string;
  destinationUrl: string;
};

/**
 * The first live path deliberately exposes only automatic targeting and all
 * placements. Interest and audience labels are not Pinterest resource IDs,
 * while keyword targeting requires a separate provider mutation. Rejecting
 * those modes before the first mutation prevents a saved choice from being
 * silently replaced by broad targeting.
 */
function hasDeclaredKeywords(value: unknown): boolean {
  if (Array.isArray(value)) return value.some((item) => typeof item === "string" ? item.trim() : item != null);
  if (typeof value === "string") return Boolean(value.trim());
  return Boolean(value && typeof value === "object" && Object.keys(value).length);
}

export function pinterestLiveConfigurationIssue(
  value: PinterestLiveSettings | null | undefined,
  campaignKeywords?: unknown,
): string | null {
  if (!value || (value.objectiveType !== "AWARENESS" && value.objectiveType !== "CONSIDERATION")) {
    return "Le lancement Pinterest prend actuellement en charge les objectifs Notoriété et Considération.";
  }
  if (value.intendedPromotionType !== "STANDARD_AD" || value.creativeType !== "REGULAR") {
    return "Le lancement Pinterest prend actuellement en charge une épingle sponsorisée image standard.";
  }
  if (value.targetingMode !== "automatic") {
    return "Le lancement Pinterest prend actuellement en charge le ciblage automatique Pinterest. Les intérêts, mots-clés et audiences doivent rester en brouillon tant que leurs ressources Pinterest ne sont pas résolues.";
  }
  if (hasDeclaredKeywords(campaignKeywords ?? value.keywords ?? value.keywordIds)) {
    return "Les mots-clés Pinterest ne sont pas publiables automatiquement pour le moment. Retirez-les du lancement réel ou conservez cette configuration en brouillon.";
  }
  const declaredPlacement = value.placementGroup ?? value.placementIntent ?? value.placement;
  if (declaredPlacement != null && !["ALL", "all", "automatic"].includes(String(declaredPlacement))) {
    return "Le lancement Pinterest prend actuellement en charge tous les emplacements. Un placement plus précis doit rester en brouillon.";
  }
  return null;
}

/** Pinterest v5 campaign create payload. Every provider entity starts paused. */
export function buildPinterestLiveCampaignBody(input: PinterestLiveCampaignBodyInput) {
  if ((input.dailySpendCap != null) === (input.lifetimeSpendCap != null)) throw new Error("Choisissez une seule limite de dépense Pinterest : quotidienne ou totale.");
  return {
    name: input.name,
    status: "PAUSED" as const,
    objective_type: input.objectiveType,
    intended_promotion_type: "STANDARD_AD" as const,
    is_campaign_budget_optimization: true,
    ...(input.lifetimeSpendCap != null ? { lifetime_spend_cap: input.lifetimeSpendCap }
      : { is_flexible_daily_budgets: input.flexibleDaily === true, daily_spend_cap: input.dailySpendCap }),
    ...(input.startTime != null ? { start_time: input.startTime } : {}),
    ...(input.adAccountId ? { ad_account_id: input.adAccountId } : {}),
    end_time: input.endTime,
  };
}

/**
 * `auto_targeting_enabled` is Pinterest's ad-group Performance+ targeting,
 * not a Performance+ campaign (`is_performance_plus`). The latter has a
 * different AUTOMATIC_BID-only contract that this publisher does not enable.
 */
export function buildPinterestLiveAdGroupBody(input: PinterestLiveAdGroupBodyInput) {
  const strategy = input.bidStrategyType || "MAX_BID";
  if (strategy === "MAX_BID" && (!Number.isSafeInteger(input.bidInMicroCurrency) || Number(input.bidInMicroCurrency) <= 0) || strategy === "AUTOMATIC_BID" && input.bidInMicroCurrency != null) throw new Error("Vérifiez le montant et la stratégie d’enchères Pinterest.");
  return {
    name: input.name,
    campaign_id: input.campaignId,
    status: "PAUSED" as const,
    billable_event: input.objectiveType === "AWARENESS" ? "IMPRESSION" as const : "CLICKTHROUGH" as const,
    ...((input.bidStrategyType || "MAX_BID") === "AUTOMATIC_BID" ? {} : { bid_in_micro_currency: input.bidInMicroCurrency }),
    bid_strategy_type: input.bidStrategyType || "MAX_BID" as const,
    placement_group: input.placementGroup || "ALL" as PinterestLivePlacementGroup,
    auto_targeting_enabled: true,
    targeting_spec: input.targetingSpec,
  };
}

/** Creates a protected ad-only Pin, so no public board identifier is needed. */
export function buildPinterestAdOnlyPinBody(input: PinterestAdOnlyPinBodyInput) {
  return {
    title: input.title,
    description: input.description,
    link: input.destinationUrl,
    media_source: { source_type: "image_url" as const, url: input.imageUrl, is_standard: true },
    is_removable: true,
  };
}

export function buildPinterestLiveAdBody(input: PinterestLiveAdBodyInput) {
  return {
    name: input.name,
    ad_group_id: input.adGroupId,
    pin_id: input.pinId,
    creative_type: "REGULAR" as const,
    status: "PAUSED" as const,
    destination_url: input.destinationUrl,
    is_removable: true,
  };
}

export function buildPinterestEntityStatusPatch(id: string, status: "ACTIVE" | "PAUSED") {
  return [{ id, status }];
}

export function buildPinterestActivationSteps(
  adAccountId: string,
  ids: { campaignId: string; adGroupId: string; adId: string },
) {
  const accountPath = `/ad_accounts/${adAccountId}`;
  return [
    {
      path: `${accountPath}/ads`,
      body: buildPinterestEntityStatusPatch(ids.adId, "ACTIVE"),
      stage: "ad_activated" as const,
    },
    {
      path: `${accountPath}/ad_groups`,
      body: buildPinterestEntityStatusPatch(ids.adGroupId, "ACTIVE"),
      stage: "ad_group_activated" as const,
    },
    {
      path: `${accountPath}/campaigns`,
      body: buildPinterestEntityStatusPatch(ids.campaignId, "ACTIVE"),
      stage: "active" as const,
    },
  ];
}

export type PinterestAdsDraftCampaignBody = {
  name: string;
  status: "DRAFT";
  objective_type: PinterestAdsDraft["objectiveType"];
  intended_promotion_type: PinterestAdsDraft["intendedPromotionType"];
  is_campaign_budget_optimization: true;
  is_flexible_daily_budgets?: false;
  daily_spend_cap?: number;
  lifetime_spend_cap?: number;
};

export type PinterestAdsDraftCampaignIssue = {
  code:
    | "invalid_brief"
    | "invalid_account"
    | "account_mismatch"
    | "missing_ads_scopes"
    | "app_access_unverified"
    | "billing_unverified"
    | "campaign_permission_unverified"
    | "stale_provider_evidence"
    | "unsupported_targeting"
    | "unsupported_keywords"
    | "unsupported_placement"
    | "unsupported_budget";
  field: string;
};

/** All evidence must come from fresh server-side provider checks, not input JSON. */
export type PinterestAdsDraftCampaignContext = {
  selectedAccount: PinterestAdsAccount | null;
  grantedScopes: unknown;
  appAccess: "verified" | "unverified";
  billing: "verified" | "unverified";
  campaignWritePermission: "verified" | "unverified";
  /** Time of a fresh platform-side access and account check. */
  verifiedAt: number;
};

export type PinterestAdsDraftCampaignPreflight = {
  /** A single native DRAFT campaign object, never an activated campaign/ad. */
  campaign: PinterestAdsDraftCampaignBody | null;
  /** Creation of a campaign draft cannot establish complete publishability. */
  publicationReady: false;
  issues: PinterestAdsDraftCampaignIssue[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : {};
}

function safeMicroCurrency(amount: unknown): number | null {
  if (typeof amount !== "number" || !Number.isFinite(amount) || amount < 5 || amount > 500) return null;
  const cents = Math.round(amount * 100);
  if (Math.abs(amount * 100 - cents) > 0.000001) return null;
  return cents * 10_000;
}

export function preflightPinterestDraftCampaign(
  value: unknown,
  context: PinterestAdsDraftCampaignContext,
  nowMs = Date.now(),
): PinterestAdsDraftCampaignPreflight {
  const raw = asRecord(value);
  const refs = asRecord(raw.externalRefs);
  const budget = asRecord(raw.budget);
  const account = context.selectedAccount;
  const issues: PinterestAdsDraftCampaignIssue[] = [];
  const add = (code: PinterestAdsDraftCampaignIssue["code"], field: string) => issues.push({ code, field });

  if (raw.channel !== "pinterest" || !assessAdsChannelDraft(raw).briefComplete) {
    add("invalid_brief", "channelDraft");
  }
  if (raw.targetingMode !== "automatic") add("unsupported_targeting", "targetingMode");
  if (hasDeclaredKeywords(raw.keywords ?? raw.keywordIds)) add("unsupported_keywords", "keywords");
  const declaredPlacement = raw.placementGroup ?? raw.placementIntent ?? raw.placement;
  if (declaredPlacement != null && !["ALL", "all", "automatic"].includes(String(declaredPlacement))) {
    add("unsupported_placement", "placement");
  }
  if (!account || !/^\d{5,30}$/.test(account.id) || account.currency !== "EUR" || account.canManageCampaigns !== true) {
    add("invalid_account", "selectedAccount");
  }
  if (typeof refs.adAccountId !== "string" || refs.adAccountId !== account?.id) {
    add("account_mismatch", "externalRefs.adAccountId");
  }
  if (missingPinterestAdsScopes(context.grantedScopes).length) add("missing_ads_scopes", "grantedScopes");
  if (context.appAccess !== "verified") add("app_access_unverified", "appAccess");
  if (context.billing !== "verified") add("billing_unverified", "billing");
  if (context.campaignWritePermission !== "verified") add("campaign_permission_unverified", "campaignWritePermission");
  if (!Number.isFinite(context.verifiedAt) || context.verifiedAt > nowMs ||
      nowMs - context.verifiedAt > 5 * 60_000) add("stale_provider_evidence", "verifiedAt");

  const amount = safeMicroCurrency(budget.amount);
  if (budget.currency !== "EUR" || budget.level !== "campaign" ||
      (budget.period !== "daily" && budget.period !== "lifetime") || amount === null) {
    add("unsupported_budget", "budget");
  }
  if (issues.length) return { campaign: null, publicationReady: false, issues };

  const draft = value as PinterestAdsDraft;
  const campaign: PinterestAdsDraftCampaignBody = {
    name: draft.name.trim(),
    status: "DRAFT",
    objective_type: draft.objectiveType,
    intended_promotion_type: draft.intendedPromotionType,
    is_campaign_budget_optimization: true,
    ...(budget.period === "daily"
      ? { daily_spend_cap: amount!, is_flexible_daily_budgets: false as const }
      : { lifetime_spend_cap: amount! }),
  };
  return { campaign, publicationReady: false, issues };
}
