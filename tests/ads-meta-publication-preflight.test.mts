import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as settings from "../lib/adsMetaCampaignSettings.ts";
import * as resources from "../lib/adsMetaResources.ts";
import * as placement from "../lib/adsMetaPlacement.ts";
import * as core from "../lib/adsMetaPublishCore.ts";
import { parseAdsCampaignInput, type AdsCampaignInput } from "../lib/adsValidation.ts";

const endAt = new Date(Date.now() + 8 * 86400000).toISOString();
const target: resources.MetaAdsGeoTarget = { key: "999", type: "city", name: "Lille", countryCode: "FR", region: "Hauts-de-France" };
const native = settings.defaultMetaDeliverySettings(); native.budget = { type: "total", totalEuros: 200, startAt: null, endAt }; native.callToAction = "GET_QUOTE"; native.audience = { ageMin: 25, ageMax: 65 };
const parsed = parseAdsCampaignInput({ provider: "meta", campaignType: "meta_traffic", objective: "website_traffic", conversionGoal: "website_visit", conversionLocation: "website", bidStrategy: "maximize_clicks", adAccountId: "1234567890", pageId: "9988776655", accountCurrency: "EUR", name: "Projet local", dailyBudgetEuros: 10, endDate: endAt.slice(0, 10), destinationUrl: "https://example.fr/service", trackingParameters: "utm_source=meta", imageUrl: "https://cdn.example.fr/feed.jpg", primaryText: "Découvrez notre service dans votre ville.", headlines: ["Votre offre locale"], descriptions: [], metaPlacements: ["facebook_feed"], languages: ["fr"], targetLocations: ["Lille"], noSpecialCategoryConfirmed: true, metaDeliverySettings: native, metaGeoTargets: [target] });
assert.equal(parsed.error, null);
const draft = parsed.draft!;
const nativeResources: resources.MetaAdsResources = { selectedAccountId: draft.adAccountId, selectedPageId: draft.pageId, account: { id: draft.adAccountId, name: "Compte", currency: "EUR", status: 1, timezone: "Europe/Paris" }, pages: [{ id: draft.pageId, name: "Page", instagramUserId: "17841400000000000" }], instagramAccountIds: ["17841400000000000"], locales: [{ id: "1002", name: "French" }] };
class PreparationError extends Error { status: number; constructor(message: string, status = 422) { super(message); this.status = status; } }
type Publisher = typeof import("../lib/adsMetaPublish.ts");
function publisher(options: { drift?: boolean; unknown?: boolean; locales?: resources.MetaAdsResources["locales"]; badMedia?: boolean; instagramDenied?: boolean } = {}) {
  const calls: Array<{ path: string; fields?: Record<string, string> }> = []; let contextReads = 0; let mutations = 0;
  const modules = new Map<string, unknown>([
    ["server-only", {}], ["./adsMetaPlacement.ts", placement], ["./adsMetaPublishCore.ts", core], ["./adsMetaCampaignSettings.ts", settings], ["./adsMetaResources.ts", resources],
    ["./adsMetaResourcesServer.ts", {
      MetaAdsPreparationError: PreparationError,
      metaAdsDeliveryContext: async () => ++contextReads > 1 && options.drift ? "new-identity" : "context",
      readMetaAdsDeliveryResources: async (_owner: string, account: string, page: string) => {
        assert.equal(account, draft.adAccountId); assert.equal(page, draft.pageId);
        if (options.unknown) throw new Error("Bearer token-secret private provider payload");
        return { ...nativeResources, locales: options.locales || nativeResources.locales, instagramAccountIds: options.instagramDenied ? [] : nativeResources.instagramAccountIds };
      },
      verifyMetaAdsGeoTargets: async (_owner: string, targets: resources.MetaAdsGeoTarget[], account: string) => { assert.equal(account, draft.adAccountId); assert.deepEqual(targets, [target]); return { cities: [{ key: "999" }], location_types: ["home", "recent"] }; },
    }],
    ["./adsServer.ts", { listMetaPages: async () => nativeResources.pages, metaAdsJson: async (_owner: string, path: string, body?: URLSearchParams) => {
      calls.push({ path, ...(body ? { fields: Object.fromEntries(body) } : {}) });
      if (!body) { if (path.includes("connected_instagram_accounts")) return { data: [{ id: "17841400000000000" }] }; if (path.startsWith("act_")) return { id: draft.adAccountId, currency: "EUR", account_status: 1 }; return { data: [{ key: "999", type: "city", name: "Lille", region: "Hauts-de-France", country_code: "FR" }] }; }
      mutations++;
      if (path.endsWith("/adimages")) return { images: { one: { hash: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa" } } }; if (path.endsWith("/campaigns")) return { id: "111" }; if (path.endsWith("/adsets")) return { id: "222" }; if (path.endsWith("/adcreatives")) return { id: "333" }; if (path.endsWith("/ads")) return { id: "444" }; return { success: true };
    } }],
    ["./adsMetaCreativeImageServer.ts", { prepareMetaCreativeImageForUpload: async (source: Buffer) => { assert.equal(source.toString(), "actual-image-bytes"); if (options.badMedia) throw new Error("Le fichier Meta Ads n’est pas une image valide."); return { buffer: Buffer.from("normalized-image-bytes") }; } }],
    ["./mediaLibraryContentUrl.ts", { verifyMediaLibraryContentToken: () => false }], ["./safeStorageSignedUrl.ts", { createSafeStorageSignedUrl: () => { throw new Error("Unexpected private media"); } }], ["./supabaseAdmin.ts", { supabaseAdmin: { from: () => { throw new Error("No DB writes or private media reads in public fixture"); } } }],
  ]);
  const code = ts.transpileModule(readFileSync(new URL("../lib/adsMetaPublish.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} as Publisher };
  new Function("module", "exports", "require", "fetch", code)(loaded, loaded.exports, (name: string) => { assert.ok(modules.has(name), name); return modules.get(name); }, async () => new Response("actual-image-bytes", { headers: { "Content-Type": "image/jpeg" } }));
  return { api: loaded.exports, calls, mutationCount: () => mutations };
}
test("Meta preflight inspects image and native evidence GET-only and returns no private publication input", async () => {
  const runtime = publisher(); const checked = await runtime.api.checkMetaAdsPublication("owner", draft);
  assert.deepEqual(checked, { ready: true, selectedAccountId: draft.adAccountId, selectedPageId: draft.pageId, verifiedLocationCount: 1, verifiedLanguageCount: 1, resourcesKey: resources.metaAdsResourcesConsentKey(nativeResources) });
  assert.equal(runtime.mutationCount(), 0); assert.doesNotMatch(JSON.stringify(checked), /image-bytes|signed|secret|token|feedImageBytes|targeting/);
});
test("Meta publication sends exact native age/language/zone/total/CTA and signals mutation after preparation", async () => {
  const runtime = publisher(); let boundary = false; const progress: Record<string, unknown>[] = [];
  const result = await runtime.api.publishMetaAdsCampaign("owner", draft, async (record) => { assert.equal(boundary, true); progress.push(record); }, { activate: false, onProviderMutationStart: () => { assert.equal(runtime.mutationCount(), 0); boundary = true; } });
  const adset = runtime.calls.find((call) => call.path.endsWith("/adsets"))!.fields!; const targeting = JSON.parse(adset.targeting);
  assert.deepEqual(targeting, { age_min: 25, publisher_platforms: ["facebook"], facebook_positions: ["feed"], age_max: 65, geo_locations: { cities: [{ key: "999" }], location_types: ["home", "recent"] }, locales: [1002] });
  assert.equal(adset.lifetime_budget, "20000"); assert.equal("daily_budget" in adset, false); assert.equal(adset.end_time, endAt); assert.equal(adset.bid_strategy, "LOWEST_COST_WITHOUT_CAP"); assert.equal("bid_amount" in adset, false);
  assert.equal(result.stage, "demo_paused"); assert.equal(progress.at(-1)?.budgetType, "total"); assert.equal(runtime.calls.some((call) => call.fields?.status === "ACTIVE"), false);
  const creative = runtime.calls.find((call) => call.path.endsWith("/adcreatives"))!.fields!; assert.deepEqual(JSON.parse(creative.asset_feed_spec).call_to_action_types, ["GET_QUOTE"]);
});
test("Meta changed context, missing language, invalid media and denied Instagram prevent every mutation", async () => {
  for (const options of [{ drift: true }, { locales: [] }, { badMedia: true }, { instagramDenied: true }]) {
    const runtime = publisher(options); let boundary = false;
    const selected = options.instagramDenied ? { ...draft, metaPlacements: ["instagram_feed" as const] } : draft;
    await assert.rejects(runtime.api.publishMetaAdsCampaign("owner", selected, async () => {}, { onProviderMutationStart: () => { boundary = true; } }));
    assert.equal(boundary, false); assert.equal(runtime.mutationCount(), 0);
  }
});
test("unexpected provider errors do not escape the Meta preflight public error", async () => {
  const runtime = publisher({ unknown: true });
  await assert.rejects(runtime.api.checkMetaAdsPublication("owner", draft), (error: unknown) => error instanceof PreparationError && error.status === 503 && !/token-secret|private provider/.test(error.message));
  assert.equal(runtime.mutationCount(), 0);
});
test("old Meta drafts keep original daily/end/CTA payload without native catalog reads", async () => {
  const runtime = publisher({ unknown: true });
  const legacy: AdsCampaignInput = { ...draft, metaDeliverySettings: undefined, metaGeoTargets: undefined, languages: ["fr"] };
  await runtime.api.publishMetaAdsCampaign("owner", legacy, async () => {}, { activate: false });
  const adset = runtime.calls.find((call) => call.path.endsWith("/adsets"))!.fields!;
  assert.equal(adset.daily_budget, "1000"); assert.equal("lifetime_budget" in adset, false); assert.equal("start_time" in adset, false); assert.equal("locales" in JSON.parse(adset.targeting), false);
  assert.deepEqual(JSON.parse(runtime.calls.find((call) => call.path.endsWith("/adcreatives"))!.fields!.asset_feed_spec).call_to_action_types, ["LEARN_MORE"]);
});
