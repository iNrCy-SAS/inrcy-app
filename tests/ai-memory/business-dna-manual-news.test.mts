import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as memory from "../../lib/aiMemory.ts";
import { buildBusinessDnaWorkspaceSavePatch } from "../../lib/businessDnaManualAnalysisJob.ts";
import { reconcileSavedDraft } from "../../lib/reconcileSavedDraft.ts";

const snapshot = (items = ["Auto récente 1", "Auto récente 2", "Auto récente 3", "Auto récente 4"]) => ({
  recentNewsItems: items, recentNewsUpdatedAt: "2026-11-03T10:00:00.000Z",
  recentNewsWindowStart: "2026-10-04T10:00:00.000Z", recentNewsSourceKeys: ["instagram"],
});

test("les anciens snapshots restent automatiques, sans provenance inventée", () => {
  for (const current of [{ recentNewsItems: ["Ancienne"] }, { recentNewsItems: ["Ancienne"], recentNewsUpdatedAt: "2026-10-01" }]) {
    const merged = memory.mergeAiBusinessDnaAnalysis(current, {}, snapshot(), {});
    assert.deepEqual(merged.memory.recentNewsItems, snapshot().recentNewsItems);
    assert.equal(merged.memory.recentNewsManualItems, undefined);
  }
});

test("une édition et un effacement gardent leurs emplacements, les autres actualités se rafraîchissent", () => {
  let current = memory.normalizeAiMemory(snapshot(["Ancienne 1", "Ancienne 2", "Ancienne 3", "Ancienne 4"]));
  current = memory.updateAiMemoryRecentNewsItem(current, 1, "Texte manuel exact");
  current = memory.updateAiMemoryRecentNewsItem(current, 3, "");
  assert.deepEqual(current.recentNewsManualItems, [null, "Texte manuel exact", null, ""]);
  const merged = memory.mergeAiBusinessDnaAnalysis(current, {}, snapshot(), {}).memory;
  assert.deepEqual(merged.recentNewsItems, ["Auto récente 1", "Texte manuel exact", "Auto récente 2", ""]);
  assert.deepEqual(memory.normalizeAiMemory(JSON.parse(JSON.stringify(merged))), merged);
  const refreshed = memory.mergeAiBusinessDnaAnalysis(merged, {}, snapshot(["Nouveau 1", "Nouveau 2"]), {}).memory;
  assert.deepEqual(refreshed.recentNewsItems, ["Nouveau 1", "Texte manuel exact", "Nouveau 2", ""]);
  assert.equal(refreshed.recentNewsUpdatedAt, snapshot().recentNewsUpdatedAt);
});

test("le brouillon conserve les espaces pendant la frappe avant sa normalisation de sauvegarde", () => {
  const draft = memory.updateAiMemoryRecentNewsItem({}, 0, "Une actualité ");
  assert.equal(draft.recentNewsItems[0], "Une actualité ");
  assert.equal(draft.recentNewsManualItems?.[0], "Une actualité ");
  assert.equal(memory.normalizeAiMemory(draft).recentNewsItems[0], "Une actualité");
});

test("une saisie en troisième case avec deux cases vides et l’effacement de la première ne déplacent aucun champ", () => {
  const third = memory.normalizeAiMemory(memory.updateAiMemoryRecentNewsItem({}, 2, "Uniquement la troisième"));
  assert.deepEqual(third.recentNewsItems, ["", "", "Uniquement la troisième", ""]);
  assert.deepEqual(memory.normalizeAiMemory(JSON.parse(JSON.stringify(third))).recentNewsItems, third.recentNewsItems);
  const firstCleared = memory.normalizeAiMemory(memory.updateAiMemoryRecentNewsItem({ recentNewsItems: ["Une", "Deux", "Trois", "Quatre"] }, 0, ""));
  assert.deepEqual(firstCleared.recentNewsItems, ["", "Deux", "Trois", "Quatre"]);
  assert.deepEqual(memory.normalizeAiMemory(JSON.parse(JSON.stringify(firstCleared))).recentNewsItems, firstCleared.recentNewsItems);
  assert.deepEqual(memory.mergeAiBusinessDnaAnalysis(firstCleared, {}, snapshot(), {}).memory.recentNewsItems,
    ["", "Auto récente 1", "Auto récente 2", "Auto récente 3"]);
});

test("les quatre saisies manuelles restent ordonnées et ne sont pas dupliquées dans les places auto", () => {
  let current = memory.normalizeAiMemory({});
  for (let index = 0; index < 4; index++) current = memory.updateAiMemoryRecentNewsItem(current, index, `Manuelle ${index + 1}`);
  const merged = memory.mergeAiBusinessDnaAnalysis(current, {}, snapshot(), {}).memory;
  assert.deepEqual(merged.recentNewsItems, ["Manuelle 1", "Manuelle 2", "Manuelle 3", "Manuelle 4"]);
  const oneManual = memory.updateAiMemoryRecentNewsItem({}, 0, "Même actualité");
  assert.deepEqual(memory.mergeAiBusinessDnaAnalysis(oneManual, {}, snapshot(["Même actualité", "Autre actualité"]), {}).memory.recentNewsItems,
    ["Même actualité", "Autre actualité", "", ""]);
});

test("la sauvegarde partielle transmet la provenance et garde une édition faite pendant sa réponse", () => {
  const before = memory.normalizeAiMemory(snapshot());
  const submitted = memory.updateAiMemoryRecentNewsItem(before, 0, "Première saisie");
  const patch = buildBusinessDnaWorkspaceSavePatch(before, submitted);
  assert.deepEqual(patch.recentNewsManualItems, ["Première saisie", null, null, null]);
  const persisted = memory.mergeAiMemoryUpdate(before, patch);
  const current = memory.updateAiMemoryRecentNewsItem(submitted, 0, "Dernière saisie");
  const latest = memory.updateAiMemoryRecentNewsItem(current, 2, "");
  const reconciled = reconcileSavedDraft(submitted, latest, persisted);
  const merged = memory.mergeAiBusinessDnaAnalysis(reconciled, {}, snapshot(), {}).memory;
  assert.equal(merged.recentNewsItems[0], "Dernière saisie");
  assert.equal(merged.recentNewsItems[2], "");
  assert.deepEqual(merged.recentNewsManualItems, ["Dernière saisie", null, "", null]);
});

test("une réponse de suivi ancienne ne réintroduit pas l’ancien texte manuel comme une actualité automatique", () => {
  const oldSaved = memory.updateAiMemoryRecentNewsItem(snapshot(), 0, "Ancien texte manuel");
  const latest = memory.updateAiMemoryRecentNewsItem(oldSaved, 0, "Nouveau texte manuel");
  const merged = memory.mergeAiBusinessDnaAnalysis(latest, {}, oldSaved, {}).memory;
  assert.equal(merged.recentNewsItems[0], "Nouveau texte manuel");
  assert.ok(!merged.recentNewsItems.includes("Ancien texte manuel"));
});

test("la provenance est bornée, absente du prompt et ne suffit pas à compter comme contenu", () => {
  const normalized = memory.normalizeAiMemory({ recentNewsManualItems: ["x".repeat(3_000), "", { invalid: true }, null, "Hors limite"] });
  assert.equal(normalized.recentNewsManualItems?.[0]?.length, 2_000);
  assert.equal(normalized.recentNewsManualItems?.length, 4);
  const cleared = memory.updateAiMemoryRecentNewsItem({}, 0, "");
  assert.equal(memory.hasAiMemoryContent(cleared), false);
  assert.equal(Object.hasOwn(memory.buildAiMemoryPromptPayload(normalized), "recentNewsManualItems"), false);
  assert.equal(Object.hasOwn(memory.buildAiMemoryPromptPayload(normalized), "recent_news_manual_items"), false);
  const suggested = memory.mergeAiBusinessDnaAnalysis({}, {}, { ...snapshot(), recentNewsManualItems: ["Fausse provenance"] }, {}).memory;
  assert.equal(suggested.recentNewsManualItems, undefined);
  const ui = readFileSync(new URL("../../app/dashboard/settings/_components/AiMemoryContent.tsx", import.meta.url), "utf8");
  assert.match(ui, /updateMemory\(\(current\) => updateAiMemoryRecentNewsItem\(current, index, value\)\)/);
});

test("le reset Actualités efface les marqueurs et autorise le prochain snapshot automatique", () => {
  const code = readFileSync(new URL("../../app/api/ai-memory/reset/route.ts", import.meta.url), "utf8");
  const compiled = ts.transpileModule(`${code}\nexport { resetMemoryForTab };`, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
  const loaded = { exports: {} as { resetMemoryForTab: (value: memory.AiMemory, tab: string) => memory.AiMemory } };
  new Function("module", "exports", "require", compiled)(loaded, loaded.exports, (name: string) => name === "@/lib/aiMemory" ? memory : {});
  const current = memory.updateAiMemoryRecentNewsItem({ values: ["Valeur à préserver"] }, 1, "Manuelle");
  const reset = loaded.exports.resetMemoryForTab(current, "news");
  assert.deepEqual(reset.recentNewsItems, []);
  assert.deepEqual(reset.recentNewsManualItems, []);
  assert.deepEqual(reset.values, current.values);
  assert.deepEqual(buildBusinessDnaWorkspaceSavePatch(current, reset).recentNewsManualItems, []);
  assert.deepEqual(memory.mergeAiBusinessDnaAnalysis(reset, {}, snapshot(), {}).memory.recentNewsItems, snapshot().recentNewsItems);
});
