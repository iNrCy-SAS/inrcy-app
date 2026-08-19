import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  normalizeVideoAiContextReference,
  preserveVideoAiContextReferenceOnDraftUpdate,
  videoAiContextReferenceAliases,
} from "../../lib/videoAiContextReference.ts";

const root = process.cwd();
const read = (path: string) => readFileSync(join(root, path), "utf8");
const fingerprint = "a".repeat(64);
const reference = {
  schemaVersion: 1 as const,
  source: "pro_media_library" as const,
  mediaAssetId: "media_123",
  preparationVersion: 1,
  sourceFingerprint: fingerprint,
};

test("la référence vidéo iNrSend est strictement normalisée", () => {
  assert.deepEqual(normalizeVideoAiContextReference(reference), reference);
  assert.equal(
    normalizeVideoAiContextReference({ ...reference, sourceFingerprint: "court" }),
    null,
  );
  assert.equal(
    normalizeVideoAiContextReference({ ...reference, source: "booster" }),
    null,
  );
  assert.deepEqual(videoAiContextReferenceAliases(reference), {
    videoAiContextRef: reference,
    mediaAssetId: "media_123",
    videoAiContextVersion: 1,
    videoFingerprint: fingerprint,
  });
});

test("une modification du même brouillon conserve la référence, un remplacement vidéo l'invalide", () => {
  const previousPayload = {
    videoDraft: {
      storagePath: "user/booster-drafts/video.mp4",
      videoAiContextRef: reference,
    },
    videoAiContextRef: reference,
  };
  const preserved = preserveVideoAiContextReferenceOnDraftUpdate({
    previousPayload,
    nextPayload: {
      videoDraft: { storagePath: "user/booster-drafts/video.mp4" },
      content: "Texte modifié",
    },
  });
  assert.deepEqual(preserved.videoAiContextRef, reference);
  assert.deepEqual(
    (preserved.videoDraft as Record<string, unknown>).videoAiContextRef,
    reference,
  );

  const replaced = preserveVideoAiContextReferenceOnDraftUpdate({
    previousPayload,
    nextPayload: {
      videoDraft: { storagePath: "user/booster-drafts/autre-video.mp4" },
    },
  });
  assert.equal(replaced.videoAiContextRef, undefined);

  const explicitlyCleared = preserveVideoAiContextReferenceOnDraftUpdate({
    previousPayload,
    nextPayload: {
      videoDraft: { storagePath: "user/booster-drafts/video.mp4" },
      videoAiContextRef: null,
    },
  });
  assert.equal(explicitlyCleared.videoAiContextRef, null);
});

test("iNrAgent transmet la référence persistante au brouillon iNrSend", () => {
  const prepare = read("app/api/agent/actions/prepare-publish/route.ts");
  const actions = read("app/api/agent/actions/route.ts");

  assert.match(prepare, /buildVideoAiContextReference\(/);
  assert.match(prepare, /videoAiContextReferenceAliases\(videoAiContextRef\)/);
  assert.match(actions, /normalizeVideoAiContextReference\(payload\.videoAiContextRef\)/);
  assert.match(actions, /videoAiContextReferenceAliases\(videoAiContextRef\)/);
  assert.match(actions, /videoAiContextReferenceAliases\(args\.videoAiContextRef\)/);
});

test("la génération cutover conserve la référence et un fallback local borné", () => {
  const modal = read("app/dashboard/booster/publier/PublishModal.tsx");

  assert.match(
    modal,
    /hasVideoForGeneration &&[\s\S]*videoFile &&[\s\S]*!videoAiContextRef[\s\S]*settleOptionalMediaEnrichment/,
  );
  assert.doesNotMatch(
    modal,
    /hasVideoForGeneration &&[\s\S]{0,180}!videoAiContextRef &&[\s\S]{0,80}!mediaPipelineCutoverEnabled/,
  );
  assert.match(modal, /contextRef: videoAiContextRef/);
  assert.match(modal, /i18nT\("generation_video_analysis_reused"\)/);
  assert.match(modal, /videoAiContextReferenceAliases\(videoAiContextRef\)/);

  const generate = read("app/api/booster/generate/route.ts");
  assert.match(generate, /workspace_ai_video_deadline_exceeded/);
  assert.match(
    generate,
    /canUseVerifiedLocalVideoPreview[\s\S]*mediaAnalysisFallback = null/,
  );
  assert.match(generate, /!useVerifiedLocalVideoPreview/);
});

test("la route Booster lit uniquement le cache persistant sans préparer à nouveau la vidéo", () => {
  const generate = read("app/api/booster/generate/route.ts");
  const cache = read("lib/inrAgentVideoContextCache.ts");
  const start = cache.indexOf("export async function loadPersistedInrAgentVideoForAi");
  const end = cache.indexOf("export async function loadInrAgentVideoDerivativePaths", start);
  const readOnlyFunction = cache.slice(start, end);

  assert.match(generate, /loadPersistedInrAgentVideoForAi\(/);
  assert.match(generate, /videoContextReferenceSource = persistedVideoContext/);
  assert.doesNotMatch(readOnlyFunction, /prepareInrAgentVideoForAi\(/);
  assert.doesNotMatch(readOnlyFunction, /ffmpeg/i);
  assert.doesNotMatch(readOnlyFunction, /transcrib/i);
});

test("les mises à jour iNrSend préservent la référence seulement pour la même vidéo", () => {
  const events = read("app/api/booster/events/route.ts");
  assert.match(events, /preserveVideoAiContextReferenceOnDraftUpdate\(/);
  assert.match(events, /update\(\{ payload: nextPayload \}\)/);
  assert.match(
    events,
    /cleanupReplacedBoosterVideoStorage\(userId, previousDraft\?\.payload, nextPayload\)/,
  );
});
