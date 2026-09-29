import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  ADS_LOCAL_RECOVERY_DISCARD_CONFIRMATION,
  ADS_REMOTE_DELETE_CONFIRMATION,
  canDiscardInterruptedInitialPublish,
  canManageRemoteAdsCampaign,
  canRecoverInterruptedAdsCampaign,
  hasCompleteInitialPublishResources,
  hasLocalRecoveryDiscardConfirmation,
  hasRemoteDeleteConfirmation,
  parseAdsCampaignLifecycleRequest,
} from "../lib/adsCampaignLifecycle.ts";

const now = new Date("2026-09-29T10:00:00.000Z");

test("les modifications distantes acceptent nom, budget, fin et zones bornés", () => {
  const parsed = parseAdsCampaignLifecycleRequest({
    action: "update",
    changes: {
      name: "Campagne locale",
      dailyBudgetEuros: 12.34,
      endDate: "2026-10-20",
      targetLocations: ["Lille", "Lille", "France"],
    },
  }, now);
  assert.equal(parsed.error, null);
  assert.deepEqual(parsed.request?.changes, {
    name: "Campagne locale",
    dailyBudgetCents: 1234,
    endDate: "2026-10-20",
    targetLocations: ["Lille", "France"],
  });
});

test("les modifications distantes rejettent les valeurs imprécises", () => {
  assert.match(parseAdsCampaignLifecycleRequest({ action: "update", changes: {} }, now).error || "", /au moins une/);
  assert.match(parseAdsCampaignLifecycleRequest({ action: "update", changes: { dailyBudgetEuros: 4.99 } }, now).error || "", /5 et 500/);
  assert.match(parseAdsCampaignLifecycleRequest({ action: "update", changes: { endDate: "2026-02-30" } }, now).error || "", /valide/);
  assert.match(parseAdsCampaignLifecycleRequest({ action: "update", changes: { targetLocations: [] } }, now).error || "", /1 et 20/);
});

test("la mise en pause ne demande aucun champ éditable et la reprise payante reste interdite ici", () => {
  assert.deepEqual(parseAdsCampaignLifecycleRequest({ action: "pause" }, now).request, { action: "pause", changes: {} });
  assert.deepEqual(parseAdsCampaignLifecycleRequest({ action: "reconcile" }, now).request, { action: "reconcile", changes: {} });
  assert.match(parseAdsCampaignLifecycleRequest({ action: "resume" }, now).error || "", /invalide/);
});

test("seules les campagnes fournisseur identifiées sont gérables", () => {
  const base = { provider: "google", status: "active", provider_resources: { campaignResourceName: "customers/1/campaigns/2" } };
  assert.equal(canManageRemoteAdsCampaign(base), true);
  assert.equal(canManageRemoteAdsCampaign({ ...base, status: "publishing" }), false);
  assert.equal(canRecoverInterruptedAdsCampaign({ ...base, status: "publishing" }), true);
  assert.equal(canRecoverInterruptedAdsCampaign(base), false);
  assert.equal(canManageRemoteAdsCampaign({ ...base, status: "draft" }), false);
  assert.equal(canManageRemoteAdsCampaign({ ...base, provider_resources: {} }), false);
  assert.equal(canManageRemoteAdsCampaign({ ...base, provider_resources: { imageAssets: { feed: { id: "1" } } } }), false);
  assert.equal(canManageRemoteAdsCampaign({ ...base, provider: "linkedin" }), false);
});

test("une création initiale n’est complète qu’avec toute la hiérarchie requise", () => {
  const google = {
    provider: "google", ad_account_id: "1234567890", provider_resources: {
      campaignResourceName: "customers/1234567890/campaigns/2",
      budgetResourceName: "customers/1234567890/campaignBudgets/3",
      adGroupResourceName: "customers/1234567890/adGroups/4",
      adGroupAdResourceName: "customers/1234567890/adGroupAds/4~5",
    },
  };
  assert.equal(hasCompleteInitialPublishResources(google), true);
  assert.equal(hasCompleteInitialPublishResources({ ...google, provider_resources: { ...google.provider_resources, adGroupAdResourceName: undefined } }), false);

  const meta = {
    provider: "meta", ad_account_id: "1234567890", provider_resources: {
      provider: "meta", adAccountId: "1234567890", campaignId: "11", adSetId: "12", creativeId: "13", adId: "14",
    },
  };
  assert.equal(hasCompleteInitialPublishResources(meta), false, "les identifiants Meta doivent conserver le format fournisseur attendu");
  const completeMeta = {
    ...meta,
    provider_resources: { ...meta.provider_resources, campaignId: "11111", adSetId: "12222", creativeId: "13333", adId: "14444" },
  };
  assert.equal(hasCompleteInitialPublishResources(completeMeta), true);
  assert.equal(hasCompleteInitialPublishResources({ ...completeMeta, provider_resources: { ...completeMeta.provider_resources, creativeId: undefined } }), false);
});

test("une création interrompue sans identifiant campagne exige un nettoyage local explicite", () => {
  const interrupted = {
    provider: "meta", ad_account_id: "1234567890", status: "needs_review",
    provider_resources: {
      provider: "meta", adAccountId: "1234567890", imageAssets: { feed: { id: "11", hash: "hash" } },
      inrcyLifecycleRecovery: { operation: "initial_publish", mode: "demo_paused" },
    },
  };
  assert.equal(canDiscardInterruptedInitialPublish(interrupted), true);
  assert.equal(canDiscardInterruptedInitialPublish({ ...interrupted, provider_resources: { ...interrupted.provider_resources, campaignId: "12345" } }), false);
  assert.equal(canDiscardInterruptedInitialPublish({ ...interrupted, provider_resources: { ...interrupted.provider_resources, campaignId: 12345 } }), false);
  assert.equal(hasLocalRecoveryDiscardConfirmation({ confirmation: ADS_LOCAL_RECOVERY_DISCARD_CONFIRMATION }), true);
  assert.equal(hasLocalRecoveryDiscardConfirmation({ confirmation: ADS_REMOTE_DELETE_CONFIRMATION }), false);
});

test("la suppression distante exige une confirmation exacte", () => {
  assert.equal(hasRemoteDeleteConfirmation({ confirmation: ADS_REMOTE_DELETE_CONFIRMATION }), true);
  assert.equal(hasRemoteDeleteConfirmation({ confirmation: "DELETE" }), false);
});

test("la route verrouille les mutations, expire les verrous interrompus et supprime d'abord chez le fournisseur", () => {
  const route = readFileSync(new URL("../app/api/ads/campaigns/[id]/lifecycle/route.ts", import.meta.url), "utf8");
  assert.match(route, /adsRequestOriginAllowed\(request\)/);
  assert.match(route, /requirePremiumAdsUser\(\)/);
  assert.match(route, /inrcyLifecycleClaim: \{[\s\S]*?claimedAt,[\s\S]*?previousStatus: campaign\.status,[\s\S]*?operation: request\.action/);
  assert.match(route, /const staleAfterMs = \(maxDuration \+ 120\) \* 1_000/);
  assert.match(route, /operation === "reconcile" && stableStatus \? stableStatus : "needs_review"/);
  assert.match(route, /inrcyLifecycleRecovery/);
  assert.match(route, /const effectiveRequest:[\s\S]*?pendingRecovery\?\.operation === "update"[\s\S]*?pendingRecovery\?\.operation === "initial_publish"/);
  assert.match(route, /claimCampaign\(campaign, user\.activeUserId, effectiveRequest\)/);
  assert.match(route, /preserveRecovery: Boolean\(pendingRecovery\)/);
  assert.match(route, /hasCompleteInitialPublishResources\(campaign\)/);
  assert.match(route, /hasLocalRecoveryDiscardConfirmation\(body\)/);
  assert.match(route, /reconciledChanges: recovery\.changes/);
  assert.match(route, /\.select\("id"\)\.maybeSingle\(\);[\s\S]*?return !error && Boolean\(data\);/);
  assert.match(route, /\.eq\("status", campaign\.status\)\.eq\("updated_at", campaign\.updated_at\)/);
  const providerDelete = route.indexOf("await adapter.remove()");
  const localDelete = route.lastIndexOf('supabaseAdmin.from("ads_campaigns").delete()');
  assert.ok(providerDelete >= 0 && localDelete > providerDelete, "la suppression locale ne doit suivre qu'une suppression Google confirmée");
  assert.match(route, /await deleteMetaAdsCampaign\([\s\S]*?supabaseAdmin\.from\("ads_campaigns"\)\.delete\(\)/);
});

test("la publication initiale conserve un marqueur de reprise jusqu’à sa finalisation", () => {
  const route = readFileSync(new URL("../app/api/ads/campaigns/[id]/publish/route.ts", import.meta.url), "utf8");
  assert.match(route, /operation: "initial_publish"/);
  assert.match(route, /operation: "initial_publish",[\s\S]*?mode,/);
  assert.match(route, /provider_resources: \{ inrcyLifecycleClaim: initialLifecycleClaim \}/);
  assert.match(route, /provider_resources: \{ \.\.\.resources, inrcyLifecycleClaim: initialLifecycleClaim \}/);
  assert.match(route, /provider_resources: rejectedBeforeCreate \? \{\} : withInitialPublishRecovery\(resources, mode\)/);
});
