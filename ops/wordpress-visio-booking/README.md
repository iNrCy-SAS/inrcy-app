# Rendez-vous visio après inscription

Extension WordPress autonome pour le formulaire Elementor `essai_inrcy_30j` (`405c24a`). Elle ne remplace pas l’inscription existante et ne rappelle jamais l’API de création du compte. Elle récupère le jeton sécurisé renvoyé par le succès existant, puis affiche la modale de réservation. Le même parcours peut être rouvert depuis le lien personnel inclus dans l’e-mail d’invitation.

## Parcours

1. L’inscription est validée normalement.
2. La modale propose un rendez-vous de présentation iNrCy.
3. Si le professionnel accepte, tous les créneaux proposés sont chargés.
4. La réservation crée un rendez-vous bleu de 45 minutes dans l’agenda du membre attribué et dans la vue partagée. Un départ est proposé chaque heure de 9 h à 18 h.
5. Google Meet et les invitations sont créés automatiquement.

La sélection affiche six jours disponibles à la fois, avec des flèches pour passer aux jours suivants ou précédents. Les rendez-vous sont proposés du lundi au samedi, jamais le dimanche. Un créneau peut être réservé dès quatre heures après l'instant présent, y compris le jour même s'il est disponible (par exemple, à 8 h pour 12 h).

L’attribution privilégie automatiquement une personne libre parmi Océane, Apolline et Jimmy. Si les trois agendas sont déjà occupés, le rendez-vous reste réservable et est attribué à la personne la moins chargée à cette heure ; les chevauchements pourront ensuite être réorganisés manuellement.

Le bouton « Je choisirai plus tard » ferme la modale tout en laissant un rappel discret sur la page. Le consentement téléphonique et le parcours actuel restent inchangés.

## Installation

Depuis la racine du dépôt, construire l’archive avec les sources actuelles :

```sh
node scripts/build-wordpress-visio-booking.mjs
node scripts/build-wordpress-visio-booking.mjs --check
```

Le livrable est `ops/inrcy-visio-booking.zip`. Il contient le dossier `inrcy-visio-booking/` avec les fichiers PHP, JavaScript, CSS, README et le logo. Le manifeste `ops/inrcy-visio-booking.manifest.json` indique la version et les empreintes SHA-256 de l’archive et de chaque fichier. À sources identiques, l’archive est identique ; `--check` refuse un livrable absent ou périmé sans modifier de fichier. Après chaque modification des sources, reconstruire et vérifier les deux livrables avant livraison.

Installer le ZIP vérifié dans **Extensions > Ajouter une extension > Téléverser une extension**, puis activer **iNrCy — Rendez-vous visio après inscription**. La construction locale ne modifie aucun site WordPress.

À l’installation, l’affichage public est désactivé. Dans **Réglages > Rendez-vous visio iNrCy**, le bouton de test ouvre le formulaire avec la modale uniquement pour un administrateur WordPress connecté. Les autres visiteurs conservent le parcours actuel.

Après un essai complet réussi, cocher **Proposer le rendez-vous à tous les professionnels après une inscription réussie** sur cette même page pour ouvrir le parcours au public.
