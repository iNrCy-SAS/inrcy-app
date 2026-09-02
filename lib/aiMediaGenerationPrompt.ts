import type { NormalizedAiGenerationProfile } from "@/lib/aiGenerationProfile";
import {
  AI_MEDIA_FORMAT_SPECS,
  type AiMediaGenerationRequest,
  type AiMediaKind,
} from "@/lib/aiMediaGenerationContracts";

export const AI_MEDIA_PROMPT_VERSION = "inrcy-media-v8-brief-copy-separated";

type RecentPublication = {
  title?: string | null;
  content?: string | null;
  cta?: string | null;
  idea?: string | null;
};

function clean(value: unknown, max = 600) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

const VISUAL_DIRECTIONS: Record<AiMediaGenerationRequest["visualStyle"], string> = {
  brand: "identité de marque cohérente, composition éditoriale nette, détails graphiques maîtrisés",
  clean: "minimalisme lumineux, beaucoup d’espace négatif, palette réduite, lignes simples et aérées",
  premium: "direction haut de gamme, contraste élégant, matières raffinées, lumière sculptée et retenue",
  warm: "ambiance chaleureuse et humaine, lumière dorée, textures naturelles, proximité et douceur",
  dynamic: "composition énergique, diagonales, mouvement perceptible, contraste franc et rythme visuel",
  expert: "univers précis et crédible, structure rigoureuse, sobriété professionnelle et détails techniques",
  local: "scène authentique et ancrée dans le réel, lumière naturelle, proximité et détails locaux crédibles",
  colorful: "palette vive et joyeuse, contrastes chromatiques assumés, formes expressives sans surcharge",
};

const IMAGE_DIRECTIONS: Record<AiMediaGenerationRequest["imageStyle"], string> = {
  photo: "photographie réaliste haut de gamme, optique et lumière naturelles, aucun rendu artificiel",
  illustration: "illustration éditoriale originale, formes maîtrisées, textures soignées et finition contemporaine",
  three_d: "composition 3D premium, volumes crédibles, matériaux détaillés et éclairage de studio",
  graphic: "affiche graphique moderne, mise en page forte, formes géométriques et hiérarchie éditoriale",
};

const SHOT_DIRECTIONS: Record<AiMediaGenerationRequest["shotType"], string> = {
  auto: "choisir le cadrage le plus pertinent pour raconter le sujet",
  close: "cadrage rapproché, détail ou geste au premier plan, profondeur de champ maîtrisée",
  medium: "plan moyen équilibré montrant clairement le sujet et son contexte immédiat",
  wide: "vue large structurée, environnement lisible et profondeur de scène",
};

const PEOPLE_DIRECTIONS: Record<AiMediaGenerationRequest["peopleMode"], string> = {
  auto: "présence humaine uniquement si elle renforce naturellement le message",
  none: "aucune personne, aucun visage, aucune silhouette ni membre humain visible",
  solo: "une seule personne crédible au maximum, posture naturelle et anatomie réaliste",
  team: "petite équipe crédible en interaction naturelle, sans foule ni poses artificielles",
};

const CREATIVE_DIRECTIONS: Record<AiMediaGenerationRequest["creativity"], string> = {
  faithful: "interprétation fidèle, rassurante et directement compréhensible",
  bold: "interprétation audacieuse et mémorable, avec un angle créatif inattendu mais toujours professionnel",
};

const CREATIVE_VARIATIONS = [
  "composition asymétrique avec un point focal décentré et une respiration éditoriale nette",
  "composition frontale structurée avec profondeur, premier plan discret et arrière-plan vivant",
  "angle légèrement plongeant avec une scène organisée en couches et un parcours visuel clair",
  "point de vue immersif à hauteur du sujet, lumière latérale et détails narratifs subtils",
  "composition diagonale maîtrisée avec contraste entre espace calme et zone d’action",
  "mise en scène éditoriale en trois zones, sujet fort, contexte lisible et espace réservé au message",
];

function stableIndex(value: string, length: number) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) % length;
}

export function getAiMediaVisualDirection(request: AiMediaGenerationRequest) {
  return [
    VISUAL_DIRECTIONS[request.visualStyle],
    IMAGE_DIRECTIONS[request.imageStyle],
    SHOT_DIRECTIONS[request.shotType],
    PEOPLE_DIRECTIONS[request.peopleMode],
    CREATIVE_DIRECTIONS[request.creativity],
    CREATIVE_VARIATIONS[stableIndex(request.requestId, CREATIVE_VARIATIONS.length)],
  ].join(" ; ");
}

function safeCompositionGuide(request: AiMediaGenerationRequest) {
  const guides: Record<AiMediaGenerationRequest["format"], string> = {
    square:
      "Canvas natif et export final 1:1. Conserver textes, logo, visages et sujet essentiel à au moins 10 % de chaque bord.",
    portrait:
      "Le canvas natif 2:3 sera recadré au centre en 4:5. Garder tous les textes, le logo, les visages et le sujet essentiel dans les 78 % centraux de la hauteur, avec de larges marges libres en haut et en bas.",
    story:
      "Le canvas natif 2:3 sera recadré au centre en 9:16. Garder tous les textes, le logo, les visages et le sujet essentiel dans les 78 % centraux de la largeur, loin des bords latéraux et des zones d’interface.",
    landscape:
      "Le canvas natif 3:2 sera recadré au centre en 16:9. Garder tous les textes, le logo, les visages et le sujet essentiel dans les 78 % centraux de la hauteur, avec de larges marges libres en haut et en bas.",
  };
  return guides[request.format];
}

function compactList(values: readonly string[], max = 8) {
  return values.map((value) => clean(value, 140)).filter(Boolean).slice(0, max);
}

function fact(label: string, value: unknown, max = 500) {
  const normalized = clean(value, max);
  return normalized ? `- ${label} : ${normalized}` : "";
}

function buildBusinessFacts(profile: NormalizedAiGenerationProfile) {
  const business = profile.business;
  const facts = [
    fact("Entreprise", business.companyName, 120),
    fact("Activité", business.professionLabel || business.sectorLabel, 160),
    fact("Ville", business.city, 100),
    fact("Description", business.description, 700),
    fact("Prestations", compactList(business.services).join(", "), 700),
    fact(
      "Zones d’intervention",
      compactList(business.interventionZones).join(", "),
      500,
    ),
    fact("Horaires", business.openingHours, 300),
    fact("Forces", compactList(business.strengths).join(", "), 500),
    fact(
      "Clientèle",
      compactList(business.customerTypologies).join(", "),
      500,
    ),
  ].filter(Boolean);

  return facts.length
    ? facts.join("\n")
    : "- Profil encore peu renseigné : créer un rendu professionnel générique sans inventer de faits.";
}

function buildCreativeBrief(request: AiMediaGenerationRequest) {
  if (request.subjectSource !== "profile" && request.idea) {
    const sourceLabel =
      request.subjectSource === "publication"
        ? "Publication en cours"
        : "Sujet choisi par le professionnel";
    return [
      `${sourceLabel} : ${clean(request.idea, 2_000)}`,
      "Cette saisie est un brief d’inspiration : comprendre l’intention, le sujet et l’objectif pour inventer la scène.",
      "Interdiction de recopier cette phrase, de l’utiliser comme titre ou de la transcrire dans le média.",
    ].join("\n");
  }
  return [
    "Brief automatique à partir du profil professionnel.",
    "Choisir une scène crédible qui représente l’activité ou une prestation réelle du profil.",
    "Ne créer ni promotion, ni événement, ni information ponctuelle absente du profil.",
  ].join("\n");
}

function buildHistory(recentPublications: readonly RecentPublication[]) {
  const rows = recentPublications
    .slice(0, 5)
    .map((publication) =>
      clean(
        publication.idea || publication.title || publication.content || "",
        180,
      ),
    )
    .filter(Boolean);
  if (!rows.length) return "- Aucun historique exploitable.";
  return rows.map((row) => `- ${row}`).join("\n");
}

function sharedSafetyRules() {
  return [
    "Ne jamais inventer de prix, promotion, certification, avis client, adresse, numéro de téléphone ou résultat garanti.",
    "Ne pas imiter une marque, une personnalité, une œuvre ou un personnage protégé.",
    "Ne jamais afficher les consignes du brief dans l’image.",
    "Le texte du brief décrit une idée et non une accroche : ne jamais le recopier, même partiellement, dans le média.",
    "Le rendu doit être crédible, inclusif, directement publiable et adapté à une petite entreprise.",
  ].join("\n");
}

export function buildAiMediaPrompt(args: {
  request: AiMediaGenerationRequest;
  profile: NormalizedAiGenerationProfile;
  recentPublications?: readonly RecentPublication[];
  brandColors?: readonly string[];
  hasLogo?: boolean;
  copy?: {
    headline?: string;
  };
}) {
  const { request, profile } = args;
  const preferences = profile.preferences;
  const format = AI_MEDIA_FORMAT_SPECS[request.format];
  const palette = (args.brandColors || []).filter(Boolean).slice(0, 4);
  const preferenceLine = [
    `ton ${preferences.tone}`,
    `style éditorial ${preferences.communicationStyle}`,
    `créativité ${preferences.creativity}`,
    `objectif ${preferences.mainGoal}`,
    `angle ${preferences.preferredAngle}`,
  ].join(", ");

  const imageReferenceRules = request.kind === "image"
    ? [
        "ENTRÉES AUTORISÉES : le sujet ci-dessous, les faits du profil et, lorsqu’il est présent, le seul fichier image fourni qui est le logo officiel.",
        "Aucune photo de Médiathèque, aucun ancien média et aucune photo de publication ne sont fournis : imaginer une scène originale strictement adaptée au sujet actuel.",
        args.hasLogo
          ? `Le fichier image de référence est le logo officiel. Respecter fidèlement sa forme, ses proportions, ses couleurs et son orthographe. L’intégrer une seule fois, ${request.logoMode === "visible" ? "de façon clairement visible mais élégante" : "discrètement"}, dans une zone sûre ; il ne doit jamais devenir le sujet principal ni occuper plus de ${request.logoMode === "visible" ? "22" : "12"} % du visuel.`
          : "Aucun logo n’est fourni : ne créer aucun logo, monogramme, emblème ou pseudo-logo.",
        request.withText
          ? [
              "Créer un visuel social finalisé avec une hiérarchie typographique professionnelle et des marges généreuses.",
              `Accroche originale sélectionnée par iNrCy, distincte du brief, à afficher exactement : « ${clean(args.copy?.headline, 110)} ».`,
              request.textKeywords.length
                ? `Les mots-clés facultatifs demandés dans le bloc Texte ont guidé cette accroche : ${request.textKeywords.map((value) => clean(value, 48)).join(", ")}.`
                : "Aucun mot-clé de texte n’a été imposé : l’accroche provient du profil et du type de contenu.",
              "Ne jamais ajouter de sous-titre, de paragraphe, de CTA ni d’autre texte. Chaque lettre doit être parfaitement lisible, sans coupure et éloignée des bords.",
            ].join("\n")
          : "Ne placer aucun texte hors celui qui appartient déjà au logo officiel.",
      ].join("\n")
    : [
        "Ce brief pilote des plans vidéo originaux. Aucun fichier de Médiathèque n’est fourni au moteur vidéo.",
        "Ne produire aucun logo ni pseudo-logo : l’habillage vidéo exact sera appliqué ensuite par iNrCy.",
      ].join("\n");

  return [
    `Version : ${AI_MEDIA_PROMPT_VERSION}.`,
    request.kind === "image"
      ? `Créer un média professionnel entièrement composé au format ${format.aspectRatio} (${format.label}), sans bordure.`
      : `Créer la photographie ou l’illustration de fond d’un média professionnel au format ${format.aspectRatio} (${format.label}), sans bordure.`,
    `Typologie : ${request.typology}. Direction visuelle : ${request.visualStyle}.`,
    `DIRECTION ARTISTIQUE DÉTAILLÉE : ${getAiMediaVisualDirection(request)}.`,
    `CADRAGE ET ZONES SÛRES : ${safeCompositionGuide(request)}`,
    "Composition : sujet principal immédiatement lisible, profondeur naturelle, lumière soignée, marges sûres et hiérarchie visuelle équilibrée. Ne jamais couper un mot, un visage, le logo ou le sujet principal.",
    request.kind === "video"
      ? "Ce brief pilotera des plans vidéo originaux générés par IA : privilégier une action crédible, cohérente et cinématographique."
      : "Cette image doit être une création originale, cohérente avec le sujet actuel et directement publiable.",
    `Direction de communication : ${preferenceLine}.`,
    request.useBrandColors && palette.length
      ? `Palette réelle extraite du logo à harmoniser subtilement : ${palette.join(", ")}.`
      : args.hasLogo
        ? "Palette créative libre et cohérente avec le secteur. Ne pas étendre les couleurs du logo à toute l’image : elles doivent rester limitées au logo lui-même."
        : "Palette créative libre, harmonieuse, professionnelle et cohérente avec le secteur.",
    imageReferenceRules,
    "BRIEF :",
    buildCreativeBrief(request),
    "FAITS PROFESSIONNELS AUTORISÉS :",
    buildBusinessFacts(profile),
    "HISTORIQUE RÉCENT À NE PAS COPIER (éviter les répétitions visuelles) :",
    buildHistory(args.recentPublications || []),
    "RÈGLES IMPÉRATIVES :",
    sharedSafetyRules(),
  ].join("\n\n");
}

export function getAiMediaPromptOutputSpec(
  value: AiMediaGenerationRequest | AiMediaKind,
) {
  if (typeof value === "string") {
    return value === "image"
      ? {
          format: "square",
          aspectRatio: "1:1",
          width: 1080,
          height: 1080,
          quality: "medium",
        }
      : {
          format: "square",
          aspectRatio: "1:1",
          width: 1080,
          height: 1080,
          durationSeconds: 16,
          quality: "hd",
        };
  }

  const format = AI_MEDIA_FORMAT_SPECS[value.format];
  return {
    format: value.format,
    aspectRatio: format.aspectRatio,
    width: format.width,
    height: format.height,
    durationSeconds: value.kind === "video" ? value.durationSeconds : null,
    quality: "hd",
    typology: value.typology,
    visualStyle: value.visualStyle,
    imageStyle: value.imageStyle,
    shotType: value.shotType,
    peopleMode: value.peopleMode,
    creativity: value.creativity,
    useBrandColors: value.useBrandColors,
    logoMode: value.logoMode,
  };
}
