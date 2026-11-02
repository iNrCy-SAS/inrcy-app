import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import type { useAgentCampaignRecipients } from "../../app/dashboard/agent/_hooks/useAgentCampaignRecipients.ts";

type Controller = typeof useAgentCampaignRecipients;
type Options = Parameters<Controller>[0];
type Contact = ReturnType<Controller>["pickerProps"]["filteredContacts"][number];
const base = new URL("../../app/dashboard/agent/", import.meta.url);
const compile = (relative: string) => ts.transpileModule(readFileSync(new URL(relative, base), "utf8"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;
const utilsCode = compile("_lib/agent.utils.ts");
const previewCode = compile("_lib/agent.campaign-preview.ts");
const hookCode = compile("_hooks/useAgentCampaignRecipients.ts");

function fixture(settings: { key?: "grow" | "loyalty"; failLoad?: boolean; failSave?: boolean; failCreate?: boolean } = {}) {
  // The hook has only state and derived values. These slots let the actual hook
  // run on successive renders; CRM and campaign mutations are the only I/O doubles.
  const slots: unknown[] = [];
  let cursor = 0;
  const events: string[] = [];
  const requests: Array<{ url: string; init?: RequestInit }> = [];
  const patches: Record<string, unknown>[] = [];
  const notices: string[] = [];
  const contacts: Contact[] = [
    { id: "alice", email: "ALICE@example.com", first_name: "Alice", category: "professionnel", contact_type: "client", postal_code: "75001", important: true },
    { id: "bob", email: "bob@example.com", first_name: "Bob", category: "particulier", contact_type: "prospect", postal_code: "69001", important: false },
    { id: "no-email", email: "", first_name: "No email" },
  ];
  const react = {
    useState(initial: unknown) {
      const index = cursor++;
      if (!(index in slots)) slots[index] = initial;
      return [slots[index], (next: unknown) => { slots[index] = typeof next === "function" ? next(slots[index]) : next; }];
    },
    useMemo(factory: () => unknown) { return factory(); },
  };
  const execute = (code: string, dependencies: Record<string, unknown>, fetcher?: unknown) => {
    const mod = { exports: {} as Record<string, unknown> };
    new Function("require", "module", "exports", "fetch", code)((name: string) => {
      assert.ok(name in dependencies, "unexpected dependency " + name);
      return dependencies[name];
    }, mod, mod.exports, fetcher);
    return mod.exports;
  };
  const utils = execute(utilsCode, {});
  const preview = execute(previewCode, { "./agent.utils": utils, "./agent.config": new Proxy({}, { get() { throw new Error("Recipient editing must not read publication channel configuration"); } }) });
  const fetcher = async (url: string, init?: RequestInit) => {
    requests.push({ url, init });
    events.push(init?.method === "POST" ? "create-contact" : "load-contacts");
    if (init?.method === "POST") return Response.json(settings.failCreate ? { error: "create failed" } : { id: "new-contact" }, { status: settings.failCreate ? 500 : 200 });
    return Response.json(settings.failLoad ? { error: "load failed" } : { contacts }, { status: settings.failLoad ? 500 : 200 });
  };
  const executeController = execute(hookCode, { react, "../_lib/agent.utils": utils, "../_lib/agent.campaign-preview": preview }, fetcher).useAgentCampaignRecipients as Controller;
  const action = { id: "action-a", payload: { recipients: [{ email: "previous@example.com", display_name: "Previous recipient", phone: "123" }] } } as unknown as NonNullable<Options["selectedPreparedAction"]>;
  const options: Options = {
    selectedPreparedAction: action, selectedKey: settings.key || "grow", campaignSaveState: "idle",
    setCampaignSaveState(value) { options.campaignSaveState = typeof value === "function" ? value(options.campaignSaveState) : value; },
    async patchCampaignAction(body) { patches.push(body); if (settings.failSave) throw new Error("save failed"); return action; },
    i18nT: key => key, showNotice: message => notices.push(message), onOpen: () => events.push("close-other-dialogs"),
  };
  const render = () => { cursor = 0; return executeController(options); };
  return { render, options, requests, patches, notices, events, contacts };
}

test("opening recipients restores the selected action then loads CRM without cache", async () => {
  const f = fixture();
  await f.render().open();
  const current = f.render();
  assert.equal(current.isOpen, true);
  assert.deepEqual(current.pickerProps.selectedRecipientEmails, ["previous@example.com"]);
  assert.equal(current.pickerProps.contactsLoading, false);
  assert.deepEqual(current.pickerProps.filteredContacts.map(contact => contact.id), ["alice", "bob"]);
  assert.deepEqual(f.events, ["close-other-dialogs", "load-contacts"]);
  assert.deepEqual(f.requests[0], { url: "/api/crm/contacts?all=1&pageSize=500", init: { cache: "no-store" } });
  current.close();
  assert.equal(f.render().isOpen, false);
});

test("filters select only matching CRM recipients and preserve unrelated selections", async () => {
  const f = fixture();
  await f.render().open();
  const props = f.render().pickerProps;
  props.onCategoryChange("professionnel"); props.onContactTypeChange("client"); props.onDepartmentChange("75!"); props.onToggleImportantOnly();
  assert.equal(f.render().pickerProps.activeFiltersCount, 4);
  assert.equal(f.render().pickerProps.department, "75");
  assert.deepEqual(f.render().pickerProps.filteredContacts.map(contact => contact.id), ["alice"]);
  f.render().pickerProps.onToggleFiltered();
  assert.deepEqual(f.render().pickerProps.selectedRecipientEmails, ["previous@example.com", "alice@example.com"]);
  assert.equal(f.render().pickerProps.filteredAllSelected, true);
  f.render().pickerProps.onToggleFiltered();
  assert.deepEqual(f.render().pickerProps.selectedRecipientEmails, ["previous@example.com"]);
  f.render().pickerProps.onSearchChange("unmatched");
  assert.deepEqual(f.render().pickerProps.filteredContacts, []);
});

test("saving merges CRM metadata, prior recipients and pending manual addresses exactly once", async () => {
  const f = fixture();
  await f.render().open();
  f.render().pickerProps.onToggleRecipient(" ALICE@example.com ");
  f.render().pickerProps.onManualRecipientsChange("NEW@example.com; new@example.com invalid");
  await f.render().pickerProps.onSave();
  const body = f.patches[0] as { editType: string; recipients: Array<Record<string, unknown>> };
  assert.equal(body.editType, "campaign_recipients");
  assert.deepEqual(body.recipients.map(recipient => recipient.email), ["previous@example.com", "alice@example.com", "new@example.com"]);
  assert.equal(body.recipients[0].phone, "123");
  assert.equal(body.recipients[1].contact_id, "alice");
  assert.equal(body.recipients[2].manual, true);
  assert.equal(f.options.campaignSaveState, "idle");
  assert.equal(f.render().isOpen, false);
  assert.equal(f.render().pickerProps.manualRecipientsInput, "");
});

test("manual addition normalizes and deduplicates addresses; removal is case insensitive", async () => {
  const f = fixture();
  await f.render().open();
  f.render().pickerProps.onManualRecipientsChange("X@example.com x@example.com; invalid");
  f.render().pickerProps.onAddManualRecipients();
  assert.deepEqual(f.render().pickerProps.manualSelectedRecipientEmails, ["previous@example.com", "x@example.com"]);
  assert.equal(f.render().pickerProps.manualRecipientsInput, "");
  f.render().pickerProps.onRemoveSelectedRecipient("X@EXAMPLE.COM");
  assert.deepEqual(f.render().pickerProps.selectedRecipientEmails, ["previous@example.com"]);
});

test("empty selection and a busy shared campaign lock never mutate a campaign", async () => {
  const f = fixture();
  await f.render().open();
  f.render().pickerProps.onRemoveSelectedRecipient("previous@example.com");
  await f.render().pickerProps.onSave();
  assert.deepEqual(f.notices, ["recipient_required"]);
  f.options.campaignSaveState = "saving";
  f.render().pickerProps.onToggleRecipient("alice@example.com");
  await f.render().pickerProps.onSave();
  assert.equal(f.patches.length, 0);
});

test("failed campaign save releases the shared lock and keeps the editor draft", async () => {
  const f = fixture({ failSave: true });
  await f.render().open();
  f.render().pickerProps.onManualRecipientsChange("new@example.com");
  await f.render().pickerProps.onSave();
  assert.equal(f.options.campaignSaveState, "idle");
  assert.equal(f.render().isOpen, true);
  assert.equal(f.render().pickerProps.manualRecipientsInput, "new@example.com");
  assert.equal(f.notices.at(-1), "campaign_recipients_update_failed");
});

for (const [key, expectedType] of [["grow", "prospect"], ["loyalty", "client"]] as const) {
  test(`${key}: CRM creation retains category and target contact type`, async () => {
    const f = fixture({ key });
    f.render().pickerProps.onNewRecipientNameChange("  Person  ");
    f.render().pickerProps.onNewRecipientEmailChange("NEW@example.com");
    await f.render().pickerProps.onAddNewRecipient();
    assert.deepEqual(JSON.parse(String(f.requests[0].init?.body)), { display_name: "Person", email: "new@example.com", phone: "", category: "professionnel", contact_type: expectedType });
    assert.deepEqual(f.events, ["create-contact", "load-contacts"]);
    assert.deepEqual(f.render().pickerProps.selectedRecipientEmails, ["new@example.com"]);
    assert.equal(f.render().pickerProps.newRecipientState, "idle");
    assert.deepEqual(f.render().pickerProps.newRecipientDraft, { name: "", email: "", phone: "" });
  });
}

test("invalid or failed CRM creation keeps the draft and clears loading", async () => {
  const f = fixture({ failCreate: true });
  await f.render().pickerProps.onAddNewRecipient();
  assert.equal(f.requests.length, 0);
  assert.equal(f.notices.at(-1), "email_required");
  f.render().pickerProps.onNewRecipientEmailChange("new@example.com");
  await f.render().pickerProps.onAddNewRecipient();
  assert.equal(f.render().pickerProps.newRecipientDraft.email, "new@example.com");
  assert.equal(f.render().pickerProps.newRecipientState, "idle");
  assert.equal(f.notices.at(-1), "crm_contact_add_failed");
});

test("failed CRM loading leaves the restored recipients editable and clears its spinner", async () => {
  const f = fixture({ failLoad: true });
  await f.render().open();
  assert.equal(f.render().isOpen, true);
  assert.equal(f.render().pickerProps.contactsLoading, false);
  assert.deepEqual(f.render().pickerProps.selectedRecipientEmails, ["previous@example.com"]);
  assert.equal(f.notices.at(-1), "crm_contacts_unavailable");
});
