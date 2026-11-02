import { readVideoNormalizationWorkerSource } from "./video-worker-sources.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { BOOSTER_VIDEO_PREPARATION_KEYS } from "../../lib/boosterMediaPipelineMissions.ts";
import { planVideoNormalizationExecution } from "../../lib/mediaVideoNormalizationExecutionPlan.ts";

const read = (file: string) => readFileSync(resolve(process.cwd(), file), "utf8");

test("une publication peut produire un MP4 canonique H.264/AAC", () => {
  assert.deepEqual(BOOSTER_VIDEO_PREPARATION_KEYS.publication_preparation, [
    "canonical",
    "thumbnail",
  ]);
  const plan = planVideoNormalizationExecution({
    mission: "publication_preparation",
    requestedKeys: ["canonical", "thumbnail"],
    readyKeys: new Set(),
  });
  assert.deepEqual(plan.keys, ["canonical", "thumbnail"]);

  const normalizer = read("lib/mediaVideoNormalizer.ts");
  assert.match(normalizer, /function canCopyCanonicalVideo/);
  assert.match(normalizer, /video_copy_audio_transcode/);
  assert.match(normalizer, /"-c:v",\s*"copy"/);
  assert.match(normalizer, /copyAudio \? "copy" : "aac"/);
  assert.match(normalizer, /"libx264"/);
  assert.match(normalizer, /VIDEO_CANONICAL_MAX_BYTES/);
  assert.match(normalizer, /verifyCanonicalOutput/);
});

test("le worker accepte soit l'original prouvÃ©, soit le canonique crÃ©Ã©", () => {
  const worker = readVideoNormalizationWorkerSource();
  assert.match(worker, /const canonicalPublicationReady = Boolean\(outputs\.canonical\)/);
  assert.match(
    worker,
    /!originalPublicationReady\s*&&\s*!canonicalPublicationReady/,
  );
  assert.match(
    worker,
    /params\.originalPublicationReady \|\| params\.canonicalPublicationReady/,
  );
  assert.match(worker, /left\.key === "canonical"/);
});

test("la consommation publie le canonique uniquement si l'original est incompatible", () => {
  const consumption = read("lib/mediaWorkspaceConsumption.ts");
  assert.match(
    consumption,
    /const publicationVariant = directSourceReady \? null : canonical/,
  );
  assert.match(consumption, /compatibilityProof: publicationVariant/);
  assert.match(consumption, /"canonical_derivative"/);
});
