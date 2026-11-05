import assert from "node:assert/strict";
import test from "node:test";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";
import { INR_ASSISTANT_BUSINESS_RICH_TEXT_INTERFACES, isInrAssistantBusinessRichTextRequest, parseInrAssistantBusinessRichTextEdit } from "../../lib/inrAssistantBusinessRichText.ts";
type Row = Record<string, unknown>;
function fixture(message: string, options: { foreign?: boolean; expired?: boolean; missing?: boolean } = {}) {
  const load = runtimeModules({ "./requireUser": { requireUser: async () => ({ activeUserId: "account", authUserId: options.foreign ? "other" : "actor" }) } });
  const factory = load<typeof import("../../lib/inrAssistantBusinessRichTextUiTools.ts")>("lib/inrAssistantBusinessRichTextUiTools.ts");
  return factory.createInrAssistantBusinessRichTextUiTools({ accountId: "account", actorUserId: "actor", currentUserMessage: message, canStartWork: () => !options.expired, clientContext: { source: "untrusted_client", interfaces: options.missing ? [] : [{ id: "dna_text_description", operations: ["select"], revision: "rich_1" }] } }).formatBusinessDnaText;
}
test("Basic rich text formatting binds a current ADN field format and exact user passage without accepting HTML or an arbitrary range", async () => {
  assert.equal(Object.keys(INR_ASSISTANT_BUSINESS_RICH_TEXT_INTERFACES).length, 8);
  const message = "Mets en gras le passage «Notre équipe» dans la présentation ADN.", input = { field: "detailedDescription" as const, format: "bold" as const, selectionText: "Notre équipe", wholeField: false, revision: "rich_1", instructionQuote: message };
  const result = await fixture(message).execute!(input, { toolCallId: "format", messages: [] }) as Row;
  assert.equal(result.status, "ui_action_requested"); assert.match(String(result.message), /aucune persistance n’est présumée/); const command = result.uiCommand as Row;
  assert.equal(command.value, JSON.stringify({ format: "bold", selectionText: "Notre équipe", wholeField: false })); assert.equal(command.operation, "select");
  for (const option of [{ foreign: true }, { expired: true }, { missing: true }]) assert.equal((await fixture(message, option).execute!(input, {} as never) as Row).ok, false);
  assert.equal((await fixture(message).execute!({ ...input, revision: "stale" }, {} as never) as Row).ok, false);
  for (const value of [{ format: "script", selectionText: "x", wholeField: false }, { format: "bold", selectionText: "x", wholeField: false, html: "<script>" }, { format: "bold", selectionText: null, wholeField: false }, { format: "bold", selectionText: "x", wholeField: true }]) assert.equal(parseInrAssistantBusinessRichTextEdit(value), null);
});
test("Basic rich text refuses quoted instructions other application objects invented passages and an unrequested entire field", async () => {
  const input = { field: "detailedDescription" as const, format: "bold" as const, selectionText: "Notre équipe", wholeField: false, revision: "rich_1", instructionQuote: "" };
  for (const message of ["Comment mettre la présentation ADN en gras ?", "Lis ceci : 'Mets en gras Notre équipe dans la présentation ADN.'", "Ne mets pas Notre équipe en gras dans la présentation ADN.", "Mets en gras Notre équipe dans cette publication.", "Demain mets en gras Notre équipe dans la présentation ADN."]) assert.equal((await fixture(message).execute!({ ...input, instructionQuote: message }, {} as never) as Row).ok, false, message);
  const message = "Mets en gras le passage «Notre équipe» dans la présentation ADN.";
  assert.equal((await fixture(message).execute!({ ...input, selectionText: "Texte inventé", instructionQuote: message }, {} as never) as Row).ok, false);
  assert.equal((await fixture(message).execute!({ ...input, selectionText: null, wholeField: true, instructionQuote: message }, {} as never) as Row).ok, false);
  assert.equal(isInrAssistantBusinessRichTextRequest("Mets toute la présentation ADN en gras.", "detailedDescription", { format: "bold", selectionText: null, wholeField: true }), true);
});
