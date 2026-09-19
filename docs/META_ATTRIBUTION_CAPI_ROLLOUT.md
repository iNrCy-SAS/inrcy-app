# Attribution Meta Ads + Conversions API iNrCy

Ce correctif permet de relier chaque inscription à sa source, sa campagne, son ensemble de publicités, sa publicité et son placement. Lorsque le consentement marketing Complianz est actif, il alimente le tunnel Meta `Lead` → `CompleteRegistration` → `Subscribe`.

## 1. Ordre de déploiement

1. Vérifier que le socle historique `ops/sql/2026-08-29_signup_attribution_meta_capi.sql` est installé, puis appliquer `supabase/migrations/20260919140000_meta_conversion_funnel_outbox.sql` dans Supabase.
2. Déployer l'application Next.js corrigée.
3. Ajouter les variables Vercel décrites ci-dessous.
4. Installer le script `ops/wordpress-meta-attribution/inrcy-meta-attribution.js` dans le code personnalisé WordPress, sur tout le site.
5. Définir `INRCY_TRIAL_SIGNUP_TOKEN` dans `wp-config.php`, puis synchroniser l'extrait Code Snippets d'inscription avec `ops/wordpress-trial-signup-relay/inrcy-trial-signup-relay.php`. Ce relais est indispensable : il copie explicitement les champs publicitaires du POST Elementor vers l'API et ne contient plus de secret de secours.
6. Supprimer l'ancien script WordPress qui déclenche seul `fbq('track', 'Lead', ...)`, pour éviter les doublons.
7. Ajouter les paramètres dynamiques aux URL des publicités Meta.
8. Tester dans « Gestionnaire d'événements > Tester les événements » avant d'activer la production.

## 2. Variables Vercel

À ajouter aux environnements Production, Preview et Development si nécessaire :

```text
META_PIXEL_ID=1726690678613315
META_CONVERSIONS_API_ACCESS_TOKEN=JETON_GENERE_DANS_META
META_GRAPH_API_VERSION=v25.0
```

Pour le test uniquement :

```text
META_CAPI_TEST_EVENT_CODE=TEST12345
```

Retirer `META_CAPI_TEST_EVENT_CODE` après validation. Ne jamais mettre le jeton Meta dans WordPress, le navigateur, Git ou un fichier public.

## 3. Paramètres d'URL Meta Ads

À coller dans « Paramètres de l'URL » de chaque publicité :

```text
utm_source={{site_source_name}}&utm_medium=paid_social&utm_campaign={{campaign.name}}&utm_content={{ad.name}}&utm_term={{adset.name}}&campaign_id={{campaign.id}}&campaign_name={{campaign.name}}&adset_id={{adset.id}}&adset_name={{adset.name}}&ad_id={{ad.id}}&ad_name={{ad.name}}&placement={{placement}}&site_source_name={{site_source_name}}
```

Meta remplace ces variables au moment du clic. Les noms donnent un rapport lisible ; les IDs restent fiables même si une campagne est renommée.

## 4. WordPress et Elementor

Le script fourni :

- transmet les paramètres publicitaires de la page d'accueil aux boutons d'inscription ;
- conserve l'attribution pendant toute la navigation de l'onglet, même si le visiteur consulte plusieurs pages avant de s'inscrire ;
- ajoute automatiquement les champs cachés au formulaire Elementor ;
- crée un `event_id` commun au Pixel et à la Conversions API ;
- déclenche le Pixel `Lead` après le succès réel du formulaire ;
- respecte le consentement marketing Complianz ;
- ne conserve jamais le `fbclid` brut ;
- conserve `_fbp`, `_fbc` et le user-agent uniquement côté serveur, si le consentement marketing est actif, avec suppression automatique après 90 jours.

Le formulaire de production utilise l'extrait Code Snippets versionné dans
`ops/wordpress-trial-signup-relay/inrcy-trial-signup-relay.php`. Il faut
conserver le secret exclusivement dans `wp-config.php`, sans le copier dans
Code Snippets ni dans Git.

Si l'action Webhook native Elementor est utilisée à la place, son URL reste :

```text
https://app.inrcy.com/api/public/trial-signup?token=YOUR_SECRET
```

Le script doit être chargé sur tout le site. En cas de minification/cache WordPress, purger les caches après sa publication.

Attention : `$record->get('fields')` ne contient pas nécessairement les champs
ajoutés dynamiquement au DOM. Le relais versionné lit donc ces champs depuis
`$_POST['form_fields']` avec une liste blanche stricte. Ne reconstruire le JSON
avec les seuls champs visibles du formulaire, sinon toute la provenance est
silencieusement supprimée.

## 5. Vérification attendue

Effectuer une inscription de test depuis une URL comme :

```text
https://inrcy.com/?utm_source=ig&utm_medium=paid_social&utm_campaign=TEST_CAPI&utm_content=VIDEO_TEST&utm_term=PROS_FRANCE&campaign_id=111&adset_id=222&ad_id=333&placement=instagram_reels&site_source_name=ig
```

Vérifier ensuite :

1. le bouton d'inscription conserve les paramètres ;
2. l'e-mail « Nouvelle inscription iNrCy » contient la provenance complète ;
3. l'administration iNrCy affiche l'acquisition dans le détail du compte ;
4. Supabase contient une ligne dans `public.signup_attributions` ;
5. Meta reçoit un seul `Lead` avec le même `event_id` côté navigateur et serveur ;
6. `capi_status` vaut `sent` et `capi_events_received` vaut `1` lorsque le consentement marketing est actif ;
7. sans consentement marketing, l'attribution interne existe mais `capi_status` vaut `skipped` avec `marketing_consent_missing`.
8. après création du mot de passe d'invitation, `public.meta_conversion_events` contient un unique `CompleteRegistration` ; une réinitialisation de mot de passe n'en crée aucun ;
9. après la première facture d'abonnement Stripe strictement positive, la même table contient un unique `Subscribe` avec le montant et la devise ; les renouvellements ne créent pas de second événement ;
10. les statuts `retry_wait` sont repris par `/api/cron/meta-conversions` et les événements `dead` restent visibles pour diagnostic.

## 6. Données et confidentialité

Les UTM, noms/IDs de campagnes, placements et URLs nettoyées sont conservés pour l'attribution interne. Les identifiants navigateur Meta et le user-agent ne sont enregistrés qu'avec consentement, dans une table inaccessible aux rôles `anon` et `authenticated`, et sont purgés après 90 jours. Les coordonnées envoyées à Meta sont normalisées puis hachées en SHA-256 côté serveur. La suppression du compte efface automatiquement l'attribution et sa file de conversions grâce aux clés étrangères `on delete cascade`.

La politique de confidentialité du site doit expliquer l'utilisation de Meta Pixel/Conversions API et le partage de données hachées avec Meta lorsque le consentement marketing est donné.
