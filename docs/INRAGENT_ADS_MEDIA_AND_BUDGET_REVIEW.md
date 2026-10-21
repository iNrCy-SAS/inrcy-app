# iNrAgent et iNrAds — cohérence des médias et revue de campagne

## Changements du 21 octobre 2026

### iNrAgent

- Une image ou vidéo de la médiathèque ou de la banque d’images est lue avant la rédaction. Le sujet est choisi à partir des observations du fichier, avec l’ADN pour le contexte et le ton.
- Un média nouvellement généré pour cette publication garde le parcours sujet → génération du média → rédaction.
- Un ancien sujet planifié, un nom de fichier ou des tags ne remplacent pas les observations. Une idée professionnelle qui n’est pas utilisée n’est pas consommée.
- Les modèles sans vision reçoivent une observation neutre issue de la lecture du média. Les faits mis en cache sont séparés du mode historique guidé par un sujet.
- Un fichier existant illisible ne produit pas un texte fondé uniquement sur ses métadonnées. Le mécanisme de reprise et de restitution des crédits s’applique.
- Les images volumineuses ou dans un format non accepté par la vision utilisent une copie temporaire JPEG ; le fichier destiné à la publication reste intact.

### iNrAds : lancement Meta

- Meta utilise maintenant le même contrôle d’activation sur la page et dans les routes de publication et de reprise.
- `INRCY_META_ADS_PUBLISH_ENABLED=false` conserve une coupure propre à Meta. L’ancien drapeau global pilote n’impose plus un verrou permanent au lancement Meta.
- Le mode de démonstration reste soumis à son activation distincte.
- Les droits, l’identité et le compte, le contrôle des médias, les ressources natives et les confirmations de diffusion et de dépense restent obligatoires.

### iNrAds : informations à compléter

- Les étapes concernées affichent un triangle sur leur bulle numérotée et sur leur libellé. En affichage compact, le triangle reste sur la bulle.
- Les numéros, les règles de navigation et l’accès aux étapes déjà atteintes sont conservés. Les avertissements se recalculent quand le brouillon change.
- Les champs requis et les contrôles natifs alimentent la modale finale et les indications de navigation. Les vérifications d’un ancien brouillon sont écartées.
- Google, Meta, LinkedIn, Pinterest, ChatGPT Ads, TikTok et X utilisent ce fonctionnement, en parcours manuel et assisté.

### iNrAds : budget et durée proposés

- Une nouvelle analyse fournit `budgetRecommendation` : montant quotidien indicatif, durée et justification adaptée au contexte de la campagne.
- Les anciens replis fixes (généralement 10 € et sept jours) ne remplacent plus une recommandation valide. Un nouveau résultat sans recommandation justifiée rejoint le contrôle et la réparation existants.
- Le montant, l’enveloppe totale, les dates et la durée explicitement demandés par le professionnel priment sur la proposition. Une enveloppe totale ne devient jamais un budget quotidien.
- La justification est consultable à l’étape Budget de l’analyse en cours. Un ancien brouillon n’est pas présenté comme porteur d’une nouvelle recommandation.
- Le modèle reçoit l’activité, l’offre, les zones et les publics connus. Les seuls noms de campagnes passées ne constituent pas des données de performance ; aucune prévision de rentabilité n’est déduite de ces noms.
- Les budgets restent modifiables et soumis aux vérifications natives et aux confirmations de lancement existantes.

## Vérifications

- Suites Ads : 1 230 tests, dont la transmission réelle des recommandations normalisées jusqu’au formulaire sur les sept canaux, les contraintes humaines, les contrôles natifs et les ressources de compte.
- Affichage : six tests Chromium, incluant mobile, tablette et ordinateur et les triangles dans la navigation réelle.
- iNrAgent : suites de préparation/rédaction et tests de lecture d’images volumineuses et TIFF, avec contrôle de conservation des originaux.
- TypeScript, ESLint et vérification des espaces du diff.
- Les tests IA remplacent les appels de génération par des réponses de test ; ils ne mesurent pas la pertinence commerciale d’une recommandation produite en conditions réelles.

Ces changements ne déclenchent aucune publication publicitaire. Le lancement d’une campagne reste soumis à la validation explicite du professionnel.
