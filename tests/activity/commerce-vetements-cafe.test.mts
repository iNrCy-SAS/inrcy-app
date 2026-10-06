import assert from 'node:assert/strict';
import test from 'node:test';

import { inferSectorCategoryFromProfession } from '../../lib/activitySectors.ts';
import {
  findJobValueByLabel,
  getJobsForSector,
  getServicesForSectorAndJob,
} from '../../lib/activityCatalog.ts';
import { searchActivityJobs } from '../../lib/activityJobSearch.ts';
import { boutique_cafe_theJobTemplates } from '../../lib/templates/sectors/commerce_boutique/boutique_cafe_the.ts';
import { friperieJobTemplates } from '../../lib/templates/sectors/commerce_boutique/friperie.ts';
import { magasin_vetementsJobTemplates } from '../../lib/templates/sectors/commerce_boutique/magasin_vetements.ts';
import { torrefacteurJobTemplates } from '../../lib/templates/sectors/commerce_boutique/torrefacteur.ts';

const newJobs = [
  ['magasin_vetements', 'Magasin de vêtements', magasin_vetementsJobTemplates],
  ['friperie', 'Friperie / vêtements de seconde main', friperieJobTemplates],
  ['torrefacteur', 'Torréfacteur', torrefacteurJobTemplates],
  ['boutique_cafe_the', 'Boutique de café et thé', boutique_cafe_theJobTemplates],
] as const;

test('le commerce propose les nouvelles activités, leurs prestations et leurs modèles', () => {
  const jobs = getJobsForSector('commerce_boutique');
  for (const [value, label, template] of newJobs) {
    assert.ok(jobs.some((job) => job.value === value && job.label === label));
    assert.equal(getServicesForSectorAndJob('commerce_boutique', value).length, 8);
    assert.equal(template.sector, 'commerce_boutique');
    assert.equal(template.professionKey, value);
    assert.equal(template.professionLabel, label);
  }
  assert.equal(findJobValueByLabel('commerce_boutique', 'Boutique mode'), 'boutique_mode');
  assert.equal(findJobValueByLabel('commerce_boutique', 'Épicerie / Commerce alimentaire'), 'epicerie');
});

test('la recherche et les anciens libellés retrouvent le bon métier', () => {
  const cases = [
    ['Magasin de vêtements', 'magasin_vetements'],
    ['Boutique de prêt-à-porter', 'magasin_vetements'],
    ['Commerce d’habillement', 'magasin_vetements'],
    ['Friperie', 'friperie'],
    ['Dépôt-vente de vêtements', 'friperie'],
    ['Torréfacteur', 'torrefacteur'],
    ['Brûlerie', 'torrefacteur'],
    ['Torréfaction de café', 'torrefacteur'],
    ['Boutique de café', 'boutique_cafe_the'],
  ] as const;

  for (const [label, job] of cases) {
    assert.equal(inferSectorCategoryFromProfession(label), 'commerce_boutique', label);
    assert.equal(findJobValueByLabel('commerce_boutique', label), job, label);
    const result = searchActivityJobs(label, 8)[0];
    assert.equal(result?.sectorCategory, 'commerce_boutique', label);
    assert.equal(result?.job, job, label);
  }
  assert.equal(inferSectorCategoryFromProfession('Café / bar'), 'hotel_restaurant');
});
