import assert from "node:assert/strict";
import test from "node:test";

import {
  AI_MEDIA_DNA_PAYLOAD_MAX_CHARS,
  buildAiMediaBusinessDnaPayload,
  buildAiMediaVideoDnaBrief,
} from "../../lib/aiMediaBusinessDna.ts";

type MediaDnaProfile = Parameters<typeof buildAiMediaBusinessDnaPayload>[0];

function buildProfile(premiumEnabled: boolean): MediaDnaProfile {
  return {
    kind: "inrcy.ai-generation-profile",
    version: 1,
    preferences: {
      premiumEnabled,
      engine: "openai",
      language: "fr",
      tone: "warm",
      communicationStyle: "expert",
      creativity: "creative",
      length: "medium",
      webLength: "long",
      socialLength: "short",
      emojiLevel: "light",
      voice: "nous",
      addressMode: "vous",
      commercialLevel: "balanced",
      technicalityLevel: "expert",
      humorLevel: "light",
      mainGoal: "contacts",
      preferredAngle: "quality",
      preferredCta: "devis",
      likedExample: "Une accroche sobre et utile.",
      likedExample2: "Un récit concret centré sur le client.",
      customInstructions: "Toujours citer la fabrication locale.",
    },
    business: {
      companyName: "Atelier Boréal",
      city: "Lille",
      postalCode: "59000",
      phone: "+33 6 00 00 00 00",
      email: "prive@example.test",
      sectorCode: "artisanat",
      sectorLabel: "Artisanat",
      professionCode: "menuiserie",
      professionLabel: "Menuiserie sur mesure",
      description: "Conception de mobilier durable.",
      services: ["Bibliothèques sur mesure", "Agencements professionnels"],
      interventionZones: ["Métropole lilloise"],
      openingDays: "",
      openingHours: "Du lundi au vendredi, 09:00–18:00",
      strengths: ["Finitions précises"],
      customerTypologies: ["Particuliers exigeants"],
    },
    memory: {
      schemaVersion: 1,
      detailedDescription:
        "L’atelier conçoit et fabrique localement du mobilier sur mesure en bois certifié.",
      mission: "Créer des pièces durables qui s’intègrent réellement aux usages.",
      specialties: ["Bois massif", "Petits espaces"],
      targetAudiences: ["Architectes d’intérieur"],
      customerNeeds: ["Optimiser un espace sans standardiser le résultat"],
      differentiators: ["Conception et fabrication dans le même atelier"],
      values: ["Durabilité"],
      brandPersonality: ["Précise"],
      commitments: ["Devis transparents"],
      preferredVocabulary: ["fait pour durer"],
      forbiddenVocabulary: ["prix cassé"],
      offersAndArguments: "Collections sur mesure et accompagnement de la conception à la pose.",
      proofsAndObjections: "Quinze ans d’expérience et garantie atelier.",
      editorialStrategy: "Mettre en avant les étapes de fabrication et les matières de saison.",
      richText: {
        detailedDescription: "",
        offersAndArguments: "",
        proofsAndObjections: "",
        editorialStrategy: "",
      },
    },
    request: {
      idea: "Une idée saisie par le professionnel",
      theme: "atelier",
      style: "photo",
      media: {
        type: "images",
        count: 1,
        hasVisualContext: false,
        hasAudioTranscript: false,
        context: "",
      },
    },
  };
}

test("le payload média couvre l’ADN professionnel et la configuration IA sans coordonnées privées", () => {
  const payload = buildAiMediaBusinessDnaPayload(buildProfile(false));
  const json = JSON.stringify(payload);

  for (const section of [
    "activite_et_prestations",
    "clients_et_positionnement",
    "zones_et_horaires",
    "identite_valeurs_vocabulaire",
    "configuration_ia",
  ]) {
    assert.ok(section in payload, `${section} doit alimenter le générateur média`);
  }

  for (const fact of [
    "Bibliothèques sur mesure",
    "Architectes d’intérieur",
    "Métropole lilloise",
    "Du lundi au vendredi",
    "Durabilité",
    "fait pour durer",
    "prix cassé",
    "expert",
    "light",
  ]) {
    assert.ok(json.includes(fact), `${fact} doit être injecté dans le contexte média`);
  }

  assert.doesNotMatch(json, /prive@example\.test|\+33 6 00 00 00 00/);
  assert.equal("offres_et_strategie_premium" in payload, false);
});

test("la stratégie média reste absente en Standard et apparaît uniquement en Premium", () => {
  const standard = JSON.stringify(buildAiMediaBusinessDnaPayload(buildProfile(false)));
  const premium = JSON.stringify(buildAiMediaBusinessDnaPayload(buildProfile(true)));

  for (const premiumFact of [
    "Collections sur mesure",
    "Quinze ans d’expérience",
    "matières de saison",
  ]) {
    assert.equal(standard.includes(premiumFact), false, `${premiumFact}: Standard`);
    assert.equal(premium.includes(premiumFact), true, `${premiumFact}: Premium`);
  }
});

test("le brief vidéo conserve les repères visuels majeurs de l’ADN", () => {
  const brief = buildAiMediaVideoDnaBrief(buildProfile(true));

  for (const fact of [
    "Atelier Boréal",
    "Menuiserie sur mesure",
    "Bois massif",
    "Architectes d’intérieur",
    "Métropole lilloise",
    "Durabilité",
    "Précise",
    "Devis transparents",
    "matières de saison",
  ]) {
    assert.ok(brief.includes(fact), `${fact} doit guider la vidéo`);
  }

  assert.doesNotMatch(brief, /prive@example\.test|\+33 6 00 00 00 00/);
});

test("un ADN maximal reste sous budget sans perdre les repères prioritaires", () => {
  const profile = buildProfile(true);
  const escaped = (label: string, length = 5_000) =>
    `${label} "\\\n`.repeat(Math.ceil(length / (label.length + 5))).slice(0, length);
  profile.business.companyName = "ENTREPRISE_PRIORITAIRE";
  profile.business.professionLabel = "METIER_PRIORITAIRE";
  profile.business.description = escaped("description");
  profile.business.services = [
    "PRESTATION_PRIORITAIRE",
    ...Array.from({ length: 20 }, (_, index) => escaped(`service-${index}`, 160)),
  ];
  profile.business.interventionZones = [
    "ZONE_PRIORITAIRE",
    ...Array.from({ length: 20 }, (_, index) => escaped(`zone-${index}`, 160)),
  ];
  profile.business.strengths = Array.from(
    { length: 20 },
    (_, index) => escaped(`force-${index}`, 160),
  );
  profile.business.customerTypologies = Array.from(
    { length: 20 },
    (_, index) => escaped(`client-${index}`, 160),
  );
  profile.memory.detailedDescription = escaped("presentation");
  profile.memory.targetAudiences = [
    "PUBLIC_PRIORITAIRE",
    ...Array.from({ length: 20 }, (_, index) => escaped(`public-${index}`, 160)),
  ];
  profile.memory.differentiators = [
    "DIFFERENCE_PRIORITAIRE",
    ...Array.from({ length: 20 }, (_, index) => escaped(`difference-${index}`, 160)),
  ];
  profile.memory.specialties = Array.from(
    { length: 20 },
    (_, index) => escaped(`specialite-${index}`, 160),
  );
  profile.memory.customerNeeds = Array.from(
    { length: 20 },
    (_, index) => escaped(`besoin-${index}`, 160),
  );
  profile.memory.values = Array.from(
    { length: 20 },
    (_, index) => escaped(`valeur-${index}`, 120),
  );
  profile.memory.brandPersonality = Array.from(
    { length: 20 },
    (_, index) => escaped(`personnalite-${index}`, 120),
  );
  profile.memory.commitments = Array.from(
    { length: 20 },
    (_, index) => escaped(`engagement-${index}`, 160),
  );
  profile.memory.forbiddenVocabulary = [
    "INTERDIT_PRIORITAIRE",
    ...Array.from({ length: 20 }, (_, index) => escaped(`interdit-${index}`, 120)),
  ];
  profile.memory.offersAndArguments = escaped("offres");
  profile.memory.proofsAndObjections = escaped("preuves");
  profile.memory.editorialStrategy = escaped("strategie");
  profile.preferences.language = "th";
  profile.preferences.tone = "warm";
  profile.preferences.communicationStyle = "expert";
  profile.preferences.customInstructions =
    "CONSIGNE_INTERDITE_PRIORITAIRE " + escaped("consigne", 1_200);

  const json = JSON.stringify(buildAiMediaBusinessDnaPayload(profile));

  assert.ok(json.length <= AI_MEDIA_DNA_PAYLOAD_MAX_CHARS);
  for (const fact of [
    "ENTREPRISE_PRIORITAIRE",
    "METIER_PRIORITAIRE",
    "PRESTATION_PRIORITAIRE",
    "PUBLIC_PRIORITAIRE",
    "DIFFERENCE_PRIORITAIRE",
    "ZONE_PRIORITAIRE",
    "INTERDIT_PRIORITAIRE",
    "CONSIGNE_INTERDITE_PRIORITAIRE",
    '"langue":"th"',
    '"ton":"warm"',
    '"style":"expert"',
  ]) {
    assert.ok(json.includes(fact), `${fact} doit survivre à la compaction`);
  }
});
