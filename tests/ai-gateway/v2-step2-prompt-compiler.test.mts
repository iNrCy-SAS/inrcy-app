import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

test("V2 step 2 routes Booster and iNrAgent generation through one compact prompt compiler", () => {
  const prompt = read("lib/boosterPrompt.ts");
  const generation = read("lib/boosterPublishGeneration.ts");

  assert.match(prompt, /export function compileBoosterGenerationPrompt\(/);
  assert.match(generation, /const compiledPrompt = compileBoosterGenerationPrompt\(\{/);
  assert.match(generation, /system: compiledPrompt\.system/);
  assert.match(generation, /input: compiledPrompt\.input/);
});

test("V2 step 2 sends editorial contracts only for requested channels", () => {
  const prompt = read("lib/boosterPrompt.ts");

  assert.match(prompt, /CONTRATS DES SEULS CANAUX DEMANDÉS/);
  assert.match(prompt, /formatCompactChannelContracts\(args\.channels\)/);
  assert.match(prompt, /buildBoosterLengthDirective\(preferences, args\.channels\)/);
  assert.match(prompt, /Array\.from\(new Set\(channels\)\)/);
  assert.doesNotMatch(prompt, /CHANNEL_EDITORIAL_PLAYBOOKS/);
  assert.doesNotMatch(prompt, /CHANNEL_EDITORIAL_SPECS/);
});

test("V2 step 2 keeps professional preferences and native engine personality without the former duplicated manual", () => {
  const prompt = read("lib/boosterPrompt.ts");
  const writingProfile = read("lib/aiWritingProfile.ts");

  for (const key of [
    "langue",
    "ton",
    "style_communication",
    "creativite",
    "longueur",
    "emojis",
    "voix",
    "relation_lecteur",
    "intensite_commerciale",
    "objectif",
    "angle_prefere",
    "cta_prefere",
    "contenu_apprecie_1",
    "contenu_apprecie_2",
    "a_eviter",
  ]) {
    assert.match(prompt, new RegExp(`\\b${key}\\b`), key);
  }

  assert.match(prompt, /buildCompactAiWritingDirective\(/);
  assert.match(writingProfile, /export function buildCompactAiWritingDirective\(/);
  assert.match(writingProfile, /ENGINE_NATIVE_FREEDOM\[engineOption\.value\]/);
  assert.match(prompt, /iNrCy impose les faits, la conformité et les préférences, pas une recette éditoriale uniforme/i);
});

test("V2 step 2 bounds media context and preserves free-intent priority", () => {
  const prompt = read("lib/boosterPrompt.ts");

  assert.match(prompt, /compactLongPromptContext\(args\.mediaContext, 5_000\)/);
  assert.match(prompt, /compactLongPromptContext\(args\.extraInstructions, 2_000\)/);
  assert.match(prompt, /Phrase libre prioritaire/);
  assert.match(prompt, /La phrase libre reste prioritaire/);
  assert.match(prompt, /Une image ambiguë ou hors sujet peut être ignorée/);
});

test("V2 step 2 removes obsolete prompt duplication helpers", () => {
  const prompt = read("lib/boosterPrompt.ts");
  const generation = read("lib/boosterPublishGeneration.ts");

  assert.doesNotMatch(prompt, /formatChannelPlaybooks/);
  assert.doesNotMatch(prompt, /formatChannelEditorialSpecs/);
  assert.doesNotMatch(generation, /buildStrictLanguageGenerationInstructions/);
  assert.doesNotMatch(generation, /buildImageGenerationInstructions/);
});
