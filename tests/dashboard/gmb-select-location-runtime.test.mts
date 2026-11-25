import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { integrationWriteSchemaError } from "../helpers/integrations-schema-contract.mts";

// The fixture models heterogeneous route exports and PostgREST JSON rows.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
type Db = { row: Row | null; settings: Row };

function load(file: string, modules: Row): Row {
  const code = ts.transpileModule(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const output = { exports: {} as Row };
  new Function("require", "module", "exports", code)((name: string) => {
    if (Object.hasOwn(modules, name)) return modules[name];
    throw new Error(`Unexpected dependency ${name}`);
  }, output, output.exports);
  return output.exports;
}

function runtime(options: {
  duringDiscovery?: (db: Db) => void; beforeWrite?: (db: Db) => void;
  beforeMirrorWrite?: (db: Db) => void; snapshot?: Row; inaccessible?: boolean; missing?: boolean;
} = {}) {
  const initial: Row = { id: "gmb-row", user_id: "active-company", provider: "google", source: "gmb", product: "gmb", status: "account_connected", email_address: "mail@example.test", access_token_enc: "encrypted:current-access", refresh_token_enc: "encrypted:current-refresh", expires_at: "2099-01-01T00:00:00Z", resource_id: null, resource_label: null, meta: { account: "accounts/parent", locationName: "locations/stale", gmb: { location: "locations/stale" }, retained: true }, ...options.snapshot };
  const db: Db = { row: structuredClone(initial), settings: { unrelated: { retained: true }, gmb: { connected: true, configured: false, locationName: "locations/stale", url: "https://stale.example" } } };
  const snapshot = structuredClone(initial);
  const writes: Array<{ table: string; matched: boolean; filters: Array<[string, unknown]> }> = [];
  let caches = 0;
  function query(table: string) {
    let op = "select", patch: Row = {}, single = false;
    const filters: Array<[string, unknown]> = [];
    const q: Row = {
      select: () => q, eq: (key: string, value: unknown) => { filters.push([key, value]); return q; },
      is: (key: string, value: unknown) => { filters.push([key, value]); return q; },
      maybeSingle: () => { assert.equal(op, "select", "a guarded PATCH must accept zero returned rows"); single = true; return q; },
      update: (value: Row) => { op = "update"; patch = value; return q; },
      insert: (value: Row) => { op = "insert"; patch = value; return q; },
      then(resolve: (value: unknown) => unknown, reject: (error: unknown) => unknown) {
        return Promise.resolve().then(() => {
          if (table === "integrations" && op !== "select") {
            const schemaError = integrationWriteSchemaError(patch);
            if (schemaError) return { data: null, error: schemaError };
          }
          if (op !== "select") {
            if (table === "integrations") options.beforeWrite?.(db);
            else options.beforeMirrorWrite?.(db);
          }
          let row: Row | null = table === "integrations" ? db.row : { user_id: "active-company", settings: db.settings };
          const matches = row && filters.every(([key, expected]) => {
            const actual = row?.[key] ?? null;
            if (actual && typeof actual === "object" && typeof expected === "string") {
              try { return JSON.stringify(actual) === JSON.stringify(JSON.parse(expected)); } catch { return false; }
            }
            return actual === expected;
          });
          if (op !== "select") {
            writes.push({ table, matched: Boolean(matches), filters: structuredClone(filters) });
            if (matches) {
              if (table === "integrations") Object.assign(db.row!, structuredClone(patch));
              else db.settings = structuredClone(patch.settings);
              row = table === "integrations" ? db.row : { user_id: "active-company", settings: db.settings };
            }
          }
          const selected = matches ? structuredClone(row) : null;
          return { data: single ? selected : selected ? [selected] : [], error: null };
        }).then(resolve, reject);
      },
    };
    return q;
  }
  const safe = load("lib/tsSafe.ts", {});
  const versions = load("lib/connectionVersions.ts", { "@/lib/tsSafe": safe });
  const policy = load("lib/googleBusinessSelectionPolicy.ts", {});
  const route = load("app/api/integrations/google-business/select-location/route.ts", {
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "@/lib/supabaseServer": { createSupabaseServer: async () => ({ auth: { getUser: async () => ({ data: { user: { id: "actor" } }, error: null }) } }) },
    "@/lib/supabaseAdmin": { supabaseAdmin: { from: query } },
    "@/lib/tsSafe": safe,
    "@/lib/apiUserFacingErrors": { jsonUserFacingError: () => Response.json({ error: "database_unavailable" }, { status: 500 }) },
    "@/lib/statsCache": { clearAllToolCaches: async () => { caches++; } },
    "@/lib/connectionVersions": versions,
    "@/lib/googleBusinessSelectionPolicy": policy,
    "@/lib/multicompte/server": { resolveActiveInrcyAccountId: async () => "active-company" },
    "@/lib/googleBusiness": { getGmbToken: async () => ({ accessToken: "current-raw-access-fixture", row: snapshot }) },
    "@/lib/googleBusinessLocations": {
      listAllGoogleBusinessAccounts: async (token: string) => { assert.equal(token, "current-raw-access-fixture"); return options.inaccessible ? [] : [{ name: "accounts/parent" }]; },
      listAllGoogleBusinessLocations: async (token: string, account: string) => {
        assert.equal(token, "current-raw-access-fixture"); assert.equal(account, "accounts/parent");
        options.duringDiscovery?.(db);
        return options.missing ? [] : [{ name: "locations/chosen", title: "Real Google title", status: "CLOSED_PERMANENTLY", mapsUri: "https://maps.google.com/?cid=chosen" }];
      },
    },
  });
  return { db, snapshot, writes, get caches() { return caches; }, run: async () => route.POST(new Request("https://app.example/select", { method: "POST", body: JSON.stringify({ accountName: "accounts/parent", locationName: "locations/chosen", locationTitle: "Forged client title" }) })) as Promise<Response> };
}

test("an explicit choice binds the complete verified snapshot and Google's exact title, even when closed", async () => {
  const h = runtime(); const response = await h.run();
  assert.equal(response.status, 200);
  assert.equal(h.db.row!.resource_id, "locations/chosen");
  assert.equal(h.db.row!.resource_label, "Real Google title");
  assert.equal(h.db.row!.status, "connected");
  assert.equal(h.db.row!.meta.account, "accounts/parent");
  assert.equal(h.db.row!.meta.locationName, undefined);
  assert.equal(h.db.row!.meta.gmb.location, undefined);
  assert.equal(h.db.row!.meta.url, "https://maps.google.com/?cid=chosen");
  assert.equal(Object.hasOwn(h.db.row!, "page_url"), false);
  assert.equal(h.db.settings.gmb.locationName, "locations/chosen");
  assert.equal(h.db.settings.unrelated.retained, true);
  const filters = Object.fromEntries(h.writes[0].filters);
  for (const key of ["id", "user_id", "provider", "source", "product", "status", "email_address", "access_token_enc", "refresh_token_enc", "expires_at", "resource_id", "resource_label"]) assert.equal(filters[key], h.snapshot[key], key);
  assert.equal(filters.meta, JSON.stringify(h.snapshot.meta));
  assert.equal(h.caches, 1);
});

for (const field of ["status", "email_address", "access_token_enc", "refresh_token_enc", "expires_at", "resource_id", "resource_label", "meta"] as const) {
  test(`a concurrent ${field} change after Google validation returns409 without restoring the older choice`, async () => {
    const h = runtime({ beforeWrite: db => { db.row![field] = field === "meta" ? { connection_version_updated_at: "new-oauth" } : `changed-${field}`; } });
    const response = await h.run();
    assert.equal(response.status, 409);
    const payload = await response.json();
    assert.equal(payload.code, "gmb_selection_changed");
    assert.doesNotMatch(payload.error, /reconnect/i, "a stale snapshot is not a new OAuth failure");
    assert.notEqual(h.db.row!.resource_id, "locations/chosen");
    assert.equal(h.writes[0].matched, false);
    assert.equal(h.writes.filter(write => write.table === "pro_tools_configs").length, 0);
    assert.equal(h.caches, 0);
  });
}

for (const change of ["disconnect", "replacement-row", "foreign-user", "foreign-provider"] as const) {
  test(`${change} during discovery prevents any selection write`, async () => {
    const h = runtime({ duringDiscovery: db => {
      if (change === "disconnect") db.row = null;
      else if (change === "replacement-row") db.row!.id = "new-oauth-row";
      else if (change === "foreign-user") db.row!.user_id = "other-company";
      else db.row!.provider = "other-provider";
    } });
    assert.equal((await h.run()).status, 409);
    assert.equal(h.writes.length, 0);
    assert.equal(h.caches, 0);
  });
}

test("an OAuth completed before the final metadata read still blocks the earlier token's selection", async () => {
  const h = runtime({ duringDiscovery: db => Object.assign(db.row!, { access_token_enc: "encrypted:new-oauth", meta: { account: "accounts/parent", connection_version_updated_at: "new-oauth" } }) });
  assert.equal((await h.run()).status, 409);
  assert.equal(h.db.row!.access_token_enc, "encrypted:new-oauth");
  assert.equal(h.db.row!.meta.connection_version_updated_at, "new-oauth");
  assert.equal(h.writes[0].matched, false);
});

test("a newer mirror or preference write is never overwritten by this display snapshot", async () => {
  const h = runtime({ beforeMirrorWrite: db => { db.settings = { newer: true, gmb: { locationName: "locations/newer-choice", url: "https://newer.example" } }; } });
  assert.equal((await h.run()).status, 200);
  assert.equal(h.db.row!.resource_id, "locations/chosen");
  assert.equal(h.db.settings.gmb.locationName, "locations/newer-choice");
  assert.equal(h.writes.find(write => write.table === "pro_tools_configs")?.matched, false);
});

test("inaccessible parents and absent exact targets never choose a substitute", async () => {
  for (const option of [{ inaccessible: true }, { missing: true }]) {
    const h = runtime(option);
    assert.equal((await h.run()).status, option.inaccessible ? 403 : 409);
    assert.equal(h.writes.length, 0);
    assert.equal(h.caches, 0);
  }
});
