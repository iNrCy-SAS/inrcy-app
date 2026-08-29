# Livraison iNrCy — attribution Meta Ads et Conversions API

## Résultat

Cette version sait maintenant :

- identifier la source, la campagne, l'ensemble, la publicité et le placement de chaque inscription ;
- conserver les noms et les IDs Meta même si les campagnes sont renommées ;
- afficher la provenance dans l'e-mail de nouvelle inscription ;
- afficher la provenance dans le détail d'un utilisateur de l'administration iNrCy ;
- envoyer un événement serveur Meta `Lead` ;
- dédupliquer le `Lead` navigateur et le `Lead` serveur avec un `event_id` commun ;
- respecter le consentement marketing Complianz ;
- éviter de conserver le `fbclid`, `_fbp`, `_fbc` et le user-agent dans la base.

## Aucun changement automatique en production

Ce ZIP ne modifie ni le site en ligne, ni Supabase, ni Vercel, ni Meta Ads. Pour activer le suivi, suivre exactement :

`docs/META_ATTRIBUTION_CAPI_ROLLOUT.md`

## Fichiers principaux ajoutés

- `lib/signupAttribution.ts`
- `lib/metaConversionsApi.ts`
- `lib/signupAttributionPersistence.ts`
- `ops/sql/2026-08-29_signup_attribution_meta_capi.sql`
- `ops/wordpress-meta-attribution/inrcy-meta-attribution.js`
- `docs/META_ATTRIBUTION_CAPI_ROLLOUT.md`
- `tests/auth/signup-attribution-meta-capi.test.mts`

## Contrôles réalisés

- tests Auth et attribution : 30/30 réussis ;
- TypeScript complet : réussi ;
- ESLint ciblé : réussi ;
- syntaxe JavaScript WordPress : réussie ;
- build Next.js production : réussi (221 pages/routes générées).
