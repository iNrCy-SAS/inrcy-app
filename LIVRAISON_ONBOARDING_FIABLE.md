# Onboarding fiable des nouveaux comptes

## Parcours livré

- La création d’un compte puis la définition du mot de passe ouvrent une seule fois `Profil → Activité → Configuration IA`.
- La création d’un nouvel établissement multicompte ouvre le même parcours uniquement pour cet établissement.
- Chaque étape propose **Passer**. Enregistrer ou passer fait avancer immédiatement vers l’étape suivante.
- Terminer, passer ou rencontrer une erreur terminalise le parcours pour l’établissement. Une fois le dashboard atteint, ces modales ne peuvent plus revenir.
- La complétude du profil ou de l’activité ne déclenche jamais l’onboarding.
- Une connexion ordinaire, une réinitialisation de mot de passe et un compte déjà arrivé au dashboard ne déclenchent jamais l’onboarding.
- Si la vérification ou l’enregistrement échoue, le dashboard reste accessible. Les alertes normales de l’application permettent ensuite de compléter le profil et l’activité.

## Sécurité de déclenchement

- Le droit d’ouvrir le parcours est matérialisé par une preuve serveur signée, HttpOnly, limitée au compte et expirant après deux heures.
- Cette preuve est émise uniquement après une invitation finalisée ou la création d’un nouvel établissement.
- Un état manquant au chargement du dashboard est classé directement comme abandonné (`deferred`) et ne recrée jamais un parcours.
- Les transitions concurrentes utilisent une mise à jour conditionnelle afin qu’une réponse tardive ne puisse pas ressusciter un parcours terminé.

## Mise en production

1. Déployer cette version de l’application sur Vercel.
2. Tester un nouveau compte : mot de passe, Profil, Activité, IA, dashboard.
3. Tester **Passer** sur chaque étape puis recharger le dashboard : aucune modale ne doit revenir.
4. Créer un établissement multicompte et vérifier que le parcours ne concerne que celui-ci.

**Aucun SQL Supabase n’est à exécuter pour ce correctif.** Le fichier `ops/sql/2026-09-01_onboarding_provisioning_reliability.sql` reste historique et optionnel ; il ne fait pas partie de cette livraison.

## Correctifs associés

- Les messages de temps indicatif du générateur média ont été raccourcis en français.
- L’édition d’une publication dans iNrSend reste ouverte pendant les actualisations d’historique et préserve le formulaire, les images et la vidéo en cours de modification.

## Contrôles

- Tests onboarding et multicompte.
- Tests générateur média et iNrSend.
- TypeScript, ESLint et build Next.js de production.
- ZIP Windows réextrait et contrôlé avant livraison.
