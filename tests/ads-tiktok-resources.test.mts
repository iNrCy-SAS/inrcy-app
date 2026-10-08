import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as policy from "../lib/adsTikTokPolicy.ts";
import * as resourcePolicy from "../lib/adsTikTokResources.ts";

type Api = typeof import("../lib/adsTikTokResourcesServer.ts");
class ConnectionError extends Error { code: string; status: number; constructor(message: string, code: string, status = 503) { super(message); this.code = code; this.status = status; } }
const accountId = "1234567890123";
const now = Date.parse("2026-10-08T10:00:00Z");
function runtime(options: { driftAt?: number; driftField?: string; expired?: boolean; longLived?: boolean; notAuthorized?: boolean; account?: Record<string, unknown>; identityFailure?: number; malformedIdentities?: boolean; endless?: boolean } = {}) {
  const calls: Array<{ path: string; method: string; params: URLSearchParams; headers: Headers }> = [];
  let reads = 0, decrypts = 0;
  const integration = { id: "integration", status: "connected", resource_id: accountId, resource_label: "Compte sauvegardé", access_token_enc: "cipher", refresh_token_enc: options.longLived ? null : "refresh-cipher", expires_at: options.longLived ? null : options.expired ? "2026-10-08T09:00:00Z" : "2026-10-09T10:00:00Z", meta: { token_lifecycle: options.longLived ? "long_lived" : "timed" } };
  const loaded = { exports: {} as Api };
  const modules = new Map<string, unknown>([["server-only", {}], ["./oauthCrypto.ts", {}], ["./adsTikTokServer.ts", { TikTokAdsConnectionError: ConnectionError }], ["./adsTikTokPolicy.ts", policy], ["./adsTikTokResources.ts", resourcePolicy]]);
  const output = ts.transpileModule(readFileSync(new URL("../lib/adsTikTokResourcesServer.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  new Function("module", "exports", "require", output)(loaded, loaded.exports, (name: string) => { assert.ok(modules.has(name), name); return modules.get(name); });
  const dependencies = {
    readIntegration: async (owner: string) => { assert.equal(owner, "owner"); reads++; return options.driftAt && reads >= options.driftAt ? { ...integration, [options.driftField || "resource_id"]: "changed" } : integration; },
    decrypt: (ciphertext: string) => { assert.equal(ciphertext, "cipher"); decrypts++; return "private-access-token"; },
    appId: "private-app-id", secret: "private-app-secret", now: () => now,
    fetchImpl: (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input)), path = url.pathname.replace("/open_api/v1.3/", "");
      calls.push({ path, method: init?.method || "GET", params: url.searchParams, headers: new Headers(init?.headers) });
      assert.equal(init?.method, "GET"); assert.equal(init?.body, undefined); assert.equal(url.origin, "https://business-api.tiktok.com");
      assert.equal(new Headers(init?.headers).get("Access-Token"), "private-access-token");
      if (path === "oauth2/advertiser/get/") return Response.json({ code: 0, data: { advertiser_ids: [options.notAuthorized ? "987654321" : accountId] } });
      if (path === "advertiser/info/") {
        assert.deepEqual(JSON.parse(url.searchParams.get("advertiser_ids")!), [accountId]);
        return Response.json({ code: 0, data: { list: [{ advertiser_id: accountId, name: "Annonceur", currency: "EUR", status: "STATUS_ENABLE", timezone: "Europe/Paris", secret: "private-provider-account-data", ...options.account }] } });
      }
      if (path === "identity/get/") {
        assert.equal(url.searchParams.get("advertiser_id"), accountId);
        assert.equal(url.searchParams.has("identity_type"), false);
        if (options.identityFailure) return Response.json({ code: 900, message: "private-token private-app-secret" }, { status: options.identityFailure });
        if (options.malformedIdentities) return Response.json({ code: 0, data: { identity_list: [{ identity_id: "fake", identity_type: "UNKNOWN" }] } });
        const page = Number(url.searchParams.get("page"));
        return Response.json({ code: 0, data: { identity_list: [{ identity_id: `identity-${page}`, identity_type: page === 1 ? "TT_USER" : "BC_AUTH_TT", display_name: `Identité ${page}`, ...(page > 1 ? { identity_authorized_bc_id: "123456789" } : {}), profile_image: "https://private.example/signed", access_token: "private-token" }], page_info: { total_page: options.endless ? 11 : 2 } } });
      }
      throw new Error("Unexpected provider call " + path);
    }) as typeof fetch,
  };
  return { api: loaded.exports, dependencies, calls, reads: () => reads, decrypts: () => decrypts };
}

test("TikTok resources verify the current advertiser and paginate existing identities without enabling publication", async () => {
  const { api, dependencies, calls } = runtime();
  const result = await api.readTikTokAdsResources("owner", accountId, dependencies);
  assert.equal(result.selectedAccountId, accountId); assert.equal(result.account.timezone, "Europe/Paris");
  assert.deepEqual(result.identities, [{ id: "identity-1", type: "TT_USER", displayName: "Identité 1" }, { id: "identity-2", type: "BC_AUTH_TT", displayName: "Identité 2", authorizedBusinessCenterId: "123456789" }]);
  assert.equal(result.identityRead.status, "verified"); assert.equal(result.publicationEnabled, false); assert.equal(result.readiness.publicationReady, false);
  assert.equal(result.readiness.campaignWrite, "unverified"); assert.ok(result.readiness.blockers.includes("campaign_write_unverified"));
  assert.deepEqual(calls.map((call) => call.path), ["oauth2/advertiser/get/", "advertiser/info/", "identity/get/", "identity/get/"]);
  assert.doesNotMatch(JSON.stringify(result), /private-|cipher|access_token|refresh|profile_image|request_id|secret/);
});

test("TikTok resource GET performs no refresh, storage mutation or advertiser reads when the token is expired", async () => {
  const { api, dependencies, calls, decrypts } = runtime({ expired: true });
  await assert.rejects(api.readTikTokAdsResources("owner", accountId, dependencies), (error: unknown) => error instanceof ConnectionError && error.code === "needs_reconnect");
  assert.equal(calls.length, 0); assert.equal(decrypts(), 0);
  const longLived = runtime({ longLived: true }); assert.equal((await longLived.api.readTikTokAdsResources("owner", accountId, longLived.dependencies)).account.id, accountId);
});

test("TikTok resource ownership rejects wrong account, removed authorization and account/token drift", async () => {
  const wrong = runtime(); await assert.rejects(wrong.api.readTikTokAdsResources("owner", "987654321", wrong.dependencies), /compte/); assert.equal(wrong.calls.length, 0);
  const removed = runtime({ notAuthorized: true }); await assert.rejects(removed.api.readTikTokAdsResources("owner", accountId, removed.dependencies), /autorisé/); assert.equal(removed.calls.length, 1);
  for (const driftAt of [2, 3, 4, 5, 6]) for (const driftField of ["resource_id", "access_token_enc", "status", "id"]) {
    const changed = runtime({ driftAt, driftField });
    await assert.rejects(changed.api.readTikTokAdsResources("owner", accountId, changed.dependencies), (error: unknown) => error instanceof ConnectionError && error.code === "account_mismatch");
  }
});

test("TikTok resource account must be accessible, enabled and EUR; timezone is never guessed", async () => {
  for (const account of [{ currency: "USD" }, { status: "STATUS_DISABLE" }, { advertiser_id: "987654321" }]) {
    const sample = runtime({ account }); await assert.rejects(sample.api.readTikTokAdsResources("owner", accountId, sample.dependencies), /compte/);
    assert.equal(sample.calls.filter((call) => call.path === "identity/get/").length, 0);
  }
  const unknown = runtime({ account: { timezone: "UTC+01:00" } });
  const result = await unknown.api.readTikTokAdsResources("owner", accountId, unknown.dependencies);
  assert.equal(result.account.timezone, null); assert.ok(result.readiness.blockers.includes("account_timezone_unverified"));
});

test("identity-specific read rejection remains explicit without inventing identities or write approval", async () => {
  for (const options of [{ identityFailure: 403 }, { identityFailure: 429 }, { malformedIdentities: true }, { endless: true }]) {
    const sample = runtime(options), result = await sample.api.readTikTokAdsResources("owner", accountId, sample.dependencies);
    assert.equal(result.identityRead.status, "unavailable"); assert.deepEqual(result.identities, []);
    assert.ok(result.readiness.blockers.includes("identity_read_unavailable")); assert.equal(result.readiness.campaignWrite, "unverified");
    assert.doesNotMatch(JSON.stringify(result), /private-token|private-app-secret/);
  }
  const rejectedToken = runtime({ identityFailure: 401 });
  await assert.rejects(rejectedToken.api.readTikTokAdsResources("owner", accountId, rejectedToken.dependencies), (error: unknown) => error instanceof ConnectionError && error.code === "needs_reconnect");
});

test("TikTok identity projection rejects unknown types, unsafe IDs and unbound Business Center identities", () => {
  for (const row of [{ identity_id: "../../bad", identity_type: "TT_USER" }, { identity_id: "user", identity_type: "FAKE" }, { identity_id: "user", identity_type: "BC_AUTH_TT" }]) {
    assert.equal(resourcePolicy.parseTikTokAdsIdentities({ data: { list: [row] } }), null);
  }
  assert.deepEqual(resourcePolicy.parseTikTokAdsIdentities({ data: { list: [] } }), []);
  assert.equal(resourcePolicy.parseTikTokAdsIdentities({ data: {} }), null);
});

test("TikTok resource consent ignores time/order and changes for account, timezone, identity or read evidence", async () => {
  const sample = runtime(), resources = await sample.api.readTikTokAdsResources("owner", accountId, sample.dependencies);
  const key = resourcePolicy.tikTokAdsResourcesConsentKey(resources);
  assert.equal(key, resourcePolicy.tikTokAdsResourcesConsentKey({ ...resources, verifiedAt: "later", identities: [...resources.identities].reverse(), readiness: { ...resources.readiness, blockers: [...resources.readiness.blockers].reverse() } }));
  for (const next of [{ ...resources, account: { ...resources.account, timezone: "UTC" } }, { ...resources, identities: [] }, { ...resources, identityRead: { status: "unavailable" as const, code: "ads_access_denied" } }]) assert.notEqual(key, resourcePolicy.tikTokAdsResourcesConsentKey(next));
  assert.equal(resourcePolicy.tikTokAdsResourcesConsentKey({ ...resources, selectedAccountId: "987654321" }), null);
});

test("TikTok resources route is owner-scoped, rate-limited and cannot publish or expose credentials", () => {
  const route = readFileSync(new URL("../app/api/ads/tiktok/resources/route.ts", import.meta.url), "utf8");
  assert.match(route, /requirePremiumAdsUser\("tiktok"\)/); assert.match(route, /user\.activeUserId/); assert.match(route, /enforceRateLimit/); assert.match(route, /Cache-Control.*no-store/);
  assert.doesNotMatch(route, /export async function POST|access_token_enc|refresh_token_enc|process\.env|request\.json/);
  const server = readFileSync(new URL("../lib/adsTikTokResourcesServer.ts", import.meta.url), "utf8");
  assert.doesNotMatch(server, /method: "POST"|\.upsert\(|\.update\(|tikTokAdsAccessToken\(/);
});
