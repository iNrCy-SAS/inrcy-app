import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { hasInstagramDeletionUnconfirmedAnnotation, isInstagramDeletionUnconfirmed, normalizeInstagramDeletionResult, projectInstagramDeletionStatus } from "../../lib/inrsend/instagramDeletionStatus.ts";

type RuntimeRecord = Record<string, any>; // eslint-disable-line @typescript-eslint/no-explicit-any
const read = (file: string) => readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
function productionFunction(file: string, name: string, dependencies: RuntimeRecord) {
  const source = read(file), tree = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const node = tree.statements.find(node => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(node);
  const compiled = ts.transpileModule(`${node.getText(tree).replace(/^export\s+/, "")}\nreturn ${name};`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(dependencies), compiled)(...Object.values(dependencies));
}

const legacyResult = { ok: false, status: "deleted", deleted: true, external_id: "old-ig-media", deleted_at: "2026-10-13T10:00:00Z", error: null };

test("generic classifiers require explicit annotation rather than treating another channel as Instagram", () => {
  assert.equal(hasInstagramDeletionUnconfirmedAnnotation(legacyResult), false);
  assert.equal(hasInstagramDeletionUnconfirmedAnnotation({ ...legacyResult, external_id: "facebook-post" }), false);
  assert.equal(hasInstagramDeletionUnconfirmedAnnotation({ ...legacyResult, external_id: "threads-post" }), false);
  assert.equal(hasInstagramDeletionUnconfirmedAnnotation(normalizeInstagramDeletionResult(legacyResult)), true);
  assert.equal(hasInstagramDeletionUnconfirmedAnnotation({ remote_deletion_unconfirmed: true, remoteDeletionConfirmed: true }), false);
});

test("an identified legacy local deletion becomes unconfirmed without inventing publication success", () => {
  const original = structuredClone(legacyResult);
  const result = normalizeInstagramDeletionResult(legacyResult);
  assert.equal(result.status, "deletion_unconfirmed"); assert.equal(result.deleted, false);
  assert.equal(result.ok, false); assert.equal(result.external_id, legacyResult.external_id);
  assert.equal(isInstagramDeletionUnconfirmed(result), true);
  assert.equal(Object.hasOwn(result, "published"), false); assert.equal(Object.hasOwn(result, "retryable"), false);
  assert.deepEqual(legacyResult, original);
  assert.equal(normalizeInstagramDeletionResult(result), result);
});

test("explicit confirmed remote deletions, local-only drafts and containers stay unchanged", () => {
  for (const marker of ["remoteDeletionConfirmed", "remote_deletion_confirmed", "remoteDeleted", "remote_deleted"]) {
    const confirmed = { ...legacyResult, [marker]: true };
    assert.equal(normalizeInstagramDeletionResult(confirmed), confirmed);
    assert.equal(isInstagramDeletionUnconfirmed(confirmed), false);
  }
  for (const value of [
    { ok: false, status: "deleted", deleted: true, local_deleted_only: true, delete_scope: "local_draft" },
    { ok: true, status: "deleted", deleted: true },
    { ok: false, status: "deleted", deleted: true, checkpoint: { containerId: "container", state: "created" } },
    { ok: false, status: "failed", external_id: "media", error: "Publication failed" },
    null, [], "deleted",
  ]) assert.equal(normalizeInstagramDeletionResult(value), value);
});

test("history/live summary get one terminal annotation while counters and other channels remain intact", () => {
  const payload = { done: true, queued: false, status: "completed", publication_id: "parent",
    results: { instagram: legacyResult, facebook: { ok: true, status: "delivered" }, threads: { ok: false, status: "deleted", deleted: true, external_id: "thread" } },
    summary: { pendingCount: 0, successCount: 2, failureCount: 0, entries: [
      { channel: "instagram", ok: false, status: "deleted", technicalStatus: "deleted" },
      { channel: "facebook", ok: true, status: "delivered" },
    ] } };
  const original = structuredClone(payload), projected = projectInstagramDeletionStatus(payload);
  assert.equal(projected.done, true); assert.equal(projected.queued, false); assert.equal(projected.status, "completed");
  assert.equal(projected.results.instagram.status, "deletion_unconfirmed");
  assert.deepEqual(projected.results.facebook, original.results.facebook); assert.deepEqual(projected.results.threads, original.results.threads);
  assert.equal(projected.summary.entries[0].status, "deletion_unconfirmed");
  assert.equal(projected.summary.entries[0].ok, false);
  assert.equal(projected.summary.pendingCount, 0); assert.equal(projected.summary.successCount, 2); assert.equal(projected.summary.failureCount, 0);
  assert.deepEqual(projectInstagramDeletionStatus(projected), projected);
  assert.deepEqual(payload, original);
  const confirmed = { ...payload, results: { ...payload.results, instagram: { ...legacyResult, remoteDeletionConfirmed: true } } };
  assert.equal(projectInstagramDeletionStatus(confirmed), confirmed);
  const noInstagram = { done: true, results: { threads: original.results.threads }, summary: { entries: [original.summary.entries[1]] } };
  assert.equal(projectInstagramDeletionStatus(noInstagram), noInstagram);
});

test("a contradictory legacy pending flag cannot poll/retry Instagram or hide another pending channel", () => {
  const payload = { done: false, queued: true, results: { instagram: { ...legacyResult, pending: true } },
    summary: { pendingCount: 2, entries: [
      { channel: "instagram", status: "deleted", pending: true },
      { channel: "facebook", status: "processing", pending: true },
    ] } };
  const projected = projectInstagramDeletionStatus(payload);
  assert.equal(projected.results.instagram.pending, false);
  assert.equal(projected.summary.entries[0].pending, false);
  assert.equal(projected.summary.entries[1].pending, true);
  assert.equal(projected.summary.pendingCount, 1);
  assert.equal(projected.done, false); assert.equal(projected.queued, true);
  assert.equal(Object.hasOwn(projected.results.instagram, "retryable"), false);
  assert.deepEqual(projectInstagramDeletionStatus(projected), projected);
});

test("the real history mapper serializes the projected payload for normal and async events", () => {
  const mapper = productionFunction("app/api/inrsend/history/route.ts", "mapEventItems", {
    projectInstagramDeletionStatus,
    isTechnicalAppEvent: () => false, getActionFromTrack: () => "publier", historyFolderForAction: () => "publications",
    workflowMetaFromAction: () => ({}), workflowMetaFromFolder: () => ({}), extractOriginMeta: () => ({}),
    firstNonEmpty: (...values: unknown[]) => values.find(value => typeof value === "string" && value) || "",
    safeS: (value: unknown, fallback = "") => typeof value === "string" ? value : fallback,
    getPublicationTitleFromOrigin: () => "Publication", stripWorkflowPrefix: (value: unknown) => value,
    extractChannelsFromPayload: () => ["instagram"], extractMessageFromPayload: () => ({ text: "Original post" }),
    extractAttachmentsFromPayload: () => [],
  }) as (rows: RuntimeRecord[]) => RuntimeRecord[];
  const payload = { status: "completed", publication_id: "parent", results: { instagram: legacyResult } };
  const original = structuredClone(payload);
  const rows = mapper([
    { id: "legacy-event", module: "booster", type: "publish", payload, created_at: "2026-10-12T10:00:00Z" },
    { id: "async-event", module: "booster", type: "publish_async_job", payload: { status: "completed", finalPayloadBase: payload }, created_at: "2026-10-12T10:00:00Z" },
  ]);
  assert.equal(rows.length, 2);
  for (const row of rows) { assert.equal(row.raw.payload.results.instagram.status, "deletion_unconfirmed"); assert.equal(row.raw.payload.results.instagram.ok, false); }
  assert.equal(rows[0].status, "sent"); assert.equal(rows[1].status, "completed");
  assert.deepEqual(payload, original);
});

test("the live status route applies the same projection with normal auth and no provider call", async () => {
  const reads: RuntimeRecord[] = [];
  let authenticated = true;
  const get = productionFunction("app/api/booster/publications/[publicationId]/status/route.ts", "handler", {
    projectInstagramDeletionStatus,
    requireUser: async () => authenticated ? { activeUserId: "own-account" } : { errorResponse: { status: 401 } },
    readAsyncPublicationStatus: async (params: RuntimeRecord) => { reads.push(params); return { done: true, queued: false, results: { instagram: legacyResult } }; },
    NextResponse: { json: (body: unknown, options: RuntimeRecord = {}) => ({ body, status: options.status || 200, headers: options.headers }) },
    jsonUserFacingError: () => ({ status: 500 }),
  }) as (request: Request, context: RuntimeRecord) => Promise<RuntimeRecord>;
  const publicationId = "81729f91-0000-4000-8000-123456789abc";
  const context = { params: Promise.resolve({ publicationId }) };
  authenticated = false;
  assert.equal((await get(new Request("https://app.test/status"), context)).status, 401);
  assert.equal(reads.length, 0);
  authenticated = true;
  const response = await get(new Request("https://app.test/status"), context);
  assert.equal(response.status, 200); assert.deepEqual(reads, [{ userId: "own-account", publicationId }]);
  assert.equal(response.body.results.instagram.status, "deletion_unconfirmed");
  assert.equal(response.body.done, true); assert.equal(response.body.queued, false);
  assert.equal(response.headers["Cache-Control"], "no-store");
});
