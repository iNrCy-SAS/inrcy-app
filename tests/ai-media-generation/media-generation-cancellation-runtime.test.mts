import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as contracts from "../../lib/aiMediaGenerationContracts.ts";
import * as models from "../../lib/aiMediaModelCatalog.ts";
import * as transport from "../../lib/aiMediaGenerationTransport.ts";
import * as recovery from "../../lib/aiMediaGenerationRecovery.ts";
import type { MediaGenerationRequest, MediaGenerationResult } from "../../app/dashboard/_hooks/useMediaGeneration.ts";

type Hook = {
  cancellable: boolean; cancellationPending: boolean; canRecover: boolean; busy: boolean; result: MediaGenerationResult | null; error: string;
  generate: (request: MediaGenerationRequest) => Promise<MediaGenerationResult>;
  cancelGeneration: () => boolean; reset: () => void;
  retryRecovery: () => Promise<MediaGenerationResult>;
  loadQuota: (options?: { force?: boolean }) => Promise<unknown>;
};
type Slot = { value?: unknown; deps?: readonly unknown[]; cleanup?: () => void };
type Attempt = { body: Record<string, unknown>; signal: AbortSignal; headers: Headers; resolve: (response: Response) => void };
type Recovery = { requestId: string; signal: AbortSignal; resolve: (response: Response) => void };
const input = (): MediaGenerationRequest => ({
  source: "studio", kind: "image", format: "square", subjectSource: "custom", idea: "Un vase et des fleurs.",
  creationMode: "free", freePrompt: "Un vase et des fleurs.", imageEngine: "grok",
  textKeywords: [], imageStyle: "photo", peopleMode: "auto", useBrandColors: false, logoMode: "none",
});
const quota = (accountId = "account-a") => ({ accountId, creditsReady: true, credits: { unit: "credit", remaining: 100, reserved: 0 } });

/** Real hook, controlled HTTP streams and effects; no provider or database requests. */
function harness(sessionStorage?: Pick<Storage, "getItem" | "setItem" | "removeItem">) {
  const slots: Slot[] = []; const effects: Array<() => void> = []; const listeners = new Map<string, Set<() => void>>();
  const attempts: Attempt[] = []; const recoveries: Recovery[] = []; let cursor = 0; let dirty = false; let status!: Hook; let account = "account-a"; let now = 0; let remaining = 100;
  const changed = (first?: readonly unknown[], second?: readonly unknown[]) => !first || !second || first.length !== second.length || first.some((value, index) => value !== second[index]);
  const react = {
    useState(initial: unknown) {
      const index = cursor++; const slot = slots[index] ||= { value: typeof initial === "function" ? (initial as () => unknown)() : initial };
      return [slot.value, (next: unknown) => { const value = typeof next === "function" ? (next as (old: unknown) => unknown)(slot.value) : next; if (!Object.is(value, slot.value)) { slot.value = value; dirty = true; } }];
    },
    useRef(initial: unknown) { const index = cursor++; const slot = slots[index] ||= { value: { current: initial } }; return slot.value; },
    useCallback(callback: unknown, deps: readonly unknown[]) { const index = cursor++; const slot = slots[index] ||= {}; if (changed(slot.deps, deps)) { slot.deps = deps; slot.value = callback; } return slot.value; },
    useEffect(callback: () => void | (() => void), deps: readonly unknown[]) {
      const index = cursor++; const slot = slots[index] ||= {};
      if (changed(slot.deps, deps)) { slot.deps = deps; effects.push(() => { slot.cleanup?.(); slot.cleanup = callback() || undefined; }); }
    },
  };
  const browser = {
    sessionStorage,
    performance: { now: () => now },
    setInterval() { return 1; }, clearInterval() {},
    setTimeout(callback: () => void) { queueMicrotask(callback); return 1; }, clearTimeout() {},
    requestAnimationFrame(callback: (time: number) => void) { queueMicrotask(() => { now += 1_000; callback(now); }); return 1; },
    addEventListener(event: string, callback: () => void) { if (!listeners.has(event)) listeners.set(event, new Set()); listeners.get(event)!.add(callback); },
    removeEventListener(event: string, callback: () => void) { listeners.get(event)?.delete(callback); },
  };
  const fetch = (url: string, init: RequestInit = {}): Promise<Response> => {
    if (url.endsWith("/quota")) return Promise.resolve(Response.json({ quota: { ...quota(account), credits: { unit: "credit", remaining, reserved: 0 } } }));
    if (url.startsWith("/api/media-generation/status?")) return new Promise((resolve, reject) => {
      const signal = init.signal!;
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      recoveries.push({ requestId: new URL(url, "https://example.invalid").searchParams.get("requestId")!, signal, resolve });
    });
    assert.equal(url, "/api/media-generation/generate");
    return new Promise((resolve, reject) => {
      const signal = init.signal!;
      signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")), { once: true });
      attempts.push({ body: JSON.parse(String(init.body)), signal, headers: new Headers(init.headers), resolve });
    });
  };
  const output = ts.transpileModule(readFileSync(new URL("../../app/dashboard/_hooks/useMediaGeneration.ts", import.meta.url), "utf8"), {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  const record = { exports: {} as { default: () => Hook } };
  new Function("module", "exports", "require", "window", "fetch", output)(record, record.exports, (id: string) => {
    if (id === "react") return react;
    if (id === "@/lib/multicompte/constants") return { ACTIVE_INRCY_ACCOUNT_EVENT: "account-change" };
    if (id === "@/lib/aiMediaGenerationContracts") return contracts;
    if (id === "@/lib/aiMediaModelCatalog") return models;
    if (id === "@/lib/aiMediaGenerationTransport") return transport;
    if (id === "@/lib/aiMediaGenerationRecovery") return recovery;
    throw new Error(`Unexpected hook dependency: ${id}`);
  }, browser, fetch);
  const render = () => {
    let count = 0;
    do { assert.ok(++count < 30); dirty = false; cursor = 0; status = record.exports.default(); for (const effect of effects.splice(0)) effect(); } while (dirty);
    return status;
  };
  const flush = async () => { for (let index = 0; index < 8; index++) { await new Promise((resolve) => setImmediate(resolve)); if (dirty) render(); } return status; };
  const startStream = (index: number) => {
    let controller!: ReadableStreamDefaultController<Uint8Array>; let closed = false;
    const attempt = attempts[index]; const encoder = new TextEncoder();
    const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
    attempt.signal.addEventListener("abort", () => { if (!closed) { closed = true; controller.error(new DOMException("aborted", "AbortError")); } }, { once: true });
    attempt.resolve(new Response(stream, { headers: { "Content-Type": transport.AI_MEDIA_GENERATION_STREAM_TYPE } }));
    return {
      send(value: unknown) { controller.enqueue(encoder.encode(`${JSON.stringify(value)}\n`)); },
      close() { closed = true; controller.close(); },
    };
  };
  render();
  return { attempts, recoveries, render, flush, startStream, status: () => status,
    async refreshRemaining(value: number) { remaining = value; await status.loadQuota({ force: true }); return render(); },
    changeAccount(nextAccount = "account-b") { account = nextAccount; for (const callback of listeners.get("account-change") || []) callback(); return render(); },
    dispose() { for (const slot of slots) slot.cleanup?.(); },
  };
}
const successfulResult = () => ({ type: "result", status: 200, payload: { ok: true, draft: true, item: { id: "draft-a", media_type: "image", signed_url: "https://example.invalid/media.jpg" }, quota: quota() } });

test("the hook stops preparation but refuses a user stop immediately after the actual billing event", async () => {
  const before = harness(); const cancelled = before.status().generate(input()).catch((error: Error) => error);
  before.render(); const preparation = before.startStream(0); await before.flush();
  assert.equal(before.status().cancellable, true); assert.equal(before.status().cancelGeneration(), true);
  assert.equal(before.attempts[0].signal.aborted, true); await before.flush();
  assert.equal(before.status().busy, true); assert.equal(before.status().cancellationPending, true);
  before.recoveries[0].resolve(Response.json({ ok: true, status: "failed" }));
  assert.equal((await cancelled as Error).name, "MediaGenerationCancelledError"); await before.flush();
  assert.equal(before.status().busy, false); assert.equal(before.status().cancellationPending, false);
  void preparation; before.dispose();

  const after = harness(); const task = after.status().generate(input()); after.render(); const stream = after.startStream(0);
  stream.send({ type: "billing_locked" }); await after.flush();
  assert.equal(after.status().cancellable, false); assert.equal(after.status().cancelGeneration(), false);
  after.status().reset(); after.render();
  assert.equal(after.status().busy, true);
  await assert.rejects(after.status().generate(input()), /déjà en cours/);
  assert.equal(after.attempts[0].signal.aborted, false); assert.equal(after.attempts.length, 1);
  stream.send(successfulResult()); stream.close(); assert.equal((await task).item.id, "draft-a"); await after.flush(); after.dispose();
});

test("an uncertain truncated response retrieves the existing result without an automatic second paid attempt", async () => {
  const h = harness(); const task = h.status().generate(input()); h.render();
  const stream = h.startStream(0); stream.send({ type: "billing_locked" }); stream.close();
  await h.flush(); assert.equal(h.attempts.length, 1); assert.equal(h.status().cancellable, false);
  assert.equal(h.recoveries[0].requestId, h.attempts[0].body.requestId);
  h.recoveries[0].resolve(Response.json({ ...successfulResult().payload, status: "completed" }));
  assert.equal((await task).item.id, "draft-a"); assert.equal(h.attempts.length, 1); h.dispose();
});

test("an incomplete success or an in-progress replay retrieves the existing attempt without a second POST", async () => {
  for (const response of [Response.json({ ok: true }), Response.json({ ok: false, code: "AI_MEDIA_GENERATION_IN_PROGRESS" }, { status: 409 })]) {
    const h = harness(); const task = h.status().generate(input()); h.render(); h.attempts[0].resolve(response); await h.flush();
    assert.equal(h.recoveries[0].requestId, h.attempts[0].body.requestId); assert.equal(h.status().cancellable, false);
    h.recoveries[0].resolve(Response.json({ ...successfulResult().payload, status: "completed" }));
    assert.equal((await task).item.id, "draft-a"); assert.equal(h.attempts.length, 1); h.dispose();
  }
});

test("a stop before receiving the billing event recovers the paid draft when the last credits are reserved", async () => {
  const h = harness(); const request = { ...input(), expectedCredits: 2, creditTariffVersion: "inrstudio-media-credits-2026-10-v3", creditQuoteId: "account-scoped-same-tariff-quote" };
  const task = h.status().generate(request); h.render(); h.startStream(0); await h.flush();
  // The server may already be locked while the notification is still in
  // transit. A local AbortError is not an acknowledgement of a free stop.
  assert.equal(h.status().cancelGeneration(), true); await h.flush(); await h.refreshRemaining(0);
  assert.equal(h.status().busy, true); assert.equal(h.status().cancellable, false);
  await assert.rejects(h.status().generate(request), /déjà en cours/);
  assert.equal(h.recoveries[0].requestId, h.attempts[0].body.requestId);
  h.recoveries[0].resolve(Response.json({ ok: false, status: "missing" }, { status: 404 })); await h.flush();
  assert.equal(h.status().busy, true); assert.equal(h.attempts.length, 1);
  h.recoveries[1].resolve(Response.json({ ok: true, status: "processing" }, { status: 202 })); await h.flush();
  h.recoveries[2].resolve(Response.json({ ok: true, status: "completed", item: successfulResult().payload.item, draft: true, format: "portrait" }));
  assert.equal((await task).item.id, "draft-a"); await h.flush();
  assert.equal(h.status().result?.format, "portrait"); assert.equal(h.status().result?.quota.credits.remaining, 0);
  assert.equal(h.status().cancellationPending, false); assert.equal(h.attempts.length, 1); h.dispose();
});

test("a manual recovery after eight unavailable reads is independent of an exhausted quote and performs GET only", async () => {
  for (const status of [404, 503]) {
    const h = harness(); const task = h.status().generate(input()).catch((error: Error) => error); h.render(); h.startStream(0); await h.flush();
    assert.equal(h.status().cancelGeneration(), true); await h.flush();
    for (let index = 0; index < 8; index++) {
      h.recoveries[index].resolve(Response.json(status === 404 ? { ok: false, status: "missing" } : { ok: false, code: "AI_MEDIA_STATUS_UNAVAILABLE" }, { status })); await h.flush();
    }
    const error = await task as Error;
    assert.match(error.message, /identifiant est conservé/); assert.notEqual(error.name, "MediaGenerationCancelledError");
    assert.equal(h.attempts.length, 1); assert.equal(h.status().canRecover, true); await h.refreshRemaining(0);
    h.status().reset(); h.render(); assert.equal(h.status().canRecover, true);
    await assert.rejects(h.status().generate(input()), /Récupérez/);
    const retry = h.status().retryRecovery(); h.render(); assert.equal(h.status().busy, true);
    assert.equal(h.recoveries[8].requestId, h.attempts[0].body.requestId);
    h.recoveries[8].resolve(Response.json({ ...successfulResult().payload, status: "completed" }));
    const restored = await retry; await h.flush();
    assert.equal(restored.item.id, "draft-a"); assert.equal(restored.quota.credits.remaining, 0);
    assert.equal(h.status().canRecover, false); assert.equal(h.attempts.length, 1); h.dispose();
  }
});

function memoryStorage() {
  const entries = new Map<string, string>();
  return { entries, getItem: (key: string) => entries.get(key) ?? null, setItem: (key: string, value: string) => { entries.set(key, value); }, removeItem: (key: string) => { entries.delete(key); } };
}

test("the session pointer rejects malformed values and clears only the matching account attempt", () => {
  const storage = memoryStorage(); const pointer = { requestId: "stored-request-0001", kind: "image" as const, format: "portrait" as const };
  recovery.writeAiMediaGenerationRecovery(storage, "account-a", { ...pointer, prompt: "SECRET" } as typeof pointer);
  recovery.writeAiMediaGenerationRecovery(storage, "account-b", { ...pointer, requestId: "stored-request-0002" });
  assert.equal(recovery.readAiMediaGenerationRecovery(storage, "account-c"), null);
  recovery.clearAiMediaGenerationRecovery(storage, "account-a", "wrong-request-id"); assert.equal(storage.entries.size, 2);
  recovery.clearAiMediaGenerationRecovery(storage, "account-a", pointer.requestId); assert.equal(storage.entries.size, 1);
  assert.doesNotMatch([...storage.entries.values()].join(""), /SECRET|prompt/);
  const key = [...storage.entries.keys()][0];
  for (const invalid of ["broken", JSON.stringify({ version: 2, ...pointer }), JSON.stringify({ version: 1, ...pointer, kind: "audio" }), JSON.stringify({ version: 1, ...pointer, requestId: 12345678 })]) {
    storage.setItem(key, invalid); assert.equal(recovery.readAiMediaGenerationRecovery(storage, "account-b"), null);
  }
  const blocked = { getItem() { throw new Error("blocked"); }, setItem() { throw new Error("blocked"); }, removeItem() { throw new Error("blocked"); } };
  assert.equal(recovery.readAiMediaGenerationRecovery(blocked, "account-a"), null);
  assert.doesNotThrow(() => recovery.writeAiMediaGenerationRecovery(blocked, "account-a", pointer));
});

test("a reload recovers a scoped paid result from a pointer containing no prompt or reference data", async () => {
  const storage = memoryStorage(); const original = harness(storage); await original.refreshRemaining(2);
  const task = original.status().generate({ ...input(), kind: "video", format: "story", freePrompt: "SECRET PROMPT", inspirationImages: [{ data: "SECRET REFERENCE", mimeType: "image/png", name: "private.png" }] }).catch((error: Error) => error);
  original.render(); const stream = original.startStream(0); stream.send({ type: "billing_locked" }); await original.flush();
  const requestId = String(original.attempts[0].body.requestId); original.dispose();
  assert.equal(recovery.readAiMediaGenerationRecovery(storage, "account-a")?.requestId, requestId);
  assert.doesNotMatch([...storage.entries.values()].join(""), /SECRET|prompt|inspirationImages/);
  stream.send(successfulResult()); stream.close(); assert.equal((await task as Error).name, "MediaGenerationAccountChangedError");

  const reloaded = harness(storage); await reloaded.refreshRemaining(0); assert.equal(reloaded.status().canRecover, true);
  const recovering = reloaded.status().retryRecovery(); reloaded.render();
  assert.equal(reloaded.recoveries[0].requestId, requestId); assert.equal(reloaded.attempts.length, 0);
  reloaded.recoveries[0].resolve(Response.json({ ok: true, status: "completed", item: { ...successfulResult().payload.item, media_type: "video" }, draft: true }));
  const result = await recovering; assert.equal(result.format, "story"); assert.equal(result.item.media_type, "video"); assert.equal(result.quota.credits.remaining, 0);
  assert.equal(storage.entries.size, 0); assert.equal(reloaded.attempts.length, 0); reloaded.dispose();
});

test("account changes hide another account pointer and recover it only after returning to its scope", async () => {
  const storage = memoryStorage(); recovery.writeAiMediaGenerationRecovery(storage, "account-a", { requestId: "stored-request-0001", kind: "image", format: "portrait" });
  const h = harness(storage); await h.refreshRemaining(0); assert.equal(h.status().canRecover, true);
  h.changeAccount(); await h.flush(); assert.equal(h.status().canRecover, false);
  assert.throws(() => h.status().retryRecovery(), /Aucune génération/); assert.equal(h.recoveries.length, 0);
  h.changeAccount("account-a"); await h.flush(); assert.equal(h.status().canRecover, true);
  const task = h.status().retryRecovery(); h.render(); assert.equal(h.recoveries[0].requestId, "stored-request-0001");
  h.recoveries[0].resolve(Response.json({ ...successfulResult().payload, status: "completed" }));
  assert.equal((await task).format, "portrait"); assert.equal(h.attempts.length, 0); h.dispose();
});

test("an authoritative deleted result clears a restored pointer without polling, refunding or submitting generation", async () => {
  const storage = memoryStorage(); recovery.writeAiMediaGenerationRecovery(storage, "account-a", { requestId: "purged-request-0001", kind: "image", format: "portrait" });
  const h = harness(storage); await h.refreshRemaining(0); assert.equal(h.status().canRecover, true);
  const task = h.status().retryRecovery().catch((error: Error) => error); h.render();
  h.recoveries[0].resolve(Response.json({ ok: false, status: "completed", code: "AI_MEDIA_RESULT_UNAVAILABLE" }, { status: 410 }));
  assert.match((await task as Error).message, /média enregistré n’est plus disponible/); await h.flush();
  assert.equal(h.status().canRecover, false); assert.equal(h.status().busy, false); assert.equal(storage.entries.size, 0);
  assert.equal(h.recoveries.length, 1); assert.equal(h.attempts.length, 0);
  assert.throws(() => h.status().retryRecovery(), /Aucune génération/);
  // Only a subsequent explicit user generation can create a new request.
  await h.refreshRemaining(2); const fresh = h.status().generate(input()); h.render(); assert.equal(h.attempts.length, 1);
  assert.notEqual(h.attempts[0].body.requestId, "purged-request-0001");
  const stream = h.startStream(0); stream.send(successfulResult()); stream.close(); await fresh; h.dispose();
});

test("account changes and unmount cancel only the recovery read and never present the old result", async () => {
  for (const cleanup of ["account", "unmount"]) {
    const h = harness(); const task = h.status().generate(input()).catch((error: Error) => error); h.render(); h.startStream(0); await h.flush();
    h.status().cancelGeneration(); await h.flush();
    if (cleanup === "account") h.changeAccount(); else h.dispose();
    assert.equal(h.recoveries[0].signal.aborted, true);
    assert.equal((await task as Error).name, "MediaGenerationAccountChangedError"); assert.equal(h.attempts.length, 1); assert.equal(h.status().result, null); h.dispose();
  }
});

test("account changes and unmount stop local presentation without aborting already paid work", async () => {
  for (const cleanup of ["account", "unmount"]) {
    const h = harness(); const task = h.status().generate(input()).catch((error: Error) => error); h.render();
    const stream = h.startStream(0); stream.send({ type: "billing_locked" }); await h.flush();
    if (cleanup === "account") { h.changeAccount(); await h.flush(); } else h.dispose();
    assert.equal(h.attempts[0].signal.aborted, false);
    stream.send(successfulResult()); stream.close(); assert.equal((await task as Error).name, "MediaGenerationAccountChangedError");
    assert.equal(h.status().result, null); h.dispose();
  }
});

test("the hook negotiates NDJSON and locks a legacy JSON response conservatively at its headers", async () => {
  const h = harness(); const task = h.status().generate(input()); h.render();
  assert.equal(h.attempts[0].headers.get("accept"), transport.AI_MEDIA_GENERATION_STREAM_TYPE);
  h.attempts[0].resolve(Response.json(successfulResult().payload)); await task; await h.flush();
  assert.equal(h.status().cancellable, false); assert.equal(h.status().cancelGeneration(), false); h.dispose();
});

test("the server billing gate deduplicates notifications and rejects cancellation before committing the gate", async () => {
  const aborted = new AbortController(); aborted.abort(); const cancelled = transport.createAiMediaBillingGate(aborted.signal);
  assert.throws(() => cancelled.lock(), { name: "AbortError" }); assert.equal(cancelled.locked, false); cancelled.dispose();
  const client = new AbortController(); let notifications = 0;
  const gate = transport.createAiMediaBillingGate(client.signal, () => { notifications += 1; });
  await Promise.all([gate.lock(), gate.lock()]); client.abort(); gate.disconnect();
  assert.equal(notifications, 1); assert.equal(gate.locked, true); assert.equal(gate.signal.aborted, false); gate.dispose();
});

test("protocol chunks preserve UTF-8 and public failures while malformed or oversized frames remain uncertain", async () => {
  const wire = `${JSON.stringify({ type: "billing_locked" })}\n${JSON.stringify({ type: "result", status: 429, payload: { ok: false, error: "Crédits insuffisants" } })}\n`;
  const encoded = new TextEncoder().encode(wire); let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
  for (let offset = 0; offset < encoded.length; offset += 3) controller.enqueue(encoded.slice(offset, offset + 3)); controller.close();
  let notifications = 0;
  const result = await transport.readAiMediaGenerationResponse(new Response(stream, { headers: { "Content-Type": transport.AI_MEDIA_GENERATION_STREAM_TYPE } }), () => { notifications += 1; });
  assert.equal(result.status, 429); assert.equal(notifications, 1); assert.equal((result.payload as { error: string }).error, "Crédits insuffisants");
  for (const invalid of ['{"type":"result","status":200', '{"type":"result","status":99,"payload":{}}\n', `${"x".repeat(1_048_577)}\n`, '{"type":"private_provider_log","url":"https://private.invalid"}\n']) {
    await assert.rejects(transport.readAiMediaGenerationResponse(new Response(invalid, { headers: { "Content-Type": transport.AI_MEDIA_GENERATION_STREAM_TYPE } }), () => {}), (error: unknown) => error instanceof Error && /incomplète/.test(error.message) && !/private.invalid/.test(error.message));
  }
  for (const [contentType, value] of [["text/html", "private diagnostics https://private.invalid"], ["application/json", '{"ok":']] as const) {
    await assert.rejects(transport.readAiMediaGenerationResponse(new Response(value, { status: 502, headers: { "Content-Type": contentType } }), () => {}), (error: unknown) => error instanceof Error && /incomplète/.test(error.message) && !/private.invalid/.test(error.message));
  }
});
