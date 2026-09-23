import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test, { type TestContext } from "node:test";

import {
  buildInrStudioReturnHref,
  clearInrStudioHandoff,
  consumeInrStudioReturn,
  createInrStudioHandoff,
  loadInrStudioHandoffSourceFile,
  readInrStudioHandoff,
  saveInrStudioReturn,
} from "../../lib/inrStudioNavigation.ts";
import { captureInrStudioViewport } from "../../lib/inrStudioViewport.ts";

const read = (name: string) => readFileSync(path.resolve(name), "utf8");

function replaceGlobal(t: TestContext, name: string, value: unknown) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value });
  t.after(() => {
    if (previous) Object.defineProperty(globalThis, name, previous);
    else Reflect.deleteProperty(globalThis, name);
  });
}

class ViewportElement {
  isConnected = true;
  scrollTop = 0;
  scrollLeft = 0;
  clientHeight = 100;
  scrollHeight = 600;
  clientWidth = 100;
  scrollWidth = 400;
  focused: FocusOptions[] = [];
  restored: ScrollToOptions[] = [];

  scrollTo(position: ScrollToOptions) {
    this.restored.push(position);
    this.scrollTop = position.top || 0;
    this.scrollLeft = position.left || 0;
  }

  focus(options: FocusOptions) {
    this.focused.push(options);
  }
}

function viewport(t: TestContext, nodes: ViewportElement[], active: unknown = null) {
  const windowCalls: ScrollToOptions[] = [];
  const view = {
    scrollX: 17,
    scrollY: 321,
    scrollTo(position: ScrollToOptions) { windowCalls.push(position); },
  };
  replaceGlobal(t, "HTMLElement", ViewportElement);
  replaceGlobal(t, "document", {
    activeElement: active,
    querySelectorAll: () => nodes,
  });
  replaceGlobal(t, "window", view);
  return { view, windowCalls };
}

test("embedded Studio restores nested scroll, window and the original focus without focus scrolling", (t) => {
  const outer = new ViewportElement();
  const inner = new ViewportElement();
  outer.scrollTop = 230;
  inner.scrollTop = 91;
  inner.scrollLeft = 42;
  const { view, windowCalls } = viewport(t, [outer, inner], inner);
  const restore = captureInrStudioViewport();
  outer.scrollTop = 5;
  inner.scrollTop = 0;
  inner.scrollLeft = 0;
  view.scrollX = 0;
  view.scrollY = 0;
  restore();
  assert.equal(outer.scrollTop, 230);
  assert.equal(inner.scrollTop, 91);
  assert.equal(inner.scrollLeft, 42);
  assert.deepEqual(windowCalls, [{ left: 17, top: 321, behavior: "instant" }]);
  assert.deepEqual(inner.focused, [{ preventScroll: true }]);
});

test("embedded Studio also restores a scrollable origin initially at zero", (t) => {
  const origin = new ViewportElement();
  viewport(t, [origin]);
  const restore = captureInrStudioViewport();
  origin.scrollTop = 140;
  origin.scrollLeft = 32;
  restore();
  assert.equal(origin.scrollTop, 0);
  assert.equal(origin.scrollLeft, 0);
});

test("viewport restoration skips detached scroll and focus nodes", (t) => {
  const removed = new ViewportElement();
  removed.scrollTop = 60;
  const { windowCalls } = viewport(t, [removed], removed);
  const restore = captureInrStudioViewport();
  removed.isConnected = false;
  restore();
  assert.deepEqual(removed.restored, []);
  assert.deepEqual(removed.focused, []);
  assert.equal(windowCalls.length, 1);
});

test("viewport snapshots are immutable and tolerate a non-HTML active element", (t) => {
  const origin = new ViewportElement();
  origin.scrollTop = 35;
  viewport(t, [origin], { isConnected: true, focus() { assert.fail("non-HTML focus"); } });
  const restore = captureInrStudioViewport();
  origin.scrollTop = 90;
  restore();
  origin.scrollTop = 150;
  restore();
  assert.equal(origin.scrollTop, 35);
  assert.equal(origin.restored.length, 2);
});

class MemoryStorage {
  values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
}

class MemoryCache {
  values = new Map<string, Response>();
  async put(request: Request, response: Response) { this.values.set(request.url, response.clone()); }
  async match(request: Request) { return this.values.get(request.url)?.clone(); }
  async delete(request: Request) { return this.values.delete(request.url); }
}

function navigation(t: TestContext) {
  const storage = new MemoryStorage();
  const cache = new MemoryCache();
  const created: string[] = [];
  const revoked: string[] = [];
  t.mock.method(URL, "createObjectURL", () => {
    const url = `blob:studio-owned-${created.length + 1}`;
    created.push(url);
    return url;
  });
  t.mock.method(URL, "revokeObjectURL", (url: string) => { revoked.push(url); });
  replaceGlobal(t, "window", {
    sessionStorage: storage,
    caches: { open: async () => cache },
    location: { origin: "https://app.inrcy.test", pathname: "/dashboard", search: "?draft=42", hash: "#editor" },
  });
  return { storage, cache, created, revoked };
}

const sourceFile = () => new File([new Uint8Array([1, 2, 3])], "origin.png", { type: "image/png", lastModified: 123 });

test("closing Studio revokes its own blob exactly once and clears its durable copy", async (t) => {
  const { cache, created, revoked } = navigation(t);
  const { handoff } = await createInrStudioHandoff({ tab: "retouch", origin: "booster", source: { file: sourceFile() } });
  assert.equal(handoff.source?.ownsObjectUrl, true);
  assert.equal(created.length, 1);
  const loaded = await loadInrStudioHandoffSourceFile(handoff);
  assert.ok(loaded instanceof File);
  assert.deepEqual(Array.from(new Uint8Array(await loaded.arrayBuffer())), [1, 2, 3]);
  await clearInrStudioHandoff(handoff.key);
  await clearInrStudioHandoff(handoff.key);
  assert.deepEqual(revoked, created);
  assert.equal(cache.values.size, 0);
  assert.equal(readInrStudioHandoff(handoff.key), null);
});

test("closing Studio never revokes a borrowed editor blob, even with a cached File", async (t) => {
  const { cache, created, revoked } = navigation(t);
  const { handoff } = await createInrStudioHandoff({
    tab: "retouch", origin: "inrsend", source: { file: sourceFile(), url: "blob:editor-owned" },
  });
  assert.equal(handoff.source?.url, "blob:editor-owned");
  assert.equal(handoff.source?.ownsObjectUrl, false);
  assert.deepEqual(created, []);
  assert.equal(cache.values.size, 1);
  await clearInrStudioHandoff(handoff.key);
  assert.deepEqual(revoked, []);
  assert.equal(cache.values.size, 0);
});

test("legacy handoffs without ownership metadata cannot revoke editor URLs", async (t) => {
  const { storage, revoked } = navigation(t);
  const { handoff } = await createInrStudioHandoff({ tab: "modify", origin: "inr-agent", source: { url: "blob:legacy-editor" } });
  delete handoff.source!.ownsObjectUrl;
  storage.setItem(`inrcy:studio:handoff:v1:${handoff.key}`, JSON.stringify(handoff));
  await clearInrStudioHandoff(handoff.key);
  assert.deepEqual(revoked, []);
});

test("clearing one Studio session preserves a distinct concurrent handoff", async (t) => {
  const { cache, revoked } = navigation(t);
  const first = await createInrStudioHandoff({ tab: "retouch", origin: "booster", source: { file: sourceFile() } });
  const second = await createInrStudioHandoff({ tab: "retouch", origin: "inrsend", source: { file: sourceFile() } });
  await clearInrStudioHandoff(first.handoff.key);
  assert.equal(readInrStudioHandoff(second.handoff.key)?.key, second.handoff.key);
  assert.equal(cache.values.size, 1);
  assert.deepEqual(revoked, [first.handoff.source!.url]);
  await clearInrStudioHandoff(second.handoff.key);
});

test("failed session persistence releases the newly allocated blob and cache", async (t) => {
  const { storage, cache, created, revoked } = navigation(t);
  t.mock.method(storage, "setItem", () => { throw new Error("storage_quota_exceeded"); });
  await assert.rejects(createInrStudioHandoff({
    tab: "retouch", origin: "booster", source: { file: sourceFile() },
  }), /storage_quota_exceeded/);
  assert.equal(created.length, 1);
  assert.deepEqual(revoked, created);
  assert.equal(cache.values.size, 0);
  assert.equal(storage.values.size, 0);
});

test("failed session persistence still preserves a borrowed editor blob", async (t) => {
  const { storage, cache, created, revoked } = navigation(t);
  t.mock.method(storage, "setItem", () => { throw new Error("storage_unavailable"); });
  await assert.rejects(createInrStudioHandoff({
    tab: "retouch", origin: "inrsend", source: { file: sourceFile(), url: "blob:editor-still-visible" },
  }), /storage_unavailable/);
  assert.deepEqual(created, []);
  assert.deepEqual(revoked, []);
  assert.equal(cache.values.size, 0);
});

test("navigation returns exactly once with origin context, query and anchor intact", async (t) => {
  navigation(t);
  const { handoff } = await createInrStudioHandoff({
    tab: "generate", origin: "booster", context: { channel: "instagram", draft: 42 },
  });
  assert.equal(buildInrStudioReturnHref(handoff), `/dashboard?draft=42&studio_return=${handoff.returnKey}#editor`);
  saveInrStudioReturn({ version: 1, returnKey: handoff.returnKey, handoffKey: handoff.key, action: "generate", createdAt: Date.now(), context: handoff.context, item: { id: "accepted" } });
  assert.deepEqual(consumeInrStudioReturn(handoff.returnKey)?.context, { channel: "instagram", draft: 42 });
  assert.equal(consumeInrStudioReturn(handoff.returnKey), null);
  await clearInrStudioHandoff(handoff.key);
});

test("embedded sessions keep the origin mounted and restore the viewport after closing", () => {
  const hook = read("app/dashboard/_hooks/useInrStudioSession.tsx");
  assert.doesNotMatch(hook, /useRouter|router\.(?:push|replace)|window\.location\s*=/);
  assert.match(hook, /ssr:\s*false/);
  assert.match(hook, /if \(sessionRef\.current\) return/);
  assert.match(hook, /restoreRef\.current = captureInrStudioViewport\(\)/);
  assert.match(hook, /useLayoutEffect\(\(\) => \{\s*if \(session \|\| !restoreRef\.current\) return;\s*restoreRef\.current\(\)/);
  assert.match(hook, /<Studio key=\{session\.key\} embeddedHandoff=\{session\}/);
  assert.match(hook, /pendingReturnRef\.current = resolve/);
  assert.match(hook, /const completeReturn = useCallback/);
});

test("embedded media delivery waits for origin acknowledgment before releasing its source and closing", () => {
  const client = read("app/dashboard/generer-media/MediaGeneratorStudioClient.tsx");
  assert.match(client, /if \(onEmbeddedReturn && onEmbeddedClose\) \{\s*await onEmbeddedReturn\(result\);\s*await clearInrStudioHandoff\(handoff\.key\);\s*onEmbeddedClose\(\);\s*return;/);
  assert.match(client, /embedded=\{Boolean\(embeddedHandoff\)\}/);
  assert.match(client, /!embeddedHandoff \? <main/);
  assert.match(client, /if \(onEmbeddedClose\) onEmbeddedClose\(\);\s*else router\.replace\(returnHref\)/);
});

test("StrictMode source reloading shares one Promise and cannot revoke the handoff on effect replay", () => {
  const client = read("app/dashboard/generer-media/MediaGeneratorStudioClient.tsx");
  const sourceEffect = client.slice(client.indexOf("useEffect(() => {"), client.indexOf("const closeStudio = useCallback"));
  assert.match(sourceEffect, /sourceLoadRef\.current\?\.handoffKey !== nextHandoff\.key/);
  assert.match(sourceEffect, /promise: loadInrStudioHandoffSourceFile\(nextHandoff\)/);
  assert.match(sourceEffect, /file = await sourceLoadRef\.current\.promise/);
  assert.match(sourceEffect, /if \(active\) setInitialSource\(file\)/);
  assert.match(sourceEffect, /return \(\) => \{\s*active = false;/);
  assert.doesNotMatch(sourceEffect, /clearInrStudioHandoff|revokeObjectURL/);
});

test("embedded modal isolates origin interaction and restores prior inert state", () => {
  const modal = read("app/dashboard/_components/MediaGeneratorModal.tsx");
  assert.match(modal, /node !== layerRef\.current/);
  assert.match(modal, /node, inert: node\.inert/);
  assert.match(modal, /node\.inert = true/);
  assert.match(modal, /node\.inert = inert/);
  assert.match(modal, /if \(embedded\) event\.stopPropagation\(\)/);
  assert.match(modal, /onKeyDown=\{handleKeyDown\}/);
  assert.doesNotMatch(modal, /window\.addEventListener\("keydown"/);
  assert.match(modal, /focus\(\{ preventScroll: true \}\)/);
});
