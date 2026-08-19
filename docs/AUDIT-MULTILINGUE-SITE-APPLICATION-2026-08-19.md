# Audit multilingue iNrCy — site et application

Date : 19 août 2026

## Référence utilisée

- Archive de départ : `inrcy-app-correctif-verrou-booster-standard-2026-08-19.zip`
- SHA-256 : `54B7E628D83452B1FDDB5C55C348AF90BB9321ACBBC4A800DB99D290F5DFFE07`
- Langues couvertes : français, anglais, espagnol, italien, allemand, néerlandais et portugais.

## Contrat de langue vérifié

1. TranslatePress expose la langue du site dans l'URL et dans la balise `html[lang]`.
2. Le formulaire public transmet la langue sélectionnée à l'API d'inscription.
3. L'API accepte les variantes de champ TranslatePress (`trp-form-language`, `trp_form_language` et `trp_language`).
4. La langue est enregistrée dans les métadonnées du compte (`app_language` et `app_locale`).
5. Les liens d'invitation et de réinitialisation utilisent une route localisée sans placer la langue dans le paramètre de redirection Supabase.
6. L'application recharge cette langue pour l'authentification, l'onboarding, le tableau de bord, les réglages, les messages d'erreur et les pages publiques.

## Corrections application

- Références i18n statiques complétées dans les 7 langues.
- Validation automatique ajoutée pour empêcher une clé utilisée par l'interface d'être absente d'un catalogue.
- Contrôle renforcé des variables ICU, des termes de marque, de l'encodage, des entités HTML et des fragments français accidentels.
- Textes des modales média, des canaux sociaux, des mails, des réglages Profil / Activité / IA et des erreurs métier localisés.
- Pages publiques iNr'Search, métadonnées SEO et données structurées rendues dépendantes de la langue courante.
- Inscription publique compatible avec les différents noms de champ de langue envoyés par TranslatePress.
- Tests de régression adaptés à la nouvelle génération SEO localisée.

## Correction WordPress préparée

Le texte « Publié » de la page d'accueil n'est pas une image. Le script Elementor du héros le réinjecte en français après chaque animation. Le correctif `docs/wordpress/inrcy-home-hero-locale-runtime.php` :

- détecte la langue via `html[lang]`, avec repli sur le préfixe d'URL ;
- traduit les 12 canaux et leurs états (`Publié`, `Envoi en cours`, `Mis à jour`, etc.) ;
- traduit les boutons Modifier / Supprimer, les KPI et les quatre étapes ;
- couvre les 7 langues du produit ;
- réapplique la bonne langue après les mutations Elementor sans recharger la page ;
- reste limité à la page d'accueil et au composant `#inrcyHeroSteps`.

Ce bloc est prévu pour être ajouté au snippet WordPress existant n°31. Il ne remplace ni Elementor ni TranslatePress.

## Ajustements TranslatePress identifiés

- Espagnol : `Nom` → `Apellidos`.
- Italien : `Nom` → `Cognome`.
- Allemand : `Nom` → `Nachname`.
- Portugais : `Nom` → `Apelido`.
- Portugais : `Nos Packs` → `Os nossos planos`.
- Portugais : harmoniser le libellé des CGV et des conditions d'utilisation.
- Espagnol et italien : harmoniser la grammaire du libellé des conditions.

Ces changements sont des traductions de contenu WordPress et doivent être enregistrés dans TranslatePress, puis le cache WordPress doit être vidé.

## Points volontairement non modifiés

- Les slugs traduits existants n'ont pas été renommés : cela demanderait des redirections 301 et une validation SEO avant publication.
- Les textes juridiques longs intégrés à l'application restent la version française de référence. Une traduction juridique validée doit remplacer une traduction automatique avant qu'une autre langue puisse être présentée comme juridiquement équivalente.
- Aucun secret, fichier `.env`, mot de passe ou donnée de production n'est inclus.
- Aucune migration SQL supplémentaire n'est nécessaire.

## Validation finale

- Audit i18n : aucune référence non enregistrée.
- Catalogues : 7 langues, 17 catalogues, 6 218 messages français de référence.
- Références statiques : 8 475 appels contrôlés.
- Tests : 1 477 réussis, 0 échec.
- ESLint : réussi.
- TypeScript : réussi.
- Build Next.js : réussi, 218 pages générées.
- Test dédié du héros WordPress : 2 réussis, 0 échec.

Le build local a été exécuté avec des variables Supabase factices uniquement pour permettre la collecte des routes. Elles ont été supprimées avant la création de l'archive.

## Ordre de déploiement conseillé

1. Déployer l'archive de l'application sur la branche de préproduction ou de production habituelle.
2. Laisser Vercel exécuter `npm ci` puis `npm run build`.
3. Ajouter le runtime du héros au snippet WordPress n°31.
4. Enregistrer les quelques corrections TranslatePress listées ci-dessus.
5. Vider le cache WordPress.
6. Vérifier l'accueil et l'inscription dans les 7 langues, puis une invitation complète jusqu'au premier écran de l'application.

