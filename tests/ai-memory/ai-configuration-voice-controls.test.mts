import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

test("Configuration IA keeps brand vocabulary in Business DNA and clarifies channel lengths", () => {
  const configuration = read("app/dashboard/settings/_components/AiConfigurationContent.tsx");

  assert.doesNotMatch(configuration, /preferredVocabulary|forbiddenVocabulary|data-ai-vocabulary/);
  assert.doesNotMatch(configuration, /fetch\("\/api\/ai-memory"/);
  assert.match(configuration, /memoryT\("contentLengthTitle"\)/);
  assert.match(configuration, /memoryT\("webLengthLabel"\)/);
  assert.match(configuration, /memoryT\("socialLengthLabel"\)/);
  assert.match(configuration, /data-content-length-group/);
});

test("technicality and humour are persisted and consumed by every shared writing prompt", () => {
  const configuration = read("app/dashboard/settings/_components/AiConfigurationContent.tsx");
  const compatibility = read("lib/aiConfigurationCompatibility.ts");
  const profile = read("lib/aiGenerationProfile.ts");
  const writing = read("lib/aiWritingProfile.ts");
  const boosterPrompt = read("lib/boosterPrompt.ts");
  const migration = read("ops/sql/2026-09-04_ai_memory_and_channel_lengths.sql");

  assert.match(compatibility, /technicalityLevel: "accessible" \| "balanced" \| "expert"/);
  assert.match(compatibility, /humorLevel: "none" \| "light" \| "present"/);
  assert.match(configuration, /ai_technicality_level: form\.technicalityLevel/);
  assert.match(configuration, /ai_humor_level: form\.humorLevel/);
  assert.match(profile, /technicalityLevel: AiTechnicalityLevel/);
  assert.match(profile, /humorLevel: AiHumorLevel/);
  assert.match(profile, /"ai_technicality_level"/);
  assert.match(profile, /"ai_humor_level"/);
  assert.match(writing, /TECHNICALITY_EXECUTION_DIRECTIVES/);
  assert.match(writing, /HUMOR_EXECUTION_DIRECTIVES/);
  assert.match(writing, /Niveau de technicité/);
  assert.match(writing, /Humour/);
  assert.match(boosterPrompt, /niveau_technicite: preferences\.technicalityLevel/);
  assert.match(boosterPrompt, /humour: preferences\.humorLevel/);
  assert.match(migration, /add column if not exists ai_technicality_level text not null default 'balanced'/);
  assert.match(migration, /add column if not exists ai_humor_level text not null default 'none'/);
});

test("all dashboard catalogues expose the new AI configuration labels", () => {
  const locales = ["fr-FR", "en-GB", "es-ES", "it-IT", "de-DE", "nl-NL", "pt-PT", "th-TH", "zh-CN"];
  const requiredMemoryKeys = ["contentLengthTitle", "webLengthLabel", "socialLengthLabel"];
  const requiredConfigurationKeys = [
    "technicalityLabel",
    "technicalityAccessible",
    "technicalityBalanced",
    "technicalityExpert",
    "humorLabel",
    "humorNone",
    "humorLight",
    "humorPresent",
  ];

  for (const locale of locales) {
    const catalogue = JSON.parse(read(`messages/${locale}/dashboard.json`));
    for (const key of requiredMemoryKeys) {
      assert.equal(typeof catalogue.aiMemory[key], "string", `${locale}.aiMemory.${key}`);
    }
    for (const key of requiredConfigurationKeys) {
      assert.equal(typeof catalogue.aiConfiguration[key], "string", `${locale}.aiConfiguration.${key}`);
    }
  }
});

test("Configuration IA keeps text-only menu entries and the historical yellow IA monogram elsewhere", () => {
  const menu = read("app/dashboard/_components/UserMenu.tsx");
  const mobileMenu = read("app/dashboard/_components/ResponsiveBottomNav.tsx");
  const businessDnaPage = read("app/dashboard/adn-entreprise/page.tsx");
  const profilePage = read("app/dashboard/mon-profil/page.tsx");
  const configurationDrawer = read("app/dashboard/booster/publier/components/PublishAiConfigurationDrawer.tsx");
  const icon = read("app/dashboard/_components/AiConfigurationIcon.tsx");

  assert.doesNotMatch(menu, /AiConfigurationIcon/);
  assert.match(menu, /onClick=\{\(\) => closeAndOpen\("ia"\)\}[\s\S]*?\{t\.userMenu\.ai\}/);
  const mobileConfigurationEntry = mobileMenu.slice(
    mobileMenu.indexOf("label={t.userMenu.ai}"),
    mobileMenu.indexOf("label={t.userMenu.aiMemory}"),
  );
  assert.doesNotMatch(mobileConfigurationEntry, /AiConfigurationIcon|\bicon=/);
  assert.doesNotMatch(businessDnaPage, /AiConfigurationIcon|\bicon:/);
  assert.doesNotMatch(profilePage, /AiConfigurationIcon|\bicon:/);
  assert.doesNotMatch(configurationDrawer, /AiConfigurationIcon/);
  assert.match(configurationDrawer, /<h2[\s\S]*?\{i18nT\("configuration_ia_f620c8d8"\)\}/);
  assert.match(icon, />\s*IA\s*<\/span>/);
  assert.match(icon, /color: "#fde68a"/);
  assert.match(icon, /fontWeight: 950/);
  assert.match(icon, /textShadow: "0 0 14px rgba\(250,204,21,0\.50\)"/);
  assert.doesNotMatch(icon, /<img|ai-configuration\.svg/);
});
