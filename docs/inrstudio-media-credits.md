# iNrStudio : crédits média et choix de modèles

Le système de crédits médias a été activé en production le 13 octobre 2026, après autorisation du propriétaire. Les migrations Supabase, le catalogue Stripe et les variables Vercel sont appliqués. Cette mise à jour complémentaire ajoute trois moteurs image, le guide des moteurs et le menu durée dans le bandeau compact ; sa publication et sa vérification sont documentées dans le rapport final. Aucun paiement client Stripe n'a été effectué pour les essais.

## Portefeuille commun

Une seconde vidéo historique devient **10 crédits**. Une image historique devient **7 crédits**. Les deux droits se réunissent dans le même portefeuille, utilisable pour des images ou des vidéos.

Exemple : 56 secondes restantes et 25 images restantes donnent **735 crédits** : 560 + 175. La conversion porte sur les droits réellement enregistrés, y compris les recharges et réservations en cours ; elle ne remplace pas arbitrairement le solde par cet exemple.

Les forfaits par défaut fournissent **735 crédits/mois en Standard** (25 images + 56 secondes), 2 530 en Premium (70 + 204), et 1 790 en Founder (50 + 144). La correction Standard ajoute vingt crédits au droit mensuel par défaut sans réécrire les anciennes consommations. Une exception explicite de compte à 54 secondes reste à 715 crédits : elle demeure prioritaire. Les plafonds de report sont convertis avec les mêmes facteurs. Une ancienne désactivation explicite d'un type de média reste une désactivation.

| Abonnement | Ancienne allocation mensuelle par défaut | Crédits médias mensuels |
|---|---|---:|
| Standard | 25 images + 56 secondes | **735** |
| Premium | 70 images + 204 secondes | **2 530** |
| Fondateur | 50 images + 144 secondes | **1 790** |

Ces crédits forment un seul solde, réparti librement entre images et vidéos. Les allocations personnalisées et les soldes réellement consommés restent pris en compte.

Les commandes Stripe historiques gardent leur unité et leur montant d'origine. Le portefeuille convertit leur financement et conserve les remboursements, dettes, blocages et litiges. Les jobs déjà en cours peuvent terminer sans deuxième débit. Une réussite consomme ses crédits dès la création du résultat, même si le professionnel le refuse ensuite. Un échec technique libère la réservation ; une nouvelle tentative indépendante peut consommer à nouveau. Une réponse réseau répétée avec la même clé retrouve la génération existante.

## Images : cinq moteurs

| Moteur | Génération | Référence supplémentaire | Retouche | Limites |
|---|---:|---:|---|---|
| OpenAI Image | 7 crédits | 2 crédits | Oui | 5 références |
| Gemini Image | 7 crédits | 2 crédits | Oui | 5 références |
| FLUX.2 Pro | 5 crédits | 2 crédits | Oui | 5 références, chacune ≤ 1 MP ; sortie fournisseur ≤ 2 MP |
| Grok Imagine Image | 2 crédits | 1 crédit | Oui | 3 références maximum |
| Recraft V4.1 | 4 crédits | — | Non | Création raster uniquement, sans références |

Modifier consomme aussi son image source : OpenAI/Gemini 9 crédits, FLUX 7, Grok 3. Les incompatibilités sont refusées avant toute préparation payante. Le choix explicite du moteur est conservé sans remplacement silencieux. Le format fait partie du devis et de son empreinte ; la retouche conserve le canvas final de la source. Une réservation interne conservatrice protège le budget fournisseur lors d'un échec incertain après soumission, sans convertir cet échec technique en débit du professionnel.

Pour les trois nouveaux moteurs, le logo officiel est ajouté localement dans le coin supérieur droit, sans référence fournisseur cachée ni supplément surprise. Cette position standard est expliquée dans le guide ; intégrer le logo dans une surface en perspective n'est pas garanti par cette composition. FLUX et Grok sont testés avec plusieurs références ; Recraft n'est pas présenté comme un moteur de retouche ou de SVG dans ce parcours.

Ce sont des tarifs commerciaux en crédits. Ils ne signifient pas qu'un crédit se vend un centime. La grille fournisseur et la grille commerciale sont distinctes.

## Vidéos : trois familles, sept modèles actifs

| Famille | Modèle | Durées finales compatibles | Crédits/s à la qualité de base | Autre qualité |
|---|---|---|---:|---|
| Google | Gemini Omni | 4–20 s | 10 en 720p | — |
| Google | Veo 3.1 Fast | 4, 6, 8, 10, 12, 14, 16 s | 10 sans dialogue natif, 15 avec, en 720p | Mêmes tarifs en 1080p, durées 8/16 s |
| Google | Veo 3.1 Lite | 4, 6, 8, 10, 12, 14, 16 s | 3 sans dialogue natif, 5 avec, en 720p | 5 sans dialogue natif, 8 avec, en 1080p ; durées 8/16 s |
| Alibaba | Wan 2.6 Flash | 4–30 s | 5 en 720p | 7,5 en 1080p ; photo nécessaire |
| Alibaba | Wan 2.7 R2V | 4–20 s | 10 en 720p | 15 en 1080p ; photo nécessaire |
| Grok | Imagine Lite | 4–30 s | 3 en 720p | 14 en 1080p |
| Grok | Imagine 1.5 | 4–30 s | 14 en 720p | 25 en 1080p |

MiniMax H3, Wan 3.0 et HeyGen ne sont plus proposés pour les nouvelles créations. Leurs métadonnées canoniques, anciens jobs, résultats et montants historiques sont conservés ; leur présence dans une archive n'autorise pas une nouvelle soumission.

Le professionnel choisit le moteur et sa résolution dans le bandeau, puis une durée compatible. Dans Studio Libre, chaque durée apparaît une seule fois : le découpage est automatique, sans choix manuel de montage ni de transition. Par exemple, Omni 10 s utilise un clip natif, Omni 15 s deux clips, Veo 720p 12 s deux clips de 6 s et Veo 1080p 16 s deux clips de 8 s. Veo 1080p ne propose pas de durée entre 10 et 15 s. Un changement de moteur conserve la durée si elle reste réalisable, sinon sélectionne la durée compatible la plus proche et actualise le devis. Les incompatibilités de références ou de brief restent signalées. Le plafond du compte peut restreindre la plage globale **4–30 s**. Les réglages propres aux parcours guidés ne réintroduisent pas de choix de montage dans le formulaire Libre.

Chaque vidéo nécessite **au maximum deux clips fournisseurs**, avec priorité à un clip natif unique quand la durée le permet. Omni et Wan 2.7 sont limités à 20 secondes (clips jusqu'à 10 s), Veo à 16 (clips jusqu'à 8 s), Wan Flash et Grok à 30 (clips jusqu'à 15 s). Un assemblage doit permettre deux clips d'au moins quatre secondes. Les deux plans indépendants du Studio Libre peuvent être préparés en parallèle, avec une concurrence limitée à deux ; cela ne garantit ni une durée d'attente ni une continuité visuelle parfaite.

Le devis couvre les clips réellement prévus et arrondit le total à l'entier supérieur. L'assemblage ne permet pas de lancer un troisième clip pour obtenir une durée supérieure au plafond d'un moteur. Les vidéos historiques restent dans la médiathèque et leurs montants comptables restent intacts. Les nouveaux réglages mémorisés acceptent 4–30 s ; les anciennes préférences de 1–3 s sont ramenées à 4 lors de leur lecture.

Le bandeau compact réunit **crédits disponibles, menu moteur/résolution/tarif, durée, prix confirmé et bouton de génération**. Les boutons de scènes séparés sont retirés du bloc des paramètres Libre. Le bouton ⓘ près du moteur ouvre un guide accessible présentant les cinq moteurs image ou les sept moteurs vidéo actifs. Le menu contient treize combinaisons vidéo réelles, chacune sur une ligne distincte, regroupées par fournisseur. La recommandation figure dans une option et son motif reste accessible au survol, sans agrandir le bandeau. Le détail des crédits est fermé par défaut et s'ouvre depuis le prix. Le portefeuille demeure distinct, à gauche sur ordinateur ; un devis périmé, un changement d'établissement ou un solde insuffisant bloque le lancement.

Les suggestions se limitent aux moteurs actifs et compatibles : notamment Grok Lite 720p pour la voix off Libre sans photo, Wan Flash pour une photo à animer, ou un autre moteur selon les contraintes du brief, des références et des clips. Les vocaux fournis pour des personnages restent réservés à Wan 2.7, avec son parcours natif existant. Pour une image, une demande de texte précis ou de flyer suggère OpenAI ; les autres créations suggèrent Gemini, sans prétendre qu'il coûte moins cher (les deux ont la même base de sept crédits). Ces règles déterministes ne lancent aucun appel IA et ne remplacent pas un choix explicite de l'utilisateur. Une recommandation ne garantit ni vitesse, ni fidélité des références, ni qualité de parole.

Suppléments affichés dans le devis :

- Vidéo Libre sans photo : **7 crédits de préparation créative**, couvrant notamment le réalisateur IA et la préparation éventuelle du logo officiel.
- Vidéo avec références précomposées : **7 + 2 crédits par référence originale** pour préparer l'image de départ ; cela remplace le forfait Libre et ne se cumule pas avec lui. Le moteur vidéo reçoit une seule image composée.
- Grok : **1 crédit par image transmise et par clip fournisseur**, donc un par clip après précomposition.
- Voix off séparée du parcours Guidé : **2 crédits**. Les dialogues natifs font partie du tarif vidéo. En parcours Libre, la voix off TTS est préparée séparément pour tous les moteurs et reste absorbée dans le prix affiché.

Exemples sans photo : Omni 8 s Guidé sans voix off = 80 crédits ; Omni 8 s Libre = 87 ; Grok Lite 5 s Libre = 22 ; Veo Fast 8 s Guidé avec choix explicite Sans parole = 80 en 720p comme en 1080p. Avec trois photos précomposées, Grok Lite 5 s Libre = 29 (15 vidéo + 13 préparation + 1 référence moteur). Le devis signé, avec les options réellement choisies, fait autorité.

Tous les modèles sélectionnés annoncent de l'audio natif. iNrStudio conserve la voix off synthétique existante et les contrôles de parole. Les voix sont disponibles à partir de **4 secondes** pour que les phrases puissent tenir ; un dialogue trop long est refusé avant l'appel vidéo payant. Un dialogue natif rejeté par le contrôle ne devient pas une vidéo silencieuse facturée comme une réussite.

Les sources de parole sont exclusives : en voix off Libre, le texte et la piste TTS sont préparés et validés avant la génération vidéo ; le moteur reçoit une mise en scène silencieuse sans script de narration natif, puis son audio est entièrement retiré au montage. En mode personnages parlants, seule la parole native est conservée, sans TTS ajouté. La consigne visuelle interdit articulation et imitation de parole dans les autres modes, tout en conservant gestes, regards et sourires naturels. Ce cadrage réduit le risque de lèvres qui parlent ; les tests de code et le contrôle audio ne garantissent pas l'obéissance visuelle du moteur.

L'interface Libre propose un seul choix parmi **Voix off**, **Personnages** et **Sans parole**, avec une case musique indépendante. Le choix Voix off active directement la narration et ses réglages, sans second interrupteur. Sans parole ne lance aucune préparation de narration et retire entièrement l'audio natif, y compris des paroles imprévues ; seule la musique instrumentale cochée est ajoutée. Sans parole et sans musique produit donc une vidéo muette.

Si le planificateur invente une réplique trop longue, la tentative de secours déjà bornée reçoit le budget exact du plan et une demande de réécriture concise. Une citation fournie par le professionnel reste intacte : trop longue, elle est refusée avant tout appel vidéo plutôt que tronquée.

La qualité française, les références, la voix et la synchronisation doivent être évaluées sur chaque rendu ; une capacité annoncée ou un contrôle automatique ne vaut pas validation humaine. La voix off fournie utilise le service indépendant FAL/Chatterbox multilingue, distinct du moteur vidéo choisi. Le retrait du moteur vidéo MiniMax H3 ne retire pas ce service de narration et n'est pas un diagnostic de « TTS MiniMax ». Aucun de ces parcours ne garantit le timbre, le visage ou les mouvements des lèvres.

Le dialogue natif utilisant un vocal fourni reste réservé à **Wan 2.7**, avec photo, affectation et consentement explicites pour cette destination. Aucun parcours de vocal de personnage Wan 2.6 n’est activé. Le service FAL/Chatterbox existant pour la voix off fournie reste distinct et inchangé.

## Recharges et revenus

| Recharge commune | Nouveau prix, HT | Prix HT par crédit |
|---|---:|---:|
| 500 crédits | 19 € | 0,038 € |
| 1 000 crédits | 35 € | 0,035 € |
| 2 000 crédits | 65 € | 0,0325 € |
| 5 000 crédits | 155 € | 0,031 € |

Équivalence au tarif de base de l'ancien système, sans références, préparation ou voix off supplémentaire :

| Recharge | TTC à TVA de 20 % | Images à 7 crédits chacune, au maximum | Vidéo Omni à 10 crédits/seconde |
|---|---:|---:|---:|
| 500 crédits | 22,80 € | 71 | 50 s |
| 1 000 crédits | 42 € | 142 | 100 s |
| 2 000 crédits | 78 € | 285 | 200 s |
| 5 000 crédits | 186 € | 714 | 500 s |

Les équivalences images et vidéo sont alternatives ; le professionnel peut aussi les mélanger. Les autres moteurs ont leur propre consommation. Les références, la préparation et les options apparaissent dans le total avant lancement. Une recharge de 2 000 crédits porte un solde Standard non consommé de 735 à **2 735 crédits**.

Les quatre clés historiques `video_50`, `video_100`, `video_200`, `video_500` et leur conversion secondes ×10 sont conservées. Ces recharges achètent du pouvoir de génération commun. Les nouveaux prix maintiennent au moins 3,1 centimes HT par crédit pour couvrir les coûts fournisseurs, frais et tentatives échouées. Les prix des anciennes commandes restent figés ; les remboursements et litiges conservent leur calcul historique. Les trois anciens packs images ne sont plus proposés à l'achat ; leurs commandes et sessions déjà payées restent honorées.

Les droits inclus sont 735/2 530 crédits par mois pour Standard/Premium. La différence est **1 795 crédits**. Acheter au moins cette différence avec les nouveaux packs coûte 65 € HT (2 000 crédits), au-dessus de l'écart de 50 € HT entre les offres mensuelles actuelles : les recharges ne reproduisent pas à moindre prix les droits supplémentaires de Premium. Ce calcul ne constitue pas une promesse de marge nette ; le coût réel dépend du fournisseur, du change, des taxes et des tentatives.

La grille en crédits est versionnée dans `lib/aiMediaCreditsPricing.ts`. Les capacités, IDs et estimations de prix fournisseurs sont centralisés dans `lib/aiMediaModelCatalog.ts`. Les estimations fournisseurs servent au fusible de dépenses internes ; elles sont séparées du débit commercial des pros. Les coûts estimés sont en USD, les recharges en EUR HT. La marge réelle dépend du change, des options, des frais Stripe et des tentatives techniquement échouées. Les réserves actuelles distinguent notamment Veo Fast sans dialogue natif (0,10 USD/s) et avec dialogue natif (0,15 USD/s), aux deux résolutions actives. Ces taux du catalogue applicatif ne constituent pas une facture fournisseur.

## Activation de production exécutée

Les trois migrations `20261013100955_unified_media_credits`, `20261013113745_media_credit_recharge_pricing` et `20261013114612_standard_media_credits_735` ont été appliquées dans une transaction, puis vérifiées. Les six tables du portefeuille ont leur RLS active ; les accès client sont limités au compte autorisé et les mutations passent par les RPC serveur. Les anciennes commandes et générations restent intactes. Les portefeuilles sont initialisés à leur première lecture V4 : aucune réécriture massive arbitraire des comptes n'est nécessaire.

Les quatre nouveaux prix Stripe LIVE sont actifs, à paiement unique, en EUR HT, avec taxes ajoutées au checkout. Les anciens objets et les abonnements récurrents sont conservés. Les quatre variables de prix Vercel Production ont été enregistrées et vérifiées ; le déploiement a été reconstruit avec les variables de production et promu sur `app.inrcy.com`.

Le parcours réel a confirmé le devis, généré une vidéo de quatre secondes via Google Vertex, puis affiché le résultat dans iNrStudio. Le checkout de 500 crédits affiche 19 € HT + 3,80 € de TVA = 22,80 € TTC ; il a été fermé sans paiement. Les essais historiques des moteurs vidéo et des trois nouveaux moteurs image sont détaillés dans les rapports correspondants ; ils ne définissent pas le catalogue actif après les retraits.

| Variable serveur de production configurée | Crédits | Montant Stripe `unit_amount`, centimes EUR HT |
|---|---:|---:|
| `STRIPE_VIDEO_CREDITS_50_PRICE_ID` | 500 | 1 900 |
| `STRIPE_VIDEO_CREDITS_100_PRICE_ID` | 1 000 | 3 500 |
| `STRIPE_VIDEO_CREDITS_200_PRICE_ID` | 2 000 | 6 500 |
| `STRIPE_VIDEO_CREDITS_500_PRICE_ID` | 5 000 | 15 500 |

Les IDs ne sont pas inventés dans le code et ne sont pas fournis par le navigateur. Le serveur relit le prix Stripe et refuse toute monnaie, quantité, taxe ou récurrence incompatible. Les réponses de configuration restent génériques, et les logs du checkout utilisent uniquement des motifs fixes sans détails fournisseurs.

Le choix de moteur du Studio est mémorisé par établissement dans le navigateur. iNrAgent conserve son moteur automatique Omni et utilise le même portefeuille : ses durées restent dans la plage 4–20 s, avec au maximum deux clips. Une ancienne préférence automatique de 24 s devient 20 s ; les autres paramètres de réalisation et de voix sont conservés. Un plafond de compte incompatible bloque la génération avant tout appel fournisseur. Ce changement n'ajoute pas de nouveaux fournisseurs autonomes aux campagnes déjà configurées.

Une future modification du barème doit conserver la récupération des anciens jobs : le devis courant et le fingerprint empêchent les réductions de débit, mais une reprise après changement de version peut nécessiter la récupération du résultat enregistré. Les devis sont versionnés ; un changement de version exige un nouveau devis pour une nouvelle génération et ne supprime pas les résultats historiques.

## Sources techniques et historique

### Retraits des nouvelles créations — 9 novembre 2026

MiniMax H3 est retiré sur instruction de l'utilisateur après les mesures de latence de la campagne. Wan 3.0 et HeyGen sont également absents du catalogue actif. Ces retraits concernent toutes les nouvelles créations, sans suppression des résultats, du tarif enregistré ou des métadonnées nécessaires aux anciens jobs. Les liens fournisseur conservés ci-dessous documentent l'historique, pas une disponibilité actuelle.

Le cas MiniMax H3 C06 reste une génération vidéo historiquement réussie. Sa narration fournie utilise FAL/Chatterbox séparément : le retrait du moteur vidéo ne retire pas ce service de clonage et ne lui attribue pas le temps de génération vidéo.

### Historique : ajout HeyGen Video — 15 octobre 2026

À cette date d'ajout, le moteur `heygen/heygen-video-1` était proposé en 768p et 1080p via l'accès AI Gateway existant. Il acceptait 5 à 15 secondes par clip ; le Studio pouvait assembler deux clips jusqu'à 30 secondes dans la limite du compte. Les modes alors activés étaient texte-vers-vidéo et image-de-départ-vers-vidéo, avec une seule image transmise (les références du parcours essentiel étaient précomposées). Le mode fournisseur `reference_to_video`, qui a un autre tarif, n'était pas activé pour cet ajout. Cette description historique ne réactive pas HeyGen.

Le barème commercial est fixe : 4 crédits/s en 768p, 10 crédits/s en 1080p et 4 crédits par image effectivement transmise, auxquels s'ajoutent les postes de préparation existants. Les autres moteurs conservent leurs prix et leurs choix par défaut. La version de devis reste inchangée : aucun tarif préexistant n'est modifié et le devis signé lie déjà le moteur et la résolution.

Le catalogue public consulté affiche 0,018 USD/s en 768p et 0,05 USD/s en 1080p pour ces deux modes. La fiche Vercel annonce une remise de 50 % jusqu'au 31 octobre 2026, tandis que l'API d'endpoints indique `discount: 0` : le tarif futur n'est donc pas garanti. Les réserves internes utilisent les bornes prudentes hors promotion déduites de cette remise (0,036 / 0,10 USD/s). L'endpoint déclare aussi 0,02 USD par image en entrée malgré une description indiquant l'absence de supplément : la réserve utilise 0,04 USD/image par prudence. Ces montants restent des estimations internes, jamais une preuve du montant réellement facturé par Vercel.

Le transport envoie explicitement le mode, le niveau de résolution et la désactivation de la réécriture automatique du prompt. En 1080p texte-vers-vidéo, le fournisseur accepte le paysage ou le vertical ; les formats carré et portrait sont recadrés au centre par le montage existant, avec une consigne de cadrage protectrice. Avec une image de départ, son ratio est suivi. Le panneau « i » précise les usages, les durées, cette adaptation de cadrage et le fait que la qualité des dialogues en français reste à vérifier. Aucun nouvel essai de génération payant n'a été effectué pour cet ajout.

Sources : [fiche Vercel](https://vercel.com/ai-gateway/models/heygen-video-1), [contrat HeyGen](https://developers.heygen.com/docs/models/heygen-video), [options du fournisseur AI SDK](https://ai-sdk.dev/providers/ai-sdk-providers/heygen), [endpoint public](https://ai-gateway.vercel.sh/v1/models/heygen/heygen-video-1/endpoints).

- [Catalogue public AI Gateway](https://ai-gateway.vercel.sh/v1/models)
- [Génération vidéo avec AI Gateway](https://vercel.com/docs/ai-gateway/modalities/video-generation)
- [Tarification Google Gemini API](https://ai.google.dev/gemini-api/docs/pricing)
- [Capacités et contraintes Veo](https://ai.google.dev/gemini-api/docs/veo)
- [Documentation MiniMax H3](https://huggingface.co/MiniMaxAI/MiniMax-H3)

La sélection et les prix ont été vérifiés le 13 octobre 2026. Les prix d'achat privés ou négociés de Magnific ne sont pas connus.

## Vérifications

Les suites médias, crédits, recharges et iNrAgent couvrent le recalcul des devis, les erreurs et reprises, les nouveaux transports vidéo, les plafonds de durée et les commandes Stripe simulées. Les tests SQL exécutent réellement les migrations sur PGlite avec des comptes synthétiques : conversion, débit/libération, report, désactivation de médias, durées mémorisées, remboursements, dettes et litiges. PGlite sérialise les requêtes ; ces essais ne constituent pas un test de charge multiprocessus de PostgreSQL.

TypeScript et le lint des fichiers modifiés passent. La compilation Next.js complète passe, avec 8 Go de mémoire JavaScript dans cet environnement local ; le premier essai au plafond mémoire par défaut a échoué par manque de mémoire.

Les vrais composants Libre, Guidé, Modifier et Boutique ont été vérifiés dans Chrome avec des réponses API simulées : moteur/durée/résolution, devis périmé, changement d'établissement, justificatif tarifaire, portefeuille indisponible, voix courtes et affichage mobile. Les captures montrent des soldes fictifs. Ces captures de composants utilisent des réponses simulées ; elles complètent les générations et contrôles de production réels réalisés ensuite.

Les libellés ajoutés sont traduits dans les neuf langues de l'application. Les validations de catalogues et les contrôles de rendu passent.

Le bandeau du mode Guidé a été mesuré à 83 px sur ordinateur (1536, 1920 et 2560 px), y compris en mode illimité et portefeuille indisponible ; il mesure 167 px sur mobile de 390 px. Le bouton reste sur une ligne et le solde dispose d'un seul sous-texte. Le bloc 3 présente ses six réglages sur trois colonnes et deux rangées sur ordinateur, sans durée ni sélecteur de scènes séparé, et sans défilement interne. Les états de moteur incompatible ont également été vérifiés. Les captures utilisent les vrais composants avec des API et soldes simulés.

## Piste distincte : brouillon vidéo économique

Wan 2.2 Fast 5B sur fal affiche 0,025 USD par vidéo 720p jusqu'à cinq secondes ; deux clips suggèrent un coût vidéo d'environ 0,05 USD pour dix secondes. Cela reste une piste de brouillon visuel à 1 crédit/s, non un moteur final garantissant le même rendu et sans voix native promise. L'accès `FAL_KEY` est présent localement, sans authentification ou génération fal testée pour cette livraison. Ce mode nécessite un parcours évitant le supplément de préparation vidéo actuel ; il n'est pas annoncé comme déjà activé.

Sources complémentaires : [FLUX via Gateway](https://vercel.com/ai-gateway/models/flux-2-pro), [prix Black Forest Labs](https://docs.bfl.ai/quick_start/pricing), [Grok Imagine Image](https://docs.x.ai/developers/models/grok-imagine-image), [prix Recraft](https://www.recraft.ai/docs/api-reference/pricing), [Wan Fast fal](https://fal.ai/models/fal-ai/wan/v2.2-5b/text-to-video/fast-wan).
