import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as pricing from "../../lib/aiMediaCreditsPricing.ts";
import type { MediaGenerationQuota } from "../../app/dashboard/_hooks/useMediaGeneration.ts";
import type { MediaCreditQuoteInput } from "../../app/dashboard/_hooks/useMediaCreditQuote.ts";

type Status = { ready: boolean; loading: boolean; quote: { totalCredits: number; quoteId: string } | null; estimate: { totalCredits: number } | null; authorization: Record<string, unknown>; remainingAfter: number | null; insufficient: boolean };
function quota(accountId = "account-a", remaining = 500, creditsReady = true) {
  return { accountId, unlimited: false, creditsReady, credits: { unit: "credit", remaining, reserved: 0 } } as unknown as MediaGenerationQuota;
}
const input = (videoEngine = "omni"): MediaCreditQuoteInput => ({ kind: "video", operation: "generate", creationMode: "free", inputMode: "essential", identityMode: "auto", videoEngine: videoEngine as MediaCreditQuoteInput["videoEngine"], videoResolution: "720p", durationSeconds: 8, inspirationImagesCount: 0, withNarration: false, teamVideoSpeechMode: "voiceover" });

/** Execute the real hook with deterministic effects, deferred HTTP and account events. */
function harness(initialInput = input(), initialQuota = quota()) {
  const slots: Array<{ value?: unknown; deps?: unknown[]; cleanup?: (() => void) | undefined }> = [];
  const effects: Array<() => void> = [];
  const timers = new Map<number, () => void>();
  const listeners = new Map<string, Set<() => void>>();
  const requests: Array<{ input: MediaCreditQuoteInput; signal: AbortSignal; resolve: (value: unknown) => void }> = [];
  let cursor = 0, dirty = true, timerId = 0, currentInput = initialInput, currentQuota = initialQuota, eligible = true, status: Status;
  const same = (a: unknown[] | undefined, b: unknown[]) => a?.length === b.length && a.every((value, index) => Object.is(value, b[index]));
  const react = {
    useState(initial: unknown) {
      const index = cursor++;
      slots[index] ??= { value: typeof initial === "function" ? initial() : initial };
      return [slots[index].value, (update: unknown) => { const next = typeof update === "function" ? update(slots[index].value) : update; if (!Object.is(next, slots[index].value)) { slots[index].value = next; dirty = true; } }];
    },
    useRef(initial: unknown) { const index = cursor++; slots[index] ??= { value: { current: initial } }; return slots[index].value; },
    useEffect(callback: () => (() => void) | undefined, deps: unknown[]) {
      const index = cursor++, previous = slots[index];
      if (!same(previous?.deps, deps)) effects.push(() => { previous?.cleanup?.(); slots[index] = { deps, cleanup: callback() }; });
    },
  };
  const browser = {
    setTimeout(callback: () => void) { timers.set(++timerId, callback); return timerId; },
    clearTimeout(id: number) { timers.delete(id); },
    addEventListener(event: string, callback: () => void) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(callback); },
    removeEventListener(event: string, callback: () => void) { listeners.get(event)?.delete(callback); },
  };
  const source = readFileSync(new URL("../../app/dashboard/_hooks/useMediaCreditQuote.ts", import.meta.url), "utf8");
  const output = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  const record = { exports: {} as { default: (input: MediaCreditQuoteInput, quota: MediaGenerationQuota, eligible: boolean) => Status } };
  const require = (specifier: string) => {
    if (specifier === "react") return react;
    if (specifier === "@/lib/aiMediaCreditsPricing") return pricing;
    if (specifier === "@/lib/multicompte/constants") return { ACTIVE_INRCY_ACCOUNT_EVENT: "account-change" };
    throw new Error(`Unexpected quote dependency: ${specifier}`);
  };
  const fetch = (_url: string, options: RequestInit) => new Promise((resolve) => requests.push({ input: JSON.parse(options.body as string), signal: options.signal!, resolve }));
  new Function("module", "exports", "require", "window", "fetch", output)(record, record.exports, require, browser, fetch);
  const render = () => {
    let count = 0;
    do { assert.ok(++count < 30, "quote hooks settle"); dirty = false; cursor = 0; status = record.exports.default(currentInput, currentQuota, eligible); for (const effect of effects.splice(0)) effect(); } while (dirty);
    return status!;
  };
  const flush = async () => { for (let index = 0; index < 5; index++) { await new Promise((resolve) => setImmediate(resolve)); if (dirty) render(); } return status!; };
  const respond = (index: number, account: string, remaining = 500) => {
    const request = requests[index];
    request.resolve({ ok: true, json: async () => ({ quote: { ...pricing.quoteAiMediaCredits(request.input), quoteId: `${account}-${index}` }, credits: { remaining } }) });
  };
  render();
  return { requests, render, flush, respond,
    status: () => status!,
    update(next: MediaCreditQuoteInput, balance = currentQuota) { currentInput = next; currentQuota = balance; return render(); },
    eligible(value: boolean) { eligible = value; return render(); },
    runTimers() { for (const [id, callback] of [...timers]) { timers.delete(id); callback(); } },
    changeAccount() { for (const callback of listeners.get("account-change") ?? []) callback(); return render(); },
    dispose() { for (const slot of slots) slot?.cleanup?.(); },
  };
}

test("media generation requires a confirmed quote and uses the fresh server balance", async () => {
  const h = harness(input("grok-lite"), quota("account-a", 500, false));
  h.runTimers(); assert.equal(h.requests.length, 0); assert.equal(h.status().ready, false); assert.deepEqual(h.status().authorization, {});
  h.update(input("grok-lite"), quota()); assert.equal(h.status().ready, false); assert.equal(h.status().estimate?.totalCredits, 31);
  h.runTimers(); h.respond(0, "account-a", 300); await h.flush();
  assert.equal(h.status().ready, true); assert.equal(h.status().remainingAfter, 269);
  assert.deepEqual(h.status().authorization, { expectedCredits: 31, creditTariffVersion: pricing.AI_MEDIA_CREDIT_TARIFF_VERSION, creditQuoteId: "account-a-0" });
  h.update(input("grok-lite"), quota("account-a", 300, false)); assert.equal(h.status().quote, null); assert.deepEqual(h.status().authorization, {}); h.dispose();
});

test("a parameter change disables generation immediately and a late old quote never wins", async () => {
  const h = harness(); h.runTimers(); h.respond(0, "account-a"); await h.flush(); assert.equal(h.status().ready, true);
  h.update(input("grok-lite")); assert.equal(h.status().ready, false); assert.deepEqual(h.status().authorization, {}); h.runTimers();
  h.update({ ...input("wan3"), durationSeconds: 5 }); h.runTimers(); assert.equal(h.requests[1].signal.aborted, true);
  h.respond(2, "account-a"); await h.flush(); assert.equal(h.status().quote?.totalCredits, 57);
  h.respond(1, "account-a"); await h.flush(); assert.equal(h.status().quote?.totalCredits, 57); assert.equal(h.status().quote?.quoteId, "account-a-2");
  h.update({ ...input("wan3"), durationSeconds: 5 }, quota("account-a", 40)); assert.equal(h.status().ready, false); h.runTimers(); h.respond(3, "account-a", 40); await h.flush(); assert.equal(h.status().insufficient, true); h.dispose();
});

test("account changes invalidate price authorization until a fresh scoped quota arrives", async () => {
  const h = harness(); h.runTimers(); h.respond(0, "account-a"); await h.flush();
  h.changeAccount(); assert.equal(h.status().ready, false); assert.deepEqual(h.status().authorization, {}); h.runTimers(); assert.equal(h.requests.length, 1);
  h.update(input(), quota("account-b", 90)); h.runTimers(); h.respond(1, "account-b", 90); await h.flush();
  assert.equal(h.status().quote?.quoteId, "account-b-1"); assert.equal(h.status().remainingAfter, 3); assert.equal(h.status().ready, true); h.dispose();
});

test("changing from one to two scenes invalidates the previous quote immediately", async () => {
  const h = harness({ ...input("grok-lite"), sceneMode: "single" });
  h.runTimers(); h.respond(0, "account-a"); await h.flush();
  assert.equal(h.status().ready, true);
  h.update({ ...input("grok-lite"), sceneMode: "multi" });
  assert.equal(h.status().ready, false);
  assert.deepEqual(h.status().authorization, {});
  h.runTimers(); assert.equal(h.requests[1].input.sceneMode, "multi");
  h.respond(1, "account-a"); await h.flush();
  assert.equal(h.status().ready, true);
  assert.equal(h.status().quote?.quoteId, "account-a-1"); h.dispose();
});

test("an incompatible brief clears price and authorization until a fresh eligible quote arrives", async () => {
  const h = harness(); h.runTimers(); h.respond(0, "account-a"); await h.flush();
  assert.equal(h.status().ready, true);
  h.eligible(false); assert.equal(h.status().ready, false); assert.equal(h.status().quote, null);
  assert.equal(h.status().estimate, null); assert.deepEqual(h.status().authorization, {});
  h.runTimers(); assert.equal(h.requests.length, 1);
  h.eligible(true); assert.equal(h.status().ready, false); h.runTimers(); h.respond(1, "account-a"); await h.flush();
  assert.equal(h.status().ready, true); assert.equal(h.status().quote?.quoteId, "account-a-1"); h.dispose();
});
