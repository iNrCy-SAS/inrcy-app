# iNr’Annuaire — WordPress 2.0.0

Le shortcode [inrcy_directory] affiche les professionnels ayant choisi leur présence dans iNr’Annuaire. Cette présence est indépendante de la publication iNr’Search. Chaque carte présente le nom, le métier du catalogue de l’application, le lieu sur deux lignes et un QR code vers l’iNr’Badge du professionnel. Le badge reste accessible par un lien cliquable.

## Source des données

L’API publique est https://app.inrcy.com/api/public/directory. L’ancien endpoint /api/public/inrsearch/directory reste compatible. Le catalogue de métiers et ses regroupements proviennent de l’application, avec les effectifs réels ; les spécialités sans correspondance restent dans Autre métier.

Les filtres sont q, metier, secteur, ville, departement et region. La pagination publique utilise inrcy_page et envoie page à l’API, pour éviter le paramètre réservé WordPress.

## Mise en service

1. Déployer l’application contenant le nouvel endpoint et les QR codes avant de remplacer le plugin.
2. Installer ou mettre à jour le plugin avec inrcy-directory-2.0.0.zip.
3. Conserver la page /annuaire/ et son shortcode [inrcy_directory].
4. Vérifier une fiche, le filtre métier et la seconde page.

## Actualisation du cache

Conserver INRCY_DIRECTORY_PURGE_SECRET dans wp-config.php et la même valeur dans les variables de l’application ; INRCY_DIRECTORY_PURGE_URL pointe vers https://inrcy.com/wp-json/inrcy/v1/directory-cache/purge. Le secret doit contenir au moins 32 caractères. Les requêtes de purge sont signées HMAC-SHA256 et expirent après cinq minutes.

Le cache WordPress dure une heure avec une copie de secours d’un jour. Une modification de présence ou d’accès incrémente sa version en production. Le développement local n’envoie pas de purge du réglage Annuaire au site de production.

## Vérification locale

L’application expose /annuaire sur localhost:3000 pour revoir les fiches, filtres et QR avant la mise en ligne. Cette préparation ne déploie ni l’application ni le plugin WordPress.
