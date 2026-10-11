# Recharges vidéo et quotas mensuels

Préparation sur la base Production `de666187`. Les moteurs Omni/Veo, les prompts, le contrôle créatif, les durées 8/16/24 s et le nombre d’images ne sont pas modifiés par cette fonctionnalité.

## Périmètre validé

| Forfait | Quota vidéo mensuel inclus |
|---|---:|
| Standard | 54 s |
| Premium | 204 s |
| Founder | 144 s, inchangé |

| Recharge ponctuelle | Prix HT | Variable Vercel |
|---|---:|---|
| 50 s | 8 € | `STRIPE_VIDEO_CREDITS_50_PRICE_ID` |
| 100 s | 15 € | `STRIPE_VIDEO_CREDITS_100_PRICE_ID` |
| 200 s | 29 € | `STRIPE_VIDEO_CREDITS_200_PRICE_ID` |
| 500 s | 69 € | `STRIPE_VIDEO_CREDITS_500_PRICE_ID` |

Le bouton **Recharger** est dans le bandeau du bas d’iNr’Studio, à côté du compteur vidéo, en Libre et Guidé. Il ouvre les quatre packs sans quitter le brief. Le paiement Stripe s’ouvre dans un autre onglet. Boutique présente aussi ces packs ; les prestations continuent à passer par leur commande manuelle existante.

Les propriétaires et administrateurs d’un établissement avec abonnement actif/en essai peuvent acheter. Tous les membres autorisés utilisent le solde partagé de leur établissement. Les achats Stripe sont proposés sur le web ; le solde fonctionne aussi sur les applications natives. Des produits IAP distincts seraient nécessaires pour proposer les achats directement dans les apps natives.

## Activation, dans cet ordre

1. Lire les lignes réelles `ai_media_plan_limits`, les éventuels overrides et le mois courant de `ai_media_monthly_usage`. L’observation « 56 s » dans le Studio peut être un solde avec report, pas une limite de forfait. Ne pas supprimer le report ou remettre les consommations à zéro. La migration vérifie Standard 48/54 et Premium 196/204 avant de fixer 54/204 ; un autre état déclenche un arrêt à examiner.
2. Contrôler/appliquer `supabase/migrations/20261011121940_video_credit_recharges.sql` dans le projet correct. Elle est transactionnelle et conserve les usages existants et les règles d’images/report. Elle ajoute cinq tables avec RLS (packs, commandes, soldes, ledger, contestations), le champ immuable de financement acheté et la lecture de quota v3. Les RPC d’écriture sont réservées au rôle serveur. v3 expose séparément limite, utilisé et réservé inclus du mois ; le bandeau Studio utilise ces compteurs et présente à côté le restant total et le restant acheté.
3. Créer ou vérifier manuellement les quatre produits/prix dans le dashboard Stripe du compte et du mode choisis : EUR, paiement ponctuel, montant HT du tableau et `tax_behavior=exclusive`. Copier leurs Price IDs dans les quatre variables correspondantes. Le code accepte ces IDs directement : aucun `lookup_key` ni métadonnée produit n’est requis. Un script alternatif est disponible : `node --experimental-strip-types scripts/provision-video-credit-packs.mts` affiche un plan hors ligne ; `--apply --mode=test` ou `--apply --mode=live` est une mutation explicite, avec la clé du mode choisi. Ce script réutilise ses propres `lookup_key` et refuse un prix divergent, sans modifier les produits antérieurs. Ne pas exécuter ce provisionnement si les quatre prix ont déjà été créés manuellement.
4. Vérifier que Stripe Tax est déjà configuré pour les produits numériques comme pour les abonnements actuels. Les prix sont `exclusive`/EUR/ponctuels. Checkout conserve `automatic_tax`, collecte l’adresse et les numéros de TVA, puis crée la facture. Aucune règle fiscale ou catégorie de taxe spécifique n’est imposée par le script.
5. Ajouter les quatre variables de prix à l’environnement Vercel approprié. Réutiliser `STRIPE_SECRET_KEY` et `STRIPE_WEBHOOK_SECRET` existants, sans les imprimer ni les copier dans le dépôt. Preview doit utiliser des IDs et clés du même mode que ses données de paiement.
6. S’assurer que le webhook existant `/api/stripe/webhook` reçoit les dix événements suivants, en plus de ses événements d’abonnement actuels : `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated`, `charge.dispute.closed`. La signature reste vérifiée avant traitement. Les abonnements et les commandes de prestations conservent leur flux. Un événement financier encore en traitement reçoit503 pour conserver les retries ; un événement durablement terminé reçoit200 sans seconde écriture.
7. Livrer le code seulement après la migration : la nouvelle lecture de quota appelle v3. Vérifier Boutique, Mon abonnement, les deux modes Studio, l’achat réussi/différé/annulé/expiré, le changement d’établissement et les relectures après retour au Studio. Un retour navigateur seul n’ajoute jamais de secondes ; le serveur relit la session, le prix exact, le PaymentIntent et sa charge.
8. Après activation, contrôler les quatre prix et leurs montants côté Stripe, les lignes de commandes/ledger et les compteurs inclus/achetés. Un test Checkout en mode test est préférable pour la transaction complète ; aucune génération média payante n’est nécessaire pour vérifier le paiement.

## Consommation et remboursement

Le quota inclus et son report restent dans `ai_media_monthly_usage`. Les secondes achetées restent dans un portefeuille indépendant, sans expiration au renouvellement mensuel. Chaque génération finance d’abord sa durée avec les secondes incluses, puis complète avec les secondes achetées. Par exemple, 6 s incluses restantes + un clip de 8 s réservent 6 s incluses et 2 s achetées. Les réservations concurrentes sont bornées par les compteurs verrouillés ; un paiement est crédité une seule fois par commande.

Un échec ou une expiration libère les deux portions réservées. Un média sauvegardé, y compris un brouillon temporaire généré, consomme sa durée une seule fois. Le solde acheté survit au changement de mois, aux changements de forfait et à la suspension ; l’usage reste soumis aux règles d’accès existantes de l’application.

Politique technique de remboursement : la proportion remboursée cumulée d’une charge retire la même proportion de secondes, arrondie à l’entier inférieur ; un remboursement intégral retire toutes les secondes du pack. Les événements dupliqués ou arrivés dans le désordre ne retirent pas deux fois le même quota. Si les secondes remboursées ont déjà été utilisées/réservées, une dette reste dans le portefeuille acheté et est affichée. Les prochains achats couvrent cette dette ; elle ne réduit jamais le quota mensuel inclus. Les remboursements sont initiés par l’administrateur dans Stripe, pas automatiquement dans le navigateur. Le paragraphe recharges d’Article40 des CGA décrit ce fonctionnement sans modifier les conditions existantes d’octroi d’un remboursement ni les droits applicables.

Une contestation est relue auprès de Stripe : ses événements servent uniquement à identifier l’objet. Les secondes achetées concernées sont suspendues (`held_seconds`) pendant la contestation et annulées séparément (`dispute_revoked_seconds`) si elle est perdue. `won`, `prevented` et `warning_closed` libèrent la suspension ; une restitution tardive après perte est acceptée. Un ancien état ne peut pas resuspendre/révoquer une contestation déjà libérée. Le montant contesté est converti en secondes arrondies au supérieur, plafonné au pack non remboursé ; une devise différente suspend le pack par prudence. Remboursements et contestations sont projetés ensemble pour éviter le double retrait. Les jobs déjà réservés terminent normalement ; une suspension peut laisser un déficit temporaire distinct d’une dette définitive. Le quota inclus demeure intact. Le wallet est partagé : il n’alloue pas une commande d’achat à chaque job.

Les tables financières utilisent des références restrictives pour préserver leur audit ; la suppression définitive/anonymisation d’un compte acheté doit tenir compte de ce journal, comme pour les autres archives de facturation.

## Traçabilité et coût

`ai_media_video_credit_orders` garde le compte, l’utilisateur acheteur, le pack et son montant HT au moment de l’achat, la session/PaymentIntent Stripe, la date de crédit et les remboursements cumulés. `ai_media_video_credit_disputes` garde le lien charge/contestation et sa progression. `ai_media_video_credit_ledger` trace achat, remboursement, réservation, consommation, libération, suspension et annulation liée à une contestation avec des clés uniques. Les jobs conservent leur statut/erreur et la portion achetée immuable. Le navigateur ne décide ni du montant, ni de l’établissement crédité, ni des secondes ajoutées.

Un fournisseur vidéo peut facturer un essai finalement rejeté par le contrôle audio/qualité de l’application. Le quota iNrCy est alors libéré ; le coût fournisseur éventuel reste à la charge d’iNrCy. Ces recharges n’ajoutent aucune nouvelle tentative automatique ni modification de moteur. Le coût réel doit être rapproché des exports fournisseur : le ledger de secondes n’est pas une facture Google. La marge ne doit donc pas être calculée seulement avec les vidéos acceptées.

En cas de timeout Stripe incertain, la commande conserve ses paramètres et sa clé d’idempotence. Après 23 h sans identifiant de session connu, aucune nouvelle demande payante n’est créée pour cette même intention ; rapprochement manuel requis. Une session vérifiée expirée ou définitivement échouée libère la clé locale pour permettre un nouvel achat. Un paiement en cours garde cette clé. Les clés sont séparées par établissement, utilisateur et pack.

## Contrôles locaux reproductibles

- `npm run test:video-credits` : SQL PostgreSQL/PGlite sans réseau et appels Stripe simulés, avec comptes synthétiques. `PGLITE_MODULE` permet de pointer vers une installation locale en lecture seule ; le dépôt épingle PGlite 0.5.8 dans ses dépendances de développement.
- Tests Boutique, webhook/abonnements et quotas existants : `node --test --experimental-strip-types tests/boutique/*.test.mts tests/stripe-webhook/*.test.mts tests/ai-media-generation/ai-media-generation-quota*.test.mts tests/ai-media-generation/ai-media-generation-rollover.test.mts`.
- `npm run typecheck`, validation des catalogues/références i18n et ESLint des fichiers édités.

PGlite valide les migrations, les fonctions, les triggers, RLS et les reprises. Ses appels simultanés partagent une connexion sérialisée : cela ne prouve pas une absence de deadlock sous plusieurs connexions PostgreSQL réelles. La transaction Stripe en ligne, les droits réels de Supabase et les interfaces publiées nécessitent les contrôles d’activation ci-dessus.

Pour arrêter les ventes, retirer les quatre IDs de prix empêche l’ouverture de nouveaux Checkout. Après les premiers achats ou Checkout ouverts, conserver les tables/ledger, les RPC et **les nouveaux handlers webhook** dans tout retour arrière d’interface. Revenir intégralement au webhook de `de666187` acquitte ces événements sans crédit/retrait : les paiements déjà ouverts, remboursements et contestations tardifs seraient perdus. Si un retour arrière intégral est indispensable, inventorier toutes les sessions ouvertes et les événements concernés, puis effectuer un rapprochement et un rejeu explicites avant réouverture ; Stripe ne retente pas automatiquement un événement déjà acquitté200. Ne pas supprimer le portefeuille. Les fonctions v2 mises à jour restent compatibles, mais l’ancienne interface ne présente pas la ventilation achetée.
