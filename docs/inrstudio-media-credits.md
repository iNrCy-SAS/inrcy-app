# iNrStudio : crédits média et choix de modèles

Changement préparé localement le 13 octobre 2026. Aucun déploiement, migration distante, achat ou appel de génération payant n'a été effectué pendant l'implémentation.

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

## Images

OpenAI Image et Gemini Image sont proposés pour Générer et Modifier. Le prix de base est **7 crédits**, plus **2 crédits par image d'entrée**. Modifier, avec son image source, coûte donc **9 crédits**. Une création avec cinq références coûte 17 crédits. Le choix explicite d'un moteur image n'est pas remplacé silencieusement par un autre moteur.

Ce sont des tarifs commerciaux en crédits. Ils ne signifient pas que le fournisseur facture exactement sept centimes ni qu'un crédit se vend un centime.

## Vidéos : quatre familles, huit modèles

| Famille | Modèle | Durées finales compatibles | Crédits/s à la qualité de base | Autre qualité |
|---|---|---|---:|---|
| Google | Gemini Omni | 4–20 s | 10 en 720p | — |
| Google | Veo 3.1 Fast | 4, 6, 8, 10, 12, 14, 16 s | 10 en 720p | 12 en 1080p, durées 8/16 s |
| Google | Veo 3.1 Lite | 4, 6, 8, 10, 12, 14, 16 s | 5 en 720p | 8 en 1080p, durées 8/16 s |
| MiniMax | MiniMax H3 | 4–30 s | 8 en 768p | — |
| Alibaba | Wan 2.6 Flash | 4–30 s | 5 en 720p | 7,5 en 1080p ; photo nécessaire |
| Alibaba | Wan 3.0 | 4–30 s | 10 en 720p | 20 en 1080p |
| Grok | Imagine Lite | 4–30 s | 3 en 720p | 14 en 1080p |
| Grok | Imagine 1.5 | 4–30 s | 14 en 720p | 25 en 1080p |

Le professionnel choisit d'abord une durée finale entre **4 et 30 secondes**, puis un moteur compatible. Changer le moteur ou la qualité ne raccourcit pas la durée : les options incompatibles sont grisées, et la génération attend une combinaison valide et un devis confirmé. Le plafond de l'établissement peut restreindre cette plage.

Chaque vidéo comporte **au maximum deux scènes** et nécessite au maximum deux clips fournisseurs. Omni est limité à 20 secondes (deux clips jusqu'à 10 s), Veo à 16 (deux clips jusqu'à 8 s), et MiniMax H3, Wan Flash et Grok à 30 (deux clips jusqu'à 15 s). Wan 3 peut produire 30 secondes nativement. Une réalisation avec deux scènes doit aussi permettre deux clips d'au moins quatre secondes ; un moteur ou une durée incompatible reste indisponible.

Le devis couvre les clips réellement prévus et arrondit le total à l'entier supérieur. L'assemblage ne permet pas de lancer un troisième clip pour obtenir une durée supérieure au plafond d'un moteur. Les vidéos historiques restent dans la médiathèque et leurs montants comptables restent intacts. Les nouveaux réglages mémorisés acceptent 4–30 s ; les anciennes préférences de 1–3 s sont ramenées à 4 lors de leur lecture.

Le bandeau compact réunit **un seul menu moteur/résolution/tarif, le prix confirmé et le bouton de génération sur la même ligne**. Le menu contient quatorze combinaisons réelles, chacune sur une ligne distincte, regroupées par fournisseur. La recommandation figure dans une option et son motif reste accessible au survol, sans agrandir le bandeau. Le détail des crédits est fermé par défaut et s'ouvre depuis le prix. Le portefeuille demeure distinct, à gauche sur ordinateur ; un devis périmé, un changement d'établissement ou un solde insuffisant bloque le lancement.

Une suggestion de modèle explique son motif à partir du brief et des options : MiniMax H3 pour la parole française, Wan 3 pour une scène continue de 16–30 secondes native, Wan Flash pour une photo compatible à animer, ou le tarif fournisseur public le plus faible parmi les modèles compatibles. Pour une image, une demande de texte précis ou de flyer suggère OpenAI ; les autres créations suggèrent Gemini, sans prétendre qu'il coûte moins cher (les deux ont la même base de sept crédits). Ces règles déterministes ne lancent aucun appel IA, ne changent ni le moteur choisi ni la durée et vérifient les mêmes contraintes de références et de clips que le devis. Il s'agit d'un conseil de choix, pas d'une garantie de qualité.

Suppléments affichés dans le devis :

- Vidéo Libre sans photo : **7 crédits de préparation créative**, couvrant notamment le réalisateur IA et la préparation éventuelle du logo officiel.
- Vidéo avec références précomposées : **7 + 2 crédits par référence originale** pour préparer l'image de départ ; cela remplace le forfait Libre et ne se cumule pas avec lui. Le moteur vidéo reçoit une seule image composée.
- Grok : **1 crédit par image transmise et par clip fournisseur**, donc un par clip après précomposition.
- Voix off séparée du parcours Guidé : **2 crédits**. Les dialogues et voix off natifs font partie du tarif vidéo. Le TTS de secours du parcours Libre est absorbé dans le prix affiché.

Exemples sans photo : Omni 8 s Guidé sans voix off = 80 crédits ; Omni 8 s Libre = 87 ; Grok Lite 5 s Libre = 22 ; MiniMax H3 10 s Guidé sans voix off = 80 ; Veo Fast 8 s Guidé sans voix off = 80 en 720p ou 96 en 1080p. Avec trois photos, Grok Lite 5 s Libre = 29 (15 vidéo + 13 préparation + 1 référence moteur).

Tous les modèles sélectionnés annoncent de l'audio natif. iNrStudio conserve la voix off synthétique existante et les contrôles de parole. Les voix sont disponibles à partir de **4 secondes** pour que les phrases puissent tenir ; un dialogue trop long est refusé avant l'appel vidéo payant. Un dialogue natif rejeté par le contrôle ne devient pas une vidéo silencieuse facturée comme une réussite.

MiniMax documente le français parmi ses langues natives. La qualité française des autres modèles doit être évaluée avec de vrais rendus avant de promettre une équivalence. Une voix synthétique distincte ne produit pas à elle seule une synchronisation des lèvres. Aucune promesse de clonage de voix réelle n'a été ajoutée.

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

La grille en crédits est versionnée dans `lib/aiMediaCreditsPricing.ts`. Les capacités, IDs et estimations de prix fournisseurs sont centralisés dans `lib/aiMediaModelCatalog.ts`. Les estimations fournisseurs servent au fusible de dépenses internes ; elles sont séparées du débit commercial des pros. Les coûts estimés sont en USD, les recharges en EUR HT. La marge réelle dépend du change, des options, des frais Stripe et des tentatives techniquement échouées. Veo Fast utilise les prix Google avec audio : 0,10 USD/s en 720p et 0,12 USD/s en 1080p, identiques sur les grilles Gemini API et Vertex consultées.

## Activation ultérieure, sans l'avoir exécutée

1. Tester les migrations `supabase/migrations/20261013100955_unified_media_credits.sql`, puis `supabase/migrations/20261013113745_media_credit_recharge_pricing.sql` et `supabase/migrations/20261013114612_standard_media_credits_735.sql`, sur une copie de la base contenant les migrations précédentes. Elles sont transactionnelles, vérifient leurs dépendances et gardent les commandes historiques intactes. La deuxième change seulement les quatre prix du catalogue pour les futures commandes. La troisième corrige le forfait Standard historique 25/54 en 25/56 et préserve les exceptions de compte, les configurations non standard et les consommations déjà enregistrées.
2. Appliquer ces migrations dans l'environnement retenu AVANT d'y servir la nouvelle interface. Les nouveaux appels se bloquent avant tout fournisseur si les crédits ne sont pas prêts ; un écart entre le prix stocké, le catalogue serveur et Stripe bloque aussi le checkout avant création de session payante.
3. Vérifier les accès : Gemini API pour Omni, le transport Google/Vertex existant pour Fast, AI Gateway pour Lite/MiniMax/Wan/Grok/OpenAI Image. Une clé Gateway ou l'OIDC Vercel donne l'accès technique ; le compte doit aussi disposer du budget et des permissions nécessaires. Un abonnement Magnific ne finance pas ces appels API. Aucune nouvelle clé de fournisseur n'est embarquée dans le navigateur.
4. Préparer de nouveaux prix Stripe à 19/35/65/155 € HT, à paiement unique, actifs, en EUR, avec `tax_behavior=exclusive` et un libellé en crédits médias. Conserver les anciens objets pour les paiements, retours et webhooks historiques. Remplacer ultérieurement les valeurs des quatre variables serveur ci-dessous dans l'environnement Vercel retenu, puis vérifier les montants. Une variable qui référence encore l'ancien prix de 8 € ne peut pas ouvrir la nouvelle recharge de 19 €. Aucun prix Stripe, secret, variable Vercel ou déploiement distant n'a été modifié ici.
5. Faire quelques générations réelles contrôlées pour comparer la qualité, la voix française et la latence, puis décider du déploiement. Aucun test payant n'a été lancé pour cette préparation.

| Variable serveur existante, à remplacer ultérieurement | Crédits | Montant Stripe `unit_amount`, centimes EUR HT |
|---|---:|---:|
| `STRIPE_VIDEO_CREDITS_50_PRICE_ID` | 500 | 1 900 |
| `STRIPE_VIDEO_CREDITS_100_PRICE_ID` | 1 000 | 3 500 |
| `STRIPE_VIDEO_CREDITS_200_PRICE_ID` | 2 000 | 6 500 |
| `STRIPE_VIDEO_CREDITS_500_PRICE_ID` | 5 000 | 15 500 |

Les IDs ne sont pas inventés dans le code et ne sont pas fournis par le navigateur. Le serveur relit le prix Stripe et refuse toute monnaie, quantité, taxe ou récurrence incompatible. Les réponses de configuration restent génériques, et les logs du checkout utilisent uniquement des motifs fixes sans détails fournisseurs.

Le choix de moteur du Studio est mémorisé par établissement dans le navigateur. iNrAgent conserve son moteur automatique Omni et utilise le même portefeuille : ses durées restent dans la plage 4–20 s, avec au maximum deux clips. Une ancienne préférence automatique de 24 s devient 20 s ; les autres paramètres de réalisation et de voix sont conservés. Un plafond de compte incompatible bloque la génération avant tout appel fournisseur. Ce changement n'ajoute pas de nouveaux fournisseurs autonomes aux campagnes déjà configurées.

Une future modification du barème doit conserver la récupération des anciens jobs : le devis courant et le fingerprint empêchent les réductions de débit, mais une reprise après changement de version peut nécessiter la récupération du résultat enregistré. La version actuelle reste fixe pendant cette livraison.

## Sources techniques vérifiées

- [Catalogue public AI Gateway](https://ai-gateway.vercel.sh/v1/models)
- [Génération vidéo avec AI Gateway](https://vercel.com/docs/ai-gateway/modalities/video-generation)
- [Tarification Google Gemini API](https://ai.google.dev/gemini-api/docs/pricing)
- [Capacités et contraintes Veo](https://ai.google.dev/gemini-api/docs/veo)
- [Documentation MiniMax H3](https://huggingface.co/MiniMaxAI/MiniMax-H3)

La sélection et les prix ont été vérifiés le 13 octobre 2026. Les prix d'achat privés ou négociés de Magnific ne sont pas connus.

## Vérifications locales

Les suites médias, crédits, recharges et iNrAgent couvrent le recalcul des devis, les erreurs et reprises, les nouveaux transports vidéo, les plafonds de durée et les commandes Stripe simulées. Les tests SQL exécutent réellement les migrations sur PGlite avec des comptes synthétiques : conversion, débit/libération, report, désactivation de médias, durées mémorisées, remboursements, dettes et litiges. PGlite sérialise les requêtes ; ces essais ne constituent pas un test de charge multiprocessus de PostgreSQL.

TypeScript et le lint des fichiers modifiés passent. La compilation Next.js complète passe, avec 8 Go de mémoire JavaScript dans cet environnement local ; le premier essai au plafond mémoire par défaut a échoué par manque de mémoire.

Les vrais composants Libre, Guidé, Modifier et Boutique ont été vérifiés dans Chrome avec des réponses API simulées : moteur/durée/résolution, devis périmé, changement d'établissement, justificatif tarifaire, portefeuille indisponible, voix courtes et affichage mobile. Les captures montrent des soldes fictifs. Aucun compte Supabase réel, fournisseur vidéo ou paiement réel n'a été appelé pour cette vérification.

Les libellés ajoutés sont traduits dans les neuf langues de l'application. Les validations de catalogues et les contrôles de rendu passent.

Le bandeau du mode Guidé a été mesuré à 83 px sur ordinateur (1536, 1920 et 2560 px), y compris en mode illimité et portefeuille indisponible ; il mesure 167 px sur mobile de 390 px. Le bouton reste sur une ligne et le solde dispose d'un seul sous-texte. Le bloc 3 présente ses six réglages sur trois colonnes et deux rangées sur ordinateur, avec le choix des scènes dans la cellule durée, sans défilement interne. Les états de moteur incompatible ont également été vérifiés. Les captures utilisent les vrais composants avec des API et soldes simulés.
