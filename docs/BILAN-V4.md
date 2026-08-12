# iNrCy V4 — synchronisation Dashboard / iNrStats / Booster

Date : 12 août 2026

## Avant la correction

- Une ancienne réponse iNrStats à `0` pouvait rester servie pendant plusieurs heures.
- Déconnecter/reconnecter un site modifiait la clé technique et faisait revenir les chiffres, donnant l'impression qu'une reconnexion était obligatoire.
- Dashboard, le résumé du Générateur et iNrStats ne partageaient pas tous une version fonctionnelle explicite du cache.
- Les quatre parcours OAuth Google utilisaient `include_granted_scopes=true`. Google pouvait donc ajouter à la demande courante d'anciens droits déjà accordés au même client OAuth, notamment un ancien droit Gmail de lecture.
- Un compte historiquement touché n'avait pas de réparation globale et devait attendre ou provoquer manuellement un changement de connexion.

## Après la correction V4

- Une version de cache unique `v4-2026-08-12` est utilisée par l'overview iNrStats, la signature Dashboard/Générateur et le cache mémoire serveur.
- Tous les anciens calculs courants sont ignorés après déploiement, sans supprimer les dernières bonnes mesures.
- Le SQL V4 répare chaque compte une seule fois : expiration des calculs remplaçables, libération du rafraîchissement quotidien et incrément du signal temps réel `stats_version`.
- Les connexions existantes restent intactes. Aucun professionnel n'a besoin de déconnecter/reconnecter un canal dont le jeton est encore valide.
- Les changements des intégrations, de Site iNrCy/iNrBadge/iNrSearch et des outils pro déclenchent le même signal Stats temps réel.
- Gmail, GA4/GSC, Google Business et YouTube demandent uniquement leurs propres scopes. Les anciens droits Google ne sont plus fusionnés automatiquement.
- Les scopes YouTube ne peuvent plus être élargis silencieusement par une ancienne variable Vercel.
- Un refus d'authentification détecté pendant la lecture Google Business ou YouTube est enregistré immédiatement en « À reconnecter », sans attendre qu'une publication Booster échoue.

## Règle de vérité conservée pour tous les canaux

- **Connecté — vert** : état officiel valide, jeton réutilisable et cible de publication présente ; Stats actives et Booster autorisé.
- **À reconnecter — jaune** : expiration ou refus OAuth réellement identifié ; Stats à 0 et Booster indisponible.
- **À connecter — bleu / Stats grises** : aucune connexion officielle ; Booster indisponible.
- **Désactivé** : jamais sélectionnable dans Booster.
- Booster recontrôle l'état officiel côté serveur juste avant l'envoi, même si l'utilisateur avait ouvert la fenêtre auparavant.

## Déploiement

1. Déployer le code V4 sur Vercel.
2. Exécuter dans Supabase SQL Editor : `ops/sql/2026-08-12_stats_oauth_account_repair_v4.sql`.
3. Exécuter ensuite le contrôle en lecture seule : `ops/sql/2026-08-12_stats_oauth_account_repair_v4_verify.sql`.
4. Le résultat final du contrôle doit contenir `MIGRATION_APPLIED = true`.

Le SQL peut aussi être lancé juste avant le déploiement. Il est idempotent : le relancer ne répare pas et ne réinitialise pas une deuxième fois les comptes déjà passés en V4.

## Cas de la cliente Google Business

Si son jeton Google Business est réellement valide, sa prochaine ouverture authentifiée relira automatiquement les mesures Google 7/30 jours et recalculera Dashboard/iNrStats, sans déconnexion/reconnexion. Si Google refuse réellement le jeton, le canal passera en jaune « À reconnecter » avant toute nouvelle publication Booster.

## Vérifications réalisées

- Tests ciblés OAuth/cache/connexion : 28/28.
- Suite Dashboard complète : 312/312.
- Suite iNrSend : 72/72.
- TypeScript : aucune erreur.
- Build Next.js de production : 218/218 pages générées.
