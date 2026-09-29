# Parcours reviewer X Ads

## Prérequis

- compte iNrCy Premium de test fourni de façon sécurisée ;
- compte X de test autorisé sur un compte annonceur maîtrisé ;
- App approuvée Standard et jetons régénérés après approbation ;
- variables Production validées avec `npm run verify:x-ads-env` ;
- aucune campagne active nécessaire.

## Parcours principal

1. Se connecter à `https://app.inrcy.com`.
2. Ouvrir **iNr’ADS**, sélectionner **X Ads**, puis **Configurer**.
3. Vérifier que l’écran porte clairement le nom et les couleurs X Ads.
4. Cliquer sur **Connecter X Ads**.
5. Sur X, vérifier l’identité de l’App et autoriser le parcours OAuth 1.0a.
6. Confirmer le retour sur `/dashboard/ads?channel=x` avec l’état connecté.
7. Cliquer sur **Charger mes comptes**.
8. Vérifier que seuls les comptes annonceurs accessibles au membre sont affichés.
9. Sélectionner un compte éligible et cliquer sur **Associer ce compte**.
10. Recharger la page et confirmer que le compte reste associé.
11. Ouvrir **Voir le compte** et vérifier le compte dans X Ads.
12. Déconnecter X Ads et confirmer que la connexion X organique du dashboard reste intacte.

## Cas de refus attendus

- App non approuvée Ads : message d’accès Ads refusé, aucun faux succès.
- Jeton révoqué : statut « reconnecter », aucune suppression du compte organique.
- Compte non accepté ou supprimé : association refusée.
- Rôle lecture seule : association refusée.
- Devise autre qu’EUR ou financement non vérifié : association refusée.
- OAuth annulé, état expiré ou request token différent : callback refusé.
- Réponse paginée incomplète : liste non présentée comme complète.

## Vérifications de non-mutation

- `publicationEnabled` vaut `false` dans les réponses du statut et des comptes.
- Aucun appel `POST /campaigns`, `POST /line_items` ou `POST /promoted_tweets` n’est effectué.
- Cliquer sur les boutons de connexion/association ne peut pas diffuser une annonce.
- Un brouillon iNrCy reste local et modifiable.

## Résultats à archiver

- date, environnement et commit ;
- statut des tests `npm run test:ads-x` ;
- sortie non secrète du validateur ;
- identifiants de captures E01–E12 ;
- App ID et compte Ads masqués ;
- décision X et date d’approbation.
