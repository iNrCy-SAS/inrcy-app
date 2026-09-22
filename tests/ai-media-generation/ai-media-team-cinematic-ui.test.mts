import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  patchAiMediaGeneratorPreferences,
  serializeAiMediaGeneratorPreferences,
} from "../../lib/aiMediaGenerationPreferences.ts";

const read = (relativePath: string) => readFileSync(relativePath, "utf8");

test("toute vidéo du Studio essentiel demande une vraie scène animée sans interrupteur trompeur", () => {
  const generator = read("app/dashboard/_components/MediaGenerator.tsx");
  const hook = read("app/dashboard/_hooks/useMediaGeneration.ts");
  const styles = read("app/dashboard/_components/MediaGenerator.module.css");

  assert.doesNotMatch(generator, /ANIMATABLE_IDENTITY_MODES|teamAnimationToggle/);
  assert.match(generator, /inputMode: "essential"/);
  assert.match(generator, /teamVideoMode: kind === "video" \? "cinematic" : undefined/);
  assert.match(generator, /ai_generator_essential_new_scene_video/);
  assert.match(generator, /mediaSourceMode === "real" \? inspirationImages : \[\]/);
  assert.match(hook, /function hasAnimationSourceImage\(/);
  assert.match(hook, /return kind === "video" && Boolean\(images\?\.length\)/);
  assert.match(styles, /\.newSceneNotice,/);
});

test("les photos sont présentées comme personnages, décor et produit distincts", () => {
  const generator = read("app/dashboard/_components/MediaGenerator.tsx");
  const styles = read("app/dashboard/_components/MediaGenerator.module.css");

  assert.match(generator, /id: "character"/);
  assert.match(generator, /id: "environment"/);
  assert.match(generator, /id: "product"/);
  assert.match(generator, /characterIndex: characterIndex as 1 \| 2 \| 3/);
  assert.match(generator, /image\.role === args\.role/);
  assert.match(styles, /\.referenceCollection\s*\{/);
  assert.match(styles, /\.referenceTile\s*\{/);
  assert.match(styles, /\.referenceTileRemove\s*\{/);
});

test("le bloc 3 vidéo place le scénario sous la durée et l'identité à droite en 16 ou 24 secondes", () => {
  const generator = read("app/dashboard/_components/MediaGenerator.tsx");
  const styles = read("app/dashboard/_components/MediaGenerator.module.css");

  assert.match(
    generator,
    /data-has-scene-mode=\{[\s\S]*?kind === "video" && durationSeconds > 8/,
  );
  assert.match(
    styles,
    /\.directionCard\[data-media-kind="video"\]\[data-has-scene-mode="true"\][\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    styles,
    /data-has-scene-mode="true"\][\s\S]*?> \.identitySettings[\s\S]*?display:\s*contents/,
  );
  assert.match(
    styles,
    /data-has-scene-mode="true"\][\s\S]*?> \.sceneModeField[\s\S]*?grid-column:\s*1;[\s\S]*?grid-row:\s*3 \/ 5;[\s\S]*?align-self:\s*start/,
  );
  assert.match(
    styles,
    /> \.sceneModeField[\s\S]*?\.sceneModeChoices[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    styles,
    /data-has-scene-mode="true"\][\s\S]*?> \.directionSettings[\s\S]*?> :nth-child\(1\)[\s\S]*?grid-column:\s*1;[\s\S]*?grid-row:\s*2/,
  );
  assert.match(
    styles,
    /> \.identitySettings[\s\S]*?> :nth-child\(1\)[\s\S]*?grid-column:\s*2;[\s\S]*?grid-row:\s*4[\s\S]*?> \.identitySettings[\s\S]*?> :nth-child\(2\)[\s\S]*?grid-column:\s*3;[\s\S]*?grid-row:\s*4/,
  );
});

test("le bloc 1 distingue la voix off des personnages parlants sans mélanger les deux", () => {
  const generator = read("app/dashboard/_components/MediaGenerator.tsx");
  const hook = read("app/dashboard/_hooks/useMediaGeneration.ts");
  const styles = read("app/dashboard/_components/MediaGenerator.module.css");

  assert.match(generator, /\(\["voiceover", "characters"\] as const\)\.map/);
  assert.match(generator, /const animatedCharactersSpeak =[\s\S]*?teamVideoSpeechMode === "characters"/);
  assert.match(generator, /const effectiveWithNarration = kind === "video" && !animatedCharactersSpeak/);
  assert.match(generator, /withNarration: kind === "video" \? effectiveWithNarration : undefined/);
  assert.match(generator, /teamVideoSpeechMode: kind === "video" \? teamVideoSpeechMode : undefined/);
  assert.match(generator, /teamVideoSpeechMode === "voiceover" \? \(/);
  assert.match(generator, /styles\.characterSpeechNotice/);
  assert.match(generator, /ai_generator_essential_character_speech_notice/);
  assert.match(hook, /teamVideoSpeechMode\?: MediaGenerationTeamVideoSpeechMode/);
  assert.match(styles, /\.soundChoices\s*\{[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(
    styles,
    /@media \(max-width: 620px\)[\s\S]*?\.soundChoices\s*\{[^}]*grid-template-columns:\s*1fr/,
  );
});

test("le consentement Google\/Veo est demandé à chaque génération et transmis séparément", () => {
  const generator = read("app/dashboard/_components/MediaGenerator.tsx");
  const hook = read("app/dashboard/_hooks/useMediaGeneration.ts");

  assert.match(generator, /teamCinematicConsentRequired[\s\S]*?setTeamVideoConsentOpen\(true\)/);
  assert.match(generator, /handleConfirmTeamVideoConsent[\s\S]*?performGeneration\(true\)/);
  assert.match(generator, /role="dialog"[\s\S]*?ai_generator_team_video_consent_checkbox/);
  assert.match(generator, /setTeamVideoVeoConsent\(false\)/);
  assert.match(hook, /teamVideoMode\?: MediaGenerationTeamVideoMode/);
  assert.match(hook, /teamVideoVeoConsent\?: boolean/);
  assert.match(hook, /teamVideoMode:[\s\S]*?request\.teamVideoMode \|\| "montage"/);
  assert.match(hook, /teamVideoVeoConsent:[\s\S]*?Boolean\(request\.teamVideoVeoConsent\)/);
});

test("les quatre cartes du studio gardent une grille 2×2 responsive", () => {
  const generator = read("app/dashboard/_components/MediaGenerator.tsx");
  const styles = read("app/dashboard/_components/MediaGenerator.module.css");

  assert.equal((generator.match(/<header className=\{styles\.essentialCardHeader\}>/g) || []).length, 4);
  assert.match(
    styles,
    /\.essentialGrid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    styles,
    /@media \(max-width: 1100px\)[\s\S]*?\.essentialGrid\s*\{[\s\S]*?grid-template-columns:\s*1fr/,
  );
});

test("seul le choix cinématographique peut être mémorisé, jamais le consentement", () => {
  const preferences = patchAiMediaGeneratorPreferences({}, {
    blockId: 5,
    saved: true,
    defaults: {
      peopleMode: "team",
      identityMode: "reference_team",
      teamVideoMode: "cinematic",
      teamVideoSpeechMode: "characters",
      teamVideoVeoConsent: true,
    },
  });

  assert.equal(preferences.blocks[5].defaults.teamVideoMode, "cinematic");
  assert.equal(preferences.blocks[5].defaults.teamVideoSpeechMode, "characters");
  const serialized = JSON.stringify(serializeAiMediaGeneratorPreferences(preferences));
  assert.match(serialized, /teamVideoMode/);
  assert.match(serialized, /teamVideoSpeechMode/);
  assert.doesNotMatch(serialized, /teamVideoVeoConsent/);
});

test("les neuf langues couvrent le mode, le consentement et l'utilisation automatique du moteur", () => {
  const locales = [
    "fr-FR",
    "en-GB",
    "es-ES",
    "it-IT",
    "de-DE",
    "nl-NL",
    "pt-PT",
    "th-TH",
    "zh-CN",
  ];
  const keys = [
    "ai_generator_team_animation_label",
    "ai_generator_team_animation_hint_cinematic",
    "ai_generator_team_animation_hint_montage",
    "ai_generator_team_speech_title",
    "ai_generator_team_speech_voiceover",
    "ai_generator_team_speech_voiceover_hint",
    "ai_generator_team_speech_characters",
    "ai_generator_team_speech_characters_hint",
    "ai_generator_team_speech_gender_hint",
    "ai_generator_team_speech_narration_disabled_hint",
    "ai_generator_team_speech_finish_title",
    "ai_generator_team_speech_finish_hint",
    "ai_generator_team_speech_finish_summary",
    "ai_generator_team_video_consent_title",
    "ai_generator_team_video_consent_description",
    "ai_generator_team_video_consent_description_characters",
    "ai_generator_team_video_consent_checkbox",
    "ai_generator_team_video_consent_checkbox_characters",
    "ai_generator_team_video_consent_required",
    "ai_generator_team_video_consent_confirm",
    "ai_generator_team_video_consent_cancel",
    "ai_generator_stage_team_animation",
  ];

  for (const locale of locales) {
    const catalog = JSON.parse(read(`messages/${locale}/media.json`)) as Record<string, string>;
    for (const key of keys) {
      assert.ok(catalog[key]?.trim().length > 1, `${locale}: ${key}`);
    }
  }

  const fr = JSON.parse(read("messages/fr-FR/media.json")) as Record<string, string>;
  assert.match(fr.ai_generator_team_animation_hint_cinematic, /automatiquement/i);
  assert.match(fr.ai_generator_team_video_consent_description, /Google Gemini\/Veo/);
  assert.match(fr.ai_generator_team_video_consent_description, /2 jours/);
  assert.match(fr.ai_generator_team_video_consent_checkbox, /autorisation/i);
  assert.match(fr.ai_generator_team_speech_voiceover, /ne parlent pas/i);
  assert.match(fr.ai_generator_team_speech_characters, /sans voix off/i);
  assert.match(fr.ai_generator_team_speech_gender_hint, /^iNrCy vise/i);
  assert.doesNotMatch(
    fr.ai_generator_team_speech_gender_hint,
    /est attribuée à chaque personne/i,
  );
  assert.match(fr.ai_generator_team_speech_gender_hint, /féminines, masculines ou neutres/i);
  assert.match(fr.ai_generator_team_speech_gender_hint, /Aucun clonage vocal/i);
  assert.match(fr.ai_generator_team_speech_gender_hint, /mouvements de bouche/i);
  assert.match(fr.ai_generator_team_speech_gender_hint, /reste muette plutôt que désynchronisée/i);
  assert.doesNotMatch(fr.ai_generator_team_speech_gender_hint, /voix off de secours/i);
  assert.match(fr.ai_generator_team_video_consent_description_characters, /voix.*ne clonent pas/i);
});

test("la page ouverte affiche le wordmark iNr’Studio jusque sur mobile sans renommer le titre fonctionnel", () => {
  const modal = read("app/dashboard/_components/MediaGeneratorModal.tsx");
  const styles = read("app/dashboard/_components/MediaGeneratorModal.module.css");
  const fr = JSON.parse(read("messages/fr-FR/media.json")) as Record<string, string>;
  const dashboardFr = JSON.parse(read("messages/fr-FR/dashboard.json")) as {
    userMenu: { mediaGenerator: string };
  };

  assert.match(
    modal,
    /className=\{styles\.studioWordmark\}[\s\S]*?<span>\{studioWordmark\.slice\(0, 4\)\}<\/span>[\s\S]*?<b>\{studioWordmark\.slice\(4\)\}<\/b>/,
  );
  assert.match(styles, /\.studioWordmark\s*\{/);
  assert.match(
    styles,
    /@media \(max-width: 620px\)[\s\S]*?\.moduleIdentity > div\s*\{[^}]*display:\s*grid/,
  );
  assert.equal(fr.ai_generator_made_inrcy, "iNr’Studio");
  assert.equal(fr.ai_generator_made_inrcy_hint, "Vos médias Made in iNrCy");
  assert.equal(fr.ai_generator_modal_title, "Générer un média");
  assert.equal(dashboardFr.userMenu.mediaGenerator, "Studio Médias");
});

test("le dialogue de consentement reste exploitable sur mobile", () => {
  const styles = read("app/dashboard/_components/MediaGenerator.module.css");
  assert.match(styles, /\.teamVideoConsentBackdrop\s*\{/);
  assert.match(styles, /\.teamVideoConsentDialog\s*\{/);
  assert.match(
    styles,
    /@media \(max-width: 620px\)[\s\S]*?\.teamVideoConsentActions\s*\{[^}]*grid-template-columns:\s*1fr/,
  );
});
