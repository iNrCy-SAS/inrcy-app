import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import nodeCrypto from "node:crypto";
import ts from "typescript";
import * as policy from "../lib/adsTikTokPolicy.ts";
import * as security from "../lib/security.ts";
import { validateTikTokAdsEnv } from "../scripts/verify-tiktok-ads-env-core.mjs";

const appId = "12345678901234567", redirectUri = "https://app.example/api/ads/tiktok/callback";
const binding = { appId, redirectUri };
const generated = "https://business-api.tiktok.com/portal/auth?" + new URLSearchParams({
  app_id: appId, redirect_uri: redirectUri, rid: "official-generated-marker", state: "old-state",
});
const owner = "11111111-1111-4111-8111-111111111111", auth = "22222222-2222-4222-8222-222222222222";
const env = (patch: Record<string, string | undefined> = {}) => ({
  NEXT_PUBLIC_APP_URL: "https://app.example", TIKTOK_ADS_APP_ID: appId, TIKTOK_ADS_SECRET: "fixture-secret",
  TIKTOK_ADS_AUTHORIZATION_URL: generated, TIKTOK_ADS_REDIRECT_URI: redirectUri,
  INRCY_CREDENTIALS_SECRET: Buffer.alloc(32, 7).toString("base64"), ...patch,
});
function load<T>(file: string, modules: Record<string, unknown>, variables = env(), fetchImpl: typeof fetch = (async () => { throw new Error("Unmocked network call prohibited"); }) as typeof fetch): T {
  const loaded = { exports: {} as T };
  const output = ts.transpileModule(readFileSync(new URL("../" + file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("module", "exports", "require", "process", "fetch", output)(loaded, loaded.exports, (name: string) => {
    assert.ok(Object.hasOwn(modules, name), "Unexpected module " + name); return modules[name];
  }, { env: variables }, fetchImpl);
  return loaded.exports;
}
type Server = typeof import("../lib/adsTikTokServer.ts");
type Route = { GET: (request: Request) => Promise<Response> };
const next = { NextResponse: {
  json: (body: unknown, options?: ResponseInit) => Response.json(body, options),
  redirect: (url: URL) => Object.assign(new Response(null, { status: 307, headers: { Location: String(url) } }), {
    cookies: { set: () => {} },
  }),
} };
function serverConfiguration(variables = env()) {
  return load<Server>("lib/adsTikTokServer.ts", {
    "server-only": {}, "@/lib/supabaseAdmin": {},
    "@/lib/oauthCrypto": {}, "@/lib/adsTikTokPolicy": policy,
  }, variables).tikTokAdsOAuthConfiguration;
}
function startRoute(variables = env(), denied = false) {
  let states = 0;
  const route = load<Route>("app/api/ads/tiktok/start/route.ts", {
    "next/server": next,
    "@/lib/adsServer": { requirePremiumAdsUser: async (channel: string) => {
      assert.equal(channel, "tiktok"); return denied ? { user: null, errorResponse: Response.json({}, { status: 403 }) } : { user: { activeUserId: owner, authUserId: auth }, errorResponse: null };
    } },
    "@/lib/adsTikTokServer": { tikTokAdsOAuthConfiguration: serverConfiguration(variables) },
    "@/lib/adsTikTokPolicy": policy,
    "@/lib/security": { makeOAuthState: (...args: Parameters<typeof security.makeOAuthState>) => { states++; return security.makeOAuthState(...args); } },
  }, variables);
  return { route, states: () => states };
}

test("the official advertiser URL retains generated parameters and replaces state after exact binding", () => {
  const url = policy.tikTokAdsAuthorizeUrl(generated, "new-state", binding);
  assert.ok(url); assert.equal(url.searchParams.get("app_id"), appId);
  assert.equal(url.searchParams.get("redirect_uri"), redirectUri);
  assert.equal(url.searchParams.get("rid"), "official-generated-marker");
  assert.deepEqual(url.searchParams.getAll("state"), ["new-state"]);
  assert.ok(policy.tikTokAdsAuthorizeUrl(generated.replace("redirect_uri=", "redirect_url="), "state", binding));
});
test("mismatched, missing and duplicated OAuth parameters are rejected without rewriting the destination", () => {
  for (const [name, value] of [["app_id", "987654321"], ["redirect_uri", "https://elsewhere.example/api/ads/tiktok/callback"]]) {
    const changed = new URL(generated); changed.searchParams.set(name, value);
    assert.equal(policy.tikTokAdsAuthorizeUrl(String(changed), "state", binding), null);
  }
  for (const name of ["app_id", "redirect_uri"]) {
    const missing = new URL(generated); missing.searchParams.delete(name);
    assert.equal(policy.tikTokAdsAuthorizeUrl(String(missing), "state", binding), null);
    const duplicate = new URL(generated); duplicate.searchParams.append(name, duplicate.searchParams.get(name)!);
    assert.equal(policy.tikTokAdsAuthorizeUrl(String(duplicate), "state", binding), null);
  }
  const aliases = new URL(generated); aliases.searchParams.set("redirect_url", redirectUri);
  assert.equal(policy.tikTokAdsAuthorizeUrl(String(aliases), "state", binding), null);
});
test("authorization URL credentials, fragments, ports and deceptive hosts are rejected", () => {
  for (const url of [generated.replace("https:", "http:"), generated.replace("business-api.tiktok.com", "business-api.tiktok.com.evil.example"),
    generated.replace("business-api.tiktok.com", "user:password@business-api.tiktok.com"),
    generated.replace("business-api.tiktok.com", "business-api.tiktok.com:8443"), generated + "#fragment"]) {
    assert.equal(policy.tikTokAdsAuthorizeUrl(url, "state", binding), null);
  }
});
test("only the dedicated same-origin callback is accepted, with localhost HTTP limited to development", () => {
  assert.ok(policy.tikTokAdsCallbackUrl(redirectUri, "https://app.example"));
  assert.ok(policy.tikTokAdsCallbackUrl("http://localhost:3000/api/ads/tiktok/callback", "http://localhost:3000"));
  for (const url of [redirectUri.replace("https:", "http:"), redirectUri + "?code=x", redirectUri + "#fragment",
    redirectUri.replace("/api/ads/", "/api/integrations/"), redirectUri.replace("app.example", "user:password@app.example")]) {
    assert.equal(policy.tikTokAdsCallbackUrl(url), null);
  }
  assert.equal(policy.tikTokAdsCallbackUrl(redirectUri, "https://preview.example"), null);
});
test("start checks configuration and channel access before generating OAuth state", async () => {
  for (const patch of [{ TIKTOK_ADS_APP_ID: "wrong" }, { TIKTOK_ADS_SECRET: " " },
    { INRCY_CREDENTIALS_SECRET: "invalid" },
    { TIKTOK_ADS_AUTHORIZATION_URL: generated.replace(appId, "987654321") },
    { TIKTOK_ADS_REDIRECT_URI: "https://elsewhere.example/api/ads/tiktok/callback" }]) {
    const h = startRoute(env(patch)); const result = await h.route.GET(new Request("https://app.example/api/ads/tiktok/start"));
    assert.equal(result.status, 503); assert.equal(h.states(), 0);
    assert.doesNotMatch(await result.text(), /fixture-secret|official-generated-marker/);
  }
  const denied = startRoute(env(), true); assert.equal((await denied.route.GET(new Request("https://app.example/api/ads/tiktok/start"))).status, 403);
  assert.equal(denied.states(), 0);
});
test("valid start binds the application, callback, authenticated user and establishment into protected state", async () => {
  const h = startRoute(); const result = await h.route.GET(new Request("https://app.example/api/ads/tiktok/start"));
  assert.equal(result.status, 307); const url = new URL(result.headers.get("Location")!);
  assert.equal(url.searchParams.get("rid"), "official-generated-marker");
  const state = security.b64urlJsonDecode<Record<string, unknown>>(url.searchParams.get("state")!);
  assert.equal(state?.appId, appId); assert.equal(state?.redirectUri, redirectUri);
  assert.equal(state?.accountId, owner); assert.equal(state?.authUserId, auth);
  assert.equal(h.states(), 1); assert.doesNotMatch(url.toString(), /fixture-secret/);
});
function callbackRoute(variables = env(), options: { invalidState?: boolean; authUser?: string; pilot?: boolean } = {}) {
  let exchanges = 0; const saves: string[] = [];
  const state = security.makeOAuthState("ads_tiktok", "/dashboard/ads?channel=tiktok", { accountId: owner, authUserId: auth, ...binding });
  const route = load<Route>("app/api/ads/tiktok/callback/route.ts", {
    "next/server": next, "@/lib/security": security,
    "@/lib/supabaseServer": { createSupabaseServer: async () => ({ auth: { getUser: async () => ({ data: { user: { id: options.authUser || auth } }, error: null }) } }) },
    "@/lib/multicompte/server": { resolveOAuthBoundInrcyAccountId: async (_db: unknown, identity: string, account: string) => { assert.equal(identity, auth); assert.equal(account, owner); return owner; } },
    "@/lib/adsServer": { isAdsPilotAdmin: async () => options.pilot !== false },
    "@/lib/adsTikTokServer": { tikTokAdsOAuthConfiguration: serverConfiguration(variables),
      tikTokAdsReturnUrl: (requestUrl: string, result: string, reason?: string) => { const url = new URL("/dashboard/ads", requestUrl); url.searchParams.set("connection", result); if (reason) url.searchParams.set("reason", reason); return url; },
      exchangeTikTokAdsCode: async (code: string) => { assert.equal(code, "fixture-code"); exchanges++; return { access_token: "fixture-token" }; },
      saveTikTokAdsConnection: async (account: string) => { saves.push(account); }, TikTokAdsConnectionError: class extends Error {} },
  }, variables);
  const request = new Request(redirectUri + "?" + new URLSearchParams({ state: state.stateB64, auth_code: "fixture-code" }), {
    headers: { cookie: state.cookieName + "=" + encodeURIComponent(options.invalidState ? "bad" : state.cookieValue) },
  });
  return { route, request, exchanges: () => exchanges, saves };
}
test("a configuration change during OAuth is rejected before token exchange or storage", async () => {
  const changed = "98765432109876543";
  const h = callbackRoute(env({ TIKTOK_ADS_APP_ID: changed, TIKTOK_ADS_AUTHORIZATION_URL: generated.replace(appId, changed) }));
  const result = await h.route.GET(h.request);
  assert.equal(new URL(result.headers.get("Location")!).searchParams.get("reason"), "oauth_configuration_changed");
  assert.equal(h.exchanges(), 0); assert.deepEqual(h.saves, []);
});
test("invalid state, changed authentication or non-pilot access cannot exchange or store a token", async () => {
  for (const options of [{ invalidState: true }, { authUser: "another-user" }, { pilot: false }]) {
    const h = callbackRoute(env(), options); const result = await h.route.GET(h.request);
    assert.equal(new URL(result.headers.get("Location")!).searchParams.get("connection"), "error");
    assert.equal(h.exchanges(), 0); assert.deepEqual(h.saves, []);
  }
});
test("valid callback exchanges once and stores only under the establishment bound at start", async () => {
  const h = callbackRoute(); const result = await h.route.GET(h.request);
  assert.equal(new URL(result.headers.get("Location")!).searchParams.get("connection"), "connected");
  assert.equal(h.exchanges(), 1); assert.deepEqual(h.saves, [owner]);
  assert.doesNotMatch(result.headers.get("Location")!, /fixture-code|fixture-token|fixture-secret/);
});
test("status shares the same OAuth configuration validation without contacting the provider", async () => {
  for (const mismatch of [false, true]) {
    const variables = env(mismatch ? { TIKTOK_ADS_AUTHORIZATION_URL: generated.replace(appId, "987654321") } : {});
    const route = load<Route>("app/api/ads/tiktok/status/route.ts", {
      "next/server": next, "@/lib/adsServer": { requirePremiumAdsUser: async () => ({ user: { activeUserId: owner }, errorResponse: null }) },
      "@/lib/adsTikTokServer": { tikTokAdsOAuthConfiguration: serverConfiguration(variables), readTikTokAdsIntegration: async () => ({
        status: "connected", access_token_enc: "encrypted", expires_at: null, refresh_token_enc: null,
        meta: { token_lifecycle: "long_lived" }, resource_id: "123456789" }) },
      "@/lib/adsTikTokPolicy": policy,
    }, variables);
    const result = await route.GET(new Request("https://app.example/api/ads/tiktok/status"));
    const body = await result.json(); assert.equal(body.configured, !mismatch); assert.equal(body.connected, !mismatch);
    assert.equal(body.publicationEnabled, false); assert.doesNotMatch(JSON.stringify(body), /fixture-secret|encrypted|official-generated-marker/);
  }
});
test("the environment verifier accepts a coherent isolated configuration and never exposes its values", () => {
  const result = validateTikTokAdsEnv(env()); assert.equal(result.ok, true); assert.equal(result.details.publicationEnabled, false);
  assert.doesNotMatch(JSON.stringify(result), /fixture-secret|official-generated-marker|12345678901234567/);
  const invalid = validateTikTokAdsEnv(env({ NEXT_PUBLIC_TIKTOK_ADS_SECRET: "must-never-be-printed", TIKTOK_ADS_SECRET: "", TIKTOK_ADS_AUTHORIZATION_URL: generated.replace(appId, "987654321") }));
  assert.equal(invalid.ok, false); assert.ok(invalid.errors.some((error: string) => error.includes("TIKTOK_ADS_SECRET")));
  assert.doesNotMatch(JSON.stringify(invalid), /must-never-be-printed|fixture-secret|987654321/);
});
test("the environment verifier rejects organic or off-origin callbacks and unusable encryption keys", () => {
  for (const patch of [{ TIKTOK_ADS_REDIRECT_URI: "https://app.example/api/integrations/tiktok/callback" },
    { NEXT_PUBLIC_APP_URL: "https://preview.example" }, { INRCY_CREDENTIALS_SECRET: "invalid" },
    { TIKTOK_REDIRECT_URI: redirectUri }]) assert.equal(validateTikTokAdsEnv(env(patch)).ok, false);
});

function actualServer(fetchImpl: typeof fetch) {
  const writes: Array<{ payload: Record<string, unknown>; conflict: unknown }> = [], filters: Array<[string, unknown]> = [];
  const encrypted: string[] = [];
  const query = { select() { return this; }, eq(column: string, value: unknown) { filters.push([column, value]); return this; },
    maybeSingle: async () => ({ data: null, error: null }),
    upsert: async (payload: Record<string, unknown>, options: unknown) => { writes.push({ payload, conflict: options }); return { error: null }; } };
  const api = load<Server>("lib/adsTikTokServer.ts", { "server-only": {},
    "@/lib/supabaseAdmin": { supabaseAdmin: { from: (table: string) => { assert.equal(table, "integrations"); return query; } } },
    "@/lib/oauthCrypto": { encryptToken: (value: string) => { encrypted.push(value); return "cipher:" + value; } },
    "@/lib/adsTikTokPolicy": policy,
  }, env(), fetchImpl);
  return { api, writes, filters, encrypted };
}
test("the real code exchange posts only fixture credentials to TikTok and accepts its successful envelope", async () => {
  const calls: Array<{ url: string; init?: RequestInit }> = [];
  const h = actualServer((async (input, init) => { calls.push({ url: String(input), init }); return Response.json({ code: 0, data: { access_token: "fixture-access" } }); }) as typeof fetch);
  const token = await h.api.exchangeTikTokAdsCode("fixture-code"); assert.equal(token.access_token, "fixture-access");
  assert.equal(calls.length, 1); assert.equal(calls[0].url, "https://business-api.tiktok.com/open_api/v1.3/oauth2/access_token/");
  assert.equal(calls[0].init?.method, "POST"); assert.equal(calls[0].init?.cache, "no-store");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)), { app_id: appId, secret: "fixture-secret", auth_code: "fixture-code" });
  assert.deepEqual(h.writes, []);
});
test("HTTP 200 OAuth errors or a missing token never expose provider messages or persist a connection", async () => {
  for (const payload of [{ code: 401, message: "fixture-secret private-details" }, { code: 0, data: {} }]) {
    const h = actualServer((async () => Response.json(payload)) as typeof fetch);
    await assert.rejects(h.api.exchangeTikTokAdsCode("fixture-code"), (error: unknown) => {
      assert.ok(error instanceof Error); assert.doesNotMatch(error.message, /fixture-secret|private-details/); return true;
    });
    assert.deepEqual(h.writes, []);
  }
});
test("connection save verifies accessible advertisers and encrypts both tokens in the ads-only row", async () => {
  const calls: string[] = [];
  const h = actualServer((async (input, init) => {
    const url = new URL(String(input)); calls.push(url.pathname); assert.equal(new Headers(init?.headers).get("Access-Token"), "fixture-access");
    assert.equal(init?.method || "GET", "GET");
    if (url.pathname.endsWith("/oauth2/advertiser/get/")) return Response.json({ code: 0, data: { advertiser_ids: ["123456789"] } });
    assert.ok(url.pathname.endsWith("/advertiser/info/"));
    assert.deepEqual(JSON.parse(url.searchParams.get("advertiser_ids")!), ["123456789"]);
    return Response.json({ code: 0, data: { list: [{ advertiser_id: "123456789", name: "Fixture", currency: "EUR", status: "STATUS_ENABLE" }] } });
  }) as typeof fetch);
  await h.api.saveTikTokAdsConnection(owner, { access_token: "fixture-access", refresh_token: "fixture-refresh", expires_in: 3600 });
  assert.equal(h.writes.length, 1); const saved = h.writes[0].payload;
  assert.equal(saved.user_id, owner); assert.equal(saved.provider, "tiktok"); assert.equal(saved.source, "tiktok_ads"); assert.equal(saved.product, "ads");
  assert.equal(saved.access_token_enc, "cipher:fixture-access"); assert.equal(saved.refresh_token_enc, "cipher:fixture-refresh");
  assert.deepEqual(h.writes[0].conflict, { onConflict: "user_id,provider,source,product" });
  assert.deepEqual(h.encrypted, ["fixture-access", "fixture-refresh"]);
  assert.ok(h.filters.some(([field, value]) => field === "user_id" && value === owner));
  assert.ok(h.filters.some(([field, value]) => field === "source" && value === "tiktok_ads"));
  assert.ok(h.filters.some(([field, value]) => field === "product" && value === "ads"));
  assert.deepEqual(calls, ["/open_api/v1.3/oauth2/advertiser/get/", "/open_api/v1.3/advertiser/info/"]);
});
test("an authorization without advertiser access cannot persist a connected row", async () => {
  const h = actualServer((async () => Response.json({ code: 0, data: { advertiser_ids: [] } })) as typeof fetch);
  await assert.rejects(h.api.saveTikTokAdsConnection(owner, { access_token: "fixture-access" }), (error: unknown) => {
    assert.ok(error instanceof Error); assert.match(error.message, /Aucun compte/); return true;
  });
  assert.deepEqual(h.writes, []); assert.deepEqual(h.encrypted, []);
});

test("AES-GCM storage round-trips a fixture and rejects a modified ciphertext or missing key", () => {
  type CryptoApi = typeof import("../lib/oauthCrypto.ts");
  const crypto = load<CryptoApi>("lib/oauthCrypto.ts", { "server-only": {}, crypto: { default: nodeCrypto } });
  const cipher = crypto.encryptToken("fixture-access");
  assert.notEqual(cipher, "fixture-access"); assert.equal(crypto.decryptToken(cipher), "fixture-access");
  const changed = Buffer.from(cipher, "base64"); changed[changed.length - 1] ^= 1;
  assert.throws(() => crypto.decryptToken(changed.toString("base64")));
  const missing = load<CryptoApi>("lib/oauthCrypto.ts", { "server-only": {}, crypto: { default: nodeCrypto } }, env({ INRCY_CREDENTIALS_SECRET: undefined }));
  assert.throws(() => missing.encryptToken("fixture-access"), /Missing INRCY_CREDENTIALS_SECRET/);
});
