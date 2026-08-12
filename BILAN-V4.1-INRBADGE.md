# iNrCy V4.1 — finition iNrBadge / iNr'Search

## Avant

- La grille « Retrouvez-nous » utilisait le grand visuel horizontal iNr'Search, donc le nom apparaissait dans une pastille prévue pour une icône seule.
- Le grand visuel iNr'Search contenait un damier blanc directement dans l'image et était comprimé dans un carré blanc.
- La règle CSS du bouton « Voir nos actualités » remettait la flèche en position relative, ce qui annulait son centrage vertical.

## Après

- La grille « Retrouvez-nous » utilise exclusivement `inr-search-bubble-128.png` : pastille ronde, sans nom visible.
- Le bouton « Voir nos actualités » utilise exclusivement le logo horizontal « icône + iNr'Search ».
- Une version recadrée et réellement transparente du logo horizontal est fournie dans `public/icons/inr-search-logo-transparent.png`.
- Le logo horizontal est intégré sans cube blanc, avec une zone dédiée comparable à iNr'Calendar.
- La flèche du bouton est positionnée à 50 % de la hauteur et centrée par transformation, sur ordinateur comme sur mobile.
- Les deux usages possèdent des imports distincts afin d'empêcher toute nouvelle inversion accidentelle.

## Vérifications

- Test ciblé iNrBadge/iNr'Search : 5/5.
- Suite Dashboard complète : 312/312.
- TypeScript : validé.
- Build Next.js de production : validé, 218/218 pages générées.

Cette finition est uniquement visuelle et ne nécessite aucune nouvelle requête SQL.
