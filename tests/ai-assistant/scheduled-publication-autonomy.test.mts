import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { jsonSchema, tool } from "ai";
type Row = Record<string, unknown>;
type ScheduledRow = Row & { id: string; user_id: string; action_type: string; status: string; attempt_count: number; scheduled_at: string; timezone: string; updated_at: string; channels: string[]; payload: Row & { publishPayload: { postByChannel?: Row; idempotencyKey: string }; lastExecution?: { publicationId: string; status: string } } };
type ActionResult = Row & { ok: boolean; status: string; reference?: string; token?: string; records?: Row[]; nextOffset?: number | null };
type ScheduledRuntime = { createInrAssistantScheduledPublicationTools(options: unknown): Record<"readScheduledPublications" | "previewScheduledPublicationAction" | "applyScheduledPublicationAction", { execute(input: unknown): Promise<ActionResult> }> };
const ACCOUNT = "10000000-0000-4000-8000-000000000001", ACTOR = "20000000-0000-4000-8000-000000000002", ID = "30000000-0000-4000-8000-000000000003", OTHER = "40000000-0000-4000-8000-000000000004";
function load<T>(path: string, deps: Row, globals: Row = {}): T { const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText; const loadedModule = { exports: {} }; vm.runInNewContext(`(function(require,module,exports){${source}\n})`, { Date, Intl, Buffer, Request, Response, URL, Headers, ...globals })((key: string) => { assert.ok(Object.hasOwn(deps, key), key); return deps[key]; }, loadedModule, loadedModule.exports); return loadedModule.exports as T; }
function harness() {
  const account = ACCOUNT;
  let actor = ACTOR, race = false, uncertain = false;
  const helper = load<typeof import("../../lib/inrAssistantActionPreview.ts")>("../../lib/inrAssistantActionPreview.ts", { "server-only": {}, "node:crypto": crypto }, { process: { env: { INRCY_ASSISTANT_APPROVAL_SECRET: "unit-test-signing-key-for-previews-only-12345" } } });
  const row: ScheduledRow = { id: ID, user_id: ACCOUNT, action_type: "publication", target_tool: "booster", title: "Atelier", summary: "Résumé", status: "scheduled", scheduled_at: new Date(Date.now() + 86400_000).toISOString(), timezone: "Europe/Paris", channels: ["facebook"], attempt_count: 0, executed_at: null, updated_at: new Date().toISOString(), payload: { publishPayload: { postByChannel: { facebook: { content: "Notre atelier" } }, idempotencyKey: "stable-native-key" } } };
  const rows = [row], deliveries: Row[] = [], calls: Array<{ body: Row; method: string }> = [], saved = new Map<string, string>();
  const db = { from(table: string) { assert.ok(["inr_agent_scheduled_actions", "publication_deliveries"].includes(table)); const filters: Row = {}; let from = 0, to = 999; const result = () => { assert.equal(filters.user_id, ACCOUNT); return (table === "publication_deliveries" ? deliveries : rows).filter(item => Object.entries(filters).every(([key, val]) => item[key] === val)).slice(from, to + 1).map(item => JSON.parse(JSON.stringify(item))); }; const q = { select() { return q; }, eq(key: string, value: unknown) { filters[key] = value; return q; }, order() { return q; }, range(a: number, b: number) { from = a; to = b; return q; }, limit(n: number) { to = n - 1; return q; }, async maybeSingle() { return { data: result()[0] ?? null, error: null }; }, then(resolve: (v: unknown) => unknown) { return Promise.resolve({ data: result(), error: null }).then(resolve); } }; return q; } };
  const native = async (request: Request, context: { params: Promise<{ id: string }> }) => { assert.equal((await context.params).id, ID); assert.equal(request.headers.get("cookie"), "session"); assert.equal(request.headers.get("x-account-id"), null); const body = await request.json(); calls.push({ body, method: request.method }); if (race) row.status = "running"; if (body.expectedState !== helper.scheduledPublicationFingerprint(row)) return Response.json({}, { status: 409 }); if (request.method === "POST") { row.status = "running"; row.attempt_count++; } else if (body.status) row.status = body.status; else { row.scheduled_at = body.scheduledAt; row.timezone = body.timezone; } row.updated_at = new Date(Date.now() + 1).toISOString(); if (uncertain) throw new Error("unknown after native commit"); return Response.json({ ok: true }); };
  const runtime = load<ScheduledRuntime>("../../lib/inrAssistantScheduledPublicationTools.ts", { "server-only": {}, ai: { jsonSchema, tool }, "./requireUser": { requireUser: async () => ({ activeUserId: account, authUserId: actor }) }, "./inrAssistantActionPreview.ts": helper, "./inrAssistantMemory.ts": { sanitizeInrAssistantMemoryText: (s: string, max: number) => s.slice(0, max) }, "@/app/api/agent/scheduled-actions/[id]/route": { PATCH: native }, "@/app/api/agent/scheduled-actions/[id]/execute/route": { POST: native } });
  const create = (message: string) => runtime.createInrAssistantScheduledPublicationTools({ request: new Request("https://app.test/api/assistant/chat", { headers: { cookie: "session", "x-account-id": OTHER } }), accountId: ACCOUNT, actorUserId: ACTOR, edition: "premium", supabase: db, currentUserMessage: message, resolvePreview: (ref: string) => saved.get(ref) ?? null });
  const propose = async (operation = "cancel") => { const quote = operation === "cancel" ? "Annule la publication programmée" : operation === "retry" ? "Reprends la publication échouée" : "Reprogramme la publication à demain"; const result = await create(quote).previewScheduledPublicationAction.execute({ scheduledActionId: ID, operation, scheduledAt: operation === "reschedule" ? new Date(Date.now() + 2 * 86400_000).toISOString() : null, timezone: operation === "reschedule" ? "Europe/Paris" : null, instructionQuote: quote }); if (result.token) { assert.ok(result.reference); saved.set(result.reference, result.token); } return result; };
  const apply = (p: ActionResult, message = `Confirme ${p.reference}`) => create(message).applyScheduledPublicationAction.execute({ reference: p.reference, instructionQuote: message });
  return { row, rows, deliveries, calls, create, propose, apply, race: () => { race = true; }, uncertain: () => { uncertain = true; }, scope: () => { actor = OTHER; } };
}
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
test("an uncertain native commit is recovered from read-back without repeating work; running or attempted schedules cannot be changed", async () => {
  const h = harness(), p = await h.propose(); h.uncertain(); assert.equal((await h.apply(p)).status, "unknown"); assert.equal((await h.apply(p)).status, "cancelled"); assert.equal(h.calls.length, 1);
  for (const patch of [{ status: "running" }, { attempt_count: 1 }, { scheduled_at: new Date(Date.now() - 1000).toISOString() }]) { const blocked = harness(); Object.assign(blocked.row, patch); assert.equal((await blocked.propose()).status, "blocked"); assert.equal(blocked.calls.length, 0); }
});
