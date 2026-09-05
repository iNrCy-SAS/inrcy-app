import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  patchAiMediaGeneratorPreferences,
  serializeAiMediaGeneratorPreferences,
} from "../../lib/aiMediaGenerationPreferences.ts";

const read = (relativePath: string) => readFileSync(relativePath, "utf8");

test("le bloc 5 propose l'animation dès qu'une image vidéo est ajoutée", () => {
  const generator = read("app/dashboard/_components/MediaGenerator.tsx");
  const hook = read("app/dashboard/_hooks/useMediaGeneration.ts");
  const styles = read("app/dashboard/_components/MediaGenerator.module.css");

  assert.doesNotMatch(generator, /ANIMATABLE_IDENTITY_MODES/);
  assert.match(
    generator,
    /const identityAnimationAvailable =\s*kind === "video" && inspirationImages\.length > 0/,
  );
  assert.match(generator, /\{identityAnimationAvailable \? \([\s\S]*?ai_generator_team_animation_label/);
  assert.match(generator, /data-team-video-mode=\{teamVideoMode\}/);
  assert.match(generator, /event\.target\.checked \? "cinematic" : "montage"/);
  assert.match(generator, /teamVideoMode === "cinematic"[\s\S]*?ai_generator_team_animation_hint_cinematic/);
  assert.match(hook, /function hasAnimationSourceImage\(/);
  assert.match(hook, /return kind === "video" && Boolean\(images\?\.length\)/);
  assert.match(styles, /\.teamAnimationToggle\s*\{/);
  assert.match(
    styles,
    /@media \(max-width: 620px\)[\s\S]*?\.teamAnimationToggle\s*\{/,
  );
});

test("les règles des photos restent dans le flux et ne passent sous aucun bandeau fixe", () => {
  const styles = read("app/dashboard/_components/MediaGenerator.module.css");
  const pickerRow = styles.match(/\.inspirationPickerRow\s*\{([^}]*)\}/)?.[1] || "";
  const infoButton = styles.match(/\.inspirationInfoButton\s*\{([^}]*)\}/)?.[1] || "";
  const infoBubble = styles.match(/\.inspirationInfoBubble\s*\{([^}]*)\}/)?.[1] || "";

  assert.match(pickerRow, /position:\s*relative/);
  assert.match(pickerRow, /display:\s*grid/);
  assert.match(infoButton, /top:\s*22px/);
  assert.doesNotMatch(infoButton, /top:\s*50%/);
  assert.match(infoBubble, /position:\s*relative/);
  assert.match(infoBubble, /width:\s*100%/);
  assert.match(infoBubble, /box-sizing:\s*border-box/);
  assert.doesNotMatch(infoBubble, /position:\s*absolute/);
});

test("le bloc 5 distingue la voix off des personnages parlants sans mélanger les deux", () => {
  const generator = read("app/dashboard/_components/MediaGenerator.tsx");
  const hook = read("app/dashboard/_hooks/useMediaGeneration.ts");
  const styles = read("app/dashboard/_components/MediaGenerator.module.css");

  assert.match(
    generator,
    /teamVideoMode === "cinematic"[\s\S]*?\(\["voiceover", "characters"\] as const\)\.map/,
  );
  assert.match(generator, /const animatedCharactersSpeak =[\s\S]*?teamVideoSpeechMode === "characters"/);
  assert.match(generator, /const effectiveWithNarration =[\s\S]*?!animatedCharactersSpeak && withNarration/);
  assert.match(generator, /withNarration: kind === "video" \? effectiveWithNarration : undefined/);
  assert.match(generator, /teamVideoSpeechMode: identityCinematicRequested[\s\S]*?teamVideoSpeechMode/);
  assert.match(generator, /disabled=\{operationLocked \|\| animatedCharactersSpeak\}/);
  assert.match(generator, /ai_generator_team_speech_narration_disabled_hint/);
  assert.match(generator, /ai_generator_team_speech_gender_hint/);
  assert.match(hook, /teamVideoSpeechMode\?: MediaGenerationTeamVideoSpeechMode/);
  assert.match(styles, /\.teamSpeechChoices\s*\{[\s\S]*?repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(
    styles,
    /@media \(max-width: 620px\)[\s\S]*?\.teamSpeechChoices\s*\{[^}]*grid-template-columns:\s*1fr/,
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

test("les six en-têtes du studio gardent la même géométrie et le titre ne casse plus la grille", () => {
  const generator = read("app/dashboard/_components/MediaGenerator.tsx");
  const styles = read("app/dashboard/_components/MediaGenerator.module.css");

  assert.equal((generator.match(/className=\{styles\.collapsibleHeader\}/g) || []).length, 6);
  assert.match(
    styles,
    /\.collapsibleToggle\s*\{[\s\S]*?height:\s*66px;[\s\S]*?grid-template-columns:\s*auto minmax\(145px, 1fr\) minmax\(0, 235px\) auto/,
  );
  assert.match(
    styles,
    /\.collapsibleTitle strong\s*\{[\s\S]*?text-overflow:\s*ellipsis;[\s\S]*?white-space:\s*nowrap/,
  );
  assert.match(
    styles,
    /@media \(min-width: 1101px\)[\s\S]*?\.collapsibleToggle\s*\{[\s\S]*?height:\s*58px/,
  );
  assert.match(
    styles,
    /@media \(max-width: 620px\)[\s\S]*?\.collapsibleToggle\s*\{[\s\S]*?height:\s*78px/,
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
  assert.match(fr.ai_generator_team_speech_gender_hint, /voix off de secours/i);
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
  assert.equal(fr.ai_generator_made_inrcy_hint, "Votre générateur de médias made in iNrCy");
  assert.equal(fr.ai_generator_modal_title, "Générer un média");
  assert.equal(dashboardFr.userMenu.mediaGenerator, "Générer un média");
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
