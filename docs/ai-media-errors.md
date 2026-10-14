# Erreurs de génération image et vidéo — iNrStudio

Inventaire du 14 octobre 2026. Source : historique des tâches terminées en échec ou expirées, lu sans modifier les comptes.

Périmètre : 331 tentatives, du 31 août au 14 octobre 2026, extraction complète à 2026-10-14T21:13:20.478Z. Ces tentatives comprennent des tests, des reprises et des anciennes versions. Ce ne sont pas 331 clients affectés. Aucun taux d’échec ne peut être déduit sans le nombre total de générations.

52 réponses approuvées. 330 enregistrements peuvent être rattachés à une famille ; un ancien échec ne contient aucune cause exploitable et conserve une réponse honnête « cause non identifiable ». Une famille reconnue ne prouve pas à elle seule la cause technique sous-jacente lorsqu’un ancien journal manque de détails.

## Corrections apportées

- Veo Lite : résolution native canonique 1280x720 ou 1920x1080 ; orientation transmise séparément. Le format vertical ne provoque plus le refus local « Invalid resolution: 720x1280 ». Le brief, le tarif et le découpage ne changent pas.
- Narration Libre automatique : le budget de mots est vérifié dans la rédaction IA, avant TTS et vidéo, pour utiliser le secours de texte existant si la première réponse dépasse la durée. Aucun nouvel appel vidéo automatique. Les citations exactes du pro restent intactes et ne passent pas par la réécriture.
- Réponse initiale et récupération après déconnexion : catalogue commun, code stable conservé avec le message. Les raisons enregistrées ne sont plus remplacées par un échec générique pendant la récupération.
- Priorité aux causes précises : une voix trop longue prime sur « narration indisponible » ; un plafond fournisseur prime sur « trop de demandes » ; un refus de sécurité prime sur son enveloppe technique.
- Une interruption réseau ne devient plus automatiquement « arrêt à votre demande ». Seul le marqueur explicite d’annulation utilise cette explication.

## Analyse et limites des corrections

| Famille historique | Décision |
| --- | --- |
| Narration préparée trop longue | Correction active de validation et secours de rédaction. Les anciennes traces ne distinguent pas toujours texte généré et texte imposé. Les nouveaux codes les séparent. |
| Répliques et textes exacts trop longs | Garder la protection contre la coupure de mots ; expliquer durée supérieure ou texte plus court. |
| Limite de taille de consigne compilée | Ne pas tronquer le prompt créatif silencieusement. Expliquer que la limite peut provenir de la préparation interne, proposer autre moteur ou demande plus courte. |
| Scénario incomplet, nombre de segments incohérent | Anciennes erreurs de préparation : conserver les contrôles avant vidéo. Leur présence historique ne justifie pas de supprimer la validation. Message technique clair et assistance si récurrent. |
| Réglage fournisseur incompatible | Veo Lite vertical corrigé. Les autres erreurs de paramètres datent d’intégrations antérieures ; ne pas les attribuer au prompt ni réactiver des paramètres rejetés. |
| Plafond fournisseur / accès technique | Réglage ou intervention fournisseur nécessaire ; autre moteur ou assistance. Ne pas conseiller de recharger le portefeuille iNrCy ni de répéter la même requête à la minute. |
| Plafond de sécurité du compte | Protection économique indépendante des crédits ; aucun relèvement automatique du plafond. |
| Modération / références refusées | Respecter le refus ; message adapté, sans prétendre connaître une règle précise non fournie. Référence à remplacer ou scène à reformuler selon le diagnostic. |
| Audio manquant, interrompu, répété ou différent | Conserver le contrôle qualité et différencier les messages. Ne pas livrer une vidéo incorrecte en prétendant qu’elle respecte les paroles. |
| Panne, saturation, timeout ou connexion interrompue | Message distinct et nouvelle tentative explicite. Aucun doublon vidéo payant automatique. |
| Fichier inutilisable, montage ou réponse IA invalide | Échec technique ; réessayer ou assistance. Ne pas inventer une faute du pro. |
| Cause absente | Dire qu’elle n’est pas identifiable, demander moteur et heure pour le diagnostic. |

## Fréquences dans l’historique

| Code public retenu | Tentatives |
| --- | ---: |
| AI_MEDIA_NARRATION_TOO_LONG | 115 |
| AI_MEDIA_VIDEO_INSTRUCTION_TOO_COMPLEX | 36 |
| AI_MEDIA_ACCOUNT_DAILY_SAFETY_LIMIT | 32 |
| AI_MEDIA_VIDEO_PREPARATION_FAILED | 25 |
| AI_MEDIA_PROVIDER_BUDGET_EXHAUSTED | 15 |
| AI_MEDIA_VIDEO_CONFIGURATION_REJECTED | 13 |
| AI_MEDIA_VIDEO_SAFETY_FILTERED | 12 |
| AI_MEDIA_CHARACTER_DIALOGUE_UNAVAILABLE | 11 |
| AI_MEDIA_IMAGE_PROVIDERS_UNAVAILABLE | 9 |
| AI_MEDIA_DIALOGUE_TOO_LONG | 9 |
| AI_MEDIA_EXACT_TEXT_TOO_DENSE | 9 |
| AI_MEDIA_VISIBLE_COPY_UNAVAILABLE | 7 |
| AI_MEDIA_NARRATION_UNAVAILABLE | 6 |
| AI_MEDIA_VIDEO_SPEECH_MISMATCH | 5 |
| AI_MEDIA_VIDEO_NATIVE_SPEECH_REJECTED | 4 |
| AI_MEDIA_CHARACTER_DIALOGUE_MISSING | 4 |
| AI_MEDIA_REFERENCE_POLICY_REJECTED | 2 |
| AI_MEDIA_EXACT_NARRATION_TOO_LONG | 2 |
| AI_MEDIA_VIDEO_SPEECH_INCOMPLETE | 2 |
| AI_MEDIA_VIDEO_PROVIDER_UNAVAILABLE | 2 |
| AI_MEDIA_GATEWAY_NOT_CONFIGURED | 1 |
| AI_MEDIA_VIDEO_INCOMPLETE | 1 |
| AI_MEDIA_AUDIO_SAFETY_FILTERED | 1 |
| AI_MEDIA_VIDEO_COMPOSITION_FAILED | 1 |
| AI_MEDIA_GENERATION_FAILED | 1 |
| AI_MEDIA_EXACT_DIALOGUE_INVALID | 1 |
| AI_MEDIA_CONNECTION_INTERRUPTED | 1 |
| AI_MEDIA_PREPARATION_OUTPUT_INVALID | 1 |
| AI_MEDIA_VIDEO_CAPACITY_REACHED | 1 |
| AI_MEDIA_VIDEO_SPEECH_REPEATED | 1 |
| AI_MEDIA_GENERATION_TIMEOUT | 1 |

## Catalogue des messages

Le texte affiché au pro associe la raison et l’action ci-dessous. Les champs fournisseur, URL privées, secrets, médias et prompts ne sont jamais recopiés dans le message public. Les détails techniques sélectionnés restent dans les journaux serveur ; le catalogue ne promet pas de remboursement ou d’absence de facturation sans preuve du portefeuille.

| Code | Explication | Action proposée |
| --- | --- | --- |
| AI_MEDIA_QUOTA_REACHED | Le solde disponible ne suffit pas pour cette génération. | Choisissez un moteur moins coûteux, réduisez la durée ou rechargez vos crédits. |
| AI_MEDIA_CREDIT_QUOTE_CHANGED | Le coût de la génération a changé depuis sa préparation. | Actualisez le coût affiché, puis confirmez à nouveau la génération. |
| AI_MEDIA_CREDITS_NOT_READY | Le portefeuille de crédits média est momentanément indisponible. | Contactez l’assistance si le problème persiste. Recharger vos crédits ne corrigera pas cette indisponibilité. |
| AI_MEDIA_ACCOUNT_ACCESS_DENIED | Votre session n’a pas accès à l’établissement de cette génération. | Sélectionnez le bon établissement ou reconnectez-vous avant de réessayer. |
| AI_MEDIA_IDEMPOTENCY_CONFLICT | Cette tentative existe déjà avec une autre demande. | Revenez à votre demande et lancez une nouvelle génération. |
| AI_MEDIA_GENERATED_NARRATION_INVALID | La voix off générée automatiquement n’a pas respecté la durée disponible. | Réessayez ou choisissez une durée plus longue. Votre prompt n’a pas été identifié comme trop long ; c’est la préparation automatique de la narration qui a échoué. |
| AI_MEDIA_EXACT_NARRATION_TOO_LONG | Le texte exact demandé pour la voix off est trop long pour cette durée. | Raccourcissez les paroles entre guillemets ou augmentez la durée. Vos paroles exactes ne seront pas coupées automatiquement. |
| AI_MEDIA_NARRATION_TOO_LONG | La voix off préparée est trop longue pour la durée choisie. | Choisissez une durée plus longue ou demandez une narration plus courte. Si vous avez fourni des paroles exactes, raccourcissez-les. |
| AI_MEDIA_DIALOGUE_TOO_LONG | Une réplique ne tient pas dans le plan vidéo prévu. | Raccourcissez les répliques ou choisissez une durée plus longue avec plusieurs plans. |
| AI_MEDIA_EXACT_TEXT_TOO_DENSE | Les textes ou les valeurs exactes demandés sont trop nombreux pour cette durée. | Réduisez les éléments à afficher ou augmentez la durée de la vidéo. |
| AI_MEDIA_EXACT_DIALOGUE_INVALID | Les paroles exactes n’ont pas pu être préparées en respectant votre demande. | Indiquez des phrases complètes entre guillemets, adaptées à la durée choisie. |
| AI_MEDIA_CHARACTER_DIALOGUE_MISSING | La préparation des répliques des personnages est incomplète. | Précisez qui parle et les phrases à prononcer dans votre prompt, puis réessayez. |
| AI_MEDIA_VIDEO_SPEECH_MISSING | Aucune parole n’a été détectée dans la vidéo créée par le moteur. | Réessayez avec des répliques courtes ou choisissez un autre moteur. |
| AI_MEDIA_VIDEO_SPEECH_INCOMPLETE | Une réplique s’interrompt avant la fin dans la vidéo créée. | Raccourcissez les paroles ou augmentez la durée, puis relancez la génération. |
| AI_MEDIA_VIDEO_SPEECH_REPEATED | Le contrôle audio a détecté des paroles répétées dans la vidéo. | Réessayez ou choisissez un autre moteur pour obtenir un nouveau rendu. |
| AI_MEDIA_VIDEO_SPEECH_MISMATCH | Les paroles de la vidéo ne correspondent pas aux répliques prévues. | Indiquez des répliques courtes entre guillemets ou essayez un autre moteur. |
| AI_MEDIA_VIDEO_NATIVE_SPEECH_REJECTED | Les paroles créées par le moteur n’ont pas passé le contrôle audio. | Réessayez avec des répliques plus courtes ou choisissez un autre moteur. |
| AI_MEDIA_CHARACTER_DIALOGUE_UNAVAILABLE | Le service n’a pas pu préparer les voix des personnages. | Réessayez dans quelques instants. Si le problème persiste, contactez l’assistance. |
| AI_MEDIA_NARRATION_UNAVAILABLE | La préparation de la voix off a échoué. | Réessayez dans quelques instants. Vous pouvez aussi désactiver la voix off si elle n’est pas nécessaire. |
| AI_MEDIA_VISIBLE_COPY_UNAVAILABLE | Le texte destiné au visuel n’a pas pu être préparé. | Précisez le texte souhaité entre guillemets dans le prompt ou réessayez dans quelques instants. |
| AI_MEDIA_ACCOUNT_DAILY_SAFETY_LIMIT | Le plafond quotidien de sécurité IA de ce compte est atteint. | Réessayez après le renouvellement du plafond ou contactez l’assistance. Recharger vos crédits ne relève pas ce plafond technique. |
| AI_MEDIA_ACCOUNT_SAFETY_LIMIT | Un plafond de sécurité IA de ce compte est atteint. | Réessayez plus tard ou contactez l’assistance. Ce plafond technique est distinct de votre solde de crédits. |
| AI_MEDIA_GUARD_UNAVAILABLE | La vérification des limites de génération est momentanément indisponible. | Patientez quelques minutes avant de réessayer. |
| AI_MEDIA_PROVIDER_BUDGET_EXHAUSTED | Le fournisseur du moteur a atteint un plafond technique de quota ou de facturation. | Choisissez un autre moteur ou contactez l’assistance. Votre prompt et votre solde de crédits iNrCy ne sont pas en cause. |
| AI_MEDIA_GATEWAY_NOT_CONFIGURED | L’accès technique à ce moteur est indisponible. | Choisissez un autre moteur ou contactez l’assistance. Modifier votre prompt ne résoudra pas ce problème. |
| AI_MEDIA_VIDEO_CAPACITY_REACHED | Le moteur reçoit trop de demandes pour le moment. | Patientez une minute avant de réessayer ou choisissez un autre moteur. |
| AI_MEDIA_GENERATION_TIMEOUT | Le moteur n’a pas terminé dans le délai disponible. | Réessayez plus tard ou choisissez un autre moteur. Ce délai ne signifie pas que votre prompt a été refusé. |
| AI_MEDIA_CONNECTION_INTERRUPTED | La connexion au service de génération a été interrompue avant la fin. | Vérifiez votre connexion, puis réessayez. Votre prompt n’a pas été identifié comme la cause de cet échec. |
| AI_MEDIA_GENERATION_CANCELLED | La génération a été arrêtée à votre demande. | Vous pouvez lancer une nouvelle génération lorsque vous le souhaitez. |
| AI_MEDIA_GENERATION_EXPIRED | Cette tentative a expiré sans résultat récupérable. | Vous pouvez lancer une nouvelle génération ou contacter l’assistance si cela se répète. |
| AI_MEDIA_REFERENCE_POLICY_REJECTED | Le fournisseur a refusé une image de référence selon ses règles de sécurité. | Retirez ou remplacez la référence concernée, puis réessayez. Un autre moteur peut appliquer des règles différentes. |
| AI_MEDIA_AUDIO_SAFETY_FILTERED | Le fournisseur a bloqué le rendu pendant le contrôle de sa piste audio. | Réessayez ou ajustez les paroles et le son. Ce contrôle peut concerner le rendu créé, même si votre prompt est acceptable. |
| AI_MEDIA_VIDEO_SAFETY_FILTERED | Le fournisseur a bloqué la demande ou le rendu selon ses règles de sécurité. | Reformulez la scène ou remplacez les références sensibles. Le refus peut aussi concerner le contenu créé par le moteur. |
| AI_MEDIA_IMAGE_IDENTITY_REFERENCE_REJECTED | Le moteur n’a pas pu respecter l’identité des personnes sur les photos de référence. | Essayez des photos plus nettes, avec un visage bien visible, ou choisissez un autre moteur. |
| AI_MEDIA_IMAGE_IDENTITY_MODEL_UNSUPPORTED | Ce moteur ne prend pas en charge les références d’identité nécessaires. | Choisissez un moteur compatible avec les photos de référence. |
| AI_MEDIA_VIDEO_IDENTITY_REFERENCE_REJECTED | Le moteur vidéo n’a pas pu préserver l’identité à partir des photos fournies. | Essayez des photos plus nettes ou choisissez un autre moteur. |
| AI_MEDIA_REFERENCE_REQUIRED | Ce moteur a besoin d’une image de référence pour créer cette vidéo. | Ajoutez une image dans les critères ou choisissez un moteur qui accepte un prompt seul. |
| AI_MEDIA_REFERENCES_UNSUPPORTED | Le moteur ne prend pas en charge cette sélection d’images de référence. | Réduisez le nombre d’images ou choisissez un moteur compatible. |
| AI_MEDIA_VIDEO_DURATION_INVALID | La durée choisie n’est pas compatible avec ce moteur et cette qualité. | Choisissez une durée proposée pour ce moteur dans le bandeau du bas. |
| AI_MEDIA_VIDEO_INSTRUCTION_TOO_COMPLEX | La consigne préparée par iNrStudio dépasse la taille acceptée par ce moteur. | Essayez un autre moteur ou une demande plus courte. Même un prompt court peut atteindre cette limite après sa préparation par l’outil. |
| AI_MEDIA_VIDEO_CONFIGURATION_REJECTED | Le moteur a refusé un paramètre technique de génération. | Choisissez un autre moteur ou contactez l’assistance. Modifier le contenu du prompt ne corrige pas ce réglage. |
| AI_MEDIA_VIDEO_PREPARATION_FAILED | iNrStudio n’a pas pu préparer un scénario compatible avec le moteur. | Réessayez ou choisissez un autre moteur. Si cela se répète, contactez l’assistance. |
| AI_MEDIA_IMAGE_PROVIDERS_UNAVAILABLE | Le service de génération d’images n’a pas pu produire de résultat. | Réessayez dans quelques instants ou choisissez un autre moteur d’image. |
| AI_MEDIA_VIDEO_PROVIDER_UNAVAILABLE | Le service de génération est temporairement indisponible. | Réessayez dans quelques instants ou choisissez un autre moteur. |
| AI_MEDIA_IMAGE_OUTPUT_INVALID | Le moteur a renvoyé une image inutilisable. | Réessayez pour obtenir un nouveau rendu ou choisissez un autre moteur. |
| AI_MEDIA_VIDEO_FILE_MISSING | Le moteur a terminé sans fournir de fichier vidéo utilisable. | Réessayez ou choisissez un autre moteur. |
| AI_MEDIA_VIDEO_DOWNLOAD_FAILED | Le fichier vidéo créé n’a pas pu être récupéré correctement. | Réessayez dans quelques instants. Si le problème persiste, contactez l’assistance. |
| AI_MEDIA_VIDEO_INCOMPLETE | Le moteur a renvoyé une vidéo incomplète ou illisible. | Réessayez pour produire un nouveau rendu ou choisissez un autre moteur. |
| AI_MEDIA_VIDEO_COMPOSITION_FAILED | Le montage final de la vidéo a échoué. | Réessayez. Si cela se répète, contactez l’assistance avec le moteur et la durée choisis. |
| AI_MEDIA_PREPARATION_OUTPUT_INVALID | La préparation automatique du média a renvoyé une réponse technique inutilisable. | Réessayez dans quelques instants. Votre prompt n’a pas été identifié comme la cause de cet échec. |
| AI_MEDIA_INVALID_REQUEST | Un réglage nécessaire à la génération est manquant ou incompatible. | Vérifiez les indications du prompt et de l’onglet Critères, puis réessayez. |
| AI_MEDIA_GENERATION_FAILED | La génération a échoué et le service n’a pas fourni de cause identifiable. | Réessayez ou choisissez un autre moteur. Si cela se répète, indiquez à l’assistance le moteur et l’heure de la tentative. |

## Implémentation et vérification

- Catalogue : `lib/aiMediaGenerationPublicErrors.ts`.
- Application aux routes de génération et de statut, sans modification des filtres d’appartenance au compte ni des transitions du portefeuille.
- Vérification de récupération après coupure : même tentative, explication conservée, aucun second POST de génération.
- Tests de diagnostic, confidentialité, annulation, narration exacte et automatique, paramètres Veo Lite 720p/1080p et formats vertical/paysage.
- Les tests de correction isolent les services externes. Ils vérifient les contrats et les secours sans lancer de nouvelle génération payante.

Référence du format API Veo Lite : https://vercel.com/ai-gateway/models/veo-3.1-lite-generate-001
