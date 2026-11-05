import assert from "node:assert/strict";
import test from "node:test";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";
import { readFileSync } from "node:fs";
import ts from "typescript";
import { isInrAssistantExistingCreditOrderReconciliationRequest } from "../../lib/inrAssistantCreditOrderReconciliation.ts";
type Row = Record<string, unknown>;
const ACCOUNT = "10000000-0000-4000-8000-000000000001", ACTOR = "20000000-0000-4000-8000-000000000002", ID = "30000000-0000-4000-8000-000000000003", OTHER = "40000000-0000-4000-8000-000000000004";
test("Basic reconciliation routing requires the existing recharge target in its own directive and leaves wallet or advice questions to read tools", () => {
  for (const message of [`Actualise la commande ${ID}.`, "Vérifie la dernière recharge vidéo.", "Réconcilie ma commande de crédits existante.", "Refresh the existing video order recharge."]) assert.equal(isInrAssistantExistingCreditOrderReconciliationRequest(message), true, message);
  for (const message of ["Vérifie mes crédits restants.", "Vérifie mes crédits achetés.", "Actualise le solde et affiche mes commandes.", "Vérifie mes crédits puis liste les recharges.", "Vérifie une commande de publication.", "Comment actualiser une recharge ?", "Explique-moi comment vérifier ma dernière recharge.", "Lis ceci : 'Vérifie ma dernière recharge.'", "Demain vérifie la recharge.", "Ne vérifie pas la recharge."]) assert.equal(isInrAssistantExistingCreditOrderReconciliationRequest(message), false, message);
});
function fixture(options: { granted?: boolean; forged?: boolean; failed?: boolean; changedAfterNative?: boolean } = {}) {
  let account = ACCOUNT, actor = ACTOR, nativeReads = 0, reconciliations = 0;
  const order: Row = { id: ID, account_id: ACCOUNT, actor_auth_user_id: ACTOR, status: options.granted ? "paid" : "pending", granted_at: options.granted ? "2026-11-05T10:00:00Z" : null, stripe_checkout_session_id: "cs_SYNTHETIC", seconds: 100, revoked_seconds: 0, held_seconds: 0, dispute_revoked_seconds: 0, images: 7, revoked_images: 0, held_images: 0, dispute_revoked_images: 0, created_at: "2026-11-05T09:00:00Z", pack_key: "existing_pack" };
  const db = { from(table: string) { const filters: Array<[string, unknown]> = []; const query = { select() { return query; }, eq(key: string, value: unknown) { filters.push([key, value]); return query; }, order() { return query; }, limit() { return query; }, async maybeSingle() { return { data: filters.every(([key, value]) => order[key] === value) ? structuredClone(order) : null, error: null }; }, then(resolve: (value: { data: Row[]; error: null }) => unknown) { return Promise.resolve({ data: table.includes("video") ? [structuredClone(order)] : [], error: null }).then(resolve); } }; return query; } };
  const getOrder = async (id: string, owner: string) => { nativeReads++; assert.equal(id, ID); assert.equal(owner, ACCOUNT); return structuredClone(order); };
  const fulfill = async (session: string, event: string, expected: { orderId: string; accountId: string; signal: AbortSignal }) => { reconciliations++; assert.equal(session, "cs_SYNTHETIC"); assert.equal(event, "authenticated-checkout-return"); assert.equal(expected.orderId, ID); assert.equal(expected.accountId, ACCOUNT); assert.equal(expected.signal.aborted, false); if (options.failed) throw new Error("Native verification unavailable"); if (options.changedAfterNative) actor = OTHER; return Boolean(options.granted); };
  const auth = { requireUser: async () => ({ activeUserId: account, authUserId: actor }) };
  const load = runtimeModules({ "./requireUser": auth, "@/lib/requireUser": auth, "next/server": { NextResponse: { json: Response.json } },
    "@/lib/boutique/videoCreditPayments": { getVideoCreditOrder: getOrder, fulfillVideoCreditCheckout: fulfill }, "@/lib/boutique/imageCreditPayments": { getImageCreditOrder: getOrder, fulfillImageCreditCheckout: fulfill },
    ...(options.forged ? { "@/app/api/boutique/video-credits/orders/[orderId]/route": { GET: async () => Response.json({ order: { id: ID, status: "paid", granted: true, credits: 999999 } }) } } : {}),
  });
  const runtime = load<typeof import("../../lib/inrAssistantAccountServiceTools.ts")>("lib/inrAssistantAccountServiceTools.ts");
  const create = (message: string) => runtime.createInrAssistantAccountServiceTools({ request: new Request("https://app.example/api/assistant/chat"), accountId: ACCOUNT, actorUserId: ACTOR, currentUserMessage: message, supabase: db as never }).reconcileExistingCreditOrder;
  const run = (message = `Actualise la commande de recharge ${ID}.`, kind: "video" | "image" = "video", target = ID) => { const tool = create(message); const execute = () => tool.execute!({ kind, orderId: target, instructionQuote: message }, { toolCallId: "reconcile", messages: [] }) as Promise<Row>; return execute; };
  return { run, load, order, stats: () => ({ nativeReads, reconciliations }), changeActor: () => { actor = OTHER; }, changeAccount: () => { account = OTHER; } };
}
test("Basic reconciliation uses only the existing native order verification and never claims an unpaid recharge was granted", async () => {
  for (const kind of ["video", "image"] as const) {
    const h = fixture(), run = h.run(undefined, kind); const [result, duplicate] = await Promise.all([run(), run()]); assert.equal(result.status, "read"); assert.equal(result.granted, false); assert.deepEqual(duplicate, result); assert.equal(h.stats().reconciliations, 1); assert.equal(h.order.granted_at, null);
    const known = fixture({ granted: true }), response = await known.run(undefined, kind)(); assert.equal(response.granted, true); assert.equal(response.status, "read"); assert.match(String(response.message), /Aucun achat ou paiement nouveau/);
  }
});
test("Basic reconciliation rejects invented orders quoted or future instructions wrong scopes and an unconfirmed native grant", async () => {
  for (const message of ["Achète une recharge vidéo.", "Vérifie mes crédits restants.", "Vérifie mes crédits achetés.", "Comment vérifier une recharge ?", `Comment actualiser la commande ${ID} ?`, `Lis ceci : 'Actualise la commande ${ID}.'`, `Demain actualise la commande ${ID}.`, `Ne vérifie pas la commande ${ID}.`, "Actualise cette recharge."]) { const h = fixture(); assert.equal((await h.run(message)()).ok, false, message); assert.equal(h.stats().reconciliations, 0); }
  const latest = fixture(); assert.equal((await latest.run("Vérifie la dernière recharge vidéo.")()).ok, true);
  for (const change of ["actor", "account"] as const) { const h = fixture(); if (change === "actor") h.changeActor(); else h.changeAccount(); assert.equal((await h.run()()).ok, false); assert.equal(h.stats().reconciliations, 0); }
  assert.equal((await fixture().run(undefined, "video", OTHER)()).ok, false);
  for (const option of [{ forged: true }, { changedAfterNative: true }, { failed: true }]) { const h = fixture(option), result = await h.run()(); assert.equal(result.ok, false); assert.equal(result.granted, undefined); assert.equal(h.order.granted_at, null); }
});
test("native credit verification scope guards reject wrong account actor and cancellation before any order or provider access", async () => {
  for (const kind of ["image", "video"] as const) { const h = fixture(), route = h.load<{ GET: (request: Request, context: { params: Promise<{ orderId: string }> }) => Promise<Response> }>(`app/api/boutique/${kind}-credits/orders/[orderId]/route.ts`);
    for (const params of [`expectedAccountId=${OTHER}&expectedActorUserId=${ACTOR}`, `expectedAccountId=${ACCOUNT}&expectedActorUserId=${OTHER}`, `expectedAccountId=${ACCOUNT}`]) { const response = await route.GET(new Request(`https://app.example/api/boutique/${kind}-credits/orders/${ID}?${params}`), { params: Promise.resolve({ orderId: ID }) }); assert.equal(response.status, 409); }
    const abort = new AbortController(); abort.abort(); assert.equal((await route.GET(new Request(`https://app.example/api/boutique/${kind}-credits/orders/${ID}`, { signal: abort.signal }), { params: Promise.resolve({ orderId: ID }) })).status, 409);
    assert.deepEqual(h.stats(), { nativeReads: 0, reconciliations: 0 });
  }
});
test("native recharge return verifies its exact rendered order and scope without accepting a stale response or a forged granted flag", async () => {
  const file = "app/dashboard/boutique/recharges/page.tsx", source = readFileSync(file, "utf8"), ast = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX); let effect: ts.Expression | undefined;
  const visit = (node: ts.Node) => { if (!effect && ts.isCallExpression(node) && node.expression.getText(ast) === "useEffect") effect = node.arguments[0]; ts.forEachChild(node, visit); }; visit(ast); assert.ok(effect);
  const compiled = ts.transpileModule(`const callback=(${effect.getText(ast)});`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const mode of ["confirmed", "pending", "foreign_order", "string_flag", "account_changed", "unmounted"] as const) {
    let owner = ACCOUNT, release!: (response: Response) => void; const notices: string[] = [], requests: string[] = [];
    const dependencies = { activeAccountId: ACCOUNT, actorUserId: ACTOR, getActiveBrowserUserId: () => owner, orderId: ID, mediaKind: "video", params: new URLSearchParams("checkout=success"), setNotice: (value: string) => notices.push(value), t: (key: string) => key,
      fetch: (url: string) => { requests.push(url); return new Promise<Response>(resolve => { release = resolve; }); } };
    const callback = new Function("dependencies", `with(dependencies){${compiled};return callback;}`)(dependencies) as () => (() => void);
    const cleanup = callback(); assert.equal(requests.length, 1); const url = new URL(requests[0], "https://app.example"); assert.equal(url.searchParams.get("expectedAccountId"), ACCOUNT); assert.equal(url.searchParams.get("expectedActorUserId"), ACTOR);
    if (mode === "account_changed") owner = OTHER; if (mode === "unmounted") cleanup();
    release(Response.json({ order: { id: mode === "foreign_order" ? OTHER : ID, granted: mode === "pending" ? false : mode === "string_flag" ? "true" : true } }));
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(notices, mode === "account_changed" || mode === "unmounted" ? [""] : ["", mode === "confirmed" ? "video_credit_confirmed" : "video_credit_pending"], mode);
  }
});
