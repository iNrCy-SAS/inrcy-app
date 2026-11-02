import { readVideoNormalizationWorkerSource } from "./video-worker-sources.mjs";
import assert from "node:assert/strict";
import test from "node:test";

import {
  VIDEO_NORMALIZATION_CHAIN_PROGRESS_SPLIT,
  mapVideoNormalizationStageProgress,
  resolveVideoNormalizationProgressWindow,
} from "../../lib/mediaVideoNormalizationProgress.ts";

test("heavy canonical stage owns 0..65 percent", () => {
  const window = resolveVideoNormalizationProgressWindow({
    continuesWithPendingOutputs: true,
    previousProgress: 0,
    hasCompletedRequiredOutput: false,
  });

  assert.deepEqual(window, { start: 0, end: 65 });
  assert.equal(mapVideoNormalizationStageProgress(0, window), 0);
  assert.equal(mapVideoNormalizationStageProgress(50, window), 33);
  assert.equal(mapVideoNormalizationStageProgress(100, window), 65);
});

test("derivative continuation resumes at 65 and reaches 100", () => {
  const window = resolveVideoNormalizationProgressWindow({
    continuesWithPendingOutputs: false,
    previousProgress: VIDEO_NORMALIZATION_CHAIN_PROGRESS_SPLIT,
    hasCompletedRequiredOutput: true,
  });

  assert.deepEqual(window, { start: 65, end: 100 });
  assert.equal(mapVideoNormalizationStageProgress(0, window), 65);
  assert.equal(mapVideoNormalizationStageProgress(50, window), 83);
  assert.equal(mapVideoNormalizationStageProgress(100, window), 100);
});

test("ready outputs recover the continuation window after an old zero checkpoint", () => {
  assert.deepEqual(
    resolveVideoNormalizationProgressWindow({
      continuesWithPendingOutputs: false,
      previousProgress: 0,
      hasCompletedRequiredOutput: true,
    }),
    { start: 65, end: 100 },
  );
});

test("a light one-stage video keeps the full 0..100 range", () => {
  const window = resolveVideoNormalizationProgressWindow({
    continuesWithPendingOutputs: false,
    previousProgress: 0,
    hasCompletedRequiredOutput: false,
  });

  assert.deepEqual(window, { start: 0, end: 100 });
  assert.equal(mapVideoNormalizationStageProgress(42, window), 42);
});

test("the worker persists the stage boundary instead of resetting chained progress", () => {
  const worker = readVideoNormalizationWorkerSource();

  assert.match(worker, /progress:\s*params\.stageCompletionProgress/);
  assert.match(worker, /processing_progress:\s*params\.stageCompletionProgress/);
  assert.match(
    worker,
    /processing_progress:\s*params\.continuesWithPendingOutputs\s*\?\s*params\.stageCompletionProgress\s*:\s*100/,
  );
});
