import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { isDeepStrictEqual } from "node:util";
import ts from "typescript";

// The real module is transpiled against an isolated in-memory database and fake Google transport.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type RuntimeValue = any;
type Row = Record<string, RuntimeValue>;
const uid = "fixture-account";
const fixture = (patch: Row = {}): Row => ({
  id: "fixture-integration", user_id: uid, provider: "google", source: "gmb", product: "gmb",
  status: "connected", email_address: "fixture@example.invalid", scopes: "https://www.googleapis.com/auth/business.manage",
  access_token_enc: "enc:old-access", refresh_token_enc: "enc:old-refresh", expires_at: "2000-01-01T00:00:00.000Z",
  resource_id: "locations/old", resource_label: "Fixture",
  meta: { account: "accounts/1", connection_version: 1, connection_version_updated_at: "2026-01-01T00:00:00.000Z" },
  ...patch,
});
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const successful = () => Response.json({ access_token: "refreshed-access", expires_in: 3600 });
const rejected = () => Response.json({ error: "invalid_grant", error_description: "Token has been expired or revoked." }, { status: 400 });

function runtime(options: {
  initial?: Row;
  fetch?: (call: number, body: URLSearchParams) => Promise<Response>;
  writeError?: boolean;
  beforeWrite?: (h: ReturnType<typeof runtime>) => void;
} = {}) {
  let row = structuredClone(options.initial ?? fixture());
  let calls = 0;
  let reads = 0;
  let writeAttempts = 0;
  const writes: Row[] = [];
  const logs: unknown[] = [];
  const db = { from(table: string) {
    assert.equal(table, "integrations");
    const predicates: Array<(r: Row) => boolean> = [];
    let patch: Row | null = null;
    let single = false;
    const execute = () => {
      if (patch) {
        writeAttempts++;
        options.beforeWrite?.(handle);
        if (options.writeError) return { data: null, error: { code: "fixture_failure" } };
      } else reads++;
      const matches = predicates.every(predicate => predicate(row));
      if (patch && matches) { row = { ...row, ...structuredClone(patch) }; writes.push(structuredClone(patch)); }
      return { data: single ? (matches ? structuredClone(row) : null) : (matches ? [structuredClone(row)] : []), error: null };
    };
    const query = {
      select() { return this; }, order() { return this; }, limit() { return this; },
      maybeSingle() { single = true; return this; },
      eq(key: string, value: RuntimeValue) {
        const expected = key === "meta" && typeof value === "string" ? JSON.parse(value) : value;
        predicates.push(r => isDeepStrictEqual(r[key], expected)); return this;
      },
      is(key: string, value: RuntimeValue) { predicates.push(r => value === null ? r[key] == null : r[key] === value); return this; },
      in(key: string, values: unknown[]) { predicates.push(r => values.includes(r[key])); return this; },
      update(value: Row) { patch = value; return this; },
      then(resolve: RuntimeValue, reject: RuntimeValue) { return Promise.resolve().then(execute).then(resolve, reject); },
    };
    return query;
  } };
  const dependencies: Record<string, unknown> = {
    "@/lib/supabaseServer": { createSupabaseServer: async () => db },
    "@/lib/multicompte/server": { resolveActiveInrcyAccountId: async () => uid },
    "@/lib/supabaseAdmin": { supabaseAdmin: db },
    "@/lib/oauthCrypto": { tryDecryptToken: (value: string | null) => value?.replace(/^enc:/, "") ?? null, encryptToken: (value: string) => `enc:${value}` },
    "@/lib/googleStatsConnectionPolicy": { canRetryGoogleStatsIntegration: () => true, isGoogleStatsRefreshRetryDeferred: () => false },
  };
  const source = readFileSync(new URL("../../lib/googleStats.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const fixtureModule = { exports: {} as Row };
  const fetch = async (url: string, init: RequestInit) => {
    assert.equal(url, "https://oauth2.googleapis.com/token");
    calls++;
    return options.fetch ? options.fetch(calls, init.body as URLSearchParams) : successful();
  };
  new Function("require", "module", "exports", "fetch", "process", "console", code)(
    (name: string) => { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; },
    fixtureModule, fixtureModule.exports, fetch,
    { env: { GOOGLE_CLIENT_ID: "fixture-client", GOOGLE_CLIENT_SECRET: "fixture-secret" } },
    { error: (...args: unknown[]) => logs.push(args) },
  );
  const handle = {
    get row() { return row; }, set row(next: Row) { row = structuredClone(next); },
    get calls() { return calls; }, get reads() { return reads; }, get writeAttempts() { return writeAttempts; },
    writes, logs,
    run: () => fixtureModule.exports.getGoogleTokenForAnyGoogle("gmb", "gmb", { supabase: db, userId: uid }),
    runGa4: () => fixtureModule.exports.getGoogleTokenFor("site_web", "ga4", { supabase: db, userId: uid }),
  };
  return handle;
}

test("a valid GMB access token works without a refresh token or database write", async () => {
  const h = runtime({ initial: fixture({ expires_at: "2099-01-01T00:00:00.000Z", refresh_token_enc: null }) });
  const result = await h.run();
  assert.equal(result.accessToken, "old-access");
  assert.equal(h.calls, 0);
  assert.equal(h.writeAttempts, 0);
});

test("GMB refresh returns the persisted snapshot and preserves account_connected without a selected target", async () => {
  const h = runtime({ initial: fixture({ status: "account_connected", resource_id: null, resource_label: null, meta: null }) });
  const result = await h.run();
  assert.equal(h.calls, 1);
  assert.equal(h.row.status, "account_connected");
  assert.equal(result.row.status, "account_connected");
  assert.equal(result.row.access_token_enc, "enc:refreshed-access");
  assert.equal(result.row.expires_at, h.row.expires_at);
  assert.equal(result.row.resource_id, null);
  assert.deepEqual(result.row.meta, null);
});

test("an old invalid_grant cannot disconnect a newer OAuth connection", async () => {
  const began = deferred<void>(), finish = deferred<Response>();
  const h = runtime({ fetch: async () => { began.resolve(); return finish.promise; } });
  const pending = h.run();
  await began.promise;
  h.row = fixture({ access_token_enc: "enc:new-access", refresh_token_enc: "enc:new-refresh", expires_at: "2099-01-01T00:00:00.000Z", resource_id: "locations/new", meta: { account: "accounts/2", connection_version_updated_at: "2099-01-01T00:00:00.000Z" } });
  finish.resolve(rejected());
  const result = await pending;
  assert.equal(result.accessToken, "new-access");
  assert.equal(result.row.resource_id, "locations/new");
  assert.equal(h.row.status, "connected");
  assert.equal(h.row.meta.needs_reconnect, undefined);
  assert.equal(h.writes.length, 0);
});

test("an old refresh success cannot replace a newer OAuth token or return its former target", async () => {
  const began = deferred<void>(), finish = deferred<Response>();
  const h = runtime({ fetch: async () => { began.resolve(); return finish.promise; } });
  const pending = h.run();
  await began.promise;
  h.row = fixture({ access_token_enc: "enc:new-access", refresh_token_enc: "enc:new-refresh", expires_at: "2099-01-01T00:00:00.000Z", resource_id: "locations/new" });
  finish.resolve(successful());
  const result = await pending;
  assert.equal(result.accessToken, "new-access");
  assert.equal(result.row.resource_id, "locations/new");
  assert.equal(h.row.access_token_enc, "enc:new-access");
  assert.equal(h.writes.length, 0);
});

test("a selection made during token renewal is retained and returned after a bounded retry", async () => {
  const began = deferred<void>(), finish = deferred<Response>();
  const h = runtime({ fetch: async call => { if (call === 1) { began.resolve(); return finish.promise; } return successful(); } });
  const pending = h.run();
  await began.promise;
  h.row = { ...h.row, resource_id: "locations/new", resource_label: "New fixture", meta: { ...h.row.meta, account: "accounts/2" } };
  finish.resolve(successful());
  const result = await pending;
  assert.equal(h.calls, 2);
  assert.equal(h.writes.length, 1);
  assert.equal(result.row.resource_id, "locations/new");
  assert.equal(result.row.meta.account, "accounts/2");
  assert.equal(result.row.access_token_enc, h.row.access_token_enc);
});

test("a stale refresh cannot resurrect a user-disconnected GMB connection", async () => {
  const began = deferred<void>(), finish = deferred<Response>();
  const h = runtime({ fetch: async () => { began.resolve(); return finish.promise; } });
  const pending = h.run();
  await began.promise;
  h.row = { ...h.row, status: "disconnected", access_token_enc: null, refresh_token_enc: null, resource_id: null };
  finish.resolve(successful());
  assert.equal(await pending, null);
  assert.equal(h.row.status, "disconnected");
  assert.equal(h.writes.length, 0);
});

test("a concurrently renewed GMB token wins over an older invalid_grant response", async () => {
  const began = deferred<void>(), finish = deferred<Response>();
  const h = runtime({ fetch: async () => { began.resolve(); return finish.promise; } });
  const pending = h.run();
  await began.promise;
  h.row = { ...h.row, access_token_enc: "enc:concurrent-refresh", expires_at: "2099-01-01T00:00:00.000Z" };
  finish.resolve(rejected());
  const result = await pending;
  assert.equal(result.accessToken, "concurrent-refresh");
  assert.equal(h.row.status, "connected");
  assert.equal(h.writes.length, 0);
});

test("a genuine current invalid_grant marks GMB for reconnection once", async () => {
  const h = runtime({ fetch: async () => rejected() });
  assert.equal(await h.run(), null);
  assert.equal(h.calls, 1);
  assert.equal(h.row.status, "disconnected");
  assert.equal(h.row.access_token_enc, null);
  assert.equal(h.row.meta.needs_reconnect_reason, "google_refresh_token_invalid");
  assert.equal(h.writes.length, 1);
});

test("transient Google failures keep the stored GMB connection intact", async () => {
  const h = runtime({ fetch: async () => Response.json({ error: "temporarily_unavailable" }, { status: 503 }) });
  await assert.rejects(h.run(), /temporarily_unavailable/);
  assert.equal(h.row.status, "connected");
  assert.equal(h.writeAttempts, 0);
});

test("failed token persistence neither returns an unpersisted snapshot nor marks authentication invalid", async () => {
  const h = runtime({ writeError: true });
  await assert.rejects(h.run(), /ne peut pas être actualisée/);
  assert.equal(h.row.access_token_enc, "enc:old-access");
  assert.equal(h.row.meta.needs_reconnect, undefined);
  assert.equal(h.writes.length, 0);
});

test("GMB compare-and-swap retries remain bounded under concurrent metadata changes", async () => {
  const h = runtime({ beforeWrite: handle => { handle.row = { ...handle.row, meta: { ...handle.row.meta, revision: handle.writeAttempts } }; } });
  assert.equal(await h.run(), null);
  assert.equal(h.calls, 2);
  assert.equal(h.writeAttempts, 2);
  assert.equal(h.writes.length, 0);
  assert.equal(h.row.status, "connected");
});

test("GA4 refresh recovery retains its existing connected binding and deferred retry", async () => {
  const h = runtime({ initial: fixture({ source: "site_web", product: "ga4" }), fetch: async () => rejected() });
  assert.equal(await h.runGa4(), null);
  assert.equal(h.row.status, "connected");
  assert.equal(h.row.meta.google_stats_refresh_failure_reason, "google_refresh_token_invalid");
  assert.ok(h.row.meta.google_stats_refresh_retry_at);
  assert.equal(h.row.meta.needs_reconnect, undefined);
});
