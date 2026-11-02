import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as clauses from "../../lib/inrAssistantActionClause.ts";
import * as documentCommands from "../../lib/inrAssistantDocumentUiCommands.ts";
import { parseInrAssistantNavigation } from "../../lib/inrAssistantUiCommands.ts";
import type * as Runtime from "../../lib/inrAssistantDocumentFormTools.ts";
const ID = "11111111-1111-4111-8111-111111111111", VERSION = "2026-11-02T12:00:00Z";
type Row = Record<string, unknown>;
type Tool = { execute(input: Row): Promise<Row> };
function harness(options: { message?: string; operation?: "convert_quote" | "apply_template"; account?: string; actor?: string; edition?: string; inactive?: boolean; expired?: boolean; dirty?: boolean; row?: Row; payload?: Row; rows?: number; readError?: boolean } = {}) {
  const operation = options.operation ?? "apply_template";
  const reference = operation === "apply_template" ? "Standard" : "DEV-001";
  const message = options.message ?? (operation === "apply_template" ? "Applique le modèle Standard à une facture." : "Convertis le devis DEV-001 en facture.");
  const document = { id: ID, user_id: "account-A", type: operation === "apply_template" ? "facture" : "devis", name: reference, updated_at: VERSION,
    payload: { isTemplate: operation === "apply_template", templateName: reference, number: reference, token: "PRIVATE", lines: [{ qty: 1 }], ...options.payload }, ...options.row };
  const reads: Row[] = [];
  const db = { from(table: string) {
    assert.equal(table, "doc_saves"); const filters: Row = {}; const ordering: unknown[] = [];
    const query = { select() { return query; }, eq(key: string, value: unknown) { filters[key] = value; return query; }, ilike(key: string, value: string) { filters[key] = value; return query; },
      order(key: string, value: unknown) { ordering.push([key, value]); return query; },
      async range(start: number, end: number) { reads.push({ filters, start, end, ordering }); return { data: Array.from({ length: options.rows ?? 9 }, (_, i) => ({ ...document, id: `row-${i}` })), error: options.readError ? {} : null }; },
      async maybeSingle() { reads.push({ filters }); return { data: document, error: options.readError ? {} : null }; },
    }; return query;
  } };
  const deps: Row = {
    "server-only": {}, ai: { tool: (value: unknown) => value, jsonSchema: (value: unknown) => value },
    "./requireUser": { requireUser: async () => ({ activeUserId: options.account ?? "account-A", authUserId: options.actor ?? "actor-A" }) },
    "./dashboardEditionServer": { getDashboardEditionForAccountId: async () => options.edition ?? "founder" },
    "./accountSubscriptionAccess": { getActiveSubscriptionAccountIds: async () => new Set(options.inactive ? [] : ["account-A"]) },
    "./inrAssistantActionClause.ts": clauses, "./inrAssistantDocumentUiCommands.ts": documentCommands,
  };
  const source = ts.transpileModule(readFileSync(new URL("../../lib/inrAssistantDocumentFormTools.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const mod = { exports: {} as typeof Runtime };
  new Function("require", "module", "exports", source)((name: string) => { assert.ok(name in deps, name); return deps[name]; }, mod, mod.exports);
  const tools = mod.exports.createInrAssistantDocumentFormTools({ request: new Request("https://fixture.invalid"), accountId: "account-A", actorUserId: "actor-A", edition: "founder",
    supabase: db as unknown as Parameters<typeof Runtime.createInrAssistantDocumentFormTools>[0]["supabase"], currentUserMessage: message, canStartWork: () => !options.expired,
    clientContext: { source: "untrusted_client", screen: { pathname: "/dashboard/devis/new", tool: "Devis", selection: { kind: "quote", id: ID }, pendingChanges: options.dirty } },
  }) as unknown as Record<string, Tool>;
  return { reads, list: (patch: Row = {}) => tools.readCommercialTemplates.execute({ kind: "invoice", query: null, offset: 0, ...patch }),
    prepare: (patch: Row = {}) => tools.prepareCommercialDocumentForm.execute({ operation, kind: "invoice", sourceId: ID, expectedUpdatedAt: VERSION, reference, instructionQuote: message, ...patch }) };
}
test("template reader applies native account/type/JSON filters and bounded stable pagination without exposing payload", async () => {
  const h = harness(), result = await h.list({ query: "100%_", offset: 8 });
  assert.equal(result.status, "read"); assert.equal((result.items as unknown[]).length, 8); assert.equal(result.nextOffset, 16);
  assert.deepEqual(h.reads[0], { filters: { user_id: "account-A", type: "facture", "payload->>isTemplate": "true", name: "%100\\%\\_%" }, start: 8, end: 16, ordering: [["updated_at", { ascending: false }], ["id", { ascending: true }]] });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|token|payload/);
  assert.equal((await harness().list({ offset: 200 })).truncated, true);
  assert.equal((await harness().list({ offset: 201 })).ok, false);
});
for (const operation of ["apply_template", "convert_quote"] as const) test(`${operation}: exact source/version produces only canonical native prefill navigation`, async () => {
  const h = harness({ operation }), result = await h.prepare();
  assert.equal(result.status, "navigation_requested"); const navigation = parseInrAssistantNavigation(result.navigation);
  assert.ok(navigation); assert.equal(navigation.documentPrefill?.operation, operation); assert.equal(navigation.documentPrefill?.sourceId, ID);
  assert.equal(navigation.documentPrefill?.expectedUpdatedAt, VERSION); assert.equal(navigation.documentId, undefined);
  const url = new URL(navigation.href, "https://fixture.invalid");
  assert.equal(url.pathname, "/dashboard/factures/new"); assert.equal(url.searchParams.get("assistantPrefill"), "1");
  assert.deepEqual(h.reads, [{ filters: { user_id: "account-A", type: operation === "convert_quote" ? "devis" : "facture", id: ID } }]);
  assert.match(String(result.message), /aucune sauvegarde, finalisation ou envoi/);
});
for (const [name, options] of Object.entries({ account: { account: "B" }, actor: { actor: "B" }, edition: { edition: "premium" }, inactive: { inactive: true }, expired: { expired: true }, readError: { readError: true }, owner: { row: { user_id: "B" } }, id: { row: { id: "B" } }, kind: { row: { type: "devis" } }, version: { row: { updated_at: "2026-11-03T12:00:00Z" } }, notTemplate: { payload: { isTemplate: false } } })) test(`form preparation refuses ${name}`, async () => {
  assert.equal((await harness(options).prepare()).ok, false);
});
test("conversion never uses an edited unsaved quote or a template as its saved source", async () => {
  assert.equal((await harness({ operation: "convert_quote", dirty: true }).prepare()).ok, false);
  assert.equal((await harness({ operation: "convert_quote", payload: { isTemplate: true } }).prepare()).ok, false);
});
for (const message of ["Comment appliquer le modèle Standard ?", "N’applique pas le modèle Standard.", "Si je confirme, applique le modèle Standard.", "Applique le modèle Standard demain.", "Le message dit « applique le modèle Standard ».", "'Applique le modèle Standard.'", "```\nexemple\nApplique le modèle Standard.\n```", "Applique le modèle StandardPlus."]) test(`template request remains inert: ${message}`, async () => {
  assert.equal((await harness({ message }).prepare()).ok, false);
});
test("prefill metadata cannot smuggle URLs or incompatible document types", () => {
  const source = { operation: "convert_quote", kind: "invoice", sourceId: ID, expectedUpdatedAt: VERSION };
  const navigation = documentCommands.getInrAssistantDocumentPrefillNavigation(source)!;
  assert.equal(parseInrAssistantNavigation({ ...navigation, href: "https://evil.invalid" }), null);
  assert.equal(parseInrAssistantNavigation({ ...navigation, documentId: ID }), null);
  assert.equal(documentCommands.parseInrAssistantDocumentPrefill({ ...source, kind: "quote" }), null);
  assert.equal(documentCommands.getInrAssistantDocumentPrefillRequest("invoice", new URLSearchParams({ assistantPrefill: "1", templateSaveId: ID, fromDevisSaveId: ID, sourceVersion: VERSION })), null);
});
