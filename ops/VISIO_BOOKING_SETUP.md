# Prise de rendez-vous visio après inscription

Ce module est indépendant de l’ancien connecteur Google Agenda d’iNrCalendar. Les routes `app/api/integrations/google-calendar/*` restent volontairement supprimées (`410`) et ne sont pas utilisées.

## Variables de production

Obligatoires :

- `INRCY_VISIO_BOOKING_SECRET` : secret aléatoire dédié aux jetons éphémères. À défaut, le code sait utiliser `INRCY_TRIAL_SIGNUP_SECRET`, mais un secret distinct est recommandé.
- `INRCY_VISIO_SHARED_CALENDAR_ID` : identifiant de l’agenda « Agenda partagé iNrCy ».
- `INRCY_VISIO_GOOGLE_REDIRECT_URI` : `https://app.inrcy.com/api/admin/visio-booking/google/callback`.
- `INRCY_VISIO_GOOGLE_ACCOUNT_EMAIL` : compte Google interne autorisé à gérer l’agenda partagé.
- `KV_REST_API_URL` et `KV_REST_API_TOKEN` : verrou distribué obligatoire en production.
- `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` et `INRCY_CREDENTIALS_SECRET` : infrastructure OAuth/chiffrement existante.

Recommandées :

- `INRCY_VISIO_BOOKING_ALERT_EMAIL=compte@inrcy.com`
- `INRCY_VISIO_PUBLIC_CALENDAR_ID=contact@admin-inrcy.com` : agenda principal du compte affiché comme « Équipe iNrCy », seul expéditeur des invitations externes. Ne pas utiliser ici l’identifiant technique `c_...@group.calendar.google.com` de l’agenda partagé.
- `INRCY_VISIO_BOOKED_COLOR_ID=9` pour la couleur bleue des rendez-vous réservés.
- `INRCY_VISIO_HORIZON_DAYS=21`
- `INRCY_VISIO_MINIMUM_LEAD_DAYS=1` pour proposer les rendez-vous dès le lendemain, sans imposer 24 heures glissantes.
- `INRCY_VISIO_ALLOWED_ORIGINS=https://inrcy.com,https://www.inrcy.com`

Les identifiants d’agenda d’Océane, Apolline et Jimmy ont des valeurs par défaut conformes aux comptes actuels. Ils peuvent être surchargés avec `INRCY_VISIO_OCEANE_CALENDAR_ID`, `INRCY_VISIO_APOLLINE_CALENDAR_ID` et `INRCY_VISIO_JIMMY_CALENDAR_ID`.

## Google Workspace

1. Ajouter l’URI de redirection ci-dessus au client OAuth existant.
2. Le compte interne connecté doit avoir accès aux disponibilités des trois agendas, pouvoir écrire dans l’agenda public « Équipe iNrCy » et dans « Agenda partagé iNrCy ».
3. Ouvrir `/api/admin/visio-booking/google/start` avec la session admin iNrCy et accepter uniquement les droits Agenda demandés.
4. Vérifier `/api/admin/visio-booking/google/status`.

## WordPress

Installer puis activer le dossier `ops/wordpress-visio-booking` sous forme d’extension. Le plugin observe la réponse de l’appel d’inscription existant : il ne crée jamais une seconde inscription.

## Règles métier verrouillées

- rendez-vous du lundi au samedi, dimanche exclu ;
- horaires 9h, 11h, 14h, 16h et 18h, heure de Paris ;
- réservation possible dès le lendemain, jamais le jour même et sans décalage automatique à J+2 ;
- événement réservé créé en bleu pour 1 heure, avec une fenêtre interne de disponibilité de 2 heures ;
- rappel orange d'inscription conservé 1 heure uniquement si aucun rendez-vous n'est réservé ;
- retrait automatique du rappel orange correspondant dès qu'un rendez-vous est confirmé ;
- deux rendez-vous simultanés maximum ;
- attribution automatique à la personne disponible ayant reçu le moins de rendez-vous ;
- création Google Meet sur l’agenda du membre affecté ;
- invitation du professionnel envoyée uniquement par le vrai compte public « Équipe iNrCy », jamais par l’identifiant technique de l’agenda partagé ;
- copie interne sans notification visible dans l’agenda partagé et alerte à `compte@inrcy.com`.
