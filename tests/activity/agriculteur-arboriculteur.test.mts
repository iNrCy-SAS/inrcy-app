import assert from 'node:assert/strict';
import test from 'node:test';

import { inferSectorCategoryFromProfession } from '../../lib/activitySectors.ts';
import {
  findJobValueByLabel,
  getJobsForSector,
  getServicesForSectorAndJob,
} from '../../lib/activityCatalog.ts';
import { searchActivityJobs } from '../../lib/activityJobSearch.ts';
import { agriculteurJobTemplates } from '../../lib/templates/sectors/agriculture_producteurs/agriculteur.ts';
import { arboriculteurJobTemplates } from '../../lib/templates/sectors/agriculture_producteurs/arboriculteur.ts';

test('Agriculteur et Arboriculteur ont leurs prestations et modèles dans le secteur agricole', () => {
  const jobs = getJobsForSector('agriculture_producteurs');
  const newJobs = [
    ['agriculteur', 'Agriculteur', agriculteurJobTemplates],
    ['arboriculteur', 'Arboriculteur', arboriculteurJobTemplates],
  ] as const;

  for (const [value, label, template] of newJobs) {
    assert.ok(jobs.some((job) => job.value === value && job.label === label));
    assert.equal(getServicesForSectorAndJob('agriculture_producteurs', value).length, 8);
    assert.equal(template.sector, 'agriculture_producteurs');
    assert.equal(template.professionKey, value);
    assert.equal(template.professionLabel, label);
  }

  assert.equal(findJobValueByLabel('agriculture_producteurs', 'Maraîcher'), 'maraicher');
  assert.equal(findJobValueByLabel('agriculture_producteurs', 'Viticulteur / domaine'), 'viticulteur_domaine');
  assert.equal(inferSectorCategoryFromProfession('Torréfacteur'), 'commerce_boutique');
});

test('les variantes de noms agricoles retrouvent le bon métier', () => {
  const cases = [
    ['Agriculteur', 'agriculteur'],
    ['Agricultrice', 'agriculteur'],
    ['Exploitant agricole', 'agriculteur'],
    ['Céréalier', 'agriculteur'],
    ['Arboriculteur', 'arboriculteur'],
    ['Arboricultrice', 'arboriculteur'],
    ['Arboriculture fruitière', 'arboriculteur'],
    ['Fruiticulteur', 'arboriculteur'],
    ['Producteur de fruits', 'arboriculteur'],
    ['Verger', 'arboriculteur'],
  ] as const;

  for (const [label, value] of cases) {
    assert.equal(inferSectorCategoryFromProfession(label), 'agriculture_producteurs', label);
    assert.equal(findJobValueByLabel('agriculture_producteurs', label), value, label);
    const result = searchActivityJobs(label, 8)[0];
    assert.equal(result?.sectorCategory, 'agriculture_producteurs', label);
    assert.equal(result?.job, value, label);
  }
});
