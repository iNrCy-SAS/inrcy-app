# Inventaire des preuves X Ads

Nommer les fichiers `XADS-E##-AAAA-MM-JJ-description.ext`. Conserver les originaux dans un espace privé ; seules les versions masquées peuvent être partagées.

| ID | Preuve attendue | État | Données à masquer |
| --- | --- | --- | --- |
| E01 | Console X : App ID, nom et propriétaire | À produire | clés, tokens, e-mail inutile |
| E02 | User authentication settings : OAuth 1.0a, Read and write | À produire | Consumer Secret |
| E03 | Callback Ads exact et callback organique distinct | Bloqué : callback Ads absent au 30/09/2026 | autres URLs internes |
| E04 | Confirmation Standard Access pour la bonne App | À produire | identifiants non nécessaires |
| E05 | Variables Vercel présentes en Production, noms uniquement | Vérifié en lecture seule le 30/09/2026 | toutes les valeurs |
| E06 | `npm run verify:x-ads-env` réussi | À produire | environnement et secrets |
| E07 | Modale iNr’ADS X avant connexion | À produire | identité personnelle |
| E08 | Écran de consentement X | À produire | handle si non requis |
| E09 | Retour connecté dans iNr’ADS | À produire | identifiant complet du compte |
| E10 | Liste des comptes et association explicite | À produire | comptes tiers |
| E11 | Persistance après rechargement + bouton Voir le compte | À produire | budget/facturation |
| E12 | Déconnexion Ads avec X organique toujours connecté | À produire | données organiques |
| E13 | Résultat `npm run test:ads-x` | À produire | chemins locaux personnels |
| E14 | Réponse API d’erreur contrôlée pour app non autorisée | Facultatif | headers OAuth |
| E15 | Formulaire final avant soumission | À produire | coordonnées privées |

## Métadonnées à joindre

- date et heure ;
- environnement ;
- commit Git ;
- version Ads API ;
- navigateur ;
- compte test utilisé, sous forme masquée ;
- auteur de la vérification ;
- résultat et anomalie éventuelle.

## Interdictions

- Consumer Key/Secret en clair ;
- access token ou access token secret ;
- cookie, header Authorization ou signature OAuth ;
- identifiant de financement complet ;
- données d’un annonceur tiers sans autorisation ;
- capture affirmant « campagne publiée » tant que `publicationEnabled=false`.
