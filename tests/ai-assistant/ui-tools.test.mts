import * as websiteCommands from "../../lib/inrAssistantWebsiteUiCommands.ts";
import * as studioCommands from "../../lib/inrAssistantStudioUiCommands.ts";
import * as statsCommands from "../../lib/inrAssistantStatsUiCommands.ts";
import * as badgeCommands from "../../lib/inrAssistantBadgeUiCommands.ts";
import * as businessFormCommands from "../../lib/inrAssistantBusinessFormUiCommands.ts";
import * as actionClauses from "../../lib/inrAssistantActionClause.ts";
import * as requestClauses from "../../lib/inrAssistantRequestClauses.ts";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as adsCommands from "../../lib/inrAssistantAdsUiCommands.ts";
import * as mediaCommands from "../../lib/inrAssistantMediaUiCommands.ts";
import * as commands from "../../lib/inrAssistantUiCommands.ts";
import * as editionCommands from "../../lib/inrAssistantScreenCommandPolicy.ts";
import * as editions from "../../lib/dashboardEdition.ts";
import * as mailAttachments from "../../lib/inrAssistantMailAttachments.ts";
import * as mailLifecycle from "../../lib/inrAssistantMailLifecycle.ts";
import type { InrAssistantClientScreen } from "../../lib/inrAssistantClientContext.ts";
import type * as Runtime from "../../lib/inrAssistantUiTools.ts";
import { asSchema, generateText, jsonSchema as sdkJsonSchema, tool as sdkTool } from "ai";
import type { LanguageModelV3 } from "@ai-sdk/provider";
import { repairInrAssistantToolInput } from "../../lib/inrAssistantToolInputRepair.ts";

function harness(message: string, options: { edition?: editions.DashboardEdition; foreign?: boolean; available?: boolean; expired?: boolean; documentOwner?: string; preview?: boolean; screen?: InrAssistantClientScreen; accountId?: string; mediaRows?: Record<string, unknown>[]; realSdk?: boolean } = {}) {
  const activeId = options.accountId ?? "active";
  const deps: Record<string, unknown> = {
    "./inrAssistantWebsiteUiCommands.ts": websiteCommands,
    "./inrAssistantRequestClauses.ts": requestClauses,
    "./inrAssistantBusinessFormUiCommands.ts": businessFormCommands, "./inrAssistantActionClause.ts": actionClauses,
    "server-only": {}, ai: options.realSdk ? { tool: sdkTool, jsonSchema: sdkJsonSchema } : { tool: (value: unknown) => value, jsonSchema: (value: object, options?: {validate?:unknown}) => Object.assign(value, {validate:options?.validate}) },
    "./requireUser": { requireUser: async () => ({ activeUserId: options.foreign ? "other" : activeId }) },
    "./inrAssistantStudioUiCommands.ts": studioCommands, "./inrAssistantStatsUiCommands.ts": statsCommands, "./inrAssistantBadgeUiCommands.ts": badgeCommands,
    "./inrAssistantUiCommands.ts": commands,
    "./inrAssistantScreenCommandPolicy.ts": editionCommands,
    "./dashboardEdition.ts": editions,
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
  for (const moduleName of ["inrAssistantWebsiteUiTools", "inrAssistantStudioUiTools", "inrAssistantStatsUiTools", "inrAssistantBadgeUiTools", "inrAssistantBusinessFormUiTools"]) {
    const entry = {exports:{}}; const code = ts.transpileModule(readFileSync(new URL(`../../lib/${moduleName}.ts`,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
    vm.runInNewContext(`(function(require,module,exports){${code}\n})`, {})( (name:string)=>{assert.ok(name in deps,name);return deps[name];},entry,entry.exports);deps[`./${moduleName}.ts`]=entry.exports;
  }
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
  return moduleRecord.exports.createInrAssistantUiTools({ accountId: activeId, edition: options.edition ?? "founder", currentUserMessage: message, canStartWork: () => !options.expired, ...(options.documentOwner || options.mediaRows ? { supabase: db } : {}),
    clientContext: { source: "untrusted_client", screen: options.screen ?? { pathname: "/dashboard/devis/new", tool: "Créer un devis", selection: { kind: "quote", id: options.preview ? "preview_local" : "quote-123" }, ...(options.preview ? { revision: "preview_local_2", pendingChanges: true } : {}), ...(options.available === false ? {} : { availableCommands: ["export_document_pdf"] }) } } });
}
const execution = { toolCallId: "test", messages: [] };
function toolResultRow(value: unknown): Record<string, unknown> {
  assert.ok(value && typeof value === "object" && !Array.isArray(value), "The executor must return a result object");
  assert.equal(Symbol.asyncIterator in value, false, "These native screen commands return one result, never a stream");
  const row: Record<string, unknown> = Object.fromEntries(Object.entries(value));
  assert.equal(typeof row.ok, "boolean");
  return row;
}

test("Stats exposes only its five native nullable settings and accepts the strict Basic request", async () => {
  const request = "Affiche la vue Évolution des statistiques.", screen: InrAssistantClientScreen = { pathname: "/dashboard/stats", tool: "iNr’Stats", selection: { kind: "stats", id: "stats" }, revision: "stats_live_1", availableCommands: ["configure_stats_view"] };
  const tools = harness(request, { screen, edition: "basic" }), schema = tools.runScreenCommand.inputSchema as unknown as { required: string[]; properties: { command: { enum: string[] }; documentId: { type: string | string[] }; documentKind: { type: string | string[] }; recipient: { type: string | string[] }; patch: { properties: Record<string, { enum?: unknown[] }>; required: string[]; additionalProperties: boolean } } };
  assert.deepEqual([...schema.properties.command.enum], ["configure_stats_view"]);
  for (const field of ["documentId", "documentKind", "recipient"] as const) { assert.equal(schema.properties[field].type, "null"); assert.ok(schema.required.includes(field)); }
  assert.deepEqual(Object.keys(schema.properties.patch.properties).sort(), ["channel", "evolutionView", "indexRangeMonths", "metric", "panel"]);
  assert.deepEqual([...schema.properties.patch.properties.indexRangeMonths.enum!], [...statsCommands.INR_ASSISTANT_STATS_INDEX_RANGES, null]);
  assert.deepEqual([...schema.properties.patch.required].sort(), Object.keys(schema.properties.patch.properties).sort()); assert.equal(schema.properties.patch.additionalProperties, false);
  assert.deepEqual([...schema.properties.patch.properties.channel.enum!], ["all", ...statsCommands.INR_ASSISTANT_STATS_CHANNELS, null]); assert.match(tools.runScreenCommand.description!, /configure_stats_view.*panel=.*evolution/);
  const patch = { ...Object.fromEntries(Object.keys(schema.properties.patch.properties).map(field => [field, null])), panel: "evolution" };
  const result = await tools.runScreenCommand.execute!({ command: "configure_stats_view", instructionQuote: request, documentId: null, documentKind: null, recipient: null, patch }, execution) as { ok: boolean; uiCommand: unknown };
  assert.equal(result.ok, true); assert.deepEqual(commands.parseInrAssistantUiCommand(result.uiCommand), { command: "configure_stats_view", selection: screen.selection, revision: screen.revision, patch: { panel: "evolution" } });
  const document = harness(request).runScreenCommand.inputSchema as unknown as typeof schema;
  for (const field of ["documentId", "documentKind"] as const) assert.deepEqual([...document.properties[field].type], ["string", "null"]);
  assert.equal(document.properties.recipient.type,"null");
  assert.deepEqual([...document.properties.command.enum],["export_document_pdf"],"a document screen does not expose unrelated Stats controls");
  const legacyPatch = { panel:"evolution",name:null,changes:null,subject:null };
  assert.equal((await tools.runScreenCommand.execute!({ command: "configure_stats_view", instructionQuote: request, patch: legacyPatch }, execution) as { ok: boolean }).ok, true, "persisted legacy null placeholders remain harmless at the native executor");
});

test("mounted library schemas reject malformed model inputs before any native execution", () => {
  const request="Dans la médiathèque ouverte, affiche uniquement les images.";
  const screen: InrAssistantClientScreen={pathname:"/dashboard/mediatheque",tool:"Mes médias",selection:{kind:"media",id:"library"},revision:"library_1",availableCommands:["configure_media_library"]};
  for(const edition of ["basic","standard"] as const){
    const definition=harness(request,{screen,edition}).runScreenCommand;
    const schema=definition.inputSchema as unknown as {properties:{command:{enum:string[]};patch:{properties:Record<string,unknown>}};validate:(input:unknown)=>{success:boolean}};
    assert.deepEqual([...schema.properties.command.enum],["configure_media_library"]);
    assert.deepEqual(Object.keys(schema.properties.patch.properties),["changes"]);
    assert.match(definition.description!,/patch est un OBJET.*typeFilter/);
    const input={command:"configure_media_library",instructionQuote:"affiche uniquement les images",documentId:null,documentKind:null,recipient:null,patch:{changes:[{field:"typeFilter",valueJson:'"image"'}]}};
    assert.equal(schema.validate(input).success,true);
    for(const patch of [
      {...input,patch:JSON.stringify(input.patch)}, {...input,documentId:"None"}, {...input,documentKind:"None"},
      {...input,patch:{type:"image"}}, {...input,command:"configure_ads_draft"},
      {...input,patch:{changes:[{field:"typeFilter",valueJson:"image"}]}},
      {...input,patch:{changes:[{field:"zoom",valueJson:"2"}]}},
      {...input,patch:null}, {...input,patch:{changes:null}},
      {...input,patch:{changes:[{field:"typeFilter",valueJson:'"images"'}]}},
      {...input,patch:{changes:[{field:"typeFilter",valueJson:'"image"'},{field:"typeFilter",valueJson:'"video"'}]}},
      {...input,patch:{changes:[{field:"typeFilter",valueJson:'"image"'}],name:"Hidden"}},
    ])assert.equal(schema.validate(patch).success,false,JSON.stringify(patch));
  }
});

test("a requested native library filter identifies the library and waits for its ACK instead of referring to image retouch", async () => {
  const request = "Ouvre la médiathèque et affiche uniquement les images.";
  const screen: InrAssistantClientScreen = { pathname: "/dashboard/mediatheque", tool: "Mes médias", selection: { kind: "media", id: "library" }, revision: "library_1", availableCommands: ["configure_media_library"] };
  const input = { command: "configure_media_library" as const, instructionQuote: "affiche uniquement les images", documentId: null, documentKind: null, recipient: null, patch: { changes: [{ field: "typeFilter", valueJson: '"image"' }] } };
  for (const edition of ["basic", "standard", "premium"] as const) {
    const output = toolResultRow(await harness(request, { screen, edition, realSdk: true }).runScreenCommand.execute!(input, execution));
    assert.equal(output.ok, true); assert.equal(output.status, "ui_action_requested");
    assert.match(String(output.message), /médiathèque.*attendre.*confirmation du navigateur/);
    assert.doesNotMatch(String(output.message), /retouch|appliqu|enregistr/i);
    const refused = toolResultRow(await harness(request, { screen: { ...screen, availableCommands: [] }, edition, realSdk: true }).runScreenCommand.execute!(input, execution));
    assert.equal(refused.ok, false); assert.match(String(refused.message), /médiathèque/i); assert.doesNotMatch(String(refused.message), /retouche/i);
  }
});

test("real SDK repairs only the serialized retouch envelope before native validation and exact mounted action", async () => {
  const request = "Mets le fond en blanc et le zoom à110%. Ne sauvegarde aucune copie.";
  const screen: InrAssistantClientScreen = { pathname: "/dashboard/generer-media", tool: "Retouche image", selection: { kind: "media", id: "30000000-0000-4000-8000-000000000001" }, revision: "image_1", availableCommands: ["configure_image_retouch"] };
  const patch = { changes: [{ field: "backgroundMode", valueJson: '"white"' }, { field: "zoom", valueJson: "1.1" }] };
  const raw = { command: "configure_image_retouch", instructionQuote: "Mets le fond en blanc et le zoom à110%", documentId: null, documentKind: null, recipient: null, patch: JSON.stringify(patch) };
  const definition = harness(request, { screen, edition: "basic", realSdk: true }).runScreenCommand;
  const schema = asSchema(definition.inputSchema);
  assert.match(definition.description!, /110%=1\.1, pas110/);
  assert.match(definition.description!, /backgroundMode.*white/);
  assert.equal((await schema.validate!(raw)).success, false);
  const fixed = JSON.parse(repairInrAssistantToolInput({ toolName: "runScreenCommand", input: JSON.stringify(raw) })!.input);
  assert.equal((await schema.validate!(fixed)).success, true);
  for (const value of [
    { ...raw, patch: { changes: [{ field: "zoom", valueJson: "110" }] } },
    { ...raw, patch: { changes: [{ field: "backgroundColor", valueJson: '"white"' }] } },
    { ...raw, patch, accountId: "foreign" }, { ...raw, patch, documentId: "30000000-0000-4000-8000-000000000002" },
  ]) assert.equal((await schema.validate!(value)).success, false, "business values/foreign scope remain rejected");
  const model: LanguageModelV3 = { specificationVersion: "v3", provider: "offline-retouch", modelId: "fixture", supportedUrls: {},
    doGenerate: async () => ({ content: [{ type: "tool-call", toolCallId: "screen-repair", toolName: "runScreenCommand", input: JSON.stringify(raw) }], finishReason: { unified: "tool-calls", raw: "fixture" }, usage: { inputTokens: { total: 0, noCache: 0, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 0, text: 0, reasoning: 0 } }, warnings: [] }),
    doStream: async () => { throw new Error("No transport"); },
  };
  let repairs = 0;
  const result = await generateText({ model, prompt: request, tools: { runScreenCommand: definition }, experimental_repairToolCall: async ({ toolCall }) => { repairs += 1; return repairInrAssistantToolInput(toolCall); } });
  assert.equal(repairs, 1);
  assert.equal(result.toolResults.length, 1);
  const output = toolResultRow(result.toolResults[0].output);
  assert.equal(output.ok, true, JSON.stringify(output));
  assert.deepEqual(commands.parseInrAssistantUiCommand(output.uiCommand), { command: "configure_image_retouch", selection: screen.selection, revision: screen.revision, patch: { backgroundMode: "white", zoom: 1.1 } });
  const foreign = harness(request, { screen, edition: "basic", foreign: true, realSdk: true }).runScreenCommand;
  assert.equal(toolResultRow(await foreign.execute!(fixed, execution)).status, "blocked", "repair cannot bypass native active-account verification");
  for (const message of [
    `Comment faire : ${request}`, `Si je confirme, ${request}`, `Après mon approbation, ${request}`,
    `${request} Ne retouche pas cette image.`, `${request} Mais pas de fond blanc.`,
  ]) {
    const rejected = harness(message, { screen, edition: "basic", realSdk: true }).runScreenCommand;
    const output = toolResultRow(await rejected.execute!(fixed, execution));
    assert.equal(output.status, "needs_instruction", message);
    assert.equal(output.uiCommand, undefined);
  }
});

test("Stats diagnoses invalid parameters separately from a missing mounted view and rejects every nonnull foreign field", async () => {
  const request = "Affiche la vue Évolution des statistiques.", screen: InrAssistantClientScreen = { pathname: "/dashboard/stats", tool: "iNr’Stats", selection: { kind: "stats", id: "stats" }, revision: "stats_live_1", availableCommands: ["configure_stats_view"] };
  const input = { command: "configure_stats_view" as const, instructionQuote: request, patch: { panel: "evolution" } }, tools = harness(request, { screen, edition: "basic" });
  for (const field of ["name", "primaryText", "format", "recipient", "subject", "bodyText", "attachmentIds", "mediaId", "targetBytes", "metaSlot", "changes", "adsChanges", "businessFormAction", "businessFormTab", "unknownSetting"]) {
    const result = toolResultRow(await tools.runScreenCommand.execute!({ ...input, patch: { panel: "evolution", [field]: field === "changes" ? [{ field: "panel", valueJson: '"evolution"' }] : "foreign-value" } }, execution));
    assert.equal(result.ok, false, field); assert.equal(result.code, "stats_view_invalid_patch", field); assert.equal(result.uiCommand, undefined); assert.ok(typeof result.message === "string"); assert.doesNotMatch(result.message, /Ouvrez/);
  }
  for (const patch of [null, {}, { panel: null, metric: null }, { panel: "Évolution" }, { evolutionView: "evolution" }, { channel: "google" }, { metric: "revenue" }]) {
    const result = toolResultRow(await tools.runScreenCommand.execute!({ ...input, patch }, execution)); assert.equal(result.code, "stats_view_invalid_patch");
  }
  for (const target of [{ documentId: "11111111-1111-4111-8111-111111111111" }, { documentKind: "quote" as const }, { recipient: "person@example.invalid" }]) assert.equal(toolResultRow(await tools.runScreenCommand.execute!({ ...input, ...target }, execution)).code, "stats_view_unrelated_target");
  for (const stale of [{ ...screen, pathname: "/dashboard" }, { ...screen, availableCommands: [] }, { ...screen, revision: undefined }, { ...screen, selection: { kind: "stats" as const, id: "other_stats" } }]) assert.equal(toolResultRow(await harness(request, { screen: stale, edition: "basic" }).runScreenCommand.execute!(input, execution)).code, "stats_view_context_unavailable");
  assert.equal((await harness(request, { screen, edition: "basic", foreign: true }).runScreenCommand.execute!(input, execution) as { status: string }).status, "blocked");
  assert.equal((await harness(request, { screen, edition: "basic", expired: true }).runScreenCommand.execute!(input, execution) as { status: string }).status, "needs_instruction");
  const filters = { panel: "evolution", evolutionView: "index", channel: "gmb" }, result = await tools.runScreenCommand.execute!({ ...input, patch: filters }, execution) as { ok: boolean; uiCommand: unknown };
  assert.equal(result.ok, true); assert.deepEqual(commands.parseInrAssistantUiCommand(result.uiCommand), { command: "configure_stats_view", selection: screen.selection, revision: screen.revision, patch: filters });
});

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

test("native agent settings navigation preserves edition scope and the exact named agent without changing any setting", async () => {
  for (const request of ["Ouvre les réglages de l’agent Publications. Ne modifie rien.", "Dans l’Agent Publications déjà ouvert, affiche maintenant le panneau Réglages. Ne change aucune valeur."]) {
    const input = { destination: "publication_agent_settings", instructionQuote: request, documentId: null };
    const result = toolResultRow(await harness(request, { edition: "standard", realSdk: true }).navigateApplication.execute!(input, execution));
    assert.equal(result.ok, true); assert.equal(result.status, "navigation_requested");
    assert.equal((result.navigation as { destination: string }).destination, "publication_agent_settings");
    assert.equal(toolResultRow(await harness(request, { edition: "standard", realSdk: true }).navigateApplication.execute!({ ...input, destination: "stats_agent_settings" }, execution)).ok, false);
    assert.equal(toolResultRow(await harness(request, { edition: "basic", realSdk: true }).navigateApplication.execute!(input, execution)).ok, false);
    assert.match(String(result.message), /Ouverture.*demandée/);
    assert.doesNotMatch(String(result.message), /est ouvert|a été ouvert|appliqu|sauvegard/i);
  }
  const request = "Ouvre iNr’CRM pour consulter la liste. Ne crée et ne modifie aucune fiche.";
  assert.equal(toolResultRow(await harness(request, { edition: "premium", realSdk: true }).navigateApplication.execute!({ destination: "crm", instructionQuote: request, documentId: null }, execution)).ok, true);
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
