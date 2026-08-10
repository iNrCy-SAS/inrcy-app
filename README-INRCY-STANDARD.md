# iNrCy Standard — dossier de présentation et de test

## Résultat livré

iNrCy reste une seule application et une seule architecture Supabase. Trois informations indépendantes évitent désormais tout mélange entre produit et facturation :

- `app_edition` : `standard` ou `premium`, pour les grands outils accessibles ;
- `plan` : `Trial`, `Starter`, `Accel`, `Speed`, etc., conservé pour les niveaux commerciaux et les futures options ;
- `status` : `trialing`, `active`, `trial_expired`, etc., conservé pour le cycle d’accès.

Tous les comptes historiques reçoivent `app_edition = premium` lors de la migration. Chaque future inscription, publique ou Admin, reçoit exactement `plan = Trial`, `status = trialing` et `app_edition = standard`.

L’écran Admin permet de basculer manuellement `app_edition` entre Standard et Premium pendant l’essai, sans modifier le plan, le statut, les dates ni Stripe.

## Expérience Standard

Le tableau de bord Standard reprend volontairement le dashboard iNrCy actuel : même barre, même Générateur, mêmes KPI, mêmes statuts de canaux, mêmes bulles et même carrousel. La différence graphique est limitée aux deux blocs inférieurs :

- à gauche : une « Boîte de pilotage » avec iNr’Stats, iNr’Send limité aux Publications et Réputation ; chaque ligne aligne l’icône, les informations et son action ;
- à droite : Booster occupe tout le cadre et constitue l’appel à l’action principal, sans carte imbriquée ni ancien libellé « Boîte de vitesse / Conversion » ;
- 10 canaux de publication : Site iNrCy, Site web, Google Business, iNr’Search, Facebook, Instagram, LinkedIn, TikTok, YouTube et Pinterest ;
- les vraies bulles de connexion sont conservées avec leur état, « Voir » et « Configurer » ;
- iNr’Badge reste une vraie bulle interactive, incluse comme bonus et non comptée parmi les 10 canaux ;

La barre supérieure ne propose pas iNr’Agent en Standard. Tout le reste conserve le graphisme actuel. Le menu général reste disponible, mais les écrans Premium sont également protégés côté serveur : un simple changement d’URL ne permet pas de les ouvrir.

## Premium

L’expérience Premium existante n’a pas été redessinée ni réduite. Elle conserve l’architecture et les outils actuels.

Dans le compte Standard, l’offre Premium est présentée avec un bouton de contact. Aucun passage autonome ni paiement Premium n’est autorisé pour le moment.

Dans « Mon compte », les informations et identifiants du professionnel sont affichés avant les informations de forfait.

Lorsque Google Business n’est pas connecté dans Réputation, chaque avis fictif porte désormais le badge « EXEMPLE », le texte précise qu’aucun vrai avis n’est chargé et un bouton « Brancher Google » renforcé remplace toute ambiguïté. Ces marqueurs disparaissent dès que les vrais avis sont disponibles.

## Base de données et déploiement

- une petite migration additive ajoute uniquement `subscriptions.app_edition` ;
- la valeur par défaut Supabase est `standard`, ce qui protège aussi les futurs parcours d’inscription ;
- les lignes déjà présentes sont initialisées à `premium` ;
- `plan`, `status`, Stripe, les données métier et les validations API/OAuth ne sont pas modifiés ;
- aucun SQL n’a été exécuté et aucune modification n’a été déployée en production depuis ce dossier.

Ordre de déploiement : exécuter `ops/sql/2026-08-10_subscriptions_app_edition.sql`, puis déployer le nouveau code.

## Aperçu local sans changer un compte

Dans un environnement local uniquement, ajouter dans `.env.local` :

```env
INRCY_DEV_DASHBOARD_EDITION=standard
```

Puis lancer :

```powershell
npm install
npm run dev
```

Cette variable est volontairement ignorée en production. Pour revoir Premium en local, remplacer `standard` par `premium` ou supprimer la variable.

## Contrôles réalisés

- TypeScript : validé ;
- ESLint sur tous les fichiers modifiés : validé ;
- tests édition Standard, nouveaux inscrits, dashboard actuel, blocs inférieurs, Mon compte, bulles et protections d’accès : 10/10 ;
- tests de reconnexion et sélection Booster : 14/14 ;
- tests de navigation et préchargement : 8/8.
- tests spécifiques Réputation et avis d’exemple : 3/3.

Total ciblé : 35 tests réussis, aucun échec.

## Retour arrière

Le ZIP de sauvegarde `inrcy-avant-ajout-standard-20260810-windows.zip` contient l’état complet antérieur à l’ajout de l’édition Standard. Pour un retour complet : restaurer d’abord ce code, puis exécuter si nécessaire `ops/sql/2026-08-10_subscriptions_app_edition_rollback.sql`.
