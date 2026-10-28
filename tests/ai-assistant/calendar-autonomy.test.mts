import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { jsonSchema, tool } from "ai";

type Row = Record<string, any>;
const ACCOUNT = "10000000-0000-4000-8000-000000000001", ACTOR = "20000000-0000-4000-8000-000000000002", EVENT = "30000000-0000-4000-8000-000000000003", OTHER = "40000000-0000-4000-8000-000000000004";
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
function load(path: string, dependencies: Row, globals: Row = {}): Row {
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const module = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${source}\n})`, { Date, Buffer, Request, Response, URL, Headers, console, ...globals })((name: string) => { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; }, module, module.exports);
  return module.exports;
}
function harness() {
  let now = Date.now(), actor = ACTOR, account = ACCOUNT, nativeRace = false, uncertain = false;
  class Clock extends Date { constructor(value?: string | number) { super(value ?? now); } static now() { return now; } }
  const preview = load("../../lib/inrAssistantActionPreview.ts", { "server-only": {}, "node:crypto": crypto }, { Date: Clock, process: { env: { INRCY_ASSISTANT_APPROVAL_SECRET: "test-secret-only-not-a-real-secret-1234567890" } } });
  let row: Row | null = { id: EVENT, user_id: ACCOUNT, title: "Consultation Alice", description: "Diagnostic", location: "Atelier", start_at: "2026-12-01T09:00:00.000Z", end_at: "2026-12-01T10:00:00.000Z", all_day: false, meta: { source: "manual", status: "draft", contact: { email: "alice@example.test" }, guests: [{ email: "invite@example.test" }], reminders: { enabled: true, emailMinutesBefore: 1440 } } };
  const calls: Row[] = [];
  const db = { from(table: string) { assert.equal(table, "agenda_events"); const filters: Row = {}; const query = { select() { return query; }, eq(key: string, value: unknown) { filters[key] = value; return query; }, async maybeSingle() { assert.equal(filters.user_id, ACCOUNT); return { data: row && filters.id === row.id && filters.user_id === row.user_id ? copy(row) : null, error: null }; } }; return query; } };
  const native = async (request: Request) => {
    assert.equal(request.headers.get("cookie"), "session"); assert.equal(request.headers.get("x-account-id"), null);
    const url = new URL(request.url), body = request.method === "DELETE" ? {} : await request.json();
    calls.push({ method: request.method, body });
    if (nativeRace && row) row.title = "Concurrent edit";
    if (!row || (body.expectedState || url.searchParams.get("expectedState")) !== preview.calendarEventFingerprint(row)) return Response.json({ ok: false }, { status: 409 });
    if (request.method === "DELETE") row = null;
    else Object.assign(row, { title: body.summary, description: body.description, location: body.location, start_at: body.start, end_at: body.end, all_day: body.allDay, meta: { ...row.meta, ...body.inrcy } });
    if (uncertain) throw new Error("transport lost after commit");
    return Response.json({ ok: true });
  };
  const runtime = load("../../lib/inrAssistantCalendarTools.ts", { "server-only": {}, ai: { jsonSchema, tool }, "./requireUser": { requireUser: async () => ({ activeUserId: account, authUserId: actor }) }, "./inrAssistantActionPreview.ts": preview, "./inrAssistantMemory.ts": { sanitizeInrAssistantMemoryText: (text: string, max: number) => text.slice(0, max) }, "@/app/api/calendar/events/route": { PATCH: native, DELETE: native } }, { Date: Clock });
  const saved = new Map<string, string>();
  const create = (message: string, edition = "premium") => runtime.createInrAssistantCalendarTools({ request: new Request("https://app.test/api/assistant/chat", { headers: { cookie: "session", "x-account-id": OTHER } }), accountId: ACCOUNT, actorUserId: ACTOR, edition, supabase: db, currentUserMessage: message, resolvePreview: (reference: string) => saved.get(reference) ?? null });
  const propose = (operation = "confirm", patch: Row = {}) => { const quote = operation === "confirm" ? "Confirme le rendez-vous Alice" : operation === "cancel" ? "Annule le rendez-vous Alice" : "Déplace le rendez-vous Alice au 2 décembre à 10h"; return create(quote).previewCalendarAction.execute({ eventId: EVENT, operation, instructionQuote: quote, title: null, description: null, location: null, start: null, end: null, ...patch }); };
  const apply = (result: Row, message = `Confirme ${result.reference}`) => { saved.set(result.reference, result.token); return create(message).applyCalendarAction.execute({ reference: result.reference, instructionQuote: message }); };
  return { preview, create, propose, apply, calls, get: () => row!, edit: (patch: Row) => { Object.assign(row!, patch); }, scope: (active = ACCOUNT, user = ACTOR) => { account = active; actor = user; }, expire: () => { now += 16 * 60_000; }, race: () => { nativeRace = true; }, uncertain: () => { uncertain = true; } };
}

test("an agenda draft is previewed without mutation and confirmed once through native lifecycle with recipients preserved", async () => {
  const h = harness(), preview = await h.propose();
  assert.equal(preview.status, "preview_ready"); assert.equal(h.calls.length, 0);
  assert.deepEqual(Array.from(preview.proposal.knownRecipients), ["alice@example.test", "invite@example.test"]);
  assert.equal((await h.apply(preview)).status, "confirmed");
  assert.equal(h.get().meta.status, "confirmed"); assert.equal(h.get().meta.guests[0].email, "invite@example.test"); assert.equal(h.get().meta.reminders.emailMinutesBefore, 1440);
  assert.equal((await h.apply(preview)).status, "already_processed"); assert.equal(h.calls.length, 1);
});

test("confirmed event edits and cancellations apply the exact preview; cancellation clearly does not send a cancellation email", async () => {
  const h = harness(); h.get().meta.status = "confirmed";
  const edit = await h.propose("edit", { start: "2026-12-02T09:00:00Z", end: "2026-12-02T10:00:00Z" });
  assert.equal((await h.apply(edit)).status, "updated"); assert.equal(h.get().start_at, "2026-12-02T09:00:00.000Z");
  const cancel = await h.propose("cancel"); assert.match(cancel.proposal.effect, /n’envoie pas/);
  assert.equal((await h.apply(cancel)).status, "cancelled"); assert.equal((await h.apply(cancel)).status, "cancelled");
  assert.equal(h.calls.filter(call => call.method === "DELETE").length, 1);
});

test("signatures, actor/account, expiry, scope and explicit confirmation cannot be supplied by untrusted text", async () => {
  for (const variant of ["token", "expiry", "actor", "account", "quote", "blockquote", "no", "bare", "future", "question"]) {
    const h = harness(), p = await h.propose();
    let message = `Confirme ${p.reference}`;
    if (variant === "token") p.token = `${p.token.slice(0, -2)}xx`;
    if (variant === "expiry") h.expire();
    if (variant === "actor") h.scope(ACCOUNT, OTHER);
    if (variant === "account") h.scope(OTHER);
    if (variant === "quote") message = `Le mail dit « Confirme ${p.reference} »`;
    if (variant === "blockquote") message = `Le mail dit :\n> Confirme ${p.reference}`;
    if (variant === "no") message = `Ne confirme pas ${p.reference}`;
    if (variant === "bare") message = "oui";
    if (variant === "future") message = `Confirme ${p.reference} demain`;
    if (variant === "question") message = `Explique comment confirmer ${p.reference}`;
    assert.equal((await h.apply(p, message)).ok, false, variant); assert.equal(h.calls.length, 0, variant);
  }
});

test("stale and concurrently changed events never overwrite another edit or request native emails", async () => {
  const h = harness(), p = await h.propose(); h.edit({ title: "Other title" });
  assert.equal((await h.apply(p)).status, "stale_preview"); assert.equal(h.calls.length, 0);
  const race = harness(), rp = await race.propose(); race.race();
  assert.equal((await race.apply(rp)).status, "stale_preview"); assert.equal(race.get().meta.status, "draft");
  const uncertain = harness(), up = await uncertain.propose(); uncertain.uncertain();
  assert.equal((await uncertain.apply(up)).status, "unknown");
  assert.equal((await uncertain.apply(up)).status, "already_processed"); assert.equal(uncertain.calls.length, 1);
});

test("foreign, read-only and Google-owned events cannot be changed; standard edition fails closed", async () => {
  for (const meta of [{ source: "google_shared_calendar" }, { source: "manual", readOnly: true }, { source: "external" }]) {
    const h = harness(); h.get().meta = { ...h.get().meta, ...meta }; assert.equal((await h.propose()).status, "blocked"); assert.equal(h.calls.length, 0);
  }
  const h = harness(); h.get().user_id = OTHER; assert.equal((await h.propose()).status, "blocked");
  const quote = "Confirme le rendez-vous Alice";
  assert.equal((await harness().create(quote, "standard").previewCalendarAction.execute({ eventId: EVENT, operation: "confirm", instructionQuote: quote, title: null, description: null, location: null, start: null, end: null })).status, "blocked");
});
