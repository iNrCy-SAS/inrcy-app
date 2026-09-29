# Checklist de préparation LinkedIn Ads

Ne cocher un élément que lorsqu’une preuve datée est disponible. Les captures correspondantes sont répertoriées dans [EVIDENCE_INVENTORY.md](./EVIDENCE_INVENTORY.md).

## 1. Identité et propriété de l’application

- [x] L’app dédiée utilisée pour Ads est identifiée : **iNrCy Ads**. Preuve portail LIADS-01, 30/09/2026.
- [ ] Le logo et la description publique de l’app sont définitifs et cohérents avec iNrCy.
- [ ] L’app LinkedIn est associée à la Page officielle de l’entreprise.
- [ ] La personne qui soumet dispose des droits nécessaires dans LinkedIn Developers et sur la Page.
- [ ] Le domaine de production est vérifié et accessible en HTTPS.
- [ ] La politique de confidentialité publique est accessible sans authentification.
- [ ] L’URL de suppression de compte/données est accessible sans authentification initiale et explique le parcours.
- [x] Le choix « app Ads dédiée » est consigné. **iNrCy Ads** isole les secrets et la revue de la connexion organique. Preuve LIADS-01.

## 2. Accès Development

- [x] Le produit **Advertising API** apparaît comme approuvé dans l’onglet Products. Preuve LIADS-02, 30/09/2026.
- [x] Le niveau affiché est **Development**. Preuve LIADS-02, 30/09/2026.
- [x] `r_ads` et `rw_ads` apparaissent dans l’onglet Auth. Preuve LIADS-04, 30/09/2026.
- [ ] Vérifier dans Auth et lors du prochain consentement que `r_ads_reporting`, `r_organization_admin` et `w_organization_social` sont disponibles et accordés.
- [x] Le callback exact est enregistré : `https://app.inrcy.com/api/ads/linkedin/callback`. Preuve LIADS-03, 30/09/2026.
- [x] Le compte iNrCy `558357276` est ajouté via **View Ad Accounts**. Preuve LIADS-05, 30/09/2026.
- [x] Le membre de test dispose de l’accès de gestion au compte dans Campaign Manager. Preuve utilisateur du 30/09/2026.
- [ ] Le compte `558357276` n’est plus **On hold**, sa devise est EUR et sa facturation est exploitable.
- [ ] Le compte, la Page et les données de démonstration appartiennent à l’entreprise ou sont explicitement autorisés.
- [ ] Aucun faux profil automatisé n’est utilisé.

## 3. Configuration iNrCy

- [x] `LINKEDIN_ADS_CLIENT_ID` est présent dans le projet Vercel. Présence vérifiée en lecture seule le 30/09/2026 ; valeur non copiée.
- [x] `LINKEDIN_ADS_CLIENT_SECRET` est présent côté serveur dans le projet Vercel et n’est jamais préfixé par `NEXT_PUBLIC_`. Présence vérifiée, valeur non copiée.
- [x] `LINKEDIN_ADS_REDIRECT_URI` est présent dans le projet Vercel ; le callback portail confirmé est `https://app.inrcy.com/api/ads/linkedin/callback`. Vérifier la valeur par environnement avec le script avant déploiement.
- [ ] `LINKEDIN_ADS_API_VERSION=202609` ou une version active plus récente validée par les tests.
- [ ] `NEXT_PUBLIC_APP_URL=https://app.inrcy.com`.
- [ ] `INRCY_CREDENTIALS_SECRET` décode exactement 32 octets.
- [ ] `npm run verify:linkedin-ads-env` réussit dans l’environnement visé.
- [ ] Les variables sont présentes en Production et dans l’environnement de démonstration retenu.

## 4. Contrôles de connexion

- [ ] Le bouton principal demande exactement `rw_ads r_ads_reporting r_organization_admin w_organization_social`.
- [ ] Le mode diagnostic séparé demande uniquement `r_ads`.
- [ ] `r_organization_social`, `w_member_social` et `rw_organization_admin` ne sont jamais demandés par le parcours Ads.
- [ ] Le `state` OAuth est refusé s’il est absent, expiré, réutilisé ou lié à une autre session.
- [ ] Le code OAuth est échangé côté serveur.
- [ ] L’introspection confirme un jeton 3-legged, le bon `client_id` et les scopes accordés.
- [ ] Les jetons sont chiffrés avant stockage.
- [ ] La liste de comptes correspond aux comptes réellement administrés par le membre.
- [ ] La sélection d’un compte persiste après rechargement.
- [ ] Le rôle, le statut et la servabilité du compte sont relus avant toute future mutation.
- [ ] La déconnexion LinkedIn Ads n’efface pas la connexion LinkedIn organique.
- [ ] Après déconnexion, les données d’intégration Ads locales ont disparu.

## 5. Mutation réelle nécessaire avant la future vidéo Standard

- [ ] Une route serveur appelle réellement l’API LinkedIn versionnée.
- [ ] Le code relit immédiatement compte, rôle, Page/organisation, groupe de campagnes, géographies et locale.
- [ ] Une campagne `DRAFT` est créée sur un compte Development explicitement autorisé.
- [ ] La campagne distante apparaît dans Campaign Manager avec le bon compte, objectif, budget, calendrier et ciblage.
- [ ] Une modification distante est effectuée et visible dans Campaign Manager.
- [ ] L’archivage reste distinct de la suppression ; un `DRAFT` utilise `DELETE`, tout autre statut utilise `PENDING_DELETION`.
- [ ] Les statistiques de campagne sont relues avec `r_ads_reporting` sans persister les données Bing Maps.
- [ ] Le parcours d’erreur 401/403 déclenche une reconnexion ou un message actionnable.
- [ ] Aucune campagne n’est activée pendant la démonstration.
- [ ] La création publicitaire, le Sponsored Content et les assets sont soit implémentés et vérifiés, soit explicitement hors périmètre dans la vidéo.

À la date du dossier, cette section n’est pas remplissable : `publicationEnabled` vaut `false` et aucune route de mutation LinkedIn n’est exposée.

## 6. Confidentialité et conformité

- [ ] La politique de confidentialité nomme LinkedIn comme fournisseur/intégration et décrit les données traitées.
- [ ] La finalité est limitée à la gestion des campagnes du client authentifié.
- [ ] Aucun Member Data LinkedIn n’est utilisé pour enrichir un CRM, créer des prospects ou fabriquer des audiences.
- [ ] Les durées de conservation sont alignées avec les règles LinkedIn ; la durée la plus courte s’applique.
- [ ] La suppression utilisateur couvre la connexion, les jetons et les données LinkedIn associées.
- [ ] Le processus de réponse à une demande de suppression est testé.
- [ ] Les journaux ne contiennent ni jeton, ni secret, ni contenu personnel inutile.
- [ ] Les comptes de test et captures ne révèlent pas d’identifiants personnels non nécessaires.

## 7. Vidéo et demande Standard — hors approbation Development

Le Development Tier est déjà approuvé et ne nécessite pas cette vidéo. Ne commencer cette section que si iNrCy décide de demander le Standard Tier.

- [ ] Le script FR ou EN a été relu par une personne qui connaît le produit.
- [ ] La vidéo montre l’URL de production et l’interface réelle, pas une maquette.
- [ ] La vidéo montre OAuth et le consentement exact.
- [ ] La vidéo montre la création, la modification ou l’optimisation **réelle** d’une campagne LinkedIn.
- [ ] Le résultat est confirmé dans Campaign Manager.
- [ ] Les données sensibles sont masquées sans masquer le fonctionnement.
- [ ] Les sous-titres ou une narration rendent chaque action compréhensible.
- [ ] Le lien vidéo est accessible au reviewer sans demande d’autorisation supplémentaire.
- [ ] Les réponses de formulaire reflètent exactement la version démontrée.
- [ ] La demande est soumise manuellement via le Developer Support Portal.

## État de soumission actuel

Le **Development Tier est approuvé depuis le 30/09/2026**. La connexion et l’association de compte peuvent donc être éprouvées sur les comptes Development autorisés. Le connecteur ne crée, ne modifie et n’optimise encore aucune campagne distante : seule une éventuelle demande **Standard** doit attendre cette mutation réelle et sa preuve vidéo.
