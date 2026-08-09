import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  findUnfulfilledVideoPreparationKeys,
  mergeVideoPreparationRequest,
  readRequestedVideoPreparationKeys,
} from "../../lib/mediaVideoNormalizationMissionState.ts";

const ROOT = process.cwd();

async function read(relativePath: string) {
  return await readFile(path.resolve(ROOT, relativePath), "utf8");
}

test("une publication arrivée pendant la préparation IA fusionne les sorties sans downgrade", () => {
  const merged = mergeVideoPreparationRequest({
    jobPayload: {
      pipelineMission: "ai_preparation",
      requiredOutputs: ["frame_01", "thumbnail", "audio_track"],
    },
    mediaMetadata: {
      pipeline_mission: "ai_preparation",
      preparation_required_outputs: ["ai_preview", "frame_02", "frame_03"],
    },
    requestedMission: "publication_preparation",
  });

  assert.equal(merged.mission, "publication_preparation");
  assert.deepEqual(
    new Set(merged.requiredOutputs),
    new Set([
      "canonical",
      "thumbnail",
      "frame_01",
      "frame_02",
      "frame_03",
      "audio_track",
    ]),
  );

  const lateAiRetry = mergeVideoPreparationRequest({
    jobPayload: {
      pipelineMission: merged.mission,
      requiredOutputs: merged.requiredOutputs,
    },
    mediaMetadata: {
      pipeline_mission: merged.mission,
      preparation_required_outputs: merged.requiredOutputs,
    },
    requestedMission: "ai_preparation",
  });
  assert.equal(lateAiRetry.mission, "publication_preparation");
  assert.deepEqual(
    new Set(lateAiRetry.requiredOutputs),
    new Set(merged.requiredOutputs),
  );
});

test("le worker ne refile que les sorties demandées après son snapshot", () => {
  const latestPayload = {
    pipelineMission: "publication_preparation",
    requiredOutputs: [
      "canonical",
      "thumbnail",
      "frame_01",
      "frame_02",
      "frame_03",
      "audio_track",
    ],
  };
  const fulfilledByAiWorker = [
    "ai_preview",
    "thumbnail",
    "frame_01",
    "frame_02",
    "frame_03",
    "audio_track",
  ] as const;

  assert.deepEqual(
    findUnfulfilledVideoPreparationKeys({
      payload: latestPayload,
      fulfilledKeys: fulfilledByAiWorker,
    }),
    ["canonical"],
  );
  assert.deepEqual(
    readRequestedVideoPreparationKeys({ payload: latestPayload }),
    latestPayload.requiredOutputs,
  );
});

test("la queue et le worker protègent durablement la course AI vers publication", async () => {
  const queue = await read("lib/mediaVideoNormalizationQueue.ts");
  const worker = await read("lib/mediaVideoNormalizationWorker.ts");

  assert.match(queue, /mergeVideoPreparationRequest/);
  assert.match(queue, /select\("payload,updated_at"\)/);
  assert.match(queue, /select\("media_metadata,updated_at"\)/);
  assert.match(queue, /\.eq\("updated_at", previousJobUpdatedAt\)/);
  assert.match(queue, /\.eq\("updated_at", previousMediaUpdatedAt\)/);
  const durableIntent = queue.indexOf("jobId: null");
  const enqueueRpc = queue.indexOf(
    'supabaseAdmin.rpc("inrcy_enqueue_video_normalization"',
  );
  assert.ok(durableIntent >= 0 && durableIntent < enqueueRpc);

  assert.match(worker, /updateMediaAfterSuccessfulNormalization/);
  assert.match(
    worker,
    /select\("media_metadata,publication_status,updated_at"\)/,
  );
  assert.match(worker, /settleSuccessfulVideoJob/);
  assert.match(worker, /findUnfulfilledVideoPreparationKeys/);
  assert.match(worker, /planVideoNormalizationFailure/);
  assert.match(worker, /status: "queued"/);
  assert.match(worker, /attempt_count: failurePlan\.attemptCount/);
  assert.match(worker, /claimedKeys: claimedRequest\.keys/);
  assert.match(worker, /requiredOutputs: \[\.\.\.latestKeys\]/);
  assert.match(worker, /previousMissionFailure/);
  assert.match(worker, /mediaMetadata: currentMedia\.data\?\.media_metadata/);
  assert.match(worker, /neq\("status", "ready"\)/);
  assert.match(worker, /video_job_lease_refresh_failed/);
  assert.match(worker, /if \(mediaUpdate\.error\)/);
  assert.match(worker, /if \(publicationStatusUpdate\.error\)/);
  assert.match(worker, /if \(jobUpdate\.error \|\| !jobUpdate\.data\?\.\[0\]\)/);
  assert.match(worker, /neq\("publication_status", "ready"\)/);
  assert.match(worker, /Exactly one bounded stage per invocation/);
  assert.match(worker, /const job = await claimTargetedProcessingJob/);
  assert.match(worker, /summaries\.push\(await processClaimedVideoJob/);

  // Le worker global reste strictement séquentiel et le claim ciblé refuse un
  // lock processing encore valide : aucun deuxième FFmpeg ne démarre en parallèle.
  assert.match(worker, /for \(const job of jobs\)/);
  const targetedClaim = await read("lib/mediaProcessingTargetedClaim.ts");
  assert.match(
    targetedClaim,
    /if \(!lockExpiresAt \|\| lockExpiresAt > nowMs\) return null/,
  );
});
