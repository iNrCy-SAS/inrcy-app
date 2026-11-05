import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import test from "node:test";
import * as React from "react";
import ts from "typescript";
import * as driver from "../../lib/inrAssistantLocalInterface.ts";
import * as reports from "../../lib/inrAssistantContentReport.ts";

type Row = Record<string, unknown>;
type Element = React.ReactElement<Row>;
type Effect = () => void | (() => void);
const root = process.cwd();
const require = createRequire(import.meta.url);
const scope = { actorUserId: "local-actor", accountId: "local-account", pathname: "/dashboard" };
const messages: Row = Object.fromEntries(["dashboard", "gps", "shell", "settings", "media", "booster", "agent", "mails"].map(name => [name, JSON.parse(readFileSync(resolve(root, `messages/fr-FR/${name}.json`), "utf8"))]));
const translator = (namespace: string) => (key: string, values: Row = {}) => {
  const value = `${namespace}.${key}`.split(".").reduce<unknown>((row, part) => row && typeof row === "object" ? (row as Row)[part] : undefined, messages);
  assert.equal(typeof value, "string", `Missing translation ${namespace}.${key}`);
  return String(value).replace(/\{(\w+)\}/g, (_match, name: string) => String(values[name] ?? `{${name}}`));
};
let nextMount = 0;
function elements(tree: React.ReactNode): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  return React.isValidElement<Row>(tree) ? [tree, ...elements(tree.props.children as React.ReactNode)] : [];
}
function find(tree: React.ReactNode, predicate: (node: Element) => boolean) {
  const result = elements(tree).find(predicate);
  assert.ok(result, "Expected native control is missing");
  return result;
}
const ticks = async () => { for (let i = 0; i < 8; i++) await Promise.resolve(); };

/** Execute the production component AND registration hook. State setters stay
 * uncommitted until render(), so an ACK cannot be supplied by a fake hook or by
 * merely invoking a callback. Browser/clipboard/network boundaries are isolated. */
function harness(file: string, props: Row = {}, passive = false, initialFetch?: (url: string, init?: RequestInit) => Promise<unknown>, exportName = "default") {
  const slots: unknown[] = [], effectSlots = new Map<number, { dependencies?: unknown[]; cleanup?: () => void }>();
  const mount = `basic-local-${++nextMount}`;
  let cursor = 0, effects: Effect[] = [], tree: React.ReactNode, current = true;
  let draft: string | null = "Message initial privé";
  const clipboard: string[] = [];
  let writeText: (text: string) => Promise<void> = async text => { clipboard.push(text); };
  let fetcher: (url: string, init?: RequestInit) => Promise<unknown> = initialFetch ?? (async () => { throw new Error("Unexpected network request"); });
  const storage = new Map<string, string>();
  const nativeRefs = new Map<object, Row>();
  const visibilityObservers = new Set<() => void>();
  class NativeResizeObserver {
    callback: () => void;
    constructor(callback: () => void) { this.callback = callback; visibilityObservers.add(callback); }
    observe() {}
    disconnect() { visibilityObservers.delete(this.callback); }
  }
  class NativeAnchor {
    href: string; isConnected = true; clicks = 0; disabled = false;
    constructor(href: string) { this.href = href; }
    matches() { return this.disabled; }
    click() { this.clicks++; }
  }
  const browserDocument = { body: { style: {} }, documentElement: { style: {} }, activeElement: null, querySelectorAll: () => [], addEventListener() {}, removeEventListener() {} };
  const browserWindow = { innerWidth: 1280, innerHeight: 1000, location: { origin: "https://app.inrcy.com", href: "https://app.inrcy.com/dashboard?private=local" }, addEventListener() {}, removeEventListener() {}, setTimeout: () => 1, clearTimeout() {}, localStorage: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) } };
  const react = {
    ...React,
    useId() { const slot = cursor++; slots[slot] ??= `${mount}-${slot}`; return slots[slot]; },
    useRef(initial: unknown) { const slot = cursor++; slots[slot] ??= { current: initial }; return slots[slot]; },
    useState(initial: unknown) {
      const slot = cursor++;
      if (!(slot in slots)) slots[slot] = typeof initial === "function" ? (initial as () => unknown)() : initial;
      return [slots[slot], (update: unknown) => { slots[slot] = typeof update === "function" ? (update as (previous: unknown) => unknown)(slots[slot]) : update; }];
    },
    useMemo(callback: () => unknown, dependencies: unknown[]) {
      const slot = cursor++, previous = slots[slot] as { dependencies: unknown[]; value: unknown } | undefined;
      if (!previous || previous.dependencies.length !== dependencies.length || dependencies.some((item, index) => !Object.is(item, previous.dependencies[index]))) slots[slot] = { dependencies, value: callback() };
      return (slots[slot] as { value: unknown }).value;
    },
    useCallback(callback: unknown, dependencies: unknown[]) { return react.useMemo(() => callback, dependencies); },
    useEffect(callback: Effect, dependencies?: unknown[]) { if (passive) react.useLayoutEffect(callback, dependencies); },
    useLayoutEffect(callback: Effect, dependencies?: unknown[]) {
      const slot = cursor++, previous = effectSlots.get(slot);
      if (dependencies && previous?.dependencies && dependencies.length === previous.dependencies.length && dependencies.every((item, index) => Object.is(item, previous.dependencies![index]))) return;
      effects.push(() => { previous?.cleanup?.(); const cleanup = callback(); effectSlots.set(slot, { dependencies, cleanup: typeof cleanup === "function" ? cleanup : undefined }); });
    },
  };
  const cache = new Map<string, Row>();
  function load(filePath: string): Row {
    const path = resolve(root, filePath);
    if (cache.has(path)) return cache.get(path)!;
    const record = { exports: {} as Row };
    cache.set(path, record.exports);
    const code = ts.transpileModule(readFileSync(path, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText + (path.endsWith("ResponsiveBottomNav.tsx") && exportName === "nativeMobile" ? "\nmodule.exports.nativeMobile = ResponsiveBottomNavMobile;" : path.endsWith("AgentMediaImage.tsx") && exportName === "nativeImage" ? "\nmodule.exports.nativeImage = ImageAttempt;" : "");
    new Function("module", "exports", "require", "navigator", "requestAnimationFrame", "window", "document", "fetch", "HTMLElement", "ResizeObserver", "HTMLAnchorElement", code)(record, record.exports, (id: string): unknown => {
      if (id === "react") return react;
      if (id === "react/jsx-runtime") return require(id);
      if (id === "react-dom") return { createPortal: (children: React.ReactNode) => children };
      if (id === "next-intl") return { useLocale: () => "fr-FR", useTranslations: translator };
      if (id === "next/navigation") return { usePathname: () => scope.pathname, useSearchParams: () => new URLSearchParams(), useRouter: () => ({ push() { assert.fail("Local menu controls cannot navigate"); } }) };
      if (id.endsWith("DashboardViewerAccessProvider")) return { useDashboardViewerAccess: () => ({ actorUserId: scope.actorUserId, activeAccountId: scope.accountId }) };
      if (id.endsWith("DashboardAssistantProvider")) return { useDashboardAssistant: () => ({ assistantContactDraft: draft }) };
      if (id.endsWith("useDashboardI18n")) return { useDashboardI18n: () => ({ ...(messages.dashboard as Row), locale: "fr-FR" }) };
      if (id.endsWith("useDashboardLanguage")) return { useDashboardLanguage: () => ({ language: "fr-FR", setLanguage() { assert.fail("Opening language choices cannot persist a preference"); } }) };
      if (id.endsWith("useDashboardCompletionChecks")) return { useDashboardCompletionChecks: () => ({ profileIncomplete: false, activityIncomplete: false }) };
      if (id.endsWith("useDashboardNotifications")) return { useDashboardNotifications: () => ({ notifications: [], notificationsCount: 0, unreadNotificationsCount: 0 }) };
      if (id.endsWith("DashboardGeneratorStateProvider")) return { useDashboardGeneratorState: () => ({ isActive: true }) };
      if (id.endsWith("DashboardEditionProvider")) return { useDashboardEdition: () => "basic" };
      if (id.endsWith("DashboardUnsavedNavigationProvider")) return { useDashboardUnsavedNavigation: () => ({ requestNavigation() { assert.fail("Local menu controls cannot navigate"); } }) };
      if (id.endsWith("MailsSettingsContent")) return { MailSignatureSettingsContent: "MailSignatureSettingsContent" };
      if (id.endsWith("useUnsavedExitGuard")) return { useUnsavedExitGuard: () => ({ confirmExit() { assert.fail("Basic help controls cannot open mailbox settings"); } }) };
      if (id === "@/lib/supabaseClient") return { createClient() { assert.fail("Local menu controls cannot change authentication"); } };
      if (id === "@/lib/inrAssistantLocalInterface") return driver;
      if (id === "@/lib/inrAssistantContentReport") return reports;
      if (id === "@/lib/clientSubscriptionBilling") return { detectClientBillingPlatform: () => "web" };
      if (id === "@/lib/browserAccountCache") return { getActiveBrowserUserId: () => scope.accountId, purgeAllBrowserAccountCaches: () => assert.fail("Local menu controls cannot clear account data"), setActiveBrowserUserId: () => assert.fail("Local menu controls cannot switch account") };
      if (id === "@/lib/multicompte/client") return { switchActiveInrcyAccount: () => assert.fail("Local menu controls cannot switch account") };
      if (id.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
      if (id === "next/image") return { __esModule: true, default: "img" };
      if (id === "next/link") return { __esModule: true, default: "a" };
      if (/(?:DashboardToolArtwork|DashboardMobileSelect|DashboardNavigationIcon|DashboardGeneratorOrb|DashboardAssistantTrigger|LegalDocumentsModal|PublishExecutionProgress|PublishExecutionResultModal)$/.test(id)) return { __esModule: true, default: id.split("/").pop() };
      const base = id.startsWith("@/") ? resolve(root, id.slice(2)) : resolve(dirname(path), id);
      const dependency = [base, `${base}.ts`, `${base}.tsx`].find(candidate => existsSync(candidate));
      assert.ok(dependency, `Unresolved production dependency ${id}`);
      return load(dependency);
    }, { clipboard: { writeText: (text: string) => writeText(text) } }, () => 1, browserWindow, browserDocument, (url: string, init?: RequestInit) => fetcher(url, init), class {}, NativeResizeObserver, NativeAnchor);
    cache.set(path, record.exports);
    return record.exports;
  }
  const Component = load(file)[exportName] as (props: Row) => React.ReactNode;
  function render(patch: Row = {}) {
    Object.assign(props, patch); cursor = 0; effects = []; tree = Component(props);
    for (const node of elements(tree)) {
      const ref = node.props.ref as { current: unknown } | undefined;
      if (!ref || typeof ref !== "object") continue;
      let control = nativeRefs.get(ref);
      if (!control) { control = { open: false, visible: true, isConnected: true, focus() {}, contains: () => false, closest: () => null, querySelector: () => null, querySelectorAll: () => [], getBoundingClientRect: () => ({ right: 50, bottom: 60, top: 10 }) }; control.getClientRects = () => control!.visible ? [1] : []; nativeRefs.set(ref, control); }
      control.showModal = () => { control!.open = true; };
      control.close = () => { control!.open = false; (node.props.onClose as (() => void) | undefined)?.(); };
      ref.current = control;
    }
    effects.forEach(effect => effect()); return tree;
  }
  function command(id: driver.InrAssistantLocalInterface, operation: driver.InrAssistantLocalOperation, value: string | null = null) {
    const hint = driver.getInrAssistantLocalInterfaceHints(scope)?.find(item => item.id === id);
    assert.ok(hint, `Native interface ${id} must be mounted and idle`);
    return { command: "control_local_interface" as const, selection: { kind: "account_document" as const, id }, operation, value, revision: hint.revision };
  }
  render();
  return {
    render, get tree() { return tree; }, clipboard,
    setDraft(value: string | null) { draft = value; },
    setClipboard(callback: typeof writeText) { writeText = callback; },
    setFetch(callback: typeof fetcher) { fetcher = callback; },
    setControlVisible(value: boolean) { nativeRefs.forEach(control => { control.visible = value; }); visibilityObservers.forEach(update => update()); },
    anchor(href: string) { return new NativeAnchor(href); },
    command,
    run(command: driver.InrAssistantLocalInterfaceCommand) { return driver.runInrAssistantLocalInterface(command, scope, () => current); },
    reportCommand() { const hint = reports.getInrAssistantContentReportHint(scope); assert.ok(hint, "The native unattempted report must be open"); return { command: "submit_content_report" as const, selection: { kind: "account_document" as const, id: "content_report" as const }, revision: hint.revision }; },
    runReport(command: reports.InrAssistantContentReportCommand) { return reports.runInrAssistantContentReportCommand(command, scope, () => current); },
    invalidate() { current = false; },
    unmount() { current = false; effectSlots.forEach(effect => effect.cleanup?.()); effectSlots.clear(); },
  };
}

function nativeSourceCallback(file: string, name: string, scope: Row): unknown {
  const source = readFileSync(resolve(root, file), "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  let expression: string | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isFunctionDeclaration(node) && node.name?.text === name) expression = node.getText(ast);
    if (ts.isVariableDeclaration(node) && node.name.getText(ast) === name && node.initializer) expression = (ts.isCallExpression(node.initializer) && node.initializer.expression.getText(ast).endsWith("useCallback") ? node.initializer.arguments[0] : node.initializer).getText(ast);
    ts.forEachChild(node, visit);
  }; visit(ast);
  assert.ok(expression, `The shared native callback ${name} must exist`);
  const code = ts.transpileModule(`const nativeCallback = (${expression});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function(...Object.keys(scope), code + "\nreturn nativeCallback;")(...Object.values(scope));
}
function nativePlanningOpen(scope: Row): (target: "calendar" | "help", guard?: () => boolean) => Promise<void> {
  return nativeSourceCallback("app/dashboard/agent/AgentClient.tsx", "requestPlanningWorkspace", scope) as (target: "calendar" | "help", guard?: () => boolean) => Promise<void>;
}

test("Basic Send editor controls require visible buttons real native commits and reject a late Studio handoff", async t => {
  const state = { editing: true, libraryOpen: false, studioTab: null as string | null }; let errors = 0, opened = 0, cleaned = 0;
  let release!: () => void;
  const launch = nativeSourceCallback("app/dashboard/mails/MailboxClient.tsx", "launchPublicationMediaGenerator", {
    normalizeChannelKey: (value: string) => value, activePublicationEditChannelKey: "facebook", detailsItem: { id: "owned-detail" },
    setDetailsActionError: (value: string | null) => { if (value) errors++; },
    createInrStudioHandoff: async () => { await new Promise<void>(resolve => { release = resolve; }); return { href: "/dashboard/generer-media?studio_handoff=owned-key", handoff: { key: "owned-key" } }; },
    clearInrStudioHandoff: async (key: string) => { assert.equal(key, "owned-key"); cleaned++; }, openStudio: () => { opened++; state.studioTab = "generate"; },
  }) as (brief: string, guard: () => boolean) => Promise<void>;
  const library = nativeSourceCallback("app/dashboard/mails/_components/MailboxDetailsModal.tsx", "openPublicationMediaLibrary", { preserveDetailsModalScroll() {}, setPublicationMediaLibraryOpen: (value: boolean) => { state.libraryOpen = value; } }) as () => void;
  const h = harness("app/dashboard/_hooks/useInrAssistantSendEditorControls.ts", { enabled: true, busy: false, stateKey: "owned-detail:facebook:v1", ...state, edit() { state.editing = true; }, library, generate: (guard: () => boolean) => launch("Publication native", guard), videoRetouch() { state.studioTab = "retouch"; }, closeLibrary() { state.libraryOpen = false; } }, false, undefined, "useInrAssistantSendEditorControls"); t.after(() => h.unmount());
  type Bind = (target: string) => (node: unknown) => void;
  const bind = () => h.tree as unknown as Bind;
  assert.equal(await h.run(h.command("send_editor", "select", "library")), false, "The callback is unavailable without its actual native button");
  bind()("library")(h.anchor("https://unused.invalid"));
  let done = false; const openLibrary = h.run(h.command("send_editor", "select", "library")).then(result => { done = true; return result; }); await ticks(); assert.equal(done, false); h.render(state); assert.equal(await openLibrary, true);
  const close = h.run(h.command("send_editor", "close")); h.render(state); assert.equal(await close, true);
  bind()("generate")(h.anchor("https://unused.invalid"));
  const late = h.run(h.command("send_editor", "select", "generate")); h.render({ stateKey: "other-detail:facebook:v2" }); release(); await ticks(); h.render(state);
  assert.equal(await late, false); assert.equal(opened, 0); assert.equal(cleaned, 1); assert.equal(errors, 0, "Late responses do not inject errors into the new detail");
  const success = h.run(h.command("send_editor", "select", "generate")); release(); await ticks(); h.render(state); assert.equal(await success, true); assert.equal(opened, 1);
});

test("Basic Planning confirmation close never invokes a generic final confirmation or its alternate action", async t => {
  let closes = 0, confirmations = 0;
  const h = harness("app/dashboard/agent/_components/AgentFeedbackModals.tsx", { confirmDialog: { title: "Vérifiez", message: "Décision native", confirmLabel: "Confirmer" }, publishExecutionProgress: {}, publishSuccessSummary: null, campaignLaunchNotice: null,
    onCloseConfirm: () => { closes++; }, onConfirm: () => { confirmations++; }, onAlternateConfirm: () => { confirmations++; },
  }); t.after(() => h.unmount());
  const close = h.run(h.command("planning_confirmation", "close")); await ticks(); assert.equal(closes, 1); assert.equal(confirmations, 0);
  h.render({ confirmDialog: null }); assert.equal(await close, true); assert.equal(confirmations, 0);
});

test("Basic Planning image retry uses its native scoped recovery without claiming that the image loaded", async t => {
  const h = harness("app/dashboard/agent/_components/AgentMediaImage.tsx", { src: "/api/storage/content?owned=1", alt: "Aperçu", accountId: scope.accountId, sourceKey: "owned-source" }, true, undefined, "nativeImage"); t.after(() => h.unmount());
  (find(h.tree, node => node.type === "img").props.onError as () => void)(); await ticks(); h.render();
  (find(h.tree, node => node.type === "img").props.onError as () => void)(); h.render();
  assert.ok(elements(h.tree).some(node => node.type === "button"));
  const retry = h.run(h.command("planning_image", "retry")); await ticks(); h.render(); assert.equal(await retry, true);
  assert.ok(elements(h.tree).some(node => node.type === "img" && String(node.props.src).includes("previewRetry=")));
});

test("Basic Send help uses the native parent controls and waits for the actual visible help state", async t => {
  let opens = 0, closes = 0;
  const h = harness("app/dashboard/mails/_components/MailboxHeader.tsx", { helpOpen: false, settingsOpen: false, standardMode: true, onOpenHelp: () => { opens++; }, onCloseHelp: () => { closes++; }, onOpenSettings() { assert.fail("No mailbox access"); }, onCloseSettings() { assert.fail("No mailbox access"); } }); t.after(() => h.unmount());
  let done = false; const open = h.run(h.command("send_help", "open")).then(result => { done = true; return result; }); await ticks(); assert.equal(opens, 1); assert.equal(done, false);
  h.render({ helpOpen: true }); assert.equal(await open, true);
  const close = h.run(h.command("send_help", "close")); await ticks(); assert.equal(closes, 1); h.render({ helpOpen: false }); assert.equal(await close, true);
});

test("Basic Inertia help uses its exact Dashboard native port and cannot open from an unrelated panel", async t => {
  const file = "app/dashboard/DashboardClient.tsx", source = readFileSync(resolve(root, file), "utf8"), ast = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  let call: ts.CallExpression | undefined;
  const visit = (node: ts.Node) => { if (ts.isCallExpression(node) && node.expression.getText(ast) === "useInrAssistantLocalInterface" && ts.isStringLiteralLike(node.arguments[0]) && node.arguments[0].text === "inertia_help") call = node; ts.forEachChild(node, visit); }; visit(ast); assert.ok(call);
  const compiled = ts.transpileModule(`const port = { snapshot: ${call.arguments[1].getText(ast)}, handlers: ${call.arguments[2].getText(ast)}, enabled: ${call.arguments[3].getText(ast)} };`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  let open = false;
  const port = (panel: string) => new Function("helpInertieOpen", "panel", "setHelpInertieOpen", compiled + "\nreturn port;")(open, panel, (value: boolean) => { open = value; }) as { snapshot: unknown; handlers: driver.InrAssistantLocalInterfaceRegistration["handlers"]; enabled: boolean };
  const wrong = port("contact"); assert.equal(wrong.enabled, false); assert.throws(() => wrong.handlers.open!.invoke(null, () => true));
  const commit = (revision: string) => { const entry = port("inertie"); driver.registerInrAssistantLocalInterface("inertia-native-test", { ...scope, id: "inertia_help", revision, handlers: entry.handlers, snapshot: entry.snapshot }); };
  t.after(() => driver.registerInrAssistantLocalInterface("inertia-native-test", null)); commit("inertia-1");
  const command = (operation: "open" | "close", revision: string) => ({ command: "control_local_interface" as const, selection: { kind: "account_document" as const, id: "inertia_help" as const }, operation, value: null, revision });
  let done = false; const opening = driver.runInrAssistantLocalInterface(command("open", "inertia-1"), scope, () => true).then(result => { done = true; return result; }); await ticks(); assert.equal(open, true); assert.equal(done, false); commit("inertia-2"); assert.equal(await opening, true);
  const closing = driver.runInrAssistantLocalInterface(command("close", "inertia-2"), scope, () => true); await ticks(); commit("inertia-3"); assert.equal(await closing, true); assert.equal(open, false);
});

test("Basic Planning header uses its real native exit decision and commits only the requested calendar or help", async t => {
  const state = { calendarOpen: false, helpOpen: false }; let reads = 0, decide!: () => void;
  const open = nativePlanningOpen({
    exitScheduledEditSession(options: { canContinue: () => boolean; onAfterExit: () => void; onDecision: () => void }) { decide = () => { if (options.canContinue()) options.onAfterExit(); options.onDecision(); }; },
    setHelpOpen: (value: boolean) => { state.helpOpen = value; }, setScheduleOpen: (value: boolean) => { state.calendarOpen = value; },
    refreshActions: async () => { reads++; }, refreshScheduledActions: async () => { reads++; },
  });
  const props = { enabled: true, ...state, busy: false, stateKey: "manual-schedule", open, closeHelp: () => { state.helpOpen = false; } };
  const h = harness("app/dashboard/_hooks/useInrAssistantPlanningWorkspaceControls.ts", props, false, undefined, "useInrAssistantPlanningWorkspaceControls"); t.after(() => h.unmount());
  let done = false; const calendar = h.run(h.command("planning_workspace", "open")).then(result => { done = true; return result; });
  await ticks(); assert.equal(done, false); assert.equal(reads, 0); decide(); await ticks(); assert.equal(done, false);
  h.render(state); assert.equal(await calendar, true); assert.equal(reads, 2);
  const help = h.run(h.command("planning_workspace", "select", "help")); decide(); await ticks(); h.render(state); assert.equal(await help, true);
  const close = h.run(h.command("planning_workspace", "close")); h.render(state); assert.equal(await close, true); assert.equal(reads, 2);
  const late = h.run(h.command("planning_workspace", "select", "help")); h.invalidate(); decide(); assert.equal(await late, false); assert.equal(state.helpOpen, false);
});

test("Basic Send native links click only an exact rendered owned-detail target and expose no URL in hints", async t => {
  const h = harness("app/dashboard/_hooks/useInrAssistantSendNativeLinks.ts", { enabled: true, busy: false, stateKey: "owned-publication:facebook:v1" }, false, undefined, "useInrAssistantSendNativeLinks"); t.after(() => h.unmount());
  type Bind = (target: string, href: string) => (node: unknown) => void;
  const bind = () => h.tree as unknown as Bind;
  const anchor = h.anchor("https://provider.invalid/owned-post?private=secret"); bind()("publication", anchor.href)(anchor);
  const download = h.anchor("https://app.inrcy.com/api/media-library/items/owned/content?token=private"); bind()("image:1", download.href)(download);
  assert.ok(!JSON.stringify(driver.getInrAssistantLocalInterfaceHints(scope)).includes("private"));
  assert.equal(await h.run(h.command("send_links", "select", "image:2")), false); assert.equal(download.clicks, 0);
  const open = h.run(h.command("send_links", "select", "publication")); await ticks(); assert.equal(anchor.clicks, 1); h.render(); assert.equal(await open, true);
  const get = h.run(h.command("send_links", "select", "image:1")); h.render(); assert.equal(await get, true); assert.equal(download.clicks, 1);
  const stale = h.command("send_links", "select", "publication"); h.render({ stateKey: "different-record:facebook:v2" }); assert.equal(await h.run(stale), false); assert.equal(anchor.clicks, 1);
  anchor.isConnected = false; assert.equal(await h.run(h.command("send_links", "select", "publication")), false);
  anchor.isConnected = true; anchor.href = "https://provider.invalid/replaced"; assert.equal(await h.run(h.command("send_links", "select", "publication")), false);
  bind()("publication", "javascript:alert(1)")(anchor); assert.equal(await h.run(h.command("send_links", "select", "publication")), false); assert.equal(anchor.clicks, 1);
});

test("Basic emoji controls use only visible native choices and acknowledge an actual insertion commit", async t => {
  const selected: string[] = [];
  const h = harness("app/dashboard/_components/EmojiPickerButton.tsx", { onSelect: (value: string) => selected.push(value) }, true); t.after(() => h.unmount());
  const open = h.run(h.command("emoji_picker", "open")); await ticks(); h.render(); assert.equal(await open, true);
  assert.equal(await h.run(h.command("emoji_picker", "select", JSON.stringify({ field: "emoji", value: "☕" }))), false, "A catalogue emoji absent from the current native group is unavailable");
  const group = h.run(h.command("emoji_picker", "select", JSON.stringify({ field: "group", value: "objects" }))); h.render(); assert.equal(await group, true);
  let done = false;
  const insert = h.run(h.command("emoji_picker", "select", JSON.stringify({ field: "emoji", value: "☕" }))).then(result => { done = true; return result; });
  await ticks(); assert.deepEqual(selected, ["☕"]); assert.equal(done, false);
  h.render(); assert.equal(await insert, true);
  assert.equal(find(h.tree, node => node.type === "button").props["aria-expanded"], false);
});

test("Basic emoji priority selects the open picker and never guesses between closed launchers", async t => {
  const left = harness("app/dashboard/_components/EmojiPickerButton.tsx", { onSelect() {} }, true);
  const right = harness("app/dashboard/_components/EmojiPickerButton.tsx", { onSelect() {} }, true); t.after(() => { left.unmount(); right.unmount(); });
  assert.ok(!driver.getInrAssistantLocalInterfaceHints(scope)?.some(hint => hint.id === "emoji_picker"));
  (find(right.tree, node => node.type === "button").props.onClick as () => void)(); right.render();
  const search = right.run(right.command("emoji_picker", "search", "café")); right.render(); assert.equal(await search, true);
  assert.equal(find(right.tree, node => node.type === "input").props.value, "café");
  assert.equal(find(left.tree, node => node.type === "button").props["aria-expanded"], false);
});

test("Basic engine info closes through the native parent and waits for its committed state", async t => {
  let calls = 0;
  const h = harness("app/dashboard/_components/AiEngineInfoModal.tsx", { open: true, activeEngine: "openai", onClose: () => { calls++; } }); t.after(() => h.unmount());
  let done = false;
  const close = h.run(h.command("engine_info", "close")).then(result => { done = true; return result; });
  await ticks(); assert.equal(calls, 1); assert.equal(done, false);
  h.render({ open: false }); assert.equal(await close, true);
});

test("Basic content report preparation changes the native draft without sending or exposing private fields", async t => {
  const h = harness("app/dashboard/_components/AiContentReportButton.tsx", { surface: "studio", content: "Extrait privé" }, true); t.after(() => h.unmount()); h.render();
  let posts = 0; h.setFetch(async () => { posts++; assert.fail("Preparation cannot submit a report"); });
  const open = h.run(h.command("content_report", "open")); h.render(); assert.equal(await open, true);
  for (const [field, value] of [["reason", "false_information"], ["comment", "Précision privée du professionnel"]]) {
    const select = h.run(h.command("content_report", "select", JSON.stringify({ field, value }))); h.render(); assert.equal(await select, true);
  }
  assert.equal(find(h.tree, node => node.type === "select").props.value, "false_information");
  assert.equal(find(h.tree, node => node.type === "textarea").props.value, "Précision privée du professionnel");
  assert.equal(posts, 0);
  const hints = JSON.stringify({ local: driver.getInrAssistantLocalInterfaceHints(scope), report: reports.getInrAssistantContentReportHint(scope) });
  for (const secret of ["Extrait privé", "Précision privée", "private=local", "false_information"]) assert.ok(!hints.includes(secret));
  const command = h.reportCommand();
  (find(h.tree, node => node.type === "textarea").props.onChange as (event: unknown) => void)({ target: { value: "Brouillon changé" } }); h.render();
  assert.equal(await h.runReport(command), false); assert.equal(posts, 0, "A stale draft revision cannot submit the revised native form");
});

test("Basic dedicated report submission uses the real native payload once and requires the sent render", async t => {
  const h = harness("app/dashboard/_components/AiContentReportButton.tsx", { surface: "studio", content: "Extrait natif" }, true); t.after(() => h.unmount()); h.render();
  const open = h.run(h.command("content_report", "open")); h.render(); await open;
  let posts = 0, release!: () => void; const bodies: Row[] = [];
  h.setFetch(async (url, init) => { assert.equal(url, "/api/content-reports"); assert.equal(init?.method, "POST"); posts++; bodies.push(JSON.parse(String(init?.body))); await new Promise<void>(resolve => { release = resolve; }); return { ok: true, json: async () => ({ ok: true }) }; });
  const command = h.reportCommand(); let done = false;
  const send = h.runReport(command).then(result => { done = true; return result; });
  assert.equal(posts, 1); assert.equal(await h.runReport(command), false); h.render();
  assert.equal(reports.getInrAssistantContentReportHint(scope), undefined);
  release(); await ticks(); assert.equal(done, false, "A network response alone is not a native UI confirmation");
  h.render(); assert.equal(await send, true); assert.equal(posts, 1);
  assert.deepEqual(bodies, [{ surface: "studio", reason: "offensive", comment: "", contentExcerpt: "Extrait natif", sourceUrl: "https://app.inrcy.com/dashboard?private=local" }]);
  assert.ok(elements(h.tree).some(node => node.props.role === "status"));
  assert.equal(await h.runReport(command), false); assert.equal(posts, 1);
});

test("Basic report uncertainty and late scope changes never create automatic retries or false success", async t => {
  for (const failure of ["unknown", "late"]) {
    const h = harness("app/dashboard/_components/AiContentReportButton.tsx", { surface: "studio" }, true); t.after(() => h.unmount()); h.render();
    const open = h.run(h.command("content_report", "open")); h.render(); await open;
    let posts = 0;
    h.setFetch(async () => { posts++; if (failure === "unknown") throw new Error("Network unavailable"); h.invalidate(); return { ok: true, json: async () => ({ ok: true }) }; });
    const command = h.reportCommand(), send = h.runReport(command); await ticks(); h.render();
    assert.equal(await send, false); assert.equal(await h.runReport(command), false); assert.equal(posts, 1);
    assert.equal(reports.getInrAssistantContentReportHint(scope), undefined); h.unmount();
  }
});

test("Basic recharge controls open the actual native dialog and wait for its close event without purchasing", async t => {
  let refreshed = 0;
  const h = harness("app/dashboard/_components/VideoCreditRecharge.tsx", { onRefresh: () => { refreshed++; } }, true, undefined, "MediaCreditRechargeButton"); t.after(() => h.unmount()); h.render();
  let done = false;
  const open = h.run(h.command("video_recharge", "open")).then(value => { done = true; return value; });
  await ticks(); assert.equal(done, false); h.render(); assert.equal(await open, true);
  const dialog = find(h.tree, node => node.type === "dialog"); assert.equal((dialog.props.ref as { current: { open: boolean } }).current.open, true);
  const close = h.run(h.command("video_recharge", "close")); await ticks(); assert.equal(refreshed, 1); h.render(); assert.equal(await close, true);
  h.render({ disabled: true }); assert.ok(!driver.getInrAssistantLocalInterfaceHints(scope)?.some(hint => hint.id === "video_recharge"));
});

test("Basic establishment local controls require a visible native launcher and never switch or create an account", async t => {
  let reads = 0, opens = 0;
  const h = harness("app/dashboard/_components/EstablishmentMenu.tsx", { mobile: true, mobileBackLabel: "Retour au menu", onContact() { assert.fail("Local menu operations cannot contact"); }, onOpen() { opens++; } }, true, async (url, init) => {
    assert.equal(url, "/api/multicompte/accounts"); assert.equal(init?.method, undefined); reads++;
    return { ok: true, json: async () => ({ ok: true, accounts: [], config: { multiAccountEnabled: false, maxEstablishments: 1 } }) };
  }); t.after(() => h.unmount()); h.render();
  const hiddenCommand = h.command("establishment_menu", "open");
  h.setControlVisible(false); h.render();
  assert.ok(!driver.getInrAssistantLocalInterfaceHints(scope)?.some(hint => hint.id === "establishment_menu"));
  assert.equal(await h.run(hiddenCommand), false); assert.equal(opens, 0);
  h.setControlVisible(true); h.render();
  const open = h.run(h.command("establishment_menu", "open")); h.render(); await ticks(); h.render(); assert.equal(await open, true); assert.equal(opens, 1); assert.equal(reads, 1);
  assert.equal(await h.run(h.command("establishment_menu", "select", "other-account-id")), false);
  const back = h.run(h.command("establishment_menu", "select", "back")); h.render(); assert.equal(await back, true);
  assert.equal(find(h.tree, node => node.type === "button").props["aria-expanded"], false);
});

test("Basic dashboard information opens the requested native popover and closes it after a real commit", async t => {
  const h = harness("app/dashboard/_components/DashboardHero.tsx", { generatorPower: 40, dnaPower: 20, aiPower: 20, channelPowerSteps: [], connectedChannels: 2, totalChannels: 5, uiBalance: 3, onOpenChannels() { assert.fail("Information must not navigate"); }, onOpenPersonalization() { assert.fail("Information must not navigate"); } }); t.after(() => h.unmount());
  assert.equal(await h.run(h.command("dashboard_info", "select", "invalid")), false);
  for (const value of ["channels", "dna"]) {
    let done = false;
    const select = h.run(h.command("dashboard_info", "select", value)).then(result => { done = true; return result; }); await ticks(); assert.equal(done, false);
    h.render(); assert.equal(await select, true); assert.equal(elements(h.tree).filter(node => node.props.role === "dialog").length, 1);
  }
  const close = h.run(h.command("dashboard_info", "close")); h.render(); assert.equal(await close, true); assert.ok(!elements(h.tree).some(node => node.props.role === "dialog"));
});

test("Basic drawer close invokes the native guard and cannot acknowledge a still-open or reopened panel", async t => {
  let requested = 0;
  const h = harness("app/dashboard/SettingsDrawer.tsx", { isOpen: true, title: "Réglages", children: "Brouillon", onClose: () => { requested++; } }, true); t.after(() => h.unmount()); h.render();
  const command = h.command("settings_drawer", "close"); let done = false;
  const close = h.run(command).then(result => { done = true; return result; }); await ticks(); assert.equal(requested, 1); assert.equal(done, false);
  h.render(); await ticks(); assert.equal(done, false, "A native confirmation that leaves the parent open is never acknowledged as a close");
  h.render({ isOpen: false }); assert.equal(await close, true);
  h.render({ isOpen: true }); assert.equal(await h.run(command), false); assert.equal(requested, 1);
});

test("Basic mobile menu uses the native menu and language controls without navigation preference writes or logout", async t => {
  // Export the existing private mobile component in the test loader; its full
  // production render/handlers/hooks are unchanged. The responsive wrapper is
  // separately covered by the mobile viewport tests.
  const h = harness("app/dashboard/_components/ResponsiveBottomNav.tsx", {}, false, undefined, "nativeMobile"); t.after(() => h.unmount());
  const open = h.run(h.command("mobile_menu", "open")); await ticks(); h.render(); assert.equal(await open, true);
  assert.ok(elements(h.tree).some(node => node.props.role === "menu"));
  assert.equal(await h.run(h.command("mobile_menu", "select", "logout")), false);
  const language = h.run(h.command("mobile_menu", "select", "language")); h.render(); assert.equal(await language, true);
  assert.ok(elements(h.tree).some(node => node.props.role === "group" && node.props.id === "dashboard-mobile-languages"));
  const close = h.run(h.command("mobile_menu", "close")); h.render(); assert.equal(await close, true);
  assert.ok(!elements(h.tree).some(node => node.props.role === "menu"));
});

const guideProps = { edition: "basic", metaPilotEnabled: false, inrAgentEnabled: false, progress: { channels: 40, dna: 0, ai: 0, connected: 2, total: 5, uiBalance: 10, isActive: true }, onNavigate() { assert.fail("Local help controls must not navigate"); } };

test("Basic help uses native search and theme handlers and waits for the displayed commit", async t => {
  const h = harness("app/dashboard/_components/DashboardUsageGuide.tsx", guideProps); t.after(() => h.unmount());
  let complete = false;
  const pending = h.run(h.command("help", "search", "zzzz-no-match")).then(value => { complete = true; return value; });
  await ticks(); assert.equal(complete, false);
  assert.equal(find(h.tree, node => node.type === "input").props.value, "");
  h.render(); assert.equal(await pending, true);
  assert.equal(find(h.tree, node => node.type === "input").props.value, "zzzz-no-match");
  assert.equal(await h.run(h.command("help", "select", "reviews")), false, "A filtered-out native theme cannot be selected");
  const clear = h.run(h.command("help", "search", "")); h.render(); assert.equal(await clear, true);
  const select = h.run(h.command("help", "select", "reviews"));
  await ticks(); h.render(); assert.equal(await select, true);
  assert.ok(elements(h.tree).some(node => node.type === "h2" && node.props.children === ((messages.dashboard as Row).helpCenter as { goals: { reviews: { title: string } } }).goals.reviews.title));
  const hints = JSON.stringify(driver.getInrAssistantLocalInterfaceHints(scope));
  assert.ok(!hints.includes("zzzz") && !hints.includes("query"), "Hints expose no local search or sheet contents");
});

test("Basic help close waits for the real parent close commit and rejects a stale revision", async t => {
  let closed = 0;
  const h = harness("app/dashboard/_components/HelpModal.tsx", { open: true, title: "Aide", children: "Guide", onClose: () => { closed++; } }); t.after(() => h.unmount());
  const initial = h.command("help_dialog", "close");
  let complete = false;
  const pending = h.run(initial).then(value => { complete = true; return value; });
  await ticks(); assert.equal(closed, 1); assert.equal(complete, false);
  h.render({ open: false }); assert.equal(await pending, true); assert.equal(h.tree, null);
  h.render({ open: true }); assert.equal(await h.run(initial), false); assert.equal(closed, 1);
});

test("Basic legal opens only a native document and verifies modal open and close after rendering", async t => {
  const h = harness("app/dashboard/settings/_components/LegalContent.tsx"); t.after(() => h.unmount());
  const openCommand = h.command("legal", "open", "cga");
  assert.ok(driver.parseInrAssistantLocalInterfaceCommand(openCommand));
  for (const value of ["https://external.invalid", "#delete", "unknown", null]) assert.equal(driver.parseInrAssistantLocalInterfaceCommand({ ...openCommand, value }), null);
  assert.equal(await h.run({ ...openCommand, value: "https://external.invalid" }), false);
  let complete = false;
  const pending = h.run(openCommand).then(value => { complete = true; return value; });
  await ticks(); assert.equal(complete, false); assert.ok(!elements(h.tree).some(node => node.type === "LegalDocumentsModal"));
  h.render(); assert.equal(await pending, true);
  assert.equal(find(h.tree, node => node.type === "LegalDocumentsModal").props.docKey, "cga");
  const close = h.run(h.command("legal", "close")); h.render(); assert.equal(await close, true);
  assert.ok(!elements(h.tree).some(node => node.type === "LegalDocumentsModal"));
});

test("Basic contact copies the reviewed message or fixed coordinates without opening or sending a message", async t => {
  const h = harness("app/dashboard/settings/_components/ContactContent.tsx"); t.after(() => h.unmount());
  (find(h.tree, node => node.type === "textarea").props.onChange as (event: unknown) => void)({ target: { value: "Message corrigé par le professionnel" } }); h.render();
  let release!: () => void;
  h.setClipboard(async text => { h.clipboard.push(text); await new Promise<void>(resolve => { release = resolve; }); });
  let complete = false;
  const copy = h.run(h.command("contact", "copy", "message")).then(value => { complete = true; return value; });
  await ticks(); assert.deepEqual(h.clipboard, ["Message corrigé par le professionnel"]); assert.equal(complete, false);
  release(); await ticks(); assert.equal(complete, false, "Clipboard completion alone is not a rendered confirmation");
  h.render(); assert.equal(await copy, true);
  h.setClipboard(async text => { h.clipboard.push(text); });
  for (const [kind, expected] of [["email", "contact@inrcy.com"], ["phone", "06.31.26.08.12"], ["email", "contact@inrcy.com"]]) {
    const next = h.run(h.command("contact", "copy", kind)); await ticks(); h.render(); assert.equal(await next, true); assert.equal(h.clipboard.at(-1), expected);
  }
  const before = h.clipboard.length;
  assert.equal(await h.run(h.command("contact", "copy", "mailto:external@example.invalid")), false); assert.equal(h.clipboard.length, before);
  const hints = JSON.stringify(driver.getInrAssistantLocalInterfaceHints(scope));
  assert.ok(!hints.includes("corrigé") && !hints.includes("contact@") && !hints.includes("mailto:"));
});

test("Basic contact denies a failed clipboard and an absent message rather than reporting success", async t => {
  const h = harness("app/dashboard/settings/_components/ContactContent.tsx"); t.after(() => h.unmount());
  h.setClipboard(async () => { throw new Error("Clipboard permission denied"); });
  assert.equal(await h.run(h.command("contact", "copy", "email")), false);
  h.setDraft(null); h.render();
  assert.equal(await h.run(h.command("contact", "copy", "message")), false); assert.deepEqual(h.clipboard, []);
});

test("Basic generator refresh uses the native promise and rejects duplicate requests failures and busy state", async t => {
  let calls = 0, release!: (success: boolean) => void;
  const h = harness("app/dashboard/_components/DashboardGeneratorHub.tsx", { onDesktopLeftHost() {}, onDesktopRightHost() {}, onOpenGeneratorHelp() {}, kpisLoading: false, generatorIsActive: true,
    onRefreshGenerator: () => { calls++; return new Promise<boolean>(resolve => { release = resolve; }); },
  }); t.after(() => h.unmount());
  const initial = h.command("generator", "retry");
  let complete = false;
  const refresh = h.run(initial).then(value => { complete = true; return value; });
  assert.equal(calls, 1); assert.equal(await h.run(initial), false); await ticks(); assert.equal(complete, false);
  release(true); await ticks(); assert.equal(complete, false); h.render(); assert.equal(await refresh, true);
  h.render({ onRefreshGenerator: async () => { calls++; return false; } });
  assert.equal(await h.run(h.command("generator", "retry")), false); assert.equal(calls, 2);
  h.render({ kpisLoading: true }); assert.ok(!driver.getInrAssistantLocalInterfaceHints(scope)?.some(item => item.id === "generator"));
  assert.equal(await h.run(initial), false); assert.equal(calls, 2);
  h.render({ kpisLoading: false, onRefreshGenerator: async () => { calls++; return true; } });
  const native = find(h.tree, node => node.type === "button" && String(node.props.className).includes("refreshAction"));
  (native.props.onClick as () => void)(); await ticks(); h.render(); assert.equal(calls, 3, "The visible native button shares the same callback");
});

test("Basic local controls cannot acknowledge a late account or route change", async t => {
  let release!: () => void;
  const h = harness("app/dashboard/settings/_components/ContactContent.tsx"); t.after(() => h.unmount());
  h.setClipboard(() => new Promise<void>(resolve => { release = resolve; }));
  const pending = h.run(h.command("contact", "copy", "email"));
  h.invalidate(); release(); await ticks(); h.render(); assert.equal(await pending, false);
});
