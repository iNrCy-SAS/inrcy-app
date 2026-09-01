# Onboarding fiable des nouveaux comptes

## Résultat

- Un nouveau compte professionnel reçoit atomiquement son établissement principal, son accès propriétaire, sa configuration multicompte et un onboarding `Profil` en attente.
- Un nouvel établissement multicompte reçoit le même onboarding, indépendamment des autres établissements.
- Après la définition du mot de passe, le parcours `Profil → Activité → Configuration IA` est obligatoire et ne peut plus être fermé ou reporté.
- Si l’état manque malgré tout, l’API tente une réparation ciblée. Une indisponibilité réelle affiche un écran de reprise avec trois tentatives automatiques puis un bouton **Réessayer** ; le dashboard ne s’ouvre jamais silencieusement.
- Aucun compte existant n’est parcouru, reclassé ou remis à zéro par la nouvelle migration.

## Ordre de mise en production

1. Exécuter dans Supabase le fichier `ops/sql/2026-09-01_onboarding_provisioning_reliability.sql`.
2. Déployer ensuite cette version de l’application sur Vercel.
3. Créer un compte de test, définir son mot de passe et vérifier l’ouverture des trois étapes.
4. Sur un compte multicompte de test, créer un établissement et vérifier que son parcours repart à l’étape Profil.

La migration ne contient aucun `DELETE`, `TRUNCATE`, rattrapage global ni réinitialisation d’onboarding. Sur Supabase hébergé, elle conserve le trigger existant de `auth.users` et remplace uniquement sa fonction, sans tenter de modifier la table Auth gérée par Supabase.

## Fiabilité du dashboard local

- `npm run dev` démarre Node avec le magasin de certificats Windows (`--use-system-ca`) : les appels serveur vers Supabase ne sont plus rejetés par une chaîne TLS locale.
- Le dashboard reçoit l’état initial d’onboarding directement côté serveur avant l’hydratation React.
- Une route client neutre (`/api/dashboard/runtime-snapshot`) reste disponible comme secours et pour les changements d’établissement, afin d’éviter les filtres d’extensions de confidentialité.
- Les erreurs restent bloquantes et sont journalisées ; aucun contournement TLS ni ouverture silencieuse du dashboard n’a été ajouté.

## Contrôles réalisés

- Build Next.js de production : réussi.
- TypeScript : réussi.
- ESLint ciblé : réussi.
- Tests onboarding : 54/54 réussis, dont les régressions TLS, état initial serveur et route neutre.
- Tests authentification et multicompte : réussis.
- Validation des catalogues i18n (9 langues) : réussie.
