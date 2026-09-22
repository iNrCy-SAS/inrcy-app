import type { NormalizedAiGenerationProfile } from "@/lib/aiGenerationProfile";
import { buildAiMediaBusinessDnaPayload } from "./aiMediaBusinessDna.ts";
import type { AiMediaGenerationRequest } from "@/lib/aiMediaGenerationContracts";

export const AI_MEDIA_PROMPT_VERSION =
  "inrcy-media-v24-structured-studio-contracts";
export const AI_MEDIA_COMPILED_PROMPT_MAX_CHARS = 11_800;

export type AiMediaPromptRecentPublication = {
  title?: string | null;
  content?: string | null;
  cta?: string | null;
  idea?: string | null;
};

export type AiMediaPromptBuilderArgs = {
  request: AiMediaGenerationRequest;
  profile: NormalizedAiGenerationProfile;
  recentPublications?: readonly AiMediaPromptRecentPublication[];
  brandColors?: readonly string[];
  hasLogo?: boolean;
  /** Le texte, le téléphone et le logo exacts seront posés localement. */
  deferVisibleElementsToComposer?: boolean;
  copy?: {
    headline?: string;
  };
};

export function cleanAiMediaPromptText(value: unknown, max = 600) {
  return String(value ?? "")
    .replace(/\u0000/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max);
}

export function cleanAiMediaPromptStructuredText(value: unknown, max = 600) {
  return String(value ?? "")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, max);
}

const VISUAL_DIRECTIONS: Record<
  AiMediaGenerationRequest["visualStyle"],
  string
> = {
  brand:
    "identité de marque cohérente, composition éditoriale nette, détails graphiques maîtrisés",
  clean:
    "minimalisme lumineux, beaucoup d’espace négatif, palette réduite, lignes simples et aérées",
  premium:
    "direction haut de gamme, contraste élégant, matières raffinées, lumière sculptée et retenue",
  warm: "ambiance chaleureuse et humaine, lumière dorée, textures naturelles, proximité et douceur",
  dynamic:
    "composition énergique, diagonales, mouvement perceptible, contraste franc et rythme visuel",
  expert:
    "univers précis et crédible, structure rigoureuse, sobriété professionnelle et détails techniques",
  local:
    "scène authentique et ancrée dans le réel, lumière naturelle, proximité et détails locaux crédibles",
  colorful:
    "palette vive et joyeuse, contrastes chromatiques assumés, formes expressives sans surcharge",
};

const IMAGE_DIRECTIONS: Record<
  AiMediaGenerationRequest["imageStyle"],
  string
> = {
  photo:
    "photographie réaliste haut de gamme, optique et lumière naturelles, aucun rendu artificiel",
  illustration:
    "illustration éditoriale originale, formes maîtrisées, textures soignées et finition contemporaine",
  three_d:
    "composition 3D premium, volumes crédibles, matériaux détaillés et éclairage de studio",
  graphic:
    "affiche graphique moderne, mise en page forte, formes géométriques et hiérarchie éditoriale",
};

const VIDEO_DIRECTIONS: Record<
  AiMediaGenerationRequest["imageStyle"],
  string
> = {
  photo:
    "vidéo réaliste haut de gamme, personnes, objets, matières, lumière et mouvements naturels, sans aspect artificiel",
  illustration:
    "véritable dessin animé 2D, personnages et décors illustrés cohérents d’un plan à l’autre, animation fluide et aucun photoréalisme",
  three_d:
    "film d’animation 3D premium, personnages et volumes cohérents, matériaux détaillés et mouvements cinématographiques fluides",
  graphic:
    "motion design graphique moderne, formes animées lisibles, transitions maîtrisées et composition éditoriale dynamique",
};

const SHOT_DIRECTIONS: Record<AiMediaGenerationRequest["shotType"], string> = {
  auto: "choisir le cadrage le plus pertinent pour raconter le sujet",
  close:
    "cadrage rapproché, détail ou geste au premier plan, profondeur de champ maîtrisée",
  medium:
    "plan moyen équilibré montrant clairement le sujet et son contexte immédiat",
  wide: "vue large structurée, environnement lisible et profondeur de scène",
};

const PEOPLE_DIRECTIONS: Record<
  AiMediaGenerationRequest["peopleMode"],
  string
> = {
  auto: "présence humaine uniquement si elle renforce naturellement le message",
  none: "aucune personne, aucun visage, aucune silhouette ni membre humain visible",
  solo: "une seule personne crédible au maximum, posture naturelle et anatomie réaliste",
  team: "petite équipe crédible en interaction naturelle, sans foule ni poses artificielles",
};

const CREATIVE_DIRECTIONS: Record<
  AiMediaGenerationRequest["creativity"],
  string
> = {
  faithful: "interprétation fidèle, rassurante et directement compréhensible",
  bold:
    "interprétation audacieuse et mémorable, avec un angle créatif inattendu mais toujours professionnel",
};

const CREATIVE_VARIATIONS = [
  "composition asymétrique avec un point focal décentré et une respiration éditoriale nette",
  "composition frontale structurée avec profondeur, premier plan discret et arrière-plan vivant",
  "angle légèrement plongeant avec une scène organisée en couches et un parcours visuel clair",
  "point de vue immersif à hauteur du sujet, lumière latérale et détails narratifs subtils",
  "composition diagonale maîtrisée avec contraste entre espace calme et zone d’action",
  "mise en scène éditoriale en trois zones, sujet fort, contexte lisible et espace réservé au message",
];

const IMAGE_ORIGINALITY_AXES = [
  "partir d’un détail métier rarement montré et en faire le point d’entrée narratif",
  "montrer un avant/après implicite dans une seule composition, sans split-screen ni comparaison littérale",
  "faire du geste professionnel, de la matière ou de l’outil réel la preuve centrale du message",
  "construire une scène documentaire prise sur le vif, avec un détail inattendu mais crédible",
  "mettre en scène le résultat concret pour le client plutôt qu’une pose publicitaire générique",
  "utiliser un angle éditorial symbolique sobre, directement relié au sujet et jamais décoratif",
];

const VIDEO_ORIGINALITY_AXES = [
  "ouvrir sur un geste ou un détail en mouvement, puis révéler progressivement le contexte",
  "faire évoluer la scène par une transformation concrète liée au métier plutôt que par une transition décorative",
  "raconter une micro-histoire cause-action-résultat avec des actions observables",
  "adopter un point de vue immersif au cœur de l’action, avec un déplacement de caméra motivé",
  "construire le rythme autour d’un objet, d’un produit ou d’une matière qui change réellement d’état",
  "commencer par le bénéfice visible puis remonter naturellement vers le geste professionnel qui l’a rendu possible",
];

function stableIndex(value: string, length: number) {
  let hash = 2_166_136_261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16_777_619);
  }
  return (hash >>> 0) % length;
}

export function getAiMediaImageRenderDirection(
  request: AiMediaGenerationRequest
) {
  return IMAGE_DIRECTIONS[request.imageStyle];
}

export function getAiMediaVideoRenderDirection(
  request: AiMediaGenerationRequest
) {
  return VIDEO_DIRECTIONS[request.imageStyle];
}

/** Compatibilité publique ; les builders dédiés appellent leur variante typée. */
export function getAiMediaRenderDirection(request: AiMediaGenerationRequest) {
  return request.kind === "video"
    ? getAiMediaVideoRenderDirection(request)
    : getAiMediaImageRenderDirection(request);
}

function composeAiMediaVisualDirection(
  request: AiMediaGenerationRequest,
  renderDirection: string
) {
  return [
    VISUAL_DIRECTIONS[request.visualStyle],
    renderDirection,
    SHOT_DIRECTIONS[request.shotType],
    PEOPLE_DIRECTIONS[request.peopleMode],
    CREATIVE_DIRECTIONS[request.creativity],
    `Piste facultative, uniquement si compatible avec le brief et le cadrage choisi : ${CREATIVE_VARIATIONS[
      stableIndex(request.requestId, CREATIVE_VARIATIONS.length)
    ]}`,
  ].join(" ; ");
}

export function getAiMediaImageVisualDirection(
  request: AiMediaGenerationRequest
) {
  return composeAiMediaVisualDirection(
    request,
    getAiMediaImageRenderDirection(request)
  );
}

export function getAiMediaVideoVisualDirection(
  request: AiMediaGenerationRequest
) {
  return composeAiMediaVisualDirection(
    request,
    getAiMediaVideoRenderDirection(request)
  );
}

/** Compatibilité publique ; les builders dédiés appellent leur variante typée. */
export function getAiMediaVisualDirection(request: AiMediaGenerationRequest) {
  return request.kind === "video"
    ? getAiMediaVideoVisualDirection(request)
    : getAiMediaImageVisualDirection(request);
}

export function getAiMediaImageOriginalityDirection(
  request: AiMediaGenerationRequest
) {
  return `Piste facultative à réinventer selon le sujet, sans modifier les critères explicites : ${IMAGE_ORIGINALITY_AXES[
    stableIndex(`${request.requestId}:image`, IMAGE_ORIGINALITY_AXES.length)
  ]}`;
}

export function getAiMediaVideoOriginalityDirection(
  request: AiMediaGenerationRequest
) {
  return `Piste facultative à réinventer selon le sujet, sans modifier le scénario demandé : ${VIDEO_ORIGINALITY_AXES[
    stableIndex(`${request.requestId}:video`, VIDEO_ORIGINALITY_AXES.length)
  ]}`;
}

/** Short enough to remain mandatory at every visual provider boundary. */
export function buildAiMediaOriginalityContract(request: AiMediaGenerationRequest) {
  return [
    "ORIGINALITY: invent a distinctive concept grounded in THIS brief, not stock advertising.",
    request.kind === "video"
      ? "Vary opening, action and camera only where unspecified."
      : "Vary composition, viewpoint and lighting only where unspecified.",
    "No default tablet, laptop, phone or office; include one only when justified by the requested scene.",
    "Keep all explicit criteria, facts and required reference identities/objects/places intact.",
  ].join(" ");
}

export function getAiMediaImageQualityBar(request: AiMediaGenerationRequest) {
  if (request.kind !== "image") return "";
  const ambition =
    request.creativity === "bold"
      ? "Créer un parti pris visuel audacieux, immédiatement mémorable, mais lisible et crédible pour cette activité."
      : "Créer un parti pris visuel distinctif, élégant et immédiatement compréhensible, fidèle au réel de cette activité.";
  return [
    "EXIGENCE DE QUALITÉ DIFFÉRENCIANTE : produire une image digne d’une campagne de marque, et non une image de banque générique.",
    ambition,
    "Faire raconter le sujet par une preuve visuelle concrète : geste, objet, lieu, transformation ou résultat directement lié au brief.",
    "Construire un point focal fort, une profondeur en plusieurs plans, une lumière intentionnelle, des matières détaillées et des marges propres.",
    "Chaque élément doit servir le sujet. Écarter les accessoires aléatoires, les poses publicitaires figées, les clichés corporate, la surcharge et les détails incohérents.",
  ].join("\n");
}

export function isRequiredAiMediaReference(
  image: AiMediaGenerationRequest["inspirationImages"][number]
) {
  return image.usage === "required";
}

function isRequiredCharacterReference(
  request: AiMediaGenerationRequest,
  image: AiMediaGenerationRequest["inspirationImages"][number]
) {
  return (
    image.role === "character" &&
    (isRequiredAiMediaReference(image) ||
      (!image.usage && request.identityMode !== "auto"))
  );
}

export function getAiMediaReferenceGroups(request: AiMediaGenerationRequest) {
  const characterReferences = request.inspirationImages.filter((image) =>
    isRequiredCharacterReference(request, image)
  );
  const environmentReferences = request.inspirationImages.filter(
    (image) =>
      image.role === "environment" && isRequiredAiMediaReference(image)
  );
  const productReferences = request.inspirationImages.filter(
    (image) => image.role === "product" && isRequiredAiMediaReference(image)
  );
  const requiredReferences = request.inspirationImages.filter(
    isRequiredAiMediaReference
  );
  const inspirationReferences = request.inspirationImages.filter(
    (image) => !isRequiredAiMediaReference(image)
  );
  const hasStrictIdentityReferences =
    characterReferences.length > 0 &&
    (request.identityMode === "professional" ||
      request.identityMode === "brand_avatar" ||
      request.identityMode === "reference_team");
  return {
    characterReferences,
    environmentReferences,
    productReferences,
    requiredReferences,
    inspirationReferences,
    hasStrictIdentityReferences,
  };
}

function getRequiredCharacterCastRule(request: AiMediaGenerationRequest) {
  const { characterReferences } = getAiMediaReferenceGroups(request);
  if (!characterReferences.length) {
    return request.peopleMode === "team"
      ? "Composer une petite équipe crédible sans foule anonyme."
      : request.peopleMode === "solo"
      ? "Composer une personne unique crédible."
      : "Choisir librement la présence humaine uniquement si elle sert le brief.";
  }
  return [
    `Analyser les ${characterReferences.length} fichier${
      characterReferences.length > 1 ? "s" : ""
    } de personnage obligatoire${
      characterReferences.length > 1 ? "s" : ""
    } : une photo peut contenir UNE OU PLUSIEURS personnes distinctes. Le nombre de fichiers ne fixe jamais le nombre de personnes.`,
    "Détecter toutes les personnes distinctes dans l’ensemble des photos, reconnaître une même personne éventuellement présente sur plusieurs photos, puis préserver séparément le visage, les traits, la coiffure, la silhouette, les proportions et les signes distinctifs de chacune.",
    "Toutes les personnes distinctes détectées sont obligatoires et doivent apparaître reconnaissables, engagées dans une action crédible liée au brief. N’en omettre, fusionner, permuter, dupliquer ni substituer aucune ; aucun personnage générique de fallback.",
  ].join("\n");
}

export function getAiMediaImageIdentityDirection(
  request: AiMediaGenerationRequest
) {
  const { characterReferences } = getAiMediaReferenceGroups(request);
  if (request.peopleMode === "none" && !characterReferences.length) return "";
  const referenceCount = characterReferences.length;
  const castRule = getRequiredCharacterCastRule(request);
  if (request.identityMode === "reference_team") {
    return [
      "RÉFÉRENCE OBLIGATOIRE — FIDÉLITÉ D’IDENTITÉ : contrainte stricte, jamais une simple inspiration.",
      "ÉQUIPE DE RÉFÉRENCE : les fichiers source sont autoritaires, mais un fichier n’équivaut pas à une personne.",
      castRule,
      `Composer une scène de groupe naturelle dans le rendu choisi (${getAiMediaImageRenderDirection(
        request
      )}), puis faire contrôler les ressemblances avant validation. Si la fidélité ne peut pas être respectée, échouer explicitement plutôt que substituer une personne générique.`,
    ].join("\n");
  }
  if (request.identityMode === "professional") {
    return [
      "RÉFÉRENCE OBLIGATOIRE — FIDÉLITÉ D’IDENTITÉ : contrainte stricte, jamais une simple inspiration.",
      "IDENTITÉS VISUELLES GUIDÉES : la photo autorisée impose de préserver chaque personne distincte qu’elle contient, même si plusieurs personnes figurent dans un seul fichier.",
      castRule,
      `Inscrire toutes ces personnes dans le rendu choisi (${getAiMediaImageRenderDirection(
        request
      )}) avec une posture, une action et un décor adaptés au brief. Si une fidélité ne peut pas être respectée, échouer explicitement plutôt que produire un remplacement silencieux. Le professionnel doit contrôler chaque ressemblance avant validation du média.`,
    ].join("\n");
  }
  if (request.identityMode === "brand_avatar") {
    return [
      "AVATAR DE MARQUE GUIDÉ : créer ou reprendre l’avatar illustré autorisé comme personnage de l’image.",
      `Le décliner dans le rendu choisi (${getAiMediaImageRenderDirection(
        request
      )}) en visant une apparence, une palette et des signes distinctifs cohérents. Faire contrôler le résultat avant validation.`,
      castRule,
      referenceCount
        ? `Les ${referenceCount} référence${
            referenceCount > 1 ? "s" : ""
          } autorisée${
            referenceCount > 1 ? "s" : ""
          } guident le rendu : viser le même avatar, qu’elles montrent un dessin existant ou une personne adulte autorisée à styliser.`
        : "Créer un avatar professionnel original et cohérent avec l’ADN.",
    ].join("\n");
  }
  return referenceCount
    ? "IDENTITÉ LIBRE : les médias fournis inspirent le sujet ou la scène, sans imposer une identité réelle particulière."
    : "IDENTITÉ LIBRE : choisir des personnes génériques crédibles uniquement si elles servent le message.";
}

export function getAiMediaVideoIdentityDirection(
  request: AiMediaGenerationRequest
) {
  const { characterReferences } = getAiMediaReferenceGroups(request);
  if (request.peopleMode === "none" && !characterReferences.length) return "";
  const referenceCount = characterReferences.length;
  const castRule = getRequiredCharacterCastRule(request);
  if (request.identityMode === "reference_team") {
    return [
      "RÉFÉRENCE OBLIGATOIRE — FIDÉLITÉ D’IDENTITÉ : contrainte stricte, jamais une simple inspiration.",
      "ÉQUIPE DE RÉFÉRENCE : les fichiers source sont autoritaires, mais un fichier n’équivaut pas à une personne.",
      castRule,
      "COHÉRENCE INTER-SCÈNES : conserver exactement toutes les personnes détectées, leurs visages, traits, silhouettes, vêtements distinctifs et proportions pendant tous les plans. Lorsque l’animation reçoit une image de groupe précomposée, garder tous les membres visibles, actifs et reconnaissables, sans transformation du visage.",
    ].join("\n");
  }
  if (request.identityMode === "professional") {
    return [
      "RÉFÉRENCE OBLIGATOIRE — FIDÉLITÉ D’IDENTITÉ : contrainte stricte, jamais une simple inspiration.",
      "IDENTITÉS VISUELLES GUIDÉES : la photo autorisée impose de préserver chaque personne distincte qu’elle contient, même si plusieurs personnes figurent dans un seul fichier.",
      castRule,
      `COHÉRENCE INTER-SCÈNES : inscrire toutes ces personnes dans le rendu choisi (${getAiMediaVideoRenderDirection(
        request
      )}) et conserver chacune, ses traits, sa silhouette et ses éléments distinctifs pendant toute la vidéo. Toutes doivent participer à une action observable liée au brief, sans relégation hors champ durable.`,
    ].join("\n");
  }
  if (request.identityMode === "brand_avatar") {
    return [
      "AVATAR DE MARQUE GUIDÉ : créer ou reprendre l’avatar illustré autorisé comme personnage de la vidéo.",
      `Le décliner dans le rendu choisi (${getAiMediaVideoRenderDirection(
        request
      )}) en gardant une apparence, une palette et des signes distinctifs cohérents entre tous les plans.`,
      castRule,
      referenceCount
        ? `Les ${referenceCount} référence${
            referenceCount > 1 ? "s" : ""
          } autorisée${
            referenceCount > 1 ? "s" : ""
          } guident chaque plan : viser le même avatar.`
        : "Créer un avatar professionnel original et assurer sa continuité visuelle pendant toute la vidéo.",
    ].join("\n");
  }
  return referenceCount
    ? "IDENTITÉ LIBRE : les références inspirent la scène sans imposer l’identité biométrique d’une personne réelle."
    : "IDENTITÉ LIBRE : choisir des personnes génériques crédibles uniquement si elles servent l’action.";
}

/** Compatibilité publique ; les contrats dédiés ne passent pas par ce routeur. */
export function getAiMediaIdentityDirection(request: AiMediaGenerationRequest) {
  return request.kind === "video"
    ? getAiMediaVideoIdentityDirection(request)
    : getAiMediaImageIdentityDirection(request);
}

export function getAiMediaImageSafeCompositionGuide(
  request: AiMediaGenerationRequest
) {
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

export function buildAiMediaPromptBusinessDna(
  profile: NormalizedAiGenerationProfile,
  request?: AiMediaGenerationRequest
) {
  if (request?.subjectSource === "custom") {
    return "Sujet personnalisé : ne pas importer le métier, les prestations ou les décors de l’ADN. Seuls le logo et la palette explicitement sélectionnés s’appliquent via leurs contrats dédiés.";
  }
  const dna = buildAiMediaBusinessDnaPayload(profile);
  return Object.keys(dna).length
    ? JSON.stringify(dna, null, 2)
    : "ADN encore peu renseigné : créer un rendu professionnel générique sans inventer de faits.";
}

export function buildAiMediaPromptCreativeBrief(
  request: AiMediaGenerationRequest
) {
  if (request.idea) {
    const sourceLabel =
      request.subjectSource === "publication"
        ? "Publication en cours"
        : request.subjectSource === "profile"
        ? "Brief du professionnel enrichi par son ADN"
        : "Sujet choisi par le professionnel";
    return [
      `SUJET CENTRAL OBLIGATOIRE — ${sourceLabel} : ${cleanAiMediaPromptText(
        request.idea,
        2_000
      )}`,
      "Le résultat doit représenter ce sujet sans ambiguïté. Conserver ses personnes, objets, lieux, actions et relations importantes ; ne jamais le remplacer par une scène générique issue de l’ADN.",
      "L’ADN peut seulement préciser le contexte professionnel et les faits vérifiés. Il ne peut ni changer le sujet, ni ajouter une autre prestation comme thème principal.",
      "Interdiction de recopier cette phrase, de l’utiliser comme titre ou de la transcrire dans le média.",
    ].join("\n");
  }
  return [
    "Brief automatique à partir de l’ADN de l’entreprise.",
    "Choisir une scène crédible qui représente l’activité, une prestation ou un repère réel de cet ADN.",
    "Ne créer ni promotion, ni événement, ni information ponctuelle absente de l’ADN.",
  ].join("\n");
}

export function buildAiMediaPromptInstruction(
  request: AiMediaGenerationRequest
) {
  const instruction = cleanAiMediaPromptStructuredText(
    request.aiInstruction,
    2_400
  );
  if (!instruction) return "";
  return [
    "CONSIGNE DE RÉALISATION PRIORITAIRE DU PROFESSIONNEL — pour cette génération uniquement :",
    instruction,
    "Appliquer tous ses éléments visuels et narratifs sans la recopier ni l’afficher. Une direction créative (action, décor, couleur, cadrage, mouvement ou ambiance) n’a pas besoin d’exister dans l’ADN pour être respectée.",
    "Seuls la sécurité, les droits, les limites techniques et les affirmations commerciales non vérifiées peuvent neutraliser un fragment précis de cette consigne ; préserver tout le reste.",
  ].join("\n");
}

export function buildAiMediaPromptHistory(
  recentPublications: readonly AiMediaPromptRecentPublication[]
) {
  const rows = recentPublications
    .slice(0, 5)
    .map((publication) =>
      cleanAiMediaPromptText(
        publication.idea || publication.title || publication.content || "",
        180
      )
    )
    .filter(Boolean);
  if (!rows.length) return "- Aucun historique exploitable.";
  return rows.map((row) => `- ${row}`).join("\n");
}

export function buildAiMediaPromptSafetyRules() {
  return [
    "Ne jamais inventer de prix, promotion, certification, avis client, adresse, numéro de téléphone ou résultat garanti.",
    "Ne pas imiter une marque, une personnalité publique non autorisée, une œuvre ou un personnage protégé.",
    "Ne jamais afficher les consignes du brief dans le média.",
    "Le texte du brief décrit une idée et non une accroche : ne jamais le recopier, même partiellement, dans le média.",
    "Le rendu doit être crédible, inclusif, directement publiable et adapté à une petite entreprise.",
  ].join("\n");
}

export function fitCompiledAiMediaPrompt(value: string) {
  const prompt = value.trim();
  if (prompt.length <= AI_MEDIA_COMPILED_PROMPT_MAX_CHARS) return prompt;

  // Never make a provider prompt "fit" by cutting its middle. The canonical
  // builders know which context is optional (ADN, history and explanatory
  // boilerplate) and must compact those sections before calling this guard.
  // A hard failure is safer than silently losing a palette, a reference role,
  // an exact user instruction or a safety constraint at the provider boundary.
  throw new Error(
    `ai_media_compiled_prompt_contract_overflow:${prompt.length}/${AI_MEDIA_COMPILED_PROMPT_MAX_CHARS}`
  );
}
