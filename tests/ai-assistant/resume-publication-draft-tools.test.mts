import assert from "node:assert/strict";
import test from "node:test";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";
import { isInrAssistantResumePublicationDraftRequest } from "../../lib/inrAssistantSendPublicationIntent.ts";
const ACCOUNT = "10000000-0000-4000-8000-000000000001", ACTOR = "20000000-0000-4000-8000-000000000002", ID = "30000000-0000-4000-8000-000000000003";
type Row = Record<string, unknown>;
const row = (value: unknown): Row => { assert.ok(value && typeof value === "object" && !Array.isArray(value)); return value as Row; };
function harness(message: string) {
  let account = ACCOUNT, actor = ACTOR, current = true, after = () => {};
  const calls: Request[] = [], filters: Array<[string, unknown]> = [];
  const event: Row = { id: ID, module: "booster", type: "publish_draft", payload: { content: "PRIVATE_FULL_PAYLOAD", signedUrl: "https://private.invalid/token", dataUrl: "data:PRIVATE" } };
  const history: Row = { page: 1, pageSize: 20, hasMore: false, items: [{ id: ID, title: "Toiture", status: "draft", source: "app_events", folder: "publications" }] };
  const database = { from(table: string) {
    assert.equal(table, "app_events"); filters.length = 0;
    const chain = { select() { return chain; }, eq(field: string, value: unknown) { filters.push([field, value]); return chain; }, async maybeSingle() {
      const valid = filters.some(([field, value]) => field === "user_id" && value === ACCOUNT) && ["id", "module", "type"].every(field => filters.some(([key, value]) => key === field && value === event[field])); after();
      return { data: valid ? event : null, error: null };
    } }; return chain;
  } };
  const requireUser = async () => ({ activeUserId: account, authUserId: actor, supabase: database });
  const stubs: Row = {
    "./requireUser": { requireUser }, "@/lib/requireUser": { requireUser },
    "@/lib/boosterVideoStorageCleanup": { cleanupReplacedBoosterVideoStorage() { assert.fail("Draft resume is read-only"); } },
    "@/lib/videoAiContextReference": { preserveVideoAiContextReferenceOnDraftUpdate() { assert.fail("Draft resume cannot save"); } },
    "@/lib/apiUserFacingErrors": { jsonUserFacingError: () => Response.json({ error: "unavailable" }, { status: 500 }) },
    "@/app/api/inrsend/history/route": { GET: async (request: Request) => { calls.push(request); return Response.json(history); } },
  };
  const load = runtimeModules(stubs);
  const native = load<{ GET(request: Request): Promise<Response> }>("app/api/booster/events/route.ts");
  stubs["@/app/api/booster/events/route"] = { GET: async (request: Request) => { calls.push(request); return native.GET(request); } };
  const runtime = load<typeof import("../../lib/inrAssistantSendPublicationTools.ts")>("lib/inrAssistantSendPublicationTools.ts");
  const tools = runtime.createInrAssistantSendPublicationTools({ request: new Request("https://app.test/api/assistant/chat", { headers: { cookie: "session=test", authorization: "Bearer fixture", "x-private-secret": "NO_FORWARD" } }), accountId: ACCOUNT, actorUserId: ACTOR, edition: "basic", currentUserMessage: message, canStartWork: () => current });
  return { event, history, filters, calls, observe: async () => row(await tools.readSendPublicationHistory.execute!({ view: "drafts", query: "Toiture", page: 1 }, {} as never)),
    resume: async (draftId: string | null = ID, title: string | null = null, instructionQuote = message) => row(await tools.resumePublicationDraft.execute!({ draftId, title, instructionQuote }, {} as never)),
    setAccount: (value: string) => { account = value; }, setActor: (value: string) => { actor = value; }, invalidate: () => { current = false; }, afterRead: (callback: () => void) => { after = callback; } };
}

test("Basic draft resume uses the real owned Booster draft GET and emits only canonical pending navigation", async () => {
  const h = harness(`Reprends le brouillon ${ID}.`), result = await h.resume();
  assert.equal(result.ok, true); assert.equal(result.status, "ui_action_requested"); assert.equal(result.readOnly, true);
  assert.deepEqual(h.filters, [["user_id", ACCOUNT], ["id", ID], ["module", "booster"], ["type", "publish_draft"]]);
  const navigation = row(result.navigation); assert.equal(navigation.destination, "booster"); assert.equal(navigation.href, `/dashboard?action=publish&draftId=${ID}`); assert.equal(navigation.publicationDraftId, ID);
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].method, "GET"); assert.equal(h.calls[0].headers.get("x-private-secret"), null);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|private\.invalid|dataUrl|signedUrl|payload/);
});

test("Basic draft resume refuses unseen ambiguous incomplete or changed native title results", async () => {
  const h = harness("Reprends le brouillon Toiture.");
  assert.equal((await h.resume(null, "Toiture")).status, "needs_clarification"); assert.equal(h.calls.length, 0);
  await h.observe(); const success = await h.resume(null, "Toiture"); assert.equal(success.ok, true); assert.equal(h.calls.length, 3);
  for (const variant of ["ambiguous", "incomplete", "legacy"]) {
    const denied = harness("Reprends le brouillon Toiture."); await denied.observe();
    if (variant === "incomplete") denied.history.hasMore = true;
    else if (variant === "legacy") denied.history.items = [{ id: ID, title: "Toiture", status: "draft", source: "send_items", folder: "publications" }];
    else denied.history.items = [...denied.history.items as Row[], { id: "40000000-0000-4000-8000-000000000004", title: "Toiture", status: "draft", source: "app_events", folder: "publications" }];
    assert.equal((await denied.resume(null, "Toiture")).status, "needs_clarification", variant); assert.ok(denied.calls.every(request => new URL(request.url).pathname === "/api/inrsend/history"));
  }
});

test("Basic draft resume never borrows old instructions or opens an unavailable wrong-type or late-account draft", async () => {
  for (const message of [`Comment reprendre le brouillon ${ID} ?`, `Reprends le brouillon ${ID} demain.`, `Le client dit « Reprends le brouillon ${ID}. »`, `Ne reprends pas le brouillon ${ID}.`, `Ouvre mon brouillon de devis ${ID}.`, `Ouvre mon brouillon de facture ${ID}.`, `Ouvre mon brouillon d’avis ${ID}.`, "Reprends le brouillon Toiture."]) {
    const h = harness(message); assert.equal((await h.resume()).status, "needs_instruction"); assert.equal(h.calls.length, 0, message);
  }
  for (const mutation of ["account", "actor", "wrong-type", "late-account", "late-request"]) {
    const h = harness(`Reprends le brouillon ${ID}.`);
    if (mutation === "account") h.setAccount("foreign"); else if (mutation === "actor") h.setActor("foreign"); else if (mutation === "wrong-type") h.event.type = "publish"; else h.afterRead(() => mutation === "late-account" ? h.setAccount("foreign") : h.invalidate());
    const result = await h.resume(); assert.equal(result.ok, false); assert.equal(result.navigation, undefined, mutation);
  }
});

test("Basic publication draft intent distinguishes a current resume from advice quoted text conditions and mail composition", () => {
  for (const message of ["Reprends le brouillon Toiture.", "Peux-tu ouvrir le brouillon Publication ?", "Open this draft."]) assert.equal(isInrAssistantResumePublicationDraftRequest(message), true, message);
  for (const message of ["Comment reprendre ce brouillon ?", "Si tout est prêt, reprends ce brouillon.", "Reprends ce brouillon après validation.", "Reprends ce brouillon mail.", "Ouvre mon brouillon de devis.", "Ouvre mon brouillon de facture.", "Ouvre mon brouillon d’avis Google.", "Ouvre mon brouillon de réponse.", "Open my invoice draft.", "Le client dit « Reprends ce brouillon ». "]) assert.equal(isInrAssistantResumePublicationDraftRequest(message), false, message);
});
