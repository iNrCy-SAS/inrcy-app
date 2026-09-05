import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import { normalizeAiMediaGenerationRequest } from "../../lib/aiMediaGenerationContracts.ts";
import { assertAiVideoReferenceTeamGoogleEgress } from "../../lib/aiVideoProviderTypes.ts";

const ROOT = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(ROOT, relativePath), "utf8");

test("le prompt vidéo distingue le professionnel, l’avatar et le mode générique", () => {
  const veo = read("lib/aiVideoProviderGoogleVeo.ts");

  assert.match(veo, /buildGoogleVideoIdentityDirection/);
  assert.match(veo, /IDENTITY LOCK — APPROVED REAL PROFESSIONAL/);
  assert.match(veo, /IDENTITY LOCK — APPROVED BRAND AVATAR/);
  assert.match(veo, /general visual inspiration only/);
  assert.match(
    veo,
    /never replace the professional with a generic or different person/
  );
  assert.match(veo, /PUNCTUAL USER DIRECTION FOR THIS GENERATION ONLY/);
});

test("les références d’identité restent actives sur chaque segment et chaque fournisseur", () => {
  const veo = read("lib/aiVideoProviderGoogleVeo.ts");
  const omni = read("lib/aiVideoProviderGoogleOmni.ts");

  for (const provider of [veo, omni]) {
    assert.match(provider, /preserveIdentityReferences \|\| index === 0/);
    assert.match(provider, /videoCharacterMode === "professional"/);
    assert.match(provider, /videoCharacterMode === "brand_avatar"/);
    assert.match(provider, /videoCharacterMode === "reference_team"/);
    assert.match(provider, /assertAiVideoReferenceTeamGoogleEgress\(args\)/);
  }

  assert.match(
    veo,
    /inspirationImages\.length && args\.preserveIdentityReferences[\s\S]*?\[\{ prompt: args\.prompt, inspirationImages \}\]/
  );
  assert.match(
    omni,
    /args\.inspirationImages\.length && args\.preserveIdentityReferences[\s\S]*?images: args\.inspirationImages/
  );
});

test("un fournisseur qui refuse l’identité échoue explicitement sans rendu générique", () => {
  const veo = read("lib/aiVideoProviderGoogleVeo.ts");
  const omni = read("lib/aiVideoProviderGoogleOmni.ts");
  const route = read("app/api/media-generation/generate/route.ts");

  for (const provider of [veo, omni]) {
    assert.match(provider, /ai_video_identity_reference_rejected/);
  }
  assert.match(
    veo,
    /const canRetryWithoutInspiration =\s*!args\.preserveIdentityReferences/
  );
  assert.match(
    omni,
    /const canDropInspiration =\s*!args\.preserveIdentityReferences/
  );
  assert.match(route, /AI_MEDIA_VIDEO_IDENTITY_REFERENCE_REJECTED/);
  assert.match(route, /Aucune personne générique n’a été substituée/);
});

test("l’équipe cinématique n’envoie à Veo qu’une composition de groupe consentie et retombe toujours en local", () => {
  const server = read("lib/aiMediaGenerationServer.ts");
  const route = read("app/api/media-generation/generate/route.ts");

  assert.match(server, /providerRequest\.teamVideoMode === "cinematic"/);
  assert.match(server, /providerRequest\.teamVideoVeoConsent/);
  assert.match(server, /videoEngine: "veo"/);
  assert.match(server, /inspirationImages: \[groupImage\]/);
  assert.match(server, /identityTeamPrecomposed: true/);
  assert.match(server, /identityTeamGoogleEgressConsent: true/);
  assert.match(
    server,
    /identity_team_cinematic_unavailable_local_motion[\s\S]*?createAiMediaFallbackVideo/,
  );
  assert.match(
    server,
    /identity_team_google_consent_missing_local_motion[\s\S]*?createAiMediaFallbackVideo/,
  );
  assert.match(server, /team_video_mode: providerRequest\.teamVideoMode/);
  assert.match(
    server,
    /team_video_speech_mode: providerRequest\.teamVideoSpeechMode/,
  );
  assert.match(route, /team_video_mode: normalizedRequest\.teamVideoMode/);
  assert.match(
    route,
    /team_video_speech_mode: normalizedRequest\.teamVideoSpeechMode/,
  );
  assert.match(route, /teamVideoSpeechMode: request\.teamVideoSpeechMode/);
  assert.doesNotMatch(server, /team_video_veo_consent/);
  assert.doesNotMatch(route, /team_video_veo_consent/);
});

test("les garde-fous Google sont évalués avant toute création de client réseau", () => {
  const guard = read("lib/aiVideoProviderTypes.ts");
  assert.match(guard, /identityTeamPrecomposed/);
  assert.match(guard, /identityTeamGoogleEgressConsent/);
  assert.match(guard, /ai_video_reference_team_precomposition_required/);
  assert.match(guard, /ai_video_reference_team_google_consent_required/);
  assert.match(guard, /ai_video_reference_team_single_group_image_required/);

  for (const relativePath of [
    "lib/aiVideoProviderGoogleVeo.ts",
    "lib/aiVideoProviderGoogleOmni.ts",
  ]) {
    const provider = read(relativePath);
    const guardCall = provider.indexOf(
      "assertAiVideoReferenceTeamGoogleEgress(args)",
    );
    const googleClient = provider.indexOf("new GoogleGenAI", guardCall);
    assert.ok(guardCall > 0, `${relativePath}: garde réseau`);
    assert.ok(googleClient > guardCall, `${relativePath}: aucun egress avant gardes`);
  }
});

test("la garde réseau refuse à l’exécution une équipe brute, non consentie ou multiple", () => {
  const data = Buffer.alloc(96, 31).toString("base64");
  const request = normalizeAiMediaGenerationRequest({
    requestId: "team-google-egress-runtime-guard",
    kind: "video",
    subjectSource: "profile",
    identityMode: "reference_team",
    identityConsent: true,
    teamVideoMode: "cinematic",
    teamVideoVeoConsent: true,
    inspirationImages: [
      { mimeType: "image/jpeg", data },
      { mimeType: "image/jpeg", data },
    ],
    source: "studio",
  });

  assert.throws(
    () => assertAiVideoReferenceTeamGoogleEgress({ request }),
    /precomposition_required/,
  );
  assert.throws(
    () =>
      assertAiVideoReferenceTeamGoogleEgress({
        request,
        identityTeamPrecomposed: true,
      }),
    /google_consent_required/,
  );
  assert.throws(
    () =>
      assertAiVideoReferenceTeamGoogleEgress({
        request,
        identityTeamPrecomposed: true,
        identityTeamGoogleEgressConsent: true,
      }),
    /single_group_image_required/,
  );
  assert.doesNotThrow(() =>
    assertAiVideoReferenceTeamGoogleEgress({
      request: { ...request, inspirationImages: [request.inspirationImages[0]!] },
      identityTeamPrecomposed: true,
      identityTeamGoogleEgressConsent: true,
    }),
  );
});

test("la direction Veo impose une scène animée continue sans diaporama ni altération d’équipe", () => {
  const veo = read("lib/aiVideoProviderGoogleVeo.ts");
  const server = read("lib/aiMediaGenerationServer.ts");

  assert.match(veo, /one continuous scene/);
  assert.match(veo, /never use collage, split-screen, portrait cards, slideshow/);
  assert.match(veo, /Ken Burns/);
  assert.match(veo, /real facial and full-body motion/);
  assert.match(veo, /gestures, steps, interaction and camera movement/);
  assert.match(veo, /exactly \$\{identityTeamMemberCount === 3 \? 3 : 2\} adults/);
  assert.match(veo, /never invent, remove, fuse, duplicate, swap or replace anyone/);
  assert.match(server, /jamais un collage, un écran partagé, des cartes portrait ni un diaporama/);
  assert.match(server, /regards, expressions, gestes, pas, interactions et mouvements de caméra naturels/);
});

test("Veo sépare strictement les dialogues natifs et la voix off sans inférer le genre réel", () => {
  const veo = read("lib/aiVideoProviderGoogleVeo.ts");
  const contracts = read("lib/aiMediaGenerationContracts.ts");

  assert.match(contracts, /teamVideoSpeechMode: AiMediaTeamVideoSpeechMode/);
  assert.match(contracts, /teamVideoSpeechMode !== "characters"/);
  assert.match(veo, /buildGoogleVideoTeamSpeechDirection/);
  assert.match(veo, /scene\?\.spokenLine/);
  assert.match(veo, /connected to the current professional subject/);
  assert.doesNotMatch(veo, /\["On s’y met \?", "Avec plaisir\."\]/);
  assert.match(veo, /VOICE-OVER MODE — every on-screen person stays silent/);
  assert.match(veo, /no dialogue, speech, lip-sync or vocalisation/);
  assert.match(veo, /NATIVE CHARACTER DIALOGUE, never voice-over/);
  assert.match(veo, /says exactly “\$\{firstLine\}”/);
  assert.match(veo, /precise lip-sync, breathing, expression and body language/);
  assert.match(veo, /distinct synthetic feminine, masculine or neutral adult timbres/);
  assert.match(veo, /never clone a real voice, infer or state real gender identity/);
  assert.match(veo, /never voice-over/);

  const identityPosition = veo.indexOf(
    "identityDirection ? `${identityDirection}.` : \"\"",
  );
  const speechPosition = veo.indexOf(
    "speechDirection ? `${speechDirection}.` : \"\"",
  );
  const subjectPosition = veo.indexOf(
    "`PRIMARY SUBJECT — visually unmistakable: ${primarySubject}.`",
  );
  assert.ok(identityPosition > 0, "verrou d’identité présent");
  assert.ok(speechPosition > identityPosition, "dialogue après le verrou d’identité");
  assert.ok(subjectPosition > speechPosition, "instructions critiques avant le contexte tronquable");
});

test("le cadrage vidéo protège la tête lors du recadrage carré", () => {
  const veo = read("lib/aiVideoProviderGoogleVeo.ts");
  const composer = read("lib/aiMediaGeneratedVideo.ts");
  const copywriter = read("lib/aiMediaCopywriter.ts");

  assert.match(veo, /buildGoogleVideoFramingDirection/);
  assert.match(veo, /complete hairline, entire head, chin, shoulders and upper torso/);
  assert.match(veo, /FINAL 1:1 SAFE FRAME/);
  assert.match(composer, /args\.width === args\.height[\s\S]*?\? "0"/);
  assert.match(composer, /crop=\$\{args\.width\}:\$\{args\.height\}:\(in_w-out_w\)\/2:\$\{verticalCropY\}/);
  assert.match(copywriter, /spokenLine/);
  assert.match(copywriter, /spokenReply/);
  assert.match(copywriter, /directement liée au sujet professionnel vérifié/);
});

test("le montage audio préserve le dialogue natif et retombe sans double parole", () => {
  const composer = read("lib/aiMediaGeneratedVideo.ts");
  const server = read("lib/aiMediaGenerationServer.ts");

  assert.match(composer, /AiMediaNativeAudioMode = "ambience" \| "dialogue" \| "mute"/);
  assert.match(composer, /args\.nativeAudioMode === "dialogue"[\s\S]*?"1\.0"/);
  assert.match(composer, /args\.nativeAudioMode === "dialogue"[\s\S]*?"0\.035"/);
  assert.match(composer, /ai_original_video_dialogue_narration_conflict/);
  assert.match(composer, /ai_original_video_native_dialogue_missing/);
  assert.match(server, /character_dialogue_fallback_narration/);
  assert.match(server, /identity_team_character_dialogue_fallback_voiceover/);
  assert.match(server, /minimalNativeDialogueSucceeded/);
  assert.match(server, /video_composition_minimal_native_dialogue/);
  assert.match(server, /else if \(!characterDialogueProviderFallback\)/);
  assert.match(server, /nativeAudioMode: narrationAudio \? "mute" : "ambience"/);
  assert.match(server, /video_composition_silent_fallback/);
  assert.match(server, /nativeAudioMode: "mute"/);
  assert.match(server, /native_character_dialogue_preserved/);
});
