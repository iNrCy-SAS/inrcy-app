# Livraison iNrCy — Studio de génération d’images et de vidéos IA

Cette livraison transforme « Générer un média » en une fenêtre iNrCy unique, réutilisée depuis le Menu, Booster et iNrSend. Les brouillons privés, compteurs et tables Supabase existants sont conservés. Le remplacement du moteur vidéo ne nécessite aucune nouvelle migration SQL.

## Expérience utilisateur

- Écran 1 : six blocs compacts et repliables — Création, Contenu, Univers, Cadrage, Identité et Finitions — pour garder tous les réglages dans la même fenêtre sans surcharge.
- Le sujet libre peut être dicté au microphone ; la transcription réutilise le service vocal sécurisé de Booster.
- Chaque bloc se déplie dans le flux de la fenêtre et repousse proprement les suivants ; aucun menu ne passe derrière un autre bloc.
- Écran 2 : création plein écran, progression, grand aperçu, validation dans la Médiathèque ou régénération.
- Formats : carré 1:1, portrait 4:5, Story/Reel 9:16 et paysage 16:9.
- Vidéos : 10, 20 ou 30 secondes, 20 secondes par défaut.

## Images originales

- Le média final est créé par GPT Image 2 via Vercel AI Gateway.
- Le modèle reçoit trois sources seulement : le sujet actuel, les faits vérifiés du Profil et le logo officiel de l’établissement actif.
- Le logo est l’unique image de référence. Aucune photo de la Médiathèque, aucun ancien média et aucune photo de publication ne sont envoyés au modèle.
- La palette est extraite du vrai logo et le prompt exige une intégration discrète, fidèle, non rognée et limitée à une seule occurrence.
- Les mots proposés dans « Finitions » sont des thèmes éditoriaux : un mini-copywriter les transforme en une vraie accroche française courte. Ils ne sont jamais concaténés avec `+`, `·` ou `/`.
- L’idée du bloc 1 inspire l’accroche sans être recopiée mot pour mot. Aucun habillage graphique massif n’est collé après la génération.
- Le résultat est normalisé en JPEG sRGB aux dimensions exactes du format choisi.

## Vraies vidéos IA originales

- Fournisseur unique : Google Veo 3.1 Fast (`veo-3.1-fast-generate-preview`) via l’API Gemini, côté serveur uniquement.
- Veo crée de vrais plans animés originaux de 4, 6 ou 8 secondes avec ambiance native.
- iNrCy lance les plans en parallèle puis assemble exactement 10 secondes (6+4), 20 secondes (8+8+4) ou 30 secondes (8+8+8+6).
- L’ancien diaporama basé sur les images de la Médiathèque a été supprimé. Aucun visuel existant du pro n’est utilisé comme faux plan vidéo.
- Chaque plan reçoit un brief Veo compact construit avec l’idée, l’entreprise, le métier, les prestations, les forces, la clientèle, la localisation, la scène et la direction artistique. Le contexte reste sous la limite du modèle et interdit toute fausse écriture générée.
- Logo, palette et textes exacts sont ajoutés après génération par iNrCy. Le texte peut être activé ou désactivé.
- La voix off est facultative. Un scénariste IA transforme l’idée et les faits vérifiés du Profil en un mini-récit naturel adapté à 10, 20 ou 30 secondes ; Gemini TTS lit ensuite exactement ce script. Le script brut n’est pas conservé dans les métadonnées.
- La musique iNrCy est facultative et mixée avec l’ambiance native. Quand la voix est active, ambiance et musique sont automatiquement abaissées pour garder les paroles intelligibles.
- Sortie : MP4 H.264/AAC, 30 fps, pixel format `yuv420p`, métadonnées nettoyées et `faststart`.
- Le contrat final impose au plus 30 secondes et moins de 74 Mo afin de rester sous les limites officielles de Google Business (30 s / 75 Mo / 720p minimum).

Au tarif public Veo 3.1 Fast 720p avec audio contrôlé le 1er septembre 2026 (0,10 USD par seconde générée), le coût fournisseur estimatif est de 1 USD pour 10 s, 2 USD pour 20 s et 3 USD pour 30 s. La valeur comptable reste configurable côté serveur si le tarif évolue.

## Fiabilité et sécurité

- `GEMINI_API_KEY` est obligatoire en Production et reste exclusivement côté serveur ; aucune clé n’est envoyée au navigateur ni stockée dans le dépôt.
- Le SDK Google Gen AI officiel soumet et suit chaque opération longue Veo. Les fichiers sont téléchargés par le client Google officiel.
- Taille de téléchargement bornée, timeouts, validation FFmpeg de chaque clip et du fichier final.
- Les plans sont lancés avec une concurrence bornée à 2 par défaut pour rester compatible avec les faibles quotas RPM d’un nouveau projet Google. `AI_MEDIA_VEO_CONCURRENCY` permet de monter jusqu’à 4 après vérification du plafond réel dans AI Studio. Les refus temporaires 429/5xx sont retentés avec temporisation. En cas d’échec partiel, aucun nouveau plan n’est démarré et les jobs déjà soumis sont comptabilisés de manière conservatrice.
- Garde-fou économique et quota mensuel restent isolés par établissement actif.
- Standard : 20 images et 5 vidéos de 10 secondes par mois, afin de faire découvrir le moteur sans ouvrir les formats les plus coûteux. Les durées 20 et 30 secondes sont réservées à Premium et Founder, qui disposent de 30 images / 10 vidéos. Seul l’admin global iNrCy est affiché comme illimité, avec un fusible technique anti-boucle à 10 000 opérations.
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
- `AI_MEDIA_VEO_COST_MICRO_USD_PER_SECOND` ;
- `AI_MEDIA_VEO_POLL_MS` ;
- `AI_MEDIA_VEO_CONCURRENCY` ;
- `AI_MEDIA_TTS_MODEL`, `AI_MEDIA_TTS_VOICE`, `AI_MEDIA_TTS_TIMEOUT_MS` et `AI_MEDIA_TTS_COST_MICRO_USD` ;
- `AI_MEDIA_COPY_MODEL` ;
- `AI_GATEWAY_IMAGE_MODEL` et `AI_MEDIA_IMAGE_COST_MICRO_USD`.

## Validation avant production

1. Exécuter `npm run test:ai-media-generation`, `npm run typecheck`, `npm run lint` et `npm run build`.
2. Contrôler la fenêtre sur ordinateur et mobile, notamment dictée, menus repliables, formats et revue du résultat.
3. Effectuer un smoke image réel sur un établissement de test.
4. Après validation explicite du coût, effectuer un seul smoke vidéo Veo de 10 secondes (coût indicatif 1 USD).
5. Vérifier le média privé dans le bon établissement, son quota, son poids, sa durée et sa lecture dans Booster/iNrSend.

Les tests automatisés ne contactent ni Gemini/Veo ni AI Gateway et ne consomment aucun crédit fournisseur.
