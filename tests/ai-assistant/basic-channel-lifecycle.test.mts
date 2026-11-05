import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as clauses from "../../lib/inrAssistantRequestClauses.ts";
import * as facebook from "../../lib/facebookPublicationPreferences.ts";
import * as instagram from "../../lib/instagramPublicationPreferences.ts";
import * as threads from "../../lib/threadsPublicationPreferences.ts";
import * as targetIntents from "../../lib/inrAssistantBasicTargetIntents.ts";
import { withBasicReceiptContract } from "./helpers/basic-receipt-contract.mts";
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
function harness() {
  let activeAccount = accountId, actor = actorUserId, mismatch = false, unavailable = false, siteFailure = false, siteRace = false, boardLag = false;
  const preferences: Record<string, Row> = { facebook: { version: 1, reelsEnabled: true, storiesEnabled: true, defaultMode: "reel" }, instagram: { version: 1, reelsEnabled: true, storiesEnabled: true, defaultMode: "reel" }, threads: { version: 1, ghostEnabled: true, defaultMode: "ghost" } };
  const schedule: Row = { enabled: false, dayOfMonth: 5, time: "07:00", timezone: "Europe/Paris", nextRunAt: null, lastStatus: "never", lastRunAt: null, lastSuccessAt: null };
  const boards: Row[] = [{ id: "board-existing", name: "Catalogue", description: "Réalisation", privacy: "PUBLIC", access_token: "PRIVATE" }];
  const connection: Row = { accountConnected: true, connected: true, resource_id: "pinterest-account", username: "atelier", requiresUpdate: false };
  let defaultBoardId = "board-existing";
  const root: Row = { site_web: { url: "https://atelier.example/", domain: "atelier.example", ga4: { measurement_id: "G-TEST1234", property_id: "123" }, gsc: { property: "sc-domain:atelier.example" }, actus_widget: { layout: "grid", limit: 5 }, privateSetting: "PRIVATE" }, facebook: { connected: true }, inrBadgeTheme: { id: "forest" } };
  const integrations: Row[] = [{ id: "ga4", product: "ga4", status: "connected", updated_at: "old", resource_id: "123" }, { id: "gsc", product: "gsc", status: "connected", updated_at: "old", resource_id: "sc-domain:atelier.example" }];
  const calls: Array<{ path: string; body: Row }> = [], tokens = new Map<string, string>();
  const auth = async () => ({ activeUserId: activeAccount, authUserId: actor, supabase });
  const response = (data: unknown, status = 200) => Response.json(data, { status });
  const supabase = { from(table: string) {
    let patch: Row | null = null; const filters: Array<[string, unknown]> = [];
    const read = () => { assert.ok(filters.some(([key, value]) => key === "user_id" && value === accountId)); if (table === "integrations") return { data: structuredClone(integrations), error: null }; assert.equal(table, "pro_tools_configs"); return { data: { settings: structuredClone(root) }, error: null }; };
    const query = { select: () => query, eq: (key: string, value: unknown) => { filters.push([key, value]); return query; }, in: (key: string, value: unknown) => { filters.push([key, value]); return query; }, update: (value: Row) => { patch = value; return query; }, then: (resolve: (value: unknown) => void) => resolve(read()), maybeSingle: async () => {
      if (!patch) return read();
      assert.ok(filters.some(([key, value]) => key === "settings" && value === JSON.stringify(root))); calls.push({ path: "site-settings", body: patch });
      if (!mismatch) Object.assign(root, patch.settings); return { data: { user_id: accountId }, error: null };
    } }; return query;
  } };
  const nativePrefs = (channel: string) => ({
    GET: async () => unavailable && channel === "threads" ? response({ ok: false }, 403) : response({ ok: true, preferences: preferences[channel] }),
    PATCH: async (request: Request) => { const body = await request.json() as Row; calls.push({ path: channel, body }); assert.equal(request.headers.get("cookie"), "session"); if (unavailable) return response({ ok: false, code: "MIGRATION_REQUIRED" }, 503); if (!mismatch) preferences[channel] = body; return response({ ok: true, preferences: body }); },
  });
  const common: Row = { "server-only": {}, ai, "./requireUser": { requireUser: auth }, "./inrAssistantActionPreview.ts": previewApi, "./inrAssistantRequestClauses.ts": clauses, "./inrAssistantBasicTargetIntents.ts": targetIntents,
    "./facebookPublicationPreferences": facebook, "./instagramPublicationPreferences": instagram, "./threadsPublicationPreferences": threads,
    "./channelConnectionState": { getChannelConnectionStates: async () => ({ pinterest: connection }) },
    "@/app/api/integrations/facebook/publication-preferences/route": nativePrefs("facebook"), "@/app/api/integrations/instagram/publication-preferences/route": nativePrefs("instagram"), "@/app/api/integrations/threads/publication-preferences/route": nativePrefs("threads"),
    "@/app/api/ai-memory/analysis-schedule/route": { GET: async () => unavailable ? response({ error: "migration_required" }, 503) : response({ ok: true, schedule }), PUT: async (request: Request) => { const body = await request.json() as Row; calls.push({ path: "schedule", body }); assert.equal(request.headers.get("cookie"), "session"); assert.equal(body.timezone, undefined); if (!mismatch) Object.assign(schedule, body, { nextRunAt: body.enabled ? "2026-12-06T07:30:00Z" : null }); return response({ ok: true, schedule }); } },
    "@/app/api/integrations/pinterest/boards/route": {
      GET: async () => response({ ok: true, boards, defaultBoardId }),
      POST: async (request: Request) => { const body = await request.json() as Row; calls.push({ path: "board-create", body }); const board = { id: "board-created", name: body.name, description: "", privacy: "PUBLIC" }; if (!boardLag && !mismatch) boards.push(board); return response({ ok: true, board }); },
    },
    "@/app/api/integrations/pinterest/boards/[boardId]/route": {
      PATCH: async (request: Request, context: { params: Promise<{ boardId: string }> }) => { const { boardId } = await context.params, body = await request.json() as Row; calls.push({ path: "board-rename", body: { ...body, boardId } }); const selected = boards.find(item => item.id === boardId)!; if (!mismatch) selected.name = body.name; return response({ ok: true, board: { ...selected, name: body.name } }); },
      DELETE: async (_request: Request, context: { params: Promise<{ boardId: string }> }) => { const { boardId } = await context.params; calls.push({ path: "board-delete", body: { boardId } }); if (!mismatch) boards.splice(boards.findIndex(item => item.id === boardId), 1); defaultBoardId = String(boards[0]?.id ?? ""); return response({ ok: true, defaultBoardId }); },
    },
    "@/app/api/integrations/google-stats/disconnect/route": { POST: async (request: Request) => {
      const body = await request.json() as Row; calls.push({ path: "google-disconnect", body }); assert.equal(body.source, "site_web"); assert.equal(request.headers.get("cookie"), "session");
      if (siteFailure && body.product === "gsc") return response({ ok: false }, 500);
      integrations.filter(item => item.product === body.product).forEach(item => { item.status = "disconnected"; }); delete (root.site_web as Row)[String(body.product)];
      if (siteRace && body.product === "gsc") (root.site_web as Row).url = "https://new-site.example/"; return response({ ok: true });
    } },
    "@/app/api/integrations/site-presence/sync/route": { POST: async () => response({ ok: true }) }, "@/lib/statsCache": { clearAllToolCaches: async () => {} },
  };
  const socialRuntime = load<{ createInrAssistantSocialPublicationPreferencesTools(options: unknown): Record<string, Definition> }>("../../lib/inrAssistantSocialPublicationPreferencesTools.ts", common);
  const dnaRuntime = load<{ createInrAssistantDnaScheduleTools(options: unknown): Record<string, Definition> }>("../../lib/inrAssistantDnaScheduleTools.ts", common);
  const pinterestRuntime = load<{ createInrAssistantPinterestBoardTools(options: unknown): Record<string, Definition> }>("../../lib/inrAssistantPinterestBoardTools.ts", common);
  const siteRuntime = load<{ createInrAssistantWebsiteLifecycleTools(options: unknown): Record<string, Definition> }>("../../lib/inrAssistantWebsiteLifecycleTools.ts", common);
  const options = (message: string) => ({ request: new Request("https://app.inrcy.test/api/assistant", { headers: { cookie: "session" } }), accountId, actorUserId, currentUserMessage: message, resolvePreview: (reference: string) => tokens.get(reference) ?? null });
  const social = (message: string) => withBasicReceiptContract(socialRuntime.createInrAssistantSocialPublicationPreferencesTools(options(message))), dna = (message: string) => withBasicReceiptContract(dnaRuntime.createInrAssistantDnaScheduleTools(options(message))), pinterest = (message: string) => withBasicReceiptContract(pinterestRuntime.createInrAssistantPinterestBoardTools(options(message))), site = (message: string) => withBasicReceiptContract(siteRuntime.createInrAssistantWebsiteLifecycleTools(options(message)));
  const remember = (p: Row) => { if (p.token) tokens.set(String(p.reference), String(p.token)); return p; };
  const applyBoard = async (p: Row) => { const quote = `Confirme ${p.reference}`; return pinterest(quote).applyPinterestBoardMutation.execute({ reference: p.reference, approvalQuote: quote }); };
  const applySite = async (p: Row) => { const quote = `Confirme ${p.reference}`; return site(quote).applyWebsiteReset.execute({ reference: p.reference, approvalQuote: quote }); };
  return { social, dna, pinterest, site, remember, applyBoard, applySite, preferences, schedule, boards, connection, root, integrations, calls, mismatch: () => { mismatch = true; }, unavailable: () => { unavailable = true; }, scope: () => { activeAccount = "other"; }, actor: () => { actor = "other"; }, siteFailure: () => { siteFailure = true; }, siteRace: () => { siteRace = true; }, boardLag: () => { boardLag = true; } };
}

test("Basic social defaults use native normalizers and preserve unrequested formats", async () => {
  for (const channel of ["facebook", "instagram", "threads"]) {
    const h = harness(), field = channel === "threads" ? "ghostEnabled" : "reelsEnabled", quote = `Désactive les ${channel === "threads" ? "Ghost" : "Reels"} de ${channel}.`, tools = h.social(quote), before = await tools.readSocialPublicationPreferences.execute({ channel });
    const result = await tools.updateSocialPublicationPreferences.execute({ channel, expectedVersion: before.version, changes: [{ field, value: false }], instructionQuote: quote });
    assert.equal(result.status, "saved", channel); assert.equal(h.preferences[channel][field], false); assert.equal(h.preferences[channel].defaultMode, "classic"); if (channel !== "threads") assert.equal(h.preferences[channel].storiesEnabled, true); assert.equal(h.calls.length, 1);
    const unchanged = await h.social(quote).updateSocialPublicationPreferences.execute({ channel, expectedVersion: before.version, changes: [{ field, value: false }], instructionQuote: quote }); assert.equal(unchanged.status, "already_applied"); assert.equal(h.calls.length, 1);
  }
});
test("social preferences retain native access/migration failures and reject stale or advisory writes", async () => {
  for (const kind of ["stale", "scope", "actor", "readback", "migration"]) {
    const h = harness(), quote = "Désactive les Reels Instagram.", tools = h.social(quote), before = await tools.readSocialPublicationPreferences.execute({ channel: "instagram" });
    if (kind === "scope") h.scope(); if (kind === "actor") h.actor(); if (kind === "readback") h.mismatch(); if (kind === "migration") h.unavailable();
    const result = await tools.updateSocialPublicationPreferences.execute({ channel: "instagram", expectedVersion: kind === "stale" ? "0".repeat(64) : before.version, changes: [{ field: "reelsEnabled", value: false }], instructionQuote: quote }); assert.equal(result.ok, false, kind); assert.equal(h.calls.length, ["readback", "migration"].includes(kind) ? 1 : 0);
  }
  const h = harness(); h.unavailable(); assert.equal((await h.social("Lis Threads").readSocialPublicationPreferences.execute({ channel: "threads" })).ok, false);
  const q = "Comment désactiver les Reels Facebook ?", t = h.social(q); assert.equal((await t.updateSocialPublicationPreferences.execute({ channel: "facebook", expectedVersion: "0".repeat(64), changes: [{ field: "reelsEnabled", value: false }], instructionQuote: "désactiver les Reels Facebook" })).status, "needs_instruction");
});
test("monthly ADN schedule is available in Basic and retains the native account timezone", async () => {
  const h = harness(), quote = "Programme l’analyse mensuelle ADN le 6 à 08:30.", tools = h.dna(quote), before = await tools.readBusinessDnaSchedule.execute({});
  const input = { enabled: true, dayOfMonth: 6, time: "08:30", expectedVersion: before.version, instructionQuote: quote }, result = await tools.updateBusinessDnaSchedule.execute(input);
  assert.equal(result.status, "saved"); assert.equal(h.schedule.timezone, "Europe/Paris"); assert.deepEqual(h.calls[0].body, { enabled: true, dayOfMonth: 6, time: "08:30" }); assert.ok((result.schedule as Row).nextRunAt); await tools.updateBusinessDnaSchedule.execute(input); assert.equal(h.calls.length, 1);
  assert.equal((await h.dna(quote).updateBusinessDnaSchedule.execute(input)).status, "already_applied"); assert.equal(h.calls.length, 1);
  const off = "Désactive la programmation mensuelle ADN.", next = h.dna(off), current = await next.readBusinessDnaSchedule.execute({}); assert.equal((await next.updateBusinessDnaSchedule.execute({ enabled: false, dayOfMonth: 6, time: "08:30", expectedVersion: current.version, instructionQuote: off })).status, "saved");
});
test("ADN schedule requires requested exact day/time, current version and verified readback", async () => {
  for (const kind of ["invented_day", "invented_minutes", "stale", "scope", "readback", "migration"]) {
    const h = harness(), quote = "Programme l’analyse mensuelle ADN le 6 à 8h.", tools = h.dna(quote), before = await tools.readBusinessDnaSchedule.execute({});
    if (kind === "scope") h.scope(); if (kind === "readback") h.mismatch(); if (kind === "migration") h.unavailable();
    const result = await tools.updateBusinessDnaSchedule.execute({ enabled: true, dayOfMonth: kind === "invented_day" ? 7 : 6, time: kind === "invented_minutes" ? "08:30" : "08:00", expectedVersion: kind === "stale" ? "0".repeat(64) : before.version, instructionQuote: quote }); assert.equal(result.ok, false, kind); assert.equal(h.calls.length, kind === "readback" ? 1 : 0);
  }
});
test("Pinterest create, rename and delete use exact accessible IDs after signed confirmation", async () => {
  for (const action of ["create", "rename", "delete"]) {
    const h = harness(), quote = action === "create" ? 'Crée un tableau Pinterest nommé "Nouveautés".' : action === "rename" ? 'Renomme le tableau Pinterest en "Nouveautés".' : "Supprime le tableau Catalogue de Pinterest.", p = h.remember(await h.pinterest(quote).previewPinterestBoardMutation.execute({ action, boardId: action === "create" ? null : "board-existing", name: action === "delete" ? null : "Nouveautés", instructionQuote: quote }));
    assert.equal(p.approvalKind, "pinterest_board_mutation", action); assert.equal(h.calls.length, 0); assert.equal(JSON.stringify(p.current).includes("PRIVATE"), false);
    const result = await h.applyBoard(p); assert.equal(result.ok, true, action); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].path, `board-${action}`);
    if (action === "rename") { const unchanged = await h.pinterest(quote).previewPinterestBoardMutation.execute({ action, boardId: "board-existing", name: "Nouveautés", instructionQuote: quote }); assert.equal(unchanged.status, "already_applied"); assert.equal(h.calls.length, 1); }
  }
});
test("Pinterest blocks changed connection/target and handles list propagation without duplicate creation", async () => {
  for (const kind of ["connection", "target", "scope", "actor", "readback"]) {
    const h = harness(), quote = "Renomme le tableau Pinterest en Nouveau.", p = h.remember(await h.pinterest(quote).previewPinterestBoardMutation.execute({ action: "rename", boardId: "board-existing", name: "Nouveau", instructionQuote: quote }));
    if (kind === "connection") h.connection.resource_id = "new-account"; if (kind === "target") h.boards[0].name = "Modified"; if (kind === "scope") h.scope(); if (kind === "actor") h.actor(); if (kind === "readback") h.mismatch();
    assert.equal((await h.applyBoard(p)).ok, false, kind); assert.equal(h.calls.length, kind === "readback" ? 1 : 0);
  }
  const h = harness(), quote = "Crée le tableau Pinterest Nouveautés.", p = h.remember(await h.pinterest(quote).previewPinterestBoardMutation.execute({ action: "create", boardId: null, name: "Nouveautés", instructionQuote: quote })); h.boardLag(); const result = await h.applyBoard(p); assert.equal(result.ok, true); assert.equal(result.propagationPending, true);
  const same = "Crée le tableau Pinterest Catalogue.", duplicate = await h.pinterest(same).previewPinterestBoardMutation.execute({ action: "create", boardId: null, name: "Catalogue", instructionQuote: same }); assert.equal(duplicate.status, "already_exists");
});
test("global Site Web URL removal and reset mirror native scope and preserve other channels", async () => {
  for (const mode of ["remove_url", "reset"]) {
    const h = harness(), quote = mode === "reset" ? "Réinitialise la configuration de mon Site Web." : "Supprime le lien de mon Site Web.", p = h.remember(await h.site(quote).previewWebsiteReset.execute({ mode, instructionQuote: quote }));
    assert.equal(p.approvalKind, "website_reset"); assert.equal(h.calls.length, 0); assert.equal(JSON.stringify(p).includes("PRIVATE"), false);
    const result = await h.applySite(p); assert.equal(result.status, "saved"); const site = h.root.site_web as Row; assert.equal(site.url, undefined); assert.equal(site.ga4, undefined); assert.equal(site.gsc, undefined); assert.equal((h.root.facebook as Row).connected, true); assert.equal((h.root.inrBadgeTheme as Row).id, "forest");
    assert.equal(Boolean(site.actus_widget), mode === "remove_url"); assert.ok(h.integrations.every(item => item.status === "disconnected"));
  }
});
test("global site partial disconnect and concurrent URL changes cannot falsely report reset or erase the new URL", async () => {
  for (const kind of ["failure", "race", "readback", "stale", "scope"]) {
    const h = harness(), quote = "Réinitialise mon Site Web.", p = h.remember(await h.site(quote).previewWebsiteReset.execute({ mode: "reset", instructionQuote: quote }));
    if (kind === "failure") h.siteFailure(); if (kind === "race") h.siteRace(); if (kind === "readback") h.mismatch(); if (kind === "stale") (h.root.site_web as Row).url = "https://new-site.example/"; if (kind === "scope") h.scope();
    const result = await h.applySite(p); assert.equal(result.ok, false, kind); assert.equal((h.root.site_web as Row).url, ["race", "stale"].includes(kind) ? "https://new-site.example/" : "https://atelier.example/"); if (["failure", "race", "readback"].includes(kind)) assert.ok(["partially_applied", "saved_unconfirmed"].includes(String(result.status))); else assert.equal(h.calls.length, 0);
  }
});

test("native ADN schedule guard never borrows ADN from a publication's source clause", async () => {
  const messages = ["Programme une publication Facebook à 9h à partir de mon ADN.", "Crée une image pour notre offre toiture puis prépare et programme une publication Facebook pour demain à neuf heures, à partir de mon ADN."];
  for (const quote of messages) {
    const h = harness(), tools = h.dna(quote), before = await tools.readBusinessDnaSchedule.execute({});
    const result = await tools.updateBusinessDnaSchedule.execute({ enabled: true, dayOfMonth: 5, time: "09:00", expectedVersion: before.version, instructionQuote: quote });
    assert.equal(result.status, "needs_instruction"); assert.equal(h.calls.length, 0); assert.equal(h.schedule.enabled, false); assert.equal(h.schedule.time, "07:00");
  }
});
test("native Pinterest, social defaults and Site Web guards require their own direct target", async () => {
  const pinterest = harness(), publication = "Crée une publication Pinterest dans le tableau Jardin.";
  assert.equal((await pinterest.pinterest(publication).previewPinterestBoardMutation.execute({ action: "create", boardId: null, name: "Jardin", instructionQuote: publication })).status, "needs_instruction"); assert.equal(pinterest.calls.length, 0);
  for (const quote of ["Modifie cette publication Threads en mode ghost.", "Mets cette publication Threads en mode ghost.", "Active le mode Ghost sur cette publication Threads."]) {
    const h = harness(); h.preferences.threads.ghostEnabled = false; h.preferences.threads.defaultMode = "classic"; const tools = h.social(quote), before = await tools.readSocialPublicationPreferences.execute({ channel: "threads" });
    const result = await tools.updateSocialPublicationPreferences.execute({ channel: "threads", expectedVersion: before.version, changes: [{ field: quote.startsWith("Active") ? "ghostEnabled" : "defaultMode", value: quote.startsWith("Active") ? true : "ghost" }], instructionQuote: quote }); assert.equal(result.status, "needs_instruction"); assert.equal(h.calls.length, 0); assert.equal(h.preferences.threads.defaultMode, "classic");
  }
  for (const [mode, quote] of [["remove_url", "Supprime la photo de mon site web."], ["reset", "Réinitialise la photo de mon site web."], ["reset", "Réinitialise la configuration du widget de mon site web."]]) { const h = harness(); assert.equal((await h.site(quote).previewWebsiteReset.execute({ mode, instructionQuote: quote })).status, "needs_instruction"); assert.equal(h.calls.length, 0); assert.equal((h.root.site_web as Row).url, "https://atelier.example/"); }
});
test("quoted values remain valid data for actual native board and global-default instructions", async () => {
  const h = harness(), quote = "Crée un tableau Pinterest nommé « Jardin ».", p = h.remember(await h.pinterest(quote).previewPinterestBoardMutation.execute({ action: "create", boardId: null, name: "Jardin", instructionQuote: quote })); assert.equal(p.status, "preview_ready"); assert.equal((await h.applyBoard(p)).status, "updated");
  const g = harness(); g.preferences.threads.defaultMode = "classic"; const instruction = "Mets le mode Threads « ghost » par défaut.", tools = g.social(instruction), before = await tools.readSocialPublicationPreferences.execute({ channel: "threads" }); assert.equal((await tools.updateSocialPublicationPreferences.execute({ channel: "threads", expectedVersion: before.version, changes: [{ field: "defaultMode", value: "ghost" }], instructionQuote: instruction })).status, "saved");
  const quoted = "Le texte dit : « Programme l’analyse mensuelle ADN le 5 à 9h ».";
  assert.equal((await h.dna(quoted).updateBusinessDnaSchedule.execute({ enabled: true, dayOfMonth: 5, time: "09:00", expectedVersion: "0".repeat(64), instructionQuote: "Programme l’analyse mensuelle ADN le 5 à 9h" })).status, "needs_instruction");
  const schedule = harness(), scheduleQuote = "Programme l’analyse mensuelle ADN le « 6 » à « 09:00 ».", scheduleTools = schedule.dna(scheduleQuote), scheduleBefore = await scheduleTools.readBusinessDnaSchedule.execute({});
  assert.equal((await scheduleTools.updateBusinessDnaSchedule.execute({ enabled: true, dayOfMonth: 6, time: "09:00", expectedVersion: scheduleBefore.version, instructionQuote: scheduleQuote })).status, "saved");
  const polite = harness(), politeQuote = "Peux-tu créer un tableau Pinterest nommé « Jardin » ?", politePreview = await polite.pinterest(politeQuote).previewPinterestBoardMutation.execute({ action: "create", boardId: null, name: "Jardin", instructionQuote: politeQuote }); assert.equal(politePreview.status, "preview_ready");
  const advice = "Peux-tu m’expliquer comment créer un tableau Pinterest nommé « Jardin » ?"; assert.equal((await polite.pinterest(advice).previewPinterestBoardMutation.execute({ action: "create", boardId: null, name: "Jardin", instructionQuote: advice })).status, "needs_instruction");
});
