import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as catalogue from "../../lib/boutique/products.ts";

type Row = Record<string, unknown>;
const output = ts.transpileModule(readFileSync(new URL("../../app/api/boutique/order/route.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function fixture(options: { balance?: number; authenticated?: boolean; existing?: Row; insertError?: boolean } = {}) {
  const inserts: Row[] = [];
  const updates: Row[] = [];
  const mails: Row[] = [];
  const admin = { from(table: string) {
    assert.equal(table, "boutique_orders");
    const chain = {
      select() { return chain; }, eq() { return chain; },
      maybeSingle: async () => ({ data: options.existing ?? null, error: null }),
      insert(payload: Row) { inserts.push(payload); return chain; },
      single: async () => options.insertError
        ? { data: null, error: { code: "PGRST204" } }
        : { data: { id: "order-fixture-001" }, error: null },
      update(payload: Row) { updates.push(payload); return chain; },
      then: (resolve: (value: unknown) => unknown) => Promise.resolve({ error: null }).then(resolve),
    };
    return chain;
  } };
  const client = {
    auth: { getUser: async () => ({ data: { user: options.authenticated === false ? null : { id: "auth-user", email: "client@example.invalid" } }, error: null }) },
    from(table: string) {
      assert.ok(["profiles", "loyalty_balance"].includes(table));
      const chain = { select() { return chain; }, eq() { return chain; }, maybeSingle: async () => ({
        data: table === "profiles" ? { contact_email: "admin@example.invalid" } : { balance: options.balance ?? 50000 }, error: null,
      }) };
      return chain;
    },
  };
  const modules = new Map<string, unknown>([
    ["next/server", { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } }],
    ["@/lib/supabaseServer", { createSupabaseServer: async () => client }],
    ["@/lib/multicompte/server", { resolveActiveInrcyAccountId: async () => "active-account" }],
    ["@/lib/supabaseAdmin", { supabaseAdmin: admin }],
    ["@/lib/txMailer", { sendTxMail: async (payload: Row) => { mails.push(payload); } }],
    ["@/lib/boutique/products", catalogue],
    ["@/lib/env", { optionalEnv: () => "boutique@example.invalid" }],
  ]);
  const runtime = { exports: {} as { POST: (request: Request) => Promise<Response> } };
  new Function("module", "exports", "require", "console", output)(runtime, runtime.exports, (name: string) => {
    assert.ok(modules.has(name), `Unmocked dependency ${name}`);
    return modules.get(name);
  }, { error() {} });
  return { inserts, updates, mails, post: (body: unknown) => runtime.exports.POST(new Request("https://example.invalid/api/boutique/order", {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  })) };
}

for (const method of ["EUR", "UI"] as const) test(`${method} orders persist and email server-calculated HT amounts, ignoring tampered client prices`, async () => {
  const route = fixture();
  const response = await route.post({ productKey: "cartes_visite", method, idempotencyKey: `fixture-${method}`, amount_eur: 1, amount_ui: 0, taxBehavior: "inclusive" });
  assert.equal(response.status, 200);
  assert.equal(route.inserts.length, 1);
  assert.deepEqual(route.inserts[0], {
    user_id: "active-account", account_email: "client@example.invalid", admin_email: "admin@example.invalid",
    product_key: "cartes_visite", product_name: "Cartes de visite premium", method,
    amount_eur: method === "EUR" ? 299 : 179, amount_eur_tax_behavior: "exclusive", amount_ui: method === "UI" ? 7200 : null,
    status: "pending", idempotency_key: `fixture-${method}`,
  });
  assert.equal(route.mails.length, 2);
  for (const mail of route.mails) {
    const body = String(mail.text).replaceAll("\u202f", " ");
    assert.match(body, method === "EUR" ? /Prix : 299 € HT\n/ : /Prix : 179 € HT \+ 7 200 UI\n/);
    assert.doesNotMatch(body, /Prix : 359|Prix : 215/);
  }
  assert.deepEqual(route.updates, [{ boutique_email_sent: true, client_email_sent: true, last_error: null }]);
});

test("historic idempotent orders are returned untouched and never recalculated or emailed again", async () => {
  const historical = { id: "legacy-order", status: "processed", amount_eur: 359, amount_eur_tax_behavior: null };
  const route = fixture({ existing: historical });
  const response = await route.post({ productKey: "cartes_visite", method: "EUR", idempotencyKey: "old-key" });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { ok: true, orderId: "legacy-order", status: "processed", deduped: true });
  assert.deepEqual(route.inserts, []);
  assert.deepEqual(route.updates, []);
  assert.deepEqual(route.mails, []);
  assert.equal(historical.amount_eur, 359);
  assert.equal(historical.amount_eur_tax_behavior, null);
});

test("authentication and the full unchanged UI balance remain required", async () => {
  const anonymous = fixture({ authenticated: false });
  assert.equal((await anonymous.post({ productKey: "cartes_visite", method: "EUR" })).status, 401);
  const insufficient = fixture({ balance: 7199 });
  assert.equal((await insufficient.post({ productKey: "cartes_visite", method: "UI" })).status, 400);
  for (const route of [anonymous, insufficient]) {
    assert.deepEqual(route.inserts, []);
    assert.deepEqual(route.mails, []);
  }
});

test("a missing schema update fails before sending any order mail", async () => {
  const route = fixture({ insertError: true });
  assert.equal((await route.post({ productKey: "cartes_visite", method: "EUR" })).status, 500);
  assert.deepEqual(route.mails, []);
  assert.deepEqual(route.updates, []);
});
