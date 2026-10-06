import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const source = ts.transpileModule(
  readFileSync(new URL("../app/api/ads/campaigns/[id]/preflight/route.ts", import.meta.url), "utf8"),
  { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
).outputText;
const campaignId = "870bb769-8aa0-45da-ac44-d24d0b414955";
const activeUserId = "active-owner";
const draft = { provider: "linkedin", adAccountId: "558357276", accountCurrency: "EUR", dailyBudgetEuros: 30 };

class ConnectionError extends Error {
  code: string;
  status: number;
  constructor(message: string, code: string, status = 503) { super(message); this.code = code; this.status = status; }
}

function routeRuntime(options: {
  originAllowed?: boolean; authStatus?: number; limited?: boolean; missing?: boolean; databaseError?: boolean;
  stored?: Record<string, unknown>; validationFails?: boolean; checkerError?: unknown;
} = {}) {
  const calls: Array<{ operation: string; value?: unknown }> = [];
  const query = {
    select: (columns: string) => { calls.push({ operation: "select", value: columns }); return query; },
    eq: (column: string, value: unknown) => { calls.push({ operation: "eq", value: [column, value] }); return query; },
    maybeSingle: async () => ({
      data: options.missing ? null : {
        id: campaignId, user_id: activeUserId, provider: "linkedin", ad_account_id: draft.adAccountId,
        currency: "EUR", daily_budget_cents: 3000, draft, status: "draft", provider_resources: {}, published_at: null,
        ...options.stored,
      },
      error: options.databaseError ? { message: "internal database secret" } : null,
    }),
  };
  const modules = new Map<string, unknown>([
    ["next/server", { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } }],
    ["@/lib/adsServer", {
      adsRequestOriginAllowed: () => options.originAllowed !== false,
      adsBadOriginResponse: () => Response.json({ error: "bad origin" }, { status: 403 }),
      requirePremiumAdsUser: async (channel: string) => {
        calls.push({ operation: "authorize", value: channel });
        return options.authStatus
          ? { user: null, errorResponse: Response.json({ error: "authorization required" }, { status: options.authStatus }) }
          : { user: { activeUserId, authUserId: "authenticated-admin" }, errorResponse: null };
      },
    }],
    ["@/lib/supabaseAdmin", { supabaseAdmin: { from: (table: string) => { calls.push({ operation: "from", value: table }); return query; } } }],
    ["@/lib/rateLimit", { enforceRateLimit: async (input: unknown) => {
      calls.push({ operation: "limit", value: input });
      return options.limited ? Response.json({ error: "rate limit" }, { status: 429 }) : null;
    } }],
    ["@/lib/adsValidation", { parseAdsCampaignInput: (value: unknown, input: unknown) => {
      calls.push({ operation: "parse", value: input });
      return options.validationFails ? { draft: null, error: "invalid draft" } : { draft: value, error: null };
    } }],
    ["@/lib/adsLinkedInServer", { LinkedInAdsConnectionError: ConnectionError }],
    ["@/lib/adsLinkedInPublisherServer", { checkLinkedInAdsPublication: async (owner: string, value: unknown, input: unknown) => {
      calls.push({ operation: "check", value: { owner, draft: value, options: input } });
      if (options.checkerError) throw options.checkerError;
      return { ready: true, verifiedGeoCount: 7, token: "must not escape" };
    } }],
    ["@/lib/observability/logger", { log: { warn: (_name: string, value: unknown) => calls.push({ operation: "log", value }) } }],
  ]);
  const loaded = { exports: {} as { GET: (request: Request, context: { params: Promise<{ id: string }> }) => Promise<Response> } };
  new Function("module", "exports", "require", source)(loaded, loaded.exports, (specifier: string) => {
    assert.ok(modules.has(specifier), `Unexpected route dependency ${specifier}`);
    return modules.get(specifier);
  });
  return {
    calls, exports: loaded.exports,
    run: (id = campaignId, mode = "") => loaded.exports.GET(
      new Request(`https://app.inrcy.com/api/ads/campaigns/${id}/preflight${mode ? `?mode=${mode}` : ""}`),
      { params: Promise.resolve({ id }) },
    ),
  };
}

test("saved-draft preflight authenticates LinkedIn access and checks only the active owner's draft without publishing", async () => {
  const runtime = routeRuntime();
  const result = await runtime.run();
  assert.equal(result.status, 200);
  assert.deepEqual(await result.json(), { ready: true, verifiedGeoCount: 7 });
  assert.equal(result.headers.get("cache-control"), "no-store");
  assert.deepEqual(runtime.calls[0], { operation: "authorize", value: "linkedin" });
  assert.ok(runtime.calls.some((call) => call.operation === "eq" && JSON.stringify(call.value) === JSON.stringify(["id", campaignId])));
  assert.ok(runtime.calls.some((call) => call.operation === "eq" && JSON.stringify(call.value) === JSON.stringify(["user_id", activeUserId])));
  assert.deepEqual(runtime.calls.find((call) => call.operation === "parse")?.value, { purpose: "publish" });
  assert.deepEqual(runtime.calls.find((call) => call.operation === "check")?.value, { owner: activeUserId, draft, options: { activate: true } });
  assert.deepEqual(Object.keys(runtime.exports).sort(), ["GET", "maxDuration", "runtime"].sort());
});

test("saved-draft preflight permits a paused readiness check without requesting activation", async () => {
  const runtime = routeRuntime();
  assert.equal((await runtime.run(campaignId, "paused")).status, 200);
  assert.deepEqual(runtime.calls.find((call) => call.operation === "check")?.value, { owner: activeUserId, draft, options: { activate: false } });
});

test("preflight refuses cross-origin, unauthenticated, non-Premium and rate-limited calls before campaign reads", async () => {
  for (const [options, status] of [
    [{ originAllowed: false }, 403], [{ authStatus: 401 }, 401], [{ authStatus: 403 }, 403], [{ limited: true }, 429],
  ] as const) {
    const runtime = routeRuntime(options);
    assert.equal((await runtime.run()).status, status);
    assert.equal(runtime.calls.some((call) => ["from", "check"].includes(call.operation)), false);
  }
  const runtime = routeRuntime();
  assert.equal((await runtime.run("not-an-id")).status, 400);
  assert.equal((await runtime.run(campaignId, "delete")).status, 400);
  assert.equal(runtime.calls.some((call) => ["from", "check"].includes(call.operation)), false);
});

test("preflight rejects missing, foreign, published and inconsistent drafts before the provider check", async () => {
  const cases: Array<[Parameters<typeof routeRuntime>[0], number]> = [
    [{ missing: true }, 404], [{ databaseError: true }, 503], [{ stored: { user_id: "foreign-owner" } }, 404],
    [{ stored: { provider: "google" } }, 400], [{ stored: { status: "active" } }, 409],
    [{ stored: { published_at: "2026-10-06" } }, 409], [{ stored: { provider_resources: { campaignId: "existing" } } }, 409],
    [{ stored: { provider_resources: null } }, 409], [{ stored: { provider_resources: [] } }, 409],
    [{ stored: { ad_account_id: "99999" } }, 400], [{ stored: { currency: "USD" } }, 400],
    [{ stored: { daily_budget_cents: 4000 } }, 400], [{ validationFails: true }, 400],
    [{ stored: { draft: { ...draft, provider: "google" } } }, 400],
  ];
  for (const [options, status] of cases) {
    const runtime = routeRuntime(options);
    assert.equal((await runtime.run()).status, status, JSON.stringify(options));
    assert.equal(runtime.calls.some((call) => call.operation === "check"), false, JSON.stringify(options));
  }
});

test("preflight returns controlled errors and never exposes unexpected provider or database internals", async () => {
  const known = routeRuntime({ checkerError: new ConnectionError("Les zones sont à vérifier.", "publication_preflight_failed", 422) });
  const failure = await known.run();
  assert.equal(failure.status, 422);
  assert.deepEqual(await failure.json(), { ready: false, code: "publication_preflight_failed", error: "Les zones sont à vérifier." });
  const unexpected = routeRuntime({ checkerError: new Error("Bearer token-secret private database URL") });
  const unavailable = await unexpected.run();
  assert.equal(unavailable.status, 503);
  assert.doesNotMatch(await unavailable.text(), /token-secret|private database/);
  assert.doesNotMatch(JSON.stringify(unexpected.calls.filter((call) => call.operation === "log")), /token-secret|private database/);
});
