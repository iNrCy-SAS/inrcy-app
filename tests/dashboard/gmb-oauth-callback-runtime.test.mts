import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { integrationWriteSchemaError } from "../helpers/integrations-schema-contract.mts";

// The route fixture models heterogeneous JSON, PostgREST and dependency exports.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
type Db = { integrations: Row[]; configs: Row[] };

function load(file: string, modules: Row, globals: Row = {}, sourceOverride?: string): Row {
  const code = ts.transpileModule(sourceOverride ?? readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const output = { exports: {} as Row };
  new Function("require", "module", "exports", ...Object.keys(globals), code)((name: string) => {
    if (Object.hasOwn(modules, name)) return modules[name];
    throw new Error(`Unexpected dependency ${name}`);
  }, output, output.exports, ...Object.values(globals));
  return output.exports;
}

const accountName = "accounts/parent";
const oldLocation = "locations/old";
const newLocation = "locations/new";
const newToken = "new-google-access-fixture";
const scopes = "https://www.googleapis.com/auth/business.manage https://www.googleapis.com/auth/userinfo.email openid";
const oldMeta = { account: accountName, accountName, location: oldLocation, locationName: oldLocation, locationTitle: "Same title", url: "https://old.example", gmb_verification: { status: "pending" }, gmb: { account: accountName, locationName: oldLocation }, needs_reconnect: true, retained: true };
const oldSettings = { connected: true, configured: true, accountName, locationName: oldLocation, locationTitle: "Same title", resource_id: oldLocation, resource_label: "Same title", url: "https://old.example", retained: true };

function runtime(options: {
  locations?: Row[]; accounts?: Row[]; accountFailure?: boolean; accountPageFailure?: boolean; locationPageFailure?: boolean;
  nextEmail?: string; grantedScopes?: string; returnTo?: string; noExisting?: boolean; legacyPageUrlWrite?: boolean; databaseError?: Row;
  beforeIntegrationWrite?: (db: Db) => void; afterIntegrationWrite?: (db: Db) => void;
} = {}) {
  const target = { id: "gmb-row", user_id: "active-account", provider: "google", source: "gmb", product: "gmb", status: "connected", email_address: "mail@example.test", resource_id: oldLocation, resource_label: "Same title", access_token_enc: "encrypted:old-access", refresh_token_enc: "encrypted:old-refresh", meta: structuredClone(oldMeta) };
  const db: Db = { integrations: options.noExisting ? [] : [target], configs: [{ user_id: "active-account", settings: { retained: { unchanged: true }, gmb: structuredClone(oldSettings) } }] };
  const requests: Array<{ url: URL; authorization: string | null }> = [];
  const writes: Array<{ table: string; op: string; payload: Row; matched: number }> = [];
  const logs: unknown[] = [];
  let cachesCleared = 0;
  let integrationWriteStarted = false;
  function query(table: string) {
    let op = "select", payload: Row = {}, single = false, required = false;
    const filters: Array<[string, unknown]> = [];
    const q: Row = {
      select: () => q, eq: (key: string, value: unknown) => { filters.push([key, value]); return q; },
      is: (key: string, value: unknown) => { filters.push([key, value]); return q; },
      maybeSingle: () => { single = true; return q; }, single: () => { single = true; required = true; return q; },
      update: (value: Row) => { op = "update"; payload = value; return q; },
      insert: (value: Row) => { op = "insert"; payload = value; return q; },
      upsert: (value: Row) => { op = "upsert"; payload = value; return q; },
      then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
        return Promise.resolve().then(() => {
          if (table === "integrations" && op !== "select") {
            const schemaError = integrationWriteSchemaError(payload);
            if (schemaError || options.databaseError) return { data: null, error: schemaError || options.databaseError };
          }
          if (table === "integrations" && op !== "select" && !integrationWriteStarted) { integrationWriteStarted = true; options.beforeIntegrationWrite?.(db); }
          const rows = table === "integrations" ? db.integrations : db.configs;
          const matches = (row: Row) => filters.every(([key, expected]) => {
            const actual = row[key] ?? null;
            if (actual && typeof actual === "object" && typeof expected === "string") {
              try { return JSON.stringify(actual) === JSON.stringify(JSON.parse(expected)); } catch { return false; }
            }
            return actual === expected;
          });
          let selected = rows.filter(matches);
          if (op === "insert") { const inserted = { id: "inserted-gmb", ...structuredClone(payload) }; rows.push(inserted); selected = [inserted]; }
          if (op === "update") for (const row of selected) Object.assign(row, structuredClone(payload));
          if (op === "upsert") {
            const found = rows.find(row => row.user_id === payload.user_id);
            if (found) { Object.assign(found, structuredClone(payload)); selected = [found]; }
            else { rows.push(structuredClone(payload)); selected = [rows.at(-1)!]; }
          }
          const result = structuredClone(selected);
          if (op !== "select") {
            writes.push({ table, op, payload: structuredClone(payload), matched: selected.length });
            if (table === "integrations" && selected.length) options.afterIntegrationWrite?.(db);
          }
          return { data: single ? result[0] ?? null : result, error: required && result.length !== 1 ? { code: "PGRST116", message: "row changed" } : null };
        }).then(resolve, reject);
      },
    };
    return q;
  }
  const fetcher: typeof fetch = async (input, init) => {
    const url = new URL(String(input));
    requests.push({ url, authorization: new Headers(init?.headers).get("authorization") });
    if (url.hostname === "oauth2.googleapis.com") return Response.json({ access_token: newToken, expires_in: 3600, scope: options.grantedScopes ?? scopes });
    if (url.pathname === "/oauth2/v2/userinfo") return Response.json({ id: "google-user", email: options.nextEmail ?? "mail@example.test", name: "Fixture" });
    if (url.hostname === "mybusinessaccountmanagement.googleapis.com") {
      if (options.accountFailure || url.searchParams.has("pageToken")) return Response.json({ error: { message: "Temporary unavailable" } }, { status: 503 });
      return Response.json({ accounts: options.accounts ?? [{ name: accountName }], ...(options.accountPageFailure ? { nextPageToken: "next-accounts" } : {}) });
    }
    if (url.hostname === "mybusinessbusinessinformation.googleapis.com") {
      if (url.searchParams.has("pageToken")) return Response.json({ error: { message: "Temporary unavailable" } }, { status: 503 });
      return Response.json({ locations: options.locations ?? [{ name: newLocation, title: "Same title", metadata: { mapsUri: "https://maps.google.com/?cid=new" } }], ...(options.locationPageFailure ? { nextPageToken: "next-locations" } : {}) });
    }
    throw new Error("Unexpected provider request");
  };
  const safeTypes = load("lib/tsSafe.ts", {});
  const versions = load("lib/connectionVersions.ts", { "@/lib/tsSafe": safeTypes });
  const modules = {
    "next/server": { NextResponse: { redirect: (url: URL) => Object.assign(new Response(null, { status: 307, headers: { location: String(url) } }), { cookies: { set() {} } }) } },
    "@/lib/supabaseServer": { createSupabaseServer: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "actor" } }, error: null }) } }) },
    "@/lib/supabaseAdmin": { supabaseAdmin: { from: query } },
    "@/lib/statsCache": { clearAllToolCaches: async () => { cachesCleared++; } },
    "@/lib/oauthCrypto": { encryptToken: (token: string) => `encrypted:${token}` },
    "@/lib/googleBusinessLocations": load("lib/googleBusinessLocations.ts", {}, { fetch: fetcher }),
    "@/lib/googleBusinessSelectionPolicy": load("lib/googleBusinessSelectionPolicy.ts", {}),
    "@/lib/rateLimit": { enforceRateLimit: async () => null, getClientIp: () => "fixture-ip" },
    "@/lib/security": { safeInternalPath: (value: string) => value, verifyOAuthState: () => ({ ok: true, returnTo: options.returnTo ?? "/dashboard?panel=gmb", cookieName: "fixture-oauth", state: { accountId: "active-account" } }) },
    "@/lib/tsSafe": safeTypes,
    "@/lib/observability/oauth": { oauthCallbackEvent: (_request: Request, event: unknown) => logs.push(event), oauthCallbackException: (...args: unknown[]) => logs.push(args.slice(1)) },
    "@/lib/userFacingErrors": { getSimpleFrenchErrorMessage: (message: unknown, fallback: string) => typeof message === "string" ? message : fallback },
    "@/lib/observability/logger": { log: { warn: (...args: unknown[]) => logs.push(args) } },
    "@/lib/googleOAuthConsent": load("lib/googleOAuthConsent.ts", {}),
    "@/lib/connectionVersions": versions,
    "@/lib/multicompte/server": { resolveOAuthBoundInrcyAccountId: async () => "active-account" },
  };
  const callbackSource = options.legacyPageUrlWrite ? readFileSync(new URL("../../app/api/integrations/google-business/callback/route.ts", import.meta.url), "utf8").replace(".insert(payload)", ".insert({ ...payload, page_url: null })").replace(".update(payload)", ".update({ ...payload, page_url: null })") : undefined;
  const callback = load("app/api/integrations/google-business/callback/route.ts", modules, { fetch: fetcher, process: { env: { GOOGLE_CLIENT_ID: "fixture-client", GOOGLE_CLIENT_SECRET: "fixture-secret" } } }, callbackSource);
  const reviews = load("lib/googleBusinessReviews.ts", { "server-only": {}, "@/lib/tsSafe": safeTypes });
  return { db, requests, writes, logs, get cachesCleared() { return cachesCleared; }, reviews,
    run: async () => new URL((await callback.GET(new Request("https://app.example/api/integrations/google-business/callback?code=fixture-code&state=fixture-state")) as Response).headers.get("location")!),
  };
}

test("an inaccessible old ID is cleared even when the only Google result has exactly the same title", async () => {
  const h = runtime(); const destination = await h.run(); const row = h.db.integrations[0];
  assert.equal(destination.searchParams.get("ok"), "1");
  assert.equal(destination.searchParams.get("warning"), "gmb_selection_required");
  assert.equal(row.status, "account_connected");
  assert.equal(row.resource_id, null); assert.equal(row.resource_label, null); assert.equal(Object.hasOwn(row, "page_url"), false);
  assert.equal(row.access_token_enc, `encrypted:${newToken}`);
  assert.equal(row.refresh_token_enc, "encrypted:old-refresh");
  assert.equal(row.meta.needs_reconnect, undefined);
  assert.equal(row.meta.gmb_verification, undefined);
  assert.equal(row.meta.url, null);
  assert.equal(h.reviews.getGmbReviewTargetFromRow(row).locationName, null, "legacy meta cannot revive the old target");
  const mirror = h.db.configs[0].settings.gmb;
  assert.equal(mirror.connected, true); assert.equal(mirror.configured, false);
  for (const key of ["locationName", "locationTitle", "resource_id", "resource_label", "url"]) assert.equal(mirror[key], null);
  assert.equal(h.db.configs[0].settings.retained.unchanged, true);
  assert.equal(h.cachesCleared, 1);
  const discovery = h.requests.filter(request => request.url.hostname.startsWith("mybusiness"));
  assert.equal(discovery.length, 2);
  assert.ok(discovery.every(request => request.authorization === `Bearer ${newToken}`));
  assert.equal(h.writes.filter(write => write.table === "integrations").length, 1, "no late account-hint write");
});

test("a confirmed exact target survives OAuth with fresh provider label and URL", async () => {
  const h = runtime({ locations: [{ name: oldLocation, title: "Fresh title", metadata: { mapsUri: "https://maps.google.com/?cid=verified" } }] });
  const destination = await h.run(); const row = h.db.integrations[0];
  assert.equal(destination.searchParams.get("warning"), null);
  assert.equal(row.status, "connected"); assert.equal(row.resource_id, oldLocation);
  assert.equal(row.resource_label, "Fresh title");
  assert.equal(row.meta.url, "https://maps.google.com/?cid=verified");
  assert.equal(row.meta.gmb_verification, undefined, "fresh OAuth must not reuse an older business validation");
  assert.equal(h.db.configs[0].settings.gmb.url, row.meta.url);
  assert.equal(h.reviews.getGmbReviewTargetFromRow(row).locationName, oldLocation);
});

for (const failure of ["accountFailure", "accountPageFailure", "locationPageFailure"] as const) {
  test(`${failure}: partial discovery never preserves a target, even if its first page contains it`, async () => {
    const h = runtime({ [failure]: true, locations: [{ name: oldLocation, title: "Same title" }] });
    assert.equal((await h.run()).searchParams.get("ok"), "1");
    assert.equal(h.db.integrations[0].status, "account_connected");
    assert.equal(h.db.integrations[0].resource_id, null);
    assert.equal(h.db.integrations[0].refresh_token_enc, "encrypted:old-refresh");
    assert.doesNotMatch(JSON.stringify(h.logs), /new-google-access-fixture|encrypted:old-refresh/);
  });
}

test("changing Google identity never retains the previous target or refresh credential", async () => {
  const h = runtime({ nextEmail: "other@example.test" }); await h.run();
  assert.equal(h.db.integrations[0].status, "account_connected");
  assert.equal(h.db.integrations[0].resource_id, null);
  assert.equal(h.db.integrations[0].refresh_token_enc, null);
  assert.equal(h.reviews.getGmbReviewTargetFromRow(h.db.integrations[0]).locationName, null);
  assert.equal(h.requests.filter(request => request.url.hostname.startsWith("mybusiness")).length, 0);
});

test("losing the exact parent never rebinds an identically named location under another account", async () => {
  const h = runtime({ accounts: [{ name: "accounts/other" }], locations: [{ name: oldLocation, title: "Same title" }] });
  assert.equal((await h.run()).searchParams.get("ok"), "1");
  assert.equal(h.db.integrations[0].status, "account_connected");
  assert.equal(h.db.integrations[0].resource_id, null);
  assert.equal(h.db.integrations[0].meta.account, null);
  assert.equal(h.requests.filter(request => request.url.hostname === "mybusinessbusinessinformation.googleapis.com").length, 0);
});

test("a new authorization without an existing integration saves no selection from a stale mirror", async () => {
  const h = runtime({ noExisting: true });
  assert.equal((await h.run()).searchParams.get("ok"), "1");
  assert.equal(h.db.integrations[0].status, "account_connected");
  assert.equal(h.db.integrations[0].resource_id, null);
  assert.equal(h.db.integrations[0].access_token_enc, `encrypted:${newToken}`);
  assert.equal(h.db.integrations[0].refresh_token_enc, null);
  assert.equal(Object.hasOwn(h.db.integrations[0], "page_url"), false);
});

for (const noExisting of [true, false]) {
  test(`${noExisting ? "INSERT" : "UPDATE"}: the real callback preserves the selected URL only inside existing JSON columns`, async () => {
    const h = runtime({ noExisting, locations: [{ name: oldLocation, title: "Exact fiche", metadata: { mapsUri: "https://maps.google.com/?cid=verified" } }] });
    assert.equal((await h.run()).searchParams.get("ok"), "1");
    assert.equal(h.db.integrations[0].meta.url, "https://maps.google.com/?cid=verified");
    assert.equal(h.db.configs[0].settings.gmb.url, h.db.integrations[0].meta.url);
    assert.equal(Object.hasOwn(h.db.integrations[0], "page_url"), false);
    assert.ok(h.writes.filter(write => write.table === "integrations").every(write => integrationWriteSchemaError(write.payload) === null));
  });
  test(`${noExisting ? "INSERT" : "UPDATE"}: the former page_url SQL payload is rejected by the production-schema fixture`, async () => {
    const h = runtime({ noExisting, legacyPageUrlWrite: true }); const before = structuredClone(h.db);
    const result = await h.run();
    assert.equal(result.searchParams.get("ok"), "0");
    assert.equal(result.searchParams.get("error"), noExisting ? "db_insert_failed" : "db_update_failed");
    assert.deepEqual(h.db, before, "an unsupported SQL column cannot save credentials or change the old target");
    assert.equal(h.writes.length, 0); assert.equal(h.cachesCleared, 0);
    assert.ok(h.logs.some(event => event && typeof event === "object" && (event as Row).db_code === "PGRST204"));
  });
}

test("callback database diagnostics retain only a normalized code and never raw provider details", async () => {
  for (const code of ["42703", "https://fixture.invalid/token-canary?secret=fixture-token-canary"]) {
    const h = runtime({ noExisting: true, databaseError: { code, message: "fixture-token-canary", details: "fixture-token-canary" } });
    const result = await h.run();
    assert.equal(result.searchParams.get("error"), "db_insert_failed");
    assert.doesNotMatch(`${result}\n${JSON.stringify(h.logs)}`, /fixture-token-canary/);
    const diagnostics = h.logs.filter(event => event && typeof event === "object" && Object.hasOwn(event as object, "db_code"));
    assert.ok(diagnostics.every(event => (event as Row).db_code === "42703"));
    if (code === "42703") assert.equal(diagnostics.length, 1);
  }
});

test("a valid callback removes an older permission failure from the return URL", async () => {
  const h = runtime({ returnTo: "/dashboard?panel=gmb&error=google_permissions_incomplete&message=old&toast=old&warning=old&skipped=1" });
  const destination = await h.run();
  assert.equal(destination.searchParams.get("ok"), "1");
  for (const key of ["error", "message", "toast", "skipped"]) assert.equal(destination.searchParams.get(key), null);
  assert.equal(destination.searchParams.get("warning"), "gmb_selection_required");
});

test("a later explicit selection wins over a callback still verifying its older candidate", async () => {
  const h = runtime({ beforeIntegrationWrite: db => Object.assign(db.integrations[0], { resource_id: newLocation, meta: { account: accountName, connection_version: 1, connection_version_updated_at: "newer-choice" } }) });
  const destination = await h.run();
  assert.equal(destination.searchParams.get("ok"), "0");
  assert.equal(h.db.integrations[0].resource_id, newLocation);
  assert.equal(h.db.integrations[0].meta.connection_version_updated_at, "newer-choice");
  assert.equal(h.writes.find(write => write.table === "integrations")?.matched, 0);
});

for (const changed of ["credential", "metadata", "disconnect"] as const) {
  test(`a concurrent ${changed} change cannot be replaced by this callback snapshot`, async () => {
    const h = runtime({ beforeIntegrationWrite: db => {
      if (changed === "disconnect") db.integrations.length = 0;
      else if (changed === "credential") db.integrations[0].access_token_enc = "encrypted:newer-authorization";
      else db.integrations[0].meta = { ...db.integrations[0].meta, connection_version_updated_at: "newer-authorization" };
    } });
    assert.equal((await h.run()).searchParams.get("ok"), "0");
    assert.equal(h.writes.find(write => write.table === "integrations")?.matched, 0);
    if (changed === "disconnect") assert.equal(h.db.integrations.length, 0);
    else if (changed === "credential") assert.equal(h.db.integrations[0].access_token_enc, "encrypted:newer-authorization");
    else assert.equal(h.db.integrations[0].meta.connection_version_updated_at, "newer-authorization");
  });
}

test("no trailing hint or mirror overwrite can roll back a selection completed after the OAuth write", async () => {
  const h = runtime({ afterIntegrationWrite: db => {
    Object.assign(db.integrations[0], { resource_id: newLocation, resource_label: "Explicit choice", status: "connected", meta: { account: accountName, connection_version: 1, connection_version_updated_at: "newer-choice" } });
    db.configs[0].settings.gmb = { connected: true, configured: true, accountName, resource_id: newLocation, locationName: newLocation, url: "https://explicit.example" };
  } });
  assert.equal((await h.run()).searchParams.get("ok"), "1");
  assert.equal(h.db.integrations[0].resource_id, newLocation);
  assert.equal(h.db.configs[0].settings.gmb.locationName, newLocation);
  assert.equal(h.db.configs[0].settings.gmb.url, "https://explicit.example");
  assert.equal(h.writes.filter(write => write.table === "integrations").length, 1);
});

test("partial Google consent cannot persist anything", async () => {
  const h = runtime({ grantedScopes: "https://www.googleapis.com/auth/business.manage" });
  const before = structuredClone(h.db); const destination = await h.run();
  assert.equal(destination.searchParams.get("error"), "google_permissions_incomplete");
  assert.equal(destination.searchParams.get("ok"), "0");
  assert.deepEqual(h.db, before); assert.equal(h.writes.length, 0);
});
