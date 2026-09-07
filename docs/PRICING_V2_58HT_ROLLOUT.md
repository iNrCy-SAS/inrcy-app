# Tarifs HT v2 — procédure de mise en production

## Montants

| Offre | Mensuel | Annuel | Taxe Stripe |
| --- | ---: | ---: | --- |
| Standard v2 | 58,00 € HT | 628,00 € HT | `exclusive` |
| Premium v2 | 108,00 € HT | 1 168,00 € HT | `exclusive` |

Les deux annuels utilisent des montants commerciaux ronds, avec une remise affichée
de 10 % : 628 € HT pour Standard et 1 168 € HT pour Premium.

## Cohortes

`NEXT_PUBLIC_INRCY_PRICING_V2_CUTOVER_AT` contient une date UTC ISO.

- `auth.users.created_at < cutover` : tarifs historiques TTC ;
- `auth.users.created_at >= cutover` : tarifs HT v2 ;
- date absente ou invalide : retour de sécurité vers les tarifs historiques.

La date de création Auth protège sans migration les abonnés, essais, invitations et
inscriptions commencés avant le basculement. Après la première création de compte
postérieure au cutover, cette date ne doit plus jamais être déplacée ni supprimée.

## Stripe puis Vercel

1. Créer quatre nouveaux Price Stripe EUR récurrents, sans modifier ni archiver les
   Price historiques : 5 800 cts/mois, 62 800 cts/an, 10 800 cts/mois,
   116 800 cts/an. Déclarer leur `tax_behavior` à `exclusive`.
2. Vérifier Stripe Tax et le calcul automatique selon pays/adresse/statut fiscal.
3. Renseigner les quatre variables `STRIPE_PRICE_*HT_*_ID` documentées dans
   `docs/ENVIRONMENT_CHECKLIST.md`, en conservant toutes les variables historiques.
4. Au moment de l'activation, enregistrer l'instant UTC courant comme cutover
   technique immuable dans Vercel, puis redéployer immédiatement. Il ne s'agit pas
   d'une date commerciale planifiée : elle sert uniquement à protéger les comptes
   déjà créés.
5. Tester un compte créé avant cet instant (ancien Price) et un compte de test créé
   après cet instant (nouveau Price + taxe dynamique).
6. Synchroniser lors de l'activation les textes du site marketing externe vers 58 € HT et
   108 € HT. Aucun changement WordPress n'est effectué par ce dépôt.

## Repli

Ne jamais changer le cutover après son activation. En cas d'incident, retirer
temporairement les quatre Price IDs v2 et redéployer : seuls les nouveaux checkouts
échouent en sécurité avec HTTP 503, tandis que les abonnements et cohortes existants
restent inchangés. Restaurer les mêmes IDs pour reprendre les ventes.
