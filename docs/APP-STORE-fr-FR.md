# App Store — iNrCy (fr-FR)

État vérifié le 19 septembre 2026.

## Identité Apple

- Nom : `iNrCy`
- Plateforme : iOS
- Bundle ID : `com.inrcy.app`
- App Store ID : `6813871919`
- SKU : `INRCY-IOS-001`
- Version marketing : `1.0`
- Build : `1`
- Team ID : `C5F54XF6NT`
- Statut App Store Connect : `À finaliser avant soumission`
- Aucun terme « Beta » dans la fiche.

## Fiche produit validée

- Sous-titre : `Publiez partout en 1 clic`
- Catégorie principale : `Économie et entreprise`
- Catégorie secondaire : `Productivité`
- Classement d’âge : `4+`
- URL marketing : `https://inrcy.com/`
- URL d’assistance : `https://inrcy.com/contact/`
- URL de confidentialité : `https://inrcy.com/politique-de-confidentialite/`
- Copyright : `2026 iNrCy`
- Publication : automatique après validation Apple.
- Prix de téléchargement : gratuit (`0 EUR`).
- Disponibilité : les `175` pays et régions proposés par App Store Connect.

### Texte promotionnel

> iNrCy génère des contenus personnalisés et optimisés pour votre activité, puis les adapte et les publie sur vos 12 canaux en 1 clic.

### Description

Votre communication publiée partout en 1 clic.

iNrCy génère des contenus personnalisés et optimisés pour développer la visibilité de votre entreprise depuis un seul espace.

Une idée, une photo, une vidéo ou quelques mots suffisent : iNrCy crée des contenus adaptés à votre activité, à votre audience et aux spécificités de chaque canal. Vous gardez la main, ajustez si nécessaire, puis validez la diffusion.

Connectez jusqu’à 12 canaux :

- Facebook
- Instagram
- LinkedIn
- Site internet
- iNrSearch
- iNrBadge
- TikTok
- YouTube
- Pinterest
- X
- Google Business
- E-mails

Avec iNrCy, vous pouvez :

- générer des contenus personnalisés et optimisés ;
- adapter le ton, le format et le message à chaque canal ;
- publier votre communication sur plusieurs canaux en 1 clic ;
- programmer et retrouver vos publications ;
- suivre vos campagnes et leurs performances ;
- centraliser votre communication et vos actions commerciales.

iNrCy est conçu pour les professionnels qui veulent rester visibles sans transformer leur communication en deuxième métier.

Les fonctionnalités disponibles dépendent de votre abonnement, des canaux connectés et des services activés dans votre espace iNrCy.

### Mots-clés

`communication,contenus,réseaux sociaux,marketing,publication,IA,entreprise,multicanal,campagnes`

## Captures App Store

Les trois captures iPhone 6,5 pouces sont au format Apple `1242 × 2688` :

- `assets/app-store/iphone-6.5/01-votre-communication-partout-1242x2688.png`
- `assets/app-store/iphone-6.5/02-contenus-personnalises-1242x2688.png`
- `assets/app-store/iphone-6.5/03-douze-canaux-1242x2688.png`

Elles ont été téléversées et acceptées par App Store Connect (`3/10`). Apple les réutilisera pour les autres tailles d’iPhone.

## Confidentialité Apple

Le manifeste natif et la déclaration App Store sont préparés pour les données réellement traitées par iNrCy :

- coordonnées : nom, e-mail, téléphone, adresse physique et autres coordonnées ;
- autres informations financières liées aux devis et factures ;
- contacts CRM ;
- e-mails ou messages ;
- photos, vidéos et audio ;
- assistance client et autres contenus utilisateur ;
- identifiant utilisateur ;
- historique d’achats ;
- interactions, autres données d’utilisation et statistiques ;
- pannes, performances et autres diagnostics ;
- autres données métier ou issues des canaux connectés.

Toutes ces catégories sont déclarées sans suivi publicitaire. iNrCy n’utilise ni IDFA, ni courtier de données, ni publicité tierce dans l’app. Les données sont principalement utilisées pour le fonctionnement, la personnalisation, l’analyse technique et, pour les achats RevenueCat, la validation des droits et les statistiques d’abonnement.

La déclaration de confidentialité a été publiée dans App Store Connect le 19 septembre 2026. Elle comporte 20 types de données, tous liés au compte utilisateur et aucun utilisé à des fins de suivi.

## Configuration native et automatisation ajoutées

- Signature automatique associée à l’équipe Apple `C5F54XF6NT` pour Debug et Release.
- `ITSAppUsesNonExemptEncryption = NO` : l’app utilise uniquement le chiffrement standard/exempté, notamment HTTPS et les mécanismes système.
- Manifeste `PrivacyInfo.xcprivacy` aligné sur la déclaration App Store.
- Workflow manuel `.github/workflows/ios-app-store.yml` : vérification non signée par défaut sur `macos-26` / Xcode 26, archive signée et envoi TestFlight uniquement si l’option correspondante est explicitement activée.
- Options d’export App Store dans `ios/ExportOptions.plist`.

### Secrets GitHub requis pour l’archive signée

Aucun secret ne doit être ajouté au dépôt. Le workflow signé attend uniquement des secrets GitHub Actions :

- `APPLE_DISTRIBUTION_CERTIFICATE_BASE64`
- `APPLE_DISTRIBUTION_CERTIFICATE_PASSWORD`
- `APPLE_PROVISIONING_PROFILE_BASE64`
- `APPLE_ID`
- `APPLE_APP_SPECIFIC_PASSWORD`

Sans ces cinq secrets, seule la vérification iOS non signée peut être lancée.

## Abonnements natifs et RevenueCat

- Les achats Stripe restent utilisés uniquement dans la version web.
- Les applications iOS et Android chargent les prix localisés depuis leur magasin et utilisent RevenueCat pour l’achat et la restauration des droits.
- Produits Standard attendus sur les deux magasins :
  - mensuel : `com.inrcy.standard.monthly` ;
  - annuel : `com.inrcy.standard.yearly`.
- Les deux abonnements existent dans App Store Connect. Les prix France sélectionnés dans les paliers Apple sont `69,90 € / mois` et `749,99 € / an`.
- L’application Android `com.inrcy.app` est créée dans RevenueCat sous le nom `iNrCy (Play Store)`.
- La clé publique iOS et la clé publique Android RevenueCat sont enregistrées dans Vercel pour la production.
- Le webhook `https://app.inrcy.com/api/billing/native/webhook` est créé dans RevenueCat pour les événements de production et de sandbox ; son secret est stocké uniquement dans Vercel.
- Le compte de service Google Play RevenueCat est créé, sa clé JSON est enregistrée dans RevenueCat et les autorisations de catalogue, achats et abonnements sont accordées. La validation des achats reste temporairement en attente de propagation côté Google.

## Alignement Google Play

- Production Android publiée : `1.0.5 – Expérience mobile améliorée`.
- Fiche Google Play mise à jour et publiée le 19 septembre 2026.
- Extension de la disponibilité à `177` pays/régions envoyée à Google pour examen le 19 septembre 2026.

## Éléments restant avant soumission

1. Finaliser la mise à jour de l’entité juridique Apple, accepter le contrat des apps payantes, puis renseigner les informations fiscales et bancaires.
2. Ajouter une capture de vérification à chacun des deux abonnements Apple.
3. Créer les deux abonnements correspondants dans Google Play, puis les rattacher à l’entitlement et à l’offering Standard dans RevenueCat.
4. Attendre la propagation des autorisations du compte de service Google et relancer la validation RevenueCat.
5. Créer un mot de passe spécifique à l’app Apple, puis enregistrer les cinq valeurs de signature dans les secrets GitHub Actions. Le certificat Apple Distribution et le profil App Store sont déjà créés et vérifiés localement, hors du dépôt.
6. Fournir à Apple un compte de démonstration fonctionnel et les notes de vérification.
7. Lancer le workflow de vérification iOS, puis l’archive signée avec envoi TestFlight.
8. Vérifier TestFlight sur un iPhone réel et compléter les éventuelles informations demandées par Apple.
9. Demander une confirmation finale avant de cliquer sur « Soumettre pour vérification ».

La version n’a pas encore été soumise à l’examen Apple.
