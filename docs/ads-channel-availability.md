# Disponibilité des canaux iNr’ADS

État de la configuration de l’application au 15 octobre 2026, après validation Meta indiquée par l’équipe.

| Canal | Comptes professionnels autorisés à iNr’ADS | Validation interne existante |
| --- | --- | --- |
| Meta Ads | Accessible | Accessible |
| Google Ads | Accessible | Accessible |
| Pinterest Ads | Accessible | Accessible |
| ChatGPT Ads | Accessible | Accessible |
| LinkedIn Ads | À venir, boutons désactivés | Accessible |
| TikTok Ads | À venir, boutons désactivés | Accessible |
| X Ads | À venir, boutons désactivés | Accessible |

Les droits commerciaux Premium / Founder restent nécessaires. L’ouverture d’un canal ne remplace ni OAuth, ni les droits du compte publicitaire, ni les vérifications de ressources et de facturation. Les protections techniques de publication, de création en pause et de diffusion payante sont inchangées.

La navigation des modales de connexion passe uniquement par les canaux autorisés. Un appel direct à une configuration indisponible reste sans effet ; les routes API gardent leur contrôle serveur par canal.

## Accès de validation conservés

Le mécanisme existant `isAdsPilotAdmin` est conservé : comptes administrateurs internes et unique identité `FULL_PRODUCT_REVIEWER_ACCOUNT_ID` avec le rôle serveur `reviewer`, uniquement quand son propre compte est actif. Un autre rôle reviewer, un profil utilisateur ou un changement de compte ne donne pas cette exception.

Un audit en lecture seule du 15 octobre a confirmé l’existence de cette unique identité reviewer. Aucune connexion LinkedIn Ads n’était associée à cette identité au moment du contrôle : cela confirme une exception de test produit, sans établir l’existence d’un reviewer LinkedIn dédié. Aucun rôle ni compte n’a été créé ou modifié.

Le texte « À venir » réutilise `dashboard.signatureTools.comingSoon`, déjà traduit dans les neuf langues de l’application. Aucun dictionnaire iNrStudio n’est modifié.
