import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { preflightXAdsPausedCampaign, type XAdsPublishEvidence } from "../../lib/adsXPublish.ts";
import type { XAdsDraft } from "../../lib/adsChannelDrafts.ts";

const now = Date.parse("2026-09-27T12:00:00Z");
const draft: XAdsDraft = {
  schemaVersion: 1,
  channel: "x",
  name: "Annonce automne",
  objective: "engagement",
  format: "text",
  targetingMode: "broad",
  budget: { amount: 25, currency: "EUR", period: "daily", level: "campaign" },
  audience: { locationBriefs: ["France"], audienceBrief: "Entreprises locales" },
  creative: { postText: "Découvrez notre actualité cette semaine.", mediaBrief: "", destinationUrl: "" },
  externalRefs: { adAccountId: "abc123", fundingInstrumentId: "fund1", postId: "1234567890123456789", locationIds: ["loc1"] },
};
const evidence: XAdsPublishEvidence = {
  checkedAt: "2026-09-27T12:00:00Z",
  standardAccessApproved: true,
  userTokenRegeneratedAfterApproval: true,
  account: {
    id: "abc123", name: "Compte X", approvalStatus: "ACCEPTED", deleted: false,
    currency: "EUR", permissions: ["AD_MANAGER"], canManageCampaigns: true,
    billingReady: true, eligibleToAssociate: true,
  },
  fundingInstrument: {
    id: "fund1", accountId: "abc123", currency: "EUR", ableToFund: true,
    deleted: false, cancelled: false,
  },
  post: {
    id: "1234567890123456789", accountId: "abc123", text: draft.creative.postText,
    promotableUserVerified: true, deleted: false,
  },
  verifiedLocationIds: ["loc1"],
};
const input = {
  draft, evidence, bidAmountLocalMicro: 1_500_000,
  startTime: "2026-09-28T12:00:00Z", endTime: "2026-10-05T12:00:00Z", now,
};

test("prepares only paused X campaign and line item requests", () => {
  const result = preflightXAdsPausedCampaign(input);
  assert.equal(result.prepared, true);
  if (!result.prepared) return;
  assert.equal(result.plan.accountId, "abc123");
  assert.equal(result.plan.campaign.entity_status, "PAUSED");
  assert.equal(result.plan.lineItem.entity_status, "PAUSED");
  assert.equal(result.plan.campaign.daily_budget_amount_local_micro, 25_000_000);
  assert.equal(result.plan.lineItem.objective, "ENGAGEMENTS");
  assert.deepEqual(result.plan.locations, [{ targeting_type: "LOCATION", targeting_value: "loc1" }]);
  assert.deepEqual(result.plan.promotedPost, { tweet_ids: draft.externalRefs?.postId });
  const source = readFileSync(new URL("../../lib/adsXPublish.ts", import.meta.url), "utf8");
  assert.doesNotMatch(source, /\bfetch\s*\(|\baxios\s*\(/);
});

test("fails closed when Standard approval or token renewal is unverified", () => {
  const result = preflightXAdsPausedCampaign({
    ...input,
    evidence: { ...evidence, standardAccessApproved: false, userTokenRegeneratedAfterApproval: false },
  });
  assert.equal(result.prepared, false);
  assert.deepEqual(result.issues.map((issue) => issue.code), ["standard_access_unverified", "ads_token_unverified"]);
});

test("rejects stale or mismatched account, funding, post, and targeting evidence", () => {
  const result = preflightXAdsPausedCampaign({
    ...input,
    evidence: {
      ...evidence,
      checkedAt: "2026-09-27T11:50:00Z",
      account: { ...evidence.account!, billingReady: false },
      fundingInstrument: { ...evidence.fundingInstrument!, accountId: "other" },
      post: { ...evidence.post!, text: "Different post" },
      verifiedLocationIds: [],
    },
  });
  assert.equal(result.prepared, false);
  assert.deepEqual(new Set(result.issues.map((issue) => issue.code)), new Set([
    "stale_platform_evidence", "account_unverified", "funding_unverified", "post_unverified", "locations_unverified",
  ]));
});

test("rejects unsupported formats, objectives, budgets, bids, and schedules", () => {
  const result = preflightXAdsPausedCampaign({
    ...input,
    draft: { ...draft, objective: "website_traffic", format: "video", targetingMode: "keywords",
      keywords: ["annonce"], budget: { ...draft.budget, period: "lifetime" } },
    bidAmountLocalMicro: 30_000_000,
    endTime: "2026-09-27T12:00:00Z",
  });
  assert.equal(result.prepared, false);
  for (const code of ["unsupported_objective", "unsupported_format", "unsupported_targeting", "unsupported_budget", "invalid_bid", "invalid_schedule"]) {
    assert.ok(result.issues.some((issue) => issue.code === code), code);
  }
});

test("malformed evidence cannot produce a plan", () => {
  const result = preflightXAdsPausedCampaign({
    ...input,
    evidence: { ...evidence, post: { ...evidence.post!, text: null } } as unknown as XAdsPublishEvidence,
  });
  assert.equal(result.prepared, false);
  assert.ok(result.issues.some((issue) => issue.code === "post_unverified"));
});
