import type { TikTokAdsDraft } from "./adsChannelDrafts.ts";
import type { TikTokAdsAccount } from "./adsTikTokPolicy.ts";

/**
 * Deliberately pure preparation for the regular TikTok Marketing API v1.3.
 * No caller should infer that a campaign body is a publishable ad: ad group,
 * targeting, approved identity, owned video, schedule and creative still need
 * separate provider-backed checks. This module performs no provider write.
 *
 * Sources (TikTok's own SDK, whose models expose the API fields and defaults):
 * https://github.com/tiktok/tiktok-business-api-sdk/blob/main/python_sdk/docs/CampaignCreateBody.md
 * https://github.com/tiktok/tiktok-business-api-sdk/blob/main/python_sdk/docs/AdgroupCreateBody.md
 * https://github.com/tiktok/tiktok-business-api-sdk/blob/main/python_sdk/docs/AdcreateCreatives.md
 * The SDK defaults operation_status to ENABLE at all three levels. Never omit
 * DISABLE from a prepared paid object, including future ad group/ad adapters.
 */

export const TIKTOK_ADS_CREATION_PATHS = {
  campaign: "/campaign/create/",
  adGroup: "/adgroup/create/",
  ad: "/ad/create/",
} as const;

export type TikTokAdsPausedIssue = {
  code:
    | "invalid_draft"
    | "unsupported_objective"
    | "unsupported_destination"
    | "unsupported_budget"
    | "invalid_account"
    | "advertiser_mismatch"
    | "app_access_unverified"
    | "campaign_permission_unverified"
    | "invalid_request_id";
  field: string;
};

export type TikTokAdsPausedCampaignBody = {
  advertiser_id: string;
  campaign_name: string;
  objective_type: "TRAFFIC";
  budget_optimize_on: true;
  budget_mode: "BUDGET_MODE_TOTAL";
  budget: number;
  operation_status: "DISABLE";
  request_id: string;
};

/** The caller must obtain this evidence server-side, never from a browser body. */
export type TikTokAdsPausedCampaignContext = {
  selectedAccount: TikTokAdsAccount | null;
  appAccess: "verified" | "unverified";
  campaignWritePermission: "verified" | "unverified";
  /** Stable per attempted creation, so a retried request cannot duplicate it. */
  requestId: string;
};

export type TikTokAdsPausedCampaignPreflight = {
  /** Only a disabled campaign body; never an ad group or ad. */
  campaign: TikTokAdsPausedCampaignBody | null;
  /** A campaign body alone never makes an ad publishable. */
  publicationReady: false;
  issues: TikTokAdsPausedIssue[];
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown> : {};
}

function id(value: unknown): string {
  return typeof value === "string" && /^\d{5,30}$/.test(value) ? value : "";
}

function money(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 && value <= 500 &&
    Math.abs(value * 100 - Math.round(value * 100)) < 0.000001;
}

/**
 * Only the narrow lifetime-budget, website-traffic campaign can be shaped now.
 * Daily budget is deliberately blocked: TikTok's dynamic daily budget may
 * exceed the stated daily amount. The current studio mostly emits daily briefs.
 */
export function preflightTikTokPausedCampaign(
  value: unknown,
  context: TikTokAdsPausedCampaignContext,
): TikTokAdsPausedCampaignPreflight {
  const draft = asRecord(value) as Partial<TikTokAdsDraft>;
  const refs = asRecord(draft.externalRefs);
  const budget = asRecord(draft.budget);
  const account = context.selectedAccount;
  const issues: TikTokAdsPausedIssue[] = [];
  const add = (code: TikTokAdsPausedIssue["code"], field: string) => issues.push({ code, field });

  const name = typeof draft.name === "string" ? draft.name.trim() : "";
  if (draft.schemaVersion !== 1 || draft.channel !== "tiktok" || name.length < 3 || name.length > 100 ||
      draft.format !== "video") add("invalid_draft", "channelDraft");
  if (draft.objectiveType !== "TRAFFIC") add("unsupported_objective", "objectiveType");
  if (draft.destinationKind !== "website" || draft.optimizationIntent !== "clicks" ||
      typeof draft.creative?.destinationUrl !== "string" || !validHttpsUrl(draft.creative.destinationUrl)) {
    add("unsupported_destination", "creative.destinationUrl");
  }
  if (budget.currency !== "EUR" || budget.level !== "campaign" || budget.period !== "lifetime" ||
      !money(budget.amount)) add("unsupported_budget", "budget");

  if (!account || !id(account.id) || account.currency !== "EUR" || account.status.toUpperCase() !== "STATUS_ENABLE") {
    add("invalid_account", "selectedAccount");
  }
  if (!id(refs.advertiserId) || refs.advertiserId !== account?.id) {
    add("advertiser_mismatch", "externalRefs.advertiserId");
  }
  if (context.appAccess !== "verified") add("app_access_unverified", "appAccess");
  if (context.campaignWritePermission !== "verified") {
    add("campaign_permission_unverified", "campaignWritePermission");
  }
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(context.requestId)) {
    add("invalid_request_id", "requestId");
  }

  if (issues.length) return { campaign: null, publicationReady: false, issues };
  return {
    campaign: {
      advertiser_id: account!.id,
      campaign_name: name,
      objective_type: "TRAFFIC",
      budget_optimize_on: true,
      budget_mode: "BUDGET_MODE_TOTAL",
      budget: budget.amount as number,
      operation_status: "DISABLE",
      request_id: context.requestId,
    },
    publicationReady: false,
    issues,
  };
}

function validHttpsUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" && Boolean(url.hostname) && !url.username && !url.password && value.length <= 2_000;
  } catch {
    return false;
  }
}
