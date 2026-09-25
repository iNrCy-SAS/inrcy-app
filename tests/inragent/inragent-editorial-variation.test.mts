import assert from "node:assert/strict";
import test from "node:test";

import {
  buildInrAgentEditorialFocusPlan,
  isInrAgentEditorialIdeaCovered,
} from "../../lib/inrAgentEditorialVariation.ts";
import {
  INR_AGENT_PUBLISH_THEMES,
  sanitizeInrAgentAutomationSettings,
} from "../../lib/inrAgentSettings.ts";

const slots = Array.from({ length: 6 }, (_, index) => ({
  slotKey: `publish:2026-10-${String(index + 1).padStart(2, "0")}`,
  sequence: index + 1,
  theme: ["conseils", "services", "faq"][index % 3],
}));

const business = {
  services: ["Pose de panneaux solaires", "Entretien photovoltaïque", "Dépannage onduleur"],
  intervention_zones: ["Arras", "Lens", "Douai"],
  strengths: ["Diagnostic précis", "Accompagnement transparent"],
  customer_typologies: ["Particuliers", "Professionnels"],
  ai_memory: {
    specialties: ["Autoconsommation", "Optimisation énergétique"],
    targetAudiences: ["Propriétaires", "Entreprises locales"],
    customerNeeds: ["Réduire sa facture", "Fiabiliser son installation"],
    differentiators: ["Explications simples", "Suivi durable"],
    keyArguments: ["Étude personnalisée", "Accompagnement de A à Z"],
    recentNewsItems: ["Préparer son installation avant l'hiver", "Comprendre son suivi de production"],
  },
};

test("les idées du professionnel passent une seule fois avant le relais iNr'ADN", () => {
  const plan = buildInrAgentEditorialFocusPlan({
    slots,
    business,
    publicationIdeas: [
      "Expliquer comment préparer son projet solaire",
      "Parler du bon entretien des panneaux",
    ],
    seed: "pro-priority",
  });

  assert.equal(plan[0].focus.source, "professional_idea");
  assert.equal(plan[0].focus.subject, "Expliquer comment préparer son projet solaire");
  assert.equal(plan[1].focus.source, "professional_idea");
  assert.equal(plan[1].focus.subject, "Parler du bon entretien des panneaux");
  assert.ok(plan.slice(2).every((slot) => slot.focus.source === "business_dna"));
  assert.equal(
    plan.filter((slot) => slot.focus.subject === "Expliquer comment préparer son projet solaire").length,
    1,
  );
  assert.ok(plan.slice(2).every((slot) => Boolean(slot.focus.service)));
  assert.ok(plan.slice(2).every((slot) => Boolean(slot.focus.mediaDirection)));
});

test("une idée déjà couverte est écartée au profit d'un autre sujet", () => {
  const plan = buildInrAgentEditorialFocusPlan({
    slots: slots.slice(0, 2),
    business,
    publicationIdeas: ["Isolation toiture : les étapes importantes", "Entretien photovoltaïque au fil des saisons"],
    historicalSubjects: ["Isolation toiture : les étapes importantes avant de lancer son projet"],
    seed: "covered-idea",
  });

  assert.equal(
    isInrAgentEditorialIdeaCovered(
      "Isolation toiture : les étapes importantes",
      ["Isolation toiture : les étapes importantes avant de lancer son projet"],
    ),
    true,
  );
  assert.equal(plan[0].focus.source, "professional_idea");
  assert.equal(plan[0].focus.subject, "Entretien photovoltaïque au fil des saisons");
  assert.notEqual(plan[1].focus.subject, "Isolation toiture : les étapes importantes");
});

test("les prestations et les combinaisons iNr'ADN tournent avant répétition", () => {
  const plan = buildInrAgentEditorialFocusPlan({
    slots,
    business,
    seed: "balanced-dna",
  });

  const firstThreeServices = plan.slice(0, 3).map((slot) => slot.focus.service);
  assert.equal(new Set(firstThreeServices).size, 3);
  assert.ok(
    plan.every((slot) => slot.focus.zone || slot.focus.audience || slot.focus.strength),
  );
  assert.equal(new Set(plan.slice(0, 2).map((slot) => slot.focus.contextualHook)).size, 2);
  assert.ok(new Set(plan.slice(0, 2).map((slot) => slot.focus.businessArgument)).size >= 2);
  assert.ok(new Set(plan.map((slot) => slot.focus.focusKey)).size >= 5);
});

test("un même créneau garde exactement le même focus lors d'un retry", () => {
  const first = buildInrAgentEditorialFocusPlan({
    slots,
    business,
    publicationIdeas: ["Mettre en avant l'accompagnement du premier diagnostic"],
    seed: "stable-retry",
  });
  const retry = buildInrAgentEditorialFocusPlan({
    slots,
    business,
    publicationIdeas: ["Mettre en avant l'accompagnement du premier diagnostic"],
    seed: "stable-retry",
  });

  assert.deepEqual(retry, first);
});

test("un focus déjà planifié reste intact quand l'horizon se reconcilie", () => {
  const first = buildInrAgentEditorialFocusPlan({
    slots,
    business,
    seed: "preserve-focus",
  });
  const existingFocusBySlotKey = new Map([
    [slots[2].slotKey, first[2].focus],
  ]);
  const reconciled = buildInrAgentEditorialFocusPlan({
    slots,
    business,
    existingFocusBySlotKey,
    seed: "preserve-focus",
  });

  assert.deepEqual(reconciled[2].focus, first[2].focus);
});

test("tous les thèmes sont activés par défaut sans écraser un choix explicite", () => {
  const fresh = sanitizeInrAgentAutomationSettings("publish", {});
  assert.deepEqual(fresh.allowedThemes, [...INR_AGENT_PUBLISH_THEMES]);

  const migratedLegacyDefault = sanitizeInrAgentAutomationSettings("publish", {
    allowedThemes: ["conseils", "realisations", "offres", "actualites"],
    metadata: {},
  });
  assert.deepEqual(
    migratedLegacyDefault.allowedThemes,
    [...INR_AGENT_PUBLISH_THEMES],
  );

  const explicitChoice = sanitizeInrAgentAutomationSettings("publish", {
    allowedThemes: ["services", "faq"],
    metadata: {},
  });
  assert.deepEqual(explicitChoice.allowedThemes, ["services", "faq"]);
});
