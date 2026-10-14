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
function runtime(options: { driftAt?: number; driftField?: string; expired?: boolean; longLived?: boolean; notAuthorized?: boolean; account?: Record<string, unknown>; identityFailure?: number; malformedIdentities?: boolean; endless?: boolean; identityInfo?: Record<string, unknown>; identityInfoFailure?: number; noBusinessCenter?: boolean; mixedBusinessCenter?: boolean; foreignBusinessCenter?: boolean } = {}) {
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
        const type = url.searchParams.get("identity_type");
        if (options.identityFailure) return Response.json({ code: 900, message: "private-token private-app-secret" }, { status: options.identityFailure });
        if (options.malformedIdentities) return Response.json({ code: 0, data: { identity_list: [{ identity_id: "fake", identity_type: "UNKNOWN" }] } });
        if (type === null) {
          assert.equal(url.searchParams.has("page"), false); assert.equal(url.searchParams.has("page_size"), false);
          return Response.json({ code: 0, data: { identity_list: [{ identity_id: "identity-1", identity_type: "TT_USER" }, ...options.noBusinessCenter ? [] : [{ identity_id: "identity-2", identity_type: "BC_AUTH_TT", identity_authorized_bc_id: "123456789" }]] } });
        }
        assert.ok(type === "TT_USER" || type === "BC_AUTH_TT");
        assert.equal(url.searchParams.get("identity_authorized_bc_id"), type === "BC_AUTH_TT" ? "123456789" : null);
        const page = Number(url.searchParams.get("page"));
        const index = type === "TT_USER" ? 1 : 2;
        const rows = page === 1 || options.endless ? [{ identity_id: `identity-${index}`, identity_type: type, display_name: `Identité ${index}`, ...(type === "BC_AUTH_TT" ? { identity_authorized_bc_id: options.foreignBusinessCenter ? "987654321" : "123456789" } : {}), profile_image: "https://private.example/signed", access_token: "private-token" }] : [];
        if (type === "BC_AUTH_TT" && options.mixedBusinessCenter) rows.push({ identity_id: "other-tt-user", identity_type: "TT_USER", display_name: "Autre identité", profile_image: "https://private.example/signed", access_token: "private-token" }, { identity_id: "foreign-bc-profile", identity_type: "BC_AUTH_TT", display_name: "Autre BC", identity_authorized_bc_id: "987654321", profile_image: "https://private.example/signed", access_token: "private-token" });
        return Response.json({ code: 0, data: { identity_list: rows, page_info: { total_page: options.endless ? 11 : type === "TT_USER" ? 2 : 1 } } });
      }
      if (path === "identity/info/") {
        assert.equal(url.searchParams.get("advertiser_id"), accountId);
        const type = url.searchParams.get("identity_type");
        assert.equal(url.searchParams.get("identity_id"), type === "TT_USER" ? "identity-1" : "identity-2");
        assert.equal(url.searchParams.get("identity_authorized_bc_id"), type === "BC_AUTH_TT" ? "123456789" : null);
        if (options.identityInfoFailure && type === "BC_AUTH_TT") return Response.json({ code: 900, message: "private-token" }, { status: options.identityInfoFailure });
        return Response.json({ code: 0, data: { identity_info: { identity_id: url.searchParams.get("identity_id"), identity_type: type, ...(type === "BC_AUTH_TT" ? { identity_authorized_bc_id: "123456789" } : {}), available_status: "AVAILABLE", can_push_video: true, is_gpppa: false, ...options.identityInfo } } });
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
  assert.deepEqual(result.identities, [{ id: "identity-1", type: "TT_USER", displayName: "Identité 1", availableStatus: "AVAILABLE", canPushVideo: true, isGpppa: false }, { id: "identity-2", type: "BC_AUTH_TT", displayName: "Identité 2", authorizedBusinessCenterId: "123456789", availableStatus: "AVAILABLE", canPushVideo: true, isGpppa: false }]);
  assert.equal(result.identityRead.status, "verified"); assert.equal(result.publicationEnabled, false); assert.equal(result.readiness.publicationReady, false);
  assert.equal(result.readiness.campaignWrite, "unverified"); assert.ok(result.readiness.blockers.includes("campaign_write_unverified"));
  assert.deepEqual(calls.map((call) => call.path), ["oauth2/advertiser/get/", "advertiser/info/", "identity/get/", "identity/get/", "identity/get/", "identity/get/", "identity/info/", "identity/info/"]);
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
  for (const options of [{ identityFailure: 403 }, { identityFailure: 429 }, { malformedIdentities: true }, { endless: true }, { identityInfoFailure: 403 }]) {
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

test("Business Center pagination uses only native-discovered BC IDs and rejects unrelated rows", async () => {
  const mixed = runtime({ mixedBusinessCenter: true });
  const result = await mixed.api.readTikTokAdsResources("owner", accountId, mixed.dependencies);
  assert.equal(result.identityRead.status, "verified");
  assert.deepEqual(result.identities.map((identity) => identity.id), ["identity-1", "identity-2"]);
  const bcReads = mixed.calls.filter((call) => call.params.get("identity_type") === "BC_AUTH_TT");
  assert.ok(bcReads.length > 0); assert.ok(bcReads.every((call) => call.params.get("identity_authorized_bc_id") === "123456789"));
  assert.ok(!mixed.calls.some((call) => call.params.get("identity_id") === "foreign-bc-profile" || call.params.get("identity_id") === "other-tt-user"));
  const none = runtime({ noBusinessCenter: true }), noneResult = await none.api.readTikTokAdsResources("owner", accountId, none.dependencies);
  assert.deepEqual(noneResult.identities.map((identity) => identity.id), ["identity-1"]);
  assert.ok(!none.calls.some((call) => call.params.get("identity_type") === "BC_AUTH_TT"));
  const foreign = runtime({ foreignBusinessCenter: true }), foreignResult = await foreign.api.readTikTokAdsResources("owner", accountId, foreign.dependencies);
  assert.deepEqual(foreignResult.identities.map((identity) => identity.id), ["identity-1"]);
  assert.equal(foreignResult.readiness.campaignWrite, "unverified");
});

test("Spark Push identities need an exact AVAILABLE, push-enabled and non-GPPPA info response", async () => {
  for (const identityInfo of [{ available_status: "UNAVAILABLE" }, { available_status: undefined }, { can_push_video: false }, { can_push_video: "true" }, { can_push_video: undefined }, { is_gpppa: true }, { is_gpppa: "false" }, { is_gpppa: undefined }, { identity_id: "foreign-profile" }, { identity_id: undefined }, { identity_type: "CUSTOMIZED_USER" }, { identity_type: undefined }, { identity_authorized_bc_id: "987654321" }]) {
    const sample = runtime({ identityInfo }), result = await sample.api.readTikTokAdsResources("owner", accountId, sample.dependencies);
    assert.deepEqual(result.identities, []); assert.equal(result.identityRead.status, "verified");
    assert.ok(result.readiness.blockers.includes("identity_required")); assert.equal(result.readiness.campaignWrite, "unverified");
    assert.ok(sample.calls.every((call) => call.method === "GET"));
  }
  const eligible = { id: "profile", type: "TT_USER" as const, displayName: "Profil" };
  for (const info of [{}, { available_status: "AVAILABLE", can_push_video: true }, { available_status: "AVAILABLE", can_push_video: true, is_gpppa: "false" }]) {
    assert.equal(resourcePolicy.verifiedTikTokSparkPushIdentity(eligible, { data: { identity_info: info } }), null);
  }
  for (const type of ["CUSTOMIZED_USER", "AUTH_CODE"] as const) {
    assert.equal(resourcePolicy.verifiedTikTokSparkPushIdentity({ ...eligible, type }, { data: { identity_info: { available_status: "AVAILABLE", can_push_video: true, is_gpppa: false } } }), null);
  }
  const info = { identity_id: eligible.id, identity_type: eligible.type, available_status: "AVAILABLE", can_push_video: true, is_gpppa: false };
  assert.ok(resourcePolicy.verifiedTikTokSparkPushIdentity(eligible, { data: { identity_info: { ...info, identity_authorized_bc_id: null } } }));
  const bc = { ...eligible, type: "BC_AUTH_TT" as const, authorizedBusinessCenterId: "123456789" };
  assert.equal(resourcePolicy.verifiedTikTokSparkPushIdentity(bc, { data: { identity_info: { ...info, identity_type: bc.type } } }), null);
  assert.ok(resourcePolicy.verifiedTikTokSparkPushIdentity(bc, { data: { identity_info: { ...info, identity_type: bc.type, identity_authorized_bc_id: bc.authorizedBusinessCenterId } } }));
});

test("TikTok resource consent ignores time/order and changes for account, timezone, identity or read evidence", async () => {
  const sample = runtime(), resources = await sample.api.readTikTokAdsResources("owner", accountId, sample.dependencies);
  const key = resourcePolicy.tikTokAdsResourcesConsentKey(resources);
  assert.equal(key, resourcePolicy.tikTokAdsResourcesConsentKey({ ...resources, verifiedAt: "later", identities: [...resources.identities].reverse(), readiness: { ...resources.readiness, blockers: [...resources.readiness.blockers].reverse() } }));
  for (const next of [{ ...resources, account: { ...resources.account, timezone: "UTC" } }, { ...resources, identities: [] }, { ...resources, identities: resources.identities.map((identity) => ({ ...identity, canPushVideo: undefined })) }, { ...resources, identityRead: { status: "unavailable" as const, code: "ads_access_denied" } }]) assert.notEqual(key, resourcePolicy.tikTokAdsResourcesConsentKey(next));
  assert.equal(resourcePolicy.tikTokAdsResourcesConsentKey({ ...resources, selectedAccountId: "987654321" }), null);
});

test("TikTok resources route is owner-scoped, rate-limited and cannot publish or expose credentials", () => {
  const route = readFileSync(new URL("../app/api/ads/tiktok/resources/route.ts", import.meta.url), "utf8");
  assert.match(route, /requirePremiumAdsUser\("tiktok"\)/); assert.match(route, /user\.activeUserId/); assert.match(route, /enforceRateLimit/); assert.match(route, /Cache-Control.*no-store/);
  assert.doesNotMatch(route, /export async function POST|access_token_enc|refresh_token_enc|process\.env|request\.json/);
  const server = readFileSync(new URL("../lib/adsTikTokResourcesServer.ts", import.meta.url), "utf8");
  assert.doesNotMatch(server, /method: "POST"|\.upsert\(|\.update\(|tikTokAdsAccessToken\(/);
});
