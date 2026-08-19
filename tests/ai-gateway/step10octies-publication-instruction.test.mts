import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

test("Step 10 octies adds a separate 50/50 desktop publication instruction field", () => {
  const panel = read(
    "app/dashboard/booster/publier/components/PublishIntentPanel.tsx",
  );

  assert.match(panel, /publicationInstruction:\s*string/);
  assert.match(panel, /setPublicationInstruction/);
  assert.match(
    panel,
    /"minmax\(0, 1fr\) minmax\(0, 1fr\)"/,
  );
  assert.match(panel, /i18nT\("sujet_de_la_publication_obligatoire_pour_62d82326"\)/);
  assert.match(panel, /i18nT\("consigne_ponctuelle_a_l_ia_facultatif_cf850551"\)/);
  assert.match(panel, /i18nT\("prioritaire_sur_votre_configuration_ia_pour_5278e325"\)/);
});

test("Step 10 octies keeps mobile compact with a collapsible instruction", () => {
  const panel = read(
    "app/dashboard/booster/publier/components/PublishIntentPanel.tsx",
  );

  assert.match(panel, /mobileInstructionExpanded/);
  assert.match(panel, /i18nT\("ajouter_une_consigne_a_l_ia_d2a6adfb"\)/);
  assert.match(panel, /i18nT\("consigne_ajoutee_modifier_ee9b29d7"\)/);
  assert.match(panel, /aria-expanded=\{mobileInstructionExpanded\}/);
});

test("Step 10 octies gives both subject and publication instruction their own microphone target", () => {
  const panel = read(
    "app/dashboard/booster/publier/components/PublishIntentPanel.tsx",
  );

  assert.match(panel, /type VoiceTarget = "idea" \| "instruction"/);
  assert.match(panel, /target: "idea"/);
  assert.match(panel, /target: "instruction"/);
  assert.match(panel, /i18nT\("dicter_le_sujet_f14f51b5"\)/);
  assert.match(panel, /i18nT\("dicter_la_consigne_ponctuelle_312b62b3"\)/);
  assert.match(panel, /setVoiceTargetText/);
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
