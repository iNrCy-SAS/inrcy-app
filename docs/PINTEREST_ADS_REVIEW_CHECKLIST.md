# Pinterest Ads — dossier d’autorisation et preuve vidéo

Ce document prépare une éventuelle nouvelle revue Pinterest de l’application iNrCy. Il ne contient aucun secret, jeton OAuth ni identifiant de compte publicitaire.

## État vérifié dans Pinterest Developers

Contrôle manuel effectué le 29 septembre 2026 sur l’application iNrCy :

- niveau d’accès affiché : **Accès Standard actif** ;
- callback organique enregistré : `https://app.inrcy.com/api/integrations/pinterest/callback` ;
- callback Ads enregistré : `https://app.inrcy.com/api/ads/pinterest/callback` ;
- les permissions Ads en lecture et en écriture sont disponibles dans la table des scopes du portail.

Une nouvelle demande d’upgrade n’est donc pas visible actuellement. Ne soumettre un nouveau dossier que si Pinterest le demande ou si le niveau d’accès change.

## Contrôles techniques avant démonstration

- [ ] `npm run verify:pinterest-env` réussit dans l’environnement visé.
- [ ] Le callback de production correspond exactement à celui déclaré dans Pinterest Developers.
- [ ] Le bouton de connexion demande les scopes définis par `PINTEREST_ADS_SCOPES` : `ads:read`, `ads:write`, `boards:read`, `boards:write`, `pins:read` et `pins:write`.
- [ ] Le callback refuse un `state` OAuth absent, expiré, réutilisé ou non conforme.
- [ ] Le code échange le code OAuth côté serveur et ne place jamais de jeton dans l’URL du navigateur.
- [ ] Les jetons d’accès et de renouvellement sont chiffrés avant stockage.
- [ ] Le scope retourné par Pinterest est revalidé après la connexion et après chaque renouvellement.
- [ ] La liste des comptes Ads provient de l’API Pinterest et le compte choisi est revérifié côté serveur.
- [ ] Seuls les comptes en EUR sont associables dans cette première version.
- [ ] À la validation, **Enregistrer en brouillon** reste local dans iNr’Send ; **Lancer la campagne** ouvre la validation finale avec `Active` par défaut et `Paused` en option.

## Scénario de vidéo si Pinterest demande une nouvelle revue

Pinterest demande une vraie capture de l’intégration et du flux OAuth, pas une maquette. Masquer les secrets, jetons, données personnelles et identifiants inutiles.

1. Ouvrir iNrCy avec un utilisateur de démonstration déjà authentifié.
2. Aller dans **iNr’ADS**, choisir **Pinterest Ads**, puis ouvrir **Configurer**.
3. Cliquer sur **Connecter Pinterest Ads**.
4. Montrer la page de consentement Pinterest avec les permissions demandées, puis autoriser le compte de démonstration.
5. Montrer le retour automatique vers iNrCy et la lecture réelle des comptes publicitaires accessibles.
6. Associer un compte de démonstration autorisé et facturé en EUR.
7. Générer une proposition Pinterest puis parcourir : objectif, audience, découverte, épingle sponsorisée, format du Pin, destination et mesure, budget, validation.
8. Enregistrer le brouillon et montrer qu’il apparaît dans **iNr’Send > ADS > Brouillons**.
9. Réouvrir ce brouillon sur **Validation** et modifier une étape précédente pour démontrer que le professionnel garde le contrôle.
10. Cliquer sur **Lancer la campagne**, conserver le choix **Paused**, confirmer la validation finale, puis montrer la campagne, le groupe d’annonces, l’épingle publicitaire et l’annonce en pause dans Pinterest Ads Manager.

Pendant une éventuelle démonstration de revue, utiliser **Paused** pour ne déclencher aucune diffusion. Le choix **Active** est destiné au lancement réel demandé explicitement par le professionnel.

## Description d’application proposée

La description enregistrée dans Pinterest Developers doit refléter le cas d’usage Ads avant une éventuelle nouvelle revue. Texte proposé :

> iNrCy enables authenticated business users to connect their Pinterest account through OAuth, select an advertising account they are authorized to manage, and prepare Pinterest-specific campaigns. Users review the objective, audience, Pin creative, destination, schedule, budget, and final launch status. They may save the campaign as a private iNrCy draft, create it on Pinterest in Paused status, or explicitly launch it in Active status. The current automated publisher supports a standard image Pin for Awareness and Consideration objectives and creates the campaign hierarchy in Paused status before any optional activation. iNrCy never collects Pinterest credentials. The application also lets users manage boards, create and publish Pins, and view Pinterest performance data from their own workspace.

Ne pas enregistrer ce texte dans le portail sans validation humaine finale du périmètre produit présenté à Pinterest.

## Références officielles

- Accès Trial et Standard : <https://developers.pinterest.com/docs/key-concepts/access-tiers/>
- OAuth et scopes : <https://developers.pinterest.com/docs/getting-started/set-up-authentication-and-authorization/>
- Campagnes et groupes d’annonces : <https://developers.pinterest.com/docs/work-with-ads/create-campaigns-and-ad-groups/>
- Objectifs `SALES` et `LEADS` : <https://developers.pinterest.com/docs/work-with-ads/try-out-campaign-objective-type-simplification/>
- Créations publicitaires : <https://developers.pinterest.com/docs/work-with-ads/managing-ads/>
