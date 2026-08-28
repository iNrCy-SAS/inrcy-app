# Réparation des journaux de production — 28 août 2026

## Incidents corrigés

- Vercel `preparation_dispatch_http_413` : les workers Booster transportent
  désormais une référence compacte et relisent le payload média durable côté
  serveur.
- Supabase Storage `HEAD 400` : les URL privées/signées sont sondées avec un
  `GET` borné à un octet.
- Supabase onboarding `42501 / 401` : le navigateur passe par une API iNrCy
  authentifiée ; les accès à la table restent côté serveur.
- Supabase notifications `23505 / 409` : les insertions dédupliquées utilisent
  une fonction atomique `ON CONFLICT DO NOTHING`.

## Ordre de déploiement

1. Exécuter `ops/sql/2026-08-28_notification_insert_dedupe.sql` dans Supabase.
2. Déployer ensuite l'application sur Vercel.

Le script SQL est idempotent, ne supprime aucune donnée et réserve la fonction
au rôle backend `service_role`.
