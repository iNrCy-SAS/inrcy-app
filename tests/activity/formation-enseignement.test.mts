import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ACTIVITY_SECTOR_OPTIONS,
  inferSectorCategoryFromProfession,
} from '../../lib/activitySectors.ts';
import {
  findJobValueByLabel,
  getJobsForSector,
  getServicesForSectorAndJob,
} from '../../lib/activityCatalog.ts';
import { inferInrSearchVisualTheme } from '../../lib/inrSearchVisualIdentity.ts';
import { formation_enseignementTemplates } from '../../lib/templates/sectors/formation_enseignement/common.ts';
import { auto_ecoleJobTemplates } from '../../lib/templates/sectors/formation_enseignement/auto_ecole.ts';
import { moto_ecoleJobTemplates } from '../../lib/templates/sectors/formation_enseignement/moto_ecole.ts';
import { bateau_ecoleJobTemplates } from '../../lib/templates/sectors/formation_enseignement/bateau_ecole.ts';
import { formation_poids_lourd_transportJobTemplates } from '../../lib/templates/sectors/formation_enseignement/formation_poids_lourd_transport.ts';
import { recuperation_pointsJobTemplates } from '../../lib/templates/sectors/formation_enseignement/recuperation_points.ts';
import { formation_code_routeJobTemplates } from '../../lib/templates/sectors/formation_enseignement/formation_code_route.ts';
import { formateurJobTemplates } from '../../lib/templates/sectors/formation_enseignement/formateur.ts';

test('le secteur Formation & Enseignement est disponible', () => {
  assert.deepEqual(
    ACTIVITY_SECTOR_OPTIONS.find((option) => option.value === 'formation_enseignement'),
    { value: 'formation_enseignement', label: 'Formation & Enseignement' },
  );
});

test('les métiers de la conduite sont détectés sans perturber automobile et formation B2B', () => {
  const cases = [
    ['Auto-école', 'formation_enseignement'],
    ['École de conduite', 'formation_enseignement'],
    ['Moto école', 'formation_enseignement'],
    ['Bateau-école permis côtier', 'formation_enseignement'],
    ['Formation permis poids lourd', 'formation_enseignement'],
    ['Stage de récupération de points', 'formation_enseignement'],
    ['Centre de formation au Code de la route', 'formation_enseignement'],
    ['Permis remorque', 'formation_enseignement'],
    ['Garage auto', 'automobile'],
    ['Formation professionnelle B2B', 'services_entreprises'],
  ] as const;

  for (const [profession, expectedSector] of cases) {
    assert.equal(inferSectorCategoryFromProfession(profession), expectedSector);
  }
});

test('le catalogue contient 7 métiers et 8 prestations par métier', () => {
  const expectedJobs = [
    ['auto_ecole', 'Auto-école'],
    ['moto_ecole', 'Moto-école'],
    ['bateau_ecole', 'Bateau-école'],
    ['formation_poids_lourd_transport', 'Formation poids lourd et transport'],
    ['recuperation_points', 'Stage de récupération de points'],
    ['formation_code_route', 'Centre de formation au Code de la route'],
    ['formateur', 'Formateur'],
  ] as const;

  const jobs = getJobsForSector('formation_enseignement');
  assert.equal(jobs.length, expectedJobs.length);

  for (const [value, label] of expectedJobs) {
    assert.ok(jobs.some((job) => job.value === value && job.label === label));
    assert.equal(getServicesForSectorAndJob('formation_enseignement', value).length, 8);
  }
});

test('les synonymes historiques retrouvent le bon métier', () => {
  const aliases = [
    ['École de conduite', 'auto_ecole'],
    ['Auto-école en ligne', 'auto_ecole'],
    ['Permis moto', 'moto_ecole'],
    ['Permis bateau', 'bateau_ecole'],
    ['Permis remorque', 'formation_poids_lourd_transport'],
    ['Récupération de points', 'recuperation_points'],
    ['Code de la route', 'formation_code_route'],
  ] as const;

  for (const [label, expectedJob] of aliases) {
    assert.equal(findJobValueByLabel('formation_enseignement', label), expectedJob);
  }
});

test('les packs de templates couvrent le secteur et ses 7 métiers', () => {
  assert.equal(formation_enseignementTemplates.sector, 'formation_enseignement');

  const definitions = [
    auto_ecoleJobTemplates,
    moto_ecoleJobTemplates,
    bateau_ecoleJobTemplates,
    formation_poids_lourd_transportJobTemplates,
    recuperation_pointsJobTemplates,
    formation_code_routeJobTemplates,
    formateurJobTemplates,
  ];

  assert.deepEqual(
    definitions.map((definition) => definition.professionKey),
    [
      'auto_ecole',
      'moto_ecole',
      'bateau_ecole',
      'formation_poids_lourd_transport',
      'recuperation_points',
      'formation_code_route',
      'formateur',
    ],
  );
  assert.ok(definitions.every((definition) => definition.sector === 'formation_enseignement'));
});

test('iNrSearch applique le thème mobilité', () => {
  assert.equal(inferInrSearchVisualTheme('formation_enseignement Auto-école'), 'motion');
});
