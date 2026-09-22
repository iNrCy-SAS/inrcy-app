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

test("Booster délègue les actions média à iNrStudio et réinsère le résultat", () => {
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
    "narrationVoice",
    "narrationVoiceVariant",
    "format",
    "typology",
    "visualStyle",
    "imageStyle",
    "shotType",
    "peopleMode",
    "creativity",
    "useBrandColors",
    "logoMode",
    "videoEngine",
    "durationSeconds",
    "source",
  ]) {
    assert.ok(
      hook.includes(field),
      `${field} doit rester dans le contrat client`
    );
  }
  assert.doesNotMatch(hook, /\binstruction\b/);
  assert.match(hook, /const textMode = resolveMediaGenerationTextMode\(request\)/);
  assert.match(hook, /withText: textMode !== "none"/);
  assert.match(hook, /textKeywords: textMode === "ai" \? request\.textKeywords : \[\]/);
  assert.doesNotMatch(hook, /withText: request\.kind === "image"/);

  assert.match(publishModal, /from "@\/lib\/inrStudioNavigation"/);
  assert.match(publishModal, /createInrStudioHandoff\(\{/);
  assert.match(publishModal, /tab: "generate"[\s\S]*?origin: "booster-publish"/);
  assert.match(publishModal, /openInrStudioImageTool = async \([\s\S]*?tab: "modify" \| "retouch"/);
  assert.match(publishModal, /source: \{[\s\S]*?file: sourceFile \|\| null,[\s\S]*?url: sourceUrl/);
  assert.match(publishModal, /context: \{[\s\S]*?channel,[\s\S]*?imageKey,/);
  assert.match(
    publishModal,
    /pendingStudioReturn\.action === "retouch"[\s\S]*?pendingStudioReturn\.action === "modify"/,
  );
  assert.match(
    publishModal,
    /loadedPublicationDraftId !== expectedDraftId[\s\S]*?return;/,
  );
  assert.match(publishModal, /replaceImageFile\(imageKey, file\)/);
  assert.match(publishModal, /addMediaLibrarySelection\(/);
  assert.match(publishModal, /\[returnedItem\]/);
  assert.match(publishModal, /\{ kind: "publication" \}/);
  assert.doesNotMatch(publishModal, /<MediaGeneratorModal/);
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
  const omniProvider = read("lib/aiVideoProviderGoogleOmni.ts");
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
  assert.match(
    omniProvider,
    /args\.generationArgs\.signal\?\.addEventListener\("abort"/
  );
  assert.match(composer, /signal: args\.signal/);
});

test("la fenêtre iNrStudio expose quatre cartes essentielles adaptatives", () => {
  const hook = read("app/dashboard/_hooks/useMediaGeneration.ts");
  const generator = read("app/dashboard/_components/MediaGenerator.tsx");
  const generatorStyles = read(
    "app/dashboard/_components/MediaGenerator.module.css"
  );

  assert.deepEqual(
    [...generator.matchAll(/data-generator-block="([^"]+)"/g)].map(
      (match) => match[1]
    ),
    ["subject", "selection", "direction", "finish"]
  );
  assert.match(generator, /className=\{styles\.essentialGrid\}/);
  assert.doesNotMatch(generator, /expandedStep|footerEnginePicker/);
  assert.equal(
    (generator.match(/<RememberPreferenceControl/g) || []).length,
    3
  );
  assert.match(generator, /handleRememberPreferenceGroup/);
  assert.match(generator, /savePreferenceBlock\(1, checked, block1\)/);
  assert.match(generator, /savePreferenceBlock\(2, checked, block2\)/);
  assert.match(generator, /savePreferenceBlock\(3, checked, block3\)/);
  assert.match(generator, /savePreferenceBlock\(4, checked, block4\)/);
  assert.match(generator, /savePreferenceBlock\(5, checked, block5\)/);
  assert.match(generator, /savePreferenceBlock\(6, checked, block6\)/);
  assert.match(generator, /id: "publication"/);
  assert.match(generator, /id: "custom"/);
  assert.match(generator, /id: "profile"/);
  assert.match(generator, /<MediaSubjectVoiceButton/);
  assert.match(
    generator,
    /\(\["ai", "criteria", "real"\] as const\)\.map/
  );
  assert.match(generator, /data-testid="ai-media-criteria-panel"/);
  assert.match(generator, /AI_PEOPLE_CRITERIA\.map/);
  assert.match(generator, /AI_SETTING_CRITERIA\.map/);
  assert.match(generator, /AI_FOCUS_CRITERIA\.map/);
  assert.match(generator, /kind === "image" && imagePurpose !== "auto"/);
  assert.match(generator, /kind === "video" && durationSeconds > 8/);
  assert.match(generator, /\(\["single", "multi"\] as const\)\.map/);
  assert.match(generator, /\["none", "ai_generator_redesign_text_none"\]/);
  assert.match(generator, /\["ai", "ai_generator_redesign_text_ai"\]/);
  assert.match(generator, /\["exact", "ai_generator_redesign_text_exact"\]/);
  assert.match(generator, /ai_generator_brand_colors/);
  assert.match(generator, /ai_generator_logo_label/);
  assert.match(generator, /\(\["voiceover", "characters"\] as const\)\.map/);
  assert.match(generator, /teamVideoSpeechMode === "voiceover" \? \(/);

  const generation = sourceSection(
    generator,
    "const performGeneration",
    "const handleGenerate"
  );
  assert.match(generation, /inputMode: "essential"/);
  assert.match(
    generation,
    /inspirationImages: mediaSourceMode === "real" \? inspirationImages : \[\]/
  );
  assert.match(generation, /generationMode:/);
  assert.match(generation, /peopleCriterion:/);
  assert.match(generation, /settingCriterion:/);
  assert.match(generation, /focusCriterion:/);
  assert.match(generation, /textMode: textMode/);
  assert.match(generation, /exactText: exactText/);
  assert.match(generation, /sceneMode: kind === "video" \? videoSceneMode/);
  assert.match(generation, /connectScenes:/);
  assert.match(hook, /request\.inputMode === "essential"/);

  assert.match(
    generatorStyles,
    /\.essentialGrid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/
  );
  assert.match(
    generatorStyles,
    /\.studioSelect\s*\{[\s\S]*?background-color:\s*#10244a/
  );
  assert.match(
    generatorStyles,
    /\.studioSelect\s*\{[\s\S]*?background-image:\s*url\(/
  );
  assert.match(generatorStyles, /\.essentialCardHeader \.rememberPreference/);
  assert.match(
    generatorStyles,
    /@media \(max-width: 1100px\)[\s\S]*?\.essentialGrid\s*\{[\s\S]*?grid-template-columns:\s*1fr/
  );
});

test("iNrStudio garde toutes les consignes accessibles sur un PC compact", () => {
  const generatorStyles = read(
    "app/dashboard/_components/MediaGenerator.module.css"
  );
  const modalStyles = read(
    "app/dashboard/_components/MediaGeneratorModal.module.css"
  );
  const compactGenerator = sourceSection(
    generatorStyles,
    "@media (min-width: 1101px) and (max-height: 839px)",
    "@media (min-width: 1101px) and (max-height: 760px)"
  );
  const compactModal = sourceSection(
    modalStyles,
    "@media (min-width: 1101px) and (max-height: 839px)",
    "@media (max-width: 620px)"
  );

  assert.match(
    compactGenerator,
    /\.generator\s*\{[\s\S]*?height:\s*auto;[\s\S]*?overflow:\s*visible;/
  );
  assert.match(
    compactGenerator,
    /\.essentialGrid\s*\{[\s\S]*?grid-template-rows:\s*auto auto;[\s\S]*?overflow:\s*visible;/
  );
  assert.match(
    compactGenerator,
    /\.essentialCard\s*\{[\s\S]*?height:\s*auto;[\s\S]*?overflow:\s*visible;/
  );
  assert.match(compactModal, /\.body\s*\{[\s\S]*?overflow-y:\s*auto;/);
});

test("le header mobile sépare l'action et le type de média sur deux lignes", () => {
  const modalStyles = read(
    "app/dashboard/_components/MediaGeneratorModal.module.css"
  );

  assert.match(
    modalStyles,
    /@media \(max-width: 620px\)[\s\S]*?\.heading\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\);[\s\S]*?grid-template-rows:\s*auto auto;/
  );
  assert.match(
    modalStyles,
    /@media \(max-width: 620px\)[\s\S]*?\.heading \.studioTabs\s*\{[\s\S]*?grid-row:\s*1;/
  );
  assert.match(
    modalStyles,
    /@media \(max-width: 620px\)[\s\S]*?\.mediaTypeTabs\s*\{[\s\S]*?grid-row:\s*2;/
  );
});

test("la revue vidéo reste entière dans l'aperçu et en plein écran mobile", () => {
  const generator = read("app/dashboard/_components/MediaGenerator.tsx");
  const generatorStyles = read(
    "app/dashboard/_components/MediaGenerator.module.css"
  );

  assert.match(generator, /resolveAiMediaPreviewFormat\(\{/);
  assert.match(generator, /fallback:\s*generationResult\.format/);
  assert.match(generator, /data-format=\{resultPreviewFormat\}/);
  assert.match(
    generatorStyles,
    /\.previewFrame\s*\{[\s\S]*?position:\s*relative;/
  );
  assert.match(
    generatorStyles,
    /\.previewFrame video\s*\{[\s\S]*?position:\s*absolute;[\s\S]*?inset:\s*0;[\s\S]*?min-width:\s*0;[\s\S]*?min-height:\s*0;[\s\S]*?object-fit:\s*contain\s*!important;[\s\S]*?object-position:\s*50% 50%;/
  );
  assert.match(generator, /<video[\s\S]*?objectFit:\s*"contain"/);
  assert.doesNotMatch(generator, /<video[\s\S]*?objectFit:\s*"cover"/);
  assert.match(
    generatorStyles,
    /\.previewFrame video:fullscreen,\s*\.previewFrame video:-webkit-full-screen,\s*\.previewFrame:fullscreen video,\s*\.previewFrame:-webkit-full-screen video\s*\{[\s\S]*?width:\s*100vw\s*!important;[\s\S]*?height:\s*100vh\s*!important;[\s\S]*?min-width:\s*0\s*!important;[\s\S]*?min-height:\s*0\s*!important;[\s\S]*?object-fit:\s*contain\s*!important;[\s\S]*?object-position:\s*50% 50%\s*!important;[\s\S]*?background:\s*#000\s*!important;/
  );
  assert.match(
    generatorStyles,
    /@media \(max-width: 900px\)[\s\S]*?\.previewFrame\s*\{[\s\S]*?grid-column:\s*1;[\s\S]*?grid-row:\s*2;/
  );
});

test("fermer toute revue exige une confirmation, y compris depuis le Menu", () => {
  const modal = read("app/dashboard/_components/MediaGeneratorModal.tsx");
  const requestClose = sourceSection(
    modal,
    "const requestClose",
    "const cancelClose"
  );

  assert.match(requestClose, /if \(hasExternalHandoff \|\| hasResult\)/);
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

test("iNrStudio reçoit le handoff et retourne le média avec son contexte", () => {
  const studio = read(
    "app/dashboard/generer-media/MediaGeneratorStudioClient.tsx"
  );
  const studioStyles = read(
    "app/dashboard/generer-media/mediaGeneratorStudio.module.css"
  );
  const edition = read("lib/dashboardEdition.ts");
  const desktopMenu = read("app/dashboard/_components/UserMenu.tsx");
  const mobileMenu = read("app/dashboard/_components/ResponsiveBottomNav.tsx");
  const dashboardFr = JSON.parse(read("messages/fr-FR/dashboard.json"));

  assert.match(studio, /<MediaGeneratorModal/);
  assert.match(studio, /source="studio"/);
  assert.match(studio, /readInrStudioHandoff/);
  assert.match(studio, /loadInrStudioHandoffSourceFile/);
  assert.match(studio, /initialTab=\{initialTab\}/);
  assert.match(studio, /initialSource=\{initialSource\}/);
  assert.match(studio, /acceptMode=\{handoff \? "insert" : "library"\}/);
  assert.match(studio, /context: handoff\.context/);
  assert.match(studio, /buildInrStudioReturnHref\(handoff\)/);
  assert.match(studio, /buildInrStudioAbandonHref\(handoff\)/);
  assert.match(studio, /handoffOriginLabel=\{getInrStudioOriginLabel\(handoff\?\.origin\)\}/);
  assert.match(studio, /onAbandonHandoff=\{abandonStudio\}/);
  assert.match(studio, /router\.replace\("\/dashboard\/mediatheque"\)/);
  assert.doesNotMatch(studio, /heroTop|heroBottom|ai_studio_quota_badge/);
  assert.doesNotMatch(studioStyles, /\.heroTop|\.heroBottom|\.sideCard/);
  assert.doesNotMatch(edition, /dashboard\/generer-media/);
  for (const source of [desktopMenu, mobileMenu]) {
    assert.ok(source.includes("/dashboard/generer-media"));
  }
  assert.equal(existsSync("lib/dashboardRequiredSetupAccess.ts"), false);
  assert.equal(existsSync("app/dashboard/generer-media/layout.tsx"), false);
  assert.match(desktopMenu, /mediaGenerator/);
  assert.match(mobileMenu, /mediaGenerator/);
  assert.equal(
    dashboardFr.userMenu.mediaGenerator,
    "Studio Médias",
    "l’entrée du menu global doit utiliser le nom du studio"
  );
});

test("un handoff iNrStudio protège la sortie et utilise un CTA média unique", () => {
  const modal = read("app/dashboard/_components/MediaGeneratorModal.tsx");
  const imageRetoucher = read(
    "app/dashboard/_components/MediaRetoucher.tsx"
  );
  const videoRetoucher = read(
    "app/dashboard/_components/MediaVideoRetoucher.tsx"
  );
  const navigation = read("lib/inrStudioNavigation.ts");

  assert.match(modal, /hasExternalHandoff \|\| hasResult/);
  assert.match(modal, /requestStudioTab/);
  assert.match(modal, /requestMediaType/);
  assert.match(modal, /ai_studio_origin_return/);
  assert.match(modal, /ai_studio_origin_abandon/);
  assert.match(modal, /onAbandonHandoff/);
  assert.match(imageRetoucher, /\? "Utiliser ce média"/);
  assert.match(videoRetoucher, /\? "Utiliser ce média"/);
  assert.match(navigation, /buildInrStudioAbandonHref/);
  assert.match(navigation, /getInrStudioOriginLabel/);
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

test("iNrSend délègue génération, modification et retouche à iNrStudio", () => {
  const details = read(
    "app/dashboard/mails/_components/MailboxDetailsModal.tsx"
  );
  const mailbox = read("app/dashboard/mails/MailboxClient.tsx");

  assert.match(details, /createInrStudioHandoff\(\{/);
  assert.match(details, /tab: "generate"[\s\S]*?origin: "inrsend-publish"/);
  assert.match(mailbox, /openPublicationImageInStudio\([\s\S]*?tab: "modify" \| "retouch"/);
  assert.match(mailbox, /origin: "inrsend-publish"/);
  assert.match(mailbox, /context: \{[\s\S]*?channel,[\s\S]*?imageKey,/);
  assert.match(mailbox, /openPublicationVideoRetoucher/);
  assert.match(mailbox, /mediaType: "video"/);
  assert.match(mailbox, /videoTransformedVariants: video\.transformedVariants/);
  assert.match(details, /openPublicationVideoRetoucher\(activePublicationEntry\.key\)/);
  assert.doesNotMatch(details, /<BoosterVideoFormatManager/);
  assert.match(details, /studioReturn\.action === "retouch" \|\| studioReturn\.action === "modify"/);
  assert.match(details, /imageKey: String\(studioReturn\.context\.imageKey/);
  assert.doesNotMatch(details, /<MediaGeneratorModal/);
  assert.doesNotMatch(mailbox, /MailboxPublicationImageAdapterModal/);
  assert.match(details, /ai_generator_replace_title/);
  assert.match(details, /markPublicationEditDirty/);
  assert.match(
    details,
    /publicationMediaGeneratorBrief[\s\S]*?publicationEditForm\.title[\s\S]*?publicationEditForm\.content/
  );
  assert.match(details, /publicationBrief: publicationMediaGeneratorBrief/);
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
    "ai_generator_instruction_label",
    "ai_generator_instruction_optional",
    "ai_generator_instruction_placeholder",
    "ai_generator_instruction_hint",
    "ai_generator_remember_settings",
    "ai_generator_preferences_saving",
    "ai_generator_preferences_load_error",
    "ai_generator_preferences_save_error",
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
    "ai_generator_video_character_label",
    "ai_generator_video_character_auto",
    "ai_generator_video_character_professional",
    "ai_generator_video_character_brand_avatar",
    "ai_generator_video_character_professional_photo_required",
    "ai_generator_video_character_avatar_reference_required",
    "ai_generator_video_character_consent_label",
    "ai_generator_video_character_consent_hint",
    "ai_generator_video_character_consent_required",
    "ai_generator_footer_consent_title",
    "ai_generator_footer_consent_blocking",
    "ai_generator_footer_consent_confirmed",
    "ai_generator_reference_summary",
    "ai_generator_media_to_animate_title",
    "ai_generator_professional_photos_title",
    "ai_generator_avatar_reference_title",
    "ai_generator_reference_generic_hint",
    "ai_generator_reference_professional_hint",
    "ai_generator_reference_avatar_hint",
    "ai_generator_unlimited",
    "ai_generator_duration_8",
    "ai_generator_duration_16",
    "ai_generator_duration_24",
    "ai_generator_video_engine_title",
    "ai_generator_video_engine_omni",
    "ai_generator_video_engine_omni_hint",
    "ai_generator_video_engine_veo",
    "ai_generator_video_engine_veo_hint",
    "ai_generator_video_engine_result_omni",
    "ai_generator_video_engine_result_veo",
    "ai_generator_video_engine_result_omni_veo_fallback",
    "ai_generator_video_engine_result_veo_omni_fallback",
    "ai_generator_video_engine_result_local_fallback",
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
    "ai_studio_origin_exit_title",
    "ai_studio_origin_exit_description",
    "ai_studio_origin_stay",
    "ai_studio_origin_return",
    "ai_studio_origin_abandon",
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
    "Temps indicatif : iNrCy lit l’ADN de votre entreprise, construit les scènes puis réalise le montage. La durée dépend du format choisi."
  );
  assert.equal(
    media.ai_generator_custom_placeholder,
    "Expliquez ici votre idée et détaillez-la le plus possible pour obtenir un contenu de qualité…"
  );
});

test("les neuf langues distinguent Modifier et Retoucher dans les cartes image", () => {
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
    const shell = JSON.parse(read(`messages/${locale}/shell.json`)) as Record<
      string,
      unknown
    >;
    const agent = JSON.parse(read(`messages/${locale}/agent.json`)) as Record<
      string,
      unknown
    >;
    assert.equal(typeof shell.modifier_image_3f1a7c90, "string", `${locale}: Modifier`);
    assert.equal(typeof shell.adapter_e6b4616c, "string", `${locale}: Retoucher`);
    assert.equal(typeof agent.modifier_f260e757, "string", `${locale}: Modifier Agent`);
    assert.equal(typeof agent.adapt_image, "string", `${locale}: Retoucher Agent`);
  }
});
