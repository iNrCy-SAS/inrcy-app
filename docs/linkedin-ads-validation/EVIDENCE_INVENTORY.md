# Inventaire des preuves LinkedIn Ads

Les fichiers de preuve ne doivent pas contenir de secret. Conserver les originaux dans un espace interne contrôlé ; le dépôt ne contient que cette liste et, éventuellement, des copies expurgées.

Convention de nommage : `LIADS-XX-description-AAAA-MM-JJ.ext`.

## A. Portail développeur

| ID | Capture attendue | État | Masquage |
| --- | --- | --- | --- |
| LIADS-01 | App LinkedIn, nom et Page associée | À produire | Client ID si non nécessaire |
| LIADS-02 | Products avec Advertising API et niveau Development | À produire | Autres produits hors périmètre |
| LIADS-03 | Auth avec callback Ads exact | À produire | Client Secret toujours masqué |
| LIADS-04 | Auth avec `r_ads` et `rw_ads` disponibles | À produire | Aucun jeton |
| LIADS-05 | View Ad Accounts avec le compte de démo ajouté | À produire | Masquer comptes tiers |

## B. Produit iNrCy

| ID | Capture attendue | État | Critère |
| --- | --- | --- | --- |
| LIADS-10 | Carte LinkedIn Ads dans iNr’ADS | À produire | Design production |
| LIADS-11 | Modale de connexion LinkedIn Ads | À produire | Séparation de l’organique visible |
| LIADS-12 | Consentement LinkedIn `r_ads` | À produire | Domaine LinkedIn visible |
| LIADS-13 | Liste des comptes et association | À produire | Comptes tiers masqués |
| LIADS-14 | Scope `rw_ads` demandé par action explicite | À produire | Libellé de gestion clair |
| LIADS-15 | Rôle, état et servabilité du compte | À produire | Données cohérentes avec Campaign Manager |
| LIADS-16 | Déconnexion Ads, puis organique toujours connecté | À produire | Deux écrans horodatés |

## C. Campagne réelle — obligatoire pour Standard

| ID | Preuve attendue | État actuel | Critère |
| --- | --- | --- | --- |
| LIADS-20 | Récapitulatif iNrCy avant mutation | Bloqué | Même nom/compte que LinkedIn |
| LIADS-21 | Réponse de création réussie expurgée | Bloqué | ID distant, aucun jeton |
| LIADS-22 | Campagne dans Campaign Manager | Bloqué | Statut non diffusé |
| LIADS-23 | Modification initiée dans iNrCy | Bloqué | Champ précis visible |
| LIADS-24 | Modification visible dans Campaign Manager | Bloqué | Valeur identique |
| LIADS-25 | Gestion propre d’un refus de rôle/scope | Bloqué | Message actionnable |

Ces preuves sont bloquées parce que la publication/mutation LinkedIn est actuellement désactivée dans le code.

## D. Sécurité, confidentialité et exploitation

| ID | Preuve attendue | État | Critère |
| --- | --- | --- | --- |
| LIADS-30 | `npm run verify:linkedin-ads-env` | À produire | Sortie sans valeurs secrètes |
| LIADS-31 | `npm run test:ads-linkedin` | À produire | Suite verte, commit identifié |
| LIADS-32 | Politique de confidentialité publique | Route publique vérifiée le 29/09/2026 ; revue Ads à faire | Navigation privée, HTTP 200 et texte cohérent avec la vidéo |
| LIADS-33 | Page de suppression de compte/données | À vérifier | Instructions utilisables |
| LIADS-34 | Test de suppression de l’intégration Ads | À produire | Ligne et jetons supprimés |
| LIADS-35 | Journal de production expurgé | À produire | Aucun secret, token ou code OAuth |
| LIADS-36 | Procédure de rotation du Client Secret | À rédiger hors dépôt public si sensible | Responsables et délai définis |

## E. Soumission

| ID | Preuve attendue | État | Critère |
| --- | --- | --- | --- |
| LIADS-40 | Vidéo finale | Bloquée par LIADS-20 à 24 | Lien accessible au reviewer |
| LIADS-41 | Réponses finales au formulaire | Brouillon disponible | Correspondent à la vidéo |
| LIADS-42 | Relecture produit/juridique/sécurité | À planifier | Approbateurs nommés |
| LIADS-43 | Copie PDF ou capture de la demande envoyée | Non soumise | Date et identifiant de dossier |
| LIADS-44 | Décision LinkedIn | Inconnue | Ne jamais présumer l’approbation |

## Journal de collecte

| Date | ID | Auteur | Environnement | Commit/déploiement | Observation |
| --- | --- | --- | --- | --- | --- |
| `[AAAA-MM-JJ]` | `[LIADS-XX]` | `[NOM]` | `[Preview/Production]` | `[SHA/URL]` | `[NOTE]` |

## Vérification avant partage externe

- [ ] Les images ne montrent pas de Client Secret, token, cookie ou fichier `.env`.
- [ ] Les autres clients et comptes sont masqués.
- [ ] Les noms, dates et fonctions correspondent à la version soumise.
- [ ] Le commit et le déploiement de la vidéo sont identifiés en interne.
- [ ] La vidéo et les captures restent accessibles pendant toute la durée de la revue.
- [ ] Aucune preuve ne prétend à une approbation Development ou Standard non confirmée dans le portail.
