# Démonstration X Ads facultative — FR / EN

La documentation officielle X consultée le 30 septembre 2026 ne rend pas une vidéo obligatoire pour Standard Access. Utiliser ce plan uniquement si le formulaire courant ou un reviewer X demande une démonstration.

Durée visée : 2 à 3 minutes. Enregistrer l’interface réelle en Production ou dans un environnement de revue explicitement identifié. Masquer toutes les clés, jetons et données de tiers.

## Storyboard FR

1. **Contexte (10 s)**
   « iNrCy aide les professionnels à préparer et gérer leurs campagnes. Cette démonstration montre la connexion X Ads séparée de la publication X organique. »

2. **Séparation des canaux (15 s)**
   Montrer X Ads dans iNr’ADS et, sans ouvrir de secret, signaler le callback dédié `/api/ads/x/callback`.

3. **Autorisation (25 s)**
   Cliquer sur **Connecter X Ads**, montrer le consentement X et revenir dans iNr’ADS.

4. **Comptes accessibles (30 s)**
   Charger les comptes, expliquer qu’iNrCy affiche uniquement ceux accessibles à l’utilisateur et vérifie rôle, statut, devise et financement.

5. **Association explicite (20 s)**
   Choisir un compte maîtrisé, l’associer, recharger la page et montrer la persistance.

6. **Sécurité et non-diffusion (20 s)**
   Montrer que la publication X Ads reste désactivée et qu’aucune campagne payante n’est créée pendant ce parcours.

7. **Déconnexion isolée (20 s)**
   Déconnecter X Ads, puis montrer que X organique reste connecté.

8. **Conclusion (10 s)**
   « Les jetons sont chiffrés, les secrets restent côté serveur et l’utilisateur garde le contrôle de son compte annonceur. »

## English voice-over

1. “iNrCy helps professionals prepare and manage advertising campaigns. This demonstration shows that X Ads authorization is separate from organic X publishing.”
2. “The Ads callback is dedicated to the X Ads flow and uses OAuth 1.0a user context.”
3. “The user authorizes the App directly on X and returns to iNr’ADS.”
4. “iNrCy lists only ad accounts available to the authorized user and verifies account status, management role, currency, and funding readiness.”
5. “The advertiser account is explicitly selected and remains associated after reload.”
6. “Remote X Ads publishing is currently disabled, so this review flow cannot create spending or serve an ad.”
7. “Disconnecting X Ads removes only the Ads integration and leaves the organic X connection untouched.”
8. “Tokens are encrypted, secrets remain server-side, and the advertiser stays in control.”

## Si un publisher est ajouté plus tard

Tourner une nouvelle vidéo : ne pas recycler celle-ci. La nouvelle version doit montrer le sandbox X, une création `PAUSED`, la relecture de l’objet créé et l’absence de diffusion. Le passage à `ACTIVE` doit rester hors vidéo tant qu’une validation métier séparée ne l’autorise pas.
