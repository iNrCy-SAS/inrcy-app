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
    assert.ok(index > previousIndex, `${token} doit rester dans l'ordre attendu`);
    previousIndex = index;
  }
}

test("Booster utilise le générateur partagé et réinsère le média validé", () => {
  const hook = read("app/dashboard/_hooks/useMediaGeneration.ts");
  const publishModal = read("app/dashboard/booster/publier/PublishModal.tsx");
  const intentPanel = read("app/dashboard/booster/publier/components/PublishIntentPanel.tsx");
  const mediaPanel = read("app/dashboard/booster/publier/components/PublishImagesPanel.tsx");

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
    "withMusic",
    "source",
  ]) {
    assert.ok(hook.includes(field), `${field} doit rester dans le contrat client`);
  }
  assert.doesNotMatch(hook, /\binstruction\b/);

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
      "app/dashboard/booster/publier/components/PublishMediaGeneratorModal.tsx",
    ),
    false,
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
    /const reset = useCallback\(\(\) => \{\s*pendingGenerationAttemptRef\.current = null/,
  );
  assert.match(hook, /current >= 99/);
  assert.match(hook, /Math\.min\(99, current \+ 1\)/);
  assert.doesNotMatch(hook, /current >= 92|Math\.min\(92,/);
});

test("la modale partagée guide en trois choix puis affiche une grande revue explicite", () => {
  const generator = read("app/dashboard/_components/MediaGenerator.tsx");
  const generatorStyles = read("app/dashboard/_components/MediaGenerator.module.css");
  const modal = read("app/dashboard/_components/MediaGeneratorModal.tsx");
  const modalStyles = read("app/dashboard/_components/MediaGeneratorModal.module.css");

  for (const source of ["publication", "profile", "custom"] as const) {
    assert.ok(generator.includes(`\"${source}\"`), `${source} doit être proposé`);
  }
  assert.match(
    generator,
    /const subjectChoices:[\s\S]*?id: "publication"[\s\S]*?disabled: !publicationAvailable/,
  );
  assert.match(generator, /disabled=\{busy \|\| finishing \|\| choice\.disabled\}/);
  assert.match(generator, /ai_generator_subject_publication_unavailable/);
  for (const key of [
    "ai_generator_step_subject",
    "ai_generator_step_kind",
    "ai_generator_step_option",
    "ai_generator_with_text",
    "ai_generator_without_text",
    "ai_generator_with_music",
    "ai_generator_without_music",
  ]) {
    assert.ok(generator.includes(key), `${key} doit être présent`);
  }
  assert.match(generator, /acceptMode === "insert"/);
  assert.match(generator, /await onAccepted\(result\)/);
  assert.match(generator, /ai_generator_confirm_insert/);
  assert.match(generator, /ai_generator_open_library/);
  assert.match(generator, /ai_generator_regenerate/);
  assert.match(generator, /ai_generator_saved_automatically/);
  assert.match(generator, /ai_generator_video_timing_hint/);
  assert.match(generator, /ai_generator_image_timing_hint/);
  assert.match(generator, /progress >= 99/);
  assert.match(generator, /ai_generator_stage_patience/);
  assert.match(generator, /generationResult\.item\.media_type === "video"/);
  assert.match(generator, /<video[\s\S]*?controls[\s\S]*?playsInline/);
  assert.match(generator, /<img[\s\S]*?generationResult\.item\.signed_url/);
  assert.doesNotMatch(generator, /resultInfo|resultCaption|result\.prompt/);

  const quotaIndex = generator.indexOf("className={styles.quotaCard}");
  const resultIndex = generator.indexOf("{generationResult ? (");
  assert.ok(quotaIndex >= 0 && resultIndex > quotaIndex, "le quota reste visible avant l'aperçu");

  const dialogWidth = modalStyles.match(/\.dialog\s*\{[\s\S]*?width:\s*min\((\d+)px,\s*100%\)/)?.[1];
  assert.ok(dialogWidth && Number(dialogWidth) >= 720, "la modale doit rester compacte mais confortable");
  const previewWidth = generatorStyles.match(/\.previewFrame\s*\{[\s\S]*?width:\s*min\(100%,\s*(\d+)px\)/)?.[1];
  assert.ok(previewWidth && Number(previewWidth) >= 600, "l'aperçu doit rester lisible");
  assert.match(generatorStyles, /object-fit:\s*contain/);
  assert.match(modal, /createPortal/);
  assert.match(modal, /role="dialog"/);
});

test("fermer toute revue exige une confirmation, y compris depuis le Menu", () => {
  const modal = read("app/dashboard/_components/MediaGeneratorModal.tsx");
  const requestClose = sourceSection(modal, "const requestClose", "const cancelClose");

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
  const studio = read("app/dashboard/generer-media/MediaGeneratorStudioClient.tsx");
  const studioStyles = read("app/dashboard/generer-media/mediaGeneratorStudio.module.css");
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
  const intentPanel = read("app/dashboard/booster/publier/components/PublishIntentPanel.tsx");
  const mediaPanel = read("app/dashboard/booster/publier/components/PublishImagesPanel.tsx");

  const topActions = sourceSection(
    intentPanel,
    "onClick={onPickImagesClick}",
    "{videoPreviewUrl && videoFile ? (",
  );
  const lowerActions = sourceSection(
    mediaPanel,
    "onClick={onPickImagesClick}",
    "{imgError ? (",
  );
  const sharedOrderedTokens = [
    "ajouter_une_video",
    "onGenerateMedia",
    "onOpenMediaLibrary",
    "onTakePhotoClick",
  ];
  assertOrdered(topActions, ["ajouter_des_images", ...sharedOrderedTokens]);
  assertOrdered(lowerActions, ["ajouter_une_image", ...sharedOrderedTokens]);
  assert.equal((topActions.match(/ai_generator_generate_media/g) || []).length >= 1, true);
  assert.equal((lowerActions.match(/ai_generator_generate_media/g) || []).length >= 1, true);
});

test("iNrSend réutilise la modale partagée en édition", () => {
  const details = read("app/dashboard/mails/_components/MailboxDetailsModal.tsx");

  assert.match(details, /<MediaGeneratorModal/);
  assert.match(details, /source="booster"/);
  assert.match(details, /origin="inrsend"/);
  assert.match(details, /acceptMode="insert"/);
  assert.match(details, /ai_generator_replace_title/);
  assert.match(details, /markPublicationEditDirty/);
  assert.match(
    details,
    /publicationMediaGeneratorBrief[\s\S]*?publicationEditForm\.title[\s\S]*?publicationEditForm\.content/,
  );
  assert.match(
    details,
    /publicationBrief=\{publicationMediaGeneratorBrief\}/,
  );
});

test("toutes les langues contiennent la copie complète de la modale", () => {
  const requiredKeys = [
    "ai_generator_modal_title",
    "ai_generator_modal_subtitle",
    "ai_generator_step_subject",
    "ai_generator_subject_publication",
    "ai_generator_subject_publication_unavailable",
    "ai_generator_subject_profile",
    "ai_generator_subject_custom",
    "ai_generator_step_kind",
    "ai_generator_step_option",
    "ai_generator_generate_media",
    "ai_generator_with_text",
    "ai_generator_without_text",
    "ai_generator_with_music",
    "ai_generator_without_music",
    "ai_generator_confirm_insert",
    "ai_generator_regenerate",
    "ai_generator_image_timing_hint",
    "ai_generator_video_timing_hint",
    "ai_generator_saved_automatically",
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
