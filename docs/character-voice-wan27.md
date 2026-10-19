# Voix des personnages : Wan 2.7, Wan 3.0 et HeyGen

Dans iNr’Studio, chaque photo classée **Personnage** conserve son choix **Obligatoire / Inspiration** et propose **Voix IA** par défaut ou **Voix fournie**. La voix fournie peut être importée, enregistrée au microphone ou choisie dans le filtre **Audio** de la médiathèque, puis écoutée, remplacée et retirée. Les paroles et les actions restent dans le prompt. Le mode sonore **Personnages** est nécessaire pour utiliser les voix fournies.

Une voix fournie autorise **Wan 2.7 R2V**, **Wan 3.0** et **HeyGen Video**. Le moteur choisi est conservé s'il fait partie de ces trois ; un moteur incompatible bascule vers Wan 2.7. Les photos originales et leurs voix restent associées pendant chaque scène ; elles ne sont pas aplaties en une image commune. Le choix d'un moteur ne supprime pas les vocaux.

Les transports AI Gateway sont distincts :

- `alibaba/wan-v2.7-r2v` associe `referenceVoice` à chaque image de `providerOptions.alibaba.media`.
- `alibaba/wan-v3.0-video` reçoit les images puis les WAV signés dans `inputReferences`, avec leur `mediaType`. Le prompt associe chaque `Image N` à son `Audio M`, numérotés séparément. Les vocaux doivent durer au plus **15 secondes au total** ; le serveur contrôle aussi la durée réelle des WAV. Le Studio propose de raccourcir les échantillons ou de choisir un autre moteur en cas de dépassement.
- `heygen/heygen-video-1` utilise `providerOptions.heygen.mode = reference_to_video`, `referenceImages` et `referenceAudio`. Le prompt associe `<Picture N>` et `<Audio M>` et demande de reprendre le timbre pour le nouveau texte du prompt, en ignorant les paroles de l'enregistrement.

Le Studio accepte au plus trois voix et cinq médias visuels. Pour Wan 3.0 et HeyGen avec voix fournies, chaque plan réutilise les références originales : aucune première image de continuité n'est ajoutée, car ces modèles interdisent de combiner les références vocales avec une première image. Wan 2.7 conserve sa première image de continuité quand il reste un emplacement.

## Capacités et tarifs

Catalogue AI Gateway vérifié le 19 octobre 2026 :

| Réglage | Valeur |
| --- | --- |
| Photos de référence | De 1 à 5 |
| Vocal importé | MP3 ou WAV, de 1 à 10 secondes, maximum 3 MiB |
| Enregistrement | Microphone du navigateur, arrêt automatique après 10 secondes |
| Stockage audio normalisé | WAV PCM 16 bits, mono, 16 kHz, maximum 320 044 octets |
| Durée vidéo dans le Studio | De 4 à 10 secondes par scène ; jusqu’à 20 secondes avec deux scènes |
| 720p | Coût fournisseur estimé : 0,10 USD/s ; tarif Studio : 10 crédits/s |
| 1080p | Coût fournisseur estimé : 0,15 USD/s ; tarif Studio : 15 crédits/s |

Ces durées et tarifs concernent Wan 2.7. Le modèle accepte nativement 2 à 10 secondes ; le Studio conserve son minimum de 4 secondes par scène. Le coût fournisseur et les crédits commerciaux sont distincts. La préparation créative du mode Libre reste facturée 7 crédits ; la préparation d’une première image composée ne s’applique à aucun des trois moteurs lorsqu'une voix est fournie.

| Autre moteur avec voix fournie | Crédits Studio / seconde | Réservation fournisseur / seconde |
| --- | --- | --- |
| Wan 3.0 · 720p | 10 | 0,10 USD |
| Wan 3.0 · 1080p | 20 | 0,20 USD |
| HeyGen · 768p · références | 10 | 0,10 USD |
| HeyGen · 1080p · références | 18 | 0,18 USD |

HeyGen ajoute la borne existante de 4 crédits par image transmise, à chaque plan. Les bornes HeyGen utilisent les tarifs hors promotion ; l'offre du catalogue expirant le 31 octobre 2026 est temporairement inférieure. Le mode HeyGen sans voix fournie garde son tarif image-vers-vidéo actuel. Le devis signé déduit la présence de vocaux des références validées lors de la génération ; le client ne peut pas imposer le tarif d'un autre mode. Version du tarif : `inrstudio-media-credits-2026-10-v4`.

## Stockage et configuration

Deux copies privées ont des cycles de vie distincts dans le bucket `inrcy-pro-media` :

- **Médiathèque** : une copie durable, réutilisable dans le filtre **Audio**, liée au compte dans `pro_media_library` avec `media_type = 'audio'`. Les imports MP3/WAV de la médiathèque sont limités à 3 MiB et 5 minutes. Les vocaux issus de l’import ou du microphone du Studio y sont également conservés. Chaque vocal choisi dans le Studio doit durer de 1 à 10 secondes.
- **Génération Studio** : un échantillon temporaire normalisé sous `_studio-voice-references/`, lié au compte et expirant après 24 heures. Le cron existant `/api/cron/media-orphan-cleanup` supprime les objets expirés correspondant à ce préfixe et à ce format de chemin.

Retirer ou remplacer une voix dans le Studio supprime uniquement sa référence temporaire. Cela ne supprime jamais le vocal durable de la médiathèque. La suppression volontaire dans la médiathèque utilise son action de suppression habituelle. Les chemins durables restent hors du préfixe nettoyé par le cron des échantillons.

L’aperçu exige une session authentifiée. Les URL temporaires destinées au moteur sont signées pour 30 minutes. L’ajout du type Audio nécessite la migration `supabase/migrations/20261019113912_character_voice_audio_library.sql`, qui élargit uniquement la contrainte `pro_media_library_media_type_check` à `image`, `video`, `audio`. Les politiques RLS et les autres colonnes ne changent pas. Aucun lien vers `media_assets` n’apparaît dans les migrations suivies ; vérifier les contraintes et triggers de l’environnement cible avant application.

Le bucket doit autoriser `audio/wav`. Le script réutilise le SDK Supabase installé et lit `SUPABASE_URL` ou `NEXT_PUBLIC_SUPABASE_URL`, ainsi que `SUPABASE_SERVICE_ROLE_KEY`. Utiliser l’environnement serveur prévu pour le projet ; ne pas exposer cette clé dans le navigateur.

Vérification sans modification, depuis la racine du dépôt :

```powershell
node --use-system-ca --env-file=.env.local scripts/configure-character-voice-storage.mjs --check
```

Si le résultat contient `"ready":false`, appliquer la seule modification MIME nécessaire :

```powershell
node --use-system-ca --env-file=.env.local scripts/configure-character-voice-storage.mjs --apply
```

Le mode `--check` est aussi le mode par défaut. Codes de sortie : `0` si prêt, `2` si une modification est nécessaire, `1` en cas d’erreur. Le script refuse un bucket public. Il conserve les MIME existants et la limite de taille, ajoute seulement `audio/wav` à une liste restrictive qui ne l’autorise pas, puis relit et vérifie le résultat. Une liste MIME vide ou non définie autorise déjà les fichiers WAV. Chaque requête réseau expire après 12 secondes ; les diagnostics n’affichent ni URL ni clé.

## Vérifications restantes avant validation client

Les tests locaux couvrent les formats audio, les durées, les droits d’accès, la signature par personnage, les erreurs et le nettoyage, avec des services simulés et du son synthétique décodé par FFmpeg. Ils ne prouvent pas le rendu du modèle vidéo.

Effectuer un essai autorisé avec un vrai échantillon français pour vérifier la ressemblance vocale, le respect des paroles du prompt, le visage et les lèvres synchronisées. Tester également deux personnages avec deux voix, deux scènes, les formats d’image et les deux résolutions. Vérifier dans l’environnement déployé l’import, le microphone, la lecture privée, l’annulation, le filtre Audio, le choix d’un vocal existant, sa conservation après retrait dans le Studio, le nettoyage temporaire après 24 heures et la facturation. Aucun résultat vocal ou dialogue français fidèle n’est garanti par le catalogue.

Références : [Wan 2.7 R2V](https://vercel.com/ai-gateway/models/wan-v2.7-r2v), [Wan 3.0 et références audio sur Gateway](https://vercel.com/changelog/wan-3-0-now-available-on-ai-gateway), [options HeyGen du SDK](https://ai-sdk.dev/providers/ai-sdk-providers/heygen), [voix de référence HeyGen](https://runware.ai/docs/models/heygen-video-1-0/guides/audio-references), [mise à jour d’un bucket Supabase](https://supabase.com/docs/reference/javascript/storage-updatebucket).
