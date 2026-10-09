import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as safe from "../../lib/tsSafe.ts";

type Assets = typeof import("../../lib/metaBusinessAssets.ts");
type Reply = { body?: unknown; status?: number; failure?: Error; elapsedMs?: number };
const appId = "99000111222";
const appSecret = "fixture-app-secret";
const userToken = "fixture-user-token";
const pageToken = "fixture-page-token";
const actorId = "22000111222";
const pageId = "33000111222";
const secondPageId = "44000111222";
const scopes = ["pages_show_list", "pages_read_engagement", "pages_manage_posts"];
const inspection = (extra: Record<string, unknown> = {}) => ({ is_valid: true, app_id: appId, type: "USER", user_id: actorId,
  scopes, granular_scopes: [{ scope: "pages_show_list", target_ids: [pageId] }], ...extra });

function runtime(options: { debug?: Reply; actor?: Reply; page?: Reply; pageIdentity?: Reply; configured?: boolean;
  normalPages?: unknown[]; debugByToken?: Record<string, unknown>; candidates?: string[] } = {}) {
  const calls: Array<{ path: string; fields: string | null; bearer: string | null; inputToken: string | null }> = [];
  let now = Date.now();
  const nativePageTokens = new Map<string, string>();
  const respond = (reply: Reply | undefined, fallback: unknown) => {
    now += reply?.elapsedMs || 0;
    if (reply?.failure) throw reply.failure;
    return Response.json(reply && Object.hasOwn(reply, "body") ? reply.body : fallback, { status: reply?.status || 200 });
  };
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    assert.equal(url.origin, "https://graph.facebook.test", "No request may reach a live provider");
    assert.equal(init?.method || "GET", "GET", "Discovery must not make native mutations");
    assert.equal(init?.cache, "no-store");
    const path = url.pathname.replace(/^\/v25\.0\//, "");
    const fields = url.searchParams.get("fields");
    const bearer = new Headers(init?.headers).get("Authorization");
    const inputToken = url.searchParams.get("input_token");
    calls.push({ path, fields, bearer, inputToken });
    if (path === "me/accounts") return Response.json({ data: options.normalPages || [] });
    if (path === "me/assigned_pages" || path === "me/businesses") return Response.json({ data: [] });
    if (path === "debug_token") {
      assert.equal(bearer, `Bearer ${appId}|${appSecret}`);
      assert.ok(inputToken === userToken || inputToken === "fixture-second-user-token");
      return respond(options.debug, { data: options.debugByToken?.[inputToken!] || inspection(options.candidates
        ? { granular_scopes: [{ scope: "pages_show_list", target_ids: options.candidates }] } : {}) });
    }
    if (path === "me" && (bearer === `Bearer ${userToken}` || bearer === "Bearer fixture-second-user-token")) {
      assert.equal(fields, "id");
      assert.equal(url.searchParams.has("access_token"), false);
      return respond(options.actor, { id: actorId });
    }
    if (path === "me" && bearer?.startsWith(`Bearer ${pageToken}`)) {
      assert.equal(fields, "id");
      const requestedToken = bearer.slice("Bearer ".length);
      const matchedId = nativePageTokens.get(requestedToken);
      assert.ok(matchedId);
      return respond(options.pageIdentity, { id: matchedId });
    }
    if (/^[1-9]\d+$/.test(path)) {
      if (fields?.includes("instagram_business_account")) {
        return Response.json({ error: { code: 100, message: "Unsupported nested Instagram field" } }, { status: 400 });
      }
      assert.equal(fields, "id,name,access_token");
      assert.ok(bearer === `Bearer ${userToken}` || bearer === "Bearer fixture-second-user-token");
      assert.equal(url.searchParams.has("access_token"), false);
      const candidateToken = path === pageId ? pageToken : `${pageToken}-${path}`;
      nativePageTokens.set(candidateToken, path);
      return respond(options.page, { id: path, name: "Page de test", access_token: candidateToken });
    }
    throw new Error(`Unexpected fixture path ${path}`);
  };
  const compiled = ts.transpileModule(readFileSync(new URL("../../lib/metaBusinessAssets.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const modules: Record<string, unknown> = {
    "@/lib/observability/fetch": { fetchWithRetry: fetchImpl },
    "@/lib/tsSafe": safe,
    "@/lib/metaGraphApi": { buildMetaGraphUrl: (path: string) => `https://graph.facebook.test/v25.0/${path}` },
  };
  class Clock extends Date { static now() { return now; } }
  const loaded = { exports: {} as Assets };
  new Function("module", "exports", "require", "fetch", "process", "Date", compiled)(loaded, loaded.exports,
    (name: string) => { assert.ok(Object.hasOwn(modules, name)); return modules[name]; }, fetchImpl,
    { env: options.configured === false ? {} : { FACEBOOK_APP_ID: appId, FACEBOOK_APP_SECRET: appSecret } }, Clock);
  return { api: loaded.exports, calls };
}

const targetedReads = (run: ReturnType<typeof runtime>) => run.calls.filter((call) => /^[1-9]\d+$/.test(call.path)
  && call.fields === "id,name,access_token");

function assertSafeDiagnostics(result: Awaited<ReturnType<Assets["listAccessibleFacebookPagesDetailed"]>>) {
  const json = JSON.stringify(result.diagnostics);
  for (const sensitive of [appSecret, userToken, pageToken, "fixture-provider-private-description", "https://private.example"]) {
    assert.equal(json.includes(sensitive), false, "Recovery diagnostic must not retain sensitive provider details");
  }
}

test("a native granted Page is recovered from an empty list only after actor, exact Page and Page-token identity checks", async () => {
  const run = runtime();
  const result = await run.api.listAccessibleFacebookPagesDetailed(userToken);
  assert.equal(result.pages.length, 1);
  assert.equal(result.pages[0].id, pageId);
  assert.equal(result.pages[0].access_token, pageToken, "The native token remains server-side in the existing asset contract");
  assert.equal(result.pages[0].source, "page_lookup");
  assert.equal(result.diagnostics.primary_request_succeeded, true);
  assert.equal(result.diagnostics.primary_fallback_used, true);
  assert.deepEqual(run.calls.filter((call) => call.bearer).map((call) => call.path), ["debug_token", "me", pageId, "me"]);
  assert.equal(result.pages[0].instagram_business_account, null, "Failed optional Instagram enrichment must not drop the basic Page");
  assertSafeDiagnostics(result);
});

test("invalid, other-app, non-user, expired or scope-incomplete tokens cannot recover a Page", async () => {
  for (const extra of [{ is_valid: false }, { is_valid: "true" }, { app_id: "55000111222" }, { type: "SYSTEM_USER" },
    { user_id: "invalid-actor" }, { scopes: ["pages_show_list"] }, { scopes: ["pages_read_engagement"] },
    { expires_at: 1 }, { data_access_expires_at: 1 }, { expires_at: "invalid" }]) {
    const run = runtime({ debug: { body: { data: inspection(extra) } } });
    const result = await run.api.listAccessibleFacebookPagesDetailed(userToken);
    assert.deepEqual(result.pages, []);
    assert.equal(targetedReads(run).length, 0);
    assert.equal(run.calls.some((call) => call.path === "me"), false);
    assert.equal(result.diagnostics.issues.some((issue) => issue.stage === "granted_page_token"), true);
    assertSafeDiagnostics(result);
  }
});

test("native actor mismatch blocks the exact Page request", async () => {
  const run = runtime({ actor: { body: { id: "66000111222" } } });
  const result = await run.api.listAccessibleFacebookPagesDetailed(userToken);
  assert.deepEqual(result.pages, []);
  assert.equal(targetedReads(run).length, 0);
  assert.equal(result.diagnostics.issues.some((issue) => issue.stage === "granted_page_actor"), true);
  assertSafeDiagnostics(result);
});

test("missing targets never infer global access and unrelated scope targets are never requested", async () => {
  for (const granular_scopes of [undefined, null, [], [{ scope: "pages_show_list" }], [{ scope: "pages_show_list", target_ids: [] }],
    [{ scope: "ads_management", target_ids: [pageId] }], [{ scope: "pages_manage_posts", target_ids: [pageId] }]]) {
    const run = runtime({ debug: { body: { data: inspection({ granular_scopes }) } } });
    const result = await run.api.listAccessibleFacebookPagesDetailed(userToken);
    assert.deepEqual(result.pages, []);
    assert.equal(targetedReads(run).length, 0);
    assertSafeDiagnostics(result);
  }
});

test("malformed candidate IDs or more than twenty distinct native targets are refused before lookup", async () => {
  for (const target_ids of ["not-an-array", [pageId, "../me"], [pageId, 33000111222], [pageId, "0"],
    Array.from({ length: 21 }, (_, index) => `${77000111222 + index}`)]) {
    const run = runtime({ debug: { body: { data: inspection({ granular_scopes: [{ scope: "pages_show_list", target_ids }] }) } } });
    const result = await run.api.listAccessibleFacebookPagesDetailed(userToken);
    assert.deepEqual(result.pages, []);
    assert.equal(targetedReads(run).length, 0);
    assertSafeDiagnostics(result);
  }
});

test("duplicate granted IDs result in one lookup and never a guessed or unrelated Page", async () => {
  const run = runtime({ debug: { body: { data: inspection({ granular_scopes: [
    { scope: "pages_show_list", target_ids: [pageId, pageId] }, { scope: "pages_show_list", target_ids: [pageId] },
    { scope: "ads_read", target_ids: [secondPageId] },
  ] }) } } });
  const result = await run.api.listAccessibleFacebookPagesDetailed(userToken);
  assert.deepEqual(result.pages.map((page) => page.id), [pageId]);
  assert.deepEqual(targetedReads(run).map((call) => call.path), [pageId]);
});

test("a wrong native Page ID, absent Page token or Page-token identity mismatch never becomes selectable", async () => {
  for (const options of [{ page: { body: { id: secondPageId, name: "Other Page", access_token: pageToken } } },
    { page: { body: { id: pageId, name: "Public Page" } } },
    { page: { body: { id: pageId, access_token: " " } } }, { pageIdentity: { body: { id: secondPageId } } }]) {
    const run = runtime(options);
    const result = await run.api.listAccessibleFacebookPagesDetailed(userToken);
    assert.deepEqual(result.pages, []);
    assert.equal(targetedReads(run).length, 1);
    assert.equal(result.diagnostics.issues.some((issue) => issue.stage === "granted_page_lookup" || issue.stage === "granted_page_identity"), true);
    assertSafeDiagnostics(result);
  }
});

test("provider failures and malformed introspection remain diagnostic-only without exposing their descriptions", async () => {
  for (const debug of [{ status: 401, body: { error: { code: 190, message: `fixture-provider-private-description ${userToken}` } } },
    { status: 503, body: { error: { code: 2, message: `https://private.example ${appSecret}` } } },
    { body: null }, { body: [] }, { body: {} },
    { failure: new Error(`fixture-provider-private-description ${appSecret} ${userToken}`) }]) {
    const run = runtime({ debug });
    const result = await run.api.listAccessibleFacebookPagesDetailed(userToken);
    assert.deepEqual(result.pages, []);
    assert.equal(targetedReads(run).length, 0);
    assertSafeDiagnostics(result);
  }
});

test("a provider refusal or malformed direct Page response cannot be accepted just from granular targets", async () => {
  for (const page of [{ status: 403, body: { error: { code: 200, error_subcode: 33, type: "OAuthException", fbtrace_id: "fixture-trace",
    message: `fixture-provider-private-description ${pageToken} ${userToken}` } } }, { body: { error: { code: 200 } } },
    { body: null }, { failure: new Error(`https://private.example ${pageToken}`) }]) {
    const run = runtime({ page });
    const result = await run.api.listAccessibleFacebookPagesDetailed(userToken);
    assert.deepEqual(result.pages, []);
    assert.equal(targetedReads(run).length, 1);
    assertSafeDiagnostics(result);
  }
});

test("the historical non-empty Page path does not introspect tokens or change its assets", async () => {
  const normal = { id: pageId, name: "Historical Page", access_token: pageToken, instagram_business_account: { id: "88000111222", username: "fixture" } };
  const run = runtime({ normalPages: [normal] });
  const result = await run.api.listAccessibleFacebookPagesDetailed(userToken);
  assert.equal(result.pages[0].source, "me_accounts");
  assert.equal(result.pages[0].access_token, pageToken);
  assert.equal(run.calls.some((call) => call.path === "debug_token"), false);
  assert.equal(targetedReads(run).length, 0);
});

test("an unconfigured targeted fallback leaves standard discovery unchanged", async () => {
  const run = runtime({ configured: false });
  const result = await run.api.listAccessibleFacebookPagesDetailed(userToken);
  assert.deepEqual(result.pages, []);
  assert.equal(run.calls.some((call) => call.path === "debug_token"), false);
});

test("multi-token discovery can recover the valid second grant without mixing actors or losing existing diagnostics", async () => {
  const run = runtime({ debugByToken: { [userToken]: inspection({ is_valid: false }),
    "fixture-second-user-token": inspection() } });
  const result = await run.api.listAccessibleFacebookPagesFromTokensDetailed([userToken, "fixture-second-user-token"]);
  assert.deepEqual(result.pages.map((page) => page.id), [pageId]);
  assert.equal(result.diagnostics.token_count, 2);
  assert.equal(result.diagnostics.recovered_token_count, 1);
  const pageRead = targetedReads(run)[0];
  assert.equal(pageRead.bearer, "Bearer fixture-second-user-token");
  assert.equal(result.diagnostics.issues.some((issue) => issue.stage === "granted_page_token"), true);
});

test("a targeted recovery deadline keeps a confirmed first Page and prevents further network lookups", async () => {
  const run = runtime({ candidates: [pageId, secondPageId], pageIdentity: { body: { id: pageId }, elapsedMs: 9800 } });
  const result = await run.api.listAccessibleFacebookPagesDetailed(userToken);
  assert.deepEqual(result.pages.map((page) => page.id), [pageId]);
  assert.deepEqual(targetedReads(run).map((call) => call.path), [pageId]);
  assert.equal(result.diagnostics.issues.some((issue) => issue.stage === "granted_page_lookup"), true);
  assertSafeDiagnostics(result);
});
