import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { jsonSchema, tool } from "ai";
import type * as Guides from "../../lib/inrAssistantAppGuides.ts";

const root = fileURLToPath(new URL("../../", import.meta.url));
const cache = new Map<string, { exports: unknown }>();
function load(name: string, parent = root): unknown {
  if (name === "server-only") return {};
  if (name === "ai") return { jsonSchema, tool };
  assert.ok(name.startsWith(".") || name.startsWith("@/"), name);
  const path = name.startsWith("@/") ? resolve(root, name.slice(2)) : resolve(parent, name);
  const file = extname(path) ? path : `${path}.ts`;
  if (cache.has(file)) return cache.get(file)!.exports;
  if (file.endsWith(".json")) return JSON.parse(readFileSync(file, "utf8"));
  const record: { exports: unknown } = { exports: {} };
  cache.set(file, record);
  const compiled = ts.transpileModule(readFileSync(file, "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, { URL, URLSearchParams })(
    (dependency: string) => load(dependency, dirname(file)), record, record.exports,
  );
  return record.exports;
}
const runtime = load("./lib/inrAssistantAppGuides.ts") as typeof Guides;

test("a navigation shortcut never replaces Facebook, Trustpilot or other reviews with Google reviews", () => {
  for (const question of [
    "Où consulter mes avis Trustpilot ?",
    "Où gérer mes avis Facebook ?",
    "Où consulter mes avis TripAdvisor ?",
  ]) {
    const answer = runtime.getVerifiedInrAssistantNavigation(question);
    assert.match(answer ?? "", /n’est pas intégrée/);
    assert.doesNotMatch(answer ?? "", /Google|\/dashboard|Connecter mes canaux/);
  }
  assert.equal(runtime.getVerifiedInrAssistantNavigation("Où gérer mes avis Google et Facebook ?"), null);
});

test("a location question followed by work retains the full model and tool pipeline", () => {
  for (const question of [
    "Où gérer mes avis Google ? Prépare une réponse de remerciement.",
    "Où gérer mes avis Google ? Télécharge mes avis.",
    "Où gérer mes avis Google ? Réponds au dernier avis.",
    "Où gérer mes avis Google ? Rédige une réponse.",
    "Où gérer mes avis Google ? Ouvre cet écran.",
    "Où trouver mes contacts ? Importe ce CSV.",
    "Où gérer mes avis Google, puis prépare une réponse ?",
    "Quels boutons pour connecter Facebook et peux-tu préparer une image ?",
    "Comment connecter Facebook puis lire mes statistiques ?",
  ]) assert.equal(runtime.getVerifiedInrAssistantNavigation(question), null, question);
});

test("detailed or ambiguous location questions are not answered with an approximate top-ranked screen", () => {
  for (const question of [
    "Où sont mes factures clients ?",
    "Où voir les factures ?",
    "Où sont mes devis, mes factures ?",
    "Où trouver mes brouillons de campagne mail ?",
    "Où répondre aux mails reçus ?",
    "Où modifier mon adresse ?",
    "Où modifier le logo de mon entreprise ?",
    "Où télécharger mon logo ?",
    "Où consulter mes avis Google supprimés ?",
  ]) assert.equal(runtime.getVerifiedInrAssistantNavigation(question), null, question);
});

test("unsupported review queries retain an explicit product limitation in bounded knowledge", () => {
  for (const question of ["Où gérer mes avis Facebook ?", "Où consulter mes avis Trustpilot ?"]) {
    for (const budget of [650, 1200, 2400]) {
      const knowledge = runtime.getInrAssistantAppKnowledge(question, budget);
      assert.ok(knowledge.length <= budget);
      assert.match(knowledge, /Facebook|Trustpilot/i, question);
      assert.match(knowledge, /non pris|pas pris|uniquement|seuls les avis Google|Google uniquement|pas les avis|pas.*(?:Facebook|Trustpilot)/i, question);
    }
  }
});
