# Revalider les informations d’iNrAssistant

Les parcours de l’assistant doivent suivre les écrans, les conditions d’accès et les effets des outils actuels. Le hash global de l’application ne suffit pas à certifier une procédure.

`scripts/assistant-guide-reviews.json` conserve, pour chaque guide, une empreinte de sa procédure et des fichiers répertoriés dans `sourceFiles`. Le contrôle échoue si un guide a changé, si une de ses sources a changé, si un guide n’a pas encore été revu ou s’il a été supprimé. Les fins de lignes Windows/Linux sont normalisées.

## Après un changement d’interface ou d’outil

1. Exécuter `npm run assistant:knowledge:check` pour connaître les guides concernés.
2. Comparer leur texte avec les sources et le parcours réel. Vérifier les libellés, l’ordre des étapes, les offres, les conditions de connexion et la différence entre préparer et exécuter. Mettre à jour les sorties des outils et le centre d’aide qui décrivent le même parcours.
3. Mettre à jour ou ajouter les tests des questions réellement posées. Les étapes annoncées doivent correspondre à l’interface, même quand un ancien URL reste disponible comme redirection.
4. Après cette relecture, valider explicitement les guides concernés, puis régénérer l’index :

```sh
node scripts/build-assistant-code-index.mjs --review-guides=reputation,channel-google-business --write
npm run assistant:knowledge:check
npm run test:assistant
```

`--write` seul met à jour l’index global uniquement si les procédures sont déjà revalidées. Il ne remet pas automatiquement à jour les empreintes de relecture. `--review-guides=all --write` est réservé à une relecture de l’ensemble des guides ; il prend aussi en compte les suppressions.

`sourceFiles` doit inclure les composants, les règles d’accès et les handlers qui déterminent ce que décrit le guide. Ajouter une source pertinente permet aux changements ultérieurs de déclencher sa revalidation. Les empreintes sont des repères de relecture, pas une analyse automatique du sens des boutons.

## Vérifier les réponses informatives

`scripts/inr-assistant-information-qa.mjs` définit des questions et des contrats sur le texte de réponse : parcours des avis Google en français/anglais, accès Basique à Studio et distinction entre factures d’abonnement et factures clients.

La QA existante conserve ses assertions sur les appels d’outils et ajoute ces vérifications de réponse. Le mode `--live` utilise les vrais modèles, avec des effets métier remplacés par des données de démonstration. Le mode hors ligne ne certifie pas les réponses : son texte fournisseur est un exemple fixe, ce que le rapport indique explicitement.

Les tests `guide-freshness.test.mjs` et `information-qa.test.mjs` contrôlent respectivement la détection d’une procédure/source modifiée et le rejet des mauvaises réponses reproduites.
