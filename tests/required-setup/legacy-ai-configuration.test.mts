import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import {
  migrateBusinessProfileAiConfiguration,
  migrateLegacyAiConfigurationLocal,
  resolveCompatibleAiConfiguration,
  selectAiConfigurationCache,
} from "../../lib/aiConfigurationCompatibility.ts";

const root = process.cwd();
const read = (relativePath: string) => readFileSync(join(root, relativePath), "utf8");

test("the historical local Config IA shape is relocated without losing a setting", () => {
  const legacy = {
    tone: "direct",
    preferredCta: "appeler",
    communicationStyle: "premium",
    emojiLevel: "moderate",
    length: "detailed",
    addressMode: "auto",
    aiVoice: "auto",
    creativity: "stable",
    customInstructions: "Ne jamais inventer un tarif.",
  };

  assert.deepEqual(migrateLegacyAiConfigurationLocal(legacy, "premium"), {
    tone: "serious",
    textStyle: "premium",
    originality: "classic",
    webLength: "long",
    socialLength: "long",
    emojiLevel: "light",
    pronoun: "auto",
    addressMode: "vous",
    commercialLevel: "direct",
    preferredCta: "appeler",
    forbiddenStyle: "Ne jamais inventer un tarif.",
  });
});

test("real legacy production values remain readable in the current fields", () => {
  const productionLegacyRow = {
    tone: "pro",
    communication_style: "local_humain",
    ai_voice: "auto",
    ai_length: "detailed",
    emoji_level: "light",
    address_mode: "vous",
    ai_creativity: "balanced",
    preferred_cta: "custom",
    ai_custom_instructions: "Toujours rester factuel.",
  };

  assert.deepEqual(
    migrateBusinessProfileAiConfiguration(productionLegacyRow, "premium"),
    {
      tone: "serious",
      textStyle: "local_humain",
      originality: "balanced",
      webLength: "long",
      socialLength: "long",
      emojiLevel: "light",
      pronoun: "auto",
      addressMode: "vous",
      preferredCta: "custom",
      forbiddenStyle: "Toujours rester factuel.",
    },
  );
});

test("rerunning historical SQL cannot downgrade current or legacy voice settings", () => {
  const voiceMigration = read("ops/sql/2026-05-15_ai_voice.sql");
  const signatureMigration = read("ops/sql/2026-06-10_ai_signature_refonte.sql");

  assert.match(voiceMigration, /not in \('auto', 'je', 'nous', 'vous', 'neutral'\)/);
  assert.match(
    signatureMigration,
    /not in \('simple', 'dynamic', 'expert', 'coulisses', 'local_humain', 'premium'\)/,
  );
  assert.match(signatureMigration, /when communication_style in \('local-humain'\) then 'local_humain'/);
  assert.match(signatureMigration, /when ai_voice = 'auto' then 'auto'/);
  assert.match(signatureMigration, /not in \('auto', 'je', 'nous', 'vous', 'neutral'\)/);
});

test("split channel lengths prefer current columns and fall back independently to ai_length", () => {
  assert.deepEqual(
    migrateBusinessProfileAiConfiguration({
      ai_length: "detailed",
      ai_web_length: "short",
      ai_social_length: null,
    }, "premium"),
    { webLength: "short", socialLength: "long" },
  );
});

test("empty migration defaults never erase a recoverable historical local value", () => {
  const resolved = resolveCompatibleAiConfiguration({
    edition: "premium",
    appDefaultLanguage: "fr",
    local: {
      communicationStyle: "professionnel",
      customInstructions: "Conserver cette consigne historique.",
      likedExample: "Un ancien contenu apprécié.",
    },
    businessProfile: {
      communication_style: "dynamic",
      ai_custom_instructions: "",
      ai_liked_example: "",
      ai_liked_example_2: "",
    },
  });

  assert.equal(resolved.textStyle, "dynamic", "a populated server value stays authoritative");
  assert.equal(resolved.forbiddenStyle, "Conserver cette consigne historique.");
  assert.equal(resolved.likedExample, "Un ancien contenu apprécié.");
  assert.equal(resolved.likedExample2, "");
});

test("missing sources do not manufacture partial persisted values", () => {
  assert.deepEqual(migrateLegacyAiConfigurationLocal({}, "standard"), {});
  assert.deepEqual(migrateBusinessProfileAiConfiguration(null, "standard"), {});
});

test("the historical global cache can only migrate to its primary account", () => {
  const legacyGlobalValue = JSON.stringify({ communicationStyle: "local_humain" });

  assert.deepEqual(selectAiConfigurationCache({
    scopedValue: null,
    legacyGlobalValue,
    activeUserId: "primary-account",
    authUserId: "primary-account",
  }), { rawValue: legacyGlobalValue, source: "legacy-global" });

  assert.deepEqual(selectAiConfigurationCache({
    scopedValue: null,
    legacyGlobalValue,
    activeUserId: "managed-account",
    authUserId: "primary-account",
  }), { rawValue: null, source: "none" });

  assert.deepEqual(selectAiConfigurationCache({
    scopedValue: "{}",
    legacyGlobalValue,
    activeUserId: "primary-account",
    authUserId: "primary-account",
  }), { rawValue: "{}", source: "scoped" });
});

test("Configuration IA blocks persistence after a failed or incomplete load", () => {
  const source = read("app/dashboard/settings/_components/AiConfigurationContent.tsx");
  assert.match(source, /const loadSucceededRef = useRef\(false\)/);
  assert.match(source, /loadSucceededRef\.current = false/);
  assert.match(source, /loadSucceededRef\.current = true/);

  const saveIndex = source.indexOf("const save = async");
  const guardIndex = source.indexOf("if (!loadSucceededRef.current)", saveIndex);
  const upsertIndex = source.indexOf(".upsert", saveIndex);
  assert.ok(saveIndex >= 0 && guardIndex > saveIndex);
  assert.ok(upsertIndex > guardIndex, "the load guard must run before Supabase persistence");
  assert.match(source, /disabled=\{saving \|\| !loadSucceededRef\.current\}/);
});

test("Config IA keeps old readers and a pre-migration schema safe on save", () => {
  const source = read("app/dashboard/settings/_components/AiConfigurationContent.tsx");
  assert.match(source, /ai_length:\s*safeSocialLength/);
  assert.match(source, /ai_web_length:\s*safeWebLength/);
  assert.match(source, /ai_social_length:\s*safeSocialLength/);
  assert.match(source, /ai_liked_example_2\|schema cache\|column/);
  assert.match(source, /upsert\(basePayload/);
  assert.match(source, /option value="local_humain"/);
  assert.match(source, /option value="auto"/);
  assert.match(source, /communication_style: form\.textStyle/);
  assert.match(source, /ai_voice: form\.pronoun/);
});

test("Config IA scopes browser settings per active account without deleting the legacy key", () => {
  const source = read("app/dashboard/settings/_components/AiConfigurationContent.tsx");
  assert.match(source, /readAccountCacheValue\(STORAGE_KEY, activeUserId\)/);
  assert.match(source, /writeAccountCacheValue\(STORAGE_KEY, JSON\.stringify\(safeForm\), activeUserId\)/);
  assert.match(source, /cacheSelection\.source === "legacy-global"/);
  assert.doesNotMatch(source, /localStorage\.removeItem\(STORAGE_KEY\)/);
  assert.match(source, /writeAccountCacheValue\(STORAGE_KEY, "\{\}", activeUserId\)/);
});

test("ADN saves preserve hidden Premium memory and update only relocated business fields", () => {
  const route = read("app/api/ai-memory/route.ts");
  assert.match(route, /mergeAiMemoryPremiumFields\(memory, currentMemoryResult\.data\?\.memory\)/);
  assert.match(route, /mergeAiMemoryUpdate\(currentMemory, input\.memory \?\? input/);
  assert.match(route, /mergeAiBusinessKnowledgeUpdate\(currentBusinessKnowledge, input\.businessKnowledge\)/);
  assert.match(route, /const hasBusinessKnowledge = Object\.prototype\.hasOwnProperty\.call\(input, "businessKnowledge"\)/);
  assert.match(route, /business_description: businessKnowledge\.description/);
  assert.match(route, /services: businessKnowledge\.services/);
  assert.doesNotMatch(
    route.slice(route.indexOf("if (hasBusinessKnowledge)"), route.indexOf("const completionScore")),
    /company_legal_name|contact_email|first_name|last_name|phone:/,
  );
});
