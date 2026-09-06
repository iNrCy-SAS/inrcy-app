# Rendez-vous visio après inscription

Extension WordPress autonome pour le formulaire Elementor `essai_inrcy_30j` (`405c24a`). Elle ne remplace pas l’inscription existante et ne rappelle jamais l’API de création du compte. Elle récupère seulement le jeton éphémère renvoyé par le succès existant, puis affiche la modale de réservation.

## Parcours

1. L’inscription est validée normalement.
2. La modale propose un rendez-vous de présentation iNrCy.
3. Si le professionnel accepte, les disponibilités réelles de l’équipe sont chargées.
4. La réservation crée un événement d’une heure et conserve deux heures dans le contrôle de disponibilité.
5. Google Meet et les invitations sont créés automatiquement.

Le bouton « Non, continuer sans rendez-vous » ferme simplement la modale. Le consentement téléphonique et le parcours actuel restent inchangés.

## Installation

Créer une archive contenant le dossier `inrcy-visio-booking`, puis l’installer dans **Extensions > Ajouter une extension > Téléverser une extension**. Activer ensuite **iNrCy — Rendez-vous visio après inscription**.

L’activation sur le site public doit uniquement être faite après que les variables Vercel, l’agenda partagé et la connexion Google privée ont été validés.
