import assert from "node:assert/strict";
import test from "node:test";

import {
  archiveLinkedInAdsCampaignCore,
  deleteLinkedInAdsCampaignCore,
  LinkedInAdsLifecycleError,
  readLinkedInAdsCampaignAnalyticsCore,
  setLinkedInAdsCampaignPausedCore,
  updateLinkedInAdsCampaignCore,
  type LinkedInAdsLifecycleContext,
  type LinkedInAdsRemoteRequest,
} from "../lib/adsLinkedInLifecycleCore.ts";

const nowMs = Date.parse("2026-09-30T12:00:00Z");
const campaignUrn = "urn:li:sponsoredCampaign:456";
const creativeUrn = "urn:li:sponsoredCreative:789";
const resources = {
  schemaVersion: 1,
  operationKey: "linkedin:campaign-local",
  accountId: "123",
  targetStatus: "ACTIVE",
  stage: "active",
  campaignId: "456",
  campaignUrn,
  creativeUrn,
};
const context: LinkedInAdsLifecycleContext = {
  accountId: "123",
  accountCurrency: "EUR",
  scopes: "rw_ads r_ads_reporting r_organization_admin w_organization_social",
  hasAccountAccess: true,
  canManageCampaigns: true,
  canServeCampaigns: true,
};

function harness(status: "ACTIVE" | "PAUSED" | "DRAFT" = "PAUSED") {
  let campaignStatus: string = status;
  let deleted = false;
  let name = "Campagne LinkedIn";
  let dailyBudget = { amount: "20.00", currencyCode: "EUR" };
  let runSchedule = { start: nowMs - 86_400_000, end: Date.parse("2026-10-10T23:59:59Z") };
  const calls: Array<{ method: string; path: string; body?: unknown }> = [];
  const request: LinkedInAdsRemoteRequest = async (input) => {
    calls.push(input);
    if (input.method === "DELETE") {
      deleted = true;
      return {};
    }
    if (input.method === "POST") {
      const set = ((input.body as { patch?: { $set?: Record<string, unknown> } })?.patch?.$set) || {};
      if (typeof set.status === "string") campaignStatus = set.status;
      if (typeof set.name === "string") name = set.name;
      if (set.dailyBudget) dailyBudget = set.dailyBudget as typeof dailyBudget;
      if (set.runSchedule) runSchedule = set.runSchedule as typeof runSchedule;
      return {};
    }
    if (input.path.includes("/adCampaigns/456")) {
      if (deleted) throw new LinkedInAdsLifecycleError("not found", false, 404);
      return {
        id: "456",
        account: "urn:li:sponsoredAccount:123",
        campaignGroup: "urn:li:sponsoredCampaignGroup:321",
        status: campaignStatus,
        name,
        dailyBudget,
        runSchedule,
      };
    }
    if (input.path.includes("/adCampaignGroups/321")) {
      return { id: "321", account: "urn:li:sponsoredAccount:123", status: "ACTIVE" };
    }
    if (input.path.includes("/creatives/")) {
      return { id: creativeUrn, account: "urn:li:sponsoredAccount:123", campaign: campaignUrn, intendedStatus: "ACTIVE" };
    }
    if (input.path.includes("/adAnalytics?")) return { elements: [] };
    throw new Error(`unexpected ${input.path}`);
  };
  return { calls, request };
}

test("LinkedIn pause est idempotente et ne rejoue aucune mutation", async () => {
  const { calls, request } = harness("PAUSED");
  const result = await setLinkedInAdsCampaignPausedCore({ context, resources, paused: true, request, now: () => nowMs });
  assert.equal(result.state, "paused");
  assert.equal(calls.filter((call) => call.method === "POST").length, 0);
});

test("LinkedIn ACTIVE relit groupe et creative avant mutation puis confirme le statut", async () => {
  const { calls, request } = harness("PAUSED");
  const result = await setLinkedInAdsCampaignPausedCore({ context, resources, paused: false, request, now: () => nowMs });
  assert.equal(result.state, "active");
  const post = calls.findIndex((call) => call.method === "POST");
  assert.ok(post > calls.findIndex((call) => call.path.includes("adCampaignGroups")));
  assert.ok(post > calls.findIndex((call) => call.path.includes("creatives")));
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
  assert.ok(calls.slice(post + 1).some((call) => call.path.includes("adCampaigns/456")));
});

test("LinkedIn ACTIVE reste fail-closed quand le compte est On hold", async () => {
  const { calls, request } = harness("PAUSED");
  await assert.rejects(
    () => setLinkedInAdsCampaignPausedCore({
      context: { ...context, canServeCampaigns: false }, resources, paused: false, request, now: () => nowMs,
    }),
    (error: unknown) => error instanceof LinkedInAdsLifecycleError && /On hold/.test(error.message),
  );
  assert.equal(calls.some((call) => call.method === "POST"), false);
});

test("LinkedIn update relit après mutation et devient idempotente", async () => {
  const { calls, request } = harness("PAUSED");
  const changes = { name: "Nouvelle campagne", dailyBudgetCents: 2500, endDate: "2026-10-20" };
  await updateLinkedInAdsCampaignCore({ context, resources, changes, request, now: () => nowMs });
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
  await updateLinkedInAdsCampaignCore({ context, resources, changes, request, now: () => nowMs });
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
});

test("une mutation LinkedIn incertaine n’est jamais rejouée", async () => {
  const base = harness("ACTIVE");
  let posts = 0;
  const request: LinkedInAdsRemoteRequest = async (input) => {
    if (input.method === "POST") {
      posts += 1;
      throw new LinkedInAdsLifecycleError("timeout", true);
    }
    return base.request(input);
  };
  await assert.rejects(
    () => setLinkedInAdsCampaignPausedCore({ context, resources, paused: true, request, now: () => nowMs }),
    (error: unknown) => error instanceof LinkedInAdsLifecycleError && error.remoteMayHaveChanged,
  );
  assert.equal(posts, 1);
});

test("la suppression DRAFT utilise DELETE et confirme l’absence sans replay", async () => {
  const { calls, request } = harness("DRAFT");
  const result = await deleteLinkedInAdsCampaignCore({ context, resources, request, now: () => nowMs });
  assert.equal(result.state, "removed");
  assert.equal(calls.filter((call) => call.method === "DELETE").length, 1);
});

test("l’archivage LinkedIn est confirmé et devient idempotent", async () => {
  const { calls, request } = harness("ACTIVE");
  const archived = await archiveLinkedInAdsCampaignCore({ context, resources, request, now: () => nowMs });
  assert.equal(archived.state, "archived");
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
  assert.ok(calls.some((call) => call.method === "POST"
    && (call.body as { patch?: { $set?: { status?: string } } })?.patch?.$set?.status === "ARCHIVED"));

  await archiveLinkedInAdsCampaignCore({ context, resources, request, now: () => nowMs });
  assert.equal(calls.filter((call) => call.method === "POST").length, 1);
});

test("les statistiques relisent la campagne avant adAnalytics", async () => {
  const { calls, request } = harness("ACTIVE");
  const result = await readLinkedInAdsCampaignAnalyticsCore({
    context, resources, startDate: "2026-09-01", endDate: "2026-09-30", request, now: () => nowMs,
  });
  assert.equal(result.campaignUrn, campaignUrn);
  assert.match(calls.at(-1)?.path || "", /\/rest\/adAnalytics\?/);
});
