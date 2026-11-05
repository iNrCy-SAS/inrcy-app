import * as requestClauses from "../../lib/inrAssistantRequestClauses.ts";
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { jsonSchema, tool } from "ai";

type Row = Record<string, unknown>;
type Action = { execute(input: unknown): Promise<Row> };
type Lifecycle = { createInrAssistantPublicationLifecycleTools(options: unknown): Record<string, Action> };
type Stats = { createInrAssistantStatsTools(options: unknown): Record<string, Action> };
const ACCOUNT = "10000000-0000-4000-8000-000000000001", ACTOR = "20000000-0000-4000-8000-000000000002", ACTION = "30000000-0000-4000-8000-000000000003", PUBLICATION = "40000000-0000-4000-8000-000000000004", EVENT = "50000000-0000-4000-8000-000000000005", MEDIA = "60000000-0000-4000-8000-000000000006", REPORT = "70000000-0000-4000-8000-000000000007", DRAFT = "80000000-0000-4000-8000-000000000008", OTHER = "90000000-0000-4000-8000-000000000009";
const asRow = (value: unknown): Row => value && typeof value === "object" && !Array.isArray(value) ? value as Row : {};
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
function load<T>(path: string, deps: Row, globals: Row = {}): T {
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} }; vm.runInNewContext(`(function(require,module,exports){${source}\n})`, { Date, Intl, Buffer, Request, Response, URL, Headers, AbortSignal, ...globals })((key: string) => { assert.ok(Object.hasOwn(deps, key), key); return deps[key]; }, loaded, loaded.exports); return loaded.exports as T;
}
function harness() {
  let activeAccount = ACCOUNT, activeActor = ACTOR, edition = "standard", active = true, canStart = true, uncertain = false, nativeReject = false, forged = false, authFailure = false;
  let afterReportSend: (() => void) | null = null;
  const request = new Request("https://app.test/api/assistant/chat", { headers: { cookie: "session=owned", authorization: "session-auth", "x-account-id": OTHER, "x-cron-secret": "never-forward" } });
  const calls: Array<{ route: string; body: Row; method: string; channel?: string }> = [], reads: Array<{ table: string; filters: Row }> = [], saved = new Map<string, string>();
  const prepared: Row = { id: ACTION, user_id: ACCOUNT, automation_key: "publish", action_type: "publication", target_tool: "booster", title: "Atelier", status: "pending_validation", target_channels: ["facebook", "linkedin"], validated_at: null, completed_at: null, scheduled_for: null, validation_required: true, execution_policy: "manual_validation", updated_at: "2026-10-28T10:00:00.000Z", payload: { selectedChannels: ["facebook", "linkedin"], postByChannel: { facebook: { title: "Titre", content: "Texte initial", cta: "Venez", ctaMode: "website", ctaUrl: "https://atelier.test", ctaPhone: "", hashtags: ["atelier"] }, linkedin: { title: "Li", content: "LinkedIn" } } } };
  const event: Row = { id: EVENT, user_id: ACCOUNT, module: "booster", type: "publish", created_at: "2026-10-28T10:00:00.000Z", payload: { publication_id: PUBLICATION, title: "Atelier publié", channels: ["facebook", "linkedin"], results: { facebook: { external_id: "fb-123", status: "published", ok: true }, linkedin: { external_id: "li-234", status: "published", ok: true } } } };
  const media: Row = { id: MEDIA, user_id: ACCOUNT, is_active: true, source: "upload", bucket_name: "inrcy-pro-media", storage_path: `users/${ACCOUNT}/image.jpg`, media_type: "image", mime_type: "image/jpeg", size_bytes: 1200, original_file_name: "atelier.jpg" };
  const report: Row = { id: REPORT, user_id: ACCOUNT, automation_key: "stats", action_type: "stats_report", target_tool: "inrstats", title: "Bilan octobre", status: "completed", created_at: "2026-10-28T10:00:00Z", payload: { delivery: { sentAt: "2026-10-28T10:00:01Z" }, reportDocument: { bucket: "inr-agent-reports", storagePath: `${ACCOUNT}/stats/2026/10/28/bilan.pdf`, filename: "bilan.pdf", downloadUrl: "https://untrusted.invalid/leak" } } };
  const tables: Record<string, Row[]> = { inr_agent_actions: [prepared, report], app_events: [event, { id: DRAFT, user_id: ACCOUNT, module: "booster", type: "publish_draft", payload: { title: "Brouillon", channels: ["facebook"] } }], publications: [{ id: PUBLICATION, user_id: ACCOUNT, title: "Atelier", content: "Publié" }], publication_deliveries: [{ user_id: ACCOUNT, publication_id: PUBLICATION, channel: "facebook", status: "delivered" }], pro_media_library: [media] };
  const db = { from(table: string) { assert.ok(Object.hasOwn(tables, table), table); const filters: Row = {}, notFilters: Row = {}; let contained: Row = {}, from = 0, to = 10000; const result = () => { assert.equal(filters.user_id, ACCOUNT, "all assistant queries must be account-scoped"); reads.push({ table, filters: clone(filters) }); return tables[table].filter(value => Object.entries(filters).every(([key, item]) => value[key] === item) && Object.entries(notFilters).every(([key, item]) => value[key] !== item) && Object.entries(contained).every(([key, item]) => asRow(value.payload)[key] === item)).slice(from, to + 1).map(clone); }; const q = { select() { return q; }, eq(key: string, value: unknown) { filters[key] = value; return q; }, neq(key: string, value: unknown) { notFilters[key] = value; return q; }, contains(key: string, value: Row) { assert.equal(key, "payload"); contained = value; return q; }, order() { return q; }, limit(n: number) { to = n - 1; return q; }, range(a: number, b: number) { from = a; to = b; return q; }, abortSignal(signal: AbortSignal) { assert.ok(signal); return q; }, async maybeSingle() { return { data: result()[0] ?? null, error: null }; }, then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: result(), error: null }).then(resolve); } }; return q; } };
  const helper = load<typeof import("../../lib/inrAssistantActionPreview.ts")>("../../lib/inrAssistantActionPreview.ts", { "server-only": {}, "node:crypto": crypto, "./inrAssistantRequestClauses.ts": requestClauses }, { process: { env: { INRCY_ASSISTANT_APPROVAL_SECRET: "unit-tests-only-signed-preview-secret-12345" } } });
  const instagram = load<typeof import("../../lib/inrsend/instagramCapabilities.ts")>("../../lib/inrsend/instagramCapabilities.ts", {});
  const documentHelper = load<typeof import("../../lib/inrAssistantStatsReportDocument.ts")>("../../lib/inrAssistantStatsReportDocument.ts", {});
  async function recordNative(req: Request, channel?: string) { assert.equal(req.headers.get("cookie"), "session=owned"); assert.equal(req.headers.get("authorization"), "session-auth"); assert.equal(req.headers.get("x-account-id"), null); assert.equal(req.headers.get("x-cron-secret"), null); assert.equal(new URL(req.url).origin, "https://app.test"); const body = await req.json() as Row; calls.push({ route: new URL(req.url).pathname, method: req.method, body, channel }); return body; }
  const agentNative = async (req: Request) => {
    const body = await recordNative(req); if (nativeReject || body.expectedUpdatedAt !== prepared.updated_at) return Response.json({ error: "stale" }, { status: 409 });
    if (body.editType === "save_publish_draft") { prepared.status = "cancelled"; prepared.completed_at = "2026-10-28T10:01:00Z"; asRow(prepared.payload).movedToInrSendDraft = { ok: true, draftId: DRAFT }; asRow(tables.app_events.find(value => value.id === DRAFT)?.payload).inrAgentActionId = ACTION; return Response.json({ savedAsDraft: true, draftId: DRAFT }); }
    const payload = asRow(prepared.payload);
    if (body.editType === "publish_channel_selection") payload.selectedChannels = body.channels;
    else if (body.editType === "publish_channel_text") Object.assign(asRow(asRow(payload.postByChannel)[String(body.channel)]), { title: body.title, content: body.content, cta: body.cta, ctaMode: body.ctaMode, ctaUrl: body.ctaUrl, ctaPhone: body.ctaPhone, hashtags: body.hashtags });
    else if (body.editType === "publish_channel_media") payload.lastManualEdit = { editType: body.editType, channel: body.channel, media: body.media, mediaOperation: body.mediaOperation };
    else if (body.status === "refused") prepared.status = "refused";
    else if (body.editType === "restore_refused_publication" || body.editType === "restore_validated_publication") prepared.status = "pending_validation";
    else assert.fail(`Unknown native edit ${String(body.editType)}`);
    prepared.updated_at = new Date(Date.parse(String(prepared.updated_at)) + 1000).toISOString();
    if (uncertain) throw new Error("native result lost after commit");
    return Response.json({ saved: true, action: { id: forged ? OTHER : ACTION } });
  };
  const channelNative = (channel: string) => ({ DELETE: async (req: Request, context: { params: Promise<{ publicationId: string }> }) => {
    assert.equal((await context.params).publicationId, PUBLICATION); const body = await recordNative(req, channel); if (nativeReject) return Response.json({ error: "denied" }, { status: 409 });
    const result = asRow(asRow(asRow(event.payload).results)[channel]);
    if (body.action === "cancel_pending") { result.status = "cancelled"; result.cancelled = true; }
    else { result.status = "deleted"; result.deleted = true; }
    if (uncertain) throw new Error("native deletion receipt lost");
    return Response.json(body.action === "cancel_pending" ? { ok: true, cancelled: !forged } : { ok: true, deleted: !forged, ...(channel === "instagram" ? { local_deleted_only: true } : {}) });
  } });
  const block = (channel: string) => ({ channel, live: true, connection: { statsConnected: true }, opportunities: 4, capturedLeads: { week: 2, month: 3 }, estimatedValue: 500, syncAt: Date.now(), snapshotDate: "2026-10-30", error: null });
  let statsPayload: Row = { ok: true, ran: true, inrstats: { "30": { blocks: { facebook: block("facebook"), linkedin: { ...block("linkedin"), live: false, error: "source unavailable" } } } } };
  const statsNative = async (req: Request) => { const body = await recordNative(req); if (nativeReject) return Response.json({ error: "failed" }, { status: 503 }); if (new URL(req.url).pathname.includes("channel-refresh")) return Response.json({ periods: { "30": { block: block(forged ? "x" : String(body.channel)) } } }); return Response.json(statsPayload); };
  const sendNative = async (req: Request) => { await recordNative(req); if (uncertain) throw new Error("mail receipt lost"); afterReportSend?.(); return Response.json({ sent: !forged, recipientEmail: "pro@example.test", filename: "bilan.pdf", action: { id: REPORT } }, { status: nativeReject ? 500 : 200 }); };
  const deps: Row = { "server-only": {}, ai: { tool, jsonSchema }, "./requireUser": { requireUser: async () => { if (authFailure) throw new Error("scope lookup unavailable"); return { activeUserId: activeAccount, authUserId: activeActor }; } }, "./dashboardEditionServer": { getDashboardEditionForAuthUser: async (actor: string) => { assert.equal(actor, ACTOR); return edition; } }, "./accountSubscriptionAccess": { getActiveSubscriptionAccountIds: async (ids: string[]) => { assert.deepEqual([...ids], [ACCOUNT]); return new Set(active ? [ACCOUNT] : []); } }, "./inrAssistantActionPreview.ts": helper, "./inrAssistantMemory.ts": { sanitizeInrAssistantMemoryText: (value: string, max: number) => value.slice(0, max) }, "./inrsend/instagramCapabilities": instagram,
    "./inrAssistantStatsReportDocument.ts": documentHelper, "@/app/api/agent/actions/route": { PATCH: agentNative }, "@/lib/inrsend/publicationChannelActions": { createPublicationChannelHandlers: channelNative }, "@/lib/mediaLibraryContentUrl": { buildMediaLibraryContentUrl: (mediaId: string) => `/api/media-library/${mediaId}/content` }, "@/app/api/stats/channel-refresh/route": { POST: statsNative }, "@/app/api/stats/daily-refresh/route": { POST: statsNative }, "@/app/api/agent/actions/send-stats-report/route": { POST: sendNative }, "@/app/api/inrstats/inrbadge/route": { GET: async (req: Request) => { assert.equal(req.method, "GET"); assert.equal(req.headers.get("cookie"), "session=owned"); calls.push({ route: "/api/inrstats/inrbadge", body: {}, method: "GET" }); return Response.json({ views: { month: 0 }, syncedAt: Date.now() }); } }, "@/app/api/inr-search/analytics/route": { GET: async () => { calls.push({ route: "/api/inr-search/analytics", body: {}, method: "GET" }); return Response.json({ ok: true, analytics: { views: { month: 0 } } }); } } };
  deps["@/app/api/inrsend/publications/[publicationId]/tiktok/retry/route"] = { POST: async (req: Request, context: { params: Promise<{ publicationId: string }> }) => {
    assert.equal((await context.params).publicationId, PUBLICATION); await recordNative(req, "tiktok"); if (nativeReject) return Response.json({ ok: false }, { status: 409 });
    const result = asRow(asRow(asRow(event.payload).results).tiktok); Object.assign(result, { ok: true, error: null, tiktok_status: "PROCESSING_UPLOAD", diagnostics: { ...asRow(result.diagnostics), status: { pending: true }, retry_at: "2026-11-05T12:00:00Z" } });
    if (uncertain) throw new Error("retry receipt lost"); return Response.json({ ok: true, publication_id: forged ? OTHER : PUBLICATION, result });
  } };
  // Published composite writes have their own native guarded factory suite.
  // Do not invent those tools in this isolated legacy lifecycle/stats harness.
  deps["./inrAssistantPublishedPublicationTools.ts"] = { createInrAssistantPublishedPublicationTools: () => ({}) };
  const lifecycle = load<Lifecycle>("../../lib/inrAssistantPublicationLifecycleTools.ts", deps), stats = load<Stats>("../../lib/inrAssistantStatsTools.ts", deps);
  const options = (message: string, extra: Row) => ({ request, accountId: ACCOUNT, actorUserId: ACTOR, edition, supabase: db, currentUserMessage: message, canStartWork: () => canStart, resolvePreview: (reference: string) => saved.get(reference) ?? null, ...extra });
  const create = (message: string, extra: Row = {}) => lifecycle.createInrAssistantPublicationLifecycleTools(options(message, extra));
  const createStats = (message: string, extra: Row = {}) => stats.createInrAssistantStatsTools(options(message, extra));
  const preview = async (operation = "delete_channel", channel: string | null = "facebook") => { const quote = operation === "delete_channel" ? "Supprime la publication sur Facebook" : operation === "cancel_tiktok_pending" ? "Annule le TikTok en attente" : operation === "refuse_prepared" ? "Refuse cette proposition" : "Remets cette proposition en attente"; const result = await create(quote).previewPublicationLifecycleAction.execute({ targetId: operation.endsWith("prepared") ? ACTION : PUBLICATION, operation, channel, instructionQuote: quote }); if (typeof result.token === "string") saved.set(String(result.reference), result.token); return result; };
  const apply = (p: Row, message = `Confirme ${String(p.reference)}`, extra: Row = {}) => create(message, extra).applyPublicationLifecycleAction.execute({ reference: p.reference, instructionQuote: message });
  const edit = (overrides: Row = {}) => ({ actionId: ACTION, operation: "text", channel: "facebook", channels: null, text: { title: null, content: "Nouveau texte", cta: null, hashtags: null }, mediaId: null, mediaOperation: null, mediaIndex: null, instructionQuote: "Modifie cette publication", ...overrides });
  return { create, createStats, preview, apply, edit, prepared, event, media, report, tables, calls, reads, saved, statsPayload: (value: Row) => { statsPayload = value; }, edition: (value: string) => { edition = value; }, scope: () => { activeAccount = OTHER; }, actor: () => { activeActor = OTHER; }, inactive: () => { active = false; }, stop: () => { canStart = false; }, uncertain: () => { uncertain = true; }, reject: () => { nativeReject = true; }, forge: () => { forged = true; }, switchAfterSend: () => { afterReportSend = () => { activeAccount = OTHER; }; }, failScopeAfterSend: () => { afterReportSend = () => { authFailure = true; }; } };
}

test("TikTok retry in Basic requires signed approval and reuses only a confirmed failed native publication", async () => {
  const h = harness(); h.edition("basic"); const settings = { privacyLevel: "SELF_ONLY", musicUsageConfirmed: true, commercialContent: "none" };
  asRow(asRow(h.event.payload).results).tiktok = { ok: false, tiktok_status: "FAILED", diagnostics: { publicationSettings: settings } };
  h.tables.publication_deliveries.push({ user_id: ACCOUNT, publication_id: PUBLICATION, channel: "tiktok", status: "failed" });
  const instructionQuote = "Retente cette publication TikTok";
  const p = await h.create(instructionQuote).previewPublicationLifecycleAction.execute({ targetId: PUBLICATION, operation: "retry_tiktok", channel: "tiktok", instructionQuote });
  assert.equal(p.status, "preview_ready"); assert.equal(h.calls.length, 0); h.saved.set(String(p.reference), String(p.token));
  assert.equal((await h.apply(p, "oui")).status, "confirmation_required");
  assert.equal((await h.apply(p)).status, "processing"); assert.equal(h.calls.length, 1); assert.equal(h.calls[0].route, `/api/inrsend/publications/${PUBLICATION}/tiktok/retry`); assert.deepEqual(h.calls[0].body, {});
  assert.equal((await h.apply(p)).status, "stale_preview"); assert.equal(h.calls.length, 1); assert.equal(asRow(asRow(asRow(h.event.payload).results).facebook).status, "published");
});

test("TikTok retry blocks missing consent, pending/unknown state and uncertain attempt replays", async () => {
  const instructionQuote = "Retente cette publication TikTok", input = { targetId: PUBLICATION, operation: "retry_tiktok", channel: "tiktok", instructionQuote };
  for (const result of [{ tiktok_status: "FAILED", ok: false }, { tiktok_status: "PROCESSING_UPLOAD", ok: false }, { tiktok_status: "UNKNOWN", ok: false }, { tiktok_status: "FAILED", ok: false, diagnostics: { publicationSettings: { privacyLevel: "SELF_ONLY", commercialContent: "none", musicUsageConfirmed: false } } }]) {
    const h = harness(); asRow(asRow(h.event.payload).results).tiktok = result; assert.equal((await h.create(instructionQuote).previewPublicationLifecycleAction.execute(input)).status, "blocked"); assert.equal(h.calls.length, 0);
  }
  const h = harness(); asRow(asRow(h.event.payload).results).tiktok = { ok: false, tiktok_status: "FAILED", diagnostics: { publicationSettings: { privacyLevel: "SELF_ONLY", musicUsageConfirmed: true, commercialContent: "none" } } };
  const p = await h.create(instructionQuote).previewPublicationLifecycleAction.execute(input); h.saved.set(String(p.reference), String(p.token)); h.uncertain();
  const message = `Confirme ${String(p.reference)}`, apply = h.create(message).applyPublicationLifecycleAction, args = { reference: p.reference, instructionQuote: message };
  assert.equal((await apply.execute(args)).status, "unknown"); assert.equal((await apply.execute(args)).status, "unknown"); assert.equal(h.calls.length, 1); assert.equal((await h.apply(p)).status, "stale_preview");
});

test("publication reads paginate owned drafts/history/prepared without executing or exposing campaigns", async () => {
  const h = harness(); for (let n = 0; n < 24; n++) h.tables.app_events.push({ ...clone(h.event), id: `record-${n}` }); h.tables.app_events.push({ ...h.event, user_id: OTHER }); h.tables.inr_agent_actions.push({ ...h.prepared, action_type: "campaign" });
  const first = await h.create("Liste mes publications").readPublicationWorkspace.execute({ view: "history", recordId: null, offset: 0 }); assert.equal((first.records as Row[]).length, 20); assert.equal(first.nextOffset, 20);
  const last = await h.create("Suite").readPublicationWorkspace.execute({ view: "history", recordId: null, offset: 20 }); assert.equal((last.records as Row[]).length, 5); assert.equal(last.nextOffset, null);
  const prepared = await h.create("Liste").readPublicationWorkspace.execute({ view: "prepared", recordId: null, offset: 0 }); assert.equal((prepared.records as Row[]).length, 1);
  const drafts = await h.create("Ouvre mon brouillon").readPublicationWorkspace.execute({ view: "drafts", recordId: DRAFT, offset: 0 }); assert.equal((drafts.records as Row[])[0].toolUrl, `/dashboard?action=publish&draftId=${DRAFT}`); assert.equal(h.calls.length, 0);
});

test("prepared text edits preserve unspecified CTA/hashtags and use the native account-scoped route once", async () => {
  const h = harness(), tool = h.create("Modifie cette publication").editPreparedPublication;
  assert.equal((await tool.execute(h.edit())).status, "updated"); assert.equal((await tool.execute(h.edit())).status, "updated"); assert.equal(h.calls.length, 1);
  const body = h.calls[0].body; assert.equal(body.editType, "publish_channel_text"); assert.equal(body.expectedUpdatedAt, "2026-10-28T10:00:00.000Z"); assert.equal(body.ctaUrl, "https://atelier.test"); assert.deepEqual(body.hashtags, ["atelier"]); assert.equal(body.title, "Titre"); assert.equal(body.applyToAllChannels, false);
  assert.equal((await tool.execute(h.edit({ text: { title: null, content: "Autre", cta: null, hashtags: null } }))).status, "needs_instruction"); assert.equal(h.calls.length, 1);
});

test("prepared channel selection does not approve or dispatch; active owned library media are resolved server-side", async () => {
  const h = harness(); const result = await h.create("Modifie cette publication").editPreparedPublication.execute(h.edit({ operation: "channels", channel: null, channels: ["facebook"], text: null })); assert.equal(result.status, "updated"); assert.equal(h.calls[0].body.confirmPending, false); assert.equal(h.prepared.status, "pending_validation");
  const mediaInput = h.edit({ operation: "media", text: null, mediaId: MEDIA, mediaOperation: "replace", mediaIndex: 0 }); assert.equal((await h.create("Modifie cette publication").editPreparedPublication.execute(mediaInput)).status, "updated"); assert.equal(asRow(h.calls[1].body.media).storagePath, `users/${ACCOUNT}/image.jpg`); assert.equal(asRow(h.calls[1].body.media).url, `https://app.test/api/media-library/${MEDIA}/content`);
  const bad = harness(); bad.media.user_id = OTHER; assert.equal((await bad.create("Modifie cette publication").editPreparedPublication.execute(mediaInput)).status, "unknown"); assert.equal(bad.calls.length, 0);
});

test("save prepared publication as Booster draft returns native draft link and never publishes", async () => {
  const h = harness(), instructionQuote = "Enregistre cette publication en brouillon";
  const result = await h.create(instructionQuote).editPreparedPublication.execute(h.edit({ operation: "save_draft", channel: null, text: null, instructionQuote })); assert.equal(result.status, "draft"); assert.equal(result.draftId, DRAFT); assert.equal(h.calls[0].body.editType, "save_publish_draft"); assert.equal(h.calls.length, 1); assert.equal(h.prepared.status, "cancelled");
});

test("a draft inserted before source closure failure is recovered without a duplicate native transfer", async () => { const h = harness(), instructionQuote = "Enregistre cette publication en brouillon"; asRow(h.tables.app_events.find(value => value.id === DRAFT)?.payload).inrAgentActionId = ACTION; const result = await h.create(instructionQuote).editPreparedPublication.execute(h.edit({ operation: "save_draft", channel: null, text: null, instructionQuote })); assert.equal(result.status, "draft"); assert.equal(result.draftId, DRAFT); assert.equal(h.calls.length, 0); assert.equal(h.prepared.status, "pending_validation"); });

for (const status of ["validated", "scheduled", "executing", "completed", "failed"]) test(`prepared edit refuses ${status} and never changes a dispatched action`, async () => { const h = harness(); h.prepared.status = status; assert.equal((await h.create("Modifie cette publication").editPreparedPublication.execute(h.edit())).status, "blocked"); assert.equal(h.calls.length, 0); });

test("destructive publication operation needs exact signed preview; native ID is never chosen by model", async () => {
  const h = harness(), p = await h.preview(); assert.equal(p.status, "preview_ready"); assert.equal(p.approvalKind, "publication_lifecycle"); assert.equal(h.calls.length, 0);
  assert.equal((await h.apply(p, "oui")).status, "confirmation_required"); const result = await h.apply(p); assert.equal(result.status, "deleted"); assert.equal(result.localOnly, false); assert.equal(h.calls[0].body.externalId, "fb-123"); assert.equal(h.calls[0].channel, "facebook"); assert.equal(asRow(asRow(asRow(h.event.payload).results).linkedin).status, "published");
  assert.equal((await h.apply(p)).status, "stale_preview"); assert.equal(h.calls.length, 1);
});

test("refusal and future restoration use the signed current timestamp and native decisions", async () => {
  const h = harness(), p = await h.preview("refuse_prepared", null); assert.equal(p.status, "preview_ready"); assert.equal((await h.apply(p)).status, "refused"); assert.equal(h.calls[0].body.expectedUpdatedAt, "2026-10-28T10:00:00.000Z"); assert.equal(h.calls[0].body.status, "refused");
  h.prepared.scheduled_for = new Date(Date.now() + 86400_000).toISOString(); const restore = await h.preview("restore_prepared", null); assert.equal(restore.status, "preview_ready"); assert.equal((await h.apply(restore)).status, "pending_validation"); assert.equal(h.calls[1].body.editType, "restore_refused_publication");
  const scheduled = harness(); scheduled.prepared.status = "scheduled"; scheduled.prepared.scheduled_for = new Date(Date.now() + 86400_000).toISOString(); const back = await scheduled.preview("restore_prepared", null); assert.equal((await scheduled.apply(back)).status, "pending_validation"); assert.equal(scheduled.calls[0].body.editType, "restore_validated_publication");
});

test("Instagram published and YouTube deletion are blocked, unpublished Instagram and pending TikTok are local only", async () => {
  for (const channel of ["instagram", "youtube_shorts"]) { const h = harness(); asRow(asRow(h.event.payload).results)[channel] = { status: "published", external_id: "remote-id", ok: true }; assert.equal((await h.preview("delete_channel", channel)).status, "unsupported"); assert.equal(h.calls.length, 0); }
  const instagram = harness(); asRow(asRow(instagram.event.payload).results).instagram = { status: "draft", ok: false }; const p = await instagram.preview("delete_channel", "instagram"); assert.equal((await instagram.apply(p)).status, "deleted_locally");
  const tiktok = harness(); asRow(asRow(tiktok.event.payload).results).tiktok = { status: "pending", pending: true }; const tp = await tiktok.preview("cancel_tiktok_pending", "tiktok"); const result = await tiktok.apply(tp); assert.equal(result.status, "cancelled_locally"); assert.equal(result.localOnly, true); assert.equal(tiktok.calls[0].body.action, "cancel_pending");
});

for (const suffix of [" seulement si le client accepte", " demain", " après ma confirmation", " dans 2 heures", " mais ne supprime pas"]) test(`conditional/desferred approval cannot execute${suffix}`, async () => { const h = harness(), p = await h.preview(); assert.equal((await h.apply(p, `Confirme ${String(p.reference)}${suffix}`)).status, "confirmation_required"); assert.equal(h.calls.length, 0); });

test("scope changes, expired authorization, stale data and uncertain outcomes never repeat native mutations", async () => {
  for (const change of ["scope", "actor", "inactive", "stop"] as const) { const h = harness(), p = await h.preview(); h[change](); assert.equal((await h.apply(p)).status, "blocked"); assert.equal(h.calls.length, 0); }
  const stale = harness(), p = await stale.preview(); asRow(stale.event.payload).title = "Changed"; assert.equal((await stale.apply(p)).status, "stale_preview"); assert.equal(stale.calls.length, 0);
  const lost = harness(), lp = await lost.preview(), message = `Confirme ${String(lp.reference)}`, current = lost.create(message).applyPublicationLifecycleAction; lost.uncertain(); const input = { reference: lp.reference, instructionQuote: message }; assert.equal((await current.execute(input)).status, "unknown"); assert.equal((await current.execute(input)).status, "unknown"); assert.equal(lost.calls.length, 1); assert.equal((await lost.apply(lp)).status, "stale_preview");
});

test("Basic permits manual publications and stats/PDF while prepared agent operations and generated reports stay unavailable", async () => {
  const h = harness(); h.edition("basic"); assert.equal((await h.create("Liste").readPublicationWorkspace.execute({ view: "history", recordId: null, offset: 0 })).status, "read"); assert.equal((await h.create("Liste").readPublicationWorkspace.execute({ view: "prepared", recordId: null, offset: 0 })).status, "blocked");
  assert.equal((await h.create("Modifie cette publication").editPreparedPublication.execute(h.edit())).status, "blocked"); const p = await h.preview(); assert.equal((await h.apply(p)).status, "deleted");
  assert.equal((await h.createStats("Actualise mes stats").refreshStatsSources.execute({ channel: null, instructionQuote: "Actualise mes stats" })).status, "partial"); assert.equal((await h.createStats("Télécharge mon bilan").readStatsReports.execute({ reportId: REPORT, offset: 0 })).status, "read");
  const before = h.calls.length; assert.equal((await h.createStats("Envoie mon bilan statistiques").sendStatsReport.execute({ instructionQuote: "Envoie mon bilan statistiques" })).status, "blocked"); assert.equal(h.calls.length, before);
});

test("server edition downgrade overrides caller edition for agent actions", async () => { const h = harness(); h.edition("basic"); assert.equal((await h.create("Modifie cette publication", { edition: "premium" }).editPreparedPublication.execute(h.edit())).status, "blocked"); assert.equal((await h.createStats("Envoie le bilan statistiques", { edition: "premium" }).sendStatsReport.execute({ instructionQuote: "Envoie le bilan statistiques" })).status, "blocked"); assert.equal(h.calls.length, 0); });

test("stats refresh returns partial fresh sources, preserves missing values, and uses native all/channel paths once", async () => {
  const h = harness(), all = h.createStats("Actualise mes stats").refreshStatsSources;
  const result = await all.execute({ channel: null, instructionQuote: "Actualise mes stats" }); assert.equal(result.status, "partial"); const sources = result.sources as Row[]; assert.equal(sources[0].opportunitiesEstimated, 4); assert.equal(sources[1].opportunitiesEstimated, null); assert.equal(sources[1].live, false); assert.equal(h.calls[0].body.force, true); assert.equal(h.calls[0].body.announce, false);
  await all.execute({ channel: null, instructionQuote: "Actualise mes stats" }); assert.equal(h.calls.length, 1);
  assert.equal((await h.createStats("Actualise Facebook").refreshStatsSources.execute({ channel: "facebook", instructionQuote: "Actualise Facebook" })).status, "refreshed"); assert.equal(h.calls[1].route, "/api/stats/channel-refresh"); assert.equal(h.calls[1].body.channel, "facebook");
});

test("stats refresh pending, error, mismatched and empty source responses are never announced fresh", async () => {
  for (const data of [{ ok: true, ran: false, inProgress: true }, { ok: true, ran: true }, { ok: true, ran: true, inrstats: { "30": { blocks: { facebook: { channel: "facebook", live: false, connection: { statsConnected: false }, opportunities: 0 } } } } }]) { const h = harness(); h.statsPayload(data); const result = await h.createStats("Actualise mes stats").refreshStatsSources.execute({ channel: null, instructionQuote: "Actualise mes stats" }); assert.notEqual(result.ok, true); assert.notEqual(result.status, "refreshed"); }
  const forged = harness(); forged.forge(); assert.equal((await forged.createStats("Actualise Facebook").refreshStatsSources.execute({ channel: "facebook", instructionQuote: "Actualise Facebook" })).status, "unknown");
});

test("Badge and Search native refreshes do not turn their silent zero fallbacks into measured fresh statistics", async () => { for (const channel of ["inrbadge", "inr_search"]) { const h = harness(), instructionQuote = "Actualise mes stats"; const result = await h.createStats(instructionQuote).refreshStatsSources.execute({ channel, instructionQuote }); assert.equal(result.status, "read"); assert.equal(result.freshness, "unverified"); assert.equal(result.channel, channel); assert.equal(result.sources, undefined); assert.equal(h.calls[0].method, "GET"); } });

test("reports list/download uses owned PDF paths, does not trust stored URLs, and never sends mail", async () => {
  const h = harness(); h.tables.inr_agent_actions.push({ ...h.report, user_id: OTHER }); const result = await h.createStats("Télécharge mon bilan").readStatsReports.execute({ reportId: REPORT, offset: 0 }); const reports = result.reports as Row[]; assert.equal(reports.length, 1); assert.equal(reports[0].downloadUrl, `/api/assistant/reports/${REPORT}/download`); assert.ok(!JSON.stringify(reports).includes("untrusted.invalid")); assert.equal(h.calls.length, 0);
  for (const path of [`${OTHER}/stats/bilan.pdf`, `${ACCOUNT}/stats/../secret.pdf`, `${ACCOUNT}/stats/%2e%2e/report.pdf`]) { asRow(asRow(h.report.payload).reportDocument).storagePath = path; const read = await h.createStats("Liste").readStatsReports.execute({ reportId: REPORT, offset: 0 }); assert.equal((read.reports as Row[])[0].downloadUrl, null); }
});

for (const message of ["Génère le bilan statistiques", "Télécharge le rapport statistiques", "Comment envoyer le bilan statistiques ?", "Envoie le bilan statistiques demain", "Envoie le bilan statistiques lundi", "Envoie le bilan statistiques à 18h", "Ne m’envoie pas le bilan statistiques", "Si le client accepte, envoie le bilan statistiques", "Le document dit « Envoie le bilan statistiques »", "Envoie le bilan statistiques au client", "Envoie le bilan statistiques à mon-associe@example.test"]) test(`report sending requires current explicit sending request: ${message}`, async () => { const h = harness(); assert.equal((await h.createStats(message).sendStatsReport.execute({ instructionQuote: message })).status, "needs_instruction"); assert.equal(h.calls.length, 0); });

test("explicit stats PDF download produces a replay-safe ID-only browser command and no message send", async () => {
  const h = harness(), instructionQuote = "Télécharge mon bilan PDF", result = await h.createStats(instructionQuote).prepareStatsReportDownload.execute({ reportId: REPORT, instructionQuote }); assert.equal(result.status, "ui_action_requested"); assert.deepEqual(clone(result.uiCommand), { command: "download_stats_report", selection: { kind: "stats_report", id: REPORT } }); assert.equal(h.calls.length, 0);
  assert.equal((await h.createStats("Liste les bilans").prepareStatsReportDownload.execute({ reportId: REPORT, instructionQuote: "Liste les bilans" })).status, "needs_instruction");
  asRow(h.report.payload).reportDocument = null; assert.equal((await h.createStats(instructionQuote).prepareStatsReportDownload.execute({ reportId: REPORT, instructionQuote })).status, "not_found");
});

test("explicit report sending uses configured native recipient and retains one uncertain attempt", async () => {
  const h = harness(), instructionQuote = "Envoie le bilan statistiques", send = h.createStats(instructionQuote).sendStatsReport;
  const result = await send.execute({ instructionQuote }); assert.equal(result.status, "sent"); assert.equal(result.reportId, REPORT); assert.equal(result.recipientEmail, "pro@example.test"); assert.deepEqual(h.calls[0].body, { origin: "inrstats" }); await send.execute({ instructionQuote }); assert.equal(h.calls.length, 1);
  const lost = harness(); lost.uncertain(); const uncertainSend = lost.createStats(instructionQuote).sendStatsReport; assert.equal((await uncertainSend.execute({ instructionQuote })).status, "unknown"); assert.equal((await uncertainSend.execute({ instructionQuote })).status, "unknown"); assert.equal(lost.calls.length, 1);
});

for (const change of ["switchAfterSend", "failScopeAfterSend"] as const) test(`confirmed report delivery stays sent after ${change} without disclosing old-account data or resending`, async () => {
  const h = harness(), instructionQuote = "Envoie le bilan statistiques", send = h.createStats(instructionQuote).sendStatsReport;
  h[change](); const first = await send.execute({ instructionQuote }); assert.equal(first.status, "sent"); assert.equal(first.ok, true); assert.equal(first.scopeChanged, true); assert.equal(first.reportId, undefined); assert.equal(first.recipientEmail, undefined); assert.equal(first.filename, undefined); assert.equal(first.nextAction, undefined);
  const replay = await send.execute({ instructionQuote }); assert.deepEqual(clone(replay), clone(first)); assert.equal(h.calls.length, 1);
});

test("strict schemas reject fabricated scope/recipient/URL fields before invoking native handlers", async () => {
  const h = harness(); await assert.rejects(() => h.createStats("Envoie le bilan statistiques").sendStatsReport.execute({ instructionQuote: "Envoie le bilan statistiques", recipientEmail: "outside@example.test" })); await assert.rejects(() => h.create("Modifie cette publication").editPreparedPublication.execute(h.edit({ accountId: OTHER }))); await assert.rejects(() => h.create("Modifie cette publication").editPreparedPublication.execute(h.edit({ operation: "media", text: null, mediaId: "https://remote.invalid/image.jpg", mediaOperation: "replace", mediaIndex: 0 }))); assert.equal(h.calls.length, 0);
});
