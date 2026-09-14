import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

function indexOfOrFail(source: string, marker: string) {
  const index = source.indexOf(marker);
  assert.notEqual(index, -1, `Missing marker: ${marker}`);
  return index;
}

const route = read("app/api/booster/publish-now/route.ts");
const ingress = read("lib/boosterPublicationIngress.ts");
const asyncPublication = read("lib/boosterAsyncPublication.ts");
const executionIdempotency = read("lib/executionIdempotency.ts");
const cron = read("app/api/cron/booster-publications/route.ts");
const publishModal = read("app/dashboard/booster/publier/PublishModal.tsx");
const workspacePreparation = read(
  "lib/mediaWorkspacePublicationPreparation.ts",
);

test("an ingress insert failure keeps the running publication UUID recoverable", () => {
  const insertFailure = ingress.slice(indexOfOrFail(ingress, "if (insertError)"));
  assert.doesNotMatch(insertFailure, /failExecutionIdempotencyLock/);
  assert.match(insertFailure, /Keep the lock running with the same publicationId/);
  assert.match(ingress, /lockResult\.state === "running"[\s\S]*loadParent/);
});

test("parent idempotency is strictly terminal before parent conversion and cleanup", () => {
  assert.match(
    executionIdempotency,
    /completeExecutionIdempotencyLockOrThrow[\s\S]*\.select\("id"\)[\s\S]*execution_idempotency_lock_missing/,
  );
  const strictCommit = indexOfOrFail(
    asyncPublication,
    "await completeExecutionIdempotencyLockOrThrow",
  );
  const parentConversion = indexOfOrFail(
    asyncPublication,
    ".update({ type: finalEventType, payload: finalPayload })",
  );
  const cleanup = indexOfOrFail(asyncPublication, 'name: "channel_cleanup"');
  assert.ok(strictCommit < parentConversion);
  assert.ok(parentConversion < cleanup || cleanup < strictCommit);
  assert.match(
    asyncPublication.slice(strictCommit, parentConversion),
    /ok: !aggregate\.summary\.allFailed/,
  );
});

test("a missing expected child becomes one terminal channel failure", () => {
  assert.match(
    asyncPublication,
    /if \(!payload\)[\s\S]*status: "failed"[\s\S]*async_channel_event_missing/,
  );
});

test("cron reserves independent capacity for queued, stale recovery, and finalization", () => {
  assert.match(
    cron,
    /queuedChannelCandidatesQuery[\s\S]*processingChannelCandidatesQuery[\s\S]*queuedPreparationCandidatesQuery[\s\S]*activePreparationCandidatesQuery/,
  );
  assert.match(cron, /\.eq\("payload->>status", "queued"\)/);
  assert.match(
    cron,
    /\.eq\("payload->>status", "processing"\)[\s\S]*channelRecoveryCutoffIso/,
  );
  assert.match(cron, /getBoosterCronSweepPlan/);
  assert.match(cron, /sweepPlan\.runRecoverySweep/);
  assert.match(cron, /sweepPlan\.runFinalizationSweep/);
  assert.match(
    cron,
    /ascending: sweepPlan\.finalizationAscending[\s\S]*\.limit\(ASYNC_FINALIZATION_CANDIDATE_LIMIT\)/,
  );
  assert.match(cron, /finalizationRecoveryCutoffIso/);
  assert.match(cron, /parentsAlreadyWorking[\s\S]*candidateKey/);
  assert.match(
    cron,
    /lease\.state === "completed"[\s\S]*finalizeAsyncPublicationIfReady/,
  );
});

test("red target channels are durable but never dispatchable", () => {
  assert.match(publishModal, /channels: publishTargetChannels/);
  assert.match(publishModal, /clientPreflightFailuresByChannel/);
  assert.match(
    ingress,
    /normalizeClientPreflightFailuresByChannel[\s\S]*slice\(0, 100\)[\s\S]*slice\(0, 600\)/,
  );
  assert.match(
    ingress,
    /status: clientPreflightFailuresByChannel\[target\.channel\][\s\S]*\? "failed"[\s\S]*: "preparing"/,
  );
  assert.match(
    route,
    /const dispatchableSelected = selected\.filter\([\s\S]*!clientPreflightFailuresByChannel\[channel\]/,
  );
  assert.match(
    route,
    /const activePreparationSelected = dispatchableSelected\.filter/,
  );
  assert.match(
    route,
    /const queuedChannelRows = durableChannelRows\.filter[\s\S]*status === "queued"/,
  );
});

test("media preparation is server-owned and cannot delay a no-media channel", () => {
  const helper = indexOfOrFail(
    route,
    "await prepareWorkspaceMediaForPublication",
  );
  const resolver = indexOfOrFail(
    route,
    "await resolveWorkspacePublicationConsumption",
  );
  assert.ok(helper < resolver);
  assert.match(
    route,
    /First materialize and dispatch channels that need no media[\s\S]*deferredPreparationChannels\.add/,
  );
  assert.match(
    route,
    /preparationDeferred[\s\S]*status: "preparing"[\s\S]*preparationPending: true/,
  );
  assert.match(
    route,
    /deferredPreparationChannels\.size > 0[\s\S]*status: "queued"[\s\S]*failAsyncPublicationPreparationLease/,
  );
  assert.match(asyncPublication, /BOOSTER_ASYNC_PREPARATION_MAX_ATTEMPTS = 10/);
  assert.match(
    workspacePreparation,
    /probePotentialDirectVideo[\s\S]*enqueueVideoNormalization/,
  );
  assert.match(
    workspacePreparation,
    /mission: "publication_preparation"/,
  );
});
