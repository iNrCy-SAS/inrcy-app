# Analyse iNrADN enrichie — 13 septembre 2026

## Objectif

Enrichir automatiquement les rubriques existantes de l’ADN entreprise à partir
des canaux déjà autorisés, sans modifier le design, le schéma Supabase ni les
règles de priorité des données saisies par le professionnel.

## Profondeur de collecte

- Les contenus structurants sont étudiés sur 365 jours afin de détecter les
  services, cibles, problèmes clients, preuves, vocabulaire, ton, saisonnalité et
  appels à l’action récurrents.
- Les actualités conservent une fenêtre stricte de 30 jours : un ancien contenu ne
  peut donc pas être présenté comme une actualité récente.
- Le site peut fournir jusqu’à 16 pages publiques pertinentes, avec priorité aux
  pages services, à propos, équipe, réalisations, avis, tarifs, FAQ et actualités.
- Les connecteurs récupèrent davantage de publications, avec pagination lorsque
  l’API le permet. Une page secondaire en échec n’annule pas une première page
  valide ; une autorisation expirée continue en revanche à demander une
  reconnexion.
- Les publications internes iNrCy sont lues sur la même fenêtre annuelle et
  restent strictement filtrées par `user_id`.

## Analyse et remplissage

- Le premier passage IA produit le résultat complet dans le contrat JSON déjà
  utilisé par l’interface.
- Un second passage ciblé est lancé uniquement lorsque des rubriques importantes
  sont encore trop pauvres. Il complète les lacunes puis fusionne ses résultats
  avec le premier passage.
- En cas d’échec ou de délai insuffisant pour ce complément, le premier résultat
  reste utilisable : l’analyse n’est pas perdue.
- Les champs textuels déjà renseignés par le professionnel restent prioritaires.
  Les listes détectées sont normalisées, dédupliquées et fusionnées sans effacer
  les informations existantes.
- Les blocs Premium sont développés seulement lorsque l’accès Premium est actif.
- Les faits commerciaux précis doivent être présents dans les sources. Les
  recommandations stratégiques peuvent être déduites des sources, mais elles ne
  doivent pas inventer de clients, prix, certifications ou performances.

## Budget et résilience

- Les sources sont réparties par priorité et par poids afin qu’un gros site ne
  masque pas les réseaux sociaux ou les publications iNrCy.
- Le contexte transmis à iNrAgent et Booster est augmenté, tout en conservant les
  plafonds plus petits des rédacteurs qui n’ont pas besoin du profil complet.
- L’analyse automatique mensuelle gratuite et le quota manuel de trois analyses
  ne sont pas modifiés par cette évolution.
- Aucune donnée privée, aucun message privé et aucun identifiant de connexion ne
  sont collectés.

## Dictée des tags

Tous les champs iNrADN utilisant le composant partagé de tags affichent maintenant
un microphone. Une phrase comme « Force 1, virgule, Force 2, virgule, Force 3 » est
transcrite, découpée en tags, normalisée et dédupliquée tout en respectant la
limite propre au champ. Un sous-texte localisé explique cette syntaxe.

## Impact Supabase

- Aucune migration.
- Aucune table, colonne, politique RLS ou fonction SQL ajoutée ou modifiée.
- Seule la fenêtre de lecture des publications existantes passe à 365 jours, avec
  un tri décroissant et une limite de 200 lignes.

## Contrôles attendus avant livraison

1. TypeScript sans erreur.
2. Tests de contrat de l’analyse, du budget des sources, des fenêtres temporelles,
   de la fusion enrichie et de la dictée des tags.
3. Validation des clés i18n et des catalogues JSON.
4. Lint des fichiers modifiés.
5. Build de production complet.
