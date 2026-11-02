import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import { inrAssistantMailDraftVersion, persistInrAssistantMailDraft } from "../../lib/inrAssistantMailDraftPersistence.ts";
import { normalizeRichMailHtmlForSend } from "../../lib/mailRichText.ts";
type Row = Record<string, unknown>;
const ACCOUNT = "11111111-1111-4111-8111-111111111111", DRAFT = "22222222-2222-4222-8222-222222222222";
const VERSION = "2026-11-02T10:00:00.000Z", NEXT = "2026-11-02T10:00:01.000Z";
function harness(mode = "new") {
  const attachment = { bucket: "inrbox_attachments", path: `${ACCOUNT}/devis.pdf`, name: "Devis.pdf", type: "application/pdf", size: 100 };
  const payload = { user_id: ACCOUNT, status: "draft", integration_id: "mailbox", type: "devis", to_emails: "alice@example.test", subject: "Devis", body_text: "Bonjour", body_html: normalizeRichMailHtmlForSend("Bonjour", ""), attachments: [attachment], draft_state: { stage: "compose" } };
  const baseline = JSON.stringify({ selectedAccountId: "mailbox", composeType: "devis", to: "alice@example.test", subject: "Devis", text: "Bonjour", html: "", attachments: [attachment] });
  let record: Row = mode === "new" ? {} : { ...payload, id: DRAFT, updated_at: VERSION }, writes = 0, started = 0, current = true;
  if (mode === "tracking-before-read") { record.track_kind = "fideliser"; record.draft_state = { trackPayload: { edited: "other tab" } }; record.updated_at = NEXT; }
  if (mode === "stale") record.subject = "Autre onglet";
  if (mode === "sent") record.status = "sent";
  if (mode === "foreign") record.user_id = "another";
  const from = (table: string) => {
    assert.equal(table, "send_items"); let update: Row | undefined, inserting = false;
    const filters: Array<[string, unknown]> = [];
    const execute = () => {
      if (!update) {
        assert.ok(filters.some(([key, value]) => key === "user_id" && value === ACCOUNT));
        const data = filters.every(([key, value]) => record[key] === value) ? structuredClone(record) : null;
        if (mode === "race" && writes === 0) record.updated_at = NEXT;
        if (mode === "scope") current = false;
        return { data, error: null };
      }
      writes++;
      if (mode === "metadata-unavailable") return { data: null, error: { code: "PGRST204" } };
      if (!inserting && !filters.every(([key, value]) => record[key] === value)) return { data: null, error: null };
      if (!inserting) { assert.ok(typeof update.updated_at === "string" && Date.parse(update.updated_at) > Date.parse(VERSION)); assert.ok(filters.some(([key, value]) => key === "updated_at" && value === VERSION)); }
      record = { ...record, ...update, id: DRAFT, updated_at: NEXT };
      if (mode === "readback") record.attachments = [];
      return { data: { id: DRAFT }, error: null };
    };
    const query = { select: () => query, eq: (key: string, value: unknown) => { filters.push([key, value]); return query; }, update: (value: Row) => { update = value; return query; }, insert: (value: Row) => { update = value; inserting = true; return query; }, maybeSingle: async () => execute(), single: async () => execute() };
    return query;
  };
  return { run: () => persistInrAssistantMailDraft({ supabase: { from } as never, accountId: ACCOUNT, draftId: mode === "new" ? null : DRAFT,
    expectedVersion: mode === "no-version" ? null : { id: mode === "wrong-id" ? "different" : DRAFT, accountId: mode === "wrong-account-version" ? "other" : ACCOUNT, updatedAt: VERSION },
    payload: { ...payload, body_text: "Bonjour modifié", body_html: normalizeRichMailHtmlForSend("Bonjour modifié", "") }, baseline, isCurrent: () => current, onWriteStarted: () => { started++; } }), record: () => record, writes: () => writes, started: () => started };
}
test("native draft save persists and rereads the exact fields and PDF attachments", async () => {
  for (const mode of ["new", "existing"]) {
    const h = harness(mode); assert.deepEqual(await h.run(), { id: DRAFT, updatedAt: NEXT }); assert.equal(h.writes(), 1); assert.equal(h.started(), 1);
    assert.equal(h.record().body_text, "Bonjour modifié"); assert.equal((h.record().attachments as unknown[]).length, 1);
  }
});
test("stale, sent, foreign and changed-account drafts never receive an assistant write", async () => {
  for (const mode of ["stale", "sent", "foreign", "scope", "tracking-before-read", "no-version", "wrong-id", "wrong-account-version"]) {
    const h = harness(mode); await assert.rejects(h.run()); assert.equal(h.writes(), 0, mode); assert.equal(h.started(), 0, mode);
  }
});

test("loaded draft version is exact server data, never a recreated timestamp or an unscoped hint", () => {
  assert.deepEqual(inrAssistantMailDraftVersion({ id: DRAFT, user_id: ACCOUNT, updated_at: VERSION }), { id: DRAFT, accountId: ACCOUNT, updatedAt: VERSION });
  for (const value of [{ id: DRAFT, user_id: ACCOUNT }, { id: DRAFT, updated_at: VERSION }, { id: DRAFT, user_id: ACCOUNT, updated_at: "bad" }]) assert.equal(inrAssistantMailDraftVersion(value), null);
});
test("concurrent draft edit wins CAS and incomplete storage never silently drops attachments", async () => {
  for (const mode of ["race", "metadata-unavailable", "readback"]) {
    const h = harness(mode); await assert.rejects(h.run()); assert.equal(h.writes(), 1, mode); assert.equal(h.started(), 1, mode);
    if (mode === "race") assert.equal(h.record().body_text, "Bonjour");
  }
});

test("the actual mailbox loader captures the row timestamp and changing draft identity clears that proof", async () => {
  const source = readFileSync(new URL("../../app/dashboard/mails/MailboxClient.tsx", import.meta.url), "utf8");
  const tree = ts.createSourceFile("MailboxClient.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let open = "", setter = "";
  const walk = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === "openItem") open = node.getText(tree);
    if (ts.isVariableDeclaration(node) && node.name.getText(tree) === "setDraftId") setter = `const ${node.getText(tree)};`;
    ts.forEachChild(node, walk);
  }; walk(tree); assert.ok(open); assert.ok(setter);
  const state: Row = {}, scope: Row = { useCallback: (fn: unknown) => fn, inrAssistantMailDraftVersion, openWorkflowCampaignDraft: () => false,
    inferTrackFromCampaign: () => null, normalizeCampaignAttachments: (value: unknown) => value ?? [], normalizeComposeRecipientHints: (value: unknown) => value ?? [],
    normalizeMailSubject: (value: string) => value, makeComposeSnapshot: JSON.stringify };
  for (const name of ["setSelectedId", "setComposeOpen", "setDraftIdState", "setDraftServerVersion", "setComposeType", "setComposeTemplateKey", "setComposeSourceDocSaveId", "setComposeSourceDocType", "setComposeSourceDocNumber", "setPendingTrack", "setSelectedAccountId", "setTo", "setComposeRecipientHints", "setSubject", "setComposeBody", "setComposeAttachments", "setFiles", "setLastSavedComposeSnapshot"]) scope[name] = (value: unknown) => { state[name] = value; };
  const compiled = ts.transpileModule(`${setter}\n${open}`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const actual = vm.runInNewContext(`(()=>{${compiled};return {openItem,setDraftId}})()`, scope) as { openItem(value: unknown): Promise<void>; setDraftId(value: string | null): void };
  await actual.openItem({ id: DRAFT, source: "send_items", status: "draft", raw: { id: DRAFT, user_id: ACCOUNT, updated_at: VERSION, type: "mail", subject: "Original" } });
  assert.deepEqual(state.setDraftServerVersion, { id: DRAFT, accountId: ACCOUNT, updatedAt: VERSION });
  actual.setDraftId(null); assert.equal(state.setDraftServerVersion, null);
  await actual.openItem({ id: DRAFT, source: "send_items", status: "draft", raw: { id: DRAFT, user_id: ACCOUNT, type: "mail" } });
  assert.equal(state.setDraftServerVersion, null);
});
