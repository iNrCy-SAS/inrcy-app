import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) => readFileSync(path, "utf8");

function sourceSection(source: string, startToken: string, endToken: string) {
  const start = source.indexOf(startToken);
  assert.ok(start >= 0, `${startToken} doit être présent`);
  const end = source.indexOf(endToken, start + startToken.length);
  assert.ok(end > start, `${endToken} doit suivre ${startToken}`);
  return source.slice(start, end);
}

test("les trois groupes de réglages réutilisables gardent leur contrôle de mémorisation", () => {
  const generator = read("app/dashboard/_components/MediaGenerator.tsx");
  const styles = read("app/dashboard/_components/MediaGenerator.module.css");

  assert.deepEqual(
    Array.from(generator.matchAll(/data-generator-block="([^"]+)"/g), (match) => match[1]),
    ["subject", "selection", "direction", "finish"]
  );
  assert.equal(
    (generator.match(/<RememberPreferenceControl/g) || []).length,
    3
  );
  assert.match(generator, /handleRememberPreferenceGroup/);
  assert.match(generator, /ai_generator_remember_settings/);
  assert.match(styles, /\.essentialCardHeader \.rememberPreference/);
  assert.match(
    styles,
    /\.essentialGrid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/
  );
  assert.match(
    styles,
    /@media \(max-width: 1100px\)[\s\S]*?\.essentialGrid\s*\{[\s\S]*?grid-template-columns:\s*1fr/
  );
  const directionBlock = sourceSection(
    generator,
    'data-generator-block="direction"',
    'data-generator-block="finish"'
  );
  assert.match(directionBlock, /checked=\{savedPreferences\.blocks\[3\]\.saved\}/);
  assert.match(
    directionBlock,
    /onChange=\{\(checked\) => handleRememberPreferenceGroup\(3, checked\)\}/,
    "le contrôle du bloc Direction doit enregistrer le groupe 3 qu’il affiche"
  );
});

test("le client charge sans cache, recharge au changement de compte et fusionne les PATCH concurrents", () => {
  const hook = read("app/dashboard/_hooks/useAiMediaGeneratorPreferences.ts");

  assert.match(
    hook,
    /const PREFERENCES_ENDPOINT = "\/api\/media-generation\/preferences"/
  );
  assert.match(hook, /method: "GET"[\s\S]*?cache: "no-store"/);
  assert.match(hook, /method: "PATCH"[\s\S]*?cache: "no-store"/);
  assert.match(hook, /credentials: "same-origin"/);
  assert.match(hook, /ACTIVE_INRCY_ACCOUNT_EVENT/);
  assert.match(hook, /requestEpoch !== accountEpochRef\.current/);
  assert.match(
    hook,
    /blocks:\s*\{[\s\S]*?\.\.\.current\.blocks,[\s\S]*?\[blockId\]: nextPreferences\.blocks\[blockId\]/
  );
  assert.doesNotMatch(hook, /localStorage|sessionStorage/);
});

test("le Studio essentiel ne mémorise aucun contenu sensible et transmet ses critères structurés", () => {
  const generator = read("app/dashboard/_components/MediaGenerator.tsx");
  const preferenceSave = sourceSection(
    generator,
    "const handleRememberPreferenceGroup",
    "const performGeneration"
  );
  const generation = sourceSection(
    generator,
    "const performGeneration",
    "const handleGenerate"
  );

  assert.doesNotMatch(generator, /patchPreferences/);
  for (const sensitive of [
    "customIdea",
    "aiInstruction",
    "inspirationImages",
    "textKeywords",
    "identityConsent",
  ]) {
    assert.doesNotMatch(
      preferenceSave,
      new RegExp(`\\b${sensitive}\\b`),
      `${sensitive} ne doit jamais être mémorisé`
    );
  }
  for (const structured of [
    "typology",
    "visualStyle",
    "visualDirection",
    "imagePurpose",
  ]) {
    assert.match(
      generation,
      new RegExp(`\\b${structured}(?:\\s*:|\\s*,)`),
      `${structured} doit être envoyé comme critère structuré par le Studio essentiel`
    );
  }
  assert.match(generation, /inputMode: "essential"/);
  assert.match(generation, /aiInstruction: generationAiInstruction/);
  assert.match(generation, /generationMode:/);
  assert.match(generation, /sceneMode: kind === "video" \? videoSceneMode : undefined/);
  assert.match(generation, /connectScenes:[\s\S]*?videoSceneMode === "single"/);
  assert.match(
    generation,
    /inspirationImages: mediaSourceMode === "real" \? inspirationImages : \[\]/
  );

  for (const restored of [
    /setImagePurpose\(block3\.defaults\.imagePurpose\)/,
    /setVisualDirection\(block3\.defaults\.visualDirection\)/,
    /setVideoSceneMode\(block3\.defaults\.sceneMode\)/,
  ]) {
    assert.match(generator, restored);
  }
  assert.match(
    preferenceSave,
    /imagePurpose,[\s\S]*?visualDirection,[\s\S]*?sceneMode:\s*videoSceneMode/,
    "le bloc 3 doit mémoriser ses trois contrats propres",
  );
});

test("les neuf catalogues traduisent la mémorisation et les garanties d’identité", () => {
  const locales = [
    "fr-FR",
    "en-GB",
    "es-ES",
    "it-IT",
    "de-DE",
    "nl-NL",
    "pt-PT",
    "th-TH",
    "zh-CN",
  ];
  const keys = [
    "ai_generator_remember_settings",
    "ai_generator_preferences_saving",
    "ai_generator_preferences_load_error",
    "ai_generator_preferences_save_error",
    "ai_generator_video_character_consent_label",
    "ai_generator_footer_consent_title",
    "ai_generator_footer_consent_blocking",
    "ai_generator_footer_consent_confirmed",
    "ai_generator_inspiration_rules_body",
  ];

  for (const locale of locales) {
    const messages = JSON.parse(
      read(`messages/${locale}/media.json`)
    ) as Record<string, unknown>;
    for (const key of keys) {
      assert.equal(typeof messages[key], "string", `${locale}: ${key}`);
      assert.ok(String(messages[key]).trim().length > 1, `${locale}: ${key}`);
    }
  }

  const fr = JSON.parse(read("messages/fr-FR/media.json")) as Record<
    string,
    string
  >;
  assert.match(fr.ai_generator_video_character_consent_label, /majeure/i);
  assert.match(fr.ai_generator_video_character_consent_label, /autoris/i);
  assert.match(
    fr.ai_generator_video_character_consent_label,
    /cette génération/i
  );
  assert.match(fr.ai_generator_inspiration_rules_body, /vise à préserver/i);
  assert.match(
    fr.ai_generator_inspiration_rules_body,
    /contrôler le résultat/i
  );
  assert.match(
    fr.ai_generator_inspiration_rules_body,
    /aucune substitution silencieuse/i
  );
});
