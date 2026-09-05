import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import { AI_ENGINE_OPTIONS } from "../../lib/aiEnginePreference.ts";
import { AI_FEATURE_POLICIES } from "../../lib/aiGatewayPolicy.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (rel: string) => readFileSync(resolve(ROOT, rel), "utf8");

test("Step 6 ter separates hard rules from soft editorial preferences", () => {
  const profile = read("lib/aiWritingProfile.ts");
  assert.match(profile, /RÈGLES DURES/i);
  assert.match(profile, /PRÉFÉRENCES SOUPLES/i);
  assert.match(profile, /personnalité et une direction, pas une recette/i);
  assert.match(profile, /CTA séparé n'est pas obligatoire/i);
  assert.match(profile, /Ne jamais réécrire un bon texte uniquement pour le faire rentrer dans un gabarit/i);
});

test("all eight selectable engines receive explicit permission to keep a native editorial voice", () => {
  const profile = read("lib/aiWritingProfile.ts");
  assert.equal(AI_ENGINE_OPTIONS.length, 8);
  for (const engine of AI_ENGINE_OPTIONS) {
    assert.match(profile, new RegExp(`${engine.value}:`));
  }
  assert.match(profile, /Exploite ta propre voix et ton propre jugement éditorial/i);
  assert.match(profile, /Ne cherche pas à imiter ChatGPT, Claude, Gemini, Mistral, Grok, Perplexity, DeepSeek, Llama/i);
});

test("creative latitude follows the user's originality setting without changing hard constraints", () => {
  const profile = read("lib/aiWritingProfile.ts");
  assert.match(profile, /LIBERTÉ ÉLEVÉE/i);
  assert.match(profile, /LIBERTÉ MODÉRÉE/i);
  assert.match(profile, /LIBERTÉ ÉQUILIBRÉE/i);
  assert.match(profile, /ai_creativity/i);
});

test("Booster keeps airy paragraphs and makes dynamic emojis channel-aware", () => {
  const prompt = read("lib/boosterPrompt.ts");
  assert.match(prompt, /paragraphes courts pour TOUS les canaux/i);
  assert.match(prompt, /deux sauts de ligne consécutifs/i);
  assert.match(prompt, /laisser le moteur choisir librement le nombre de paragraphes utile/i);
  assert.match(prompt, /Les repères ci-dessous pilotent réellement la quantité attendue/i);
  assert.match(prompt, /Pour BEAUCOUP, respecte au moins le bas de la plage/i);
  assert.match(prompt, /canaux site restent strictement sans emoji/i);
  assert.match(prompt, /facebook:\s*"6–10 emojis visibles/i);
  assert.match(prompt, /instagram:\s*"8–12 emojis visibles/i);
  assert.match(prompt, /inrcy_site:\s*"0 emoji malgré le niveau Beaucoup/i);
  assert.doesNotMatch(prompt, /3 à 5 emojis obligatoires/i);
  assert.doesNotMatch(prompt, /4 à 8 emojis obligatoires/i);
});

test("CTA is no longer a reason to rewrite an otherwise publishable Booster result", () => {
  const generation = read("lib/boosterPublishGeneration.ts");
  const prompt = read("lib/boosterPrompt.ts");
  assert.match(generation, /collectChannelQualityIssues\(/);
  assert.match(generation, /hasCorePublishableContent\(channel, post\)/);
  assert.doesNotMatch(generation, /missingCta|cta_missing|missing_cta/);
  assert.match(prompt, /La clé cta doit toujours exister mais peut contenir ""/i);
  assert.match(prompt, /Le CTA préféré est une orientation, pas une obligation/i);
});

test("anti-duplication only regenerates quasi copies instead of normal same-topic vocabulary", () => {
  const generation = read("lib/boosterPublishGeneration.ts");
  assert.match(generation, /jaccard >= 0\.92/);
  assert.match(generation, /lengthRatio >= 0\.86/);
  assert.match(generation, /Seules les copies quasi/i);
});

test("mail and campaign generators no longer force the same salutation-CTA-ending template", () => {
  const templates = read("lib/templateAiGeneration.ts");
  const mails = read("app/api/mails/generate-ai/route.ts");
  assert.match(templates, /Salutation, CTA séparé et formule de fin ne sont pas obligatoires/i);
  assert.match(templates, /ne reproduis pas automatiquement la structure du modèle de départ/i);
  assert.match(mails, /une salutation et une fin simple sont possibles mais pas obligatoires/i);
});

test("engine preference is passed into shared writing-freedom rules across writing modules", () => {
  const files = [
    "lib/boosterPrompt.ts",
    "lib/templateAiGeneration.ts",
    "app/api/mails/generate-ai/route.ts",
    "app/api/e-reputation/google/generate-reply/route.ts",
  ];
  for (const file of files) {
    const source = read(file);
    assert.match(
      source,
      /buildAiWritingProfileRules\([\s\S]*preferredEngine|buildAiWritingProfileRules\([\s\S]*getAiPreferredEngineFromBusiness|buildCompactAiWritingDirective\([\s\S]*preferences\.engine/i,
      file,
    );
  }
});

test("token budgets keep safe headroom while generated channel ceilings stay centralized", () => {
  assert.equal(AI_FEATURE_POLICIES["booster.publish"].maxOutputTokens, 12_000);
  assert.equal(AI_FEATURE_POLICIES["agent.publish"].maxOutputTokens, 12_000);
  assert.equal(AI_FEATURE_POLICIES["templates.generate"].maxOutputTokens, 3000);

  const generation = read("lib/boosterPublishGeneration.ts");
  const channelRules = read("lib/boosterChannelRules.ts");
  assert.match(generation, /limitBoosterGeneratedContent/);
  assert.match(channelRules, /inrcy_site:[\s\S]*?max:\s*4200/);
  assert.match(channelRules, /site_web:[\s\S]*?max:\s*5000/);
  assert.match(channelRules, /pinterest:[\s\S]*?max:\s*500/);
  assert.match(generation, /getBoosterContentLengthForChannel/);
  assert.match(generation, /Math\.ceil\(rule\.max \/ estimatedCharsPerToken\) \+ 260/);
  assert.match(generation, /languageCode === "zh"[\s\S]*?1\.15[\s\S]*?languageCode === "th"[\s\S]*?1\.6/);
  assert.match(generation, /Math\.max\(baseBudget, applyAiEngineOutputTokenCalibration\(baseBudget, engine\)\)/);
  assert.match(generation, /Math\.min\(12_000, getAiEngineOutputTokenLimit\(engine\)\)/);
});

test("iNrAgent publishing explicitly preserves the selected engine's native voice", () => {
  const agent = read("app/api/agent/actions/prepare-publish/route.ts");
  assert.match(agent, /Préserve la voix native du moteur IA choisi par l'établissement/i);
  assert.match(agent, /un CTA séparé reste facultatif/i);
});


test("creative synonym reformulations and normal same-topic overlap are advisory only", () => {
  const generation = read("lib/boosterPublishGeneration.ts");
  assert.match(
    generation,
    /const REPAIR_TRIGGER_ISSUES = new Set<ChannelQualityIssue>\(\[[\s\S]*"missing"[\s\S]*"meta_leak"[\s\S]*"language_mismatch"[\s\S]*"too_short_editorial"[\s\S]*\]\);/,
  );
  assert.match(generation, /advisoryChannels/);
  assert.match(generation, /!REPAIR_TRIGGER_ISSUES\.has\(issue\)/);
  assert.match(generation, /L'ancrage lexical exact est volontairement non bloquant/i);
  assert.match(generation, /unsafe channels after single repair/);
  assert.doesNotMatch(generation, /attempt > 0/);
});


test("long and deep Booster lengths are strong editorial targets but never final 502 conditions", () => {
  const prompt = read("lib/boosterPrompt.ts");
  const generation = read("lib/boosterPublishGeneration.ts");
  const channelRules = read("lib/boosterChannelRules.ts");

  assert.match(prompt, /long: "LONG"/i);
  assert.match(prompt, /deep: "APPROFONDI PREMIUM"/i);
  assert.match(prompt, /PRIORITÉ ÉDITORIALE/i);
  assert.match(prompt, /formatBoosterGeneratedContentRule/);
  assert.match(prompt, /maximum absolu propre à chaque canal/i);
  assert.match(channelRules, /site_web:[\s\S]*?long:\s*\{ min:\s*1800, max:\s*2800 \}[\s\S]*?deep:\s*\{ min:\s*3000, max:\s*4500 \}[\s\S]*?max:\s*5000/i);
  assert.match(channelRules, /youtube_shorts:[\s\S]*?long:\s*\{ min:\s*1000, max:\s*1700 \}[\s\S]*?deep:\s*\{ min:\s*1700, max:\s*2500 \}[\s\S]*?max:\s*2800/i);
  assert.match(prompt, /Les plages ci-dessous concernent exclusivement le champ content/i);

  assert.match(generation, /CHANNEL_DETAILED_ENRICHMENT_MIN/);
  assert.match(generation, /too_short_editorial/);
  assert.match(generation, /Une longueur éditoriale encore inférieure à la cible ne provoque jamais/i);
  assert.match(generation, /improvesLength/);
});
