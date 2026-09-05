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

test("les six blocs proposent une mémorisation accessible et responsive", () => {
  const generator = read("app/dashboard/_components/MediaGenerator.tsx");
  const styles = read("app/dashboard/_components/MediaGenerator.module.css");

  assert.equal(
    (generator.match(/<RememberPreferenceControl/g) || []).length,
    6,
  );
  for (const blockId of [1, 2, 3, 4, 5, 6]) {
    assert.match(
      generator,
      new RegExp(`checked=\\{savedPreferences\\.blocks\\[${blockId}\\]\\.saved\\}`),
    );
    assert.match(
      generator,
      new RegExp(`handleRememberPreference\\(${blockId}, checked\\)`),
    );
  }
  assert.match(generator, /role="switch"/);
  assert.match(generator, /aria-checked=\{checked\}/);
  assert.match(generator, /ai_generator_remember_settings/);
  assert.match(styles, /\.collapsibleHeader\s*\{[\s\S]*?grid-template-columns:/);
  assert.match(styles, /\.rememberPreference\s*\{/);
  assert.match(
    styles,
    /@media \(max-width: 620px\)[\s\S]*?\.rememberPreference\s*\{[\s\S]*?position:\s*absolute/,
  );
});

test("le client charge sans cache, recharge au changement de compte et fusionne les PATCH concurrents", () => {
  const hook = read(
    "app/dashboard/_hooks/useAiMediaGeneratorPreferences.ts",
  );

  assert.match(hook, /const PREFERENCES_ENDPOINT = "\/api\/media-generation\/preferences"/);
  assert.match(hook, /method: "GET"[\s\S]*?cache: "no-store"/);
  assert.match(hook, /method: "PATCH"[\s\S]*?cache: "no-store"/);
  assert.match(hook, /credentials: "same-origin"/);
  assert.match(hook, /ACTIVE_INRCY_ACCOUNT_EVENT/);
  assert.match(hook, /requestEpoch !== accountEpochRef\.current/);
  assert.match(
    hook,
    /blocks:\s*\{[\s\S]*?\.\.\.current\.blocks,[\s\S]*?\[blockId\]: nextPreferences\.blocks\[blockId\]/,
  );
  assert.doesNotMatch(hook, /localStorage|sessionStorage/);
});

test("la mémorisation UI ne sérialise aucune donnée libre, photo ou consentement", () => {
  const generator = read("app/dashboard/_components/MediaGenerator.tsx");
  const remembered = sourceSection(
    generator,
    "const handleRememberPreference",
    "const handleGenerate",
  );

  for (const forbidden of [
    "aiInstruction",
    "customIdea",
    "inspirationImages",
    "identityConsent",
    "textKeywords",
    "textKeywordDraft",
  ]) {
    assert.doesNotMatch(
      remembered,
      new RegExp(`\\b${forbidden}\\b`),
      `${forbidden} ne doit jamais entrer dans le PATCH de préférences`,
    );
  }

  const identityBlock = sourceSection(remembered, "case 5:", "case 6:");
  assert.match(identityBlock, /peopleMode/);
  assert.match(identityBlock, /identityMode/);
  assert.doesNotMatch(
    identityBlock,
    /identityConsent|inspirationImages|identityReferenceSetId|photo/i,
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
    "ai_generator_inspiration_rules_body",
  ];

  for (const locale of locales) {
    const messages = JSON.parse(read(`messages/${locale}/media.json`)) as Record<
      string,
      unknown
    >;
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
  assert.match(fr.ai_generator_video_character_consent_label, /cette génération/i);
  assert.match(fr.ai_generator_inspiration_rules_body, /vise à préserver/i);
  assert.match(fr.ai_generator_inspiration_rules_body, /contrôler le résultat/i);
  assert.match(fr.ai_generator_inspiration_rules_body, /aucune substitution silencieuse/i);
});
