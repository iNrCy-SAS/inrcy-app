import assert from "node:assert/strict";
import test from "node:test";

import {
  getBusinessDnaAnalysisDepthGaps,
  mergeBusinessDnaAnalysisDrafts,
} from "../../lib/businessDnaAnalysisDepth.ts";

test("a sparse DNA draft is explicitly routed through the completion pass", () => {
  const gaps = getBusinessDnaAnalysisDepthGaps(
    { description: "Court", services: [] },
    { mission: "", specialties: [] },
    { includePremium: true },
  );

  assert.ok(gaps.includes("businessKnowledge.description"));
  assert.ok(gaps.includes("memory.targetAudiences"));
  assert.ok(gaps.includes("memory.editorialStrategy"));
});

test("the completion pass enriches a draft without dropping primary facts", () => {
  const merged = mergeBusinessDnaAnalysisDrafts(
    {
      businessKnowledge: {
        description: "Entreprise de rénovation locale spécialisée dans les chantiers habités.",
        services: ["Rénovation intérieure"],
        strengths: ["Suivi de chantier"],
      },
      memory: {
        mission: "Rendre les travaux plus lisibles pour le client.",
        specialties: ["Rénovation intérieure"],
        recentNewsItems: ["Un chantier livré en septembre."],
      },
    },
    {
      businessKnowledge: {
        description: "Entreprise de rénovation locale spécialisée dans les chantiers habités, de la préparation à la réception, avec coordination des étapes et information régulière du client.",
        services: ["Coordination de chantier", "Rénovation de cuisine"],
        strengths: ["Communication régulière"],
      },
      memory: {
        mission: "Rendre les travaux plus lisibles pour le client, avec une organisation claire et des échanges réguliers du premier rendez-vous jusqu’à la réception.",
        specialties: ["Coordination de chantier", "Rénovation de cuisine"],
        recentNewsItems: ["Un chantier livré en septembre.", "Une rénovation de cuisine présentée en août."],
      },
    },
    { includePremium: false },
  );

  assert.deepEqual(merged.businessKnowledge.services, [
    "Rénovation intérieure",
    "Coordination de chantier",
    "Rénovation de cuisine",
  ]);
  assert.ok(merged.businessKnowledge.description.includes("coordination des étapes"));
  assert.ok(merged.memory.mission.includes("premier rendez-vous"));
  assert.equal(merged.memory.recentNewsItems.length, 2);
  assert.equal(merged.memory.offersAndArguments, "");
});

