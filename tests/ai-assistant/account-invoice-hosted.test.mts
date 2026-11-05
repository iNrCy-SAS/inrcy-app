import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";
import { parseInrAssistantAccountDocumentCommand, type InrAssistantAccountDocumentCommand } from "../../lib/inrAssistantAccountDocuments.ts";
type Row = Record<string, unknown>;
const ACCOUNT = "10000000-0000-4000-8000-000000000001", ACTOR = "20000000-0000-4000-8000-000000000002";
const invoices = [{ id: "in_LATEST", number: "INV-012", hostedInvoiceUrl: "https://invoice.stripe.com/i/native-latest", invoicePdf: "https://pay.stripe.com/invoice/native-latest/pdf" }, { id: "in_OLD", number: "INV-01", hostedInvoiceUrl: "https://invoice.stripe.com/i/native-old", invoicePdf: "https://pay.stripe.com/invoice/native-old/pdf" }];
function fixture(changedDuringRead = false) {
  let actor = ACTOR, reads = 0;
  const load = runtimeModules({ "./requireUser": { requireUser: async () => ({ activeUserId: ACCOUNT, authUserId: actor }) }, "@/app/api/billing/invoices/route": { GET: async () => { reads++; if (changedDuringRead) actor = "different-actor"; return Response.json({ invoices }); } } });
  const runtime = load<typeof import("../../lib/inrAssistantAccountServiceTools.ts")>("lib/inrAssistantAccountServiceTools.ts");
  return { reads: () => reads, run: async (message: string, invoiceId = "in_LATEST", quote = message) => {
    const tool = runtime.createInrAssistantAccountServiceTools({ request: new Request("https://app.fixture.invalid/api/assistant/chat"), accountId: ACCOUNT, actorUserId: ACTOR, currentUserMessage: message, supabase: { from() { assert.fail("Invoice viewing never mutates or queries account business data"); } } }).prepareAccountDocumentDownload;
    return await tool.execute!({ kind: "subscription_invoice_hosted", invoiceId, instructionQuote: quote }, { toolCallId: "hosted", messages: [] }) as Row;
  } };
}

test("Basic hosted invoice preparation binds the exact current original quote and real authenticated invoice without exposing its URL or paying it", async () => {
  for (const [message, id] of [["Ouvre ma dernière facture d’abonnement", "in_LATEST"], ["Affiche ma facture d’abonnement INV-01", "in_OLD"], ["Consulte ma facture d’abonnement in_OLD", "in_OLD"]]) {
    const h = fixture(), result = await h.run(message, id); assert.equal(result.status, "ui_action_requested"); assert.deepEqual(parseInrAssistantAccountDocumentCommand(result.uiCommand), { command: "open_subscription_invoice_link", selection: { kind: "account_document", id }, invoiceId: id }); assert.doesNotMatch(JSON.stringify(result), /invoice\.stripe|pay\.stripe|native-old|native-latest/); assert.match(String(result.message), /Aucun paiement effectué/); assert.equal(h.reads(), 1);
  }
  for (const [message, id] of [["Ouvre ma dernière facture d’abonnement", "in_OLD"], ["Ouvre ma facture d’abonnement INV-012", "in_OLD"], ["Ouvre ma dernière facture d’abonnement INV-01", "in_LATEST"], ["Ouvre ma facture d’abonnement INV-012 et INV-01", "in_LATEST"], ["Ouvre ma facture d’abonnement in_OTHER", "in_LATEST"]]) assert.equal((await fixture().run(message, id)).ok, false, message);
  for (const message of ["Ouvre cette photo", "Télécharge ma facture d’abonnement INV-012", "Ouvre le PDF de ma facture d’abonnement INV-012", "Comment ouvrir ma facture d’abonnement INV-012 ?", "Lis ceci : 'Ouvre ma facture d’abonnement INV-012.'", "Demain ouvre ma facture d’abonnement INV-012", "N’ouvre pas ma facture d’abonnement INV-012"]) assert.equal((await fixture().run(message)).ok, false, message);
  const separate = "Ouvre cette photo puis affiche ma facture d’abonnement INV-012"; assert.equal((await fixture().run(separate, "in_LATEST", "Ouvre cette photo")).ok, false); assert.equal((await fixture().run(separate, "in_LATEST", "ma facture d’abonnement INV-012")).ok, false);
  assert.equal((await fixture(true).run("Ouvre ma dernière facture d’abonnement")).status, "blocked");
});

test("Basic native hosted invoice browser handoff rereads only its fixed native ID and Stripe URL while preserving the separate PDF flow", async () => {
  const source = ts.transpileModule(readFileSync("lib/inrAssistantAccountDocuments.ts", "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const mode of ["hosted", "pdf", "missing", "foreign", "unsafe", "malformed", "late_scope"] as const) {
    let current = true; const clicks: Row[] = [], requests: string[] = []; const native = structuredClone(invoices);
    if (mode === "missing") delete (native[0] as Row).hostedInvoiceUrl; if (mode === "unsafe") native[0].hostedInvoiceUrl = "https://attacker.invalid/i/in_LATEST"; if (mode === "malformed") native[0].hostedInvoiceUrl = "javascript:alert(1)";
    const fetchNative = async (url: string, options: RequestInit) => { requests.push(url); assert.equal(options.credentials, "include"); assert.equal(options.method, undefined); if (mode === "late_scope") current = false; return Response.json({ invoices: native }); };
    const document = { createElement(tag: string) { assert.equal(tag, "a"); const anchor: Row = { click() { clicks.push({ ...anchor, click: undefined }); } }; return anchor; } };
    const helperModule = { exports: {} as typeof import("../../lib/inrAssistantAccountDocuments.ts") }; new Function("module", "exports", "require", "fetch", "document", source)(helperModule, helperModule.exports, () => assert.fail("Invoice opening does not request cookie modules"), fetchNative, document);
    const id = mode === "foreign" ? "in_OTHER" : "in_LATEST", command = { command: mode === "pdf" ? "download_subscription_invoice" : "open_subscription_invoice_link", selection: { kind: "account_document", id }, invoiceId: id } as InrAssistantAccountDocumentCommand;
    const ok = await helperModule.exports.downloadInrAssistantAccountDocument(command, () => current); assert.equal(ok, mode === "hosted" || mode === "pdf", mode); assert.deepEqual(requests, ["/api/billing/invoices"]); assert.equal(clicks.length, ok ? 1 : 0);
    if (ok) { assert.equal(clicks[0].href, mode === "pdf" ? invoices[0].invoicePdf : invoices[0].hostedInvoiceUrl); assert.equal(clicks[0].target, "_blank"); assert.equal(clicks[0].rel, "noopener noreferrer"); }
  }
  assert.equal(parseInrAssistantAccountDocumentCommand({ command: "open_subscription_invoice_link", selection: { kind: "account_document", id: "in_OTHER" }, invoiceId: "in_LATEST" }), null);
});
