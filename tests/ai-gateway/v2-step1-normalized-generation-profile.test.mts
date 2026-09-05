import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

test("V2 step 1 centralizes professional preferences, activity, request and media context", () => {
  const source = read("lib/aiGenerationProfile.ts");
  for (const field of [
    "engine",
    "language",
    "tone",
    "communicationStyle",
    "creativity",
    "length",
    "emojiLevel",
    "voice",
    "addressMode",
    "commercialLevel",
    "mainGoal",
    "preferredAngle",
    "preferredCta",
    "likedExample",
    "likedExample2",
    "customInstructions",
  ]) {
    assert.match(source, new RegExp(`\\b${field}\\b`), field);
  }
  for (const field of [
    "companyName",
    "sectorLabel",
    "professionLabel",
    "description",
    "services",
    "interventionZones",
    "idea",
    "theme",
    "style",
    "media",
  ]) {
    assert.match(source, new RegExp(`\\b${field}\\b`), field);
  }
});

test("legacy AI preference keys converge into the canonical profile", () => {
  const source = read("lib/aiGenerationProfile.ts");
  for (const legacyKey of [
    "ai_tone",
    "ai_pronoun",
    "ai_audience_relation",
    "ai_emoji_level",
    "ai_content_length",
    "ai_cta_preference",
  ]) {
    assert.match(source, new RegExp(legacyKey), legacyKey);
  }
});

test("Booster creates one canonical profile and reuses it in primary generation and the single targeted repair", () => {
  const source = read("lib/boosterPublishGeneration.ts");
  assert.match(source, /const baseGenerationProfile = buildNormalizedAiGenerationProfile\(/);
  assert.match(source, /const generationProfile: NormalizedAiGenerationProfile = \{/);
  assert.match(source, /engine: args\.generationProfile\.preferences\.engine/);
  assert.match(source, /compileBoosterGenerationPrompt\(\{/);
  assert.match(source, /generationProfile: args\.generationProfile/);
  assert.match(source, /system: compiledPrompt\.system/);
  assert.match(source, /input: compiledPrompt\.input/);
  assert.match(source, /generationProfile: args\.generationProfile/);
  assert.match(source, /async function repairChannelsOnce\(/);
  assert.match(source, /mode: "repair"/);
  assert.match(source, /generationProfile,\s*\n\s*recentPublications: args\.recentPublications/);
  assert.doesNotMatch(source, /buildCompactYoutubeContext|youtube-rescue-/);
});

test("shared writing modules consume the same canonical profile", () => {
  const files = [
    "lib/templateAiGeneration.ts",
    "app/api/mails/generate-ai/route.ts",
    "app/api/e-reputation/google/generate-reply/route.ts",
    "app/api/agent/actions/send-stats-report/route.ts",
    "app/api/booster/transcribe/route.ts",
  ];
  for (const file of files) {
    assert.match(read(file), /buildNormalizedAiGenerationProfile\(/, file);
  }
});
