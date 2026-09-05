import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { normalizeAiMediaGenerationRequest } from "../../lib/aiMediaGenerationContracts.ts";
import {
  patchAiMediaGeneratorPreferences,
  serializeAiMediaGeneratorPreferences,
} from "../../lib/aiMediaGenerationPreferences.ts";

const read = (relativePath: string) => readFileSync(relativePath, "utf8");
const photo = (seed: number) => ({
  mimeType: "image/jpeg" as const,
  data: Buffer.alloc(96, seed).toString("base64"),
});

test("l'équipe de référence exige 2 à 3 adultes autorisés et force le mode équipe", () => {
  assert.throws(
    () => normalizeAiMediaGenerationRequest({
      requestId: "reference-team-one-photo",
      kind: "image",
      subjectSource: "profile",
      peopleMode: "solo",
      identityMode: "reference_team",
      identityConsent: true,
      inspirationImages: [photo(1)],
      source: "studio",
    }),
    /deux ou trois photos/i,
  );

  for (const kind of ["image", "video"] as const) {
    const normalized = normalizeAiMediaGenerationRequest({
      requestId: `reference-team-${kind}-valid`,
      kind,
      subjectSource: "profile",
      peopleMode: "auto",
      identityMode: "reference_team",
      identityConsent: true,
      identityReferenceSetId: `reference-team-${kind}-set`,
      inspirationImages: [photo(2), photo(3), photo(4)],
      source: "studio",
    });
    assert.equal(normalized.identityMode, "reference_team");
    assert.equal(normalized.videoCharacterMode, "reference_team");
    assert.equal(normalized.peopleMode, "team");
    assert.equal(normalized.inspirationImages.length, 3);
    assert.equal(normalized.identityConsent, true);
  }
});

test("le mode équipe reste compatible avec l'alias vidéo historique mais jamais sans accord", () => {
  assert.throws(
    () => normalizeAiMediaGenerationRequest({
      requestId: "reference-team-legacy-no-consent",
      kind: "video",
      subjectSource: "profile",
      peopleMode: "team",
      videoCharacterMode: "reference_team",
      inspirationImages: [photo(5), photo(6)],
      source: "studio",
    }),
    /autorisation/i,
  );

  const legacy = normalizeAiMediaGenerationRequest({
    requestId: "reference-team-legacy-consent",
    kind: "video",
    subjectSource: "profile",
    peopleMode: "team",
    videoCharacterMode: "reference_team",
    identityConsent: true,
    inspirationImages: [photo(7), photo(8)],
    source: "studio",
  });
  assert.equal(legacy.identityMode, "reference_team");
  assert.equal(legacy.peopleMode, "team");
});

test("la préférence mémorise l'équipe, la normalise et exclut photos et consentement", () => {
  const preferences = patchAiMediaGeneratorPreferences({}, {
    blockId: 5,
    saved: true,
    defaults: {
      peopleMode: "solo",
      identityMode: "reference_team",
      identityConsent: true,
      inspirationImages: [photo(9), photo(10)],
    },
  });

  assert.deepEqual(preferences.blocks[5], {
    saved: true,
    defaults: {
      peopleMode: "team",
      identityMode: "reference_team",
    },
  });
  const serialized = JSON.stringify(serializeAiMediaGeneratorPreferences(preferences));
  assert.equal(serialized.includes("identityConsent"), false);
  assert.equal(serialized.includes("inspirationImages"), false);
  assert.equal(serialized.includes(photo(9).data), false);
});

test("le studio propose l'équipe en image et vidéo avec un flux responsive explicite", () => {
  const generator = read("app/dashboard/_components/MediaGenerator.tsx");
  const styles = read("app/dashboard/_components/MediaGenerator.module.css");
  const hook = read("app/dashboard/_hooks/useMediaGeneration.ts");

  assert.match(generator, /"reference_team"/);
  assert.match(generator, /option === "reference_team"\) setPeopleMode\("team"\)/);
  assert.match(generator, /videoCharacterMode === "reference_team"[\s\S]*?inspirationImages\.length < 2/);
  assert.match(generator, /ai_generator_reference_team_consent_label/);
  assert.match(generator, /ai_generator_identity_consent_hint_team_video/);
  assert.match(generator, /ai_generator_kind_video_hint_team/);
  assert.match(generator, /ai_generator_stage_team_composition/);
  assert.match(generator, /ai_generator_video_creation_detail_team/);
  assert.match(generator, /videoCharacterMode === "reference_team" && kind === "video"/);
  assert.match(generator, /styles\.identityModeChoices/);
  assert.match(hook, /\| "reference_team"/);
  assert.match(
    styles,
    /\.parameterChoices\.identityModeChoices\s*\{[\s\S]*?repeat\(4, minmax\(0, 1fr\)\)/,
  );
  assert.match(
    styles,
    /@media \(max-width: 620px\)[\s\S]*?\.parameterChoices\.identityModeChoices\s*\{[^}]*repeat\(2, minmax\(0, 1fr\)\)/,
  );
});

test("les neuf langues expliquent l'équipe distincte et le transfert vidéo ponctuel", () => {
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
    "ai_generator_video_character_reference_team",
    "ai_generator_video_character_reference_team_required",
    "ai_generator_reference_team_title",
    "ai_generator_reference_team_hint",
    "ai_generator_reference_team_consent_label",
    "ai_generator_identity_consent_hint_team_video",
    "ai_generator_kind_video_hint_team",
    "ai_generator_stage_team_composition",
    "ai_generator_video_creation_detail_team",
  ];

  for (const locale of locales) {
    const catalog = JSON.parse(read(`messages/${locale}/media.json`)) as Record<string, string>;
    for (const key of keys) {
      assert.ok(catalog[key]?.trim().length > 1, `${locale}: ${key}`);
    }
    assert.match(catalog.ai_generator_identity_consent_hint_team_video, /OpenAI/);
    assert.match(catalog.ai_generator_identity_consent_hint_team_video, /iNrCy/);
    assert.match(catalog.ai_generator_identity_consent_hint_team_video, /H\.264/);
    assert.match(catalog.ai_generator_video_creation_detail_team, /H\.264/);
    assert.doesNotMatch(catalog.ai_generator_identity_consent_hint_team_video, /video engine|moteur vidéo|Videomodell|motor de vídeo|motore video|video-engine|ระบบวิดีโอ|视频引擎/i);
  }

  const fr = JSON.parse(read("messages/fr-FR/media.json")) as Record<string, string>;
  assert.match(fr.ai_generator_reference_team_hint, /2 ou 3 photos/);
  assert.match(fr.ai_generator_reference_team_hint, /distincte/i);
  assert.match(fr.ai_generator_reference_team_consent_label, /adulte/i);
  assert.match(fr.ai_generator_reference_team_consent_label, /autoris/i);
});

test("la migration accepte et canonise la préférence d'équipe sans élargir les données stockées", () => {
  const migration = read("ops/sql/2026-09-05_ai_media_generator_preferences_atomic.sql");
  assert.match(migration, /'reference_team'/);
  assert.match(
    migration,
    /when p_defaults ->> 'identityMode' = 'reference_team' then 'team'/,
  );
  assert.doesNotMatch(migration, /identityConsent|inspirationImages|referenceSetId/);
});
