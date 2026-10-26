import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import type { ReactNode } from "react";
import { elements, find, invoke, harness } from "./dashboard-assistant-runtime-harness.mts";

const tick = () => new Promise(resolve => setImmediate(resolve));
const session = (tree: ReactNode) => find(tree, node => node.props.actorUserId === "actor-a");
const controls = (tree: ReactNode) => find(tree, node => Boolean(node.props.value)).props.value as { assistantOpen: boolean };
const noModelRequest = () => assert.fail("The first-arrival UI must not call the model, send a message or reconnect an account automatically");

test("only the durable first-arrival callback opens the assistant and marks its static welcome", () => {
  const originalFetch = globalThis.fetch; globalThis.fetch = noModelRequest as typeof fetch;
  const view = harness(true, undefined, undefined, { query: "lang=fr" });
  try {
    let tree = view.providerRender();
    assert.equal(controls(tree).assistantOpen, false);
    assert.equal(session(tree).props.onboardingWelcome, false);
    assert.deepEqual({ ...view.firstArrival(), onWelcome: undefined }, { actorUserId: "actor-a", accountId: "account-a", enabled: true, onWelcome: undefined });
    view.firstArrival()!.onWelcome();
    tree = view.providerRender();
    assert.equal(controls(tree).assistantOpen, true);
    assert.equal(session(tree).props.onboardingWelcome, true);
    assert.equal(elements(tree).some(node => node.type === "aside"), false, "There must not be a second first-visit bubble beside the assistant");
    invoke(session(tree), "minimize");
    assert.equal(controls(view.providerRender()).assistantOpen, false);
    invoke(session(view.providerRender()), "close");
    assert.equal(controls(view.providerRender()).assistantOpen, false);
  } finally { globalThis.fetch = originalFetch; }
});

test("tools, dashboard overlays and a changed establishment never consume an automatic welcome", () => {
  for (const options of [
    { pathname: "/dashboard/mediatheque", query: "" },
    ...["panel=compte", "action=channels", "action=publish", "help=1", "generator=1", "stats=1"].map(query => ({ query })),
  ]) {
    const view = harness(true, undefined, undefined, options); const tree = view.providerRender();
    assert.equal(view.firstArrival()?.enabled, false, JSON.stringify(options));
    assert.equal(controls(tree).assistantOpen, false);
    assert.equal(session(tree).props.onboardingWelcome, false);
  }
  const view = harness(true, undefined, undefined, { query: "" });
  view.providerRender(); const staleWelcome = view.firstArrival()!.onWelcome;
  view.switchAccount(); staleWelcome();
  assert.equal(controls(view.providerRender()).assistantOpen, false, "A stale welcome must not open in a different establishment");
});

test("the welcome suggests a channel connection but only fills the composer after an explicit click", () => {
  const originalFetch = globalThis.fetch; globalThis.fetch = noModelRequest as typeof fetch;
  const view = harness(false, undefined, undefined, { onboardingWelcome: true });
  try {
    let tree = view.render();
    assert.ok(elements(tree).some(node => node.props.children === "Welcome, I am your assistant"));
    assert.ok(elements(tree).some(node => node.props.children === "Let us set up your first channel"));
    const button = find(tree, node => node.type === "button" && Array.isArray(node.props.children) && node.props.children[0] === "Connect my first channel");
    invoke(button, "onClick"); tree = view.render();
    assert.equal(find(tree, node => node.type === "textarea").props.value, "Help me connect my first channel");
    assert.equal(view.actions.replies, 0);
    assert.equal(view.navigations.length, 0, "The suggestion does not bypass the official channel connection flow");
  } finally { view.cleanup(); globalThis.fetch = originalFetch; }
});

test("an existing transcript and draft survive a first-arrival welcome flag without being replaced", () => {
  const originalFetch = globalThis.fetch; globalThis.fetch = noModelRequest as typeof fetch;
  const turnId = "10000000-0000-4000-8000-000000000001";
  const storage = new Map([["inrcy_assistant_session_v1:actor-a:account-a", JSON.stringify({ version: 1, actorUserId: "actor-a", accountId: "account-a", updatedAt: Date.now(), messages: [{ role: "user", content: "My earlier request", turnId }, { role: "assistant", content: "My saved answer" }], draft: "My unfinished message", interrupted: false, retryable: false })]]);
  const view = harness(false, storage, undefined, { onboardingWelcome: true });
  try {
    const tree = view.render();
    assert.equal(find(tree, node => node.type === "textarea").props.value, "My unfinished message");
    assert.ok(elements(tree).some(node => node.props.content === "My saved answer"));
    assert.equal(elements(tree).some(node => node.props.children === "Welcome, I am your assistant"), false);
    view.loadHistoryAutomatically();
    assert.equal(find(view.render(), node => node.type === "textarea").props.value, "My unfinished message");
  } finally { view.cleanup(); globalThis.fetch = originalFetch; }
});

function firstArrivalHook() {
  const compiled = ts.transpileModule(readFileSync(new URL("../../app/dashboard/_hooks/useAssistantFirstArrival.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const refs: Array<{ current: unknown }> = []; let index = 0;
  let effect: (() => void | (() => void)) | undefined;
  const browser = { accountId: "account-a", signingOut: false };
  const events = new EventTarget();
  const moduleRecord = { exports: {} as { useAssistantFirstArrival: (options: { actorUserId: string; accountId: string; enabled: boolean; onWelcome: () => void }) => void } };
  const dependencies: Record<string, unknown> = {
    react: { useRef: (initial: unknown) => refs[index++] ||= { current: initial }, useEffect: (callback: typeof effect) => { effect = callback; } },
    "@/lib/browserAccountCache": { getActiveBrowserUserId: () => browser.accountId },
    "@/lib/browserSignOutState": { BROWSER_SIGN_OUT_START_EVENT: "sign-out", isBrowserSignOutInProgress: () => browser.signingOut },
    "@/lib/multicompte/constants": { ACTIVE_INRCY_ACCOUNT_EVENT: "account-switch" },
  };
  new Function("module", "exports", "require", "window", compiled)(moduleRecord, moduleRecord.exports, (name: string) => { assert.ok(name in dependencies, name); return dependencies[name]; }, events);
  return { browser, events, mount(onWelcome: () => void, enabled = true) {
    index = 0; moduleRecord.exports.useAssistantFirstArrival({ actorUserId: "actor-a", accountId: "account-a", enabled, onWelcome });
    return effect?.() as (() => void) | undefined;
  } };
}

test("the real hook shares its first claim across Strict Mode and never starts an AI request", async () => {
  const originalFetch = globalThis.fetch; const requests: Array<{ url: string; init?: RequestInit; resolve: (response: Response) => void }> = [];
  globalThis.fetch = ((url: string, init?: RequestInit) => new Promise<Response>(resolve => requests.push({ url, init, resolve }))) as typeof fetch;
  const hook = firstArrivalHook(); let welcomes = 0;
  let cleanup: (() => void) | undefined;
  try {
    cleanup = hook.mount(() => welcomes++); cleanup?.();
    cleanup = hook.mount(() => welcomes++);
    assert.equal(requests.length, 1, "Strict Mode must share the same atomic account claim");
    assert.equal(requests[0].url, "/api/dashboard/setup-intro");
    assert.equal(requests[0].init?.credentials, "include"); assert.equal(requests[0].init?.method, "POST");
    assert.deepEqual(JSON.parse(String(requests[0].init?.body)), { accountId: "account-a" });
    requests[0].resolve(Response.json({ accountId: "account-a", show: true })); await tick();
    assert.equal(welcomes, 1); assert.equal(requests.length, 1);
    hook.events.dispatchEvent(new Event("account-switch")); await tick();
    assert.equal(requests.length, 1, "The mounted scope must not replay its successful welcome");
  } finally { cleanup?.(); globalThis.fetch = originalFetch; }
});

test("the real durable claim keeps existing accounts quiet and rejects late account/logout results", async () => {
  const originalFetch = globalThis.fetch;
  try {
    for (const scenario of ["seen", "different-response", "account-switch", "logout", "disabled"]) {
      let complete!: (response: Response) => void; let requests = 0; let welcomes = 0;
      globalThis.fetch = ((url: string) => { assert.equal(url, "/api/dashboard/setup-intro"); requests++; return new Promise<Response>(resolve => { complete = resolve; }); }) as typeof fetch;
      const hook = firstArrivalHook(); const cleanup = hook.mount(() => welcomes++, scenario !== "disabled");
      if (scenario === "disabled") { assert.equal(requests, 0); continue; }
      if (scenario === "account-switch") { hook.browser.accountId = "account-b"; hook.events.dispatchEvent(new Event("account-switch")); }
      if (scenario === "logout") { hook.browser.signingOut = true; hook.events.dispatchEvent(new Event("sign-out")); }
      complete(Response.json({ accountId: scenario === "different-response" ? "account-b" : "account-a", show: scenario !== "seen" }));
      await tick(); assert.equal(welcomes, 0, scenario); cleanup?.();
    }
  } finally { globalThis.fetch = originalFetch; }
});
