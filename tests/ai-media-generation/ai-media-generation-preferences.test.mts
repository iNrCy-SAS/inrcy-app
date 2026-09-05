import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

import {
  AiMediaGeneratorPreferencesValidationError,
  AiMediaGeneratorPreferencesVersionError,
  normalizeAiMediaGeneratorPreferences,
  patchAiMediaGeneratorPreferences,
  parseAiMediaGeneratorPreferencesPatch,
  serializeAiMediaGeneratorPreferences,
} from "../../lib/aiMediaGenerationPreferences.ts";

const ROOT = process.cwd();

test("les réglages média persistants sont limités à des valeurs structurées sûres", () => {
  const dangerousPayload = {
    blockId: 5,
    saved: true,
    defaults: {
      peopleMode: "solo",
      videoCharacterMode: "professional",
      inspirationImages: [
        { mimeType: "image/jpeg", data: "base64-photo-du-pro" },
      ],
      identityConsent: true,
      teamVideoVeoConsent: true,
      aiInstruction: "consigne ponctuelle",
      customIdea: "sujet ponctuel",
      textKeywords: ["ponctuel"],
    },
  };

  const preferences = patchAiMediaGeneratorPreferences({}, dangerousPayload);
  assert.deepEqual(preferences.blocks[5], {
    saved: true,
    defaults: {
      peopleMode: "solo",
      identityMode: "professional",
      teamVideoMode: "montage",
      teamVideoSpeechMode: "voiceover",
    },
  });

  const serialized = JSON.stringify(
    serializeAiMediaGeneratorPreferences(preferences),
  );
  assert.equal(serialized.includes("base64-photo-du-pro"), false);
  assert.equal(serialized.includes("identityConsent"), false);
  assert.equal(serialized.includes("teamVideoVeoConsent"), false);
  assert.equal(serialized.includes("aiInstruction"), false);
  assert.equal(serialized.includes("customIdea"), false);
  assert.equal(serialized.includes("textKeywords"), false);
});

test("le sujet personnalisé reste ponctuel lorsqu'on mémorise le bloc 1", () => {
  const preferences = patchAiMediaGeneratorPreferences({}, {
    blockId: 1,
    saved: true,
    defaults: {
      kind: "video",
      subjectSource: "custom",
      customIdea: "une opération commerciale privée",
      aiInstruction: "une autre consigne privée",
    },
  });

  assert.deepEqual(preferences.blocks[1], {
    saved: true,
    defaults: { kind: "video", subjectSource: "profile" },
  });
});

test("chaque bloc mémorisé est normalisé et peut être désactivé isolément", () => {
  let preferences = normalizeAiMediaGeneratorPreferences({});
  preferences = patchAiMediaGeneratorPreferences(preferences, {
    blockId: 3,
    saved: true,
    defaults: {
      visualStyle: "premium",
      creativity: "bold",
      useBrandColors: false,
      logoMode: "visible",
    },
  });
  preferences = patchAiMediaGeneratorPreferences(preferences, {
    blockId: 6,
    saved: true,
    defaults: {
      durationSeconds: 24,
      withText: false,
      withMusic: false,
      withNarration: true,
      narrationVoice: "male",
      textKeywords: ["ne doit pas être stocké"],
    },
  });
  preferences = patchAiMediaGeneratorPreferences(preferences, {
    blockId: 3,
    saved: false,
  });

  assert.equal(preferences.blocks[3].saved, false);
  assert.deepEqual(preferences.blocks[6], {
    saved: true,
    defaults: {
      durationSeconds: 24,
      withText: false,
      withMusic: false,
      withNarration: true,
      narrationVoice: "male",
    },
  });

  const stored = serializeAiMediaGeneratorPreferences(preferences);
  const storedBlocks = (stored.blocks ?? {}) as Record<string, unknown>;
  assert.equal(Object.hasOwn(storedBlocks, "3"), false);
  assert.equal(Object.hasOwn(storedBlocks, "6"), true);
});

test("un PATCH invalide est refusé", () => {
  assert.throws(
    () => patchAiMediaGeneratorPreferences({}, { blockId: 7, saved: true }),
    AiMediaGeneratorPreferencesValidationError,
  );
  assert.throws(
    () => patchAiMediaGeneratorPreferences({}, { blockId: 1, saved: "yes" }),
    AiMediaGeneratorPreferencesValidationError,
  );
  assert.throws(
    () =>
      patchAiMediaGeneratorPreferences({}, { blockId: 2, saved: true }),
    AiMediaGeneratorPreferencesValidationError,
  );
  assert.throws(
    () =>
      patchAiMediaGeneratorPreferences({}, {
        blockId: 3,
        saved: true,
        defaults: {
          visualStyle: "inconnu",
          creativity: "bold",
          useBrandColors: true,
          logoMode: "visible",
        },
      }),
    AiMediaGeneratorPreferencesValidationError,
  );
  assert.throws(
    () =>
      patchAiMediaGeneratorPreferences({}, {
        blockId: "1",
        saved: false,
      }),
    AiMediaGeneratorPreferencesValidationError,
  );
});

test("désactiver un bloc reste valide sans renvoyer ses valeurs", () => {
  assert.deepEqual(
    parseAiMediaGeneratorPreferencesPatch({ blockId: 5, saved: false }),
    { blockId: 5, saved: false, defaults: null },
  );
});

test("une version future n’est jamais rétrogradée silencieusement", () => {
  const futurePreferences = {
    version: 2,
    blocks: {
      3: {
        saved: true,
        defaults: {
          visualStyle: "premium",
          futureField: "à conserver",
        },
      },
    },
  };

  assert.throws(
    () => normalizeAiMediaGeneratorPreferences(futurePreferences),
    AiMediaGeneratorPreferencesVersionError,
  );
  assert.throws(
    () =>
      patchAiMediaGeneratorPreferences(futurePreferences, {
        blockId: 3,
        saved: false,
      }),
    AiMediaGeneratorPreferencesVersionError,
  );
});

test("la route est authentifiée, atomique, limitée au compte actif et non mise en cache", () => {
  const source = readFileSync(
    path.join(
      ROOT,
      "app/api/media-generation/preferences/route.ts",
    ),
    "utf8",
  );

  assert.match(source, /await requireUser\(\)/);
  assert.match(source, /\.eq\("user_id", activeUserId\)/);
  assert.match(
    source,
    /\.rpc\([\s\S]*?"inrcy_patch_ai_media_generator_preferences_v2"/,
  );
  assert.match(source, /p_account_id: activeUserId/);
  assert.match(source, /parseAiMediaGeneratorPreferencesPatch\(body\)/);
  assert.match(source, /AI_MEDIA_PREFERENCES_VERSION_UNSUPPORTED/);
  assert.match(source, /AI_MEDIA_PREFERENCES_MIGRATION_REQUIRED/);
  assert.match(source, /"Cache-Control": "private, no-store/);
  assert.match(source, /Vary: "Cookie"/);
  assert.doesNotMatch(source, /supabaseAdmin/);
  assert.doesNotMatch(source, /\.upsert\(/);
  assert.doesNotMatch(source, /currentRootSettings/);
});

test("la migration sérialise les PATCH concurrents et ne modifie qu’un bloc JSONB", () => {
  const migration = readFileSync(
    path.join(
      ROOT,
      "ops/sql/2026-09-05_ai_media_generator_preferences_atomic.sql",
    ),
    "utf8",
  );

  assert.match(
    migration,
    /create or replace function public\.inrcy_patch_ai_media_generator_preferences/,
  );
  assert.match(migration, /security invoker/i);
  assert.doesNotMatch(migration, /security definer/i);
  assert.match(migration, /for update/i);
  assert.match(migration, /on conflict \(user_id\) do nothing/i);
  assert.match(migration, /public\.inrcy_can_access_account\(p_account_id\)/);
  assert.match(migration, /jsonb_set\([\s\S]*?array\[p_block_id::text\]/);
  assert.match(migration, /v_blocks := v_blocks - p_block_id::text/);
  assert.match(migration, /AI_MEDIA_PREFERENCES_VERSION_UNSUPPORTED/);
  assert.match(migration, /AI_MEDIA_PREFERENCES_SETTINGS_INVALID/);
  assert.match(migration, /from public, anon, authenticated, service_role/);
  assert.match(migration, /to authenticated/);
});

test("le mode vidéo d’équipe est rétrocompatible et le consentement Veo reste strictement ponctuel", () => {
  const legacy = patchAiMediaGeneratorPreferences({}, {
    blockId: 5,
    saved: true,
    defaults: {
      peopleMode: "team",
      identityMode: "reference_team",
    },
  });
  assert.deepEqual(legacy.blocks[5], {
    saved: true,
    defaults: {
      peopleMode: "team",
      identityMode: "reference_team",
      teamVideoMode: "montage",
      teamVideoSpeechMode: "voiceover",
    },
  });

  const cinematic = patchAiMediaGeneratorPreferences(legacy, {
    blockId: 5,
    saved: true,
    defaults: {
      peopleMode: "team",
      identityMode: "reference_team",
      teamVideoMode: "cinematic",
      teamVideoSpeechMode: "characters",
      teamVideoVeoConsent: true,
    },
  });
  assert.equal(cinematic.blocks[5].defaults.teamVideoMode, "cinematic");
  assert.equal(
    cinematic.blocks[5].defaults.teamVideoSpeechMode,
    "characters",
  );
  assert.equal(
    JSON.stringify(serializeAiMediaGeneratorPreferences(cinematic)).includes(
      "teamVideoVeoConsent",
    ),
    false,
  );
});

test("la migration v2 est additive, atomique et n’autorise que le mode non sensible", () => {
  const migration = readFileSync(
    path.join(
      ROOT,
      "ops/sql/2026-09-05_ai_media_generator_team_video_mode.sql",
    ),
    "utf8",
  );

  assert.match(
    migration,
    /create or replace function public\.inrcy_patch_ai_media_generator_preferences_v2/,
  );
  assert.match(migration, /security invoker/i);
  assert.doesNotMatch(migration, /security definer/i);
  assert.match(
    migration,
    /public\.inrcy_patch_ai_media_generator_preferences\([\s\S]*?p_account_id/,
  );
  assert.match(migration, /jsonb_build_object\([\s\S]*?'peopleMode'[\s\S]*?'identityMode'/);
  assert.match(migration, /jsonb_set\([\s\S]*?teamVideoMode/);
  assert.match(migration, /jsonb_set\([\s\S]*?teamVideoSpeechMode/);
  assert.match(migration, /voiceover[\s\S]*?characters/);
  assert.match(migration, /forbidden|ACCOUNT_FORBIDDEN/i);
  assert.match(migration, /from public, anon, authenticated, service_role/);
  assert.match(migration, /to authenticated/);
  assert.doesNotMatch(migration, /teamVideoVeoConsent/);
  assert.doesNotMatch(migration, /identityConsent|inspirationImages|referenceSetId/);
});
