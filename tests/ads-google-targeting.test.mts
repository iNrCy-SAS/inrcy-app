import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as locations from "../lib/adsGoogleLocations.ts";
import { GoogleAdsApiError } from "../lib/adsGoogleApiError.ts";
import { adsAccountCanBeAssociated } from "../lib/adsValidation.ts";

type Call = { name: string; args: unknown[] };
const account = { id: "1234567890", currency: "EUR", provider: "google", loginCustomerId: "9876543210" };
const suggestions = { geoTargetConstantSuggestions: [{ geoTargetConstant: {
  resourceName: "geoTargetConstants/100001", id: "100001", name: "Lille", canonicalName: "Lille,Hauts-de-France,France", countryCode: "FR", status: "ENABLED",
} }] };

function routeHarness(overrides: { auth?: unknown; accounts?: unknown[]; integration?: unknown; limited?: Response; failure?: Error } = {}) {
  const calls: Call[] = [];
  const imports: Record<string, unknown> = {
    "next/server": { NextResponse: { json: (value: unknown, init: ResponseInit) => Response.json(value, init) } },
    "@/lib/adsServer": {
      requirePremiumAdsUser: async (...args: unknown[]) => { calls.push({ name: "auth", args }); return overrides.auth || { user: { activeUserId: "user-one" }, errorResponse: null }; },
      adsConnectionStatus: (integration: { status?: string }) => integration.status,
      readAdsIntegration: async (...args: unknown[]) => { calls.push({ name: "integration", args }); return overrides.integration === undefined ? { status: "connected", resource_id: "1234567890" } : overrides.integration; },
      listAdsAccounts: async (...args: unknown[]) => { calls.push({ name: "accounts", args }); return overrides.accounts || [account]; },
      googleAdsJson: async (...args: unknown[]) => { calls.push({ name: "google", args }); if (overrides.failure) throw overrides.failure; return suggestions; },
    },
    "@/lib/adsValidation": { adsAccountCanBeAssociated },
    "@/lib/adsGoogleApiError": { GoogleAdsApiError },
    "@/lib/adsGoogleLocations": locations,
    "@/lib/rateLimit": { enforceRateLimit: async (...args: unknown[]) => { calls.push({ name: "rate-limit", args }); return overrides.limited || null; } },
  };
  const source = readFileSync(new URL("../app/api/ads/google/targeting/route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const route: { GET?: (request: Request) => Promise<Response> } = {};
  new Function("exports", "require", compiled)(route, (id: string) => { assert.ok(id in imports, `Unexpected dependency ${id}`); return imports[id]; });
  return { get: route.GET!, calls };
}

const request = () => new Request("https://app.example/api/ads/google/targeting?query=Lille&accountId=1111111111&country=BE");

test("Google targeting authorizes Premium Google access before any account/provider lookup", async () => {
  const denied = Response.json({ error: "forbidden" }, { status: 403 });
  const { get, calls } = routeHarness({ auth: { user: null, errorResponse: denied } });
  assert.equal(await get(request()), denied);
  assert.deepEqual(calls, [{ name: "auth", args: ["google"] }]);
});

test("Google targeting uses only the stored accessible account and the official read-only suggestion service", async () => {
  const { get, calls } = routeHarness();
  const response = await get(request());
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("cache-control"), "no-store");
  assert.deepEqual(await response.json(), { options: [{ id: "100001", name: "Lille", canonicalName: "Lille,Hauts-de-France,France", country: "FR" }], selectedAccountId: "1234567890" });
  assert.deepEqual(calls.find((call) => call.name === "integration")?.args, ["user-one", "google"]);
  assert.deepEqual(calls.find((call) => call.name === "accounts")?.args, ["user-one", "google"]);
  assert.deepEqual(calls.find((call) => call.name === "google")?.args, ["user-one", "geoTargetConstants:suggest", { locale: "fr", locationNames: { names: ["Lille"] } }, "9876543210"]);
});

test("Google targeting rejects disconnected or inaccessible accounts without a geographic query", async () => {
  for (const overrides of [
    { integration: null }, { integration: { status: "needs_update", resource_id: "1234567890" } },
    { integration: { status: "connected", resource_id: "" } },
    { accounts: [{ ...account, id: "1111111111" }] }, { accounts: [{ ...account, currency: "USD" }] },
  ]) {
    const { get, calls } = routeHarness(overrides);
    assert.ok([403, 409].includes((await get(request())).status));
    assert.equal(calls.some((call) => call.name === "google"), false);
  }
});

test("Google targeting rejects invalid queries and rate limits before provider calls", async () => {
  for (const query of ["", "a", "x".repeat(121)]) {
    const { get, calls } = routeHarness();
    assert.equal((await get(new Request(`https://app.example/api/ads/google/targeting?query=${query}`))).status, 400);
    assert.equal(calls.some((call) => call.name === "accounts"), false);
  }
  const { get, calls } = routeHarness({ limited: Response.json({ error: "slow down" }, { status: 429 }) });
  assert.equal((await get(request())).status, 429);
  assert.equal(calls.some((call) => call.name === "integration"), false);
});

test("Google targeting hides provider exception details", async () => {
  for (const failure of [new Error("Bearer SECRET"), new GoogleAdsApiError("Bearer SECRET", 403)]) {
    const { get } = routeHarness({ failure });
    const response = await get(request());
    assert.ok([403, 503].includes(response.status));
    assert.doesNotMatch(await response.text(), /SECRET|Bearer/);
  }
});

test("the Google studio persists a canonical label only after an explicit suggestion choice", () => {
  const client = readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8");
  const search = client.slice(client.indexOf("function GoogleLocationSearch("), client.indexOf("function GoogleAdCopyField("));
  assert.match(search, /\/api\/ads\/google\/targeting\?query=/);
  assert.match(search, /response\.selectedAccountId !== accountId/);
  assert.match(search, /requestId !== requestRef\.current/);
  assert.match(search, /onClick=\{\(\) => onChange\(selectGoogleTargetLocation\(locations, option\)\)\}/);
  assert.match(search, /option\.canonicalName/);
  assert.doesNotMatch(search, /onChange\(response|onChange\(options/);
  assert.match(client, /channelId === "google" && <GoogleLocationSearch/);
});
