import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACTIVITY_CATALOG, findJobValueByLabel, getJobsForSector,
  isValidJobForSector,
} from '../../lib/activityCatalog.ts';
import { ACTIVITY_SECTOR_OPTIONS, decodeBusinessSector, encodeBusinessSector, inferSectorCategoryFromProfession } from '../../lib/activitySectors.ts';
import { searchActivityJobs } from '../../lib/activityJobSearch.ts';

test('two generic professions extend the existing sector/job catalogue without a specialty tier', () => {
  assert.equal(ACTIVITY_SECTOR_OPTIONS.length, 36);
  assert.equal(Object.values(ACTIVITY_CATALOG).reduce((count, sector) => count + Object.keys(sector.jobs).length, 0), 335);
  for (const [sector, job, label] of [['sante', 'chirurgien', 'Chirurgien'], ['formation_enseignement', 'formateur', 'Formateur']] as const) {
    assert.equal(isValidJobForSector(sector, job), true);
    assert.deepEqual(getJobsForSector(sector).filter(option => option.value === job), [{ value: job, label }]);
    const definition = ACTIVITY_CATALOG[sector].jobs[job];
    assert.deepEqual(Object.keys(definition).sort(), ['label', 'services']);
    assert.equal(definition.services.length, 8);
    assert.equal(new Set(definition.services).size, 8);
    assert.deepEqual(decodeBusinessSector(encodeBusinessSector(sector, job)), { sectorCategory: sector, profession: job });
  }
  assert.equal(Object.keys(ACTIVITY_CATALOG.sante.jobs).length, 10);
  assert.equal(Object.keys(ACTIVITY_CATALOG.formation_enseignement.jobs).length, 7);
});

test('existing lawyer, hotel, camping and training-organisation choices retain their IDs, labels and initial services', () => {
  for (const [sector, job, label, services] of [
    ['juridique', 'avocat', 'Avocat', ['Premier rendez-vous', 'Conseil juridique', 'Analyse dossier', 'Rédaction d’actes', 'Négociation', 'Procédure', 'Suivi client', 'Accompagnement contentieux']],
    ['hotel_restaurant', 'hotel', 'Hôtel', ['Réservation chambre', 'Séjour week-end', 'Offre entreprise', 'Petit-déjeuner', 'Accueil groupe', 'Événement / séminaire', 'Carte cadeau', 'Offre saisonnière']],
    ['tourisme', 'camping', 'Camping', ['Emplacements', 'Mobil-homes', 'Réservation séjour', 'Activités', 'Piscine / loisirs', 'Services vacanciers', 'Offre famille', 'Disponibilités']],
    ['services_entreprises', 'organisme_formation', 'Formation', ['Formation inter', 'Formation intra', 'Atelier', 'Coaching', 'Programme sur mesure', 'E-learning', 'Audit besoins', 'Suivi apprenants']],
  ] as const) {
    assert.deepEqual(ACTIVITY_CATALOG[sector].jobs[job], { label, services });
    assert.equal(findJobValueByLabel(sector, label), job);
    assert.deepEqual(decodeBusinessSector(encodeBusinessSector(sector, job)), { sectorCategory: sector, profession: job });
  }
  assert.ok(!('organisme_formation' in ACTIVITY_CATALOG.formation_enseignement.jobs), 'the existing training organisation is not duplicated into the new generic trainer choice');
});

for (const [query, sector, job] of [
  ['Chirurgien', 'sante', 'chirurgien'], ['Chirurgienne', 'sante', 'chirurgien'],
  ['Chirurgiens', 'sante', 'chirurgien'], ['Chirurgiennes', 'sante', 'chirurgien'],
  ['Formateur', 'formation_enseignement', 'formateur'], ['Formatrice', 'formation_enseignement', 'formateur'],
  ['Formateurs', 'formation_enseignement', 'formateur'], ['Formatrices', 'formation_enseignement', 'formateur'],
  ['Formateur indépendant', 'formation_enseignement', 'formateur'], ['Formatrice indépendante', 'formation_enseignement', 'formateur'],
  ['Organisme de formation', 'services_entreprises', 'organisme_formation'], ['Centre de formation', 'services_entreprises', 'organisme_formation'],
] as const) {
  test(`${query}: search and saved-label restoration resolve the same existing generic ID`, () => {
    const [result] = searchActivityJobs(query);
    assert.equal(result?.sectorCategory, sector);
    assert.equal(result?.job, job);
    assert.equal(findJobValueByLabel(sector, query), job);
  });
}

test('principal surgeon and trainer roles outrank their descriptive specialties', () => {
  for (const [query, expected] of [
    ['Chirurgien esthétique', 'sante'], ['Chirurgienne orthopédiste', 'sante'],
    ['Cabinet de chirurgienne', 'sante'], ['Je suis une chirurgienne esthétique', 'sante'],
    ['Nous sommes des chirurgiens', 'sante'],
    ['Formateur informatique', 'formation_enseignement'], ['Formatrice en informatique', 'formation_enseignement'],
    ['Formateur en cosmétique', 'formation_enseignement'], ['Nous sommes des formateurs indépendants', 'formation_enseignement'],
  ] as const) assert.equal(inferSectorCategoryFromProfession(query), expected, query);
});

test('cosmetics professions, driving schools and a client profession retain their original sector', () => {
  for (const [query, expected] of [
    ['Formulateur de cosmétiques', 'beaute_bien_etre'], ['Formulatrice cosmétique', 'beaute_bien_etre'],
    ['Fabricant de cosmétiques pour chirurgiens', 'beaute_bien_etre'],
    ['Laboratoire de formulation cosmétique', 'beaute_bien_etre'],
    ['Auto-école', 'formation_enseignement'], ['École de conduite', 'formation_enseignement'],
    ['Formation au Code de la route', 'formation_enseignement'], ['Formation poids lourd', 'formation_enseignement'],
    ['Organisme de formation', 'services_entreprises'], ['Centre de formation', 'services_entreprises'],
    ['Architecte pour un chirurgien', 'architecture_design'],
    ['Créateur de site internet pour un formateur', 'communication'],
    ['Agence de communication pour des chirurgiens', 'services_entreprises'],
  ] as const) assert.equal(inferSectorCategoryFromProfession(query), expected, query);
  for (const [query, sector, job] of [
    ['Auto-école', 'formation_enseignement', 'auto_ecole'],
    ['Formation poids lourd', 'formation_enseignement', 'formation_poids_lourd_transport'],
    ['Formulatrice cosmétique', 'beaute_bien_etre', 'formulateur_cosmetiques'],
  ] as const) {
    const [result] = searchActivityJobs(query);
    assert.equal(result?.sectorCategory, sector, query);
    assert.equal(result?.job, job, query);
  }
});

