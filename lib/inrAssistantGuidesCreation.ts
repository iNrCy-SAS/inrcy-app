export type InrAssistantCreationGuide = {
  id: string;
  title: string;
  keywords: string[];
  content: string;
  sourceFiles: string[];
};

/** Current UI instructions, resolved against the French labels and access gates. */
export const INR_ASSISTANT_CREATION_GUIDES: readonly InrAssistantCreationGuide[] = [
  {
    id: "booster",
    title: "Booster : créer, publier ou programmer un contenu",
    keywords: ["booster", "publier", "publication", "programmer", "réseaux", "contenus", "brouillon", "tiktok", "musique", "stories", "reel"],
    content: `Ouvrir [Publier](/dashboard?action=publish), depuis le bouton Publier du bloc Booster ou du menu. Le parcours actuel est Préparation → Idée → Contenus → Médias → Validation → Bilan. En mode Manuel, l’étape Idée est retirée. Ne pas indiquer un ancien onglet « Configurer ».
1. Préparation : sélectionner les canaux connectés, puis Automatique ou Manuel ; Continuer. Un canal indisponible doit être connecté/reconnecté dans le cockpit, pas forcé dans la publication.
2. Automatique : dans Idée, décrire le sujet, fournir si utile des médias/documents et utiliser « ✨ Générer avec iNrCy ». Manuel : rédiger directement dans Contenus. Vérifier et ajuster le contenu propre à chaque canal.
3. Médias : ajouter depuis l’appareil ou la Médiathèque, générer dans iNrStudio, adapter au canal. « Modifier » ouvre la modification IA avec l’image choisie ; « Retoucher » ouvre l’édition manuelle. Plusieurs images donnent des Stories vidéo successives et un seul Reel assemblé. Une reprise conserve la musique et les Stories confirmées. Vérifier l’aperçu final par canal.
4. Validation : vérifier alertes et aperçus. Les cartes permettent de changer le format Facebook/Instagram et la case Story, le tableau Pinterest et le mode Threads ; ces choix restent synchronisés avec Contenus. « Musique » reste visible sur Facebook/Instagram, grisée en Classique avec « Réservé aux Stories et Reels ». Pour les Stories/Reels créés depuis les images, choisir Auto ou un des 24 sons avec préécoute dans la modale : une seule piste par canal. Les photos Google Business/Threads et le son des vidéos importées sont conservés. TikTok garde son option native pour les photos. « Publier » ouvre « Confirmer la publication ? », puis confirmer avec « Publier ». « 🕒 Programmer » ouvre la date/heure ; confirmer. Ne pas annoncer une publication avant le retour effectif. TikTok peut demander une validation supplémentaire ; YouTube exige une vidéo.
5. Bilan : consulter le résultat par canal ; un succès partiel ne signifie pas que tous les canaux ont publié. Le menu Brouillons du header rouvre les brouillons ; l’icône d’enregistrement a pour libellé « Enregistrer le brouillon publication ».
Accès : Standard (essai inclus) et Premium ; les canaux utilisables dépendent des connexions, autorisations et règles du canal. La génération de médias conserve ses crédits iNrStudio.`,
    sourceFiles: [
      "app/dashboard/_components/dashboardMobileMenuModel.ts",
      "app/dashboard/booster/publier/PublishModal.tsx",
      "app/dashboard/booster/publier/components/publishWizard.ts",
      "app/dashboard/booster/publier/components/PublishCreationModePanel.tsx",
      "app/dashboard/booster/publier/components/PublishFinalReviewModal.tsx",
      "app/dashboard/booster/publier/components/PublishFooterActions.tsx",
      "app/dashboard/booster/publier/components/PublishMediaPoolPanel.tsx",
      "app/dashboard/booster/publier/components/PublishValidationChannelOptions.tsx",
      "messages/fr-FR/booster.json",
      "lib/dashboardEdition.ts",
    ],
  },
  {
    id: "studio-create",
    title: "iNrStudio : générer une image ou une vidéo",
    keywords: ["studio", "inrstudio", "générer", "generation", "image", "vidéo", "prompt", "création", "paroles", "crédits"],
    content: `Ouvrir [iNrStudio](/dashboard/generer-media), puis l’onglet Générer. Le menu supérieur devient un menu déroulant sur mobile. Choisir Image ou Vidéo.
Les sous-onglets de génération sont Prompt et Critères. Dans Prompt, remplir « Votre demande » avec la scène, l’ambiance et les textes exacts souhaités. « Utiliser mon ADN » ajoute les informations professionnelles pertinentes ; logo/couleurs sont repris par défaut, coordonnées seulement sur demande. La demande reste prioritaire ; décocher pour une création indépendante de l’ADN.
Dans Critères, choisir le Format et, pour la vidéo, la Durée et les options disponibles. Les « Médias d’inspiration » viennent d’Importer ou Médiathèque : préciser le type et l’utilisation de chaque référence. Les compatibilités, le nombre de références et les durées dépendent du moteur affiché. Ne pas promettre qu’un moteur accepte toutes les références.
Pour les paroles vidéo : choisir Voix off ou Personnages dans Critères, puis « Ajouter paroles » et remplir « Paroles à prononcer ». « Sans parole » désactive cette saisie. Respecter l’autorisation proposée pour l’animation des personnes et la transmission des références.
Vérifier le coût et le solde, puis « Générer une image » ou « Générer une vidéo ». Le rendu peut rester temporaire : cliquer « Enregistrer dans la Médiathèque » pour le conserver, ou « Utiliser ce média » si Studio a été ouvert depuis un autre outil. « Réajuster » permet de reprendre la demande ; une nouvelle génération peut consommer de nouveaux crédits. « Récupérer le résultat » reprend une tentative récupérable, sans promettre un résultat terminé.
Accès : Standard et Premium, avec les quotas/crédits et moteurs disponibles du compte. Un lancement depuis Booster/une campagne peut verrouiller le type ou le format et réinsérer le résultat dans l’outil d’origine.`,
    sourceFiles: [
      "app/dashboard/generer-media/page.tsx",
      "app/dashboard/generer-media/MediaGeneratorStudioClient.tsx",
      "app/dashboard/_components/MediaGeneratorModal.tsx",
      "app/dashboard/_components/MediaFreeGenerator.tsx",
      "app/dashboard/_components/MediaGenerationCreationWorkspace.tsx",
      "lib/inrStudioModalPolicy.ts",
      "messages/fr-FR/media.json",
      "lib/dashboardEdition.ts",
    ],
  },
  {
    id: "studio-edit",
    title: "iNrStudio : modifier une image ou retoucher un média",
    keywords: ["studio", "modifier", "retoucher", "retouche", "fond", "recadrer", "cadrage", "image", "vidéo", "format"],
    content: `Ouvrir [iNrStudio](/dashboard/generer-media). Trois onglets distincts : Générer, Modifier, Retoucher. Sur mobile, les choisir dans le menu déroulant du haut.
MODIFIER : modification d’image par IA ; la Vidéo est désactivée dans cet onglet. Ajouter l’« Image à modifier » par « Choisir sur mon appareil » ou « Choisir dans ma médiathèque ». Remplir « Consigne de modification » en précisant ce qui change et ce qui doit être conservé. Vérifier le moteur/coût/solde, puis « Modifier le média ». Le maintien parfait de tous les détails n’est pas garanti. Reprendre avec « Modifier la consigne », ou conserver via « Enregistrer dans la Médiathèque » / « Utiliser ce média » selon l’origine.
RETOUCHER une Image : ajouter l’image, ouvrir l’atelier de retouche et utiliser les outils disponibles (cadrage, fond, texte/lien selon l’éditeur). Enregistrer avec « Enregistrer dans la Médiathèque » ou « Utiliser ce média ». Ce parcours d’édition manuelle est distinct de la modification IA.
RETOUCHER une Vidéo : choisir Vidéo dans le header puis une source via « Choisir sur mon appareil » ou « Choisir dans ma médiathèque ». Les outils actuels adaptent le format et le cadrage ; ils ne constituent pas un montage vidéo général. « Remplacer la vidéo » change la source. Confirmer avec « Enregistrer dans la Médiathèque » ou « Utiliser ce média ».
Lors d’un lancement depuis un autre outil, les onglets nécessitant une source sont indisponibles tant qu’aucune source n’a été transmise ; le type peut être fixé par cet outil. Le retour conserve le contexte d’origine.
Accès : Standard et Premium. Les modifications IA conservent leurs vérifications de crédits ; ne pas confondre retouche manuelle et nouvelle génération payante.`,
    sourceFiles: [
      "app/dashboard/_components/MediaGeneratorModal.tsx",
      "app/dashboard/_components/MediaModifier.tsx",
      "app/dashboard/_components/MediaRetoucher.tsx",
      "app/dashboard/_components/MediaVideoRetoucher.tsx",
      "app/dashboard/_components/MediaGenerationCreationWorkspace.tsx",
      "lib/inrStudioModalPolicy.ts",
      "messages/fr-FR/media.json",
    ],
  },
  {
    id: "media-library",
    title: "Mes médias : importer, retrouver et gérer ses fichiers",
    keywords: ["médiathèque", "mediatheque", "mes médias", "fichier", "importer", "titre", "tag", "télécharger", "supprimer", "sélection", "zip"],
    content: `Ouvrir [Mes médias](/dashboard/mediatheque) depuis Médiathèque dans le menu ou le raccourci de Studio. La liste des fichiers est l’élément principal ; images, vidéos et audios y sont gérés.
Importer : cliquer Importer (icône + sur mobile), puis « Choisir sur mon appareil ». Plusieurs fichiers peuvent être sélectionnés ; le nom de chaque fichier est conservé individuellement. Seuls les « Tags communs (facultatif) » sont appliqués à tout le lot. Aucun titre commun n’est demandé. Valider l’import ; attendre les résultats effectifs et les éventuelles erreurs par fichier.
Retrouver : recherche par titre, tag ou fichier ; filtres Type et Statut. Sur mobile, la recherche, l’icône Filtres et l’icône de sélection sont sur la même ligne ; Filtres déplie les critères secondaires.
Chaque ligne : case de sélection, miniature/aperçu, titre éditable avec son crayon, flèche « Afficher les détails », téléchargement puis suppression en dernier. Les détails contiennent tags éditables avec crayon, type, poids, format/durée et date. Cliquer sur la miniature pour agrandir/lire le média. Si « Optimiser » est proposé, il prépare une copie compatible ; vérifier le résultat.
Cocher plusieurs fichiers ou « Tout sélectionner » / « Tout désélectionner » agit sur les éléments visibles de la liste courante. « Télécharger la sélection » prépare une archive ZIP. « Supprimer la sélection » permet la suppression en masse ; les suppressions demandent confirmation et peuvent avertir qu’un média est utilisé ailleurs. Ne pas confondre suppression d’un fichier et dépublication sur un réseau.
Les crayons enregistrent les titres/tags de chaque média ; les actions de masse restent indisponibles pendant certaines éditions/opérations. Sur mobile, les détails sont repliés pour garder une ligne compacte.
Accès : Standard (essai inclus) et Premium ; fichiers privés du compte/établissement actif. Importer ou télécharger ne déclenche pas une génération IA.`,
    sourceFiles: [
      "app/dashboard/mediatheque/page.tsx",
      "app/dashboard/mediatheque/MediaLibraryClient.tsx",
      "app/dashboard/mediatheque/MediaMetadataField.tsx",
      "messages/fr-FR/media.json",
      "lib/dashboardEdition.ts",
    ],
  },
  {
    id: "ads",
    title: "iNr’ADS : préparer et valider une campagne publicitaire",
    keywords: ["ads", "publicité", "campagne", "budget", "google ads", "meta", "linkedin", "pinterest", "chatgpt", "tiktok ads", "enchères"],
    content: `Ouvrir [iNr’ADS](/dashboard/ads). Accès ordinaire Premium ; Standard/essai est renvoyé vers Abonnement. Les canaux publics actuels sont Meta, Google, LinkedIn, Pinterest et OpenAI/ChatGPT. TikTok et X sont réservés au pilote ; ne pas les proposer comme accès général.
Choisir le canal et utiliser ses réglages de connexion/compte publicitaire. « Lancer une campagne » ouvre le studio : « Créer manuellement » puis « Commencer → », ou « Créer avec iNrCy » puis « Préparer l’analyse → » et « Lancer l’analyse iNrCy ».
En mode assisté, « Mode d’analyse » propose « Analyse libre iNrADN » (iNrCy choisit le cap) ou « Analyse par objectif précis » ; ce dernier demande « Résultat recherché » avant l’analyse.
Les étapes varient avec la plateforme et le format. Google : Votre projet → (Analyse iNrCy en mode assisté) → Campagne → Enchères → Zones géographiques → Paramètres → Mots-clés → Annonce → Destination et suivi → Budget et calendrier → Vérifier et lancer. Google Search n’a pas d’étape média dédiée. LinkedIn a Audience, Format, Annonce, Média, Diffusion et suivi. Meta/Pinterest/ChatGPT ont leurs propres étapes : suivre les noms et avertissements affichés, pas un parcours générique inventé.
Compléter objectif, zone/audience, création, destination/suivi, budget/calendrier et les ressources du compte demandées. Ajouter un média par « Générer » ou « Médiathèque » lorsque le format en exige un. « Enregistrer en brouillon » conserve la préparation ; ce n’est pas un lancement.
La dernière action dépend de la connexion, du canal, du format et de l’activation effective de la publication : « Lancer la campagne », « VALIDER », « VALIDER LE BROUILLON », ou création native en pause. Il faut revoir et autoriser le budget/diffusion, puis attendre la confirmation réelle. Ne pas promettre une diffusion si le résultat est un brouillon ou une campagne en pause.
Le raccourci « Voir les campagnes dans iNr’Send » ouvre [Campagnes ADS](/dashboard/mails?folder=campagnes-ads). Les restrictions live, comptes/pixels/identités et activations serveur ne sont pas déductibles du forfait seul : se fier au contrôle courant, sans demander de jeton ou secret au professionnel.`,
    sourceFiles: [
      "app/dashboard/ads/page.tsx",
      "app/dashboard/ads/AdsClient.tsx",
      "app/dashboard/ads/AdsCampaignAnalysisChoice.tsx",
      "app/dashboard/ads/AdsCampaignDemoDialog.tsx",
      "lib/adsAccessPolicy.ts",
      "lib/adsDraftNavigation.ts",
      "lib/adsPublishMode.ts",
      "lib/dashboardEdition.ts",
    ],
  },
  {
    id: "ads-platforms",
    title: "iNr’ADS : étapes propres à chaque plateforme",
    keywords: ["ads", "google", "meta", "facebook", "instagram", "linkedin", "pinterest", "chatgpt", "openai", "étapes", "ciblage", "format"],
    content: `Ces parcours concernent iNr’ADS Premium et ses canaux publics. Choisir le canal avant « Lancer une campagne ». L’analyse assistée insère « Analyse iNrCy » après « Votre projet » ; le mode manuel ne l’affiche pas.
[Google Ads](/dashboard/ads?channel=google) : Votre projet → Campagne → Enchères → Zones géographiques → Paramètres → Mots-clés → Annonce → Destination et suivi → Budget et calendrier → Vérifier et lancer. Une campagne Google Search n’a pas d’étape média ; les formats nécessitant un visuel ajoutent Médias.
[LinkedIn Ads](/dashboard/ads?channel=linkedin) : Votre projet → Campagne → Zones géographiques → Audience → Format → Annonce → Média → Diffusion et suivi → Budget et calendrier → Vérifier et lancer. Choisir les zones exactes proposées et les ressources/identité du compte ; ne pas inventer les autorisations de diffusion.
[Meta Ads](/dashboard/ads?channel=meta) : Votre projet → Campagne → Zones géographiques → Audience → Enchères → Annonce → Média → Destination et suivi → Budget et calendrier → Vérifier et lancer. Les identités/placements Facebook et Instagram sont vérifiés ; un placement Instagram peut exiger son identité Instagram.
[Pinterest Ads](/dashboard/ads?channel=pinterest) : Votre projet → Campagne → Budget et calendrier → Zones géographiques → Audience → Enchères → Format du Pin → (Découverte Pinterest si ciblage manuel) → Épingle → Média → Destination et suivi → Vérifier et lancer. Le ciblage automatique retire l’étape Découverte Pinterest.
[ChatGPT Ads](/dashboard/ads?channel=openai) : Votre projet → Campagne → Budget et calendrier → Zones géographiques → Audience et contexte → Enchères → Carte ChatGPT → Média → Destination et suivi → Vérifier et lancer.
Les boutons de validation restent soumis à la disponibilité réelle des connecteurs, formats et modes de publication. Relire les blocages affichés : sauvegarder, valider un brouillon, créer en pause et lancer une diffusion payante sont des résultats distincts. Un budget et une destination doivent être revus par le professionnel avant lancement. TikTok/X ne sont pas des canaux publics ordinaires.`,
    sourceFiles: [
      "app/dashboard/ads/AdsClient.tsx",
      "app/dashboard/ads/page.tsx",
      "app/dashboard/ads/AdsCampaignAnalysisChoice.tsx",
      "lib/adsDraftNavigation.ts",
      "lib/adsAccessPolicy.ts",
      "lib/adsMetaPlacement.ts",
    ],
  },
  {
    id: "emailing",
    title: "Campagnes mails : Propulser, Fidéliser et finalisation dans iNr’Send",
    keywords: ["emailing", "mail", "campagne", "propulser", "fidéliser", "valoriser", "récolter", "offrir", "informer", "suivre", "enquêter", "newsletter", "destinataires"],
    content: `Depuis le menu « Campagnes mails » (/dashboard?action=campaigns), choisir le parcours ; accès Premium, pas Standard/essai.
[Propulser](/dashboard/propulser) : Valoriser, Récolter ou Offrir, bouton « Lancer ». Accès directs : /dashboard/propulser?action=valorize ; /dashboard/propulser?action=reviews ; /dashboard/propulser?action=promo.
[Fidéliser](/dashboard/fideliser) : Informer, Suivre ou Enquêter, bouton « Envoyer » de la carte (il ouvre d’abord le modèle). Accès directs : /dashboard/fideliser?action=inform ; /dashboard/fideliser?action=thanks ; /dashboard/fideliser?action=satisfaction.
Dans l’action, choisir un modèle dans « Choisir un modèle », modifier Objet et Message, ou utiliser « ✨ Générer avec iNrCy ». Vérifier le texte généré, les informations de l’entreprise et les zones encore à compléter. Joindre les pièces utiles via le sélecteur de pièces jointes. Le header propose Brouillons et l’icône « Enregistrer le brouillon » ; sauvegarder permet de reprendre plus tard.
« Suivant » transmet la préparation à iNr’Send, sans envoyer immédiatement le mail. Choisir une boîte d’envoi connectée, renseigner/vérifier les destinataires, objet, message et pièces jointes. Selon l’action, des contacts ou destinataires peuvent être préparés : contrôler la liste finale et éviter les doublons.
Dans cette finalisation, « Envoyer » effectue l’envoi réel ; « Programmer » ouvre une date/heure et programme l’envoi avec iNr’Agent. Demander la validation du professionnel avant envoi ou programmation, puis annoncer seulement le résultat confirmé. Un brouillon ou une mise en file d’envoi ne prouve pas que tous les mails ont été livrés.
Historique : [Propulsions dans iNr’Send](/dashboard/mails?folder=propulsions) et [Fidélisations dans iNr’Send](/dashboard/mails?folder=fidelisations). Les finalisations Informer/Suivre/Enquêter utilisent respectivement les dossiers informations/suivis/enquetes. Le header permet de passer de Propulser à Fidéliser et inversement.
Pour les campagnes récurrentes, ouvrir [Agent Emailings](/dashboard/agent/campagnes-mails), modes Prospection / Fidélisation. Préparer un modèle manuellement et activer une automatisation sont deux opérations différentes.`,
    sourceFiles: [
      "app/dashboard/_components/DashboardModulesCard.tsx",
      "app/dashboard/propulser/page.tsx",
      "app/dashboard/propulser/components/valoriser/ValoriserModal.tsx",
      "app/dashboard/propulser/components/recolter/RecolterModal.tsx",
      "app/dashboard/propulser/components/offrir/OffrirModal.tsx",
      "app/dashboard/fideliser/page.tsx",
      "app/dashboard/fideliser/components/informer/InformerModal.tsx",
      "app/dashboard/fideliser/components/suivre/SuivreModal.tsx",
      "app/dashboard/fideliser/components/enqueter/EnqueterModal.tsx",
      "app/dashboard/mails/_components/MailboxComposeModal.tsx",
      "messages/fr-FR/growth.json",
      "messages/fr-FR/mails.json",
      "lib/dashboardEdition.ts",
    ],
  },
  {
    id: "agents",
    title: "Agents IA : Publications, Emailings et Stats",
    keywords: ["agent", "agents", "automatisation", "automatique", "planning", "réglages", "idées", "publications", "emailings", "stats", "bilan", "premium", "standard"],
    content: `Les agents spécialisés ont des espaces actuels distincts, accessibles par « Agent IA »/« Piloter » depuis l’outil concerné : [Agent Publications](/dashboard/agent/publications), [Agent Emailings](/dashboard/agent/campagnes-mails), [Agent Stats](/dashboard/agent/stats). Le robot assistant de discussion est distinct de ces automatisations. Le décompte commercial Standard 3 / Premium 4 inclut l’Assistant ; il ne faut pas inventer un troisième espace d’automatisation Standard.
Standard/essai : automatisations Publications et Stats. Premium : ajoute Emailings, avec deux modes « Prospection » et « Fidélisation ». Standard ne peut pas préparer une campagne mails automatisée ; les rubriques mails de Stats sont aussi restreintes.
Header Agent Publications : « Idées », « Générer », « Planning », « Réglages », interrupteur « Automatisation activée »/« Automatisation en pause ». Idées sert à préparer les sujets ; Générer prépare une publication, ce n’est pas une confirmation de publication immédiate.
Dans Réglages Publications, les sous-onglets sont « Planning », « Canaux », « Création », « Références ». Planning règle fréquence, jours/heures et contenus préparés à l’avance (7 jours, 15 jours — recommandé, 1 mois). Canaux choisit les connexions utilisables. Création règle les sources/types de médias ; Références ajoute les personnes/décors/produits et les autorisations nécessaires. Terminer par « Enregistrer les réglages ». L’application peut demander quand appliquer le changement au planning existant.
Emailings : choisir Prospection ou Fidélisation, « Préparer », « Planning », « Réglages ». Une boîte mail connectée et des destinataires sont requis avant envoi. Stats : « Envoyer un bilan », « Planning », « Réglages » ; cette action peut envoyer un PDF au professionnel, ce n’est pas seulement un aperçu.
Relire les actions préparées et leurs statuts. « Valider » et « Refuser » ont des effets réels sur l’action. La publication automatique sans validation est un réglage explicite avec confirmation ; ne pas la présumer activée. Les générations ponctuelles restent soumises aux crédits/quotas affichés.`,
    sourceFiles: [
      "lib/inrAgentWorkspaces.ts",
      "lib/standardAgentPolicy.ts",
      "lib/dashboardEdition.ts",
      "app/dashboard/agent/AgentClient.tsx",
      "app/dashboard/agent/_components/AgentWorkspaceHeader.tsx",
      "app/dashboard/agent/_components/AgentCampaignAccess.tsx",
      "messages/fr-FR/agent.json",
    ],
  },
];
