/** Reviewed capabilities and paths of the current Basique application. */
export const INR_ASSISTANT_BASIC_GUIDES = [
  {
    "id": "basic-booster",
    "title": "Publications et planning manuel Basique",
    "keywords": [
      "basique",
      "assistant",
      "autonome",
      "booster"
    ],
    "content": "iNr’Assistant peut préparer les contenus, choisir les médias par canal et appliquer les options disponibles : placement classique/Reel/Story Meta, Story associée, musique native, mode Threads classique/éphémère, CTA et tableau Pinterest réellement accessible. Les réglages de cadrage/adaptation natifs sont conservés. La validation peut répartir les canaux entre diffusion immédiate et dates de programmation distinctes, avec suivi de chaque résultat. Les programmations manuelles du Basique peuvent être relues, modifiées (date, texte, médias), annulées ou reprises lorsqu’elles sont admissibles, après aperçu exact confirmé. Les tâches de l’agent restent exclues du Basique ; un résultat incertain demande une vérification avant toute reprise. L’historique Publications permet de rechercher puis reprendre un brouillon Booster précis, par référence citée ou titre unique réellement lu, sans générer ni publier. Le planning manuel permet aussi la diffusion immédiate d’une programmation encore admissible après aperçu confirmé, et l’édition de ses CTA explicites. Les publications déjà diffusées suivent un autre parcours : lire la version exacte, présenter les changements par canal, confirmer puis vérifier chaque résultat ; une issue fournisseur incertaine interdit de répéter aveuglément. Pinterest : titre 100 caractères ; description finale 800, CTA et hashtags compris. Un refus de longueur avant envoi reste corrigible sans bloquer la version. Les contrôles locaux du formulaire (texte, médias, options et calendrier) modifient le brouillon ouvert ; ils ne constituent pas à eux seuls une sauvegarde ou une diffusion.",
    "sourceFiles": [
      "lib/inrAssistantPublicationTools.ts",
      "lib/pinterestTextLimits.ts",
      "lib/pinterestTextRules.ts",
      "lib/inrAssistantScheduledPublicationTools.ts",
      "lib/inrAssistantScheduledPublicationEdit.ts",
      "lib/productNavigation.ts",
      "app/dashboard/_components/dashboardMobileMenuModel.ts",
      "app/dashboard/booster/publier/PublishModal.tsx",
      "app/dashboard/booster/publier/components/publishWizard.ts",
      "app/dashboard/booster/publier/components/PublishCreationModePanel.tsx",
      "app/dashboard/booster/publier/components/PublishContentAdjustmentModal.tsx",
      "lib/boosterContentAdjustment.ts",
      "app/dashboard/booster/publier/components/PublishFinalReviewModal.tsx",
      "app/dashboard/booster/publier/components/PublishFooterActions.tsx",
      "app/dashboard/booster/publier/components/PublishMediaPoolPanel.tsx",
      "app/dashboard/booster/publier/components/PublishValidationChannelOptions.tsx",
      "messages/fr-FR/booster.json",
      "lib/dashboardEdition.ts",
      "lib/inrAssistantSendPublicationTools.ts",
      "lib/inrAssistantPublishedPublicationTools.ts",
      "lib/inrAssistantScheduledPublicationIntent.ts",
      "lib/inrAssistantPublicationCtaPatch.ts",
      "lib/inrAssistantScheduledEditorSelection.ts",
      "app/dashboard/_hooks/useInrAssistantScheduledPublicationControls.ts"
    ]
  },
  {
    "id": "basic-studio-create",
    "title": "Studio Basique : devis et création",
    "keywords": [
      "basique",
      "assistant",
      "autonome",
      "studio",
      "create"
    ],
    "content": "Accès : [iNr’Studio](/dashboard/generer-media). Préparer devis/champs selon choix explicites ne lance ni génération, achat ni consentement d’identité/voix.\nImage/Vidéo : format, moteur, durée (s) ; plans automatiques en Studio Libre. Conseil indicatif, choix explicite conservé. Moteurs disponibles ; Wan 3 et MiniMax H3 retirés de tous les parcours de génération.\nVisuel : vidéo 500 caractères max, image 4 000 ; paroles séparées. Utiliser mon ADN ajoute faits/logo/couleurs/coordonnées sur demande. Décoché : pas d’autre ADN. Consignes ET Interdictions de Ma communication restent transmises ; les interdictions priment. Règles jamais coupées ; incompatibilité bloquée.\nInspiration/Personnage/Décor/Produit : rôle avant Importer/Médiathèque (images seules), fermeture après ajout. Inspiration facultative, autres Obligatoires ; usage sur miniature. Vérifier identités/doublons.\nMusiques : catalogue iNrCy, Automatique/Sans musique/piste et préécoute ; distinct des vocaux.\nVoix off/Personnages/Sans parole. Automatiques : IA sans champ ; Paroles exactes : champ/compteur selon durée/moteur/plans/langue. Ne jamais tronquer texte exact ou brouillon ; réduire avec accord ou durée compatible. Exact vide = sans parole.\nVoix off IA : Réglages → Femme/Homme, Style de voix ; réglages IA si options utiles. Voix réelle : 3 vocaux max, Importer/Enregistrer/Médiathèque. Voix off sans photo : Chatterbox hors moteur vidéo (vocal 5 à 10 s) ; un narrateur actif. Personnage vocal : Wan 2.7 ou Kling ; un vocal/personne. Kling : 5 à 10 s, un locuteur. Genre réglable, vocal pour le timbre ; droits à confirmer par le pro. Import/enregistrement humains.\nEn Libre, paroles exactes compatibles, piste réelle complète trop longue : une resynthèse supplémentaire, mêmes paroles/vocal ; jamais après erreur réseau/soumission incertaine, ni substitution de voix.\nSous-titres voix off : durée mesurée, départ estimé, pas d’alignement mot à mot. Barre et ≈% vidéo estimés, sans délai garanti.\nVérifier mon média : même tentative, sans relance. Pause/fermeture garde l’identifiant ; critères restent modifiables. Une nouvelle génération attend sa résolution. Annuler la génération : confirmation distincte ; arrêt ≠ absence de débit.\nCoût/solde avant Générer ; Enregistrer dans la Médiathèque/Utiliser ce média. Régénérer peut débiter.\nLire préférences ; oublier un bloc préserve les autres. Basique sans crédits mensuels ; les recharges permettent de générer sans changer d’offre. Depuis Booster, type/format fixés.",
    "sourceFiles": [
      "lib/inrAssistantMediaTools.ts",
      "lib/productNavigation.ts",
      "app/dashboard/generer-media/page.tsx",
      "app/dashboard/generer-media/MediaGeneratorStudioClient.tsx",
      "app/dashboard/_components/MediaGeneratorModal.tsx",
      "app/dashboard/_components/MediaFreeGenerator.tsx",
      "lib/studioInspirationImagePolicy.ts",
      "lib/aiMediaGenerationContracts.ts",
      "lib/aiMediaVideoSpeechBudget.ts",
      "app/dashboard/_components/MediaGenerationCreationWorkspace.tsx",
      "lib/aiMediaGlobalConstraints.ts",
      "lib/aiMediaGenerationServer.ts",
      "lib/aiMediaFreeGenerationPrompt.ts",
      "lib/aiMediaFreeGenerationPlan.ts",
      "lib/aiMediaModelCatalog.ts",
      "lib/aiMediaCreditsPricing.ts",
      "lib/aiVideoProvider.ts",
      "lib/aiVideoProviderGateway.ts",
      "lib/aiMediaNarrationSubtitles.ts",
      "lib/aiMediaGeneratedVideo.ts",
      "lib/inrStudioModalPolicy.ts",
      "messages/fr-FR/media.json",
      "lib/dashboardEdition.ts",
      "lib/inrAssistantStudioFormSelection.ts",
      "lib/inrAssistantStudioPreferenceTools.ts",
      "lib/inrAssistantLocalInterfaceTools.ts",
      "app/dashboard/_components/MediaEngineCreditControls.tsx",
      "app/dashboard/_components/StudioVoicePool.tsx",
      "app/dashboard/_components/MediaCharacterVoiceInput.tsx",
      "lib/aiMediaModelRecommendation.ts",
      "lib/aiMediaVideoClientOptions.ts",
      "lib/aiMediaNarrationPreparation.ts",
      "lib/aiMediaNarrationVoiceClone.ts",
      "app/dashboard/_hooks/useMediaGeneration.ts"
    ]
  },
  {
    "id": "basic-studio-edit",
    "title": "Studio Basique : retouche manuelle autonome",
    "keywords": [
      "basique",
      "assistant",
      "autonome",
      "studio",
      "edit"
    ],
    "content": "Accès direct au retoucheur image : /dashboard/generer-media?studio_tab=retouch&studio_media_type=image ; vidéo : /dashboard/generer-media?studio_tab=retouch&studio_media_type=video. iNr’Assistant peut choisir une source de la médiathèque, régler le cadrage et enregistrer une copie. Pour une image : zoom, déplacement, fond et habillage texte/lien, avec réinitialisation disponible. Chaque réglage attend la confirmation de l’éditeur et la copie enregistrée est relue avant d’annoncer sa réussite.",
    "sourceFiles": [
      "lib/inrAssistantStudioUiCommands.ts",
      "app/dashboard/_hooks/useInrAssistantImageCommands.ts",
      "lib/inrAssistantNavigationForm.ts",
      "lib/productNavigation.ts",
      "app/dashboard/_components/MediaGeneratorModal.tsx",
      "app/dashboard/_components/MediaModifier.tsx",
      "app/dashboard/_components/MediaRetoucher.tsx",
      "app/dashboard/_components/MediaVideoRetoucher.tsx",
      "app/dashboard/_components/MediaGenerationCreationWorkspace.tsx",
      "lib/inrStudioModalPolicy.ts",
      "messages/fr-FR/media.json"
    ]
  },
  {
    "id": "basic-media-library",
    "title": "Basique : gérer et retrouver les médias",
    "keywords": [
      "basique",
      "assistant",
      "autonome",
      "media",
      "library"
    ],
    "content": "iNr’Assistant peut afficher les filtres et la recherche, sélectionner ou prévisualiser les éléments effectivement visibles, modifier leurs informations, importer une pièce jointe admissible fournie dans la conversation, optimiser une copie et préparer un téléchargement. Il applique le filtre avant de choisir dans la liste rechargée. Supprimer des originaux exige l’aperçu exact confirmé ; un téléchargement transmis ne prouve pas la réception du fichier.",
    "sourceFiles": [
      "app/dashboard/_hooks/useInrAssistantMediaLibraryCommands.ts",
      "lib/inrAssistantMediaLibraryTools.ts",
      "lib/inrAssistantMediaUiTools.ts",
      "lib/productNavigation.ts",
      "app/dashboard/mediatheque/page.tsx",
      "app/dashboard/mediatheque/MediaLibraryClient.tsx",
      "app/dashboard/mediatheque/MediaMetadataField.tsx",
      "messages/fr-FR/media.json",
      "lib/dashboardEdition.ts"
    ]
  },
  {
    "id": "basic-stats",
    "title": "Basique : lire et piloter les statistiques",
    "keywords": [
      "basique",
      "assistant",
      "autonome",
      "stats"
    ],
    "content": "La page complète est /dashboard/stats ; /dashboard?stats=1 ouvre le bilan Booster. iNr’Assistant peut lire l’évolution mensuelle réelle et choisir la vue, le canal, la métrique visibilité/clics et l’affichage mesuré/indice. Les données manquantes restent inconnues. Basique permet consultation/actualisation et téléchargement des bilans déjà accessibles ; génération et envoi d’un nouveau bilan conservent leurs droits Standard.",
    "sourceFiles": [
      "lib/inrAssistantStatsTools.ts",
      "lib/inrAssistantStatsUiCommands.ts",
      "lib/inrAssistantStatsUiTools.ts",
      "lib/inrAssistantPureStatsViewRequest.ts",
      "app/dashboard/_hooks/useInrAssistantStatsCommands.ts",
      "lib/productNavigation.ts",
      "app/dashboard/stats/StatsClient.tsx",
      "app/dashboard/stats/StatsMeasuredEvolution.tsx",
      "app/dashboard/stats/StatsVisibilityIndex.tsx",
      "app/dashboard/stats/stats.monthly-metrics.ts",
      "app/dashboard/stats/stats.evolution-loader.ts",
      "app/api/inrstats/evolution/route.ts",
      "app/dashboard/stats/stats.edition-policy.ts",
      "messages/fr-FR/stats.json"
    ]
  },
  {
    "id": "basic-reputation",
    "title": "Basique : avis Google et réponses",
    "keywords": [
      "basique",
      "assistant",
      "autonome",
      "reputation"
    ],
    "content": "iNr’Assistant peut parcourir les avis au-delà de la première page, filtrer par note, date et présence de réponse, et répondre à un avis précis. Pour modifier ou supprimer une réponse existante, il présente un aperçu à confirmer, vérifie que l’avis n’a pas changé puis relit le résultat. La suppression concerne uniquement la réponse du professionnel, jamais l’avis du client. Une page partielle ne représente pas tous les avis. Chemin actuel : Accueil → Connecter mes canaux → bulle Google Business → Avis Google. Une réponse peut être préparée en brouillon avec le moteur natif puis vérifiée ; une génération de réponse ne publie rien.",
    "sourceFiles": [
      "lib/inrAssistantGoogleReviewTools.ts",
      "lib/googleReviewStateFingerprint.ts",
      "app/api/e-reputation/google/reviews/route.ts",
      "app/api/e-reputation/google/reply/route.ts",
      "lib/productNavigation.ts",
      "app/dashboard/_components/DashboardChannelWorkspace.tsx",
      "app/dashboard/e-reputation/page.tsx",
      "app/dashboard/e-reputation/EReputationReviewsClient.tsx",
      "lib/inrAssistantInsightsTools.ts",
      "app/dashboard/propulser/page.tsx",
      "lib/dashboardEdition.ts",
      "messages/fr-FR/reputation.json"
    ]
  },
  {
    "id": "basic-business-dna",
    "title": "Basique : identité et sources ADN",
    "keywords": [
      "basique",
      "assistant",
      "autonome",
      "business",
      "dna"
    ],
    "content": "iNr’Assistant peut compléter les coordonnées, le nom, l’activité/profession du catalogue, la ville et un logo déjà importé, à partir des informations explicites du professionnel. Il vérifie la version puis relit les champs sauvegardés. Il peut lister les sources et documents ADN, choisir les sources d’analyse demandées et supprimer un document précis après aperçu confirmé. Pour un nouveau fichier local, le choix du fichier et l’autorisation native restent personnels. Les formulaires ouverts permettent les choix locaux, onglets et annulations natives. Pour les champs de texte enrichi, l’assistant peut appliquer gras, italique ou listes au passage littéral unique demandé, ou à tout le champ explicitement désigné, en utilisant la barre native ; la mise en forme ne prouve pas une sauvegarde serveur. La langue de rédaction IA et la langue d’affichage de l’application sont deux réglages distincts.",
    "sourceFiles": [
      "lib/inrAssistantBusinessIdentityTools.ts",
      "lib/businessIdentity.ts",
      "lib/inrAssistantBusinessDnaSourceTools.ts",
      "lib/inrAssistantDnaAnalysisTools.ts",
      "app/dashboard/personnalisation/page.tsx",
      "app/dashboard/adn-entreprise/page.tsx",
      "app/dashboard/mon-profil/page.tsx",
      "app/dashboard/settings/profil/page.tsx",
      "app/dashboard/settings/activite/page.tsx",
      "app/dashboard/settings/_components/AiMemoryContent.tsx",
      "app/dashboard/settings/_components/BusinessDnaAnalysisScheduleModal.tsx",
      "app/api/ai-memory/route.ts",
      "messages/fr-FR/dashboard.json",
      "lib/inrAssistantBasicTargetIntents.ts",
      "lib/inrAssistantBusinessRichText.ts",
      "lib/inrAssistantBusinessRichTextUiTools.ts",
      "lib/inrAssistantBusinessFormUiCommands.ts",
      "lib/inrAssistantApplicationPreferences.ts"
    ]
  },
  {
    "id": "basic-channels-overview",
    "title": "Basique : sélectionner et personnaliser les canaux",
    "keywords": [
      "basique",
      "assistant",
      "autonome",
      "channels",
      "overview"
    ],
    "content": "iNr’Assistant peut lister les ressources réellement accessibles chez Google Business, Facebook, Instagram, LinkedIn et Pinterest, puis préparer un changement de cible ou une déconnexion à confirmer. Le thème iNr’Badge, la présentation iNr’Search, le QR PNG/PDF et les réglages natifs du widget Site Web sont également pilotables. Les autorisations OAuth et l’installation du code sur un site externe restent des actions personnelles du professionnel. Le cockpit, ses filtres, liens et panneaux sont pilotés par les contrôles réellement montés. Pour iNr’Badge, les couleurs peuvent être recalculées depuis le logo enregistré : extraction native, sauvegarde conditionnelle et relecture exacte avant confirmation. La fiche Google permet de préparer les sections, catégories et horaires ; enregistrer le brouillon demande la confirmation native du professionnel. Un lien public transmis au navigateur ne prouve pas le chargement du site externe.",
    "sourceFiles": [
      "lib/inrAssistantChannelConfigurationTools.ts",
      "lib/inrAssistantNativePresentationTools.ts",
      "lib/inrAssistantWebsiteTools.ts",
      "lib/inrAssistantBadgeUiCommands.ts",
      "lib/inrAssistantWebsiteUiCommands.ts",
      "app/dashboard/DashboardClient.tsx",
      "lib/inrAssistantBasicTargetIntents.ts",
      "app/dashboard/settings/_components/InrBadgeSettingsContent.tsx",
      "app/dashboard/_hooks/useInrAssistantBadgeCommands.ts",
      "app/api/inrbadge/settings/route.ts",
      "app/api/inr-search/settings/route.ts",
      "lib/inrAssistantBadgeIdentityTheme.ts",
      "lib/inrAssistantBadgeIdentityThemeUiTools.ts",
      "lib/inrAssistantGoogleBusinessDraftReview.ts",
      "lib/inrAssistantNativeChannelLinks.ts",
      "lib/inrAssistantLocalInterface.ts"
    ]
  },
  {
    "id": "basic-studio-preview",
    "title": "Studio : aperçu, enregistrement et abandon",
    "keywords": [
      "aperçu",
      "preview",
      "enregistrer",
      "conserver",
      "écarter",
      "scènes",
      "personnages",
      "produit",
      "décor"
    ],
    "content": "iNr’Studio est disponible en Basique avec les crédits et moteurs autorisés. iNr’Assistant peut demander un aperçu temporaire plutôt qu’un enregistrement immédiat. L’aperçu prêt est affiché avec Conserver ce média et Écarter cet aperçu. Conserver vérifie la liaison entre la génération et son média puis relit l’enregistrement ; écarter refuse uniquement le brouillon temporaire, jamais un original déjà accepté. Consulter le statut ne sauvegarde pas silencieusement. Les crédits de génération déjà consommés ne sont pas remboursés par l’abandon. Les références peuvent être décrites comme produit, décor, personnage ou inspiration ; durée/paroles selon le moteur. En Studio Libre, les plans sont automatiques ; les autres parcours gardent leurs choix natifs de scènes. Les autorisations d’identité fidèle et de voix personnelles restent dans le parcours natif du professionnel. Fermer, réinitialiser, abandonner ou reprendre une récupération ouvre les confirmations natives lorsqu’elles sont nécessaires : l’assistant attend le choix du professionnel et ne déclare pas le travail supprimé ou récupéré à l’ouverture du dialogue. Signaler un contenu demande un motif, un commentaire et un ordre actuel d’envoi ; seule une réponse native positive permet d’annoncer le signalement transmis.",
    "sourceFiles": [
      "lib/inrAssistantMediaTools.ts",
      "lib/inrAssistantMediaPreview.ts",
      "lib/inrAssistantTaskPolicy.ts",
      "app/dashboard/_components/DashboardAssistantSession.tsx",
      "lib/inrAssistantReplyReplay.ts",
      "lib/inrAssistantAttachmentStorage.ts",
      "app/dashboard/_components/dashboardAssistantSessionState.ts",
      "lib/inrAssistantStudioDraftReview.ts",
      "lib/inrAssistantStudioDraftReviewUiTools.ts",
      "lib/inrAssistantContentReport.ts",
      "lib/inrAssistantContentReportTools.ts",
      "app/dashboard/_components/MediaEngineCreditControls.tsx",
      "lib/aiMediaVideoClientOptions.ts"
    ]
  },
  {
    "id": "basic-account-services",
    "title": "Basique : compte, notifications, crédits et confidentialité",
    "keywords": [
      "notifications",
      "lues",
      "crédits",
      "solde",
      "factures abonnement",
      "rgpd",
      "cookies",
      "parrainage"
    ],
    "content": "Les informations de compte sont accessibles dans Mon compte (/dashboard?panel=compte), les notifications dans /dashboard?panel=notifications, les factures d’abonnement dans /dashboard?panel=factures et les données RGPD dans /dashboard?panel=rgpd. L’abonnement et ses factures appartiennent au titulaire connecté ; les notifications et crédits dépendent de l’établissement actif. iNr’Assistant peut lire le solde natif du Studio, les packs et historiques sans achat ; une source indisponible reste inconnue, un vrai zéro reste zéro. Il peut marquer les notifications ciblées ou toutes comme lues sans les supprimer. L’export RGPD concerne le titulaire et tous ses établissements accessibles ; les données restent hors conversation et sont téléchargées dans le navigateur. Une facture exacte ou la dernière facture d’abonnement est résolue côté navigateur, sans URL fournie au modèle ; l’historique natif couvre les 100 dernières factures. Les cookies statistiques se règlent uniquement dans le navigateur courant ; les cookies nécessaires restent actifs. Un parrainage exige quatre coordonnées fournies, un aperçu confirmé et un reçu durable. L’acceptation SMTP ne prouve pas la livraison et un envoi incertain n’est pas répété automatiquement. Le paiement, le mot de passe et la suppression du compte gardent leur validation personnelle. La langue d’affichage et le thème peuvent être modifiés et vérifiés. Ouvrir l’action d’une notification choisie vérifie sa destination native et les droits du forfait avant de la marquer lue puis de naviguer ; supprimer une notification nécessite son aperçu signé confirmé, sans supprimer le contenu lié. Une facture d’abonnement précise peut être téléchargée en PDF ou ouverte sur sa page Stripe native, sans paiement implicite. Une commande de recharge existante peut être vérifiée par son identifiant réel : les crédits ne sont annoncés comptabilisés que si la réponse native et l’écriture relue concordent. Le solde UI, son journal et les commandes de prestations Boutique sont lus séparément, avec pagination ; donnée indisponible ≠ zéro, aucune commande ni réparation du solde.",
    "sourceFiles": [
      "lib/inrAssistantAccountServiceTools.ts",
      "lib/inrAssistantAccountDocuments.ts",
      "lib/inrAssistantReferralTools.ts",
      "app/api/referrals/route.ts",
      "app/api/notifications/mark-all-read/route.ts",
      "app/dashboard/settings/_components/RgpdContent.tsx",
      "app/api/notifications/[id]/read/route.ts",
      "app/api/notifications/feed/route.ts",
      "lib/cookieConsentPreferences.ts",
      "lib/inrAssistantNotificationNavigation.ts",
      "lib/inrAssistantNotificationNavigationTools.ts",
      "lib/inrAssistantApplicationPreferenceTools.ts",
      "lib/inrAssistantCreditOrderReconciliation.ts",
      "lib/notificationRemovalState.ts",
      "app/api/notifications/[id]/route.ts",
      "lib/inrAssistantBasicShopRead.ts",
      "lib/loyalty/inertia.ts",
      "app/dashboard/settings/_components/InertiaContent.tsx",
      "app/dashboard/settings/_components/BoutiqueContent.tsx"
    ]
  },
  {
    "id": "basic-channel-preferences",
    "title": "Basique : formats sociaux, Pinterest et Site Web",
    "keywords": [
      "préférences globales",
      "formats",
      "reels",
      "stories",
      "ghost",
      "tableau Pinterest",
      "réinitialiser site",
      "widget"
    ],
    "content": "Dans Accueil → Connecter mes canaux, ouvrir la bulle du canal. Les préférences globales Facebook/Instagram gèrent les formats Reel/Story et le format par défaut ; Threads gère son mode classique/éphémère lorsque le canal est autorisé. Elles sont distinctes des options d’une seule publication. iNr’Assistant les lit, applique les normaliseurs natifs et vérifie le résultat. Désactiver le format par défaut peut le rétablir en Classique ; cet effet natif est signalé. Les tableaux Pinterest peuvent être créés, renommés ou supprimés après aperçu exact confirmé ; supprimer un tableau chez Pinterest a un impact distant présenté avant validation. Le Site Web permet rattachements Analytics/Search Console, personnalisation du widget et génération/affichage/copie de son code. Le code et les jetons restent dans l’interface, jamais dans la conversation. Retirer le lien ou réinitialiser le canal demande un aperçu confirmé et déconnecte les produits Google concernés ; une opération partielle reste signalée. Le site externe n’est pas supprimé. L’installation du widget et les autorisations OAuth restent personnelles.",
    "sourceFiles": [
      "lib/inrAssistantSocialPublicationPreferencesTools.ts",
      "lib/inrAssistantPinterestBoardTools.ts",
      "lib/inrAssistantWebsiteLifecycleTools.ts",
      "lib/inrAssistantWebsiteTools.ts",
      "app/dashboard/_components/SiteActusWidgetCode.tsx",
      "lib/inrAssistantBasicTargetIntents.ts",
      "lib/facebookPublicationPreferences.ts",
      "lib/instagramPublicationPreferences.ts",
      "lib/threadsPublicationPreferences.ts",
      "app/api/integrations/facebook/publication-preferences/route.ts",
      "app/api/integrations/instagram/publication-preferences/route.ts",
      "app/api/integrations/threads/publication-preferences/route.ts",
      "app/api/integrations/pinterest/boards/route.ts",
      "app/api/integrations/pinterest/boards/[boardId]/route.ts",
      "app/api/integrations/google-stats/disconnect/route.ts"
    ]
  },
  {
    "id": "basic-dna-schedule",
    "title": "Basique : programmation mensuelle de l’analyse ADN",
    "keywords": [
      "analyse ADN",
      "mensuelle",
      "programmation ADN",
      "jour",
      "heure"
    ],
    "content": "Personnaliser → Analyse propose la programmation mensuelle native de l’analyse ADN. Elle est accessible en Basique, distincte des agents iNrAgent. iNr’Assistant peut lire la programmation puis modifier les seules valeurs explicitement demandées : activation, jour du mois de 1 à 28 et heure. Le fuseau de l’établissement est conservé et le serveur fournit la prochaine échéance. Le réglage est relu après sauvegarde ; il ne lance pas une analyse immédiate. Une publication programmée à partir de l’ADN ne constitue pas une demande de changer cette programmation.",
    "sourceFiles": [
      "lib/inrAssistantDnaScheduleTools.ts",
      "app/api/ai-memory/analysis-schedule/route.ts",
      "app/dashboard/settings/_components/BusinessDnaAnalysisScheduleModal.tsx",
      "lib/inrAssistantBasicTargetIntents.ts"
    ]
  },
  {
    "id": "basic-generator-estimates",
    "title": "Basique : hypothèses du potentiel commercial",
    "keywords": [
      "panier moyen",
      "taux de conversion",
      "taux de transformation",
      "estimations",
      "opportunités",
      "générateur"
    ],
    "content": "Depuis Accueil, le réglage des estimations du Générateur s’ouvre via /dashboard?helpAction=generator-settings. iNr’Assistant peut lire puis modifier le panier moyen et le taux de conversion explicitement fournis, avec validations natives, contrôle de version et relecture. Ces données sont des hypothèses de calcul du potentiel commercial. Elles ne prouvent ni ventes, ni chiffre d’affaires encaissé, ni garantie de clients. Les recommandations sectorielles affichées restent des suggestions à vérifier.",
    "sourceFiles": [
      "lib/inrAssistantGeneratorSettingsTools.ts",
      "lib/generatorSettings.ts",
      "app/dashboard/_components/GeneratorSettingsModal.tsx",
      "app/dashboard/DashboardClient.tsx"
    ]
  }
];
