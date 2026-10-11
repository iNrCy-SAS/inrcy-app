# Recharges images

Extension additive des recharges vidéo déjà livrées. Les moteurs d’images, de retouche et de vidéo, leurs consignes, prompts, contrôles et estimations de coût ne changent pas. Les quotas mensuels restent Standard25 images/54s, Premium70 images/204s et Founder50 images/144s, avec leurs reports existants.

## Catalogue confirmé

| Recharge ponctuelle | Prix HT | Variable serveur Vercel |
|---|---:|---|
| 20 images | 5 € | `STRIPE_IMAGE_CREDITS_20_PRICE_ID` |
| 50 images | 10 € | `STRIPE_IMAGE_CREDITS_50_PRICE_ID` |
| 100 images | 19 € | `STRIPE_IMAGE_CREDITS_100_PRICE_ID` |

Les achats images et vidéo passent par Stripe sur le web. Les autres produits Boutique conservent leur commande manuelle. Les propriétaires et administrateurs d’un établissement avec abonnement actif/en essai peuvent acheter ; les membres autorisés utilisent son solde partagé. L’interface native utilise le solde acheté mais ne propose pas d’achat Stripe intégré.

## Fonctionnement

Une génération d’image ou une modification déjà décomptée par l’application réserve une unité. Le quota inclus et son report sont utilisés avant le portefeuille acheté. Les crédits images restent distincts des secondes vidéo et survivent au renouvellement mensuel et aux changements de forfait. La disponibilité du Studio suit toujours les règles d’accès existantes.

La portion achetée du job est immuable. Un échec ou une expiration libère la réservation ; un média généré, y compris un brouillon temporaire, est consommé une seule fois. Une retouche locale qui n’appelait aucun moteur et ne consommait aucun quota continue à suivre son fonctionnement actuel.

Les mêmes vérifications Stripe servent les deux domaines par une configuration fixée côté serveur. Le catalogue, le compte, l’acteur, le PriceID, la TVA exclusive, la quantité, le Customer, la Session, le PaymentIntent payé et sa charge sont vérifiés avant la RPC de crédit. Les métadonnées `inrcy_image_credits_v1` et `inrcy_video_credits_v1` ne sont jamais interchangeables. Une redirection réussie ou un montant transmis par le navigateur ne suffit pas pour ajouter du crédit.

Le remboursement cumulatif retire la proportion correspondante d’images arrondie à l’entier inférieur ; un remboursement intégral retire toutes les images du pack. Si elles ont déjà été consommées ou réservées, une dette reste dans le portefeuille acheté et les achats suivants la couvrent. Cette dette ne réduit jamais le quota mensuel inclus. Ce comportement technique ne modifie pas les conditions existantes d’octroi d’un remboursement ni les droits applicables.

Une contestation ouverte suspend les images achetées concernées. Une perte les annule séparément d’un remboursement ; `won`, `prevented` et `warning_closed` libèrent la suspension. Une restitution tardive après perte reste possible, mais les anciens états ne peuvent pas révoquer de nouveau une contestation libérée. La conversion du montant contesté arrondit au supérieur, plafonnée au pack non remboursé ; une autre devise concerne par prudence tout le pack. Les remboursements et contestations sont projetés ensemble sans double retrait. Un job déjà réservé peut terminer ; son déficit temporaire de suspension reste distinct d’une dette définitive. Le wallet agrégé n’alloue pas une commande d’achat à chaque job.

## Activation opératoire

1. Vérifier le projet Supabase et sa migration vidéo `20261011121940_video_credit_recharges.sql`. Lire les quotas réels25/70/50 images et54/204/144 secondes ainsi que les fonctions v2/v3 et les éventuels overrides. Ne remettre aucun usage/report à zéro.
2. Relire puis appliquer une fois la migration CLI `supabase/migrations/20261011171132_image_credit_recharges.sql`. Elle est transactionnelle et échoue si les quotas ou les définitions attendues ont dérivé. Elle ajoute cinq tables avec RLS : packs, commandes, balances, ledger, disputes. Les écritures et RPC restent réservées à `service_role`. Elle généralise le split acheté des jobs et garde les triggers vidéo/images chacun sous un `WHEN media_kind` distinct. Aucun quota de forfait n’est mis à jour.
3. Si application par SQL Editor, inscrire l’historique de migration selon la procédure du projet après réussite, sans exécuter une seconde fois les instructions. Contrôler les cinq RLS/ACL, les trois packs, les grants EXECUTE serveur et les triggers. Relire les quotas et rapprocher réservations actives de chaque portefeuille.
4. Créer ou vérifier les trois produits/PriceIDs dans le compte Stripe et le mode adéquats : EUR, paiement ponctuel, montants HT du tableau et `tax_behavior=exclusive`. Le code accepte les IDs créés manuellement, sans `lookup_key` ni métadonnée produit obligatoire. Conserver la configuration StripeTax des produits numériques déjà utilisée pour les recharges vidéo ; aucune règle fiscale nouvelle n’est introduite.
5. Ajouter les trois variables de prix à l’environnement Vercel choisi, avec les clés Stripe existantes du même mode. Ne pas afficher ou enregistrer les clés dans le dépôt. Les commandes en cours conservent leur prix et leurs paramètres d’origine, même si le catalogue évolue.
6. Conserver le webhook `/api/stripe/webhook` et les dix événements déjà utilisés pour les recharges vidéo : `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed`, `checkout.session.expired`, `charge.refunded`, `charge.dispute.created`, `charge.dispute.updated`, `charge.dispute.funds_withdrawn`, `charge.dispute.funds_reinstated`, `charge.dispute.closed`. Aucun endpoint ni événement supplémentaire n’est nécessaire pour les images. La signature est vérifiée avant tout traitement, puis les objets courants sont relus auprès de Stripe.
7. Livrer le code après la migration. Vérifier Boutique, le bandeau Studio Libre/Guidé, les onglets du panneau de recharges et Mon abonnement : compteur mensuel inclus séparé du solde acheté, et mises à jour après achat/changement d’établissement. Étendre le paragraphe recharges des CGA aux images avec le même fonctionnement et les mêmes conditions existantes.
8. Contrôler les parcours en mode Stripe test si disponible : paiement réussi/différé/échoué/expiré, événements rejoués, remboursement, contestation et isolation de deux établissements. Aucun paiement réel ni génération payante n’est requis pour les tests locaux. Vérifier les montants des PriceIDs configurés et la lecture réelle de la nouvelle API après publication.

## Contrat des API

- `GET /api/boutique/image-credits` : compte actif, acteur, droit d’achat, trois packs disponibles selon configuration et vingt commandes récentes avec `images`, `revoked_images`, `held_images`, `dispute_revoked_images`.
- `POST /api/boutique/image-credits/checkout` : `accountId`, `packKey`, `requestKey`. Montants et nombres d’images du navigateur sont ignorés. Retour compatible vidéo : `orderId`, `url`, `completed`, `pending`, `failed`, `expired` selon l’état vérifié.
- `GET /api/boutique/image-credits/orders/[orderId]` : commande limitée au compte actif ; retour `images`, `granted`, `status`, `revokedImages`, `heldImages`, `disputeRevokedImages`, `createdAt`, `packKey` après rapprochement serveur.
- Retour Checkout : `/dashboard/boutique/recharges?media=image&checkout=success|cancel&order=…`. Les retours vidéo existants ne changent pas.
- `quota.image` et `quota.video` exposent les mêmes champs inclus/achetés. `includedUsed` compte le mois actuel ; `used` reste l’agrégat compatible incluant la consommation achetée historique. Le bandeau Libre/Guidé partage le même composant et affiche deux soldes disponibles : `includedRemaining` (abonnement et report) et `purchasedRemaining` (crédits achetés), sans les additionner. Le bouton Recharger est placé à côté du solde acheté ; les deux sous-textes sont alignés.

## Traçabilité, tests et limites

`ai_media_image_credit_orders` conserve le pack et le prix de l’achat, le compte/acteur et les identifiants Stripe. `ai_media_image_credit_disputes` conserve les contestations ; `ai_media_image_credit_ledger` trace achat, réservation, consommation, libération, remboursement, suspension et perte avec des clés uniques. Le budget moteur et les champs de coût existants restent des estimations internes ; ces journaux de quota ne prouvent pas le coût réellement facturé par le fournisseur. Un essai fournisseur finalement rejeté peut coûter à iNrCy alors que sa réservation client est libérée. Aucune tentative automatique supplémentaire n’est ajoutée.

Tests locaux sans réseau :

```text
node --test --experimental-strip-types tests/boutique/image-credit-*.test.* tests/boutique/video-credit-*.test.* tests/stripe-webhook/checkout-convergence-runtime.test.mts tests/ai-media-generation/media-credit-quota-mapping.test.mts
```

`PGLITE_MODULE` peut pointer vers le runtime préinstallé en lecture seule. Si le sandbox Windows interdit les processus enfants, utiliser `--test-isolation=none` pour cette commande locale. `test:contracts` découvre automatiquement tous les nouveaux tests. Exécuter également typecheck, ESLint et les tests Boutique/abonnements/quota existants.

PGlite exécute les vraies migrations, RPC, triggers et politiques RLS avec comptes synthétiques. Ses requêtes sont sérialisées : les tests de réservations concurrentes ne prouvent pas l’absence de deadlock sur plusieurs connexions PostgreSQL. L’ordre reste compteur mensuel→wallet pour les jobs et commande→wallet pour les paiements, sans paiement qui verrouille le compteur mensuel.

Après timeout Stripe incertain, conserver la même intention et ses paramètres. Après23h sans Session connue, arrêter les nouvelles créations pour cette intention et rapprocher manuellement. Réinitialiser la clé locale seulement après état payé/expiré/échoué vérifié ; les clés sont séparées par établissement, acteur, domaine et pack.

Pour suspendre les nouvelles ventes images, retirer les trois PriceIDs de l’environnement. Après le premier achat ou Checkout ouvert, conserver tables, wallet, RPC et handlers webhook images dans tout retour arrière. L’ancien webhook vidéo acquitte certains événements image sans crédit ni retrait ; un retour arrière intégral nécessite l’inventaire, le rapprochement et le rejeu explicite des paiements/remboursements/contestations concernés. Ne jamais supprimer le portefeuille acheté pour arrêter la vente.
