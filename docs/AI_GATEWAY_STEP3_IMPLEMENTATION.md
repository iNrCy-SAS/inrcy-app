# iNrCy — AI Gateway Étape 3

> **Mise à jour :** l'Étape 3 bis étend désormais le sélecteur à 8 moteurs. Voir `docs/AI_GATEWAY_STEP3BIS_8_ENGINES.md` et utiliser la migration SQL Étape 3 bis pour le déploiement courant.

## Objectif

Rendre le choix du moteur IA visible et réellement fonctionnel dans **Configuration IA**, avec une préférence enregistrée par compte actif et utilisée par les flux de génération iNrCy.

## Interface

La première section de `Configuration IA` est désormais :

- **Moteur IA**
- **Choisir votre moteur préférentiel**

Choix proposés :

| Choix interface | Code Supabase | Modèle Gateway actuel |
|---|---|---|
| OpenAI — ChatGPT | `openai` | `openai/gpt-5.6-luna` |
| Anthropic — Claude | `anthropic` | `anthropic/claude-sonnet-4.6` |
| Google — Gemini | `google` | `google/gemini-3-flash` |
| xAI — Grok | `xai` | `spacexai/grok-4.1-fast-non-reasoning` |

Le professionnel choisit un **moteur**, pas un identifiant technique. Le mapping moteur → modèle reste centralisé dans `lib/aiEnginePreference.ts`, ce qui permet de faire évoluer un modèle plus tard sans migrer les profils Supabase.

## Persistance Supabase

Nouvelle colonne :

```text
public.business_profiles.ai_preferred_engine
```

Valeurs autorisées :

```text
openai | anthropic | google | xai
```

Migration à exécuter avant déploiement :

```text
ops/sql/2026-07-10_ai_gateway_preferred_engine.sql
```

Le défaut est `openai`, donc tous les comptes existants conservent le comportement actuel après migration.

## Routage réel

La couche neutre `lib/aiGatewayClient.ts` accepte désormais `engine`. La priorité de résolution du modèle devient :

1. `opts.model` explicite (cas technique spécialisé)
2. moteur préféré du compte (`engine`)
3. `AI_GATEWAY_VISION_MODEL` pour une requête image sans préférence
4. `AI_GATEWAY_MODEL`
5. anciens fallback `OPENAI_*`
6. `gpt-5.6-luna`

Les flux suivants utilisent la préférence du compte :

- Booster / Publier multicanal
- reprises qualité et sauvetage YouTube
- iNrAgent Publier
- Propulser
- Fidéliser
- iNrAgent Campagnes
- Mails simples
- vision des pièces jointes mail
- réponses Google Reviews
- réponses Trustpilot
- iNrAgent Rapport Stats
- nettoyage IA des dictées / transcriptions

La transcription audio brute reste volontairement sur l'API OpenAI directe à cette étape.

## Vercel

Aucune nouvelle variable n'est nécessaire si l'Étape 2 est déjà active.

Conserver :

```text
AI_GATEWAY_API_KEY=...
AI_GATEWAY_MODE=gateway
AI_GATEWAY_MODEL=openai/gpt-5.6-luna
```

`AI_GATEWAY_MODEL` reste un fallback global. Dès qu'un compte possède une préférence, son moteur choisi est résolu avant cette variable.

Conserver également `OPENAI_API_KEY` pour la transcription audio brute.

## QA effectuée

- `npm run qa:ai-gateway` : OK
  - audit statique Gateway : OK
  - 3 tests moteur/préférence : OK
  - TypeScript : 0 erreur
- `npm run build` : atteint `Creating an optimized production build...` puis dépasse la limite de temps de l'environnement de test ; non déclaré comme validé.

## QA manuelle recommandée après déploiement

1. Ouvrir Configuration IA.
2. Choisir Claude et enregistrer.
3. Recharger la page : Claude doit rester sélectionné.
4. Générer un Booster sur plusieurs canaux.
5. Vérifier dans AI Gateway Team Data que le modèle Anthropic apparaît.
6. Refaire avec Gemini puis Grok.
7. Revenir à ChatGPT et confirmer `openai/gpt-5.6-luna`.
8. Tester un compte secondaire / multicompte pour confirmer l'isolation de la préférence par `activeUserId`.
