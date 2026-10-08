import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
const source = ts.transpileModule(readFileSync(new URL("../app/api/ads/campaigns/[id]/preflight/route.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
const campaignId = "870bb769-8aa0-45da-ac44-d24d0b414955";
class PreparationError extends Error { status: number; constructor(message: string, status = 422) { super(message); this.status = status; } }
class OpenaiError extends Error { code: string; constructor(message: string, code = "ACCOUNT_MISMATCH") { super(message); this.code = code; } }
function runtime(provider: "meta" | "openai", error?: Error, ownDraft = true) {
  let checked = false;
  const draft = { provider, adAccountId: provider === "meta" ? "1234567890" : "adacct_test", pageId: "9988776655", accountCurrency: "EUR", dailyBudgetEuros: 10 };
  const query = { select: () => query, eq: (_name: string, value: string) => { assert.ok([campaignId, "owner"].includes(value)); return query; }, maybeSingle: async () => ({ error: null, data: { user_id: ownDraft ? "owner" : "foreign", provider, ad_account_id: draft.adAccountId, currency: "EUR", daily_budget_cents: 1000, draft, status: "draft", provider_resources: {}, published_at: null } }) };
  const check = async (owner: string, value: unknown) => { assert.equal(owner, "owner"); assert.equal(value, draft); checked = true; if (error) throw error; return { ready: true, selectedAccountId: draft.adAccountId, selectedPageId: draft.pageId, verifiedLocationCount: 1, verifiedLanguageCount: 0, resourcesKey: "verified-native-context", account: { privateKey: "secret" }, locations: ["private-provider-payload"], delivery: { private: true }, imageBytes: "signed-image-token" }; };
  const fail = () => { throw new Error("Other provider must not be called"); };
  const modules = new Map<string, unknown>([
    ["next/server", { NextResponse: { json: (body: unknown, init: ResponseInit) => Response.json(body, init) } }],
    ["@/lib/adsServer", { adsRequestOriginAllowed: () => true, requirePremiumAdsUser: async () => ({ user: { activeUserId: "owner", authUserId: "auth" }, errorResponse: null }), isAdsChannelUserAllowed: async () => true }],
    ["@/lib/adsMetaPublish", { checkMetaAdsPublication: provider === "meta" ? check : fail }], ["@/lib/adsMetaResourcesServer", { MetaAdsPreparationError: PreparationError }],
    ["@/lib/adsOpenaiServer", { checkOpenaiAdsPublication: provider === "openai" ? check : fail }], ["@/lib/adsOpenaiConnector", { OpenaiAdsPublishError: OpenaiError }],
    ["@/lib/adsPinterestCampaignPublish", { checkPinterestAdsPublication: fail, PinterestAdsPreparationError: PreparationError }], ["@/lib/adsPinterestServer", { PinterestAdsConnectionError: class extends Error {} }],
    ["@/lib/adsGooglePublish", { checkGoogleAdsPublication: fail, GoogleAdsLocationResolutionError: class extends Error {} }], ["@/lib/adsGoogleApiError", { GoogleAdsApiError: class extends Error {} }],
    ["@/lib/adsLinkedInPublisherServer", { checkLinkedInAdsPublication: fail }], ["@/lib/adsLinkedInServer", { LinkedInAdsConnectionError: class extends Error {} }],
    ["@/lib/supabaseAdmin", { supabaseAdmin: { from: () => query } }], ["@/lib/rateLimit", { enforceRateLimit: async () => null }], ["@/lib/adsValidation", { parseAdsCampaignInput: () => ({ draft, error: null }) }], ["@/lib/observability/logger", { log: { warn: () => {} } }],
  ]);
  const loaded = { exports: {} as { GET: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response> } };
  new Function("module", "exports", "require", source)(loaded, loaded.exports, (id: string) => { assert.ok(modules.has(id), id); return modules.get(id); });
  return { draft, checked: () => checked, run: () => loaded.exports.GET(new Request(`https://app.inrcy.com/api/ads/campaigns/${campaignId}/preflight`), { params: Promise.resolve({ id: campaignId }) }) };
}
test("saved Meta and ChatGPT preflight return only the explicit safe readiness projection", async () => {
  for (const provider of ["meta", "openai"] as const) {
    const fixture = runtime(provider), response = await fixture.run(), body = await response.json();
    assert.equal(response.status, 200); assert.equal(response.headers.get("cache-control"), "no-store"); assert.equal(fixture.checked(), true);
    assert.deepEqual(body, { ready: true, selectedAccountId: fixture.draft.adAccountId, verifiedLocationCount: 1, resourcesKey: "verified-native-context", ...(provider === "meta" ? { selectedPageId: fixture.draft.pageId, verifiedLanguageCount: 0 } : {}) });
    assert.doesNotMatch(JSON.stringify(body), /private|secret|signed-image|delivery|imageBytes/);
  }
});
test("saved Meta and ChatGPT preflight never reads a foreign owner's provider context", async () => {
  for (const provider of ["meta", "openai"] as const) { const fixture = runtime(provider, undefined, false); assert.equal((await fixture.run()).status, 404); assert.equal(fixture.checked(), false); }
});
test("native preflight exposes controlled readiness errors and sanitizes unknown transport errors", async () => {
  const known = await runtime("meta", new PreparationError("Le compte a changé.", 409)).run(); assert.equal(known.status, 409); assert.equal((await known.json()).error, "Le compte a changé.");
  for (const provider of ["meta", "openai"] as const) { const response = await runtime(provider, new Error("Bearer secret private-provider-url")).run(); assert.equal(response.status, 503); assert.doesNotMatch(await response.text(), /secret|private-provider/); }
});
