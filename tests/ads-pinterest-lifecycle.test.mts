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
const resources = { campaignId: "610001", adGroupId: "620002", adId: "630003", initialActivationPending: true };

function harness(options: {
  status?: "ACTIVE" | "PAUSED"; wrongParent?: boolean; failPatchPath?: string;
  malformedChildResponse?: boolean; wrongChildStatus?: boolean; unappliedChildren?: boolean;
  malformedActivationResponse?: boolean; safetyPauseUnapplied?: boolean;
} = {}) {
  let campaignStatus = options.status || "PAUSED";
  let adStatus = "PAUSED";
  let adGroupStatus = "PAUSED";
  const calls: Array<{ path: string; method: string; body?: unknown }> = [];
  const request: PinterestAdsLifecycleRequest = async (path, method, body) => {
    calls.push({ path, method, body });
    if (method === "PATCH") {
      if (path === options.failPatchPath) throw new Error("Pinterest indisponible");
      const first = Array.isArray(body) ? body[0] as { id?: string; status?: string } : {};
      if (path.endsWith("/campaigns") && (first.status === "ACTIVE" || first.status === "PAUSED")) {
        if (!(first.status === "PAUSED" && options.safetyPauseUnapplied)) campaignStatus = first.status;
        if (first.status === "ACTIVE" && options.malformedActivationResponse) return { items: [] };
      }
      if (!options.unappliedChildren) {
        if (path.endsWith("/ads")) adStatus = String(first.status);
        if (path.endsWith("/ad_groups")) adGroupStatus = String(first.status);
      }
      if (path.endsWith("/ads") && options.malformedChildResponse) return { items: [{ exceptions: [] }] };
      return { items: [{ data: { id: first.id, status: path.endsWith("/ads") && options.wrongChildStatus ? "PAUSED" : first.status }, exceptions: [] }] };
    }
    if (path.endsWith(`/campaigns/${resources.campaignId}`)) {
      return { id: resources.campaignId, ad_account_id: accountId, status: campaignStatus };
    }
    if (path.endsWith(`/ad_groups/${resources.adGroupId}`)) {
      return { id: resources.adGroupId, campaign_id: options.wrongParent ? "999999" : resources.campaignId, status: adGroupStatus };
    }
    return { id: resources.adId, ad_group_id: resources.adGroupId, status: adStatus };
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
  assert.equal(result.resources.initialActivationPending, false);
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

test("une reprise Pinterest ordinaire préserve les enfants manuellement pausés", async () => {
  for (const prior of [false, undefined]) {
    const { calls, request } = harness();
    const result = await resumePinterestAdsCampaign(accountId, { ...resources, initialActivationPending: prior }, request);
    assert.equal(result.state, "active");
    assert.deepEqual(calls.filter((call) => call.method === "PATCH").map((call) => call.path), [`/ad_accounts/${accountId}/campaigns`]);
  }
});

test("une réponse Pinterest enfant incomplète ou incohérente ne permet pas d’activer la campagne", async () => {
  for (const option of [{ malformedChildResponse: true }, { wrongChildStatus: true }, { unappliedChildren: true }]) {
    const { calls, request } = harness(option);
    await assert.rejects(() => resumePinterestAdsCampaign(accountId, resources, request), (error) => error instanceof PinterestAdsLifecycleError && error.remoteMayHaveChanged);
    const patches = calls.filter((call) => call.method === "PATCH");
    assert.equal(patches.some((call) => call.path.endsWith("/campaigns") && (call.body as { status: string }[])[0].status === "ACTIVE"), false);
    assert.ok(calls.at(-1)?.path.endsWith(`/campaigns/${resources.campaignId}`), "la pause sécurité doit être relue");
  }
});

test("une réponse PATCH de pause Pinterest ne suffit jamais à confirmer la pause de sécurité", async () => {
  const { calls, request } = harness({ malformedActivationResponse: true, safetyPauseUnapplied: true });
  await assert.rejects(() => resumePinterestAdsCampaign(accountId, resources, request), (error) => {
    assert.ok(error instanceof PinterestAdsLifecycleError);
    assert.equal(error.campaignMayBeActive, true);
    assert.doesNotMatch(error.message, /maintenue en pause par sécurité/);
    assert.match(error.message, /Vérifiez immédiatement/);
    return true;
  });
  assert.equal(calls.at(-1)?.method, "GET");
});

test("une pause de sécurité réellement relue PAUSED est confirmée", async () => {
  const { request } = harness({ malformedActivationResponse: true });
  await assert.rejects(() => resumePinterestAdsCampaign(accountId, resources, request), (error) => {
    assert.ok(error instanceof PinterestAdsLifecycleError);
    assert.equal(error.campaignMayBeActive, false);
    assert.match(error.message, /maintenue en pause par sécurité/);
    return true;
  });
});

test("une campagne Pinterest déjà active ne réactive pas implicitement un enfant en pause", async () => {
  const { calls, request } = harness({ status: "ACTIVE" });
  await assert.rejects(() => resumePinterestAdsCampaign(accountId, resources, request), /pause manuelle est conservée/);
  assert.equal(calls.some((call) => call.method === "PATCH"), false);
});
