import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";
import ts from "typescript";
import * as bubbleAccess from "../../lib/bubbleAccess.ts";

const ACCOUNT = "company-account";
const OWNER = "owner-auth";
const OTHER = "other-company";
type Row = Record<string, unknown>;

function harness(overrides: Record<string, Row[]> = {}) {
  const tables: Record<string, Row[]> = {
    app_bubble_access: [],
    inrcy_account_members: [{ account_id: ACCOUNT, auth_user_id: OWNER, is_default: true, created_at: "2026-01-01" }],
    subscriptions: [{ user_id: OWNER, status: "active" }],
    profiles: [{ user_id: OWNER, role: "user" }, { user_id: OTHER, role: "admin" }],
    ...overrides,
  };
  const reads: Array<{ table: string; filters: Array<[string, unknown[]]> }> = [];
  const client = { from(table: string) {
    const filters: Array<[string, unknown[]]> = [];
    const query = {
      select() { return query; },
      in(key: string, values: unknown[]) { filters.push([key, values]); return query; },
      then(resolveResult: (value: unknown) => unknown) {
        reads.push({ table, filters });
        return Promise.resolve({ data: (tables[table] || []).filter((row) => filters.every(([key, values]) => values.includes(row[key]))), error: null }).then(resolveResult);
      },
    };
    return query;
  } };
  const compiled = ts.transpileModule(readFileSync(resolve(import.meta.dirname, "../../lib/inrSearchEligibility.ts"), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const loaded = { exports: {} };
  new Function("module", "exports", "require", compiled)(loaded, loaded.exports, (name: string) => {
    if (name === "server-only") return {};
    if (name === "@/lib/bubbleAccess") return bubbleAccess;
    if (name === "@/lib/supabaseAdmin") return { supabaseAdmin: client };
    throw new Error(`Unexpected dependency ${name}`);
  });
  return { api: loaded.exports as typeof import("../../lib/inrSearchEligibility.ts"), reads };
}

test("trois décisions natives partagent quatre lectures et les mêmes identifiants de compte/abonnement", async () => {
  const h = harness();
  const result = await h.api.getNativeChannelPublicationEligibility(ACCOUNT);
  assert.deepEqual(Object.values(result).map((value) => value.allowed), [true, true, true]);
  assert.deepEqual(Object.values(result).map((value) => value.authUserId), [OWNER, OWNER, OWNER]);
  assert.equal(h.reads.length, 4);
  assert.deepEqual(h.reads.map((read) => read.table).sort(), ["app_bubble_access", "inrcy_account_members", "profiles", "subscriptions"]);
  const access = h.reads.find((read) => read.table === "app_bubble_access")!;
  assert.deepEqual(access.filters, [["user_id", [ACCOUNT]], ["bubble_key", ["inrbadge", "inr_search", "inr_directory"]]]);
  assert.ok(h.reads.filter((read) => ["subscriptions", "profiles"].includes(read.table)).every((read) =>
    read.filters[0][1].includes(ACCOUNT) && read.filters[0][1].includes(OWNER) && !read.filters[0][1].includes(OTHER)));
});

test("désactiver Badge bloque aussi l’annuaire et laisse Search indépendant", async () => {
  const h = harness({ app_bubble_access: [{ user_id: ACCOUNT, bubble_key: "inrbadge", enabled: false }] });
  const result = await h.api.getNativeChannelPublicationEligibility(ACCOUNT);
  assert.equal(result.inrbadge.reason, "bubble_disabled");
  assert.equal(result.inr_directory.reason, "bubble_disabled");
  assert.equal(result.inr_search.allowed, true);
});

test("un abonnement inactif et le rôle admin d’un autre compte ne rendent aucun canal publiable", async () => {
  const h = harness({ subscriptions: [{ user_id: OWNER, status: "canceled" }] });
  const result = await h.api.getNativeChannelPublicationEligibility(ACCOUNT);
  assert.ok(Object.values(result).every((value) => !value.allowed && value.reason === "subscription_inactive"));
});

test("un admin autorisé conserve les interdictions de bulles propres à son compte", async () => {
  const h = harness({ subscriptions: [], profiles: [{ user_id: OWNER, role: "admin" }],
    app_bubble_access: [{ user_id: ACCOUNT, bubble_key: "inr_search", enabled: false }] });
  const result = await h.api.getNativeChannelPublicationEligibility(ACCOUNT);
  assert.equal(result.inrbadge.allowed, true);
  assert.equal(result.inr_directory.allowed, true);
  assert.equal(result.inr_search.reason, "bubble_disabled");
});

test("les API existantes conservent les mêmes décisions que le lot natif", async () => {
  const h = harness({ app_bubble_access: [{ user_id: ACCOUNT, bubble_key: "inr_search", enabled: false }],
    subscriptions: [{ user_id: ACCOUNT, status: "trialing", trial_end_at: new Date(Date.now() + 86_400_000).toISOString() }] });
  const result = await h.api.getNativeChannelPublicationEligibility(ACCOUNT);
  assert.deepEqual(await h.api.getInrSearchPublicationEligibility(ACCOUNT), result.inr_search);
  assert.deepEqual(await h.api.getInrSearchPublicationEligibility(ACCOUNT, "inrbadge"), result.inrbadge);
  assert.deepEqual(await h.api.getInrDirectoryPublicationEligibility(ACCOUNT), result.inr_directory);
  assert.deepEqual([...(await h.api.filterEligibleInrDirectoryAccountIds([ACCOUNT, ACCOUNT]))], [ACCOUNT]);
});

test("un identifiant absent reste refusé sans interroger la base", async () => {
  const h = harness();
  const result = await h.api.getNativeChannelPublicationEligibility("");
  assert.ok(Object.values(result).every((value) => !value.allowed));
  assert.equal(h.reads.length, 0);
});
