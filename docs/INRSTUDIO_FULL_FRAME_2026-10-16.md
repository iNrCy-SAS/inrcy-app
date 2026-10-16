# iNrStudio : génération plein cadre

## Problème et comportement attendu

Un fichier généré pouvait déjà contenir des bandes blanches latérales avant sa publication Facebook. L’adaptation du canal conservait alors ces bandes. La normalisation image ajoutait aussi une copie floutée autour du premier plan lorsque le ratio natif du moteur différait du format demandé. Le compositeur image de coordonnées utilisait un ajustement avec fond blanc.

Les nouvelles générations doivent remplir les dimensions choisies. Le redimensionnement conserve les proportions et recadre le débordement au centre ; il n’étire pas les sujets et n’ajoute ni fond blanc, ni fond noir, ni copie floutée. Le sujet essentiel, les textes et les logos sont demandés dans une zone sûre. Les calques officiels déjà prévus par le parcours sont posés après le recadrage. Cette correction n’ajoute aucun texte ou logo supplémentaire.

## Traitement

- Image : inspection locale d’un petit échantillon orienté, retrait des bandes blanches/noires uniformes reconnues, puis recadrage couvrant le format final.
- Vidéo : recherche de bandes intégrées sur trois images du segment réellement utilisé. Un retrait fixe n’est appliqué que si les trois détections concordent. Il précède le redimensionnement couvrant et les calques. La durée, les pistes sonores et les choix voix off/personnages/sans parole sont conservés.
- Prompts : consignes plein cadre explicites, marges du texte internes à la composition. Le contrat vidéo compact reste limité à 300 caractères ; les limites des transports et les citations complètes restent contrôlées.

La détection est volontairement prudente : bandes opposées, neutres, étroites, presque symétriques, avec une rupture nette vers l’image. Un fond de produit blanc, une scène sombre, un espace de composition asymétrique ou un fondu ne suffisent pas à déclencher un retrait. Le scan vidéo est borné à 12 secondes ; un échec du scan n’invalide pas un clip payant autrement décodable.

## Portée et limites

La correction concerne les nouvelles générations. Elle ne réécrit pas la médiathèque historique et ne republie pas les anciens posts. Le mode Modifier garde le canvas autoritaire de la source et ses marges graphiques existantes. Les fichiers personnels téléversés et la politique de cadrage des canaux restent inchangés.

Le fond noir de la visionneuse Facebook sur ordinateur est extérieur au fichier. Un visuel vertical plein cadre peut donc toujours être entouré par cette interface horizontale. Les éléments graphiques ambigus ou les bordures irrégulières dessinées par un moteur ne sont pas supprimés aveuglément.

## Validation

Les tests utilisent Sharp et FFmpeg réels avec des médias synthétiques : photo 2:3 dans un canvas 4:5 à bandes blanches, quatre formats d’export, bandes noires/blanches horizontales et verticales, orientation EXIF, fonds de produit, modifications, logo demandé après recadrage, segment vidéo avec décalage de départ et conservation audio. Les tests de séparation des trois modes audio restent actifs. Aucun appel payant à un fournisseur de génération n’est nécessaire pour ces contrôles.
