import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const sourcePath = new URL(
  "../../app/dashboard/booster/publier/PublishModal.tsx",
  import.meta.url,
);
const source = await readFile(sourcePath, "utf8");
const videoAiRuntime = await readFile(
  new URL(
    "../../app/dashboard/booster/publier/publishModal.videoAiRuntime.ts",
    import.meta.url,
  ),
  "utf8",
);
const foundations = await readFile(
  new URL(
    "../../app/dashboard/booster/publier/publishModal.foundations.ts",
    import.meta.url,
  ),
  "utf8",
);
const audioClient = await readFile(
  new URL("../../lib/boosterVideoAudioClient.ts", import.meta.url),
  "utf8",
);
const transcribeRoute = await readFile(
  new URL("../../app/api/booster/transcribe/route.ts", import.meta.url),
  "utf8",
);

const generationController = await readFile(new URL("../../app/dashboard/booster/publier/useBoosterGeneration.ts", import.meta.url), "utf8");

test("les captures vidéo restent mises en cache et préchauffent hors du bloc d'insertion", () => {
  assert.match(foundations, /type VideoFramesPreparationCache = \{/);
  assert.match(source, /const getOrPrepareVideoFramesForAI = useCallback/);
  assert.match(source, /videoFramesForAiCacheRef\.current = null/);
  const addVideoBlock = source.slice(
    source.indexOf("const addVideoFile"),
    source.indexOf("const onVideoChange"),
  );
  assert.doesNotMatch(addVideoBlock, /getOrPrepareVideoFramesForAI/);
  assert.match(
    source,
    /creationMode !== "ai" \|\|\s*!videoFile \|\|\s*videoAiContextRef[\s\S]*?getOrPrepareVideoFramesForAI\(videoFile\)/,
  );
  assert.doesNotMatch([source, generationController].join("\n"), /preparePersistentAiMedia/);
  assert.doesNotMatch([source, generationController].join("\n"), /preparePersistentPublicationMedia/);
  assert.match(source, /await waitForPersistentWorkspaceIdle/);
  assert.match(source, /await verifyPersistentWorkspaceSources/);
});

test("la génération rapide utilise les captures locales sans attendre de transcription audio", () => {
  const addVideoBlock = source.slice(
    source.indexOf("const addVideoFile"),
    source.indexOf("const onVideoChange"),
  );
  assert.doesNotMatch(addVideoBlock, /getOrPrepareVideoAudioFileForAI/);
  assert.doesNotMatch(addVideoBlock, /getOrPrepareVideoFramesForAI/);
  assert.doesNotMatch([source, generationController].join("\n"), /getOrPrepareVideoAudioFileForAI/);
  assert.doesNotMatch([source, generationController].join("\n"), /transcribeVideoAudioForAI/);

  const generationBlock = generationController.slice(
    generationController.indexOf("const onGenerate = async"),
    generationController.indexOf("  return { onGenerate"),
  );
  assert.ok(generationBlock.length > 0);
  assert.match(generationBlock, /const videoAudioTranscript = ""/);
  assert.match(generationBlock, /videoAudioTranscriptStatus = "unavailable"/);
  assert.match(
    generationBlock,
    /settleOptionalMediaEnrichment\([\s\S]*getOrPrepareVideoFramesForAI\(videoFile\)[\s\S]*BOOSTER_LOCAL_MEDIA_ENRICHMENT_BUDGET_MS/,
  );
  assert.doesNotMatch(
    generationBlock,
    /hasVideoForGeneration\s*&&\s*videoFile\s*&&\s*!videoAiContextRef\s*&&\s*!mediaPipelineCutoverEnabled/,
  );
});

test("le transport de transcription rapide n'envoie jamais le conteneur vidéo complet", () => {
  assert.match(audioClient, /new OfflineAudioContext\(/);
  assert.match(audioClient, /targetSampleRate \|\| DEFAULT_TARGET_SAMPLE_RATE/);
  assert.match(audioClient, /type: "audio\/wav"/);
  assert.match(
    videoAiRuntime,
    /FAST_GENERATION_AUDIO_MAX_BYTES = 3_750_000/,
  );
  assert.match(
    videoAiRuntime,
    /if \(preparedAudio\.size > FAST_GENERATION_AUDIO_MAX_BYTES\) return null/,
  );
  assert.match(videoAiRuntime, /prepareVideoAudioTransport\(preparedAudio\)/);
  assert.match(videoAiRuntime, /formData\.append\("audio", transport\.file, transport\.file\.name\)/);
  assert.match(videoAiRuntime, /audioStoragePath: transport\.storagePath/);
  assert.match(videoAiRuntime, /formData\.append\("origin", "video"\)/);
  assert.match(videoAiRuntime, /"x-inrcy-transcription-mode": "generation-fast"/);
  assert.doesNotMatch(videoAiRuntime, /formData\.append\("video"/);
  assert.match(
    videoAiRuntime,
    /else \{\s*\/\/ Ne jamais envoyer le conteneur vidéo complet[\s\S]*return null;/,
  );
  assert.match(
    transcribeRoute,
    /if \(fastGenerationMode\) \{[\s\S]*video_container_fast_mode_skipped/,
  );
});
