# Rollout Gemini Omni Flash — 2 septembre 2026

## État de référence et rollback

- Commit de référence avant intégration : `873d9287b21476750e25801a653b220324425a69`.
- Branche de sauvegarde : `backup-pre-omni-flash-20260902`.
- Rollback moteur sans retour de code : définir `AI_MEDIA_VIDEO_PROVIDER=google-veo-fast` dans Vercel puis redéployer.
- Mode normal : variable absente ou `AI_MEDIA_VIDEO_PROVIDER=auto` ; le choix effectué dans l’interface est alors respecté.

## Moteurs exposés

- **Rapide et précis** : `gemini-omni-1.1-flash`, 720p, plans natifs de 8 secondes. Les films longs génèrent leurs plans en parallèle par défaut ; l’option `connectScenes` les enchaîne depuis la dernière frame réelle du plan précédent.
- **Créatif et cinématique** : `veo-3.1-fast-generate-preview`, avec Lite comme secours interne non facturé.
- Veo Standard n’est ni sélectionné ni exposé par l’application.

Les durées commerciales 8, 16 et 24 secondes correspondent à un, deux ou trois plans natifs de 8 secondes. Omni et Veo Fast sont provisionnés à `100000` micro-USD par seconde (0,10 $/s) conformément au tarif 720p utilisé lors de ce rollout.

## Repli fiable

Un film de 8 secondes peut utiliser le secours Veo uniquement si Omni n’a encore renvoyé aucun actif facturable. Les films longs gardent le même moteur. Les inspirations génériques incompatibles peuvent être retirées, mais jamais les références d’identité obligatoires ni la frame de raccord. Un actif déjà produit mais impossible à télécharger ne déclenche jamais une seconde génération payante silencieuse.

Le raccord par frame utilise l’entrée image initiale de Veo et la balise `FIRST_FRAME` d’Omni. Il conserve 8/16/24 secondes sans rejouer un MP4 cumulatif. `connectScenes` est désactivé par défaut : les plans restent parallèles, avec des coupes possibles. Quand le pro coche « Raccorder les scènes » dans Finitions (bloc 4), sous les durées, une fenêtre informe du délai supplémentaire et les plans deviennent séquentiels ; musique, voix off et habillage restent préparés en parallèle. Aucun appel de génération n’est ajouté. La frame est extraite localement, puis supprimée. La continuité visuelle est guidée, pas garantie; elle ne verrouille pas la voix synthétique. L’opt-in `AI_MEDIA_OMNI_STATEFUL_CONTINUATION_ENABLED` ne s’applique que si le pro demande aussi le raccord. La vidéo de 8 secondes et l’animation locale d’identité n’ont pas de raccord à activer.

Omni demande désormais une livraison par URI : le serveur attend que le fichier Google passe à l’état `ACTIVE`, puis télécharge le MP4 authentifié. Ce flux évite la limite des réponses vidéo inline, qui pouvait tronquer un rendu 720p pourtant terminé.

Le coût réellement observé est enregistré dans le garde-fou économique. Les identifiants moteur/modèle et les avertissements de repli restent dans la provenance du média. L’écran de résultat indique aussi le moteur réellement utilisé ; un repli Veo Fast est affiché en orange et n’est jamais masqué au professionnel.

## Variables optionnelles

### Préférence de raccord — 9 septembre 2026

Les durées restent dans Finitions (bloc visuel 4). « Mémoriser ces réglages » conserve aussi `connectScenes` dans le bloc de stockage 6. Le raccord reste désactivé pour les anciens réglages, les images, les vidéos de 8 secondes et les animations locales d’identité ; aucun délai fixe de génération n’est promis.

Migration additive : `supabase/migrations/20260909210317_ai_media_connect_scenes_preference.sql`, appliquée sur le projet Application iNrCy. Elle étend uniquement l’allowlist du bloc 6, sans réécrire les préférences existantes ni modifier les autorisations, le verrou de compte ou la RPC v2. Les essais SQL utilisent des tables temporaires avec rollback, jamais les réglages réels d’un professionnel.

### Paramètres moteur

- `AI_MEDIA_OMNI_MODEL` (défaut `gemini-omni-1.1-flash`)
- `AI_MEDIA_OMNI_COST_MICRO_USD_PER_SECOND` (défaut `100000`)
- `AI_MEDIA_OMNI_FILE_POLL_MS` (défaut `2000`, maximum `10000`)
- `AI_MEDIA_OMNI_FALLBACK_TO_VEO` (défaut activé)
- `AI_MEDIA_VIDEO_TIMEOUT_MS` (défaut `420000`, maximum `600000`) : délai par plan, avec budget global du film plafonné à `600000` ms pour conserver la marge de montage de la route.

`AI_MEDIA_OMNI_CONCURRENCY` (défaut 3) et `AI_MEDIA_VEO_CONCURRENCY` (défaut 2) règlent le parallélisme sans raccord. Avec raccord, un seul plan est généré à la fois. Un échec attend la fin de tous les plans déjà lancés avant de clôturer la tentative et sa comptabilisation. Les tests locaux utilisent des fixtures et des fournisseurs simulés; valider le rendu et la latence réels en Preview avant déploiement. Aucun délai fixe en minutes n’est promis dans l’interface.

Ne surcharger ces valeurs qu’après un essai Preview 8/16/24 secondes en portrait et paysage.
