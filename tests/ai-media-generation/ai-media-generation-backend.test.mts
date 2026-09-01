import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  AiMediaRequestValidationError,
  normalizeAiMediaGenerationRequest,
} from "../../lib/aiMediaGenerationContracts.ts";
import { bufferFromUint8ArrayView } from "../../lib/aiMediaBuffer.ts";
import {
  AI_MEDIA_SOUNDTRACKS,
  selectAiMediaSoundtrack,
} from "../../lib/aiMediaSoundtrackCatalog.ts";

const ROOT = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(ROOT, relativePath), "utf8");

test("le contrat réduit les options au média demandé", () => {
  const image = normalizeAiMediaGenerationRequest({
    requestId: "media-request-0001",
    kind: "image",
    subjectSource: "publication",
    idea: "Présenter le nouveau menu de printemps",
    withText: true,
    withMusic: true,
    source: "booster",
  });
  assert.equal(image.withText, true);
  assert.equal(image.withMusic, false);

  const video = normalizeAiMediaGenerationRequest({
    requestId: "media-request-0002",
    kind: "video",
    subjectSource: "custom",
    idea: "Montrer le savoir-faire de l'atelier",
    withText: true,
    withMusic: true,
    source: "studio",
  });
  assert.equal(video.withText, false);
  assert.equal(video.withMusic, true);

  const profile = normalizeAiMediaGenerationRequest({
    requestId: "media-request-0003",
    kind: "image",
    subjectSource: "profile",
    idea: "Ce texte doit être ignoré au profit du profil",
    withText: false,
    source: "studio",
  });
  assert.equal(profile.subjectSource, "profile");
  assert.equal(profile.idea, "");
  assert.throws(
    () =>
      normalizeAiMediaGenerationRequest({
        kind: "image",
        subjectSource: "custom",
        idea: "x",
      }),
    AiMediaRequestValidationError,
  );
});

test("les dix bandes-son originales sont déterministes et durent exactement huit secondes", () => {
  const manifest = JSON.parse(
    read("assets/media-generation/soundtracks/manifest.json"),
  ) as {
    generatedBy: string;
    tracks: Array<{
      id: string;
      fileName: string;
      durationSeconds: number;
      sha256: string;
      sizeBytes: number;
      license: string;
    }>;
  };

  assert.equal(AI_MEDIA_SOUNDTRACKS.length, 10);
  assert.equal(new Set(AI_MEDIA_SOUNDTRACKS.map((item) => item.id)).size, 10);
  assert.equal(manifest.generatedBy, "inrcy-procedural-synth");
  assert.equal(manifest.tracks.length, 10);
  assert.equal(
    selectAiMediaSoundtrack("atelier artisan savoir-faire").id,
    selectAiMediaSoundtrack("atelier artisan savoir-faire").id,
  );

  for (const track of manifest.tracks) {
    const buffer = readFileSync(
      path.join(ROOT, "assets/media-generation/soundtracks", track.fileName),
    );
    assert.equal(buffer.toString("ascii", 0, 4), "RIFF");
    assert.equal(buffer.toString("ascii", 8, 12), "WAVE");
    const channels = buffer.readUInt16LE(22);
    const sampleRate = buffer.readUInt32LE(24);
    const bitsPerSample = buffer.readUInt16LE(34);
    const dataBytes = buffer.readUInt32LE(40);
    const duration = dataBytes / (sampleRate * channels * (bitsPerSample / 8));
    assert.equal(duration, 8);
    assert.equal(track.durationSeconds, 8);
    assert.equal(track.sizeBytes, buffer.byteLength);
    assert.equal(track.license, "inrcy-original-procedural-v1");
    assert.equal(
      track.sha256,
      createHash("sha256").update(buffer).digest("hex"),
    );
  }
});

test("le prompt rend le texte natif optionnel et interdit les faits inventés", () => {
  const source = read("lib/aiMediaGenerationPrompt.ts");
  assert.match(source, /MODE TEXTE NATIF/);
  assert.match(source, /3 à 8 mots/);
  assert.match(source, /jamais à recopier dans le média/);
  assert.match(source, /le brief ne doit jamais devenir le texte de l’image/);
  assert.match(source, /inrcy-media-v3/);
  assert.match(source, /subjectSource/);
  assert.match(source, /MODE SANS TEXTE/);
  assert.match(source, /aucune lettre, aucun mot, aucun chiffre/);
  assert.match(source, /Ne jamais inventer de prix, promotion, certification/);
  assert.match(source, /exactement pensée pour 8 secondes/);
  assert.match(source, /carrée 1:1/);
});

test("la vue Buffer des médias Gateway ne duplique pas le Uint8Array", () => {
  const backing = new Uint8Array([10, 20, 30, 40, 50, 60]);
  const source = backing.subarray(2, 5);
  const buffer = bufferFromUint8ArrayView(source);

  assert.equal(buffer.byteLength, 3);
  assert.deepEqual([...buffer], [30, 40, 50]);
  source[1] = 99;
  assert.equal(buffer[1], 99);
  buffer[2] = 77;
  assert.equal(source[2], 77);
  assert.equal(buffer.buffer, source.buffer);
});

test("la route applique scope, abonnement et quota à l'établissement actif", () => {
  const route = read("app/api/media-generation/generate/route.ts");
  const quotaRoute = read("app/api/media-generation/quota/route.ts");

  assert.match(route, /context\.accountId = current\.scope\.activeUserId/);
  assert.match(route, /getDashboardEditionForAccountId\(context\.accountId\)/);
  assert.match(route, /identifier: context\.accountId/);
  assert.match(route, /accountId: context\.accountId/);
  assert.doesNotMatch(route, /body\.accountId|body\.userId/);
  assert.match(quotaRoute, /getDashboardEditionForAccountId\(activeUserId\)/);
  assert.match(quotaRoute, /accountId: activeUserId/);
  assert.match(route, /reservation\.outcome === "premium_required"/);
  assert.match(route, /code: "AI_MEDIA_STUDIO_DISABLED"/);
  assert.doesNotMatch(route, /code: "PREMIUM_REQUIRED"/);
  assert.doesNotMatch(route, /réservé à iNrCy Premium/);
  assert.match(route, /normalizedRequest\.source/);
});

test("un média persisté n'est jamais libéré du quota", () => {
  const route = read("app/api/media-generation/generate/route.ts");
  assert.match(route, /getPersistedGeneratedAiMediaId/);
  assert.match(route, /recovered_after_persistence_error/);
  assert.match(
    route,
    /quotaReserved && !quotaCompleted && !mediaPersisted/,
  );
  assert.match(route, /AI_MEDIA_FINALIZATION_PENDING/);
});

test("Gateway, normalisation et médiathèque respectent le contrat universel", () => {
  const gateway = read("lib/aiMediaGateway.ts");
  const normalizer = read("lib/aiMediaNormalizer.ts");
  const registry = read("lib/aiGeneratedMediaRegistry.ts");
  const server = read("lib/aiMediaGenerationServer.ts");
  const nextConfig = read("next.config.ts");
  const vercelConfig = read("vercel.json");

  assert.match(gateway, /openai\/gpt-image-2/);
  assert.match(gateway, /AI_GATEWAY_IMAGE_MODEL[\s\S]{0,240}\?\? ""/);
  assert.match(gateway, /configured \|\| \(kind === "image" \? DEFAULT_IMAGE_MODEL : DEFAULT_VIDEO_MODEL\)/);
  assert.match(gateway, /bfl\/flux-3-video/);
  assert.match(gateway, /AI_GATEWAY_IMAGE_MODEL/);
  assert.match(gateway, /AI_GATEWAY_VIDEO_MODEL/);
  assert.match(gateway, /size: "1024x1024"/);
  assert.match(gateway, /duration: 8/);
  assert.match(gateway, /DEFAULT_VIDEO_COST_MICRO_USD = 1_500_000/);
  assert.match(gateway, /aspectRatio: "1:1"/);
  assert.match(gateway, /generateAudio: false/);
  assert.match(gateway, /MAX_VIDEO_BYTES = 100 \* 1024 \* 1024/);
  assert.match(gateway, /DEFAULT_VIDEO_GATEWAY_POLL_TIMEOUT_MS = 540_000/);
  assert.match(gateway, /MAX_VIDEO_GATEWAY_POLL_TIMEOUT_MS = 560_000/);
  assert.match(gateway, /AbortSignal\.timeout\(pollTimeoutMs\)/);
  assert.match(gateway, /bufferFromUint8ArrayView\(image\.uint8Array\)/);
  assert.match(gateway, /bufferFromUint8ArrayView\(video\.uint8Array\)/);
  assert.doesNotMatch(gateway, /Buffer\.from\((?:image|video)\.uint8Array\)/);
  assert.match(normalizer, /VIDEO_SIDE = 1080/);
  assert.match(normalizer, /VIDEO_DURATION_SECONDS = 8/);
  assert.match(normalizer, /MAX_NORMALIZED_VIDEO_BYTES = 60 \* 1024 \* 1024/);
  assert.match(normalizer, /-c:v/);
  assert.match(normalizer, /libx264/);

  assert.match(registry, /const BUCKET = "inrcy-pro-media"/);
  assert.match(registry, /users\/\$\{safePathSegment\(args\.accountId/);
  assert.match(registry, /ai-generated\/\$\{args\.kind\}/);
  assert.match(registry, /`ai-media:\$\{jobId\}`/);
  assert.match(registry, /upload_protocol: "server_legacy"/);
  assert.match(registry, /active_account_id: args\.accountId/);
  assert.match(server, /prompt_sha256: promptHash/);
  assert.doesNotMatch(server, /prompt_sha256: promptHash,\s*prompt,/);
  assert.match(nextConfig, /assets\/media-generation\/soundtracks\/\*\*\/\*/);
  assert.match(nextConfig, /node_modules\/ffmpeg-static\/\*\*\/\*/);
  assert.match(vercelConfig, /media-generation\/generate\/route\.ts/);
  assert.match(vercelConfig, /assets\/media-generation\/soundtracks/);
  assert.equal((JSON.parse(vercelConfig) as { fluid?: boolean }).fluid, true);
});
