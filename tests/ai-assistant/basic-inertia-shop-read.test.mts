import assert from "node:assert/strict";
import test from "node:test";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";
import { getInrAssistantBasicShopReadView, nativeInertiaDate, nativeInertiaNumber } from "../../lib/inrAssistantBasicShopRead.ts";
type Row = Record<string, unknown>;
const ACCOUNT = "10000000-0000-4000-8000-000000000001", ACTOR = "20000000-0000-4000-8000-000000000002", OTHER = "30000000-0000-4000-8000-000000000003";
function fixture(options: { balance?: unknown; balanceMissing?: boolean; failed?: string; changedDuringRead?: boolean; wrongOwner?: boolean; malformed?: boolean } = {}) {
  let actor = ACTOR, account = ACCOUNT; const reads: Array<{ table: string; projection: string; filters: Array<[string, unknown]>; range: number[] }> = [];
  const records: Record<string, Row[]> = {
    loyalty_balance: options.balanceMissing ? [] : [{ user_id: ACCOUNT, balance: options.balance ?? 0 }],
    loyalty_ledger: Array.from({ length: 25 }, (_, index) => ({ id: `event-${index}`, user_id: ACCOUNT, created_at: "2026-11-05T10:00:00Z", action_key: "create_actu", label: `Native entry ${index}`, amount: index === 0 ? "-2.5" : 10 })),
    boutique_orders: Array.from({ length: 25 }, (_, index) => ({ id: `order-${index}`, user_id: ACCOUNT, product_key: "native_service", product_name: `Historic service ${index}`, method: index === 0 ? "EUR" : "UI", amount_eur: index === 0 ? "12.50" : null, amount_eur_tax_behavior: index === 0 ? "exclusive" : null, amount_ui: index === 0 ? null : 40, status: "processed", created_at: "2026-11-05T10:00:00Z", account_email: "PRIVATE@example.invalid", admin_email: "PRIVATE-admin" })),
  };
  for (const table of ["loyalty_ledger", "boutique_orders"]) records[table].push({ ...records[table][0], id: "FOREIGN", user_id: OTHER });
  if (options.malformed) { records.loyalty_ledger[0].amount = "not a number"; records.loyalty_ledger[0].created_at = "2026-02-31T10:00:00Z"; records.boutique_orders[0].amount_eur = -100; records.boutique_orders[0].amount_ui = "Infinity"; records.boutique_orders[0].method = "UNKNOWN"; records.boutique_orders[0].created_at = "tomorrow"; }
  const db = { from(table: string) { assert.ok(table in records, `No API/write or unrelated table may run: ${table}`); let projection = "", start = 0, end = 999; const filters: Array<[string, unknown]> = [];
    const execute = () => { reads.push({ table, projection, filters, range: [start, end] }); if (options.changedDuringRead) actor = OTHER; const data = records[table].filter(item => filters.every(([key, value]) => item[key] === value)).slice(start, end + 1).map(item => Object.fromEntries(projection.split(",").map(key => [key, options.wrongOwner && key === "user_id" ? OTHER : item[key]]))); return { data, error: options.failed === table ? { message: "Synthetic source unavailable" } : null }; };
    const query = { select(value: string) { projection = value; return query; }, eq(key: string, value: unknown) { filters.push([key, value]); return query; }, order() { return query; }, range(a: number, b: number) { start = a; end = b; return query; }, async maybeSingle() { const result = execute(); return { ...result, data: result.data[0] ?? null }; }, then(resolve: (value: ReturnType<typeof execute>) => unknown) { return Promise.resolve(execute()).then(resolve); } }; return query;
  } };
  const load = runtimeModules({ "./requireUser": { requireUser: async () => ({ activeUserId: account, authUserId: actor }) } }), runtime = load<typeof import("../../lib/inrAssistantAccountServiceTools.ts")>("lib/inrAssistantAccountServiceTools.ts");
  return { reads, actor: () => { actor = OTHER; }, account: () => { account = OTHER; }, run: async (view: "inertia" | "shop_orders", offset = 0) => {
    const tools = runtime.createInrAssistantAccountServiceTools({ request: new Request("https://app.fixture.invalid/api/assistant/chat"), accountId: ACCOUNT, actorUserId: ACTOR, currentUserMessage: "Lis mon solde Inertie et mes commandes de prestations Boutique", supabase: db as never });
    return await tools.readAccountServices.execute!({ view, offset }, { toolCallId: "native-shop-read", messages: [] }) as Row;
  } };
}

test("Basic Inertia reads the active establishment native balance and paginated signed journal without confusing UI with Studio credits or repairing a ledger", async () => {
  const h = fixture(), result = await h.run("inertia"); assert.equal(result.status, "read"); assert.equal(result.unit, "UI"); assert.equal(result.balanceKnown, true); assert.equal(result.balance, 0); assert.equal(result.ledgerKnown, true); assert.equal((result.events as Row[]).length, 20); assert.equal((result.events as Row[])[0].amountUi, -2.5); assert.equal(result.nextOffset, 20);
  const next = await h.run("inertia", 20); assert.equal((next.events as Row[]).length, 5); assert.equal(next.nextOffset, null); assert.doesNotMatch(JSON.stringify(next), /FOREIGN/); assert.deepEqual(h.reads.filter(item => item.table === "loyalty_ledger").map(item => item.range), [[0, 20], [20, 40]]); assert.ok(h.reads.every(item => item.filters.some(([key, value]) => key === "user_id" && value === ACCOUNT)));
});
test("Basic prestation order reads preserve historic EUR and UI amounts with their native status and dates without making a purchase or claiming payment", async () => {
  const h = fixture(), result = await h.run("shop_orders"), orders = result.orders as Row[]; assert.equal(result.status, "read"); assert.equal(orders.length, 20); assert.deepEqual({ amount: orders[0].amountEur, tax: orders[0].eurTaxBehavior, ui: orders[0].amountUi, status: orders[0].status, date: orders[0].createdAt }, { amount: 12.5, tax: "exclusive", ui: null, status: "processed", date: "2026-11-05T10:00:00.000Z" }); assert.equal(orders[1].amountUi, 40); assert.equal(orders[1].amountEur, null); assert.equal(result.nextOffset, 20); assert.equal(result.untrustedContent, true);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|FOREIGN/); assert.match(String(result.message), /ne prouve ni règlement/); const next = await h.run("shop_orders", 20); assert.equal((next.orders as Row[]).length, 5); assert.equal(next.nextOffset, null); assert.ok(h.reads.every(item => item.table === "boutique_orders" && item.filters.some(([key, value]) => key === "user_id" && value === ACCOUNT)));
});
test("Basic Inertia unavailable or missing sources stay partial and unknown while malformed stored amounts and dates never become invented zeros", async () => {
  for (const options of [{ balanceMissing: true }, { failed: "loyalty_balance" }, { balance: "NaN" }]) { const result = await fixture(options).run("inertia"); assert.equal(result.status, "partial"); assert.equal(result.balanceKnown, false); assert.equal(result.balance, null); assert.equal(result.ledgerKnown, true); }
  const failedLedger = await fixture({ balance: "15.5", failed: "loyalty_ledger" }).run("inertia"); assert.equal(failedLedger.status, "partial"); assert.equal(failedLedger.balance, 15.5); assert.equal(failedLedger.ledgerKnown, false); assert.deepEqual(failedLedger.events, []);
  assert.equal((await fixture({ failed: "boutique_orders" }).run("shop_orders")).status, "unavailable"); const bad = fixture({ malformed: true }), inertia = await bad.run("inertia"), shop = await bad.run("shop_orders"); assert.equal((inertia.events as Row[])[0].amountUi, null); assert.equal((inertia.events as Row[])[0].createdAt, null); assert.equal((shop.orders as Row[])[0].amountEur, null); assert.equal((shop.orders as Row[])[0].amountUi, null); assert.equal((shop.orders as Row[])[0].method, null); assert.equal((shop.orders as Row[])[0].createdAt, null);
});
test("Basic Inertia and prestation reads stop before or after account actor drift and reject a native result from another establishment", async () => {
  for (const view of ["inertia", "shop_orders"] as const) {
    for (const kind of ["actor", "account"] as const) { const h = fixture(); h[kind](); assert.equal((await h.run(view)).status, "blocked"); assert.equal(h.reads.length, 0); }
    for (const options of [{ changedDuringRead: true }, { wrongOwner: true }]) { const result = await fixture(options).run(view); assert.equal(result.status, "blocked"); assert.equal(result.orders, undefined); assert.equal(result.events, undefined); assert.equal(result.balance, undefined); }
  }
});
test("Basic private shop routing separates Inertia and prestation histories from media recharge wallet UI appearance and advice", () => {
  for (const text of ["Combien d’unités d’inertie ai-je ?", "Lis mon historique Inertie.", "Vérifie mon solde UI.", "Combien UI ?"]) assert.equal(getInrAssistantBasicShopReadView(text), "inertia", text);
  for (const text of ["Liste mes commandes de prestations.", "Quel est le statut de mes commandes Boutique ?", "Mes commandes de prestations", "Nos commandes de services.", "Mes commandes Boutique", "Mes commandes de la Boutique"]) assert.equal(getInrAssistantBasicShopReadView(text), "shop_orders", text);
  for (const text of ["Combien de crédits Studio me reste-t-il ?", "Vérifie la commande de recharge vidéo.", "Modifie le thème de l’UI.", "Comment fonctionnent les unités d’inertie ?", "Lis ceci : 'Lis mon solde Inertie.'", "Ne lis pas mes commandes Boutique.", "Comment voir mes commandes de prestations ?", "Lis ceci : 'Mes commandes de prestations'", "Mes commandes de prestations demain"]) assert.equal(getInrAssistantBasicShopReadView(text), null, text);
  assert.equal(nativeInertiaNumber(""), null); assert.equal(nativeInertiaNumber(Infinity), null); assert.equal(nativeInertiaDate("2026-02-31T10:00:00Z"), null); assert.equal(nativeInertiaDate("2026-11-05T11:00:00+01:00"), "2026-11-05T10:00:00.000Z");
});
