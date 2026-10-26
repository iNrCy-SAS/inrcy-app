import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import type { useAssistantFirstArrival } from "../../app/dashboard/_hooks/useAssistantFirstArrival.ts";

type HookProps = Parameters<typeof useAssistantFirstArrival>[0];
type Effect = () => void | (() => void);
type HookView = { refs: Array<{ current: unknown }>; nextRef: number; effect?: Effect; dependencies?: unknown[] };
function registeredEffect(view: HookView) {
  const { effect, dependencies } = view;
  assert.ok(effect); assert.ok(dependencies);
  return { effect, dependencies };
}
type FetchCall = { accountId: string; signal: AbortSignal; resolve: (value: Response) => void; reject: (error: Error) => void };
const accountA = "11111111-1111-4111-8111-111111111111";
const accountB = "22222222-2222-4222-8222-222222222222";
const actorA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const actorB = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const ACCOUNT_EVENT = "inrcy:active-account-changed";
const SIGN_OUT_EVENT = "inrcy:browser-sign-out-start";
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

/** Real hook/module lifetime, isolated React effect lifetimes, no browser or external requests. */
function harness() {
  let activeAccount: string | null = accountA;
  let signingOut = false;
  let currentView: HookView | undefined;
  const window = new EventTarget();
  const calls: FetchCall[] = [];
  const timeouts: { milliseconds: number; controller: AbortController }[] = [];
  const dependencies: Record<string, unknown> = {
    react: {
      useRef(initial: unknown) {
        assert.ok(currentView, "React refs belong to a mounted hook instance");
        return currentView.refs[currentView.nextRef++] ||= { current: initial };
      },
      useEffect(effect: Effect, values: unknown[]) {
        assert.ok(currentView);
        assert.equal(currentView.effect, undefined, "This focused harness handles the hook's one real effect");
        currentView.effect = effect; currentView.dependencies = values;
      },
    },
    "@/lib/browserAccountCache": { getActiveBrowserUserId: () => activeAccount },
    "@/lib/browserSignOutState": { BROWSER_SIGN_OUT_START_EVENT: SIGN_OUT_EVENT, isBrowserSignOutInProgress: () => signingOut },
    "@/lib/multicompte/constants": { ACTIVE_INRCY_ACCOUNT_EVENT: ACCOUNT_EVENT },
  };
  const compiled = ts.transpileModule(readFileSync(new URL("../../app/dashboard/_hooks/useAssistantFirstArrival.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const moduleRecord = { exports: {} as { useAssistantFirstArrival: typeof useAssistantFirstArrival } };
  const fetcher = (url: unknown, init: RequestInit = {}) => {
    assert.equal(url, "/api/dashboard/setup-intro", "First arrival can call only its existing atomic onboarding endpoint, never AI or a provider");
    assert.equal(init.method, "POST"); assert.equal(init.credentials, "include"); assert.equal(init.cache, "no-store");
    assert.equal(new Headers(init.headers).get("content-type"), "application/json");
    const body: unknown = JSON.parse(String(init.body));
    assert.ok(body && typeof body === "object" && "accountId" in body);
    assert.deepEqual(Object.keys(body), ["accountId"], "Neither an actor nor client-owned welcome/plan fields are sent");
    assert.equal(typeof body.accountId, "string");
    assert.ok(init.signal instanceof AbortSignal);
    const signal = init.signal;
    return new Promise<Response>((resolve, reject) => {
      const aborted = () => reject(new DOMException("Request timed out", "TimeoutError"));
      signal.addEventListener("abort", aborted, { once: true });
      const finish = (response: Response) => { signal.removeEventListener("abort", aborted); resolve(response); };
      const fail = (error: Error) => { signal.removeEventListener("abort", aborted); reject(error); };
      calls.push({ accountId: body.accountId as string, signal, resolve: finish, reject: fail });
    });
  };
  vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, {
    window, fetch: fetcher,
    AbortSignal: { timeout(milliseconds: number) { const controller = new AbortController(); timeouts.push({ milliseconds, controller }); return controller.signal; } },
  })((name: string) => {
    assert.ok(Object.hasOwn(dependencies, name), `Unexpected first-arrival dependency: ${name}`);
    return dependencies[name];
  }, moduleRecord, moduleRecord.exports);

  const mount = (input: Partial<Omit<HookProps, "onWelcome">> = {}) => {
    let welcomes = 0;
    const onWelcome = () => { welcomes++; };
    let props: HookProps = { actorUserId: actorA, accountId: accountA, enabled: true, onWelcome, ...input };
    const state: NonNullable<typeof currentView> = { refs: [], nextRef: 0 };
    let previousDependencies: unknown[] | undefined;
    let latestEffect: Effect | undefined;
    let cleanup: (() => void) | undefined;
    const render = (changes: Partial<HookProps> = {}) => {
      props = { ...props, ...changes };
      state.nextRef = 0; state.effect = undefined; state.dependencies = undefined;
      currentView = state;
      try { moduleRecord.exports.useAssistantFirstArrival(props); } finally { currentView = undefined; }
      const registered = registeredEffect(state);
      latestEffect = registered.effect;
      if (!previousDependencies || previousDependencies.length !== registered.dependencies.length || registered.dependencies.some((value, index) => !Object.is(value, previousDependencies![index]))) {
        cleanup?.();
        cleanup = latestEffect() || undefined;
      }
      previousDependencies = registered.dependencies;
    };
    render();
    return {
      get welcomes() { return welcomes; }, render,
      unmount() { cleanup?.(); cleanup = undefined; },
      strictModeReplay() { cleanup?.(); cleanup = latestEffect?.() || undefined; },
    };
  };
  return {
    calls, timeouts, mount,
    account(value: string | null, notify = true) { activeAccount = value; if (notify) window.dispatchEvent(new Event(ACCOUNT_EVENT)); },
    signOut(value = true, notify = true) { signingOut = value; if (value && notify) window.dispatchEvent(new Event(SIGN_OUT_EVENT)); },
    notifyAccount() { window.dispatchEvent(new Event(ACCOUNT_EVENT)); },
    respond(index: number, value: unknown, status = 200) { calls[index].resolve(Response.json(value, { status })); },
  };
}

test("first arrival performs one private durable claim and Strict Mode replay cannot consume or duplicate the welcome", async () => {
  const h = harness(), view = h.mount();
  view.strictModeReplay(); view.render();
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].accountId, accountA);
  assert.equal(h.timeouts[0].milliseconds, 15_000);
  h.respond(0, { accountId: accountA, show: true }); await flush();
  assert.equal(view.welcomes, 1);
  h.notifyAccount(); h.notifyAccount(); view.render(); await flush();
  assert.equal(view.welcomes, 1); assert.equal(h.calls.length, 1, "An already welcomed live scope never reclaims on browser events");
  view.unmount();
});

test("a Strict Mode replacement mount subscribes to the existing claim without losing the only true server response", async () => {
  const h = harness(), abandoned = h.mount();
  abandoned.unmount();
  const replacement = h.mount();
  assert.equal(h.calls.length, 1);
  h.respond(0, { accountId: accountA, show: true }); await flush();
  assert.equal(abandoned.welcomes, 0); assert.equal(replacement.welcomes, 1);
  replacement.unmount();
});

test("disabled, absent actor, absent account and unhydrated active cache cannot consume a first-arrival claim", async () => {
  for (const input of [{ enabled: false }, { actorUserId: "" }, { accountId: "" }, {}]) {
    const h = harness();
    if (!Object.keys(input).length) h.account(null);
    const view = h.mount(input);
    await flush();
    assert.equal(h.calls.length, 0); assert.equal(view.welcomes, 0);
    view.unmount();
  }
  const h = harness(); h.account(null);
  const view = h.mount();
  h.account(accountA);
  assert.equal(h.calls.length, 1, "A later trusted account-cache event can begin onboarding");
  h.respond(0, { accountId: accountA, show: true }); await flush();
  assert.equal(view.welcomes, 1); view.unmount();
});

test("initial sign-out and a mismatched active account are not eligible for an onboarding claim", async () => {
  const signingOut = harness(); signingOut.signOut();
  const first = signingOut.mount();
  assert.equal(signingOut.calls.length, 0); assert.equal(first.welcomes, 0); first.unmount();
  const switched = harness(); switched.account(accountB);
  const second = switched.mount();
  assert.equal(switched.calls.length, 0); assert.equal(second.welcomes, 0); second.unmount();
});

test("switching establishments ignores the old true claim and welcomes only the current server account", async () => {
  const h = harness(), view = h.mount();
  h.account(accountB);
  view.render({ accountId: accountB });
  assert.deepEqual(h.calls.map(call => call.accountId), [accountA, accountB]);
  h.respond(0, { accountId: accountA, show: true }); await flush();
  assert.equal(view.welcomes, 0);
  h.respond(1, { accountId: accountB, show: true }); await flush();
  assert.equal(view.welcomes, 1); view.unmount();
});

test("an account-cache change without a rerender or notification still rejects a late old-account response", async () => {
  const h = harness(), view = h.mount();
  h.account(accountB, false);
  h.respond(0, { accountId: accountA, show: true }); await flush();
  assert.equal(view.welcomes, 0); assert.equal(h.calls.length, 1); view.unmount();
});

test("sign-out invalidates an outstanding claim even if the sign-out flag is cleared before the response arrives", async () => {
  const h = harness(), view = h.mount();
  h.signOut(); h.signOut(false);
  h.respond(0, { accountId: accountA, show: true }); await flush();
  assert.equal(view.welcomes, 0); view.unmount();
});

test("unmounted and disabled subscribers ignore a pending welcome without opening or starting another request", async () => {
  for (const terminate of ["unmount", "disable"] as const) {
    const h = harness(), view = h.mount();
    if (terminate === "unmount") view.unmount(); else view.render({ enabled: false });
    h.respond(0, { accountId: accountA, show: true }); await flush();
    assert.equal(view.welcomes, 0); assert.equal(h.calls.length, 1); view.unmount();
  }
});

test("false is authoritative across later mounts and the in-flight map never becomes a persistent local first-visit guess", async () => {
  const h = harness(), first = h.mount();
  h.respond(0, { accountId: accountA, show: true }); await flush();
  assert.equal(first.welcomes, 1); first.unmount();
  const later = h.mount();
  assert.equal(h.calls.length, 2, "A settled claim is evicted; a later mount asks the durable server flag");
  h.respond(1, { accountId: accountA, show: false }); await flush();
  assert.equal(later.welcomes, 0); later.unmount();
});

test("malformed, foreign, failed and rejected responses never open the assistant", async () => {
  for (const scenario of [
    { value: { accountId: accountA, show: false } }, { value: { accountId: accountB, show: true } },
    { value: { accountId: accountA, show: "true" } }, { value: { show: true } },
    { value: null }, { value: [] }, { value: { accountId: accountA, show: true }, status: 503 },
    { malformed: true }, { rejected: true },
  ]) {
    const h = harness(), view = h.mount();
    if ("malformed" in scenario) h.calls[0].resolve(new Response("not JSON", { status: 200 }));
    else if ("rejected" in scenario) h.calls[0].reject(new Error("Simulated network failure"));
    else h.respond(0, scenario.value, scenario.status);
    await flush();
    assert.equal(view.welcomes, 0); assert.equal(h.calls.length, 1); view.unmount();
  }
});

test("the deduplication key separates authenticated actors even when the selected establishment is the same", async () => {
  const h = harness(), oldActor = h.mount();
  oldActor.unmount();
  const newActor = h.mount({ actorUserId: actorB });
  assert.equal(h.calls.length, 2, "A different actor cannot subscribe to another actor's pending first-arrival response");
  h.respond(0, { accountId: accountA, show: true }); await flush();
  assert.equal(oldActor.welcomes, 0); assert.equal(newActor.welcomes, 0);
  h.respond(1, { accountId: accountA, show: false }); await flush();
  assert.equal(newActor.welcomes, 0); newActor.unmount();
});

test("the 15-second timeout is harmless and evicts the pending claim so a later account event may retry", async () => {
  const h = harness(), view = h.mount();
  assert.equal(h.timeouts[0].milliseconds, 15_000); assert.equal(h.calls[0].signal.aborted, false);
  h.timeouts[0].controller.abort(new DOMException("Timed out", "TimeoutError")); await flush();
  assert.equal(h.calls[0].signal.aborted, true); assert.equal(view.welcomes, 0);
  h.notifyAccount();
  assert.equal(h.calls.length, 2);
  h.respond(1, { accountId: accountA, show: true }); await flush();
  assert.equal(view.welcomes, 1); view.unmount();
});
