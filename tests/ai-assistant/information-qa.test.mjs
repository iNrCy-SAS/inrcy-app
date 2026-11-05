import assert from "node:assert/strict";
import test from "node:test";
import { INR_ASSISTANT_INFORMATION_QA_CASES, evaluateInrAssistantInformationAnswer } from "../../scripts/inr-assistant-information-qa.mjs";

test("navigation QA rejects the reproduced false answer despite a working legacy URL", () => {
  const answer = "Pour gérer vos avis Google : Menu > « Réputation », ou Accueil > Gérer dans la section Réputation. [Avis Google](/dashboard/e-reputation).";
  const result = evaluateInrAssistantInformationAnswer("reviews-fr", answer);
  assert.equal(result.passed, false);
  assert.ok(result.violations.includes("obsolete_reputation_menu"));
  assert.ok(result.violations.includes("obsolete_reputation_home_section"));
  assert.equal(evaluateInrAssistantInformationAnswer("reviews-fr", "Ouvrez Mes canaux, choisissez Google Business puis Avis.").passed, true);
  assert.equal(evaluateInrAssistantInformationAnswer("reviews-en", "Open My channels, choose Google Business, then Reviews.").passed, true);
});

test("offer QA distinguishes manual Studio access from included credits", () => {
  assert.equal(evaluateInrAssistantInformationAnswer("basic-studio", "Oui, Basique donne accès à Studio. Aucun crédit inclus : les recharges permettent de générer selon le solde et les moteurs disponibles.").passed, true);
  assert.equal(evaluateInrAssistantInformationAnswer("basic-studio", "Basique donne accès à Studio avec une recharge de crédits, mais ne permet pas d’activer les agents.").passed, true);
  assert.equal(evaluateInrAssistantInformationAnswer("basic-studio", "Studio est réservé aux offres Standard et Premium ; le forfait Basique ne permet pas de générer, même avec des crédits.").passed, false);
});

test("subscription invoice QA rejects the client accounting destination", () => {
  assert.equal(evaluateInrAssistantInformationAnswer("subscription-invoices", "Mon compte → Factures, [Factures d’abonnement](/dashboard?panel=factures).").passed, true);
  assert.equal(evaluateInrAssistantInformationAnswer("subscription-invoices", "Mon compte → Factures : [Factures](/dashboard/factures).").passed, false);
});

test("all information scenarios have read-only contracts scored by the live evaluator", () => {
  assert.equal(new Set(INR_ASSISTANT_INFORMATION_QA_CASES.map((item) => item.id)).size, INR_ASSISTANT_INFORMATION_QA_CASES.length);
  for (const scenario of INR_ASSISTANT_INFORMATION_QA_CASES) {
    assert.equal(scenario.readOnly, true);
    assert.deepEqual(scenario.calls, {});
    assert.equal(evaluateInrAssistantInformationAnswer(scenario.answerContract, "").passed, false);
  }
});
