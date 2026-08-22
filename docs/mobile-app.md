# iNrCy mobile shell

The mobile work is isolated on the `mobile-app` branch. The web application
and its Stripe checkout remain unchanged.

## Identity

- App name: `iNrCy`
- Android application ID / iOS bundle ID: `com.inrcy.app`
- Canonical web origin: `https://app.inrcy.com`

## Local commands

```powershell
npm run typecheck
node --test --test-isolation=none --experimental-strip-types tests/mobile-runtime/native-runtime.test.mts tests/mobile-billing/client-subscription-routing.test.mts
npm run mobile:sync
npm run mobile:android
npm run mobile:ios
```

`mobile:sync` normalise automatiquement les chemins du manifeste Swift après
chaque synchronisation Capacitor, y compris quand la synchronisation est
lancée depuis Windows.

The native projects are already generated. Run `npm run mobile:assets` only
when the source logo changes, then run `npm run mobile:sync`.

## Native subscriptions

The billing contract is deliberately account-based:

- the web app keeps Stripe;
- an account created on the web keeps its 21-day iNrCy trial on mobile;
- after the trial, iOS uses App Store billing and Android uses Google Play
  billing;
- RevenueCat links the store purchase to the Supabase user ID and its webhook
  updates the shared subscription record, so the same account works on web and
  mobile without creating a second active billing source.

Before enabling native purchases in a deployed build:

1. Run `ops/sql/2026-08-20_native_billing.sql` in the Supabase SQL editor.
2. Create the Standard monthly and yearly products in App Store Connect and
   Google Play Console. Premium remains team-managed in the current app and
   can be added later without changing the account contract.
3. Add the Standard products to RevenueCat and configure the `standard`
   entitlement.
4. Set `NEXT_PUBLIC_REVENUECAT_IOS_API_KEY` and
   `NEXT_PUBLIC_REVENUECAT_ANDROID_API_KEY` in the mobile build environment.
5. Deploy the database migration before deploying the native webhook route.
6. Set the RevenueCat webhook URL to
   `https://app.inrcy.com/api/billing/native/webhook` and its authorization
   value to `REVENUECAT_WEBHOOK_AUTHORIZATION`.

Native purchase code remains fail-closed until the public RevenueCat keys and
the store products exist. Stripe checkout is not changed by this configuration.

For a staging or LAN server, set `CAPACITOR_SERVER_URL` only for the command
that generates/synchronizes the native project. The default remains the
canonical HTTPS app origin.

## Release checklist

The native project is prepared for the first signed builds:

- iOS uses portable forward-slash Swift Package paths, declares camera and
  microphone usage, registers the `inrcy://` and legacy `com.inrcy.app://`
  schemes, and includes the privacy manifest plus Associated Domains
  entitlement.
- Android declares camera and microphone permissions, accepts both custom
  schemes plus `https://app.inrcy.com` links, and refuses to produce a release
  artifact until an upload key is configured.

Signing material is intentionally not included in source control or ZIP files.
Before building a release:

1. In Xcode, select the `App` target and choose the Apple Developer Team for
   `com.inrcy.app` in **Signing & Capabilities**. Keep **Automatically manage
   signing** enabled.
2. Enable **Associated Domains** for the App ID and publish an Apple App Site
   Association file for `app.inrcy.com` using the real Team ID.
3. Copy `android/keystore.properties.example` to
   `android/keystore.properties` and fill it with the existing Google Play
   upload-key values. Never place the keystore or passwords in the repository.
4. Publish an Android Digital Asset Links file for `app.inrcy.com` with the
   SHA-256 certificate fingerprint of the Play app-signing/upload key.
5. Run `npm run test:mobile`, then build the signed iOS archive and Android
   AAB on the respective native toolchains.

## Rollback

The `baseline-before-mobile` tag is the pre-mobile state. Native work can be
removed independently because the web app is still served by Next.js and the
mobile branch is separate.
