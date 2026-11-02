import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
type Row = Record<string, unknown>;
function sourceNode(file: string, name: string) {
  const source = ts.createSourceFile(file, readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let found = "";
  function visit(node: ts.Node) { if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node.getText(source); if (ts.isVariableDeclaration(node) && node.name.getText(source) === name) found = `const ${node.getText(source)};`; ts.forEachChild(node, visit); }
  visit(source); assert.ok(found); return found;
}
// Run the actual compose confirmation AND native sender functions. No provider
// or customer is contacted: fetch is a strict local receipt fixture.
function harness(mode = "accepted", provider = "gmail", campaign = false) {
  let current = true, starts = 0, resets = 0; const confirmations: Row[] = [], posts: Row[] = [], accepted: string[] = [];
  const to = campaign ? "alice@example.test,bob@example.test" : "alice@example.test";
  const attachments = [{ bucket: "inrbox_attachments", path: "owned/document.pdf", name: "Document.pdf", type: "application/pdf", size: 120 }];
  const scope = { React: { useCallback: (fn: unknown) => fn }, assistantComposeConsumed: false, assistantConsumed: false,
    attachBusy: false, selectedAccount: { id: "mailbox-owned", provider, email_address: "pro@example.test" }, mailAccounts: [{}],
    to, subject: "Devis exact", text: "Bonjour Alice", html: "<p>Bonjour Alice</p>", composeAttachments: attachments,
    composeType: "mail", pendingTrack: null, composeTemplateKey: "", composeSourceDocSaveId: "doc-owned", composeSourceDocType: "devis", composeSourceDocNumber: "D-42", draftId: "draft-owned", currentComposeSnapshot: "snapshot-exact",
    composeRecipientHintsByEmail: new Map(), crmRecipientsByEmail: new Map(), BULK_CONFIRM_WARNING_THRESHOLD: 20,
    folder: "mails", searchParams: new URLSearchParams(), i18nT: (key: string) => key,
    normalizeEmails: (value: string) => value.split(","), normalizeMailSubject: (value: string) => value,
    normalizeRichMailHtmlForSend: (_text: string, html: string) => html, serializeComposeAttachments: (value: unknown) => value,
    extractTemplatePlaceholders: () => mode === "placeholder" ? ["[CLIENT]"] : [],
    confirmInrcy: async (value: Row) => { confirmations.push(value); if (mode === "edited") current = false; return mode !== "refused" && mode !== "placeholder"; },
    bulkConfirmationMessage: () => "Bulk", getBulkCampaignFolder: () => "mails", isBusinessMailFolder: () => true,
    folderFromTrack: () => "mails", providerSendEndpoint: (value: string) => `/api/inbox/${value}/send`,
    setSendBusy() {}, setToast() {}, setDraftId(value: unknown) { assert.equal(value, null); }, setAssistantConsumedSnapshot(value: unknown) { assert.equal(value, "snapshot-exact"); },
    setComposeOpen() { resets++; }, resetCompose() { resets++; }, updateFolder() { resets++; }, loadHistory: async () => { if (mode === "slow-history") await new Promise(() => {}); },
    fetch: async (url: string, init: RequestInit) => {
      posts.push({ url, body: JSON.parse(String(init.body)) });
      if (mode === "unknown") throw new Error("Transport lost after submit");
      if (mode === "account-after-post") current = false;
      return Response.json(mode === "failure" ? { error: "Refus fournisseur" } : campaign ? { success: true, campaignId: "campaign-owned", queued: 2 } : provider === "gmail" ? { ok: true, id: "provider-id" } : { success: true }, { status: mode === "failure" ? 500 : 200 });
    },
  };
  const source = [sourceNode("app/dashboard/mails/MailboxClient.tsx", "doSend"), sourceNode("app/dashboard/mails/_components/MailboxComposeModal.tsx", "requestSend")].join("\n");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const run = vm.runInNewContext(`(function(){${compiled}; return requestSend;})()`, scope) as (execution: unknown) => Promise<void>;
  return { run: () => run({ isCurrent: () => current, started: () => { starts++; }, accepted: (kind: string) => { accepted.push(kind); } }), manual: () => run(undefined), confirmations, posts, accepted, starts: () => starts, resets: () => resets, attachments };
}
test("native exact compose sends only after current confirmation with its PDF and source link preserved", async () => {
  for (const provider of ["gmail", "microsoft", "imap"]) {
    const h = harness("accepted", provider); await h.run();
    assert.equal(h.confirmations.length, 1); assert.equal(h.posts.length, 1); assert.equal(h.starts(), 1); assert.deepEqual(h.accepted, ["accepted"]);
    const body = h.posts[0].body as Row; assert.deepEqual(body.attachments, h.attachments); assert.equal(body.sourceDocSaveId, "doc-owned");
    assert.equal(body.sendItemId, undefined, "Assistant outgoing history cannot overwrite a concurrently edited draft");
    assert.equal(body.to, "alice@example.test"); assert.equal(body.html, "<p>Bonjour Alice</p>"); assert.equal(h.resets(), 0);
  }
});

test("manual provider sending retains its native history behavior", async () => {
  const h = harness(); await h.manual();
  assert.equal((h.posts[0].body as Row).sendItemId, "draft-owned");
  assert.equal(h.confirmations.length, 0); assert.equal(h.resets(), 3);
});

test("accepted individual and campaign sends do not wait for a slow history refresh", { timeout: 2000 }, async () => {
  for (const campaign of [false, true]) {
    const h = harness("slow-history", "gmail", campaign); await h.run();
    assert.deepEqual(h.accepted, [campaign ? "queued" : "accepted"]);
    assert.equal(h.posts.length, 1);
  }
});

test("verified native draft save acknowledges without awaiting history refresh", { timeout: 2000 }, async () => {
  let saved = false, accepted = false, refreshed = false;
  const scope = {
    assistantComposeConsumed: false, attachBusy: false,
    supabase: { auth: { getUser: async () => ({ data: { user: { id: "owned" } } }) } },
    resolveActiveBrowserUserId: (id: string) => id, getBulkCampaignFolder: () => "mails", pendingTrack: null,
    readWorkflowCampaignState: () => null, workflowReturnKey: null, selectedAccountId: "mailbox-owned", selectedAccount: { provider: "gmail" },
    to: "alice@example.test", subject: "Exact", text: "Bonjour", html: "", composeType: "mail", composeRecipientHints: [],
    normalizeComposeRecipientHints: () => [], normalizeRichMailHtmlForSend: () => "<p>Bonjour</p>",
    composeSourceDocSaveId: null, composeSourceDocType: null, composeSourceDocNumber: null, composeTemplateKey: null,
    serializeComposeAttachments: () => [], composeAttachments: [], draftId: null, lastSavedComposeSnapshot: null,
    persistInrAssistantMailDraft: async (input: { payload: Row }) => { assert.equal(input.payload.user_id, "owned"); saved = true; return "verified-draft"; },
    setDraftId: (id: string) => assert.equal(id, "verified-draft"), setComposeSavedSnapshotFromCurrent() {}, setToast() {}, i18nT: (key: string) => key,
    loadHistory: async () => { refreshed = true; await new Promise(() => {}); },
  };
  const source = ts.transpileModule(sourceNode("app/dashboard/mails/MailboxClient.tsx", "saveDraft"), { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const run = vm.runInNewContext(`(function(){${source};return saveDraft;})()`, scope);
  await run({ isCurrent: () => true, started() {}, accepted() { accepted = true; } });
  assert.equal(saved, true); assert.equal(accepted, true); assert.equal(refreshed, true);
});
test("refused confirmation, changed compose and unresolved placeholders cannot send", async () => {
  for (const mode of ["refused", "edited", "placeholder"]) { const h = harness(mode); await h.run(); assert.equal(h.posts.length, 0); assert.equal(h.starts(), 0); assert.deepEqual(h.accepted, []); }
});
test("failed, uncertain or late cross-account responses cannot become accepted receipts", async () => {
  for (const mode of ["failure", "unknown", "account-after-post"]) {
    const h = harness(mode); if (mode === "unknown") await assert.rejects(h.run()); else await h.run();
    assert.equal(h.posts.length, 1); assert.equal(h.starts(), 1); assert.deepEqual(h.accepted, []); assert.equal(h.resets(), 0);
  }
});
test("native multiple-recipient compose is queued as a campaign and never reported delivered", async () => {
  const h = harness("accepted", "gmail", true); await h.run();
  assert.equal(h.posts[0].url, "/api/crm/campaigns"); assert.deepEqual(h.accepted, ["queued"]); assert.equal(h.posts.length, 1);
  assert.equal(((h.posts[0].body as Row).recipients as unknown[]).length, 2);
});
