import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isValidElement, type ReactElement, type ReactNode } from "react";
import ts from "typescript";
import * as clientContext from "../../lib/inrAssistantClientContext.ts";
import * as clientStream from "../../lib/inrAssistantClientStream.ts";

const require = createRequire(import.meta.url);
const source = readFileSync(new URL("../../app/dashboard/_components/DashboardAssistantProvider.tsx", import.meta.url), "utf8");
const compiled = ts.transpileModule(`${source}\nexport { AssistantSession as TestSession, clearActorSessions as TestClearActorSessions };`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText;
export type Props = Record<string, unknown>;
type Element = ReactElement<Props>;
export function elements(tree: ReactNode): Element[] {
  if (Array.isArray(tree)) return tree.flatMap(elements);
  return isValidElement<Props>(tree) ? [tree, ...elements(tree.props.children as ReactNode)] : [];
}
export function find(tree: ReactNode, predicate: (node: Element) => boolean) {
  const node = elements(tree).find(predicate);
  assert.ok(node);
  return node;
}
export function invoke(node: Element, name: string, ...args: unknown[]) {
  (node.props[name] as (...values: unknown[]) => void)(...args);
}

// Execute the real chat callbacks with isolated React state and browser-account
// access. DOM dialog effects are excluded; the request cleanup runs unchanged.
export function harness(providerOnly = false, storage = new Map<string, string>(), scope = { actorUserId: "actor-a", activeAccountId: "account-a" }, options: { onboardingWelcome?: boolean; pathname?: string; query?: string } = {}) {
  let activeAccountId = scope.activeAccountId;
  const states: unknown[] = [];
  const refs: { current: unknown }[] = [];
  let stateIndex = 0;
  let refIndex = 0;
  let effects: (() => void | (() => void))[] = [];
  const handoffs: string[] = [];
  const actions = { minimize: 0, replies: 0, close: 0, navigationChecks: 0 };
  const navigations: string[] = [];
  let arrivalOptions: { actorUserId: string; accountId: string; enabled: boolean; onWelcome: () => void } | undefined;
  let navigationAllowed = true;
  let deferredNavigation = false;
  let releaseNavigation: ((allowed: boolean) => void) | null = null;
  const body = { isConnected: true };
  let nativeModal: { tagName: string; isConnected: boolean } | null = null;
  let onMutation: (() => void) | undefined;
  let portalTarget: unknown;
  const browserDocument = { body, querySelector: () => nativeModal };
  const browserStorage = { get length() { return storage.size; }, key: (index: number) => [...storage.keys()][index] || null, removeItem: (key: string) => { storage.delete(key); }, getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => { storage.set(key, value); } };
  class BrowserMutationObserver {
    constructor(callback: () => void) { onMutation = callback; }
    observe() {}
    disconnect() { onMutation = undefined; }
  }
  const copy = { open: "Open", close: "Close", intro: "Intro", prompt: "Prompt", placeholder: "Request", send: "Send", pending: "Thinking", retry: "Retry", unavailable: "Unavailable", timeout: "Timeout", newChat: "New", you: "You", suggestions: ["Post", "Channel", "Profile"], minimize: "Minimize", human: "Contact team", requestLabel: "My request", exchangeLabel: "Last exchange", mediaReady: "Created media", mediaProcessing: "Media processing", mediaFailed: "Media failed", mediaLibrary: "My media", keepWorking: "You may minimize", moveLeft: "Move window to the left", moveRight: "Move window to the right", interrupted: "Restored interrupted request", reference: "Reference:", history: "History", historyLoading: "Loading history", historyEmpty: "No saved conversations", historyUnavailable: "History unavailable; this conversation stays open", historyOlder: "Older conversations remain available", replaceDraft: "Replace your draft?", openConversation: "Open", keepDraft: "Keep draft", inProgress: "Your request is still in progress; retry manually", collaboration: "Collaboration", collaborating: "Collaborating with", activityUnconfirmed: "Check status", activityStatuses: { running: "Working", completed: "Done", blocked: "Needs input", failed: "Failed" }, onboardingGreeting: "Welcome, I am your assistant", onboardingMessage: "Let us set up your first channel", onboardingConnect: "Connect my first channel", onboardingRequest: "Help me connect my first channel" };
  const moduleRecord = { exports: {} as { TestSession: (props: Props) => ReactNode; default: (props: Props) => ReactNode; TestClearActorSessions: (actor: string) => void } };
  const mockRequire = (name: string) => {
    if (name === "react/jsx-runtime") return require(name);
    if (name === "next/image") return { __esModule: true, default: "img" };
    if (name === "react-dom") return { createPortal: (child: ReactNode, target: unknown) => { portalTarget = target; return child; } };
    if (name === "react") return {
      createContext: require("react").createContext,
      useCallback: (callback: unknown) => callback,
      useMemo: (factory: () => unknown) => factory(),
      useState: (initial: unknown) => {
        const index = stateIndex++;
        if (!(index in states)) states[index] = initial;
        return [states[index], (next: unknown) => { states[index] = typeof next === "function" ? next(states[index]) : next; }];
      },
      useRef: (initial: unknown) => { const index = refIndex++; return refs[index] ||= { current: initial }; },
      useEffect: (effect: () => void | (() => void)) => effects.push(effect),
    };
    if (name === "next-intl") return { useLocale: () => "en-GB" };
    if (name === "next/navigation") return { useRouter: () => ({ push: (href: string) => { navigations.push(href); } }), usePathname: () => options.pathname || "/dashboard", useSearchParams: () => new URLSearchParams(options.query ?? "action=publish&token=secret") };
    if (name.endsWith("/useAssistantFirstArrival")) return { useAssistantFirstArrival: (value: typeof arrivalOptions) => { arrivalOptions = value; } };
    if (name === "@/lib/inrAssistantClientContext") return clientContext;
    if (name === "@/lib/inrAssistantClientStream") return clientStream;
    if (name === "@/lib/browserAccountCache") return { getActiveBrowserUserId: () => activeAccountId };
    if (name === "@/lib/multicompte/constants") return { ACTIVE_INRCY_ACCOUNT_EVENT: "account-changed" };
    if (name === "@/lib/supabaseClient") return {};
    if (name === "./DashboardViewerAccessProvider") return { useDashboardViewerAccess: () => ({ actorUserId: scope.actorUserId, activeAccountId: scope.activeAccountId }) };
    if (name === "./DashboardUnsavedNavigationProvider") return { useDashboardUnsavedNavigation: () => ({ requestNavigation: async (callback: () => unknown) => {
      actions.navigationChecks += 1;
      if (deferredNavigation) {
        deferredNavigation = false;
        if (!await new Promise<boolean>(resolve => { releaseNavigation = resolve; })) return false;
      }
      if (!navigationAllowed) return false;
      await callback();
      return true;
    } }) };
    if (name === "./dashboardAssistantCopy") return { dashboardAssistantCopy: () => copy };
    if (name === "./DashboardAssistantMessageContent") return { __esModule: true, default: () => null };
    if (name.endsWith(".module.css")) return { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
    assert.fail(`Unexpected dependency ${name}`);
  };
  new Function("module", "exports", "require", "document", "MutationObserver", "localStorage", "sessionStorage", compiled)(moduleRecord, moduleRecord.exports, mockRequire, browserDocument, BrowserMutationObserver, browserStorage, browserStorage);
  let restored = false;
  const render = (open = true) => {
    stateIndex = 0; refIndex = 0; effects = [];
    const tree = moduleRecord.exports.TestSession({ ...scope, onboardingWelcome: options.onboardingWelcome === true, allowed: true, open, close: () => { actions.close += 1; }, minimize: () => { actions.minimize += 1; }, onReply: () => { actions.replies += 1; }, onHumanContact: (message: string) => { handoffs.push(message); }, onInternalNavigate: (href: string) => { navigations.push(href); }, onOpenMediaLibrary: () => { navigations.push("/dashboard/mediatheque"); }, screen: clientContext.getInrAssistantClientScreen("/dashboard", new URLSearchParams("action=publish&token=secret")) });
    if (restored) effects[9]();
    return tree;
  };
  const initial = providerOnly ? null : render();
  if (!providerOnly) effects[0]();
  const cleanup = providerOnly ? () => {} : effects[1]() as () => void;
  if (!providerOnly) { effects[8](); restored = true; }
  return {
    initial, render, cleanup, handoffs, actions, navigations, storage,
    firstArrival: () => arrivalOptions,
    clearActorSessions: moduleRecord.exports.TestClearActorSessions,
    restorePosition: () => effects[3](),
    restoreSession: () => effects[8](),
    loadHistoryAutomatically: () => effects[10](),
    allowNavigation: (allowed: boolean) => { navigationAllowed = allowed; },
    deferNavigation: () => { deferredNavigation = true; },
    releaseNavigation: (allowed: boolean) => { releaseNavigation?.(allowed); },
    observePortalHost: () => effects[2](),
    portalTarget: () => portalTarget,
    showNativeHelp: () => { nativeModal = { tagName: "DIALOG", isConnected: true }; onMutation?.(); return nativeModal; },
    closeNativeHelp: () => { if (nativeModal) nativeModal.isConnected = false; nativeModal = null; onMutation?.(); },
    body,
    providerRender: () => {
      stateIndex = 0; refIndex = 0; effects = [];
      return moduleRecord.exports.default({ children: "Page" });
    },
    switchAccount: () => { activeAccountId = "account-b"; },
    submit: (value: string) => {
      invoke(find(render(), node => node.type === "textarea"), "onChange", { target: { value } });
      invoke(find(render(), node => node.type === "form"), "onSubmit", { preventDefault() {} });
    },
  };
}
