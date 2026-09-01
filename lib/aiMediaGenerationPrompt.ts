import type { NormalizedAiGenerationProfile } from "@/lib/aiGenerationProfile";
import type {
  AiMediaGenerationRequest,
  AiMediaKind,
} from "@/lib/aiMediaGenerationContracts";

export const AI_MEDIA_PROMPT_VERSION = "inrcy-media-v3";

function clean(value: unknown, max = 600) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

function compactList(values: readonly string[], max = 5) {
  return values.map((value) => clean(value, 120)).filter(Boolean).slice(0, max);
}

function buildBusinessFacts(profile: NormalizedAiGenerationProfile) {
  const business = profile.business;
  const facts = [
    business.companyName ? `Nom vérifié : ${clean(business.companyName, 120)}` : "",
    business.professionLabel || business.sectorLabel
      ? `Activité vérifiée : ${clean(business.professionLabel || business.sectorLabel, 140)}`
      : "",
    business.city ? `Ville vérifiée : ${clean(business.city, 100)}` : "",
    business.description
      ? `Description : ${clean(business.description, 500)}`
      : "",
    compactList(business.services).length
      ? `Services : ${compactList(business.services).join(", ")}`
      : "",
    compactList(business.strengths).length
      ? `Points forts : ${compactList(business.strengths).join(", ")}`
      : "",
  ].filter(Boolean);

  return facts.length
    ? facts.map((fact) => `- ${fact}`).join("\n")
    : "- Aucun fait professionnel supplémentaire n’est disponible : rester générique.";
}

function buildCreativeBrief(request: AiMediaGenerationRequest) {
  if (request.subjectSource !== "profile" && request.idea) {
    const sourceLabel =
      request.subjectSource === "publication"
        ? "Sujet et contenu de la publication en cours"
        : "Autre sujet choisi par le professionnel";
    return `${sourceLabel} (à comprendre, jamais à recopier dans le média) : ${clean(request.idea, 2_000)}`;
  }
  return [
    "BRIEF AUTOMATIQUE ACTIVITÉ : aucun sujet ponctuel n’a été fourni.",
    "Construire le média exclusivement à partir des faits professionnels vérifiés ci-dessous et de la direction de communication du profil.",
    "Choisir une scène représentative, crédible et immédiatement compréhensible de l’activité, sans inventer d’offre ni d’information.",
  ].join("\n");
}

function sharedSafetyRules() {
  return [
    "Ne jamais inventer de prix, promotion, certification, avis client, adresse, numéro de téléphone ou résultat garanti.",
    "Ne pas imiter une marque, une personnalité, une œuvre ou un personnage protégé.",
    "Ne créer aucun faux logo : le nom de l’entreprise peut être écrit uniquement s’il figure dans les faits vérifiés.",
    "Le sujet du professionnel est uniquement un brief de création : ne jamais l’afficher, le citer ni le recopier textuellement dans le média.",
    "Le rendu doit être directement exploitable par une petite entreprise et rester crédible, élégant et inclusif.",
  ].join("\n");
}

export function buildAiMediaPrompt(args: {
  request: AiMediaGenerationRequest;
  profile: NormalizedAiGenerationProfile;
}) {
  const { request, profile } = args;
  const preferences = profile.preferences;
  const preferenceLine = [
    `ton ${preferences.tone}`,
    `style ${preferences.communicationStyle}`,
    `créativité ${preferences.creativity}`,
    `objectif ${preferences.mainGoal}`,
  ].join(", ");

  if (request.kind === "image") {
    const textRule = request.withText
      ? [
          "MODE TEXTE NATIF : intégrer dans l’image une seule accroche courte en français, pertinente pour le sujet, de 3 à 8 mots.",
          "Créer une accroche marketing originale qui synthétise le brief et les faits vérifiés, puis la rendre une seule fois, parfaitement lisible, avec accents et orthographe exacts.",
          "Ne reprendre aucune phrase complète, formulation ou consigne du champ idée : le brief ne doit jamais devenir le texte de l’image.",
          "Ne jamais ajouter d’autre texte, de prix, de coordonnées, de hashtag ou de micro-typographie.",
        ].join("\n")
      : [
          "MODE SANS TEXTE : l’image ne doit contenir aucune lettre, aucun mot, aucun chiffre, aucune typographie, aucun filigrane et aucune signalétique lisible.",
          "Éviter aussi les pseudo-lettres décoratives et les logos inventés.",
        ].join("\n");

    return [
      `Version de prompt : ${AI_MEDIA_PROMPT_VERSION}.`,
      "Créer un visuel publicitaire professionnel carré 1:1, 1024 × 1024, destiné aux réseaux sociaux.",
      "Composition universelle : sujet principal clair, marges de sécurité généreuses, lumière soignée, détails réalistes, aucune bordure.",
      `Direction de communication : ${preferenceLine}.`,
      buildCreativeBrief(request),
      "Faits professionnels autorisés :",
      buildBusinessFacts(profile),
      textRule,
      "Règles impératives :",
      sharedSafetyRules(),
    ].join("\n\n");
  }

  return [
    `Version de prompt : ${AI_MEDIA_PROMPT_VERSION}.`,
    "Créer une vidéo publicitaire professionnelle exactement pensée pour 8 secondes, carrée 1:1 et en qualité HD.",
    "Une scène principale cohérente avec un mouvement naturel et stable, un début immédiatement compréhensible et une fin propre utilisable en boucle.",
    "Ne générer aucun son : la bande musicale sera ajoutée ensuite par iNrCy.",
    "La vidéo ne doit contenir aucune lettre, aucun mot, aucun chiffre, aucun sous-titre, aucun filigrane, aucune signalétique lisible et aucun logo inventé.",
    "Éviter les coupes frénétiques, les déformations de visages ou de mains, le scintillement et les changements brusques de sujet.",
    `Direction de communication : ${preferenceLine}.`,
    buildCreativeBrief(request),
    "Faits professionnels autorisés :",
    buildBusinessFacts(profile),
    "Règles impératives :",
    sharedSafetyRules(),
  ].join("\n\n");
}

export function getAiMediaPromptOutputSpec(kind: AiMediaKind) {
  return kind === "image"
    ? { aspectRatio: "1:1", width: 1024, height: 1024, quality: "medium" }
    : { aspectRatio: "1:1", width: 1080, height: 1080, durationSeconds: 8, quality: "hd" };
}
