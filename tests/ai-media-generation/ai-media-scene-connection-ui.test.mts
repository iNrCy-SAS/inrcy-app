import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { IntlMessageFormat } from "intl-messageformat";
import ts from "typescript";
import { getAiMediaVideoDurationSceneOptions } from "../../lib/aiMediaVideoTimeline.ts";

const source = readFileSync("app/dashboard/_components/MediaGenerator.tsx", "utf8");
const styles = readFileSync("app/dashboard/_components/MediaGenerator.module.css", "utf8");

test("le type reste dans le header et les combinaisons durée/scènes dans le bandeau", () => {
  const modal = readFileSync("app/dashboard/_components/MediaGeneratorModal.tsx", "utf8");
  const controls = readFileSync("app/dashboard/_components/MediaEngineCreditControls.tsx", "utf8");
  const parsed = ts.createSourceFile("MediaGenerator.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const diagnostics = (parsed as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
  assert.equal(diagnostics.length, 0, "le composant TSX est syntaxiquement valide");
  const directionCard = source.indexOf('data-generator-block="direction"');
  const format = source.indexOf('ai_generator_format_title', directionCard);
  assert.ok(directionCard > 0 && format > directionCard);
  assert.doesNotMatch(source.slice(directionCard), /<MediaVideoDurationSelect|styles\.sceneModeChoices/);
  assert.match(source, /onDurationSceneChange=\{\(seconds, mode\) => \{ setDurationSeconds\(seconds\); setVideoSceneMode\(mode\); \}\}/);
  assert.match(source, /<MediaGenerationActions>[\s\S]*?\{engineControls\}/);
  assert.match(controls, /getAiMediaVideoDurationSceneOptions\(props\.videoEngine, selectedResolution\)/);
  assert.match(controls, /value=\{`\$\{duration\}:\$\{sceneMode\}`\}/);
  const omni = getAiMediaVideoDurationSceneOptions("omni", "720p");
  assert.deepEqual(omni.filter((option) => option.durationSeconds === 15), [{ durationSeconds: 15, sceneMode: "multi", sceneCount: 2 }]);
  assert.deepEqual(getAiMediaVideoDurationSceneOptions("veo", "1080p"), [
    { durationSeconds: 8, sceneMode: "single", sceneCount: 1 },
    { durationSeconds: 16, sceneMode: "multi", sceneCount: 2 },
  ]);
  assert.match(modal, /\(\["image", "video"\] as const\)\.filter\(\(mediaType\) => !imageOnly \|\| mediaType === "image"\)\.map/);
  assert.match(modal, /studioTab === "modify" && mediaType === "video"/);
  assert.match(source, /getMediaVideoDurationChoices\(videoMaxDurationSeconds\)/);
  assert.match(source, /canGenerateAiMediaVideoDuration\(selectedVideoEngine, durationSeconds, videoResolution, videoSceneMode\)/);
  assert.doesNotMatch(source, /setDurationSeconds\(\(current\)/);
  assert.match(source, /creditQuote\.insufficient/);
  assert.match(source, /!creditQuote\.ready/);
  assert.doesNotMatch(source, /duration > videoRemainingSeconds/);
  assert.doesNotMatch(source, /expandedStep|sceneConnectionChoice/);
});

test("le Studio transmet le scénario et les choix visuels structurés sans anciens réglages cachés", () => {
  const generation = source.slice(source.indexOf("const performGeneration"), source.indexOf("const handleGenerate"));
  assert.match(generation, /inputMode: "essential"/);
  assert.match(generation, /sceneMode: kind === "video" \? videoSceneMode : undefined/);
  assert.match(generation, /connectScenes:[\s\S]*?durationSeconds > 8[\s\S]*?videoSceneMode === "single"/);
  assert.match(generation, /typology: structuredTypology/);
  assert.match(generation, /visualStyle: structuredVisualStyle/);
  assert.match(generation, /visualDirection,/);
  assert.match(generation, /imageStyle,/);
  assert.doesNotMatch(generation, /shotType\s*:|creativity\s*:/);
  assert.match(generation, /videoEngine: selectedVideoEngine/);
  assert.match(generation, /\.\.\.creditQuote\.authorization/);
  assert.doesNotMatch(source, /setConnectScenes|SceneConnectionNotice/);
});

test("les sélecteurs essentiels restent sombres et la grille passe de 2×2 à une colonne", () => {
  assert.match(source, /className=\{styles\.studioSelect\}/);
  assert.match(styles, /\.studioSelect(?:\s*,\s*\.durationAndScenes > div:first-child > select)?\s*\{[\s\S]*?background-color:\s*#10244a/);
  assert.match(styles, /\.studioSelect option(?:\s*,\s*\.durationAndScenes > div:first-child > select option)?\s*\{[\s\S]*?background:\s*#10244a/);
  assert.match(styles, /\.essentialGrid\s*\{[\s\S]*?grid-template-columns:\s*repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(styles, /@media \(max-width: 1100px\)[\s\S]*?\.essentialGrid\s*\{[\s\S]*?grid-template-columns:\s*1fr/);
});

test("les neuf langues affichent une ou deux scènes et leur durée minimale", () => {
  for (const locale of ["fr-FR", "en-GB", "de-DE", "es-ES", "it-IT", "nl-NL", "pt-PT", "th-TH", "zh-CN"]) {
    const messages = JSON.parse(readFileSync(`messages/${locale}/media.json`, "utf8")) as Record<string, string>;
    for (const key of ["ai_generator_duration_scene_single", "ai_generator_duration_scene_multi", "ai_generator_duration_adjusted", "ai_generator_free_scene_single", "ai_generator_free_scene_multi", "ai_generator_two_scenes_minimum", "ai_generator_connect_scenes_label", "ai_generator_connect_scenes_hint", "ai_generator_connect_scenes_notice", "ai_generator_connect_scenes_understood", "ai_generator_sequence_count"]) {
      assert.ok(messages[key]?.trim(), `${locale}: ${key}`);
    }
    const formatter = new IntlMessageFormat(messages.ai_generator_sequence_count, locale);
    assert.ok(messages.ai_generator_free_scene_multi.includes("2"));
    assert.ok(messages.ai_generator_two_scenes_minimum.includes("8"));
    for (const key of ["ai_generator_duration_scene_single", "ai_generator_duration_scene_multi"]) {
      const label = String(new IntlMessageFormat(messages[key], locale).format({ seconds: 15 }));
      assert.ok(label.includes("15"));
      assert.doesNotMatch(label, /[{}]/);
    }
    for (const count of [1, 2]) {
      const label = String(formatter.format({ count }));
      assert.ok(label.includes(String(count)), `${locale}: nombre ${count} présent`);
      assert.doesNotMatch(label, /[{}]/);
    }
  }
  const fr = JSON.parse(readFileSync("messages/fr-FR/media.json", "utf8")) as Record<string, string>;
  assert.equal(fr.ai_generator_connect_scenes_notice, "Attention : raccorder les scènes peut entraîner un temps de création plus long que sans raccord.");
  assert.equal(new IntlMessageFormat(fr.ai_generator_sequence_count, "fr-FR").format({ count: 1 }), "1 séquence");
  assert.equal(new IntlMessageFormat(fr.ai_generator_sequence_count, "fr-FR").format({ count: 2 }), "2 séquences");
});
