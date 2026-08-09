# Réparation OAuth et journaux de production — 9 août 2026

## Résultat

- Google OAuth ne demande plus `gmail.readonly`. L'intégration ne conserve que
  `gmail.send` et `userinfo.email`.
- Le scanner de retours automatiques ne contient plus aucun chemin de lecture
  Gmail, y compris pour les anciens comptes qui auraient encore accordé ce droit.
- Les échecs répétés du scanner IMAP sont mis en pause après trois tentatives
  pendant six heures. L'envoi SMTP reste connecté et utilisable.
- Les références média sont vérifiées dans `storage.objects` avant toute demande
  d'URL signée, via une fonction réservée au rôle backend.
- Les rapprochements Stripe par e-mail sont insensibles à la casse. Un événement
  Stripe historique sans compte iNrCy est tracé en information et non comme une
  fausse alerte de production. Les cas qui devraient obligatoirement correspondre
  à un compte restent des warnings.

## Cause de l'écran Google « application non validée »

Le client OAuth de production appartient au projet
`location-site-1763997543736`. Le Centre de validation Google confirmait le
branding et l'accès aux données, mais l'URL OAuth de production ajoutait encore
`https://www.googleapis.com/auth/gmail.readonly`, absent des autorisations
validées. Ce scope permet de lire les messages Gmail et est classé « restricted ».
La différence entre les scopes validés et ceux demandés déclenchait donc l'écran
d'avertissement.

## Lecture des journaux

### Vercel — 12 dernières heures

- 20 warnings, 0 erreur et 0 fatal.
- 18 warnings provenaient du même compte IMAP OVH
  (`ssl0.ovh.net:993`) dans `/api/cron/mail-bounces`, avec le message trop générique
  `Command failed`.
- 2 warnings provenaient d'événements Stripe sans correspondance locale unique.

### Supabase

- 8 réponses Storage `400` correspondaient à des références vidéo/miniature
  absentes au moment de créer une URL signée.
- Le couple Postgres `42501` / REST `401` sur
  `inrcy_onboarding_states` coïncidait avec un `/auth/v1/user` `403` depuis le
  navigateur mobile.
- Le contrôle direct de production a confirmé que le `SELECT` authenticated, le
  `SELECT` service_role, la RLS, la policy d'accès et l'exécution de la RPC
  onboarding sont tous présents. Il s'agissait donc d'une session expirée, pas
  d'un GRANT manquant. Aucun accès n'a été ouvert à `anon`.
- Le GET Storage d'un ancien PNG signé provenait d'Amazonbot : c'est un robot qui
  suivait une URL ancienne, pas une panne applicative.

## Action Supabase appliquée

`ops/sql/2026-08-09_storage_registry_reconciliation.sql` a été exécuté sur le
projet de production. Il ne supprime aucune ligne et aucun fichier.

- fonction `public.inrcy_storage_object_exists(text, text)` installée ;
- exécution réservée à `service_role` ;
- 0 variante supplémentaire à marquer `failed` ;
- 0 source supplémentaire à signaler absente.

## Vérifications

- 26 tests ciblés réussis ;
- TypeScript (`tsc --noEmit`) réussi ;
- ESLint sur tous les fichiers modifiés réussi ;
- compilation Next.js réussie ; l'étape finale du build local a seulement été
  interrompue par un `spawn EPERM` du bac à sable Windows après la compilation.

## Mise en production

Le ZIP corrigé doit être déployé sur Vercel. Tant que l'ancien déploiement reste
actif, il continuera de demander `gmail.readonly` et d'émettre les anciens logs
IMAP/Stripe. Après déploiement, tester Google avec une fenêtre privée ou un compte
qui n'a pas déjà accepté l'ancien consentement.
