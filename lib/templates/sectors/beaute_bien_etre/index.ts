import { beaute_bien_etreTemplates } from './common';
import { createJobTemplates } from '../shared';
import { coach_sportifJobTemplates } from './coach_sportif';
import { coiffeurJobTemplates } from './coiffeur';
import { estheticienneJobTemplates } from './estheticienne';
import { masseurJobTemplates } from './masseur';
import { nutritionnisteJobTemplates } from './nutritionniste';
import { onglerieJobTemplates } from './onglerie';
import { spaJobTemplates } from './spa';
import { tatoueurJobTemplates } from './tatoueur';
import { boutique_cosmetiquesJobTemplates } from './boutique_cosmetiques';
import { marque_cosmetiqueJobTemplates } from './marque_cosmetique';
import { fabricant_cosmetiquesJobTemplates } from './fabricant_cosmetiques';
import { formulateur_cosmetiquesJobTemplates } from './formulateur_cosmetiques';
import { grossiste_cosmetiquesJobTemplates } from './grossiste_cosmetiques';
import { parfumerieJobTemplates } from './parfumerie';
import { savonnerieJobTemplates } from './savonnerie';
import { cosmetiques_naturelsJobTemplates } from './cosmetiques_naturels';
import { vente_domicile_beauteJobTemplates } from './vente_domicile_beaute';
import { boutique_beaute_en_ligneJobTemplates } from './boutique_beaute_en_ligne';
import { produits_capillairesJobTemplates } from './produits_capillaires';
import { maquillage_cosmetiquesJobTemplates } from './maquillage_cosmetiques';
import { createCosmeticProductJobTemplates } from './cosmeticProductTemplates';

export { beaute_bien_etreTemplates };

export const COSMETIC_PRODUCT_JOB_TEMPLATE_DEFINITIONS = [
  boutique_cosmetiquesJobTemplates, marque_cosmetiqueJobTemplates, fabricant_cosmetiquesJobTemplates,
  formulateur_cosmetiquesJobTemplates, grossiste_cosmetiquesJobTemplates, parfumerieJobTemplates,
  savonnerieJobTemplates, cosmetiques_naturelsJobTemplates, vente_domicile_beauteJobTemplates,
  boutique_beaute_en_ligneJobTemplates, produits_capillairesJobTemplates, maquillage_cosmetiquesJobTemplates,
];

export function buildBeauteBienEtreJobTemplates() {
  return [
    ...[coach_sportifJobTemplates, coiffeurJobTemplates, estheticienneJobTemplates, masseurJobTemplates, nutritionnisteJobTemplates, onglerieJobTemplates, spaJobTemplates, tatoueurJobTemplates].flatMap((definition) => createJobTemplates(definition)),
    ...COSMETIC_PRODUCT_JOB_TEMPLATE_DEFINITIONS.flatMap(createCosmeticProductJobTemplates),
  ];
}
