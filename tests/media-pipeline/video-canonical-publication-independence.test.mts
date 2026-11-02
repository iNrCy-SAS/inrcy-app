import { readVideoNormalizationWorkerSource } from "./video-worker-sources.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const read = (file: string) => readFileSync(resolve(ROOT, file), "utf8");

const generationController = read("app/dashboard/booster/publier/useBoosterGeneration.ts");

test("the verified original remains publishable when optional AI artifacts fail", () => {
  const worker = readVideoNormalizationWorkerSource();
  const consumption = read("lib/mediaWorkspaceConsumption.ts");

  assert.match(worker, /const publicationMediaReady = originalReady \|\| canonicalReady/);
  assert.match(
    worker,
    /Captures\/audio IA are best-effort and never invalidate a compatible/,
  );
  assert.match(worker, /outputs\.canonical/);
  assert.match(worker, /canonicalPublicationReady/);
  assert.match(
    consumption,
    /const publicationVariant = directSourceReady \? null : canonical/,
  );
  assert.match(
    consumption,
    /bucket: publicationVariant\?\.bucket \|\| item\.sourceBucket/,
  );
});

test("AI captures start for every accepted video without a size branch", () => {
  const modal = read("app/dashboard/booster/publier/PublishModal.tsx");
  const prewarmStart = modal.indexOf(
    "// Les captures locales commencent dès l'insertion de toute vidéo acceptée.",
  );
  const prewarmEnd = modal.indexOf("}, [", prewarmStart);
  const localPrewarm = modal.slice(prewarmStart, prewarmEnd);

  assert.ok(prewarmStart >= 0 && prewarmEnd > prewarmStart);
  assert.match(localPrewarm, /getOrPrepareVideoFramesForAI\(videoFile\)/);
  assert.doesNotMatch(localPrewarm, /size\s*[<>]=?|HEAVY|PREWARM_MIN/);

  const generationStart = generationController.indexOf("let videoFramesForAI");
  const generationEnd = generationController.indexOf("let generationWorkspaceId", generationStart);
  assert.ok(generationStart >= 0 && generationEnd > generationStart, "inspect the active local-video analysis block before creating its durable receipt");
  const localGeneration = generationController.slice(generationStart, generationEnd);
  assert.match(localGeneration, /getOrPrepareVideoFramesForAI\(videoFile\)/);
  assert.match(localGeneration, /BOOSTER_LOCAL_MEDIA_ENRICHMENT_BUDGET_MS/);
});
