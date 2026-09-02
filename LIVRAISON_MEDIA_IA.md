# Livraison iNrCy — Studio de génération d’images et de vidéos IA

Cette livraison transforme « Générer un média » en une fenêtre iNrCy unique, réutilisée depuis le Menu, Booster et iNrSend. Les brouillons privés et compteurs Supabase existants sont conservés. La migration additive `ops/sql/2026-09-02_ai_media_video_durations_8_16_24.sql` ajoute uniquement la durée maximale pilotable par forfait et par établissement.

## Expérience utilisateur

- Écran 1 : six blocs compacts et repliables — Création, Contenu, Univers, Cadrage, Identité et Finitions — pour garder tous les réglages dans la même fenêtre sans surcharge.
- Le sujet libre peut être dicté au microphone ; la transcription réutilise le service vocal sécurisé de Booster.
- Chaque bloc se déplie dans le flux de la fenêtre et repousse proprement les suivants ; aucun menu ne passe derrière un autre bloc.
- Écran 2 : création plein écran, progression, grand aperçu, validation dans la Médiathèque ou régénération.
- Formats : carré 1:1, portrait 4:5, Story/Reel 9:16 et paysage 16:9.
- Vidéos : 8, 16 ou 24 secondes, avec 8 secondes sélectionnées par défaut dans l’interface.

## Images originales

- Le média final est créé par GPT Image 2 via Vercel AI Gateway.
- Le modèle reçoit trois sources seulement : le sujet actuel, les faits vérifiés du Profil et le logo officiel de l’établissement actif.
- Le logo est l’unique image de référence. Aucune photo de la Médiathèque, aucun ancien média et aucune photo de publication ne sont envoyés au modèle.
- La palette est extraite du vrai logo et le prompt exige une intégration discrète, fidèle, non rognée et limitée à une seule occurrence.
- Les mots proposés dans « Finitions » sont des thèmes éditoriaux : un mini-copywriter les transforme en une vraie accroche française courte. Ils ne sont jamais concaténés avec `+`, `·` ou `/`.
- L’idée du bloc 1 inspire l’accroche sans être recopiée mot pour mot. Aucun habillage graphique massif n’est collé après la génération.
- Le résultat est normalisé en JPEG sRGB aux dimensions exactes du format choisi.

## Vraies vidéos IA originales

- Fournisseur : Google Veo 3.1 via l’API Gemini, côté serveur uniquement. La chaîne par défaut essaie Fast (`veo-3.1-fast-generate-preview`), puis Lite (`veo-3.1-lite-generate-preview`) si Fast refuse un rendu non facturé.
- Chaque plan iNrCy dure nativement 8 secondes, la durée la plus simple à assembler et la seule compatible avec plusieurs images de référence sur les modèles qui les acceptent.
- iNrCy lance les plans avec une concurrence bornée puis assemble exactement 8 secondes (1 plan), 16 secondes (2 plans) ou 24 secondes (3 plans), sans coupe partielle.
- L’ancien diaporama basé sur les images de la Médiathèque a été supprimé. Aucun visuel existant du pro n’est utilisé comme faux plan vidéo.
- Chaque plan reçoit un brief Veo compact construit avec l’idée, l’entreprise, le métier, les prestations, les forces, la clientèle, la localisation, la scène et la direction artistique. Le contexte reste sous la limite du modèle et interdit toute fausse écriture générée.
- Logo, palette et textes exacts sont ajoutés après génération par iNrCy. Le texte peut être activé ou désactivé.
- La voix off est facultative. Un scénariste IA transforme l’idée et les faits vérifiés du Profil en un mini-récit naturel adapté à 8, 16 ou 24 secondes ; Gemini TTS lit ensuite exactement ce script. Le script brut n’est pas conservé dans les métadonnées.
- La musique iNrCy est facultative et mixée avec l’ambiance native. Quand la voix est active, ambiance et musique sont automatiquement abaissées pour garder les paroles intelligibles.
- Sortie : MP4 H.264/AAC, 30 fps, pixel format `yuv420p`, métadonnées nettoyées et `faststart`.
- Le contrat final impose au plus 24 secondes et moins de 74 Mo afin de garder une marge sous les limites de publication les plus strictes prises en charge.

Aux tarifs publics contrôlés le 1er septembre 2026, Veo 3.1 Fast coûte environ 0,10 USD/s, soit 0,80 USD, 1,60 USD ou 2,40 USD pour 8/16/24 s. Le secours Lite coûte environ 0,05 USD/s, soit 0,40 USD, 0,80 USD ou 1,20 USD. Le garde-fou réserve le candidat configuré le plus cher, puis comptabilise le modèle réellement facturable.

## Fiabilité et sécurité

- `GEMINI_API_KEY` est obligatoire en Production et reste exclusivement côté serveur ; aucune clé n’est envoyée au navigateur ni stockée dans le dépôt.
- Le SDK Google Gen AI officiel soumet et suit chaque opération longue Veo. Les fichiers sont téléchargés par le client Google officiel.
- Taille de téléchargement bornée, timeouts, validation FFmpeg de chaque clip et du fichier final.
- Les plans sont lancés avec une concurrence bornée à 2 par défaut pour rester compatible avec les faibles quotas RPM d’un nouveau projet Google. `AI_MEDIA_VEO_CONCURRENCY` permet de monter jusqu’à 4 après vérification du plafond réel dans AI Studio. Les erreurs 408/429/5xx et réseau sont retentées avec temporisation exponentielle et jitter. Un paramètre d’inspiration incompatible est retiré automatiquement (`3 références` → `image source` → `sans image`) avant d’abandonner la génération.
- Les modèles retirés Veo 2/3.0 et tout identifiant inconnu sont ignorés au profit du modèle actif par défaut avant réservation. Aucun deuxième rendu n’est soumis après réception d’une vidéo facturable : seul son téléchargement est retenté.
- La voix off et la musique sont des améliorations facultatives : leur indisponibilité est enregistrée comme avertissement et la vidéo continue avec son ambiance Veo, sans perdre un rendu valide.
- Chaque clip téléchargé est vérifié comme MP4, puis le fichier final est certifié H.264, `yuv420p`, 30 fps, AAC si attendu, dimensions et durée exactes.
- Après validation d’un brouillon, Booster utilise une URL applicative stable qui recrée une signature Storage à chaque lecture. Sur mobile, l’acceptation et le téléchargement retentent le même média en cas de `Load failed` : aucune seconde génération ni consommation de quota n’est déclenchée, et le média déjà créé reste récupérable dans la Médiathèque.
- Garde-fou économique et quota mensuel restent isolés par établissement actif.
- Standard : 20 images et 5 vidéos de 8 secondes par mois. Premium et Founder : 30 images et 6 vidéos par mois, avec choix 8, 16 ou 24 secondes. Les nombres et la durée maximale restent surchargeables par établissement dans Supabase ; une limite à zéro désactive la génération correspondante. Seul l’admin global iNrCy est affiché comme illimité, avec un fusible technique anti-boucle à 10 000 opérations.
- Idempotence par `requestId` : une réponse navigateur incertaine ne doit pas créer une seconde facture.
- Le brief libre n’est pas persisté ; seules sa version et son empreinte SHA-256 sont enregistrées.
- Les brouillons restent privés et ne sont conservés qu’après validation explicite.

## Variables serveur

Obligatoires :

- `GEMINI_API_KEY` pour les vidéos Veo et la voix Gemini TTS ;
- `AI_GATEWAY_API_KEY` ou `VERCEL_OIDC_TOKEN` pour les images via AI Gateway ;
- les variables Supabase, KV et Storage déjà requises par l’application.

Surcharges optionnelles, à calibrer uniquement en Preview :

- `AI_MEDIA_VIDEO_PROVIDER` (défaut `google-veo-fast`) ;
- `AI_MEDIA_VIDEO_TIMEOUT_MS` ;
- `AI_MEDIA_VEO_MODEL` ;
- `AI_MEDIA_VEO_FALLBACK_MODELS` (défaut Lite ; chaîne vide pour désactiver le secours) ;
- `AI_MEDIA_VEO_FAST_COST_MICRO_USD_PER_SECOND`, `AI_MEDIA_VEO_LITE_COST_MICRO_USD_PER_SECOND` et `AI_MEDIA_VEO_STANDARD_COST_MICRO_USD_PER_SECOND` ;
- `AI_MEDIA_VEO_COST_MICRO_USD_PER_SECOND` reste l’alias historique du coût Fast ;
- `AI_MEDIA_VEO_POLL_MS` ;
- `AI_MEDIA_VEO_CONCURRENCY` ;
- `AI_MEDIA_TTS_MODEL`, `AI_MEDIA_TTS_VOICE`, `AI_MEDIA_TTS_TIMEOUT_MS` et `AI_MEDIA_TTS_COST_MICRO_USD` ;
- `AI_MEDIA_COPY_MODEL` ;
- `AI_GATEWAY_IMAGE_MODEL` et `AI_MEDIA_IMAGE_COST_MICRO_USD`.

## Validation avant production

1. Exécuter `npm run test:ai-media-generation`, `npm run typecheck`, `npm run lint` et `npm run build`.
2. Contrôler la fenêtre sur ordinateur et mobile, notamment dictée, menus repliables, formats et revue du résultat.
3. Effectuer un smoke image réel sur un établissement de test.
4. Après validation explicite du coût, effectuer un seul smoke vidéo Veo de 8 secondes (coût Fast indicatif 0,80 USD).
5. Vérifier le média privé dans le bon établissement, son quota, son poids, sa durée et sa lecture dans Booster/iNrSend.

Les tests automatisés ne contactent ni Gemini/Veo ni AI Gateway et ne consomment aucun crédit fournisseur.
