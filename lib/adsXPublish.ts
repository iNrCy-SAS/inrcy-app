import { assessAdsChannelDraft, type XAdsDraft } from "./adsChannelDrafts.ts";
import type { XAdsAccount } from "./adsXPolicy.ts";

/**
 * A server-only, side-effect-free preparation for a narrow X Ads flow.
 * Nothing in this module sends an Ads API request or authorizes ad delivery.
 * The evidence must come from fresh, authenticated platform reads and the
 * app-level Standard approval, never from a browser or an AI-generated draft.
 *
 * References:
 * https://docs.x.com/x-ads-api/getting-started/step-by-step-guide
 * https://docs.x.com/x-ads-api/campaign-management
 * https://docs.x.com/x-ads-api/creatives/reference
 */
export type XAdsPublishEvidence = {
  checkedAt: string;
  standardAccessApproved: boolean;
  userTokenRegeneratedAfterApproval: boolean;
  account: XAdsAccount | null;
  fundingInstrument: {
    id: string;
    accountId: string;
    currency: string;
    ableToFund: boolean;
    deleted: boolean;
    cancelled: boolean;
  } | null;
  post: {
    id: string;
    accountId: string;
    text: string;
    promotableUserVerified: boolean;
    deleted: boolean;
  } | null;
  verifiedLocationIds: string[];
};

export type XAdsPausedCampaignPlan = {
  accountId: string;
  /** POST /12/accounts/:account_id/campaigns — always paused. */
  campaign: {
    name: string;
    funding_instrument_id: string;
    daily_budget_amount_local_micro: number;
    start_time: string;
    end_time: string;
    entity_status: "PAUSED";
  };
  /** POST /12/accounts/:account_id/line_items after receiving campaign_id. */
  lineItem: {
    product_type: "PROMOTED_TWEETS";
    placements: "ALL_ON_TWITTER";
    objective: "ENGAGEMENTS";
    bid_amount_local_micro: number;
    entity_status: "PAUSED";
  };
  /** POST /12/accounts/:account_id/targeting_criteria after line_item_id. */
  locations: Array<{ targeting_type: "LOCATION"; targeting_value: string }>;
  /** POST /12/accounts/:account_id/promoted_tweets after line_item_id. */
  promotedPost: { tweet_ids: string };
};

export type XAdsPausedCampaignPreflight =
  | { prepared: false; issues: Array<{ code: string; field: string }>; plan?: never }
  | { prepared: true; issues: []; plan: XAdsPausedCampaignPlan };

function identifier(value: unknown): value is string {
  return typeof value === "string" && /^[a-z0-9]+$/i.test(value);
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function timestamp(value: unknown): number | null {
  if (typeof value !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Only a text ENGAGEMENTS brief with an existing, verified post is serialized.
 * Other X objectives, creatives, targeting and scheduling need their own
 * audited API mappings. A prepared plan still needs an explicit, separate
 * server mutation path and a fresh platform check before any POST.
 */
export function preflightXAdsPausedCampaign(input: {
  draft: unknown;
  evidence: XAdsPublishEvidence;
  bidAmountLocalMicro: number;
  startTime: string;
  endTime: string;
  now?: number;
}): XAdsPausedCampaignPreflight {
  const evidence = input.evidence || {} as XAdsPublishEvidence;
  const issues: Array<{ code: string; field: string }> = [];
  const add = (code: string, field: string, failed: boolean) => {
    if (failed) issues.push({ code, field });
  };

  const assessment = assessAdsChannelDraft(input.draft);
  add("invalid_x_brief", "draft", assessment.channel !== "x" || !assessment.briefComplete);
  const draft = input.draft && typeof input.draft === "object" && !Array.isArray(input.draft)
    ? input.draft as Partial<XAdsDraft>
    : null;
  const refs = draft?.externalRefs;
  add("unsupported_objective", "draft.objective", draft?.objective !== "engagement");
  add("unsupported_format", "draft.format", draft?.format !== "text");
  add("unsupported_targeting", "draft.targetingMode", draft?.targetingMode !== "broad");
  add("unsupported_budget", "draft.budget", draft?.budget?.period !== "daily" || draft.budget.level !== "campaign");
  add("unmapped_destination", "draft.creative.destinationUrl", Boolean(stringValue(draft?.creative?.destinationUrl).trim()));

  const checkedAt = timestamp(evidence.checkedAt);
  const now = input.now ?? Date.now();
  add("stale_platform_evidence", "evidence.checkedAt", checkedAt === null || !Number.isFinite(now) || checkedAt > now || now - checkedAt > 5 * 60_000);
  add("standard_access_unverified", "evidence.standardAccessApproved", evidence.standardAccessApproved !== true);
  add("ads_token_unverified", "evidence.userTokenRegeneratedAfterApproval", evidence.userTokenRegeneratedAfterApproval !== true);

  const account = evidence.account;
  add("account_unverified", "evidence.account", !account || !identifier(account.id) || account.id !== refs?.adAccountId
    || account.deleted || account.approvalStatus !== "ACCEPTED" || account.currency !== "EUR"
    || account.canManageCampaigns !== true || account.billingReady !== true);

  const funding = evidence.fundingInstrument;
  add("funding_unverified", "evidence.fundingInstrument", !funding || !identifier(funding.id)
    || funding.id !== refs?.fundingInstrumentId || funding.accountId !== account?.id
    || funding.currency !== "EUR" || funding.ableToFund !== true || funding.deleted || funding.cancelled);

  const post = evidence.post;
  add("post_unverified", "evidence.post", !post || !/^\d{1,20}$/.test(post.id)
    || post.id !== refs?.postId || post.accountId !== account?.id
    || stringValue(post.text).trim() !== stringValue(draft?.creative?.postText).trim()
    || post.promotableUserVerified !== true || post.deleted);

  const locations = refs?.locationIds;
  const verifiedLocations = evidence.verifiedLocationIds;
  add("locations_unverified", "evidence.verifiedLocationIds", !Array.isArray(locations) || locations.length === 0
    || !locations.every(identifier) || new Set(locations).size !== locations.length
    || !Array.isArray(verifiedLocations) || locations.some((id) => !verifiedLocations.includes(id)));

  const budgetAmount = draft?.budget?.amount;
  const budgetMicro = typeof budgetAmount === "number" ? budgetAmount * 1_000_000 : NaN;
  add("invalid_budget_micro", "draft.budget.amount", !Number.isSafeInteger(budgetMicro) || budgetMicro <= 0);
  add("invalid_bid", "bidAmountLocalMicro", !Number.isSafeInteger(input.bidAmountLocalMicro)
    || input.bidAmountLocalMicro <= 0 || input.bidAmountLocalMicro > budgetMicro);

  const start = timestamp(input.startTime);
  const end = timestamp(input.endTime);
  add("invalid_schedule", "startTime", start === null || !Number.isFinite(now) || start <= now);
  add("invalid_schedule", "endTime", end === null || start === null || end <= start);

  if (issues.length || !draft || !account || !funding || !post || !locations) return { prepared: false, issues };
  return {
    prepared: true,
    issues: [],
    plan: {
      accountId: account.id,
      campaign: {
        name: draft.name!,
        funding_instrument_id: funding.id,
        daily_budget_amount_local_micro: budgetMicro,
        start_time: input.startTime,
        end_time: input.endTime,
        entity_status: "PAUSED",
      },
      lineItem: {
        product_type: "PROMOTED_TWEETS",
        placements: "ALL_ON_TWITTER",
        objective: "ENGAGEMENTS",
        bid_amount_local_micro: input.bidAmountLocalMicro,
        entity_status: "PAUSED",
      },
      locations: locations.map((id) => ({ targeting_type: "LOCATION", targeting_value: id })),
      promotedPost: { tweet_ids: post.id },
    },
  };
}
