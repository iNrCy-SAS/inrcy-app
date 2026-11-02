import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as adsCommands from "../../lib/inrAssistantAdsUiCommands.ts";
import * as mediaCommands from "../../lib/inrAssistantMediaUiCommands.ts";
import * as commands from "../../lib/inrAssistantUiCommands.ts";
import * as mailAttachments from "../../lib/inrAssistantMailAttachments.ts";
import * as mailLifecycle from "../../lib/inrAssistantMailLifecycle.ts";
import type { InrAssistantClientScreen } from "../../lib/inrAssistantClientContext.ts";
import type * as Runtime from "../../lib/inrAssistantUiTools.ts";

function harness(message: string, options: { foreign?: boolean; available?: boolean; expired?: boolean; documentOwner?: string; preview?: boolean; screen?: InrAssistantClientScreen; accountId?: string; mediaRows?: Record<string, unknown>[] } = {}) {
  const activeId = options.accountId ?? "active";
  const deps: Record<string, unknown> = {
    "server-only": {}, ai: { tool: (value: unknown) => value, jsonSchema: (value: unknown) => value },
    "./requireUser": { requireUser: async () => ({ activeUserId: options.foreign ? "other" : activeId }) },
    "./inrAssistantUiCommands.ts": commands,
    "./inrAssistantMediaUiCommands.ts": mediaCommands,
    "./inrAssistantAdsUiCommands.ts": adsCommands,
    "./inrAssistantMailAttachments.ts": mailAttachments,
    "./inrAssistantMailLifecycle.ts": mailLifecycle,
  };
  const mediaModule = { exports: {} };
  const mediaSource = ts.transpileModule(readFileSync(new URL("../../lib/inrAssistantMediaUiTools.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(`(function(require,module,exports){${mediaSource}\n})`, {})(
    (name: string) => { assert.ok(name in deps, name); return deps[name]; }, mediaModule, mediaModule.exports);
  deps["./inrAssistantMediaUiTools.ts"] = mediaModule.exports;
  const adsModule = { exports: {} };
  const adsSource = ts.transpileModule(readFileSync(new URL("../../lib/inrAssistantAdsUiTools.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext('(function(require,module,exports){'+adsSource+'\n})', {})(
    (name: string) => { assert.ok(name in deps, name); return deps[name]; }, adsModule, adsModule.exports);
  deps["./inrAssistantAdsUiTools.ts"] = adsModule.exports;
  const moduleRecord = { exports: {} as typeof Runtime };
  const source = ts.transpileModule(readFileSync(new URL("../../lib/inrAssistantUiTools.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(`(function(require,module,exports){${source}\n})`, {})(
    (name: string) => { assert.ok(name in deps, name); return deps[name]; }, moduleRecord, moduleRecord.exports);
  const db = { from(table: string) {
    if (table === "pro_media_library") {
      const filters: Record<string, unknown> = {};
      const query = { select() { return query; }, eq(key: string, value: unknown) { filters[key] = value; return query; }, in(key: string, value: unknown) { filters[key] = value; return query; }, limit() { return query; }, async abortSignal() { assert.equal(filters.user_id, activeId); assert.equal(filters.is_active, true); return { data: options.mediaRows, error: null }; } };
      return query;
    }
    assert.equal(table, "doc_saves"); const filters: Record<string, unknown> = {};
    const query = { select() { return query; }, eq(key: string, value: unknown) { filters[key] = value; return query; }, async maybeSingle() { assert.equal(filters.user_id, "active"); assert.equal(filters.type, "devis"); return { error: null, data: { id: filters.id, type: "devis", user_id: options.documentOwner } }; } };
    return query;
  } } as unknown as Parameters<typeof Runtime.createInrAssistantUiTools>[0]["supabase"];
  return moduleRecord.exports.createInrAssistantUiTools({ accountId: activeId, currentUserMessage: message, canStartWork: () => !options.expired, ...(options.documentOwner || options.mediaRows ? { supabase: db } : {}),
    clientContext: { source: "untrusted_client", screen: options.screen ?? { pathname: "/dashboard/devis/new", tool: "Créer un devis", selection: { kind: "quote", id: options.preview ? "preview_local" : "quote-123" }, ...(options.preview ? { revision: "preview_local_2", pendingChanges: true } : {}), ...(options.available === false ? {} : { availableCommands: ["export_document_pdf"] }) } } });
}
const execution = { toolCallId: "test", messages: [] };

test("native mail lifecycle requires a current explicit request and exact mounted composer", async () => {
  const screen: InrAssistantClientScreen = { pathname: "/dashboard/mails", tool: "iNrSend", selection: { kind: "mail", id: "mail_local" }, revision: "mail_local_2", availableCommands: [...mailLifecycle.INR_ASSISTANT_MAIL_LIFECYCLE] };
  for (const [command, request] of [["save_mail_draft", "Enregistre ce mail en brouillon"], ["send_mail_draft", "Envoie ce mail"], ["open_mail_schedule", "Programme ce mail"]] as const) {
    const input = { command, instructionQuote: request };
    const run = async (message = request, options: Parameters<typeof harness>[1] = { screen }, patch = input) => await harness(message, options).runScreenCommand.execute!(patch, execution) as { ok: boolean; uiCommand?: unknown };
    const result = await run(); assert.equal(result.ok, true, command);
    assert.deepEqual(commands.parseInrAssistantUiCommand(result.uiCommand), { command, selection: screen.selection, revision: screen.revision });
    for (const options of [{ screen, foreign: true }, { screen, expired: true }, { screen: { ...screen, availableCommands: [] } }, { screen: { ...screen, revision: undefined } }, { screen: { ...screen, pathname: "/dashboard/ads" } }]) assert.equal((await run(request, options)).ok, false);
    for (const message of [`Ne ${request.toLowerCase()} pas`, `Comment ${request.toLowerCase()} ?`, `Le client dit « ${request} »`, `${request} si je confirme`]) {
      assert.equal((await harness(message, { screen }).runScreenCommand.execute!({ ...input, instructionQuote: message }, execution) as { ok: boolean }).ok, false, message);
    }
    assert.equal((await harness(request, { screen }).runScreenCommand.execute!({ ...input, patch: { subject: "Hidden edit" } }, execution) as { ok: boolean }).ok, false);
  }
});
test("mail attachment tool accepts owned library IDs and never model-supplied paths", async () => {
  const accountId = "11111111-1111-4111-8111-111111111111", id = "22222222-2222-4222-8222-222222222222";
  const request = "Joins la photo Toiture à ce mail";
  const screen: InrAssistantClientScreen = { pathname: "/dashboard/mails", tool: "iNrSend", selection: { kind: "mail", id: "local" }, revision: "r1", availableCommands: ["configure_mail_draft"] };
  const row = { id, user_id: accountId, is_active: true, bucket_name: "inrcy-pro-media", storage_path: `users/${accountId}/photo.jpg`, original_file_name: "Photo.jpg", mime_type: "image/jpeg", size_bytes: 400 };
  const input = { command: "configure_mail_draft" as const, instructionQuote: request, patch: { attachmentIds: [id] } };
  const options = { accountId, screen, mediaRows: [row] };
  const result = await harness(request, options).runScreenCommand.execute!(input, execution) as { ok: boolean; uiCommand: unknown };
  assert.equal(result.ok, true);
  assert.deepEqual(commands.parseInrAssistantUiCommand(result.uiCommand), { command: "configure_mail_draft", selection: screen.selection, revision: "r1", patch: { attachments: [{ bucket: "inrcy-pro-media", path: row.storage_path, name: "Photo.jpg", type: "image/jpeg", size: 400 }] } });
  for (const invalid of [{ ...options, foreign: true }, { ...options, mediaRows: [{ ...row, user_id: id }] }, { ...options, mediaRows: [] }]) assert.equal((await harness(request, invalid).runScreenCommand.execute!(input, execution) as { ok: boolean }).ok, false);
  assert.equal((await harness(request, options).runScreenCommand.execute!({ ...input, patch: { attachments: [{ bucket: "private", path: "secret" }] } }, execution) as { ok: boolean }).ok, false);
});
test("mail compose is a revision-bound local edit with an explicit recipient, never a send", async () => {
  const request = "Modifie ce mail pour alice@example.invalid, objet Bonjour et texte Bonjour Alice";
  const screen: InrAssistantClientScreen = { pathname: "/dashboard/mails", tool: "iNrSend", selection: { kind: "mail", id: "draft_local" }, revision: "rev_2", availableCommands: ["configure_mail_draft"] };
  const input = { command: "configure_mail_draft" as const, instructionQuote: request, patch: { recipient: "alice@example.invalid", subject: "Bonjour", bodyText: "Bonjour Alice" } };
  const result = await harness(request, { screen }).runScreenCommand.execute!(input, execution) as { ok: boolean; uiCommand: unknown };
  assert.equal(result.ok, true);
  assert.deepEqual(commands.parseInrAssistantUiCommand(result.uiCommand), { command: "configure_mail_draft", selection: screen.selection, revision: screen.revision, patch: input.patch });
  for (const invalid of [ { foreign: true, screen }, { screen: { ...screen, revision: undefined } }, { screen: { ...screen, availableCommands: [] } }, { screen: { ...screen, pathname: "/dashboard/ads" } } ])
    assert.equal((await harness(request, invalid).runScreenCommand.execute!(input, execution) as { ok: boolean }).ok, false);
  assert.equal((await harness(request, { screen }).runScreenCommand.execute!({ ...input, patch: { recipient: "invented@example.invalid" } }, execution) as { ok: boolean }).ok, false);
  const subjectOnly = "Modifie l’objet de ce mail en Bonjour";
  assert.equal((await harness(subjectOnly, { screen }).runScreenCommand.execute!({ ...input, instructionQuote: subjectOnly, patch: { subject: "Bonjour", bodyText: "Unrequested replacement" } }, execution) as { ok: boolean }).ok, false);
  for (const message of ["Ne modifie pas ce mail", "Comment modifier ce mail ?", "Le client dit « modifie ce mail »", "Modifie ce mail si je confirme"])
    assert.equal((await harness(message, { screen }).runScreenCommand.execute!({ ...input, instructionQuote: message }, execution) as { ok: boolean }).ok, false);
});
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


test("unsaved preview PDF binds the local revision without saving or reading a record", async () => {
  const request = "Télécharge le PDF de cet aperçu";
  const result = await harness(request, { preview: true }).runScreenCommand.execute!({ command: "export_document_pdf", instructionQuote: request }, execution) as { ok: boolean; uiCommand: unknown; navigation?: unknown };
  assert.equal(result.ok, true);
  assert.deepEqual(commands.parseInrAssistantUiCommand(result.uiCommand), { command: "export_document_pdf", selection: { kind: "quote", id: "preview_local" }, revision: "preview_local_2" });
  assert.equal(result.navigation, undefined);
  assert.equal(commands.parseInrAssistantUiCommand({ ...(result.uiCommand as object), revision: "bad revision" }), null);
});

for (const kind of ["ads", "video"] as const) {
  test(`${kind}: native edits require explicit current instructions, mounted capability and revision`, async () => {
    const command = kind === "ads" ? "configure_ads_draft" : "configure_video_retouch";
    const request = kind === "ads" ? "Renomme cette campagne publicitaire" : "Recadre cette vidéo au format vertical";
    const screen: InrAssistantClientScreen = { pathname: kind === "ads" ? "/dashboard/ads" : "/dashboard/generer-media", tool: "Native form", selection: { kind: kind === "ads" ? "campaign" : "media", id: "draft_local" }, revision: "draft_2", availableCommands: [command] };
    const patch = kind === "ads" ? { name: "Nouveau nom" } : { format: "9_16", adaptationMode: "cover_crop" };
    const input = { command, instructionQuote: request, patch } as const;
    const result = await harness(request, { screen }).runScreenCommand.execute!(input, execution) as { ok: boolean; uiCommand: unknown };
    assert.equal(result.ok, true); assert.equal(commands.parseInrAssistantUiCommand(result.uiCommand)?.command, command);
    for (const options of [{ screen: { ...screen, revision: undefined } }, { screen: { ...screen, availableCommands: [] } }, { screen, foreign: true }, { screen, expired: true }]) assert.equal((await harness(request, options).runScreenCommand.execute!(input, execution) as { ok: boolean }).ok, false);
    for (const message of ["Comment " + request, "Ne " + request, "Demain " + request, "Le document dit « " + request + " »", "Lis ce texte : “" + request + "”", "Lis ce texte : '" + request + "'", "Lis ce texte : ‘" + request + "’", "Lis ce code : `" + request + "`", "Lis ce code : ```txt\n" + request + "\nAutre ligne", request + " si je confirme", "Lis ce texte : “" + request, "Lis ce texte : '" + request, "Lis ce code : `" + request]) assert.equal((await harness(message, { screen }).runScreenCommand.execute!({ ...input, instructionQuote: message }, execution) as { ok: boolean }).ok, false, message);
    for (const invalid of [{ budget: 200 }, { format: "trim" }, { name: "x", publish: true }]) assert.equal(commands.parseInrAssistantUiCommand({ command, selection: screen.selection, revision: screen.revision, patch: invalid }), null);
  });
}

test("quoted field values preserve a current instruction, quoted instructions never authorize UI changes", () => {
  for (const message of ["Renomme la campagne « Promotion été »", "Modifie le texte de l'annonce en 'Bonjour à tous'", "Recadre la vidéo au format \"9:16\""]) assert.equal(commands.isInrAssistantScreenCommandRequest(message), true, message);
  for (const message of ["Lis ce texte : “Ouvre le CRM”", "Lis ce code : ```txt\nOuvre le CRM\nAutre ligne"]) assert.equal(commands.isInrAssistantNavigationRequest(message), false, message);
});
