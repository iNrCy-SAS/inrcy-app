import { AI_MEDIA_FORMAT_SPECS } from "@/lib/aiMediaGenerationContracts";
import {
  AI_MEDIA_PROMPT_VERSION,
  buildAiMediaPromptBusinessDna,
  buildAiMediaPromptCreativeBrief,
  buildAiMediaPromptHistory,
  buildAiMediaPromptInstruction,
  buildAiMediaPromptSafetyRules,
  fitCompiledAiMediaPrompt,
  getAiMediaVideoIdentityDirection,
  getAiMediaVideoOriginalityDirection,
  type AiMediaPromptBuilderArgs,
} from "@/lib/aiMediaPromptShared";
import {
  buildAiMediaVideoAudioContract,
  buildAiMediaVideoModeContract,
  buildAiMediaVideoPaletteContract,
  buildAiMediaVideoStyleContract,
  buildAiMediaVideoTextContract,
  buildAiMediaVideoTimelineContract,
} from "@/lib/aiMediaVideoPromptModules";

/** Contrat propriétaire de Générer · Vidéo. */
export function buildAiMediaVideoGenerationPrompt(
  args: AiMediaPromptBuilderArgs
) {
  const { request, profile } = args;
  const format = AI_MEDIA_FORMAT_SPECS[request.format];
  const preferences = profile.preferences;
  const preferenceLine = [
    `ton ${preferences.tone}`,
    `style éditorial ${preferences.communicationStyle}`,
    `créativité ${preferences.creativity}`,
    `objectif ${preferences.mainGoal}`,
    `angle ${preferences.preferredAngle}`,
  ].join(", ");

  const compiledPrompt = [
    `Version : ${AI_MEDIA_PROMPT_VERSION}.`,
    "CONTRAT GÉNÉRER VIDÉO — mission exclusive : produire des plans vidéo originaux formant une nouvelle séquence animée cohérente dans le temps, jamais une simple affiche fixe ni une modification d’un média existant.",
    "ORDRE DE PRIORITÉ VIDÉO — sécurité et droits ; sujet explicite ; consigne explicite ; mode de composition ; références obligatoires ; identité et continuité ; durée et structure des scènes ; format ; texte et audio ; ADN pertinent ; préférences esthétiques.",
    "BRIEF UTILISATEUR PRIORITAIRE :",
    buildAiMediaPromptCreativeBrief(request),
    buildAiMediaPromptInstruction(request),
    "CONTRAT DU MODE DE COMPOSITION VIDÉO :",
    buildAiMediaVideoModeContract(args),
    `OBJECTIF DE SORTIE : vidéo professionnelle plein cadre au ratio ${format.aspectRatio} (${format.label}), mouvement naturel, sans bordure, sans planche comparative et sans explication.`,
    "MODULE DURÉE ET SCÈNES :",
    buildAiMediaVideoTimelineContract(args),
    request.inputMode !== "essential"
      ? `Typologie : ${request.typology}. Direction visuelle : ${request.visualStyle}.`
      : `MODE STUDIO GUIDÉ VIDÉO : typologie ${request.typology}, style ${request.visualStyle}, rendu ${request.imageStyle}, cadrage ${request.shotType}, créativité ${request.creativity}. Le brief et le contrat de mode restent prioritaires ; l’ADN sert uniquement de contexte.`,
    "MODULE STYLE ET RÉALISATION :",
    buildAiMediaVideoStyleContract(args),
    `SIGNATURE NARRATIVE PROPRE À CETTE REQUÊTE : ${getAiMediaVideoOriginalityDirection(
      request
    )}. Cette variation ne peut jamais altérer les faits, identités, références obligatoires ni la consigne du professionnel.`,
    "MISE EN SCÈNE : privilégier une action crédible, des gestes complets, une caméra intentionnelle et une évolution visible. Éviter l’immobilité, les micro-mouvements artificiels, les morphings, les membres incohérents, les objets qui changent de forme et les transitions gratuites.",
    `FORMAT VIDÉO : respecter le ratio ${format.aspectRatio} dans tous les plans. Garder visages, produit, action principale et future zone d’habillage éloignés des bords et des interfaces.`,
    request.inputMode !== "essential"
      ? `Direction de communication : ${preferenceLine}.`
      : "",
    "MODULE TEXTE VISIBLE :",
    buildAiMediaVideoTextContract(args),
    "Ne produire aucun logo ni pseudo-logo : l’habillage vidéo exact sera appliqué ensuite par iNrCy selon le choix du professionnel.",
    buildAiMediaVideoPaletteContract(args),
    request.generationMode === "inspiration"
      ? getAiMediaVideoIdentityDirection(request)
      : "IDENTITÉ NON RÉFÉRENCÉE : aucune identité réelle n’est à reproduire ou à inventer à partir d’un fichier absent.",
    "MODULE AUDIO ET PAROLE :",
    buildAiMediaVideoAudioContract(args),
    "ADN PROFESSIONNEL AUTORISÉ — utiliser uniquement les éléments pertinents pour le sujet, sans afficher ni recopier ce bloc :",
    buildAiMediaPromptBusinessDna(profile),
    "HISTORIQUE RÉCENT À NE PAS COPIER (éviter les répétitions visuelles, narratives et lexicales) :",
    buildAiMediaPromptHistory(args.recentPublications || []),
    "ANTI-RÉPÉTITION VIDÉO — comparer le scénario envisagé à cet historique et changer explicitement le sujet traité, l’ouverture, la progression, les personnes, le décor, l’action, les cadrages, les transitions et le vocabulaire narratif. Ne réutiliser aucune accroche, aucun slogan, aucune succession de plans ni structure récente. Interdiction des formules passe-partout ; si aucun texte spécifique n’est validé, ne rien écrire.",
    "RÈGLES IMPÉRATIVES VIDÉO :",
    "Les paramètres techniques, la durée, les rôles des références et les couleurs sont des instructions de réalisation, jamais des éléments à afficher. Aucun nuancier, échantillon de couleur, code hexadécimal, légende technique ou planche de style ajouté au résultat. Ne pas recopier les annotations techniques autour du sujet des références.",
    buildAiMediaPromptSafetyRules(),
    "COMPOSITION EXACTE PRISE EN CHARGE PAR iNrCy APRÈS GÉNÉRATION — RÈGLE FINALE PRIORITAIRE : produire des plans sans texte, chiffre, téléphone, coordonnées ni logo, sans enseigne ni interface lisible ; iNrCy appliquera ensuite uniquement l’habillage validé sans le transmettre au moteur visuel.",
    "CONTRÔLE FINAL VIDÉO — vérifier silencieusement : sujet reconnaissable dès le début ; consigne exécutée ; mode de composition respecté ; chaque critère explicite appliqué sans contrainte inventée ; durée et structure respectées ; identités, produit et décor continus ; références required fidèles sans fallback ; inspirations non copiées ; ouverture, personnes, décor, action, vocabulaire et succession de plans différents des productions récentes ; texte conforme au mode sans slogan générique ; mouvements crédibles ; aucun texte ou logo dessiné par le moteur. Produire uniquement la vidéo finale.",
  ]
    .filter(Boolean)
    .join("\n\n");
  return fitCompiledAiMediaPrompt(compiledPrompt);
}
