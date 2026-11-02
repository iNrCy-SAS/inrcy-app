import { readFileSync as readSubmissionSource } from "node:fs";
const submission = readSubmissionSource(new URL("../../app/dashboard/booster/publier/publicationSubmission.ts", import.meta.url), "utf8");
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8").replace(
    /\r\n/g,
    "\n",
  );
}

const workspaceHook = read(
  "app/dashboard/booster/publier/usePersistentMediaWorkspace.ts",
);
const modal = read("app/dashboard/booster/publier/PublishModal.tsx");
const generation = read("app/dashboard/booster/publier/useBoosterGeneration.ts");
const generationRoute = read("app/api/booster/generate/route.ts");
const sharedGeneration = read("lib/boosterPublishGeneration.ts");
const transcriptionRoute = read("app/api/booster/transcribe/route.ts");
const videoAiRuntime = read(
  "app/dashboard/booster/publier/publishModal.videoAiRuntime.ts",
);

test("workspace lifecycle cannot leave synchronization stuck or apply a stale snapshot", () => {
  assert.match(
    workspaceHook,
    /adoptWorkspace[\s\S]*setSynchronizing\(false\)/,
  );
  assert.match(
    workspaceHook,
    /archiveWorkspace[\s\S]*setSynchronizing\(false\)/,
  );
  assert.match(
    workspaceHook,
    /operationVersion === operationVersionRef\.current[\s\S]*referenceRef\.current\?\.workspaceId === workspaceId[\s\S]*onPreparedMediaRef\.current/,
  );
});

test("waitForIdle is followed by one authoritative source-readiness snapshot", () => {
  assert.match(workspaceHook, /const verifyReadySources = useCallback/);
  assert.match(
    workspaceHook,
    /loadMediaPublicationWorkspace\(\{[\s\S]*includeUrls: false/,
  );
  assert.match(
    workspaceHook,
    /media\.uploadStatus === "uploaded"[\s\S]*media\.storagePath/,
  );
  assert.match(
    modal,
    /await waitForPersistentWorkspaceIdle[\s\S]*await verifyPersistentWorkspaceSources/,
  );
});

test("generation applies its 105-second safety window without fake waits", () => {
  assert.match(generation, /Date\.now\(\) \+ BOOSTER_GENERATION_SAFETY_BUDGET_MS/);
  assert.match(
    generation,
    /BOOSTER_GENERATION_SAFETY_BUDGET_MS\s*=\s*105_000/,
  );
  assert.doesNotMatch([modal, submission].join("\n"), /await sleep\(320\)|await sleep\(650\)/);
  assert.doesNotMatch([modal, submission].join("\n"), /transcribeVideoAudioForAI\(/);
  assert.doesNotMatch(generation, /await sleep\(320\)|await sleep\(650\)/);
  assert.doesNotMatch(generation, /transcribeVideoAudioForAI\(/);
  const mediaReadinessIndex = generation.indexOf(
    'await waitForPersistentWorkspaceReadiness(',
  );
  const deadlineStartIndex = generation.indexOf(
    'const generationDeadlineAt =\n        Date.now() + BOOSTER_GENERATION_SAFETY_BUDGET_MS',
  );
  const requestBuildIndex = generation.indexOf('const generationPayload = {');
  assert.ok(mediaReadinessIndex >= 0);
  assert.ok(deadlineStartIndex > mediaReadinessIndex);
  assert.ok(requestBuildIndex > deadlineStartIndex);
});

test("video preparation never holds Generate beyond the shared grace window", () => {
  assert.match(generation, /BOOSTER_VIDEO_AI_PREPARATION_GRACE_MS = 12_000/);
  assert.match(
    generation,
    /waitForPersistentWorkspaceReadiness\([\s\S]*?"generate"[\s\S]*?Math\.max\(1_000, mediaPreparationDeadlineAt - Date\.now\(\)\)/,
  );
  assert.match(
    generation,
    /videoAiPreparationReady = await Promise\.race\(\[[\s\S]*?preparation[\s\S]*?mediaPreparationDeadlineAt - Date\.now\(\)/,
  );
  assert.doesNotMatch(
    generation,
    /heavyVideoNeedsCanonical\s*\?\s*await preparation/,
  );
});

test("the server shares the route-entry deadline with transcription and generation", () => {
  assert.match(
    generationRoute,
    /routeStartedAt \+ BOOSTER_GENERATION_SAFETY_BUDGET_MS/,
  );
  assert.match(
    generationRoute,
    /aiTranscribeMedia\(\{[\s\S]*deadlineAt:[\s\S]*signal: req\.signal/,
  );
  assert.match(
    generationRoute,
    /generateSharedBoosterPosts\(\{[\s\S]*deadlineAt:/,
  );
  assert.match(
    sharedGeneration,
    /Math\.min\([\s\S]*budget\.startedAt \+ budget\.maxDurationMs[\s\S]*requestedDeadlineAt/,
  );
});

test("fast video context never sends the full video and bounds /transcribe work", () => {
  assert.match(videoAiRuntime, /mode: "generation_fast"/);
  assert.match(
    videoAiRuntime,
    /Ne jamais envoyer le conteneur vidéo complet à \/transcribe/,
  );
  assert.doesNotMatch(videoAiRuntime, /formData\.append\("video"/);
  assert.match(
    transcriptionRoute,
    /FAST_GENERATION_TRANSCRIPTION_BUDGET_MS = 7_000/,
  );
  assert.match(
    transcriptionRoute,
    /fastGenerationMode[\s\S]*deadlineAt: fastGenerationDeadlineAt/,
  );
  assert.match(transcriptionRoute, /source: "video_audio_fast"/);
});
