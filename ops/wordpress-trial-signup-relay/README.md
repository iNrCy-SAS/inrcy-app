# Relais WordPress des inscriptions iNrCy

Ce fichier est la source versionnee de l'extrait Code Snippets actif
`Invitation inrcy essai 30 j`.

Le relais lit les champs standards depuis le record Elementor et les champs
d'attribution ajoutes par le navigateur directement depuis
`$_POST['form_fields']`. Elementor ne garantit pas que les champs ajoutes au DOM
apres le rendu figurent dans `$record->get('fields')`.

Avant publication dans Code Snippets :

1. definir `INRCY_TRIAL_SIGNUP_TOKEN` dans `wp-config.php` ; l'extrait echoue
   volontairement si la constante est absente et ne contient aucun secret de
   secours ;
2. ne jamais enregistrer ce secret dans Git ;
3. laisser l'extrait actif et execute partout ;
4. purger le cache WordPress apres la mise a jour ;
5. valider une inscription avec des parametres Meta factices puis verifier
   `public.signup_attributions` et l'e-mail d'administration.
