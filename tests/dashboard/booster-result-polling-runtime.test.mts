/* eslint-disable @typescript-eslint/no-explicit-any -- production effect callbacks run with isolated timers and HTTP fixtures */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { isBoosterPublicationPendingStatus } from "../../lib/boosterPublicationStatus.ts";
import { isRetryablePublicationEntry, publicationStorySequenceCounts } from "../../lib/publicationStorySequenceRetry.ts";

const parse = (path: string) => ts.createSourceFile(path, readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"), ts.ScriptTarget.ES2022, true, ts.ScriptKind.TSX);
const modal = parse("app/dashboard/_components/PublishExecutionResultModal.tsx");
const progress = parse("app/dashboard/_components/PublishExecutionProgress.tsx");
function find(source: ts.Node, predicate: (node: ts.Node) => boolean): ts.Node {
  let found: ts.Node | undefined;
  const visit = (node: ts.Node) => {
    if (!found && predicate(node)) found = node;
    if (!found) ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(found, "Required production callback was not found");
  return found;
}
function evaluate(expression: string, scope: Record<string, unknown> = {}): any {
  const code = ts.transpileModule(`const value = (${expression});`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  return new Function(...Object.keys(scope), code + "\nreturn value;")(...Object.values(scope));
}
function productionFunction(source: ts.SourceFile, name: string, scope: Record<string, unknown> = {}) {
  const node = find(source, node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  return evaluate(node.getText(source).replace(/^export\s+/, ""), scope);
}
const getPublicationDestinationStatus = productionFunction(progress, "getPublicationDestinationStatus", { isBoosterPublicationPendingStatus });
const entryPublicationId = productionFunction(modal, "entryPublicationId");
const publicationChannelKey = productionFunction(modal, "publicationChannelKey");
const isPendingPublicationEntry = productionFunction(modal, "isPendingPublicationEntry", { getPublicationDestinationStatus });
const mergePublicationResultSnapshot = productionFunction(modal, "mergePublicationResultSnapshot", { entryPublicationId, publicationChannelKey, getPublicationDestinationStatus, isPendingPublicationEntry, isRetryablePublicationEntry, publicationStorySequenceCounts });

function pendingIds(summary: any) {
  const node = find(modal, node => ts.isVariableDeclaration(node) && node.name.getText(modal) === "pendingPublicationIds") as ts.VariableDeclaration;
  return evaluate(node.initializer!.getText(modal), { liveEntries: summary.entries, liveSummary: summary, isPendingPublicationEntry, entryPublicationId });
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const settle = () => new Promise<void>(resolve => setImmediate(resolve));
const response = (summary: any, done = true) => ({ ok: true, json: async () => ({ summary, done }) });
function harness(summary: any, fetch: (url: string, options?: any) => Promise<any>, tiktok = false) {
  let current = summary;
  let updates = 0;
  let timerId = 0;
  const timers = new Map<number, () => void>();
  const listeners = new Map<string, () => void>();
  const document = {
    hidden: false,
    addEventListener: (event: string, callback: () => void) => listeners.set(event, callback),
    removeEventListener: (event: string) => listeners.delete(event),
  };
  const discriminator = tiktok ? "tiktokPublicationId" : "pendingPublicationIds";
  const effect = find(modal, node => ts.isCallExpression(node) && node.expression.getText(modal) === "useEffect" && Boolean(node.arguments[1]?.getText(modal).includes(discriminator))) as ts.CallExpression;
  const tiktokEntry = summary.entries.find((entry: any) => entry.channel === "tiktok");
  const callback = evaluate(effect.arguments[0].getText(modal), {
    pendingPublicationIds: pendingIds(summary), hasPendingAsyncJob: true,
    tiktokPublicationId: tiktokEntry ? entryPublicationId(tiktokEntry, summary) : "",
    hasPendingTiktok: Boolean(tiktokEntry), tiktokPollInFlightRef: { current: false },
    entryPublicationId, mergePublicationResultSnapshot, fetch, document,
    setLiveSummary: (update: any) => { current = update(current); updates += 1; },
    setTimeout: (fn: () => void) => { timers.set(++timerId, fn); return timerId; },
    clearTimeout: (id: number) => timers.delete(id),
  });
  const cleanup = callback();
  return {
    get summary() { return current; }, get updates() { return updates; }, timers, listeners, document, cleanup,
    replace(next: any) { current = next; },
    async tick() {
      const timer = timers.entries().next().value;
      assert.ok(timer, "Expected a scheduled production poll");
      timers.delete(timer[0]); timer[1](); await settle();
    },
  };
}
const mixedSummary = () => ({
  publicationId: "retry-B", channelLinks: { site_web: "https://example.test/post" }, retryableFailureCount: 0,
  entries: [
    { channel: "site_web", label: "Site Web", status: "published", publicationId: "initial-A", ok: true },
    { channel: "tiktok", label: "TikTok", status: "processing", technicalStatus: "processing", warning_kind: "pending", publicationId: "initial-A", ok: true },
    { channel: "gmb", label: "Google Business", status: "queued", publicationId: "retry-B", ok: true },
  ],
});

test("a retried publication keeps polling the earlier pending job and merges both jobs without losing successful channels", async () => {
  const oldJob = deferred<any>();
  const retryJob = deferred<any>();
  const urls: string[] = [];
  const state = harness(mixedSummary(), async url => { urls.push(url); return url.includes("initial-A") ? oldJob.promise : retryJob.promise; });
  await state.tick();
  assert.deepEqual(urls.sort(), ["/api/booster/publications/initial-A/status", "/api/booster/publications/retry-B/status"]);
  retryJob.resolve(response({ entries: [{ channel: "gmb", label: "Google Business", status: "published", ok: true }] }));
  await settle();
  oldJob.resolve(response({ entries: [
    { channel: "tiktok", label: "TikTok", status: "published", ok: true },
    { channel: "gmb", label: "Google Business", status: "failed", ok: false },
  ] }));
  await settle();
  assert.equal(state.summary.entries.length, 3);
  assert.ok(state.summary.entries.every((entry: any) => getPublicationDestinationStatus(entry) === "published"));
  assert.equal(state.summary.entries.find((entry: any) => entry.channel === "gmb").publicationId, "retry-B");
  assert.equal(state.summary.successCount, 3);
  assert.equal(state.summary.failureCount, 0);
  assert.equal(state.summary.pendingCount, 0);
  assert.deepEqual(state.summary.channelLinks, { site_web: "https://example.test/post" });
  assert.equal(state.timers.size, 0);
  state.cleanup();
});

test("late snapshots cannot replace the result after the polling effect was disposed", async () => {
  const request = deferred<any>();
  const original = mixedSummary();
  const state = harness(original, async () => request.promise);
  await state.tick(); state.cleanup();
  request.resolve(response({ entries: [{ channel: "tiktok", label: "TikTok", status: "failed", ok: false }] }));
  await settle();
  assert.equal(state.summary, original);
  assert.equal(state.updates, 0);
  assert.equal(state.timers.size, 0);
  assert.equal(state.listeners.size, 0);
});

test("a delayed processing snapshot cannot undo TikTok finalization while another channel is still pending", async () => {
  const oldJob = deferred<any>();
  const state = harness(mixedSummary(), async url => url.includes("initial-A")
    ? oldJob.promise
    : response({ entries: [{ channel: "gmb", label: "Google Business", status: "queued" }] }, false));
  await state.tick();
  const confirmed = mixedSummary();
  confirmed.entries[1] = { channel: "tiktok", label: "TikTok", publicationId: "initial-A", status: "published", technicalStatus: "completed", warning_kind: "", ok: true };
  state.replace(confirmed);
  oldJob.resolve(response({ entries: [{ channel: "tiktok", label: "TikTok", status: "processing", warning_kind: "pending", ok: true }] }, false));
  await settle();
  assert.equal(getPublicationDestinationStatus(state.summary.entries[1]), "published");
  assert.equal(state.summary.pendingCount, 1);
  state.cleanup();
});

test("legacy single-publication results retain ID fallback and visibility suspension", async () => {
  const urls: string[] = [];
  const state = harness({ publication_id: "legacy", entries: [{ channel: "facebook", label: "Facebook", status: "processing" }] }, async url => {
    urls.push(url); return response({ entries: [{ channel: "facebook", label: "Facebook", status: "published", ok: true }] });
  });
  state.document.hidden = true; state.listeners.get("visibilitychange")!();
  assert.equal(state.timers.size, 0);
  assert.deepEqual(urls, []);
  state.document.hidden = false; state.listeners.get("visibilitychange")!();
  await state.tick();
  assert.deepEqual(urls, ["/api/booster/publications/legacy/status"]);
  assert.equal(state.summary.successCount, 1);
  state.cleanup();
});

test("pending-to-failed polling updates retry eligibility and excludes blocked channels", async () => {
  const state = harness({ publicationId: "initial-A", retryableFailureCount: 0, entries: [
    { channel: "gmb", label: "Google Business", status: "processing" },
    { channel: "youtube_shorts", label: "YouTube", status: "failed", ok: false, retryable: false },
  ] }, async () => response({ entries: [{ channel: "gmb", label: "Google Business", status: "failed", ok: false, retryable: true }] }));
  await state.tick();
  assert.equal(state.summary.pendingCount, 0);
  assert.equal(state.summary.failureCount, 2);
  assert.equal(state.summary.retryableFailureCount, 1);
  assert.equal(state.summary.allFailed, true);
  state.cleanup();
});

test("TikTok finalization follows its original publication after another channel was retried", async () => {
  const calls: Array<[string, string]> = [];
  const state = harness(mixedSummary(), async (url, options) => {
    calls.push([url, options.method]); return { ok: true, json: async () => ({ status: { status: "PUBLISH_COMPLETE" } }) };
  }, true);
  await state.tick();
  assert.deepEqual(calls, [["/api/inrsend/publications/initial-A/tiktok/status", "POST"]]);
  const tiktok = state.summary.entries.find((entry: any) => entry.channel === "tiktok");
  assert.equal(getPublicationDestinationStatus(tiktok), "published");
  assert.equal(tiktok.technicalStatus, "completed");
  assert.equal(state.summary.pendingCount, 1);
  assert.equal(state.summary.entries.find((entry: any) => entry.channel === "gmb").status, "queued");
  state.cleanup();
});

test("a late TikTok response cannot update a new attempt or a disposed result", async () => {
  for (const dispose of [false, true]) {
    const request = deferred<any>();
    const state = harness(mixedSummary(), async () => request.promise, true);
    await state.tick();
    const latest = mixedSummary(); latest.entries[1].publicationId = "new-tiktok-C";
    state.replace(latest);
    if (dispose) state.cleanup();
    request.resolve({ ok: true, json: async () => ({ status: { status: "PUBLISH_COMPLETE" } }) });
    await settle();
    assert.equal(state.summary.entries[1].status, "processing");
    assert.equal(state.summary.entries[1].publicationId, "new-tiktok-C");
    if (dispose) assert.equal(state.updates, 0);
    else state.cleanup();
  }
});
