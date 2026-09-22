import { describeAiMediaBrandColors } from "@/lib/aiMediaColorDirection";
import { getAiLanguageLabel } from "@/lib/aiWritingProfile";
import {
  cleanAiMediaPromptStructuredText,
  cleanAiMediaPromptText,
  getAiMediaReferenceGroups,
  getAiMediaVideoVisualDirection,
  type AiMediaPromptBuilderArgs,
} from "@/lib/aiMediaPromptShared";

const AI_MEDIA_GENERIC_HEADLINE_BLACKLIST = [
  ["Votre projet", "entre de bonnes mains"].join(" "),
  ["Votre projet", "prend vie"].join(" "),
  ["Une expertise", "à votre service"].join(" "),
  ["Une réponse", "sur mesure"].join(" "),
].join(" ; ");

const PEOPLE_CRITERIA = {
  auto:
    "PERSONNAGES — choix créatif : décider librement si une présence humaine sert réellement le sujet, sans imposer un nombre.",
  none:
    "PERSONNAGES — contrainte absolue : aucune personne, aucun visage, aucune silhouette ni membre humain dans aucun plan.",
  one:
    "PERSONNAGES — contrainte absolue : montrer exactement 1 personne, clairement identifiable et cohérente pendant tous les plans.",
  two:
    "PERSONNAGES — contrainte absolue : montrer exactement 2 personnes distinctes, toutes deux lisibles et cohérentes pendant tous les plans.",
  three:
    "PERSONNAGES — contrainte absolue : montrer exactement 3 personnes distinctes, toutes visibles et cohérentes pendant tous les plans.",
  group:
    "PERSONNAGES — montrer un groupe naturel de plusieurs personnes, avec des rôles, interactions et attitudes crédibles ; éviter la foule anonyme.",
} as const;

const SETTING_CRITERIA = {
  auto:
    "DÉCOR — choix créatif : déduire du sujet un lieu crédible, spécifique au métier et différent des décors récents.",
  interior:
    "DÉCOR — placer toute l’action dans un intérieur crédible, cohérent, lisible et visuellement maîtrisé.",
  exterior:
    "DÉCOR — placer toute l’action en extérieur, avec un environnement crédible, cohérent et lisible.",
  studio:
    "DÉCOR — composer la vidéo comme une production en studio avec lumière contrôlée, fond maîtrisé et continuité d’éclairage.",
  neutral:
    "DÉCOR — utiliser un fond neutre et épuré qui valorise immédiatement le sujet principal sans accessoire parasite.",
} as const;

const FOCUS_CRITERIA = {
  auto:
    "FOCUS — choix créatif : choisir le point focal le plus utile au brief, sans priorité arbitraire.",
  people:
    "FOCUS — priorité visuelle aux personnes, à leurs expressions, leurs gestes et leurs interactions.",
  product:
    "FOCUS — priorité visuelle au produit ou à l’objet principal ; sa forme et son usage doivent rester lisibles pendant l’action.",
  environment:
    "FOCUS — priorité visuelle au lieu, au décor et à son atmosphère ; le sujet humain ou produit reste secondaire.",
} as const;

export function buildAiMediaVideoPeopleCriterion(
  args: AiMediaPromptBuilderArgs
) {
  return PEOPLE_CRITERIA[args.request.peopleCriterion];
}

export function buildAiMediaVideoSettingCriterion(
  args: AiMediaPromptBuilderArgs
) {
  return SETTING_CRITERIA[args.request.settingCriterion];
}

export function buildAiMediaVideoFocusCriterion(
  args: AiMediaPromptBuilderArgs
) {
  return FOCUS_CRITERIA[args.request.focusCriterion];
}

export function buildAiMediaVideoReferenceContract(
  args: AiMediaPromptBuilderArgs
) {
  const { request } = args;
  const {
    characterReferences,
    environmentReferences,
    productReferences,
    requiredReferences,
    inspirationReferences,
    hasStrictIdentityReferences,
  } = getAiMediaReferenceGroups(request);
  if (!request.inspirationImages.length) {
    return "Aucun média de référence : créer des plans originaux strictement guidés par le sujet, la consigne et l’ADN pertinent.";
  }

  const inventory = request.inspirationImages
    .map((reference, index) => {
      const role = reference.role || "inspiration";
      const usage = reference.usage || "inspiration";
      const character = reference.characterIndex
        ? `, personnage ${reference.characterIndex}`
        : "";
      return `Référence ${index + 1} — rôle=${role}, usage=${usage}${character}.`;
    })
    .join("\n");

  return [
    "ENTRÉES DE RÉFÉRENCE VIDÉO : chaque fichier conserve exactement le rôle et l’usage choisis par le professionnel ; ne jamais les permuter ni les déduire à nouveau.",
    inventory,
    characterReferences.length
      ? `RÉFÉRENCE OBLIGATOIRE — PERSONNAGES : analyser toutes les personnes distinctes visibles dans les ${characterReferences.length} fichier${
          characterReferences.length > 1 ? "s" : ""
        } source. Une photo peut contenir UNE OU PLUSIEURS personnes ; le nombre de fichiers ne fixe jamais le casting. Préserver chaque visage, traits, silhouette et signe distinctif, toutes les faire apparaître reconnaissables et en action pendant la vidéo, sans omission, fusion, permutation, duplication, substitution générique ni fallback. Si la fidélité est impossible, échouer plutôt que remplacer.`
      : "",
    environmentReferences.length
      ? "RÉFÉRENCE OBLIGATOIRE — DÉCOR : conserver le lieu reconnaissable dans toutes les séquences concernées ; aucun décor générique de remplacement ni fallback."
      : "",
    productReferences.length
      ? "RÉFÉRENCE OBLIGATOIRE — PRODUIT : conserver forme, proportions, matières, couleurs, marquages et signes distinctifs pendant toutes les séquences ; aucun produit générique de substitution ni fallback."
      : "",
    requiredReferences.length && !hasStrictIdentityReferences
      ? "Toute autre référence marquée required est une contrainte de fidélité de son rôle, pas une suggestion esthétique."
      : "",
    inspirationReferences.length
      ? `INSPIRATION UNIQUEMENT : ${inspirationReferences.length} média${
          inspirationReferences.length > 1 ? "s" : ""
        } guide${
          inspirationReferences.length > 1 ? "nt" : ""
        } librement l’ambiance, la palette, le rythme ou la composition. Ne pas copier leur identité, produit, décor, pose ou cadrage exact ; aucune fidélité n’est imposée.`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

export function buildAiMediaVideoFreeModeContract(
  args: AiMediaPromptBuilderArgs
) {
  const { request } = args;
  return [
    "MODE VIDÉO — 100 % IA SANS CRITÈRES : contrat d’invention libre guidé uniquement par le sujet, la consigne explicite et l’ADN pertinent.",
    "Ne transformer aucun réglage automatique en contrainte : ne pas imposer un nombre de personnes, un type de décor, une priorité visuelle ou une référence absente.",
    "Choisir librement casting, lieu et point focal pour servir le brief, puis les maintenir cohérents pendant la durée.",
    request.inspirationImages.length
      ? "ERREUR DE CONTRAT : ce mode ne doit recevoir aucun fichier de référence."
      : "Aucun fichier de référence n’est fourni ni attendu dans ce mode.",
  ].join("\n");
}

export function buildAiMediaVideoCriteriaModeContract(
  args: AiMediaPromptBuilderArgs
) {
  return [
    "MODE VIDÉO — IA AVEC CRITÈRES : contrat de composition structurée. Chaque choix ci-dessous est une contrainte autonome, testable et prioritaire sur les choix créatifs automatiques.",
    buildAiMediaVideoPeopleCriterion(args),
    buildAiMediaVideoSettingCriterion(args),
    buildAiMediaVideoFocusCriterion(args),
    "Aucun fichier de référence n’est fourni dans ce mode : les critères décrivent la scène sans imposer une identité, un produit ou un lieu réel non transmis.",
  ].join("\n");
}

export function buildAiMediaVideoInspirationModeContract(
  args: AiMediaPromptBuilderArgs
) {
  return [
    "MODE VIDÉO — INSPIRATIONS : contrat piloté par les fichiers transmis. Le couple rôle+usage de chaque référence est autoritaire ; les critères IA de casting, décor et focus sont inactifs.",
    buildAiMediaVideoReferenceContract(args),
  ].join("\n");
}

/** Compositeur de mode propre à Générer · Vidéo, sans branche Image/Modifier. */
export function buildAiMediaVideoModeContract(args: AiMediaPromptBuilderArgs) {
  switch (args.request.generationMode) {
    case "ai_criteria":
      return buildAiMediaVideoCriteriaModeContract(args);
    case "inspiration":
      return buildAiMediaVideoInspirationModeContract(args);
    case "ai_free":
    default:
      return buildAiMediaVideoFreeModeContract(args);
  }
}

export function buildAiMediaVideoTimelineContract(
  args: AiMediaPromptBuilderArgs
) {
  const { request } = args;
  const duration = request.durationSeconds || 16;
  const sceneMode = request.sceneMode || "single";
  if (sceneMode === "single") {
    return [
      `DURÉE EXACTE : ${duration} secondes.`,
      "SCÈNE UNIQUE : une action continue dans un même lieu et un même moment, sans saut de décor ni montage de scènes indépendantes.",
      "Construire un début immédiatement lisible, une évolution naturelle et une fin propre dans ce seul plan narratif.",
    ].join("\n");
  }
  const sequenceCount = duration >= 24 ? 3 : 2;
  return [
    `DURÉE EXACTE : ${duration} secondes.`,
    `MULTISCÈNE : structurer ${sequenceCount} séquences complémentaires avec une progression claire, sans répéter la même action ni le même cadrage.`,
    request.connectScenes
      ? "CONTINUITÉ ACTIVÉE : chaque séquence reprend visuellement la précédente ; conserver sujet, identités, produit, décor, lumière, palette et direction du mouvement."
      : "SÉQUENCES AUTONOMES : varier utilement les plans tout en gardant le même sujet, les mêmes identités, la même palette et une continuité narrative évidente.",
    "Chaque coupe doit apporter une information visuelle nouvelle et servir le brief.",
  ].join("\n");
}

export function buildAiMediaVideoStyleContract(
  args: AiMediaPromptBuilderArgs
) {
  return [
    `STYLE VIDÉO AUTORISÉ : ${getAiMediaVideoVisualDirection(args.request)}.`,
    "Le style règle le rendu, la caméra, la lumière et le rythme ; il ne peut jamais inventer un personnage, un décor, un produit, un texte ou une référence obligatoire.",
  ].join("\n");
}

export function buildAiMediaVideoTextContract(args: AiMediaPromptBuilderArgs) {
  const { request } = args;
  const targetLanguage = getAiLanguageLabel(args.profile);
  const textMode = request.textMode || (request.withText ? "ai" : "none");
  const exactVisibleText =
    textMode === "exact"
      ? cleanAiMediaPromptStructuredText(request.exactText, 600)
      : "";
  const aiVisibleHeadline =
    textMode === "ai" ? cleanAiMediaPromptText(args.copy?.headline, 120) : "";

  if (textMode === "exact" && exactVisibleText) {
    return [
      `TEXTE EXACT — LANGUE ${targetLanguage} : iNrCy superposera localement et exclusivement « ${exactVisibleText} », sans reformulation, traduction, correction, ajout ni omission.`,
      "Aucun autre titre, slogan, sous-titre, enseigne, légende, CTA, interface, lettre ou chiffre ne doit apparaître.",
      "Le moteur visuel ne dessine aucun texte dans aucun plan ; réserver une zone calme et stable pour le seul habillage exact, loin des visages, du produit et de l’action.",
    ].join("\n");
  }
  if (textMode === "ai" && aiVisibleHeadline) {
    return [
      `LANGUE DU TEXTE VISIBLE — RÈGLE ABSOLUE : l’habillage local est exclusivement en ${targetLanguage}. TEXTE IA CONTEXTUALISÉ : iNrCy superposera localement et exclusivement l’accroche validée « ${aiVisibleHeadline} ».`,
      "Cette accroche doit provenir des faits et du sujet actuels, employer un vocabulaire concret, différer de l’historique récent des accroches et ne reprendre aucune structure récente.",
      `Clichés interdits, notamment : ${AI_MEDIA_GENERIC_HEADLINE_BLACKLIST}.`,
      request.textKeywords.length
        ? `Mots-clés ayant guidé cette accroche : ${request.textKeywords
            .map((value) => cleanAiMediaPromptText(value, 48))
            .join(", ")}.`
        : "Aucun mot-clé supplémentaire n’a été imposé.",
      "Le moteur visuel ne dessine aucun texte, enseigne, sous-titre, légende, interface, lettre ni chiffre dans aucun plan ; réserver une zone calme et stable pour l’habillage local.",
    ].join("\n");
  }
  return [
    "AUCUN TEXTE VISIBLE — contrainte absolue pour CHAQUE PLAN : Aucun texte visible ne doit être créé ; ne créer ni recopier aucun mot, lettre, chiffre, slogan, enseigne, sous-titre, légende, CTA, interface, écran lisible, téléphone, coordonnée ou pseudo-logo.",
    `Aucun habillage lisible ne sera ajouté ; la langue de narration configurée est ${targetLanguage}. Toute accroche, même plausible ou générique, est interdite.`,
  ].join("\n");
}

export function buildAiMediaVideoAudioContract(args: AiMediaPromptBuilderArgs) {
  const { request } = args;
  if (request.teamVideoSpeechMode === "characters") {
    return [
      "DIALOGUES PERSONNAGES : garder les locuteurs clairement visibles, mouvements de bouche naturels et cohérents, gestes sobres, aucun changement d’identité pendant la prise de parole.",
      "La bande-son et les paroles sont pilotées séparément ; ne jamais afficher leurs instructions à l’écran.",
    ].join("\n");
  }
  return [
    request.withNarration
      ? "NARRATION : garder les personnages silencieux et construire des plans laissant respirer la voix off préparée séparément par iNrCy."
      : "SANS NARRATION : raconter clairement par l’action et la mise en scène visuelle.",
    request.withMusic
      ? "MUSIQUE : prévoir un rythme de montage compatible avec une bande musicale ajoutée séparément."
      : "AUCUNE MUSIQUE DEMANDÉE : privilégier une temporalité naturelle et une ambiance discrète.",
  ].join("\n");
}

export function buildAiMediaVideoPaletteContract(
  args: AiMediaPromptBuilderArgs
) {
  const palette = describeAiMediaBrandColors(args.brandColors || [], 4);
  if (args.request.useBrandColors && palette.length) {
    return `Couleurs de marque à utiliser uniquement comme accents dans la lumière, les matières et le décor : ${palette.join(
      ", "
    )}. Ne pas en faire un sujet ni une planche de présentation ; maintenir ces accents pendant toute la vidéo.`;
  }
  return args.hasLogo
    ? "Palette créative libre et cohérente avec le secteur. Ne pas étendre les couleurs du logo à toute la vidéo : elles doivent rester limitées au logo lui-même, appliqué localement."
    : "Palette créative libre, harmonieuse, professionnelle et stable pendant toute la vidéo.";
}
