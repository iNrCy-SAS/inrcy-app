import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

function nodes(file: string) {
  const source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, file.endsWith("tsx") ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const calls: ts.CallExpression[] = []; const visit = (node: ts.Node) => { if (ts.isCallExpression(node)) calls.push(node); ts.forEachChild(node, visit); }; visit(ast);
  return { source, ast, calls };
}
function actual<T>(node: ts.Node, ast: ts.SourceFile, deps: Record<string, unknown>): T {
  const compiled = ts.transpileModule(`(${node.getText(ast)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText.trim().replace(/;$/, "");
  return vm.runInNewContext(`(function(deps){with(deps){return ${compiled};}})`)(deps) as T;
}
const hook = nodes("app/dashboard/_hooks/useMediaGeneration.ts"), component = nodes("app/dashboard/_components/VideoCreditRecharge.tsx");

test("the actual Studio credit refresh applies only the latest confirmed native quota in its current account", async () => {
  const load = hook.calls.find(call => call.expression.getText(hook.ast) === "useCallback" && call.parent.getText(hook.ast).startsWith("loadQuota =")); assert.ok(load);
  const updates: unknown[] = [], replies: Array<(value: unknown) => void> = [];
  const deps = { accountEpochRef: { current: 1 }, mountedRef: { current: true }, quotaRequestRef: { current: null as unknown }, quotaRef: { current: null as unknown }, setQuota: (value: unknown) => updates.push(value), setError: () => {}, setStatus: () => {},
    fetch: async (url: string, init: RequestInit) => { assert.equal(url, "/api/media-generation/quota"); assert.equal(init.method, "GET"); return new Promise(resolve => replies.push(resolve)); }, readJson: async (value: unknown) => value, normalizeQuota: (value: unknown) => value, readErrorMessage: () => "Quota indisponible" };
  const native = actual<(options: { force: boolean; canApply?: () => boolean; expectedAccountId?: string }) => Promise<unknown>>(load.arguments[0], hook.ast, deps);
  const older = native({ force: true }), newer = native({ force: true, expectedAccountId: "account-a" });
  replies[1]({ ok: true, quota: { accountId: "account-a", credits: 200 } }); assert.ok(await newer);
  replies[0]({ ok: true, quota: { accountId: "account-a", credits: 20 } }); assert.equal(await older, null); assert.equal(updates.length, 1);
  let current = true; const stale = native({ force: true, canApply: () => current, expectedAccountId: "account-a" }); current = false;
  replies[2]({ ok: true, quota: { accountId: "account-a" } }); assert.equal(await stale, null);
  const wrongAccount = native({ force: true, expectedAccountId: "account-a" }); replies[3]({ ok: true, quota: { accountId: "account-b" } }); assert.equal(await wrongAccount, null);
  const changed = native({ force: true }); deps.accountEpochRef.current++; replies[4]({ ok: true, quota: { accountId: "account-a" } }); assert.equal(await changed, null);
  const failed = native({ force: true }); replies[5]({ ok: false }); assert.equal(await failed, null); assert.equal(updates.length, 1);
});

test("the actual credit balance refresh confirms a fresh native counter without querying or fulfilling an order", async () => {
  const effect = component.calls.find(call => call.expression.getText(component.ast) === "useEffect" && call.arguments[0].getText(component.ast).includes("balanceLoader.current = load")); assert.ok(effect);
  const updates: unknown[] = [], replies: Array<(value: unknown) => void> = [], loader = { current: null as null | ((canApply?: () => boolean, accountId?: string) => Promise<boolean>) };
  const deps = { balanceLoader: loader, setBalance: (value: unknown) => updates.push(value), ACTIVE_INRCY_ACCOUNT_EVENT: "account-change", window: { addEventListener: () => {}, removeEventListener: () => {} }, fetch: async (url: string) => { assert.equal(url, "/api/media-generation/quota"); return new Promise(resolve => replies.push(resolve)); } };
  const cleanup = actual<() => () => void>(effect.arguments[0], component.ast, deps)();
  const response = (accountId: string, remaining: number) => ({ ok: true, json: async () => ({ quota: { accountId, creditsReady: true, credits: { remaining } } }) });
  const pending = loader.current!(() => true, "account-a"); replies[1](response("account-a", 400)); assert.equal(await pending, true);
  replies[0](response("account-a", 10)); await new Promise(resolve => setImmediate(resolve)); assert.equal(updates.length, 1);
  let current = true; const stale = loader.current!(() => current, "account-a"); current = false; replies[2](response("account-a", 5)); assert.equal(await stale, false);
  const wrong = loader.current!(() => true, "account-a"); replies[3](response("account-b", 1)); assert.equal(await wrong, false);
  const unmounted = loader.current!(() => true, "account-a"); cleanup(); replies[4](response("account-a", 2)); assert.equal(await unmounted, false); assert.equal(updates.length, 1); assert.equal(loader.current, null);
});

test("the actual credit catalogue refresh reads confirmed order history with scope and purchase guards only", async () => {
  const load = component.calls.find(call => call.expression.getText(component.ast) === "useCallback" && call.parent.getText(component.ast).startsWith("load =")); assert.ok(load);
  const updates: unknown[] = [], replies: Array<(value: unknown) => void> = [];
  const deps = { epoch: { current: 1 }, sequence: { current: 0 }, options: { endpoint: "/api/boutique/video-credits", unavailable: "unavailable" }, fetch: async (url: string) => { assert.equal(url, "/api/boutique/video-credits"); return new Promise(resolve => replies.push(resolve)); }, setCatalogue: (value: unknown) => updates.push(value), setNotice: () => {}, t: (value: string) => value, checkoutToRefresh: { current: false }, requests: { current: new Map() }, mediaKind: "video", storageKey: () => "key", sessionStorage: { getItem: () => null } };
  const native = actual<(options?: { canApply?: () => boolean; expectedAccountId?: string }) => Promise<boolean>>(load.arguments[0], component.ast, deps);
  const response = (accountId: string) => ({ ok: true, json: async () => ({ accountId, packs: [], orders: [{ id: "confirmed-order", status: "paid", granted_at: "2026-11-05" }] }) });
  const confirmed = native({ expectedAccountId: "account-a" }); replies[0](response("account-a")); assert.equal(await confirmed, true); assert.equal(updates.length, 1);
  let current = true; const stale = native({ canApply: () => current }); current = false; replies[1](response("account-a")); assert.equal(await stale, false);
  const wrong = native({ expectedAccountId: "account-a" }); replies[2](response("account-b")); assert.equal(await wrong, false);
  const changed = native(); deps.epoch.current++; replies[3](response("account-a")); assert.equal(await changed, false); assert.equal(updates.length, 1);
  const refreshCalls = [...hook.calls, ...component.calls].filter(call => call.expression.getText(call.getSourceFile()) === "useInrAssistantRefresh"); assert.equal(refreshCalls.length, 3);
  for (const call of refreshCalls) { const text = call.getText(call.getSourceFile()); assert.match(text, /topics: \["credits"\]/); assert.doesNotMatch(text, /\/orders\/|checkout|purchase\(/); }
  assert.match(refreshCalls[0].getText(hook.ast), /blocked: status === "generating" \|\| cancellationPending/);
  assert.match(refreshCalls[2].getText(component.ast), /blocked: busy !== null/);
});
