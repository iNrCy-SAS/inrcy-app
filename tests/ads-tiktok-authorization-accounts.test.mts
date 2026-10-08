import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as policy from "../lib/adsTikTokPolicy.ts";

type Server = typeof import("../lib/adsTikTokServer.ts");
const advertiserId = "1234567890123456789";

test("official authorized advertisers distinguish a genuinely empty list from an invalid response", () => {
  assert.deepEqual(policy.parseTikTokAdvertiserAuthorization({ code: 0, data: { list: [
    { advertiser_id: advertiserId, advertiser_name: "Annonceur de test" },
    { advertiser_id: advertiserId, advertiser_name: "Même annonceur" },
  ] } }), [advertiserId]);
  assert.deepEqual(policy.parseTikTokAdvertiserAuthorization({ code: 0, data: { list: [] } }), []);
  assert.deepEqual(policy.parseTikTokAdvertiserAuthorization({ code: 0, data: { advertiser_ids: [advertiserId] } }), [advertiserId]);
  for (const value of [null, {}, { code: 0 }, { code: 0, data: {} }, { code: 0, data: [] },
    { code: 0, data: { list: null } }, { code: 0, data: { list: {}, advertiser_ids: [advertiserId] } },
    { code: 40100, data: { list: [{ advertiser_id: advertiserId }] } },
    { code: 0, data: { list: [{}] } }, { code: 0, data: { list: [{ advertiser_id: "../../bad" }] } },
    { code: 0, data: { list: [{ advertiser_id: 9007199254740992 }] } },
    { code: 0, data: { list: [{ advertiser_id: advertiserId }, { advertiser_id: "invalid" }] } }]) {
    assert.equal(policy.parseTikTokAdvertiserAuthorization(value), null);
  }
});

function runtime(authorized: unknown, httpStatus = 200) {
  const calls: Array<{ path: string; method: string }> = [];
  const saved: Array<Record<string, unknown>> = [];
  let reads = 0;
  const query = {
    select: () => query,
    eq: () => query,
    maybeSingle: async () => { reads++; return { data: null, error: null }; },
    upsert: async (row: Record<string, unknown>, options: { onConflict: string }) => {
      assert.equal(options.onConflict, "user_id,provider,source,product");
      saved.push(row); return { error: null };
    },
  };
  const modules: Record<string, unknown> = {
    "server-only": {},
    "@/lib/supabaseAdmin": { supabaseAdmin: { from: (table: string) => { assert.equal(table, "integrations"); return query; } } },
    "@/lib/oauthCrypto": { encryptToken: (token: string) => { assert.equal(token, "fixture-access-token"); return "fixture-ciphertext"; } },
    "@/lib/adsTikTokPolicy": policy,
  };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://business-api.tiktok.com");
    const path = url.pathname.replace("/open_api/v1.3/", "");
    calls.push({ path, method: init?.method || "GET" });
    assert.equal(init?.body, undefined);
    assert.equal(new Headers(init?.headers).get("Access-Token"), "fixture-access-token");
    if (path === "oauth2/advertiser/get/") {
      assert.equal(url.searchParams.get("app_id"), "fixture-app-id");
      assert.equal(url.searchParams.get("secret"), "fixture-secret");
      return Response.json(authorized, { status: httpStatus });
    }
    if (path === "advertiser/info/") {
      assert.deepEqual(JSON.parse(url.searchParams.get("advertiser_ids")!), [advertiserId]);
      return Response.json({ code: 0, data: { list: [{ advertiser_id: advertiserId, name: "Annonceur de test", currency: "EUR", status: "STATUS_ENABLE" }] } });
    }
    throw new Error("Unmocked provider request prohibited");
  };
  const loaded = { exports: {} as Server };
  const output = ts.transpileModule(readFileSync(new URL("../lib/adsTikTokServer.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function("module", "exports", "require", "process", "fetch", output)(loaded, loaded.exports, (name: string) => {
    assert.ok(Object.hasOwn(modules, name), "Unexpected module " + name); return modules[name];
  }, { env: { TIKTOK_ADS_APP_ID: "fixture-app-id", TIKTOK_ADS_SECRET: "fixture-secret" } }, fetchImpl);
  return { api: loaded.exports, calls, saved, reads: () => reads };
}

test("empty native authorization stays disconnected even when the token advertised an account", async () => {
  const h = runtime({ code: 0, data: { list: [] } });
  await assert.rejects(h.api.saveTikTokAdsConnection("owner", {
    access_token: "fixture-access-token", advertiser_ids: [advertiserId],
  }), (error: unknown) => error instanceof h.api.TikTokAdsConnectionError && error.code === "ads_access_missing");
  assert.deepEqual(h.calls, [{ path: "oauth2/advertiser/get/", method: "GET" }]);
  assert.equal(h.reads(), 0); assert.deepEqual(h.saved, []);
});

test("incomplete or invalid native advertiser lists fail as provider_response_invalid before account lookup or storage", async () => {
  for (const authorized of [{ code: 0, data: {} }, { code: 0, data: { list: null } },
    { code: 0, data: { list: [{ advertiser_id: "bad" }] } },
    { code: 0, data: { list: [{ advertiser_id: advertiserId }, {}] } }]) {
    const h = runtime(authorized);
    await assert.rejects(h.api.saveTikTokAdsConnection("owner", { access_token: "fixture-access-token" }),
      (error: unknown) => error instanceof h.api.TikTokAdsConnectionError && error.code === "provider_response_invalid" && error.status === 502);
    assert.equal(h.calls.length, 1); assert.equal(h.reads(), 0); assert.deepEqual(h.saved, []);
  }
});

test("native provider errors are never misreported as an empty advertiser authorization", async () => {
  for (const [status, code] of [[200, 40001], [403, 40001]]) {
    const h = runtime({ code, message: "Provider error", data: { list: [] } }, status);
    await assert.rejects(h.api.saveTikTokAdsConnection("owner", { access_token: "fixture-access-token" }),
      (error: unknown) => error instanceof h.api.TikTokAdsConnectionError
        && error.code === (status === 403 ? "ads_access_denied" : "provider_unavailable"));
    assert.equal(h.calls.length, 1); assert.equal(h.reads(), 0); assert.deepEqual(h.saved, []);
  }
});

test("a verified official advertiser list stores only encrypted credentials under the Ads product", async () => {
  const h = runtime({ code: 0, data: { list: [{ advertiser_id: advertiserId, advertiser_name: "Annonceur de test" }] } });
  await h.api.saveTikTokAdsConnection("owner", { access_token: "fixture-access-token" });
  assert.deepEqual(h.calls, [{ path: "oauth2/advertiser/get/", method: "GET" }, { path: "advertiser/info/", method: "GET" }]);
  assert.equal(h.reads(), 1); assert.equal(h.saved.length, 1);
  assert.equal(h.saved[0].user_id, "owner"); assert.equal(h.saved[0].source, "tiktok_ads"); assert.equal(h.saved[0].product, "ads");
  assert.equal(h.saved[0].access_token_enc, "fixture-ciphertext"); assert.equal(h.saved[0].status, "connected");
  assert.equal(h.saved[0].resource_id, null);
  assert.doesNotMatch(JSON.stringify(h.saved), /fixture-access-token|fixture-secret/);
});
