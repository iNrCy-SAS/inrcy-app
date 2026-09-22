import { describeAiMediaBrandColors } from "@/lib/aiMediaColorDirection";
import { AI_MEDIA_FORMAT_SPECS } from "@/lib/aiMediaGenerationContracts";
import { getAiLanguageLabel } from "@/lib/aiWritingProfile";
import {
  AI_MEDIA_COMPILED_PROMPT_MAX_CHARS,
  AI_MEDIA_PROMPT_VERSION,
  buildAiMediaPromptBusinessDna,
  buildAiMediaPromptCreativeBrief,
  buildAiMediaPromptHistory,
  buildAiMediaPromptInstruction,
  buildAiMediaPromptSafetyRules,
  cleanAiMediaPromptStructuredText,
  cleanAiMediaPromptText,
  fitCompiledAiMediaPrompt,
  getAiMediaImageIdentityDirection,
  getAiMediaImageOriginalityDirection,
  getAiMediaImageQualityBar,
  getAiMediaImageSafeCompositionGuide,
  getAiMediaImageVisualDirection,
  getAiMediaReferenceGroups,
  type AiMediaPromptBuilderArgs,
} from "@/lib/aiMediaPromptShared";

const AI_MEDIA_GENERIC_HEADLINE_BLACKLIST = [
  ["Votre projet", "entre de bonnes mains"].join(" "),
  ["Votre projet", "prend vie"].join(" "),
  ["Une expertise", "à votre service"].join(" "),
  ["Une réponse", "sur mesure"].join(" "),
].join(" ; ");

function buildImageGenerationModeContract(args: AiMediaPromptBuilderArgs) {
  const { request } = args;
  if (request.generationMode === "ai_criteria") {
    const people = {
      auto: "Personnages : laisser l’IA décider uniquement selon le sujet.",
      none: "Personnages : aucune personne, aucun visage, aucune silhouette ni membre humain.",
      one: "Personnages : montrer exactement 1 personne clairement visible.",
      two: "Personnages : montrer exactement 2 personnes distinctes et clairement visibles.",
      three: "Personnages : montrer exactement 3 personnes distinctes et clairement visibles.",
      group: "Personnages : montrer un groupe naturel crédible, sans foule anonyme.",
    }[request.peopleCriterion];
    const setting = {
      auto: "Décor : déduire un lieu spécifique et crédible du sujet.",
      interior: "Décor : intérieur crédible, lisible et visuellement maîtrisé.",
      exterior: "Décor : extérieur cohérent, lisible et réaliste.",
      studio: "Décor : production en studio avec lumière et fond contrôlés.",
      neutral: "Décor : fond neutre, épuré et sans accessoire parasite.",
    }[request.settingCriterion];
    const focus = {
      auto: "Focus : choisir le point focal le plus utile au brief.",
      people: "Focus : priorité visuelle aux personnes et à leurs expressions.",
      product: "Focus : priorité visuelle au produit ou à l’objet principal.",
      environment: "Focus : priorité visuelle au lieu, au décor et à son atmosphère.",
    }[request.focusCriterion];
    return [
      "MODE IMAGE — IA AVEC CRITÈRES : contrat de composition structurée ; appliquer chaque choix comme une contrainte autonome.",
      people,
      setting,
      focus,
      "Aucun fichier de référence n’est fourni dans ce mode.",
    ].join("\n");
  }
  if (request.generationMode === "inspiration") {
    return "MODE IMAGE — INSPIRATIONS : le couple rôle+usage de chaque fichier est autoritaire ; les critères IA de casting, décor et focus sont inactifs.";
  }
  return [
    "MODE IMAGE — 100 % IA SANS CRITÈRES : inventer librement à partir du sujet, de la consigne et de l’ADN pertinent.",
    "Ne pas imposer un nombre de personnes, un type de décor, une priorité visuelle ni une référence absente.",
  ].join("\n");
}

function buildImagePurposeContract(args: AiMediaPromptBuilderArgs) {
  const { request } = args;
  const purpose = request.imagePurpose || "auto";
  const common =
    "Le type de création est un contrat de mise en page autoritaire : il ne peut jamais être réduit à une simple ambiance photographique.";
  if (purpose === "flyer") {
    const comparisonRequested =
      /\b(?:compar|pack|forfait|formule|offre|abonnement|tarif|prix)\w*/i.test(
        `${request.idea} ${request.aiInstruction}`
      );
    return [
      "TYPE DE CRÉATION STRUCTURÉ — FLYER COMMERCIAL.",
      common,
      "INTERDICTION : ne jamais produire une simple photo stock plein cadre, un portrait générique ou une photographie avec une petite barre décorative.",
      "Imposer une vraie composition graphique professionnelle : grille éditoriale, hiérarchie titre/offre, zones de texte volontairement dessinées, contrastes lisibles, marges sûres, point focal commercial et zone d’appel à l’action.",
      args.deferVisibleElementsToComposer
        ? comparisonRequested
          ? "COMPARAISON OBLIGATOIRE GÉRÉE PAR INR'CY : conserver un arrière-plan équilibré pour deux offres de même importance, sans dessiner de cartes, de colonnes, de tarifs ni de faux éléments d’interface."
          : "MISE EN PAGE COMMERCIALE GÉRÉE PAR INR'CY : conserver un arrière-plan lisible sans dessiner de carte d’offre ni de faux élément d’interface."
        : comparisonRequested
          ? "COMPARAISON OBLIGATOIRE : prévoir deux cartes ou deux colonnes d’offres équilibrées et immédiatement comparables, avec emplacements distincts pour les noms, prix, bénéfices et CTA. Les deux offres ont la même importance visuelle."
          : "Prévoir au moins une carte d’offre structurée avec emplacements distincts pour titre, bénéfices, prix éventuel et CTA.",
      request.imageStyle === "graphic"
        ? "RENDU AFFICHE GRAPHIQUE AUTORITAIRE : formes, aplats, cartes, séparateurs et typographie structurent le visuel ; la photographie éventuelle reste secondaire."
        : "Le rendu choisi complète cette architecture commerciale sans la remplacer.",
      args.deferVisibleElementsToComposer
        ? "Le fournisseur livre uniquement un arrière-plan commercial propre, sans texte, sans lettre, sans chiffre, sans carte tarifaire, sans tableau, sans bouton et sans panneau vide. iNrCy construit ensuite la grille complète du flyer avec les mots et chiffres exacts."
        : "Composer chaque information lisible dans la zone graphique qui lui est réservée.",
    ].join("\n");
  }
  const contracts: Record<typeof purpose, string> = {
    auto: "TYPE DE CRÉATION STRUCTURÉ — AUTO : déduire du brief une composition précise et nommable, jamais une image générique par défaut.",
    simple:
      "TYPE DE CRÉATION STRUCTURÉ — IMAGE SIMPLE : un seul sujet central, une lecture immédiate, une composition plein cadre sans fausse grille commerciale.",
    social:
      "TYPE DE CRÉATION STRUCTURÉ — PUBLICATION SOCIALE : impact en une seconde, point focal net, hiérarchie adaptée au fil social et marges sûres pour les interfaces.",
    product_sheet:
      "TYPE DE CRÉATION STRUCTURÉ — FICHE PRODUIT : produit héros fidèle, architecture modulaire, zones dédiées au nom, bénéfices, caractéristiques et CTA ; jamais une simple photo catalogue isolée.",
    poster:
      "TYPE DE CRÉATION STRUCTURÉ — AFFICHE : composition verticale ou panoramique forte selon le format, hiérarchie titre/visuel/information et lecture à distance.",
    banner:
      "TYPE DE CRÉATION STRUCTURÉ — BANNIÈRE : composition horizontale ou adaptée au ratio demandé, sujet décentré, large zone sûre pour le message et CTA.",
    infographic:
      "TYPE DE CRÉATION STRUCTURÉ — INFOGRAPHIE : informations organisées en sections, progression visuelle, pictogrammes cohérents et comparaison lisible ; aucune photo générique ne doit remplacer les données.",
  };
  return [contracts[purpose], common].filter(Boolean).join("\n");
}

function buildImageVisualDirectionContract(args: AiMediaPromptBuilderArgs) {
  const direction = args.request.visualDirection || "auto";
  const descriptions: Record<typeof direction, string> = {
    auto: "déduire une direction singulière du brief sans retomber sur un style générique",
    clean: "mise en page épurée, respirante, précise, avec peu d'éléments et une hiérarchie nette",
    premium: "finition haut de gamme, matières et contrastes raffinés, détails sobres et maîtrisés",
    warm: "lumière chaleureuse, palette accueillante, présence humaine ou matières naturelles crédibles",
    dynamic: "rythme visuel énergique, diagonales ou profondeur, mouvement lisible sans surcharge",
    bold: "parti pris audacieux, contrastes francs, échelle graphique forte et composition mémorable",
  };
  return `DIRECTION VISUELLE STRUCTURÉE — ${direction.toUpperCase()} : ${descriptions[direction]}.`;
}

function buildImageReferenceContract(args: AiMediaPromptBuilderArgs) {
  const { request } = args;
  const {
    characterReferences,
    environmentReferences,
    productReferences,
    requiredReferences,
    inspirationReferences,
    hasStrictIdentityReferences,
  } = getAiMediaReferenceGroups(request);
  const characterInspirations = inspirationReferences.filter(
    (reference) => reference.role === "character"
  );
  const productInspirations = inspirationReferences.filter(
    (reference) => reference.role === "product"
  );
  const environmentInspirations = inspirationReferences.filter(
    (reference) => reference.role === "environment"
  );
  const uncategorizedInspirations = inspirationReferences.filter(
    (reference) =>
      reference.role !== "character" &&
      reference.role !== "product" &&
      reference.role !== "environment"
  );
  const referenceInputLabel = hasStrictIdentityReferences
    ? `${characterReferences.length} référence${
        characterReferences.length > 1 ? "s" : ""
      } de personnage autorisée${
        characterReferences.length > 1 ? "s" : ""
      }${environmentReferences.length ? ", 1 décor" : ""}${
        productReferences.length ? ", 1 produit" : ""
      }`
    : `${requiredReferences.length} référence${
        requiredReferences.length > 1 ? "s" : ""
      } obligatoire${requiredReferences.length > 1 ? "s" : ""} et ${
        inspirationReferences.length
      } inspiration${inspirationReferences.length > 1 ? "s" : ""}`;

  return [
    `ENTRÉES AUTORISÉES POUR CETTE IMAGE : le sujet, la consigne, l’ADN professionnel structuré${
      request.inspirationImages.length
        ? ` et ${referenceInputLabel} avec accord ponctuel`
        : ""
    }${args.hasLogo ? ", puis le logo officiel" : ""}.`,
    request.inspirationImages.length
      ? [
          hasStrictIdentityReferences
            ? `RÉFÉRENCE OBLIGATOIRE — PERSONNAGES : analyser toutes les personnes distinctes visibles dans les ${characterReferences.length} fichier${
                characterReferences.length > 1 ? "s" : ""
              } source. Une photo peut contenir une ou plusieurs personnes et le nombre de photos ne fixe jamais le casting. Préserver chaque personne, toutes les faire apparaître reconnaissables et en action, sans omission, fusion, permutation, duplication, substitution générique ni fallback. Ne jamais recopier leur arrière-plan, leur pose ni le cadrage source par défaut.`
            : "",
          environmentReferences.length
            ? "RÉFÉRENCE OBLIGATOIRE — DÉCOR : conserver ce lieu ou cet environnement comme cadre reconnaissable de la scène ; ne pas le remplacer par un décor générique ni utiliser de fallback."
            : "",
          productReferences.length
            ? "RÉFÉRENCE OBLIGATOIRE — PRODUIT : reproduire le produit fourni avec sa forme, ses proportions, ses matières, ses couleurs et ses éléments distinctifs ; ne pas lui substituer un produit générique ni utiliser de fallback."
            : "",
          characterInspirations.length
            ? `INSPIRATION UNIQUEMENT — rôle Personnage : ${characterInspirations.length} média${
                characterInspirations.length > 1 ? "s" : ""
              } guide${
                characterInspirations.length > 1 ? "nt" : ""
              } librement le casting, la présence humaine, les attitudes ou l’énergie de la scène. Ne préserver ni recopier aucune identité, aucun visage, aucune silhouette ni tenue exacte.`
            : "",
          productInspirations.length
            ? `INSPIRATION UNIQUEMENT — rôle Produit : ${productInspirations.length} média${
                productInspirations.length > 1 ? "s" : ""
              } guide${
                productInspirations.length > 1 ? "nt" : ""
              } librement la catégorie, le langage de formes, les matières ou la mise en valeur du produit. Ne reproduire ni imposer sa forme, sa marque, ses détails distinctifs ni son apparence exacte.`
            : "",
          environmentInspirations.length
            ? `INSPIRATION UNIQUEMENT — rôle Décor : ${environmentInspirations.length} média${
                environmentInspirations.length > 1 ? "s" : ""
              } guide${
                environmentInspirations.length > 1 ? "nt" : ""
              } librement l’ambiance, l’architecture, la lumière ou la palette du lieu. Ne reproduire ni imposer son plan, ses éléments reconnaissables ni son décor exact.`
            : "",
          uncategorizedInspirations.length
            ? `INSPIRATION UNIQUEMENT — rôle Inspiration libre : ${uncategorizedInspirations.length} média${
                uncategorizedInspirations.length > 1 ? "s" : ""
              } guide${
                uncategorizedInspirations.length > 1 ? "nt" : ""
              } librement l’ambiance, la palette, le rythme ou la composition. Ne préserver ni recopier aucune identité, aucun produit, aucun décor, aucune pose ni aucun cadrage exact.`
            : "",
        ]
          .filter(Boolean)
          .join("\n")
      : "Aucune photo de Médiathèque, d’identité, d’ancien média ou de publication n’est fournie : imaginer une scène originale strictement adaptée au sujet actuel.",
    args.hasLogo
      ? `${
          request.inspirationImages.length
            ? "La dernière image de référence"
            : "Le seul fichier image de référence"
        } est le logo officiel. Respecter fidèlement sa forme, ses proportions, ses couleurs et son orthographe. L’intégrer une seule fois, ${
          request.logoMode === "visible"
            ? "de façon clairement visible mais élégante"
            : "discrètement"
        }, dans une zone sûre ; il ne doit jamais devenir le sujet principal ni occuper plus de ${
          request.logoMode === "visible" ? "22" : "12"
        } % du visuel.`
      : "Aucun logo n’est fourni : ne créer aucun logo, monogramme, emblème ou pseudo-logo.",
  ].join("\n");
}

function buildImageTextContract(args: AiMediaPromptBuilderArgs) {
  const { request } = args;
  const targetLanguage = getAiLanguageLabel(args.profile);
  const textMode = request.textMode || (request.withText ? "ai" : "none");
  const exactVisibleText =
    textMode === "exact"
      ? cleanAiMediaPromptStructuredText(request.exactText, 600)
      : "";
  const aiVisibleHeadline =
    textMode === "ai" ? cleanAiMediaPromptText(args.copy?.headline, 120) : "";

  if (args.deferVisibleElementsToComposer) {
    const localTextMode =
      textMode === "exact" && exactVisibleText
        ? "MODE TEXTE EXACT : une copie exacte validée est conservée hors du prompt fournisseur puis composée localement par iNrCy, sans reformulation, traduction, correction, ajout ni omission. Ne jamais tenter de la deviner, de la reproduire ni de réserver des glyphes factices."
        : textMode === "ai" && aiVisibleHeadline
        ? `MODE TEXTE IA CONTEXTUALISÉ : une accroche originale validée est conservée hors du prompt fournisseur puis composée localement par iNrCy. Ne jamais tenter de la deviner, de la reproduire ni d’ajouter un slogan générique. Clichés interdits : ${AI_MEDIA_GENERIC_HEADLINE_BLACKLIST}.`
        : "MODE SANS TEXTE : aucun habillage lisible ne sera ajouté ; tout mot, lettre, chiffre, slogan, enseigne, sous-titre, légende, CTA ou interface est interdit.";
    return [
      "COMPOSITION LOCALE DU TEXTE ET DU LOGO : iNrCy posera les éléments lisibles exacts après la génération.",
      localTextMode,
      `Le fournisseur crée uniquement le fond dans la langue de contexte ${targetLanguage} : aucun mot, texte, lettre, chiffre, slogan, enseigne, sous-titre, légende, CTA, interface, écran lisible, téléphone, coordonnées, logo, monogramme ni pseudo-logo.`,
      request.imagePurpose === "flyer"
        ? "Réserver des zones graphiques calmes et distinctes pour le titre, les cartes d’offres, leurs prix/bénéfices et le CTA ; ne pas remplir ces panneaux avec une photo."
        : request.format === "portrait" || request.format === "story"
        ? "Réserver une zone visuellement calme dans la partie inférieure et garder le sujet principal dans la moitié supérieure."
        : "Réserver une zone visuellement calme sur la moitié gauche et placer le sujet principal dans la moitié droite.",
      "Ne jamais interpréter, deviner ni redessiner les éléments textuels demandés dans la consigne ponctuelle.",
    ].join("\n");
  }
  if (textMode === "exact" && exactVisibleText) {
    return [
      "TEXTE EXACT — CONTRAINTE ABSOLUE : composer le texte fourni sans reformulation, correction, traduction, abréviation ni ajout.",
      `Afficher exclusivement « ${exactVisibleText} » en respectant chaque mot, la casse et la ponctuation.`,
      "Ne créer aucun autre titre, slogan, sous-titre, enseigne, légende, CTA, interface, lettre ou chiffre ; garantir une lecture parfaite et des marges sûres.",
    ].join("\n");
  }
  if (textMode === "ai" && aiVisibleHeadline) {
    return [
      `LANGUE DU TEXTE VISIBLE — RÈGLE ABSOLUE : le texte destiné au lecteur doit être exclusivement en ${targetLanguage}.`,
      `TEXTE IA CONTEXTUALISÉ — accroche originale sélectionnée par iNrCy à partir des faits et du sujet actuels, à afficher exactement : « ${aiVisibleHeadline} » avec une hiérarchie typographique professionnelle.`,
      `Cette accroche doit employer un vocabulaire concret, différer de l’historique récent et ne reprendre aucune structure récente. Clichés interdits : ${AI_MEDIA_GENERIC_HEADLINE_BLACKLIST}.`,
      request.textKeywords.length
        ? `Mots-clés ayant guidé l’accroche : ${request.textKeywords
            .map((value) => cleanAiMediaPromptText(value, 48))
            .join(", ")}.`
        : "Aucun mot-clé supplémentaire n’a été imposé.",
      "Ne jamais ajouter de slogan, sous-titre, paragraphe, enseigne, légende, CTA, interface ni autre texte ; éloigner chaque lettre des bords.",
    ].join("\n");
  }
  return `AUCUN TEXTE VISIBLE — contrainte absolue : Aucun texte visible ne doit être créé ; ne créer ni recopier aucun mot, lettre, chiffre, slogan, enseigne, sous-titre, légende, CTA, interface, écran lisible, téléphone ou coordonnée dans l’image, hors texte déjà présent dans un éventuel logo officiel. La langue configurée est ${targetLanguage}. Toute accroche, même plausible ou générique, est interdite.`;
}

function buildImagePaletteContract(args: AiMediaPromptBuilderArgs) {
  const palette = describeAiMediaBrandColors(args.brandColors || [], 4);
  if (args.request.useBrandColors && palette.length) {
    return `Couleurs de marque à utiliser uniquement comme accents dans la lumière, les matières et le décor : ${palette.join(
      ", "
    )}. Ne pas en faire un sujet ni une planche de présentation.`;
  }
  return args.hasLogo
    ? "Palette créative libre et cohérente avec le secteur. Ne pas étendre les couleurs du logo à toute l’image : elles doivent rester limitées au logo lui-même."
    : "Palette créative libre, harmonieuse, professionnelle et cohérente avec le secteur.";
}

/** Contrat propriétaire de Générer · Image. */
export function buildAiMediaImageGenerationPrompt(
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
    "CONTRAT GÉNÉRER IMAGE — mission exclusive : composer une nouvelle image originale, jamais modifier une source ni préparer une animation.",
    "ORDRE DE PRIORITÉ IMAGE — sécurité et droits ; sujet explicite ; consigne explicite ; références obligatoires ; texte exact ou habillage local ; format et zones sûres ; ADN pertinent ; préférences esthétiques. Une couche inférieure ne doit jamais diluer une exigence supérieure.",
    "BRIEF UTILISATEUR PRIORITAIRE :",
    buildAiMediaPromptCreativeBrief(request),
    buildAiMediaPromptInstruction(request),
    "CONTRAT DU MODE DE COMPOSITION IMAGE :",
    buildImageGenerationModeContract(args),
    "CONTRAT DU TYPE DE CRÉATION IMAGE :",
    buildImagePurposeContract(args),
    buildImageVisualDirectionContract(args),
    args.deferVisibleElementsToComposer
      ? `Créer le fond premium d’un média professionnel au format ${format.aspectRatio} (${format.label}), sans bordure.`
      : `Créer une image professionnelle entièrement composée au format ${format.aspectRatio} (${format.label}), sans bordure.`,
    request.inputMode !== "essential"
      ? `Typologie : ${request.typology}. Direction visuelle : ${request.visualStyle}.`
      : `MODE STUDIO GUIDÉ IMAGE : typologie ${request.typology}, type ${request.imagePurpose}, style ${request.visualStyle}, direction ${request.visualDirection}, rendu ${request.imageStyle}, cadrage ${request.shotType}, présence ${request.peopleMode}, créativité ${request.creativity}. Le brief reste prioritaire et l’ADN sert uniquement de contexte.`,
    `DIRECTION ARTISTIQUE IMAGE : ${getAiMediaImageVisualDirection(request)}.`,
    `SIGNATURE CRÉATIVE PROPRE À CETTE REQUÊTE : ${getAiMediaImageOriginalityDirection(
      request
    )}. Cette variation ne peut jamais altérer les faits, identités, références obligatoires ni la consigne du professionnel.`,
    getAiMediaImageQualityBar(request),
    `FORMAT ET ZONES SÛRES : ${getAiMediaImageSafeCompositionGuide(request)}`,
    "COMPOSITION IMAGE : sujet immédiatement lisible, profondeur naturelle, lumière soignée, marges sûres et hiérarchie visuelle équilibrée. Ne jamais couper un mot, un visage, le logo ou le sujet principal.",
    request.inputMode !== "essential"
      ? `Direction de communication : ${preferenceLine}.`
      : "",
    buildImageTextContract(args),
    buildImagePaletteContract(args),
    "CONTRAT DES RÉFÉRENCES IMAGE :",
    buildImageReferenceContract(args),
    getAiMediaImageIdentityDirection(request),
    "ADN PROFESSIONNEL AUTORISÉ — utiliser uniquement les éléments pertinents pour le sujet, sans afficher ni recopier ce bloc :",
    buildAiMediaPromptBusinessDna(profile),
    "HISTORIQUE RÉCENT À NE PAS COPIER (éviter les répétitions visuelles) :",
    buildAiMediaPromptHistory(args.recentPublications || []),
    "ANTI-RÉPÉTITION IMAGE — comparer le résultat envisagé à cet historique et changer explicitement l’angle du sujet, la composition, le point focal, le décor, l’action, les accessoires et le vocabulaire visuel. Ne réutiliser aucune accroche, aucun slogan, aucune structure de mise en page ni scène récente. Interdiction des slogans passe-partout ; si aucun texte spécifique n’est validé, ne rien écrire.",
    "RÈGLES IMPÉRATIVES IMAGE :",
    "Les paramètres techniques et couleurs de marque sont des instructions de réalisation, jamais des éléments à afficher. Aucun nuancier, échantillon de couleur, code hexadécimal, légende technique ou planche de style ajouté au résultat. Ne pas recopier les annotations techniques autour du sujet des références.",
    buildAiMediaPromptSafetyRules(),
    args.deferVisibleElementsToComposer
      ? "COMPOSITION EXACTE PRISE EN CHARGE PAR iNrCy APRÈS GÉNÉRATION — RÈGLE FINALE PRIORITAIRE : produire exclusivement le fond sans texte, chiffre, téléphone, coordonnées ni logo. La consigne ponctuelle peut demander leur présence, mais le fournisseur ne doit jamais les dessiner : iNrCy appliquera ensuite les valeurs exactes sans les transmettre au moteur."
      : "",
    "CONTRÔLE FINAL IMAGE — vérifier silencieusement : sujet reconnaissable ; consigne exécutée ; références obligatoires fidèles ; inspirations non copiées ; format exact ; texte et identité conformes ; composition, décor et vocabulaire différents des productions récentes ; aucun slogan générique ; aucun élément parasite. Produire une seule image finale plein cadre, sans explication.",
  ]
    .filter(Boolean)
    .join("\n\n");
  if (compiledPrompt.length <= AI_MEDIA_COMPILED_PROMPT_MAX_CHARS) {
    return compiledPrompt;
  }

  // Un brief maximal et plusieurs références peuvent dépasser le budget du
  // fournisseur. Dans ce cas, reconstruire un contrat condensé plutôt que
  // couper aveuglément son milieu : le rôle/usage d'un média obligatoire, la
  // palette ou le mode texte ne doivent jamais disparaître au profit d'un ADN
  // verbeux.
  const compactDna = cleanAiMediaPromptStructuredText(
    buildAiMediaPromptBusinessDna(profile),
    420
  );
  const compactHistory = cleanAiMediaPromptStructuredText(
    buildAiMediaPromptHistory(args.recentPublications || []),
    180
  );
  const compactPrompt = [
    `Version : ${AI_MEDIA_PROMPT_VERSION}.`,
    "CONTRAT GÉNÉRER IMAGE CONDENSÉ — produire une nouvelle image originale plein cadre ; ne jamais modifier une source ni préparer une animation.",
    `SUJET CENTRAL OBLIGATOIRE (${request.subjectSource}) : ${
      cleanAiMediaPromptText(request.idea, 2_000) ||
      "déduire un sujet professionnel factuel de l’ADN compact ci-dessous"
    }. Ne jamais afficher ni recopier cette formulation dans le média.`,
    request.aiInstruction
      ? `CONSIGNE DE RÉALISATION PRIORITAIRE :\n${cleanAiMediaPromptStructuredText(
          request.aiInstruction,
          2_400
        )}\nL’appliquer visuellement sans l’afficher ni la diluer.`
      : "Aucune consigne ponctuelle supplémentaire.",
    buildImageGenerationModeContract(args),
    buildImagePurposeContract(args),
    buildImageVisualDirectionContract(args),
    `FORMAT AUTORITAIRE : ${format.aspectRatio} (${format.label}). ${getAiMediaImageSafeCompositionGuide(
      request
    )}`,
    `PARAMÈTRES STUDIO : type ${request.imagePurpose}, rendu ${request.imageStyle}, direction ${request.visualDirection}, style ${request.visualStyle}, cadrage ${request.shotType}, présence ${request.peopleMode}, créativité ${request.creativity}.`,
    `DIRECTION ARTISTIQUE : ${getAiMediaImageVisualDirection(request)}.`,
    buildImageTextContract(args),
    buildImagePaletteContract(args),
    "CONTRAT DES RÉFÉRENCES IMAGE — chaque rôle et usage est autoritaire :",
    buildImageReferenceContract(args),
    `MODE IDENTITÉ : ${request.identityMode}. Toute référence Personnage obligatoire doit conserver séparément chaque personne distincte détectée ; aucune omission, fusion, duplication ni substitution générique.`,
    `ADN PROFESSIONNEL COMPACT — contexte seulement, jamais sujet de remplacement :\n${compactDna}\n[… contexte ADN compacté automatiquement par iNrCy …]`,
    `HISTORIQUE COMPACT À NE PAS COPIER :\n${compactHistory}`,
    "ANTI-RÉPÉTITION — varier composition, point focal, décor, action, accessoires et vocabulaire visuel ; aucun slogan générique ni reprise d’une production récente.",
    "RÈGLES TECHNIQUES IMAGE — les paramètres et couleurs sont des instructions, jamais des éléments à afficher. Aucun nuancier, échantillon de couleur, code hexadécimal, légende technique ou planche de style ajouté au résultat. Ne pas recopier les annotations techniques autour du sujet des références.",
    buildAiMediaPromptSafetyRules(),
    args.deferVisibleElementsToComposer
      ? "COMPOSITION EXACTE PRISE EN CHARGE PAR iNrCy APRÈS GÉNÉRATION — RÈGLE FINALE PRIORITAIRE : produire exclusivement le fond sans texte, chiffre, téléphone, coordonnées ni logo. Les valeurs exactes restent hors du prompt fournisseur et seront posées localement."
      : "",
    "CONTRÔLE FINAL IMAGE — sujet et consigne respectés ; références obligatoires fidèles ; inspirations non copiées ; format, texte, identité, palette et logo conformes ; une seule image finale sans explication.",
  ]
    .filter(Boolean)
    .join("\n\n");
  return fitCompiledAiMediaPrompt(compactPrompt);
}
