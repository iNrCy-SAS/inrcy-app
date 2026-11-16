import assert from "node:assert/strict";
import test from "node:test";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";
import { parseInrAssistantAccountDocumentCommand } from "../../lib/inrAssistantAccountDocuments.ts";
type Row = Record<string, unknown>;
const ACCOUNT = "10000000-0000-4000-8000-000000000001", ACTOR = "20000000-0000-4000-8000-000000000002", OTHER = "30000000-0000-4000-8000-000000000003", ID = "40000000-0000-4000-8000-000000000004";
function harness(options: { quota?: Row; quotaUnavailable?: boolean; catalogueUnavailable?: boolean; scopeAfterQuota?: boolean; subscription?: Row | null; subscriptionAccountId?: string; subscriptionUnavailable?: boolean; scopeAfterSubscription?: boolean } = {}) {
  let active = ACCOUNT, actor = ACTOR;
  let subscriptionReads = 0;
  const rows: Row[] = [{ id: ID, user_id: ACCOUNT, title: "Publication terminée", read_at: null }, { id: OTHER, user_id: OTHER, title: "Autre compte", read_at: null }], reads: Row[] = [], writes: Row[] = [];
  const db = { from(table: string) {
    const filters: Array<[string, unknown]> = []; let change: Row | undefined, projection = "", start = 0, end = 999;
    const query = { select(fields: string) { projection = fields; return query; }, eq(key: string, value: unknown) { filters.push([key, value]); return query; }, is(key: string, value: unknown) { filters.push([key, value]); return query; }, in(key: string, value: unknown[]) { filters.push([key, value]); return query; }, update(value: Row) { change = value; return query; }, order() { return query; }, range(a: number, b: number) { start = a; end = b; return query; }, limit(size: number) { end = start + size - 1; return query; },
      then(resolve: (value: unknown) => unknown) { reads.push({ table, filters, projection });
        const source = table === "subscriptions" ? [{ user_id: ACTOR, plan: "Basic", status: "active", billing_cycle: "monthly", stripe_customer_id: "PRIVATE" }] : table === "notifications" ? rows : [];
        const selected = source.filter(item => filters.every(([key, value]) => Array.isArray(value) ? value.includes(item[key]) : item[key] === value));
        if (change) { writes.push({ table, filters, change }); selected.forEach(item => Object.assign(item, change)); }
        const data = selected.slice(start, end + 1).map(item => Object.fromEntries(projection.split(",").filter(key => key in item).map(key => [key, item[key]])));
        return Promise.resolve({ data, error: null }).then(resolve);
      },
      async maybeSingle() { return await new Promise<{ data: Row[]; error: null }>(resolve => query.then(value => resolve(value as never))).then(result => ({ data: result.data[0] || null, error: null })); },
    }; return query;
  } };
  const auth = { requireUser: async () => ({ activeUserId: active, authUserId: actor, user: { id: actor } }) };
  const load = runtimeModules({ "./requireUser": auth, "@/lib/requireUser": auth, "@/lib/supabaseAdmin": { supabaseAdmin: db }, "next/server": { NextResponse: { json: Response.json } },
    "@/lib/apiUserFacingErrors": { jsonUserFacingError: () => Response.json({}, { status: 500 }) },
    "@/app/api/notifications/feed/route": { GET: async () => Response.json({ items: rows.filter(item => item.user_id === ACCOUNT && !item.read_at).map(item => ({ ...item, unread: true })), totalCount: 1, nextOffset: null }) },
    "@/app/api/billing/invoices/route": { GET: async () => Response.json({ invoices: [ { id: "in_LATEST", number: "INV-002", total: 1200, invoicePdf: "https://pay.stripe.com/invoice/private/pdf" }, { id: "in_OLD", number: "INV-001", total: 900, invoicePdf: "https://pay.stripe.com/invoice/private-old/pdf" } ] }) },
    "@/app/api/billing/account-subscription/route": { GET: async () => {
      subscriptionReads++;
      if (options.scopeAfterSubscription) active = OTHER;
      return options.subscriptionUnavailable ? Response.json({ok:false},{status:503}) : Response.json({ok:true,accountId:options.subscriptionAccountId || ACCOUNT,
        subscription: options.subscription === undefined ? {plan:"Basic",status:"active",billing_cycle:"monthly",stripe_customer_id:"PRIVATE",stripe_subscription_id:"PRIVATE",auth_user_id:ACTOR,contact_email:"PRIVATE"} : options.subscription});
    } },
    "@/app/api/boutique/video-credits/route": { GET: async () => options.catalogueUnavailable ? Response.json({}, { status: 503 }) : Response.json({ accountId: ACCOUNT, actorAuthUserId: ACTOR, creditsReady: true, packs: [] }) },
    "@/app/api/media-generation/quota/route": { GET: async () => { if (options.scopeAfterQuota) active = OTHER; return options.quotaUnavailable ? Response.json({ ok: false }, { status: 503 }) : Response.json({ ok: true, quota: options.quota || { accountId: ACCOUNT, creditsReady: true, unlimited: false, credits: { unit: "credit", remaining: 70, limit: 140, used: 50, reserved: 20 }, private: "PRIVATE WALLET" } }); } },
  });
  const runtime = load<typeof import("../../lib/inrAssistantAccountServiceTools.ts")>("lib/inrAssistantAccountServiceTools.ts");
  const create = (message: string) => runtime.createInrAssistantAccountServiceTools({ request: new Request("https://app.test/api/assistant/chat"), accountId: ACCOUNT, actorUserId: ACTOR, supabase: db as never, currentUserMessage: message });
  const execute = async (tools: ReturnType<typeof create>, name: keyof ReturnType<typeof create>, input: unknown) => await tools[name].execute!(input as never, { toolCallId: "test", messages: [] }) as Row;
  return { rows, reads, writes, create, execute, get subscriptionReads() { return subscriptionReads; }, scope: () => { active = OTHER; }, actor: () => { actor = OTHER; } };
}
test("account services use the native active-establishment contract and remove billing URLs/secrets", async () => {
  const h = harness(), tools = h.create("Lis mon abonnement");
  const subscription = await h.execute(tools, "readAccountServices", { view: "subscription", offset: 0 }); assert.equal(subscription.scope, "active_establishment_subscription"); assert.equal((subscription.subscription as Row).plan, "Basic");
  assert.equal(subscription.accountId,ACCOUNT);assert.equal(h.subscriptionReads,1);assert.equal(h.reads.length,0);assert.doesNotMatch(JSON.stringify(subscription), /PRIVATE|stripe_customer|stripe_subscription|auth_user_id|contact_email/);
  const invoices = await h.execute(tools, "readAccountServices", { view: "invoices", offset: 0 }); assert.equal((invoices.invoices as Row[]).length, 2); assert.doesNotMatch(JSON.stringify(invoices), /pay\.stripe|private/);
  h.scope(); assert.equal((await h.execute(tools, "readAccountServices", { view: "invoices", offset: 0 })).status, "blocked");
});
test("Basic credits read the real common wallet counters without estimating a generation or exposing private quota fields", async () => {
  const h = harness(), result = await h.execute(h.create("Combien de crédits me reste-t-il ?"), "readAccountServices", { view: "credits", offset: 0 });
  assert.equal(result.status, "read"); assert.equal(result.quotaKnown, true); assert.equal(result.unlimited, false); assert.equal(result.quotaFreshness, "native_snapshot");
  assert.deepEqual(result.credits, { unit: "credit", remaining: 70, limit: 140, used: 50, reserved: 20, sharedPool: null }); assert.doesNotMatch(JSON.stringify(result), /PRIVATE|WALLET/); assert.equal(h.writes.length, 0); assert.equal(h.reads.length, 0);
  const unlimited = harness({ quota: { accountId: ACCOUNT, creditsReady: true, unlimited: true, credits: { unit: "credit", remaining: null, limit: null, used: 18, reserved: 2 } } });
  const value = await unlimited.execute(unlimited.create("Lis mes crédits"), "readAccountServices", { view: "credits", offset: 0 }); assert.equal(value.unlimited, true); assert.equal(value.quotaKnown, true); assert.equal((value.credits as Row).remaining, null); assert.equal((value.credits as Row).limit, null);
});

test("a secondary Premium contract at Standard price is reported instead of the payer's legacy plan",async()=>{
  const h=harness({subscription:{account_id:ACCOUNT,auth_user_id:ACTOR,plan:"Premium",app_edition:"premium",status:"active",monthly_price_eur:58,monthly_price_tax_behavior:"exclusive",start_date:"2026-11-16",next_renewal_date:"2026-12-16",stripe_subscription_id:"sub_PRIVATE",stripe_customer_id:"cus_PRIVATE",entitlement_offer:"PRIVATE"}});
  const result=await h.execute(h.create("Lis mon abonnement Sajemma"),"readAccountServices",{view:"subscription",offset:0});
  assert.equal(result.ok,true);assert.equal(result.scope,"active_establishment_subscription");assert.equal(result.accountId,ACCOUNT);
  assert.deepEqual(result.subscription,{plan:"Premium",app_edition:"premium",status:"active",monthly_price_eur:58,monthly_price_tax_behavior:"exclusive",start_date:"2026-11-16",next_renewal_date:"2026-12-16"});
  assert.equal(h.reads.length,0,"the assistant never queries the payer-level legacy subscription directly");
  assert.equal(h.writes.length,0);assert.doesNotMatch(JSON.stringify(result),/PRIVATE|stripe_|auth_user_id|entitlement_offer/);
});

test("subscription errors, foreign-account replies and a scope change never expose a stale contract",async()=>{
  for(const options of [{subscriptionAccountId:OTHER},{scopeAfterSubscription:true}]) {
    const h=harness(options),result=await h.execute(h.create("Lis mon abonnement"),"readAccountServices",{view:"subscription",offset:0});
    assert.equal(result.status,"blocked");assert.equal(result.subscription,undefined);
  }
  const failed=harness({subscriptionUnavailable:true}),unavailable=await failed.execute(failed.create("Lis mon abonnement"),"readAccountServices",{view:"subscription",offset:0});
  assert.equal(unavailable.status,"unavailable");assert.equal(unavailable.subscription,undefined);assert.equal(failed.reads.length,0);
});

test("a native shared Premium allowance is one monthly pool for its members, without leaking private pool identifiers",async()=>{
  const h=harness({quota:{accountId:ACCOUNT,creditsReady:true,unlimited:false,credits:{unit:"credit",remaining:2400,limit:2590,used:159,reserved:31,sharedPool:{memberCount:2,monthlyLimit:2590,poolId:"PRIVATE",members:[ACTOR,OTHER]}}}});
  const result=await h.execute(h.create("Combien de crédits pour nos deux comptes ?"),"readAccountServices",{view:"credits",offset:0});
  assert.equal(result.quotaKnown,true);assert.deepEqual((result.credits as Row).sharedPool,{memberCount:2,monthlyLimit:2590});
  assert.equal((result.credits as Row).limit,2590);assert.equal((result.credits as Row).remaining,2400);
  assert.doesNotMatch(JSON.stringify(result),/PRIVATE|poolId|members/);assert.equal(h.writes.length,0);
});
test("credit source failures remain partial, preserve a real zero and never turn unknown counters into zero", async () => {
  const quotaOnly = harness({ catalogueUnavailable: true }), live = await quotaOnly.execute(quotaOnly.create("Lis mes crédits"), "readAccountServices", { view: "credits", offset: 0 }); assert.equal(live.status, "partial"); assert.equal((live.credits as Row).remaining, 70); assert.equal(live.catalogueAvailable, false);
  for (const options of [{ quotaUnavailable: true }, { quota: { accountId: ACCOUNT, creditsReady: false, unlimited: false, credits: { unit: "credit", remaining: 0, limit: 0, used: 0, reserved: 0 } } }]) {
    const h = harness(options), result = await h.execute(h.create("Lis mes crédits"), "readAccountServices", { view: "credits", offset: 0 }); assert.equal(result.status, "partial"); assert.equal(result.quotaKnown, false); assert.equal(result.quotaFreshness, "unverified");
    assert.deepEqual(result.credits, { unit: "credit", remaining: null, limit: null, used: null, reserved: null, sharedPool: null }); assert.equal(result.catalogueAvailable, true);
  }
  const zero = harness({ quota: { accountId: ACCOUNT, creditsReady: true, unlimited: false, credits: { unit: "credit", remaining: 0, limit: 140, used: 140, reserved: 0 } } }), result = await zero.execute(zero.create("Lis mes crédits"), "readAccountServices", { view: "credits", offset: 0 }); assert.equal((result.credits as Row).remaining, 0); assert.equal(result.quotaKnown, true);
});
test("common credit snapshots from a different account or a session changed during reading never disclose counters", async () => {
  for (const options of [{ quota: { accountId: OTHER, creditsReady: true, unlimited: true, credits: { unit: "credit", remaining: 999, limit: 999, used: 0, reserved: 0 } } }, { scopeAfterQuota: true }]) {
    const h = harness(options), result = await h.execute(h.create("Lis mes crédits"), "readAccountServices", { view: "credits", offset: 0 }); assert.equal(result.status, "blocked"); assert.equal(result.credits, undefined); assert.equal(result.unlimited, undefined);
  }
});
test("marking notifications read is native, idempotent, account-scoped and never deletes stored notifications", async () => {
  const h = harness(), message = "Marque toutes mes notifications comme lues", tools = h.create(message), input = { notificationIds: null, instructionQuote: message };
  assert.equal((await h.execute(tools, "markNotificationsRead", input)).status, "read"); assert.equal((await h.execute(tools, "markNotificationsRead", input)).status, "read");
  assert.equal(h.rows.length, 2); assert.ok(h.rows[0].read_at); assert.equal(h.rows[1].read_at, null); assert.equal(h.writes.length, 1);
  h.actor(); assert.equal((await h.execute(h.create(message), "markNotificationsRead", input)).status, "blocked");
});
test("notification targets cannot expand one selected notice into all or fabricate another account ID", async () => {
  const h = harness(), message = "Marque cette notification comme lue", tools = h.create(message);
  assert.equal((await h.execute(tools, "markNotificationsRead", { notificationIds: null, instructionQuote: message })).status, "needs_details");
  assert.equal((await h.execute(tools, "markNotificationsRead", { notificationIds: [ID], instructionQuote: message })).status, "needs_details");
  await h.execute(tools, "readAccountServices", { view: "notifications", offset: 0 });
  assert.equal((await h.execute(tools, "markNotificationsRead", { notificationIds: [OTHER], instructionQuote: message })).status, "needs_details");
  assert.equal((await h.execute(tools, "markNotificationsRead", { notificationIds: [ID], instructionQuote: message })).status, "read");
});
test("account downloads bind the requested document kind and exact invoice reference", async () => {
  const h = harness();
  for (const message of ["Télécharge cette photo", "Télécharge cette photo. Exemple : « export RGPD »", "Comment exporter mes données personnelles ?", "Exporte mes données personnelles demain"]) {
    assert.equal((await h.execute(h.create(message), "prepareAccountDocumentDownload", { kind: "account_export", invoiceId: null, instructionQuote: message })).status, "needs_instruction");
    assert.equal((await h.execute(h.create(message), "prepareAccountDocumentDownload", { kind: "subscription_invoice", invoiceId: "in_LATEST", instructionQuote: message })).status, "needs_instruction");
  }
  const exportMessage = "Télécharge mon export RGPD";
  const exported = await h.execute(h.create(exportMessage), "prepareAccountDocumentDownload", { kind: "account_export", invoiceId: null, instructionQuote: exportMessage }); assert.ok(parseInrAssistantAccountDocumentCommand(exported.uiCommand));
  const latest = "Télécharge ma dernière facture d’abonnement";
  assert.equal((await h.execute(h.create(latest), "prepareAccountDocumentDownload", { kind: "subscription_invoice", invoiceId: "in_OLD", instructionQuote: latest })).status, "needs_details");
  const invoice = await h.execute(h.create(latest), "prepareAccountDocumentDownload", { kind: "subscription_invoice", invoiceId: "in_LATEST", instructionQuote: latest }); assert.ok(parseInrAssistantAccountDocumentCommand(invoice.uiCommand)); assert.doesNotMatch(JSON.stringify(invoice), /pay\.stripe|private/);
  const specific = "Télécharge ma facture d’abonnement INV-001"; assert.equal((await h.execute(h.create(specific), "prepareAccountDocumentDownload", { kind: "subscription_invoice", invoiceId: "in_OLD", instructionQuote: specific })).status, "ui_action_requested");
});
test("cookie preference commands require the matching explicit opt-in/opt-out and never change essential cookies", async () => {
  const h = harness(), message = "Désactive les cookies statistiques";
  const result = await h.execute(h.create(message), "configureCookieConsent", { analytics: false, instructionQuote: message }); assert.deepEqual(parseInrAssistantAccountDocumentCommand(result.uiCommand), { command: "configure_cookie_consent", selection: { kind: "account_document", id: "cookie_preferences" }, analytics: false });
  assert.equal((await h.execute(h.create(message), "configureCookieConsent", { analytics: true, instructionQuote: message })).status, "needs_instruction");
  assert.equal((await h.execute(h.create("Comment activer les cookies ?"), "configureCookieConsent", { analytics: true, instructionQuote: "Comment activer les cookies ?" })).status, "needs_instruction");
  assert.equal(parseInrAssistantAccountDocumentCommand({ command: "configure_cookie_consent", selection: { kind: "account_document", id: "other" }, analytics: false }), null);
});
test("single-quoted instructions and incomplete code fences cannot authorize account changes, exports or notification marking", async () => {
  const h = harness();
  const cases = [
    { name: "configureCookieConsent" as const, command: "Active les cookies statistiques", input: { analytics: true } },
    { name: "prepareAccountDocumentDownload" as const, command: "Télécharge mon export RGPD", input: { kind: "account_export", invoiceId: null } },
    { name: "prepareAccountDocumentDownload" as const, command: "Télécharge ma dernière facture d’abonnement", input: { kind: "subscription_invoice", invoiceId: "in_LATEST" } },
    { name: "markNotificationsRead" as const, command: "Marque toutes mes notifications comme lues", input: { notificationIds: null } },
  ];
  for (const entry of cases) for (const message of [`Lis ceci : '${entry.command}'`, `Texte cité : ‘${entry.command}’`, `Lis ce code : \`\`\`\n${entry.command}`, `> ${entry.command}`]) {
    for (const instructionQuote of [message, entry.command]) assert.equal((await h.execute(h.create(message), entry.name, { ...entry.input, instructionQuote })).status, "needs_instruction", message);
  }
  const targetQuoted = "Télécharge cette photo ; exemple 'export RGPD'";
  assert.equal((await h.execute(h.create(targetQuoted), "prepareAccountDocumentDownload", { kind: "account_export", invoiceId: null, instructionQuote: "Télécharge cette photo" })).status, "needs_instruction");
  assert.equal(h.writes.length, 0);
});
