# Bilan — 4 warnings Supabase Storage du 9 août 2026

## Conclusion

Les quatre lignes `GET 400` sont expliquées et corrigeables. Elles ne correspondent ni à quatre fichiers supprimés, ni à quatre nouvelles publications en échec.

Des robots externes ont revisité d’anciennes URLs Supabase signées après leur expiration de 24 heures :

- deux images du bucket public `booster`, revisitées par `Amazonbot` environ 29 h 39 et 32 h 28 après expiration ;
- deux vidéos du bucket privé `inrcy-pro-media`, revisitées par l’agent externe de Meta environ 120 h 49 et 221 h 18 après expiration.

La vérification SQL en lecture seule confirme que les quatre objets existent toujours. Leurs tailles sont cohérentes : 990 825 octets et 1 826 310 octets pour les images, 29 852 178 octets et 34 749 083 octets pour les vidéos.

## Cause exacte

L’application fournissait parfois à un réseau social ou à un robot une URL Supabase contenant un jeton valable 24 heures. La publication pouvait réussir au moment de l’envoi, mais une nouvelle lecture plusieurs jours plus tard utilisait le même jeton devenu invalide. Supabase répondait alors `400` et classait la requête comme warning.

Le problème concernait donc la durée de vie de l’adresse diffusée, pas le fichier lui-même.

## Corrections appliquées

1. **Images `booster`**

   Le bucket est public. Les images utilisent maintenant directement l’URL publique permanente de Supabase. Aucune URL signée temporaire n’est créée pour ce bucket.

2. **Vidéos et médias privés**

   Les fournisseurs reçoivent maintenant une URL inrCy stable et authentifiée. À chaque lecture, cette route vérifie la signature inrCy puis crée un accès Supabase frais et redirige le fournisseur en `307`.

3. **Compatibilité vidéo**

   La redirection accepte `GET` et `HEAD`, conserve le fonctionnement des requêtes `Range` et ne charge pas une grosse vidéo en mémoire Vercel.

4. **Priorité aux références durables**

   Lorsqu’un média possède un `bucket` et un `storagePath`, l’application reconstruit désormais son URL durable au lieu de réutiliser une ancienne URL temporaire présente dans le payload.

5. **Tous les chemins de publication concernés**

   La correction couvre Booster immédiat, iNrSend, iNrAgent immédiat et iNrAgent programmé. Les images optimisées Instagram, réseaux sociaux, site et Google Business du bucket `booster` utilisent également leur URL publique permanente.

## Fichiers principaux modifiés

- `lib/storageContentUrl.ts`
- `app/api/storage/content/route.ts`
- `app/api/booster/publish-now/publishNow.server-preparation.ts`
- `lib/inrsend/publicationChannelActions.ts`
- `app/api/agent/actions/execute/route.ts`
- `app/api/agent/actions/schedule/route.ts`
- `tests/observability/production-warning-regressions-2026-08-09.test.mts`

## Validation

- TypeScript : réussi sans erreur.
- ESLint ciblé : réussi sans erreur ni warning.
- 571 tests concernés : 571 réussis, 0 échec.
  - Dashboard : 259/259
  - Système de publication : 206/206
  - iNrSend : 72/72
  - iNrAgent + observabilité : 34/34
- Next.js : compilation de production réussie et contrôle TypeScript Next.js terminé. La collecte finale des pages demande les variables Supabase de production, volontairement absentes de l’archive source locale.
- Contrôle Supabase : requêtes SQL de diagnostic uniquement, aucune donnée ni configuration modifiée.

## À savoir après déploiement

Le correctif agit sur toutes les nouvelles URLs produites après le déploiement. Les anciennes URLs temporaires déjà enregistrées dans les caches de Meta ou Amazon ne peuvent pas être remplacées à distance. Ces robots peuvent donc encore retenter ponctuellement une ancienne adresse et générer un warning résiduel. Cela ne signifie pas que le nouveau correctif a échoué.

Le bon indicateur après déploiement est le suivant : aucune nouvelle publication ne doit diffuser d’URL `/storage/v1/object/sign/booster/...`, et les médias privés doivent être présentés aux fournisseurs via `/api/storage/content?...`.
