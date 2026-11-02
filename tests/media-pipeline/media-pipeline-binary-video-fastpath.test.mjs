import { readVideoNormalizationWorkerSource } from "./video-worker-sources.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(path, "utf8");

const generationController = read("app/dashboard/booster/publier/useBoosterGeneration.ts");

test("les workers Storage évitent les copies binaires inutiles", () => {
  const imageWorker = read("lib/mediaImageNormalizationWorker.ts");
  const videoWorker = readVideoNormalizationWorkerSource();
  assert.match(imageWorker, /toExactStorageArrayBuffer\(params\.normalized\.buffer\)/);
  assert.match(videoWorker, /createReadStream\(params\.normalized\.filePath\)/);
  assert.match(videoWorker, /duplex:\s*"half"/);
  assert.doesNotMatch(videoWorker, /readFile\(params\.normalized\.filePath\)/);
  assert.match(imageWorker, /withStorageBinaryMetadata/);
  assert.match(videoWorker, /withStorageBinaryMetadata/);
});

test("les images historiques illisibles utilisent le secours IA depuis leur source", () => {
  const consumption = read("lib/mediaWorkspaceConsumption.ts");
  const resolver = consumption.slice(
    consumption.indexOf("async function resolveProviderSafeImageDataUrl"),
    consumption.indexOf("export async function resolveWorkspacePublicationConsumption"),
  );
  assert.match(resolver, /return await imageVariantToProviderSafeDataUrl\(candidate\)/);
  assert.match(resolver, /catch \(error\)[\s\S]*lastError = error/);
  assert.match(resolver, /return await sourceImageToProviderSafeDataUrl\(\{/);
  assert.match(consumption, /const sourceBuffer = await downloadWorkspaceImageSource\(params\)/);
  assert.match(consumption, /sharp\(sourceBuffer,[\s\S]*\.jpeg\(/);
  assert.match(consumption, /!expectedPrefixes\.some\(\(prefix\) => storagePath\.startsWith\(prefix\)\)/);
  assert.match(consumption, /expectedSha256 === sha256\(buffer\)/);
  assert.match(consumption, /markVariantBinaryUploadTrusted\(variant\)/);
});

test("la génération vidéo utilise les captures locales tandis que programmer exige le workspace", () => {
  const modal = read("app/dashboard/booster/publier/PublishModal.tsx");
  const generate = read("app/api/booster/generate/route.ts");
  assert.match(
    generationController,
    /shouldPrepareMediaForAi[\s\S]*waitForPersistentWorkspaceReadiness\([\s\S]*"generate"/,
  );
  assert.match(modal, /getOrPrepareVideoFramesForAI\(videoFile\)/);
  assert.doesNotMatch([modal, generationController].join("\n"), /transcribeVideoAudioForAI\(/);
  assert.doesNotMatch([modal, generationController].join("\n"), /directOriginalAvailable/);
  assert.match(
    modal,
    /mediaPipelineCutoverV1:\s*true,[\s\S]{0,100}allowOriginalVideoFallback:\s*false/,
  );
  assert.match(generate, /workspace_verified_client_video_context/);
  assert.match(generate, /existingVideoFrames\.length/);
});

test("les événements de progression ne publient jamais uploaded", () => {
  const uploadClient = read("lib/universalMediaUploadClient.ts");
  assert.match(uploadClient, /progressPersistenceChain/);
  assert.match(uploadClient, /if \(normalized >= 100\) return/);
  assert.match(uploadClient, /event: "uploading"/);
  assert.match(uploadClient, /await progressPersistenceChain\.catch/);
});
