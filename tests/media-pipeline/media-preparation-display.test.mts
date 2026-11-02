import { readFileSync as readSubmissionSource } from "node:fs";
const submission = readSubmissionSource(new URL("../../app/dashboard/booster/publier/publicationSubmission.ts", import.meta.url), "utf8");
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  resolveMediaPreparationDisplayPhase,
  resolveMediaPreparationDisplayState,
} from "../../lib/mediaPreparationDisplay.ts";

test("all media preparation states use one universal phase", () => {
  assert.deepEqual(
    resolveMediaPreparationDisplayState([
      {
        mediaType: "video",
        sizeBytes: 75_000_000,
        processingStatus: "processing",
        processingProgress: 32.5,
      },
    ]),
    { phase: "preparation", phaseProgress: null },
  );
});

test("videos, images and terminal rows use the universal preparation label", () => {
  for (const row of [
    {
      mediaType: "video",
      sizeBytes: 75_000_000,
      processingStatus: "processing",
      processingProgress: 20,
    },
    {
      mediaType: "image",
      sizeBytes: 50_000_000,
      processingStatus: "processing",
      processingProgress: 20,
    },
    {
      mediaType: "video",
      sizeBytes: 75_000_000,
      processingStatus: "ready",
      processingProgress: 100,
    },
    {
      mediaType: "video",
      sizeBytes: 75_000_000,
      processingStatus: "failed_terminal",
      processingProgress: 0,
    },
  ]) {
    assert.equal(resolveMediaPreparationDisplayPhase([row]), "preparation");
  }
});

test("the async publication scopes progress to the media families of preparing channels", () => {
  const source = readFileSync(
    new URL("../../lib/boosterAsyncPublication.ts", import.meta.url),
    "utf8",
  );
  assert.match(source, /parentPayload\.preparationRequest/);
  assert.match(source, /state\.status === "preparing"/);
  assert.match(source, /requestedMediaTypes/);
  assert.match(source, /phaseProgress/);
});

test("generation and publication expose only the universal media label", () => {
  const modal = readFileSync(
    new URL(
      "../../app/dashboard/booster/publier/PublishModal.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  assert.doesNotMatch([modal, submission].join("\n"), /Compression des médias/);
  assert.match(submission, /"Préparation des médias"/);
  assert.doesNotMatch([modal, submission].join("\n"), /Préparation de la vidéo/);
});
