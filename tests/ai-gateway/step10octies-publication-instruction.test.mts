import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

test("the desktop brief keeps separate subject and instruction fields with more room for the subject", () => {
  const panel = read(
    "app/dashboard/booster/publier/components/PublishIntentPanel.tsx",
  );

  assert.match(panel, /publicationInstruction:\s*string/);
  assert.match(panel, /setPublicationInstruction/);
  assert.match(
    read("app/dashboard/booster/publier/components/PublishIntentPanel.module.css"),
    /\.writing\s*\{[^}]*grid-template-columns: minmax\(0, 1\.2fr\) minmax\(0, 1fr\)/,
  );
  assert.match(panel, /i18nT\("sujet_de_la_publication_obligatoire_pour_62d82326"\)/);
  assert.match(panel, /i18nT\("consigne_ponctuelle_a_l_ia_facultatif_cf850551"\)/);
  assert.match(panel, /i18nT\("prioritaire_sur_votre_configuration_ia_pour_5278e325"\)/);
});

test("the mobile brief keeps both fields available in one scrollable column", () => {
  const panel = read(
    "app/dashboard/booster/publier/components/PublishIntentPanel.tsx",
  );

  assert.match(panel, /target: "idea"/);
  assert.match(panel, /target: "instruction"/);
  assert.match(panel, /wizard_brief_instruction/);
  const styles = read("app/dashboard/booster/publier/components/PublishIntentPanel.module.css");
  assert.match(styles, /@media \(max-width: 700px\)/);
  assert.match(styles, /grid-template-rows: repeat\(2, minmax\(155px, auto\)\)/);
  const wizardStyles = read("app/dashboard/booster/publier/components/publishWizard.module.css");
  assert.match(wizardStyles, /data-current-step="intention"[^\n]*overflow-y: auto/);
});

test("Step 10 octies gives both subject and publication instruction their own microphone target", () => {
  const panel = read(
    "app/dashboard/booster/publier/components/PublishIntentPanel.tsx",
  );
  const sharedVoiceButton = read(
    "app/dashboard/_components/MediaSubjectVoiceButton.tsx",
  );

  assert.match(panel, /type VoiceTarget = "idea" \| "instruction"/);
  assert.match(panel, /target: "idea"/);
  assert.match(panel, /target: "instruction"/);
  assert.match(panel, /import MediaSubjectVoiceButton/);
  assert.match(
    panel,
    /purpose=\{args\.target === "idea" \? "subject" : "instruction"\}/,
  );
  assert.match(panel, /onBusyChange=\{\(busy\) =>[\s\S]*?handleVoiceBusyChange/);
  assert.match(sharedVoiceButton, /purpose === "instruction"/);
  assert.match(sharedVoiceButton, /voice_instruction_title/);
  assert.match(sharedVoiceButton, /voice_subject_title/);
  assert.doesNotMatch(panel, /\bMediaRecorder\b|\bgetUserMedia\b/);
  assert.doesNotMatch(panel, /fetch\([\s\S]*?\/api\/booster\/transcribe/);
});

test("Step 10 octies saves, restores, resets and submits the one-publication instruction", () => {
  const modal = read("app/dashboard/booster/publier/PublishModal.tsx");
  const route = read("app/api/booster/generate/route.ts");

  assert.match(modal, /const \[publicationInstruction, setPublicationInstruction\]/);
  assert.match(modal, /payload\.publicationInstruction/);
  assert.match(modal, /setPublicationInstruction\(nextPublicationInstruction\)/);
  assert.match(modal, /setPublicationInstruction\(""\)/);
  assert.ok(
    (modal.match(/publicationInstruction:\s*publicationInstruction\.trim\(\)/g) || [])
      .length >= 3,
  );
  assert.match(route, /publicationInstruction\?: string/);
  assert.match(route, /slice\(0, 4_000\)/);
  assert.match(route, /publicationInstruction,\s*\n\s*theme/);
});

test("Step 10 octies makes the local instruction priority without adding a punitive validator", () => {
  const prompt = read("lib/boosterPrompt.ts");
  const generation = read("lib/boosterPublishGeneration.ts");

  assert.match(prompt, /CONSIGNE PONCTUELLE PRIORITAIRE/);
  assert.match(prompt, /prioritaire sur la Configuration IA générale/i);
  assert.match(prompt, /message direct du pro au moteur IA actif/i);
  assert.match(prompt, /propre jugement d’auteur/i);
  assert.match(prompt, /remplace temporairement les réglages généraux/i);
  assert.match(prompt, /ne peut jamais autoriser l’invention de faits/i);
  assert.match(generation, /applyPublicationInstructionOverrides/);
  assert.match(generation, /detectPublicationInstructionLanguage/);
  assert.match(generation, /detectPublicationInstructionLength/);
  assert.match(generation, /detectPublicationInstructionEmojiLevel/);

  const triggerBlock = generation.match(
    /const REPAIR_TRIGGER_ISSUES = new Set<ChannelQualityIssue>\(\[([\s\S]*?)\]\);/,
  );
  assert.ok(triggerBlock);
  assert.doesNotMatch(triggerBlock[1], /publicationInstruction|instruction/i);
});

test("Step 10 octies propagates the same instruction through primary, repair and model fallback prompts", () => {
  const generation = read("lib/boosterPublishGeneration.ts");
  const prompt = read("lib/boosterPrompt.ts");

  assert.ok(
    (generation.match(/publicationInstruction:\s*args\.publicationInstruction/g) || [])
      .length >= 4,
  );
  assert.match(generation, /compileBoosterGenerationPrompt\(\{/);
  assert.match(prompt, /boosterSystemPrompt\([\s\S]*?args\.generationProfile,[\s\S]*?args\.publicationInstruction/);
  assert.match(prompt, /const core = boosterUserPrompt\(args\)/);
});
