import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

function sourceSection(source: string, startToken: string, endToken: string) {
  const start = source.indexOf(startToken);
  assert.ok(start >= 0, `${startToken} doit être présent`);
  const end = source.indexOf(endToken, start + startToken.length);
  assert.ok(end > start, `${endToken} doit suivre ${startToken}`);
  return source.slice(start, end);
}

function assertOrdered(source: string, tokens: string[]) {
  let previousIndex = -1;
  for (const token of tokens) {
    const index = source.indexOf(token, previousIndex + 1);
    assert.ok(
      index > previousIndex,
      `${token} doit rester dans l'ordre attendu`
    );
    previousIndex = index;
  }
}

test("Booster utilise le générateur partagé et réinsère le média validé", () => {
  const hook = read("app/dashboard/_hooks/useMediaGeneration.ts");
  const publishModal = read("app/dashboard/booster/publier/PublishModal.tsx");
  const intentPanel = read(
    "app/dashboard/booster/publier/components/PublishIntentPanel.tsx"
  );
  const mediaPanel = read(
    "app/dashboard/booster/publier/components/PublishImagesPanel.tsx"
  );

  assert.match(hook, /\/api\/media-generation\/quota/);
  assert.match(hook, /\/api\/media-generation\/generate/);
  assert.match(hook, /ACTIVE_INRCY_ACCOUNT_EVENT/);
  assert.match(hook, /MediaGenerationAccountChangedError/);
  for (const field of [
    "requestId",
    "kind",
    "subjectSource",
    "idea",
    "withText",
    "textKeywords",
    "withMusic",
    "withNarration",
    "format",
    "typology",
    "visualStyle",
    "imageStyle",
    "shotType",
    "peopleMode",
    "creativity",
    "useBrandColors",
    "logoMode",
    "durationSeconds",
    "source",
  ]) {
    assert.ok(
      hook.includes(field),
      `${field} doit rester dans le contrat client`
    );
  }
  assert.doesNotMatch(hook, /\binstruction\b/);
  assert.match(hook, /withText: Boolean\(request\.withText\)/);
  assert.match(
    hook,
    /textKeywords: request\.withText \? request\.textKeywords : \[\]/
  );
  assert.doesNotMatch(hook, /withText: request\.kind === "image"/);

  assert.match(publishModal, /import MediaGeneratorModal/);
  assert.match(publishModal, /source="booster"/);
  assert.match(publishModal, /origin="booster"/);
  assert.match(publishModal, /acceptMode="insert"/);
  assert.match(publishModal, /addMediaLibrarySelection\(/);
  assert.match(publishModal, /\[result\.item\]/);
  assert.match(publishModal, /\{ kind: "publication" \}/);
  assert.match(intentPanel, /onGenerateMedia/);
  assert.match(mediaPanel, /onGenerateMedia/);
  assert.doesNotMatch(intentPanel, /onGenerateImage|onGenerateVideo/);
  assert.doesNotMatch(mediaPanel, /onGenerateImage|onGenerateVideo/);
  assert.equal(
    existsSync(
      "app/dashboard/booster/publier/components/PublishMediaGeneratorModal.tsx"
    ),
    false
  );
});

test("les nouvelles tentatives réutilisent un identifiant seulement quand le résultat serveur reste incertain", () => {
  const hook = read("app/dashboard/_hooks/useMediaGeneration.ts");

  assert.match(hook, /pendingGenerationAttemptRef/);
  assert.match(hook, /previousAttempt\?\.key === attemptKey/);
  assert.match(hook, /\? previousAttempt\.requestId\s*: createRequestId\(\)/);
  assert.match(hook, /AI_MEDIA_GENERATION_IN_PROGRESS/);
  assert.match(hook, /AI_MEDIA_FINALIZATION_PENDING/);
  assert.match(hook, /clearCurrentAttempt\(\);/);
  assert.match(
    hook,
    /const reset = useCallback\(\(\) => \{[\s\S]*?pendingGenerationAttemptRef\.current = null/
  );
  assert.match(hook, /function estimateGenerationProgress/);
  assert.match(hook, /renderTimeConstant = kind === "video" \? 55 : 35/);
  assert.match(hook, /Math\.max\(current, Math\.min\(94, estimated\)\)/);
  assert.doesNotMatch(hook, /Math\.min\(94, Math\.max\(current, estimated\)\)/);
});

test("une génération peut être arrêtée avec confirmation et propagation serveur", () => {
  const hook = read("app/dashboard/_hooks/useMediaGeneration.ts");
  const generator = read("app/dashboard/_components/MediaGenerator.tsx");
  const route = read("app/api/media-generation/generate/route.ts");
  const provider = read("lib/aiVideoProviderGoogleVeo.ts");
  const composer = read("lib/aiMediaGeneratedVideo.ts");

  assert.match(hook, /new AbortController\(\)/);
  assert.match(hook, /signal: controller\.signal/);
  assert.match(hook, /const cancelGeneration = useCallback/);
  assert.match(generator, /role="alertdialog"/);
  assert.match(generator, /ai_generator_stop_confirm_cost_warning/);
  assert.match(generator, /cancelGeneration\(\)/);
  assert.match(route, /AI_MEDIA_GENERATION_CANCELLED/);
  assert.match(route, /signal: request\.signal/);
  assert.match(provider, /args\.signal\?\.addEventListener\("abort"/);
  assert.match(composer, /signal: args\.signal/);
});

test("la fenêtre iNrCy sépare les critères de la création et de la revue", () => {
  const hook = read("app/dashboard/_hooks/useMediaGeneration.ts");
  const generator = read("app/dashboard/_components/MediaGenerator.tsx");
  const voice = read("app/dashboard/_components/MediaSubjectVoiceButton.tsx");
  const generatorStyles = read(
    "app/dashboard/_components/MediaGenerator.module.css"
  );
  const modal = read("app/dashboard/_components/MediaGeneratorModal.tsx");
  const modalStyles = read(
    "app/dashboard/_components/MediaGeneratorModal.module.css"
  );

  for (const source of ["publication", "profile", "custom"] as const) {
    assert.ok(
      generator.includes(`\"${source}\"`),
      `${source} doit être proposé`
    );
  }
  assert.match(
    generator,
    /const subjectChoices:[\s\S]*?id: "publication"[\s\S]*?disabled: !publicationAvailable/
  );
  assert.match(generator, /disabled=\{operationLocked \|\| choice\.disabled\}/);
  assert.match(generator, /ai_generator_subject_publication_unavailable/);
  for (const key of [
    "ai_generator_group_creation_title",
    "ai_generator_group_creation_hint",
    "ai_generator_group_content_title",
    "ai_generator_group_content_hint",
    "ai_generator_group_art_title",
    "ai_generator_group_art_hint",
    "ai_generator_group_composition_title",
    "ai_generator_group_composition_hint",
    "ai_generator_group_identity_title",
    "ai_generator_group_identity_hint",
    "ai_generator_group_finish_title",
    "ai_generator_group_finish_hint",
    "ai_generator_step_subject",
    "ai_generator_step_kind",
    "ai_generator_typology_title",
    "ai_generator_format_title",
    "ai_generator_style_title",
    "ai_generator_brand_colors",
    "ai_generator_with_text",
    "ai_generator_text_on_media",
    "ai_generator_text_keywords_label",
    "ai_generator_with_music",
    "ai_generator_narration",
    "ai_generator_with_narration",
    "ai_generator_unlimited",
  ]) {
    assert.ok(generator.includes(key), `${key} doit être présent`);
  }
  assert.match(generator, /ai_generator_duration_\$\{duration\}/);
  assert.match(generator, /useState<MediaGenerationVideoDuration>\(10\)/);
  assert.match(generator, /standardVideoLongFormRestricted && duration > 10/);
  assert.match(generator, /disabled=\{operationLocked \|\| premiumLocked\}/);
  assert.match(generator, /acceptMode === "insert"/);
  assert.match(generator, /await onAccepted\(result\)/);
  assert.match(generator, /ai_generator_confirm_insert/);
  assert.match(generator, /ai_generator_open_library/);
  assert.match(generator, /ai_generator_regenerate/);
  assert.match(generator, /ai_generator_saved_automatically/);
  assert.match(generator, /setCreationScreen\(true\)/);
  assert.match(generator, /className=\{styles\.creationWorkspace\}/);
  assert.match(generator, /ai_generator_stage_storyboard/);
  assert.match(generator, /ai_generator_stage_render/);
  assert.match(generator, /ai_generator_edit_criteria/);
  assert.match(generator, /progress >= 99/);
  assert.match(generator, /ai_generator_stage_patience/);
  assert.match(hook, /const COMPLETION_RAMP_MIN_MS = 900/);
  assert.match(hook, /const COMPLETION_RAMP_MAX_MS = 1_800/);
  assert.match(hook, /function estimateGenerationProgress/);
  assert.match(hook, /function animateProgressToCompletion/);
  assert.match(hook, /args\.onProgress\(99\)/);
  assert.match(hook, /args\.onProgress\(100\)/);
  assert.match(hook, /Math\.max\(current, Math\.min\(94, estimated\)\)/);
  assert.doesNotMatch(hook, /Math\.min\(94, Math\.max\(current, estimated\)\)/);
  assert.match(
    hook,
    /completionStartedRef\.current = true;[\s\S]*?await animateProgressToCompletion\([\s\S]*?setResult\(nextResult\)/
  );
  assert.match(generator, /generationResult\.item\.media_type === "video"/);
  assert.match(generator, /<video[\s\S]*?controls[\s\S]*?playsInline/);
  assert.match(generator, /<img[\s\S]*?generationResult\.item\.signed_url/);
  assert.doesNotMatch(generator, /resultInfo|resultCaption|result\.prompt/);

  for (const format of ["square", "portrait", "story", "landscape"]) {
    assert.ok(
      generator.includes(`id: "${format}"`),
      `${format} doit être proposé`
    );
  }
  assert.match(generator, /\(\[10, 20, 30\] as const\)/);
  assert.match(generator, /MediaSubjectVoiceButton/);
  assert.match(voice, /\/api\/booster\/transcribe/);
  assert.match(voice, /SpeechRecognition|webkitSpeechRecognition/);
  assert.match(voice, /audio\/wav/);
  assert.match(voice, /warmupMicrophoneIfNeeded/);
  assert.match(voice, /voice_transcription_failed_live_kept/);
  assert.match(voice, /user_message \|\| record\.userMessage/);
  assert.match(generator, /expandedStep/);
  assert.match(
    generator,
    /useState<1 \| 2 \| 3 \| 4 \| 5 \| 6 \| null>\(null\)/
  );
  assert.match(generator, /aria-expanded=\{expandedStep === 1\}/);
  assert.match(generator, /aria-expanded=\{expandedStep === 3\}/);
  assert.match(generator, /aria-expanded=\{expandedStep === 6\}/);
  assert.doesNotMatch(generator, /expandedStep === [7-8]/);
  assert.equal((generator.match(/<section className=/g) || []).length, 6);
  const creationBody = sourceSection(
    generator,
    "{expandedStep === 1 ? <div className={styles.collapsibleBody}>",
    "</section>"
  );
  assertOrdered(creationBody, [
    't("ai_generator_step_kind")',
    't("ai_generator_step_subject")',
    'styles.inspirationSection',
  ]);
  assert.match(generator, /styles\.contentCriteriaSection/);
  assert.match(generator, /styles\.inspirationInfoButton/);
  assert.match(generator, /styles\.inspirationInfoBubble/);
  assert.match(generator, /ai_generator_inspiration_rules_title/);
  assert.match(generator, /ai_generator_inspiration_rules_body/);
  assert.doesNotMatch(generator, /ai_generator_generate_summary_(?:video|image)/);
  assert.doesNotMatch(generator, /styles\.wideSection/);
  assert.match(generatorStyles, /\.collapsibleToggle/);
  assert.match(generatorStyles, /\.combinedSubsection/);
  assert.match(
    generatorStyles,
    /\.criteriaGrid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/
  );
  assert.match(
    generatorStyles,
    /\.criteriaGrid\s*\{[\s\S]*?grid-auto-rows:\s*max-content/
  );
  assert.match(
    generatorStyles,
    /\.criteriaGrid\s*\{[\s\S]*?align-items:\s*start/
  );
  assert.match(
    generatorStyles,
    /\.contentCriteriaSection\s*\{[\s\S]*?height:\s*fit-content/
  );
  assert.match(
    generatorStyles,
    /\.parameterChoices\s*\{[\s\S]*?grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/
  );
  assert.match(generatorStyles, /\.voiceButton/);
  assert.match(generator, /normalizeTextKeywordValues/);
  assert.match(generator, /textKeywords: resolvedTextKeywords/);
  assert.match(generator, /ai_generator_text_keywords_placeholder/);
  assert.match(generatorStyles, /\.textKeywordTags/);
  assert.match(generatorStyles, /\.textKeywordInputRow/);
  assert.match(generatorStyles, /\.creationWorkspace::before/);
  assert.match(generatorStyles, /@keyframes creativeAurora/);
  assert.match(
    generatorStyles,
    /@media \(max-width: 620px\)[\s\S]*?\.footerBar\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)[\s\S]*?justify-items:\s*center/
  );
  assert.match(
    generatorStyles,
    /@media \(max-width: 620px\)[\s\S]*?\.generateButton\s*\{[\s\S]*?width:\s*min\(100%, 250px\)[\s\S]*?justify-self:\s*center/
  );
  assert.match(generator, /ai_generator_duration_\$\{duration\}/);
  assert.match(generator, /className=\{styles\.quotaCard\}/);
  assert.match(
    modalStyles,
    /\.dialog\s*\{[\s\S]*?width:\s*min\(1600px, 100%\)/
  );
  assert.match(modalStyles, /border-radius:\s*24px/);
  assert.match(
    modalStyles,
    /@media \(max-width: 620px\)[\s\S]*?height:\s*100dvh/
  );
  assert.match(
    generatorStyles,
    /\.previewFrame\[data-format="portrait"\]\s*\{[\s\S]*?aspect-ratio:\s*4 \/ 5/
  );
  assert.match(
    generatorStyles,
    /\.previewFrame\[data-format="story"\]\s*\{[\s\S]*?aspect-ratio:\s*9 \/ 16/
  );
  assert.match(
    generatorStyles,
    /\.previewFrame\[data-format="landscape"\]\s*\{[\s\S]*?aspect-ratio:\s*16 \/ 9/
  );
  assert.match(generatorStyles, /object-fit:\s*contain/);
  assert.match(modal, /createPortal/);
  assert.match(modal, /role="dialog"/);
});

test("fermer toute revue exige une confirmation, y compris depuis le Menu", () => {
  const modal = read("app/dashboard/_components/MediaGeneratorModal.tsx");
  const requestClose = sourceSection(
    modal,
    "const requestClose",
    "const cancelClose"
  );

  assert.match(requestClose, /if \(hasResult\)/);
  assert.doesNotMatch(requestClose, /acceptMode/);
  assert.doesNotMatch(requestClose, /onAccepted/);
  assert.match(modal, /role="alertdialog"/);
  assert.match(modal, /onResultChange=\{handleResultChange\}/);
  assert.match(modal, /beforeunload/);
  for (const key of [
    "ai_generator_close_confirm_title",
    "ai_generator_close_confirm_description",
    "ai_generator_close_confirm_cancel",
    "ai_generator_close_confirm_leave",
    "ai_generator_close_library_title",
    "ai_generator_close_library_description",
    "ai_generator_close_library_leave",
  ]) {
    assert.ok(modal.includes(key), `${key} doit protéger la fermeture`);
  }
});

test("le Menu ouvre directement la même modale sans ancien grand studio", () => {
  const studio = read(
    "app/dashboard/generer-media/MediaGeneratorStudioClient.tsx"
  );
  const studioStyles = read(
    "app/dashboard/generer-media/mediaGeneratorStudio.module.css"
  );
  const edition = read("lib/dashboardEdition.ts");
  const requiredSetup = read("lib/dashboardRequiredSetupAccess.ts");
  const desktopMenu = read("app/dashboard/_components/UserMenu.tsx");
  const mobileMenu = read("app/dashboard/_components/ResponsiveBottomNav.tsx");

  assert.match(studio, /<MediaGeneratorModal/);
  assert.match(studio, /source="studio"/);
  assert.match(studio, /origin="menu"/);
  assert.match(studio, /acceptMode="library"/);
  assert.match(studio, /router\.replace\("\/dashboard\/mediatheque"\)/);
  assert.doesNotMatch(studio, /heroTop|heroBottom|ai_studio_quota_badge/);
  assert.doesNotMatch(studioStyles, /\.heroTop|\.heroBottom|\.sideCard/);
  assert.doesNotMatch(edition, /dashboard\/generer-media/);
  for (const source of [requiredSetup, desktopMenu, mobileMenu]) {
    assert.ok(source.includes("/dashboard/generer-media"));
  }
  assert.match(desktopMenu, /mediaGenerator/);
  assert.match(mobileMenu, /mediaGenerator/);
});

test("Booster garde le même ordre d'actions en haut et dans Médias", () => {
  const intentPanel = read(
    "app/dashboard/booster/publier/components/PublishIntentPanel.tsx"
  );
  const mediaPanel = read(
    "app/dashboard/booster/publier/components/PublishImagesPanel.tsx"
  );

  const topActions = sourceSection(
    intentPanel,
    "onClick={onPickImagesClick}",
    "{videoPreviewUrl && videoFile ? ("
  );
  const lowerActions = sourceSection(
    mediaPanel,
    "onClick={onPickImagesClick}",
    "{imgError ? ("
  );
  const sharedOrderedTokens = [
    "ajouter_une_video",
    "onGenerateMedia",
    "onOpenMediaLibrary",
    "onTakePhotoClick",
  ];
  assertOrdered(topActions, ["ajouter_des_images", ...sharedOrderedTokens]);
  assertOrdered(lowerActions, ["ajouter_une_image", ...sharedOrderedTokens]);
  assert.equal(
    (topActions.match(/ai_generator_generate_media/g) || []).length >= 1,
    true
  );
  assert.equal(
    (lowerActions.match(/ai_generator_generate_media/g) || []).length >= 1,
    true
  );
});

test("iNrSend réutilise la modale partagée en édition", () => {
  const details = read(
    "app/dashboard/mails/_components/MailboxDetailsModal.tsx"
  );

  assert.match(details, /<MediaGeneratorModal/);
  assert.match(details, /source="booster"/);
  assert.match(details, /origin="inrsend"/);
  assert.match(details, /acceptMode="insert"/);
  assert.match(details, /ai_generator_replace_title/);
  assert.match(details, /markPublicationEditDirty/);
  assert.match(
    details,
    /publicationMediaGeneratorBrief[\s\S]*?publicationEditForm\.title[\s\S]*?publicationEditForm\.content/
  );
  assert.match(details, /publicationBrief=\{publicationMediaGeneratorBrief\}/);
});

test("toutes les langues contiennent la copie complète de la modale", () => {
  const requiredKeys = [
    "ai_generator_modal_title",
    "ai_generator_modal_subtitle",
    "ai_generator_group_creation_title",
    "ai_generator_group_creation_hint",
    "ai_generator_group_content_title",
    "ai_generator_group_content_hint",
    "ai_generator_group_art_title",
    "ai_generator_group_art_hint",
    "ai_generator_group_composition_title",
    "ai_generator_group_composition_hint",
    "ai_generator_group_identity_title",
    "ai_generator_group_identity_hint",
    "ai_generator_group_finish_title",
    "ai_generator_group_finish_hint",
    "ai_generator_step_subject",
    "ai_generator_subject_publication",
    "ai_generator_subject_publication_unavailable",
    "ai_generator_subject_profile",
    "ai_generator_subject_custom",
    "ai_generator_step_kind",
    "ai_generator_typology_title",
    "ai_generator_format_title",
    "ai_generator_style_title",
    "ai_generator_render_title",
    "ai_generator_render_label",
    "ai_generator_shot_label",
    "ai_generator_identity_title",
    "ai_generator_people_label",
    "ai_generator_creativity_label",
    "ai_generator_brand_colors",
    "ai_generator_logo_label",
    "ai_generator_finish_title",
    "ai_generator_generate_media",
    "ai_generator_with_text",
    "ai_generator_text_on_media",
    "ai_generator_text_inspiration_hint",
    "ai_generator_text_keywords_label",
    "ai_generator_text_keywords_hint",
    "ai_generator_text_keywords_placeholder",
    "ai_generator_text_keywords_counter",
    "ai_generator_text_keyword_add",
    "ai_generator_text_keyword_remove",
    "ai_generator_options_summary_text_keywords",
    "ai_generator_with_music",
    "ai_generator_inspiration_rules_title",
    "ai_generator_inspiration_rules_body",
    "ai_generator_unlimited",
    "ai_generator_duration_10",
    "ai_generator_duration_20",
    "ai_generator_duration_30",
    "ai_generator_stage_profile",
    "ai_generator_stage_brand",
    "ai_generator_stage_storyboard",
    "ai_generator_stage_render",
    "ai_generator_edit_criteria",
    "ai_generator_confirm_insert",
    "ai_generator_regenerate",
    "ai_generator_image_timing_hint",
    "ai_generator_video_timing_hint",
    "ai_generator_saved_automatically",
    "ai_generator_stop_generation",
    "ai_generator_stop_confirm_title",
    "ai_generator_stop_confirm_description",
    "ai_generator_stop_confirm_cost_warning",
    "ai_generator_stop_confirm_continue",
    "ai_generator_stop_confirm_action",
    "ai_generator_open_library",
    "ai_generator_close_confirm_title",
    "ai_generator_close_confirm_description",
    "ai_generator_close_library_title",
    "ai_generator_close_library_description",
    "ai_generator_close_library_leave",
    "ai_generator_replace_title",
    "ai_generator_replace_description",
  ];

  for (const locale of [
    "fr-FR",
    "en-GB",
    "es-ES",
    "it-IT",
    "de-DE",
    "nl-NL",
    "pt-PT",
    "th-TH",
    "zh-CN",
  ]) {
    const media = JSON.parse(read(`messages/${locale}/media.json`)) as Record<
      string,
      unknown
    >;
    for (const key of requiredKeys) {
      assert.equal(typeof media[key], "string", `${locale}: ${key}`);
    }
  }
});

test("les temps indicatifs français restent courts et explicites", () => {
  const media = JSON.parse(read("messages/fr-FR/media.json")) as Record<
    string,
    unknown
  >;

  assert.equal(
    media.ai_generator_image_timing_hint,
    "Temps indicatif : la création d'une image peut prendre entre 30 secondes et 2 minutes"
  );
  assert.equal(
    media.ai_generator_video_timing_hint,
    "Temps indicatif : iNrCy analyse le profil, construit les scènes puis réalise le montage. La durée dépend du format choisi."
  );
  assert.equal(
    media.ai_generator_custom_placeholder,
    "Expliquez ici votre idée et détaillez-la le plus possible pour obtenir un contenu de qualité…"
  );
});
