import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as contracts from "../../lib/aiMediaGenerationContracts.ts";
import * as models from "../../lib/aiMediaModelCatalog.ts";
import * as transport from "../../lib/aiMediaGenerationTransport.ts";
import * as recovery from "../../lib/aiMediaGenerationRecovery.ts";
import * as characterVoices from "../../lib/aiMediaCharacterVoiceClient.ts";

type Scope = { accountId: string | null; kind: "image" | "video"; isCurrent: () => boolean };
type Hook = { result: { item: { id: string } } | null; loadQuota: () => Promise<unknown>; retryRecovery: () => Promise<unknown>; discardDraft: () => Promise<void> };
const pointer = { requestId: "request-before-0001", kind: "video", format: "story", mediaId: "media-before" } as const;
function memory() {
  const entries = new Map<string, string>();
  return { entries, getItem: (key: string) => entries.get(key) ?? null, setItem(key: string, value: string) { entries.set(key, value); }, removeItem(key: string) { entries.delete(key); } };
}

/** Execute the exported production DELETE helper with controlled HTTP and real recovery storage. */
function harness() {
  const storage = memory(); const session = memory(); const calls: Array<{ url: string; init: RequestInit }> = [];
  let respond!: (response: Response) => void;
  let current = true; let now = 0; let cursor = 0; let dirty = false; let hook!: Hook;
  const slots: Array<{ value?: unknown; deps?: unknown[]; cleanup?: () => void }> = [];
  const effects: Array<() => void> = [];
  const react = {
    useState(initial: unknown) { const index = cursor++; const slot = slots[index] ||= { value: typeof initial === "function" ? initial() : initial }; return [slot.value, (next: unknown) => { const value = typeof next === "function" ? next(slot.value) : next; if (!Object.is(value, slot.value)) { slot.value = value; dirty = true; } }]; },
    useRef(initial: unknown) { const index = cursor++; return (slots[index] ||= { value: { current: initial } }).value; },
    useCallback(value: unknown, deps: unknown[]) { const index = cursor++; const slot = slots[index] ||= {}; if (!slot.deps || deps.some((item, i) => item !== slot.deps![i])) { slot.deps = deps; slot.value = value; } return slot.value; },
    useEffect(effect: () => void | (() => void), deps: unknown[]) { const index = cursor++; const slot = slots[index] ||= {}; if (!slot.deps || deps.some((item, i) => item !== slot.deps![i])) { slot.deps = deps; effects.push(() => { slot.cleanup?.(); slot.cleanup = effect() || undefined; }); } },
  };
  const output = ts.transpileModule(readFileSync(new URL("../../app/dashboard/_hooks/useMediaGeneration.ts", import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const modules = new Map<string, unknown>([
    ["react", react], ["@/lib/multicompte/constants", { ACTIVE_INRCY_ACCOUNT_EVENT: "account-change" }],
    ["@/lib/aiMediaGenerationContracts", contracts], ["@/lib/aiMediaModelCatalog", models],
    ["@/lib/aiMediaGenerationTransport", transport], ["@/lib/aiMediaGenerationRecovery", recovery],
    ["@/lib/aiMediaCharacterVoiceClient", characterVoices],
  ]);
  const record = { exports: {} as { default: () => Hook; discardMediaGenerationDraft: (mediaId: string, scope?: Scope) => Promise<boolean> } };
  new Function("module", "exports", "require", "window", "fetch", output)(record, record.exports, (name: string) => {
    assert.ok(modules.has(name), `Unexpected hook dependency: ${name}`); return modules.get(name);
  }, {
    localStorage: storage, sessionStorage: session,
    performance: { now: () => now }, addEventListener() {}, removeEventListener() {}, setInterval: () => 1, clearInterval() {},
    setTimeout(callback: () => void) { queueMicrotask(callback); return 1; }, clearTimeout() {},
    requestAnimationFrame(callback: (time: number) => void) { queueMicrotask(() => { now += 1_000; callback(now); }); return 1; },
  }, (url: string, init: RequestInit) => {
    if (url.endsWith("/quota")) { assert.equal(init.method, "GET"); return Promise.resolve(Response.json({ quota: { accountId: "account-a", creditsReady: true, credits: { unit: "credit", remaining: 0, reserved: 0 } } })); }
    if (url.startsWith("/api/media-generation/status?")) { assert.equal(init.method, "GET"); return Promise.resolve(Response.json({ ok: true, status: "completed", draft: true, item: { id: pointer.mediaId, media_type: "video", signed_url: "https://example.invalid/media.mp4" } })); }
    assert.equal(url, "/api/media-generation/drafts/media-before"); assert.equal(init.method, "DELETE");
    calls.push({ url, init }); return new Promise<Response>(resolve => { respond = resolve; });
  });
  const scope = { accountId: "account-a", kind: "video", isCurrent: () => current } as Scope;
  recovery.writeAiMediaGenerationRecovery(storage, "account-a", pointer);
  const render = () => { let turns = 0; do { assert.ok(++turns < 30); dirty = false; cursor = 0; hook = record.exports.default(); for (const effect of effects.splice(0)) effect(); } while (dirty); return hook; };
  const flush = async () => { for (let turn = 0; turn < 4; turn++) { await new Promise(resolve => setImmediate(resolve)); if (dirty) render(); } };
  return {
    storage, session, calls, scope,
    render, flush, status: () => hook,
    dispose() { for (const slot of slots) slot.cleanup?.(); },
    discard: (overrides: Partial<Scope> = {}) => record.exports.discardMediaGenerationDraft(pointer.mediaId, { ...scope, ...overrides }),
    unscoped: () => record.exports.discardMediaGenerationDraft(pointer.mediaId),
    respond(response: Response) { respond(response); },
    changeAccount() { current = false; },
    saved(account = "account-a") { return recovery.readAiMediaGenerationRecovery(recovery.createAiMediaRecoveryStorage(storage, session), account); },
  };
}

test("confirmed discard clears only its snapshotted account, kind, request and media pointer", async () => {
  const h = harness();
  recovery.writeAiMediaGenerationRecovery(h.storage, "account-b", { ...pointer, requestId: "other-account-0001", mediaId: "media-account-b" });
  const discarded = h.discard(); h.respond(Response.json({ ok: true, discarded: true }));
  assert.equal(await discarded, true); assert.equal(h.saved(), null);
  assert.equal(h.saved("account-b")?.mediaId, "media-account-b");
  assert.equal(h.calls.length, 1); assert.equal(h.calls[0].init.credentials, "include");
});

test("a late discard acknowledgement preserves a newer request or media in the same account", async () => {
  for (const newer of [
    { ...pointer, requestId: "newer-request-0001" },
    { ...pointer, mediaId: "newer-media" },
    { ...pointer, kind: "image", format: "square" },
  ] as const) {
    const h = harness(); const discarded = h.discard();
    recovery.writeAiMediaGenerationRecovery(h.storage, "account-a", newer);
    h.respond(Response.json({ ok: true, discarded: true })); assert.equal(await discarded, true);
    assert.deepEqual(h.saved(), newer);
  }
});

test("switching the account while DELETE is pending preserves recovery pointers for both accounts", async () => {
  const h = harness(); const discarded = h.discard();
  recovery.writeAiMediaGenerationRecovery(h.storage, "account-b", { ...pointer, requestId: "new-account-0002", mediaId: "new-account-media" });
  h.changeAccount(); h.respond(Response.json({ ok: true, discarded: true }));
  assert.equal(await discarded, true); assert.deepEqual(h.saved(), pointer);
  assert.equal(h.saved("account-b")?.mediaId, "new-account-media");
});

test("failure, malformed or unconfirmed responses preserve the paid pointer", async () => {
  for (const response of [
    Response.json({ ok: true, discarded: false, accepted: true }),
    Response.json({ ok: false, discarded: true }),
    Response.json({ ok: true }),
    new Response('{"ok":', { headers: { "Content-Type": "application/json" } }),
    new Response(null, { status: 204 }),
    new Response(null, { status: 404 }),
    new Response(null, { status: 410 }),
  ]) {
    const h = harness(); const discarded = h.discard(); h.respond(response);
    assert.equal(await discarded, false); assert.deepEqual(h.saved(), pointer);
  }
  const h = harness(); const discarded = h.discard();
  h.respond(Response.json({ error: "Suppression indisponible" }, { status: 503 }));
  await assert.rejects(discarded, /Suppression indisponible/); assert.deepEqual(h.saved(), pointer);
});

test("wrong kind, missing account/media scope and unscoped legacy callers cannot clear a pointer", async () => {
  for (const scope of [{ kind: "image" }, { accountId: "account-b" }, { accountId: null }] as const) {
    const h = harness(); const discarded = h.discard(scope); h.respond(Response.json({ ok: true, discarded: true }));
    assert.equal(await discarded, true); assert.deepEqual(h.saved(), pointer);
  }
  const h = harness(); const discarded = h.unscoped(); h.respond(Response.json({ ok: true, discarded: true }));
  assert.equal(await discarded, true); assert.deepEqual(h.saved(), pointer);
});

test("confirmed discard also clears a matching legacy session pointer while a newer fallback survives", async () => {
  const h = harness(); h.storage.entries.clear();
  recovery.writeAiMediaGenerationRecovery(h.session, "account-a", pointer);
  const discarded = h.discard(); h.respond(Response.json({ ok: true, discarded: true }));
  assert.equal(await discarded, true); assert.equal(h.saved(), null); assert.equal(h.session.entries.size, 0);
  const newer = { ...pointer, requestId: "fallback-new-0002" };
  const next = harness(); const late = next.discard();
  recovery.writeAiMediaGenerationRecovery(next.session, "account-a", newer);
  next.respond(Response.json({ ok: true, discarded: true }));
  assert.equal(await late, true); assert.deepEqual(next.saved(), newer);
});

test("the real hook preserves the paid result after an uncertain discard and clears it only after confirmed retry", async () => {
  const h = harness(); h.render(); await h.status().loadQuota(); await h.flush();
  await h.status().retryRecovery(); await h.flush();
  assert.equal(h.status().result?.item.id, pointer.mediaId);
  const uncertain = h.status().discardDraft(); h.respond(new Response('{"ok":', { headers: { "Content-Type": "application/json" } }));
  await assert.rejects(uncertain, /suppression du brouillon/); h.render();
  assert.equal(h.status().result?.item.id, pointer.mediaId); assert.deepEqual(h.saved(), pointer);
  const confirmed = h.status().discardDraft(); h.respond(Response.json({ ok: true, discarded: true })); await confirmed; h.render();
  assert.equal(h.status().result, null); assert.equal(h.saved(), null); assert.equal(h.calls.length, 2); h.dispose();
});
