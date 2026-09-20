# iNrCy — AI Gateway Étape 4 — verrouillage de tous les modules IA

Date : 2026-07-10

## Objectif

Faire de Vercel AI Gateway l'unique chemin de génération texte/vision d'iNrCy, tout en conservant séparément la transcription audio brute actuelle.

## Architecture après Étape 4

```text
Configuration IA (moteur préféré par business_profile)
        ↓
Modules iNrCy
        ↓
aiGenerateJSON (lib/aiGatewayClient.ts)
        ↓
Vercel AI Gateway
        ↓
ChatGPT / Claude / Gemini / Mistral / Grok / Perplexity / DeepSeek / Llama
```

Aucun fallback silencieux vers OpenAI direct n'est conservé pour la génération texte/vision.

## Modules couverts

- Booster / Publier multicanal
- reprise qualité Booster et récupération canal par canal
- sauvetage YouTube
- iNrAgent / Publier
- Propulser
- Fidéliser
- iNrAgent / Campagnes
- Mails simples
- analyse visuelle des images jointes aux mails
- analyse des frames vidéo jointes aux mails
- réponses Google Reviews
- réponses Trustpilot
- iNrAgent / Rapport Stats
- correction/nettoyage IA de la transcription

## Exception volontaire

`app/api/booster/transcribe/route.ts` conserve l'appel direct :

```text
https://api.openai.com/v1/audio/transcriptions
```

Cet appel sert uniquement à convertir l'audio brut en texte. Une fois le texte obtenu, son nettoyage IA repasse par Vercel AI Gateway avec le moteur préféré du compte.

## Verrous ajoutés

### 1. Client central Gateway-only

`lib/aiGatewayClient.ts` :

- plus de runtime `openai-direct` ;
- plus de fallback automatique vers `OPENAI_API_KEY` ;
- plus de fallback `OPENAI_MODEL` / `OPENAI_VISION_MODEL` ;
- credential Gateway obligatoire (`AI_GATEWAY_API_KEY` ou `VERCEL_OIDC_TOKEN`) ;
- chaque requête doit indiquer un moteur ou un modèle explicite ;
- chaque requête doit porter un tag fonctionnel `feature`.

### 2. Tags fonctionnels

Les appels sont identifiés par :

- `booster.publish`
- `booster.youtube-rescue`
- `agent.publish`
- `templates.generate`
- `agent.campaign`
- `mails.generate`
- `mails.attachment-image`
- `mails.attachment-video`
- `reviews.google`
- `reviews.trustpilot`
- `agent.stats-report`
- `booster.transcript-cleanup`

Ces tags préparent l'Étape 5 (coûts, budgets, quotas, observabilité par usage).

### 3. Audit bloquant

`scripts/audit-ai-gateway.mjs` échoue si :

- un consommateur legacy `openaiGenerateJSON` réapparaît ;
- un endpoint OpenAI direct est ajouté hors transcription brute ;
- un endpoint direct Anthropic / Google Gemini / Mistral / xAI / Perplexity / DeepSeek est ajouté ;
- un appel `aiGenerateJSON` n'a pas de tag `feature` ;
- un appel `aiGenerateJSON` n'a pas de routage moteur/modèle explicite.

### 4. QA dédiée

`tests/ai-gateway/step4-all-modules-gateway.test.mts` vérifie :

- client de génération Gateway-only ;
- exception unique transcription brute ;
- tags et routage explicites ;
- couverture des grands modules ;
- distinction explicite des flux iNrAgent partagés.

## Environnement

Pour la génération texte/vision :

```text
AI_GATEWAY_API_KEY=...
AI_GATEWAY_MODE=gateway
AI_GATEWAY_MODEL=openai/gpt-5.6-luna
```

`AI_GATEWAY_VISION_MODEL` reste optionnel.

Pour la transcription audio brute uniquement :

```text
OPENAI_API_KEY=...
OPENAI_TRANSCRIBE_MODEL=gpt-4o-mini-transcribe   # optionnel
```

## Supabase

Aucune migration Supabase supplémentaire n'est nécessaire pour l'Étape 4.
La colonne `business_profiles.ai_preferred_engine` de l'Étape 3 bis reste la source de vérité.

## Validation effectuée

- `npm run audit:ai-gateway` : OK
- `npm run test:ai-gateway` : 11/11 tests OK
- `npm run typecheck` : 0 erreur
- `npm run build` : atteint `Creating an optimized production build...`, puis dépasse la limite d'exécution de l'environnement de test ; non déclaré validé.
