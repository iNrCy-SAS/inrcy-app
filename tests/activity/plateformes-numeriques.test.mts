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
import { plateformes_numeriquesTemplates } from '../../lib/templates/sectors/plateformes_numeriques/common.ts';
import { plateforme_mise_en_relationJobTemplates } from '../../lib/templates/sectors/plateformes_numeriques/plateforme_mise_en_relation.ts';
import { mise_en_relation_particuliers_prosJobTemplates } from '../../lib/templates/sectors/plateformes_numeriques/mise_en_relation_particuliers_pros.ts';
import { mise_en_relation_b2bJobTemplates } from '../../lib/templates/sectors/plateformes_numeriques/mise_en_relation_b2b.ts';
import { mise_en_relation_particuliersJobTemplates } from '../../lib/templates/sectors/plateformes_numeriques/mise_en_relation_particuliers.ts';
import { marketplace_servicesJobTemplates } from '../../lib/templates/sectors/plateformes_numeriques/marketplace_services.ts';
import { annuaire_comparateurJobTemplates } from '../../lib/templates/sectors/plateformes_numeriques/annuaire_comparateur.ts';
import { plateforme_reservationJobTemplates } from '../../lib/templates/sectors/plateformes_numeriques/plateforme_reservation.ts';
import { plateforme_emploi_talentsJobTemplates } from '../../lib/templates/sectors/plateformes_numeriques/plateforme_emploi_talents.ts';
import { communaute_reseauJobTemplates } from '../../lib/templates/sectors/plateformes_numeriques/communaute_reseau.ts';
import { logiciel_saasJobTemplates } from '../../lib/templates/sectors/plateformes_numeriques/logiciel_saas.ts';

const expectedJobs = [
  ['plateforme_mise_en_relation', 'Plateforme de mise en relation'],
  ['mise_en_relation_particuliers_pros', 'Plateforme particuliers / professionnels'],
  ['mise_en_relation_b2b', 'Plateforme de mise en relation B2B'],
  ['mise_en_relation_particuliers', 'Plateforme entre particuliers'],
  ['marketplace_services', 'Marketplace de services'],
  ['annuaire_comparateur', 'Annuaire / comparateur en ligne'],
  ['plateforme_reservation', 'Plateforme de réservation'],
  ['plateforme_emploi_talents', 'Plateforme emploi / talents'],
  ['communaute_reseau', 'Communauté / réseau professionnel'],
  ['logiciel_saas', 'Logiciel / service en ligne (SaaS)'],
] as const;

test('le secteur Plateformes & services numériques est disponible', () => {
  assert.deepEqual(
    ACTIVITY_SECTOR_OPTIONS.find((option) => option.value === 'plateformes_numeriques'),
    { value: 'plateformes_numeriques', label: 'Plateformes & services numériques' },
  );
});

test('les activités de plateforme sont détectées avant les secteurs génériques', () => {
  const cases = [
    'Plateforme de mise en relation en ligne',
    'Marketplace de services',
    'Logiciel SaaS B2B',
    'Plateforme de recrutement',
    'Annuaire en ligne de professionnels',
    'Service de réservation en ligne',
    'Application web de matching',
  ];

  for (const profession of cases) {
    assert.equal(inferSectorCategoryFromProfession(profession), 'plateformes_numeriques');
  }
  assert.equal(inferSectorCategoryFromProfession('Cabinet de recrutement'), 'services_entreprises');
});

test('le stockage encodé conserve le nouveau secteur et le métier', () => {
  const stored = encodeBusinessSector(
    'plateformes_numeriques',
    'plateforme_mise_en_relation',
  );
  assert.equal(stored, '[[SECTOR:plateformes_numeriques]] plateforme_mise_en_relation');
  assert.deepEqual(decodeBusinessSector(stored), {
    sectorCategory: 'plateformes_numeriques',
    profession: 'plateforme_mise_en_relation',
  });
});

test('le catalogue contient 10 métiers et 8 prestations adaptées par métier', () => {
  const jobs = getJobsForSector('plateformes_numeriques');
  assert.equal(jobs.length, expectedJobs.length);

  for (const [value, label] of expectedJobs) {
    assert.ok(jobs.some((job) => job.value === value && job.label === label));
    assert.equal(getServicesForSectorAndJob('plateformes_numeriques', value).length, 8);
  }

  assert.deepEqual(
    getServicesForSectorAndJob(
      'plateformes_numeriques',
      'mise_en_relation_particuliers_pros',
    ),
    [
      'Recherche de professionnels',
      'Dépôt du besoin',
      'Mise en relation locale',
      'Demande de devis',
      'Comparaison des réponses',
      'Prise de rendez-vous',
      'Profils vérifiés',
      'Support utilisateurs',
    ],
  );
});

test('les synonymes historiques retrouvent le bon métier', () => {
  const aliases = [
    ['Mise en relation', 'plateforme_mise_en_relation'],
    ['Plateforme de devis', 'mise_en_relation_particuliers_pros'],
    ['Plateforme B2B', 'mise_en_relation_b2b'],
    ['Plateforme C2C', 'mise_en_relation_particuliers'],
    ['Annuaire professionnel', 'annuaire_comparateur'],
    ['Réservation en ligne', 'plateforme_reservation'],
    ['Plateforme de recrutement', 'plateforme_emploi_talents'],
    ['SaaS', 'logiciel_saas'],
  ] as const;

  for (const [label, expectedJob] of aliases) {
    assert.equal(findJobValueByLabel('plateformes_numeriques', label), expectedJob);
  }
});

test('Trouver mon métier reconnaît les formulations utilisées par les pros', () => {
  const cases = [
    ['plateforme de mise en relation', 'plateforme_mise_en_relation'],
    ['trouver un pro', 'mise_en_relation_particuliers_pros'],
    ['marketplace', 'marketplace_services'],
    ['comparateur', 'annuaire_comparateur'],
    ['job board', 'plateforme_emploi_talents'],
    ['saas', 'logiciel_saas'],
  ] as const;

  for (const [query, expectedJob] of cases) {
    assert.equal(searchActivityJobs(query)[0]?.job, expectedJob, query);
  }
});

test('les templates couvrent le secteur et ses 10 métiers', () => {
  assert.equal(plateformes_numeriquesTemplates.sector, 'plateformes_numeriques');

  const definitions = [
    plateforme_mise_en_relationJobTemplates,
    mise_en_relation_particuliers_prosJobTemplates,
    mise_en_relation_b2bJobTemplates,
    mise_en_relation_particuliersJobTemplates,
    marketplace_servicesJobTemplates,
    annuaire_comparateurJobTemplates,
    plateforme_reservationJobTemplates,
    plateforme_emploi_talentsJobTemplates,
    communaute_reseauJobTemplates,
    logiciel_saasJobTemplates,
  ];

  assert.deepEqual(
    definitions.map((definition) => definition.professionKey),
    expectedJobs.map(([value]) => value),
  );
  assert.ok(definitions.every((definition) => definition.sector === 'plateformes_numeriques'));
  assert.ok(definitions.every((definition) => definition.pack.audience.length > 20));
});

test('le Générateur, iNrSearch et les prompts IA reçoivent le nouveau contexte', () => {
  const recommendation = getGeneratorRecommendation(
    '[[SECTOR:plateformes_numeriques]] plateforme_mise_en_relation',
  );
  assert.equal(recommendation.sectorCategory, 'plateformes_numeriques');
  assert.equal(recommendation.sectorLabel, 'Plateformes & services numériques');
  assert.equal(inferInrSearchVisualTheme('plateformes_numeriques marketplace SaaS'), 'digital');

  const generationProfile = readFileSync(
    new URL('../../lib/aiGenerationProfile.ts', import.meta.url),
    'utf8',
  );
  const mediaPrompt = readFileSync(
    new URL('../../lib/aiMediaGenerationPrompt.ts', import.meta.url),
    'utf8',
  );
  const mediaBusinessDna = readFileSync(
    new URL('../../lib/aiMediaBusinessDna.ts', import.meta.url),
    'utf8',
  );
  const sectorTemplateIndex = readFileSync(
    new URL('../../lib/templates/sectors/index.ts', import.meta.url),
    'utf8',
  );
  assert.match(generationProfile, /getJobLabel\(decodedSector\.sectorCategory, professionCode\)/);
  assert.match(generationProfile, /\["services", "services_text"\]/);
  assert.match(mediaPrompt, /buildAiMediaBusinessDnaPayload\(profile\)/);
  assert.match(mediaBusinessDna, /secteur: cleanText\(business\.sectorLabel/);
  assert.match(mediaBusinessDna, /metier: cleanText\(business\.professionLabel/);
  assert.match(mediaBusinessDna, /prestations: cleanList\(business\.services/);
  assert.match(
    sectorTemplateIndex,
    /plateformes_numeriques: plateformes_numeriquesTemplates/,
  );
  assert.match(
    sectorTemplateIndex,
    /buildPlateformesNumeriquesJobTemplates\(\)/,
  );
});
