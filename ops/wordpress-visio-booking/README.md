# Rendez-vous visio après inscription

Extension WordPress autonome pour le formulaire Elementor `essai_inrcy_30j` (`405c24a`). Elle ne remplace pas l’inscription existante et ne rappelle jamais l’API de création du compte. Elle récupère seulement le jeton éphémère renvoyé par le succès existant, puis affiche la modale de réservation.

## Parcours

1. L’inscription est validée normalement.
2. La modale propose un rendez-vous de présentation iNrCy.
3. Si le professionnel accepte, les disponibilités réelles de l’équipe sont chargées.
4. La réservation crée un événement d’une heure et conserve deux heures dans le contrôle de disponibilité.
5. Google Meet et les invitations sont créés automatiquement.

La sélection affiche sept jours disponibles à la fois, avec des flèches pour passer à la semaine suivante ou précédente. Les rendez-vous sont proposés du lundi au samedi, jamais le dimanche. Un créneau peut être réservé le jour même s’il reste au moins deux heures de délai, sinon dès le lendemain.

Le bouton « Non, continuer sans rendez-vous » ferme simplement la modale. Le consentement téléphonique et le parcours actuel restent inchangés.

## Installation

Créer une archive contenant le dossier de l’extension, puis l’installer dans **Extensions > Ajouter une extension > Téléverser une extension**. Activer ensuite **iNrCy — Rendez-vous visio après inscription**.

À l’installation, l’affichage public est désactivé. Dans **Réglages > Rendez-vous visio iNrCy**, le bouton de test ouvre le formulaire avec la modale uniquement pour un administrateur WordPress connecté. Les autres visiteurs conservent le parcours actuel.

Après un essai complet réussi, cocher **Proposer le rendez-vous à tous les professionnels après une inscription réussie** sur cette même page pour ouvrir le parcours au public.
