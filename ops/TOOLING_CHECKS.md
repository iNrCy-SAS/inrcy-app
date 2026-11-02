# Contrôles locaux et CI

## Plans QA publication et médias

Les commandes `qa:*` et `certify:*` répertoriées dans `scripts/qa-plans.json` conservent leurs dépendances de contrôle. Le lanceur développe ce graphe et exécute chaque **suite npm nommée** une seule fois, puis `typecheck`, `lint` et `build` lorsqu'ils sont requis. Les suites peuvent toujours partager des fichiers de test : leurs globs et leurs commandes restent inchangés.

```sh
npm run certify:publication-system -- --plan
npm run certify:publication-system
npm run test:tooling
```

`--plan` affiche les commandes sans les exécuter. Chaque étape passe par `npm run`, y compris `build`, afin de conserver `prebuild` et les autres hooks npm. Une erreur arrête le plan. Les scripts d'audit concernés lisent les fichiers locaux ; ils ne modifient pas les données de production.

La certification publication appelait auparavant `typecheck` neuf fois et certaines suites médias plusieurs fois. Le plan en conserve l'union exacte et appelle `typecheck` une seule fois. La CI exécutait déjà son propre `typecheck` et son `build` une seule fois ; cette déduplication concerne les agrégateurs QA locaux.

## Dette ESLint explicite

```sh
npm run lint:hygiene
npm run lint:hygiene -- lib/example.ts app/example/page.tsx
```

Ce contrôle en lecture seule réactive `@typescript-eslint/no-unused-vars` et `react-hooks/exhaustive-deps` sur `app`, `lib` (hors fournisseur `lib/vendor`), `hooks` et `i18n`. La référence examinée du 2 novembre 2026 contient 393 avertissements de variables inutilisées et 193 de dépendances de hooks. Le contrôle est ajouté à la CI et refuse toute nouvelle identité `(fichier, règle, message)` ou occurrence supplémentaire, ainsi que les erreurs ESLint. Déplacer seulement une ligne dans le même fichier ne crée pas un avertissement nouveau.

Les suppressions d'avertissements sont acceptées. Lorsqu'un avertissement est corrigé, retirer son entrée ou réduire son compteur dans `scripts/lint-hygiene-baseline.json` après revue. Une extraction vers un autre fichier demande une correction ou une revue explicite de cette référence ; le script ne la régénère jamais automatiquement. Aucun autofix n'est appliqué. Le contrôle `lint` existant continue à couvrir les autres règles et fichiers.

## Dépendances et portée TypeScript

Les tests navigateur importent les objets Playwright depuis la dépendance directe existante `@playwright/test` ; les objets `chromium`, `firefox` et `webkit` sont identiques à ceux de `playwright`. Les outils qui importent directement `@formatjs/icu-messageformat-parser`, `intl-messageformat`, `@sentry/core` et `@sentry/node` les déclarent désormais en dépendances de développement avec les versions exactes déjà verrouillées. Ce changement ne met à niveau aucun paquet.

`tsconfig.json` reste inchangé : l'inventaire initial comprend 3 291 fichiers racines, dont 1 057 tests et 6 déclarations générées Next. Sortir les tests du projet principal demanderait un second projet pour conserver leur contrôle et pourrait contrôler deux fois les modules applicatifs importés. Aucun gain de compilation n'est établi ; la mesure porte sur l'inventaire, pas sur une accélération supposée. Dans une copie neuve, générer les types Next avant le contrôle TypeScript si les déclarations `.next` manquent.

L'alignement futur des versions Next et `eslint-config-next` est une opération distincte, avec sa propre validation ; il ne fait pas partie de ce nettoyage.
