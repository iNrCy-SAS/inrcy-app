import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { asSchema, jsonSchema, tool } from "ai";
import type * as Communication from "../../lib/inrAssistantCommunicationTools.ts";
import type * as Memory from "../../lib/inrAssistantMemory.ts";

type Row = Record<string, unknown>;
const ACCOUNT = "10000000-0000-4000-8000-000000000001", OTHER = "20000000-0000-4000-8000-000000000002";
const ACTOR = "30000000-0000-4000-8000-000000000003", DRAFT = "40000000-0000-4000-8000-000000000004";
const MAILBOX = "50000000-0000-4000-8000-000000000005", EVENT = "60000000-0000-4000-8000-000000000006";
const CAMPAIGN = "70000000-0000-4000-8000-000000000007", TURN = `${ACCOUNT}_80000000-0000-4000-8000-000000000008`;
const RECIPIENT = "destinataire@example.test";
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
function fixtureDraft(): Row { return { id: DRAFT, user_id: ACCOUNT, type: "mail", status: "draft", subject: "Offre toiture", body_text: "Texte initial du brouillon.", body_html: "<p>Texte initial du brouillon.</p>", to_emails: "ancien@example.test", integration_id: MAILBOX, provider: "gmail", folder: "propulsions", track_kind: "propulser", track_type: "promo_mail", template_key: "offer-template", attachments: [{ bucket: "pro-media", path: `${ACCOUNT}/piece.pdf`, name: "piece.pdf", type: "application/pdf" }], draft_state: { aiEngine: "openai", stage: "compose", recipientHints: [{ email: "ancien@example.test" }], trackPayload: { existingMarker: "keep" } }, updated_at: "2026-10-26T12:00:00.000Z" }; }
function fixtureEvent(): Row { return { id: EVENT, user_id: ACCOUNT, title: "Rendez-vous toiture", description: "Visite technique", location: "Atelier", start_at: "2026-12-01T09:00:00.000Z", end_at: "2026-12-01T10:00:00.000Z", all_day: false, meta: { status: "draft", source: "manual", guests: [{ email: "PRIVATE GUEST" }], reminders: { enabled: true, untouched: "keep" } } }; }
function harness(options: { edition?: "standard" | "premium" | "founder"; message?: string; nativeStatus?: number; nativePaused?: boolean; throwAfterDispatchCommit?: boolean; scopeChangeOnAuth?: number; actorChanged?: boolean; unfilteredRows?: boolean; readErrorTable?: string; readNeverTable?: string; canStartWork?: boolean } = {}) {
  const rows: Record<string, Row[]> = { send_items: [fixtureDraft()], agenda_events: [fixtureEvent()], mail_campaigns: [], inr_agent_scheduled_actions: [] };
  const queries: Array<{ table: string; select: string; filters: Array<[string, string, unknown]>; limit: number | null }> = [];
  const apiCalls: Array<{ path: string; body: Row; headers: Headers }> = [];
  let authCalls = 0;
  const db = { from(table: string) {
    assert.ok(Object.hasOwn(rows, table), `No arbitrary table is permitted: ${table}`);
    const query = { table, select: "", filters: [] as Array<[string, string, unknown]>, limit: null as number | null };
    queries.push(query);
    const includes = (current: unknown, expected: unknown): boolean => expected && typeof expected === "object"
      ? Object.entries(expected).every(([key, value]) => includes(current && typeof current === "object" ? (current as Row)[key] : undefined, value)) : current === expected;
    const result = (single = false) => {
      assert.ok(query.filters.some(([operator, field, value]) => operator === "eq" && field === "user_id" && value === ACCOUNT), "Every read must enforce the active account in SQL");
      if (options.readNeverTable === table) return new Promise<never>(() => {});
      if (options.readErrorTable === table) return Promise.resolve({ data: null, error: { code: "PRIVATE DB ERROR", token: "PRIVATE TOKEN" } });
      let selected = options.unfilteredRows ? rows[table] : rows[table].filter(row => query.filters.every(([operator, field, value]) => operator === "eq" ? row[field] === value : operator === "neq" ? row[field] !== value : operator === "contains" ? includes(row[field], value) : operator === "ilike" ? String(row[field]).toLowerCase().includes(String(value).replaceAll("%", "").toLowerCase()) : operator === "lt" ? String(row[field]) < String(value) : String(row[field]) > String(value)));
      if (query.limit) selected = selected.slice(0, query.limit);
      return Promise.resolve({ data: clone(single ? selected[0] ?? null : selected), error: null });
    };
    const builder = {
      select(value: string) { query.select = value; return builder; },
      eq(field: string, value: unknown) { query.filters.push(["eq", field, value]); return builder; },
      neq(field: string, value: unknown) { query.filters.push(["neq", field, value]); return builder; },
      contains(field: string, value: unknown) { query.filters.push(["contains", field, value]); return builder; },
      ilike(field: string, value: unknown) { query.filters.push(["ilike", field, value]); return builder; },
      lt(field: string, value: unknown) { query.filters.push(["lt", field, value]); return builder; },
      gt(field: string, value: unknown) { query.filters.push(["gt", field, value]); return builder; },
      order() { return builder; }, limit(value: number) { query.limit = value; return builder; },
      maybeSingle() { return result(true); }, then(resolve: (value: unknown) => unknown, reject?: (error: unknown) => unknown) { return result().then(resolve, reject); },
      insert() { assert.fail("All mutations must use existing authenticated handlers"); }, update() { assert.fail("No direct database mutation from assistant"); }, delete() { assert.fail("Deletion is not exposed"); },
    };
    return builder;
  } };
  const native = async (request: Request): Promise<Response> => {
    const path = new URL(request.url).pathname, body = await request.json() as Row;
    assert.equal(new URL(request.url).origin, "https://app.inrcy.com");
    assert.equal(request.headers.get("cookie"), "trusted-session-cookie"); assert.equal(request.headers.get("authorization"), "Bearer trusted-session-token");
    assert.equal(request.headers.get("x-cron-user-id"), null); assert.equal(request.headers.get("x-account-id"), null);
    apiCalls.push({ path, body, headers: request.headers });
    if (options.nativeStatus) return Response.json({ error: "PRIVATE NATIVE ERROR STACK AND TOKEN" }, { status: options.nativeStatus });
    if (path === "/api/mails/workflow-draft") {
      const row = rows.send_items.find(item => item.id === body.draftId)!;
      row.subject = body.subject; row.body_text = body.bodyText; row.body_html = body.bodyHtml; row.to_emails = body.toEmails;
      row.draft_state = { ...(row.draft_state as Row), trackPayload: body.trackPayload };
      return Response.json({ draftId: body.draftId });
    }
    if (path === "/api/crm/campaigns") {
      const status = options.nativePaused ? "paused" : "queued";
      rows.mail_campaigns.push({ id: CAMPAIGN, user_id: ACCOUNT, status, metadata: body.metadata, total_count: (body.recipients as unknown[]).length });
      if (options.throwAfterDispatchCommit) throw new Error("PRIVATE transport error after dispatch was committed");
      return Response.json({ success: true, campaignId: CAMPAIGN, campaignStatus: status, queued: (body.recipients as unknown[]).length, token: "PRIVATE TOKEN", domainAuthentication: { secret: "PRIVATE DNS" } });
    }
    if (path === "/api/agent/scheduled-actions") {
      const record = { id: body.scheduleRequestId, user_id: ACCOUNT, status: "scheduled", payload: body.payload };
      rows.inr_agent_scheduled_actions.push(record);
      return Response.json({ scheduledAction: record });
    }
    if (path === "/api/calendar/events") {
      assert.equal(request.method, "PATCH"); assert.equal(new URL(request.url).searchParams.get("id"), EVENT);
      assert.equal(body.requireDraft, true);
      const row = rows.agenda_events[0]; row.title = body.summary; row.start_at = body.start; row.end_at = body.end;
      row.meta = { ...(row.meta as Row), ...(body.inrcy as Row) };
      return Response.json({ ok: true });
    }
    assert.fail(`Unexpected native endpoint ${path}`);
  };
  const common: Record<string, unknown> = {
    "server-only": {}, "node:crypto": { createHash, randomUUID }, ai: { tool, jsonSchema },
    "./requireUser": { requireUser: async () => { authCalls++; return { errorResponse: null, activeUserId: options.scopeChangeOnAuth && authCalls >= options.scopeChangeOnAuth ? OTHER : ACCOUNT, authUserId: options.actorChanged ? OTHER : ACTOR }; } },
    "@/app/api/mails/workflow-draft/route": { POST: native }, "@/app/api/crm/campaigns/route": { POST: native },
    "@/app/api/agent/scheduled-actions/route": { POST: native }, "@/app/api/calendar/events/route": { PATCH: native },
  };
  const load = (path: string) => {
    const compiled = ts.transpileModule(readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const moduleRecord = { exports: {} };
    vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, { Request, Response, Headers, URL, Date, Intl, TextEncoder, setTimeout, clearTimeout, console, fetch() { assert.fail("No external network, provider, email or paid AI call is permitted"); } })((name: string) => {
      assert.ok(Object.hasOwn(common, name), `Unexpected dependency ${name}`); return common[name];
    }, moduleRecord, moduleRecord.exports);
    return moduleRecord.exports;
  };
  common["./inrAssistantMemory.ts"] = load("lib/inrAssistantMemory.ts") as typeof Memory;
  const runtime = load("lib/inrAssistantCommunicationTools.ts") as typeof Communication;
  const source = new Request("https://app.inrcy.com/api/assistant/chat", { headers: { cookie: "trusted-session-cookie", authorization: "Bearer trusted-session-token", "x-cron-user-id": OTHER, "x-account-id": OTHER } });
  const create = (message = options.message ?? "Modifie le brouillon de campagne.", actionRequestId = TURN) => runtime.createInrAssistantCommunicationTools({ request: source, accountId: ACCOUNT, actorUserId: ACTOR, supabase: db as never, edition: options.edition ?? "premium", currentUserMessage: message, actionRequestId, canStartWork: () => options.canStartWork !== false });
  const tools = create();
  const execute = async (name: keyof typeof tools, input: unknown, useTools = tools): Promise<Row> => {
    const result: unknown = await (useTools[name].execute as (value: unknown, context: unknown) => Promise<unknown>)(input, { toolCallId: `test-${name}`, messages: [] });
    assert.ok(result && typeof result === "object" && !Array.isArray(result) && !(Symbol.asyncIterator in result));
    return result as Row;
  };
  return { tools, execute, create, rows, queries, apiCalls, source };
}
const edit = (changes: Row = {}) => ({ instructionQuote: "Modifie le brouillon de campagne.", draftId: DRAFT, subject: "Nouvel objet", bodyText: null, recipients: null, ...changes });
const dispatch = (quote = `Envoie le brouillon à ${RECIPIENT}.`, changes: Row = {}) => ({ instructionQuote: quote, draftId: DRAFT, mode: "send", recipients: [RECIPIENT], scheduledAt: null, timezone: null, ...changes });
const calendarEdit = (changes: Row = {}) => ({ instructionQuote: "Modifie le rendez-vous.", eventId: EVENT, title: "Visite toiture", description: null, location: null, start: null, end: null, ...changes });
const read = (changes: Row = {}) => ({ section: "drafts", recordId: null, query: null, timeMin: null, timeMax: null, ...changes });

test("real SDK schemas reject privilege fields and invalid recipients before business execution", async () => {
  const h = harness();
  for (const [name, input] of [["updateCampaignDraft", edit({ accountId: OTHER })], ["dispatchCampaignDraft", dispatch(undefined, { recipients: ["javascript:alert(1)"] })], ["updateCalendarAppointment", calendarEdit({ eventId: "invented" })], ["readCommunicationRecords", read({ section: "admin" })]] as const) {
    const inputSchema = h.tools[name].inputSchema as Parameters<typeof asSchema<unknown>>[0];
    const parsed = await asSchema<unknown>(inputSchema).validate?.(input);
    assert.equal(parsed?.success, false);
    await assert.rejects(h.execute(name, input));
  }
  assert.equal(h.queries.length, 0); assert.equal(h.apiCalls.length, 0);
});

test("draft editing invokes the native workflow handler and preserves its mailbox, attachments and workflow state", async () => {
  const h = harness(), original = clone(h.rows.send_items[0]);
  const result = await h.execute("updateCampaignDraft", edit());
  assert.equal(result.status, "updated"); assert.equal(h.apiCalls.length, 1);
  const body = h.apiCalls[0].body;
  assert.equal(body.selectedAccountId, MAILBOX); assert.deepEqual(body.attachments, original.attachments);
  assert.equal(body.subject, "Nouvel objet"); assert.equal(body.bodyText, original.body_text); assert.equal(body.bodyHtml, original.body_html);
  assert.equal(body.templateKey, original.template_key); assert.equal(body.aiEngine, "openai");
  assert.equal((body.trackPayload as Row).existingMarker, "keep");
  assert.equal(body.toEmails, original.to_emails); assert.equal(result.message?.toString().includes("Aucun envoi"), true);
  await h.execute("updateCampaignDraft", edit({ subject: "Unexpected second mutation" }));
  assert.equal(h.apiCalls.length, 1, "One model turn cannot edit the same draft twice");
  const restored = await h.execute("updateCampaignDraft", edit(), h.create());
  assert.equal(restored.status, "unchanged"); assert.equal(h.apiCalls.length, 1, "A retry recovers its durable edit marker");
});

test("rewritten draft text replaces stale HTML, and recipient changes require the literal latest addresses", async () => {
  const message = `Modifie le brouillon pour ${RECIPIENT}.`, h = harness({ message });
  const result = await h.execute("updateCampaignDraft", edit({ instructionQuote: message, bodyText: "Nouvelle rédaction", recipients: [RECIPIENT] }));
  assert.equal(result.ok, true); assert.equal(h.apiCalls[0].body.bodyHtml, ""); assert.equal(h.apiCalls[0].body.toEmails, RECIPIENT);
  assert.deepEqual(h.apiCalls[0].body.recipientHints, []);
  const denied = harness();
  assert.equal((await denied.execute("updateCampaignDraft", edit({ recipients: [RECIPIENT] }))).status, "needs_instruction");
  assert.equal(denied.apiCalls.length, 0);
});

test("questions, negations, old instructions and future sends cannot authorize immediate diffusion", async () => {
  for (const message of [`Comment envoyer le brouillon à ${RECIPIENT} ?`, `Ne l’envoie pas à ${RECIPIENT}.`, `Envoie pas le brouillon à ${RECIPIENT}.`, `Envoie le brouillon demain à ${RECIPIENT}.`, `Tu avais dit : envoie le brouillon à ${RECIPIENT}. Mais explique-moi seulement.`]) {
    const h = harness({ message });
    const quote = message.includes("envoie") ? message.slice(message.indexOf("envoie")) : message;
    assert.equal((await h.execute("dispatchCampaignDraft", dispatch(quote))).status, "needs_instruction", message);
    assert.equal(h.apiCalls.length, 0); assert.equal(h.queries.length, 0);
  }
  const h = harness({ message: "Bonjour, que dois-je faire ?" });
  assert.equal((await h.execute("dispatchCampaignDraft", dispatch())).status, "needs_instruction");
  for (const message of ["Est-ce que je peux modifier le brouillon de campagne ?", "Puis-je changer le brouillon de campagne ?", "Si je modifie le brouillon de campagne…", "Can I update this draft?"]) {
    const question = harness({ message });
    assert.equal((await question.execute("updateCampaignDraft", edit({ instructionQuote: message }))).status, "needs_instruction");
    assert.equal(question.apiCalls.length, 0); assert.equal(question.queries.length, 0);
  }
});

test("native campaign dispatch preserves suppression/quota checks and announces queued or paused, never delivery", async () => {
  for (const nativePaused of [false, true]) {
    const message = `Envoie le brouillon à ${RECIPIENT}.`, h = harness({ message, nativePaused });
    const result = await h.execute("dispatchCampaignDraft", dispatch(message));
    assert.equal(result.status, nativePaused ? "paused" : "queued");
    assert.equal(h.apiCalls[0].path, "/api/crm/campaigns");
    const body = h.apiCalls[0].body;
    assert.equal(body.accountId, MAILBOX, "The native API's accountId is the already saved mailbox, not the establishment or an LLM-selected account");
    assert.deepEqual(body.recipients, [{ email: RECIPIENT }]); assert.equal(body.text, "Texte initial du brouillon.");
    assert.equal(body.skipScheduledDuplicateCheck, undefined); assert.equal(body.allowDuplicateCampaignSend, undefined);
    assert.ok(typeof body.idempotencyKey === "string" && body.idempotencyKey.startsWith("assistant-communication:"));
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|TOKEN|DNS|livré|envoyé avec succès/);
    const retry = await h.execute("dispatchCampaignDraft", dispatch(message), h.create(message));
    assert.equal(retry.status, "already_processed"); assert.equal(h.apiCalls.length, 1);
  }
});

test("schedule uses the native stable UUID contract and requires the exact requested date, time and zone", async () => {
  const when = new Date(Date.now() + 2 * 86400_000);
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Paris", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(when).map(part => [part.type, part.value]));
  const message = `Programme le brouillon le ${parts.year}-${parts.month}-${parts.day} à ${parts.hour}h${parts.minute} Europe/Paris pour ${RECIPIENT}.`;
  const h = harness({ message }), input = dispatch(message, { mode: "schedule", scheduledAt: when.toISOString(), timezone: "Europe/Paris" });
  const result = await h.execute("dispatchCampaignDraft", input);
  assert.equal(result.status, "scheduled"); assert.equal(h.apiCalls[0].path, "/api/agent/scheduled-actions");
  const body = h.apiCalls[0].body;
  assert.match(String(body.scheduleRequestId), /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-8[a-f0-9]{3}-[a-f0-9]{12}$/);
  assert.equal(body.actionType, "campaign"); assert.equal(body.targetTool, "propulser"); assert.equal(body.scheduledAt, when.toISOString());
  assert.deepEqual((body.payload as Row).kind, "mail_campaign");
  const retry = await h.execute("dispatchCampaignDraft", input, h.create(message));
  assert.equal(retry.status, "already_processed"); assert.equal(h.apiCalls.length, 1);
  for (const changed of [{ timezone: "UTC" }, { scheduledAt: new Date(when.getTime() + 3600_000).toISOString() }, { recipients: ["invented@example.test"] }]) {
    const denied = harness({ message });
    assert.equal((await denied.execute("dispatchCampaignDraft", { ...input, ...changed })).status, "needs_instruction");
    assert.equal(denied.apiCalls.length, 0); assert.equal(denied.queries.length, 0);
  }
  const asSend = await h.execute("dispatchCampaignDraft", dispatch(message), h.create(message));
  assert.equal(asSend.status, "needs_instruction"); assert.equal(h.apiCalls.length, 1);
  const isoMessage = `Programme le brouillon le ${when.toISOString()} Europe/Paris pour ${RECIPIENT}.`, iso = harness({ message: isoMessage });
  assert.equal((await iso.execute("dispatchCampaignDraft", { ...input, instructionQuote: isoMessage })).status, "scheduled");
});

test("uncertain recovery, native refusals and scope changes fail closed without a blind second dispatch", async () => {
  const message = `Envoie le brouillon à ${RECIPIENT}.`;
  for (const options of [{ readErrorTable: "mail_campaigns" }, { readErrorTable: "inr_agent_scheduled_actions" }, { scopeChangeOnAuth: 2 }, { actorChanged: true }, { canStartWork: false }]) {
    const h = harness({ ...options, message });
    const result = await h.execute("dispatchCampaignDraft", dispatch(message));
    assert.equal(result.ok, false); assert.equal(h.apiCalls.length, 0); assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  }
  for (const nativeStatus of [409, 425, 429, 503]) {
    const h = harness({ message, nativeStatus });
    const result = await h.execute("dispatchCampaignDraft", dispatch(message));
    assert.equal(result.ok, false); assert.equal(h.apiCalls.length, 1); assert.doesNotMatch(JSON.stringify(result), /PRIVATE|STACK|TOKEN/);
    await h.execute("dispatchCampaignDraft", dispatch(message)); assert.equal(h.apiCalls.length, 1);
  }
});

test("a lost response after native dispatch commit is recovered durably, including failed status, without sending twice", async () => {
  const message = `Envoie le brouillon à ${RECIPIENT}.`, h = harness({ message, throwAfterDispatchCommit: true });
  const first = await h.execute("dispatchCampaignDraft", dispatch(message));
  assert.equal(first.ok, false); assert.equal(first.status, "unavailable"); assert.doesNotMatch(JSON.stringify(first), /PRIVATE/);
  assert.equal(h.rows.mail_campaigns.length, 1); assert.equal(h.apiCalls.length, 1);
  h.rows.mail_campaigns[0].status = "failed";
  const recovered = await h.execute("dispatchCampaignDraft", dispatch(message), h.create(message));
  assert.equal(recovered.status, "already_processed"); assert.equal(recovered.savedStatus, "failed");
  assert.equal(h.apiCalls.length, 1, "An already recorded failed campaign requires review, never an automatic second diffusion");
});

test("a stalled durable recovery is bounded to five seconds and never falls through to a new send", async t => {
  t.mock.timers.enable({ apis: ["setTimeout"] });
  try {
    const message = `Envoie le brouillon à ${RECIPIENT}.`, h = harness({ message, readNeverTable: "mail_campaigns" });
    const result = h.execute("dispatchCampaignDraft", dispatch(message));
    await new Promise<void>(resolve => setImmediate(resolve));
    t.mock.timers.tick(5000);
    assert.equal((await result).ok, false); assert.equal(h.apiCalls.length, 0);
    assert.equal(h.queries.filter(query => query.table === "send_items").length, 0);
  } finally { t.mock.timers.reset(); }
});

test("Standard cannot read campaign drafts or agenda, edit them, or dispatch while ordinary saved mail history remains scoped", async () => {
  const message = `Envoie le brouillon à ${RECIPIENT}.`, h = harness({ edition: "standard", message });
  for (const [name, input] of [["updateCampaignDraft", edit()], ["dispatchCampaignDraft", dispatch(message)], ["updateCalendarAppointment", calendarEdit()], ["readCommunicationRecords", read()], ["readCommunicationRecords", read({ section: "calendar" })]] as const) {
    assert.equal((await h.execute(name, input)).status, "not_included");
  }
  assert.equal(h.apiCalls.length, 0); assert.equal(h.queries.length, 0);
  h.rows.send_items.push({ ...fixtureDraft(), id: randomUUID(), status: "sent", folder: "mails", subject: "Courrier standard" });
  const result = await h.execute("readCommunicationRecords", read({ section: "mail_history" }));
  assert.equal(result.ok, true); assert.equal((result.items as Row[]).length, 1);
  assert.ok(h.queries[0].filters.some(([op, field, value]) => op === "eq" && field === "folder" && value === "mails"));
});

test("saved mail/agenda reading exposes bounded prose only, no foreign rows, raw HTML, recipients, meta or private provider details", async () => {
  const h = harness({ unfilteredRows: true });
  h.rows.send_items = Array.from({ length: 12 }, (_, index) => ({ ...fixtureDraft(), id: index ? randomUUID() : DRAFT, subject: `Sujet ${index} client@example.test`, body_text: `Contact client@example.test Bearer PRIVATE_TOKEN ${"Texte ".repeat(1000)}`, body_html: "<script>PRIVATE HTML</script>", draft_state: { token: "PRIVATE STATE" } }));
  h.rows.send_items.unshift({ ...fixtureDraft(), user_id: OTHER, subject: "FOREIGN SECRET" });
  const list = await h.execute("readCommunicationRecords", read());
  assert.equal((list.items as Row[]).length, 7); // First SQL page contains one rejected foreign row.
  assert.ok(new TextEncoder().encode(JSON.stringify(list)).byteLength < 6000);
  assert.doesNotMatch(JSON.stringify(list), /FOREIGN|PRIVATE|example\.test|body_html|draft_state|attachments|integration_id|user_id/);
  const detail = await h.execute("readCommunicationRecords", read({ recordId: DRAFT }));
  assert.equal((detail.items as Row[]).length, 1); assert.doesNotMatch(JSON.stringify(detail), /PRIVATE_TOKEN|example\.test|PRIVATE HTML|PRIVATE STATE/);
  const calendar = await h.execute("readCommunicationRecords", read({ section: "calendar", recordId: EVENT }));
  assert.equal((calendar.items as Row[]).length, 1); assert.equal(calendar.availabilityGuaranteed, false); assert.equal(calendar.period, null, "An exact record read is not falsely described as belonging to the default next-seven-days window");
  assert.doesNotMatch(JSON.stringify(calendar), /PRIVATE GUEST|guests|reminders|readOnly/);
});

test("draft calendar edits preserve meta through native PATCH, never confirm or notify, and retain a durable retry marker", async () => {
  const message = "Modifie le rendez-vous.", h = harness({ message });
  const result = await h.execute("updateCalendarAppointment", calendarEdit());
  assert.equal(result.status, "updated"); assert.equal(h.apiCalls[0].path, "/api/calendar/events");
  const body = h.apiCalls[0].body;
  assert.equal(body.requireDraft, true); assert.equal(body.start, "2026-12-01T09:00:00.000Z");
  assert.deepEqual(Object.keys(body.inrcy as Row), ["assistantCommunicationActionKey"]);
  assert.equal((h.rows.agenda_events[0].meta as Row).status, "draft"); assert.deepEqual((h.rows.agenda_events[0].meta as Row).guests, [{ email: "PRIVATE GUEST" }]);
  assert.equal((await h.execute("updateCalendarAppointment", calendarEdit(), h.create(message))).status, "unchanged");
  assert.equal(h.apiCalls.length, 1);
});

test("confirmed, requested and synchronized appointments require the native UI rather than silently triggering invitations", async () => {
  for (const meta of [{ status: "confirmed", source: "manual" }, { status: "pending", source: "inrbadge" }, { status: "draft", source: "google_calendar", readOnly: true }]) {
    const h = harness({ message: "Modifie le rendez-vous." });
    h.rows.agenda_events[0].meta = meta;
    assert.equal((await h.execute("updateCalendarAppointment", calendarEdit())).status, "confirmation_required");
    assert.equal(h.apiCalls.length, 0);
  }
});
