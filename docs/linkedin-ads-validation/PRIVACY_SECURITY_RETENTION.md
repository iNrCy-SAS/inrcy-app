# Confidentialité, sécurité et rétention — LinkedIn Ads

Ce document prépare la revue technique. Il ne remplace ni une validation juridique ni la politique de confidentialité publique.

## Données traitées par le connecteur actuel

| Donnée | Source | Finalité | Stockage actuel |
| --- | --- | --- | --- |
| Access token et éventuel refresh token | OAuth LinkedIn | Appels autorisés au nom du membre | Chiffrés côté serveur |
| Scopes accordés | Introspection LinkedIn | Vérifier lecture/gestion | Texte de contrôle |
| Person URN du membre authentifié | API LinkedIn | S’assurer que la reconnexion appartient au même membre | Métadonnée technique |
| ID, nom, devise, pays et état du compte Ads | API LinkedIn | Affichage et association du compte | Sélection et contrôles techniques |
| Rôle du membre sur le compte | `adAccountUsers` | Autorisation de gestion | Dernière vérification |
| Statuts de servabilité | `adAccounts/{id}` | Bloquer les comptes non diffusables | Dernière vérification |
| Brouillon de campagne iNrCy | Données saisies/proposées dans iNrCy | Préparation et reprise ultérieure | Donnée iNrCy, pas une campagne LinkedIn distante |

Le connecteur actuel ne demande pas de reporting et ne collecte pas de données de performance LinkedIn Ads.

## Contrôles techniques vérifiés dans le code

- identifiants LinkedIn Ads distincts, sans fallback implicite vers les identifiants organiques ;
- OAuth Authorization Code 3-legged avec secret serveur ;
- callback HTTPS dédié et `state` anti-CSRF lié à la session ;
- cookie du state HttpOnly, SameSite Lax et durée courte ;
- introspection du jeton, contrôle du `client_id`, du type 3L et des scopes ;
- chiffrement AES-256-GCM des jetons avant écriture ;
- session iNrCy et établissement actif vérifiés ;
- limitation de débit du callback et de la lecture de comptes ;
- relecture des rôles et comptes depuis LinkedIn ;
- refus des comptes Enterprise hors Marketing Solutions ;
- réponses de statut et comptes non mises en cache ;
- déconnexion limitée à l’intégration Ads.

## Exigences LinkedIn de stockage à traduire en politique opérationnelle

LinkedIn impose des durées différentes selon la catégorie de données et précise que la règle la plus courte s’applique lorsqu’une donnée relève de plusieurs catégories. La documentation actuelle prévoit notamment :

- aucune durée maximale spécifique pour l’ID/URN du membre authentifié et certains IDs/URNs de gestion publicitaire ;
- jusqu’à un an pour les données d’administration et de reporting des comptes publicitaires ;
- jusqu’à un an pour les listes standardisées, à l’exception des données de localisation Microsoft Bing qui ne peuvent pas être stockées ;
- des limites plus courtes pour certaines données de profil ou d’activité des membres ;
- suppression sur demande du membre selon les Terms.

Source : <https://learn.microsoft.com/en-us/linkedin/marketing/data-storage-requirements?view=li-lms-2026-03>

Le connecteur doit éviter de persister tout catalogue de ciblage ou donnée membre qui n’est pas indispensable. Une politique de purge explicite doit être définie avant l’ajout du reporting, de données d’organisation détaillées, de Lead Gen ou d’audiences.

## Règles produit à afficher et respecter

1. Utiliser les données LinkedIn uniquement pour gérer le compte et les campagnes demandés par l’utilisateur autorisé.
2. Ne pas utiliser de données de membre LinkedIn pour enrichir un CRM, générer des prospects, compléter un profil ou créer une audience.
3. Ne pas exporter ni transférer des données de membre LinkedIn hors d’iNrCy.
4. Ne jamais journaliser les jetons, secrets, codes OAuth ou cookies.
5. Limiter l’affichage aux utilisateurs rattachés au même établissement iNrCy et au compte LinkedIn autorisé.
6. Réévaluer immédiatement les rôles et l’accès avant chaque future mutation.
7. Honorer la déconnexion, l’expiration du jeton et la demande de suppression.

## Déconnexion et suppression

Le bouton de déconnexion Ads supprime la ligne locale `linkedin_ads` et donc les jetons chiffrés associés. Il ne supprime pas la connexion LinkedIn organique.

URLs à vérifier avant soumission :

- politique de confidentialité de l’app : `https://app.inrcy.com/legal/confidentialite` ;
- gestion de suppression : `https://app.inrcy.com/suppression-compte`.

La présence des routes dans le dépôt ne prouve pas leur accessibilité publique ni que le texte mentionne suffisamment LinkedIn Ads. Effectuer une vérification en navigation privée, puis une revue juridique ciblée.

## Gaps à fermer avant revue Standard

- [ ] Définir une durée opérationnelle de purge pour les métadonnées LinkedIn Ads et l’implémenter.
- [ ] Vérifier si la politique publique décrit explicitement LinkedIn Ads, OAuth, finalités, destinataires et suppression.
- [ ] Vérifier l’effacement de l’intégration Ads lors d’une suppression complète du compte iNrCy.
- [ ] Décider si la déconnexion locale doit aussi guider l’utilisateur vers la révocation de l’autorisation dans LinkedIn.
- [ ] Tester que les logs de production ne contiennent aucune réponse OAuth brute.
- [ ] Documenter les personnes habilitées à accéder aux secrets et le processus de rotation.
- [ ] Préparer une réponse d’incident et un contact de sécurité.
- [ ] Réaliser une revue juridique des LinkedIn Marketing API Program Terms au moment de la soumission.

## Phrase de transparence proposée

> Lorsque vous connectez LinkedIn Ads, iNrCy utilise les autorisations que vous accordez pour afficher les comptes publicitaires que vous administrez et, si vous autorisez explicitement la gestion, créer ou modifier les campagnes que vous validez. Les jetons d’accès sont chiffrés. Vous pouvez déconnecter LinkedIn Ads à tout moment sans déconnecter vos publications LinkedIn organiques.

N’ajouter la partie « créer ou modifier » à la politique publique qu’au moment où cette fonction est réellement active.
