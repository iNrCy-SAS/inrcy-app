import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as crypto from "node:crypto";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as clauses from "../../lib/inrAssistantActionClause.ts";
import * as commands from "../../lib/inrAssistantDocumentUiCommands.ts";
import * as template from "../../lib/commercialDocumentTemplate.ts";
import { COMMERCIAL_UUID } from "../../lib/commercialDocumentDraft.ts";
import { commercialDocumentRow } from "../../lib/commercialDocumentValidation.ts";
const A = "11111111-1111-4111-8111-111111111111", ID = "22222222-2222-4222-8222-222222222222", ACTOR = "33333333-3333-4333-8333-333333333333", VERSION = "2026-11-02T12:00:00Z";
type Row = Record<string, unknown>; type Tool = { execute(input: Row): Promise<Row> };
const clone = <T,>(v: T): T => JSON.parse(JSON.stringify(v));
function harness(options: { noAuth?: boolean; account?: string; actor?: string; edition?: string; inactive?: boolean; template?: boolean; conflict?: boolean; readbackError?: boolean; insertLost?: boolean; insertError?: boolean; deleteError?: boolean; owner?: string; dirty?: boolean } = {}) {
  const original = { id: ID, user_id: options.owner ?? A, type: "facture", name: "Standard", updated_at: VERSION, payload: {
    number: "FAC-001", clientName: "PRIVATE CLIENT", clientEmail: "private@example.test", isFinalized: true, officialSequenceValue: 88,
    isTemplate: options.template ?? false, templateName: "Standard", serviceDateMode: "period", serviceDate: "2026-10-01", servicePeriodStart: "2026-10-01", servicePeriodEnd: "2026-10-31",
    lines: [{ id: "old", label: "Prestation", qty: 2, unitPrice: 90, vatRate: 20, details: "Détail" }], discountValue: "5", notes: "Note", invoiceMention: "Mention", quoteMention: "Ignore", providerOverride: { name: "Prestataire" },
  } };
  const rows = new Map<string, Row>([[ID, clone(original)]]), calls: Row[] = []; let writes = 0;
  const db = { from(table: string) {
    assert.equal(table, "doc_saves"); const filters: Row = {}; let operation = "read";
    const q = { select() { return q; }, eq(k: string, v: unknown) { filters[k] = v; return q; }, delete() { operation = "delete"; return q; },
      async insert(value: Row) { calls.push({ operation: "insert", value: clone(value) }); if (options.insertError) return { error: {} }; if (rows.has(String(value.id))) return { error: { code: "23505" } }; rows.set(String(value.id), clone(value)); writes++; return { error: options.insertLost ? {} : null }; },
      async maybeSingle() {
        calls.push({ operation, filters: clone(filters) }); assert.equal(filters.user_id, A); assert.equal(filters.type, "facture");
        if (writes && options.readbackError) return { data: null, error: {} };
        if (operation === "delete" && options.conflict) rows.get(ID)!.updated_at = "2026-11-03T12:00:00Z";
        const item = [...rows.values()].find(value => Object.entries(filters).every(([key, expected]) => key === "payload->>isTemplate" ? String((value.payload as Row).isTemplate) === expected : value[key] === expected));
        if (operation === "delete" && options.deleteError) return { data: null, error: {} };
        if (operation === "delete" && item) { rows.delete(String(item.id)); writes++; }
        return { data: item ? clone(item) : null, error: null };
      },
    }; return q;
  } };
  const deps: Row = { "server-only": {}, "node:crypto": crypto, "next/server": { NextResponse: Response },
    "@/lib/requireUser": { requireUser: async () => options.noAuth ? { errorResponse: Response.json({}, { status: 401 }) } : { supabase: db, activeUserId: options.account ?? A, authUserId: options.actor ?? ACTOR } },
    "@/lib/dashboardEditionServer": { getDashboardEditionForAccountId: async () => options.edition ?? "founder" },
    "@/lib/accountSubscriptionAccess": { getActiveSubscriptionAccountIds: async () => new Set(options.inactive ? [] : [A]) },
    "@/lib/commercialDocumentDraft": { COMMERCIAL_UUID }, "@/lib/commercialDocumentValidation": { commercialDocumentRow },
    "@/lib/commercialDocumentTemplate": template, "@/lib/observability/withApi": { withApi: (fn: unknown) => fn },
  };
  function load<T>(file: string): T {
    const source = ts.transpileModule(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
    const mod = { exports: {} }; vm.runInNewContext(`(function(require,module,exports){${source}\n})`, { Request, Response, Headers, URL, Date, Buffer, process: { env: { INRCY_ASSISTANT_APPROVAL_SECRET: "not-live-fixture-".repeat(8) } } })((name: string) => { assert.ok(name in deps, name); return deps[name]; }, mod, mod.exports); return mod.exports as T;
  }
  deps["./inrAssistantRequestClauses.ts"] = { inrAssistantMaskQuotedText: clauses.inrAssistantMaskQuotedText };
  deps["@/lib/inrAssistantActionPreview"] = load("lib/inrAssistantActionPreview.ts");
  deps["@/lib/commercialMutationIdempotency"] = load("lib/commercialMutationIdempotency.ts");
  const route = load<{ POST(request: Request): Promise<Response> }>("app/api/documents/templates/route.ts");
  Object.assign(deps, { ai: { tool: (v: unknown) => v, jsonSchema: (v: unknown) => v }, "./requireUser": deps["@/lib/requireUser"], "./dashboardEditionServer": deps["@/lib/dashboardEditionServer"], "./accountSubscriptionAccess": deps["@/lib/accountSubscriptionAccess"], "./inrAssistantActionPreview.ts": deps["@/lib/inrAssistantActionPreview"], "./inrAssistantActionClause.ts": clauses, "./commercialDocumentTemplate.ts": template, "./inrAssistantDocumentUiCommands.ts": commands, "@/app/api/documents/templates/route": route });
  const factory = load<{ createInrAssistantDocumentTemplateTools(options: Row): Record<string, Tool> }>("lib/inrAssistantDocumentTemplateTools.ts");
  const tokens = new Map<string, string>();
  const tools = (message: string, patch: Row = {}) => factory.createInrAssistantDocumentTemplateTools({ request: new Request("https://fixture.invalid/api/inr-assistant/chat"), accountId: A, actorUserId: ACTOR, supabase: db, edition: "founder", currentUserMessage: message, resolvePreview: (ref: string) => tokens.get(ref), ...patch });
  const preview = async (message = options.template ? "Supprime le modèle Standard." : "Crée le modèle Mensuel depuis la facture FAC-001.", extra: Row = {}, context: Row = {}) => {
    const result = await tools(message, context).previewCommercialTemplateAction.execute({ operation: options.template ? "delete" : "create", kind: "invoice", sourceId: ID, expectedUpdatedAt: VERSION, reference: options.template ? "Standard" : "FAC-001", templateName: options.template ? null : "Mensuel", instructionQuote: message, ...extra });
    if (typeof result.reference === "string" && typeof result.token === "string") tokens.set(result.reference, result.token); return result;
  };
  const run = (patch: Row = {}, headers: Row = {}) => route.POST(new Request("https://fixture.invalid/api/documents/templates", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "native-template-fixture-0001", ...headers }, body: JSON.stringify({ accountId: A, kind: "invoice", operation: "create", source: "saved", sourceId: ID, expectedUpdatedAt: VERSION, name: "Mensuel", ...patch }) }));
  const remove = () => route.POST(new Request("https://fixture.invalid/api/documents/templates", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": "native-template-fixture-0001" }, body: JSON.stringify({ accountId: A, kind: "invoice", operation: "delete", sourceId: ID, expectedUpdatedAt: VERSION }) }));
  return { rows, original, calls, writes: () => writes, run, remove, preview, tools, tokens };
}
test("saved and local sources use the same native projection, preserve reusable fields and never copy client/official/assistant state", async () => {
  const h = harness(), result = await (await h.run()).json(); assert.equal(result.status, "created"); assert.equal(result.documentCreated, false);
  const payload = h.rows.get(result.id)!.payload as Row;
  assert.equal(payload.clientName, ""); assert.equal(payload.clientEmail, ""); assert.equal(payload.number, ""); assert.equal(payload.status, "brouillon"); assert.equal(payload.isFinalized, false);
  assert.equal(payload.officialSequenceValue, undefined); assert.equal(payload.quoteMention, undefined); assert.equal(payload.serviceDate, ""); assert.equal(payload.servicePeriodEnd, "2026-10-31");
  assert.equal(payload.discountValue, 5); assert.equal(payload.invoiceMention, "Mention"); assert.deepEqual(payload.providerOverride, { name: "Prestataire" });
  assert.deepEqual((payload.lines as Row[]).map(({ id, ...line }) => line), h.original.payload.lines.map(({ id, ...line }) => line));
  assert.deepEqual(h.rows.get(ID), h.original); assert.equal(h.writes(), 1);
  const local = template.createCommercialTemplateSnapshot("invoice", h.original.payload, "Mensuel", index => `l_${result.id}_${index}`);
  const { nativeTemplateInputHash, nativeTemplatePayloadHash, ...actual } = payload; assert.ok(nativeTemplateInputHash); assert.ok(nativeTemplatePayloadHash); assert.deepEqual(actual, local);
});
test("exact creation retry recovers the same row, input conflict is refused and a lost insert response is proven by readback", async () => {
  const h = harness(), first = await (await h.run()).json(), second = await (await h.run()).json(); assert.equal(first.id, second.id); assert.equal(second.reused, true); assert.equal(h.writes(), 1);
  assert.equal((await h.run({ name: "Autre" })).status, 409); assert.equal(h.writes(), 1);
  (h.rows.get(first.id)!.payload as Row).notes = "Changed after creation";
  assert.equal((await h.run()).status, 409); assert.equal(h.writes(), 1);
  const lost = harness({ insertLost: true }); assert.equal((await lost.run()).status, 200); assert.equal(lost.writes(), 1);
});
for (const [name, config, status] of [["session", { noAuth: true }, 401], ["account", { account: ACTOR }, 403], ["edition", { edition: "premium" }, 403], ["subscription", { inactive: true }, 403], ["owner", { owner: ACTOR }, 409]] as const) test(`template creation rejects ${name} without writing`, async () => { const h = harness(config); assert.equal((await h.run()).status, status); assert.equal(h.writes(), 0); });
test("source version, forged fields, cross-origin and empty lines fail closed", async () => {
  for (const [patch, headers, status] of [[{ expectedUpdatedAt: "2020-01-01" }, {}, 409], [{ isFinalized: true }, {}, 400], [{}, { origin: "https://other.invalid" }, 403]] as [Row, Row, number][]) { const h = harness(); assert.equal((await h.run(patch, headers)).status, status); assert.equal(h.writes(), 0); }
  const h = harness(); (h.rows.get(ID)!.payload as Row).lines = []; assert.equal((await h.run()).status, 400); assert.equal(h.writes(), 0);
});
test("create from local form whitelists fields and has actor-scoped deterministic identity", async () => {
  const make = (actor: string) => { const h = harness({ actor }); const body = { operation: "create", source: "form", accountId: A, kind: "invoice", name: "Local", snapshot: { ...h.original.payload, assistantPreviewToken: "SECRET" } };
    return { h, response: h.run({ ...body, sourceId: undefined, expectedUpdatedAt: undefined }) }; };
  const a = make(ACTOR), b = make(A); const ar = await (await a.response).json(), br = await (await b.response).json();
  assert.equal(ar.status, "created"); assert.notEqual(ar.id, br.id); assert.equal((a.h.rows.get(ar.id)!.payload as Row).assistantPreviewToken, undefined);
});
test("deletion is exact template-only CAS plus absence readback; a missing replay never claims a successful deletion", async () => {
  const h = harness({ template: true }); assert.equal((await (await h.remove()).json()).status, "deleted"); assert.equal(h.rows.size, 0); assert.equal(h.writes(), 1);
  assert.equal((await h.remove()).status, 404); assert.equal(h.writes(), 1);
  const call = h.calls.find(call => call.operation === "delete")!; assert.equal((call.filters as Row).updated_at, VERSION); assert.equal((call.filters as Row)["payload->>isTemplate"], "true");
  const document = harness(); assert.equal((await document.remove()).status, 404); assert.equal(document.writes(), 0);
  const conflict = harness({ template: true, conflict: true }); assert.equal((await conflict.remove()).status, 409); assert.equal(conflict.writes(), 0);
});
test("write/readback failures never return a model operation receipt", async () => {
  for (const config of [{ insertError: true }, { readbackError: true }]) { const h = harness(config); assert.equal((await h.run()).status, 503); }
  for (const config of [{ deleteError: true }, { readbackError: true }]) { const h = harness({ template: true, ...config }); assert.equal((await h.remove()).status, 503); }
});
for (const deleting of [false, true]) test(`signed ${deleting ? "deletion" : "creation"} preview is inert, exact approval executes once, unrelated preview cannot be used`, async () => {
  const h = harness({ template: deleting }), preview = await h.preview(); assert.equal(preview.status, "preview_ready"); assert.equal(h.writes(), 0);
  const reference = String(preview.reference), instructionQuote = `Confirme ${reference}`, apply = h.tools(instructionQuote).applyCommercialTemplateAction;
  const [a, b] = await Promise.all([apply.execute({ reference, instructionQuote }), apply.execute({ reference, instructionQuote })]);
  assert.equal(a.status, deleting ? "deleted" : "created"); assert.deepEqual(a, b); assert.equal(h.writes(), 1);
});
for (const message of ["Comment créer le modèle Mensuel depuis la facture FAC-001 ?", "Ne crée pas le modèle Mensuel depuis la facture FAC-001.", "Si je confirme, crée le modèle Mensuel depuis la facture FAC-001.", "Crée le modèle Mensuel depuis la facture FAC-001 quand je confirme.", "Le client dit « crée le modèle Mensuel depuis la facture FAC-001 ».", "```\nCrée le modèle Mensuel depuis la facture FAC-001.\n```", "Crée le modèle Mensuel depuis la facture FAC-001Plus."]) test(`template instruction remains inert: ${message}`, async () => { const h = harness(); assert.equal((await h.preview(message)).ok, false); assert.equal(h.writes(), 0); });
test("changed version, actor, dirty source and unconfirmed/quoted approvals cannot mutate", async () => {
  const h = harness(), preview = await h.preview(), reference = String(preview.reference);
  for (const instructionQuote of [`Ne confirme pas ${reference}`, `Le texte dit « Confirme ${reference} »`, `Si je confirme ${reference}`]) assert.equal((await h.tools(instructionQuote).applyCommercialTemplateAction.execute({ reference, instructionQuote })).ok, false);
  h.rows.get(ID)!.updated_at = "2026-11-03T12:00:00Z"; const instructionQuote = `Confirme ${reference}`;
  assert.equal((await h.tools(instructionQuote).applyCommercialTemplateAction.execute({ reference, instructionQuote })).ok, false); assert.equal(h.writes(), 0);
  assert.equal((await harness({ actor: A }).preview()).ok, false);
  assert.equal((await harness().preview(undefined, {}, { clientContext: { screen: { selection: { id: ID }, pendingChanges: true } } })).ok, false);
});
test("current form command contains only explicit name and opaque identity/revision, not its local snapshot", async () => {
  const h = harness(), instructionQuote = "Crée le modèle Mensuel depuis cette facture ouverte.";
  const context = { source: "untrusted_client", screen: { pathname: "/dashboard/factures/new", selection: { kind: "invoice", id: "preview_form" }, revision: "revision1", availableCommands: ["create_document_template"], pendingChanges: true, secret: "PRIVATE" } };
  const result = await h.tools(instructionQuote, { clientContext: context }).prepareCurrentDocumentTemplate.execute({ templateName: "Mensuel", instructionQuote });
  assert.equal(result.status, "ui_requested"); assert.deepEqual(JSON.parse(JSON.stringify(result.uiCommand)), { command: "create_document_template", selection: { kind: "invoice", id: "preview_form" }, revision: "revision1", templateName: "Mensuel" });
  assert.equal(h.writes(), 0); assert.doesNotMatch(JSON.stringify(result), /PRIVATE|clientName|unitPrice|snapshot/);
  for (const message of ["Comment créer le modèle Mensuel depuis cette facture ?", "Crée le modèle Mensuel depuis ce devis.", "Crée le modèle Mensuel depuis la facture FAC-OTHER.", "Si je confirme, crée le modèle Mensuel depuis cette facture."]) assert.equal((await h.tools(message, { clientContext: context }).prepareCurrentDocumentTemplate.execute({ templateName: "Mensuel", instructionQuote: message })).ok, false);
  for (const templateName of ["facture", "depuis cette facture"]) {
    const message = "Crée un modèle depuis cette facture";
    assert.equal((await h.tools(message, { clientContext: context }).prepareCurrentDocumentTemplate.execute({ templateName, instructionQuote: message })).ok, false);
  }
});
