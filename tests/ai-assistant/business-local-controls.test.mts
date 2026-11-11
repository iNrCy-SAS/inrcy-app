import assert from "node:assert/strict";
import * as browserPopover from "../../lib/browserPopover.ts";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import vm from "node:vm";
import * as driver from "../../lib/inrAssistantLocalInterface.ts";
import * as cookiePort from "../../lib/inrAssistantCookieOptions.ts";
const scope = { actorUserId: "local-actor", accountId: "local-account", pathname: "/dashboard" };
type Row = Record<string, unknown>;
function nativeRegistration(file: string, id: driver.InrAssistantLocalInterface, dependencies: Row) {
  const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), ast = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  let call: ts.CallExpression | undefined;
  const visit = (node: ts.Node) => { if (ts.isCallExpression(node) && node.expression.getText(ast) === "useInrAssistantLocalInterface" && (ts.isStringLiteral(node.arguments[0]) && node.arguments[0].text === id || node.arguments[0].getText(ast) === "assistantInterface" && dependencies.assistantInterface === id || ts.isConditionalExpression(node.arguments[0]) && node.arguments[0].getText(ast).includes("pickerKind") && id === (dependencies.pickerKind === "additional" ? "google_additional_category" : "google_primary_category"))) call = node; ts.forEachChild(node, visit); }; visit(ast); assert.ok(call, `${file}:${id}`);
  const code = ts.transpileModule(`const build=()=>({snapshot:${call.arguments[1].getText(ast)},handlers:${call.arguments[2].getText(ast)},enabled:${call.arguments[3]?.getText(ast) || "true"},busy:${call.arguments[4]?.getText(ast) || "false"}});`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const factory = new Function("dependencies", `with(dependencies){${code};return build;}`) as (dependencies: Row) => () => { snapshot: unknown; handlers: driver.InrAssistantLocalInterfaceRegistration["handlers"]; enabled: boolean; busy: boolean };
  // A render closes over that render's values, while setters update the next one.
  const build = () => factory({ ...dependencies })();
  const key = `native-${id}`; let version = 0, current = true;
  const commit = () => { const value = build(); driver.registerInrAssistantLocalInterface(key, value.enabled ? { ...scope, id, snapshot: value.snapshot, handlers: value.handlers, busy: value.busy, revision: `native_${++version}` } : null); };
  commit();
  return { commit, build, invalidate: () => { current = false; }, close: () => driver.registerInrAssistantLocalInterface(key, null), run(operation: driver.InrAssistantLocalOperation, value: string | null = null) {
    const hint = driver.getInrAssistantLocalInterfaceHints(scope)?.find(hint => hint.id === id); assert.ok(hint, id);
    return driver.runInrAssistantLocalInterface({ command: "control_local_interface", selection: { kind: "account_document", id }, operation, value, revision: hint.revision }, scope, () => current);
  } };
}
const tick = async () => { for (let index = 0; index < 5; index++) await Promise.resolve(); };
function nativeFunction(file: string, name: string, dependencies: Row) {
  const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), ast = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX); let found: ts.Expression | ts.FunctionDeclaration | undefined;
  const visit = (node: ts.Node) => { if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name && node.initializer) found = node.initializer; if (ts.isFunctionDeclaration(node) && node.name?.text === name) found = node; ts.forEachChild(node, visit); }; visit(ast); assert.ok(found, name);
  const code = ts.transpileModule(`const fn=(${found.getText(ast)});`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function("dependencies", `with(dependencies){${code};return fn;}`)({ ...dependencies }) as (...args: unknown[]) => unknown;
}
test("Basic Google category pickers close only their own native search and preserve every selected category and the other picker", async () => {
  const file = "app/dashboard/_components/GoogleBusinessCategoriesEditor.tsx", selected = { name: "categories/gcid:plumber", displayName: "Plombier" };
  const states = (["primary", "additional"] as const).map(pickerKind => {
    const state: Row & { query: string | null; value: typeof selected; options: Array<typeof selected>; pageToken: string; nextPageToken: string | null; error: string; loading: boolean; activeIndex: number } = { pickerKind, context: { accountId: scope.accountId }, getActiveBrowserUserId: () => scope.accountId, query: "Électricien", value: selected, disabled: false, options: [selected], pageToken: "page", nextPageToken: "more", error: "", loading: true, activeIndex: 0,
      setQuery: (value: string | null) => { state.query = value; }, setOptions: (value: Array<typeof selected>) => { state.options = value; }, setPageToken: (value: string) => { state.pageToken = value; }, setNextPageToken: (value: string | null) => { state.nextPageToken = value; }, setError: (value: string) => { state.error = value; }, setLoading: (value: boolean) => { state.loading = value; }, setActiveIndex: (value: number) => { state.activeIndex = value; }, close: () => nativeFunction(file, "close", state)() };
    return state;
  });
  const primary = nativeRegistration(file, "google_primary_category", states[0]), additional = nativeRegistration(file, "google_additional_category", states[1]);
  try { assert.equal(driver.getInrAssistantLocalInterfaceHints(scope)?.length, 2); const pending = primary.run("close"); await tick(); primary.commit(); assert.equal(await pending, true); assert.equal(states[0].query, null); assert.equal(states[0].value, selected); assert.equal(states[1].query, "Électricien");
    const second = additional.run("close"); await tick(); additional.commit(); assert.equal(await second, true); assert.equal(states[1].value, selected);
  } finally { primary.close(); additional.close(); }
});
test("Basic Pinterest native rename draft selects one real literal board and cancellation preserves every remote board and new-board draft", async () => {
  const file = "app/dashboard/settings/_components/PinterestSettingsContent.tsx", boards = [{ id: "board-a", name: "Atelier rouge" }, { id: "board-b", name: "Atelier bleu" }];
  const state: Row & { editingBoardId: string | null; editingBoardName: string; settings: { boards: Array<{ id: string; name: string }>; accountConnected: boolean; requiresUpdate: boolean } } = { editingBoardId: null, editingBoardName: "", settings: { boards: structuredClone(boards), accountConnected: true, requiresUpdate: false }, loading: false, syncing: false, boardAction: null, newBoardName: "Keep new board draft", useCallback: (callback: unknown) => callback,
    setEditingBoardId: (id: string | null) => { state.editingBoardId = id; }, setEditingBoardName: (name: string) => { state.editingBoardName = name; }, setNotice() {}, setError() {}, startRenameBoard: (board: unknown) => nativeFunction(file, "startRenameBoard", state)(board) };
  const h = nativeRegistration(file, "pinterest_board_name", state); try {
    assert.equal(await h.run("open", "Invented board"), false); let settled = false; const open = h.run("open", "Atelier rouge").then(ok => { settled = true; return ok; }); await tick(); assert.equal(settled, false); h.commit(); assert.equal(await open, true); assert.equal(state.editingBoardId, "board-a"); assert.equal(state.editingBoardName, "Atelier rouge");
    state.editingBoardName = "Unsaved local rename"; h.commit(); assert.equal(await h.run("open", "board-b"), false); assert.equal(state.editingBoardName, "Unsaved local rename");
    const clear = h.run("clear"); await tick(); h.commit(); assert.equal(await clear, true); assert.equal(state.editingBoardId, null); assert.equal(state.editingBoardName, ""); assert.equal(state.newBoardName, "Keep new board draft"); assert.deepEqual(state.settings.boards, boards);
    state.settings.boards = [{ id: "board-a", name: "Same" }, { id: "board-b", name: "Same" }]; h.commit(); assert.equal(await h.run("open", "Same"), false);
  } finally { h.close(); }
});
test("Basic Pinterest native refresh acknowledges only its completed scoped read and never a failed response or dirty draft", async () => {
  const file = "app/dashboard/settings/_components/PinterestSettingsContent.tsx";
  for (const outcome of ["ok", "failed", "scope"] as const) {
    let account = scope.accountId, release!: (response: Response) => void;
    const state: Row & { settings: Row; completedBoardsRead: number; syncing: boolean; error: unknown; hasUnsavedChanges: boolean } = { settings: { accountConnected: true, requiresUpdate: false, boards: [], defaultBoardId: "" }, completedBoardsRead: 0, syncing: false, error: null, loading: false, boardAction: null, hasUnsavedChanges: false, mountedRef: { current: true }, boardMutationVersion: { current: 0 }, pendingDashboardUpdateRef: { current: false }, useCallback: (callback: unknown) => callback, getActiveBrowserUserId: () => account,
      setSyncing: (value: boolean) => { state.syncing = value; }, setNotice() {}, setError: (value: unknown) => { state.error = value; }, setCompletedBoardsRead: (update: (previous: number) => number) => { state.completedBoardsRead = update(state.completedBoardsRead); }, setSettings: (update: (previous: Row) => Row) => { state.settings = update(state.settings); },
      recentCreatedBoards: new Map(), recentRenamedBoards: new Map(), recentDeletedBoards: new Map(), fetch: (url: string, options: RequestInit) => { assert.equal(url, "/api/integrations/pinterest/boards"); assert.equal(options.method, undefined); return new Promise<Response>(resolve => { release = resolve; }); } };
    for (const helper of ["asRecord", "asBoard", "normalizeBoards", "getPinterestCacheKey", "pruneMutationMap", "mergeLiveBoardsWithRecentMutations", "isPinterestBoardReady", "withPinterestBoardReadiness"]) state[helper] = (...args: unknown[]) => nativeFunction(file, helper, state)(...args);
    state.refreshBoards = (...args: unknown[]) => nativeFunction(file, "refreshBoards", state)(...args);
    const h = nativeRegistration(file, "pinterest_boards", state); try { let settled = false; const read = h.run("retry").then(ok => { settled = true; return ok; }); await tick(); h.commit(); assert.equal(settled, false); assert.equal(state.completedBoardsRead, 0);
      if (outcome === "scope") account = "different-account";
      release(Response.json(outcome === "failed" ? { ok: false } : { ok: true, boards: [{ id: "board-a", name: "Native board" }], defaultBoardId: "board-a" }, { status: outcome === "failed" ? 503 : 200 })); await tick(); await new Promise(resolve => setImmediate(resolve)); h.commit(); assert.equal(await read, outcome === "ok"); assert.equal(state.completedBoardsRead, outcome === "ok" ? 1 : 0); if (outcome === "ok") { state.hasUnsavedChanges = true; h.commit(); assert.equal(h.build().busy, true); }
    } finally { h.close(); }
  }
});
test("Basic CTA channel navigation and choices use native finite controls without modifying saved CTAs or starting a subscription", async () => {
  const file = "app/dashboard/settings/_components/AiChannelCtaPanel.tsx", channels = ["site_web", "gmb", "facebook"].map(key => ({ key }));
  const state = { activeChannel: "site_web", activeIndex: 0, menuOpen: true, assistantActive: true, disabled: false, AI_CTA_CHANNELS: channels, setMenuOpen: (open: boolean) => { state.menuOpen = open; }, setActiveChannel: (key: string) => { state.activeChannel = key; state.activeIndex = channels.findIndex(channel => channel.key === key); }, navigate: (direction: unknown) => nativeFunction(file, "navigate", state)(direction) };
  const h = nativeRegistration(file, "writing_cta_channels", state);
  try { for (const [operation, value, expected] of [["select", "gmb", "gmb"], ["next", null, "facebook"], ["next", null, "site_web"], ["previous", null, "facebook"]] as const) {
    const pending = h.run(operation, value); await tick(); assert.equal(state.activeChannel, expected); assert.equal(state.menuOpen, false); h.commit(); assert.equal(await pending, true);
  } assert.equal(await h.run("select", "threads"), false); assert.equal(await h.run("select", "billing"), false); } finally { h.close(); }
  const choices = nativeRegistration(file, "writing_cta_choices", state);
  try { const opening = choices.run("open"); await tick(); choices.commit(); assert.equal(await opening, true); assert.equal(state.menuOpen, true); const closing = choices.run("close"); await tick(); choices.commit(); assert.equal(await closing, true); } finally { choices.close(); }
});
test("Basic closing the subscription activation choice uses its native close and focus handler without selecting checkout", async () => {
  const file = "app/dashboard/settings/_components/StandardSubscriptionContent.tsx"; let focused = 0;
  const state = { premiumActivationOpen: true, setPremiumActivationOpen: (open: boolean) => { state.premiumActivationOpen = open; }, premiumActivationOpener: { current: { focus: () => { focused++; } } }, closePremiumActivationChoice: () => nativeFunction(file, "closePremiumActivationChoice", state)() };
  const h = nativeRegistration(file, "subscription_activation_choice", state);
  try { const pending = h.run("close"); await tick(); assert.equal(state.premiumActivationOpen, false); assert.equal(focused, 1); h.commit(); assert.equal(await pending, true); } finally { h.close(); }
});
test("Basic Badge link copy uses the exact current native URL and refuses a failed clipboard or invented copy target", async () => {
  const file = "app/dashboard/_components/InrBadgeBubbleActions.tsx", copied: string[] = []; let failed = false;
  const state = { publicUrl: "https://public.example/badge-owned", assistantBadge: true, copiedUrl: "", setCopiedUrl: (value: string) => { state.copiedUrl = value; }, navigator: { clipboard: { writeText: async (value: string) => { if (failed) throw new Error("Clipboard refused"); copied.push(value); } } }, t: (key: string) => key, onNotice() {}, onError() {}, copyLink: () => nativeFunction(file, "copyLink", state)() };
  const h = nativeRegistration(file, "badge_link", state);
  try { assert.equal(await h.run("copy", "other"), false); assert.deepEqual(copied, []); const pending = h.run("copy", "link"); await tick(); h.commit(); assert.equal(await pending, true); assert.deepEqual(copied, [state.publicUrl]); failed = true; assert.equal(await h.run("copy", "link"), false); assert.equal(copied.length, 1); } finally { h.close(); }
});
test("Basic engine information and profession search use native setters and require their displayed committed state", async () => {
  const state = { engineInfoOpen: false, assistantActive: true, setEngineInfoOpen: (open: boolean) => { state.engineInfoOpen = open; } };
  const engine = nativeRegistration("app/dashboard/settings/_components/AiConfigurationContent.tsx", "engine_info", state);
  try {
    let settled = false; const result = engine.run("open").then(ok => { settled = true; return ok; }); await tick(); assert.equal(state.engineInfoOpen, true); assert.equal(settled, false); engine.commit(); assert.equal(await result, true);
    const close = engine.run("close"); await tick(); engine.commit(); assert.equal(await close, true); assert.equal(state.engineInfoOpen, false);
  } finally { engine.close(); }
  const profession = { assistantActive: true, loading: false, saving: false, manualSelectionOpen: false, jobSearchOpen: false, jobSearch: "", setManualSelectionOpen: (open: boolean) => { profession.manualSelectionOpen = open; }, setJobSearchOpen: (open: boolean) => { profession.jobSearchOpen = open; }, setJobSearch: (value: string) => { profession.jobSearch = value; } };
  const picker = nativeRegistration("app/dashboard/settings/_components/ActivityContent.tsx", "profession_picker", profession);
  try {
    const open = picker.run("open"); await tick(); picker.commit(); assert.equal(await open, true); assert.equal(profession.manualSelectionOpen, true);
    const search = picker.run("search", "boulanger"); await tick(); assert.equal(profession.jobSearch, "boulanger"); picker.commit(); assert.equal(await search, true); assert.equal(profession.jobSearchOpen, true);
    const clear = picker.run("clear"); await tick(); picker.commit(); assert.equal(await clear, true); assert.equal(profession.jobSearch, ""); assert.equal(profession.jobSearchOpen, true);
    const close = picker.run("close"); await tick(); picker.commit(); assert.equal(await close, true); assert.equal(profession.manualSelectionOpen, false); assert.equal(profession.jobSearchOpen, false);
    assert.equal(await picker.run("search", "x".repeat(161)), false); profession.assistantActive = false; picker.commit(); assert.equal(driver.getInrAssistantLocalInterfaceHints(scope), undefined);
  } finally { picker.close(); }
});
test("Basic native channel close and previous next wait for the actual native parent commit", async () => {
  let requested = "", settled = false;
  const close = nativeRegistration("app/dashboard/_components/ChannelParametersDialog.tsx", "channel_parameters", { onClose: () => { requested = "close"; } });
  try { const pending = close.run("close").then(ok => { settled = true; return ok; }); await tick(); assert.equal(requested, "close"); assert.equal(settled, false); close.close(); assert.equal(await pending, true); } finally { close.close(); }
  const state = { name: "Google Business", previous: { name: "Site Web", onSelect: () => { requested = "previous"; } }, next: { name: "Facebook", onSelect: () => { requested = "next"; } } };
  const header = nativeRegistration("app/dashboard/_components/ChannelSettingsHeader.tsx", "channel_header", state);
  try { for (const direction of ["previous", "next"] as const) { const pending = header.run(direction); await tick(); assert.equal(requested, direction); state.name = state[direction].name; header.commit(); assert.equal(await pending, true); } } finally { header.close(); }
});
test("Basic language notification and writing length menus use only their visible native variant and wait for the displayed open state", async () => {
  for (const [file, id] of [["app/dashboard/_components/LanguageSelector.tsx", "language_options"], ["app/dashboard/_components/NotificationMenu.tsx", "notification_menu"], ["app/dashboard/settings/_components/AiConfigurationContent.tsx", "writing_web_length_options"], ["app/dashboard/settings/_components/AiConfigurationContent.tsx", "writing_social_length_options"]] as const) {
    let notices = 0, reads = 0; const state = { assistantInterface: id, assistantActive: true, assistantVisible: true, open: false, notificationMenuOpen: false, onOpen: () => { notices++; }, refreshNotifications: () => { reads++; }, setOpen: (value: boolean) => { state.open = value; }, setNotificationMenuOpen: (value: boolean) => { state.notificationMenuOpen = value; } };
    const h = nativeRegistration(file, id, state);
    try { let settled = false; const pending = h.run("open").then(ok => { settled = true; return ok; }); await tick(); assert.equal(settled, false); h.commit(); assert.equal(await pending, true); assert.ok(state.open || state.notificationMenuOpen);
      if (id === "notification_menu") assert.equal(reads, 1); if (id === "language_options" || id === "notification_menu") assert.equal(notices, 1);
      const closing = h.run("close"); await tick(); h.commit(); assert.equal(await closing, true);
      state.assistantVisible = false; state.assistantActive = false; h.commit(); assert.equal(driver.getInrAssistantLocalInterfaceHints(scope), undefined);
    } finally { h.close(); }
  }
});
test("Basic contact message editing remains a scoped local draft with native length validation and no external transmission", async () => {
  const state = { assistantContactDraft: "Résumé original" as string | null, reviewedMessage: "Résumé original", copied: null, nextCopySequence: 1, EMAIL: "contact@example.invalid", PHONE_DISPLAY: "00", copy: async () => { assert.fail("Editing cannot copy or send"); }, setEditedDraft: (value: { source: string | null; message: string }) => { assert.equal(value.source, state.assistantContactDraft); state.reviewedMessage = value.message; } };
  const h = nativeRegistration("app/dashboard/settings/_components/ContactContent.tsx", "contact", state);
  try { const pending = h.run("select", "Résumé exact à relire"); await tick(); h.commit(); assert.equal(await pending, true); assert.equal(state.reviewedMessage, "Résumé exact à relire");
    assert.equal(await h.run("select", "x".repeat(6001)), false); state.assistantContactDraft = null; h.commit(); assert.equal(await h.run("select", "Autre texte"), false);
  } finally { h.close(); }
});
test("Basic ADN location and schedule retry cannot acknowledge an increment or failed read as a successful refresh", async () => {
  for (const [file, id] of [["AiMemoryContent", "dna_sources"], ["BusinessLocationFields", "business_location"], ["BusinessDnaAnalysisScheduleModal", "dna_schedule"]] as const) {
    const state = { assistantActive: true, completedLoadAttempt: 0, loadAttempt: 0, loaded: false, loading: false, saving: false, workspaceSaving: false, analyzing: false, voiceTarget: null, hasWorkspaceChanges: false, documentUploadState: "idle", autofilling: false, disabled: false, dirtyRef: { current: false }, open: true, error: "load-failed", onOpen() {}, onClose() {}, setLoadAttempt: (update: (previous: number) => number) => { state.loadAttempt = update(state.loadAttempt); } };
    const h = nativeRegistration(`app/dashboard/settings/_components/${file}.tsx`, id, state);
    try {
      let settled = false; const pending = h.run("retry").then(ok => { settled = true; return ok; }); await tick(); assert.equal(state.loadAttempt, 1); h.commit(); await tick(); assert.equal(settled, false, id);
      state.loading = true; h.commit(); state.completedLoadAttempt = 1; state.loading = false; h.commit(); await tick(); assert.equal(settled, false, `${id}: a failed read cannot succeed`);
      state.error = ""; state.loaded = true; h.commit(); assert.equal(await pending, true, id);
    } finally { h.close(); }
  }
});
test("Basic cookie settings bridge keeps root banner opening separate from analytics consent and acknowledges only a rendered snapshot", async () => {
  let requested: boolean | null = null;
  cookiePort.registerInrAssistantCookieOptions("root", { available: true, open: false, setOpen: open => { requested = open; } });
  try {
    cookiePort.setNativeInrAssistantCookieOptions(true); assert.equal(requested, true); assert.deepEqual(cookiePort.getInrAssistantCookieOptionsSnapshot(), { available: true, open: false });
    cookiePort.registerInrAssistantCookieOptions("root", { available: true, open: true, setOpen: open => { requested = open; } }); assert.equal(cookiePort.getInrAssistantCookieOptionsSnapshot().open, true);
    cookiePort.registerInrAssistantCookieOptions("duplicate", { available: true, open: true, setOpen() { assert.fail("Ambiguous root banner cannot execute"); } }); assert.throws(() => cookiePort.setNativeInrAssistantCookieOptions(false));
  } finally { cookiePort.registerInrAssistantCookieOptions("duplicate", null); cookiePort.registerInrAssistantCookieOptions("root", null); }
  assert.equal(cookiePort.getInrAssistantCookieOptionsSnapshot().available, false);
});
test("Basic native popover controls use only their explicit element and wait for the real toggle rendering", async () => {
  let open = false, renderedOpen = false, showCalls = 0, hideCalls = 0; const listeners = new Set<() => void>(); let cleanup: (() => void) | undefined;
  const element = { matches: (selector: string) => { assert.equal(selector, ":popover-open"); return open; }, showPopover() { showCalls++; open = true; listeners.forEach(listener => listener()); }, hidePopover() { hideCalls++; open = false; listeners.forEach(listener => listener()); }, addEventListener: (type: string, listener: () => void) => { assert.equal(type, "toggle"); listeners.add(listener); }, removeEventListener: (_type: string, listener: () => void) => { listeners.delete(listener); } };
  const key = "native-popover"; let revision = 0;
  const source = ts.transpileModule(readFileSync(new URL("../../app/dashboard/_hooks/useInrAssistantNativePopover.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const helperModule = { exports: {} as typeof import("../../app/dashboard/_hooks/useInrAssistantNativePopover.ts") }, effects: Array<() => (() => void) | void> = [];
  const dependencies: Row = { "@/lib/browserPopover": browserPopover, react: { useState: () => [renderedOpen, (value: boolean) => { renderedOpen = value; }], useLayoutEffect: (effect: () => (() => void) | void) => effects.push(effect) }, "./useInrAssistantLocalInterface": { useInrAssistantLocalInterface: (id: driver.InrAssistantLocalInterface, snapshot: unknown, handlers: driver.InrAssistantLocalInterfaceRegistration["handlers"], enabled: boolean, busy: boolean) => driver.registerInrAssistantLocalInterface(key, enabled ? { ...scope, id, snapshot, handlers, busy, revision: `popover_${++revision}` } : null) } };
  vm.runInNewContext(`(function(require,module,exports){${source}\n})`)((name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; }, helperModule, helperModule.exports);
  const commit = () => { cleanup?.(); effects.length = 0; helperModule.exports.useInrAssistantNativePopover("channel_board", { current: element as unknown as HTMLElement }); for (const effect of effects) cleanup = effect() || undefined; };
  const run = (operation: "open" | "close") => { const hint = driver.getInrAssistantLocalInterfaceHints(scope)?.find(hint => hint.id === "channel_board"); assert.ok(hint); return driver.runInrAssistantLocalInterface({ command: "control_local_interface", selection: { kind: "account_document", id: "channel_board" }, operation, revision: hint.revision, value: null }, scope, () => true); };
  try {
    commit(); let settled = false; const pending = run("open").then(ok => { settled = true; return ok; }); await tick(); assert.equal(showCalls, 1); assert.equal(open, true); assert.equal(settled, false); commit(); assert.equal(await pending, true);
    const closing = run("close"); await tick(); assert.equal(hideCalls, 1); commit(); assert.equal(await closing, true); assert.equal(open, false);
  } finally { cleanup?.(); driver.registerInrAssistantLocalInterface(key, null); }
});
