# Plugin iNrCy Annuaire

Ce plugin affiche les profils iNr’Search autorisés dans une page HTML WordPress. Il évite l’iframe : les moteurs reçoivent les intitulés, les descriptions et les liens vers les profils dès le rendu initial. Les cartes sont présentées par 12, avec pagination.

## Installation

1. Déployer d’abord la version iNr’Search qui contient `/api/public/inrsearch/directory`.
2. Dans WordPress : **Extensions → Ajouter une extension → Téléverser une extension**.
3. Installer puis activer `inrcy-directory-1.4.2.zip`.

## Configuration de la purge immédiate

Générer un secret aléatoire d’au moins 32 caractères, puis utiliser exactement la même valeur dans WordPress et dans Vercel.

Dans `wp-config.php`, avant la ligne qui arrête l’édition :

```php
define('INRCY_DIRECTORY_PURGE_SECRET', 'remplacer-par-un-secret-aleatoire-long');
```

Dans les variables d’environnement de l’application :

```text
INRCY_DIRECTORY_PURGE_SECRET=la-même-valeur
INRCY_DIRECTORY_PURGE_URL=https://inrcy.com/wp-json/inrcy/v1/directory-cache/purge
```

`INRCY_DIRECTORY_PURGE_URL` est facultative lorsque l’URL ci-dessus est utilisée, car elle correspond à la valeur par défaut.

Le secret n’est jamais envoyé tel quel : l’application signe le corps et l’horodatage de chaque demande avec HMAC-SHA256. WordPress refuse les signatures incorrectes ainsi que les demandes vieilles de plus de cinq minutes.

## Création de la page

1. Dans **Pages → Ajouter une page**, créer la page `Annuaire iNrCy`.
2. Utiliser le slug `annuaire`.
3. Ajouter un bloc **Code court** contenant :

```text
[inrcy_directory]
```

4. Publier la page.

## Cache

Le plugin appelle :

```text
https://app.inrcy.com/api/public/inrsearch/directory
```

Les filtres publics sont `q`, `metier`, `secteur`, `ville`, `departement`, `region` et `inrcy_page`. Le plugin traduit ensuite `inrcy_page` en `page` uniquement pour l’API iNrCy. Ce nom dédié évite la variable `page` réservée par WordPress.

Les résultats restent mis en cache une heure côté WordPress. Une copie de secours valable un jour évite de vider l’annuaire lors d’une panne API momentanée. Chaque inclusion, exclusion, connexion ou déconnexion iNr’Search incrémente immédiatement la version du cache : toutes les pages et combinaisons de filtres utilisent alors la nouvelle version sans attendre l’expiration des anciens transients.

Un profil n’est envoyé par l’API que si le professionnel a connecté sa page iNr’Search et autorisé séparément son affichage dans l’annuaire. La page peut donc rester publique et référencée tout en étant absente de l’annuaire.

## Ordre de déploiement

1. Installer cette version `1.4.2` du plugin.
2. Ajouter `INRCY_DIRECTORY_PURGE_SECRET` dans `wp-config.php`.
3. Déployer l’application corrigée avec le même secret dans Vercel.
4. Tester successivement l’inclusion puis l’exclusion d’une fiche.

## Nouveautés de la version 1.4.2

- largeur des cartes stabilisée : une ligne contenant une à quatre fiches conserve les mêmes dimensions que la grille complète ;
- comportement tablette et mobile inchangé.

## Nouveautés de la version 1.4.1

- pagination publique corrigée avec `inrcy_page`, sans collision avec la variable `page` réservée par WordPress ;
- page 2 et suivantes conservées avec tous les filtres actifs ;
- cache principal d’une heure et copie de secours d’un jour en cas d’indisponibilité momentanée de l’API.

## Nouveautés de la version 1.3

- design de l’annuaire isolé du thème WordPress pour éviter les collisions de styles ;
- titre WordPress dupliqué masqué sur la page contenant le shortcode ;
- grille plus dense sur ordinateur et cartes plus lisibles sur mobile ;
- carte entièrement cliquable avec libellé accessible et zones tactiles d’au moins 44 px ;
- appel à l’action pour activer iNr’Search et choisir la diffusion dans l’annuaire ;
- données structurées `CollectionPage`, `ItemList` et `LocalBusiness` ;
- titre, description et image de partage Rank Math renforcés ;
- animations neutralisées lorsque le visiteur préfère réduire les mouvements.
