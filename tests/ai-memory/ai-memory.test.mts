import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_MEMORY_PROMPT_PAYLOAD_MAX_CHARS,
  EMPTY_AI_MEMORY,
  buildAiMemoryPromptPayload,
  getAiMemoryCompletionScore,
  mergeAiBusinessDnaAnalysis,
  mergeAiBusinessKnowledgeUpdate,
  mergeAiMemoryUpdate,
  mergeAiMemoryPremiumFields,
  normalizeAiMemory,
} from "../../lib/aiMemory.ts";

test("AI Memory sanitizes, deduplicates and bounds professional data", () => {
  const memory = normalizeAiMemory({
    detailed_description: `\u0000${"a".repeat(5_100)}`,
    raison_d_etre: " Rendre le numérique utile ",
    specialties: [" Façades ", "façades", "Isolation"],
    target_audiences: "Copropriétés; Maisons anciennes",
    brand_personality: [" Claire ", "claire", "Audacieuse"],
    engagements: ["Réponse sous 24 heures"],
    forbidden_vocabulary: ["leader", "Leader"],
  });

  assert.equal(memory.schemaVersion, 1);
  assert.equal(memory.detailedDescription.length, 5_000);
  assert.deepEqual(memory.specialties, ["Façades", "Isolation"]);
  assert.deepEqual(memory.targetAudiences, ["Copropriétés", "Maisons anciennes"]);
  assert.equal(memory.mission, "Rendre le numérique utile");
  assert.deepEqual(memory.brandPersonality, ["Claire", "Audacieuse"]);
  assert.deepEqual(memory.commitments, ["Réponse sous 24 heures"]);
  assert.deepEqual(memory.forbiddenVocabulary, ["leader"]);
});

test("Standard never exposes the three Premium memory blocks", () => {
  const memory = normalizeAiMemory({
    detailedDescription: "Contexte commun",
    offersAndArguments: "Offre Premium",
    proofsAndObjections: "Preuves Premium",
    editorialStrategy: "Stratégie Premium",
  }, { includePremium: false });

  assert.equal(memory.detailedDescription, "Contexte commun");
  assert.equal(memory.offersAndArguments, "");
  assert.equal(memory.proofsAndObjections, "");
  assert.equal(memory.editorialStrategy, "");
});

test("a temporary Standard period preserves previously saved Premium blocks", () => {
  const commonUpdate = normalizeAiMemory({ detailedDescription: "Nouvelle présentation" }, {
    includePremium: false,
  });
  const merged = mergeAiMemoryPremiumFields(commonUpdate, {
    offersAndArguments: "Offre conservée",
    proofsAndObjections: "Preuve conservée",
    editorialStrategy: "Stratégie conservée",
  });

  assert.equal(merged.detailedDescription, "Nouvelle présentation");
  assert.equal(merged.offersAndArguments, "Offre conservée");
  assert.equal(merged.proofsAndObjections, "Preuve conservée");
  assert.equal(merged.editorialStrategy, "Stratégie conservée");
});

test("a partial memory save preserves every omitted historical field", () => {
  const merged = mergeAiMemoryUpdate({
    mission: "Mission historique",
    values: ["Transparence"],
    preferredVocabulary: ["travail soigné"],
    forbiddenVocabulary: ["leader"],
    offersAndArguments: "Offre Premium conservée",
    richText: {
      offersAndArguments: "<div><strong>Offre Premium conservée</strong></div>",
    },
  }, {
    preferred_vocabulary: ["sur mesure"],
    values: [],
  });

  assert.equal(merged.mission, "Mission historique");
  assert.deepEqual(merged.values, [], "an explicit empty list remains a voluntary deletion");
  assert.deepEqual(merged.preferredVocabulary, ["sur mesure"]);
  assert.deepEqual(merged.forbiddenVocabulary, ["leader"]);
  assert.equal(merged.offersAndArguments, "Offre Premium conservée");
  assert.match(merged.richText.offersAndArguments, /Offre Premium conservée/);
});

test("changing one plain rich-text field regenerates only that rich field", () => {
  const merged = mergeAiMemoryUpdate({
    detailedDescription: "Ancienne description",
    offersAndArguments: "Offre inchangée",
    richText: {
      detailedDescription: "<div><strong>Ancienne description</strong></div>",
      offersAndArguments: "<div><em>Offre inchangée</em></div>",
    },
  }, { detailedDescription: "Nouvelle description" });

  assert.equal(merged.detailedDescription, "Nouvelle description");
  assert.match(merged.richText.detailedDescription, /Nouvelle description/);
  assert.doesNotMatch(merged.richText.detailedDescription, /Ancienne description/);
  assert.match(merged.richText.offersAndArguments, /<em>Offre inchangée<\/em>/);
});

test("a partial business knowledge save cannot erase services, zones or schedules", () => {
  const current = {
    description: "Description historique",
    services: ["Audit", "Conseil"],
    interventionZones: ["Lyon"],
    strengths: ["Réactivité"],
    customerTypes: ["Artisans"],
    weeklySchedule: {
      version: 1,
      days: {
        monday: { open: true, allDay: false, slots: [{ start: "09:00", end: "17:00" }] },
      },
      notes: "Sur rendez-vous",
    },
  };
  const merged = mergeAiBusinessKnowledgeUpdate(current, {
    description: "Description mise à jour",
  });

  assert.equal(merged.description, "Description mise à jour");
  assert.deepEqual(merged.services, ["Audit", "Conseil"]);
  assert.deepEqual(merged.interventionZones, ["Lyon"]);
  assert.deepEqual(merged.strengths, ["Réactivité"]);
  assert.deepEqual(merged.customerTypes, ["Artisans"]);
  assert.equal(merged.weeklySchedule.days.monday.open, true);
  assert.equal(merged.weeklySchedule.notes, "Sur rendez-vous");

  const explicitlyCleared = mergeAiBusinessKnowledgeUpdate(current, { services: [] });
  assert.deepEqual(explicitlyCleared.services, []);
  assert.deepEqual(explicitlyCleared.interventionZones, ["Lyon"]);
});

test("channel analysis enriches manual data without ever replacing it", () => {
  const result = mergeAiBusinessDnaAnalysis(
    {
      mission: "Rendre chaque chantier serein.",
      specialties: ["Rénovation sur mesure"],
      targetAudiences: ["Propriétaires exigeants"],
      brandPersonality: ["Rassurante"],
      commitments: ["Compte rendu après chaque étape"],
      offersAndArguments: "Offre rédigée manuellement",
    },
    {
      description: "Présentation rédigée et validée par le professionnel.",
      services: ["Audit initial"],
      strengths: ["Interlocuteur unique"],
    },
    {
      detailedDescription: "Présentation suggérée par l'analyse.",
      mission: "Une mission générique qui ne doit pas remplacer la version validée.",
      specialties: ["Rénovation sur mesure", "Suivi de chantier"],
      targetAudiences: ["Syndics"],
      brandPersonality: ["Pédagogue"],
      commitments: ["Devis détaillé"],
      offersAndArguments: "Offre proposée par l'IA",
    },
    {
      description: "Description proposée par l'IA.",
      services: ["Audit initial", "Planification"],
      strengths: ["Respect des délais"],
    },
    { includePremium: true },
  );

  assert.equal(
    result.businessKnowledge.description,
    "Présentation rédigée et validée par le professionnel.",
  );
  assert.deepEqual(result.businessKnowledge.services, ["Audit initial", "Planification"]);
  assert.deepEqual(result.businessKnowledge.strengths, [
    "Interlocuteur unique",
    "Respect des délais",
  ]);
  assert.deepEqual(result.memory.specialties, [
    "Rénovation sur mesure",
    "Suivi de chantier",
  ]);
  assert.deepEqual(result.memory.targetAudiences, [
    "Propriétaires exigeants",
    "Syndics",
  ]);
  assert.equal(result.memory.mission, "Rendre chaque chantier serein.");
  assert.deepEqual(result.memory.brandPersonality, ["Rassurante", "Pédagogue"]);
  assert.deepEqual(result.memory.commitments, [
    "Compte rendu après chaque étape",
    "Devis détaillé",
  ]);
  assert.equal(result.memory.offersAndArguments, "Offre rédigée manuellement");
  assert.ok(result.changedFields.includes("services"));
  assert.ok(result.addedItems >= 4);
});

test("Standard analysis cannot inject Premium strategy while keeping saved Premium data intact", () => {
  const result = mergeAiBusinessDnaAnalysis(
    {
      offersAndArguments: "Offre Premium existante",
      proofsAndObjections: "Preuve Premium existante",
      editorialStrategy: "Stratégie Premium existante",
    },
    {},
    {
      offersAndArguments: "Suggestion non autorisée",
      proofsAndObjections: "Suggestion non autorisée",
      editorialStrategy: "Suggestion non autorisée",
    },
    {},
    { includePremium: false },
  );

  assert.equal(result.memory.offersAndArguments, "Offre Premium existante");
  assert.equal(result.memory.proofsAndObjections, "Preuve Premium existante");
  assert.equal(result.memory.editorialStrategy, "Stratégie Premium existante");
  assert.doesNotMatch(JSON.stringify(result), /Suggestion non autorisée/);
});

test("Premium analysis fills an empty strategy block but still respects an existing one", () => {
  const result = mergeAiBusinessDnaAnalysis(
    { offersAndArguments: "Offre déjà validée" },
    {},
    {
      offersAndArguments: "Offre IA ignorée",
      proofsAndObjections: "Preuves suggérées",
      editorialStrategy: "Stratégie suggérée",
    },
    {},
    { includePremium: true },
  );

  assert.equal(result.memory.offersAndArguments, "Offre déjà validée");
  assert.equal(result.memory.proofsAndObjections, "Preuves suggérées");
  assert.equal(result.memory.editorialStrategy, "Stratégie suggérée");
});

test("completion remains optional and the prompt payload omits empty fields", () => {
  assert.equal(getAiMemoryCompletionScore(EMPTY_AI_MEMORY, { includePremium: false }), 0);

  const completeCore = normalizeAiMemory({
    detailedDescription: "Une présentation suffisamment précise de l'entreprise, de sa méthode, de son histoire et de ses engagements.",
    mission: "Rendre la rénovation fiable, lisible et sereine pour chaque propriétaire.",
    specialties: ["Façades", "Isolation"],
    targetAudiences: ["Propriétaires"],
    customerNeeds: ["Être rassuré sur les délais"],
    differentiators: ["Interlocuteur unique"],
    values: ["Transparence"],
    brandPersonality: ["Rassurante"],
    commitments: ["Réponse sous 24 heures"],
    preferredVocabulary: ["travail soigné"],
    forbiddenVocabulary: ["le meilleur"],
  });
  assert.equal(getAiMemoryCompletionScore(completeCore, { includePremium: false }), 100);

  const payload = buildAiMemoryPromptPayload({
    detailedDescription: "Entreprise familiale",
    mission: "Préserver les maisons anciennes",
    specialties: ["Rénovation"],
    brandPersonality: ["Rassurante"],
    commitments: ["Devis détaillé"],
  });
  assert.deepEqual(payload, {
    presentation_detaillee: "Entreprise familiale",
    mission_raison_d_etre: "Préserver les maisons anciennes",
    specialites: ["Rénovation"],
    personnalite_de_marque: ["Rassurante"],
    engagements: ["Devis détaillé"],
  });
});

test("even a fully completed memory stays compact enough for prompt injection", () => {
  const repeatedList = Array.from({ length: 30 }, (_, index) =>
    `${index}-${"x".repeat(200)}`,
  );
  const payload = buildAiMemoryPromptPayload({
    detailedDescription: "d".repeat(8_000),
    specialties: repeatedList,
    targetAudiences: repeatedList,
    customerNeeds: repeatedList,
    differentiators: repeatedList,
    values: repeatedList,
    preferredVocabulary: repeatedList,
    forbiddenVocabulary: repeatedList,
    offersAndArguments: "o".repeat(8_000),
    proofsAndObjections: "p".repeat(8_000),
    editorialStrategy: "s".repeat(8_000),
  });
  const serialized = JSON.stringify(payload);

  assert.ok(
    serialized.length <= AI_MEMORY_PROMPT_PAYLOAD_MAX_CHARS,
    `payload too large: ${serialized.length}`,
  );
  assert.ok(String(payload.presentation_detaillee).length >= 32);
  assert.ok(String(payload.offres_et_arguments).length >= 32);
  assert.ok((payload.specialites as string[]).length >= 1);
  assert.ok((payload.clienteles_cibles as string[]).length >= 1);
  assert.ok((payload.vocabulaire_interdit as string[]).length >= 1);
});
