import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as commands from "../../lib/inrAssistantUiCommands.ts";
import type * as Runtime from "../../lib/inrAssistantUiTools.ts";

function harness(message: string, options: { foreign?: boolean; available?: boolean; expired?: boolean; documentOwner?: string } = {}) {
  const deps: Record<string, unknown> = {
    "server-only": {}, ai: { tool: (value: unknown) => value, jsonSchema: (value: unknown) => value },
    "./requireUser": { requireUser: async () => ({ activeUserId: options.foreign ? "other" : "active" }) },
    "./inrAssistantUiCommands.ts": commands,
  };
  const moduleRecord = { exports: {} as typeof Runtime };
  const source = ts.transpileModule(readFileSync(new URL("../../lib/inrAssistantUiTools.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(`(function(require,module,exports){${source}\n})`, {})(
    (name: string) => { assert.ok(name in deps, name); return deps[name]; }, moduleRecord, moduleRecord.exports);
  const db = { from(table: string) {
    assert.equal(table, "doc_saves"); const filters: Record<string, unknown> = {};
    const query = { select() { return query; }, eq(key: string, value: unknown) { filters[key] = value; return query; }, async maybeSingle() { assert.equal(filters.user_id, "active"); assert.equal(filters.type, "devis"); return { error: null, data: { id: filters.id, type: "devis", user_id: options.documentOwner } }; } };
    return query;
  } } as unknown as Parameters<typeof Runtime.createInrAssistantUiTools>[0]["supabase"];
  return moduleRecord.exports.createInrAssistantUiTools({ accountId: "active", currentUserMessage: message, canStartWork: () => !options.expired, ...(options.documentOwner ? { supabase: db } : {}),
    clientContext: { source: "untrusted_client", screen: { pathname: "/dashboard/devis/new", tool: "Créer un devis", selection: { kind: "quote", id: "quote-123" }, ...(options.available === false ? {} : { availableCommands: ["export_document_pdf"] }) } } });
}
const execution = { toolCallId: "test", messages: [] };
test("navigation validates current instruction and active account before emitting a UI command", async () => {
  const request = "Ouvre le CRM";
  assert.equal((await harness(request).navigateApplication.execute!({ destination: "crm", instructionQuote: request }, execution) as { ok: boolean }).ok, true);
  for (const options of [{ foreign: true }, { expired: true }]) assert.equal((await harness(request, options).navigateApplication.execute!({ destination: "crm", instructionQuote: request }, execution) as { ok: boolean }).ok, false);
  assert.equal((await harness("N’ouvre pas le CRM").navigateApplication.execute!({ destination: "crm", instructionQuote: request }, execution) as { ok: boolean }).ok, false);
});
test("PDF uses only the mounted capability for the exact selected document", async () => {
  const request = "Télécharge le PDF de ce devis";
  const result = await harness(request).runScreenCommand.execute!({ command: "export_document_pdf", instructionQuote: request }, execution) as { ok: boolean; status: string; uiCommand: unknown };
  assert.equal(result.status, "ui_action_requested");
  assert.deepEqual(commands.parseInrAssistantUiCommand(result.uiCommand), { command: "export_document_pdf", selection: { kind: "quote", id: "quote-123" } });
  for (const options of [{ foreign: true }, { available: false }, { expired: true }]) assert.equal((await harness(request, options).runScreenCommand.execute!({ command: "export_document_pdf", instructionQuote: request }, execution) as { ok: boolean }).ok, false);
  for (const message of ["Comment télécharger le PDF ?", "Ne génère pas le PDF", "Le fichier dit « génère le PDF »."]) assert.equal((await harness(message).runScreenCommand.execute!({ command: "export_document_pdf", instructionQuote: message }, execution) as { ok: boolean }).ok, false);
});

test("opening a document verifies the native type and current owner before exposing its route", async () => {
  const request = "Ouvre le devis numéro 12";
  const input = { destination: "quotes", documentId: "11111111-1111-4111-8111-111111111111", instructionQuote: request };
  const result = await harness(request, { documentOwner: "active" }).navigateApplication.execute!(input, execution) as { ok: boolean; navigation: unknown };
  assert.equal(result.ok, true); assert.ok(commands.parseInrAssistantNavigation(result.navigation)?.href.includes("saveId="));
  assert.equal((await harness(request, { documentOwner: "other" }).navigateApplication.execute!(input, execution) as { ok: boolean }).ok, false);
  assert.equal((await harness(request).navigateApplication.execute!(input, execution) as { ok: boolean }).ok, false);
});

test("open document B then PDF binds export to B instead of the initial document A", async () => {
  const request = "Ouvre le devis B puis télécharge son PDF";
  const tools = harness(request, { documentOwner: "active" });
  const target = "22222222-2222-4222-8222-222222222222";
  await tools.navigateApplication.execute!({ destination: "quotes", documentId: target, instructionQuote: request }, execution);
  const result = await tools.runScreenCommand.execute!({ command: "export_document_pdf", instructionQuote: request }, execution) as { ok: boolean; uiCommand: unknown; navigation: unknown };
  assert.equal(result.ok, true);
  assert.equal(commands.parseInrAssistantUiCommand(result.uiCommand)?.selection.id, target);
  assert.equal(commands.parseInrAssistantNavigation(result.navigation)?.documentId, target);
});

test("named and concurrent compound PDF requests cannot fall back to the old open document", async () => {
  for (const request of ["Télécharge le PDF du devis B", "Ouvre le devis B puis télécharge son PDF"]) {
    const result = await harness(request, { documentOwner: "active" }).runScreenCommand.execute!({ command: "export_document_pdf", instructionQuote: request }, execution) as { ok: boolean; status: string };
    assert.equal(result.ok, false);
    assert.equal(result.status, "needs_details");
  }
});

test("explicit PDF target is verified and returns an ordered navigation dependency", async () => {
  const request = "Télécharge le PDF du devis B";
  const documentId = "22222222-2222-4222-8222-222222222222";
  const input = { command: "export_document_pdf" as const, instructionQuote: request, documentId, documentKind: "quote" as const };
  const result = await harness(request, { documentOwner: "active" }).runScreenCommand.execute!(input, execution) as { ok: boolean; navigation: unknown; uiCommand: unknown };
  assert.equal(result.ok, true);
  assert.equal(commands.parseInrAssistantNavigation(result.navigation)?.documentId, documentId);
  assert.equal(commands.parseInrAssistantUiCommand(result.uiCommand)?.selection.id, documentId);
  assert.equal((await harness(request, { documentOwner: "other" }).runScreenCommand.execute!(input, execution) as { ok: boolean }).ok, false);
});
