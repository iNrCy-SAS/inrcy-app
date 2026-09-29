# Checklist de préparation LinkedIn Ads

Ne cocher un élément que lorsqu’une preuve datée est disponible. Les captures correspondantes sont répertoriées dans [EVIDENCE_INVENTORY.md](./EVIDENCE_INVENTORY.md).

## 1. Identité et propriété de l’application

- [ ] Le nom public, le logo et la description de l’app sont définitifs et cohérents avec iNrCy.
- [ ] L’app LinkedIn est associée à la Page officielle de l’entreprise.
- [ ] La personne qui soumet dispose des droits nécessaires dans LinkedIn Developers et sur la Page.
- [ ] Le domaine de production est vérifié et accessible en HTTPS.
- [ ] La politique de confidentialité publique est accessible sans authentification.
- [ ] L’URL de suppression de compte/données est accessible sans authentification initiale et explique le parcours.
- [ ] Le choix « app Ads dédiée » ou « app existante » est consigné. Une app Ads dédiée est recommandée par iNrCy pour isoler secrets et revue.

## 2. Accès Development

- [ ] Le produit **Advertising API** apparaît comme approuvé dans l’onglet Products.
- [ ] Le niveau affiché est **Development** au minimum.
- [ ] Les permissions `r_ads` et `rw_ads` apparaissent dans l’onglet Auth.
- [ ] Le callback exact est enregistré : `https://app.inrcy.com/api/ads/linkedin/callback`.
- [ ] Chaque compte utilisé au niveau Development est ajouté via **View Ad Accounts**.
- [ ] Le compte de démonstration est administré par le membre de test.
- [ ] Le compte, la Page et les données de démonstration appartiennent à l’entreprise ou sont explicitement autorisés.
- [ ] Aucun faux profil automatisé n’est utilisé.

## 3. Configuration iNrCy

- [ ] `LINKEDIN_ADS_CLIENT_ID` est défini côté serveur.
- [ ] `LINKEDIN_ADS_CLIENT_SECRET` est défini côté serveur et n’est jamais préfixé par `NEXT_PUBLIC_`.
- [ ] `LINKEDIN_ADS_REDIRECT_URI=https://app.inrcy.com/api/ads/linkedin/callback`.
- [ ] `LINKEDIN_ADS_API_VERSION=202609` ou une version active plus récente validée par les tests.
- [ ] `NEXT_PUBLIC_APP_URL=https://app.inrcy.com`.
- [ ] `INRCY_CREDENTIALS_SECRET` décode exactement 32 octets.
- [ ] `npm run verify:linkedin-ads-env` réussit dans l’environnement visé.
- [ ] Les variables sont présentes en Production et dans l’environnement de démonstration retenu.

## 4. Contrôles de connexion

- [ ] Le bouton LinkedIn Ads demande d’abord uniquement `r_ads`.
- [ ] L’upgrade explicite « Autoriser la gestion » demande uniquement `rw_ads`.
- [ ] Les scopes organiques ne sont pas demandés par le parcours Ads.
- [ ] Le `state` OAuth est refusé s’il est absent, expiré, réutilisé ou lié à une autre session.
- [ ] Le code OAuth est échangé côté serveur.
- [ ] L’introspection confirme un jeton 3-legged, le bon `client_id` et les scopes accordés.
- [ ] Les jetons sont chiffrés avant stockage.
- [ ] La liste de comptes correspond aux comptes réellement administrés par le membre.
- [ ] La sélection d’un compte persiste après rechargement.
- [ ] Le rôle, le statut et la servabilité du compte sont relus avant toute future mutation.
- [ ] La déconnexion LinkedIn Ads n’efface pas la connexion LinkedIn organique.
- [ ] Après déconnexion, les données d’intégration Ads locales ont disparu.

## 5. Mutation réelle nécessaire avant la vidéo Standard

- [ ] Une route serveur appelle réellement l’API LinkedIn versionnée.
- [ ] Le code relit immédiatement compte, rôle, Page/organisation, groupe de campagnes, géographies et locale.
- [ ] Une campagne `DRAFT` est créée sur un compte Development explicitement autorisé.
- [ ] La campagne distante apparaît dans Campaign Manager avec le bon compte, objectif, budget, calendrier et ciblage.
- [ ] Une modification distante est effectuée et visible dans Campaign Manager.
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

## 7. Vidéo et demande Standard

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

## Blocage de soumission actuel

La connexion et l’association de compte sont documentées, mais le connecteur ne crée, ne modifie et n’optimise encore aucune campagne distante. La demande Standard doit attendre cette mutation réelle et sa preuve vidéo. Ce blocage n’empêche pas de demander ou d’utiliser le niveau Development pour achever le développement.
