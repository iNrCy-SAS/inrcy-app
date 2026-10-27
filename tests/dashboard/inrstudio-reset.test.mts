import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

const read = (path: string) => readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
const modalPath = "app/dashboard/_components/MediaGeneratorModal.tsx";
const source = ts.createSourceFile(modalPath, read(modalPath), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);

function handler<T = void>(name: string, context: Record<string, unknown>) {
  let expression: ts.Expression | undefined;
  function visit(node: ts.Node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.name.text === name) expression = node.initializer;
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.ok(expression, `Missing handler ${name}`);
  const code = ts.transpileModule(`const run = ${expression.getText(source)};`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
  }).outputText;
  return new Function("useCallback", ...Object.keys(context), `${code}; return run;`)(
    (callback: unknown) => callback, ...Object.values(context),
  ) as () => Promise<T>;
}

function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>((yes) => { resolve = yes; });
  return { promise, resolve };
}

function context(draft = true) {
  const events: string[] = [];
  const state: Record<string, unknown> = {
    currentResult: { draft, item: { id: "owned-preview" } }, generationPrompt: "Keep this until confirmed",
    freeMediaType: "video", visitedFreeTypes: ["image", "video"], generationSession: 4,
    studioTab: "generate", closeConfirmOpen: false, resetRequested: false, locked: false, pendingRecovery: false,
  };
  const set = (name: string) => (value: unknown) => {
    state[name] = typeof value === "function" ? value(state[name]) : value;
    events.push(`set:${name}`);
  };
  const draftReplacementResolutionRef: { current: ((approved: boolean) => void) | null } = { current: null };
  return {
    state, events, locked: false, activeMediaType: "video", studioTab: "generate", pendingRecovery: false,
    hasExternalHandoff: false, hasWorkspaceDraft: true, workspaceBusy: false, closeConfirmOpen: false,
    closeInFlightRef: { current: false }, sessionVersionRef: { current: 2 },
    draftReplacementResolutionRef,
    openedRef: { current: true }, currentResultRef: { current: state.currentResult },
    discardMediaGenerationDraft: async (id: string) => { events.push(`discard:${id}`); },
    setLocked: set("locked"), setCurrentResult: set("currentResult"), setGenerationPrompt: set("generationPrompt"),
    setVisitedFreeTypes: set("visitedFreeTypes"), setFreeMediaType: set("freeMediaType"),
    setGenerationSession: set("generationSession"), setStudioTab: set("studioTab"),
    setMediaTypeByTab: set("mediaTypeByTab"), setRetoucherDirty: set("retoucherDirty"),
    setResetRequested: set("resetRequested"), setCloseConfirmOpen: set("closeConfirmOpen"),
    setPendingRecovery: set("pendingRecovery"),
    window: { requestAnimationFrame(callback: () => void) { callback(); } },
    dialogRef: { current: { querySelector() { return { focus() { events.push("focus:generate"); } }; } } },
  };
}

test("asking to reset and cancelling preserve the prompt, preview and both media forms", async () => {
  const ctx = context();
  const original = structuredClone(ctx.state);
  await handler("requestReset", ctx)();
  assert.equal(ctx.state.resetRequested, true);
  assert.equal(ctx.state.closeConfirmOpen, true);
  assert.equal(ctx.state.generationPrompt, original.generationPrompt);
  assert.deepEqual(ctx.state.currentResult, original.currentResult);
  assert.deepEqual(ctx.state.visitedFreeTypes, ["image", "video"]);
  assert.equal(ctx.events.some((event) => event.startsWith("discard:")), false);
  await handler("cancelClose", ctx)();
  assert.equal(ctx.state.closeConfirmOpen, false);
  assert.equal(ctx.state.resetRequested, false);
  assert.deepEqual(ctx.state.currentResult, original.currentResult);
});

test("confirmed reset waits for draft cleanup, clears both forms and unlocks a new creation", async () => {
  const ctx = context();
  const pending = deferred();
  const run = handler("confirmReset", {
    ...ctx, discardMediaGenerationDraft: async (id: string) => {
      ctx.events.push(`discard:${id}`); await pending.promise;
    },
  });
  const resetting = run();
  assert.equal(ctx.closeInFlightRef.current, true);
  assert.equal(ctx.state.locked, true);
  assert.equal(ctx.state.generationPrompt, "Keep this until confirmed");
  assert.notEqual(ctx.currentResultRef.current, null);
  await run();
  assert.equal(ctx.events.filter((event) => event.startsWith("discard:")).length, 1);
  // Cancel/Escape cannot interrupt a reset that has already been confirmed.
  ctx.state.closeConfirmOpen = true;
  await handler("cancelClose", ctx)();
  assert.equal(ctx.state.closeConfirmOpen, true);
  pending.resolve();
  await resetting;
  assert.equal(ctx.state.currentResult, null);
  assert.equal(ctx.currentResultRef.current, null);
  assert.equal(ctx.state.generationPrompt, "");
  assert.deepEqual(ctx.state.visitedFreeTypes, ["video"]);
  assert.equal(ctx.state.generationSession, 5);
  assert.equal(ctx.state.studioTab, "generate");
  assert.equal(ctx.state.locked, false);
  assert.equal(ctx.state.closeConfirmOpen, false);
  assert.equal(ctx.closeInFlightRef.current, false);
  assert.equal(ctx.events.at(-1), "focus:generate");
});

test("resetting a saved image or video never deletes its library item", async () => {
  for (const kind of ["image", "video"]) {
    const ctx = context(false);
    await handler("confirmReset", { ...ctx, activeMediaType: kind })();
    assert.equal(ctx.events.some((event) => event.startsWith("discard:")), false);
    assert.equal(ctx.state.freeMediaType, kind);
    assert.equal(ctx.state.generationPrompt, "");
    assert.equal(ctx.state.currentResult, null);
  }
});

test("reset cannot hide a busy attempt or overwrite another establishment after asynchronous cleanup", async () => {
  for (const name of ["requestReset", "confirmReset"]) {
    const ctx = context();
    await handler(name, { ...ctx, locked: true })();
    assert.deepEqual(ctx.events, []);
  }
  const ctx = context();
  const pending = deferred();
  const resetting = handler("confirmReset", { ...ctx, discardMediaGenerationDraft: () => pending.promise })();
  ctx.sessionVersionRef.current += 1;
  ctx.state.generationPrompt = "New establishment";
  ctx.events.length = 0;
  pending.resolve();
  await resetting;
  assert.equal(ctx.state.generationPrompt, "New establishment");
  assert.deepEqual(ctx.events, []);
  assert.equal(ctx.closeInFlightRef.current, false);
});

test("temporary cleanup failure still allows starting over without generating or refunding credits", async () => {
  const ctx = context();
  await handler("confirmReset", {
    ...ctx, discardMediaGenerationDraft: async () => { throw Error("temporary cleanup outage"); },
  })();
  assert.equal(ctx.state.currentResult, null);
  assert.equal(ctx.state.generationSession, 5);
  assert.equal(ctx.state.locked, false);
  const modal = read(modalPath);
  const reset = modal.slice(modal.indexOf("const confirmReset"), modal.indexOf("const cancelClose"));
  assert.doesNotMatch(reset, /generate\(|acceptDraft\(|used_count|reserved_count|loadQuota|onClose\(/);
  // Recovery owns a potentially paid attempt; the Reset action must not bypass it.
  for (const file of ["MediaFreeGenerator", "MediaModifier"]) {
    assert.match(read(`app/dashboard/_components/${file}.tsx`), /handleReset=\{canRecover \? undefined : onReset\}/);
  }
});

test("all Studio locales provide help and reset warnings, including the unsaved preview and consumed credits", () => {
  const keys = Object.keys(JSON.parse(read("messages/fr-FR/media.json")))
    .filter((key) => /ai_generator_(?:prompt_helper_|workspace_reset_)/.test(key));
  assert.equal(keys.length, 23);
  for (const locale of ["fr-FR", "en-GB", "es-ES", "de-DE", "it-IT", "nl-NL", "pt-PT", "th-TH", "zh-CN"]) {
    const messages = JSON.parse(read(`messages/${locale}/media.json`));
    for (const key of keys) assert.ok(typeof messages[key] === "string" && messages[key].trim(), `${locale}: ${key}`);
  }
});

/** Execute the actual component effect callbacks, including their cleanups. */
function mountLifecycle(ctx: ReturnType<typeof context>) {
  const listeners = new Map<string, Set<() => void>>();
  const workspaceStates: Array<{ busy: boolean; hasDraft: boolean }> = [];
  let replacementRequest: (() => Promise<boolean>) | null = null;
  const environment = {
    ...ctx, open: true, mounted: false, embedded: false, hasPendingWork: true,
    hasExternalHandoff: false, closeConfirmOpen: false, initialFreeMediaType: "image",
    initialGenerationPrompt: "", initialTab: "generate", initialMediaType: "image",
    ACTIVE_INRCY_ACCOUNT_EVENT: "account-changed", setMounted() {}, layerRef: { current: null },
    onWorkspaceStateChange(value: { busy: boolean; hasDraft: boolean }) { workspaceStates.push(value); },
    registerDraftReplacementRequest(value: (() => Promise<boolean>) | null) { replacementRequest = value; },
    requestDraftReplacement: handler<boolean>("requestDraftReplacement", ctx),
    window: {
      ...ctx.window,
      addEventListener(name: string, listener: () => void) {
        if (!listeners.has(name)) listeners.set(name, new Set());
        listeners.get(name)!.add(listener);
      },
      removeEventListener(name: string, listener: () => void) { listeners.get(name)?.delete(listener); },
    },
  };
  const cleanups: Array<() => void> = [];
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) &&
      ["useEffect", "useLayoutEffect"].includes(node.expression.text)) {
      const code = ts.transpileModule(`const run = ${node.arguments[0].getText(source)};`, {
        compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
      }).outputText;
      const run = new Function(...Object.keys(environment), `${code}; return run;`)(...Object.values(environment));
      const cleanup = run();
      if (typeof cleanup === "function") cleanups.push(cleanup);
      return;
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return {
    workspaceStates,
    get replacementRequest() { return replacementRequest; },
    emit(name: string) { for (const listener of listeners.get(name) || []) listener(); },
    unmount() { for (const cleanup of cleanups.reverse()) cleanup(); },
  };
}

test("page reload and React unmount preserve a paid draft for authenticated recovery", async () => {
  for (const event of ["pagehide", "unmount"]) {
    const ctx = context();
    const lifecycle = mountLifecycle(ctx);
    const approvals: boolean[] = [];
    ctx.draftReplacementResolutionRef.current = (approved) => { approvals.push(approved); };
    assert.deepEqual(lifecycle.workspaceStates, [{ busy: false, hasDraft: true }]);
    assert.equal(typeof lifecycle.replacementRequest, "function");
    if (event === "pagehide") lifecycle.emit("pagehide");
    lifecycle.unmount();
    await Promise.resolve();
    assert.equal(ctx.events.some((entry) => entry.startsWith("discard:")), false, event);
    assert.equal(ctx.currentResultRef.current, ctx.state.currentResult);
    assert.notEqual(ctx.currentResultRef.current, null);
    assert.deepEqual(approvals, [false], "React cleanup cancels only the free insertion approval, preserving the paid preview");
    assert.equal(lifecycle.replacementRequest, null, "The real registration effect releases its handler on unmount");
  }
});

test("changing establishment drops local preview state without deleting the prior account's draft", async () => {
  const ctx = context();
  const lifecycle = mountLifecycle(ctx);
  const approvals: boolean[] = [];
  ctx.draftReplacementResolutionRef.current = (approved) => { approvals.push(approved); };
  lifecycle.emit("account-changed");
  lifecycle.unmount();
  await Promise.resolve();
  assert.equal(ctx.currentResultRef.current, null);
  assert.equal(ctx.state.currentResult, null);
  assert.equal(ctx.events.some((entry) => entry.startsWith("discard:")), false);
  assert.deepEqual(approvals, [false], "An account change invalidates the pending free prompt replacement");
});

test("explicit confirmed close and handoff abandonment still discard only temporary drafts", async () => {
  for (const name of ["confirmClose", "confirmAbandonHandoff"]) for (const draft of [true, false]) {
    const ctx = context(draft);
    await handler(name, { ...ctx,
      onClose() { ctx.events.push("close"); },
      async onAbandonHandoff() { ctx.events.push("abandon"); },
    })();
    assert.equal(ctx.events.filter((entry) => entry.startsWith("discard:")).length, draft ? 1 : 0);
    assert.ok(ctx.events.includes(name === "confirmClose" ? "close" : "abandon"));
  }
});
