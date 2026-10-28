/* eslint-disable @typescript-eslint/no-explicit-any -- Dynamic transpiled modules and fluent database fixtures intentionally expose runtime shapes. */
import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import crypto from "node:crypto";
import ts from "typescript";
import { createClient } from "@supabase/supabase-js";
import * as reviewerAccess from "../../lib/reviewerAccess.ts";
import { META_DIRECT_CHANNELS_PUBLIC_ENABLED } from "../../lib/metaChannelRollout.ts";

function load<T = any>(file: string, dependencies: Record<string, unknown> = {}): T {
  const code = ts.transpileModule(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true },
  }).outputText;
  const exports = {};
  new Function("exports", "require", code)(exports, (id: string) => {
    if (id === "server-only") return {};
    assert.ok(id in dependencies, `Unexpected dependency: ${id}`); return dependencies[id];
  });
  return exports as T;
}
const ACCOUNT = "00000000-0000-4000-8000-000000000010";
const OTHER = "00000000-0000-4000-8000-000000000011";
const ACTOR = "00000000-0000-4000-8000-000000000012";
const safe = load("lib/tsSafe.ts");
const graph = load("lib/metaGraphApi.ts");
const authMode = load("lib/instagramAuthMode.ts", { "@/lib/metaGraphApi": graph });
const threadsGraph = load("lib/threadsGraphApi.ts");
const security = load("lib/security.ts", { crypto });
const encryption = load("lib/oauthCrypto.ts", { crypto });
const tokens = load("lib/metaDirectTokens.ts", { "@/lib/oauthCrypto": encryption, "@/lib/instagramAuthMode": authMode, "@/lib/tsSafe": safe });
const ENV = { INRCY_CREDENTIALS_SECRET: Buffer.alloc(32, 17).toString("base64"), NEXT_PUBLIC_SITE_URL: "https://fixture.example", INSTAGRAM_DIRECT_APP_ID: "fixture-ig", INSTAGRAM_DIRECT_APP_SECRET: "secret-ig-fixture", INSTAGRAM_DIRECT_REDIRECT_URI: "", THREADS_APP_ID: "fixture-threads", THREADS_APP_SECRET: "secret-threads-fixture", THREADS_REDIRECT_URI: "" };
async function configured(body: () => Promise<void>) {
  const prior = Object.fromEntries(Object.keys(ENV).map(key => [key, process.env[key]]));
  Object.assign(process.env, ENV);
  try { await body(); } finally { for (const [key, value] of Object.entries(prior)) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
}
async function withFetch(fake: typeof fetch, body: () => Promise<void>) { const prior = globalThis.fetch; globalThis.fetch = fake; try { await body(); } finally { globalThis.fetch = prior; } }
const responseFactory = {
  redirect(url: string | URL) { const values = new Map<string, { value: string; options: any }>(); return { status: 307, headers: new Headers({ location: String(url) }), cookies: { set(name: string, value: string, options: unknown) { values.set(name, { value, options }); } }, cookieValues: values }; },
  json(body: unknown, options?: { status?: number }) { return { status: options?.status ?? 200, body }; },
};
function harness(options: { publicEnabled?: boolean; noSession?: boolean; actorAdmin?: boolean; actorReviewer?: boolean; actorId?: string; activeAccountId?: string; accountRole?: string; authenticatedActor?: string; wrongAccount?: boolean; partialScopes?: boolean; nonTester?: boolean; invalidDebugToken?: boolean; wrongDebugApp?: boolean; responseThrows?: boolean; personal?: boolean; failAt?: "token_exchange" | "token_inspection" | "long_token_exchange" | "profile"; saveError?: { code: string; details: string } } = {}) {
  const actorAdmin = options.actorAdmin ?? true, role = options.accountRole ?? "admin";
  const actorId = options.actorId ?? ACTOR, accountId = options.activeAccountId ?? ACCOUNT;
  const saves: any[] = [], calls: any[] = [], events: any[] = [], steps: string[] = [];
  const query = { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: { role, meta: { publication_preferences: { mode: "reels" }, page_id: "legacy-page" } }, error: null }; } };
  const admin = { from: () => query, async rpc(name: string, args: any) { saves.push({ name, args }); return { error: options.saveError ?? null }; } };
  const rollout = { META_DIRECT_CHANNELS_PUBLIC_ENABLED: options.publicEnabled ?? false };
  const gate = load("lib/metaChannelRolloutServer.ts", { "next/server": { NextResponse: responseFactory }, "@/lib/roles": { ADMIN_USER_IDS: [], getMyRole: async () => ({ isAdmin: actorAdmin, isReviewer: options.actorReviewer === true, role: options.actorReviewer ? "reviewer" : actorAdmin ? "admin" : "user", authUserId: actorId }) }, "@/lib/metaChannelRollout": rollout, "@/lib/reviewerAccess": reviewerAccess });
  const oauth = load("lib/metaDirectOAuth.ts", {
    "next/server": { NextResponse: responseFactory },
    "@/lib/supabaseServer": { createSupabaseServer: async () => ({ auth: { getUser: async () => ({ data: { user: options.noSession ? null : { id: options.authenticatedActor ?? actorId } }, error: null }) } }) },
    "@/lib/supabaseAdmin": { supabaseAdmin: admin },
    "@/lib/multicompte/server": { getCurrentInrcyAccountScope: async () => options.noSession ? null : ({ scope: { activeUserId: accountId }, user: { id: actorId } }), resolveOAuthBoundInrcyAccountId: async (_supabase: unknown, _actor: string, account: string) => { if (options.wrongAccount || account !== accountId) throw Error("Account authorization denied"); return account; } },
    "@/lib/security": security, "@/lib/metaChannelRolloutServer": gate,
    "@/lib/metaChannelRollout": rollout,
    "@/lib/instagramAuthMode": authMode, "@/lib/threadsGraphApi": threadsGraph, "@/lib/oauthCrypto": encryption, "@/lib/tsSafe": safe,
    "@/lib/connectionVersions": { withCurrentConnectionVersion: (_key: string, value: unknown) => value },
    "@/lib/statsCache": { clearAllToolCaches: async () => {} }, "@/lib/rateLimit": { enforceRateLimit: async () => null, getClientIp: () => "fixture-ip" },
    "@/lib/observability/oauth": { oauthCallbackEvent: (_request: unknown, event: unknown) => events.push(event) },
    "@/lib/metaDirectTokens": { ...tokens,
      fetchMetaDirectJson: async (input: string | URL, init?: RequestInit) => {
        const url = new URL(String(input)); calls.push({ url, init });
        const requestStage = url.pathname.endsWith("oauth/access_token") ? "token_exchange" : url.pathname.endsWith("debug_token") ? "token_inspection" : "profile";
        steps.push(requestStage);
        if (options.failAt === requestStage) throw new tokens.MetaDirectApiError("meta_permission_or_request_failed", "Meta a refusé cette opération.", 400, { httpStatus: 400, metaCode: 100, metaSubcode: 33 });
        if (options.responseThrows) throw new tokens.MetaDirectApiError("meta_permission_or_request_failed", "Meta a refusé cette opération.", 400);
        if (url.pathname.endsWith("oauth/access_token")) return { access_token: "fixture-short-token", permissions: options.partialScopes ? ["instagram_business_basic"] : [...authMode.INSTAGRAM_DIRECT_SCOPES] };
        if (options.nonTester && url.pathname.endsWith("debug_token") && url.searchParams.get("access_token") !== `TH|${ENV.THREADS_APP_ID}|${ENV.THREADS_APP_SECRET}`) {
          throw new tokens.MetaDirectApiError("meta_permission_or_request_failed", "Meta refused non-tester token inspection.", 400, { httpStatus: 403, metaCode: 10 });
        }
        if (url.pathname.endsWith("debug_token")) return { data: { is_valid: !options.invalidDebugToken, app_id: options.wrongDebugApp ? "another-app" : ENV.THREADS_APP_ID, scopes: options.partialScopes ? ["threads_basic"] : [...threadsGraph.THREADS_SCOPES] } };
        return url.host === "graph.instagram.com" ? { data: [{ user_id: "1234567890", username: "brand", account_type: options.personal ? "PERSONAL" : "BUSINESS" }] } : { id: "1234567891", username: "thread-brand" };
      }, exchangeMetaDirectLongToken: async () => {
        steps.push("long_token_exchange");
        if (options.failAt === "long_token_exchange") throw new tokens.MetaDirectApiError("meta_permission_or_request_failed", "Meta a refusé cette opération.", 400, { httpStatus: 400, metaCode: 100, metaSubcode: 33 });
        return { accessToken: "fixture-long-token", expiresAt: new Date(Date.now() + 60 * 86400000).toISOString() };
      },
    },
  });
  const callback = (provider: "instagram" | "threads", changes?: { missingCookie?: boolean; legacyCookie?: boolean; malformedCookie?: boolean; tamper?: boolean; account?: string; code?: string }) => {
    const stateProvider = provider === "instagram" ? "instagram_direct" : "threads";
    const state = security.makeOAuthState(stateProvider, "/dashboard?panel=" + provider, { accountId: changes?.account ?? accountId, authUserId: actorId });
    const stateB64 = changes?.tamper ? Buffer.from(JSON.stringify({ ...security.b64urlJsonDecode(state.stateB64), accountId: OTHER })).toString("base64url") : state.stateB64;
    const url = new URL(`https://fixture.example/api/integrations/${provider}/callback`); url.searchParams.set("state", stateB64); url.searchParams.set("code", changes?.code ?? "fixture-code-secret");
    return new Request(url, { headers: changes?.missingCookie ? {} : { cookie: `${state.cookieName}=${changes?.malformedCookie ? "%E0%A4%A" : changes?.legacyCookie ? state.nonce : state.cookieValue}` } });
  };
  return { module: oauth, calls, saves, events, steps, callback };
}

test("closed rollout mode rejects USER/staff or a non-admin account before contacting Meta", async () => configured(async () => {
  for (const options of [{ actorAdmin: false }, { accountRole: "user" }, { accountRole: "staff" }]) for (const provider of ["instagram", "threads"]) {
    const h = harness(options); const result = await h.module.startMetaDirectOAuth(new Request("https://fixture.example/start"), provider);
    assert.equal(result.status, 403); assert.equal(h.calls.length, 0); assert.equal(h.saves.length, 0);
  }
}));

test("public rollout lets ordinary accounts start and complete both Meta providers with the account bound", async () => configured(async () => {
  assert.equal(META_DIRECT_CHANNELS_PUBLIC_ENABLED, true);
  for (const provider of ["instagram", "threads"] as const) {
    const h = harness({ publicEnabled: META_DIRECT_CHANNELS_PUBLIC_ENABLED, actorAdmin: false, accountRole: "user" });
    const start = await h.module.startMetaDirectOAuth(new Request("https://fixture.example/start"), provider);
    assert.equal(start.status, 307);
    const state = security.b64urlJsonDecode(new URL(start.headers.get("location")).searchParams.get("state"));
    assert.equal(state.authUserId, ACTOR);
    assert.equal(state.accountId, ACCOUNT);
    const result = await h.module.handleMetaDirectOAuthCallback(h.callback(provider), provider);
    assert.equal(new URL(result.headers.get("location")).searchParams.get("ok"), "1");
    assert.equal(h.saves.length, 1);
    assert.equal(h.saves[0].args.p_account_id, ACCOUNT);
    assert.equal(h.saves[0].args.p_admin_pilot, false);
    assert.deepEqual(h.saves[0].args.p_integration.meta.publication_preferences, { mode: "reels" });
  }
}));

test("public rollout still refuses unauthenticated, foreign-account and forged OAuth callbacks without contacting Meta", async () => configured(async () => {
  for (const provider of ["instagram", "threads"] as const) {
    const noSession = harness({ publicEnabled: true, noSession: true });
    assert.equal((await noSession.module.startMetaDirectOAuth(new Request("https://fixture.example/start"), provider)).status, 401);
    for (const options of [{ noSession: true }, { authenticatedActor: OTHER }, { wrongAccount: true }]) {
      const h = harness({ publicEnabled: true, actorAdmin: false, accountRole: "user", ...options });
      const result = await h.module.handleMetaDirectOAuthCallback(h.callback(provider), provider);
      assert.equal(new URL(result.headers.get("location")).searchParams.get("ok"), "0");
      assert.equal(h.calls.length, 0);
      assert.equal(h.saves.length, 0);
    }
    for (const change of [{ missingCookie: true }, { legacyCookie: true }, { tamper: true }, { account: OTHER }]) {
      const h = harness({ publicEnabled: true, actorAdmin: false, accountRole: "user" });
      const result = await h.module.handleMetaDirectOAuthCallback(h.callback(provider, change), provider);
      assert.equal(new URL(result.headers.get("location")).searchParams.get("ok"), "0");
      assert.equal(h.calls.length, 0);
      assert.equal(h.saves.length, 0);
    }
  }
}));

test("ADMIN start uses bound HttpOnly state and same-origin return URLs for each provider", async () => configured(async () => {
  for (const provider of ["instagram", "threads"]) {
    const h = harness(); const result = await h.module.startMetaDirectOAuth(new Request("https://fixture.example/start?returnTo=https://attacker.example"), provider);
    const url = new URL(result.headers.get("location")); assert.equal(url.hostname, provider === "instagram" ? "www.instagram.com" : "www.threads.com");
    const state = security.b64urlJsonDecode(url.searchParams.get("state")); assert.equal(state.accountId, ACCOUNT); assert.equal(state.authUserId, ACTOR); assert.equal(state.returnTo, "/dashboard?panel=" + provider);
    const cookie = Array.from(result.cookieValues.values())[0] as any; assert.equal(cookie.options.httpOnly, true); assert.equal(cookie.options.secure, true); assert.ok(cookie.value.includes("."));
    assert.equal(url.toString().includes("secret-ig-fixture"), false); assert.equal(url.toString().includes("secret-threads-fixture"), false);
  }
}));

test("Missing, legacy or tampered state, wrong auth user and wrong bound account cannot call Meta or save", async () => configured(async () => {
  for (const provider of ["instagram", "threads"] as const) {
    for (const change of [{ missingCookie: true }, { legacyCookie: true }, { tamper: true }, { account: OTHER }]) {
      const h = harness(); const result = await h.module.handleMetaDirectOAuthCallback(h.callback(provider, change), provider);
      assert.equal(new URL(result.headers.get("location")).searchParams.get("ok"), "0"); assert.equal(h.calls.length, 0); assert.equal(h.saves.length, 0);
    }
    for (const options of [{ authenticatedActor: OTHER }, { wrongAccount: true }, { actorAdmin: false }, { accountRole: "user" }]) {
      const h = harness(options); const result = await h.module.handleMetaDirectOAuthCallback(h.callback(provider), provider);
      assert.equal(new URL(result.headers.get("location")).searchParams.get("ok"), "0"); assert.equal(h.calls.length, 0); assert.equal(h.saves.length, 0);
    }
  }
}));

test("Partial scopes or a consumer Instagram account preserve the old connection", async () => configured(async () => {
  for (const provider of ["instagram", "threads"] as const) {
    const h = harness({ partialScopes: true }); const result = await h.module.handleMetaDirectOAuthCallback(h.callback(provider), provider);
    assert.equal(new URL(result.headers.get("location")).searchParams.get("error"), "meta_permissions_incomplete"); assert.equal(h.saves.length, 0);
  }
  const h = harness({ personal: true }); const result = await h.module.handleMetaDirectOAuthCallback(h.callback("instagram"), "instagram");
  assert.equal(new URL(result.headers.get("location")).searchParams.get("error"), "instagram_professional_required"); assert.equal(h.saves.length, 0);
}));

test("Successful callbacks save one transaction with bound IDs and preferences, and clear state", async () => configured(async () => {
  for (const provider of ["instagram", "threads"] as const) {
    const h = harness(); const result = await h.module.handleMetaDirectOAuthCallback(h.callback(provider), provider);
    assert.equal(new URL(result.headers.get("location")).searchParams.get("ok"), "1"); assert.equal(h.saves.length, 1);
    const saved = h.saves[0];
    assert.equal(saved.args.p_integration.scopes, (provider === "instagram" ? authMode.INSTAGRAM_DIRECT_SCOPES : threadsGraph.THREADS_SCOPES).join(" "));
    assert.equal(saved.args.p_integration.scope, undefined);
    assert.equal(saved.name, "save_meta_direct_connection"); assert.equal(saved.args.p_account_id, ACCOUNT); assert.equal(saved.args.p_admin_pilot, true);
    assert.equal(saved.args.p_integration.resource_id, provider === "instagram" ? "1234567890" : "1234567891");
    assert.equal(encryption.decryptToken(saved.args.p_integration.access_token_enc), "fixture-long-token");
    assert.deepEqual(saved.args.p_integration.meta.publication_preferences, { mode: "reels" }); assert.equal(saved.args.p_integration.meta.page_id, undefined);
    assert.equal(saved.args.p_integration.meta.auth_mode, provider === "instagram" ? "instagram_login" : "threads_login");
    assert.equal((Array.from(result.cookieValues.values())[0] as any).options.maxAge, 0);
  }
}));

test("REVIEWER can authorize both pilot providers while account ownership remains bound", async () => configured(async () => {
  const reviewer = reviewerAccess.FULL_PRODUCT_REVIEWER_ACCOUNT_ID;
  for (const provider of ["instagram", "threads"] as const) {
    const h = harness({ actorAdmin: false, actorReviewer: true, accountRole: "reviewer", actorId: reviewer, activeAccountId: reviewer });
    const start = await h.module.startMetaDirectOAuth(new Request("https://fixture.example/start"), provider);
    assert.equal(start.status, 307);
    const result = await h.module.handleMetaDirectOAuthCallback(h.callback(provider), provider);
    assert.equal(new URL(result.headers.get("location")).searchParams.get("ok"), "1");
    assert.equal(h.saves.length, 1);
    assert.equal(h.saves[0].args.p_account_id, reviewer);
    const denied = harness({ actorAdmin: false, actorReviewer: true, accountRole: "reviewer", actorId: reviewer, activeAccountId: reviewer, wrongAccount: true });
    const invalid = await denied.module.handleMetaDirectOAuthCallback(denied.callback(provider), provider);
    assert.equal(new URL(invalid.headers.get("location")).searchParams.get("ok"), "0");
    assert.equal(denied.saves.length, 0);
    for (const [actorId,activeAccountId] of [[ACTOR,reviewer],[reviewer,ACCOUNT],[ACTOR,ACCOUNT]] as const) {
      const unrelated = harness({ actorAdmin:false,actorReviewer:true,accountRole:"reviewer",actorId,activeAccountId });
      assert.equal((await unrelated.module.startMetaDirectOAuth(new Request("https://fixture.example/start"),provider)).status,403);
      assert.equal(new URL((await unrelated.module.handleMetaDirectOAuthCallback(unrelated.callback(provider),provider)).headers.get("location")).searchParams.get("ok"),"0");
      assert.equal(unrelated.saves.length,0);
      assert.equal(unrelated.calls.length,0);
    }
  }
}));

test("Provider and transport errors never reveal credentials, codes, response bodies or request URLs", async () => configured(async () => {
  const secret = "DO_NOT_EXPOSE_PROVIDER_SECRET";
  for (const fake of [async () => Response.json({ error: { message: secret, code: 190 } }, { status: 401 }), async () => { throw Error(secret); }, async () => new Response(secret, { status: 502 })]) {
    await withFetch(fake as typeof fetch, async () => {
      await assert.rejects(tokens.fetchMetaDirectJson(`https://graph.threads.com/me?access_token=${secret}`), (error: any) => { assert.equal(String(error).includes(secret), false); assert.equal(String(error).includes("graph.threads"), false); return true; });
    });
  }
  const h = harness({ responseThrows: true }); const response = await h.module.handleMetaDirectOAuthCallback(h.callback("threads", { code: secret }), "threads");
  assert.equal(response.headers.get("location").includes(secret), false); assert.equal(JSON.stringify(h.events).includes(secret), false); assert.equal(h.saves.length, 0);
}));

test("Refresh CAS retains account/token ownership, rejects a reconnection to another resource, and reuses only the same winner", async () => configured(async () => {
  const original = { id: "integration-id", user_id: ACCOUNT, provider: "threads", source: "threads", product: "threads", status: "connected", resource_id: "123", access_token_enc: encryption.encryptToken("old-token"), expires_at: new Date(Date.now() + 86400000).toISOString(), meta: { auth_mode: "threads_login", token_issued_at: new Date(Date.now() - 2 * 86400000).toISOString() } };
  for (const changed of [true, false]) for (const resource of ["123", "456"]) {
    const filters: any[] = [];
    const query = { update() { return this; }, select() { return this; }, eq(key: string, value: unknown) { filters.push([key, value]); return this; }, async maybeSingle() { return { data: filters.some(([key]) => key === "access_token_enc") ? changed ? { id: original.id } : null : { ...original, resource_id: resource, access_token_enc: encryption.encryptToken("winner-token"), expires_at: new Date(Date.now() + 60 * 86400000).toISOString() }, error: null }; } };
    const admin = { from() { filters.length = 0; return query; } };
    await withFetch(async () => Response.json({ access_token: "refreshed-token", expires_in: 5184000 }), async () => {
      if (!changed && resource !== "123") await assert.rejects(tokens.ensureMetaDirectAccessToken(admin, original), (error: any) => error.code === "meta_connection_changed");
      else assert.equal(await tokens.ensureMetaDirectAccessToken(admin, original), changed ? "refreshed-token" : "winner-token");
    });
    assert.ok(filters.some(([key, value]) => key === "id" && value === original.id)); assert.ok(filters.some(([key, value]) => key === "user_id" && value === ACCOUNT));
  }
}));

test("Expired direct tokens require reconnection and young tokens/legacy Facebook tokens make no refresh request", async () => configured(async () => {
  let calls = 0;
  await withFetch(async () => { calls++; throw Error("Unexpected remote refresh"); }, async () => {
    const original = { provider: "instagram", access_token_enc: encryption.encryptToken("current-token"), expires_at: new Date(Date.now() - 1000).toISOString(), meta: { auth_mode: "instagram_login" } };
    await assert.rejects(tokens.ensureMetaDirectAccessToken({}, original), (error: any) => error.code === "meta_direct_reconnect_required");
    assert.equal(await tokens.ensureMetaDirectAccessToken({}, { ...original, expires_at: new Date(Date.now() + 86400000).toISOString(), meta: { auth_mode: "instagram_login", token_issued_at: new Date().toISOString() } }), "current-token");
    assert.equal(await tokens.ensureMetaDirectAccessToken({}, { ...original, meta: {} }), "current-token");
  });
  assert.equal(calls, 0);
}));

test("Malformed OAuth cookies are rejected through the controlled state error without provider calls", async () => configured(async () => {
  const h = harness();
  const result = await h.module.handleMetaDirectOAuthCallback(h.callback("threads", { malformedCookie: true }), "threads");
  assert.equal(new URL(result.headers.get("location")).searchParams.get("error"), "oauth_state");
  assert.equal(h.calls.length, 0); assert.equal(h.saves.length, 0);
}));

test("A token refresh cannot overwrite a publication-preference edit that completed during the Meta request", async () => configured(async () => {
  const stored = { id: "integration-id", user_id: ACCOUNT, provider: "threads", source: "threads", product: "threads", status: "connected", resource_id: "123", access_token_enc: encryption.encryptToken("old-token"), expires_at: new Date(Date.now() + 86400000).toISOString(), meta: { auth_mode: "threads_login", token_issued_at: new Date(Date.now() - 2 * 86400000).toISOString(), publication_preferences: { reply_control: "everyone" } } };
  const original = structuredClone(stored);
  const admin = { from() {
    let patch: any = null; const filters: Array<[string, any]> = [];
    return { update(value: any) { patch = value; return this; }, select() { return this; }, eq(key: string, value: any) { filters.push([key, value]); return this; }, async maybeSingle() {
      const matches = filters.every(([key, value]) => JSON.stringify((stored as any)[key]) === JSON.stringify(key === "meta" && typeof value === "string" ? JSON.parse(value) : value));
      if (patch) { if (!matches) return { data: null, error: null }; Object.assign(stored, patch); return { data: { id: stored.id }, error: null }; }
      return { data: matches ? structuredClone(stored) : null, error: null };
    } };
  } };
  await withFetch(async () => { stored.meta.publication_preferences.reply_control = "followers_only"; return Response.json({ access_token: "refreshed-token", expires_in: 5184000 }); }, async () => {
    await tokens.ensureMetaDirectAccessToken(admin, original);
    assert.equal(stored.meta.publication_preferences.reply_control, "followers_only");
  });
}));

test("The installed PostgREST client serializes token/resource/meta CAS filters as valid JSON", async () => configured(async () => {
  const integration = { id: "00000000-0000-4000-8000-000000000030", user_id: ACCOUNT, provider: "threads", source: "threads", product: "threads", status: "connected", resource_id: "123", access_token_enc: encryption.encryptToken("old-token"), expires_at: new Date(Date.now() + 86400000).toISOString(), meta: { auth_mode: "threads_login", token_issued_at: new Date(Date.now() - 2 * 86400000).toISOString() } };
  const urls: URL[] = [];
  const fakeFetch: typeof fetch = async (input, init) => {
    const url = new URL(String(input)); urls.push(url);
    if (url.host === "graph.threads.com") return Response.json({ access_token: "refreshed-token", expires_in: 5184000 });
    assert.equal(url.host, "fixture.supabase.co"); assert.equal(init?.method, "PATCH");
    assert.equal(url.searchParams.get("id"), `eq.${integration.id}`);
    assert.equal(url.searchParams.get("user_id"), `eq.${ACCOUNT}`);
    assert.equal(url.searchParams.get("access_token_enc"), `eq.${integration.access_token_enc}`);
    assert.equal(url.searchParams.get("resource_id"), "eq.123");
    assert.deepEqual(JSON.parse(String(url.searchParams.get("meta")).replace(/^eq\./, "")), integration.meta);
    return Response.json({ id: integration.id });
  };
  const admin = createClient("https://fixture.supabase.co", "fixture-service-key", { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: fakeFetch } });
  await withFetch(fakeFetch, async () => assert.equal(await tokens.ensureMetaDirectAccessToken(admin, integration), "refreshed-token"));
  assert.equal(urls.length, 2);
}));

test("Direct OAuth refuses HTTP and Threads refuses HTTPS localhost before any Meta request", async () => configured(async () => {
  for (const origin of ["https://localhost", "https://preview.localhost", "https://127.0.0.1", "https://[::1]"]) {
    process.env.NEXT_PUBLIC_SITE_URL = origin;
    process.env.THREADS_REDIRECT_URI = `${origin}/api/integrations/threads/callback`;
    const h = harness();
    const result = await h.module.startMetaDirectOAuth(new Request(`${origin}/start`), "threads");
    assert.equal(result.status, 503);
    assert.equal(result.body.code, "meta_oauth_config_missing");
    assert.equal(h.calls.length, 0); assert.equal(h.saves.length, 0);
  }
  process.env.NEXT_PUBLIC_SITE_URL = "http://fixture.example";
  for (const provider of ["instagram", "threads"] as const) {
    const redirectKey = provider === "instagram" ? "INSTAGRAM_DIRECT_REDIRECT_URI" : "THREADS_REDIRECT_URI";
    process.env[redirectKey] = `http://fixture.example/api/integrations/${provider === "instagram" ? "instagram-direct" : "threads"}/callback`;
    const h = harness();
    const result = await h.module.startMetaDirectOAuth(new Request("http://fixture.example/start"), provider);
    assert.equal(result.status, 503); assert.equal(result.body.code, "meta_oauth_config_missing");
    assert.match(result.body.error, /HTTPS/);
    assert.equal(h.calls.length, 0); assert.equal(h.saves.length, 0);
  }
}));

test("A callback configured on another origin cannot start OAuth or save a connection", async () => configured(async () => {
  for (const provider of ["instagram", "threads"] as const) {
    const redirectKey = provider === "instagram" ? "INSTAGRAM_DIRECT_REDIRECT_URI" : "THREADS_REDIRECT_URI";
    process.env[redirectKey] = `https://other-origin.example/api/integrations/${provider === "instagram" ? "instagram-direct" : "threads"}/callback`;
    const h = harness();
    const started = await h.module.startMetaDirectOAuth(new Request("https://fixture.example/start"), provider);
    assert.equal(started.status, 503); assert.equal(started.body.code, "meta_oauth_config_missing");
    const result = await h.module.handleMetaDirectOAuthCallback(h.callback(provider), provider);
    const destination = new URL(result.headers.get("location"));
    assert.equal(destination.origin, "https://fixture.example");
    assert.equal(destination.searchParams.get("error"), "meta_oauth_config_missing");
    assert.equal(destination.searchParams.get("ok"), "0");
    assert.equal(h.calls.length, 0); assert.equal(h.saves.length, 0);
  }
}));

test("Callback failures identify only the failed Meta step and safe numeric diagnostics", async () => configured(async () => {
  for (const failAt of ["token_exchange", "token_inspection", "long_token_exchange", "profile"] as const) {
    const h = harness({ failAt });
    const result = await h.module.handleMetaDirectOAuthCallback(h.callback("threads"), "threads");
    assert.equal(new URL(result.headers.get("location")).searchParams.get("error"), "meta_permission_or_request_failed");
    assert.equal(h.saves.length, 0);
    const event = h.events.at(-1);
    assert.equal(event.stage, failAt);
    assert.equal(event.httpStatus, 400); assert.equal(event.metaCode, 100); assert.equal(event.metaSubcode, 33);
    for (const secret of ["fixture-code-secret", "fixture-short-token", "fixture-long-token", ENV.THREADS_APP_SECRET]) assert.equal(JSON.stringify(h.events).includes(secret), false);
  }
}));

test("Connection save failure logs only the allowlisted SQLSTATE and preserves credential privacy", async () => configured(async () => {
  for (const databaseCode of ["42703", "PGRST202", "DO_NOT_EXPOSE_DATABASE_SECRET"]) {
    const h = harness({ saveError: { code: databaseCode, details: "DO_NOT_EXPOSE_DATABASE_ROW_TOKEN" } });
    const result = await h.module.handleMetaDirectOAuthCallback(h.callback("instagram"), "instagram");
    const destination = new URL(result.headers.get("location"));
    assert.equal(destination.searchParams.get("error"), "meta_connection_save_failed");
    assert.equal(h.events.at(-1).stage, "connection_save");
    assert.equal(h.events.at(-1).database_code, databaseCode.startsWith("DO_NOT") ? undefined : databaseCode);
    for (const secret of ["DO_NOT_EXPOSE_DATABASE_SECRET", "DO_NOT_EXPOSE_DATABASE_ROW_TOKEN", "fixture-code-secret", "fixture-long-token"]) {
      assert.equal(JSON.stringify(h.events).includes(secret), false);
      assert.equal(destination.toString().includes(secret), false);
    }
  }
}));

test("Threads inspects long-lived tokens using the application credential at the versioned endpoint", async () => configured(async () => {
  const h = harness();
  const result = await h.module.handleMetaDirectOAuthCallback(h.callback("threads"), "threads");
  assert.equal(new URL(result.headers.get("location")).searchParams.get("ok"), "1");
  assert.deepEqual(h.steps, ["token_exchange", "long_token_exchange", "token_inspection", "profile"]);
  const inspection = h.calls.find((call: any) => call.url.pathname.endsWith("debug_token"));
  assert.equal(inspection.url.origin, "https://graph.threads.com");
  assert.equal(inspection.url.pathname, "/v1.0/debug_token");
  assert.equal(inspection.url.searchParams.get("input_token"), "fixture-long-token");
  assert.equal(inspection.url.searchParams.get("access_token"), `TH|${ENV.THREADS_APP_ID}|${ENV.THREADS_APP_SECRET}`);
  assert.equal(inspection.url.toString().includes("fixture-short-token"), false);
  assert.equal(h.saves.length, 1);
}));

test("A non-tester Threads customer completes OAuth without using their own token as the inspector", async () => configured(async () => {
  const h = harness({ publicEnabled: true, actorAdmin: false, accountRole: "user", nonTester: true });
  const result = await h.module.handleMetaDirectOAuthCallback(h.callback("threads"), "threads");
  const destination = new URL(result.headers.get("location"));
  assert.equal(destination.searchParams.get("ok"), "1");
  assert.equal(h.saves.length, 1);
  assert.equal(h.saves[0].args.p_account_id, ACCOUNT);
  assert.equal(h.saves[0].args.p_admin_pilot, false);
  assert.deepEqual(h.saves[0].args.p_integration.meta.permissions, [...threadsGraph.THREADS_SCOPES]);
  for (const secret of [ENV.THREADS_APP_SECRET, "fixture-long-token"]) {
    assert.equal(destination.toString().includes(secret), false);
    assert.equal(JSON.stringify(h.events).includes(secret), false);
  }
}));

test("Threads inspection rejects invalid tokens, wrong apps and incomplete permissions before reading or saving", async () => configured(async () => {
  for (const options of [{ invalidDebugToken: true }, { wrongDebugApp: true }, { partialScopes: true }]) {
    const h = harness(options);
    const result = await h.module.handleMetaDirectOAuthCallback(h.callback("threads"), "threads");
    assert.equal(new URL(result.headers.get("location")).searchParams.get("error"), options.partialScopes ? "meta_permissions_incomplete" : "meta_token_invalid");
    assert.equal(h.saves.length, 0);
    assert.deepEqual(h.steps, ["token_exchange", "long_token_exchange", "token_inspection"]);
  }
  const instagram = harness({ partialScopes: true });
  await instagram.module.handleMetaDirectOAuthCallback(instagram.callback("instagram"), "instagram");
  assert.deepEqual(instagram.steps, ["token_exchange"]);
  assert.equal(instagram.saves.length, 0);
}));
