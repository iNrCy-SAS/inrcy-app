# iNrCy — AI Gateway Étape 3 bis

## Objectif

Finaliser le sélecteur **Choisir votre moteur préférentiel** avec 8 grandes familles IA réellement routées via Vercel AI Gateway, tout en protégeant les flux multicanaux, JSON et vision d'iNrCy.

## Interface

La première section de `Configuration IA` reste :

- **Moteur IA**
- **Choisir votre moteur préférentiel**

Choix proposés :

| Choix interface | Code Supabase | Modèle Gateway actuel | Vision |
|---|---|---|---|
| OpenAI — ChatGPT | `openai` | `openai/gpt-5.6-luna` | Oui |
| Anthropic — Claude | `anthropic` | `anthropic/claude-sonnet-4.6` | Oui |
| Google — Gemini | `google` | `google/gemini-3-flash` | Oui |
| Mistral AI — Mistral | `mistral` | `mistral/mistral-medium-3.5` | Oui |
| xAI — Grok | `xai` | `spacexai/grok-4.1-fast-non-reasoning` | Oui |
| Perplexity — Sonar | `perplexity` | `perplexity/sonar-pro` | Oui |
| DeepSeek | `deepseek` | `deepseek/deepseek-v4-pro-0813` | Non |
| Meta — Llama | `meta` | `meta/llama-4-maverick` | Oui |

Le professionnel choisit une **famille / un moteur**, jamais un identifiant technique. Le mapping moteur → modèle est centralisé dans `lib/aiEnginePreference.ts`.

## Sécurisation vision

DeepSeek V3.2 est textuel dans le catalogue Gateway actuel. Pour éviter de casser :

- Booster avec image
- analyse de pièce jointe
- analyse de frames vidéo
- tout autre appel `aiGenerateJSON` avec `images`

iNrCy applique automatiquement :

```text
DeepSeek sélectionné + requête texte
→ deepseek/deepseek-v4-pro-0813

DeepSeek sélectionné + requête avec image
→ AI_GATEWAY_VISION_MODEL si défini
→ sinon google/gemini-3-flash
```

Le fallback vision est centralisé et testé.

## Compatibilité JSON

Les flux iNrCy attendent des objets JSON exploitables.

Deux modes sont gérés :

```text
strict
→ envoi du format json_object au Gateway

prompt-only
→ pas de paramètre JSON fournisseur spécifique
→ les prompts iNrCy exigent toujours un JSON strict
→ parseur iNrCy récupère l'objet JSON de la réponse
```

Mode `prompt-only` retenu pour :

- Perplexity
- DeepSeek
- Llama

Cela évite de supposer qu'un paramètre fournisseur de sortie structurée est uniformément supporté par tous les backends du Gateway.

## Persistance Supabase

Colonne :

```text
public.business_profiles.ai_preferred_engine
```

Valeurs autorisées :

```text
openai
anthropic
google
mistral
xai
perplexity
deepseek
meta
```

Migration Étape 3 bis :

```text
ops/sql/2026-07-10_ai_gateway_step3bis_8_engines.sql
```

Le script est idempotent et gère aussi le cas où l'ancienne contrainte Étape 3 à 4 moteurs existe déjà : elle est supprimée puis recréée avec les 8 valeurs.

## Vercel

Aucune nouvelle variable obligatoire si l'Étape 2 est déjà active.

Conserver :

```text
AI_GATEWAY_API_KEY=...
AI_GATEWAY_MODE=gateway
AI_GATEWAY_MODEL=openai/gpt-5.6-luna
OPENAI_API_KEY=...
```

Optionnel :

```text
AI_GATEWAY_VISION_MODEL=google/gemini-3-flash
```

Si cette variable n'est pas définie, le fallback vision interne pour un moteur non compatible image est :

```text
google/gemini-3-flash
```

`OPENAI_API_KEY` reste nécessaire tant que la transcription audio brute n'a pas été migrée.

## QA

Commandes :

```bash
npm run test:ai-gateway
npm run typecheck
npm run qa:ai-gateway
```

Tests dédiés :

- défaut OpenAI préservé
- normalisation des 8 moteurs
- 8 mappings `provider/model`
- capacité vision explicite
- modes JSON explicites
- fallback vision DeepSeek testé
