import { AI_MEDIA_FORMAT_SPECS } from "@/lib/aiMediaGenerationContracts";
import { getAiLanguageLabel } from "@/lib/aiWritingProfile";
import {
  AI_MEDIA_COMPILED_PROMPT_MAX_CHARS,
  AI_MEDIA_PROMPT_VERSION,
  buildAiMediaOriginalityContract,
  buildAiMediaPromptBusinessDna,
  buildAiMediaPromptCreativeBrief,
  buildAiMediaPromptHistory,
  buildAiMediaPromptInstruction,
  buildAiMediaPromptSafetyRules,
  cleanAiMediaPromptStructuredText,
  cleanAiMediaPromptText,
  fitCompiledAiMediaPrompt,
  getAiMediaReferenceGroups,
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

function buildCompactVideoModeContract(args: AiMediaPromptBuilderArgs) {
  const { request } = args;
  if (request.generationMode !== "inspiration") {
    return buildAiMediaVideoModeContract(args);
  }
  const {
    characterReferences,
    environmentReferences,
    productReferences,
    requiredReferences,
    inspirationReferences,
  } = getAiMediaReferenceGroups(request);
  const inventory = request.inspirationImages
    .map((reference, index) => {
      const role = reference.role || "inspiration";
      const usage = reference.usage || "inspiration";
      const character = reference.characterIndex
        ? `/personnage-${reference.characterIndex}`
        : "";
      return `#${index + 1}:${role}/${usage}${character}`;
    })
    .join(" ; ");
  const inspirationCount = (role: string) =>
    inspirationReferences.filter((reference) => reference.role === role).length;
  const categorizedRequired =
    characterReferences.length +
    environmentReferences.length +
    productReferences.length;
  return [
    "MODE VIDÉO — INSPIRATIONS : chaque couple rôle/usage transmis est autoritaire ; ne jamais reclasser un fichier et ne pas appliquer les critères IA inactifs.",
    `INVENTAIRE AUTORITAIRE : ${inventory}.`,
    characterReferences.length
      ? "RÉFÉRENCE OBLIGATOIRE — PERSONNAGES : détecter toutes les personnes distinctes des fichiers requis et préserver séparément visage, traits, silhouette, proportions et signes distinctifs ; toutes restent reconnaissables et actives, sans omission, fusion, permutation, duplication, substitution ni fallback."
      : "",
    environmentReferences.length
      ? "RÉFÉRENCE OBLIGATOIRE — DÉCOR : garder le lieu reconnaissable et continu ; aucun décor générique ni fallback."
      : "",
    productReferences.length
      ? "RÉFÉRENCE OBLIGATOIRE — PRODUIT : garder forme, proportions, matières, couleurs, marquages et signes distinctifs ; aucune substitution ni fallback."
      : "",
    requiredReferences.length > categorizedRequired
      ? "AUTRE RÉFÉRENCE REQUIRED : fidélité obligatoire selon son rôle ; jamais une simple suggestion esthétique."
      : "",
    inspirationCount("character")
      ? "INSPIRATION UNIQUEMENT — rôle Personnage : guider présence, attitudes et énergie sans copier identité, visage, silhouette ni tenue."
      : "",
    inspirationCount("product")
      ? "INSPIRATION UNIQUEMENT — rôle Produit : guider catégorie, formes, matières et mise en valeur sans reproduire marque ni apparence exacte."
      : "",
    inspirationCount("environment")
      ? "INSPIRATION UNIQUEMENT — rôle Décor : guider ambiance, architecture, lumière et palette sans reproduire le lieu exact."
      : "",
    inspirationCount("inspiration")
      ? "INSPIRATION UNIQUEMENT — rôle Inspiration libre : guider ambiance, palette, rythme et composition sans imposer identité, produit, décor, pose ni cadrage exact."
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function buildCompactVideoIdentityContract(args: AiMediaPromptBuilderArgs) {
  const { request } = args;
  if (request.generationMode !== "inspiration") {
    return "IDENTITÉ NON RÉFÉRENCÉE : aucune identité, aucun produit et aucun lieu réel absent ne doit être inventé comme s’il provenait d’une référence.";
  }
  const {
    characterReferences,
    environmentReferences,
    productReferences,
    inspirationReferences,
  } = getAiMediaReferenceGroups(request);
  const requiredContinuity = [
    characterReferences.length ? "personnes" : "",
    environmentReferences.length ? "décor" : "",
    productReferences.length ? "produit" : "",
  ].filter(Boolean);
  return `MODE IDENTITÉ — ${request.identityMode} : appliquer l’inventaire rôle/usage sans reclasser ; ${
    requiredContinuity.length
      ? `${requiredContinuity.join(", ")} required continus et reconnaissables dans tous les plans concernés`
      : "aucune fidélité required supplémentaire"
  }${inspirationReferences.length ? "; inspirations sans fidélité exacte" : ""}.`;
}

function buildCompactVideoStyleContract(args: AiMediaPromptBuilderArgs) {
  const { request } = args;
  const direction = request.visualDirection || "auto";
  const directionContract = {
    auto: "déduire une réalisation singulière du brief, sans style passe-partout",
    clean: "caméra stable, lumière nette, plans épurés et respirants",
    premium: "lumière raffinée, mouvements précis et finitions haut de gamme",
    warm: "lumière accueillante, gestes humains et matières naturelles",
    dynamic: "caméra intentionnelle, rythme soutenu et progression lisible",
    bold: "cadrages forts, contrastes francs et signature mémorable",
  }[direction];
  return [
    `DIRECTION VISUELLE STRUCTURÉE — ${direction.toUpperCase()} : ${directionContract}.`,
    `STYLE VIDÉO STRUCTURÉ : style=${request.visualStyle}, rendu=${request.imageStyle}, cadrage=${request.shotType}, présence=${request.peopleMode}, créativité=${request.creativity}. Ces choix règlent caméra, lumière et rythme sans inventer de sujet, texte ni référence.`,
  ].join("\n");
}

function buildCompactVideoTextContract(args: AiMediaPromptBuilderArgs) {
  const { request } = args;
  const language = getAiLanguageLabel(args.profile);
  const textMode = request.textMode || (request.withText ? "ai" : "none");
  if (textMode === "exact") {
    const exactText = cleanAiMediaPromptStructuredText(request.exactText, 600);
    return [
      `TEXTE EXACT VALIDÉ (${language}) pour l’habillage local iNrCy : « ${exactText} ». Conserver chaque caractère ; aucune reformulation, traduction, correction, addition ni omission.`,
      "Moteur visuel : aucun mot, lettre, chiffre, enseigne, CTA, interface ni pseudo-texte ; réserver une zone calme stable loin du sujet.",
    ].join("\n");
  }
  if (textMode === "ai") {
    const headline = cleanAiMediaPromptText(args.copy?.headline, 120);
    const keywords = request.textKeywords
      .map((value) => cleanAiMediaPromptText(value, 48))
      .filter(Boolean)
      .join(", ");
    return [
      `TEXTE IA VALIDÉ (${language}) pour l’habillage local iNrCy : « ${headline} ». Conserver cette accroche sans ajout${
        keywords ? ` ; mots-clés imposés : ${keywords}` : ""
      }.`,
      "Le moteur visuel ne dessine aucun texte, chiffre, enseigne, interface ni pseudo-texte ; réserver une zone calme stable.",
    ].join("\n");
  }
  return `AUCUN TEXTE VISIBLE dans aucun plan : aucun mot, lettre, chiffre, slogan, enseigne, légende, CTA, téléphone, coordonnée, interface, écran lisible ni pseudo-logo. Langue de narration : ${language}.`;
}

function compactVideoOptionalContext(value: string, maxLength: number) {
  if (maxLength <= 0) return "";
  const normalized = value.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxLength) return normalized;
  if (maxLength < 2) return "";
  const slice = normalized.slice(0, maxLength - 1);
  const boundary = slice.lastIndexOf(" ");
  return `${slice.slice(0, boundary > maxLength * 0.6 ? boundary : undefined).trim()}…`;
}

function assembleBudgetedVideoPrompt(args: {
  requiredSections: readonly string[];
  dna: string;
  history: string;
}) {
  const dnaMarker = "[… contexte ADN compacté automatiquement par iNrCy …]";
  const historyMarker = "[… historique compacté automatiquement par iNrCy …]";
  const render = (dna: string, history: string) =>
    [
      ...args.requiredSections,
      `ADN PROFESSIONNEL COMPACT — contexte seulement, jamais sujet de remplacement :${
        dna ? `\n${dna}` : ""
      }\n${dnaMarker}`,
      `HISTORIQUE COMPACT À NE PAS COPIER :${
        history ? `\n${history}` : ""
      }\n${historyMarker}`,
    ]
      .filter(Boolean)
      .join("\n\n");
  const minimum = render("", "");
  const targetLength = AI_MEDIA_COMPILED_PROMPT_MAX_CHARS - 256;
  const available = Math.max(
    0,
    targetLength - minimum.length
  );
  const dnaBudget = Math.min(420, Math.floor(available * 0.72));
  const historyBudget = Math.min(180, Math.max(0, available - dnaBudget));
  return fitCompiledAiMediaPrompt(
    render(
      compactVideoOptionalContext(args.dna, dnaBudget),
      compactVideoOptionalContext(args.history, historyBudget)
    )
  );
}

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
    buildAiMediaOriginalityContract(request),
    "CONTRAT DU MODE DE COMPOSITION VIDÉO :",
    buildAiMediaVideoModeContract(args),
    `OBJECTIF DE SORTIE : vidéo professionnelle plein cadre au ratio ${format.aspectRatio} (${format.label}), mouvement naturel, sans bordure, sans planche comparative et sans explication.`,
    "MODULE DURÉE ET SCÈNES :",
    buildAiMediaVideoTimelineContract(args),
    request.inputMode !== "essential"
      ? `Typologie : ${request.typology}. Direction visuelle : ${request.visualStyle}.`
      : `MODE STUDIO GUIDÉ VIDÉO : typologie ${request.typology}, style ${request.visualStyle}, direction ${request.visualDirection}, rendu ${request.imageStyle}, cadrage ${request.shotType}, créativité ${request.creativity}. Le brief et le contrat de mode restent prioritaires ; l’ADN sert uniquement de contexte.`,
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
    `LOGO STRUCTURÉ — ${request.logoMode} : ne produire aucun logo ni pseudo-logo dans les plans ; iNrCy appliquera ensuite le logo officiel ${
      request.logoMode === "none"
        ? "— aucun logo ne sera ajouté"
        : request.logoMode === "visible"
        ? "de façon visible mais maîtrisée"
        : "de façon discrète"
    }.`,
    buildAiMediaVideoPaletteContract(args),
    request.generationMode === "inspiration"
      ? getAiMediaVideoIdentityDirection(request)
      : "IDENTITÉ NON RÉFÉRENCÉE : aucune identité réelle n’est à reproduire ou à inventer à partir d’un fichier absent.",
    "MODULE AUDIO ET PAROLE :",
    buildAiMediaVideoAudioContract(args),
    "ADN PROFESSIONNEL AUTORISÉ — utiliser uniquement les éléments pertinents pour le sujet, sans afficher ni recopier ce bloc :",
    buildAiMediaPromptBusinessDna(profile, request),
    "HISTORIQUE RÉCENT À NE PAS COPIER (éviter les répétitions visuelles, narratives et lexicales) :",
    buildAiMediaPromptHistory(args.recentPublications || []),
    "ANTI-RÉPÉTITION VIDÉO — comparer les pistes narratives à cet historique et renouveler uniquement les aspects laissés libres : ouverture, rythme, point de vue, lumière et mise en scène. Conserver impérativement le sujet, les personnes, objets, lieux, actions, textes exacts et références demandés. La nouveauté n’autorise jamais à modifier le scénario explicite ni à rompre la continuité entre les plans. Ne réutiliser aucune succession de plans ni structure récente, sauf scénario explicitement imposé ; éviter les formules passe-partout.",
    "RÈGLES IMPÉRATIVES VIDÉO :",
    "Les paramètres techniques, la durée, les rôles des références et les couleurs sont des instructions de réalisation, jamais des éléments à afficher. Aucun nuancier, échantillon de couleur, code hexadécimal, légende technique ou planche de style ajouté au résultat. Ne pas recopier les annotations techniques autour du sujet des références.",
    buildAiMediaPromptSafetyRules(),
    "COMPOSITION EXACTE PRISE EN CHARGE PAR iNrCy APRÈS GÉNÉRATION — RÈGLE FINALE PRIORITAIRE : produire des plans sans texte, chiffre, téléphone, coordonnées ni logo, sans enseigne ni interface lisible ; iNrCy appliquera ensuite uniquement l’habillage validé sans le transmettre au moteur visuel.",
    "CONTRÔLE FINAL VIDÉO — vérifier silencieusement : sujet reconnaissable dès le début ; consigne exécutée ; mode de composition respecté ; chaque critère explicite appliqué sans contrainte inventée ; durée et structure respectées ; identités, produit et décor continus ; références required fidèles sans fallback ; inspirations non copiées ; originalité des aspects laissés libres ; texte conforme au mode sans slogan générique ; mouvements crédibles ; aucun texte ou logo dessiné par le moteur. Produire uniquement la vidéo finale.",
  ]
    .filter(Boolean)
    .join("\n\n");
  if (compiledPrompt.length <= AI_MEDIA_COMPILED_PROMPT_MAX_CHARS) {
    return compiledPrompt;
  }

  // Les briefs maximaux, cinq références et les modules audio/identité peuvent
  // dépasser le budget du fournisseur. Reconstruire un contrat plus concis en
  // conservant intégralement le sujet, la consigne, chaque rôle/usage, la
  // palette et les choix Studio ; seuls ADN, historique et répétitions
  // explicatives sont compressés.
  const compactRequiredSections = [
    `Version : ${AI_MEDIA_PROMPT_VERSION}.`,
    "CONTRAT GÉNÉRER VIDÉO CONDENSÉ — nouvelle séquence animée cohérente ; jamais affiche fixe ni modification d’une source.",
    `SUJET CENTRAL OBLIGATOIRE (${request.subjectSource}) : ${
      cleanAiMediaPromptText(request.idea, 2_000) ||
      "déduire un sujet professionnel factuel de l’ADN compact ci-dessous"
    }. Ne jamais afficher ni recopier cette formulation dans le média.`,
    request.aiInstruction
      ? `CONSIGNE DE RÉALISATION PRIORITAIRE :\n${cleanAiMediaPromptStructuredText(
          request.aiInstruction,
          2_400
        )}\nAppliquer chaque exigence visuelle et narrative sans l’afficher, la reformuler ni la diluer.`
      : "Aucune consigne ponctuelle supplémentaire.",
    buildAiMediaOriginalityContract(request),
    "CONTRAT DU MODE DE COMPOSITION VIDÉO — chaque critère et chaque couple rôle/usage est autoritaire :",
    buildCompactVideoModeContract(args),
    `SORTIE ET FORMAT AUTORITAIRES : vidéo plein cadre ${format.aspectRatio} (${format.label}), mouvement naturel, sans bordure, planche comparative ni explication. Garder visages, produit, action et zone d’habillage loin des bords et interfaces.`,
    "DURÉE ET SCÈNES :",
    buildAiMediaVideoTimelineContract(args),
    `PARAMÈTRES STUDIO : typologie ${request.typology}, mode équipe ${request.teamVideoMode}.`,
    "STYLE ET RÉALISATION :",
    buildCompactVideoStyleContract(args),
    `SIGNATURE NARRATIVE FACULTATIVE : ${getAiMediaVideoOriginalityDirection(
      request
    )} Ne jamais altérer faits, critères, scénario ni références obligatoires.`,
    "MOUVEMENT : action crédible, gestes complets, caméra intentionnelle ; aucun morphing, membre incohérent, objet instable ni transition gratuite.",
    "TEXTE VISIBLE :",
    buildCompactVideoTextContract(args),
    `LOGO — ${request.logoMode} : aucun logo ni pseudo-logo dessiné par le moteur ; iNrCy appliquera localement le logo officiel selon ce mode.`,
    buildAiMediaVideoPaletteContract(args),
    buildCompactVideoIdentityContract(args),
    "AUDIO ET PAROLE :",
    buildAiMediaVideoAudioContract(args),
    "ANTI-RÉPÉTITION — renouveler uniquement ouverture, rythme, point de vue, lumière et mise en scène laissés libres ; conserver le sujet, le scénario, les identités, objets, lieux, actions, textes exacts et références imposés. Ne réutiliser aucune succession de plans ni structure récente, sauf scénario explicitement imposé.",
    "RÈGLES TECHNIQUES — durée, paramètres, rôles et couleurs sont des instructions, jamais des éléments à afficher. Aucun nuancier, échantillon de couleur, code hexadécimal, légende technique ou planche de style ajouté au résultat. Ne pas recopier les annotations techniques autour du sujet des références.",
    buildAiMediaPromptSafetyRules(),
    "COMPOSITION EXACTE PRISE EN CHARGE PAR iNrCy APRÈS GÉNÉRATION — RÈGLE FINALE PRIORITAIRE : plans sans texte, chiffre, téléphone, coordonnée, logo, enseigne ni interface lisible ; iNrCy ajoutera uniquement l’habillage validé.",
    "CONTRÔLE FINAL VIDÉO — sujet, consigne, mode, durée, scènes, format, texte, audio, identité, palette, logo et références conformes ; inspirations non copiées ; mouvements crédibles ; uniquement la vidéo finale.",
  ]
    .filter(Boolean)
    .map(String);
  return assembleBudgetedVideoPrompt({
    requiredSections: compactRequiredSections,
    dna: buildAiMediaPromptBusinessDna(profile, request),
    history: buildAiMediaPromptHistory(args.recentPublications || []),
  });
}
