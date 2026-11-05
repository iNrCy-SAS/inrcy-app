import assert from "node:assert/strict";
import test from "node:test";
import { getPureInrAssistantStatsViewRequest, getPureInrAssistantStatsViewSequence } from "../../lib/inrAssistantPureStatsViewRequest.ts";
import { parseInrAssistantStatsUiCommand } from "../../lib/inrAssistantStatsUiCommands.ts";

const screen = { pathname: "/dashboard/stats", tool: "iNr’Stats", selection: { kind: "stats", id: "stats" }, revision: "stats_live_1", availableCommands: ["configure_stats_view"] };
const context = { source: "untrusted_client", screen };

test("pure Stats requests resolve only explicit Globale/Evolution buttons and preserve the original quote", () => {
  const requests = [
    ["Affiche la vue Globale.", "all"],
    ["Ouvre la vue Évolution des statistiques.", "evolution"],
    ["Sélectionne la vue Globale de mes stats.", "all"],
    ["Montre-moi la vue Évolution.", "evolution"],
    ["Passe à la vue Globale.", "all"],
    ["Passe en vue Évolution.", "evolution"],
    ["Affichez la vue Évolution, s’il vous plaît.", "evolution"],
    ["  Sélectionne la vue Globale s’il te plaît !  ", "all"],
    ["Montre la vue Évolution svp.", "evolution"],
  ] as const;
  for (const [message, panel] of requests) {
    const result = getPureInrAssistantStatsViewRequest(message, context);
    assert.deepEqual(result, { command: "configure_stats_view", patch: { panel }, instructionQuote: message.trim() }, message);
    assert.ok(parseInrAssistantStatsUiCommand({ ...result, selection: screen.selection, revision: screen.revision }), message);
  }
});

test("pure Stats requests allow an explicit polite verb without turning advice into execution", () => {
  for (const message of ["Peux-tu afficher la vue Évolution des statistiques ?", "Pouvez-vous sélectionner la vue Globale ?", "Pourrais-tu m’ouvrir la vue Évolution ?", "Pourriez-vous me montrer la vue Globale ?", "Peux tu afficher la vue Évolution ?"]) {
    const panel = /Globale/.test(message) ? "all" : "evolution";
    assert.deepEqual(getPureInrAssistantStatsViewRequest(message, context), { command: "configure_stats_view", patch: { panel }, instructionQuote: message }, message);
  }
});

test("pure Stats requests refuse help, quotations, conditions, negation and delayed execution", () => {
  for (const message of [
    "Comment afficher la vue Évolution ?", "Explique la vue Globale.", "Peux-tu me dire comment afficher la vue Évolution ?", "Pourriez-vous m’expliquer comment sélectionner la vue Globale ?", "Est-ce que la vue Évolution est disponible ?",
    "« Affiche la vue Évolution. »", '"Affiche la vue Globale."', "`Affiche la vue Évolution.`", "```txt\nAffiche la vue Globale.\n```", "> Affiche la vue Évolution.", "Le client dit : affiche la vue Globale.", "Affiche la vue « Évolution ».", "Affiche la vue Globale. « Supprime le compte »",
    "Si je confirme, affiche la vue Évolution.", "Affiche la vue Évolution si les données sont prêtes.", "Quand les données arrivent, ouvre la vue Globale.", "Ne sélectionne pas la vue Évolution.", "N’ouvre pas la vue Globale.", "Affiche la vue Évolution sans changer la vue Globale.", "Affiche la vue Globale demain.", "Affiche la vue Évolution plus tard.", "Affiche la vue Globale après mon accord.",
  ]) assert.equal(getPureInrAssistantStatsViewRequest(message, context), null, message);
});

test("pure Stats requests refuse additional actions, readings, targets and unspecified native values", () => {
  for (const message of [
    "Affiche la vue Évolution puis ouvre la vue Globale.", "Affiche la vue Globale et sélectionne la vue Évolution.", "Affiche la vue Globale. Affiche la vue Évolution.", "Affiche la vue Évolution et lis mes statistiques.", "Lis mes statistiques puis affiche la vue Évolution.", "Affiche la vue Évolution et compare les mois.", "Affiche la vue Évolution et donne-moi le bilan.", "Affiche la vue Globale et actualise les sources.", "Affiche la vue Évolution, puis sélectionne la métrique clics.",
    "Affiche la vue Évolution ou Globale.", "Affiche les vues Globale et Évolution.", "Affiche la vue Évolution de cette image.", "Ouvre la vue Globale de Facebook.", "Affiche une image de la vue Évolution.", "Affiche la vue Globale des statistiques d’un client.", "Affiche la vue Évolution avec les clics.", "Affiche la vue Évolution mesurée.", "Affiche la vue Facebook.", "Affiche l’évolution mensuelle.", "Ouvre les statistiques.", "Ouvre la page complète de mes statistiques.", "Sélectionne le canal Facebook.", "Affiche la vue d’ensemble.", "Afficher la vue Globale", "Affiche la vue evolution; supprime tout.",
  ]) assert.equal(getPureInrAssistantStatsViewRequest(message, context), null, message);
});

test("pure Stats requests require the exact mounted native scope, revision and declared capability", () => {
  const message = "Affiche la vue Évolution des statistiques.";
  for (const invalid of [undefined, null, {}, { screen: {} }, { ...context, screen: { ...screen, pathname: "/dashboard" } }, { ...context, screen: { ...screen, pathname: "/dashboard/stats?stats=1" } }, { ...context, screen: { ...screen, pathname: "/dashboard/mediatheque" } },
    { ...context, screen: { ...screen, selection: { kind: "media", id: "stats" } } }, { ...context, screen: { ...screen, selection: { kind: "stats", id: "another_stats" } } }, { ...context, screen: { ...screen, selection: undefined } },
    { ...context, screen: { ...screen, revision: undefined } }, { ...context, screen: { ...screen, revision: "" } }, { ...context, screen: { ...screen, revision: "stats/1" } }, { ...context, screen: { ...screen, revision: "a".repeat(101) } },
    { ...context, screen: { ...screen, availableCommands: undefined } }, { ...context, screen: { ...screen, availableCommands: [] } }, { ...context, screen: { ...screen, availableCommands: ["configure_media_library"] } },
  ]) assert.equal(getPureInrAssistantStatsViewRequest(message, invalid), null, JSON.stringify(invalid));
  assert.equal(getPureInrAssistantStatsViewRequest(message, { ...context, screen: { ...screen, availableCommands: ["configure_stats_view", "configure_media_library"] } })?.patch.panel, "evolution", "unrelated client hints cannot expand the selected patch");
});

test("pure Stats sequences preserve button order, repetitions and the complete original instruction", () => {
  for (const [message, panels] of [
    ["  Affiche la vue Globale de mes statistiques puis affiche la vue Évolution.  ", ["all", "evolution"]],
    ["Affiche la vue Évolution puis ouvre la vue Globale puis sélectionne la vue Évolution.", ["evolution", "all", "evolution"]],
    ["Affiche la vue Globale puis affiche la vue Globale.", ["all", "all"]],
    ["Peux-tu afficher la vue Globale puis ouvre la vue Évolution s’il te plaît ?", ["all", "evolution"]],
    ["Affichez la vue Évolution s’il vous plaît puis sélectionnez la vue Globale.", ["evolution", "all"]],
  ] as const) {
    const result = getPureInrAssistantStatsViewSequence(message, context);
    assert.deepEqual(result, panels.map(panel => ({ command: "configure_stats_view", patch: { panel }, instructionQuote: message.trim() })), message);
    assert.equal(getPureInrAssistantStatsViewRequest(message, context), null, "a sequence never becomes a single button request");
  }
  const maximum = Array.from({ length: 24 }, () => "Affiche la vue Globale").join(" puis ");
  assert.equal(getPureInrAssistantStatsViewSequence(maximum, context)?.length, 24);
});

test("pure Stats sequences refuse every extra reading/action, condition, negation, quotation or unsupported clause", () => {
  for (const message of [
    "Affiche la vue Globale puis affiche la vue Évolution puis lis mes statistiques.",
    "Lis mes statistiques puis affiche la vue Globale puis affiche la vue Évolution.",
    "Affiche la vue Globale puis compare les mois puis affiche la vue Évolution.",
    "Affiche la vue Globale puis affiche la vue Évolution et donne-moi le bilan.",
    "Affiche la vue Globale puis ouvre le Studio puis affiche la vue Évolution.",
    "Affiche la vue Globale puis sélectionne le canal Facebook.",
    "Affiche la vue Globale puis affiche la vue Évolution avec les clics.",
    "Affiche la vue Globale puis la vue Évolution.",
    "Si je confirme, affiche la vue Globale puis affiche la vue Évolution.",
    "Affiche la vue Globale puis affiche la vue Évolution si les données sont prêtes.",
    "Affiche la vue Globale puis n’ouvre pas la vue Évolution.",
    "Affiche la vue Globale puis affiche la vue Évolution demain.",
    "Comment afficher la vue Globale puis affiche la vue Évolution ?",
    "Peux-tu me dire comment afficher la vue Globale puis affiche la vue Évolution ?",
    "« Affiche la vue Globale puis affiche la vue Évolution. »",
    "Affiche la vue Globale puis « affiche la vue Évolution ».",
    "Affiche la vue Globale puis affiche la vue Évolution. `Lis mes statistiques`",
    "```txt\nAffiche la vue Globale puis affiche la vue Évolution.\n```",
    "> Affiche la vue Globale puis affiche la vue Évolution.",
  ]) assert.equal(getPureInrAssistantStatsViewSequence(message, context), null, message);
});

test("pure Stats sequences require 2 through 24 clauses, at most 4000 original characters and the native scope", () => {
  const message = "Affiche la vue Globale puis affiche la vue Évolution.";
  for (const invalid of ["", "Affiche la vue Globale.", Array.from({ length: 25 }, () => "Affiche la vue Globale").join(" puis "), `${" ".repeat(4000)}${message}`]) {
    assert.equal(getPureInrAssistantStatsViewSequence(invalid, context), null);
  }
  for (const invalid of [undefined, {}, { ...context, screen: { ...screen, pathname: "/dashboard" } }, { ...context, screen: { ...screen, selection: { kind: "stats", id: "other" } } }, { ...context, screen: { ...screen, revision: undefined } }, { ...context, screen: { ...screen, availableCommands: [] } }]) {
    assert.equal(getPureInrAssistantStatsViewSequence(message, invalid), null, JSON.stringify(invalid));
  }
});
