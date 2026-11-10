import * as requestClauses from "../../lib/inrAssistantRequestClauses.ts";
import * as actionClauses from "../../lib/inrAssistantActionClause.ts";
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { jsonSchema, tool } from "ai";

type Row = Record<string, unknown>;
type CalendarRow = Row & { id: string; user_id: string; title: string; description: string; location: string; start_at: string; end_at: string; all_day: boolean; meta: Row & { source: string; status: string; contact: { email: string }; guests: Array<{ email: string }>; reminders: { enabled: boolean; emailMinutesBefore: number } } };
type ActionResult = Row & { ok: boolean; status: string; reference?: string; token?: string; proposal?: { knownRecipients: string[]; effect: string } };
type CalendarRuntime = { createInrAssistantCalendarTools(options: unknown): Record<"previewCalendarAction" | "applyCalendarAction", { execute(input: unknown): Promise<ActionResult> }> };
const ACCOUNT = "10000000-0000-4000-8000-000000000001", ACTOR = "20000000-0000-4000-8000-000000000002", EVENT = "30000000-0000-4000-8000-000000000003", OTHER = "40000000-0000-4000-8000-000000000004";
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
function load<T>(path: string, dependencies: Row, globals: Row = {}): T {
  const source = ts.transpileModule(readFileSync(new URL(path, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loadedModule = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${source}\n})`, { Date, Buffer, Request, Response, URL, Headers, console, ...globals })((name: string) => { assert.ok(Object.hasOwn(dependencies, name), name); return dependencies[name]; }, loadedModule, loadedModule.exports);
  return loadedModule.exports as T;
}
function harness() {
  let now = Date.now(), actor = ACTOR, account = ACCOUNT, nativeRace = false, uncertain = false;
  class Clock extends Date { constructor(value?: string | number) { super(value ?? now); } static now() { return now; } }
  const preview = load<typeof import("../../lib/inrAssistantActionPreview.ts")>("../../lib/inrAssistantActionPreview.ts", { "server-only": {}, "node:crypto": crypto, "./inrAssistantRequestClauses.ts": requestClauses }, { Date: Clock, process: { env: { INRCY_ASSISTANT_APPROVAL_SECRET: "test-secret-only-not-a-real-secret-1234567890" } } });
  let row: CalendarRow | null = { id: EVENT, user_id: ACCOUNT, title: "Consultation Alice", description: "Diagnostic", location: "Atelier", start_at: "2026-12-01T09:00:00.000Z", end_at: "2026-12-01T10:00:00.000Z", all_day: false, meta: { source: "manual", status: "draft", contact: { email: "alice@example.test" }, guests: [{ email: "invite@example.test" }], reminders: { enabled: true, emailMinutesBefore: 1440 } } };
  const calls: Row[] = [];
  const mailbox = { id: OTHER, user_id: ACCOUNT, category: "mail", status: "connected", account_email: "pro@example.test" };
  const db = { from(table: string) { assert.ok(["agenda_events", "integrations"].includes(table)); const filters: Row = {}; const query = { select() { return query; }, eq(key: string, value: unknown) { filters[key] = value; return query; }, async maybeSingle() { assert.equal(filters.user_id, ACCOUNT); const source = table === "integrations" ? mailbox : row; return { data: source && filters.id === source.id && filters.user_id === source.user_id ? copy(source) : null, error: null }; } }; return query; } };
  const native = async (request: Request) => {
    assert.equal(request.headers.get("cookie"), "session"); assert.equal(request.headers.get("x-account-id"), null);
    const url = new URL(request.url), body = request.method === "DELETE" ? {} : await request.json();
    calls.push({ method: request.method, body });
    if (nativeRace && row) row.title = "Concurrent edit";
    if (!row || (body.expectedState || url.searchParams.get("expectedState")) !== preview.calendarEventFingerprint(row)) return Response.json({ ok: false }, { status: 409 });
    if (request.method === "DELETE") row = null;
    else if (body.action === "reject") row.meta = { ...row.meta, status: "rejected", assistantConfirmedAction: body.approvalReference };
    else Object.assign(row, { title: body.summary, description: body.description, location: body.location, start_at: body.start, end_at: body.end, all_day: body.allDay, meta: { ...row.meta, ...body.inrcy } });
    if (uncertain) throw new Error("transport lost after commit");
    return Response.json({ ok: true });
  };
  const runtime = load<CalendarRuntime>("../../lib/inrAssistantCalendarTools.ts", { "server-only": {}, ai: { jsonSchema, tool }, "./requireUser": { requireUser: async () => ({ activeUserId: account, authUserId: actor }) }, "./inrAssistantRequestClauses.ts": requestClauses, "./inrAssistantActionClause.ts": actionClauses, "./inrAssistantActionPreview.ts": preview, "./inrAssistantMemory.ts": { sanitizeInrAssistantMemoryText: (text: string, max: number) => text.slice(0, max) }, "@/app/api/calendar/events/route": { PATCH: native, DELETE: native }, "@/app/api/calendar/appointment-requests/route": { PATCH: native } }, { Date: Clock });
  const saved = new Map<string, string>();
  const create = (message: string, edition = "premium", currentApprovalMessage?: string) => runtime.createInrAssistantCalendarTools({ request: new Request("https://app.test/api/assistant/chat", { headers: { cookie: "session", "x-account-id": OTHER } }), accountId: ACCOUNT, actorUserId: ACTOR, edition, supabase: db, currentUserMessage: message, currentApprovalMessage, resolvePreview: (reference: string) => saved.get(reference) ?? null });
  const propose = (operation = "confirm", patch: Row = {}) => { const quote = operation === "confirm" ? "Confirme le rendez-vous Alice" : operation === "cancel" ? "Annule le rendez-vous Alice" : "Déplace le rendez-vous Alice au 2 décembre à 10h"; return create(quote).previewCalendarAction.execute({ eventId: EVENT, operation, instructionQuote: quote, title: null, description: null, location: null, start: null, end: null, ...patch }); };
  const apply = (result: ActionResult, message = `Confirme ${result.reference}`, currentApprovalMessage?: string, quote = currentApprovalMessage ?? message) => { assert.ok(result.reference); assert.ok(result.token); saved.set(result.reference, result.token); return create(message, "premium", currentApprovalMessage).applyCalendarAction.execute({ reference: result.reference, instructionQuote: quote }); };
  return { preview, create, propose, apply, calls, mailbox, get: () => row!, edit: (patch: Row) => { Object.assign(row!, patch); }, scope: (active = ACCOUNT, user = ACTOR) => { account = active; actor = user; }, expire: () => { now += 16 * 60_000; }, race: () => { nativeRace = true; }, uncertain: () => { uncertain = true; } };
}

test("an agenda draft is previewed without mutation and confirmed once through native lifecycle with recipients preserved", async () => {
  const h = harness(), preview = await h.propose();
  assert.equal(preview.status, "preview_ready"); assert.equal(h.calls.length, 0);
  assert.ok(preview.proposal);
  assert.deepEqual(Array.from(preview.proposal.knownRecipients), ["alice@example.test", "invite@example.test"]);
  assert.equal((await h.apply(preview)).status, "confirmed");
  assert.equal(h.get().meta.status, "confirmed"); assert.equal(h.get().meta.guests[0].email, "invite@example.test"); assert.equal(h.get().meta.reminders.emailMinutesBefore, 1440);
  assert.equal((await h.apply(preview)).status, "already_processed"); assert.equal(h.calls.length, 1);
});

test("confirmed event edits and cancellations apply the exact preview; cancellation clearly does not send a cancellation email", async () => {
  const h = harness(); h.get().meta.status = "confirmed";
  const edit = await h.propose("edit", { start: "2026-12-02T09:00:00Z", end: "2026-12-02T10:00:00Z" });
  assert.equal((await h.apply(edit)).status, "updated"); assert.equal(h.get().start_at, "2026-12-02T09:00:00.000Z");
  const cancel = await h.propose("cancel"); assert.ok(cancel.proposal); assert.match(cancel.proposal.effect, /n’envoie pas/);
  assert.equal((await h.apply(cancel)).status, "cancelled"); assert.equal((await h.apply(cancel)).status, "cancelled");
  assert.equal(h.calls.filter(call => call.method === "DELETE").length, 1);
});

test("an independent calendar edit plus explanation prepares its exact signed preview before any mutation", async () => {
  const h = harness(); h.get().meta.status = "confirmed";
  const quote = "Déplace le rendez-vous Alice au 2 décembre de 10h à 11h";
  const result = await h.create(`${quote}. Explique ensuite quels rappels restent activés.`).previewCalendarAction.execute({
    eventId: EVENT, operation: "edit", instructionQuote: quote, title: null, description: null, location: null,
    start: "2026-12-02T09:00:00Z", end: "2026-12-02T10:00:00Z", addGuestEmails: null, remindersEnabled: null, reminderMailboxId: null,
  });
  assert.equal(result.status, "preview_ready"); assert.equal(h.calls.length, 0);
  assert.equal(h.get().start_at, "2026-12-01T09:00:00.000Z");
  assert.equal((await h.apply(result)).status, "updated");
  assert.equal(h.get().start_at, "2026-12-02T09:00:00.000Z");
  assert.equal(h.get().meta.reminders.enabled, true);
  assert.equal(h.get().meta.reminders.emailMinutesBefore, 1440);
});

test("calendar explanation fallback retains hypothetical, denied and named approval boundaries", async () => {
  const quote = "Déplace le rendez-vous Alice au 2 décembre de 10h à 11h";
  for (const message of [
    `Si Julie confirme, ${quote}. Explique ensuite les rappels.`,
    `${quote} après validation de Julie. Explique ensuite les rappels.`,
    `Imagine que nous changeons l’agenda. ${quote}. Explique ensuite les rappels.`,
    `Ne déplace pas ce rendez-vous. ${quote}. Explique ensuite les rappels.`,
    `Le client dit « ${quote} ». Explique sa demande.`,
  ]) {
    const h = harness();
    const result = await h.create(message).previewCalendarAction.execute({ eventId: EVENT, operation: "edit", instructionQuote: quote,
      title: null, description: null, location: null, start: "2026-12-02T09:00:00Z", end: "2026-12-02T10:00:00Z", addGuestEmails: null, remindersEnabled: null, reminderMailboxId: null });
    assert.equal(result.status, "needs_instruction", message); assert.equal(h.calls.length, 0, message);
  }
});

test("signatures, actor/account, expiry, scope and explicit confirmation cannot be supplied by untrusted text", async () => {
  for (const variant of ["token", "expiry", "actor", "account", "quote", "blockquote", "no", "bare", "future", "question"]) {
    const h = harness(), p = await h.propose();
    let message = `Confirme ${p.reference}`;
    if (variant === "token") { assert.ok(p.token); p.token = `${p.token.slice(0, -2)}xx`; }
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

test("conditional or delayed approvals never call the native agenda mutation, even when the tool quotes only the affirmative fragment", async () => {
  for (const suffix of ["seulement si le client accepte", "après ma confirmation", "dans 2 heures", "à 15h", "vendredi", "quand le client aura répondu", "sous réserve de son accord"]) {
    const h = harness(), p = await h.propose(), quote = `Confirme ${p.reference}`, message = `${quote} ${suffix}.`;
    assert.equal((await h.apply(p, message, undefined, quote)).status, "confirmation_required", suffix);
    assert.equal(h.calls.length, 0, suffix);
    assert.equal(h.get().meta.status, "draft", suffix);
  }
  const h = harness(), p = await h.propose(), quote = `Confirme ${p.reference}`;
  assert.equal((await h.apply(p, `Si le client accepte, ${quote}`, undefined, quote)).status, "confirmation_required");
  assert.equal(h.calls.length, 0);
});

test("an immediate approval may ask a separate conditional read and does not inherit tomorrow from the original scheduling request", async () => {
  const h = harness(), p = await h.propose(), approval = `Confirme ${p.reference} et indique si les rappels sont activés.`;
  assert.equal((await h.apply(p, `Déplace le rendez-vous demain à 14h.\nValidation actuelle de cet aperçu uniquement : ${approval}`, approval)).status, "confirmed");
  assert.equal(h.calls.length, 1);
  const negative = harness(), np = await negative.propose(), quote = `Confirme ${np.reference}`;
  assert.equal((await negative.apply(np, `${quote} et indique si les rappels sont activés, mais ne confirme pas encore.`, undefined, quote)).status, "confirmation_required");
  assert.equal(negative.calls.length, 0);
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

const editInput = (instructionQuote: string, patch: Row = {}) => ({ eventId: EVENT, operation: "edit", instructionQuote, title: null, description: null, location: null, start: null, end: null, addGuestEmails: null, remindersEnabled: null, reminderMailboxId: null, ...patch });
test("explicit guests append once and event reminder changes retain all existing metadata", async () => {
  const h = harness(), quote = "Ajoute nouveau@example.test et invite@example.test aux invités du rendez-vous Alice et désactive ses rappels";
  h.get().meta.guests.push({ email: "autre@example.test", crmContactId: OTHER } as { email: string });
  const p = await h.create(quote).previewCalendarAction.execute(editInput(quote, { addGuestEmails: ["nouveau@example.test", "invite@example.test"], remindersEnabled: false }));
  assert.equal(p.status, "preview_ready"); assert.ok(p.proposal?.knownRecipients.includes("nouveau@example.test"));
  assert.equal((await h.apply(p)).status, "updated");
  assert.deepEqual(h.get().meta.guests, [{ email: "invite@example.test" }, { email: "autre@example.test", crmContactId: OTHER }, { email: "nouveau@example.test", display_name: "nouveau@example.test" }]);
  assert.equal(h.get().meta.reminders.enabled, false); assert.equal(h.get().meta.reminders.emailMinutesBefore, 1440);
  assert.equal((await h.apply(p)).status, "already_processed"); assert.equal(h.calls.length, 1);
});

test("reminder mailbox must be explicitly named, connected and owned; no invented guest or quoted command", async () => {
  const quote = "Change la boîte des rappels du rendez-vous Alice pour pro@example.test";
  for (const variant of ["ok", "foreign", "disconnected", "unmentioned", "unrequested", "guest", "quoted", "negative", "basic"]) {
    const h = harness(); let message = quote, input = editInput(quote, { reminderMailboxId: OTHER });
    if (variant === "foreign") h.mailbox.user_id = OTHER;
    if (variant === "disconnected") h.mailbox.status = "expired";
    if (variant === "unmentioned") h.mailbox.account_email = "secret@example.test";
    if (variant === "unrequested") input = editInput(quote, { remindersEnabled: false });
    if (variant === "guest") input = editInput(quote, { addGuestEmails: ["invented@example.test"] });
    if (variant === "quoted") message = `Le message dit « ${quote} »`;
    if (variant === "negative") message = `Ne change pas la boîte. ${quote}`;
    const p = await h.create(message, variant === "basic" ? "basic" : "premium").previewCalendarAction.execute(input);
    if (variant === "ok") { assert.equal(p.status, "preview_ready"); assert.equal((await h.apply(p)).status, "updated"); assert.equal((h.get().meta.reminders as unknown as Row).mailAccountId, OTHER); }
    else { assert.equal(p.ok, false, variant); assert.equal(h.calls.length, 0, variant); }
  }
});

test("rejecting a client request uses its native notification path, preserves it and cannot replay", async () => {
  const h = harness(), quote = "Refuse la demande de rendez-vous Alice";
  h.get().meta.source = "inrbadge"; h.get().meta.status = "pending";
  const p = await h.create(quote).previewCalendarAction.execute({ ...editInput(quote), operation: "reject" });
  assert.equal(p.status, "preview_ready"); assert.match(p.proposal!.effect, /mail de refus/);
  assert.equal((await h.apply(p)).status, "rejected"); assert.equal(h.get().meta.status, "rejected");
  assert.equal((await h.apply(p)).status, "already_processed"); assert.equal(h.calls.length, 1);
  const other = harness(); assert.equal((await other.create(quote).previewCalendarAction.execute({ ...editInput(quote), operation: "reject" })).ok, false);
  const move = harness(), tomorrow = "Déplace le rendez-vous Alice demain à 10h";
  assert.equal((await move.create(tomorrow).previewCalendarAction.execute(editInput(tomorrow, { start: "2026-12-02T09:00:00Z", end: "2026-12-02T10:00:00Z" }))).status, "preview_ready");
});
