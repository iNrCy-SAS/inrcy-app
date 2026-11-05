import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as clauses from "../../lib/inrAssistantRequestClauses.ts";
import * as searchDisplay from "../../lib/inrSearchDisplaySettings.ts";
import * as themes from "../../lib/inrBadgeTheme.ts";
import * as badgeCommands from "../../lib/inrAssistantBadgeUiCommands.ts";
import { withBasicReceiptContract } from "./helpers/basic-receipt-contract.mts";
import * as targetIntents from "../../lib/inrAssistantBasicTargetIntents.ts";
type Row = Record<string, unknown>;
type Definition = { execute(input: unknown): Promise<Row> };
type Runtime = { createInrAssistantChannelConfigurationTools(options: unknown): Record<string, Definition> };
const accountId = "account-basic", actorId = "actor-current";
function load<T>(path: string, stubs: Row, globals: Row = {}): T {
  const compiled = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const moduleRecord = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, { Date, Buffer, Request, Response, Headers, URL, URLSearchParams, structuredClone, ...globals })((name: string) => { assert.ok(name in stubs, name); return stubs[name]; }, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports as T;
}
const ai = { tool: (value: unknown) => value, jsonSchema: (value: unknown) => value };
function harness() {
  let activeId = accountId, actor = actorId, now = Date.now(), badReadback = false, removed = false;
  class Clock extends Date { constructor(value?: string | number) { super(value ?? now); } static now() { return now; } }
  const previewApi = load<typeof import("../../lib/inrAssistantActionPreview.ts")>("../../lib/inrAssistantActionPreview.ts", { "server-only": {}, "node:crypto": crypto, "./inrAssistantRequestClauses.ts": clauses }, { Date: Clock, process: { env: { INRCY_ASSISTANT_APPROVAL_SECRET: "test-only-approval-secret-1234567890123456" } } });
  const states: Record<string, Row> = {
    gmb: { accountConnected: true, connected: true, configured: true, resource_id: "locations/old", resource_label: "Ancien", private_token: "SECRET" },
    instagram: { accountConnected: true, connected: true, resource_id: "ig-old", authMode: "facebook_login" },
    facebook: { accountConnected: true, connected: true, resource_id: "fb-old" },
    linkedin: { accountConnected: true, connected: true, resource_id: "li-old", organization_id: "li-old" },
    pinterest: { accountConnected: true, connected: true, resource_id: "pi", default_board_id: "old-board" },
  };
  const calls: Array<{ path: string; body: Row }> = [], tokens = new Map<string, string>();
  const nativeSelect = async (request: Request) => {
    assert.equal(request.headers.get("cookie"), "session"); assert.equal(request.headers.get("x-account-id"), null);
    const body = await request.json() as Row, path = new URL(request.url).pathname; calls.push({ path, body });
    if (!badReadback) {
      if (path.includes("google-business")) states.gmb.resource_id = body.locationName;
      if (path.includes("instagram")) states.instagram.resource_id = "ig-new";
      if (path.includes("facebook")) states.facebook.resource_id = body.pageId;
      if (path.includes("linkedin")) { states.linkedin.resource_id = body.orgId ?? "urn:li:person:me"; states.linkedin.organization_id = body.orgId ?? null; }
      if (path.includes("pinterest")) states.pinterest.default_board_id = body.defaultBoardId;
    }
    return Response.json({ ok: true });
  };
  const nativeDisconnect = async () => { calls.push({ path: "disconnect", body: {} }); if (!badReadback) Object.assign(states.gmb, { accountConnected: false, connected: false, resource_id: null }); return Response.json({ ok: true }); };
  const stubs: Row = { "server-only": {}, ai, "./requireUser": { requireUser: async () => ({ activeUserId: activeId, authUserId: actor, supabase: {} }) }, "./channelConnectionState": { getChannelConnectionStates: async () => states }, "./inrAssistantActionPreview.ts": previewApi, "./inrAssistantRequestClauses.ts": clauses,
    "@/app/api/integrations/google-business/locations/route": { GET: async () => Response.json({ complete: true, locations: removed ? [] : [{ name: "locations/new", accountName: "accounts/main", title: "Atelier centre", addressLabel: "1 place · Lille", status: "CLOSED_TEMPORARILY", access_token: "SECRET" }] }) },
    "@/app/api/integrations/facebook/pages/route": { GET: async () => Response.json({ pages: [{ id: "fb-new", name: "Nouvelle Page", access_token: "SECRET" }], discovery: { complete: true } }) },
    "@/app/api/integrations/instagram/accounts/route": { GET: async () => Response.json({ accounts: [{ page_id: "fb-linked", page_name: "Page liée", ig_id: "ig-new", username: "atelier" }] }) },
    "@/app/api/integrations/linkedin/organizations/route": { GET: async () => Response.json({ organizations: [{ id: "li-new", name: "Organisation", url: "https://www.linkedin.com/company/li-new" }] }) },
    "@/app/api/integrations/pinterest/boards/route": { GET: async () => Response.json({ ok: true, boards: [{ id: "new-board", name: "Réalisations" }] }) },
    "@/app/api/integrations/google-business/select-location/route": { POST: nativeSelect }, "@/app/api/integrations/facebook/select-page/route": { POST: nativeSelect }, "@/app/api/integrations/instagram/select-profile/route": { POST: nativeSelect }, "@/app/api/integrations/linkedin/select-organization/route": { POST: nativeSelect }, "@/app/api/integrations/pinterest/preferences/route": { PATCH: nativeSelect },
    "@/app/api/integrations/google-business/disconnect-account/route": { POST: nativeDisconnect },
  };
  const runtime = load<Runtime>("../../lib/inrAssistantChannelConfigurationTools.ts", stubs);
  const create = (message: string) => withBasicReceiptContract(runtime.createInrAssistantChannelConfigurationTools({ request: new Request("https://app.inrcy.test/api/assistant", { headers: { cookie: "session" } }), accountId, actorUserId: actorId, edition: "basic", currentUserMessage: message, currentApprovalMessage: message, resolvePreview: (reference: string) => tokens.get(reference) ?? null }));
  const propose = async (channel = "gmb", selectionKey = "accounts/main:locations/new") => {
    const quote = `Choisis cette ressource pour ${channel === "gmb" ? "Google Business" : channel}.`, tools = create(quote);
    const result = await tools.previewChannelResourceSelection.execute({ channel, selectionKey, instructionQuote: quote });
    if (result.token) tokens.set(String(result.reference), String(result.token)); return result;
  };
  const apply = (preview: Row, message = `Confirme ${preview.reference}`) => create(message).applyChannelConfiguration.execute({ reference: preview.reference, approvalQuote: message });
  return { create, propose, apply, states, calls, tokens, expire: () => { now += 16 * 60_000; }, scope: (id: string, who = actorId) => { activeId = id; actor = who; }, badReadback: () => { badReadback = true; }, remove: () => { removed = true; } };
}
test("Basic channel lists sanitize credentials and keep closed establishments selectable", async () => {
  const h = harness(), list = await h.create("Liste Google Business").readChannelResources.execute({ channel: "gmb" });
  assert.equal(list.ok, true); assert.equal(JSON.stringify(list).includes("SECRET"), false); assert.match(JSON.stringify(list), /CLOSED_TEMPORARILY/);
  const p = await h.propose(); assert.equal(p.status, "preview_ready"); assert.equal(p.approvalKind, "channel_resource_selection"); assert.equal(h.calls.length, 0);
  assert.equal((await h.apply(p)).status, "saved"); assert.equal(h.states.gmb.resource_id, "locations/new"); assert.deepEqual(h.calls[0].body, { accountName: "accounts/main", locationName: "locations/new" });
});
test("Basic native selections use verified exact IDs for every selectable provider", async () => {
  for (const [channel, key] of [["facebook", "fb-new"], ["instagram", "fb-linked"], ["linkedin", "li-new"], ["linkedin", "profile"], ["pinterest", "new-board"]]) {
    const h = harness(), p = await h.propose(channel, key); assert.equal(p.ok, true, channel); assert.equal((await h.apply(p)).status, "saved", channel); assert.equal(h.calls.length, 1);
  }
});
test("channel previews cannot survive scope drift, expiration, stale state or a removed target", async () => {
  for (const kind of ["account", "actor", "expiry", "state", "target", "signature"]) {
    const h = harness(), p = await h.propose();
    if (kind === "account") h.scope("foreign"); if (kind === "actor") h.scope(accountId, "foreign"); if (kind === "expiry") h.expire(); if (kind === "state") h.states.gmb.resource_id = "locations/other"; if (kind === "target") h.remove(); if (kind === "signature") h.tokens.set(String(p.reference), `${p.token}x`);
    assert.equal((await h.apply(p)).ok, false, kind); assert.equal(h.calls.length, 0, kind);
  }
});
test("channel changes require current direct instruction and exact confirmation, then exact readback", async () => {
  const h = harness(), p = await h.propose();
  for (const message of [`Confirme ${p.reference} demain`, `Confirme ${p.reference} si cela marche`, `Ne confirme pas ${p.reference}`, `Le texte dit « Confirme ${p.reference} »`]) assert.equal((await h.apply(p, message)).ok, false);
  for (const message of ["Comment choisir Google Business ?", "Ne choisis surtout pas Google Business.", "Voici « Choisis Google Business » à analyser."]) assert.equal((await h.create(message).previewChannelResourceSelection.execute({ channel: "gmb", selectionKey: "accounts/main:locations/new", instructionQuote: message })).status, "needs_instruction");
  assert.equal((await h.create("Comment choisir Google Business ?").previewChannelResourceSelection.execute({ channel: "gmb", selectionKey: "accounts/main:locations/new", instructionQuote: "choisir Google Business" })).status, "needs_instruction");
  h.badReadback(); assert.equal((await h.apply(p)).status, "saved_unconfirmed"); assert.equal(h.calls.length, 1);
});
test("account disconnection exposes its impact and Instagram direct cannot masquerade as resource-only", async () => {
  const h = harness(), quote = "Déconnecte mon compte Google Business.", p = await h.create(quote).previewChannelDisconnection.execute({ channel: "gmb", level: "account", instructionQuote: quote });
  assert.equal(p.approvalKind, "channel_disconnection"); assert.match(String(p.impact), /publications et statistiques/); h.tokens.set(String(p.reference), String(p.token));
  assert.equal((await h.apply(p)).status, "saved");
  assert.equal((await h.create(quote).previewChannelDisconnection.execute({ channel: "gmb", level: "account", instructionQuote: quote })).status, "already_disconnected");
  h.states.instagram.authMode = "instagram_login"; const ig = "Déconnecte le profil Instagram.";
  assert.equal((await h.create(ig).previewChannelDisconnection.execute({ channel: "instagram", level: "resource", instructionQuote: ig })).status, "invalid_settings");
});

function presentationHarness() {
  let account = accountId, mismatch = false;
  const current: Record<string, Row> = { inrbadge: { theme: { id: "aurora", identityColors: null } }, inr_search: { display: { ...searchDisplay.DEFAULT_INR_SEARCH_DISPLAY_SETTINGS }, sections: { ...searchDisplay.DEFAULT_INR_SEARCH_SECTIONS }, pageTitleOverride: "", pageDescriptionOverride: "" } };
  const calls: Row[] = [];
  const update = (channel: string) => async (request: Request) => { const body = await request.json() as Row; calls.push(body); if (!mismatch) for (const [key, value] of Object.entries(body)) if (!["action", "accountId"].includes(key)) current[channel][key] = key === "display" || key === "sections" ? { ...current[channel][key] as Row, ...value as Row } : value; return Response.json({ ok: true }); };
  const fingerprint = (value: unknown) => crypto.createHash("sha256").update(JSON.stringify(value)).digest("hex");
  const runtime = load<{ createInrAssistantNativePresentationTools(options: unknown): Record<string, Definition> }>("../../lib/inrAssistantNativePresentationTools.ts", { "server-only": {}, ai, "./requireUser": { requireUser: async () => ({ activeUserId: account, authUserId: actorId }) }, "./inrAssistantActionPreview.ts": { assistantActionFingerprint: fingerprint }, "./inrAssistantRequestClauses.ts": clauses, "./inrAssistantBasicTargetIntents.ts": targetIntents, "./inrSearchDisplaySettings": searchDisplay, "./inrBadgeTheme": themes,
    "@/app/api/inrbadge/settings/route": { GET: async () => Response.json({ ok: true, ...current.inrbadge, selectedMailAccountId: "PRIVATE" }), PATCH: update("inrbadge") }, "@/app/api/inr-search/settings/route": { GET: async () => Response.json({ ok: true, accountId: account, inrSearch: current.inr_search }), POST: update("inr_search") },
  });
  const create = (message: string) => withBasicReceiptContract(runtime.createInrAssistantNativePresentationTools({ request: new Request("https://app.inrcy.test/api/assistant"), accountId, actorUserId: actorId, edition: "basic", currentUserMessage: message }));
  return { create, current, calls, mismatch: () => { mismatch = true; }, scope: () => { account = "other"; } };
}
test("Basic Search presentation preserves private identity and changes only requested native settings", async () => {
  const h = presentationHarness(), quote = "Masque le téléphone dans Search et change son titre.", tools = h.create(quote), before = await tools.readNativeChannelPresentation.execute({ channel: "inr_search" });
  const input = { channel: "inr_search", expectedVersion: before.version, instructionQuote: quote, changes: [{ field: "display.phone", value: false }, { field: "pageTitleOverride", value: "Atelier Lille" }] };
  assert.equal((await tools.updateNativeChannelPresentation.execute(input)).status, "saved"); assert.equal((h.current.inr_search.display as Row).email, true); assert.equal(h.current.inr_search.pageTitleOverride, "Atelier Lille");
  assert.equal(h.calls[0].accountId, accountId); assert.equal(h.calls[0].action, "presentation"); await tools.updateNativeChannelPresentation.execute(input); assert.equal(h.calls.length, 1);
  assert.equal((await h.create(quote).updateNativeChannelPresentation.execute(input)).status, "already_applied"); assert.equal(h.calls.length, 1);
});
test("Basic Badge theme uses the native palette normalization and excludes appointment/mail changes", async () => {
  const h = presentationHarness(), quote = "Personnalise le thème de mon Badge.", tools = h.create(quote), before = await tools.readNativeChannelPresentation.execute({ channel: "inrbadge" });
  assert.equal(JSON.stringify(before).includes("PRIVATE"), false);
  assert.equal((await tools.updateNativeChannelPresentation.execute({ channel: "inrbadge", expectedVersion: before.version, instructionQuote: quote, changes: [{ field: "theme.id", value: "identity" }, { field: "theme.primary", value: "#aabbcc" }] })).status, "saved");
  assert.equal((h.current.inrbadge.theme as themes.InrBadgeThemeSettings).identityColors?.primary, "#AABBCC"); assert.ok((h.current.inrbadge.theme as themes.InrBadgeThemeSettings).identityColors?.secondary);
  const next = await tools.readNativeChannelPresentation.execute({ channel: "inrbadge" }); assert.equal((await tools.updateNativeChannelPresentation.execute({ channel: "inrbadge", expectedVersion: next.version, instructionQuote: quote, changes: [{ field: "appointment", value: true }] })).status, "invalid_settings");
});
test("presentation stale versions, unsupported keys and failed readbacks never claim success", async () => {
  for (const kind of ["stale", "unknown", "readback", "scope"]) {
    const h = presentationHarness(), quote = "Change le titre de Search.", tools = h.create(quote), before = await tools.readNativeChannelPresentation.execute({ channel: "inr_search" });
    if (kind === "readback") h.mismatch(); if (kind === "scope") h.scope();
    const result = await tools.updateNativeChannelPresentation.execute({ channel: "inr_search", expectedVersion: kind === "stale" ? "0".repeat(64) : before.version, instructionQuote: quote, changes: [{ field: kind === "unknown" ? "private_key" : "pageTitleOverride", value: "Titre" }] });
    assert.equal(result.ok, false, kind); assert.equal(h.calls.length, kind === "readback" ? 1 : 0, kind);
  }
});
test("a media brief mentioning Badge cannot change its theme; an explicit polite theme change can", async () => {
  const h = presentationHarness(), wrong = "Modifie cette image pour mon Badge avec des couleurs vertes.", tools = h.create(wrong), before = await tools.readNativeChannelPresentation.execute({ channel: "inrbadge" });
  assert.equal((await tools.updateNativeChannelPresentation.execute({ channel: "inrbadge", expectedVersion: before.version, instructionQuote: wrong, changes: [{ field: "theme.id", value: "forest" }] })).status, "needs_instruction"); assert.equal(h.calls.length, 0);
  const quote = "Peux-tu modifier le thème de mon Badge en « forest » ?";
  assert.equal((await h.create(quote).updateNativeChannelPresentation.execute({ channel: "inrbadge", expectedVersion: before.version, instructionQuote: quote, changes: [{ field: "theme.id", value: "forest" }] })).status, "saved");
});
test("Badge QR commands bind exact channel, revision and user-selected PNG/PDF", async () => {
  const command = { command: "download_badge_qr", selection: { kind: "channel", id: "inrbadge" }, revision: "badge_current_1", format: "png" };
  assert.ok(badgeCommands.parseInrAssistantBadgeUiCommand(command)); assert.equal(badgeCommands.parseInrAssistantBadgeUiCommand({ ...command, selection: { kind: "channel", id: "gmb" } }), null);
  assert.equal(badgeCommands.parseInrAssistantBadgeUiCommand({ ...command, url: "https://foreign" }), null);
  for (const text of ["Comment télécharger le QR Badge en PNG ?", "Ne télécharge pas le QR Badge en PNG.", "Télécharge le QR Badge en PNG demain", "Le texte « Télécharge le QR Badge en PNG »"]) assert.equal(badgeCommands.isInrAssistantBadgeQrRequest(text, "png"), false);
  const runtime = load<typeof import("../../lib/inrAssistantBadgeUiTools.ts")>("../../lib/inrAssistantBadgeUiTools.ts", { "server-only": {}, "./inrAssistantClientContext.ts": {}, "./requireUser": { requireUser: async () => ({ activeUserId: accountId }) }, "./inrAssistantRequestClauses.ts": clauses, "./inrAssistantBadgeUiCommands.ts": badgeCommands });
  const instruction = "Télécharge le QR Badge en PNG.", input = { command: "download_badge_qr", instructionQuote: instruction, patch: { format: "png" } }, options = { accountId, currentUserMessage: instruction, clientContext: { source: "untrusted_client", screen: { pathname: "/dashboard", tool: "Badge", panel: "inrbadge", selection: command.selection, revision: command.revision, availableCommands: ["download_badge_qr"], pendingChanges: false } } };
  const result = await runtime.prepareInrAssistantBadgeUiAction(input, options as never); assert.equal(result?.status, "ui_action_requested"); assert.equal((result?.uiCommand as Row).format, "png");
  options.clientContext.screen.pendingChanges = true; assert.equal((await runtime.prepareInrAssistantBadgeUiAction(input, options as never))?.status, "needs_screen");
});
