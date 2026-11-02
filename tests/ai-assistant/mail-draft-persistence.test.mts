import assert from "node:assert/strict";
import test from "node:test";
import { persistInrAssistantMailDraft } from "../../lib/inrAssistantMailDraftPersistence.ts";
import { normalizeRichMailHtmlForSend } from "../../lib/mailRichText.ts";
type Row = Record<string, unknown>;
const ACCOUNT = "11111111-1111-4111-8111-111111111111", DRAFT = "22222222-2222-4222-8222-222222222222";
function harness(mode = "new") {
  const attachment = { bucket: "inrbox_attachments", path: `${ACCOUNT}/devis.pdf`, name: "Devis.pdf", type: "application/pdf", size: 100 };
  const payload = { user_id: ACCOUNT, status: "draft", integration_id: "mailbox", type: "devis", to_emails: "alice@example.test", subject: "Devis", body_text: "Bonjour", body_html: normalizeRichMailHtmlForSend("Bonjour", ""), attachments: [attachment], draft_state: { stage: "compose" } };
  const baseline = JSON.stringify({ selectedAccountId: "mailbox", composeType: "devis", to: "alice@example.test", subject: "Devis", text: "Bonjour", html: "", attachments: [attachment] });
  let record: Row = mode === "new" ? {} : { ...payload, id: DRAFT, updated_at: "version-1" }, writes = 0, started = 0, current = true;
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
        if (mode === "race" && writes === 0) record.updated_at = "version-other";
        if (mode === "scope") current = false;
        return { data, error: null };
      }
      writes++;
      if (mode === "metadata-unavailable") return { data: null, error: { code: "PGRST204" } };
      if (!inserting && !filters.every(([key, value]) => record[key] === value)) return { data: null, error: null };
      record = { ...record, ...update, id: DRAFT, updated_at: "version-2" };
      if (mode === "readback") record.attachments = [];
      return { data: { id: DRAFT }, error: null };
    };
    const query = { select: () => query, eq: (key: string, value: unknown) => { filters.push([key, value]); return query; }, update: (value: Row) => { update = value; return query; }, insert: (value: Row) => { update = value; inserting = true; return query; }, maybeSingle: async () => execute(), single: async () => execute() };
    return query;
  };
  return { run: () => persistInrAssistantMailDraft({ supabase: { from } as never, accountId: ACCOUNT, draftId: mode === "new" ? null : DRAFT, payload: { ...payload, body_text: "Bonjour modifié", body_html: normalizeRichMailHtmlForSend("Bonjour modifié", "") }, baseline, isCurrent: () => current, onWriteStarted: () => { started++; } }), record: () => record, writes: () => writes, started: () => started };
}
test("native draft save persists and rereads the exact fields and PDF attachments", async () => {
  for (const mode of ["new", "existing"]) {
    const h = harness(mode); assert.equal(await h.run(), DRAFT); assert.equal(h.writes(), 1); assert.equal(h.started(), 1);
    assert.equal(h.record().body_text, "Bonjour modifié"); assert.equal((h.record().attachments as unknown[]).length, 1);
  }
});
test("stale, sent, foreign and changed-account drafts never receive an assistant write", async () => {
  for (const mode of ["stale", "sent", "foreign", "scope"]) {
    const h = harness(mode); await assert.rejects(h.run()); assert.equal(h.writes(), 0, mode); assert.equal(h.started(), 0, mode);
  }
});
test("concurrent draft edit wins CAS and incomplete storage never silently drops attachments", async () => {
  for (const mode of ["race", "metadata-unavailable", "readback"]) {
    const h = harness(mode); await assert.rejects(h.run()); assert.equal(h.writes(), 1, mode); assert.equal(h.started(), 1, mode);
    if (mode === "race") assert.equal(h.record().body_text, "Bonjour");
  }
});
