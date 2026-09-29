# Confidentialité, sécurité et rétention — X Ads

## Finalité

Les données X Ads sont traitées uniquement pour connecter un compte annonceur autorisé, vérifier que l’utilisateur peut le gérer et préparer les fonctionnalités publicitaires demandées. Elles ne sont pas utilisées pour enrichir un profil tiers ou entraîner un modèle.

## Données minimales

- identifiant et libellé du compte annonceur ;
- statut d’approbation du compte ;
- identifiant du membre X autorisé et nom d’écran d’affichage ;
- permissions au niveau du compte ;
- devise et indicateur de capacité de financement ;
- jeton et secret OAuth 1.0a chiffrés ;
- métadonnées techniques de connexion et dates de mise à jour.

Les numéros de carte, mots de passe X, messages privés et données de timeline ne sont ni demandés ni stockés.

## Contrôles

- TLS obligatoire vers X Ads ;
- API key et Consumer Secret serveur uniquement ;
- jetons chiffrés avec une clé dédiée de 32 octets ;
- cookie OAuth temporaire chiffré, HttpOnly et à durée courte ;
- liaison de l’état OAuth à l’utilisateur authentifié et au compte iNrCy actif ;
- comparaison constante du request token ;
- séparation stricte de l’enregistrement X organique ;
- sélection de compte explicite ;
- journalisation sans secrets ;
- publication payante désactivée.

## Rétention

Les jetons et la sélection du compte sont conservés tant que l’utilisateur maintient la connexion X Ads ou tant que le contrat impose leur conservation opérationnelle. La déconnexion supprime immédiatement la ligne d’intégration Ads locale. La suppression du compte iNrCy doit inclure ces données et leurs éventuelles copies applicatives selon la politique publique et les obligations légales.

Les journaux techniques ne doivent contenir que des identifiants pseudonymisés, codes d’erreur et horodatages nécessaires au diagnostic, avec la durée générale publiée par iNrCy. Aucun secret ou payload OAuth ne doit y être écrit.

## Révocation et incidents

Un 401 X entraîne `needs_update` et bloque la suite jusqu’à réautorisation. Une compromission suspectée exige rotation de la Consumer Secret, invalidation des jetons concernés, analyse des journaux, notification selon les obligations applicables et mise en pause du connecteur.

## Sous-traitants et transferts

Le registre RGPD et la politique de confidentialité doivent identifier X et les fournisseurs d’hébergement/stockage réellement utilisés. Ne jamais affirmer une localisation ou une certification non vérifiée. Les clauses contractuelles et mécanismes de transfert doivent être revus par le responsable conformité.

## Suppression utilisateur

1. authentifier la demande ;
2. supprimer l’intégration `provider=x, source=x_ads, product=ads` ;
3. invalider ou révoquer les accès quand le mécanisme X le permet ;
4. supprimer les caches et références de compte ;
5. appliquer la politique aux sauvegardes ;
6. tracer la réalisation sans conserver les données supprimées.
