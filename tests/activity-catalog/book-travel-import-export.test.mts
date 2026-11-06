import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import {
  ACTIVITY_JOB_ALIASES, findJobValueByLabel, getJobLabel, getJobsForSector, getServicesForSectorAndJob,
} from '../../lib/activityCatalog.ts';
import { searchActivityJobs } from '../../lib/activityJobSearch.ts';
import { decodeBusinessSector, encodeBusinessSector, inferSectorCategoryFromProfession } from '../../lib/activitySectors.ts';
import {
  buildBusinessDnaProfessionCatalog, buildMissingBusinessDnaProfession, resolveBusinessDnaProfessionSuggestion,
} from '../../lib/businessDnaActivityAutofill.ts';
import { getGeneratorRecommendation } from '../../lib/generatorSettings.ts';

const professions = [
  { sector: 'commerce_boutique', job: 'import_export', label: 'Import-export', service: 'Importation de marchandises' },
  { sector: 'tourisme', job: 'agence_voyages', label: 'Agence de voyages', service: 'Séjours sur mesure' },
  { sector: 'culture_creation', job: 'editeur_livres', label: 'Éditeur de livres / Maison d’édition', service: 'Catalogue de livres' },
] as const;

for (const profession of professions) {
  test(`${profession.label}: selection, aliases and saved profile restore the same eight service suggestions`, () => {
    const { sector, job, label, service } = profession;
    assert.ok(getJobsForSector(sector).some((entry) => entry.value === job && entry.label === label));
    const services = getServicesForSectorAndJob(sector, job);
    assert.equal(services.length, 8);
    assert.equal(new Set(services).size, 8);
    assert.ok(services.includes(service));
    for (const query of [label, ...ACTIVITY_JOB_ALIASES[sector]![job]]) {
      assert.equal(searchActivityJobs(query)[0]?.job, job, query);
      assert.equal(searchActivityJobs(query)[0]?.sectorCategory, sector, query);
      assert.equal(findJobValueByLabel(sector, query), job, query);
      assert.equal(inferSectorCategoryFromProfession(query), sector, query);
      const restored = decodeBusinessSector(encodeBusinessSector(sector, query));
      assert.deepEqual(restored, { sectorCategory: sector, profession: query });
      assert.equal(findJobValueByLabel(restored.sectorCategory, restored.profession), job, query);
      assert.deepEqual(getServicesForSectorAndJob(restored.sectorCategory, job), services);
    }
    assert.equal(getGeneratorRecommendation(encodeBusinessSector(sector, label)).sectorCategory, sector);
  });

  test(`${profession.label}: ADN only proposes the real catalogue ID with source evidence and never overwrites a chosen activity`, () => {
    const { sector: sectorCategory, job, label } = profession;
    assert.ok(buildBusinessDnaProfessionCatalog().includes(`${sectorCategory}/${job} : ${label}`));
    const sourceQuote = `Notre activité professionnelle est ${label}`;
    const choice = { sectorCategory, job, confidence: 'high', sourceQuote };
    const suggestion = resolveBusinessDnaProfessionSuggestion(choice, [{ status: 'analyzed', content: sourceQuote }]);
    assert.deepEqual(suggestion, { sectorCategory, job });
    const stored = buildMissingBusinessDnaProfession('', suggestion);
    assert.deepEqual(decodeBusinessSector(stored), { sectorCategory, profession: label });
    assert.equal(resolveBusinessDnaProfessionSuggestion(choice, [{ status: 'analyzed', content: 'Notre atelier répare des vélos.' }]), null);
    for (const existing of [encodeBusinessSector('autre', label), encodeBusinessSector('communication', 'Agence de communication')]) {
      assert.equal(buildMissingBusinessDnaProfession(existing, suggestion), null);
      assert.equal(decodeBusinessSector(existing).sectorCategory, existing.includes('SECTOR:autre') ? 'autre' : 'communication');
    }
  });
}

test('book publishing, international trade and travel aliases do not redirect unrelated professions or data actions', () => {
  for (const query of ['Éditeur de logiciels', 'Éditeur musical', 'Import export de données', 'Importateur de données', 'Exporter des contacts', 'Transport international']) {
    assert.ok(!professions.some(({ sector }) => inferSectorCategoryFromProfession(query) === sector), query);
    assert.ok(!searchActivityJobs(query).some(({ job }) => professions.some((profession) => profession.job === job)), query);
  }
  assert.equal(inferSectorCategoryFromProfession('Agence'), 'services_entreprises');
  assert.equal(searchActivityJobs('Agence de communication')[0]?.job, 'agence_communication');
  assert.equal(searchActivityJobs('Librairie')[0]?.job, 'librairie');
  assert.equal(searchActivityJobs('Écrivain')[0]?.job, 'ecrivain_auteur');
  assert.equal(findJobValueByLabel('culture_creation', 'Éditeur'), '');
  assert.equal(findJobValueByLabel('culture_creation', 'Éditeur de logiciels'), '');
});

// Load the actual template registry and its imports; type-only circular imports
// disappear during transpilation. No template or selector is mocked.
const cache = new Map<string, { exports: unknown }>();
function load<T>(relative: string): T {
  let filename = path.resolve(relative);
  if (existsSync(filename) && statSync(filename).isDirectory()) filename = path.join(filename, 'index.ts');
  else if (!filename.endsWith('.ts')) filename += '.ts';
  const cached = cache.get(filename);
  if (cached) return cached.exports as T;
  const record = { exports: {} }; cache.set(filename, record);
  const output = ts.transpileModule(readFileSync(filename, 'utf8'), { fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  new Function('module', 'exports', 'require', output)(record, record.exports, (specifier: string) => {
    const target = specifier.startsWith('@/') ? path.resolve(specifier.slice(2))
      : specifier.startsWith('.') ? path.resolve(path.dirname(filename), specifier) : null;
    assert.ok(target, `Unexpected template dependency: ${specifier}`);
    return load(target);
  });
  return record.exports as T;
}

const registry = load<typeof import('../../lib/messageTemplates.ts')>('lib/messageTemplates');
const actions = ['valoriser', 'avis', 'offres', 'informations', 'suivis', 'enquetes'] as const;
const channels = ['email', 'site_web', 'facebook', 'instagram', 'linkedin', 'google_business'] as const;

test('the three professions each expose 48 distinct real templates through every action and channel selector', () => {
  const keys = new Set<string>();
  for (const { sector, job, label } of professions) {
    const professionKeys = new Set<string>();
    assert.equal(getJobLabel(sector, job), label);
    for (const action of actions) for (const channel of channels) {
      const templates = registry.getTemplates(action, undefined, sector, job, { channel });
      assert.ok(templates.length > 0, `${job}/${action}/${channel}`);
      assert.ok(templates.every((template) => template.professionKey === job));
      const byLabel = registry.getTemplates(action, undefined, sector, label, { channel });
      assert.deepEqual(byLabel.map((template) => template.key), templates.map((template) => template.key));
      for (const template of templates) {
        assert.equal(template.sectorCategory, sector);
        assert.ok(template.title && template.subject && template.body && template.intelligent);
        professionKeys.add(template.key);
      }
    }
    assert.equal(professionKeys.size, 48, job);
    for (const key of professionKeys) { assert.ok(!keys.has(key), key); keys.add(key); }
  }
  assert.equal(keys.size, 144);
});
