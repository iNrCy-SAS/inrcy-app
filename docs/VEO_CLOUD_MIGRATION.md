# Migration Veo vers Google Cloud

État au 10 octobre 2026 : code préparé, activation Cloud et essais réels encore à réaliser. Cette branche ne bascule pas la production automatiquement.

Google annonce l'arrêt des identifiants Gemini `veo-3.1-*-generate-preview` et `gemini-omni-flash-preview` le 22 octobre 2026. Omni utilise déjà `gemini-omni-1.1-flash` et Interactions ; une ancienne surcharge preview est désormais convertie vers ce modèle stable.

## Activation Veo

Le backend historique reste sélectionné tant que `AI_MEDIA_VEO_BACKEND` est absent ou vaut `gemini`. Pour un environnement Preview dédié :

```text
AI_MEDIA_VEO_BACKEND=vertex
AI_MEDIA_VEO_VERTEX_PROJECT=<projet Cloud vérifié>
AI_MEDIA_VEO_VERTEX_LOCATION=us-central1
```

Préparer l'API `aiplatform.googleapis.com`, la facturation et une identité serveur autorisée à effectuer les prédictions. Utiliser ADC ou Workload Identity Federation ; une configuration d'authentification peut aussi être fournie par la variable serveur protégée `AI_MEDIA_VEO_VERTEX_CREDENTIALS_JSON`. Ne jamais publier de clé privée dans le dépôt. La clé Gemini reste utilisée par Omni/TTS et n'authentifie pas ce backend Cloud.

Pour Vercel, configurer `AI_MEDIA_VEO_VERTEX_WIF_AUDIENCE` avec le nom complet du fournisseur Google (`//iam.googleapis.com/projects/NUMERO/locations/global/workloadIdentityPools/POOL/providers/FOURNISSEUR`) et `AI_MEDIA_VEO_VERTEX_SERVICE_ACCOUNT` avec le compte de service dédié. Le SDK Google échange les jetons temporaires Vercel, puis emprunte l'identité de ce compte. Ne pas combiner cette méthode avec `AI_MEDIA_VEO_VERTEX_CREDENTIALS_JSON`.

Restreindre la confiance à l'équipe et au projet Vercel vérifiés, et seulement aux environnements autorisés. Pour la préparation actuelle : équipe `inrcyteam`, projet `inrcy-app`, environnement Preview. Le droit d'emprunter l'identité ne doit pas être accordé à l'ensemble d'un pool. Le compte dédié doit disposer uniquement des droits nécessaires aux prédictions Veo, sans rôle Owner ni Editor. La confiance Production ne sera ajoutée qu'au moment de la bascule autorisée.

Fast devient `veo-3.1-fast-generate-001`, avec Lite `veo-3.1-lite-generate-001` en secours. Lite est encore en Preview sur Cloud. Les surcharges connues sont converties en conservant Fast/Lite/Standard. Une valeur vide de `AI_MEDIA_VEO_FALLBACK_MODELS` désactive le secours.

Chaque requête demande un seul clip 720p avec audio. L'absence de `outputGcsUri` permet au SDK de renvoyer les octets MP4 directement : aucun bucket supplémentaire n'est requis. Un résultat facturable qui ne fournit pas les octets attendus échoue sans lancer une seconde génération.

## Vérification avant production

Les tests locaux couvrent 8/16/24 secondes, quatre formats, références/raccords, coût et échecs après facturation. Une fixture HTTP vérifie aussi la conversion des requêtes/réponses par le SDK installé. Ces contrôles ne prouvent pas les droits Cloud, les quotas ni la qualité réelle.

Avant la bascule, vérifier l'identité du projet, l'accès au modèle et les tarifs ; puis générer en Preview des films 8/16/24 secondes, dont un portrait avec référence et raccords. Contrôler MP4, son, durée, rendu final, stockage et consommation du quota iNrCy. Autoriser et plafonner la dépense de ces essais avant leur lancement.

Basculer la production seulement après ces résultats. Un retour au backend Gemini reste possible avant le 22 octobre 2026 ; après l'arrêt Google, il ne constitue plus une solution de secours.

Pour les essais au budget limité, fixer explicitement Fast (`AI_MEDIA_VEO_MODEL=veo-3.1-fast-generate-001`), désactiver le secours (`AI_MEDIA_VEO_FALLBACK_MODELS` vide) et régler `AI_MEDIA_VEO_SUBMIT_ATTEMPTS=1`. Une erreur temporaire de soumission ne relancera alors pas une génération automatiquement. Le comportement habituel conserve quatre tentatives au maximum en l'absence de ce réglage.

La fédération borne séparément la fourniture du jeton Vercel, l'attente STS et la requête IAM à 10 secondes chacune. Le SDK ne transmet pas le signal d'annulation de la génération à cette phase : une annulation peut donc attendre jusqu'à 30 secondes. Le transport STS interne de Google 10.9.1 peut encore terminer après ce délai, mais il ne peut alors poursuivre vers IAM ni lancer une génération.

Sources : [arrêts Gemini](https://ai.google.dev/gemini-api/docs/deprecations/), [migration vers Cloud](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/migrate/migrate-google-ai), [modèles Veo](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/veo/3-1-generate), [tarifs Cloud](https://cloud.google.com/gemini-enterprise-agent-platform/generative-ai/pricing), [fédération Vercel–Google](https://vercel.com/docs/oidc/gcp).
