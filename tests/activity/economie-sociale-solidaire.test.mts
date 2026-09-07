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
import { inferInrSearchVisualTheme } from '../../lib/inrSearchVisualIdentity.ts';
import { economie_sociale_solidaireTemplates } from '../../lib/templates/sectors/economie_sociale_solidaire/common.ts';
import { association_interet_generalJobTemplates } from '../../lib/templates/sectors/economie_sociale_solidaire/association_interet_general.ts';
import { cooperative_scop_scicJobTemplates } from '../../lib/templates/sectors/economie_sociale_solidaire/cooperative_scop_scic.ts';
import { entreprise_sociale_esusJobTemplates } from '../../lib/templates/sectors/economie_sociale_solidaire/entreprise_sociale_esus.ts';
import { fintech_finance_solidaire_mutualisteJobTemplates } from '../../lib/templates/sectors/economie_sociale_solidaire/fintech_finance_solidaire_mutualiste.ts';
import { structure_insertion_siaeJobTemplates } from '../../lib/templates/sectors/economie_sociale_solidaire/structure_insertion_siae.ts';
import { esat_entreprise_adapteeJobTemplates } from '../../lib/templates/sectors/economie_sociale_solidaire/esat_entreprise_adaptee.ts';
import { mutuelle_protection_socialeJobTemplates } from '../../lib/templates/sectors/economie_sociale_solidaire/mutuelle_protection_sociale.ts';
import { fondation_fonds_dotationJobTemplates } from '../../lib/templates/sectors/economie_sociale_solidaire/fondation_fonds_dotation.ts';
import { ressourcerie_recyclerieJobTemplates } from '../../lib/templates/sectors/economie_sociale_solidaire/ressourcerie_recyclerie.ts';
import { centre_social_tiers_lieuJobTemplates } from '../../lib/templates/sectors/economie_sociale_solidaire/centre_social_tiers_lieu.ts';
import { ong_solidarite_internationaleJobTemplates } from '../../lib/templates/sectors/economie_sociale_solidaire/ong_solidarite_internationale.ts';
import { reseau_accompagnement_essJobTemplates } from '../../lib/templates/sectors/economie_sociale_solidaire/reseau_accompagnement_ess.ts';

const expectedJobs = [
  ['association_interet_general', 'Association / organisme d’intérêt général'],
  ['cooperative_scop_scic', 'Coopérative / SCOP / SCIC'],
  ['entreprise_sociale_esus', 'Entreprise sociale / ESUS'],
  ['fintech_finance_solidaire_mutualiste', 'Fintech / finance solidaire & mutualiste'],
  ['structure_insertion_siae', 'Structure d’insertion / SIAE'],
  ['esat_entreprise_adaptee', 'ESAT / entreprise adaptée'],
  ['mutuelle_protection_sociale', 'Mutuelle / protection sociale'],
  ['fondation_fonds_dotation', 'Fondation / fonds de dotation'],
  ['ressourcerie_recyclerie', 'Ressourcerie / recyclerie'],
  ['centre_social_tiers_lieu', 'Centre social / tiers-lieu solidaire'],
  ['ong_solidarite_internationale', 'ONG / solidarité internationale'],
  ['reseau_accompagnement_ess', 'Réseau / accompagnement de l’ESS'],
] as const;

test('le secteur Économie sociale & solidaire est proposé dans Activité', () => {
  assert.deepEqual(
    ACTIVITY_SECTOR_OPTIONS.find((option) => option.value === 'economie_sociale_solidaire'),
    {
      value: 'economie_sociale_solidaire',
      label: 'Économie sociale & solidaire (ESS)',
    },
  );
});

test('les formulations ESS courantes sont reconnues avant les secteurs génériques', () => {
  const cases = [
    'Économie sociale et solidaire',
    'Association loi 1901',
    'Coopérative SCIC',
    'Entreprise solidaire ESUS',
    'Holding fintech mutualiste',
    'Finance solidaire à impact',
    'Structure d’insertion SIAE',
    'ESAT',
    'Mutuelle',
    'Fondation',
    'Ressourcerie',
    'ONG de solidarité internationale',
  ];

  for (const profession of cases) {
    assert.equal(
      inferSectorCategoryFromProfession(profession),
      'economie_sociale_solidaire',
      profession,
    );
  }
});

test('le stockage encodé conserve le secteur ESS et le type de structure', () => {
  const stored = encodeBusinessSector(
    'economie_sociale_solidaire',
    'structure_insertion_siae',
  );
  assert.equal(
    stored,
    '[[SECTOR:economie_sociale_solidaire]] structure_insertion_siae',
  );
  assert.deepEqual(decodeBusinessSector(stored), {
    sectorCategory: 'economie_sociale_solidaire',
    profession: 'structure_insertion_siae',
  });
});

test('le catalogue ESS contient 12 profils avec 8 prestations utiles chacun', () => {
  const jobs = getJobsForSector('economie_sociale_solidaire');
  assert.equal(jobs.length, expectedJobs.length);

  for (const [value, label] of expectedJobs) {
    assert.ok(jobs.some((job) => job.value === value && job.label === label));
    assert.equal(
      getServicesForSectorAndJob('economie_sociale_solidaire', value).length,
      8,
      value,
    );
  }

  assert.deepEqual(
    getServicesForSectorAndJob(
      'economie_sociale_solidaire',
      'association_interet_general',
    ),
    [
      'Adhésion',
      'Bénévolat',
      'Accompagnement des bénéficiaires',
      'Actions de terrain',
      'Événements solidaires',
      'Collecte de dons',
      'Partenariats',
      'Information / orientation',
    ],
  );
});

test('les noms et sigles utilisés par les pros retrouvent la bonne structure', () => {
  const aliases = [
    ['Association loi 1901', 'association_interet_general'],
    ['SCOP', 'cooperative_scop_scic'],
    ['ESUS', 'entreprise_sociale_esus'],
    ['Holding fintech mutualiste', 'fintech_finance_solidaire_mutualiste'],
    ['Inclusion financière', 'fintech_finance_solidaire_mutualiste'],
    ['SIAE', 'structure_insertion_siae'],
    ['ESAT', 'esat_entreprise_adaptee'],
    ['Fonds de dotation', 'fondation_fonds_dotation'],
    ['Recyclerie', 'ressourcerie_recyclerie'],
    ['ONG', 'ong_solidarite_internationale'],
    ['CRESS', 'reseau_accompagnement_ess'],
  ] as const;

  for (const [label, expectedJob] of aliases) {
    assert.equal(
      findJobValueByLabel('economie_sociale_solidaire', label),
      expectedJob,
      label,
    );
  }
});

test('Trouver mon métier reconnaît les recherches ESS', () => {
  const cases = [
    ['association loi 1901', 'association_interet_general'],
    ['scic', 'cooperative_scop_scic'],
    ['entrepreneuriat social', 'entreprise_sociale_esus'],
    ['financement mutualiste du sport', 'fintech_finance_solidaire_mutualiste'],
    ['impact investing', 'fintech_finance_solidaire_mutualiste'],
    ['atelier chantier insertion', 'structure_insertion_siae'],
    ['travail adapté', 'esat_entreprise_adaptee'],
    ['réemploi solidaire', 'ressourcerie_recyclerie'],
    ['maison de quartier', 'centre_social_tiers_lieu'],
    ['humanitaire', 'ong_solidarite_internationale'],
    ['économie sociale et solidaire', 'reseau_accompagnement_ess'],
  ] as const;

  for (const [query, expectedJob] of cases) {
    assert.equal(searchActivityJobs(query)[0]?.job, expectedJob, query);
  }
});

test('les templates couvrent le secteur et ses 12 profils', () => {
  assert.equal(
    economie_sociale_solidaireTemplates.sector,
    'economie_sociale_solidaire',
  );

  const definitions = [
    association_interet_generalJobTemplates,
    cooperative_scop_scicJobTemplates,
    entreprise_sociale_esusJobTemplates,
    fintech_finance_solidaire_mutualisteJobTemplates,
    structure_insertion_siaeJobTemplates,
    esat_entreprise_adapteeJobTemplates,
    mutuelle_protection_socialeJobTemplates,
    fondation_fonds_dotationJobTemplates,
    ressourcerie_recyclerieJobTemplates,
    centre_social_tiers_lieuJobTemplates,
    ong_solidarite_internationaleJobTemplates,
    reseau_accompagnement_essJobTemplates,
  ];

  assert.deepEqual(
    definitions.map((definition) => definition.professionKey),
    expectedJobs.map(([value]) => value),
  );
  assert.ok(
    definitions.every(
      (definition) =>
        definition.sector === 'economie_sociale_solidaire' &&
        definition.pack.audience.length > 30,
    ),
  );

  assert.match(
    JSON.stringify([economie_sociale_solidaireTemplates, ...definitions]),
    /bénéficiaires|adhérents|sociétaires/,
  );
});

test('le Générateur, iNrSearch et l’index des templates reçoivent le contexte ESS', () => {
  const recommendation = getGeneratorRecommendation(
    '[[SECTOR:economie_sociale_solidaire]] association_interet_general',
  );
  assert.equal(recommendation.sectorCategory, 'economie_sociale_solidaire');
  assert.equal(
    recommendation.sectorLabel,
    'Économie sociale & solidaire (ESS)',
  );
  assert.equal(
    inferInrSearchVisualTheme('economie_sociale_solidaire association'),
    'care',
  );

  const sectorTemplateIndex = readFileSync(
    new URL('../../lib/templates/sectors/index.ts', import.meta.url),
    'utf8',
  );
  assert.match(
    sectorTemplateIndex,
    /economie_sociale_solidaire: economie_sociale_solidaireTemplates/,
  );
  assert.match(
    sectorTemplateIndex,
    /buildEconomieSocialeSolidaireJobTemplates\(\)/,
  );
});
