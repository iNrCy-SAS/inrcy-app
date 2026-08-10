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

En Standard, iNr’Badge reste une fiche publique et un QR Code complets : téléphone, mail, vCard, formulaire de contact, liens vers les canaux et statistiques. Le bouton Mail utilise exclusivement l’adresse renseignée dans « Mon profil ». Le formulaire transmet les coordonnées à cette adresse et les comptabilise dans iNr’Stats, sans renvoyer l’utilisateur Standard vers le CRM.

La prise de rendez-vous iNr’Badge reste Premium avec iNr’Calendar. Elle est absente des réglages, de la fiche publique et d’iNr’Stats en Standard ; la page publique de réservation et son API refusent également tout accès direct. Les anciennes préférences Premium restent conservées en base pour permettre un futur changement d’édition sans perte de configuration.

La barre supérieure conserve iNr’Agent en Standard afin que la programmation Booster et les bilans automatiques iNr’Stats continuent de fonctionner. Son interface ne présente que deux rubriques : **Publier** et **Statistiques**. **Propulser** et **Fidéliser** restent Premium : elles sont invisibles, refusées par les API et neutralisées dans les tâches automatiques, y compris pour une ancienne action programmée avant un passage de Premium vers Standard.

Tout le reste conserve le graphisme actuel. Le menu général reste disponible, mais les autres écrans Premium sont également protégés côté serveur : un simple changement d’URL ou un appel API direct ne permet pas de les ouvrir.

## Premium

L’expérience Premium existante n’a pas été redessinée ni réduite. Elle conserve l’architecture et les outils actuels.

Dans le compte Standard, l’offre Premium est présentée avec un bouton de contact. Aucun passage autonome ni paiement Premium n’est autorisé pour le moment.

Dans « Mon compte », les informations et identifiants du professionnel restent affichés en premier. Le forfait actif et l’offre Premium sont présentés ensuite, sans passage autonome vers Premium.

Lorsque Google Business n’est pas connecté dans Réputation, chaque avis fictif porte désormais le badge « EXEMPLE », le texte précise qu’aucun vrai avis n’est chargé et un bouton « Brancher Google » renforcé remplace toute ambiguïté. Ces marqueurs disparaissent dès que les vrais avis sont disponibles.

## Cohérence complète de l’édition Standard

- le petit bouton du cadre Booster ouvre de nouveau son bilan historique propre ; il s’appelle « Bilan » et ne redirige plus vers iNrStats ;
- iNrStats Standard ne charge ni n’affiche les statistiques Mails, y compris dans les bilans produits par iNr’Agent ;
- iNr’Send Standard ne donne accès qu’à la colonne Publications et refuse également le téléchargement direct d’un fichier appartenant à une rubrique Premium ;
- Mon inertie conserve Booster comme seule mission active ; Propulser et Fidéliser restent visibles en aperçu grisé « Forfait Premium », dans le panneau, l’historique et son aide ;
- le GPS adapte iNr’Agent, iNr’Send, Booster, iNrStats et les parcours de démarrage au forfait Standard ; les rubriques Propulser, Fidéliser, CRM, Agenda et Devis & Factures sont des aperçus grisés avec un contact Premium ;
- les anciennes actions Premium éventuellement créées avant un passage en Standard sont neutralisées, et leurs gains ne peuvent plus être attribués par appel API direct.

## Base de données et déploiement

- une petite migration additive ajoute uniquement `subscriptions.app_edition` ;
- la valeur par défaut Supabase est `standard`, ce qui protège aussi les futurs parcours d’inscription ;
- les lignes déjà présentes sont initialisées à `premium` ;
- `plan`, `status`, Stripe, les données métier et les validations API/OAuth ne sont pas modifiés ;
- la migration additive a été exécutée avec succès par le responsable du projet ; la réintégration limitée d’iNr’Agent ne demande aucun SQL supplémentaire.

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
- build Next.js de production et génération des 220 pages : validés ;
- suite complète du dashboard, incluant l’édition Standard, les nouveaux inscrits, le dashboard actuel, les blocs inférieurs, Mon compte, les bulles, la reconnexion, Booster, iNr’Badge, la navigation, Réputation et les protections d’accès : 277/277 ;
- suites iNr’Agent et iNr’Send, incluant Publications, bilans, programmation et restrictions Standard : 87/87.

Total automatisé : 364/364 tests validés.

## Retour arrière

Le ZIP de sauvegarde `inrcy-avant-ajout-standard-20260810-windows.zip` contient l’état complet antérieur à l’ajout de l’édition Standard. Pour un retour complet : restaurer d’abord ce code, puis exécuter si nécessaire `ops/sql/2026-08-10_subscriptions_app_edition_rollback.sql`.
