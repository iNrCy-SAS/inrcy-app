# Navigation du site WordPress

Source de l’extrait actif « iNrCy — responsive multilingue automatique (corrigé) », identifiant 33 dans Code Snippets sur inrcy.com. Le fichier PHP contient son enveloppe complète. Lors d’une mise à jour de cet extrait, coller son contenu sans la première balise PHP, puis conserver son état actif et sa priorité existante.

Le script inrcy-active-nav-fix choisit le lien actif selon sa destination, en tenant compte des sous-pages et des langues. Il attribue aria-current="page" au seul lien actif. L’ordre du menu n’intervient pas dans cette sélection.

Vérification : node --test tests/wordpress-navigation/active-navigation.test.mjs. Après une publication WordPress, vider le cache HTML du site puis vérifier Accueil, Contact et Annuaire sur ordinateur et mobile.
