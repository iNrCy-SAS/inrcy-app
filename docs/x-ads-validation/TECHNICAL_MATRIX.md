# Matrice technique X Ads

## Séparation X organique / X Ads

| Sujet | X organique | X Ads |
| --- | --- | --- |
| Protocole | OAuth 2.0 | OAuth 1.0a, 3-legged, contexte utilisateur |
| Variables | `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REDIRECT_URI` | `X_ADS_API_KEY`, `X_ADS_API_SECRET`, `X_ADS_REDIRECT_URI` |
| Callback Production | `/api/integrations/x/callback` | `/api/ads/x/callback` |
| Stockage | intégration organique | `provider=x`, `source=x_ads`, `product=ads` |
| Droits | scopes X API v2 | App `Read and write` + Standard Access + rôle du compte Ads |
| Déconnexion | publications organiques | Ads uniquement |

Une même App X peut techniquement exposer l’API standard et l’Ads API, mais les protocoles, jetons, callbacks et enregistrements iNrCy restent séparés. Les identifiants OAuth 2.0 ne sont jamais utilisés pour signer une requête Ads.

## Routes iNrCy

| Route | Méthode | Rôle | Mutation X Ads |
| --- | --- | --- | --- |
| `/api/ads/x/start` | GET | Demande un request token OAuth 1.0a et redirige vers X | Non |
| `/api/ads/x/callback` | GET | Vérifie état + request token, échange contre jeton utilisateur | Non |
| `/api/ads/x/status` | GET | Lit connexion, comptes et readiness | Non |
| `/api/ads/x/accounts` | GET | Liste les comptes accessibles, vérifie le compte sélectionné | Non |
| `/api/ads/x/accounts` | POST | Persiste explicitement le compte éligible | Non chez X |
| `/api/ads/x/disconnect` | POST | Supprime uniquement l’intégration locale `x_ads/ads` | Non |

Les routes de mutation de campagne X sont volontairement absentes. `lib/adsXPublish.ts` prépare seulement un plan fail-closed et n’effectue aucun `fetch`.

## Appels X Ads en lecture

Tous les appels utilisent `https://ads-api.x.com/12/...`, HTTPS, OAuth 1.0a HMAC-SHA1 et le contexte utilisateur.

| Endpoint | Finalité |
| --- | --- |
| `GET /12/accounts` | Découvrir les comptes annonceurs du membre autorisé |
| `GET /12/accounts/:account_id/authenticated_user_access` | Lire le rôle réel sur le compte |
| `GET /12/accounts/:account_id/funding_instruments` | Vérifier devise et capacité de financement |

La pagination est parcourue jusqu’à épuisement du curseur, avec une borne et détection de boucle. Une réponse partielle empêche l’association.

## Conditions d’association iNrCy

- identifiant de compte syntaxiquement valide ;
- `approval_status=ACCEPTED` ;
- compte non supprimé ;
- rôle `ACCOUNT_ADMIN` ou `AD_MANAGER` ;
- un instrument actif et capable de financer ;
- devise unique vérifiée `EUR`.

Ces contraintes produit sont plus strictes que le simple accès en lecture et empêchent d’afficher un faux état « prêt ».

## Variables serveur

| Variable | Obligatoire | Exposition navigateur |
| --- | --- | --- |
| `X_ADS_API_KEY` | Oui | Interdite par convention iNrCy |
| `X_ADS_API_SECRET` | Oui | Interdite |
| `X_ADS_REDIRECT_URI` | Oui | Valeur publique, mais lue côté serveur |
| `X_ADS_API_VERSION` | Recommandée, valeur `12` | Non |
| `NEXT_PUBLIC_APP_URL` | Oui | Oui, URL publique |
| `INRCY_CREDENTIALS_SECRET` | Oui | Interdite |

Contrôle : `npm run verify:x-ads-env`.

## Sécurité

- liaison OAuth à la session et au compte iNrCy actif ;
- callback limité au chemin Ads et à l’origine canonique de l’application, y compris en développement local ;
- cookie temporaire chiffré, `HttpOnly`, `SameSite=Lax`, durée 10 minutes ;
- comparaison constante du request token retourné ;
- jetons chiffrés avant Supabase ;
- contrôles d’origine sur les POST locaux ;
- secrets jamais inclus dans le bundle client ou les logs ;
- passage en `needs_update` sur erreur 401 ou déchiffrement impossible ;
- aucun compte annonceur sélectionné automatiquement ;
- publication distante désactivée.

## Évolution vers la publication

Avant toute activation :

1. utiliser `ads-api-sandbox.x.com` pour tester sans diffusion ;
2. relire juste avant mutation le compte, le rôle, l’instrument, le post et les critères ;
3. créer campagne et line item en `PAUSED` uniquement ;
4. vérifier le résultat par GET ;
5. ajouter idempotence, journal d’audit et reprise sur erreur ;
6. exposer un feature flag serveur distinct ;
7. faire approuver explicitement le passage de `PAUSED` à `ACTIVE`.
