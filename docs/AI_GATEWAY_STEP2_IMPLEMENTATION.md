# iNrCy — AI Gateway — Étape 2 : couche centrale Vercel

Date : 10 juillet 2026

## Objectif

Faire passer la génération JSON/vision iNrCy par une couche fournisseur neutre, sans modifier les prompts métier ni exposer encore un choix de moteur aux utilisateurs.

Architecture obtenue :

`Booster / Propulser / Fidéliser / Mails / Réputation / iNrAgent`
→ `lib/aiGatewayClient.ts`
→ `Vercel AI Gateway` si configuré
→ sinon `OpenAI direct` en secours transitoire uniquement

## Modifications réalisées

- ajout de `lib/aiGatewayClient.ts` ;
- ajout du point d’entrée neutre `aiGenerateJSON` ;
- migration des 8 consommateurs JSON/vision ;
- compatibilité `provider/model` pour AI Gateway ;
- conversion automatique des modèles OpenAI sans préfixe (`gpt-5.6-luna` → `openai/gpt-5.6-luna`) ;
- authentification Gateway par `AI_GATEWAY_API_KEY` ou `VERCEL_OIDC_TOKEN` ;
- mode de transition `AI_GATEWAY_MODE=auto|gateway|openai-direct` ;
- correction du rapport Stats iNrAgent : plus de test bloquant spécifique à `OPENAI_API_KEY` ;
- diagnostics d’environnement complétés ;
- suppression du client central OpenAI spécifique : aucun consommateur legacy `openaiGenerateJSON` ne subsiste ;
- transcription audio conservée chez OpenAI direct à cette étape.

## Variables reconnues

### Gateway

- `AI_GATEWAY_API_KEY`
- `VERCEL_OIDC_TOKEN`
- `AI_GATEWAY_MODE`
- `AI_GATEWAY_MODEL`
- `AI_GATEWAY_VISION_MODEL`
- `AI_GATEWAY_BASE_URL` (optionnelle, défaut officiel Vercel)

### Transition OpenAI

- `OPENAI_API_KEY`
- `OPENAI_MODEL`
- `OPENAI_VISION_MODEL`
- `OPENAI_TRANSCRIBE_MODEL`
- `OPENAI_TRANSCRIPT_CLEANUP_MODEL`

## Comportement du mode

### `AI_GATEWAY_MODE=auto` (défaut)

- si une authentification Gateway existe : Gateway ;
- sinon : OpenAI direct.

### `AI_GATEWAY_MODE=gateway`

- Gateway obligatoire ;
- une configuration manquante produit une erreur au lieu de retomber silencieusement sur OpenAI.

### `AI_GATEWAY_MODE=openai-direct`

- OpenAI direct forcé ;
- utile uniquement pour rollback temporaire.

## Manipulation Vercel — nécessaire pour activer réellement le Gateway

Option recommandée pour la première mise en production contrôlée :

1. Ouvrir Vercel → AI Gateway → API Keys.
2. Créer une clé dédiée au projet iNrCy.
3. Copier immédiatement la clé.
4. Dans le projet Vercel iNrCy → Settings → Environment Variables, ajouter :
   - `AI_GATEWAY_API_KEY` = la clé créée ;
   - `AI_GATEWAY_MODE` = `gateway` ;
   - `AI_GATEWAY_MODEL` = modèle OpenAI actuel au format Gateway, par exemple `openai/gpt-5.6-luna` ;
   - `AI_GATEWAY_VISION_MODEL` = modèle vision actuel au format Gateway si différent.
5. Appliquer au minimum à Production et Preview selon la stratégie de test.
6. Redéployer.
7. Vérifier les générations dans Vercel → AI Gateway → Generations.

Alternative : OIDC Vercel est également supporté par le code via `VERCEL_OIDC_TOKEN`.

## Manipulation Supabase

Aucune manipulation Supabase n’est nécessaire à l’étape 2.

La colonne de préférence moteur sera ajoutée à l’étape 3, parce que la préférence devra être persistée par `business_profile` / compte actif.

## Exigence UI verrouillée pour l’étape 3

Dans `Configuration IA`, la **première case** sera :

**Choisir votre moteur préférentiel**

Cette case devra être affichée avant le ton, le style, l’originalité et les autres réglages.
