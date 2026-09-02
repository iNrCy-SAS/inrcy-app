# Rollout Gemini Omni Flash — 2 septembre 2026

## État de référence et rollback

- Commit de référence avant intégration : `873d9287b21476750e25801a653b220324425a69`.
- Branche de sauvegarde : `backup-pre-omni-flash-20260902`.
- Rollback moteur sans retour de code : définir `AI_MEDIA_VIDEO_PROVIDER=google-veo-fast` dans Vercel puis redéployer.
- Mode normal : variable absente ou `AI_MEDIA_VIDEO_PROVIDER=auto` ; le choix effectué dans l’interface est alors respecté.

## Moteurs exposés

- **Rapide et précis** : `gemini-omni-1.1-flash`, 720p, plans natifs de 8 secondes, trois plans simultanés au maximum par défaut.
- **Créatif et cinématique** : `veo-3.1-fast-generate-preview`, avec Lite comme secours interne non facturé.
- Veo Standard n’est ni sélectionné ni exposé par l’application.

Les durées commerciales 8, 16 et 24 secondes correspondent à un, deux ou trois plans natifs de 8 secondes. Omni et Veo Fast sont provisionnés à `100000` micro-USD par seconde (0,10 $/s) conformément au tarif 720p utilisé lors de ce rollout.

## Repli fiable

Une scène Omni peut être recréée par Veo uniquement si Omni n’a encore renvoyé aucun actif facturable pour cette scène. Les images d’inspiration incompatibles sont d’abord retirées automatiquement et un cadrage de sécurité professionnel est tenté. Une scène Omni déjà produite mais impossible à télécharger ne déclenche jamais une seconde génération payante silencieuse.

Le coût réellement observé est enregistré dans le garde-fou économique. Les identifiants moteur/modèle et les avertissements de repli restent dans la provenance du média.

## Variables optionnelles

- `AI_MEDIA_OMNI_MODEL` (défaut `gemini-omni-1.1-flash`)
- `AI_MEDIA_OMNI_COST_MICRO_USD_PER_SECOND` (défaut `100000`)
- `AI_MEDIA_OMNI_CONCURRENCY` (défaut `3`, maximum `4`)
- `AI_MEDIA_OMNI_FALLBACK_TO_VEO` (défaut activé)
- `AI_MEDIA_VIDEO_TIMEOUT_MS` (défaut `420000`, maximum `600000`)

Ne surcharger ces valeurs qu’après un essai Preview 8/16/24 secondes en portrait et paysage.
