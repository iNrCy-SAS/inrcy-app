# Parcours reviewer et plan de test LinkedIn Ads

État fournisseur au 30 septembre 2026 : **Development Tier approuvé** pour l’app dédiée **iNrCy Ads**. Le scénario A peut être exécuté avec un compte ajouté à la liste Development. Le scénario D et sa vidéo concernent uniquement une future demande Standard.

## Préparation interne

Créer une fiche éphémère, stockée hors du dépôt, avec :

- URL de l’app ;
- compte iNrCy de démonstration ;
- méthode de second facteur si nécessaire ;
- membre LinkedIn autorisé ;
- Page et compte Ads utilisés ;
- contact technique disponible pendant la revue.

Ne jamais committer les identifiants. Le reviewer ne doit pas recevoir le Client Secret ni un jeton OAuth.

## Prérequis du compte Development

Le produit Advertising API, le Development Tier et le callback exact sont confirmés. `r_ads` et `rw_ads` ont été vus dans Auth ; les trois scopes complémentaires du mode manage doivent encore être confirmés par une preuve de consentement réelle. Il reste aussi à autoriser et contrôler le compte de démonstration :

1. Copier l’ID du compte dans Campaign Manager.
2. Ouvrir l’app dans LinkedIn Developers.
3. Aller dans **Products > Advertising API > View Ad Accounts**.
4. Ajouter l’ID du compte et sauvegarder.
5. Vérifier que le membre de démo administre ce compte.
6. Vérifier que le compte n’est pas bloqué et que la facturation est comprise avant tout test de diffusion.

Ces étapes proviennent du Quick Start LinkedIn pour le niveau Development.

## Scénario A — connexion et lecture

| Étape | Action reviewer | Résultat attendu |
| --- | --- | --- |
| 1 | Se connecter à iNrCy et ouvrir iNr’ADS | La page des canaux apparaît |
| 2 | Choisir LinkedIn Ads puis **Configurer** | La modale LinkedIn Ads est distincte du dashboard organique |
| 3 | Cliquer sur **Connecter LinkedIn Ads** | LinkedIn affiche exactement `rw_ads r_ads_reporting r_organization_admin w_organization_social` |
| 4 | Autoriser avec le membre de démo | Retour sur `app.inrcy.com/dashboard/ads?channel=linkedin` |
| 5 | Charger les comptes | Seuls les comptes administrés et autorisés sont listés |
| 6 | Associer le compte de démo | Nom, rôle, statut et servabilité apparaissent |
| 7 | Recharger la page | Le choix persiste |
| 8 | Ouvrir LinkedIn organique | La connexion organique, si présente, est indépendante |

## Scénario B — contrôle du consentement manage

| Étape | Action reviewer | Résultat attendu |
| --- | --- | --- |
| 1 | Actualiser la connexion Ads | Le même jeu de quatre scopes manage est demandé, sans scope superflu |
| 2 | Accepter | Retour iNrCy avec les quatre scopes vérifiés par introspection |
| 3 | Recharger le compte | Le rôle est relu, pas inféré depuis le navigateur |
| 4 | Tester un rôle insuffisant si disponible | iNrCy reste en lecture seule |

Les quatre scopes ne suffisent pas seuls : le rôle du membre, l’état du compte et les ressources de campagne restent obligatoires.

## Scénario C — déconnexion

| Étape | Action reviewer | Résultat attendu |
| --- | --- | --- |
| 1 | Cliquer sur **Déconnecter** dans LinkedIn Ads | La ligne de connexion Ads locale est supprimée |
| 2 | Recharger iNr’ADS | LinkedIn Ads est déconnecté |
| 3 | Ouvrir le dashboard organique | La connexion LinkedIn organique n’a pas été supprimée |
| 4 | Vérifier l’espace confidentialité | Le reviewer trouve la politique et le parcours de suppression |

## Scénario D — campagne distante pour une future demande Standard

Ce scénario est obligatoire avant d’utiliser le storyboard Standard et n’est **pas encore exécutable** dans le code actuel.

1. Reconnecter avec les quatre scopes manage et associer le compte Development autorisé.
2. Créer dans iNrCy une campagne LinkedIn classique, limitée au cas d’usage effectivement supporté.
3. Afficher le récapitulatif avant envoi : compte, organisation, objectif, budget, dates, locale et géographies.
4. Confirmer une création distante en statut `DRAFT` ou équivalent non diffusé.
5. Ouvrir Campaign Manager et montrer la campagne portant le même nom/identifiant.
6. Revenir dans iNrCy, modifier un champ autorisé puis enregistrer.
7. Rafraîchir Campaign Manager et montrer la modification.
8. Démontrer une erreur sûre, par exemple un rôle insuffisant, sans montrer de données sensibles.
9. Terminer sans activer la campagne.

LinkedIn exige pour Standard une vidéo où la plateforme crée, modifie ou optimise une campagne. Le scénario final doit donc prouver au moins une mutation réelle, pas seulement la préparation locale.

## Données de test sûres

- Nom de campagne unique : `INRCY-LINKEDIN-REVIEW-AAAA-MM-JJ`.
- Budget minimal conforme au compte, sans activation.
- URL de destination détenue par iNrCy ou par le compte de démonstration.
- Visuel dont les droits sont détenus.
- Géographie volontairement limitée et justifiable.
- Aucun fichier de clients, aucune audience importée et aucune donnée de membre LinkedIn.

## Critères d’acceptation internes

- Le consentement affiché correspond exactement au scope annoncé.
- Aucun secret ou jeton n’apparaît dans l’URL, l’interface, la vidéo ou les logs.
- Un refus OAuth et une expiration de session sont traités proprement.
- Le compte sélectionné est relu côté serveur immédiatement avant mutation.
- Le résultat visible dans Campaign Manager correspond au récapitulatif iNrCy.
- La vidéo et les réponses de formulaire décrivent uniquement les fonctions réellement démontrées.
