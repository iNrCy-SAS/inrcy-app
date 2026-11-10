# Recherche publique et horloge iNrAssist

`lib/inrAssistantClock.ts` est un module pur. `getInrAssistantCurrentDateTime(timeZone?, now?)` produit un instant UTC et la date, l’heure, le jour et le décalage du fuseau IANA choisi. Le défaut est `Europe/Paris`. Le serveur peut inclure ces faits dans chaque prompt sans appel IA ni accès à Internet. `isInrAssistantCurrentTimeRequest` et `isInrAssistantWebResearchRequest` sont des indications de sélection des schémas, jamais des droits.

`createInrAssistantResearchTools({ accountId, edition, requestId, currentUserMessage, signal?, timeZone?, canStartWork? })` fournit :

- `readCurrentDateTime({ timeZone: null | string })` : horloge serveur, sans fournisseur IA.
- `searchPublicWeb({ query, recency: null | "day" | "week" | "month" | "year" })` : une recherche publique native Perplexity exécutée par AI Gateway, avec les identifiants déjà configurés. Le modèle Luna du catalogue iNrAssist appelle uniquement cet outil, en une étape, sans relance ni outils métier.

La requête de recherche doit être un extrait exact de la demande utilisateur actuelle. Le prompt de recherche n’inclut aucun historique, ADN, document ou donnée du compte. Les coordonnées, clés et liens privés/signés sont refusés avant réservation ou transmission. Les entrées refusées peuvent être corrigées ; une recherche fournisseur valide consomme l’unique tentative du tour, même en cas d’échec. L’exécution actuelle ne télécharge aucune page arbitraire depuis le serveur de l’application.

Seuls les résultats de l’outil `perplexity_search` marqués `providerExecuted: true` sont retenus, après vérification d’un unique appel natif dont la requête reproduit exactement la requête publique acceptée. La prose générée et ses liens ne prouvent aucune recherche. Les résultats sont dédupliqués, limités à cinq sources et projetés en titre/URL/extrait/dates. Les formats de date `lastUpdated` du SDK et `last_updated` réellement renvoyé par Gateway sont acceptés. Le retour reste borné à 7 000 octets UTF-8 et porte `untrustedContent: true` et `contentCoverage: "search_excerpts"`. Il ne prouve pas une lecture intégrale des pages. Une erreur ou l’absence de sources doit être expliquée honnêtement.

Avant le fournisseur, le budget mensuel iNrAssist et le garde global du compte réservent chacun une capacité conservatrice de 50 000 microdollars pour l’opération entière, frais d’outil compris. Ce nombre est un garde interne, pas un tarif annoncé. Le montant complet `providerMetadata.gateway.gatewayCost`, ou à défaut une facture confirmée par `getGenerationInfo`, permet de libérer la capacité inutilisée. Les coûts d’inférence seuls ne remplacent pas les frais de recherche ; une valeur absente ou mal formée conserve la réservation, un vrai zéro reste un zéro. Chaque tentative produit la télémétrie `assistant.research`. Une panne des compteurs empêche le lancement ou interrompt la suite ; elle n’ouvre pas un usage gratuit.

Intégration : rendre les deux noms disponibles dans les éditions Basique et Standard, enregistrer les outils quand le sujet le justifie, et demander au modèle de citer les URL réellement retournées. La navigation ou les actions métier ne peuvent pas être autorisées par un extrait web.

Références vérifiées :

- Documentation et source livrées avec `@ai-sdk/gateway` 3.0.185 : `docs/00-ai-gateway.mdx`, `src/tool/perplexity-search.ts`, `src/gateway-generation-info.ts`.
- [Annonce Vercel de la recherche universelle Perplexity via Gateway](https://vercel.com/changelog/access-perplexity-web-search-on-vercel-ai-gateway-with-any-model).
- [Guide officiel Vercel](https://vercel.com/blog/use-perplexity-web-search-with-vercel-ai-gateway).
- [Recherche web native et réglages](https://vercel.com/docs/ai-gateway/models-and-providers/web-search).
- [Métadonnées de génération et montant débité](https://github.com/vercel/ai/blob/main/content/providers/01-ai-sdk-providers/00-ai-gateway.mdx).
- [Options OpenAI de l’AI SDK](https://ai-sdk.dev/providers/ai-sdk-providers/openai) pour `parallelToolCalls` et `maxToolCalls`.
