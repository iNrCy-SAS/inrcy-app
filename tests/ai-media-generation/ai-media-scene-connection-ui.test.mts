import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { IntlMessageFormat } from "intl-messageformat";
import ts from "typescript";

const source = readFileSync("app/dashboard/_components/MediaGenerator.tsx", "utf8");
const styles = readFileSync("app/dashboard/_components/MediaGenerator.module.css", "utf8");

test("les durées et le raccord restent dans Finitions, après les trois autres rubriques", () => {
  const parsed = ts.createSourceFile("MediaGenerator.tsx", source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const diagnostics = (parsed as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics;
  assert.equal(diagnostics.length, 0, "le composant TSX est syntaxiquement valide");
  const finishing = source.indexOf('{expandedStep === 4 ? <div');
  const durations = source.indexOf('className={styles.durationChoices}');
  const connection = source.indexOf('className={styles.sceneConnectionChoice}');
  assert.ok(finishing > 0 && durations > finishing && connection > durations);
  assert.equal((source.match(/className=\{styles\.durationChoices\}/g) || []).length, 1);
  assert.match(source, /\[8, 16, 24\] as const/);
  assert.match(source, /ai_generator_sequence_count", \{ count: duration \/ 8 \}/);
  assert.match(source, /disabled=\{operationLocked \|\| premiumLocked\}/);
});

test("le raccord est un choix opt-in partagé avec le contrat serveur et mémorisé dans le bloc 6", () => {
  assert.match(source, /\[connectScenes, setConnectScenes\] = useState\(false\)/);
  assert.match(source, /sceneConnectionAvailable = shouldConnectAiMediaVideoScenes\(/);
  assert.match(source, /connectScenes: sceneConnectionAvailable \? connectScenes : undefined/);
  assert.match(source, /setConnectScenes\(block6.saved \? block6.defaults.connectScenes : false\)/);
  const remember = source.slice(source.indexOf("const handleRememberPreference"), source.indexOf("const performGeneration"));
  const block1 = remember.slice(remember.indexOf("case 1:"), remember.indexOf("case 2:"));
  assert.doesNotMatch(block1, /durationSeconds|connectScenes/);
  const block6 = remember.slice(remember.indexOf("case 6:"));
  assert.match(block6, /durationSeconds,\s*connectScenes,/);
  const checkbox = source.slice(source.indexOf('className={styles.sceneConnectionChoice}'), source.indexOf('className={styles.sceneConnectionChoice}') + 850);
  assert.match(checkbox, /type="checkbox"/);
  assert.match(checkbox, /checked=\{connectScenes\}/);
  assert.match(checkbox, /if \(event.target.checked\) setSceneConnectionNoticeOpen\(true\)/);
});

test("la notice utilise une vraie modale accessible et restaure le focus sans fermer le générateur", () => {
  const notice = source.slice(source.indexOf("function SceneConnectionNotice"), source.indexOf("function canvasBlob"));
  assert.match(notice, /<dialog/);
  assert.match(notice, /dialog.showModal\(\)/);
  assert.match(notice, /confirmRef.current\?\.focus\(\{ preventScroll: true \}\)/);
  assert.match(notice, /aria-labelledby=\{titleId\}/);
  assert.match(notice, /aria-describedby=\{descriptionId\}/);
  assert.match(notice, /onCancel=\{\(event\) => \{\s*event.preventDefault\(\);\s*onClose\(\)/);
  assert.match(notice, /event.stopPropagation\(\)/);
  assert.match(notice, /previousFocus\?\.isConnected\) previousFocus.focus/);
  assert.match(notice, /if \(dialog.open\) dialog.close\(\)/);
  assert.doesNotMatch(notice, /window\.alert|window\.confirm/);
  assert.match(styles, /\.sceneConnectionNotice\s*\{[^}]*width: min\(480px, calc\(100vw - 32px\)\)/);
  assert.match(styles, /\.sceneConnectionNotice\s*\{[^}]*max-height: calc\(100dvh - 32px\)/);
  assert.match(styles, /\.sceneConnectionNotice::backdrop/);
  assert.match(styles, /\.sceneConnectionNotice button:focus-visible/);
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
