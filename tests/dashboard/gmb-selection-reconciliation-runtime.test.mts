import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isDeepStrictEqual } from "node:util";
import test from "node:test";
import ts from "typescript";
import { integrationWriteSchemaError } from "../helpers/integrations-schema-contract.mts";

// The mock query builder loads the real server module without a network client.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Value = any;
const load = (name: string): Value => {
  const code = ts.transpileModule(readFileSync(new URL(`../../lib/${name}.ts`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const fixture = { exports: {} as Value };
  new Function("module", "exports", "require", code)(fixture, fixture.exports, (key: string) => {
    if (key === "server-only") return {};
    if (key === "@/lib/observability/logger") return { log: { warn() {} } };
    if (key.startsWith("@/lib/")) return load(key.slice(6));
    throw Error(`Unmocked dependency ${key}`);
  });
  return fixture.exports;
};
const { reconcileGmbSelection } = load("googleBusinessSelectionReconciliation");
const original = () => ({ id: "fixture-integration", user_id: "fixture-user", provider: "google", source: "gmb", product: "gmb", status: "connected", email_address: "fixture@example.test", resource_id: "locations/old", resource_label: "Same business", access_token_enc: "synthetic-access", refresh_token_enc: "synthetic-refresh", expires_at: "2099-01-01T00:00:00Z", meta: { account: "accounts/old", connection_version: 1, connection_version_updated_at: "2026-11-15T19:00:00Z", locationName: "locations/old", url: "https://maps.example.test/old", gmb: { location: "locations/old" }, unrelated: "keep" } });
const complete = (locations: Value[] = [{ name: "locations/new", title: "Same business", accountName: "accounts/old", status: "OPEN" }]) => ({ complete: true, accounts: [{ name: "accounts/old" }], locations });
function database(options: { beforeWrite?: (table: string, state: Value) => void; failTable?: string; failRead?: boolean; rejectMirror?: boolean } = {}) {
  const state = { row: original(), mirror: { user_id: "fixture-user", settings: { unrelated: { keep: true }, gmb: { connected: true, configured: true, accountName: "accounts/old", locationName: "locations/old", resource_id: "locations/old", url: "https://maps.example.test/old" } } } as Value, writes: [] as string[] };
  const db = { from(table: string) {
    let patch: Value = null;
    const filters: Array<[string, unknown]> = [];
    let result: Value;
    const execute = async () => {
      if (result) return result;
      if (patch && table === "integrations") {
        const schemaError = integrationWriteSchemaError(patch);
        if (schemaError) return result = { data: null, error: schemaError };
      }
      if (patch) options.beforeWrite?.(table, state);
      if (patch && table === "pro_tools_configs" && options.rejectMirror) throw Error("synthetic transport failure");
      if ((!patch && options.failRead) || (patch && options.failTable === table)) return result = { data: null, error: { message: "synthetic failure" } };
      const target = table === "integrations" ? state.row : state.mirror;
      const match = target && filters.every(([key, expected]) => {
        const value = target[key] ?? null;
        if ((key === "meta" || key === "settings") && typeof expected === "string") return isDeepStrictEqual(value, JSON.parse(expected));
        return isDeepStrictEqual(value, expected);
      });
      if (!match) return result = { data: null, error: null };
      if (patch) { Object.assign(target, structuredClone(patch)); state.writes.push(table); }
      return result = { data: structuredClone(target), error: null };
    };
    const q: Value = { select: () => q, update: (value: unknown) => { patch = value; return q; }, eq: (key: string, value: unknown) => { filters.push([key, value]); return q; }, is: (key: string, value: unknown) => { filters.push([key, value]); return q; }, maybeSingle: execute, then: (resolve: Value, reject: Value) => execute().then(resolve, reject) };
    return q;
  } };
  return { db, state, run: (discovery = complete(), row: Value = structuredClone(state.row), userId = "fixture-user") => reconcileGmbSelection({ db, userId, row, discovery }) };
}

test("A confirmed absent target is cleared while the authorized identity and tokens survive", async () => {
  const h = database();
  const result = await h.run();
  assert.deepEqual(result, { status: "invalid", cleared: true, locationName: "locations/old" });
  assert.equal(h.state.row.status, "account_connected");
  assert.equal(h.state.row.resource_id, null);
  assert.equal(Object.hasOwn(h.state.row, "page_url"), false);
  assert.equal(h.state.row.access_token_enc, "synthetic-access");
  assert.equal(h.state.row.refresh_token_enc, "synthetic-refresh");
  assert.equal(h.state.row.email_address, "fixture@example.test");
  assert.equal(h.state.row.meta.unrelated, "keep");
  assert.equal(h.state.row.meta.locationName, undefined);
  assert.equal(h.state.row.meta.gmb.location, undefined);
  assert.equal(h.state.mirror.settings.gmb.locationName, null);
  assert.equal(h.state.mirror.settings.gmb.configured, false);
  assert.deepEqual(h.state.mirror.settings.unrelated, { keep: true });
  assert.deepEqual(h.state.writes, ["integrations", "pro_tools_configs"]);
  assert.notEqual(h.state.row.resource_id, "locations/new", "A same-name replacement requires an explicit choice");
});

test("An exact accessible account and location keep their target and require no write", async () => {
  const h = database();
  const result = await h.run(complete([{ name: "locations/old", accountName: "accounts/old", title: "Updated title", status: "OPEN" }]));
  assert.equal(result.status, "valid");
  assert.deepEqual(h.state.writes, []);
});

test("Partial discovery can never invalidate a target", async () => {
  const h = database();
  assert.equal((await h.run({ ...complete([]), complete: false })).status, "unknown");
  assert.equal(h.state.row.resource_id, "locations/old");
  assert.deepEqual(h.state.writes, []);
});

test("A concurrent explicit selection wins over a delayed invalidation", async () => {
  const h = database({ beforeWrite(table, state) { if (table === "integrations") { state.row.resource_id = "locations/explicit"; state.row.meta.connection_version_updated_at = "2099-01-01T00:00:00Z"; } } });
  assert.equal((await h.run()).status, "unknown");
  assert.equal(h.state.row.resource_id, "locations/explicit");
  assert.deepEqual(h.state.writes, []);
});

test("A concurrent OAuth grant wins even when its old resource ID is unchanged", async () => {
  const h = database({ beforeWrite(table, state) { if (table === "integrations") state.row.refresh_token_enc = "synthetic-new-grant"; } });
  assert.equal((await h.run()).cleared, false);
  assert.equal(h.state.row.status, "connected");
  assert.equal(h.state.row.refresh_token_enc, "synthetic-new-grant");
  assert.deepEqual(h.state.writes, []);
});

test("A concurrent mirror edit is not overwritten by old settings", async () => {
  const h = database({ beforeWrite(table, state) { if (table === "pro_tools_configs") state.mirror.settings = { unrelated: { changed: true }, gmb: { locationName: "locations/explicit" } }; } });
  assert.equal((await h.run()).cleared, true);
  assert.deepEqual(h.state.mirror.settings, { unrelated: { changed: true }, gmb: { locationName: "locations/explicit" } });
  assert.deepEqual(h.state.writes, ["integrations"]);
});

test("A location under another parent cannot substitute a removed account", async () => {
  const h = database();
  const result = await h.run({ complete: true, accounts: [{ name: "accounts/new" }], locations: [{ name: "locations/old", accountName: "accounts/new", status: "OPEN" }] });
  assert.equal(result.cleared, true);
  assert.equal(h.state.row.meta.account, null);
  assert.equal(h.state.row.resource_id, null);
});

test("Deduplicated shared locations are inconclusive while the old parent remains accessible", async () => {
  const h = database();
  const result = await h.run({ complete: true, accounts: [{ name: "accounts/old" }, { name: "accounts/new" }], locations: [{ name: "locations/old", accountName: "accounts/new", status: "OPEN" }] });
  assert.equal(result.status, "unknown");
  assert.deepEqual(h.state.writes, []);
});

test("Another account or provider is never modified", async () => {
  const h = database();
  assert.equal((await h.run(complete(), original(), "another-user")).status, "unknown");
  assert.equal((await h.run(complete(), { ...original(), product: "ga4" })).status, "unknown");
  assert.deepEqual(h.state.writes, []);
});

test("No saved location remains unselected instead of choosing the sole result", async () => {
  const h = database();
  assert.equal((await h.run(complete(), { ...original(), resource_id: null })).status, "unselected");
  assert.deepEqual(h.state.writes, []);
});

test("A persistence error cannot report a successful invalidation", async () => {
  const h = database({ failTable: "integrations" });
  await assert.rejects(h.run(), /n’a pas pu être actualisée/);
  assert.deepEqual(h.state.writes, []);
});

test("An unavailable display mirror cannot hide a completed official invalidation", async () => {
  for (const options of [{ rejectMirror: true }, { failTable: "pro_tools_configs" }]) {
    const h = database(options);
    assert.equal((await h.run()).cleared, true);
    assert.equal(h.state.row.resource_id, null);
    assert.equal(h.state.row.status, "account_connected");
    assert.deepEqual(h.state.writes, ["integrations"]);
  }
});
