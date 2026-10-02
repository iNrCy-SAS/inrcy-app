import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

import {
  ACTIVITY_SECTOR_OPTIONS,
  decodeBusinessSector,
  encodeBusinessSector,
  inferSectorCategoryFromProfession,
} from '../../lib/activitySectors.ts';
import {
  findJobValueByLabel,
  getJobsForSector,
  getServicesForSectorAndJob,
} from '../../lib/activityCatalog.ts';
import { searchActivityJobs } from '../../lib/activityJobSearch.ts';
import { getGeneratorRecommendation } from '../../lib/generatorSettings.ts';
import {
  culture_creationTemplates,
  cultureCreationJobTemplates,
} from '../../lib/templates/sectors/culture_creation/common.ts';

const expectedJobs = [
  'ecrivain_auteur',
  'artiste',
  'artiste_peintre',
  'musicien_interprete',
  'chanteur',
  'compositeur',
  'illustrateur',
  'sculpteur',
];

test('le profil distingue les créations artistiques de la peinture en bâtiment', () => {
  assert.deepEqual(
    ACTIVITY_SECTOR_OPTIONS.find((option) => option.value === 'culture_creation'),
    { value: 'culture_creation', label: 'Arts / Culture / Création' },
  );
  assert.equal(inferSectorCategoryFromProfession('Artiste peintre'), 'culture_creation');
  assert.equal(inferSectorCategoryFromProfession('Peintre en bâtiment'), 'artisan_btp');
  assert.equal(inferSectorCategoryFromProfession('Musicienne'), 'culture_creation');
  assert.equal(inferSectorCategoryFromProfession('Disc jockey'), 'evenementiel');

  const stored = encodeBusinessSector('culture_creation', 'Artiste peintre');
  assert.deepEqual(decodeBusinessSector(stored), {
    sectorCategory: 'culture_creation',
    profession: 'Artiste peintre',
  });
  assert.equal(getGeneratorRecommendation(stored).sectorLabel, 'Arts / Culture / Création');
});

test('les huit métiers ont leurs prestations et des modèles distincts', () => {
  assert.deepEqual(getJobsForSector('culture_creation').map((job) => job.value), expectedJobs);
  assert.deepEqual(
    cultureCreationJobTemplates.map((definition) => definition.professionKey),
    expectedJobs,
  );
  assert.equal(culture_creationTemplates.sector, 'culture_creation');

  for (const definition of cultureCreationJobTemplates) {
    assert.equal(definition.sector, 'culture_creation');
    assert.equal(getServicesForSectorAndJob('culture_creation', definition.professionKey).length, 8);
    for (const field of [
      'label', 'signature', 'promoLead', 'infoLead', 'followLead', 'surveyLead',
      'seasonal', 'loyalty', 'maintenance', 'localHook', 'audience',
    ] as const) {
      assert.ok(definition.pack[field].trim(), `${definition.professionKey}.${field}`);
    }
  }

  assert.ok(getServicesForSectorAndJob('culture_creation', 'artiste_peintre').includes('Tableaux originaux'));
  assert.ok(!getServicesForSectorAndJob('culture_creation', 'artiste_peintre').includes('Peinture intérieure'));
  assert.ok(getServicesForSectorAndJob('artisan_btp', 'peintre').includes('Peinture intérieure'));
});

test('la recherche reconnaît les métiers créatifs et évite le faux résultat Magicien', () => {
  const cases = [
    ['écrivain', 'ecrivain_auteur'],
    ['auteure', 'ecrivain_auteur'],
    ['artiste', 'artiste'],
    ['artiste peintre', 'artiste_peintre'],
    ['peintre artiste', 'artiste_peintre'],
    ['musicien', 'musicien_interprete'],
    ['musicienne', 'musicien_interprete'],
    ['chanteuse', 'chanteur'],
    ['compositrice', 'compositeur'],
    ['illustratrice', 'illustrateur'],
    ['sculptrice', 'sculpteur'],
    ['disc jockey', 'dj'],
  ] as const;
  for (const [query, expectedJob] of cases) {
    assert.equal(searchActivityJobs(query)[0]?.job, expectedJob, query);
  }
  assert.ok(!searchActivityJobs('musicien').some((result) => result.job === 'magicien'));
  assert.equal(searchActivityJobs('peintre')[0]?.sectorCategory, 'artisan_btp');
  assert.ok(searchActivityJobs('peintre').some((result) => result.job === 'artiste_peintre'));
  assert.equal(findJobValueByLabel('culture_creation', 'Musicienne'), 'musicien_interprete');
  assert.equal(findJobValueByLabel('culture_creation', 'Écrivain / Auteur'), 'ecrivain_auteur');
});

test('les modèles créatifs sont inscrits dans le registre utilisé par le profil', () => {
  const registry = readFileSync(
    new URL('../../lib/templates/sectors/index.ts', import.meta.url),
    'utf8',
  );
  assert.match(registry, /culture_creation: culture_creationTemplates/);
  assert.match(registry, /buildCultureCreationJobTemplates\(\)/);
});
