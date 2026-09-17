import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { IntlMessageFormat } from "intl-messageformat";
import ts from "typescript";

const source = readFileSync("app/dashboard/_components/MediaGenerator.tsx", "utf8");
const styles = readFileSync("app/dashboard/_components/MediaGenerator.module.css", "utf8");

test("le type et la durée vidéo sont réunis dans la première carte", () => {
  const parsed = ts.createSourceFile("MediaGenerator.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const diagnostics = (parsed as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
  assert.equal(diagnostics.length, 0, "le composant TSX est syntaxiquement valide");
  const firstCard = source.indexOf('className={`${styles.essentialCard} ${styles.creationCard}`}');
  const mediaType = source.indexOf('ai_generator_essential_media_type', firstCard);
  const durations = source.indexOf('ai_generator_duration_title', mediaType);
  const format = source.indexOf('ai_generator_format_title', durations);
  assert.ok(firstCard > 0 && mediaType > firstCard && durations > mediaType && format > durations);
  assert.match(source, /\[8, 16, 24\] as const/);
  assert.match(source, /disabled=\{operationLocked \|\| premiumLocked\}/);
  assert.doesNotMatch(source, /expandedStep|sceneConnectionChoice/);
});

test("le Studio essentiel ne transmet plus le raccord ni les anciens réglages décoratifs", () => {
  const generation = source.slice(source.indexOf("const performGeneration"), source.indexOf("const handleGenerate"));
  assert.match(generation, /inputMode: "essential"/);
  assert.doesNotMatch(generation, /connectScenes\s*:/);
  assert.doesNotMatch(generation, /typology\s*:|visualStyle\s*:|shotType\s*:|creativity\s*:|videoEngine\s*:/);
  assert.doesNotMatch(source, /setConnectScenes|SceneConnectionNotice/);
});

test("les sélecteurs essentiels restent sombres et la grille passe de 2×2 à une colonne", () => {
  assert.match(source, /className=\{styles\.studioSelect\}/);
  assert.match(styles, /\.studioSelect\s*\{[\s\S]*?background-color:\s*#091735/);
  assert.match(styles, /\.studioSelect option\s*\{[\s\S]*?background:\s*#091735/);
  assert.match(styles, /\.essentialGrid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 1100px\)[\s\S]*?\.essentialGrid\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
});

test("les neuf langues affichent 1, 2 et 3 séquences et une mise en garde traduite", () => {
  for (const locale of ["fr-FR", "en-GB", "de-DE", "es-ES", "it-IT", "nl-NL", "pt-PT", "th-TH", "zh-CN"]) {
    const messages = JSON.parse(readFileSync(`messages/${locale}/media.json`, "utf8")) as Record<string, string>;
    for (const key of ["ai_generator_connect_scenes_label", "ai_generator_connect_scenes_hint", "ai_generator_connect_scenes_notice", "ai_generator_connect_scenes_understood", "ai_generator_sequence_count"]) {
      assert.ok(messages[key]?.trim(), `${locale}: ${key}`);
    }
    const formatter = new IntlMessageFormat(messages.ai_generator_sequence_count, locale);
    for (const count of [1, 2, 3]) {
      const label = String(formatter.format({ count }));
      assert.ok(label.includes(String(count)), `${locale}: nombre ${count} présent`);
      assert.doesNotMatch(label, /[{}]/);
    }
  }
  const fr = JSON.parse(readFileSync("messages/fr-FR/media.json", "utf8")) as Record<string, string>;
  assert.equal(fr.ai_generator_connect_scenes_notice, "Attention : raccorder les scènes peut entraîner un temps de création plus long que sans raccord.");
  assert.equal(new IntlMessageFormat(fr.ai_generator_sequence_count, "fr-FR").format({ count: 1 }), "1 séquence");
  assert.equal(new IntlMessageFormat(fr.ai_generator_sequence_count, "fr-FR").format({ count: 3 }), "3 séquences");
});
