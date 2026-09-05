import type { NormalizedAiGenerationProfile } from "@/lib/aiGenerationProfile";
import { fitPromptPayloadToJsonBudget } from "./aiPromptBudget.ts";

interface DnaObject {
  [key: string]: DnaValue;
}

// Le prompt image complet est volontairement borné à 12k caractères côté
// Gateway. Garder l'ADN sous 3,2k laisse de la place au brief, au cadrage, aux
// règles de sécurité et au schéma des copywriters/voix off.
export const AI_MEDIA_DNA_PAYLOAD_MAX_CHARS = 3_200;

type DnaValue = string | string[] | DnaObject;

function cleanText(value: unknown, maximum: number) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .trim()
    .slice(0, maximum);
}

function cleanList(
  value: readonly string[] | undefined,
  maximumItems = 10,
  maximumLength = 120,
) {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const raw of value || []) {
    const item = cleanText(raw, maximumLength).replace(/\s+/g, " ");
    const key = item.toLocaleLowerCase();
    if (!item || seen.has(key)) continue;
    seen.add(key);
    result.push(item);
    if (result.length >= maximumItems) break;
  }
  return result;
}

function compactRecord(
  value: Record<string, DnaValue | undefined>,
): DnaObject {
  const result: DnaObject = {};

  for (const [key, item] of Object.entries(value)) {
    if (typeof item === "string") {
      if (item) result[key] = item;
      continue;
    }
    if (Array.isArray(item)) {
      if (item.length) result[key] = item;
      continue;
    }
    if (!item) continue;

    const nested = compactRecord(item);
    if (Object.keys(nested).length) result[key] = nested;
  }

  return result;
}

function mergeDnaRecords(base: DnaObject, priority: DnaObject): DnaObject {
  const result: DnaObject = { ...base };
  for (const [key, value] of Object.entries(priority)) {
    const current = result[key];
    if (
      current &&
      value &&
      typeof current === "object" &&
      typeof value === "object" &&
      !Array.isArray(current) &&
      !Array.isArray(value)
    ) {
      result[key] = mergeDnaRecords(current, value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

/**
 * Contexte unique du studio média. Il ne contient ni coordonnées privées, ni
 * jetons, ni messages : uniquement les faits professionnels validés dans
 * l'ADN et les réglages éditoriaux utiles à la génération.
 *
 * Les champs stratégiques Premium arrivent déjà filtrés par le serveur. La
 * vérification `premiumEnabled` ci-dessous garde une seconde barrière au plus
 * près du prompt afin qu'un profil Standard ne puisse jamais les réinjecter.
 */
export function buildAiMediaBusinessDnaPayload(
  profile: NormalizedAiGenerationProfile,
) {
  const business = profile.business;
  const memory = profile.memory;
  const preferences = profile.preferences;

  const payload = compactRecord({
    activite_et_prestations: {
      entreprise: cleanText(business.companyName, 100),
      secteur: cleanText(business.sectorLabel, 120),
      metier: cleanText(business.professionLabel, 140),
      presentation: cleanText(
        memory.detailedDescription || business.description,
        2_000,
      ),
      mission_raison_d_etre: cleanText(memory.mission, 700),
      prestations: cleanList(business.services, 12, 140),
      specialites: cleanList(memory.specialties, 12, 140),
    },
    clients_et_positionnement: {
      clienteles: cleanList(business.customerTypologies, 10, 120),
      audiences_prioritaires: cleanList(memory.targetAudiences, 12, 140),
      besoins_attentes_freins: cleanList(memory.customerNeeds, 12, 140),
      forces: cleanList(business.strengths, 10, 140),
      differences: cleanList(memory.differentiators, 10, 140),
    },
    zones_et_horaires: {
      ville: cleanText(business.city, 100),
      code_postal: cleanText(business.postalCode, 24),
      zones_intervention: cleanList(business.interventionZones, 15, 140),
      horaires: cleanText(business.openingHours, 1_000),
    },
    identite_valeurs_vocabulaire: {
      valeurs: cleanList(memory.values, 10, 100),
      personnalite_de_marque: cleanList(memory.brandPersonality, 10, 100),
      engagements: cleanList(memory.commitments, 10, 140),
      vocabulaire_a_privilegier: cleanList(
        memory.preferredVocabulary,
        12,
        100,
      ),
      vocabulaire_interdit: cleanList(memory.forbiddenVocabulary, 12, 100),
    },
    offres_et_strategie_premium: preferences.premiumEnabled
      ? {
          offres_arguments: cleanText(memory.offersAndArguments, 1_800),
          preuves_objections_garanties: cleanText(
            memory.proofsAndObjections,
            1_800,
          ),
          strategie_editoriale_saisonnalite: cleanText(
            memory.editorialStrategy,
            1_800,
          ),
        }
      : undefined,
    configuration_ia: {
      langue: preferences.language,
      ton: preferences.tone,
      style: preferences.communicationStyle,
      originalite: preferences.creativity,
      emojis: preferences.emojiLevel,
      technicite: preferences.technicalityLevel,
      humour: preferences.humorLevel,
      pronom: preferences.voice,
      relation_lecteur: preferences.addressMode,
      niveau_commercial: preferences.commercialLevel,
      objectif: preferences.mainGoal,
      angle: preferences.preferredAngle,
      appel_action: preferences.preferredCta,
      contenu_apprecie_1: cleanText(preferences.likedExample, 900),
      contenu_apprecie_2: cleanText(preferences.likedExample2, 900),
      consignes_personnalisees: cleanText(
        preferences.customInstructions,
        900,
      ),
    },
  });
  // Ces repères décident directement du sujet et de la conformité de marque.
  // Ils sont réservés avant de répartir la place restante entre les détails :
  // un ADN maximal ne peut pas les faire disparaître par simple réduction
  // proportionnelle.
  const priorityPayload = compactRecord({
    activite_et_prestations: {
      entreprise: cleanText(business.companyName, 120),
      metier: cleanText(
        business.professionLabel || business.sectorLabel,
        110,
      ),
      prestation_principale: cleanText(business.services[0], 110),
    },
    clients_et_positionnement: {
      public_prioritaire: cleanText(
        memory.targetAudiences[0] || business.customerTypologies[0],
        110,
      ),
      difference_principale: cleanText(
        memory.differentiators[0] || business.strengths[0],
        110,
      ),
    },
    zones_et_horaires: {
      zone_principale: cleanText(
        business.interventionZones[0] || business.city,
        100,
      ),
    },
    identite_valeurs_vocabulaire: {
      vocabulaire_interdit: cleanList(
        memory.forbiddenVocabulary,
        2,
        64,
      ),
    },
    configuration_ia: {
      langue: preferences.language,
      ton: preferences.tone,
      style: preferences.communicationStyle,
      consignes_personnalisees: cleanText(
        preferences.customInstructions,
        160,
      ),
    },
  });
  const reservedChars = JSON.stringify(priorityPayload).length + 96;
  let optionalBudget = Math.max(
    2,
    AI_MEDIA_DNA_PAYLOAD_MAX_CHARS - reservedChars,
  );
  let compacted = fitPromptPayloadToJsonBudget(payload, optionalBudget);
  let result = mergeDnaRecords(compacted, priorityPayload);

  // La fusion remplace des clés du payload optionnel et est généralement plus
  // petite que la somme des deux JSON. Cette boucle couvre malgré tout les
  // échappements pathologiques sans jamais toucher aux repères réservés.
  for (
    let attempt = 0;
    JSON.stringify(result).length > AI_MEDIA_DNA_PAYLOAD_MAX_CHARS && attempt < 3;
    attempt += 1
  ) {
    const overflow =
      JSON.stringify(result).length - AI_MEDIA_DNA_PAYLOAD_MAX_CHARS;
    optionalBudget = Math.max(2, optionalBudget - overflow - 32);
    compacted = fitPromptPayloadToJsonBudget(payload, optionalBudget);
    result = mergeDnaRecords(compacted, priorityPayload);
  }

  return result;
}

function first(value: readonly string[] | undefined, maximum = 100) {
  return cleanText(value?.find(Boolean), maximum);
}

/**
 * Version très compacte destinée au moteur vidéo. Les copywriters et le prompt
 * image reçoivent le payload structuré complet ; Veo/Omni ne reçoivent ici que
 * les repères visuels et factuels utiles, dans leur budget de prompt strict.
 */
export function buildAiMediaVideoDnaBrief(
  profile: NormalizedAiGenerationProfile,
) {
  const business = profile.business;
  const memory = profile.memory;
  const preferences = profile.preferences;
  const rows = [
    ["Entreprise", business.companyName],
    ["Métier", business.professionLabel || business.sectorLabel],
    ["Prestation", first(business.services, 120)],
    ["Spécialité", first(memory.specialties, 120)],
    ["Mission", cleanText(memory.mission, 160)],
    ["Public", first(memory.targetAudiences, 120) || first(business.customerTypologies, 120)],
    ["Besoin", first(memory.customerNeeds, 120)],
    ["Différence", first(memory.differentiators, 120) || first(business.strengths, 120)],
    ["Zone", first(business.interventionZones, 100) || business.city],
    ["Valeur", first(memory.values, 90)],
    ["Personnalité", first(memory.brandPersonality, 90)],
    ["Engagement", first(memory.commitments, 110)],
    ["Direction", `${preferences.tone}, ${preferences.communicationStyle}`],
    preferences.premiumEnabled
      ? ["Stratégie", cleanText(memory.editorialStrategy || memory.offersAndArguments, 160)]
      : ["Stratégie", ""],
  ];

  return cleanText(
    rows
      .map(([label, value]) => {
        const normalized = cleanText(value, 180);
        return normalized ? `${label}: ${normalized}` : "";
      })
      .filter(Boolean)
      .join(". "),
    1_800,
  );
}
