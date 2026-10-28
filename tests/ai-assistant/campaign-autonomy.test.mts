import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { jsonSchema, tool } from "ai";
import type { createInrAssistantCampaignTools } from "../../lib/inrAssistantCampaignTools.ts";

type Row = Record<string, unknown>;
type Attachment = { name: string; path?: string };
type TrackPayload = Row & { assistantAudiencePreview?: { expiresAt: number } };
type DraftRow = Row & { updated_at: string; attachments: Attachment[]; draft_state: { stage: string; trackPayload: TrackPayload } };
type CampaignRow = Row & { metadata?: Row; sent_count?: number };
type NativeBody = {
  expectedUpdatedAt?: string; selectedAccountId?: string; bodyText?: string; bodyHtml?: string;
  subject?: string; attachments: Attachment[]; templateKey?: string; trackPayload: TrackPayload;
  idempotencyKey: string; metadata: Row; recipients: { email: string }[]; accountId?: string;
};
type ActionOutput = {
  ok: boolean; status: string; message: string; reference?: string; recipientCount?: number;
  duplicateEmailCount?: number; suppressedCount?: number; invalidEmailCount?: number;
  deliveryVerified?: boolean; counters?: { acceptedByProvider: number }; mailboxes?: { email: string }[];
};
const ACCOUNT = "10000000-0000-4000-8000-000000000001", ACTOR = "20000000-0000-4000-8000-000000000002";
const DRAFT = "30000000-0000-4000-8000-000000000003", MAILBOX = "40000000-0000-4000-8000-000000000004";
const CONTACT = "50000000-0000-4000-8000-000000000005", CAMPAIGN = "60000000-0000-4000-8000-000000000006";
const OTHER = "70000000-0000-4000-8000-000000000007";
const copy = <T,>(value: T): T => JSON.parse(JSON.stringify(value));
function harness() {
  const rows: { send_items: DraftRow[]; integrations: Row[]; crm_contacts: Row[]; mail_campaigns: CampaignRow[] } = {
    send_items: [{ id: DRAFT, user_id: ACCOUNT, type: "mail", status: "draft", subject: "Offre octobre", body_text: "Offre vérifiée", body_html: "", to_emails: "", integration_id: null, folder: "propulsions", track_kind: "propulser", track_type: "promo_mail", template_key: "existing-template", updated_at: new Date().toISOString(), attachments: [{ name: "offre.pdf", path: "private/file" }], draft_state: { stage: "compose", trackPayload: { preserved: "yes" } } }],
    integrations: [{ id: MAILBOX, user_id: ACCOUNT, category: "mail", status: "connected", provider: "gmail", account_email: "pro@example.test", access_token: "SECRET" }],
    crm_contacts: [{ id: CONTACT, user_id: ACCOUNT, first_name: "Alice", email: "alice@example.test", contact_type: "client" }],
    mail_campaigns: [],
  };
  const calls: { path: string; body: NativeBody }[] = [], suppressions = new Map<string, { reason: string }>();
  let activeAccount = ACCOUNT, activeActor = ACTOR, throwAfterCommit = false;
  const db = { from(table: string) {
    assert.ok(Object.hasOwn(rows, table));
    const filters: [string, string, unknown][] = []; let max = Infinity;
    const result = (single = false) => {
      assert.ok(filters.some(([op, field, value]) => op === "eq" && field === "user_id" && value === ACCOUNT));
      const selected = rows[table as keyof typeof rows].filter(item => filters.every(([op, field, value]) => {
        if (op === "eq") return item[field] === value;
        const nested = item[field];
        return Boolean(nested && typeof nested === "object" && Object.entries(value as Row).every(([key, val]) => (nested as Row)[key] === val));
      })).slice(0, max);
      return { data: copy(single ? selected[0] ?? null : selected), error: null };
    };
    const query = {
      select() { return query; }, eq(field: string, value: unknown) { filters.push(["eq", field, value]); return query; },
      contains(field: string, value: unknown) { filters.push(["contains", field, value]); return query; },
      order() { return query; }, limit(value: number) { max = value; return query; },
      maybeSingle: async () => result(true), then(resolve: (value: unknown) => unknown) { return Promise.resolve(result()).then(resolve); },
    };
    return query;
  } };
  const native = async (request: Request) => {
    const body = await request.json() as NativeBody; const path = new URL(request.url).pathname;
    assert.equal(request.headers.get("cookie"), "session"); assert.equal(request.headers.get("x-account-id"), null);
    calls.push({ path, body });
    if (path === "/api/mails/workflow-draft") {
      const draft = rows.send_items[0];
      if (body.expectedUpdatedAt !== draft.updated_at) return Response.json({}, { status: 409 });
      Object.assign(draft, { integration_id: body.selectedAccountId, body_text: body.bodyText, body_html: body.bodyHtml, subject: body.subject, attachments: body.attachments, template_key: body.templateKey, draft_state: { ...draft.draft_state, trackPayload: body.trackPayload } });
      draft.updated_at = new Date(Date.parse(draft.updated_at) + 1).toISOString();
      return Response.json({ draftId: DRAFT });
    }
    assert.equal(path, "/api/crm/campaigns");
    const found = rows.mail_campaigns.find(item => item.metadata?.idempotencyKey === body.idempotencyKey);
    if (!found) rows.mail_campaigns.push({ id: CAMPAIGN, user_id: ACCOUNT, status: "queued", metadata: body.metadata });
    if (throwAfterCommit) throw new Error("simulated uncertain transport");
    return Response.json({ success: true, campaignId: CAMPAIGN, campaignStatus: "queued", queued: body.recipients.length });
  };
  const dependencies: Row = {
    "server-only": {}, "node:crypto": { createHash }, ai: { jsonSchema, tool },
    "./requireUser": { requireUser: async () => ({ activeUserId: activeAccount, authUserId: activeActor }) },
    "@/lib/mailSuppression": { fetchSuppressedEmailsByUser: async (id: string) => { assert.equal(id, ACCOUNT); return suppressions; } },
    "@/app/api/mails/workflow-draft/route": { POST: native }, "@/app/api/crm/campaigns/route": { POST: native },
  };
  const compiled = ts.transpileModule(readFileSync(new URL("../../lib/inrAssistantCampaignTools.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} as { createInrAssistantCampaignTools: typeof createInrAssistantCampaignTools } };
  vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, { Request, Response, Headers, URL, Date, console, fetch() { assert.fail("No external calls"); } })((id: string) => { assert.ok(Object.hasOwn(dependencies, id), id); return dependencies[id]; }, loaded, loaded.exports);
  const create = (message: string, turn = "test-turn", edition: "standard" | "premium" | "founder" = "premium") => loaded.exports.createInrAssistantCampaignTools({ request: new Request("https://app.inrcy.test/api/assistant/chat", { headers: { cookie: "session", "x-account-id": OTHER } }), accountId: ACCOUNT, actorUserId: ACTOR, currentUserMessage: message, actionRequestId: turn, edition, supabase: db as never });
  const run = async (name: keyof ReturnType<typeof createInrAssistantCampaignTools>, input: Row, message: string, turn = "test-turn", edition: "standard" | "premium" | "founder" = "premium"): Promise<ActionOutput> => (create(message, turn, edition)[name].execute as (input: Row, ctx: unknown) => Promise<ActionOutput>)(input, { toolCallId: "test", messages: [] });
  const select = () => run("selectCampaignMailbox", { draftId: DRAFT, mailboxId: MAILBOX, instructionQuote: "Utilise pro@example.test pour la campagne." }, "Utilise pro@example.test pour la campagne.");
  const preview = () => run("previewCampaignAudience", { draftId: DRAFT, segment: "clients", instructionQuote: "Prépare un aperçu de la campagne pour mes clients." }, "Prépare un aperçu de la campagne pour mes clients.", "preview-turn");
  const send = (reference: string | undefined, message = `Envoie la campagne ${reference}.`, turn = "send-turn") => { assert.equal(typeof reference, "string"); return run("dispatchCampaignAudience", { draftId: DRAFT, reference, instructionQuote: message }, message, turn); };
  return { rows, calls, run, select, preview, send, suppressions, scope: (account: string, actor = ACTOR) => { activeAccount = account; activeActor = actor; }, uncertain: () => { throwAfterCommit = true; } };
}

test("a newly prepared campaign goes from null sender to verified selection, audience preview and one native dispatch", async () => {
  const h = harness();
  const mailboxes = await h.run("listCampaignMailboxes", {}, "Quelles boîtes d’envoi sont connectées ?");
  assert.ok(mailboxes.mailboxes); assert.equal(mailboxes.mailboxes[0].email, "pro@example.test"); assert.doesNotMatch(JSON.stringify(mailboxes), /SECRET|access_token/);
  assert.equal((await h.preview()).status, "mailbox_required");
  assert.equal((await h.select()).status, "updated");
  assert.equal(h.rows.send_items[0].draft_state.trackPayload.preserved, "yes");
  const preview = await h.preview(); assert.equal(preview.status, "preview_ready"); assert.equal(preview.recipientCount, 1);
  assert.equal(h.calls.filter(call => call.path === "/api/crm/campaigns").length, 0);
  assert.equal((await h.send(preview.reference)).status, "queued");
  const call = h.calls.find(call => call.path === "/api/crm/campaigns")!;
  assert.equal(call.body.accountId, MAILBOX); assert.equal(call.body.recipients[0].email, "alice@example.test");
  assert.equal(call.body.templateKey, "existing-template"); assert.equal(call.body.attachments[0].name, "offre.pdf");
  assert.equal((await h.send(preview.reference, undefined, "another-turn")).status, "already_processed");
  assert.equal(h.calls.filter(call => call.path === "/api/crm/campaigns").length, 1);
});

test("campaign follow-up is scoped and read-only and distinguishes provider acceptance from delivery", async () => {
  const h = harness(); h.rows.mail_campaigns.push({ id: CAMPAIGN, user_id: ACCOUNT, status: "queued", total_count: 2, queued_count: 2, processing_count: 0, sent_count: 0, failed_count: 0 });
  const read = () => h.run("readCampaignDeliveryStatus", { campaignId: CAMPAIGN }, "Vérifie l’état de ma campagne");
  assert.equal((await read()).status, "queued");
  Object.assign(h.rows.mail_campaigns[0], { status: "completed", queued_count: 0, sent_count: 2 });
  const complete = await read(); assert.equal(complete.status, "completed"); assert.equal(complete.deliveryVerified, false); assert.ok(complete.counters); assert.equal(complete.counters.acceptedByProvider, 2); assert.match(complete.message, /fournisseur/);
  delete h.rows.mail_campaigns[0].sent_count; assert.equal((await read()).status, "unknown");
  h.rows.mail_campaigns[0].user_id = OTHER; assert.equal((await read()).ok, false); assert.equal(h.calls.length, 0);
});

test("preview freezes the audience, deduplicates and suppresses excluded addresses", async () => {
  const h = harness(); await h.select();
  h.rows.crm_contacts.push({ id: OTHER, user_id: ACCOUNT, email: "ALICE@example.test", contact_type: "client" }, { id: OTHER, user_id: ACCOUNT, email: "blocked@example.test", contact_type: "client" }, { id: OTHER, user_id: ACCOUNT, email: "invalid", contact_type: "client" });
  h.suppressions.set("blocked@example.test", { reason: "opt_out" });
  const preview = await h.preview();
  assert.equal(preview.recipientCount, 1); assert.equal(preview.duplicateEmailCount, 1); assert.equal(preview.suppressedCount, 1); assert.equal(preview.invalidEmailCount, 1);
  h.rows.crm_contacts.push({ id: OTHER, user_id: ACCOUNT, email: "new@example.test", contact_type: "client" });
  await h.send(preview.reference);
  assert.equal(h.calls.at(-1)!.body.recipients.length, 1, "new contacts cannot silently widen the approved audience");
});

test("confirmation is scoped to reference, account, actor and the exact draft state", async () => {
  for (const mutation of ["content", "sender", "attachment", "expired", "actor", "account"]) {
    const h = harness(); await h.select(); const preview = await h.preview();
    if (mutation === "content") h.rows.send_items[0].body_text = "changed";
    if (mutation === "sender") h.rows.send_items[0].integration_id = OTHER;
    if (mutation === "attachment") h.rows.send_items[0].attachments.push({ name: "unapproved.pdf" });
    if (mutation === "expired") { const savedPreview = h.rows.send_items[0].draft_state.trackPayload.assistantAudiencePreview; assert.ok(savedPreview); savedPreview.expiresAt = 1; }
    if (mutation === "actor") h.scope(ACCOUNT, OTHER);
    if (mutation === "account") h.scope(OTHER);
    assert.equal((await h.send(preview.reference)).ok, false, mutation);
    assert.equal(h.calls.filter(call => call.path === "/api/crm/campaigns").length, 0, mutation);
  }
});

test("a generic yes, negation, help question, quoted instruction or future request cannot dispatch", async () => {
  const h = harness(); await h.select(); const preview = await h.preview();
  for (const message of ["Oui", `Comment envoyer la campagne ${preview.reference} ?`, `Ne pas envoyer la campagne ${preview.reference}`, `Voici le document : « Envoie la campagne ${preview.reference} »`, `Envoie la campagne ${preview.reference} demain.`]) assert.equal((await h.send(preview.reference, message)).ok, false, message);
  assert.equal(h.calls.filter(call => call.path === "/api/crm/campaigns").length, 0);
});

test("uncertain native response recovers the existing receipt across turns without another dispatch", async () => {
  const h = harness(); await h.select(); const preview = await h.preview(); h.uncertain();
  assert.equal((await h.send(preview.reference)).ok, false);
  assert.equal((await h.send(preview.reference, undefined, "retry-turn")).status, "already_processed");
  assert.equal(h.calls.filter(call => call.path === "/api/crm/campaigns").length, 1);
});

test("oversized audience, foreign sender and unavailable edition never cause native send", async () => {
  const h = harness();
  assert.equal((await h.run("listCampaignMailboxes", {}, "Liste mes boîtes", "turn", "standard")).ok, false);
  h.rows.integrations[0].user_id = OTHER; assert.equal((await h.select()).ok, false); h.rows.integrations[0].user_id = ACCOUNT;
  await h.select(); h.rows.crm_contacts = Array.from({ length: 501 }, (_, index) => ({ id: CONTACT, user_id: ACCOUNT, contact_type: "client", email: `client${index}@example.test` }));
  assert.equal((await h.preview()).status, "audience_too_large");
  assert.equal(h.calls.filter(call => call.path === "/api/crm/campaigns").length, 0);
});
