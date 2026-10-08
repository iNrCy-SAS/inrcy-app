# TikTok Traffic : raccordement de la création suspendue

La branche ne crée que des objets `DISABLE`. Elle ne contient aucun endpoint d’activation. Deux contrôles distincts sont nécessaires : le flag serveur `TIKTOK_ADS_PAUSED_CREATION_ENABLED=true` et une preuve native serveur valide. Aucun de ces paramètres n’est activé par le code.

Après approbation de l’application et connexion réelle du compte, un opérateur autorisé peut obtenir le périmètre de l’intégration avec :

```powershell
node --env-file=.env.local scripts/tiktok-native-capability-scope.mjs --user-id UUID_DU_PROPRIETAIRE
```

Cette commande lit uniquement la ligne `integrations` du propriétaire, du produit Ads et de la source `tiktok_ads`. Elle ne déchiffre aucun jeton et ne fournit aucun droit : `authorityVerified` reste `false`. Elle affiche seulement l’App ID, l’annonceur, le contexte et l’empreinte de l’intégration chiffrée. Une nouvelle autorisation ou sélection de compte invalide cette empreinte.

La variable serveur privée `TIKTOK_ADS_NATIVE_CAPABILITY_EVIDENCE` accepte un objet JSON, ou au maximum dix objets, avec ces champs exacts :

- `scope` : les quatre champs produits par la commande ;
- `source` : `{ "kind": "operator_verified_native_access", "reference": "URL HTTPS du contrôle TikTok officiel" }` ;
- `manualTrafficV13`, `nativeWriteAccess`, `videoUpload`, `imageUpload`, `mediaRead`, `objectRead` : `verified` uniquement après vérification réelle, sinon `unverified` ;
- `allowedNonSparkIdentityTypes` et `callToActions` : valeurs natives effectivement autorisées ;
- `minimumLifetimeBudgetEuros` : minimum EUR confirmé pour ce compte et ce calendrier, ou `null` ;
- `budgetCalendar` : les instants ISO exacts `startAt`/`endAt` vérifiés, ou `null` ;
- `scheduleTimeBasis` : `utc` ou `advertiser` uniquement si confirmé pour l’API utilisée, sinon `null` ;
- `scheduleOffsetMinutes` : décalage fixe confirmé pour `advertiser`, sinon `null` ;
- `verifiedAt`/`validUntil` : dates ISO de l’attestation de l’opérateur, valables au maximum 24 heures.

Ne jamais renseigner `verified` à partir d’un simple GET compte/identité, d’une documentation générique ou de la présence d’un jeton. Le minimum EUR, les CTA, la disponibilité des identités non-Spark et l’accès à l’upload image ne sont pas déduits automatiquement. Les champs inconnus doivent rester inconnus et bloquer la création.

Le préflight relit l’autorisation, le compte EUR, les identités et le catalogue Traffic/TikTok. Il crée un snapshot de liaison valable au maximum cinq minutes sans renouveler les dates originales de l’attestation. Toute expiration ou différence d’application, de compte, de connexion, de choix, de budget, de calendrier ou de destination bloque l’action suivante. Une confirmation du récapitulatif ne remplace jamais ces contrôles.

Le stockage durable doit également être installé : le contrôle serveur utilise la RPC de lecture `inrcy_ads_prepared_paused_store_ready`. Une RPC absente, une erreur ou un résultat différent de `true` retourne `campaign_store_migration_required` avant tout appel TikTok. Les médias sont relus dans la médiathèque du propriétaire et dans le préfixe de stockage `users/UUID_DU_PROPRIETAIRE/` ; une modification de leurs métadonnées invalide la confirmation précédente.

Pour reprendre une opération, seules les routes serveur peuvent indiquer qu’un checkpoint propriétaire existe. Une mutation au résultat incertain ne peut pas être relancée automatiquement. La réconciliation est exclusivement en GET et ne déclare une pause confirmée qu’après vérification des trois objets et de leurs parents.

Le présent branchement n’a pas été testé sur une API TikTok réelle. Une application en attente ou des identifiants absents doivent bloquer la connexion ; ne jamais les remplacer par des valeurs de démonstration.
