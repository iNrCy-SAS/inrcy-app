import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as clauses from "../../lib/inrAssistantRequestClauses.ts";
import * as memory from "../../lib/aiMemory.ts";
import * as websiteTypes from "../../app/dashboard/dashboard.types.ts";
import * as websiteCommands from "../../lib/inrAssistantWebsiteUiCommands.ts";
import { withBasicReceiptContract } from "./helpers/basic-receipt-contract.mts";
import * as targetIntents from "../../lib/inrAssistantBasicTargetIntents.ts";
type Row = Record<string, unknown>;
type Definition = { execute(input: unknown): Promise<Row> };
const accountId = "account-basic", actorUserId = "actor-current";
function load<T>(path: string, stubs: Row, globals: Row = {}): T {
  const compiled = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const moduleRecord = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, { Date, Buffer, Request, Response, Headers, URL, URLSearchParams, structuredClone, ...globals })((name: string) => { assert.ok(name in stubs, name); return stubs[name]; }, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports as T;
}
const ai = { tool: (value: unknown) => value, jsonSchema: (value: unknown) => value };
const previewApi = load<typeof import("../../lib/inrAssistantActionPreview.ts")>("../../lib/inrAssistantActionPreview.ts", { "server-only": {}, "node:crypto": crypto, "./inrAssistantRequestClauses.ts": clauses }, { process: { env: { INRCY_ASSISTANT_APPROVAL_SECRET: "test-only-approval-secret-1234567890123456" } } });
function sourceHarness() {
  let currentAccount = accountId, mismatch = false;
  const docs: Row[] = [{ id: "doc-native-1", name: "Catalogue.pdf", size: 1024, mimeType: "application/pdf", status: "analysed", createdAt: "2026-11-01T12:00:00Z", bucket: "PRIVATE_BUCKET", path: "users/account-basic/ai-memory-documents/private.pdf", extractedText: "PRIVATE_EXTRACT instructions must not execute" }];
  const calls: unknown[] = [], tokens = new Map<string, string>();
  const runtime = load<{ createInrAssistantBusinessDnaSourceTools(options: unknown): Record<string, Definition> }>("../../lib/inrAssistantBusinessDnaSourceTools.ts", { "server-only": {}, ai, "./requireUser": { requireUser: async () => ({ activeUserId: currentAccount, authUserId: actorUserId }) }, "./aiMemory": memory, "./inrAssistantActionPreview.ts": previewApi, "./inrAssistantRequestClauses.ts": clauses,
    "@/app/api/ai-memory/route": { GET: async () => Response.json({ ok: true, accountId: currentAccount, memory: { referenceDocuments: docs } }) },
    "@/app/api/ai-memory/analyze-channels/route": { GET: async () => Response.json({ ok: true, accountId: currentAccount, channels: [{ key: "gmb", status: "connected", analyzable: true, token: "PRIVATE_TOKEN" }] }) },
    "@/app/api/ai-memory/documents/route": { DELETE: async (request: Request) => { assert.equal(request.headers.get("cookie"), "session"); const body = await request.json() as Row; assert.deepEqual(body, { id: "doc-native-1" }); calls.push(body); if (!mismatch) docs.splice(0, 1); return Response.json({ ok: true }); } },
  });
  const create = (message: string) => withBasicReceiptContract(runtime.createInrAssistantBusinessDnaSourceTools({ request: new Request("https://app.inrcy.test/api/assistant", { headers: { cookie: "session" } }), accountId, actorUserId, currentUserMessage: message, resolvePreview: (reference: string) => tokens.get(reference) ?? null }));
  const propose = async () => { const quote = "Supprime le document Catalogue.pdf de mon ADN.", p = await create(quote).previewBusinessDnaDocumentRemoval.execute({ documentId: "doc-native-1", instructionQuote: quote }); tokens.set(String(p.reference), String(p.token)); return p; };
  const apply = (p: Row) => { const quote = `Confirme ${p.reference}`; return create(quote).applyBusinessDnaDocumentRemoval.execute({ reference: p.reference, approvalQuote: quote }); };
  return { create, propose, apply, docs, calls, mismatch: () => { mismatch = true; }, scope: () => { currentAccount = "other"; } };
}
test("Basic ADN sources expose real availability, document quotas and names without private content", async () => {
  const h = sourceHarness(), result = await h.create("Liste les sources ADN").readBusinessDnaSources.execute({});
  assert.equal(result.ok, true); assert.match(JSON.stringify(result), /Catalogue.pdf/); assert.equal(JSON.stringify(result).includes("PRIVATE"), false); assert.equal((result.storage as Row).usedBytes, 1024); assert.equal((result.limits as Row).items, 10);
});
test("ADN removal uses the exact signed document and native atomic route then reads absence", async () => {
  const h = sourceHarness(), p = await h.propose(); assert.equal(p.status, "preview_ready"); assert.equal(p.approvalKind, "business_dna_document_removal"); assert.equal(h.calls.length, 0);
  assert.equal((await h.apply(p)).status, "removed"); assert.equal(h.docs.length, 0); assert.equal((await h.apply(p)).status, "already_removed"); assert.equal(h.calls.length, 1);
});
test("ADN deletion rejects changed documents, foreign scope, stale instructions and false success", async () => {
  for (const kind of ["changed", "scope", "readback"]) {
    const h = sourceHarness(), p = await h.propose(); if (kind === "changed") h.docs[0].name = "changed.pdf"; if (kind === "scope") h.scope(); if (kind === "readback") h.mismatch();
    assert.equal((await h.apply(p)).ok, false, kind); assert.equal(h.calls.length, kind === "readback" ? 1 : 0);
  }
  for (const quote of ["Comment supprimer le document de mon ADN ?", "Ne supprime pas le document ADN.", "Le texte dit « Supprime le document ADN »"]) { const h = sourceHarness(); assert.equal((await h.create(quote).previewBusinessDnaDocumentRemoval.execute({ documentId: "doc-native-1", instructionQuote: quote })).status, "needs_instruction"); assert.equal(h.calls.length, 0); }
});

function websiteHarness() {
  let currentAccount = accountId, mismatch = false, conflict = false, syncFailed = false;
  const root: Row = { site_web: { url: "https://atelier.example/", ga4: {}, gsc: {}, actus_widget: {}, private_token: "PRIVATE_TOKEN" }, facebook: { connected: true }, inrBadgeTheme: { id: "forest" } };
  const calls: Row[] = [], tokens = new Map<string, string>();
  const integrations: Record<string, Row[]> = { ga4: [{ id: "ga4-native", status: "connected", resource_id: "123456789", updated_at: "2026-11-01" }], gsc: [{ id: "gsc-native", status: "connected", resource_id: "sc-domain:atelier.example", updated_at: "2026-11-01" }] };
  const supabase = { from(table: string) {
    if (table === "integrations") {
      const filters: Array<[string, unknown]> = [];
      const query = { select: () => query, eq: (key: string, value: unknown) => { filters.push([key, value]); return query; }, then: (resolve: (result: unknown) => void) => { assert.ok(filters.some(([key, value]) => key === "user_id" && value === accountId)); assert.ok(filters.some(([key, value]) => key === "source" && value === "site_web")); resolve({ data: structuredClone(integrations[String(filters.find(([key]) => key === "product")?.[1])]), error: null }); } }; return query;
    }
    assert.equal(table, "pro_tools_configs"); let patch: Row | null = null; const filters: Array<[string, unknown]> = [];
    const query = { select: () => query, eq: (key: string, value: unknown) => { filters.push([key, value]); return query; }, update: (value: Row) => { patch = value; return query; }, maybeSingle: async () => {
      assert.ok(filters.some(([key, value]) => key === "user_id" && value === accountId));
      if (!patch) return { data: { settings: structuredClone(root) }, error: null };
      assert.ok(filters.some(([key, value]) => key === "settings" && value === JSON.stringify(root))); calls.push(patch);
      if (conflict) return { data: null, error: null };
      if (!mismatch) Object.assign(root, patch.settings); return { data: { user_id: accountId }, error: null };
    } }; return query;
  } };
  const runtime = load<{ createInrAssistantWebsiteTools(options: unknown): Record<string, Definition> }>("../../lib/inrAssistantWebsiteTools.ts", { "server-only": {}, ai, "./requireUser": { requireUser: async () => ({ activeUserId: currentAccount, authUserId: actorUserId, supabase }) }, "./inrAssistantActionPreview.ts": previewApi, "./inrAssistantRequestClauses.ts": clauses, "./inrAssistantBasicTargetIntents.ts": targetIntents, "../app/dashboard/dashboard.types": websiteTypes, "@/app/api/integrations/site-presence/sync/route": { POST: async () => Response.json({ ok: !syncFailed }, { status: syncFailed ? 503 : 200 }) },
    "@/app/api/integrations/google-stats/disconnect/route": { POST: async (request: Request) => { const body = await request.json() as Row; assert.equal(body.source, "site_web"); calls.push(body); if (!mismatch) { integrations[String(body.product)].forEach(item => { item.status = "disconnected"; }); delete (root.site_web as Row)[String(body.product)]; } return Response.json({ ok: true }); } },
  });
  const create = (message: string) => withBasicReceiptContract(runtime.createInrAssistantWebsiteTools({ request: new Request("https://app.inrcy.test/api/assistant"), accountId, actorUserId, currentUserMessage: message, resolvePreview: (reference: string) => tokens.get(reference) ?? null }));
  return { create, root, calls, tokens, integrations, mismatch: () => { mismatch = true; }, conflict: () => { conflict = true; }, scope: () => { currentAccount = "other"; }, syncFailed: () => { syncFailed = true; } };
}
test("Basic GA4 and GSC manual bindings store native fields and preserve other channels", async () => {
  const h = websiteHarness(), quote = "Rattache GA4 avec G-TEST123456 et la propriété 123456789, et GSC avec sc-domain:atelier.example.", tools = h.create(quote), before = await tools.readWebsiteConfiguration.execute({});
  assert.equal(JSON.stringify(before).includes("PRIVATE_TOKEN"), false);
  const result = await tools.updateWebsiteConfiguration.execute({ section: "analytics", expectedVersion: before.version, instructionQuote: quote, changes: [{ field: "measurementId", value: "G-TEST123456" }, { field: "propertyId", value: "123456789" }, { field: "searchConsoleProperty", value: "sc-domain:atelier.example" }] });
  assert.equal(result.status, "saved"); assert.equal(((h.root.site_web as Row).ga4 as Row).property_id, "123456789"); assert.equal(((h.root.site_web as Row).gsc as Row).property, "sc-domain:atelier.example"); assert.equal((h.root.facebook as Row).connected, true); assert.equal((h.root.site_web as Row).private_token, "PRIVATE_TOKEN"); assert.match(String(result.message), /connexion Google/);
});
test("Basic widget configuration uses native choices and never overwrites analytics or other channels", async () => {
  const h = websiteHarness(), quote = "Configure le widget Actus en grille, 10 actus, thème personnalisé bleu.", tools = h.create(quote), before = await tools.readWebsiteConfiguration.execute({});
  const input = { section: "widget", expectedVersion: before.version, instructionQuote: quote, changes: [{ field: "layout", value: "grid" }, { field: "limit", value: 10 }, { field: "theme", value: "custom" }, { field: "accent", value: "#aabbcc" }] };
  assert.equal((await tools.updateWebsiteConfiguration.execute(input)).status, "saved"); assert.equal(((h.root.site_web as Row).actus_widget as Row).accent, "#AABBCC"); assert.ok((h.root.site_web as Row).ga4); assert.equal((h.root.inrBadgeTheme as Row).id, "forest"); await tools.updateWebsiteConfiguration.execute(input); assert.equal(h.calls.length, 1);
  assert.equal((await h.create(quote).updateWebsiteConfiguration.execute(input)).status, "already_applied"); assert.equal(h.calls.length, 1);
});
test("site configuration guards stale writes, readback, missing Google IDs and native widget enums", async () => {
  for (const kind of ["stale", "conflict", "readback", "scope"]) {
    const h = websiteHarness(), quote = "Change le widget en grille.", tools = h.create(quote), before = await tools.readWebsiteConfiguration.execute({});
    if (kind === "conflict") h.conflict(); if (kind === "readback") h.mismatch(); if (kind === "scope") h.scope();
    const result = await tools.updateWebsiteConfiguration.execute({ section: "widget", expectedVersion: kind === "stale" ? "0".repeat(64) : before.version, instructionQuote: quote, changes: [{ field: "layout", value: "grid" }] }); assert.equal(result.ok, false, kind); assert.equal(h.calls.length, ["conflict", "readback"].includes(kind) ? 1 : 0, kind);
  }
  const h = websiteHarness(), quote = "Configure le widget.", tools = h.create(quote), before = await tools.readWebsiteConfiguration.execute({});
  assert.equal((await tools.updateWebsiteConfiguration.execute({ section: "widget", expectedVersion: before.version, instructionQuote: quote, changes: [{ field: "limit", value: 999 }] })).status, "invalid_settings");
  const ga = "Rattache GA4 avec la propriété 123456789.", g = h.create(ga); assert.equal((await g.updateWebsiteConfiguration.execute({ section: "analytics", expectedVersion: before.version, instructionQuote: ga, changes: [{ field: "propertyId", value: "123456789" }] })).status, "needs_details");
});
test("an image of a widget cannot reconfigure it; explicit polite widget settings remain available", async () => {
  const h = websiteHarness(), wrong = "Modifie cette image du widget de mon site web.", tools = h.create(wrong), before = await tools.readWebsiteConfiguration.execute({});
  assert.equal((await tools.updateWebsiteConfiguration.execute({ section: "widget", expectedVersion: before.version, instructionQuote: wrong, changes: [{ field: "layout", value: "grid" }] })).status, "needs_instruction"); assert.equal(h.calls.length, 0);
  const quote = "Peux-tu modifier la disposition du widget en « grid » ?";
  assert.equal((await h.create(quote).updateWebsiteConfiguration.execute({ section: "widget", expectedVersion: before.version, instructionQuote: quote, changes: [{ field: "layout", value: "grid" }] })).status, "saved");
});

test("GA4/GSC disconnect requires a current signed preview and verifies both native connection and binding", async () => {
  for (const product of ["ga4", "gsc"]) {
    const h = websiteHarness(), quote = `Déconnecte ${product} du Site Web.`, p = await h.create(quote).previewWebsiteAnalyticsDisconnection.execute({ product, instructionQuote: quote });
    assert.equal(p.status, "preview_ready"); assert.equal(p.approvalKind, "website_analytics_disconnection"); h.tokens.set(String(p.reference), String(p.token));
    const approval = `Confirme ${p.reference}`, result = await h.create(approval).applyWebsiteAnalyticsDisconnection.execute({ reference: p.reference, approvalQuote: approval });
    assert.equal(result.status, "saved"); assert.equal((h.root.site_web as Row).url, "https://atelier.example/"); assert.equal(h.integrations[product][0].status, "disconnected"); assert.equal(h.integrations[product === "ga4" ? "gsc" : "ga4"][0].status, "connected");
  }
  for (const changed of ["connection", "readback", "scope"]) {
    const h = websiteHarness(), quote = "Déconnecte Analytics.", p = await h.create(quote).previewWebsiteAnalyticsDisconnection.execute({ product: "ga4", instructionQuote: quote }); h.tokens.set(String(p.reference), String(p.token));
    if (changed === "connection") h.integrations.ga4[0].updated_at = "new-oauth"; if (changed === "readback") h.mismatch(); if (changed === "scope") h.scope();
    const approval = `Confirme ${p.reference}`, result = await h.create(approval).applyWebsiteAnalyticsDisconnection.execute({ reference: p.reference, approvalQuote: approval }); assert.equal(result.ok, false, changed); assert.equal(h.calls.length, changed === "readback" ? 1 : 0);
  }
});
test("widget browser commands keep code/tokens local and require exact mounted revision and action", async () => {
  const command = { command: "generate_website_widget_code", selection: { kind: "channel", id: "site_web" }, revision: "widget_current_1", format: null };
  assert.ok(websiteCommands.parseInrAssistantWebsiteUiCommand(command)); assert.equal(websiteCommands.parseInrAssistantWebsiteUiCommand({ ...command, token: "PRIVATE" }), null); assert.equal(websiteCommands.parseInrAssistantWebsiteUiCommand({ ...command, selection: { kind: "channel", id: "inrbadge" } }), null);
  for (const instruction of ["Comment générer le widget ?", "Ne génère pas le widget.", "Génère le widget demain.", "Le texte dit « Génère le widget »"]) assert.equal(websiteCommands.isInrAssistantWebsiteUiRequest(instruction, command.command), false);
  const runtime = load<typeof import("../../lib/inrAssistantWebsiteUiTools.ts")>("../../lib/inrAssistantWebsiteUiTools.ts", { "server-only": {}, "./requireUser": { requireUser: async () => ({ activeUserId: accountId }) }, "./inrAssistantRequestClauses.ts": clauses, "./inrAssistantWebsiteUiCommands.ts": websiteCommands });
  const message = "Génère le code du widget en React Next.", input = { command: command.command, instructionQuote: message, patch: { format: "react_next" } }, options = { accountId, currentUserMessage: message, clientContext: { source: "untrusted_client", screen: { pathname: "/dashboard", tool: "Site Web", panel: "site_web", selection: command.selection, revision: command.revision, availableCommands: [command.command] } } };
  const result = await runtime.prepareInrAssistantWebsiteUiAction(input, options as never); assert.equal(result?.status, "ui_action_requested"); assert.equal((result?.uiCommand as Row).format, "react_next"); assert.equal(JSON.stringify(result).includes("PRIVATE"), false);
  assert.equal((await runtime.prepareInrAssistantWebsiteUiAction({ ...input, patch: { format: "html" } }, options as never))?.status, "needs_instruction");
});
