import { assessAdsChannelDraft, type PinterestAdsDraft } from "./adsChannelDrafts.ts";
import { missingPinterestAdsScopes, type PinterestAdsAccount } from "./adsPinterestPolicy.ts";

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
