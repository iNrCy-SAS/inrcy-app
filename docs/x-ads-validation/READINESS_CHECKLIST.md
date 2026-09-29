# Checklist X Ads API Standard Access

Ne cocher qu’avec une preuve datée répertoriée dans [EVIDENCE_INVENTORY.md](./EVIDENCE_INVENTORY.md).

## 1. App et identité

- [ ] Le nom, le logo et la description publique correspondent à iNrCy.
- [ ] L’entreprise, le domaine et l’adresse de contact sont exacts.
- [ ] La politique de confidentialité est publique sans authentification.
- [ ] Le parcours de suppression des données est public et testé.
- [ ] L’App ID destiné à la demande Ads API est consigné sans publier les secrets.
- [ ] Le soumissionnaire possède les droits nécessaires sur l’App et le compte X de test.

## 2. Authentification utilisateur

- [ ] L’App est configurée en OAuth 1.0a / 3-legged.
- [ ] Les permissions utilisateur sont `Read and write`.
- [ ] Le callback Ads exact est enregistré : `https://app.inrcy.com/api/ads/x/callback`. **Bloquant constaté le 30/09/2026 : il manque dans le portail.**
- [ ] Le callback organique `/api/integrations/x/callback` est conservé séparément.
- [ ] Le site web et les URLs légales sont renseignés dans la console.
- [ ] Aucun Consumer Secret ni jeton n’apparaît dans une capture.

## 3. Demande Ads API

- [ ] Le formulaire Ads API Access cible la bonne App ID.
- [ ] Le niveau demandé est **Standard Access**, pas Conversion Only.
- [ ] Le cas d’usage décrit la gestion des campagnes des annonceurs qui autorisent iNrCy.
- [ ] Les volumes et le nombre de clients sont réels, documentés et non inventés.
- [ ] La réponse précise que les identifiants de connexion X ne sont jamais demandés aux clients.
- [ ] Les engagements de stockage et suppression sont cohérents avec la politique publique.
- [ ] La demande est relue puis soumise manuellement.
- [ ] La décision X et sa date sont archivées.

## 4. Après approbation

- [ ] Standard Access est visible ou confirmé pour cette App.
- [ ] Les jetons utilisateur ont été régénérés/réautorisés après l’approbation.
- [ ] `GET /12/accounts` réussit avec le nouveau jeton.
- [ ] Le compte de test apparaît et appartient à l’entreprise ou est explicitement autorisé.
- [ ] Le rôle réel est lu via `authenticated_user_access`.
- [ ] Le financement et la devise sont lus sans exposer de données sensibles.

## 5. Configuration iNrCy

- [ ] `X_ADS_API_KEY` est défini côté serveur.
- [ ] `X_ADS_API_SECRET` est défini côté serveur.
- [ ] `X_ADS_REDIRECT_URI=https://app.inrcy.com/api/ads/x/callback`.
- [ ] `X_ADS_API_VERSION=12`.
- [ ] `NEXT_PUBLIC_APP_URL=https://app.inrcy.com`.
- [ ] `INRCY_CREDENTIALS_SECRET` décode exactement 32 octets.
- [ ] Aucune variable `NEXT_PUBLIC_X_ADS_*` sensible n’existe.
- [ ] `npm run verify:x-ads-env` réussit dans chaque environnement utile.
- [ ] `npm run test:ads-x` réussit.

## 6. Contrôles fonctionnels

- [ ] Le bouton X Ads ouvre uniquement le parcours Ads.
- [ ] Annuler le consentement retourne une erreur actionnable.
- [ ] Un état OAuth absent, expiré, réutilisé ou lié à un autre compte est refusé.
- [ ] La liste montre uniquement les comptes accessibles au membre.
- [ ] Le compte est choisi explicitement, jamais automatiquement.
- [ ] Un compte refusé, supprimé, non EUR ou sans rôle de gestion ne peut pas être associé.
- [ ] La sélection persiste après rechargement.
- [ ] Réautoriser le même utilisateur conserve le compte sélectionné.
- [ ] Réautoriser un autre utilisateur oblige à refaire la sélection.
- [ ] Déconnecter X Ads ne déconnecte pas X organique.
- [ ] Aucun bouton de connexion ne déclenche une création de campagne.

## 7. Publication

- [ ] `publicationEnabled` reste `false` tant que le publisher réel n’est pas audité.
- [ ] Le sandbox X est utilisé avant tout test de mutation.
- [ ] La première création utilise `PAUSED`.
- [ ] Aucun test de validation ne dépense un budget réel.
- [ ] L’activation future exige une confirmation finale séparée.

## 8. Vidéo / captures

- [ ] Les captures sont datées, lisibles et dépourvues de secrets.
- [ ] Le formulaire courant a été relu pour vérifier s’il demande une vidéo.
- [ ] Si une vidéo est demandée, le plan facultatif du dossier est utilisé.
- [ ] La vidéo montre l’interface réelle et ne prétend pas publier quand le publisher est désactivé.
