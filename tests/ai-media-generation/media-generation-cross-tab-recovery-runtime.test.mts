import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as contracts from "../../lib/aiMediaGenerationContracts.ts";
import * as speechBudget from "../../lib/aiMediaVideoSpeechBudget.ts";
import * as models from "../../lib/aiMediaModelCatalog.ts";
import * as transport from "../../lib/aiMediaGenerationTransport.ts";
import * as recovery from "../../lib/aiMediaGenerationRecovery.ts";
import * as requestRules from "../../lib/mediaGenerationClientRequest.ts";
import * as voices from "../../lib/aiMediaCharacterVoiceClient.ts";
import type useMediaGeneration from "../../app/dashboard/_hooks/useMediaGeneration.ts";

type Hook = ReturnType<typeof useMediaGeneration>;
type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void };
const pointer = { requestId: "stored-request-0001", mediaId: "media-before", kind: "image", format: "square" } as const;
const storageKey = (account = "account-a") => `inrcy:media-generation-recovery:v1:${encodeURIComponent(account)}`;
const source = ts.transpileModule(readFileSync(new URL("../../app/dashboard/_hooks/useMediaGeneration.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;
function memory() {
  const entries = new Map<string, string>();
  return { entries, getItem: (key: string) => entries.get(key) ?? null, setItem(key: string, value: string) { entries.set(key, value); }, removeItem(key: string) { entries.delete(key); } };
}
function server() {
  return { draft: true, response: undefined as (() => Response) | undefined,
    item: { id: pointer.mediaId, media_type: "image", signed_url: "https://example.invalid/photo.png" },
  };
}

/** Two real hook instances share only localStorage and a controlled native HTTP server. */
function tab(storage: ReturnType<typeof memory>, backend: ReturnType<typeof server>) {
  const slots: Slot[] = [], effects: Array<() => void> = [];
  const target = new EventTarget(), document = Object.assign(new EventTarget(), { visibilityState: "visible" });
  const calls: Array<{ url: string; method: string }> = [];
  const deferred: Array<{ signal: AbortSignal; resolve: (response: Response) => void }> = [];
  const cancellationAcks: Array<{ resolve: (response: Response) => void }> = [];
  const timers = new Map<ReturnType<typeof setTimeout>, number>();
  let deferStatus = false, deferGenerate = false, deferCancellation = false, deferQuota = false;
  const quotaReplies: Array<{ resolve: (response: Response) => void }> = [];
  let account = "account-a", cursor = 0, dirty = false, now = 0, hook!: Hook;
  let form!: { id: string; role: string; usage: string; data: string }[];
  const changed = (old?: readonly unknown[], next?: readonly unknown[]) => !old || !next || old.length !== next.length || old.some((value, index) => value !== next[index]);
  const react = {
    useState(initial: unknown) {
      const slot = slots[cursor++] ||= { value: typeof initial === "function" ? initial() : initial };
      return [slot.value, (next: unknown) => { const value = typeof next === "function" ? next(slot.value) : next; if (!Object.is(value, slot.value)) { slot.value = value; dirty = true; } }];
    },
    useRef(initial: unknown) { return (slots[cursor++] ||= { value: { current: initial } }).value; },
    useCallback(callback: unknown, deps: readonly unknown[]) { const slot = slots[cursor++] ||= {}; if (changed(slot.deps, deps)) { slot.value = callback; slot.deps = deps; } return slot.value; },
    useEffect(callback: () => void | (() => void), deps: readonly unknown[]) { const slot = slots[cursor++] ||= {}; if (changed(slot.deps, deps)) { slot.deps = deps; effects.push(() => { slot.cleanup?.(); slot.cleanup = callback() || undefined; }); } },
  };
  const browser = {
    localStorage: storage, sessionStorage: memory(), document,
    addEventListener: target.addEventListener.bind(target), removeEventListener: target.removeEventListener.bind(target),
    performance: { now: () => now }, setInterval: () => 1, clearInterval() {},
    setTimeout(callback: () => void, delay: number) { const timer = setTimeout(() => { timers.delete(timer); callback(); }, delay); timers.set(timer, delay); return timer; },
    clearTimeout(timer: ReturnType<typeof setTimeout>) { timers.delete(timer); clearTimeout(timer); },
    requestAnimationFrame(callback: (time: number) => void) { queueMicrotask(() => { now += 1_000; callback(now); }); return 1; },
  };
  const defer = (signal: AbortSignal) => new Promise<Response>((resolve, reject) => {
    signal.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    deferred.push({ signal, resolve });
  });
  const fetch = (url: string, init: RequestInit = {}): Promise<Response> => {
    const method = init.method || "GET";
    calls.push({ url, method });
    if (url.endsWith("/quota")) {
      if (deferQuota) { deferQuota = false; return new Promise(resolve => quotaReplies.push({ resolve })); }
      return Promise.resolve(Response.json({ quota: { accountId: account, creditsReady: true, credits: { remaining: 100, reserved: 0 } } }));
    }
    if (url.startsWith("/api/media-generation/status?")) {
      assert.equal(method, "GET");
      if (deferStatus) { deferStatus = false; return defer(init.signal!); }
      return Promise.resolve(backend.response?.() ?? Response.json({ ok: true, status: "completed", draft: backend.draft, item: backend.item }));
    }
    if (url === `/api/media-generation/drafts/${pointer.mediaId}/accept`) {
      assert.equal(method, "POST"); backend.draft = false;
      return Promise.resolve(Response.json({ ok: true, item: backend.item }));
    }
    if (url === "/api/media-generation/cancel") {
      assert.equal(method, "POST");
      if (deferCancellation) { deferCancellation = false; return new Promise(resolve => cancellationAcks.push({ resolve })); }
      return Promise.resolve(Response.json({ ok: true, status: "processing" }));
    }
    if (url === "/api/media-generation/generate" && deferGenerate) { assert.equal(method, "POST"); deferGenerate = false; return defer(init.signal!); }
    assert.fail(`Unexpected native request: ${method} ${url}`);
  };
  const modules = new Map<string, unknown>([
    ["react", react], ["./useInrAssistantRefresh", { useInrAssistantRefresh() {} }],
    ["@/lib/multicompte/constants", { ACTIVE_INRCY_ACCOUNT_EVENT: "account-change" }],
    ["@/lib/aiMediaGenerationContracts", contracts], ["@/lib/aiMediaVideoSpeechBudget", speechBudget],
    ["@/lib/aiMediaModelCatalog", models], ["@/lib/aiMediaGenerationTransport", transport],
    ["@/lib/aiMediaGenerationRecovery", recovery], ["@/lib/mediaGenerationClientRequest", requestRules],
    ["@/lib/aiMediaCharacterVoiceClient", voices],
  ]);
  const record = { exports: {} as { default: typeof useMediaGeneration } };
  new Function("module", "exports", "require", "window", "fetch", source)(record, record.exports, (name: string) => {
    assert.ok(modules.has(name), `Unexpected hook dependency: ${name}`); return modules.get(name);
  }, browser, fetch);
  const render = () => {
    let turns = 0;
    do {
      assert.ok(++turns < 40); dirty = false; cursor = 0;
      [form] = react.useState([{ id: "selected-photo", role: "character", usage: "required", data: "data:image/png;base64,AAAA" }]) as [typeof form];
      hook = record.exports.default();
      for (const effect of effects.splice(0)) effect();
    } while (dirty);
    return hook;
  };
  const flush = async () => { for (let index = 0; index < 8; index++) { await new Promise(resolve => setImmediate(resolve)); if (dirty) render(); } return hook; };
  const storageEvent = (key: string | null = storageKey()) => { const event = new Event("storage"); Object.defineProperty(event, "key", { value: key }); target.dispatchEvent(event); };
  render();
  return {
    calls, deferred, cancellationAcks, quotaReplies, render, flush, storageEvent, form: () => form, status: () => hook,
    pollTimers: () => [...timers.values()].filter(delay => delay === 2_000).length,
    async ready() { await hook.loadQuota(); await flush(); },
    focus() { target.dispatchEvent(new Event("focus")); },
    visible() { document.dispatchEvent(new Event("visibilitychange")); },
    deferStatus() { deferStatus = true; }, deferGenerate() { deferGenerate = true; },
    deferCancellation() { deferCancellation = true; },
    deferQuota() { deferQuota = true; },
    changeAccount(next: string) { account = next; target.dispatchEvent(new Event("account-change")); render(); },
    dispose() { for (const slot of slots) slot.cleanup?.(); for (const timer of timers.keys()) clearTimeout(timer); },
  };
}
const statusReads = (instance: ReturnType<typeof tab>) => instance.calls.filter(call => call.url.startsWith("/api/media-generation/status?"));

test("acceptance in one tab clears only the stale recovery presentation in another, retaining its photo and roles", async () => {
  const storage = memory(), backend = server(); recovery.writeAiMediaGenerationRecovery(storage, "account-a", pointer);
  const first = tab(storage, backend), second = tab(storage, backend);
  await first.ready(); await second.ready(); const form = second.form();
  assert.equal(second.status().canRecover, true);
  await first.status().retryRecovery(); await first.flush();
  await first.status().acceptDraft(); await first.flush();
  assert.equal(recovery.readAiMediaGenerationRecovery(storage, "account-a"), null);
  second.storageEvent(); await second.flush();
  assert.equal(second.status().canRecover, false); assert.equal(second.status().recoveryContext, null); assert.equal(second.status().result, null);
  assert.equal(second.form(), form); assert.deepEqual(second.form().map(({ role, usage }) => ({ role, usage })), [{ role: "character", usage: "required" }]);
  assert.equal(statusReads(second).length, 1); assert.ok(second.calls.every(call => call.method === "GET"));
  first.dispose(); second.dispose();
});

test("focus and visible-page resume reconcile a missed storage event without polling", async () => {
  for (const event of ["focus", "visible"] as const) {
    const storage = memory(), backend = server(); recovery.writeAiMediaGenerationRecovery(storage, "account-a", pointer);
    const instance = tab(storage, backend); await instance.ready(); backend.draft = false; storage.removeItem(storageKey());
    instance[event](); instance[event](); await instance.flush();
    assert.equal(instance.status().canRecover, false); assert.equal(statusReads(instance).length, 1);
    await instance.flush(); assert.equal(statusReads(instance).length, 1); instance.dispose();
  }
});

test("a missing local pointer never loses an unaccepted, unavailable, malformed or mismatched paid result", async () => {
  for (const response of [
    () => Response.json({ ok: true, status: "completed", draft: true, item: { id: pointer.mediaId } }),
    () => Response.json({ status: "missing" }, { status: 404 }),
    () => Response.json({ error: "Unavailable" }, { status: 503 }),
    () => new Response('{"ok":', { headers: { "Content-Type": "application/json" } }),
    () => Response.json({ ok: true, status: "completed", draft: false, item: { id: "different-media" } }),
  ]) {
    const storage = memory(), backend = server(); recovery.writeAiMediaGenerationRecovery(storage, "account-a", pointer);
    const instance = tab(storage, backend); await instance.ready(); backend.response = response; storage.removeItem(storageKey());
    instance.storageEvent(); await instance.flush();
    assert.equal(instance.status().canRecover, true); assert.equal(statusReads(instance).length, 1);
    await instance.flush(); assert.equal(statusReads(instance).length, 1); instance.dispose();
  }
});

test("foreign storage events and a newer account pointer are preserved even after a late successful read", async () => {
  const storage = memory(), backend = server(); recovery.writeAiMediaGenerationRecovery(storage, "account-a", pointer);
  const instance = tab(storage, backend); await instance.ready(); storage.removeItem(storageKey());
  instance.storageEvent(storageKey("account-b")); await instance.flush(); assert.equal(statusReads(instance).length, 0);
  instance.deferStatus(); instance.storageEvent(); await instance.flush();
  const newer = { ...pointer, requestId: "stored-newer-0002", mediaId: "newer-media" };
  recovery.writeAiMediaGenerationRecovery(storage, "account-a", newer);
  instance.deferred[0].resolve(Response.json({ ok: true, status: "completed", draft: false, item: backend.item })); await instance.flush();
  assert.equal(instance.status().canRecover, true); assert.deepEqual(recovery.readAiMediaGenerationRecovery(storage, "account-a"), newer);
  instance.storageEvent(); await instance.flush(); assert.equal(statusReads(instance).length, 1); instance.dispose();
});

test("a result from an old account cannot clear the new account recovery", async () => {
  const storage = memory(), backend = server(); recovery.writeAiMediaGenerationRecovery(storage, "account-a", pointer);
  const instance = tab(storage, backend); await instance.ready(); storage.removeItem(storageKey());
  instance.deferStatus(); instance.storageEvent(); await instance.flush();
  const newer = { ...pointer, requestId: "account-b-request-0002", mediaId: "account-b-media" };
  recovery.writeAiMediaGenerationRecovery(storage, "account-b", newer);
  instance.changeAccount("account-b"); await instance.flush();
  instance.deferred[0].resolve(Response.json({ ok: true, status: "completed", draft: false, item: backend.item })); await instance.flush();
  assert.equal(instance.status().canRecover, true); assert.deepEqual(recovery.readAiMediaGenerationRecovery(storage, "account-b"), newer); instance.dispose();
});

test("an already displayed draft is never hidden or replaced by another tab's storage cleanup", async () => {
  const storage = memory(), backend = server(); recovery.writeAiMediaGenerationRecovery(storage, "account-a", pointer);
  const instance = tab(storage, backend); await instance.ready(); await instance.status().retryRecovery(); await instance.flush();
  const result = instance.status().result; assert.equal(result?.draft, true);
  backend.draft = false; storage.removeItem(storageKey()); instance.storageEvent(); instance.focus(); await instance.flush();
  assert.equal(instance.status().result, result); assert.equal(statusReads(instance).length, 1); instance.dispose();
});

test("an active generation is never reconciled by storage or focus events", async () => {
  const storage = memory(), backend = server(), instance = tab(storage, backend); await instance.ready(); instance.deferGenerate();
  const running = instance.status().generate({ source: "studio", kind: "image", format: "square", subjectSource: "custom", idea: "Un vase et des fleurs.", creationMode: "free", freePrompt: "Un vase et des fleurs.", imageEngine: "grok", textKeywords: [], imageStyle: "photo", peopleMode: "auto", useBrandColors: false, logoMode: "none" });
  await instance.flush(); assert.equal(instance.status().busy, true);
  assert.equal(instance.status().recovering, false); assert.equal(instance.status().pauseRecovery(), false);
  assert.equal(instance.deferred[0].signal.aborted, false);
  storage.removeItem(storageKey()); instance.storageEvent(); instance.focus(); await instance.flush(); assert.equal(statusReads(instance).length, 0);
  instance.deferred[0].resolve(Response.json({ ok: true, draft: true, item: backend.item })); await running; await instance.flush();
  assert.equal(instance.status().result?.item.id, pointer.mediaId); instance.dispose();
});

test("pausing a pending recovery GET preserves its identity, photo and credits, then resumes that exact job", async () => {
  const storage = memory(), backend = server(); recovery.writeAiMediaGenerationRecovery(storage, "account-a", pointer);
  const instance = tab(storage, backend); await instance.ready(); const form = instance.form(), quota = instance.status().quota;
  instance.deferStatus(); const checking = instance.status().retryRecovery().catch((error: Error) => error); await instance.flush();
  assert.equal(instance.status().recovering, true); assert.equal(instance.status().canPauseRecovery, true);
  assert.equal(instance.status().pauseRecovery(), true); assert.equal(instance.status().pauseRecovery(), false);
  assert.equal((await checking as Error).name, "MediaGenerationRecoveryPausedError"); await instance.flush();
  assert.equal(instance.deferred[0].signal.aborted, true); assert.equal(instance.status().busy, false); assert.equal(instance.status().canRecover, true);
  assert.equal(instance.status().error, ""); assert.equal(instance.status().result, null); assert.equal(instance.status().quota, quota); assert.equal(instance.form(), form);
  assert.deepEqual(recovery.readAiMediaGenerationRecovery(storage, "account-a"), pointer);
  await assert.rejects(instance.status().generate({ source: "studio", kind: "image", format: "square", subjectSource: "custom", idea: "Une autre image", textKeywords: [], imageStyle: "photo", peopleMode: "auto", useBrandColors: false, logoMode: "none" }), /Récupérez/);
  instance.deferStatus(); const resumed = instance.status().retryRecovery(); await instance.flush();
  instance.deferred[1].resolve(Response.json({ ok: true, status: "completed", draft: true, item: backend.item })); await resumed; await instance.flush();
  assert.equal(instance.status().result?.item.id, pointer.mediaId); assert.equal(instance.status().recovering, false);
  assert.ok(statusReads(instance).every(call => call.url.endsWith(`requestId=${pointer.requestId}`)));
  assert.ok(instance.calls.every(call => call.method === "GET")); instance.dispose();
});

test("a pause interrupts the two-second polling delay immediately without scheduling another check", async () => {
  const storage = memory(), backend = server(); recovery.writeAiMediaGenerationRecovery(storage, "account-a", pointer);
  const instance = tab(storage, backend); await instance.ready(); instance.deferStatus();
  const checking = instance.status().retryRecovery().catch((error: Error) => error); await instance.flush();
  instance.deferred[0].resolve(Response.json({ ok: true, status: "processing" }, { status: 202 })); await instance.flush();
  assert.equal(instance.pollTimers(), 1); assert.equal(instance.status().pauseRecovery(), true);
  assert.equal(instance.pollTimers(), 0); assert.equal((await checking as Error).name, "MediaGenerationRecoveryPausedError"); await instance.flush();
  assert.equal(statusReads(instance).length, 1); assert.equal(instance.status().busy, false); assert.equal(instance.status().canRecover, true); instance.dispose();
});

test("recovery after an uncertain initial POST can pause and resume the same closure without another paid attempt", async () => {
  const storage = memory(), backend = server(), instance = tab(storage, backend); await instance.ready();
  instance.deferGenerate(); instance.deferStatus();
  const creating = instance.status().generate({ source: "studio", kind: "image", format: "square", subjectSource: "custom", idea: "Un vase et des fleurs.", creationMode: "free", freePrompt: "Un vase et des fleurs.", imageEngine: "grok", textKeywords: [], imageStyle: "photo", peopleMode: "auto", useBrandColors: false, logoMode: "none" }).catch((error: Error) => error);
  await instance.flush(); instance.deferred[0].resolve(new Response('{"ok":', { headers: { "Content-Type": "application/json" } })); await instance.flush();
  assert.equal(instance.status().recovering, true); const identity = recovery.readAiMediaGenerationRecovery(storage, "account-a")?.requestId;
  assert.ok(identity); assert.equal(instance.status().pauseRecovery(), true);
  assert.equal((await creating as Error).name, "MediaGenerationRecoveryPausedError"); await instance.flush();
  instance.deferStatus(); const resumed = instance.status().retryRecovery(); await instance.flush();
  assert.equal(instance.status().recovering, true); assert.equal(instance.deferred.length, 3);
  instance.deferred[2].resolve(Response.json({ ok: true, status: "completed", draft: true, item: backend.item })); await resumed; await instance.flush();
  assert.equal(instance.status().result?.item.id, pointer.mediaId); assert.ok(statusReads(instance).every(call => call.url.endsWith(`requestId=${identity}`)));
  assert.equal(instance.calls.filter(call => call.url.endsWith("/generate")).length, 1); assert.equal(instance.calls.filter(call => call.url.endsWith("/cancel")).length, 0); instance.dispose();
});

test("queued terminal replies after pause cannot publish an old result or erase a newer pointer", async () => {
  const storage = memory(), backend = server(); recovery.writeAiMediaGenerationRecovery(storage, "account-a", pointer);
  const instance = tab(storage, backend); await instance.ready(); instance.deferStatus();
  const checking = instance.status().retryRecovery().catch((error: Error) => error); await instance.flush();
  instance.deferred[0].resolve(Response.json({ ok: true, status: "completed", draft: false, item: backend.item }));
  assert.equal(instance.status().pauseRecovery(), true);
  const newer = { ...pointer, requestId: "newer-after-pause-0002", mediaId: "newer-media" };
  recovery.writeAiMediaGenerationRecovery(storage, "account-a", newer);
  assert.equal((await checking as Error).name, "MediaGenerationRecoveryPausedError"); await instance.flush();
  assert.equal(instance.status().result, null); assert.deepEqual(recovery.readAiMediaGenerationRecovery(storage, "account-a"), newer);
  assert.equal(instance.status().canRecover, true); instance.dispose();
});

test("pausing after a completed job while quota is pending keeps that result recoverable and a late quota cannot disturb its resumed read", async () => {
  const storage = memory(), backend = server(); recovery.writeAiMediaGenerationRecovery(storage, "account-a", pointer);
  const instance = tab(storage, backend); await instance.ready(); instance.deferQuota();
  const checking = instance.status().retryRecovery().catch((error: Error) => error); await instance.flush();
  assert.equal(instance.quotaReplies.length, 1); assert.equal(instance.status().recovering, true);
  assert.equal(instance.status().pauseRecovery(), true); assert.equal((await checking as Error).name, "MediaGenerationRecoveryPausedError"); await instance.flush();
  assert.equal(instance.status().result, null); assert.deepEqual(recovery.readAiMediaGenerationRecovery(storage, "account-a"), pointer);
  instance.deferStatus(); const resumed = instance.status().retryRecovery(); await instance.flush();
  instance.quotaReplies[0].resolve(Response.json({ quota: { accountId: "account-a", creditsReady: true, credits: { remaining: 99, reserved: 0 } } })); await instance.flush();
  assert.equal(instance.status().recovering, true); assert.equal(instance.status().canPauseRecovery, true); assert.equal(instance.status().busy, true);
  instance.deferred[0].resolve(Response.json({ ok: true, status: "completed", draft: true, item: backend.item })); await resumed; await instance.flush();
  assert.equal(instance.status().result?.item.id, pointer.mediaId); assert.ok(instance.calls.every(call => call.method === "GET")); instance.dispose();
});

test("local pause never interrupts a genuine cancellation or masks its native acknowledgement", async () => {
  const storage = memory(), backend = server(); recovery.writeAiMediaGenerationRecovery(storage, "account-a", pointer);
  const instance = tab(storage, backend); await instance.ready(); instance.deferCancellation();
  const cancelling = instance.status().cancelRecovery().catch((error: Error) => error); await instance.flush();
  assert.equal(instance.calls.filter(call => call.url.endsWith("/cancel")).length, 1);
  assert.equal(instance.status().canPauseRecovery, false); assert.equal(instance.status().pauseRecovery(), false);
  assert.equal(instance.status().cancellationPending, true); assert.equal(instance.status().busy, true);
  assert.deepEqual(recovery.readAiMediaGenerationRecovery(storage, "account-a"), pointer);
  instance.cancellationAcks[0].resolve(Response.json({ ok: true, status: "failed" })); assert.equal(await cancelling, null); await instance.flush();
  assert.equal(instance.status().cancellationPending, false); assert.equal(instance.status().busy, false);
  assert.equal(recovery.readAiMediaGenerationRecovery(storage, "account-a"), null);
  assert.equal(instance.calls.filter(call => call.url.endsWith("/cancel")).length, 1); assert.equal(statusReads(instance).length, 0); instance.dispose();
});

test("changing account after a recovery pause preserves the new account and ignores old late data", async () => {
  const storage = memory(), backend = server(); recovery.writeAiMediaGenerationRecovery(storage, "account-a", pointer);
  const instance = tab(storage, backend); await instance.ready(); instance.deferStatus();
  const checking = instance.status().retryRecovery().catch((error: Error) => error); await instance.flush(); instance.status().pauseRecovery(); await checking; await instance.flush();
  const other = { ...pointer, requestId: "account-b-after-pause-0002", mediaId: "other-media" };
  recovery.writeAiMediaGenerationRecovery(storage, "account-b", other); instance.changeAccount("account-b"); await instance.flush();
  instance.deferred[0].resolve(Response.json({ ok: true, status: "completed", draft: false, item: backend.item })); await instance.flush();
  assert.equal(instance.status().result, null); assert.equal(instance.status().quota?.accountId, "account-b");
  assert.equal(instance.status().canRecover, true); assert.deepEqual(recovery.readAiMediaGenerationRecovery(storage, "account-a"), pointer); assert.deepEqual(recovery.readAiMediaGenerationRecovery(storage, "account-b"), other); instance.dispose();
});
