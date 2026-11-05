import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as commands from "../../lib/inrAssistantBusinessFormUiCommands.ts";
import * as clauses from "../../lib/inrAssistantActionClause.ts";
import type * as Tools from "../../lib/inrAssistantBusinessFormUiTools.ts";

const accountId = "10000000-0000-4000-8000-000000000001", actorUserId = "10000000-0000-4000-8000-000000000002";
const screen = { pathname: "/dashboard/personnalisation", tool: "Personnalisation", selection: { kind: "business_form" as const, id: "personalization" }, revision: "business_form_test_1", availableCommands: ["configure_business_form" as const] };
function nativeTools(auth = { activeUserId: accountId, authUserId: actorUserId }) {
  const moduleRecord = { exports: {} }, stubs: Record<string, unknown> = {
    "server-only": {}, "./requireUser": { requireUser: async () => auth }, "./inrAssistantActionClause.ts": clauses, "./inrAssistantBusinessFormUiCommands.ts": commands,
  };
  const source = ts.transpileModule(readFileSync(new URL("../../lib/inrAssistantBusinessFormUiTools.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  vm.runInNewContext(`(function(require,module,exports){${source}\n})`)((name: string) => { assert.ok(name in stubs, name); return stubs[name]; }, moduleRecord, moduleRecord.exports);
  return moduleRecord.exports as typeof Tools;
}
const options = (message: string) => ({ accountId, actorUserId, currentUserMessage: message, clientContext: { source: "untrusted_client" as const, screen } });

test("Basic business form commands bind each native view, local draft operation and persistent confirmation without accepting unrelated payloads", () => {
  for (const tab of commands.INR_ASSISTANT_BUSINESS_FORM_TABS.filter(tab => tab !== "all")) assert.ok(commands.parseInrAssistantBusinessFormUiCommand({ command: "configure_business_form", selection: screen.selection, revision: screen.revision, patch: { businessFormAction: "select_tab", businessFormTab: tab } }), tab);
  assert.ok(commands.parseInrAssistantBusinessFormUiCommand({ command: "configure_business_form", selection: screen.selection, revision: screen.revision, patch: { businessFormAction: "open_persistent_reset", businessFormTab: "all" } }));
  for (const patch of [{ businessFormAction: "reset", save: true }, { businessFormAction: "select_tab", businessFormTab: "billing" }, { businessFormAction: "discard", businessFormTab: "identity" }, { businessFormAction: "select_tab", businessFormTab: "all" }, { businessFormAction: "delete_account" }]) assert.equal(commands.parseInrAssistantBusinessFormUiCommand({ command: "configure_business_form", selection: screen.selection, revision: screen.revision, patch }), null);
  assert.equal(commands.isInrAssistantBusinessFormUiCommandAvailable("configure_business_form", "/dashboard/ads", "business_form"), false);
});

test("Basic native form view and draft requests reject quoted advice, wrong objects, wrong tabs and foreign scope", async () => {
  const tool = nativeTools(), message = "Affiche l’onglet Activité de mon entreprise.", input = { command: "configure_business_form", instructionQuote: message, patch: { businessFormAction: "select_tab", businessFormTab: "activity" } };
  const valid = await tool.prepareInrAssistantBusinessFormUiAction(input, options(message)); assert.equal(valid?.ok, true); assert.equal(valid?.status, "ui_action_requested");
  for (const current of ["Comment afficher l’onglet Activité ?", "Ne modifie pas l’onglet Activité.", "Lis ceci : 'Affiche l’onglet Activité de mon entreprise.'", "Demain, affiche l’onglet Activité de mon entreprise."]) assert.equal((await tool.prepareInrAssistantBusinessFormUiAction({ ...input, instructionQuote: current }, options(current)))?.ok, false, current);
  assert.equal((await tool.prepareInrAssistantBusinessFormUiAction({ ...input, patch: { businessFormAction: "select_tab", businessFormTab: "profile" } }, options(message)))?.ok, false);
  assert.equal((await nativeTools({ activeUserId: "foreign", authUserId: actorUserId }).prepareInrAssistantBusinessFormUiAction(input, options(message)))?.ok, false);
  assert.equal((await nativeTools({ activeUserId: accountId, authUserId: "foreign" }).prepareInrAssistantBusinessFormUiAction(input, options(message)))?.ok, false);
  assert.equal((await tool.prepareInrAssistantBusinessFormUiAction({ ...input, documentId: accountId }, options(message)))?.ok, false);
});

test("persistent ADN reset prepares only its personal native confirmation and cannot masquerade as a local reset or an executed deletion", async () => {
  const message = "Réinitialise tout l’ADN.", tool = nativeTools();
  const result = await tool.prepareInrAssistantBusinessFormUiAction({ command: "configure_business_form", instructionQuote: message, patch: { businessFormAction: "open_persistent_reset", businessFormTab: "all" } }, options(message));
  assert.equal(result?.ok, true); assert.ok(result && "confirmationRequired" in result && result.confirmationRequired); assert.match(result!.message, /confirmation native définitive demandée/); assert.match(result!.message, /Aucune donnée ni aucun fichier/);
  assert.equal((await tool.prepareInrAssistantBusinessFormUiAction({ command: "configure_business_form", instructionQuote: message, patch: { businessFormAction: "reset" } }, options(message)))?.ok, false);
});

function expression(file: string, name: string, hook = false) {
  const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), ast = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  let found: ts.Expression | undefined;
  const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name && node.initializer) found = hook && ts.isCallExpression(node.initializer) ? node.initializer.arguments[0] : node.initializer; ts.forEachChild(node, visit); }; visit(ast); assert.ok(found, name);
  return ts.transpileModule(`const callback=(${found.getText(ast)});`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
}
function bind<T>(source: string, dependencies: Record<string, unknown>): T { return new Function("dependencies", `with(dependencies){${source}\nreturn callback;}`)(dependencies) as T; }
function formOption(file: string, property: "apply" | "isApplied") {
  const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), ast = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  let found: ts.Expression | undefined;
  const visit = (node: ts.Node) => { if (ts.isCallExpression(node) && node.expression.getText(ast) === "useInrAssistantBusinessFormCommands" && ts.isObjectLiteralExpression(node.arguments[0])) {
    const field = node.arguments[0].properties.find(field => ts.isPropertyAssignment(field) && field.name.getText(ast) === property); if (field && ts.isPropertyAssignment(field)) found = field.initializer;
  } ts.forEachChild(node, visit); }; visit(ast); assert.ok(found, `${file}:${property}`);
  return ts.transpileModule(`const callback=(${found.getText(ast)});`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
}
type Apply = (patch: commands.InrAssistantBusinessFormPatch, scope: () => boolean) => Promise<boolean | { committed: boolean }>;
test("Basic native general preferences reset and discard protect dirty inputs and never pretend to save them", async () => {
  const source = formOption("app/dashboard/settings/_components/GeneralPreferencesContent.tsx", "apply"), initial = { timezone: "Europe/Paris", currency: "EUR" }, saved = { timezone: "Asia/Bangkok", currency: "THB" };
  for (const action of ["reset", "discard"] as const) for (const outcome of ["cancel", "scope", "apply"] as const) {
    let form = { timezone: "Europe/London", currency: "GBP" }, calls = 0, confirmed = 0;
    const apply = bind<Apply>(source, { form, savedPreferencesSignatureRef: { current: JSON.stringify(saved) }, confirmInrcy: async () => { confirmed++; return outcome !== "cancel"; }, i18nT: (key: string) => key, formT: (key: string) => key,
      reset: () => { calls++; form = { ...initial }; }, setForm: (next: typeof form) => { calls++; form = next; }, setSaved: () => {}, setError: () => {}, onUnsavedChange: () => {} });
    assert.equal(await apply({ businessFormAction: action }, () => outcome !== "scope"), outcome === "apply"); assert.equal(confirmed, 1); assert.equal(calls, outcome === "apply" ? 1 : 0);
    assert.deepEqual(form, outcome === "apply" ? action === "reset" ? initial : saved : { timezone: "Europe/London", currency: "GBP" });
  }
});
test("Basic native AI configuration reset and discard retain their own confirmation and restore only their native form", async () => {
  const file = "app/dashboard/settings/_components/AiConfigurationContent.tsx";
  let form: Record<string, unknown> = { language: "fr", tone: "edited" }, approved = false, live = true; const caches: unknown[][] = [];
  const dependencies = { voiceBusy: false, activeUserIdRef: { current: accountId }, confirmInrcy: async () => approved, configurationT: (key: string) => key, memoryT: (key: string) => key,
    initialForm: { language: "fr", tone: "default" }, readDefaultAppLanguage: () => "en", formRef: { current: form }, setForm: (next: typeof form) => { form = next; }, setSaved: () => {}, setError: () => {}, writeAccountCacheValue: (...args: unknown[]) => caches.push(args), STORAGE_KEY: "configuration", AI_LANGUAGE_CUSTOM_STORAGE_KEY: "custom" };
  const reset = bind<(scope: () => boolean) => Promise<boolean>>(expression(file, "reset"), dependencies);
  assert.equal(await reset(() => live), false); assert.equal(caches.length, 0); approved = true; live = false; assert.equal(await reset(() => live), false); assert.equal(caches.length, 0);
  live = true; assert.equal(await reset(() => live), true); assert.deepEqual(form, { language: "en", tone: "default" }); assert.equal(caches.length, 2); assert.ok(caches.every(args => args[2] === accountId));
  const saved = { language: "es", tone: "saved" }, formRef = { current: form }, saveRef = { current: null as Promise<boolean> | null }, voiceRef = { current: null as string | null };
  const discard = bind<() => boolean>(expression(file, "discardConfigurationDraft"), { inFlightSaveRef: saveRef, voiceTargetRef: voiceRef, formRef, savedFormRef: { current: saved }, setForm: (next: typeof form) => { form = next; }, failedSaveSignatureRef: { current: "failed" }, setSaved: () => {}, setError: () => {}, onUnsavedChange: () => {} });
  voiceRef.current = "instructions"; assert.equal(discard(), false); voiceRef.current = null; assert.equal(discard(), true); assert.equal(form, saved); assert.equal(formRef.current, saved);
});
test("Basic ADN discard invokes the visible tab cancellation and preserves other embedded drafts", async () => {
  const file = "app/dashboard/settings/_components/AiMemoryContent.tsx", calls: string[] = [], profile = { current: { dirty: true, signature: "profile-edit" } }, activity = { current: { dirty: true, signature: "activity-edit" } }, location = { current: { dirty: true, signature: "location-edit" } };
  const cancel = bind<() => Promise<void>>(expression(file, "cancelActiveTabChanges"), { workspaceSaving: false, voiceTargetRef: { current: null }, activeTab: "profile", profileDraftRef: profile, activityDraftRef: activity, locationDraftRef: location,
    profileContentRef: { current: { cancelChanges: () => calls.push("profile") } }, activityContentRef: { current: { cancelChanges: () => calls.push("activity") } }, businessLocationRef: { current: { cancelChanges: () => calls.push("location") } },
    restoreAiMemoryDraft: () => calls.push("memory"), setProfileDirty: () => {}, setProfileDraftSignature: () => {}, setActivityDirty: () => {}, setActivityDraftSignature: () => {}, setLocationDirty: () => {}, setLocationDraftSignature: () => {}, failedAutoSaveSignatureRef: { current: "failed" }, setWorkspaceError: () => {}, setAutoSaveState: () => {} });
  let approved = false;
  const apply = bind<Apply>(formOption(file, "apply"), { hasWorkspaceChanges: true, confirmInrcy: async () => approved, t: (key: string) => key, cancelActiveTabChanges: cancel });
  assert.equal(await apply({ businessFormAction: "discard" }, () => true), false); assert.deepEqual(calls, []); approved = true;
  assert.equal(await apply({ businessFormAction: "discard" }, () => false), false); assert.deepEqual(calls, []);
  assert.equal(await apply({ businessFormAction: "discard" }, () => true), true); assert.deepEqual(calls, ["profile"]);
  assert.equal(profile.current.dirty, false); assert.deepEqual(activity.current, { dirty: true, signature: "activity-edit" }); assert.deepEqual(location.current, { dirty: true, signature: "location-edit" });
  const message = "Annule les modifications de l’onglet Activité de mon ADN.";
  assert.equal((await nativeTools().prepareInrAssistantBusinessFormUiAction({ command: "configure_business_form", instructionQuote: message, patch: { businessFormAction: "discard" } }, { ...options(message), clientContext: { source: "untrusted_client", screen: { ...screen, step: "profile" } } }))?.ok, false);
});
test("Basic personalization selects each real section and nested tab while delegating mutations only to the visible native owner", async () => {
  const file = "app/dashboard/personnalisation/page.tsx", source = formOption(file, "apply");
  for (const tab of commands.INR_ASSISTANT_BUSINESS_FORM_TABS.filter(tab => tab !== "all")) {
    const calls: unknown[] = [], native = { selectTab: (tab: string) => calls.push(["native_tab", tab]), runAssistantAction: async () => { calls.push("company_mutation"); return true; } };
    const apply = bind<Apply>(source, { selectSection: (section: string) => calls.push(["section", section]), companyTabs: ["profile", "activity", "audience", "local", "identity"].map(key => ({ key })), communicationTabs: ["parameters", "instructions", "ctas", "strategy", "news"].map(key => ({ key })),
      companyRef: { current: native }, communicationRef: { current: { runAssistantAction: async () => { calls.push("configuration_mutation"); return true; } } }, setMemoryTab: (tab: string) => calls.push(["memory", tab]), setCommunicationTab: (tab: string) => calls.push(["communication", tab]), section: "communication", communicationMemoryVisible: false });
    assert.equal(await apply({ businessFormAction: "select_tab", businessFormTab: tab }, () => true), true, tab); assert.ok(calls.length > 0); assert.ok(!calls.some(call => typeof call === "string"), "tab selection cannot invoke a mutation");
    assert.deepEqual(await apply({ businessFormAction: "discard" }, () => true), { committed: true }); assert.equal(calls.at(-1), "configuration_mutation");
  }
});
function resetFixture() {
  let release!: (approved: boolean) => void;
  const requests: Array<{ url: string; body: Record<string, unknown> }> = [], dialogs: unknown[] = [], docs = [{ id: "owned-document", path: "private/owned.pdf" }];
  const resetViewerRef = { current: { actorUserId, activeAccountId: accountId } }, browser = { accountId };
  const dependencies = { voiceBusy: false, saving: false, workspaceSaving: false, documentUploadState: "idle", activeTab: "identity", activeTabDefinition: { label: "Identité" }, resetViewerRef,
    getActiveBrowserUserId: () => browser.accountId, setResetDialogTab: (tab: unknown) => dialogs.push(tab),
    confirmInrcy: async () => new Promise<boolean>(resolve => { release = resolve; }), setWorkspaceError: () => {}, setError: () => {}, hideNavigation: true,
    t: (key: string) => key, fetch: async (url: string, init: RequestInit) => { requests.push({ url, body: JSON.parse(String(init.body)) }); return Response.json({ error: "scope_changed" }, { status: 409 }); }, apiErrorMessage: () => "scope_changed" };
  const reset = bind<(tab?: string, scope?: () => boolean) => Promise<boolean>>(expression("app/dashboard/settings/_components/AiMemoryContent.tsx", "resetCurrentTab"), dependencies);
  return { reset, requests, dialogs, docs, browser, resetViewerRef, release: (approved: boolean) => release(approved) };
}
test("the real ADN reset handler opens its native dialog without touching data and a cancelled confirmation never resets files", async () => {
  const h = resetFixture(), pending = h.reset("all"); assert.deepEqual(h.dialogs, ["all"]); assert.equal(h.requests.length, 0); assert.equal(h.docs.length, 1);
  h.release(false); assert.equal(await pending, false); assert.equal(h.requests.length, 0); assert.equal(h.docs[0].path, "private/owned.pdf"); assert.deepEqual(h.dialogs, ["all", null]);
});
test("the real ADN reset binds account and actor before confirmation and rechecks both before any native request", async () => {
  for (const mismatch of ["account", "actor", "browser", "scope"] as const) {
    const h = resetFixture(); let live = true; const pending = h.reset("identity", () => live);
    if (mismatch === "account") h.resetViewerRef.current.activeAccountId = "foreign"; if (mismatch === "actor") h.resetViewerRef.current.actorUserId = "foreign"; if (mismatch === "browser") h.browser.accountId = "foreign"; if (mismatch === "scope") live = false;
    h.release(true); assert.equal(await pending, false, mismatch); assert.equal(h.requests.length, 0, mismatch);
  }
  const current = resetFixture(), pending = current.reset("identity"); current.release(true); assert.equal(await pending, false, "The mock native server refuses the request; no success may be fabricated");
  assert.equal(current.requests.length, 1); assert.deepEqual(current.requests[0].body, { tab: "identity", preserveVocabulary: true, expectedAccountId: accountId, expectedActorUserId: actorUserId });
});

test("business form commit protocol never acknowledges a draft setter before React commits or after a scope switch", async () => {
  const source = readFileSync(new URL("../../app/dashboard/_hooks/useInrAssistantBusinessFormCommands.ts", import.meta.url), "utf8"), ast = ts.createSourceFile("driver.ts", source, ts.ScriptTarget.ES2022, true);
  let layout: ts.Expression | undefined; const visit = (node: ts.Node) => { if (!layout && ts.isCallExpression(node) && node.expression.getText(ast) === "useLayoutEffect") layout = node.arguments[0]; ts.forEachChild(node, visit); }; visit(ast); assert.ok(layout);
  const compiledLayout = ts.transpileModule(`const callback=(${layout.getText(ast)});`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  for (const scopeChanged of [false, true]) {
    let applied = false, live = true, settled = false;
    const options = { id: "general", busy: false, enabled: true, isApplied: () => applied, apply: () => { applied = true; return true; } }, current = { current: { options, revision: "before", scopeKey: "trusted", commits: 1 } }, pending = { current: null };
    const perform = bind<(patch: object, scope: () => boolean) => Promise<boolean>>(expression("app/dashboard/_hooks/useInrAssistantBusinessFormCommands.ts", "perform", true), { actorUserId, activeAccountId: accountId, current, pending, setTimeout, clearTimeout });
    const result = perform({ businessFormAction: "reset" }, () => live); void result.then(() => { settled = true; });
    await new Promise(resolve => setImmediate(resolve)); assert.equal(applied, true); assert.equal(settled, false, "setState is not a native committed result");
    if (scopeChanged) live = false;
    bind<() => void>(compiledLayout, { options, revision: "after", scopeKey: "trusted", current, pending })();
    assert.equal(await result, !scopeChanged);
  }
});
