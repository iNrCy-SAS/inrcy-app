import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as policy from "../lib/adsLinkedInPolicy.ts";

type Server = typeof import("../lib/adsLinkedInServer.ts");
type Diagnostic = import("../lib/adsLinkedInServer.ts").LinkedInAdsOAuthDiagnostic;
type Integration = import("../lib/adsLinkedInServer.ts").LinkedInAdsIntegration;
type Reply = { status?: number; body?: unknown; raw?: string; failure?: Error; jsonFailure?: Error; elapsedMs?: number };
const clientId = "fixture-ads-client";
const clientSecret = "fixture-client-secret";
const accessToken = "fixture-access-token";
const refreshToken = "fixture-refresh-token";
const scope = policy.LINKEDIN_ADS_MANAGE_SCOPES.join(",");
const validToken = { access_token: accessToken, expires_in: 5184000, refresh_token: refreshToken, refresh_token_expires_in: 31536000 };
const validIntrospection = { active: true, client_id: clientId, auth_type: "3L", scope };

function runtime(options: { exchange?: Reply; introspection?: Reply | Reply[]; memberships?: unknown; existing?: Integration | null;
  timerOverrunMs?: number } = {}) {
  const calls: string[] = [];
  const delays: number[] = [];
  const timeouts: number[] = [];
  const infos: unknown[][] = [];
  const verificationObservations: Array<{ accountReads: number; writes: number }> = [];
  let fakeNow = Date.now();
  let introspectionIndex = 0;
  const writes: Array<{ kind: "upsert" | "update"; row: Record<string, unknown> }> = [];
  const filters: Array<[string, string]> = [];
  type Query = {
    select: () => Query;
    eq: (key: string, value: string) => Query;
    maybeSingle: () => Promise<{ data: Integration | null; error: null }>;
    upsert: (row: Record<string, unknown>, options: { onConflict: string }) => Promise<{ error: null }>;
    update: (row: Record<string, unknown>) => Query;
    then: (resolve: (value: { error: null }) => unknown) => Promise<unknown>;
  };
  const query: Query = {
    select: () => query,
    eq: (key, value) => { filters.push([key, value]); return query; },
    maybeSingle: async () => { calls.push("db_read"); return { data: options.existing || null, error: null }; },
    upsert: async (row, input) => {
      assert.equal(input.onConflict, "user_id,provider,source,product");
      writes.push({ kind: "upsert", row }); return { error: null };
    },
    update: (row) => { writes.push({ kind: "update", row }); return query; },
    then: async (resolve) => resolve({ error: null }),
  };
  const modules: Record<string, unknown> = {
    "server-only": {},
    "@/lib/supabaseAdmin": { supabaseAdmin: { from: (table: string) => { assert.equal(table, "integrations"); return query; } } },
    "@/lib/oauthCrypto": {
      encryptToken: (token: string) => {
        assert.ok(token === accessToken || token === refreshToken);
        return token === accessToken ? "fixture-encrypted-access" : "fixture-encrypted-refresh";
      },
      decryptToken: (value: string) => {
        assert.ok(value === "fixture-encrypted-access" || value === "fixture-encrypted-refresh");
        return value === "fixture-encrypted-access" ? accessToken : refreshToken;
      },
    },
    "@/lib/adsLinkedInPolicy": policy,
  };
  function response(reply: Reply | undefined, defaultBody: unknown): Response {
    fakeNow += reply?.elapsedMs || 0;
    if (reply?.failure) throw reply.failure;
    const result = reply?.raw !== undefined ? new Response(reply.raw, { status: reply.status || 200 })
      : Response.json(reply && Object.hasOwn(reply, "body") ? reply.body : defaultBody, { status: reply?.status || 200 });
    if (reply?.jsonFailure) Object.defineProperty(result, "json", { value: async () => { throw reply.jsonFailure; } });
    return result;
  }
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(init?.cache, "no-store");
    if (url.pathname === "/oauth/v2/accessToken" || url.pathname === "/oauth/v2/introspectToken") {
      assert.equal(url.origin, "https://www.linkedin.com");
      assert.equal(init?.method, "POST");
      assert.ok(init?.body instanceof URLSearchParams);
      assert.equal(init.body.get("client_id"), clientId);
      assert.equal(init.body.get("client_secret"), clientSecret);
      if (url.pathname.endsWith("accessToken")) {
        const refresh = init.body.get("grant_type") === "refresh_token";
        calls.push(refresh ? "token_refresh" : "code_exchange");
        if (refresh) assert.equal(init.body.get("refresh_token"), refreshToken);
        else {
          assert.equal(init.body.get("code"), "fixture-code");
          assert.equal(init.body.get("redirect_uri"), "https://app.example.test/api/ads/linkedin/callback");
        }
        return response(options.exchange, validToken);
      }
      calls.push("token_introspection");
      assert.equal(init.body.get("token"), accessToken);
      verificationObservations.push({ accountReads: calls.filter((call) => call === "account_users").length, writes: writes.length });
      const reply = Array.isArray(options.introspection) ? options.introspection[introspectionIndex++] : options.introspection;
      if (Array.isArray(options.introspection)) assert.ok(reply, "No unplanned introspection request");
      return response(reply, validIntrospection);
    }
    assert.equal(url.origin, "https://api.linkedin.com");
    assert.equal(url.pathname, "/rest/adAccountUsers");
    assert.equal(init?.method || "GET", "GET");
    assert.equal(new Headers(init?.headers).get("Authorization"), `Bearer ${accessToken}`);
    calls.push("account_users");
    return Response.json(options.memberships || { elements: [{
      account: "urn:li:sponsoredAccount:123456", role: "ACCOUNT_MANAGER", user: "urn:li:person:fixture-member",
    }], paging: { total: 1 } });
  };
  const compiled = ts.transpileModule(readFileSync(new URL("../lib/adsLinkedInServer.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} as Server };
  class Clock extends Date { static now() { return fakeNow; } }
  const timer = (resolve: () => void, milliseconds: number) => {
    delays.push(milliseconds); fakeNow += milliseconds + (options.timerOverrunMs || 0); resolve(); return 0;
  };
  const abort = { timeout: (milliseconds: number) => { timeouts.push(milliseconds); return new AbortController().signal; } };
  new Function("module", "exports", "require", "fetch", "process", "Date", "setTimeout", "AbortSignal", "console", compiled)(loaded, loaded.exports, (name: string) => {
    assert.ok(Object.hasOwn(modules, name), `Unexpected module ${name}`); return modules[name];
  }, fetchImpl, { env: { LINKEDIN_ADS_CLIENT_ID: clientId, LINKEDIN_ADS_CLIENT_SECRET: clientSecret } },
  Clock, timer, abort, { info: (...values: unknown[]) => { infos.push(values); } });
  return { api: loaded.exports, calls, writes, filters, delays, timeouts, infos, verificationObservations };
}

async function expectFailure(run: ReturnType<typeof runtime>, action: () => Promise<unknown>, code: string,
  status: number, diagnostic: Diagnostic) {
  await assert.rejects(action(), (error: unknown) => {
    assert.ok(error instanceof run.api.LinkedInAdsConnectionError);
    assert.equal(error.code, code);
    assert.equal(error.status, status);
    assert.deepEqual(error.oauthDiagnostic, diagnostic);
    const serialized = JSON.stringify(error);
    for (const secret of [clientId, clientSecret, accessToken, refreshToken, "fixture-sensitive-description", "https://private.example"]) {
      assert.equal(serialized.includes(secret), false, "diagnostic must not retain provider or credential text");
      assert.equal(error.message.includes(secret), false);
    }
    return true;
  });
}

const diagnostic = (operation: Diagnostic["operation"], providerStatus: number | null,
  verification: Diagnostic["verification"] = null, providerCode: Diagnostic["providerCode"] = null,
  attempts?: Diagnostic["attempts"]): Diagnostic =>
  ({ operation, providerStatus, providerCode, verification, ...(attempts && attempts > 1 ? { attempts } : {}) });

test("official 3-legged introspection with comma scopes saves only the owner-scoped encrypted Ads connection", async () => {
  const run = runtime();
  const token = await run.api.exchangeLinkedInAdsCode("fixture-code", "https://app.example.test/api/ads/linkedin/callback");
  await run.api.saveLinkedInAdsConnection("fixture-owner", token, "manage");
  assert.deepEqual(run.calls, ["code_exchange", "token_introspection", "account_users", "db_read"]);
  assert.equal(run.writes.length, 1);
  const row = run.writes[0].row;
  assert.equal(row.user_id, "fixture-owner");
  assert.equal(row.provider, "linkedin_ads");
  assert.equal(row.source, "linkedin_ads");
  assert.equal(row.product, "ads");
  assert.equal(row.scopes, policy.LINKEDIN_ADS_MANAGE_SCOPES.join(" "));
  assert.equal(row.access_token_enc, "fixture-encrypted-access");
  assert.equal(row.refresh_token_enc, "fixture-encrypted-refresh");
  assert.equal(row.resource_id, null);
});

test("optional official introspection metadata may be omitted, while granted scopes remain authoritative", async () => {
  const run = runtime({ introspection: { body: { active: true, scope } } });
  await run.api.saveLinkedInAdsConnection("fixture-owner", validToken, "manage");
  assert.equal(run.writes.length, 1);
});

test("mismatched client and non-member tokens stay rejected immediately, including inactive responses", async () => {
  for (const [override, verification] of [
    [{ client_id: "other-client" }, "client_mismatch"], [{ active: false, client_id: "other-client" }, "client_mismatch"],
    [{ auth_type: "2L" }, "auth_type_mismatch"], [{ auth_type: "Enterprise_User" }, "auth_type_mismatch"],
    [{ active: false, auth_type: "2L" }, "auth_type_mismatch"],
  ] as const) {
    const run = runtime({ introspection: { body: { ...validIntrospection, ...override } } });
    await expectFailure(run, () => run.api.saveLinkedInAdsConnection("fixture-owner", validToken, "manage"),
      "authorization_invalid", 401, diagnostic("token_introspection", 200, verification));
    assert.deepEqual(run.calls, ["token_introspection"]);
    assert.equal(run.writes.length, 0);
    assert.deepEqual(run.delays, []);
  }
});

test("a newly exchanged inactive token is rechecked unchanged and only saved after active full-scope verification", async () => {
  const run = runtime({ introspection: [{ body: { active: false } }, { body: { active: false } },
    { body: { active: false } }, { body: validIntrospection }] });
  const token = await run.api.exchangeLinkedInAdsCode("fixture-code", "https://app.example.test/api/ads/linkedin/callback");
  await run.api.saveLinkedInAdsConnection("fixture-owner", token, "manage");
  assert.deepEqual(run.calls, ["code_exchange", ...Array<string>(4).fill("token_introspection"), "account_users", "db_read"]);
  assert.deepEqual(run.delays, [250, 750, 1500]);
  assert.deepEqual(run.verificationObservations, Array.from({ length: 4 }, () => ({ accountReads: 0, writes: 0 })));
  assert.deepEqual(run.infos, [["[linkedin-ads-oauth-verification]", { attempts: 4, result: "active" }]]);
  assert.equal(run.writes.length, 1);
  assert.deepEqual(run.timeouts.slice(0, 5), [15000, 10000, 9750, 9000, 7500]);
});

test("four inactive verifications exhaust the bounded window without accounts, writes or a recovery log", async () => {
  const run = runtime({ introspection: { body: { active: false } } });
  await expectFailure(run, () => run.api.saveLinkedInAdsConnection("fixture-owner", validToken, "manage"),
    "authorization_invalid", 401, diagnostic("token_introspection", 200, "inactive", null, 4));
  assert.deepEqual(run.calls, Array<string>(4).fill("token_introspection"));
  assert.deepEqual(run.delays, [250, 750, 1500]);
  assert.equal(run.writes.length, 0);
  assert.deepEqual(run.infos, []);
});

test("explicit revoked or expired statuses are not treated as delayed activation", async () => {
  for (const status of ["revoked", "expired", "REVOKED", "EXPIRED"]) {
    const run = runtime({ introspection: { body: { active: false, status } } });
    await expectFailure(run, () => run.api.saveLinkedInAdsConnection("fixture-owner", validToken, "manage"),
      "authorization_invalid", 401, { ...diagnostic("token_introspection", 200, "inactive"), tokenStatus: status.toLowerCase() as "revoked" | "expired" });
    assert.deepEqual(run.calls, ["token_introspection"]);
    assert.deepEqual(run.delays, []);
    assert.equal(run.writes.length, 0);
  }
});

test("token status diagnostics expose only known enums and never arbitrary provider values", async () => {
  for (const status of ["active", "ACTIVE", "fixture-sensitive-description", `${accessToken} https://private.example`]) {
    const run = runtime({ introspection: { body: { active: true, status } } });
    const expected = diagnostic("token_introspection", 200, "missing_scopes");
    if (status.toLowerCase() === "active") expected.tokenStatus = "active";
    await expectFailure(run, () => run.api.saveLinkedInAdsConnection("fixture-owner", validToken, "manage"),
      "scope_verification_failed", 403, expected);
    assert.deepEqual(run.calls, ["token_introspection"]);
    assert.equal(run.writes.length, 0);
  }
});

test("a refusal after an inactive response stops immediately and never logs recovery", async () => {
  for (const [reply, code, status, verification, providerCode] of [
    [{ status: 400, body: { error: "invalid_request" } }, "authorization_invalid", 401, null, "invalid_request"],
    [{ status: 429, body: { error: "temporarily_unavailable" } }, "provider_unavailable", 503, null, "temporarily_unavailable"],
    [{ body: { ...validIntrospection, client_id: "other-client" } }, "authorization_invalid", 401, "client_mismatch", null],
    [{ body: { ...validIntrospection, auth_type: "2L" } }, "authorization_invalid", 401, "auth_type_mismatch", null],
    [{ raw: "invalid JSON" }, "provider_invalid_response", 502, "malformed_response", null],
    [{ body: { active: true } }, "scope_verification_failed", 403, "missing_scopes", null],
    [{ body: { active: true, scope: "r_ads" } }, "missing_scopes", 403, "missing_scopes", null],
  ] as const) {
    const safeReply: Reply = reply;
    const run = runtime({ introspection: [{ body: { active: false } }, safeReply] });
    await expectFailure(run, () => run.api.saveLinkedInAdsConnection("fixture-owner", validToken, "manage"),
      code, status, diagnostic("token_introspection", safeReply.status || 200, verification, providerCode, 2));
    assert.deepEqual(run.calls, ["token_introspection", "token_introspection"]);
    assert.deepEqual(run.delays, [250]);
    assert.equal(run.writes.length, 0);
    assert.deepEqual(run.infos, []);
  }
});

test("the fresh verification deadline limits slow responses and late timers to ten seconds", async () => {
  const run = runtime({ introspection: [{ body: { active: false }, elapsedMs: 8900 }, { body: { active: false }, elapsedMs: 800 }] });
  await expectFailure(run, () => run.api.saveLinkedInAdsConnection("fixture-owner", validToken, "manage"),
    "authorization_invalid", 401, diagnostic("token_introspection", 200, "inactive", null, 2));
  assert.deepEqual(run.calls, ["token_introspection", "token_introspection"]);
  assert.deepEqual(run.delays, [250]);
  assert.deepEqual(run.timeouts, [10000, 850]);
  assert.equal(run.writes.length, 0);
  const late = runtime({ introspection: { body: { active: false } }, timerOverrunMs: 10000 });
  await expectFailure(late, () => late.api.saveLinkedInAdsConnection("fixture-owner", validToken, "manage"),
    "provider_unavailable", 503, diagnostic("token_introspection", null, "timeout"));
  assert.deepEqual(late.calls, ["token_introspection"]);
  assert.equal(late.writes.length, 0);
  const slow = runtime({ introspection: { body: validIntrospection, elapsedMs: 10001 } });
  await expectFailure(slow, () => slow.api.saveLinkedInAdsConnection("fixture-owner", validToken, "manage"),
    "provider_unavailable", 503, diagnostic("token_introspection", 200, "timeout"));
  assert.deepEqual(slow.calls, ["token_introspection"]);
  assert.equal(slow.writes.length, 0);
});

test("introspection HTTP400/401 keeps the safe OAuth error code, never a description or arbitrary provider string", async () => {
  for (const [status, error, known] of [[400, "invalid_request", "invalid_request"], [401, "invalid_client", "invalid_client"],
    [401, "fixture-sensitive-description", null]] as const) {
    const run = runtime({ introspection: { status, body: { error, error_description: "fixture-sensitive-description https://private.example" } } });
    await expectFailure(run, () => run.api.saveLinkedInAdsConnection("fixture-owner", validToken, "manage"),
      "authorization_invalid", 401, diagnostic("token_introspection", status, null, known));
    assert.equal(run.writes.length, 0);
    assert.deepEqual(run.calls, ["token_introspection"]);
  }
});

test("introspection rate limits and upstream failures are temporary, with no retry or persistence", async () => {
  for (const status of [429, 500, 502, 503]) {
    const run = runtime({ introspection: { status, body: { error: "temporarily_unavailable", error_description: clientSecret } } });
    await expectFailure(run, () => run.api.saveLinkedInAdsConnection("fixture-owner", validToken, "manage"),
      "provider_unavailable", 503, diagnostic("token_introspection", status, null, "temporarily_unavailable"));
    assert.deepEqual(run.calls, ["token_introspection"]);
    assert.equal(run.writes.length, 0);
  }
});

test("invalid introspection JSON or non-boolean active status is refused as malformed", async () => {
  for (const reply of [{ raw: "invalid JSON" }, { body: null }, { body: [] }, { body: {} },
    { body: { ...validIntrospection, active: "true" } }]) {
    const run = runtime({ introspection: reply });
    await expectFailure(run, () => run.api.saveLinkedInAdsConnection("fixture-owner", validToken, "manage"),
      "provider_invalid_response", 502, diagnostic("token_introspection", 200, "malformed_response"));
    assert.deepEqual(run.calls, ["token_introspection"]);
    assert.equal(run.writes.length, 0);
  }
});

test("missing or incomplete verified scopes cannot fall back to scopes asserted by the token response", async () => {
  for (const [granted, code] of [[undefined, "scope_verification_failed"], ["w_member_social", "missing_scopes"], ["r_ads", "missing_scopes"]]) {
    const run = runtime({ introspection: { body: { ...validIntrospection, scope: granted } } });
    await expectFailure(run, () => run.api.saveLinkedInAdsConnection("fixture-owner", { ...validToken, scope }, "manage"),
      code!, 403, diagnostic("token_introspection", 200, "missing_scopes"));
    assert.deepEqual(run.calls, ["token_introspection"]);
    assert.equal(run.writes.length, 0);
  }
});

test("OAuth transport timeouts and failures are typed without preserving error text", async () => {
  for (const operation of ["code_exchange", "token_introspection"] as const) {
    for (const [name, verification] of [["TimeoutError", "timeout"], ["AbortError", "timeout"], ["TypeError", "request_failed"]] as const) {
      const failure = new Error(`fixture-sensitive-description ${clientSecret} https://private.example`);
      failure.name = name;
      const run = runtime(operation === "code_exchange" ? { exchange: { failure } } : { introspection: { failure } });
      await expectFailure(run, operation === "code_exchange"
        ? () => run.api.exchangeLinkedInAdsCode("fixture-code", "https://app.example.test/api/ads/linkedin/callback")
        : () => run.api.saveLinkedInAdsConnection("fixture-owner", validToken, "manage"),
      "provider_unavailable", 503, diagnostic(operation, null, verification));
      assert.deepEqual(run.calls, [operation]);
      assert.equal(run.writes.length, 0);
    }
  }
});

test("interrupted OAuth JSON body transport remains temporary, while JSON syntax stays malformed", async () => {
  for (const operation of ["code_exchange", "token_introspection"] as const) {
    for (const [name, verification] of [["TimeoutError", "timeout"], ["AbortError", "timeout"], ["TypeError", "request_failed"]] as const) {
      const jsonFailure = new Error(`fixture-sensitive-description ${clientSecret} https://private.example`);
      jsonFailure.name = name;
      const run = runtime(operation === "code_exchange" ? { exchange: { jsonFailure } } : { introspection: { jsonFailure } });
      await expectFailure(run, operation === "code_exchange"
        ? () => run.api.exchangeLinkedInAdsCode("fixture-code", "https://app.example.test/api/ads/linkedin/callback")
        : () => run.api.saveLinkedInAdsConnection("fixture-owner", validToken, "manage"),
      "provider_unavailable", 503, diagnostic(operation, 200, verification));
      assert.deepEqual(run.calls, [operation]);
      assert.deepEqual(run.delays, []);
      assert.equal(run.writes.length, 0);
    }
    const run = runtime(operation === "code_exchange" ? { exchange: { jsonFailure: new SyntaxError("fixture-sensitive-description") } }
      : { introspection: { jsonFailure: new SyntaxError("fixture-sensitive-description") } });
    await expectFailure(run, operation === "code_exchange"
      ? () => run.api.exchangeLinkedInAdsCode("fixture-code", "https://app.example.test/api/ads/linkedin/callback")
      : () => run.api.saveLinkedInAdsConnection("fixture-owner", validToken, "manage"),
    "provider_invalid_response", 502, diagnostic(operation, 200, "malformed_response"));
    assert.deepEqual(run.calls, [operation]);
  }
  const jsonFailure = new Error("fixture-sensitive-description"); jsonFailure.name = "AbortError";
  const second = runtime({ introspection: [{ body: { active: false } }, { jsonFailure }] });
  await expectFailure(second, () => second.api.saveLinkedInAdsConnection("fixture-owner", validToken, "manage"),
    "provider_unavailable", 503, diagnostic("token_introspection", 200, "timeout", null, 2));
  assert.deepEqual(second.calls, ["token_introspection", "token_introspection"]);
  assert.deepEqual(second.delays, [250]);
  assert.equal(second.writes.length, 0);
});

test("code exchange diagnostics distinguish the provider HTTP status without changing invalid grant rejection", async () => {
  for (const [status, error, code, appStatus] of [
    [400, "invalid_grant", "authorization_invalid", 401], [401, "invalid_client", "authorization_invalid", 401],
    [429, "temporarily_unavailable", "provider_unavailable", 503], [503, "server_error", "provider_unavailable", 503],
  ] as const) {
    const run = runtime({ exchange: { status, body: { error, error_description: clientSecret } } });
    await expectFailure(run, () => run.api.exchangeLinkedInAdsCode("fixture-code", "https://app.example.test/api/ads/linkedin/callback"),
      code, appStatus, diagnostic("code_exchange", status, null, error));
    assert.deepEqual(run.calls, ["code_exchange"]);
    assert.equal(run.writes.length, 0);
  }
});

test("a successful HTTP response still needs the documented token and positive expiry", async () => {
  for (const reply of [{ raw: "invalid JSON" }, { body: {} }, { body: null }, { body: { ...validToken, access_token: 123 } },
    { body: { ...validToken, expires_in: true } }, { body: { ...validToken, expires_in: 0 } }]) {
    const run = runtime({ exchange: reply });
    await expectFailure(run, () => run.api.exchangeLinkedInAdsCode("fixture-code", "https://app.example.test/api/ads/linkedin/callback"),
      "provider_invalid_response", 502, diagnostic("code_exchange", 200, "malformed_response"));
    assert.deepEqual(run.calls, ["code_exchange"]);
    assert.equal(run.writes.length, 0);
  }
});

function expiredIntegration(): Integration {
  return { id: "fixture-integration", status: "connected", scopes: scope.replaceAll(",", " "),
    access_token_enc: "fixture-encrypted-access", refresh_token_enc: "fixture-encrypted-refresh",
    expires_at: new Date(Date.now() - 60_000).toISOString(), provider_account_id: "urn:li:person:fixture-member",
    resource_id: "123456", resource_label: "Annonceur de test", meta: { refresh_expires_at: new Date(Date.now() + 86_400_000).toISOString() } };
}

test("temporary refresh exchange and introspection failures preserve the current integration", async () => {
  for (const options of [{ exchange: { status: 429, body: { error: "temporarily_unavailable" } } },
    { introspection: { status: 503, body: { error: "server_error" } } }]) {
    const row = expiredIntegration();
    const run = runtime({ ...options, existing: row });
    await assert.rejects(run.api.linkedInAdsAuthorization("fixture-owner", row), (error: unknown) => {
      assert.ok(error instanceof run.api.LinkedInAdsConnectionError);
      assert.equal(error.code, "provider_unavailable");
      assert.equal(error.status, 503);
      return true;
    });
    assert.equal(run.writes.length, 0, "a transient error must not revoke or overwrite the saved connection");
  }
});

test("refresh introspection never rechecks an inactive token or changes the saved integration", async () => {
  const row = expiredIntegration();
  const run = runtime({ existing: row, introspection: { body: { active: false } } });
  await expectFailure(run, () => run.api.linkedInAdsAuthorization("fixture-owner", row), "authorization_invalid", 401,
    diagnostic("token_introspection", 200, "inactive"));
  assert.deepEqual(run.calls, ["token_refresh", "token_introspection"]);
  assert.deepEqual(run.delays, []);
  assert.deepEqual(run.timeouts, [15000, 15000]);
  assert.equal(run.writes.length, 0);
  assert.deepEqual(run.infos, []);
});

test("rejected refresh grants retain their operation diagnostic and require reconnection for the exact owner", async () => {
  const row = expiredIntegration();
  const run = runtime({ existing: row, exchange: { status: 400, body: { error: "invalid_grant" } } });
  await expectFailure(run, () => run.api.linkedInAdsAuthorization("fixture-owner", row), "authorization_invalid", 401,
    diagnostic("token_refresh", 400, null, "invalid_grant"));
  assert.equal(run.writes.length, 1);
  assert.equal(run.writes[0].row.status, "needs_update");
  assert.deepEqual(run.filters, [["id", row.id], ["user_id", "fixture-owner"]]);
});

test("inconsistent native member identities still block saving after valid OAuth introspection", async () => {
  const run = runtime({ memberships: { elements: [
    { account: "urn:li:sponsoredAccount:123456", role: "ACCOUNT_MANAGER", user: "urn:li:person:one" },
    { account: "urn:li:sponsoredAccount:654321", role: "ACCOUNT_MANAGER", user: "urn:li:person:two" },
  ], paging: { total: 2 } } });
  await assert.rejects(run.api.saveLinkedInAdsConnection("fixture-owner", validToken, "manage"), (error: unknown) => {
    assert.ok(error instanceof run.api.LinkedInAdsConnectionError);
    assert.equal(error.code, "provider_invalid_response"); return true;
  });
  assert.equal(run.writes.length, 0);
  assert.deepEqual(run.calls, ["token_introspection", "account_users"]);
});
