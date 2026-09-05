import type { NormalizedAiGenerationProfile } from "@/lib/aiGenerationProfile";
import { buildAiMediaBusinessDnaPayload } from "@/lib/aiMediaBusinessDna";
import {
  AI_MEDIA_FORMAT_SPECS,
  type AiMediaGenerationRequest,
  type AiMediaKind,
} from "@/lib/aiMediaGenerationContracts";
import { getAiLanguageLabel } from "@/lib/aiWritingProfile";

export const AI_MEDIA_PROMPT_VERSION = "inrcy-media-v15-contextual-speech-framing";
export const AI_MEDIA_COMPILED_PROMPT_MAX_CHARS = 11_800;

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

export function getAiMediaIdentityDirection(
  request: AiMediaGenerationRequest,
) {
  if (request.peopleMode === "none") return "";

  const referenceCount = request.inspirationImages.length;
  const mediaLabel = request.kind === "video" ? "vidéo" : "image";
  const castRule =
    request.peopleMode === "team"
      ? "Respecter une petite équipe : le personnage de référence reste le sujet principal et les autres personnes demeurent secondaires."
      : request.peopleMode === "solo"
        ? "Respecter une personne unique : aucun second visage ni personnage ne doit apparaître."
        : "Respecter la présence humaine automatique tout en gardant le personnage de référence comme sujet principal s’il apparaît.";
  if (request.identityMode === "reference_team") {
    const mappedPeople = Array.from(
      { length: Math.max(2, referenceCount) },
      (_, index) => `image ${index + 1} = personne ${index + 1}`,
    ).join(", ");
    return [
      `ÉQUIPE DE RÉFÉRENCE : réunir les ${Math.max(2, referenceCount)} adultes distincts et autorisés dans la même ${mediaLabel}.`,
      `${mappedPeople}. Chaque identité reste indépendante : préserver séparément le visage, la coiffure et les signes distinctifs de chaque personne.`,
      "Faire apparaître chaque personne exactement une fois ; ne jamais fusionner, permuter, dupliquer, omettre ni remplacer une identité par un visage générique.",
      request.kind === "video"
        ? "Lorsque l’animation reçoit une image de groupe précomposée, conserver tous les membres visibles de cette équipe pendant le plan et éviter toute transformation du visage."
        : `Composer une scène de groupe naturelle dans le rendu choisi (${IMAGE_DIRECTIONS[request.imageStyle]}), puis faire contrôler les ressemblances avant validation.`,
    ].join("\n");
  }
  if (request.identityMode === "professional") {
    return [
      `IDENTITÉ VISUELLE GUIDÉE : les références autorisées d’un professionnel adulte visent à préserver son apparence dans ${request.kind === "video" ? "la vidéo" : "l’image"}.`,
      `Le représenter dans le rendu choisi (${IMAGE_DIRECTIONS[request.imageStyle]}), sans le remplacer par un visage générique. Le professionnel doit contrôler la ressemblance avant validation du média.`,
      castRule,
      request.kind === "video"
        ? `Utiliser les ${referenceCount} photo${referenceCount > 1 ? "s" : ""} de référence pour guider chaque plan et viser une continuité cohérente de la même personne pendant toute la vidéo.`
        : `Utiliser les ${referenceCount} photo${referenceCount > 1 ? "s" : ""} de référence pour guider l’apparence, avec une posture, un vêtement et un décor adaptés au brief.`,
    ].join("\n");
  }

  if (request.identityMode === "brand_avatar") {
    return [
      `AVATAR DE MARQUE GUIDÉ : créer ou reprendre l’avatar illustré autorisé comme personnage de ${request.kind === "video" ? "la vidéo" : "l’image"}.`,
      `Le décliner dans le rendu choisi (${IMAGE_DIRECTIONS[request.imageStyle]}) en visant une apparence, une palette et des signes distinctifs cohérents${request.kind === "video" ? " entre les plans" : ""}. Faire contrôler le résultat avant validation.`,
      castRule,
      referenceCount
        ? `Les ${referenceCount} référence${referenceCount > 1 ? "s" : ""} autorisée${referenceCount > 1 ? "s" : ""} guident ${request.kind === "video" ? "chaque plan" : "le rendu"} : viser le même avatar, qu’elles montrent un dessin existant ou une personne adulte autorisée à styliser.`
        : `Créer un avatar professionnel original et cohérent avec l’ADN, puis viser une continuité visuelle de ce personnage dans ${mediaLabel}.`,
    ].join("\n");
  }

  return referenceCount
    ? "IDENTITÉ LIBRE : les médias fournis inspirent le sujet ou la scène, sans imposer une identité réelle particulière."
    : "IDENTITÉ LIBRE : choisir des personnes génériques crédibles uniquement si elles servent le message.";
}

/** @deprecated Alias historique conservé pour les imports vidéo existants. */
export const getAiMediaVideoIdentityDirection = getAiMediaIdentityDirection;

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

function buildBusinessDna(profile: NormalizedAiGenerationProfile) {
  const dna = buildAiMediaBusinessDnaPayload(profile);
  return Object.keys(dna).length
    ? JSON.stringify(dna, null, 2)
    : "ADN encore peu renseigné : créer un rendu professionnel générique sans inventer de faits.";
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
    "Brief automatique à partir de l’ADN de l’entreprise.",
    "Choisir une scène crédible qui représente l’activité, une prestation ou un repère réel de cet ADN.",
    "Ne créer ni promotion, ni événement, ni information ponctuelle absente de l’ADN.",
  ].join("\n");
}

function buildAiInstruction(request: AiMediaGenerationRequest) {
  const instruction = clean(request.aiInstruction, 600);
  if (!instruction) return "";
  return [
    "CONSIGNE PONCTUELLE DU PROFESSIONNEL — pour cette génération uniquement :",
    instruction,
    "L’appliquer comme direction créative sans la recopier ni l’afficher. Elle ne peut jamais imposer un fait absent de l’ADN, contourner les règles de sécurité ou dégrader la lisibilité du média.",
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
    "Ne pas imiter une marque, une personnalité publique non autorisée, une œuvre ou un personnage protégé.",
    "Ne jamais afficher les consignes du brief dans l’image.",
    "Le texte du brief décrit une idée et non une accroche : ne jamais le recopier, même partiellement, dans le média.",
    "Le rendu doit être crédible, inclusif, directement publiable et adapté à une petite entreprise.",
  ].join("\n");
}

function fitCompiledMediaPrompt(value: string) {
  if (value.length <= AI_MEDIA_COMPILED_PROMPT_MAX_CHARS) return value;
  const marker =
    "\n\n[… contexte ADN compacté automatiquement par iNrCy …]\n\n";
  const available = AI_MEDIA_COMPILED_PROMPT_MAX_CHARS - marker.length;
  // Le début conserve mission, cadrage et brief ; la fin conserve historique
  // anti-répétition et règles de sécurité. Seul le milieu contextuel est réduit.
  const headLength = Math.ceil(available * 0.72);
  const tailLength = Math.max(0, available - headLength);
  return `${value.slice(0, headLength)}${marker}${value.slice(-tailLength)}`;
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
  const targetLanguage = getAiLanguageLabel(profile);
  const format = AI_MEDIA_FORMAT_SPECS[request.format];
  const palette = (args.brandColors || []).filter(Boolean).slice(0, 4);
  const preferenceLine = [
    `ton ${preferences.tone}`,
    `style éditorial ${preferences.communicationStyle}`,
    `créativité ${preferences.creativity}`,
    `objectif ${preferences.mainGoal}`,
    `angle ${preferences.preferredAngle}`,
  ].join(", ");
  const hasStrictIdentityReferences =
    request.inspirationImages.length > 0 &&
    (request.identityMode === "professional" ||
      request.identityMode === "brand_avatar" ||
      request.identityMode === "reference_team");
  const referenceInputLabel = hasStrictIdentityReferences
    ? `${request.inspirationImages.length} référence${request.inspirationImages.length > 1 ? "s" : ""} d’identité autorisée${request.inspirationImages.length > 1 ? "s" : ""}`
    : `${request.inspirationImages.length} inspiration${request.inspirationImages.length > 1 ? "s" : ""} visuelle${request.inspirationImages.length > 1 ? "s" : ""} autorisée${request.inspirationImages.length > 1 ? "s" : ""}`;

  const imageReferenceRules = request.kind === "image"
    ? [
        `ENTRÉES AUTORISÉES : le sujet ci-dessous, l’ADN professionnel structuré${request.inspirationImages.length ? ` et ${referenceInputLabel} avec accord ponctuel` : ""}${args.hasLogo ? ", puis le logo officiel" : ""}.`,
        request.inspirationImages.length
          ? hasStrictIdentityReferences
            ? request.identityMode === "reference_team"
              ? `Les ${request.inspirationImages.length} références représentent autant de personnes distinctes : image 1 = personne 1, image 2 = personne 2${request.inspirationImages.length === 3 ? ", image 3 = personne 3" : ""}. Les réunir toutes, exactement une fois chacune, sans fusion, permutation, duplication ni substitution générique. Ne jamais recopier leur arrière-plan par défaut.`
              : "Les références d’identité servent uniquement à guider l’apparence du professionnel ou à créer son avatar selon le mode choisi. Ne jamais recopier leur arrière-plan par défaut."
            : "Les médias fournis sont uniquement des inspirations visuelles générales pour le sujet, l’ambiance ou la scène. Ils n’imposent aucune identité réelle à reproduire et ne doivent pas être recopiés comme anciens visuels."
          : "Aucune photo de Médiathèque, d’identité, d’ancien média ou de publication n’est fournie : imaginer une scène originale strictement adaptée au sujet actuel.",
        args.hasLogo
          ? `${request.inspirationImages.length ? "La dernière image de référence" : "Le seul fichier image de référence"} est le logo officiel. Respecter fidèlement sa forme, ses proportions, ses couleurs et son orthographe. L’intégrer une seule fois, ${request.logoMode === "visible" ? "de façon clairement visible mais élégante" : "discrètement"}, dans une zone sûre ; il ne doit jamais devenir le sujet principal ni occuper plus de ${request.logoMode === "visible" ? "22" : "12"} % du visuel.`
          : "Aucun logo n’est fourni : ne créer aucun logo, monogramme, emblème ou pseudo-logo.",
        request.withText
          ? [
              "Créer un visuel social finalisé avec une hiérarchie typographique professionnelle et des marges généreuses.",
              `Accroche originale sélectionnée par iNrCy, distincte du brief, à afficher exactement : « ${clean(args.copy?.headline, 110)} ».`,
              request.textKeywords.length
                ? `Les mots-clés facultatifs demandés dans le bloc Texte ont guidé cette accroche : ${request.textKeywords.map((value) => clean(value, 48)).join(", ")}.`
                : "Aucun mot-clé de texte n’a été imposé : l’accroche provient de l’ADN et du type de contenu.",
              "Ne jamais ajouter de sous-titre, de paragraphe, de CTA ni d’autre texte. Chaque lettre doit être parfaitement lisible, sans coupure et éloignée des bords.",
            ].join("\n")
          : "Ne placer aucun texte hors celui qui appartient déjà au logo officiel.",
      ].join("\n")
    : [
        "Ce brief pilote des plans vidéo originaux. Aucun fichier de Médiathèque n’est fourni au moteur vidéo.",
        "Ne produire aucun logo ni pseudo-logo : l’habillage vidéo exact sera appliqué ensuite par iNrCy.",
      ].join("\n");

  const compiledPrompt = [
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
    request.withText
      ? `LANGUE DU TEXTE VISIBLE — RÈGLE ABSOLUE : l'accroche et tout caractère destiné au lecteur doivent être exclusivement en ${targetLanguage}. Le brief, l’ADN et les consignes techniques peuvent être rédigés dans une autre langue : ne jamais reprendre leur langue par défaut. Les noms propres, marques et le logo officiel restent inchangés.`
      : `LANGUE DE GÉNÉRATION CONFIGURÉE : ${targetLanguage}. Aucun texte visible ne doit être créé dans le média, quelle que soit la langue du brief, hors texte déjà présent dans le logo officiel.`,
    request.useBrandColors && palette.length
      ? `Palette réelle extraite du logo à harmoniser subtilement : ${palette.join(", ")}.`
      : args.hasLogo
        ? "Palette créative libre et cohérente avec le secteur. Ne pas étendre les couleurs du logo à toute l’image : elles doivent rester limitées au logo lui-même."
        : "Palette créative libre, harmonieuse, professionnelle et cohérente avec le secteur.",
    imageReferenceRules,
    getAiMediaIdentityDirection(request),
    "BRIEF :",
    buildCreativeBrief(request),
    buildAiInstruction(request),
    "ADN PROFESSIONNEL AUTORISÉ — utiliser uniquement les éléments pertinents pour le sujet, sans afficher ni recopier ce bloc :",
    buildBusinessDna(profile),
    "HISTORIQUE RÉCENT À NE PAS COPIER (éviter les répétitions visuelles) :",
    buildHistory(args.recentPublications || []),
    "RÈGLES IMPÉRATIVES :",
    sharedSafetyRules(),
  ].join("\n\n");
  return fitCompiledMediaPrompt(compiledPrompt);
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
    videoEngine: value.kind === "video" ? value.videoEngine : null,
    identityMode: value.identityMode,
    videoCharacterMode:
      value.kind === "video" ? value.videoCharacterMode : null,
  };
}
