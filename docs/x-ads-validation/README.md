# X Ads — dossier de validation iNrCy

État : **socle de connexion prêt, accès externe non présumé, demande non soumise**. Dernière vérification documentaire : 30 septembre 2026.

Ce dossier prépare la demande **X Ads API Standard Access** de l’application iNrCy. Il ne contient ni Consumer Secret, ni jeton OAuth, ni identifiant de compte publicitaire réel.

## Verdict actuel

| Élément | État | Conséquence |
| --- | --- | --- |
| OAuth 1.0a Ads distinct de X organique | Implémenté | Callback, variables et stockage dédiés |
| Liste des comptes annonceurs | Implémentée en lecture seule | Nécessite l’approbation Ads API de l’app |
| Vérification rôle, statut et financement | Implémentée | Association limitée aux comptes acceptés, administrables et en EUR |
| Sélection persistée | Implémentée | Le compte reste associé après rechargement et réautorisation du même utilisateur X |
| Brouillon iNrCy et préflight `PAUSED` | Implémentés localement | Aucun appel de création de campagne distante |
| Publication X Ads | **Désactivée** (`publicationEnabled: false`) | Aucune dépense ni diffusion possible depuis ce connecteur |
| Configuration Vercel | Variables Ads présentes en Production | `X_ADS_API_KEY`, `X_ADS_API_SECRET` et `X_ADS_REDIRECT_URI` observées sans révéler leurs valeurs |
| Demande Standard | À remplir manuellement | Une approbation X reste obligatoire |

## Blocage portail constaté

Contrôle en lecture seule du 30 septembre 2026 : l’App X existante est bien réglée en OAuth 1.0a **Read and write** et en type Web/Automated/Bot, mais seule l’URL organique `https://app.inrcy.com/api/integrations/x/callback` est enregistrée. Le callback Ads `https://app.inrcy.com/api/ads/x/callback` manque encore dans X Developer Console.

Le même contrôle confirme que `X_ADS_API_KEY`, `X_ADS_API_SECRET` et `X_ADS_REDIRECT_URI` sont déjà déclarées sur Vercel Production ; le redirect est aussi présent en Preview. Aucune valeur n’a été affichée ou modifiée. Le blocage restant est donc bien le callback manquant dans le portail X, puis l’approbation Ads API de l’App.

Tant que cette URL Ads exacte n’est pas ajoutée au portail, le code iNrCy est prêt mais le retour OAuth X Ads ne peut pas être validé de bout en bout. Aucun réglage du portail n’a été modifié automatiquement.

## Ce que X exige officiellement

1. Un compte développeur et une App.
2. Une demande Ads API pour **chaque App** via le formulaire officiel.
3. Le niveau **Standard Access** pour Analytics, Campaign Management, Creatives, Custom Audiences et Conversions en lecture/écriture.
4. Des requêtes HTTPS signées en OAuth 1.0a avec un jeton utilisateur ayant accès au compte annonceur.
5. La régénération des jetons utilisateur après l’approbation Ads API.
6. La vérification des permissions au niveau du compte annonceur.

La documentation officielle consultée ne mentionne pas de vidéo obligatoire pour la demande Standard. Le formulaire affiché au moment de la soumission reste la source de vérité. Un plan de démonstration facultatif est néanmoins prêt si X demande une preuve.

## Pas de « scopes » OAuth 2.0 pour ce parcours

La connexion X organique d’iNrCy utilise son propre OAuth 2.0 et ses propres scopes. X Ads utilise ici **OAuth 1.0a en contexte utilisateur**. L’accès est gouverné par :

- les permissions `Read and write` configurées sur l’App X ;
- le niveau Ads API accordé à l’App (`Standard Access`) ;
- le rôle de l’utilisateur sur chaque compte annonceur (`ACCOUNT_ADMIN`, `AD_MANAGER`, etc.).

Le connecteur ne mélange jamais ces deux sessions.

## Ordre recommandé

1. Dans l’App X retenue, conserver la connexion organique existante et ajouter le callback Ads exact : `https://app.inrcy.com/api/ads/x/callback`.
2. Vérifier que l’authentification utilisateur de l’App autorise **Read and write**.
3. Compléter les réponses proposées dans ce dossier avec les volumes réels.
4. Soumettre manuellement le formulaire **Ads API Access** pour cette App.
5. Après approbation, régénérer/réautoriser les jetons utilisateur.
6. Ajouter les variables serveur puis exécuter `npm run verify:x-ads-env`.
7. Tester connexion, liste des comptes, rôle, financement et persistance sur un compte maîtrisé.
8. Conserver `publicationEnabled: false` tant qu’une mutation de campagne n’a pas été auditée dans le sandbox X puis en Production.

## Documents du dossier

- [Checklist de préparation](./READINESS_CHECKLIST.md)
- [Matrice technique](./TECHNICAL_MATRIX.md)
- [Réponses proposées FR/EN](./APPLICATION_ANSWERS_FR_EN.md)
- [Parcours reviewer](./REVIEWER_TEST_PLAN.md)
- [Confidentialité, sécurité et rétention](./PRIVACY_SECURITY_RETENTION.md)
- [Inventaire des preuves](./EVIDENCE_INVENTORY.md)
- [Démonstration vidéo facultative FR/EN](./OPTIONAL_DEMO_VIDEO_FR_EN.md)

## Sources officielles vérifiées

- Démarrage et niveaux d’accès : <https://docs.x.com/x-ads-api/getting-started/step-by-step-guide>
- Augmentation d’accès : <https://docs.x.com/x-ads-api/getting-started/increasing-access>
- Comptes et permissions : <https://docs.x.com/x-ads-api/fundamentals/accessing-ads-accounts>
- Authentification Ads : <https://docs.x.com/x-ads-api/fundamentals/making-authenticated-requests>
- Versionnement (`/12/` courant) : <https://docs.x.com/x-ads-api/fundamentals/versioning>
- Sandbox sans diffusion : <https://docs.x.com/x-ads-api/fundamentals/sandbox>
- Présentation et délai indicatif de revue : <https://docs.x.com/x-ads-api/introduction>
- Référence Campaign Management : <https://docs.x.com/x-ads-api/campaign-management/reference>
- Règles développeur : <https://docs.x.com/developer-guidelines>

X conserve la décision finale d’approuver l’App et peut modifier son formulaire ou demander des preuves supplémentaires.
