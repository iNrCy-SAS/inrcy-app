# Inventaire des preuves LinkedIn Ads

Les fichiers de preuve ne doivent pas contenir de secret. Conserver les originaux dans un espace interne contrôlé ; le dépôt ne contient que cette liste et, éventuellement, des copies expurgées.

Convention de nommage : `LIADS-XX-description-AAAA-MM-JJ.ext`.

## A. Portail développeur

| ID | Capture attendue | État | Masquage |
| --- | --- | --- | --- |
| LIADS-01 | App LinkedIn dédiée utilisée pour Ads | **Constatée le 30/09/2026 : iNrCy Ads** ; copie expurgée à archiver hors dépôt | Client ID si non nécessaire |
| LIADS-02 | Products avec Advertising API et niveau Development | **Development Tier confirmé le 30/09/2026** sur preuve officielle utilisateur et contrôle portail en lecture seule | Autres produits hors périmètre |
| LIADS-03 | Auth avec callback Ads exact | **Confirmé le 30/09/2026** : `https://app.inrcy.com/api/ads/linkedin/callback` ; copie expurgée à archiver | Client Secret toujours masqué |
| LIADS-04 | Auth avec scopes Ads disponibles | `r_ads` et `rw_ads` confirmés le 30/09/2026 ; produire une nouvelle preuve pour `r_ads_reporting`, `r_organization_admin` et `w_organization_social` | Aucun jeton |
| LIADS-05 | View Ad Accounts avec le compte de démo ajouté | **Confirmé le 30/09/2026** : compte iNrCy `558357276`, Development Tier ; capture utilisateur reçue | Masquer comptes tiers |

## B. Produit iNrCy

| ID | Capture attendue | État | Critère |
| --- | --- | --- | --- |
| LIADS-10 | Carte LinkedIn Ads dans iNr’ADS | À produire | Design production |
| LIADS-11 | Modale de connexion LinkedIn Ads | À produire | Séparation de l’organique visible |
| LIADS-12 | Consentement LinkedIn manage complet | À produire | Les quatre scopes exacts et le domaine LinkedIn sont visibles |
| LIADS-13 | Liste des comptes et association | À produire | Comptes tiers masqués |
| LIADS-14 | Scopes `rw_ads r_ads_reporting r_organization_admin w_organization_social` | À produire | Aucun scope organique de lecture superflu |
| LIADS-15 | Rôle, état et servabilité du compte | À produire | Données cohérentes avec Campaign Manager |
| LIADS-16 | Déconnexion Ads, puis organique toujours connecté | À produire | Deux écrans horodatés |

## C. Campagne réelle — obligatoire pour Standard

| ID | Preuve attendue | État actuel | Critère |
| --- | --- | --- | --- |
| LIADS-20 | Récapitulatif iNrCy avant mutation | À produire après déploiement/migration | Même nom/compte que LinkedIn |
| LIADS-21 | Réponse de création réussie expurgée | À produire lors du smoke test `PAUSED` | ID distant, aucun jeton ni URL d’upload |
| LIADS-22 | Campagne dans Campaign Manager | À produire lors du smoke test `PAUSED` | Statut non diffusé |
| LIADS-23 | Modification initiée dans iNrCy | À produire après création contrôlée | Champ précis visible |
| LIADS-24 | Modification visible dans Campaign Manager | À produire après création contrôlée | Valeur identique |
| LIADS-25 | Gestion propre d’un refus de rôle/scope | À produire | Message actionnable |

Le code publisher est implémenté, mais ces preuves ne doivent pas être marquées « faites » avant application de la migration, déploiement, activation du verrou LinkedIn dédié et contrôle humain d’un test Development `PAUSED`. Aucun appel live n’a été effectué par les tests automatisés.

## D. Sécurité, confidentialité et exploitation

| ID | Preuve attendue | État | Critère |
| --- | --- | --- | --- |
| LIADS-30 | `npm run verify:linkedin-ads-env` | À produire | Sortie sans valeurs secrètes |
| LIADS-31 | `npm run test:ads-linkedin` | **55/55 verts localement le 30/09/2026** ; à rattacher au commit final | Suite verte, commit identifié |
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
| LIADS-44 | Décision LinkedIn Development | **Approuvée le 30/09/2026** | Conserver l’original officiel hors dépôt et une copie expurgée si nécessaire |
| LIADS-45 | Décision LinkedIn Standard | Non demandée | Ne jamais présumer le Standard à partir du Development |

## Journal de collecte

| Date | ID | Auteur | Environnement | Commit/déploiement | Observation |
| --- | --- | --- | --- | --- | --- |
| 2026-09-30 | LIADS-01 à LIADS-04, LIADS-44 | Utilisateur + contrôle portail en lecture seule | LinkedIn Developers | Sans objet | App dédiée **iNrCy Ads** ; Advertising API **Development Tier** ; callback exact ; `r_ads` et `rw_ads` disponibles. Les trois scopes complémentaires restent à prouver au consentement. Aucun secret consulté ou copié. |
| 2026-09-30 | LIADS-05, LIADS-31 | Utilisateur + QA code sans réseau | Portail LinkedIn + workspace local | À rattacher au commit final | Compte `558357276` mappé ; publisher durable et verrou fournisseur testés localement, sans mutation LinkedIn réelle. |
| `[AAAA-MM-JJ]` | `[LIADS-XX]` | `[NOM]` | `[Preview/Production]` | `[SHA/URL]` | `[NOTE]` |

## Vérification avant partage externe

- [ ] Les images ne montrent pas de Client Secret, token, cookie ou fichier `.env`.
- [ ] Les autres clients et comptes sont masqués.
- [ ] Les noms, dates et fonctions correspondent à la version soumise.
- [ ] Le commit et le déploiement de la vidéo sont identifiés en interne.
- [ ] La vidéo et les captures restent accessibles pendant toute la durée de la revue.
- [ ] Toute mention de Development renvoie au constat officiel du 30/09/2026 ; aucune preuve ne prétend à un Standard Tier non confirmé.
