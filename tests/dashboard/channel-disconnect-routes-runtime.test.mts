import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import ts from "typescript";

const require = createRequire(import.meta.url);
// The isolated loader intentionally models heterogeneous route dependencies.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const asRecord = (value: unknown): Row => value && typeof value === "object" ? value as Row : {};

function load(file: string, modules: Row, globals: Row = {}) {
  const output = ts.transpileModule(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const loadedModule = { exports: {} as Row };
  new Function("require", "module", "exports", ...Object.keys(globals), output)(
    (name: string) => {
      if (name in modules) return modules[name];
      if (name === "server-only") return {};
      if (name === "crypto") return require("node:crypto");
      throw new Error(`Unexpected dependency ${name}`);
    }, loadedModule, loadedModule.exports, ...Object.values(globals),
  );
  return loadedModule.exports;
}

const routeCases = [
  { channel: "Google Business", route: "google-business/disconnect-account", provider: "google", source: "gmb", product: "gmb" },
  { channel: "Facebook", route: "facebook/disconnect-account", provider: "facebook", source: "facebook", product: "facebook" },
  { channel: "Instagram", route: "instagram/disconnect-account", provider: "instagram", source: "instagram", product: "instagram" },
  { channel: "LinkedIn", route: "linkedin/disconnect-account", provider: "linkedin", source: "linkedin", product: "linkedin" },
  { channel: "TikTok", route: "tiktok/disconnect-account", provider: "tiktok", source: "tiktok", product: "tiktok" },
  { channel: "YouTube", route: "youtube-shorts/disconnect", provider: "youtube", source: "youtube_shorts", product: "youtube_shorts" },
  { channel: "X", route: "x/disconnect", provider: "x", source: "x", product: "x" },
  { channel: "Pinterest", route: "pinterest/disconnect", provider: "pinterest", source: "pinterest", product: "pinterest" },
  { channel: "Gmail", route: "google/disconnect", provider: "gmail", category: "mail" },
  { channel: "Microsoft", route: "microsoft/disconnect", provider: "microsoft", category: "mail" },
  { channel: "IMAP", route: "imap/disconnect", provider: "imap", category: "mail" },
  { channel: "GA4", route: "google-stats/disconnect", provider: "google", source: "site_web", product: "ga4" },
  { channel: "GSC", route: "google-stats/disconnect", provider: "google", source: "site_web", product: "gsc" },
];

function routeRuntime(entry: typeof routeCases[number], options: { failWrite?: boolean; keepDeletedRow?: boolean; fetch?: typeof fetch } = {}) {
  const target = { id: "selected", user_id: "active-account", status: "connected", access_token_enc: "encrypted:access", refresh_token_enc: "encrypted:refresh", ...entry };
  const preserved = [
    { ...target, id: "other-account", user_id: "other-account" },
    { ...target, id: "other-provider", provider: `${entry.provider}_other` },
    ...(entry.provider === "google" ? [
      { ...target, id: "other-google-product", product: entry.product === "ga4" ? "gsc" : "ga4" },
      { ...target, id: "other-google-source", source: "sibling" },
    ] : []),
    ...(entry.category === "mail" ? [{ ...target, id: "other-mailbox" }] : []),
  ];
  let rows: Row[] = [target, ...structuredClone(preserved)];
  let settings: Row = { retained: { unchanged: true }, gmb: { connected: true }, facebook: {}, instagram: {}, linkedin: {}, site_web: { url: "https://example.test", ga4: { property_id: "fixture" }, gsc: { property: "fixture" } } };
  const events: string[] = [];
  function query(table: string) {
    let op = "select", patch: Row = {}, single = false;
    const filters: Array<[string, unknown]> = [];
    const q: Row = {
      select: () => q, eq: (key: string, value: unknown) => { filters.push([key, value]); return q; },
      limit: () => q, maybeSingle: () => { single = true; return q; }, single: () => { single = true; return q; },
      delete: () => { op = "delete"; return q; }, update: (value: Row) => { op = "update"; patch = value; return q; },
      upsert: (value: Row) => { op = "upsert"; patch = value; return q; },
      then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
        try {
          events.push(`${table}:${op}`);
          if (table === "pro_tools_configs") {
            if (op === "upsert") settings = patch.settings;
            return Promise.resolve({ data: { settings }, error: null }).then(resolve, reject);
          }
          assert.equal(table, "integrations");
          const matches = (row: Row) => filters.every(([key, value]) => row[key] === value);
          let data = rows.filter(matches);
          if (op !== "select" && options.failWrite) return Promise.resolve({ data: null, error: { message: "Synthetic database failure" } }).then(resolve, reject);
          if (op === "delete" && !options.keepDeletedRow) rows = rows.filter(row => !matches(row));
          if (op === "update") data = data.map(row => Object.assign(row, patch));
          return Promise.resolve({ data: single ? data[0] ?? null : data, error: null }).then(resolve, reject);
        } catch (error) { return Promise.reject(error).then(resolve, reject); }
      },
    };
    return q;
  }
  const database = { from: query };
  const supabase = { ...database, auth: { getUser: async () => ({ data: { user: { id: "authenticated-user" } }, error: null }) } };
  const jsonError = (_error: unknown, init: { status?: number } = {}) => Response.json({ error: "Synthetic failure" }, { status: init.status ?? 500 });
  const readSettings = async () => ({ root: settings, tiktok: {}, youtubeShorts: {} });
  const saveSettings = async (_db: unknown, id: string, root: Row, next: Row) => { assert.equal(id, "active-account"); settings = { ...root, [entry.source || "mail"]: next }; };
  const modules: Row = {
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "@/lib/supabaseServer": { createSupabaseServer: async () => supabase },
    "@/lib/supabaseAdmin": { supabaseAdmin: database },
    "@/lib/requireUser": { requireUser: async () => ({ supabase, user: { id: "authenticated-user" }, activeUserId: "active-account", errorResponse: null }) },
    "@/lib/multicompte/server": { resolveActiveInrcyAccountId: async () => "active-account" },
    "@/lib/apiUserFacingErrors": { jsonUserFacingError: jsonError },
    "@/lib/statsCache": { clearAllToolCaches: async () => { events.push("cache:invalidate"); } },
    "@/lib/googleOAuthRevoke": { shouldRevokeGoogleTokensForDisconnect: async () => false, revokeGoogleTokensBestEffort: async () => { throw new Error("Shared credentials must not be revoked"); } },
    "@/lib/xOAuth": { revokeXTokensBestEffort: async () => { events.push("x:revoke"); } },
    "@/lib/oauthCrypto": { tryDecryptToken: (value: string) => value?.replace("encrypted:", "") },
    "@/lib/instagramAuthMode": { resolveInstagramAuthMode: () => "facebook_login" },
    "@/lib/metaDirectConnectionRoutes": { disconnectMetaDirectConnection: () => { throw new Error("Unexpected direct auth mode"); } },
    "@/lib/tiktokSettings": { buildTiktokSettingsPatch: (current: Row, patch: Row) => ({ ...current, ...patch }) },
    "@/lib/tiktokRouteStorage": { readTiktokSettings: readSettings, saveTiktokSettings: saveSettings },
    "@/lib/youtubeShortsOAuth": { isYoutubeUsingDedicatedOAuthClient: () => false, readYoutubeShortsSettings: readSettings, saveYoutubeShortsSettings: saveSettings },
    "@/lib/appBubbleAccessServer": { isAppBubbleEnabledForUser: async () => true },
    "@/lib/pinterestOAuth": { PINTEREST_PROVIDER: "pinterest", PINTEREST_SOURCE: "pinterest", PINTEREST_PRODUCT: "pinterest" },
    "@/lib/connectionVersions": { withCurrentConnectionVersion: (_kind: string, meta: Row) => meta },
    "@/lib/sitePresenceSync": { syncSitePresenceIntegrations: async () => { events.push("site:sync"); } },
    "@/lib/tsSafe": { asRecord },
  };
  const route = load(`app/api/integrations/${entry.route}/route.ts`, modules, {
    fetch: options.fetch ?? (async () => Response.json({})), process: { env: { TIKTOK_CLIENT_KEY: "synthetic", TIKTOK_CLIENT_SECRET: "synthetic" } },
  });
  const request = new Request(`http://localhost/api/integrations/${entry.route}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(entry.category === "mail" ? { accountId: "selected" } : { source: entry.source, product: entry.product }) });
  return { run: () => route.POST(request) as Promise<Response>, rows: () => rows, settings: () => settings, preserved, events };
}

for (const entry of routeCases) {
  test(`${entry.channel}: disconnect persists only the selected channel/account and preserves sibling connections`, async () => {
    const runtime = routeRuntime(entry);
    const response = await runtime.run();
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
    const remaining = runtime.rows().find(row => row.id === "selected");
    assert.ok(!remaining || (remaining.status === "disconnected" && !remaining.access_token_enc && !remaining.refresh_token_enc));
    assert.deepEqual(runtime.rows().filter(row => row.id !== "selected"), runtime.preserved);
    assert.deepEqual(runtime.settings().retained, { unchanged: true });
  });
  test(`${entry.channel}: persistence failure is not reported as a successful disconnect`, async () => {
    const runtime = routeRuntime(entry, { failWrite: true });
    assert.equal((await runtime.run()).status, 500);
    assert.equal(runtime.rows()[0].status, "connected");
  });
}

for (const entry of routeCases.filter(entry => ["Google Business", "Facebook", "Instagram", "LinkedIn", "TikTok", "YouTube"].includes(entry.channel))) {
  test(`${entry.channel}: a still-present integration fails verification`, async () => {
    const runtime = routeRuntime(entry, { keepDeletedRow: true });
    assert.equal((await runtime.run()).status, 500);
  });
}

function revokeRuntime(file: string, stalled: boolean) {
  const controllers: AbortController[] = [], budgets: number[] = [], requests: RequestInit[] = [];
  const modules: Row = {
    "@/lib/oauthCrypto": { tryDecryptToken: (value: string) => value || null },
    "@/lib/tsSafe": { asRecord, safeErrorMessage: () => "provider unavailable" },
    "@/lib/observability/logger": { log: { warn() {}, info() {} } },
    "@/lib/supabaseAdmin": { supabaseAdmin: {} },
  };
  const exports = load(file, modules, {
    process: { env: { X_CLIENT_ID: "synthetic" } },
    AbortSignal: { timeout: (ms: number) => { budgets.push(ms); const controller = new AbortController(); controllers.push(controller); return controller.signal; } },
    fetch: async (_url: string, init: RequestInit) => {
      requests.push(init);
      if (!stalled) return Response.json({});
      return new Promise((_resolve, reject) => init.signal!.addEventListener("abort", () => reject(new Error("Synthetic timeout")), { once: true }));
    },
  });
  return { exports, controllers, budgets, requests };
}

for (const entry of [
  { name: "Google", file: "lib/googleOAuthRevoke.ts", method: "revokeGoogleTokensBestEffort" },
  { name: "X", file: "lib/xOAuth.ts", method: "revokeXTokensBestEffort" },
]) {
  test(`${entry.name}: an unavailable revoke endpoint cannot hold disconnection beyond one 1500ms budget`, async () => {
    const runtime = revokeRuntime(entry.file, true);
    const pending = runtime.exports[entry.method]({ accessTokenEnc: "access", refreshTokenEnc: "refresh" });
    assert.deepEqual(runtime.budgets, [1500]);
    assert.equal(runtime.requests.length, 1);
    runtime.controllers[0].abort();
    await pending;
    assert.equal(runtime.requests.length, 1, "Do not start a second request after the deadline");
  });
  test(`${entry.name}: responsive revocation still attempts both distinct credentials within the same budget`, async () => {
    const runtime = revokeRuntime(entry.file, false);
    await runtime.exports[entry.method]({ accessTokenEnc: "access", refreshTokenEnc: "refresh" });
    assert.equal(runtime.requests.length, 2);
    assert.equal(runtime.requests[0].signal, runtime.requests[1].signal);
    assert.deepEqual(runtime.budgets, [1500]);
  });
}

test("TikTok: revoked-provider timeout still allows verified local disconnection", async () => {
  let requestSignal: AbortSignal | null | undefined;
  const entry = routeCases.find(item => item.channel === "TikTok")!;
  const runtime = routeRuntime(entry, { fetch: async (_url, init) => {
    requestSignal = init?.signal;
    assert.ok(requestSignal);
    throw new DOMException("Synthetic provider timeout", "TimeoutError");
  } });
  assert.equal((await runtime.run()).status, 200);
  assert.ok(requestSignal);
  assert.ok(!runtime.rows().some(row => row.id === "selected"));
});

function googleSafetyRuntime(rows: Row[], error: unknown = null) {
  const query: Row = {
    select: () => query,
    eq: (key: string, value: string) => { assert.deepEqual([key, value], ["user_id", "active-account"]); return query; },
    in: async (key: string, providers: string[]) => {
      assert.equal(key, "provider");
      assert.deepEqual(providers, ["google", "gmail", "youtube"]);
      return { data: rows, error };
    },
  };
  return load("lib/googleOAuthRevoke.ts", {
    "@/lib/oauthCrypto": {},
    "@/lib/tsSafe": { safeErrorMessage: () => "Synthetic error" },
    "@/lib/observability/logger": { log: { warn() {}, info() {} } },
    "@/lib/supabaseAdmin": { supabaseAdmin: { from: () => query } },
  }).shouldRevokeGoogleTokensForDisconnect;
}

for (const provider of ["google", "gmail", "youtube"]) {
  test(`Google revocation preserves the same account's active ${provider} sibling`, async () => {
    const check = googleSafetyRuntime([{ id: "sibling", provider, status: "account_connected", account_email: "SHARED@EXAMPLE.TEST" }]);
    assert.equal(await check({ userId: "active-account", rows: [{ id: "selected", email_address: "shared@example.test" }] }), false);
  });
}
test("Google revocation fails safe when sibling-state lookup is unavailable or identity is unknown", async () => {
  assert.equal(await googleSafetyRuntime([], new Error("Synthetic failure"))({ userId: "active-account", rows: [{ id: "selected", email_address: "shared@example.test" }] }), false);
  assert.equal(await googleSafetyRuntime([])({ userId: "active-account", rows: [{ id: "selected" }] }), false);
});
test("Google revocation remains enabled when only the disconnected integration owns the account", async () => {
  const selected = { id: "selected", provider_account_id: "google-account", status: "connected" };
  assert.equal(await googleSafetyRuntime([selected])({ userId: "active-account", rows: [selected] }), true);
});

for (const provider of ["instagram", "threads"]) {
  for (const scenario of ["success", "rpc-error", "foreign-origin"]) {
    test(`${provider} direct: ${scenario} preserves the atomic scoped disconnect contract`, async () => {
      const calls: Row[] = [];
      const route = load("lib/metaDirectConnectionRoutes.ts", {
        "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
        "@/lib/multicompte/server": { getCurrentInrcyAccountScope: async () => ({ supabase: {}, scope: { activeUserId: "active-account" } }) },
        "@/lib/supabaseAdmin": { supabaseAdmin: { rpc: async (name: string, args: Row) => { calls.push({ name, args }); return { error: scenario === "rpc-error" ? new Error("Synthetic error") : null }; } } },
        "@/lib/channelConnectionState": {},
        "@/lib/metaChannelRolloutServer": { isMetaChannelPilotEnabledForActorAndAccount: async () => true },
        "@/lib/metaChannelRollout": { META_DIRECT_CHANNELS_PUBLIC_ENABLED: false },
        "@/lib/metaDirectOAuth": {},
        "@/lib/statsCache": { clearAllToolCaches: async () => {} },
      });
      const request = new Request("http://localhost/disconnect", { method: "POST", headers: { origin: scenario === "foreign-origin" ? "https://untrusted.example" : "http://localhost" } });
      const response = await route.disconnectMetaDirectConnection(request, provider);
      assert.equal(response.status, scenario === "success" ? 200 : scenario === "rpc-error" ? 503 : 403);
      assert.deepEqual(calls, scenario === "foreign-origin" ? [] : [{ name: "disconnect_meta_direct_connection", args: { p_account_id: "active-account", p_channel: provider, p_admin_pilot: true } }]);
    });
  }
}
