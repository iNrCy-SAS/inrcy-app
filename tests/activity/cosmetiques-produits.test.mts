import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACTIVITY_CATALOG, BEAUTE_BIEN_ETRE_JOB_ALIASES, findJobValueByLabel,
  getJobLabel, getJobsForSector, getServicesForSectorAndJob, isValidJobForSector,
} from '../../lib/activityCatalog.ts';
import {
  ACTIVITY_SECTOR_OPTIONS, decodeBusinessSector, encodeBusinessSector, inferSectorCategoryFromProfession,
} from '../../lib/activitySectors.ts';
import { searchActivityJobs } from '../../lib/activityJobSearch.ts';

const SECTOR = 'beaute_bien_etre';
const products = [
  ['boutique_cosmetiques', 'Boutique de cosmétiques'],
  ['marque_cosmetique', 'Marque de cosmétiques'],
  ['fabricant_cosmetiques', 'Fabricant de cosmétiques'],
  ['formulateur_cosmetiques', 'Formulateur / laboratoire cosmétique'],
  ['grossiste_cosmetiques', 'Grossiste en cosmétiques'],
  ['parfumerie', 'Parfumerie'],
  ['savonnerie', 'Savonnerie artisanale'],
  ['cosmetiques_naturels', 'Cosmétiques naturels / bio'],
  ['vente_domicile_beaute', 'Vente à domicile de produits de beauté / VDI'],
  ['boutique_beaute_en_ligne', 'Boutique de beauté en ligne'],
  ['produits_capillaires', 'Vente de produits capillaires'],
  ['maquillage_cosmetiques', 'Vente de maquillage / cosmétiques'],
] as const;

test('twelve product professions extend the existing beauty sector without replacing its service professions', () => {
  assert.equal(ACTIVITY_SECTOR_OPTIONS.filter((sector) => sector.value === SECTOR).length, 1);
  assert.equal(ACTIVITY_SECTOR_OPTIONS.some((sector) => /cosmetique/.test(sector.value)), false);
  const jobs = getJobsForSector(SECTOR);
  for (const [job, label] of products) {
    assert.ok(jobs.some((option) => option.value === job && option.label === label));
    assert.equal(isValidJobForSector(SECTOR, job), true);
    assert.equal(isValidJobForSector('commerce_boutique', job), false);
    const services = getServicesForSectorAndJob(SECTOR, job);
    assert.equal(services.length, 8, job); assert.equal(new Set(services).size, 8, job);
    assert.ok(services.every((service) => service.trim().length > 0));
    assert.doesNotMatch(services.join(' '), /rendez-vous|brushing|épilation|coupe femme|coupe homme|diagnostic médical|guérison|chiffre d’affaires/i);
  }
  for (const job of ['coach_sportif', 'coiffeur', 'estheticienne', 'masseur', 'nutritionniste', 'onglerie', 'spa', 'tatoueur']) {
    assert.equal(isValidJobForSector(SECTOR, job), true, job);
  }
  assert.equal(getJobLabel(SECTOR, 'coiffeur'), 'Coiffeur / Barber');
  assert.ok(getServicesForSectorAndJob(SECTOR, 'coiffeur').includes('Coupe femme'));
});

test('product activities expose manufacturing, formulation, wholesale and retail options instead of salon appointments', () => {
  assert.ok(getServicesForSectorAndJob(SECTOR, 'fabricant_cosmetiques').includes('Fabrication à façon'));
  assert.ok(getServicesForSectorAndJob(SECTOR, 'fabricant_cosmetiques').includes('Conditionnement'));
  assert.ok(getServicesForSectorAndJob(SECTOR, 'formulateur_cosmetiques').includes('Développement de formules'));
  assert.ok(getServicesForSectorAndJob(SECTOR, 'grossiste_cosmetiques').includes('Tarifs revendeurs'));
  assert.ok(getServicesForSectorAndJob(SECTOR, 'boutique_beaute_en_ligne').includes('Livraison et suivi'));
  assert.ok(getServicesForSectorAndJob(SECTOR, 'produits_capillaires').includes('Shampoings'));
  assert.ok(getServicesForSectorAndJob(SECTOR, 'maquillage_cosmetiques').includes('Pinceaux et accessoires'));
});

test('every cosmetic profession round trips through the encoded profile and remains selectable after accent/case normalization', () => {
  for (const [job, label] of products) {
    const encoded = encodeBusinessSector(SECTOR, label);
    const decoded = decodeBusinessSector(encoded);
    assert.deepEqual(decoded, { sectorCategory: SECTOR, profession: label });
    assert.equal(findJobValueByLabel(decoded.sectorCategory, decoded.profession), job);
    const normalized = label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    assert.equal(findJobValueByLabel(SECTOR, normalized), job);
    assert.equal(inferSectorCategoryFromProfession(normalized), SECTOR, label);
    assert.equal(inferSectorCategoryFromProfession(job), SECTOR, job);
    assert.equal(searchActivityJobs(normalized)[0]?.job, job, label);
  }
  assert.equal(findJobValueByLabel(SECTOR, 'activité inconnue sans référence au catalogue'), '');
});

test('shared cosmetic aliases restore legacy profession labels and rank the intended job first', () => {
  for (const [job, aliases] of Object.entries(BEAUTE_BIEN_ETRE_JOB_ALIASES)) {
    assert.ok(ACTIVITY_CATALOG[SECTOR].jobs[job], job);
    for (const alias of aliases) {
      assert.equal(findJobValueByLabel(SECTOR, alias), job, alias);
      const [result] = searchActivityJobs(alias);
      assert.equal(result?.sectorCategory, SECTOR, alias);
      assert.equal(result?.job, job, alias);
      assert.equal(inferSectorCategoryFromProfession(alias), alias === 'VDI' ? 'autre' : SECTOR, alias);
    }
  }
  assert.equal(searchActivityJobs('SKINCARE')[0]?.job, 'boutique_cosmetiques');
  assert.equal(searchActivityJobs('make-up')[0]?.job, 'maquillage_cosmetiques');
  assert.equal(searchActivityJobs('VDI')[0]?.job, 'vente_domicile_beaute');
  assert.ok(searchActivityJobs('cosmetiq').some((result) => result.sectorCategory === SECTOR));
});

test('specific cosmetic product wording wins over generic shop, direct-sales and industrial words', () => {
  for (const profession of [
    'BOUTIQUE DE COSMÉTIQUES', 'Fabrication industrielle de cosmétiques', 'Laboratoire de fabrication cosmétique',
    'Commerce de cosmétiques', 'Vente directe de cosmétiques', 'Grossiste de produits capillaires',
    'E-COMMERCE BEAUTÉ', 'Boutique de parfums', 'Fabrication de savons',
  ]) assert.equal(inferSectorCategoryFromProfession(profession), SECTOR, profession);
});

test('VDI search can suggest beauty without assigning unrelated direct sellers to the beauty sector', () => {
  assert.equal(searchActivityJobs('VDI')[0]?.job, 'vente_domicile_beaute');
  assert.equal(findJobValueByLabel(SECTOR, 'VDI'), 'vente_domicile_beaute');
  assert.equal(inferSectorCategoryFromProfession('VDI'), 'autre');
  assert.equal(inferSectorCategoryFromProfession('VDI de produits de beauté'), SECTOR);
  for (const profession of ['VDI linge de maison', 'VDI ustensiles de cuisine']) {
    assert.equal(inferSectorCategoryFromProfession(profession), 'autre', profession);
  }
  assert.equal(inferSectorCategoryFromProfession('Fabrication industrielle de cosmétiques'), SECTOR);
});

test('a cosmetic customer or destination does not replace a different principal profession', () => {
  for (const [profession, expected] of [
    ['Architecte d’intérieur pour parfumerie', 'architecture_design'],
    ['Agence de communication spécialisée en cosmétiques', 'services_entreprises'],
    ['Créateur de site internet pour cosmétiques', 'communication'],
    ['Fabrication industrielle de machines pour cosmétiques', 'industrie'],
    ['Fabricant industriel de matériel pour cosmétique', 'industrie'],
  ] as const) assert.equal(inferSectorCategoryFromProfession(profession), expected, profession);
});

test('secondary training or pharmacy distribution does not change a principal cosmetic product profession', () => {
  for (const profession of [
    'Fabricant de cosmétiques avec formation revendeur',
    'Grossiste cosmétique et formation produits',
    'Boutique de cosmétiques avec conseil en pharmacie',
    'Cosmétiques pour les écoles de maquillage',
    'Fabrication industrielle de cosmétiques',
  ]) assert.equal(inferSectorCategoryFromProfession(profession), SECTOR, profession);
});

test('explicit schools and care professions retain their sector even when cosmetics are mentioned', () => {
  for (const [profession, expected] of [
    ['École privée de cosmétique', 'education_enfance'],
    ['École de cosmétique', 'formation_enseignement'],
    ['Centre de formation en cosmétique', 'formation_enseignement'],
    ['Formateur en formulation cosmétique', 'formation_enseignement'],
    ['Médecin dermatologue en cosmétique', 'sante'],
    ['Pharmacie et cosmétiques', 'sante'],
    ['Parapharmacie et cosmétiques', 'sante'],
    ['Naturopathe et soins naturels', 'medecine_douce'],
    ['Coopérative de cosmétiques', 'economie_sociale_solidaire'],
    ['Magasin de vêtements', 'commerce_boutique'],
    ['Fabrication industrielle', 'industrie'],
    ['Plombier', 'artisan_btp'],
    ['Auto-école', 'formation_enseignement'],
    ['Pharmacie', 'sante'],
    ['Naturopathe', 'medecine_douce'],
  ] as const) assert.equal(inferSectorCategoryFromProfession(profession), expected, profession);
});
