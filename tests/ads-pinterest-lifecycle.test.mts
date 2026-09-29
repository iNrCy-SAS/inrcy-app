import assert from "node:assert/strict";
import test from "node:test";

import {
  pausePinterestAdsCampaign,
  PinterestAdsLifecycleError,
  readPinterestAdsCampaignState,
  resumePinterestAdsCampaign,
  type PinterestAdsLifecycleRequest,
} from "../lib/adsPinterestLifecycleCore.ts";

const accountId = "549770842067";
const resources = { campaignId: "610001", adGroupId: "620002", adId: "630003" };

function harness(options: { status?: "ACTIVE" | "PAUSED"; wrongParent?: boolean; failPatchPath?: string } = {}) {
  let campaignStatus = options.status || "PAUSED";
  const calls: Array<{ path: string; method: string; body?: unknown }> = [];
  const request: PinterestAdsLifecycleRequest = async (path, method, body) => {
    calls.push({ path, method, body });
    if (method === "PATCH") {
      if (path === options.failPatchPath) throw new Error("Pinterest indisponible");
      const first = Array.isArray(body) ? body[0] as { status?: string } : {};
      if (path.endsWith("/campaigns") && (first.status === "ACTIVE" || first.status === "PAUSED")) {
        campaignStatus = first.status;
      }
      return { items: [{ data: { id: "ok" }, exceptions: [] }] };
    }
    if (path.endsWith(`/campaigns/${resources.campaignId}`)) {
      return { id: resources.campaignId, ad_account_id: accountId, status: campaignStatus };
    }
    if (path.endsWith(`/ad_groups/${resources.adGroupId}`)) {
      return { id: resources.adGroupId, campaign_id: options.wrongParent ? "999999" : resources.campaignId, status: "PAUSED" };
    }
    return { id: resources.adId, ad_group_id: resources.adGroupId, status: "PAUSED" };
  };
  return { calls, request };
}

test("relit une campagne Pinterest réelle en pause après contrôle de sa hiérarchie", async () => {
  const { request } = harness();
  const result = await readPinterestAdsCampaignState(accountId, resources, request);
  assert.equal(result.state, "paused");
  assert.deepEqual(result.resources, resources);
});

test("reprend Pinterest dans l’ordre annonce, groupe puis campagne", async () => {
  const { calls, request } = harness();
  const result = await resumePinterestAdsCampaign(accountId, resources, request);
  assert.equal(result.state, "active");
  assert.deepEqual(calls.filter((call) => call.method === "PATCH").map((call) => call.path), [
    `/ad_accounts/${accountId}/ads`,
    `/ad_accounts/${accountId}/ad_groups`,
    `/ad_accounts/${accountId}/campaigns`,
  ]);
});

test("met en pause uniquement le parent Pinterest pour couper toute diffusion", async () => {
  const { calls, request } = harness({ status: "ACTIVE" });
  const result = await pausePinterestAdsCampaign(accountId, resources, request);
  assert.equal(result.state, "paused");
  assert.deepEqual(calls.filter((call) => call.method === "PATCH").map((call) => call.path), [
    `/ad_accounts/${accountId}/campaigns`,
  ]);
});

test("bloque toute mutation si le groupe Pinterest n’appartient pas à la campagne", async () => {
  const { calls, request } = harness({ wrongParent: true });
  await assert.rejects(
    () => resumePinterestAdsCampaign(accountId, resources, request),
    (error: unknown) => error instanceof PinterestAdsLifecycleError && /groupe d’annonces/.test(error.message),
  );
  assert.equal(calls.some((call) => call.method === "PATCH"), false);
});

test("remet le parent Pinterest en pause si la reprise échoue", async () => {
  const failedPath = `/ad_accounts/${accountId}/campaigns`;
  const { calls, request } = harness({ failPatchPath: failedPath });
  await assert.rejects(
    () => resumePinterestAdsCampaign(accountId, resources, request),
    (error: unknown) => error instanceof PinterestAdsLifecycleError && error.remoteMayHaveChanged,
  );
  const patches = calls.filter((call) => call.method === "PATCH");
  assert.equal(patches.at(-1)?.path, failedPath);
  assert.deepEqual((patches.at(-1)?.body as Array<{ status: string }>)[0], { id: resources.campaignId, status: "PAUSED" });
});
