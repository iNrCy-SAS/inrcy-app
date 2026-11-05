import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { planInrAssistantStatsViewPatch, isInrAssistantStatsViewPatchApplied, selectedStatsVisibilityIndexRange, type InrAssistantStatsViewState } from "../../lib/inrAssistantStatsViewState.ts";
import { parseInrAssistantStatsUiCommand, type InrAssistantStatsViewPatch } from "../../lib/inrAssistantStatsUiCommands.ts";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";

const ACCOUNT = "10000000-0000-4000-8000-000000000001";
const state = (): InrAssistantStatsViewState => ({ accountId: ACCOUNT, panel: "evolution", evolutionView: "index", metric: "visibility", measuredChannel: "facebook", indexChannel: "gmb", indexHistory: { accountId: ACCOUNT, channel: "gmb", range: 3, availableRanges: [1, 3, 6], ready: true } });
const target = { command: "configure_stats_view", selection: { kind: "stats", id: "stats" }, revision: "stats_live_1" };

test("Stats index periods use native finite values and require an explicit period in the instruction", async () => {
  for (const value of [1, 3, 6, 12]) assert.ok(parseInrAssistantStatsUiCommand({ ...target, patch: { evolutionView: "index", indexRangeMonths: value } }));
  for (const patch of [{ indexRangeMonths: 2 }, { indexRangeMonths: "6" }, { indexRangeMonths: 6.5 }, { indexRangeMonths: 0 }, { indexRangeMonths: 24 }, { indexRangeMonths: 6, metric: "clicks" }, { indexRangeMonths: 6, evolutionView: "measured" }, { indexRangeMonths: 6, panel: "all" }, { evolutionView: "index", metric: "clicks" }]) assert.equal(parseInrAssistantStatsUiCommand({ ...target, patch }), null);
  const load = runtimeModules({ "./requireUser": { requireUser: async () => ({ activeUserId: ACCOUNT }) } });
  const { prepareInrAssistantStatsUiAction } = load<typeof import("../../lib/inrAssistantStatsUiTools.ts")>("lib/inrAssistantStatsUiTools.ts");
  const context = { source: "untrusted_client" as const, screen: { pathname: "/dashboard/stats", tool: "iNr’Stats", selection: { kind: "stats" as const, id: "stats" }, revision: "stats_live_1", availableCommands: ["configure_stats_view" as const] } };
  const prepare = (message: string, quote = message, months = 6) => prepareInrAssistantStatsUiAction({ command: "configure_stats_view", instructionQuote: quote, patch: { evolutionView: "index", indexRangeMonths: months } }, { accountId: ACCOUNT, currentUserMessage: message, clientContext: context });
  for (const message of ["Affiche l’indice de visibilité sur 6 mois.", "Sélectionne la vue Indice sur six mois."]) assert.equal((await prepare(message))?.ok, true, message);
  for (const message of ["Affiche l’indice de visibilité.", "Affiche l’indice de visibilité sur 3 mois.", "Comment afficher l’indice de visibilité sur 6 mois ?", "Si je confirme, affiche l’indice de visibilité sur 6 mois.", "« Affiche l’indice de visibilité sur 6 mois. »"]) assert.equal((await prepare(message))?.ok, false, message);
});

test("Stats channel commands bind the index and measured filters independently without writing defaults", () => {
  const current = state();
  assert.deepEqual(planInrAssistantStatsViewPatch(current, { channel: "instagram" }, ["gmb", "facebook", "instagram"]), { indexChannel: "instagram" });
  assert.deepEqual(planInrAssistantStatsViewPatch(current, { evolutionView: "measured", channel: "instagram", metric: "clicks" }, ["gmb", "facebook", "instagram"]), { evolutionView: "measured", measuredChannel: "instagram", metric: "clicks" });
  assert.deepEqual(planInrAssistantStatsViewPatch(current, { panel: "all" }, ["gmb"]), { panel: "all" });
  assert.equal(planInrAssistantStatsViewPatch(current, { channel: "mails" }, ["gmb"]), null, "the mounted Basic model does not expose Premium mail stats");
  assert.equal(isInrAssistantStatsViewPatchApplied(current, { channel: "facebook" }), false, "the hidden measured filter cannot acknowledge an index change");
  assert.equal(isInrAssistantStatsViewPatchApplied(current, { channel: "gmb" }), true);
  assert.equal(isInrAssistantStatsViewPatchApplied({ ...current, evolutionView: "measured" }, { channel: "gmb" }), false);
  assert.equal(planInrAssistantStatsViewPatch(current, { metric: "clicks" }, ["gmb"]), null);
});

test("Stats period execution refuses locked history, pending loads and stale account/channel snapshots", () => {
  const current = state(), patch = { indexRangeMonths: 6 } as const;
  assert.deepEqual(planInrAssistantStatsViewPatch(current, patch, ["gmb"]), patch);
  assert.equal(isInrAssistantStatsViewPatchApplied(current, patch), false, "the old 3-month curve cannot acknowledge 6 months");
  const selected = { ...current, indexHistory: { ...current.indexHistory, range: selectedStatsVisibilityIndexRange(current.indexHistory.availableRanges, 6) } };
  assert.equal(isInrAssistantStatsViewPatchApplied(selected, patch), true);
  for (const history of [{ ...current.indexHistory, availableRanges: [1, 3] as const }, { ...current.indexHistory, ready: false }, { ...current.indexHistory, accountId: "other-account" }, { ...current.indexHistory, channel: "facebook" }]) {
    const stale = { ...current, indexHistory: history };
    assert.equal(planInrAssistantStatsViewPatch(stale, patch, ["gmb", "facebook"]), null);
    assert.equal(isInrAssistantStatsViewPatchApplied({ ...stale, indexHistory: { ...history, range: 6 } }, patch), false);
  }
  assert.equal(planInrAssistantStatsViewPatch(current, { channel: "facebook", indexRangeMonths: 6 }, ["gmb", "facebook"]), null, "another channel must finish its own history lookup first");
});

test("the actual StatsClient native callbacks apply the requested index period and acknowledge only its committed readback", () => {
  const file = "app/dashboard/stats/StatsClient.tsx", source = readFileSync(new URL(`../../${file}`, import.meta.url), "utf8");
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let options: ts.Expression | undefined;
  const visit = (node: ts.Node) => { if (ts.isCallExpression(node) && node.expression.getText(ast) === "useInrAssistantStatsCommands") options = node.arguments[0]; ts.forEachChild(node, visit); }; visit(ast); assert.ok(options);
  const compiled = ts.transpileModule(`(${options.getText(ast)})`, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS } }).outputText;
  let committed = state(); const changes: Array<() => void> = [];
  const deps = { activeAccountId: ACCOUNT, get assistantStatsState() { return committed; }, models: [{ key: "gmb" }, { key: "facebook" }], statsIndexChannel: "gmb", statsIndexRange: 3,
    planInrAssistantStatsViewPatch, isInrAssistantStatsViewPatchApplied,
    selectStatsPanel: (panel: string) => changes.push(() => { committed = { ...committed, panel }; }),
    setStatsEvolutionView: (evolutionView: "index" | "measured") => changes.push(() => { committed = { ...committed, evolutionView }; }),
    setStatsMetric: (metric: "visibility" | "clicks") => changes.push(() => { committed = { ...committed, metric }; }),
    setStatsChannel: (measuredChannel: string) => changes.push(() => { committed = { ...committed, measuredChannel }; }),
    setStatsIndexSelection: (selection: { channel: string; preferredRange: 1 | 3 | 6 | 12 }) => changes.push(() => { committed = { ...committed, indexChannel: selection.channel, indexHistory: { ...committed.indexHistory, range: selectedStatsVisibilityIndexRange(committed.indexHistory.availableRanges, selection.preferredRange) } }; }),
  };
  const native = vm.runInNewContext(`(function(deps){with(deps){return ${compiled.trim().replace(/;$/, "")};}})`) (deps) as { apply: (patch: InrAssistantStatsViewPatch) => boolean; isApplied: (patch: InrAssistantStatsViewPatch) => boolean };
  assert.equal(native.apply({ indexRangeMonths: 6 }), true); assert.equal(native.isApplied({ indexRangeMonths: 6 }), false);
  changes.splice(0).forEach(change => change()); assert.equal(native.isApplied({ indexRangeMonths: 6 }), true);
  assert.equal(committed.measuredChannel, "facebook"); assert.equal(committed.metric, "visibility");
  assert.equal(native.apply({ indexRangeMonths: 12 }), false); assert.equal(changes.length, 0);
  committed = { ...committed, accountId: "other-account" }; assert.equal(native.apply({ indexRangeMonths: 3 }), false); assert.equal(changes.length, 0);
});
