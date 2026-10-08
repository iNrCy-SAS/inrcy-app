import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as resources from "../lib/adsMetaResources.ts";

type Api = typeof import("../lib/adsMetaResourcesServer.ts");
type Options = { drift?: number; accountId?: string; pageId?: string; currency?: string; status?: number; localesError?: boolean; geo?: Record<string, unknown>[]; pages?: Array<{ id: string; name: string; instagramUserId?: string }> };
function runtime(options: Options = {}) {
  const calls: string[] = []; let reads = 0;
  const integration = { id: "integration", provider_account_id: "member", resource_id: options.accountId || "1234567890", status: "connected", meta: { selected_page_id: options.pageId || "9988776655" } };
  const modules = new Map<string, unknown>([
    ["server-only", {}], ["./adsMetaResources.ts", resources],
    ["./adsServer.ts", {
      adsConnectionStatus: (row: { status: string }) => row.status,
      readAdsIntegration: async () => { reads++; return options.drift && reads >= options.drift ? { ...integration, provider_account_id: "other-member" } : integration; },
      listMetaPages: async () => options.pages || [{ id: "9988776655", name: "Page", instagramUserId: "17841400000000000" }],
      metaAdsJson: async (_owner: string, path: string, body?: URLSearchParams) => {
        assert.equal(body, undefined, "all resources calls are GET only"); calls.push(path);
        if (path.startsWith(`act_${integration.resource_id}?`)) return { id: `act_${integration.resource_id}`, name: "Annonceur", currency: options.currency || "EUR", account_status: options.status ?? 1, timezone_name: "Europe/Paris" };
        if (path.includes("connected_instagram_accounts")) return path.includes("after=") ? { data: [{ id: "17841400000000001" }] } : { data: [{ id: "17841400000000000" }], paging: { next: "https://graph.test/next", cursors: { after: "cursor-two" } } };
        if (path.includes("type=adlocale")) { if (options.localesError) throw new Error("provider unavailable secret"); return { data: [{ key: "1002", name: "French" }, { key: "1001", name: "English" }] }; }
        if (path.includes("type=adgeolocation")) return { data: options.geo || [{ key: "999", type: "city", name: "Lille", region: "Hauts-de-France", country_code: "FR" }] };
        throw new Error("Unexpected GET " + path);
      },
    }],
  ]);
  const source = ts.transpileModule(readFileSync(new URL("../lib/adsMetaResourcesServer.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} as Api };
  new Function("module", "exports", "require", source)(loaded, loaded.exports, (id: string) => { assert.ok(modules.has(id), id); return modules.get(id); });
  return { api: loaded.exports, calls, readCount: () => reads };
}
test("Meta resources bind current EUR account and selected Page, including paginated Instagram rights", async () => {
  const { api, calls } = runtime();
  const result = await api.readMetaAdsDeliveryResources("owner", "1234567890", "9988776655");
  assert.equal(result.selectedAccountId, "1234567890"); assert.equal(result.selectedPageId, "9988776655"); assert.equal(result.account.timezone, "Europe/Paris");
  assert.deepEqual(result.instagramAccountIds, ["17841400000000000", "17841400000000001"]); assert.equal(result.locales[0].id, "1002");
  assert.ok(calls.some((path) => path.includes("connected_instagram_accounts") && path.includes("after=cursor-two")));
  assert.doesNotMatch(JSON.stringify(result), /token|secret|cursor|paging/);
});
test("Meta resource checks reject account/Page drift, disabled EUR accounts and foreign requested identities", async () => {
  for (const options of [{ drift: 2 }, { drift: 3 }, { currency: "USD" }, { status: 2 }, { pages: [] }]) await assert.rejects(runtime(options).api.readMetaAdsDeliveryResources("owner", "1234567890", "9988776655"));
  const wrongAccount = runtime(); await assert.rejects(wrongAccount.api.readMetaAdsDeliveryResources("owner", "99999999"), /compte/); assert.equal(wrongAccount.calls.length, 0);
  const wrongPage = runtime(); await assert.rejects(wrongPage.api.readMetaAdsDeliveryResources("owner", "1234567890", "88776655"), /Page/); assert.equal(wrongPage.calls.length, 0);
});
test("locale catalog failure leaves all languages explicit and never invents a French identifier", async () => {
  const result = await runtime({ localesError: true }).api.readMetaAdsDeliveryResources("owner");
  assert.deepEqual(result.locales, []); assert.deepEqual(resources.resolveMetaAdsLanguages(result, []), []);
  assert.throws(() => resources.resolveMetaAdsLanguages(result, ["fr"]), /vérifiées/);
});
test("Meta geography proposes exact matches only and keeps same-name foreign cities ambiguous", async () => {
  const exact = await runtime().api.searchMetaAdsGeographies("owner", ["Lille"]);
  assert.equal(exact.complete, true); assert.equal(exact.resolutions[0].autoSelectedTarget?.key, "999");
  const foreign = { key: "foreign-999", type: "city", name: "Lille", region: "Other", country_code: "US" };
  const ambiguous = await runtime({ geo: [{ key: "999", type: "city", name: "Lille", region: "Hauts-de-France", country_code: "FR" }, foreign] }).api.searchMetaAdsGeographies("owner", ["Lille"]);
  assert.equal(ambiguous.complete, false); assert.equal(ambiguous.resolutions[0].autoSelectedTarget, null); assert.equal(ambiguous.options.length, 2);
  const approximate = await runtime({ geo: [{ key: "1", type: "region", name: "Hauts-de-France", country_code: "FR" }] }).api.searchMetaAdsGeographies("owner", ["Lille"]);
  assert.equal(approximate.complete, false); assert.equal(approximate.resolutions[0].autoSelectedTarget, null);
  await assert.rejects(runtime({ drift: 2 }).api.searchMetaAdsGeographies("owner", ["Lille"]), /connexion/);
});
test("fresh Meta targets require exact ID/type/label/country and preserve geography without France fallback", async () => {
  const target: resources.MetaAdsGeoTarget = { key: "999", type: "city", name: "Lille", region: "Hauts-de-France", countryCode: "FR" };
  const actual = await runtime().api.verifyMetaAdsGeoTargets("owner", [target], "1234567890");
  assert.deepEqual(actual, { cities: [{ key: "999" }], location_types: ["home", "recent"] });
  for (const patch of [{ key: "invented" }, { region: "Another" }, { countryCode: "US" }, { type: "region" as const }]) await assert.rejects(runtime().api.verifyMetaAdsGeoTargets("owner", [{ ...target, ...patch }], "1234567890"), /confirmé/);
  await assert.rejects(runtime().api.verifyMetaAdsGeoTargets("owner", [], "1234567890"), /zone exacte/);
});
test("Meta resources and geography routes enforce owner/Premium/rate limits and expose no POST", () => {
  for (const route of ["resources", "geography"]) {
    const source = readFileSync(new URL(`../app/api/ads/meta/${route}/route.ts`, import.meta.url), "utf8");
    assert.match(source, /requirePremiumAdsUser\("meta"\)/); assert.match(source, /enforceRateLimit/); assert.match(source, /user\.activeUserId/); assert.match(source, /Cache-Control.*no-store/); assert.doesNotMatch(source, /export async function POST/);
    assert.doesNotMatch(source, /request\.json|access_token_enc|refresh_token_enc/);
  }
});
