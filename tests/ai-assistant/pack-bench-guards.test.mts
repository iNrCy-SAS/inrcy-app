import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { jsonSchema, tool } from "ai";
import * as actionClauses from "../../lib/inrAssistantActionClause.ts";
import * as requestClauses from "../../lib/inrAssistantRequestClauses.ts";
import * as commercialDraft from "../../lib/commercialDocumentDraft.ts";
import { nativeFixtureRefusal, fixtureEffectIdentity, fixtureEffectFingerprint, projectNativeFixtureRead, providerVisualSummary, providerOutputPartSummary } from "../../scripts/lib/inr-assistant-fixture-boundary.mjs";

type Row = Record<string, unknown>;
function native(file: string): Row {
  const noIo = () => assert.fail("Pure native fixture guard must not authenticate, query or execute a route");
  const dependencies: Row = {
    "server-only": {}, "node:crypto": { createHash }, ai: { jsonSchema, tool },
    "./inrAssistantActionClause.ts": actionClauses, "./inrAssistantRequestClauses.ts": requestClauses,
    "./commercialDocumentDraft.ts": commercialDraft, "./inrAssistantMemory.ts": {},
    "./requireUser": { requireUser: noIo }, "@/lib/requireUser": { requireUser: noIo },
    "@/lib/dashboardEditionServer": { getDashboardEditionForAccountId: noIo },
    "@/lib/accountSubscriptionAccess": { getActiveSubscriptionAccountIds: noIo },
  };
  const compiled = ts.transpileModule(readFileSync(new URL(`../../lib/${file}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} as Row };
  vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, { Date, Intl, URL, Request, Response, Headers, fetch: noIo })((name: string) => { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; }, loaded, loaded.exports);
  return loaded.exports;
}
const CONTACT = "70000000-0000-4000-8000-000000000001", DRAFT = "40000000-0000-4000-8000-000000000001";

test("the model bench invokes the actual CRM field and campaign slot guards before accepting fake success", () => {
  const crm = native("inrAssistantCommercialTools.ts"), workspace = native("inrAssistantWorkspaceActionTools.ts");
  const message = "Dans le CRM, remplace uniquement le téléphone du client Alice Martin par 0601020304.";
  const input = { action: "update", contactId: CONTACT, reference: "Alice Martin", instructionQuote: message, fields: { phone: "0601020304", email: "alice@example.invalid", notes: "Conserver" } };
  const refusal = nativeFixtureRefusal("manageCrmContact", input, { currentUserMessage: message }, crm);
  assert.equal(refusal?.inputIssue, "unrequested_fields"); assert.equal(refusal?.noEffect, true);
  assert.equal(nativeFixtureRefusal("manageCrmContact", { ...input, fields: { phone: "0601020304", email: null, notes: null } }, { currentUserMessage: message }, crm), null);
  const prompt = "Prépare une campagne mail Offrir pour mes clients, sans envoi.";
  const campaign = { instructionQuote: prompt, track: "promo_mail", subject: "Offre", bodyText: "Bonjour", operationKey: "revision-promo" };
  assert.equal(nativeFixtureRefusal("prepareCampaignEmail", campaign, { currentUserMessage: prompt }, workspace)?.inputIssue, "operation_key_requires_counted_batch");
  assert.equal(nativeFixtureRefusal("prepareCampaignEmail", { ...campaign, operationKey: null }, { currentUserMessage: prompt }, workspace), null);
});

test("native canonical batch slots prevent a changed subject from becoming an extra simulated creation", () => {
  const workspace = native("inrAssistantWorkspaceActionTools.ts"), scope = { currentUserMessage: "Prépare deux brouillons de campagne mail, sans envoi." };
  const input = { instructionQuote: scope.currentUserMessage, track: "newsletter_mail", subject: "Informer", bodyText: "Bonjour", operationKey: "campaign-1" };
  assert.equal(nativeFixtureRefusal("prepareCampaignEmail", { ...input, operationKey: null }, scope, workspace)?.inputIssue, "operation_key_requires_counted_batch");
  assert.equal(fixtureEffectIdentity("prepareCampaignEmail", input, scope, workspace), fixtureEffectIdentity("prepareCampaignEmail", { ...input, subject: "Autre sujet", operationKey: "other-prefix-1" }, scope, workspace));
  assert.notEqual(fixtureEffectIdentity("prepareCampaignEmail", input, scope, workspace), fixtureEffectIdentity("prepareCampaignEmail", { ...input, operationKey: "campaign-2" }, scope, workspace));
  assert.equal(fixtureEffectFingerprint("prepareCampaignEmail", input, workspace), fixtureEffectFingerprint("prepareCampaignEmail", { ...input, operationKey: "another-1" }, workspace));
  assert.notEqual(fixtureEffectFingerprint("prepareCampaignEmail", input, workspace), fixtureEffectFingerprint("prepareCampaignEmail", { ...input, subject: "Autre" }, workspace));
  const reused = (workspace.getInrAssistantWorkspaceSlotReuseRefusal as (kind: string, verified?: boolean) => Row)("campaign");
  assert.equal(reused.inputIssue, "operation_slot_reused"); assert.equal(reused.noEffect, true); assert.equal(reused.retryableInput, true);
  assert.equal((workspace.getInrAssistantWorkspaceSlotReuseRefusal as (kind: string, verified?: boolean) => Row)("campaign", false).retryableInput, undefined);
});

test("native mail/campaign conditions and agenda section guards reject incompatible fake effects", () => {
  const communication = native("inrAssistantCommunicationTools.ts"), campaign = native("inrAssistantCampaignTools.ts");
  const message = `Envoie la campagne AP-A1B2C3D4E5F6 du brouillon ${DRAFT} si Julie confirme.`;
  assert.equal(nativeFixtureRefusal("dispatchCampaignAudience", { draftId: DRAFT, reference: "AP-A1B2C3D4E5F6", instructionQuote: message.slice(0, message.indexOf(" si ")) }, { currentUserMessage: message }, campaign)?.ok, false);
  const agenda = "Confirme le rendez-vous Alice dans mon agenda.";
  assert.equal(nativeFixtureRefusal("readCommunicationRecords", { section: "drafts", recordId: null, query: "Alice", timeMin: null, timeMax: null }, { currentUserMessage: agenda }, communication)?.inputIssue, "calendar_section_required");
});

test("synthetic readers filter the actual query and section and retain native private-text boundaries", () => {
  const search = { ok: true, contacts: [{ id: CONTACT, name: "Alice Martin", email: "PRIVATE", notes: "PRIVATE" }, { id: DRAFT, name: "Bob Martin" }] };
  assert.equal(projectNativeFixtureRead("searchCrmContacts", { query: "Alice Martin" }, search).contacts.length, 1);
  assert.doesNotMatch(JSON.stringify(projectNativeFixtureRead("searchCrmContacts", { query: "Alice Martin" }, search)), /PRIVATE|email|notes/);
  assert.equal(projectNativeFixtureRead("searchCrmContacts", { query: "Inconnu" }, search).contacts.length, 0);
  const event = { id: CONTACT, title: "Alice", status: "draft", start: "2030-01-15T09:00:00Z", end: "2030-01-15T10:00:00Z", text: "PRIVATE" };
  const output = { ok: true, items: [event, { id: DRAFT, title: "Révision", status: "draft", text: "PRIVATE", recipientCount: 0 }] };
  const mail = projectNativeFixtureRead("readCommunicationRecords", { section: "drafts", recordId: null, query: "Révision" }, output);
  assert.equal(mail.items.length, 1); assert.equal(mail.items[0].id, DRAFT); assert.doesNotMatch(JSON.stringify(mail), /PRIVATE|start|end/);
  assert.equal(projectNativeFixtureRead("readCommunicationRecords", { section: "mail_history", recordId: null, query: null }, output).items.length, 0);
});

test("provider visual observability counts transmitted parts without retaining payload, URLs or text", () => {
  const summary = providerVisualSummary({ prompt: [{ role: "user", content: [
    { type: "image", image: "SECRET_IMAGE" }, { type: "image_url", image_url: "SECRET_URL" },
    { type: "file", mediaType: "image/png", data: "SECRET_FILE_IMAGE" }, { type: "file", mimeType: "image/jpeg", data: "SECRET_MIME_IMAGE" },
    { type: "file", mediaType: "audio/mp3", data: "SECRET_AUDIO" }, { type: "text", text: "PRIVATE_TEXT" },
  ] }] });
  assert.equal(summary.visualCount, 4); assert.deepEqual(summary.visualParts, { image: 1, image_url: 1, file_image: 2 });
  assert.equal(summary.serverFileTransmission, null); assert.doesNotMatch(JSON.stringify(summary), /SECRET|PRIVATE/);
});

test("provider output diagnostics retain only part types and UTF8 sizes, including metadata sizes", () => {
  const content = [
    { type: "text", text: "PRIVATE é", providerMetadata: { hidden: "SECRET_METADATA" } },
    { type: "reasoning", text: "SECRET_REASONING", providerMetadata: { encrypted: "SECRET_ENCRYPTED" } },
    { type: "file", data: "SECRET_IMAGE", mediaType: "image/png" },
  ];
  const summary = providerOutputPartSummary({ content });
  assert.deepEqual(summary.map((part: { type: string }) => part.type), ["text", "reasoning", "file"]);
  for (let index = 0; index < content.length; index++) {
    assert.equal(summary[index].serializedBytes, new TextEncoder().encode(JSON.stringify(content[index])).byteLength);
    assert.equal(summary[index].providerMetadataBytes, content[index].providerMetadata === undefined ? 0 : new TextEncoder().encode(JSON.stringify(content[index].providerMetadata)).byteLength);
  }
  assert.doesNotMatch(JSON.stringify(summary), /PRIVATE|SECRET|"hidden":|"encrypted":|"data":|"text":|"providerMetadata":/);
});
