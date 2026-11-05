import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test, { type TestContext } from "node:test";
import ts from "typescript";
import {
  clearInrStudioHandoff,
  createInrStudioHandoff,
  loadInrStudioHandoffSourceFile,
  readInrStudioHandoff,
  type InrStudioHandoff,
} from "../../lib/inrStudioNavigation.ts";

const FOREIGN_KEY = "unrelated:active-editor", CAPACITY_BYTES = 8_192;
const PUBLIC_ERROR = "Impossible d’ouvrir iNrStudio. Votre brouillon est conservé. Réessayez.";
type HandoffInput = Parameters<typeof createInrStudioHandoff>[0] & { transport?: "embedded" };

function replaceGlobal(t: TestContext, name: string, value: unknown) {
  const previous = Object.getOwnPropertyDescriptor(globalThis, name);
  Object.defineProperty(globalThis, name, { configurable: true, value });
  t.after(() => { if (previous) Object.defineProperty(globalThis, name, previous); else Reflect.deleteProperty(globalThis, name); });
}

/** Model the Storage API's shared UTF-16 capacity, including its real exception. */
class CapacityStorage {
  values = new Map<string, string>();
  writes = 0;
  quotaFailures = 0;
  readonly capacityBytes: number;
  constructor(capacityBytes: number) { this.capacityBytes = capacityBytes; }
  get length() { return this.values.size; }
  key(index: number) { return [...this.values.keys()][index] ?? null; }
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) {
    this.writes++;
    const next = new Map(this.values); next.set(String(key), String(value));
    const bytes = [...next].reduce((sum, [entryKey, entryValue]) => sum + 2 * (entryKey.length + entryValue.length), 0);
    if (bytes > this.capacityBytes) {
      this.quotaFailures++;
      throw new DOMException(`Failed to execute 'setItem' on 'Storage': Setting the value of '${key}' exceeded the quota.`, "QuotaExceededError");
    }
    this.values = next;
  }
  removeItem(key: string) { this.values.delete(key); }
  clear() { assert.fail("Opening Studio must never clear another editor's storage"); }
}

function fullBrowser(t: TestContext) {
  const storage = new CapacityStorage(CAPACITY_BYTES), foreignValue = "x".repeat(CAPACITY_BYTES / 2 - FOREIGN_KEY.length);
  storage.setItem(FOREIGN_KEY, foreignValue);
  let cacheOpens = 0, networkRequests = 0;
  replaceGlobal(t, "window", {
    sessionStorage: storage,
    caches: { open: async () => { cacheOpens++; throw new Error("Embedded Studio must not depend on Cache API"); } },
    location: { origin: "https://fixture.invalid", pathname: "/dashboard", search: "?action=publish", hash: "" },
  });
  replaceGlobal(t, "fetch", async () => { networkRequests++; assert.fail("Opening Studio must not generate, publish or call a provider"); });
  return { storage, foreignValue, cacheOpens: () => cacheOpens, networkRequests: () => networkRequests };
}

function nativeExpression(name: string, callName?: string) {
  const file = "app/dashboard/booster/publier/PublishModal.tsx", source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
  let expression: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (!callName && ts.isVariableDeclaration(node) && node.name.getText(ast) === name) expression = node.initializer;
    if (callName && ts.isCallExpression(node) && node.expression.getText(ast) === callName && node.arguments[0] && ts.isObjectLiteralExpression(node.arguments[0])) {
      const property = node.arguments[0].properties.find(entry => ts.isPropertyAssignment(entry) && entry.name.getText(ast) === name);
      if (property && ts.isPropertyAssignment(property)) expression = property.initializer;
    }
    ts.forEachChild(node, visit);
  };
  visit(ast); assert.ok(expression, `The real ${name} callback must be exercised`);
  return ts.transpileModule(`const callback = (${expression.getText(ast)});`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
}

function bind<Result>(source: string, dependencies: Record<string, unknown>): Result {
  return new Function("dependencies", `with (dependencies) { ${source}\nreturn callback; }`)(dependencies) as Result;
}

function booster(t: TestContext, save: () => Promise<string | null> = async () => "draft-saved") {
  const browser = fullBrowser(t), order: string[] = [], errors: string[] = [], handoffs: InrStudioHandoff[] = [], opened: string[] = [];
  const studioOpeningRef = { current: false }, originalIdea = "Notre offre de rénovation", originalContent = "Le texte existant du professionnel";
  const dependencies = {
    loadedPublicationDraftId: null as string | null, publicationDraftIdParam: "", hasDraftablePublicationContent: true, hasUnsavedChanges: true,
    lastSavedStudioVideoDraftRef: { current: null }, studioOpeningRef, idea: originalIdea, content: originalContent,
    onSavePublicationDraft: async (options: { updateRoute?: boolean }) => { assert.equal(options.updateRoute, false); order.push("save"); const id = await save(); if (id) order.push("saved"); return id; },
    preparePublicationDraftForStudio: async () => null as { draftId: string | null; returnHref: string | null; videoDraft: null } | null,
    createInrStudioHandoff: async (input: HandoffInput) => {
      order.push("handoff"); assert.equal(input.transport, "embedded"); assert.ok(order.indexOf("saved") < order.indexOf("handoff"));
      const result = await createInrStudioHandoff(input); handoffs.push(result.handoff); return result;
    },
    clearInrStudioHandoff,
    openStudio: (href: string) => {
      order.push("open"); const key = new URL(href, "https://fixture.invalid").searchParams.get("studio_handoff"), handoff = readInrStudioHandoff(key);
      assert.ok(handoff, "The native reader must resolve the embedded transfer despite exhausted Storage");
      assert.equal(handoff.context.draftId, "draft-saved"); assert.equal(handoff.returnHref, "/dashboard?action=publish&draftId=draft-saved"); opened.push(href);
    },
    i18nT: (key: string) => { assert.equal(key, "studio_open_unavailable"); return PUBLIC_ERROR; },
    setImgError: (message: string) => { errors.push(message); },
  };
  dependencies.preparePublicationDraftForStudio = bind(nativeExpression("preparePublicationDraftForStudio"), dependencies);
  const open = bind<(kind?: "image" | "video") => Promise<void>>(nativeExpression("openInrStudioGenerator"), dependencies);
  const closed = bind<() => void>(nativeExpression("onClosed", "useInrStudioSession"), dependencies);
  t.after(async () => { for (const handoff of handoffs) await clearInrStudioHandoff(handoff.key); });
  return { ...browser, order, errors, handoffs, opened, dependencies, studioOpeningRef, originalIdea, originalContent, open, closed };
}

test("native Booster Generate saves the draft before an embedded Studio transfer even when unrelated Storage is full", async t => {
  const h = booster(t); await h.open("image");
  assert.deepEqual(h.order, ["save", "saved", "handoff", "open"]); assert.equal(h.opened.length, 1); assert.equal(h.handoffs.length, 1);
  assert.equal(h.handoffs[0].context.mediaType, "image"); assert.equal(h.handoffs[0].publicationBrief, h.originalIdea); assert.equal(h.handoffs[0].payload, null); assert.equal(h.handoffs[0].source, null);
  assert.equal(h.storage.getItem(FOREIGN_KEY), h.foreignValue); assert.equal(h.storage.length, 1); assert.equal(h.storage.writes, 1); assert.equal(h.storage.quotaFailures, 0);
  assert.equal(h.cacheOpens(), 0); assert.equal(h.networkRequests(), 0); assert.equal(h.studioOpeningRef.current, true, "The open Studio owns the launch lock until its actual close callback");
  h.closed(); assert.equal(h.studioOpeningRef.current, false);
  assert.equal(h.dependencies.idea, h.originalIdea); assert.equal(h.dependencies.content, h.originalContent); assert.ok(h.errors.every(error => error === ""));
});

test("two native Generate clicks before React commits share one save and one Studio opening", async t => {
  let releaseSave!: (value: string) => void;
  const h = booster(t, () => new Promise(resolve => { releaseSave = resolve; }));
  const first = h.open("image"), second = h.open("video");
  assert.deepEqual(h.order, ["save"]); assert.equal(h.studioOpeningRef.current, true);
  releaseSave("draft-saved"); await Promise.all([first, second]);
  assert.deepEqual(h.order, ["save", "saved", "handoff", "open"]); assert.equal(h.handoffs[0].context.mediaType, "image"); assert.equal(h.opened.length, 1);
  await h.open("video"); assert.equal(h.opened.length, 1, "Further clicks while Studio is open cannot allocate orphan transfers");
  assert.equal(h.storage.getItem(FOREIGN_KEY), h.foreignValue); assert.equal(h.networkRequests(), 0); assert.equal(h.studioOpeningRef.current, true); h.closed(); assert.equal(h.studioOpeningRef.current, false);
});

test("a failed draft preparation preserves the editor and exposes only the localized Studio error", async t => {
  const h = booster(t, async () => { throw new DOMException("Failed to execute 'setItem' on 'Storage': inrcy:studio:handoff:v1:private exceeded quota", "QuotaExceededError"); });
  await h.open("image"); assert.deepEqual(h.order, ["save"]); assert.equal(h.opened.length, 0); assert.equal(h.handoffs.length, 0);
  assert.equal(h.errors.at(-1), PUBLIC_ERROR); assert.doesNotMatch(h.errors.join(" "), /Storage|setItem|inrcy:studio:|quota|private/);
  assert.equal(h.dependencies.idea, h.originalIdea); assert.equal(h.dependencies.content, h.originalContent); assert.equal(h.storage.getItem(FOREIGN_KEY), h.foreignValue); assert.equal(h.studioOpeningRef.current, false); assert.equal(h.networkRequests(), 0);
});

test("a declined native draft save never creates a handoff or starts a generation", async t => {
  const h = booster(t, async () => null); await h.open("video");
  assert.deepEqual(h.order, ["save"]); assert.equal(h.opened.length, 0); assert.equal(h.handoffs.length, 0); assert.equal(h.networkRequests(), 0); assert.equal(h.studioOpeningRef.current, false);
  assert.equal(h.dependencies.idea, h.originalIdea); assert.equal(h.storage.getItem(FOREIGN_KEY), h.foreignValue);
});

test("a failed native Studio opening clears its exact transfer and an explicit retry reuses the saved draft", async t => {
  const h = booster(t), openStudio = h.dependencies.openStudio;
  h.dependencies.openStudio = () => { h.order.push("open-failed"); throw new DOMException("Failed to execute 'setItem' on 'Storage': private-key exceeded quota", "QuotaExceededError"); };
  await h.open("image");
  assert.deepEqual(h.order, ["save", "saved", "handoff", "open-failed"]); assert.equal(h.opened.length, 0); assert.equal(h.handoffs.length, 1); assert.equal(readInrStudioHandoff(h.handoffs[0].key), null);
  assert.equal(h.studioOpeningRef.current, false); assert.equal(h.errors.at(-1), PUBLIC_ERROR); assert.doesNotMatch(h.errors.join(" "), /Storage|setItem|private-key|quota/);
  h.dependencies.loadedPublicationDraftId = "draft-saved"; h.dependencies.hasUnsavedChanges = false; h.dependencies.openStudio = openStudio;
  await h.open("image");
  assert.equal(h.order.filter(step => step === "save").length, 1, "The durable draft already saved before the first attempt must be reused");
  assert.equal(h.opened.length, 1); assert.equal(h.handoffs.length, 2); assert.equal(h.handoffs[1].context.draftId, "draft-saved"); assert.equal(h.networkRequests(), 0); assert.equal(h.storage.getItem(FOREIGN_KEY), h.foreignValue); h.closed();
});

test("an embedded local File remains readable without Storage or Cache writes and clears only its own transfer", async t => {
  const h = fullBrowser(t), file = new File([new Uint8Array([1, 2, 3, 4])], "source.png", { type: "image/png", lastModified: 42 });
  const input = { tab: "retouch" as const, origin: "booster-publish", transport: "embedded" as const, source: { file }, context: { draftId: "draft-saved" } };
  const first = await createInrStudioHandoff(input), second = await createInrStudioHandoff({ ...input, tab: "modify" });
  try {
    const restored = await loadInrStudioHandoffSourceFile(first.handoff); assert.ok(restored instanceof File); assert.equal(restored.name, file.name); assert.equal(restored.lastModified, file.lastModified);
    assert.deepEqual([...new Uint8Array(await restored.arrayBuffer())], [1, 2, 3, 4]);
    await clearInrStudioHandoff(first.handoff.key); assert.equal(readInrStudioHandoff(first.handoff.key), null); assert.equal(readInrStudioHandoff(second.handoff.key)?.key, second.handoff.key);
    assert.equal(h.storage.getItem(FOREIGN_KEY), h.foreignValue); assert.equal(h.storage.writes, 1); assert.equal(h.cacheOpens(), 0); assert.equal(h.networkRequests(), 0);
    assert.deepEqual([...new Uint8Array(await file.arrayBuffer())], [1, 2, 3, 4], "Releasing Studio never changes the original editor File");
    t.mock.method(h.storage, "getItem", () => { throw new DOMException("Storage blocked", "SecurityError"); });
    t.mock.method(h.storage, "removeItem", () => { throw new DOMException("Storage blocked", "SecurityError"); });
    await clearInrStudioHandoff(second.handoff.key); assert.equal(readInrStudioHandoff(second.handoff.key), null); assert.equal(h.storage.values.get(FOREIGN_KEY), h.foreignValue);
  } finally { await clearInrStudioHandoff(first.handoff.key); await clearInrStudioHandoff(second.handoff.key); }
});

test("route-based handoff persistence reports a public failure without clearing unrelated full Storage", async t => {
  const h = fullBrowser(t);
  await assert.rejects(createInrStudioHandoff({ tab: "generate", origin: "booster-publish", publicationBrief: "Brief conservé" }), error => {
    assert.ok(error instanceof Error); assert.doesNotMatch(error.message, /Storage|setItem|inrcy:studio:|quota|private/); assert.match(error.message, /iNrStudio|brouillon|réessay/i); return true;
  });
  assert.equal(h.storage.quotaFailures, 1); assert.equal(h.storage.getItem(FOREIGN_KEY), h.foreignValue); assert.equal(h.storage.length, 1); assert.equal(h.networkRequests(), 0);
});
