import assert from "node:assert/strict";
import test from "node:test";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";

const ACCOUNT = "10000000-0000-4000-8000-000000000001", ACTOR = "20000000-0000-4000-8000-000000000002", ID = "30000000-0000-4000-8000-000000000003";
function harness() {
  let account = ACCOUNT, actor = ACTOR, status = 200;
  const calls: Request[] = [];
  const payload = { page: 1, pageSize: 20, hasMore: true, total: null as number | null, totalKnown: false, items: [{ id: ID, source: "app_events", folder: "publications", title: "Travaux toiture", preview: "Réalisations récentes https://private.invalid/token", status: "queued", created_at: "2026-11-05T10:00:00Z", channels: ["facebook"], originSource: "booster_manual", raw: { apiKey: "never-expose" }, attachments: [{ name: "photo.jpg", type: "image/jpeg", size: 1200, url: "https://private.invalid/signed", storagePath: "account/private" }] }] as Array<Record<string, unknown>> };
  let afterRead = () => {};
  const load = runtimeModules({ "./requireUser": { requireUser: async () => ({ activeUserId: account, authUserId: actor }) }, "@/app/api/inrsend/history/route": { GET: async (request: Request) => { calls.push(request); afterRead(); return Response.json(payload, { status }); } } });
  const { createInrAssistantSendPublicationTools } = load<typeof import("../../lib/inrAssistantSendPublicationTools.ts")>("lib/inrAssistantSendPublicationTools.ts");
  const tools = createInrAssistantSendPublicationTools({ request: new Request("https://app.test/api/assistant/chat", { headers: { cookie: "session=fixture", authorization: "Bearer fixture", "x-cron-secret": "do-not-forward" } }), accountId: ACCOUNT, actorUserId: ACTOR, edition: "basic" });
  const run = (input = { view: "sent", query: null as string | null, page: 1 }) => tools.readSendPublicationHistory.execute!(input as never, { toolCallId: "unit", messages: [] });
  return { calls, payload, run, setStatus: (value: number) => { status = value; }, setAccount: (value: string) => { account = value; }, setActor: (value: string) => { actor = value; }, after: (callback: () => void) => { afterRead = callback; } };
}
test("Basic Send history uses the native Publications search, pagination and safe projection without mailbox access", async () => {
  const h = harness();
  const result = await h.run({ view: "sent", query: "toiture", page: 1 }) as Record<string, unknown>;
  assert.equal(result.ok, true); assert.equal(result.nextPage, 2); assert.equal(result.total, null); assert.equal(result.totalKnown, false);
  assert.equal(h.calls.length, 1);
  const url = new URL(h.calls[0].url); assert.equal(url.pathname, "/api/inrsend/history"); assert.equal(url.searchParams.get("folder"), "publications"); assert.equal(url.searchParams.get("q"), "toiture"); assert.equal(url.searchParams.get("boxView"), "sent"); assert.equal(url.searchParams.get("pageSize"), "20");
  assert.equal(h.calls[0].headers.get("cookie"), "session=fixture"); assert.equal(h.calls[0].headers.get("x-cron-secret"), null);
  assert.doesNotMatch(JSON.stringify(result), /never-expose|private.invalid|account\/private|apiKey|storagePath|signed/);
  assert.equal((result.records as Array<Record<string, unknown>>)[0].status, "queued"); assert.match(String(result.message), /sans garantie de livraison/);
});
test("Basic Send history includes native scheduled records and distinguishes an exhausted page from a bounded scan", async () => {
  const h = harness(); h.payload.page = 2; h.payload.hasMore = false; h.payload.totalKnown = true; h.payload.total = 21;
  h.payload.items[0].id = `inr-agent-scheduled:${ID}`; h.payload.items[0].source = "inr_agent_actions"; h.payload.items[0].originSource = "booster_scheduled";
  const result = await h.run({ view: "drafts", query: null, page: 2 }) as Record<string, unknown>;
  assert.equal(result.ok, true); assert.equal(result.nextPage, null); assert.equal(result.total, 21); assert.equal(new URL(h.calls[0].url).searchParams.get("boxView"), "drafts");
  h.payload.page = 100; h.payload.hasMore = true;
  const bounded = await h.run({ view: "sent", query: null, page: 100 }) as Record<string, unknown>;
  assert.equal(bounded.nativePageLimitReached, true); assert.equal(bounded.hasMore, true); assert.equal(bounded.nextPage, null);
});

test("Basic Send history retains legitimate legacy Publications without exposing mail bodies recipients or attachment names", async () => {
  const h = harness();
  Object.assign(h.payload.items[0], { source: "send_items", title: "Sujet privé PERSONNE_PRIVATE", preview: "Courrier privé destinataire@example.invalid +33612345678",
    to: ["destinataire@example.invalid"], from: "expediteur@example.invalid", integration_id: "MAILBOX_PRIVATE", html: "MESSAGE_PRIVATE",
    raw: { body: "MESSAGE_PRIVATE", subject: "PERSONNE_PRIVATE", to: ["destinataire@example.invalid"] },
    attachments: [{ name: "DOSSIER_PERSONNEL_PRIVATE.pdf", url: "https://private.invalid/signed", type: "application/pdf", size: 2000 }] });
  const result = await h.run() as Record<string, unknown>;
  assert.equal(result.ok, true); assert.equal(h.calls.length, 1);
  const record = (result.records as Array<Record<string, unknown>>)[0];
  assert.equal(record.id, ID); assert.equal(record.source, "send_items"); assert.equal(record.legacy, true); assert.equal(record.textOmitted, true);
  assert.equal(record.title, ""); assert.equal(record.preview, ""); assert.equal(record.attachmentCount, 1); assert.deepEqual(record.attachments, []);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|example\.invalid|private\.invalid|\+33612345678|integration_id|"to"|"from"/);
  const url = new URL(h.calls[0].url); assert.equal(url.searchParams.get("folder"), "publications");
  h.payload.items[0].folder = "mails"; assert.equal((await h.run() as Record<string, unknown>).ok, false);
  h.payload.items[0].folder = "publications"; h.payload.items[0].source = "mail_campaigns"; assert.equal((await h.run() as Record<string, unknown>).ok, false);
});
test("Basic Send history refuses another active account/actor before or after the native read", async () => {
  for (const target of ["account", "actor", "after"] as const) {
    const h = harness(); if (target === "account") h.setAccount("other"); else if (target === "actor") h.setActor("other"); else h.after(() => h.setAccount("other"));
    const result = await h.run() as Record<string, unknown>; assert.equal(result.ok, false); assert.equal(result.status, "blocked"); assert.equal(h.calls.length, target === "after" ? 1 : 0); assert.equal(result.records, undefined);
  }
});
test("Basic Send history refuses foreign folders, malformed pages and native errors without leaking their details", async () => {
  const malformed = harness(); for (const input of [{ view: "mails", query: null, page: 1 }, { view: "sent", query: null, page: 101 }, { view: "sent", query: null, page: 0 }, { view: "sent", query: "x".repeat(201), page: 1 }, { view: "sent", query: null, page: 1, folder: "mails" }]) await assert.rejects(async () => malformed.run(input));
  assert.equal(malformed.calls.length, 0);
  const foreign = harness(); foreign.payload.items[0].folder = "mails"; assert.equal((await foreign.run() as Record<string, unknown>).ok, false);
  const changed = harness(); changed.payload.page = 2; assert.equal((await changed.run() as Record<string, unknown>).ok, false);
  const failed = harness(); failed.setStatus(500); const result = await failed.run() as Record<string, unknown>; assert.equal(result.ok, false); assert.equal(result.records, undefined); assert.doesNotMatch(JSON.stringify(result), /never-expose|private.invalid/);
});
