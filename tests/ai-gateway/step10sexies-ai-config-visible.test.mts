import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

test("Step 10 sexies makes tone, style, commercial level and main goal visibly influential", () => {
  const writing = read("lib/aiWritingProfile.ts");

  for (const marker of [
    "TONE_EXECUTION_DIRECTIVES",
    "TEXT_STYLE_EXECUTION_DIRECTIVES",
    "COMMERCIAL_EXECUTION_DIRECTIVES",
    "MAIN_GOAL_EXECUTION_DIRECTIVES",
    "PREFERRED_ANGLE_EXECUTION_DIRECTIVES",
    "VOICE_EXECUTION_DIRECTIVES",
    "ADDRESS_EXECUTION_DIRECTIVES",
  ]) {
    assert.match(writing, new RegExp(marker));
  }

  assert.match(writing, /PRÉFÉRENCES SOUPLES MAIS VISIBLES/i);
  assert.match(writing, /EXÉCUTION CONFIG IA/i);
  assert.match(writing, /CONFIG IA À RENDRE VISIBLE/i);
  assert.match(writing, /sans imposer de gabarit ni devenir des motifs de rejet technique/i);
});

test("Step 10 sexies gives Booster a real non-blocking emoji policy per requested channel", () => {
  const prompt = read("lib/boosterPrompt.ts");

  assert.match(prompt, /CHANNEL_EMOJI_TARGETS/);
  assert.match(prompt, /buildBoosterEmojiDirective/);
  assert.match(prompt, /POLITIQUE EMOJIS/);
  assert.match(prompt, /EMOJIS BEAUCOUP — INTENSITÉ VISIBLE|BEAUCOUP/);
  assert.match(prompt, /inrcy_site: "0 emoji malgré le niveau Beaucoup/i);
  assert.match(prompt, /linkedin: "2–4 emojis maximum/i);
  assert.match(prompt, /tiktok: "8–12 emojis visibles/i);
  assert.match(prompt, /canaux site restent strictement sans emoji/i);
});

test("Step 10 sexies keeps both full liked-example allowances in the compact Booster payload", () => {
  const prompt = read("lib/boosterPrompt.ts");
  assert.match(prompt, /contenu_apprecie_1: cleanText\(preferences\.likedExample, 1200\)/);
  assert.match(prompt, /contenu_apprecie_2: cleanText\(preferences\.likedExample2, 1200\)/);
  assert.doesNotMatch(prompt, /contenu_apprecie_[12]: cleanText\(preferences\.likedExample2?, 700\)/);
});

test("Step 10 sexies keeps soft style preferences out of repair triggers while allowing targeted dynamic emoji repair", () => {
  const generation = read("lib/boosterPublishGeneration.ts");
  const repairTriggerBlock = generation.match(
    /const REPAIR_TRIGGER_ISSUES = new Set<ChannelQualityIssue>\(\[([\s\S]*?)\]\);/,
  );
  assert.ok(repairTriggerBlock, "repair trigger block must exist");
  const block = repairTriggerBlock[1];
  assert.doesNotMatch(block, /tone|commercial|goal|style/i);
  assert.match(block, /"missing"/);
  assert.match(block, /"meta_leak"/);
  assert.match(block, /"language_mismatch"/);
  assert.match(block, /"emoji_under_target"/);
  assert.match(generation, /niveau emoji Beaucoup déclenchent[\s\S]*seulement un enrichissement non bloquant/i);
});

test("Step 10 sexies keeps engine info and AI configuration surfaces above the mobile dock", () => {
  const infoModal = read("app/dashboard/_components/AiEngineInfoModal.tsx");
  const aiConfig = read("app/dashboard/settings/_components/AiConfigurationContent.tsx");
  const publishDrawer = read("app/dashboard/booster/publier/components/PublishAiConfigurationDrawer.tsx");
  const dashboardDrawer = read("app/dashboard/_components/DashboardSettingsDrawerContent.tsx");
  const configurationPage = read("app/dashboard/configuration-ia/page.tsx");
  const workspaceHeader = read("app/dashboard/_components/DashboardWorkspaceHeader.tsx");

  assert.match(infoModal, /MOBILE_DOCK_HEIGHT/);
  assert.match(infoModal, /bottom:\s*MOBILE_DOCK_HEIGHT/);
  assert.match(infoModal, /calc\(100dvh - \$\{MOBILE_DOCK_HEIGHT\}\)/);
  assert.match(infoModal, /calc\(100dvh - \$\{MOBILE_DOCK_HEIGHT\} - 32px\)/);

  assert.match(aiConfig, /onSaved\?: \(\) => void/);
  assert.match(aiConfig, /i18nT\("configuration_ia_enregistree_1ad4bba6"\)/);
  assert.match(aiConfig, /window\.setTimeout\(\(\) => onSaved\(\), 900\)/);
  assert.match(
    publishDrawer,
    /onSaved=\{\(\) => \{[\s\S]*setHasUnsavedChanges\(false\);[\s\S]*onClose\(\);[\s\S]*\}\}/,
  );
  assert.match(publishDrawer, /onUnsavedChange=\{setHasUnsavedChanges\}/);
  assert.match(configurationPage, /data-ai-configuration-page/);
  assert.match(configurationPage, /<AiConfigurationContent/);
  assert.match(configurationPage, /onUnsavedChange=\{setHasUnsavedChanges\}/);
  assert.match(workspaceHeader, /max\(90px, calc\(34px \+ var\(--inrcy-safe-area-bottom\)\)\)/);
  assert.doesNotMatch(dashboardDrawer, /<AiConfigurationContent/);
  assert.doesNotMatch(dashboardDrawer, /guidedOnboarding|onOnboarding/);
});
