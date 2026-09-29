import assert from "node:assert/strict";
import { test } from "node:test";
import {
  buildLinkedInAdsCampaignAnalyticsPath,
  buildLinkedInAdsCampaignArchiveRequest,
  buildLinkedInAdsCampaignDeletionRequest,
  buildLinkedInAdsCampaignEditRequest,
  buildLinkedInAdsCampaignStatusRequest,
  type LinkedInAdsCampaignOperationEvidence,
} from "../lib/adsLinkedInOperations.ts";

const now = Date.parse("2026-09-30T12:00:00Z");

function evidence(status: LinkedInAdsCampaignOperationEvidence["campaign"]["status"] = "PAUSED"):
LinkedInAdsCampaignOperationEvidence {
  return {
    fetchedAtMs: now - 1_000,
    selectedAccountId: "123",
    accountCurrency: "EUR",
    scopes: "rw_ads r_ads_reporting r_organization_admin w_organization_social",
    hasAccountAccess: true,
    canManageCampaigns: true,
    campaign: {
      urn: "urn:li:sponsoredCampaign:456",
      account: "urn:li:sponsoredAccount:123",
      status,
    },
  };
}

test("LinkedIn campaign edit is a scoped PARTIAL_UPDATE built from fresh ownership evidence", () => {
  const request = buildLinkedInAdsCampaignEditRequest({
    evidence: evidence(), name: " Campagne septembre ", dailyBudget: 25, bidAmount: 2.5, nowMs: now,
  });
  assert.equal(request.method, "POST");
  assert.equal(request.path, "/rest/adAccounts/123/adCampaigns/456");
  assert.equal(request.headers["X-RestLi-Method"], "PARTIAL_UPDATE");
  assert.deepEqual(request.body.patch.$set, {
    name: "Campagne septembre",
    dailyBudget: { amount: "25.00", currencyCode: "EUR" },
    unitCost: { amount: "2.50", currencyCode: "EUR" },
  });
  assert.throws(() => buildLinkedInAdsCampaignEditRequest({
    evidence: { ...evidence(), fetchedAtMs: now - 6 * 60_000 }, name: "Trop tard", nowMs: now,
  }), /stale/);
  assert.throws(() => buildLinkedInAdsCampaignEditRequest({
    evidence: { ...evidence(), accountCurrency: "USD" }, name: "Mauvaise devise", nowMs: now,
  }), /currency/);
  for (const status of ["COMPLETED", "CANCELED", "PENDING_DELETION", "REMOVED"] as const) {
    assert.throws(() => buildLinkedInAdsCampaignEditRequest({
      evidence: evidence(status), name: "Mutation interdite", nowMs: now,
    }), /edit state/);
  }
});

test("LinkedIn activation fails closed while pause requires an exact campaign confirmation", () => {
  assert.throws(() => buildLinkedInAdsCampaignStatusRequest({
    evidence: evidence(), target: "ACTIVE", confirmedCampaignUrn: "urn:li:sponsoredCampaign:456", nowMs: now,
  }), /preflight/);
  const active = buildLinkedInAdsCampaignStatusRequest({
    evidence: evidence(), target: "ACTIVE", confirmedCampaignUrn: "urn:li:sponsoredCampaign:456",
    activationReady: true, nowMs: now,
  });
  assert.equal(active.body.patch.$set.status, "ACTIVE");
  assert.throws(() => buildLinkedInAdsCampaignStatusRequest({
    evidence: evidence(), target: "PAUSED", confirmedCampaignUrn: "urn:li:sponsoredCampaign:999", nowMs: now,
  }), /confirmed/);
  for (const status of ["COMPLETED", "CANCELED", "PENDING_DELETION", "REMOVED"] as const) {
    assert.throws(() => buildLinkedInAdsCampaignStatusRequest({
      evidence: evidence(status), target: "ACTIVE", confirmedCampaignUrn: "urn:li:sponsoredCampaign:456",
      activationReady: true, nowMs: now,
    }), /not supported/);
    assert.throws(() => buildLinkedInAdsCampaignStatusRequest({
      evidence: evidence(status), target: "PAUSED", confirmedCampaignUrn: "urn:li:sponsoredCampaign:456", nowMs: now,
    }), /not supported/);
  }
});

test("LinkedIn archive stays distinct from deletion", () => {
  const archived = buildLinkedInAdsCampaignArchiveRequest({
    evidence: evidence("ACTIVE"), confirmedCampaignUrn: "urn:li:sponsoredCampaign:456", nowMs: now,
  });
  assert.equal(archived.body.patch.$set.status, "ARCHIVED");
  for (const status of ["ARCHIVED", "COMPLETED", "CANCELED", "PENDING_DELETION", "REMOVED"] as const) {
    assert.throws(() => buildLinkedInAdsCampaignArchiveRequest({
      evidence: evidence(status), confirmedCampaignUrn: "urn:li:sponsoredCampaign:456", nowMs: now,
    }), /archive state/);
  }

  const draftDelete = buildLinkedInAdsCampaignDeletionRequest({
    evidence: evidence("DRAFT"), confirmedCampaignUrn: "urn:li:sponsoredCampaign:456",
    confirmation: "DELETE_DRAFT", nowMs: now,
  });
  assert.equal(draftDelete.method, "DELETE");
  assert.equal("body" in draftDelete, false);

  const liveDelete = buildLinkedInAdsCampaignDeletionRequest({
    evidence: evidence("PAUSED"), confirmedCampaignUrn: "urn:li:sponsoredCampaign:456",
    confirmation: "REQUEST_DELETION", nowMs: now,
  });
  assert.equal(liveDelete.method, "POST");
  assert.equal("body" in liveDelete && liveDelete.body.patch.$set.status, "PENDING_DELETION");
  assert.throws(() => buildLinkedInAdsCampaignDeletionRequest({
    evidence: evidence("PAUSED"), confirmedCampaignUrn: "urn:li:sponsoredCampaign:456",
    confirmation: "DELETE_DRAFT", nowMs: now,
  }), /mismatch/);
  for (const status of ["PENDING_DELETION", "REMOVED"] as const) {
    assert.throws(() => buildLinkedInAdsCampaignDeletionRequest({
      evidence: evidence(status), confirmedCampaignUrn: "urn:li:sponsoredCampaign:456",
      confirmation: "REQUEST_DELETION", nowMs: now,
    }), /mismatch/);
  }
  for (const status of ["COMPLETED", "CANCELED"] as const) {
    const request = buildLinkedInAdsCampaignDeletionRequest({
      evidence: evidence(status), confirmedCampaignUrn: "urn:li:sponsoredCampaign:456",
      confirmation: "REQUEST_DELETION", nowMs: now,
    });
    assert.equal(request.method, "POST");
    assert.equal("body" in request && request.body.patch.$set.status, "PENDING_DELETION");
  }
});

test("LinkedIn campaign analytics is a bounded DAILY CAMPAIGN query", () => {
  const path = buildLinkedInAdsCampaignAnalyticsPath({
    evidence: evidence(), startDate: "2026-09-01", endDate: "2026-09-30", nowMs: now,
  });
  assert.match(path, /^\/rest\/adAnalytics\?q=analytics&pivot=CAMPAIGN&timeGranularity=DAILY/);
  assert.match(path, /accounts=List\(urn%3Ali%3AsponsoredAccount%3A123\)/);
  assert.match(path, /campaigns=List\(urn%3Ali%3AsponsoredCampaign%3A456\)/);
  assert.match(path, /fields=dateRange,impressions,clicks,landingPageClicks,costInLocalCurrency,externalWebsiteConversions,pivotValues$/);
  assert.throws(() => buildLinkedInAdsCampaignAnalyticsPath({
    evidence: evidence(), startDate: "2025-01-01", endDate: "2026-09-30", nowMs: now,
  }), /range/);
  assert.throws(() => buildLinkedInAdsCampaignAnalyticsPath({
    evidence: { ...evidence(), scopes: "rw_ads" },
    startDate: "2026-09-01", endDate: "2026-09-30", nowMs: now,
  }), /reporting/);
  assert.throws(() => buildLinkedInAdsCampaignAnalyticsPath({
    evidence: { ...evidence(), campaign: { ...evidence().campaign, account: "urn:li:sponsoredAccount:999" } },
    startDate: "2026-09-01", endDate: "2026-09-30", nowMs: now,
  }), /ownership/);
});
