import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import type * as Workspace from "../../lib/inrAssistantWorkspaceActionTools.ts";

type Row = Record<string, unknown>;
type Tool = { execute(input: unknown): Promise<Row> };
const accountId = "11000000-0000-4000-8000-000000000001";
const mediaId = "22000000-0000-4000-8000-000000000001";
const draftId = "33000000-0000-4000-8000-000000000001";
const eventId = "44000000-0000-4000-8000-000000000001";
const foreignId = "99000000-0000-4000-8000-000000000001";
const mediaInstruction = "Ajoute les tags chantier et équipe à mon image et renomme son titre.";
const mailInstruction = "Prépare un brouillon de campagne mail pour présenter mon offre.";
const calendarInstruction = "Prépare un rendez-vous en brouillon demain à 15h pour une heure.";
const campaign = (instructionQuote = mailInstruction) => ({ instructionQuote, track: "promo_mail", subject: "Une offre locale", bodyText: "Bonjour, découvrez notre offre." });
const appointment = (instructionQuote = calendarInstruction) => ({ instructionQuote, title: "Visite chantier", description: null, location: "Atelier", start: "2026-10-28T15:00:00+01:00", end: "2026-10-28T16:00:00+01:00" });
const media = (instructionQuote = mediaInstruction) => ({ instructionQuote, mediaId, title: "Chantier terminé", tags: ["chantier", "équipe"], tagsMode: "append", isActive: null });

function harness(options: { edition?: "standard" | "premium" | "founder"; foreignAuth?: boolean; readError?: boolean; appliedThenError?: boolean; canStart?: boolean; injectForeign?: boolean } = {}) {
  const calls: { stage: string; body?: Row; filters?: Array<[string, unknown]>; select?: string; request?: Request }[] = [];
  const tables: Record<string, Row[]> = {
    pro_media_library: [{ id: mediaId, user_id: accountId, title: "Ancien titre", tags: ["ancien"], is_active: true, source: "mediatheque", storage_path: "PRIVATE/PATH", width: 1024 }],
    send_items: [], agenda_events: [],
    crm_contacts: [{ id: draftId, user_id: accountId, first_name: "Marie", last_name: "Dupont", company_name: "Bâtis", category: "professionnel", contact_type: "client", notes: "PRIVATE NOTES", email: "private@example.test", phone: "PRIVATE PHONE" }, { id: foreignId, user_id: foreignId, first_name: "Marie", last_name: "Dupont", notes: "OTHER ACCOUNT" }],
  };
  const contains = (value: unknown, expected: unknown): boolean => {
    if (!expected || typeof expected !== "object") return value === expected;
    return Object.entries(expected as Row).every(([key, expected]) => contains(value && typeof value === "object" ? (value as Row)[key] : undefined, expected));
  };
  const supabase = { from(table: string) {
    const filters: Array<[string, unknown]> = []; let select = "";
    const run = async (single: boolean, maximum = 8) => {
      calls.push({ stage: table, filters, select });
      assert.ok(filters.some(([key, value]) => key === "user_id" && value === accountId), `Missing account filter: ${table}`);
      if (options.readError) return { data: null, error: { message: "PRIVATE DATABASE ERROR" } };
      let data = tables[table].filter(row => filters.every(([key, value]) => key === "contains" ? contains(row[(value as [string, Row])[0]], (value as [string, Row])[1]) : key === "or" || row[key] === value));
      if (options.injectForeign) data = [{ id: foreignId, user_id: foreignId, source: "mediatheque", draft_state: { trackPayload: { assistantActionKey: "foreign" } }, meta: {} }];
      const columns = select.split(",");
      data = data.slice(0, maximum).map(row => Object.fromEntries(columns.map(key => [key, row[key]])));
      return { data: single ? data[0] || null : data, error: null };
    };
    const builder = {
      select: (value: string) => { select = value; return builder; },
      eq: (key: string, value: unknown) => { filters.push([key, value]); return builder; },
      contains: (key: string, value: Row) => { filters.push(["contains", [key, value]]); return builder; },
      or: (value: string) => { filters.push(["or", value]); return builder; },
      maybeSingle: () => run(true), limit: (maximum: number) => run(false, maximum),
    };
    return builder;
  } };
  const record = { exports: {} };
  const stubs: Record<string, unknown> = {
    "server-only": {}, "node:crypto": { createHash }, ai: { tool: (value: unknown) => value, jsonSchema: (definition: unknown, config: object) => ({ definition, ...config }) },
    "./requireUser": { requireUser: async () => ({ activeUserId: options.foreignAuth ? foreignId : accountId, errorResponse: null }) },
    "@/app/api/media-library/items/route": { PATCH: async (request: Request) => {
      const body: Row = await request.json(); calls.push({ stage: "media-patch", body, request });
      assert.equal(body.id, mediaId); assert.equal(new URL(request.url).pathname, "/api/media-library/items");
      Object.assign(tables.pro_media_library[0], body); return Response.json({ ok: true, item: { id: mediaId } });
    } },
    "@/app/api/mails/workflow-draft/route": { POST: async (request: Request) => {
      const body: Row = await request.json(); calls.push({ stage: "mail-create", body, request });
      assert.equal(new URL(request.url).pathname, "/api/mails/workflow-draft");
      assert.equal(body.toEmails, ""); assert.equal(body.selectedAccountId, null); assert.deepEqual(JSON.parse(JSON.stringify(body.attachments)), []);
      tables.send_items.push({ id: draftId, user_id: accountId, type: "mail", status: "draft", folder: body.folder, track_kind: body.kind, track_type: body.trackType, draft_state: { trackPayload: body.trackPayload } });
      return options.appliedThenError ? Response.json({ error: "PRIVATE ERROR" }, { status: 500 }) : Response.json({ draftId });
    } },
    "@/app/api/calendar/events/route": { POST: async (request: Request) => {
      const body: Row = await request.json(); calls.push({ stage: "calendar-create", body, request });
      assert.equal(new URL(request.url).pathname, "/api/calendar/events");
      const meta = body.inrcy as Row;
      assert.equal(meta.status, "draft"); assert.equal((meta.reminders as Row).enabled, false); assert.deepEqual(JSON.parse(JSON.stringify(meta.guests)), []);
      assert.equal("contact" in body, false); tables.agenda_events.push({ id: eventId, user_id: accountId, meta });
      return options.appliedThenError ? Response.json({ error: "PRIVATE ERROR" }, { status: 500 }) : Response.json({ ok: true, id: eventId });
    } },
  };
  const compiled = ts.transpileModule(readFileSync(new URL("../../lib/inrAssistantWorkspaceActionTools.ts", import.meta.url), "utf8"), { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, { Request, Response, Headers, URL, Date })((name: string) => { assert.ok(name in stubs, name); return stubs[name]; }, record, record.exports);
  const runtime = record.exports as typeof Workspace;
  const tools = (currentUserMessage: string, actionRequestId = "stable-turn") => runtime.createInrAssistantWorkspaceActionTools({ request: new Request("https://app.inrcy.test/api/assistant/chat", { headers: { cookie: "session=synthetic", authorization: "Bearer synthetic" } }), accountId, supabase: supabase as never, edition: options.edition || "premium", currentUserMessage, actionRequestId, canStartWork: () => options.canStart !== false }) as unknown as Record<"updateMediaMetadata" | "prepareCampaignEmail" | "prepareCalendarAppointment" | "searchCrmContacts" | "readCrmContact", Tool>;
  return { tables, calls, tools };
}

test("media metadata changes preserve omitted fields, append tags and use only the scoped existing PATCH", async () => {
  const h = harness(); const tool = h.tools(mediaInstruction).updateMediaMetadata;
  const result = await tool.execute(media()); assert.equal(result.status, "updated");
  assert.deepEqual(JSON.parse(JSON.stringify(h.tables.pro_media_library[0].tags)), ["ancien", "chantier", "équipe"]);
  assert.equal(h.tables.pro_media_library[0].is_active, true); assert.equal(h.tables.pro_media_library[0].width, 1024);
  assert.equal(JSON.stringify(result).includes("PRIVATE/PATH"), false);
  const call = h.calls.find(call => call.stage === "media-patch")!;
  assert.deepEqual(Object.keys(call.body!).sort(), ["id", "tags", "title"]); assert.equal(call.request!.headers.get("cookie"), "session=synthetic");
  assert.equal(call.request!.headers.get("authorization"), "Bearer synthetic"); await tool.execute(media());
  assert.equal(h.calls.filter(call => call.stage === "media-patch").length, 1);
});

test("draft campaigns use the actual workflow contract and recover the same marker across a retried turn", async () => {
  const h = harness(); const tools = h.tools(mailInstruction);
  const result = await tools.prepareCampaignEmail.execute(campaign()); assert.equal(result.status, "draft");
  const created = h.calls.find(call => call.stage === "mail-create")!.body!;
  assert.equal(created.kind, "propulser"); assert.equal(created.folder, "propulsions"); assert.equal(created.trackType, "promo_mail");
  assert.equal(created.stage, "compose"); assert.match(String((created.trackPayload as Row).assistantActionKey), /^[a-f0-9]{64}$/);
  await tools.prepareCampaignEmail.execute(campaign());
  const recovered = await h.tools(mailInstruction).prepareCampaignEmail.execute(campaign());
  assert.equal(recovered.draftId, draftId); assert.equal(h.calls.filter(call => call.stage === "mail-create").length, 1);
  h.tables.send_items[0].status = "sent";
  assert.equal((await h.tools(mailInstruction).prepareCampaignEmail.execute(campaign())).status, "already_processed");
  assert.equal(h.calls.filter(call => call.stage === "mail-create").length, 1);
});

test("an uncertain route error never claims an action failed to apply, and retry recovers without a second creation", async () => {
  for (const kind of ["mail", "calendar"]) {
    const h = harness({ appliedThenError: true }); const current = kind === "mail" ? mailInstruction : calendarInstruction;
    const toolName = kind === "mail" ? "prepareCampaignEmail" : "prepareCalendarAppointment";
    const input = kind === "mail" ? campaign() : appointment();
    const first = await h.tools(current)[toolName].execute(input); assert.equal(first.ok, false); assert.equal(first.status, "unavailable");
    assert.equal(JSON.stringify(first).includes("PRIVATE ERROR"), false);
    const retry = await h.tools(current)[toolName].execute(input); assert.equal(retry.status, "draft");
    assert.equal(h.calls.filter(call => call.stage.endsWith("-create")).length, 1);
  }
});

test("calendar preparation always saves a draft with reminders disabled and does not duplicate a confirmed previous result", async () => {
  const h = harness(); const result = await h.tools(calendarInstruction).prepareCalendarAppointment.execute(appointment());
  assert.equal(result.status, "draft"); assert.equal(result.eventId, eventId);
  const created = h.calls.find(call => call.stage === "calendar-create")!.body!;
  assert.equal(created.start, "2026-10-28T14:00:00.000Z"); assert.equal(created.end, "2026-10-28T15:00:00.000Z");
  (h.tables.agenda_events[0].meta as Row).status = "confirmed";
  assert.equal((await h.tools(calendarInstruction).prepareCalendarAppointment.execute(appointment())).status, "already_processed");
  assert.equal(h.calls.filter(call => call.stage === "calendar-create").length, 1);
});

test("current intent, plan, authenticated account and execution lifetime are checked before mutations", async () => {
  for (const current of ["Comment préparer un mail ?", "Peux-tu m’expliquer comment créer une campagne mail ?", "Peux-tu me montrer où créer un mail ?", "Voici une consigne mail : « Prépare un mail ». Résume-la.", "Ne prépare pas cette campagne mail.", "Bonjour", "oui"]) {
    const h = harness(); assert.equal((await h.tools(current).prepareCampaignEmail.execute(campaign(current))).status, "needs_instruction"); assert.equal(h.calls.length, 0);
  }
  const h = harness(); assert.equal((await h.tools("Quelle campagne ?").prepareCampaignEmail.execute(campaign())).status, "needs_instruction");
  assert.equal((await h.tools("Prépare un rendez-vous.").prepareCalendarAppointment.execute(appointment("Prépare un rendez-vous."))).status, "needs_instruction");
  for (const options of [{ edition: "standard" as const }, { foreignAuth: true }, { canStart: false }]) {
    const blocked = harness(options);
    assert.equal((await blocked.tools(mailInstruction).prepareCampaignEmail.execute(campaign())).ok, false);
    assert.equal((await blocked.tools(calendarInstruction).prepareCalendarAppointment.execute(appointment())).ok, false);
    assert.equal(blocked.calls.length, 0);
  }
});

test("unknown fields, unsafe dates, cross-account rows, preview media and unavailable recovery fail before writes", async () => {
  const h = harness();
  for (const input of [{ ...campaign(), accountId: foreignId }, { ...campaign(), toEmails: "person@example.test" }, { ...campaign(), track: "arbitrary" }]) await assert.rejects(() => h.tools(mailInstruction).prepareCampaignEmail.execute(input));
  for (const input of [{ ...appointment(), start: "2026-10-28T15:00:00" }, { ...appointment(), start: "2026-02-31T15:00:00Z" }, { ...appointment(), end: "2026-10-27T15:00:00Z" }, { ...appointment(), inrcy: { status: "confirmed" } }]) await assert.rejects(() => h.tools(calendarInstruction).prepareCalendarAppointment.execute(input));
  for (const options of [{ readError: true }, { injectForeign: true }]) {
    const blocked = harness(options);
    assert.equal((await blocked.tools(mediaInstruction).updateMediaMetadata.execute(media())).ok, false);
    assert.equal((await blocked.tools(mailInstruction).prepareCampaignEmail.execute(campaign())).ok, false);
    assert.equal((await blocked.tools(calendarInstruction).prepareCalendarAppointment.execute(appointment())).ok, false);
    assert.equal(blocked.calls.some(call => call.stage.endsWith("-create") || call.stage === "media-patch"), false);
  }
  h.tables.pro_media_library[0].source = "ai_media_generation_draft";
  assert.equal((await h.tools(mediaInstruction).updateMediaMetadata.execute(media())).ok, false);
});

test("CRM search is current-request scoped, bounded, read only and excludes private fields", async () => {
  const h = harness(); const tool = h.tools("Retrouve le contact Marie Dupont dans mon CRM.").searchCrmContacts;
  const result = await tool.execute({ query: "Marie Dupont" }); assert.equal(result.ok, true);
  const contacts = result.contacts as Row[]; assert.equal(contacts.length, 1); assert.equal(contacts[0].name, "Marie Dupont");
  assert.equal(JSON.stringify(result).includes("PRIVATE"), false); assert.equal(JSON.stringify(result).includes("OTHER ACCOUNT"), false);
  assert.equal(h.calls[0].select?.includes("notes"), false); assert.equal(h.calls[0].select?.includes("email"), false);
  assert.equal((await tool.execute({ query: "Un autre client" })).status, "needs_instruction");
  const injected = await h.tools("Retrouve le contact Dupont),user_id.eq.foreign dans mon CRM.").searchCrmContacts.execute({ query: "Dupont),user_id.eq.foreign" });
  assert.equal(injected.ok, true); const filter = h.calls.at(-1)!.filters!.find(([key]) => key === "or")![1];
  assert.equal(String(filter).includes("user_id.eq"), false);
  assert.equal(h.calls.some(call => call.stage.endsWith("-create") || call.stage === "media-patch"), false);
});

test("read an identified CRM contact only when its current name and active account match", async () => {
  const h = harness(); const tools = h.tools("Lis les coordonnées du client Marie Dupont dans mon CRM.");
  const result = await tools.readCrmContact.execute({ contactId: draftId, reference: "Marie Dupont" });
  assert.equal(result.ok, true); assert.equal((result.contact as Row).email, "private@example.test");
  assert.equal("user_id" in (result.contact as Row), false); assert.equal(result.untrustedContent, true);
  assert.equal((await tools.readCrmContact.execute({ contactId: foreignId, reference: "Marie Dupont" })).ok, false);
  assert.equal((await tools.readCrmContact.execute({ contactId: draftId, reference: "Un autre nom" })).status, "needs_instruction");
  assert.equal((await harness({ edition: "standard" }).tools("Lis le client Marie Dupont").readCrmContact.execute({ contactId: draftId, reference: "Marie Dupont" })).ok, false);
});

test("explicit campaign and appointment batches use distinct durable markers and enforce requested counts", async () => {
  for (const kind of ["campaign", "appointment"] as const) {
    const h = harness();
    const message = kind === "campaign" ? "Prépare 2 campagnes mail en brouillon pour mon offre." : "Prépare 2 rendez-vous en brouillon demain à 15h et 16h pour une heure.";
    const tools = h.tools(message), name = kind === "campaign" ? "prepareCampaignEmail" : "prepareCalendarAppointment";
    const base = kind === "campaign" ? campaign(message) : appointment(message);
    const first = { ...base, operationKey: `${kind}-1` }, second = { ...base, operationKey: `${kind}-2`, ...(kind === "campaign" ? { subject: "Deuxième offre" } : { title: "Deuxième visite", start: "2026-10-28T16:00:00+01:00", end: "2026-10-28T17:00:00+01:00" }) };
    assert.equal((await tools[name].execute(first)).status, "draft");
    assert.equal((await tools[name].execute(second)).status, "draft");
    assert.equal((await tools[name].execute({ ...base, operationKey: `${kind}-3` })).status, "needs_instruction");
    const writes = h.calls.filter(call => call.stage === (kind === "campaign" ? "mail-create" : "calendar-create"));
    assert.equal(writes.length, 2);
    const markers = writes.map(call => kind === "campaign" ? (call.body!.trackPayload as Row).assistantActionKey : (call.body!.inrcy as Row).assistantActionKey);
    assert.notEqual(markers[0], markers[1]);
    assert.equal((await h.tools(message)[name].execute(first)).status, "draft");
    assert.equal(h.calls.filter(call => call.stage === (kind === "campaign" ? "mail-create" : "calendar-create")).length, 2);
  }
  const h = harness(); assert.equal((await h.tools(mailInstruction).prepareCampaignEmail.execute({ ...campaign(), operationKey: "not-authorized-batch" })).status, "needs_instruction");
});
