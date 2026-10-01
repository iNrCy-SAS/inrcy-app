import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { ADS_PUBLIC_CHANNELS, adsAccessAllowed } from "../lib/adsAccessPolicy.ts";
import { isAdsChannelId, isAdsProvider, type AdsChannelId } from "../lib/adsValidation.ts";

function actualFunction(path: string, name: string, scope: Record<string, unknown>) {
  const source = ts.createSourceFile(path, readFileSync(new URL(`../${path}`, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true);
  const declaration = source.statements.find((node) => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration, `${path} must define ${name}`);
  const compiled = ts.transpileModule(declaration.getText(source).replace(/^export\s+/, ""), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return new Function(...Object.keys(scope), `${compiled}\nreturn ${name};`)(...Object.values(scope));
}

const campaignId = "00000000-0000-4000-8000-000000000001";
const user = { authUserId: "professional", activeUserId: "business" };
const response = (body: unknown, options: { status?: number } = {}) => ({ status: options.status || 200, body });
const baseScope = {
  adsRequestOriginAllowed: () => true,
  requirePremiumAdsUser: async () => ({ user, errorResponse: null }),
  adsPilotOnlyResponse: () => response({ code: "INRCY_ADS_COMING_SOON" }, { status: 403 }),
  isAdsChannelUserAllowed: async (_auth: string, _active: string, channel: AdsChannelId) => adsAccessAllowed("premium", false, channel),
  NextResponse: { json: response },
  ADS_CAMPAIGN_ID_PATTERN: /^[a-f0-9-]{36}$/,
  enforceRateLimit: async () => null,
};

test("a Premium user lists Google, Pinterest and ChatGPT campaigns", async () => {
  let providerFilter: unknown[] = [];
  const query = {
    select() { return this; },
    eq() { return this; },
    in(_column: string, values: unknown[]) { providerFilter = values; return this; },
    order() { return this; },
    async range() { return { data: [], error: null, count: 0 }; },
  };
  const get = actualFunction("app/api/ads/campaigns/route.ts", "GET", {
    requirePremiumAdsUser: baseScope.requirePremiumAdsUser,
    isAdsPilotAdmin: async () => false,
    supabaseAdmin: { from: () => query },
    ADS_PUBLIC_CHANNELS,
    CAMPAIGN_PAGE_SIZE: 50,
    normalizeStoredAdsCampaignDraft: (value: unknown) => value,
    NextResponse: baseScope.NextResponse,
  });
  const result = await get(new Request("https://app.example/api/ads/campaigns"));
  assert.equal(result.status, 200);
  assert.deepEqual(providerFilter, ["google", "pinterest", "openai"]);
});

test("a Premium user cannot trigger private-channel recovery before the channel guard", async () => {
  for (const provider of ["meta", "linkedin", "tiktok", "x"] as const) {
    let recoveries = 0;
    const query = {
      select() { return this; }, eq() { return this; },
      maybeSingle: async () => ({ data: { id: campaignId, provider, status: "publishing" }, error: null }),
    };
    const authorize = actualFunction("app/api/ads/campaigns/[id]/lifecycle/route.ts", "authorizeRemoteLifecycle", {
      ...baseScope,
      supabaseAdmin: { from: () => query },
      recoverStaleLifecycleClaim: async () => { recoveries += 1; return response({ recovered: true }); },
    });
    const result = await authorize(new Request("https://app.example/api/ads/campaigns/id/lifecycle"), { params: Promise.resolve({ id: campaignId }) }, "update");
    assert.equal(result.response.status, 403, provider);
    assert.equal(recoveries, 0, provider);
  }
});

test("a public-channel payload cannot overwrite an existing private-channel draft", async () => {
  for (const provider of ["meta", "linkedin", "tiktok", "x"] as const) {
    let writes = 0;
    const query = {
      select() { return this; }, eq() { return this; },
      maybeSingle: async () => ({ data: { id: campaignId, provider, status: "draft", published_at: null, provider_resources: {} }, error: null }),
    };
    const post = actualFunction("app/api/ads/campaigns/route.ts", "POST", {
      ...baseScope,
      isAdsProvider,
      isAdsChannelId,
      parseAdsCampaignInput: () => ({ draft: { provider: "google", adAccountId: "", dailyBudgetEuros: 10 }, error: null }),
      canMutateAdsDraft: () => true,
      supabaseAdmin: {
        from: () => query,
        rpc: async () => { writes += 1; return { data: campaignId, error: null }; },
      },
    });
    const result = await post(new Request("https://app.example/api/ads/campaigns", { method: "POST", body: JSON.stringify({ id: campaignId }) }));
    assert.equal(result.status, 403, provider);
    assert.equal(writes, 0, provider);
  }
});
