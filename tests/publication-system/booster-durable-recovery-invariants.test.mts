import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(
    /\r\n/g,
    "\n",
  );
}

function sliceBetween(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `missing start marker: ${start}`);
  assert.ok(endIndex > startIndex, `missing end marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

const route = read("app/api/booster/publish-now/route.ts");
const ingress = read("lib/boosterPublicationIngress.ts");
const asyncPublication = read("lib/boosterAsyncPublication.ts");
const cron = read("app/api/cron/booster-publications/route.ts");

test("client preflight failures are bounded, durable and terminal before media preparation", () => {
  assert.match(
    ingress,
    /normalizeClientPreflightFailuresByChannel[\s\S]*?\.slice\(0, 100\)[\s\S]*?\.slice\(0, 600\)/,
  );
  assert.match(
    ingress,
    /preparationRequest = \{[\s\S]*?clientPreflightFailuresByChannel/,
  );
  assert.match(
    ingress,
    /status: clientPreflightFailuresByChannel\[channel\][\s\S]*?\? "failed"[\s\S]*?: "preparing"/,
  );
  assert.match(
    ingress,
    /result: clientPreflightFailuresByChannel\[channel\]/,
  );

  assert.match(
    route,
    /const dispatchableSelected = selected\.filter\([\s\S]*?!clientPreflightFailuresByChannel\[channel\]/,
  );
  assert.match(
    route,
    /const preflightFailuresByChannel:[\s\S]*?= \{ \.\.\.clientPreflightFailuresByChannel \}/,
  );
});

test("an ingress write error preserves the running UUID instead of opening a duplicate window", () => {
  const insertFailure = sliceBetween(
    ingress,
    "if (insertError)",
    'return {\n    state: "accepted"',
  );
  assert.match(insertFailure, /Keep the lock running with the same publicationId/);
  assert.doesNotMatch(insertFailure, /failExecutionIdempotencyLock/);
  assert.doesNotMatch(ingress, /import \{[\s\S]*failExecutionIdempotencyLock/);
});

test("missing technical children become isolated terminal failures", () => {
  assert.match(
    asyncPublication,
    /if \(!payload\) \{[\s\S]*?status: "failed"[\s\S]*?code: "async_channel_event_missing"/,
  );
  assert.match(
    asyncPublication,
    /The parent descriptor is authoritative[\s\S]*?never an eternal synthetic queue item/,
  );
});

test("cron retries finalization independently from media preparation state", () => {
  assert.match(cron, /queuedPreparationCandidatesQuery/);
  assert.match(cron, /activePreparationCandidatesQuery/);
  assert.match(cron, /finalizationCandidatesQuery/);
  assert.match(cron, /sweepPlan\.runFinalizationSweep/);
  assert.match(
    cron,
    /ascending: sweepPlan\.finalizationAscending[\s\S]*?\.limit\(ASYNC_FINALIZATION_CANDIDATE_LIMIT\)/,
  );
  assert.match(
    cron,
    /parentsAlreadyWorking[\s\S]*?!parentsAlreadyWorking\.has\(candidateKey\(row\)\)/,
  );
  assert.match(
    cron,
    /finalizationJobs\.map\(\(job\) =>[\s\S]*?finalizeAsyncPublicationIfReady/,
  );
  assert.match(
    cron,
    /if \(lease\.state === "completed"\)[\s\S]*?preparationRequest: null[\s\S]*?finalizeAsyncPublicationIfReady/,
  );
});

test("finalization commits terminal idempotency before exposing and cleaning the business event", () => {
  const finalizer = sliceBetween(
    asyncPublication,
    "async function finalizeClaimedAsyncPublication",
    "export async function finalizeAsyncPublicationIfReady",
  );
  const lockCommit = finalizer.indexOf("completeExecutionIdempotencyLockOrThrow");
  const parentCommit = finalizer.indexOf(
    ".update({ type: finalEventType, payload: finalPayload })",
  );
  const cleanup = finalizer.indexOf("runFinalizationSideEffects");
  assert.ok(lockCommit >= 0 && parentCommit > lockCommit);
  assert.ok(cleanup > parentCommit);
  assert.match(finalizer, /ok: !aggregate\.summary\.allFailed/);
  assert.doesNotMatch(finalizer, /failExecutionIdempotencyLock\(/);
});
