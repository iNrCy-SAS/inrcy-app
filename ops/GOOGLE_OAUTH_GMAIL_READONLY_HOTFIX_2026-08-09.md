# Correctif OAuth Gmail du 9 août 2026

## Cause

Le flux OAuth de production demandait `gmail.readonly`, alors que ce scope
restreint n'était pas déclaré ni approuvé dans Google Auth Platform. Google
affichait donc « application non validée » même si le branding et les scopes
déjà soumis apparaissaient en vert.

## Comportement du correctif

- `gmail.send` reste demandé : l'envoi Gmail continue de fonctionner.
- `gmail.readonly` est entièrement retiré du flux OAuth : l'écran rouge
  provoqué par ce scope disparaît.
- Le scanner de boîte Gmail a été retiré : même les anciens comptes ne sont plus
  lus par ce traitement. Les autres fournisseurs et l'envoi Gmail ne sont pas
  affectés.

Si une future fonctionnalité exige réellement la lecture Gmail, ce scope devra
être réintroduit seulement après sa déclaration et son approbation complète par
Google.
