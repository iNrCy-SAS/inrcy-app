import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { shouldProtectPublicationExit } from "../../app/dashboard/booster/publier/publicationExitProtection.ts";

const clean = { completed: false, creationMode: null, hasContent: false, hasLocalDocuments: false, channelsCustomized: false, busy: false };

test("every unfinished Booster stage stays protected, including an already saved draft", () => {
  assert.equal(shouldProtectPublicationExit(clean), false, "untouched opening can close");
  for (const state of [
    { channelsCustomized: true },
    { creationMode: "ai" },
    { creationMode: "manual" },
    { hasContent: true }, // also true after saving/restoring: independent of dirty snapshot
    { hasLocalDocuments: true },
    { busy: true },
  ]) {
    assert.equal(shouldProtectPublicationExit({ ...clean, ...state }), true, JSON.stringify(state));
    assert.equal(shouldProtectPublicationExit({ ...clean, ...state, completed: true }), false, "completed publication can close");
  }
});

function guardHarness({ accepted = false, childOverlayOpen = false } = {}) {
  const source = readFileSync(new URL("../../app/dashboard/_hooks/useUnsavedExitGuard.ts", import.meta.url), "utf8");
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const listeners = new Map<string, (event?: unknown) => void>();
  const cleanups: (() => void)[] = [];
  let registered: { shouldBlock: () => boolean; confirmExit: () => Promise<boolean> } | null = null;
  let prompts = 0, closed = 0, historyWrites = 0;
  const modules = {
    react: {
      useRef: (current: unknown) => ({ current }), useCallback: (fn: unknown) => fn,
      useEffect: (effect: () => (() => void) | void) => { const cleanup = effect(); if (cleanup) cleanups.push(cleanup); },
    },
    "@/lib/inrcyDialog": { confirmInrcy: async () => { prompts++; return accepted; } },
    "../_components/DashboardUnsavedNavigationProvider": { useDashboardUnsavedNavigation: () => ({ registerGuard: (guard: typeof registered) => { registered = guard; return () => { registered = null; }; } }) },
  };
  const windowMock = {
    location: { href: "https://fixture.test/dashboard?action=publish" },
    history: { state: {}, pushState: () => { historyWrites++; } },
    addEventListener: (name: string, fn: (event?: unknown) => void) => listeners.set(name, fn),
    removeEventListener: (name: string) => listeners.delete(name),
  };
  const exports = {} as { useUnsavedExitGuard: (options: unknown) => { confirmExit: () => Promise<boolean> } };
  new Function("exports", "require", "window", code)(exports, (name: keyof typeof modules) => {
    assert.ok(modules[name], `unexpected dependency ${name}`); return modules[name];
  }, windowMock);
  const layer = ts.createSourceFile("layer.tsx", readFileSync(new URL("../../app/dashboard/_components/DashboardBoosterModalLayer.tsx", import.meta.url), "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let call: ts.CallExpression | undefined;
  function visit(node: ts.Node) {
    if (ts.isCallExpression(node) && node.expression.getText(layer) === "useUnsavedExitGuard") call = node;
    ts.forEachChild(node, visit);
  }
  visit(layer);
  assert.ok(call);
  const expression = ts.transpileModule(`const options = ${call.arguments[0].getText(layer)};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  const options = new Function("mode", "publishEditorOverlayOpen", "publishHasUnsavedChanges", "closePublishModal", "i18nT", expression + "\nreturn options;")("publish", childOverlayOpen, true, () => { closed++; }, (key: string) => key);
  assert.equal(options.active, true, "the real Booster guard stays mounted through child overlays");
  assert.equal(options.shouldBlock, true);
  const guard = exports.useUnsavedExitGuard(options);
  return { guard, listeners, registration: () => registered, counts: () => ({ prompts, closed, historyWrites }), cleanup: () => cleanups.reverse().forEach(fn => fn()) };
}

test("canceling the common close guard retains work; accepting closes exactly once", async () => {
  const cancelled = guardHarness();
  assert.equal(await cancelled.guard.confirmExit(), false);
  assert.equal(cancelled.counts().closed, 0);
  assert.equal(cancelled.counts().prompts, 1);
  const accepted = guardHarness({ accepted: true });
  assert.equal(await accepted.guard.confirmExit(), true);
  assert.equal(accepted.counts().closed, 1);
  cancelled.cleanup(); accepted.cleanup();
});

test("a child overlay keeps the real Booster route, Back and reload guards registered", async () => {
  const fixture = guardHarness({ childOverlayOpen: true });
  assert.equal(fixture.listeners.has("popstate"), true);
  assert.equal(fixture.counts().historyWrites, 1);
  assert.equal(fixture.registration()?.shouldBlock(), true);
  assert.equal(await fixture.registration()!.confirmExit(), false);
  let prevented = false;
  const event = { preventDefault: () => { prevented = true; }, returnValue: undefined as unknown };
  fixture.listeners.get("beforeunload")!(event);
  assert.equal(prevented, true);
  assert.equal(event.returnValue, "");
  fixture.cleanup();
  assert.equal(fixture.listeners.size, 0);
  assert.equal(fixture.registration(), null);
});

test("browser Back uses the same protected exit and cancel keeps the workspace", async () => {
  const fixture = guardHarness();
  fixture.listeners.get("popstate")!();
  await Promise.resolve(); await Promise.resolve();
  assert.equal(fixture.counts().prompts, 1);
  assert.equal(fixture.counts().closed, 0);
  assert.equal(fixture.counts().historyWrites, 2);
  fixture.cleanup();
});
