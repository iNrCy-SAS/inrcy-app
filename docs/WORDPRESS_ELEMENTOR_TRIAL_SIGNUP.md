# Elementor → iNrCy trial signup

## Endpoint

`POST /api/public/trial-signup?token=YOUR_SECRET`

## Accepted fields

Recommended field names:

- `email`
- `first_name`
- `last_name`
- `company_name`
- `company`
- `phone`
- `legal_form`
- `message`
- `consent`
- honeypot: `website`
- attribution publicitaire : les champs `utm_*`, `campaign_*`, `adset_*`, `ad_*`, `placement`, `site_source_name`, `landing_page_url`, `event_source_url`, `referrer_url`, `event_id`
- mesure Meta consentie : `meta_tracking_consent`, `fbp`, `fbc`, `client_user_agent`

The endpoint also accepts common French aliases like `nom`, `prenom`, `societe`, `telephone`, plus Elementor-style keys such as `form_fields[email]` or `fields[first_name][value]`.

## What the endpoint does

- creates a Supabase Auth invitation
- redirects the invite email to `/set-password?mode=invite`
- upserts the `profiles` row
- creates / refreshes the `subscriptions` trial row
- sends the internal admin alert email
- stores the exact acquisition source in `signup_attributions`
- sends a consent-aware Meta CAPI `Lead` deduplicated with the browser Pixel

## Recommended Elementor setup

Use an Elementor Pro Form widget with:

1. Fields
   - Prénom → `first_name`
   - Nom → `last_name`
   - Email → `email`
   - Société → `company_name`
   - Téléphone → `phone`
   - Forme juridique → `legal_form`
   - Commentaire (optional) → `message`
   - Consent checkbox → `consent`
   - Hidden honeypot → `website`

2. Actions After Submit
   - `Webhook`
   - optional: `Email` to your sales inbox

3. Webhook URL
   - `https://app.inrcy.com/api/public/trial-signup?token=YOUR_SECRET`

4. Success message
   - `Invitation envoyée. Vérifiez votre boîte mail pour créer votre mot de passe et démarrer votre essai gratuit.`

5. Attribution Meta
   - charger `ops/wordpress-meta-attribution/inrcy-meta-attribution.js` sur tout le site
   - retirer l'ancien gestionnaire `fbq('track', 'Lead', ...)` non dédupliqué
   - suivre `docs/META_ATTRIBUTION_CAPI_ROLLOUT.md`

## Supabase prerequisites

- the Auth email template / SMTP must already work
- `NEXT_PUBLIC_APP_URL` must point to the app URL
- the app redirect URL must be allowed in Supabase Auth URL configuration
