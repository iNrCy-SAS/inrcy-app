import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
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
import {
  buildAiMediaNarrationFallback,
  getAiMediaLanguageCopy,
} from "../../lib/aiMediaLanguage.ts";

const ROOT = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(ROOT, relativePath), "utf8");

test("le contrat réduit les options au média demandé", () => {
  const inspirationData = Buffer.alloc(96, 7).toString("base64");
  const image = normalizeAiMediaGenerationRequest({
    requestId: "media-request-0001",
    kind: "image",
    subjectSource: "publication",
    idea: "Présenter le nouveau menu de printemps",
    withText: true,
    textKeywords: [
      " printemps ",
      "Nouveauté",
      "nouveauté",
      "menu",
      "local",
      "gourmand",
      "réservation",
      "en trop",
    ],
    withMusic: true,
    withNarration: true,
    source: "booster",
  });
  assert.equal(image.withText, true);
  assert.deepEqual(image.textKeywords, [
    "printemps",
    "Nouveauté",
    "menu",
    "local",
    "gourmand",
    "réservation",
  ]);
  assert.equal(image.withMusic, false);
  assert.equal(image.withNarration, false);
  assert.equal(image.narrationVoice, null);
  assert.equal(image.format, "square");
  assert.equal(image.typology, "service");
  assert.equal(image.visualStyle, "brand");
  assert.equal(image.imageStyle, "photo");
  assert.equal(image.shotType, "auto");
  assert.equal(image.peopleMode, "auto");
  assert.equal(image.creativity, "faithful");
  assert.equal(image.useBrandColors, true);
  assert.equal(image.logoMode, "discreet");
  assert.equal(image.videoEngine, null);
  assert.equal(image.aiInstruction, "");
  assert.equal(image.videoCharacterMode, "auto");
  assert.equal(image.identityConsent, false);
  assert.equal(image.teamVideoMode, "montage");
  assert.equal(image.teamVideoSpeechMode, "voiceover");
  assert.equal(image.teamVideoVeoConsent, false);
  assert.deepEqual(image.inspirationImages, []);

  const video = normalizeAiMediaGenerationRequest({
    requestId: "media-request-0002",
    kind: "video",
    subjectSource: "custom",
    idea: "Montrer le savoir-faire de l'atelier",
    withText: true,
    withMusic: true,
    withNarration: true,
    narrationVoice: "male",
    format: "story",
    typology: "showcase",
    visualStyle: "dynamic",
    imageStyle: "three_d",
    shotType: "wide",
    peopleMode: "team",
    creativity: "bold",
    useBrandColors: false,
    logoMode: "visible",
    durationSeconds: 24,
    identityConsent: true,
    inspirationImages: [
      { mimeType: "image/jpeg", data: inspirationData },
      { mimeType: "image/png", data: inspirationData },
      { mimeType: "image/webp", data: inspirationData },
    ],
    source: "studio",
  });
  assert.equal(video.withText, true);
  assert.equal(video.withMusic, true);
  assert.equal(video.withNarration, true);
  assert.equal(video.narrationVoice, "male");
  assert.equal(video.format, "story");
  assert.equal(video.typology, "showcase");
  assert.equal(video.visualStyle, "dynamic");
  assert.equal(video.imageStyle, "three_d");
  assert.equal(video.shotType, "wide");
  assert.equal(video.peopleMode, "team");
  assert.equal(video.creativity, "bold");
  assert.equal(video.useBrandColors, false);
  assert.equal(video.logoMode, "visible");
  assert.equal(video.videoEngine, "omni");
  assert.equal(video.videoCharacterMode, "auto");
  assert.equal(video.identityConsent, true);
  assert.equal(video.teamVideoMode, "montage");
  assert.equal(video.teamVideoSpeechMode, "voiceover");
  assert.equal(video.teamVideoVeoConsent, false);
  assert.equal(video.durationSeconds, 24);
  assert.equal(video.inspirationImages.length, 3);
  assert.deepEqual(
    video.inspirationImages.map((item) => item.mimeType),
    ["image/jpeg", "image/png", "image/webp"],
  );
  const veoVideo = normalizeAiMediaGenerationRequest({
    requestId: "media-request-veo-fast",
    kind: "video",
    subjectSource: "profile",
    videoEngine: "veo",
    source: "studio",
  });
  assert.equal(veoVideo.videoEngine, "veo");
  assert.equal(veoVideo.narrationVoice, null);
  const legacyVoiceVideo = normalizeAiMediaGenerationRequest({
    requestId: "media-request-default-voice",
    kind: "video",
    subjectSource: "profile",
    withNarration: true,
    source: "studio",
  });
  assert.equal(legacyVoiceVideo.narrationVoice, "female");
  assert.throws(
    () =>
      normalizeAiMediaGenerationRequest({
        requestId: "media-request-bad-voice",
        kind: "video",
        subjectSource: "profile",
        withNarration: true,
        narrationVoice: "robot",
        source: "studio",
      }),
    AiMediaRequestValidationError,
  );
  assert.throws(
    () =>
      normalizeAiMediaGenerationRequest({
        requestId: "media-request-bad-engine",
        kind: "video",
        subjectSource: "profile",
        videoEngine: "standard",
        source: "studio",
      }),
    AiMediaRequestValidationError,
  );
  assert.throws(
    () =>
      normalizeAiMediaGenerationRequest({
        requestId: "media-request-image-ref",
        kind: "image",
        subjectSource: "profile",
        inspirationImages: [{ mimeType: "image/jpeg", data: inspirationData }],
        source: "studio",
      }),
    AiMediaRequestValidationError,
  );
  assert.throws(
    () =>
      normalizeAiMediaGenerationRequest({
        requestId: "media-request-four-refs",
        kind: "video",
        subjectSource: "profile",
        inspirationImages: Array.from({ length: 4 }, () => ({
          mimeType: "image/jpeg",
          data: inspirationData,
        })),
        source: "studio",
      }),
    AiMediaRequestValidationError,
  );
  assert.throws(
    () =>
      normalizeAiMediaGenerationRequest({
        requestId: "media-request-0060",
        kind: "video",
        subjectSource: "profile",
        durationSeconds: 60,
        source: "studio",
      }),
    AiMediaRequestValidationError
  );

  const profile = normalizeAiMediaGenerationRequest({
    requestId: "media-request-0003",
    kind: "image",
    subjectSource: "profile",
    idea: "Ce texte doit être ignoré au profit du profil",
    withText: false,
    textKeywords: ["ne doit pas rester"],
    source: "studio",
  });
  assert.equal(profile.subjectSource, "profile");
  assert.equal(profile.idea, "");
  assert.deepEqual(profile.textKeywords, []);
  assert.throws(
    () =>
      normalizeAiMediaGenerationRequest({
        kind: "image",
        subjectSource: "custom",
        idea: "x",
      }),
    AiMediaRequestValidationError
  );
});

test("le mode cinématique anime toute identité référencée et protège l’egress d’équipe", () => {
  const inspirationData = Buffer.alloc(96, 17).toString("base64");
  const references = [
    { mimeType: "image/jpeg", data: inspirationData },
    { mimeType: "image/png", data: inspirationData },
  ];

  const withoutGoogleConsent = normalizeAiMediaGenerationRequest({
    requestId: "media-team-cinematic-without-google-consent",
    kind: "video",
    subjectSource: "profile",
    identityMode: "reference_team",
    identityConsent: true,
    teamVideoMode: "cinematic",
    inspirationImages: references,
    source: "studio",
  });
  assert.equal(withoutGoogleConsent.teamVideoMode, "cinematic");
  assert.equal(withoutGoogleConsent.teamVideoSpeechMode, "voiceover");
  assert.equal(withoutGoogleConsent.teamVideoVeoConsent, false);

  const cinematic = normalizeAiMediaGenerationRequest({
    requestId: "media-team-cinematic-with-google-consent",
    kind: "video",
    subjectSource: "profile",
    identityMode: "reference_team",
    identityConsent: true,
    teamVideoMode: "cinematic",
    teamVideoSpeechMode: "characters",
    teamVideoVeoConsent: true,
    withNarration: true,
    narrationVoice: "male",
    inspirationImages: references,
    source: "studio",
  });
  assert.equal(cinematic.teamVideoMode, "cinematic");
  assert.equal(cinematic.teamVideoSpeechMode, "characters");
  assert.equal(cinematic.teamVideoVeoConsent, true);
  assert.equal(cinematic.withNarration, false);
  assert.equal(cinematic.narrationVoice, null);

  const cinematicVoiceover = normalizeAiMediaGenerationRequest({
    requestId: "media-team-cinematic-voiceover",
    kind: "video",
    subjectSource: "profile",
    identityMode: "reference_team",
    identityConsent: true,
    teamVideoMode: "cinematic",
    teamVideoSpeechMode: "voiceover",
    teamVideoVeoConsent: true,
    withNarration: true,
    narrationVoice: "male",
    inspirationImages: references,
    source: "studio",
  });
  assert.equal(cinematicVoiceover.teamVideoSpeechMode, "voiceover");
  assert.equal(cinematicVoiceover.withNarration, true);
  assert.equal(cinematicVoiceover.narrationVoice, "male");

  const image = normalizeAiMediaGenerationRequest({
    requestId: "media-team-image-cinematic-ignored",
    kind: "image",
    subjectSource: "profile",
    identityMode: "reference_team",
    identityConsent: true,
    teamVideoMode: "cinematic",
    teamVideoSpeechMode: "characters",
    teamVideoVeoConsent: true,
    inspirationImages: references,
    source: "studio",
  });
  assert.equal(image.teamVideoMode, "montage");
  assert.equal(image.teamVideoSpeechMode, "voiceover");
  assert.equal(image.teamVideoVeoConsent, false);

  const professionalCinematic = normalizeAiMediaGenerationRequest({
    requestId: "media-professional-cinematic",
    kind: "video",
    subjectSource: "profile",
    peopleMode: "solo",
    identityMode: "professional",
    identityConsent: true,
    teamVideoMode: "cinematic",
    teamVideoSpeechMode: "characters",
    teamVideoVeoConsent: true,
    withNarration: true,
    inspirationImages: [references[0]],
    source: "studio",
  });
  assert.equal(professionalCinematic.teamVideoMode, "cinematic");
  assert.equal(professionalCinematic.teamVideoSpeechMode, "characters");
  assert.equal(professionalCinematic.teamVideoVeoConsent, false);
  assert.equal(professionalCinematic.withNarration, false);

  const nonTeamVideo = normalizeAiMediaGenerationRequest({
    requestId: "media-non-team-cinematic-ignored",
    kind: "video",
    subjectSource: "profile",
    teamVideoMode: "cinematic",
    teamVideoSpeechMode: "characters",
    teamVideoVeoConsent: true,
    source: "studio",
  });
  assert.equal(nonTeamVideo.teamVideoMode, "montage");
  assert.equal(nonTeamVideo.teamVideoSpeechMode, "voiceover");
  assert.equal(nonTeamVideo.teamVideoVeoConsent, false);

  const montage = normalizeAiMediaGenerationRequest({
    requestId: "media-team-montage-characters-ignored",
    kind: "video",
    subjectSource: "profile",
    identityMode: "reference_team",
    identityConsent: true,
    teamVideoMode: "montage",
    teamVideoSpeechMode: "characters",
    inspirationImages: references,
    source: "studio",
  });
  assert.equal(montage.teamVideoSpeechMode, "voiceover");

  assert.throws(
    () =>
      normalizeAiMediaGenerationRequest({
        requestId: "media-team-invalid-animation-mode",
        kind: "video",
        subjectSource: "profile",
        teamVideoMode: "faceswap",
        source: "studio",
      }),
    AiMediaRequestValidationError,
  );
  assert.throws(
    () =>
      normalizeAiMediaGenerationRequest({
        requestId: "media-team-invalid-speech-mode",
        kind: "video",
        subjectSource: "profile",
        identityMode: "reference_team",
        identityConsent: true,
        teamVideoMode: "cinematic",
        teamVideoSpeechMode: "voice-clone",
        inspirationImages: references,
        source: "studio",
      }),
    AiMediaRequestValidationError,
  );
});

test("la consigne ponctuelle et l'identité image/vidéo sont normalisées sans casser les anciens appels", () => {
  const inspirationData = Buffer.alloc(96, 9).toString("base64");
  const normalizedInstruction = normalizeAiMediaGenerationRequest({
    requestId: "media-instruction-0001",
    kind: "image",
    subjectSource: "profile",
    aiInstruction: `  Plus\u0001    lumineux\r\n\r\n\r\nsans texte ${"x".repeat(700)}`,
    source: "studio",
  });
  assert.equal(normalizedInstruction.aiInstruction.includes("\u0001"), false);
  assert.equal(normalizedInstruction.aiInstruction.includes("  "), false);
  assert.equal(normalizedInstruction.aiInstruction.length, 600);

  assert.throws(
    () => normalizeAiMediaGenerationRequest({
      requestId: "media-professional-no-photo",
      kind: "video",
      subjectSource: "profile",
      peopleMode: "solo",
      videoCharacterMode: "professional",
      source: "studio",
    }),
    /photo du professionnel/,
  );
  assert.throws(
    () => normalizeAiMediaGenerationRequest({
      requestId: "media-avatar-no-reference",
      kind: "video",
      subjectSource: "profile",
      peopleMode: "solo",
      videoCharacterMode: "brand_avatar",
      source: "studio",
    }),
    /dessin d.avatar|photo autorisée/,
  );
  assert.throws(
    () => normalizeAiMediaGenerationRequest({
      requestId: "media-professional-no-consent",
      kind: "video",
      subjectSource: "profile",
      peopleMode: "solo",
      videoCharacterMode: "professional",
      inspirationImages: [{ mimeType: "image/jpeg", data: inspirationData }],
      source: "studio",
    }),
    /autorisation/,
  );

  const professional = normalizeAiMediaGenerationRequest({
    requestId: "media-professional-consent",
    kind: "video",
    subjectSource: "profile",
    peopleMode: "solo",
    videoCharacterMode: "professional",
    identityConsent: true,
    inspirationImages: [{ mimeType: "image/jpeg", data: inspirationData }],
    source: "studio",
  });
  assert.equal(professional.videoCharacterMode, "professional");
  assert.equal(professional.identityMode, "professional");
  assert.equal(professional.identityConsent, true);
  assert.equal(professional.inspirationImages.length, 1);

  const noPeople = normalizeAiMediaGenerationRequest({
    requestId: "media-no-people-identity",
    kind: "video",
    subjectSource: "profile",
    peopleMode: "none",
    videoCharacterMode: "professional",
    identityConsent: true,
    inspirationImages: [{ mimeType: "image/jpeg", data: inspirationData }],
    source: "studio",
  });
  assert.equal(noPeople.videoCharacterMode, "auto");
  assert.equal(noPeople.identityMode, "auto");
  assert.equal(noPeople.identityConsent, false);
  assert.deepEqual(noPeople.inspirationImages, []);

  assert.throws(
    () => normalizeAiMediaGenerationRequest({
      requestId: "image-professional-no-consent",
      kind: "image",
      subjectSource: "profile",
      peopleMode: "solo",
      identityMode: "professional",
      inspirationImages: [{ mimeType: "image/jpeg", data: inspirationData }],
      source: "studio",
    }),
    /autorisation/,
  );
  const professionalImage = normalizeAiMediaGenerationRequest({
    requestId: "image-professional-consent",
    kind: "image",
    subjectSource: "profile",
    peopleMode: "solo",
    identityMode: "professional",
    identityConsent: true,
    inspirationImages: [{ mimeType: "image/jpeg", data: inspirationData }],
    source: "studio",
  });
  assert.equal(professionalImage.identityMode, "professional");
  assert.equal(professionalImage.videoCharacterMode, "professional");
  assert.equal(professionalImage.identityConsent, true);
  assert.equal(professionalImage.inspirationImages.length, 1);
});

test("les dix bandes-son originales sont déterministes et durent exactement huit secondes", () => {
  const manifest = JSON.parse(
    read("assets/media-generation/soundtracks/manifest.json")
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
    selectAiMediaSoundtrack("atelier artisan savoir-faire").id
  );

  for (const track of manifest.tracks) {
    const buffer = readFileSync(
      path.join(ROOT, "assets/media-generation/soundtracks", track.fileName)
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
      createHash("sha256").update(buffer).digest("hex")
    );
  }
});

test("le prompt donne à GPT Image le sujet, l’ADN, l’identité autorisée et le logo officiel", () => {
  const source = read("lib/aiMediaGenerationPrompt.ts");
  const dna = read("lib/aiMediaBusinessDna.ts");
  assert.match(
    source,
    /AI_MEDIA_PROMPT_VERSION = "inrcy-media-v15-contextual-speech-framing"/,
  );
  assert.match(source, /buildAiMediaBusinessDnaPayload/);
  assert.match(source, /ADN PROFESSIONNEL AUTORISÉ/);
  assert.match(source, /Palette réelle extraite du logo/);
  assert.match(source, /référence(?:s)? d’identité/);
  assert.match(source, /logo officiel/);
  assert.match(source, /Aucune photo de Médiathèque/);
  assert.match(
    source,
    /imaginer une scène originale strictement adaptée au sujet actuel/
  );
  assert.match(
    source,
    /Respecter fidèlement sa forme, ses proportions, ses couleurs et son orthographe/
  );
  assert.match(source, /Accroche originale sélectionnée par iNrCy/);
  assert.match(source, /Interdiction de recopier cette phrase/);
  assert.match(source, /request\.textKeywords/);
  assert.match(source, /HISTORIQUE RÉCENT À NE PAS COPIER/);
  assert.match(dna, /interventionZones/);
  assert.match(dna, /customerTypologies/);
  assert.match(dna, /openingHours/);
  assert.match(dna, /preferredVocabulary/);
  assert.match(dna, /technicalityLevel/);
  assert.match(dna, /humorLevel/);
  assert.doesNotMatch(dna, /business\.phone|business\.email/);
  assert.match(source, /Ne jamais inventer de prix, promotion, certification/);
  assert.match(source, /DIRECTION ARTISTIQUE DÉTAILLÉE/);
  assert.match(source, /CADRAGE ET ZONES SÛRES/);
  assert.match(source, /Palette créative libre/);
  assert.match(
    source,
    /Ne jamais couper un mot, un visage, le logo ou le sujet principal/
  );
  assert.doesNotMatch(source, /exactement pensée pour 8 secondes/);
  assert.match(source, /AI_MEDIA_FORMAT_SPECS/);
});

test("les médias IA verrouillent les textes visibles et la narration dans la langue du profil", () => {
  const languages = ["fr", "en", "es", "it", "de", "nl", "pt", "th", "zh"] as const;
  for (const language of languages) {
    const copy = getAiMediaLanguageCopy(language);
    assert.ok(copy.headlines.service.length >= 3, `${language}: accroche de secours`);
    assert.ok(copy.ctas.appeler.length >= 3, `${language}: CTA Appeler`);
    assert.ok(copy.supportingTitle.length >= 3, `${language}: scène de secours`);
    const narration = buildAiMediaNarrationFallback({
      language,
      company: "iNrCy",
      location: "Paris",
    });
    assert.match(narration, /iNrCy/);
    assert.match(narration, /Paris/);
  }

  assert.equal(getAiMediaLanguageCopy("en").ctas.appeler, "Call us");
  assert.equal(getAiMediaLanguageCopy("es").ctas.devis, "Solicite su presupuesto");
  assert.equal(getAiMediaLanguageCopy("zh").headlines.recruitment, "加入我们的团队");

  const prompt = read("lib/aiMediaGenerationPrompt.ts");
  const copywriter = read("lib/aiMediaCopywriter.ts");
  const creativePlan = read("lib/aiMediaCreativePlan.ts");
  const narration = read("lib/aiMediaNarration.ts");
  const server = read("lib/aiMediaGenerationServer.ts");

  assert.match(prompt, /LANGUE DU TEXTE VISIBLE — RÈGLE ABSOLUE/);
  assert.match(prompt, /getAiLanguageLabel\(profile\)/);
  assert.match(copywriter, /buildAiLanguageInstruction\(args\.profile\)/);
  assert.match(copywriter, /hasAiLanguageMismatch\(language, visibleCopy\)/);
  assert.match(copywriter, /langue_cible: getAiLanguageLabel\(args\.profile\)/);
  assert.match(creativePlan, /if \(language !== "fr"\)/);
  assert.match(creativePlan, /getAiMediaLanguageCopy\(language\)/);
  assert.match(narration, /buildAiMediaNarrationFallback/);
  assert.match(narration, /speechUnitCount/);
  assert.match(narration, /hasAiLanguageMismatch\(language, value\)/);
  assert.match(
    server,
    /const creativePlanTask =\s*providerRequest\.withText \|\|[\s\S]*?teamVideoSpeechMode === "characters"/,
  );
});

test("chaque critère créatif participe réellement au brief envoyé au moteur", () => {
  const source = read("lib/aiMediaGenerationPrompt.ts");
  for (const expression of [
    "VISUAL_DIRECTIONS[request.visualStyle]",
    "IMAGE_DIRECTIONS[request.imageStyle]",
    "SHOT_DIRECTIONS[request.shotType]",
    "PEOPLE_DIRECTIONS[request.peopleMode]",
    "CREATIVE_DIRECTIONS[request.creativity]",
  ]) {
    assert.ok(
      source.includes(expression),
      `${expression} doit construire le brief`
    );
  }
  assert.match(source, /request\.useBrandColors && palette\.length/);
  assert.match(source, /request\.logoMode === "visible"/);
  assert.match(source, /safeCompositionGuide\(request\)/);
  const creativePlan = read("lib/aiMediaCreativePlan.ts");
  assert.match(
    creativePlan,
    /request\.withText \? request\.textKeywords : \[\]/
  );
  assert.doesNotMatch(creativePlan, /idea: request\.idea/);
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
  assert.match(route, /isAdminUserForAi\(/);
  assert.match(route, /AI_MEDIA_ADMIN_LIMIT_OVERRIDE/);
  assert.match(route, /limitOverride: adminUnlimited/);
  assert.match(route, /\(normalizedRequest\.durationSeconds \|\| 16\) > videoMaxDurationSeconds/);
  assert.match(route, /AI_MEDIA_VIDEO_LONG_FORM_PREMIUM_REQUIRED/);
  assert.match(route, /getAiMediaVideoEntitlement/);
  assert.match(route, /videoMaxDurationSeconds/);
  assert.match(route, /presentAiMediaQuota\([\s\S]*?videoMaxDurationSeconds/);
  assert.match(quotaRoute, /isAdminUserForAi\(current\.supabase, authUserId\)/);
  assert.match(quotaRoute, /getAiMediaVideoEntitlement/);
  assert.match(quotaRoute, /videoEntitlement\.maxDurationSeconds/);
});

test("un média persisté n'est jamais libéré du quota", () => {
  const route = read("app/api/media-generation/generate/route.ts");
  assert.match(route, /getPersistedGeneratedAiMediaId/);
  assert.match(route, /recovered_after_persistence_error/);
  assert.match(route, /quotaReserved && !quotaCompleted && !mediaPersisted/);
  assert.match(route, /AI_MEDIA_FINALIZATION_PENDING/);
});

test("image Gateway, vidéo Omni/Veo et médiathèque respectent le contrat universel", () => {
  const gateway = read("lib/aiMediaGateway.ts");
  const normalizer = read("lib/aiMediaNormalizer.ts");
  const registry = read("lib/aiGeneratedMediaRegistry.ts");
  const server = read("lib/aiMediaGenerationServer.ts");
  const dnaHelper = read("lib/aiMediaBusinessDna.ts");
  const brandKit = read("lib/aiMediaBrandKit.ts");
  const renderer = read("lib/aiMediaBrandRenderer.ts");
  const provider = read("lib/aiVideoProvider.ts");
  const omni = read("lib/aiVideoProviderGoogleOmni.ts");
  const veo = read("lib/aiVideoProviderGoogleVeo.ts");
  const timeline = read("lib/aiMediaVideoTimeline.ts");
  const copywriter = read("lib/aiMediaCopywriter.ts");
  const composer = read("lib/aiMediaGeneratedVideo.ts");
  const narration = read("lib/aiMediaNarration.ts");
  const narrationAudio = read("lib/aiMediaNarrationAudio.ts");
  const quotaPresentation = read("lib/aiMediaQuotaPresentation.ts");
  const nextConfig = read("next.config.ts");
  const vercelConfig = read("vercel.json");

  assert.match(gateway, /openai\/gpt-image-2/);
  assert.match(gateway, /AI_GATEWAY_IMAGE_MODEL/);
  assert.doesNotMatch(gateway, /AI_GATEWAY_VIDEO_MODEL|storyboard-v1/);
  assert.match(gateway, /size: args\.size \|\| "1024x1024"/);
  assert.match(gateway, /AbortSignal\.any\(\[args\.signal, AbortSignal\.timeout\(timeoutMs\)\]\)/);
  assert.match(gateway, /if \(!args\.signal\?\.aborted\)/);
  assert.match(gateway, /officialLogo\?: Buffer \| null/);
  assert.match(gateway, /identityReferences\?: readonly Buffer\[\]/);
  assert.match(gateway, /\.\.\.providedReferences/);
  assert.match(gateway, /images: referenceImages/);
  assert.match(gateway, /referenceImagesCount/);
  assert.match(gateway, /identityReferenceImagesCount/);
  assert.match(gateway, /officialLogoIncluded/);
  assert.doesNotMatch(gateway, /libraryImages|pro_media_library/);
  assert.doesNotMatch(gateway, /featureKind\?: AiMediaKind/);
  assert.doesNotMatch(gateway, /experimental_generateVideo/);
  assert.doesNotMatch(gateway, /flux-3-video/);
  assert.match(gateway, /bufferFromUint8ArrayView\(image\.uint8Array\)/);
  assert.doesNotMatch(gateway, /Buffer\.from\(image\.uint8Array\)/);
  assert.match(normalizer, /durationSeconds: 8 \| 16 \| 24/);
  assert.match(normalizer, /options: \{ width\?: number; height\?: number \}/);
  assert.match(normalizer, /position: "centre"/);
  assert.equal(
    existsSync(path.join(ROOT, "lib/aiMediaStoryboardVideo.ts")),
    false
  );
  assert.match(provider, /configured === "auto"/);
  assert.match(provider, /args\?\.request\.videoEngine === "veo"/);
  assert.match(provider, /googleOmniVideoProvider/);
  assert.match(provider, /googleVeoVideoProvider/);
  assert.match(provider, /generateOriginalAiVideoClips/);
  assert.equal(
    existsSync(path.join(ROOT, "lib/aiVideoProviderFalOvi.ts")),
    false
  );
  assert.match(omni, /gemini-omni-1\.1-flash/);
  assert.match(omni, /ai\.interactions\.create/);
  assert.match(omni, /response_format:\s*\{[\s\S]*?type: "video"/);
  assert.match(omni, /resolution: "720p"/);
  assert.match(omni, /duration: `\$\{args\.durationSeconds\}s`/);
  assert.match(omni, /delivery: "uri"/);
  assert.doesNotMatch(omni, /delivery: "inline"/);
  assert.match(omni, /ai\.files\.get/);
  assert.match(omni, /state === "ACTIVE"/);
  assert.match(omni, /AI_MEDIA_OMNI_FILE_POLL_MS/);
  assert.match(omni, /background: false/);
  assert.match(omni, /store: true/);
  assert.match(omni, /stream: false/);
  assert.match(omni, /DEFAULT_CONCURRENCY = 3/);
  assert.match(omni, /AI_MEDIA_OMNI_CONCURRENCY/);
  assert.match(omni, /AI_MEDIA_OMNI_FALLBACK_TO_VEO/);
  assert.match(omni, /omni_scene_fallback_to_veo/);
  assert.match(omni, /ai_video_omni_clip_billable_failure/);
  assert.match(omni, /details\.includes\("ai_video_omni_clip_billable_failure"\)/);
  assert.match(omni, /googleVeoVideoProvider\.generate/);
  assert.match(omni, /actualCostMicroUsd \+ fallbackCostMicroUsd/);
  assert.match(omni, /reserveAiGatewayAccountAttempt/);
  assert.match(omni, /commitAiGatewayAccountAttempt/);
  assert.match(omni, /rollbackAiGatewayAccountAttempt/);
  assert.match(omni, /buildGoogleVideoScenePrompt/);
  assert.match(omni, /buildGoogleVideoSafetyFallbackPrompt/);
  assert.match(server, /videoEngineResult/);
  assert.match(server, /omni_veo_fallback/);
  assert.match(veo, /DEFAULT_VEO_MODEL/);
  assert.match(veo, /AI_MEDIA_VEO_FALLBACK_MODELS/);
  assert.match(veo, /process\.env\.GEMINI_API_KEY/);
  assert.match(veo, /new GoogleGenAI/);
  assert.match(veo, /generateVideos/);
  assert.match(veo, /source:\s*\{[\s\S]*?prompt: args\.prompt/);
  assert.doesNotMatch(veo, /\bseed:/);
  assert.doesNotMatch(veo, /stableSeed/);
  assert.doesNotMatch(veo, /generateAudio/);
  assert.doesNotMatch(veo, /enhancePrompt/);
  assert.doesNotMatch(veo, /negativePrompt/);
  assert.doesNotMatch(veo, /numberOfVideos/);
  assert.doesNotMatch(veo, /personGeneration\s*:/);
  assert.match(veo, /classifyVeoFailure/);
  assert.match(veo, /nextVeoInspirationMode/);
  assert.match(veo, /Every visible person must be unmistakably adult/);
  assert.match(veo, /This business serves a family audience/);
  assert.match(veo, /buildGoogleVideoSafetyFallbackPrompt/);
  assert.match(veo, /canRetryAfterSafety/);
  assert.match(veo, /PROFESSIONAL SAFETY FRAMING/);
  assert.match(veo, /Professional wellness service only/);
  assert.match(veo, /modestly covered by towels or sheets/);
  assert.match(veo, /no intimate body area/);
  assert.match(veo, /referenceImages:/);
  assert.match(veo, /VideoGenerationReferenceType\.ASSET/);
  assert.match(veo, /imageBytes: sourceImage\.data/);
  assert.doesNotMatch(veo, /resolution: "720p"/);
  assert.match(veo, /getVideosOperation/);
  assert.match(veo, /raiMediaFilteredReasons/);
  assert.match(veo, /safetyFilteredError/);
  assert.match(veo, /durationSeconds: args\.durationSeconds/);
  assert.match(veo, /aspectRatio: args\.aspectRatio/);
  assert.match(veo, /DEFAULT_TIMEOUT_MS = 420_000/);
  assert.match(veo, /DEFAULT_SUBMIT_ATTEMPTS = 4/);
  assert.match(veo, /DEFAULT_DOWNLOAD_ATTEMPTS = 3/);
  assert.match(veo, /MAX_VEO_PROMPT_CHARS = 1_400/);
  assert.match(veo, /\.join\(" "\),\s*MAX_VEO_PROMPT_CHARS,?\s*\)/);
  assert.match(veo, /DEFAULT_CONCURRENCY = 2/);
  assert.match(veo, /retryDelayMs/);
  assert.match(veo, /Math\.min\(configuredConcurrency, durations\.length\)/);
  assert.match(veo, /actualCostMicroUsd \+=/);
  assert.match(veo, /costMicroUsdPerSecond\(usedModel\)/);
  assert.match(veo, /Math\.max\([\s\S]*costMicroUsdPerSecond/);
  for (const criterion of [
    "request.visualStyle",
    "request.imageStyle",
    "request.shotType",
    "request.peopleMode",
    "request.creativity",
  ]) {
    assert.ok(
      veo.includes(criterion),
      `${criterion} doit guider chaque plan Veo`
    );
  }
  assert.match(veo, /PRIMARY SUBJECT — visually unmistakable/);
  assert.match(
    veo,
    /Keep every named trade, product, animal, object, action or place central/
  );
  assert.match(veo, /smartphone, tablet or laptop in the foreground/);
  assert.match(veo, /masonry or construction site/);
  assert.match(veo, /real horses as central subjects/);
  assert.match(veo, /function subjectDigitalDirection/);
  assert.match(veo, /digitalDirection \? `\$\{digitalDirection\}\.\` : ""/);
  assert.doesNotMatch(veo, /watermarks, interfaces, posters/);
  assert.match(timeline, /8: Object\.freeze\(\[8\]/);
  assert.match(timeline, /16: Object\.freeze\(\[8, 8\]/);
  assert.match(timeline, /24: Object\.freeze\(\[8, 8, 8\]/);
  assert.match(copywriter, /ne les additionne jamais/);
  assert.match(copywriter, /une accroche publicitaire courte, naturelle/i);
  assert.match(copywriter, /mots_a_evoquer: args\.request\.textKeywords/);
  assert.match(copywriter, /adn_de_l_entreprise: buildAiMediaBusinessDnaPayload/);
  assert.match(copywriter, /applyLocalizedCopy/);
  assert.doesNotMatch(copywriter, /\.join\(" \+ "\)/);
  assert.match(composer, /composeOriginalAiVideo/);
  assert.match(composer, /libx264/);
  assert.match(composer, /h264Video/);
  assert.match(composer, /yuv420Video/);
  assert.match(composer, /compatibleAudio/);
  assert.match(
    composer,
    /MAX_GOOGLE_BUSINESS_VIDEO_BYTES = 74 \* 1024 \* 1024/
  );
  assert.match(composer, /durationSeconds: AiMediaVideoDuration/);
  assert.match(composer, /narration\?: GeneratedAiNarrationAudio/);
  assert.match(
    composer,
    /const soundtrackVolume =[\s\S]*?args\.nativeAudioMode === "dialogue"[\s\S]*?\? "0\.035"/,
  );
  assert.match(
    composer,
    /const soundtrackVolume =[\s\S]*?args\.narrationInputIndex === null[\s\S]*?\? "0\.16"[\s\S]*?: "0\.08"/,
  );
  assert.match(composer, /\[voice\]/);
  assert.match(narration, /idee_du_professionnel/);
  assert.match(narration, /adn_de_l_entreprise: buildAiMediaBusinessDnaPayload/);
  assert.match(server, /creativeBrief: buildAiMediaVideoDnaBrief\(profile\)/);
  assert.match(narration, /N'invente aucun prix, résultat, certification/);
  assert.match(narration, /WORD_TARGETS/);
  assert.match(narrationAudio, /gemini-3\.1-flash-tts-preview/);
  assert.match(narrationAudio, /TRANSCRIPTION À LIRE MOT POUR MOT/);
  assert.match(narrationAudio, /response_format:[\s\S]*?type: "audio"/);
  assert.match(narrationAudio, /pcm16ToWav/);
  assert.match(brandKit, /LOGO_BUCKET/);
  assert.doesNotMatch(brandKit, /pro_media_library|libraryImages/);
  assert.match(brandKit, /extractPalette/);
  assert.match(brandKit, /\.png\(\{ compressionLevel: 9/);
  assert.doesNotMatch(renderer, /renderBrandedAiImage|imageCopySvg/);
  assert.match(renderer, /renderAiMediaVideoOverlay/);
  assert.match(renderer, /args\.logoMode === "none"/);
  assert.match(renderer, /fontfile: OVERLAY_FONT_FILE/);
  assert.match(renderer, /Geist-Regular\.ttf/);
  assert.match(renderer, /safeOverlayText/);
  assert.doesNotMatch(renderer, /font-family="Arial, Helvetica, sans-serif"/);
  assert.match(nextConfig, /Geist-Regular\.ttf/);
  assert.match(
    renderer,
    /\.trim\(\{ background: "#ffffff", threshold: 10 \}\)/
  );
  assert.doesNotMatch(renderer, /renderAiMediaVideoScenes/);

  assert.match(registry, /const BUCKET = "inrcy-pro-media"/);
  assert.match(registry, /users\/\$\{safePathSegment\(args\.accountId/);
  assert.match(registry, /ai-generated\/\$\{args\.kind\}/);
  assert.match(registry, /`ai-media:\$\{jobId\}`/);
  assert.match(registry, /upload_protocol: "server_legacy"/);
  assert.match(registry, /active_account_id: args\.accountId/);
  assert.match(server, /prompt_sha256: promptHash/);
  assert.match(server, /generationContext\.recentPublications/);
  assert.doesNotMatch(
    server,
    /brandKit\.libraryImages|composeAiMediaStoryboardVideo/
  );
  assert.match(
    server,
    /const officialLogo = providerRequest\.logoMode === "none" \? null : brandKit\.logo/
  );
  assert.match(server, /generateAiMediaImage\(\{[\s\S]*?identityReferences: preparedIdentityReferences\.buffers,[\s\S]*?officialLogo,/);
  assert.match(server, /const effectiveColors = providerRequest\.useBrandColors/);
  assert.match(server, /authorized_identity_and_official_logo/);
  assert.doesNotMatch(server, /inspiration_image_sha256/);
  assert.match(server, /normalizeGeneratedAiImage\(imageBuffer/);
  assert.match(server, /generateOriginalAiVideoClips/);
  assert.match(
    server,
    /creativeBrief: buildAiMediaVideoDnaBrief\(profile\)/
  );
  assert.match(dnaHelper, /\["Prestation", first\(business\.services, 120\)\]/);
  assert.match(veo, /adultSafePromptText\(args\.creativeBrief, 90\)/);
  assert.doesNotMatch(veo, /compact\(args\.creativeBrief, 6_000\)/);
  assert.match(server, /writeAiMediaHeadline/);
  assert.match(server, /writeAiMediaNarration/);
  assert.match(server, /generateAiMediaNarrationAudio/);
  assert.match(server, /composeOriginalAiVideo/);
  assert.match(server, /branding_overlay_unavailable_video_continued/);
  assert.match(server, /video_enhancements_unavailable_video_continued/);
  assert.match(server, /soundtrack:\s*null/);
  assert.match(server, /narration:\s*null/);
  assert.equal((server.match(/generateOriginalAiVideoClips/g) || []).length, 3);
  assert.match(server, /const durationSeconds = providerRequest\.durationSeconds \|\| 8/);
  assert.match(server, /const videoGatewayTask = measure\("video_generation"/);
  assert.match(
    server,
    /const narrationTask =[\s\S]*?measure\("narration_pipeline"/,
  );
  assert.match(server, /const soundtrackTask = measure\("soundtrack"/);
  assert.match(server, /const overlaysTask = measure\("video_overlays"/);
  assert.match(server, /videoGateway = await videoGatewayTask/);
  assert.match(server, /AI_MEDIA_NARRATION_AFTER_VIDEO_GRACE_MS/);
  assert.match(narrationAudio, /fetchOptions: \{ signal: args\.signal \}/);
  assert.match(narrationAudio, /if \(args\.signal\?\.aborted\)/);
  assert.match(narrationAudio, /DEFAULT_TTS_VOICE_FEMALE = "Kore"/);
  assert.match(narrationAudio, /DEFAULT_TTS_VOICE_MALE = "Charon"/);
  assert.match(narrationAudio, /AI_MEDIA_TTS_VOICE_MALE/);
  assert.match(server, /narrationVoice: providerRequest\.narrationVoice \|\| "female"/);
  assert.match(veo, /DEFAULT_POLL_MS = 2_500/);
  assert.match(server, /withText: providerRequest\.withText/);
  assert.doesNotMatch(server, /prompt_sha256: promptHash,\s*prompt,/);
  assert.match(nextConfig, /assets\/media-generation\/soundtracks\/\*\*\/\*/);
  assert.match(nextConfig, /node_modules\/ffmpeg-static\/\*\*\/\*/);
  assert.match(vercelConfig, /media-generation\/generate\/route\.ts/);
  assert.match(vercelConfig, /assets\/media-generation\/soundtracks/);
  assert.equal((JSON.parse(vercelConfig) as { fluid?: boolean }).fluid, true);
  assert.match(quotaPresentation, /AI_MEDIA_ADMIN_LIMIT_OVERRIDE = 10_000/);
  assert.match(quotaPresentation, /videoLongFormPremiumRequired/);
  assert.match(quotaPresentation, /quota\.edition === "standard"/);
  assert.match(quotaPresentation, /limit: null, remaining: null/);
});
