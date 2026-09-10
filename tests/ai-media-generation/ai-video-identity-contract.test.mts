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

  assert.match(veo, /buildGoogleVideoReferenceContract/);
  assert.match(veo, /request\.identityMode === "professional"/);
  assert.match(veo, /same face\/hair\/build each act/);
  assert.match(veo, /request\.identityMode === "brand_avatar"/);
  assert.match(veo, /same design\/features each act/);
  assert.match(veo, /request\.identityMode === "reference_team"/);
  assert.match(veo, /identities locked; all move 0\.0s/);
  assert.match(veo, /source to animate, not mood board/);
  assert.match(veo, /use subject\/mood\/composition\/style, not real identity/);
  assert.match(veo, /USER: \$\{userDirection\}/);
});

test("les identités gardent leurs références en parallèle et héritent des frames avec raccords", () => {
  const veo = read("lib/aiVideoProviderGoogleVeo.ts");
  const omni = read("lib/aiVideoProviderGoogleOmni.ts");

  for (const provider of [veo, omni]) {
    assert.match(provider, /inspirationImages:\s*index === 0 \|\| \(!connectScenes && preserveIdentityReferences\)\s*\? args\.request\.inspirationImages\s*: \[\]/);
    assert.match(provider, /const previousClip =[^;]*index > 0 \? clips\[index - 1\] : undefined/);
    assert.match(provider, /ai_video_continuity_context_missing/);
    assert.match(provider, /const continuityFrame = previousClip\s*\? await extractAiMediaVideoContinuityFrame\(\{ \.\.\.previousClip, signal: args\.signal \}\)/);
    assert.match(provider, /continuityFrame,\s*preserveIdentityReferences,/);
    assert.match(provider, /request\.teamVideoMode === "cinematic"/);
    assert.match(provider, /videoCharacterMode === "professional"/);
    assert.match(provider, /videoCharacterMode === "brand_avatar"/);
    assert.match(provider, /videoCharacterMode === "reference_team"/);
    assert.match(provider, /assertAiVideoReferenceTeamGoogleEgress\(args\)/);
  }

  assert.match(
    veo,
    /\(inspirationImages\.length && args\.preserveIdentityReferences\) \|\| args\.continuityFrame\s*\? \[\{ prompt: args\.prompt, inspirationImages \}\]/
  );
  assert.match(
    veo,
    /preserveIdentityReferences && args\.request\.inspirationImages\.length > 0[\s\S]*?configuredModels\.filter\(supportsVeoReferenceImages\)/,
  );
  assert.match(veo, /personGeneration: "allow_adult"/);
  assert.match(veo, /const sourceImage =\s*args\.continuityFrame \|\|/);
  assert.match(veo, /imageBytes: sourceImage\.data/);
  assert.match(veo, /!args\.continuityFrame && inspirationMode === "references"/);
  assert.match(
    omni,
    /args\.preserveIdentityReferences \|\| args\.continuityFrame\s*\? \[\s*\{\s*prompt: args\.prompt,\s*images: args\.inspirationImages/
  );
  assert.match(omni, /args\.continuityFrame \? \[\{\s*type: "image" as const,\s*data: args\.continuityFrame\.data,\s*mime_type: args\.continuityFrame\.mimeType/);
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

test("l’équipe cinématique conserve le moteur choisi, tente Omni après Veo puis retombe en local", () => {
  const server = read("lib/aiMediaGenerationServer.ts");
  const route = read("app/api/media-generation/generate/route.ts");

  assert.match(server, /providerRequest\.teamVideoMode === "cinematic"/);
  assert.match(server, /providerRequest\.teamVideoVeoConsent/);
  assert.match(server, /videoEngine: providerRequest\.videoEngine/);
  assert.doesNotMatch(
    server,
    /request:\s*\{[\s\S]{0,500}?\.\.\.providerRequest[\s\S]{0,500}?videoEngine: "veo"/,
  );
  assert.match(server, /inspirationImages: \[groupImage\]/);
  assert.match(server, /identityTeamPrecomposed: true/);
  assert.match(server, /identityTeamGoogleEgressConsent: true/);
  assert.match(server, /if \(request\.videoEngine !== "veo"\) throw primaryError/);
  assert.match(server, /request: \{ \.\.\.request, videoEngine: "omni" \}/);
  assert.match(server, /veo_fallback_to_omni/);
  assert.match(server, /video_engine_\$\{failureArgs\.engine\}_failure_\$\{failure\.kind\}/);
  assert.match(server, /redactAiMediaSensitiveText\(failure\.details, 500\)/);
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

  assert.match(veo, /one continuous take/);
  assert.match(veo, /no still\/freeze\/slideshow\/pan-zoom\/reset\/cut/);
  assert.match(veo, /group=\$\{identityTeamMemberCount === 3 \? 3 : 2\} adults/);
  assert.match(veo, /no merge\/omit\/duplicate\/swap/);
  assert.match(veo, /FRAME medium-wide\/full heads/);
  assert.match(veo, /OPENING: requested action moves at frame 1/);
  assert.match(veo, /MIDDLE: new proof step; no opening replay/);
  assert.match(veo, /FINAL: same task reaches requested result/);
  assert.match(
    veo,
    /Continue prior frame:[\s\S]*?no intro\/reset\/recap\/cut/,
  );
  assert.match(server, /jamais un collage, un écran partagé, des cartes portrait ni un diaporama/);
  assert.match(server, /regards, expressions, gestes, pas, interactions et mouvements de caméra naturels/);
});

test("Veo sépare strictement les dialogues natifs et la voix off sans inférer le genre réel", () => {
  const veo = read("lib/aiVideoProviderGoogleVeo.ts");
  const contracts = read("lib/aiMediaGenerationContracts.ts");
  const dialogue = read("lib/aiMediaDialogue.ts");

  assert.match(contracts, /teamVideoSpeechMode: AiMediaTeamVideoSpeechMode/);
  assert.match(contracts, /teamVideoSpeechMode !== "characters"/);
  assert.match(veo, /buildGoogleVideoTeamSpeechDirection/);
  assert.match(veo, /resolveAiMediaDialogueSequence/);
  assert.match(dialogue, /value: scene\.spokenLine \|\| scene\.body \|\| scene\.title \|\| args\.headline/);
  assert.match(dialogue, /usedSignatures: used/);
  assert.match(dialogue, /const line = completeAiMediaSpeechSentence\(selected, args\.language\);\s*used\.add\(aiMediaDialogueSignature\(line\)\)/);
  assert.doesNotMatch(veo, /selectAiMediaDialogueLine|usedDialogue/);
  assert.doesNotMatch(veo, /\["On s’y met \?", "Avec plaisir\."\]/);
  assert.match(veo, /VOICE-OVER: people stay silent with closed mouths/);
  assert.match(veo, /no native speech, lip-sync, vocalisation/);
  assert.match(veo, /DIALOGUE: recurring character lip-syncs once 0\.2–5\.5s/);
  assert.match(veo, /DIALOGUE: Person \$\{firstSpeaker\} left-to-right lip-syncs once/);
  assert.match(veo, /const firstLine = resolveAiMediaDialogueSequence\(\{[\s\S]*?\}\)\[index\]/);
  assert.match(veo, /Then mouth closed\/silent/);
  assert.match(veo, /No repeat\/old line\/narrator\/music\/cloning/);
  assert.match(veo, /stable adult synthetic voice/);
  assert.match(veo, /narrator\/music/);

  const requiredPosition = veo.indexOf("const requiredSections = () => [");
  const subjectPosition = veo.indexOf("`SUBJECT: ${primarySubject}", requiredPosition);
  const userPosition = veo.indexOf("`USER: ${userDirection}", requiredPosition);
  const referencePosition = veo.indexOf("`REFERENCE: ${referenceContract}", requiredPosition);
  const actPosition = veo.indexOf("`ACT: ${promptSnippet(sequenceDirection", requiredPosition);
  const noTextPosition = veo.indexOf('"NO VISUAL TEXT:', requiredPosition);
  const speechPosition = veo.indexOf("speechDirection,", requiredPosition);
  const parametersPosition = veo.indexOf("`PARAMS: ${selectedParameters}", requiredPosition);
  assert.ok(requiredPosition > 0, "contrat critique présent");
  assert.ok(subjectPosition > requiredPosition, "sujet prioritaire présent");
  assert.ok(userPosition > subjectPosition, "consigne après le sujet");
  assert.ok(referencePosition > userPosition, "rôle des références après la consigne");
  assert.ok(actPosition > referencePosition, "action de l’acte après la référence");
  assert.ok(noTextPosition > actPosition, "anti-texte avant le dialogue");
  assert.ok(speechPosition > noTextPosition, "dialogue après l’anti-texte");
  assert.ok(parametersPosition > speechPosition, "réglages après le dialogue");
});

test("le cadrage vidéo protège la tête lors du recadrage carré", () => {
  const veo = read("lib/aiVideoProviderGoogleVeo.ts");
  const composer = read("lib/aiMediaGeneratedVideo.ts");
  const copywriter = read("lib/aiMediaCopywriter.ts");

  assert.match(veo, /buildGoogleVideoFramingDirection/);
  assert.match(veo, /Stable medium-wide shot, never extreme close-up/);
  assert.match(veo, /complete hairline, entire head, chin, shoulders and upper torso/);
  assert.match(veo, /FINAL 1:1 SAFE FRAME/);
  assert.match(composer, /args\.width === args\.height[\s\S]*?\? "0"/);
  assert.match(composer, /crop=\$\{args\.width\}:\$\{args\.height\}:\(in_w-out_w\)\/2:\$\{verticalCropY\}/);
  assert.match(copywriter, /spokenLine/);
  assert.match(copywriter, /spokenReply/);
  assert.match(copywriter, /directement liée au sujet central exact et à l'action demandée/);
});

test("le montage audio préserve le dialogue natif sans jamais recoller un TTS sur les lèvres", () => {
  const composer = read("lib/aiMediaGeneratedVideo.ts");
  const server = read("lib/aiMediaGenerationServer.ts");

  assert.match(composer, /AiMediaNativeAudioMode = "ambience" \| "dialogue" \| "mute"/);
  assert.match(composer, /args\.nativeAudioMode === "dialogue"[\s\S]*?"1\.0"/);
  assert.match(composer, /args\.nativeAudioMode === "dialogue"[\s\S]*?"0\.035"/);
  assert.match(composer, /ai_original_video_dialogue_narration_conflict/);
  assert.match(composer, /ai_original_video_native_dialogue_missing/);
  assert.match(server, /auditAiMediaNativeDialogueWithGoogle/);
  assert.match(server, /native_character_dialogue_qa_rejected_native_audio_muted/);
  assert.match(
    server,
    /native_character_dialogue_qa_unavailable_native_audio_preserved/,
  );
  assert.match(
    server,
    /characterDialogueRequested &&[\s\S]*?!characterDialogueProviderFallback &&[\s\S]*?nativeDialogueQa\?\.status !== "rejected"/,
  );
  assert.doesNotMatch(server, /character_dialogue_fallback_narration/);
  assert.doesNotMatch(server, /character_dialogue_audio_fallback/);
  assert.doesNotMatch(server, /identity_team_character_dialogue_fallback_voiceover/);
  assert.doesNotMatch(server, /nativeDialogueQa\.status !== "passed"/);
  assert.match(server, /minimalNativeDialogueSucceeded/);
  assert.match(server, /video_composition_minimal_native_dialogue/);
  assert.match(server, /identity_team_character_dialogue_unavailable_silent_motion/);
  assert.match(
    server,
    /nativeAudioMode: characterDialogueRequested[\s\S]*?\? "mute"/,
  );
  assert.match(server, /video_composition_silent_fallback/);
  assert.match(server, /nativeAudioMode: "mute"/);
  assert.match(server, /native_character_dialogue_preserved/);
  assert.match(server, /quality_assurance/);
  assert.match(server, /status: "compositor_validated"/);
  assert.match(server, /checks: \["duration", "frame_layout", "audio_policy"\] as const/);
  assert.match(server, /caption_layout: AI_MEDIA_VIDEO_TEXT_LAYOUT/);
  assert.match(server, /inrcy\/video-composer-v6-full-frame-overlay/);
  assert.doesNotMatch(server, /caption-band|videoCaptionLayout/);
  assert.doesNotMatch(composer, /caption-band|captionLayout|pad=.*020617/);
  assert.doesNotMatch(server, /await measure\("video_local_quality_check"/);
});
