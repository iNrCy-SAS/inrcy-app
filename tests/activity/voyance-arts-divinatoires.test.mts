import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ACTIVITY_CATALOG, VOYANCE_ARTS_DIVINATOIRES_JOB_ALIASES, findJobValueByLabel,
  getJobLabel, getJobsForSector, getServicesForSectorAndJob, isValidJobForSector,
} from '../../lib/activityCatalog.ts';
import {
  ACTIVITY_SECTOR_OPTIONS, decodeBusinessSector, encodeBusinessSector,
  getActivitySectorLabel, inferSectorCategoryFromProfession, isActivitySectorCategory,
} from '../../lib/activitySectors.ts';
import { searchActivityJobs } from '../../lib/activityJobSearch.ts';

const SECTOR = 'voyance_arts_divinatoires';
const jobs = [
  ['voyant', 'Voyant / Voyante'], ['medium', 'Médium'], ['tarologue', 'Tarologue'],
  ['cartomancien', 'Cartomancien / Cartomancienne'], ['astrologue', 'Astrologue'],
  ['numerologue', 'Numérologue'], ['chiromancien', 'Chiromancien / Chiromancienne'],
  ['radiesthesiste_divinatoire', 'Radiesthésiste divinatoire'],
] as const;

test('voyance and divinatory arts have a distinct selectable sector with eight specific professions', () => {
  assert.equal(isActivitySectorCategory(SECTOR), true);
  assert.equal(getActivitySectorLabel(SECTOR), 'Voyance / Arts divinatoires');
  assert.deepEqual(ACTIVITY_SECTOR_OPTIONS.filter((sector) => sector.value === SECTOR), [{ value: SECTOR, label: 'Voyance / Arts divinatoires' }]);
  assert.equal(getJobsForSector(SECTOR).length, 8);
  for (const [job, label] of jobs) {
    assert.equal(getJobLabel(SECTOR, job), label);
    assert.equal(isValidJobForSector(SECTOR, job), true);
    assert.equal(isValidJobForSector('medecine_douce', job), false);
    assert.equal(isValidJobForSector('evenementiel', job), false);
    const services = getServicesForSectorAndJob(SECTOR, job);
    assert.equal(services.length, 8); assert.equal(new Set(services).size, 8);
    assert.ok(services.every((service) => service.trim().length > 0));
    assert.doesNotMatch(services.join(' '), /garanti|certitude|guérison|soigner|retour affectif|retour de l’être aimé|résultat certain|prédiction certaine|diagnostic|traitement médical/i);
  }
});

test('each profession keeps its label and eight services through profile encoding and decoding', () => {
  for (const [job, label] of jobs) {
    const decoded = decodeBusinessSector(encodeBusinessSector(SECTOR, label));
    assert.deepEqual(decoded, { sectorCategory: SECTOR, profession: label });
    assert.equal(findJobValueByLabel(decoded.sectorCategory, decoded.profession), job);
    const normalized = label.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toUpperCase();
    assert.equal(findJobValueByLabel(SECTOR, normalized), job);
    assert.equal(inferSectorCategoryFromProfession(normalized), SECTOR, label);
    assert.equal(inferSectorCategoryFromProfession(job), SECTOR, job);
    assert.equal(searchActivityJobs(normalized)[0]?.job, job, label);
  }
});

test('all divination aliases share profile restoration and search without manufacturing unknown jobs', () => {
  for (const [job, aliases] of Object.entries(VOYANCE_ARTS_DIVINATOIRES_JOB_ALIASES)) {
    assert.ok(ACTIVITY_CATALOG[SECTOR].jobs[job], job);
    for (const alias of aliases) {
      assert.equal(findJobValueByLabel(SECTOR, alias), job, alias);
      const first = searchActivityJobs(alias)[0];
      assert.equal(first?.sectorCategory, SECTOR, alias); assert.equal(first?.job, job, alias);
    }
  }
  assert.equal(findJobValueByLabel(SECTOR, 'médium en bois MDF'), '');
  assert.equal(findJobValueByLabel(SECTOR, 'cabinet de prévoyance'), '');
  assert.equal(findJobValueByLabel(SECTOR, 'métier inconnu'), '');
});

test('prefixes, feminine variants and accents find the intended practitioner', () => {
  for (const [query, job] of [
    ['voyan', 'voyant'], ['voyante', 'voyant'], ['MÉDIUM', 'medium'], ['mediumnite', 'medium'],
    ['tarol', 'tarologue'], ['taromancienne', 'tarologue'], ['cartoman', 'cartomancien'],
    ['ASTROLOGIE', 'astrologue'], ['numerol', 'numerologue'], ['chiromancienne', 'chiromancien'],
    ['radiesthesie divinatoire', 'radiesthesiste_divinatoire'],
  ] as const) assert.equal(searchActivityJobs(query)[0]?.job, job, query);
});

test('principal practitioner wording is recognized ahead of generic consultations or digital delivery', () => {
  for (const profession of [
    'Voyante indépendante', 'Cabinet de voyance', 'Consultation de médiumnité', 'Médium', 'medium', 'Médium spirite',
    'Tarologue à distance', 'Consultation de cartomancie', 'Astrologue en ligne', 'Consultant en astrologie',
    'Consultation en numérologie', 'Chiromancienne', 'Radiesthésie divinatoire',
    'Radiesthésiste au pendule divinatoire', 'Consultation au pendule divinatoire',
  ]) assert.equal(inferSectorCategoryFromProfession(profession), SECTOR, profession);
});

test('prevention insurance, medium sizes/materials and light indicators do not become divination activities', () => {
  for (const [profession, expected] of [
    ['Prévoyance', 'assurance'], ['Conseiller en prévoyance', 'assurance'], ['Cabinet assurance et prévoyance', 'assurance'],
    ['Médium taille M', 'autre'], ['Medium size', 'autre'], ['Médium en bois MDF', 'autre'],
    ['Menuisier panneaux médium', 'artisan_btp'],
    ['Médium de peinture acrylique', 'autre'], ['Formation au médium acrylique', 'services_entreprises'],
    ['Voyant automobile', 'automobile'], ['Voyant lumineux automobile', 'automobile'],
    ['Radiesthésiste', 'autre'], ['Radiesthésie de recherche d’eau', 'autre'],
    ['Centre de formation en radiesthésie de recherche d’eau', 'services_entreprises'],
  ] as const) assert.equal(inferSectorCategoryFromProfession(profession), expected, profession);
  for (const query of ['prévoyance', 'médium taille', 'médium en bois', 'voyant automobile']) {
    assert.equal(searchActivityJobs(query).some((result) => result.sectorCategory === SECTOR), false, query);
  }
});

test('a practitioner client or secondary activity does not replace an explicit main profession or teaching activity', () => {
  for (const [profession, expected] of [
    ['Consultant marketing en astrologie', 'services_entreprises'],
    ['Créateur de site pour voyance', 'communication'],
    ['Architecte de cabinet de voyance', 'architecture_design'],
    ['École de voyance', 'formation_enseignement'], ['École privée d’astrologie', 'education_enfance'],
    ['Centre de formation en numérologie', 'formation_enseignement'], ['Formatrice en tarologie', 'formation_enseignement'],
    ['Naturopathe astrologue', 'medecine_douce'], ['Magnétiseur médium', 'medecine_douce'],
    ['Astrologue formatrice', SECTOR], ['Magicien', 'evenementiel'],
  ] as const) assert.equal(inferSectorCategoryFromProfession(profession), expected, profession);
  assert.equal(getJobLabel('medecine_douce', 'magnetiseur'), 'Magnétiseur');
  assert.ok(getServicesForSectorAndJob('beaute_bien_etre', 'fabricant_cosmetiques').includes('Fabrication à façon'));
});
