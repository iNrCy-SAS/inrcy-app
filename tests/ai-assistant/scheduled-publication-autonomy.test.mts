import * as requestClauses from "../../lib/inrAssistantRequestClauses.ts";
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { jsonSchema, tool } from "ai";
import { isManualBoosterPublicationSchedule } from "../../lib/standardAgentPolicy.ts";
import * as editHelper from "../../lib/inrAssistantScheduledPublicationEdit.ts";
import * as scheduleIntent from "../../lib/inrAssistantScheduledPublicationIntent.ts";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";
type Row = Record<string, unknown>;
type ScheduledRow = Row & { id: string; user_id: string; action_type: string; status: string; attempt_count: number; scheduled_at: string; timezone: string; updated_at: string; channels: string[]; payload: Row & { publishPayload: { postByChannel?: Row; idempotencyKey: string }; lastExecution?: { publicationId: string; status: string } } };
type ActionResult = Row & { ok: boolean; status: string; reference?: string; token?: string; records?: Row[]; nextOffset?: number | null };
type ScheduledRuntime = { createInrAssistantScheduledPublicationTools(options: unknown): Record<"readScheduledPublications" | "previewScheduledPublicationAction" | "previewScheduledPublicationEdit" | "applyScheduledPublicationAction", { execute(input: unknown): Promise<ActionResult> }> };
const ACCOUNT = "10000000-0000-4000-8000-000000000001", ACTOR = "20000000-0000-4000-8000-000000000002", ID = "30000000-0000-4000-8000-000000000003", OTHER = "40000000-0000-4000-8000-000000000004";
function load<T>(path: string, deps: Row, globals: Row = {}): T { const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText; const loadedModule = { exports: {} }; vm.runInNewContext(`(function(require,module,exports){${source}\n})`, { Date, Intl, Buffer, Request, Response, URL, Headers, ...globals })((key: string) => { assert.ok(Object.hasOwn(deps, key), key); return deps[key]; }, loadedModule, loadedModule.exports); return loadedModule.exports as T; }
function harness(edition: "basic" | "premium" = "premium") {
  const account = ACCOUNT;
  let actor = ACTOR, race = false, uncertain = false;
  const helper = load<typeof import("../../lib/inrAssistantActionPreview.ts")>("../../lib/inrAssistantActionPreview.ts", { "server-only": {}, "node:crypto": crypto, "./inrAssistantRequestClauses.ts": requestClauses }, { process: { env: { INRCY_ASSISTANT_APPROVAL_SECRET: "unit-test-signing-key-for-previews-only-12345" } } });
  const row: ScheduledRow = { id: ID, user_id: ACCOUNT, action_type: "publication", target_tool: "booster", title: "Atelier", summary: "Résumé", status: "scheduled", scheduled_at: new Date(Date.now() + 86400_000).toISOString(), timezone: "Europe/Paris", channels: ["facebook"], attempt_count: 0, executed_at: null, updated_at: new Date().toISOString(), payload: { publishPayload: { postByChannel: { facebook: { content: "Notre atelier" } }, idempotencyKey: "stable-native-key" } } };
  const asset: Row = { id: OTHER, user_id: ACCOUNT, media_type: "image", mime_type: "image/jpeg", storage_path: `users/${ACCOUNT}/photo.jpg`, bucket_name: "inrcy-pro-media", is_active: true, upload_status: "uploaded", original_file_name: "photo.jpg" };
  const rows = [row], deliveries: Row[] = [], calls: Array<{ body: Row; method: string }> = [], saved = new Map<string, string>();
  const db = { from(table: string) { assert.ok(["inr_agent_scheduled_actions", "publication_deliveries", "pro_media_library"].includes(table)); const filters: Row = {}; let from = 0, to = 999; const result = () => { assert.equal(filters.user_id, ACCOUNT); return (table === "publication_deliveries" ? deliveries : table === "pro_media_library" ? [asset] : rows).filter(item => Object.entries(filters).every(([key, val]) => item[key] === val)).slice(from, to + 1).map(item => JSON.parse(JSON.stringify(item))); }; const q = { select() { return q; }, eq(key: string, value: unknown) { filters[key] = value; return q; }, order() { return q; }, range(a: number, b: number) { from = a; to = b; return q; }, limit(n: number) { to = n - 1; return q; }, async maybeSingle() { return { data: result()[0] ?? null, error: null }; }, then(resolve: (v: unknown) => unknown) { return Promise.resolve({ data: result(), error: null }).then(resolve); } }; return q; } };
  const native = async (request: Request, context: { params: Promise<{ id: string }> }) => { assert.equal((await context.params).id, ID); assert.equal(request.headers.get("cookie"), "session"); assert.equal(request.headers.get("x-account-id"), null); const body = await request.json(); calls.push({ body, method: request.method }); if (race) row.status = "running"; if (body.expectedState !== helper.scheduledPublicationFingerprint(row)) return Response.json({}, { status: 409 }); if (request.method === "POST") { row.status = "running"; row.attempt_count++; } else if (body.status) row.status = body.status; else if (body.editType) row.payload = body.payload; else { row.scheduled_at = body.scheduledAt; row.timezone = body.timezone; } row.updated_at = new Date(Date.now() + 1).toISOString(); if (uncertain) throw new Error("unknown after native commit"); return Response.json({ ok: true }); };
  const runtime = load<ScheduledRuntime>("../../lib/inrAssistantScheduledPublicationTools.ts", { "server-only": {}, ai: { jsonSchema, tool }, "./requireUser": { requireUser: async () => ({ activeUserId: account, authUserId: actor }) }, "./inrAssistantActionPreview.ts": helper, "./inrAssistantScheduledPublicationEdit.ts": editHelper, "./inrAssistantScheduledPublicationIntent.ts": scheduleIntent, "./inrAssistantPublicationCtaPatch.ts": runtimeModules()<typeof import("../../lib/inrAssistantPublicationCtaPatch.ts")>("lib/inrAssistantPublicationCtaPatch.ts"), "./standardAgentPolicy.ts": { isManualBoosterPublicationSchedule }, "./inrAssistantMemory.ts": { sanitizeInrAssistantMemoryText: (s: string, max: number) => typeof s === "string" ? s.slice(0, max) : "" }, "@/app/api/agent/scheduled-actions/[id]/route": { PATCH: native }, "@/app/api/agent/scheduled-actions/[id]/execute/route": { POST: native } });
  const create = (message: string) => runtime.createInrAssistantScheduledPublicationTools({ request: new Request("https://app.test/api/assistant/chat", { headers: { cookie: "session", "x-account-id": OTHER } }), accountId: ACCOUNT, actorUserId: ACTOR, edition, supabase: db, currentUserMessage: message, resolvePreview: (ref: string) => saved.get(ref) ?? null });
  const propose = async (operation = "cancel") => { const quote = operation === "publish_now" ? "Publie maintenant la publication programmée" : operation === "cancel" ? "Annule la publication programmée" : operation === "retry" ? "Reprends la publication échouée" : "Reprogramme la publication à demain"; const result = await create(quote).previewScheduledPublicationAction.execute({ scheduledActionId: ID, operation, scheduledAt: operation === "reschedule" ? new Date(Date.now() + 2 * 86400_000).toISOString() : null, timezone: operation === "reschedule" ? "Europe/Paris" : null, instructionQuote: quote }); if (result.token) { assert.ok(result.reference); saved.set(result.reference, result.token); } return result; };
  const apply = (p: ActionResult, message = `Confirme ${p.reference}`) => create(message).applyScheduledPublicationAction.execute({ reference: p.reference, instructionQuote: message });
  const edit = async (change: Row = {}) => { const instructionQuote = change.operation === "media" ? `${change.mediaOperation === "add" ? "Ajoute" : change.mediaOperation === "remove" ? "Supprime" : "Remplace"} le média de la publication programmée` : "Modifie le texte de la publication programmée", result = await create(instructionQuote).previewScheduledPublicationEdit.execute({ scheduledActionId: ID, edit: { channel: "facebook", operation: "text", post: { title: null, content: "Nouveau contenu", hashtags: null }, mediaId: null, mediaOperation: null, mediaIndex: null, ...change }, instructionQuote }); if (result.token) saved.set(result.reference!, result.token); return result; };
  return { rememberPreview: (p: ActionResult) => saved.set(p.reference!, p.token!), row, rows, deliveries, calls, create, propose, apply, edit, asset, race: () => { race = true; }, uncertain: () => { uncertain = true; }, scope: () => { actor = OTHER; } };
}

test("Basic publish now uses the signed existing manual schedule and never creates a second publication", async () => {
  const h = harness("basic"); Object.assign(h.row, { source: "manual", automation_key: "publish" }); h.row.payload.kind = "manual_publish_schedule";
  const key = h.row.payload.publishPayload.idempotencyKey, preview = await h.propose("publish_now");
  assert.equal(preview.status, "preview_ready"); assert.equal(h.calls.length, 0);
  assert.equal((await h.apply(preview, "oui")).status, "confirmation_required");
  assert.equal((await h.apply(preview)).status, "processing");
  assert.equal((await h.apply(preview)).ok, false, "a fresh tool request cannot repeat a started snapshot");
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].method, "POST"); assert.equal(h.calls[0].body.expectedOperation, "publish_now");
  assert.equal(h.row.payload.publishPayload.idempotencyKey, key); assert.equal(h.row.status, "running");
  const agent = harness(); assert.equal((await agent.propose("publish_now")).status, "blocked", "automatic iNrAgent actions are not the manual publish-now path");
});

test("Basic scheduled CTA changes preserve dates and other post fields and require the exact destination", async () => {
  const h = harness("basic"); Object.assign(h.row, { source: "manual", automation_key: "publish" }); h.row.payload.kind = "manual_publish_schedule";
  const date = h.row.scheduled_at, key = h.row.payload.publishPayload.idempotencyKey;
  const instructionQuote = "Modifie le lien CTA de la publication programmée pour https://atelier.example/contact";
  const edit = { channel: "facebook", operation: "cta", post: { cta: null, ctaMode: "website", ctaUrl: "https://atelier.example/contact", ctaPhone: null, ctaAction: null }, mediaId: null, mediaOperation: null, mediaIndex: null };
  const result = await h.create(instructionQuote).previewScheduledPublicationEdit.execute({ scheduledActionId: ID, edit, instructionQuote });
  assert.equal(result.status, "preview_ready"); assert.equal(h.calls.length, 0);
  h.rememberPreview(result);
  assert.equal((await h.apply(result)).status, "updated");
  const after = editHelper.scheduledPublicationChannelContent(h.row.payload, "facebook").post;
  assert.equal(after.content, "Notre atelier"); assert.equal(after.ctaUrl, "https://atelier.example/contact");
  assert.equal(h.row.scheduled_at, date); assert.equal(h.row.payload.publishPayload.idempotencyKey, key);
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].body.editType, "assistant_manual_publication_edit");
  const wrong = { ...edit, post: { ...edit.post, ctaUrl: "https://unrequested.example" } };
  assert.equal((await h.create(instructionQuote).previewScheduledPublicationEdit.execute({ scheduledActionId: ID, edit: wrong, instructionQuote })).status, "needs_instruction");
  assert.equal(h.calls.length, 1);
});

test("Basic manual schedule text/media edits use signed previews, native CAS and owned assets without publishing", async () => {
  const h = harness("basic"); Object.assign(h.row, { source: "manual", automation_key: "publish" }); h.row.payload.kind = "manual_publish_schedule";
  h.row.payload.publishPayload.postByChannel!.facebook = { content: "Notre atelier", cta: "Conservé", hashtags: ["atelier"] };
  const date = h.row.scheduled_at, preview = await h.edit(); assert.equal(preview.status, "preview_ready"); assert.equal(h.calls.length, 0);
  assert.equal((await h.apply(preview, "oui")).status, "confirmation_required"); assert.equal((await h.apply(preview)).status, "updated"); assert.equal((await h.apply(preview)).status, "updated");
  const post = h.row.payload.publishPayload.postByChannel!.facebook as Row; assert.equal(post.content, "Nouveau contenu"); assert.equal(post.cta, "Conservé"); assert.deepEqual(post.hashtags, ["atelier"]);
  assert.equal(h.row.scheduled_at, date); assert.equal(h.row.payload.publishPayload.idempotencyKey, "stable-native-key"); assert.equal(h.calls.length, 1);
  const media = await h.edit({ operation: "media", post: null, mediaId: OTHER, mediaOperation: "add", mediaIndex: 0 }); assert.equal((await h.apply(media)).status, "updated");
  assert.equal(h.calls[1].body.editType, "assistant_manual_publication_edit"); assert.equal(h.calls.length, 2);
  const remove = await h.edit({ operation: "media", post: null, mediaId: null, mediaOperation: "remove", mediaIndex: 0 }); assert.equal((await h.apply(remove)).status, "updated");
  h.asset.user_id = OTHER; assert.equal((await h.edit({ operation: "media", post: null, mediaId: OTHER, mediaOperation: "replace", mediaIndex: 0 })).status, "unavailable"); assert.equal(h.calls.length, 3);
});
test("scheduled manual edits refuse started rows, iNrAgent rows, and changed media or source snapshots", async () => {
  const h = harness("basic"); Object.assign(h.row, { source: "manual", automation_key: "publish" }); h.row.payload.kind = "manual_publish_schedule";
  const p = await h.edit(); h.row.status = "running"; assert.equal((await h.apply(p)).status, "stale_preview"); assert.equal(h.calls.length, 0);
  h.row.status = "scheduled"; const media = await h.edit({ operation: "media", post: null, mediaId: OTHER, mediaOperation: "replace", mediaIndex: 0 }); h.asset.storage_path = `users/${ACCOUNT}/other.jpg`; assert.equal((await h.apply(media)).status, "stale_preview");
  h.row.payload.editorialPlan = {}; assert.equal((await h.edit()).status, "blocked"); assert.equal(h.calls.length, 0);
});

test("Basic reads and changes only native manual Booster schedules, including at preview and apply time", async () => {
  const h = harness("basic");
  Object.assign(h.row, { source: "manual", automation_key: "publish" });
  Object.assign(h.row.payload, { kind: "manual_publish_schedule" });
  h.rows.push({ ...h.row, id: OTHER, source: "inr_agent", title: "Agent-only" });
  h.rows.push({ ...h.row, id: "invalid-manual", payload: { ...h.row.payload, editorialPlan: {} }, title: "Old agent disguised as manual" });
  const reader = h.create("Liste mes programmations").readScheduledPublications;
  const result = await reader.execute({ scheduledActionId: null, status: "all", offset: 0 });
  assert.deepEqual(result.records?.map(item => item.id), [ID]);
  const preview = await h.propose("reschedule");
  assert.equal(preview.status, "preview_ready");
  assert.equal((await h.apply(preview)).status, "scheduled");
  const second = await h.propose("cancel");
  h.row.payload.editorialPlan = {};
  assert.equal((await h.apply(second)).status, "not_found");
  assert.equal((await reader.execute({ scheduledActionId: ID, status: "all", offset: 0 })).status, "not_found");
  assert.equal(h.calls.length, 1);
});
test("read-only pagination reaches records beyond page one and excludes other accounts and action types", async () => {
  const h = harness(); for (let n = 0; n < 25; n++) h.rows.push({ ...h.row, id: `record-${n}` }); h.rows.push({ ...h.row, user_id: OTHER }, { ...h.row, action_type: "mail" });
  const tool = h.create("Liste mes programmations").readScheduledPublications;
  const first = await tool.execute({ scheduledActionId: null, status: "all", offset: 0 }); assert.ok(first.records); assert.equal(first.records.length, 20); assert.equal(first.nextOffset, 20);
  const next = await tool.execute({ scheduledActionId: null, status: "all", offset: first.nextOffset }); assert.ok(next.records); assert.equal(next.records.length, 6); assert.equal(next.nextOffset, null); assert.equal(h.calls.length, 0);
});
test("rescheduling and cancellation change only native scheduling fields after exact approval and recover without duplication", async () => {
  for (const operation of ["reschedule", "cancel"]) { const h = harness(), content = JSON.stringify(h.row.payload), p = await h.propose(operation); assert.equal(p.status, "preview_ready"); assert.equal(h.calls.length, 0);
    assert.equal((await h.apply(p)).status, operation === "cancel" ? "cancelled" : "scheduled"); assert.equal((await h.apply(p)).ok, true); assert.equal(h.calls.length, 1); assert.equal(JSON.stringify(h.row.payload), content);
  }
});
test("retry uses the existing native publication receipt and never becomes a new publication", async () => {
  const h = harness(); h.row.status = "failed"; h.row.attempt_count = 1; const p = await h.propose("retry");
  assert.equal((await h.apply(p)).status, "processing"); assert.equal(h.calls[0].method, "POST"); assert.deepEqual(Object.keys(h.calls[0].body), ["expectedState"]);
  assert.equal(h.row.payload.publishPayload.idempotencyKey, "stable-native-key"); assert.equal((await h.apply(p)).status, "stale_preview"); assert.equal(h.calls.length, 1);
});

test("a schedule marked done is not publication proof: read-only follow-up checks each selected delivery", async () => {
  const h = harness(); h.row.status = "done"; h.row.payload.lastExecution = { publicationId: OTHER, status: "processing" };
  h.deliveries.push({ user_id: ACCOUNT, publication_id: OTHER, channel: "facebook", status: "processing" });
  const read = () => h.create("Vérifie le statut").readScheduledPublications.execute({ scheduledActionId: ID, status: "all", offset: 0 });
  assert.equal((await read()).status, "processing");
  h.deliveries[0].status = "delivered"; assert.equal((await read()).status, "published");
  h.row.channels.push("linkedin"); assert.equal((await read()).status, "processing");
  h.deliveries.push({ user_id: ACCOUNT, publication_id: OTHER, channel: "linkedin", status: "failed" }); assert.equal((await read()).status, "partial"); assert.equal(h.calls.length, 0);
});
test("exact confirmation, account/actor, unchanged snapshot and native claim all gate execution", async () => {
  const h = harness(), p = await h.propose(); assert.equal((await h.apply(p, "oui")).status, "confirmation_required"); h.scope(); assert.equal((await h.apply(p)).status, "blocked"); assert.equal(h.calls.length, 0);
  const stale = harness(), sp = await stale.propose(); stale.row.payload.changed = true; assert.equal((await stale.apply(sp)).status, "stale_preview"); assert.equal(stale.calls.length, 0);
  const racing = harness(), rp = await racing.propose(); racing.race(); assert.equal((await racing.apply(rp)).status, "stale_preview"); assert.equal(racing.row.status, "running");
});
test("a future or conditional approval never dispatches, cancels or reschedules a publication immediately", async () => {
  for (const operation of ["cancel", "reschedule", "retry"]) {
    for (const suffix of ["seulement si le client accepte", "après ma confirmation", "dans 2 heures"]) {
      const h = harness();
      if (operation === "retry") { h.row.status = "failed"; h.row.attempt_count = 1; }
      const p = await h.propose(operation), before = JSON.stringify(h.row);
      assert.equal((await h.apply(p, `Confirme ${p.reference} ${suffix}`)).status, "confirmation_required", `${operation}: ${suffix}`);
      assert.equal(h.calls.length, 0);
      assert.equal(JSON.stringify(h.row), before);
    }
  }
});

test("an uncertain native commit is recovered from read-back without repeating work; running or attempted schedules cannot be changed", async () => {
  const h = harness(), p = await h.propose(); h.uncertain(); assert.equal((await h.apply(p)).status, "unknown"); assert.equal((await h.apply(p)).status, "cancelled"); assert.equal(h.calls.length, 1);
  for (const patch of [{ status: "running" }, { attempt_count: 1 }, { scheduled_at: new Date(Date.now() - 1000).toISOString() }]) { const blocked = harness(); Object.assign(blocked.row, patch); assert.equal((await blocked.propose()).status, "blocked"); assert.equal(blocked.calls.length, 0); }
});
