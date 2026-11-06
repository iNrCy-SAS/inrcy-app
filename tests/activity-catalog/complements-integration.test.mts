import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { ACTIVITY_PROFESSION_COMPLEMENTS, ACTIVITY_EXISTING_PROFESSION_ALIASES } from '../../lib/activityCatalogComplements/index.ts';
import { TRADE_PROFESSIONS } from '../../lib/activityCatalogComplements/internationalTrade.ts';
import { TRAVEL_PROFESSIONS } from '../../lib/activityCatalogComplements/travelTourism.ts';
import { BOOK_PROFESSIONS } from '../../lib/activityCatalogComplements/bookPublishing.ts';
import { ACTIVITY_CATALOG, ACTIVITY_JOB_ALIASES, findJobValueByLabel, getJobsForSector, getServicesForSectorAndJob } from '../../lib/activityCatalog.ts';
import { inferSectorCategoryFromProfession } from '../../lib/activitySectors.ts';
import { searchActivityJobs } from '../../lib/activityJobSearch.ts';

const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();

test('all fifty-eight complements have unique sector IDs and appear once in the live catalogue with their eight services', () => {
  assert.deepEqual([TRADE_PROFESSIONS.length, TRAVEL_PROFESSIONS.length, BOOK_PROFESSIONS.length], [19, 18, 21]);
  assert.equal(ACTIVITY_PROFESSION_COMPLEMENTS.length, 58);
  const ids = new Set<string>();
  for (const entry of ACTIVITY_PROFESSION_COMPLEMENTS) {
    const id = `${entry.sector}/${entry.professionKey}`;
    assert.ok(!ids.has(id), id); ids.add(id);
    assert.equal(getJobsForSector(entry.sector).filter((job) => job.value === entry.professionKey).length, 1, id);
    assert.equal(ACTIVITY_CATALOG[entry.sector].jobs[entry.professionKey].label, entry.professionLabel, id);
    assert.equal(entry.services.length, 8, id);
    assert.equal(new Set(entry.services).size, 8, id);
    assert.deepEqual(getServicesForSectorAndJob(entry.sector, entry.professionKey), entry.services, id);
    assert.equal(findJobValueByLabel(entry.sector, entry.professionLabel), entry.professionKey, id);
  }
  assert.equal(ids.size, 58);
});

test('normalized shared aliases and profession labels never name two different professions', () => {
  const names = new Map<string, string>();
  function register(name: string, id: string) {
    const key = normalize(name);
    assert.ok(key);
    const prior = names.get(key);
    assert.ok(!prior || prior === id, `${name}: ${prior} conflicts with ${id}`);
    names.set(key, id);
  }
  for (const [sector, definition] of Object.entries(ACTIVITY_CATALOG)) {
    for (const [job, profession] of Object.entries(definition.jobs)) register(profession.label, `${sector}/${job}`);
  }
  for (const [sector, jobs] of Object.entries(ACTIVITY_JOB_ALIASES)) {
    for (const [job, aliases] of Object.entries(jobs)) for (const alias of aliases) register(alias, `${sector}/${job}`);
  }
  for (const entry of [...ACTIVITY_PROFESSION_COMPLEMENTS, ...ACTIVITY_EXISTING_PROFESSION_ALIASES]) {
    for (const alias of entry.aliases) {
      register(alias, `${entry.sector}/${entry.professionKey}`);
      assert.equal(findJobValueByLabel(entry.sector, alias), entry.professionKey, alias);
      const [result] = searchActivityJobs(alias);
      assert.equal(result?.sectorCategory, entry.sector, alias);
      assert.equal(result?.job, entry.professionKey, alias);
    }
  }
});

test('specialized professions, software publishing and a different principal profession retain their meaning', () => {
  for (const [query, sector, job] of [
    ['Éditeur de logiciels', 'plateformes_numeriques', 'logiciel_saas'],
    ['Édition de logiciels', 'plateformes_numeriques', 'logiciel_saas'],
    ['Éditeur de livres', 'culture_creation', 'editeur_livres'],
    ['Éditeur de livres numériques', 'culture_creation', 'editeur_livres_numeriques'],
    ['Fabricant de cosmétiques', 'beaute_bien_etre', 'fabricant_cosmetiques'],
    ['Grossiste cosmétique', 'beaute_bien_etre', 'grossiste_cosmetiques'],
    ['Agent commercial immobilier', 'immobilier', 'mandataire_immobilier'],
    ['Commercial indépendant immobilier', 'immobilier', 'mandataire_immobilier'],
    ['Agent commercial spécialisé en immobilier', 'immobilier', 'mandataire_immobilier'],
    ['Agent commercial en assurance', 'assurance', 'conseiller_assurances'],
    ['Représentant commercial en assurances', 'assurance', 'conseiller_assurances'],
    ['Négociant en bois', 'bois_foret', 'negoce_bois'],
    ['Grossiste en bois', 'bois_foret', 'negoce_bois'],
    ['Distributeur de bois', 'bois_foret', 'negoce_bois'],
    ['Guide touristique', 'tourisme', 'guide_touristique'],
    ['Guide de haute montagne', 'tourisme', 'guide_haute_montagne'],
    ['Traducteur littéraire', 'culture_creation', 'traducteur_litteraire'],
    ['Traducteur', 'services_entreprises', 'traducteur_interprete'],
  ] as const) {
    const [result] = searchActivityJobs(query);
    assert.equal(result?.sectorCategory, sector, query);
    assert.equal(result?.job, job, query);
    assert.equal(findJobValueByLabel(sector, query), job, query);
    assert.equal(inferSectorCategoryFromProfession(query), sector, query);
  }
  for (const [query, expected] of [
    ['Architecte d’intérieur pour une agence de voyages', 'architecture_design'],
    ['Plombier pour une maison d’édition', 'artisan_btp'],
    ['Créateur de site internet pour un voyagiste', 'communication'],
    ['Agence de communication pour un importateur', 'services_entreprises'],
    ['Naturopathe pour un organisateur de séjours', 'medecine_douce'],
    ['Architecte d’intérieur pour parfumerie', 'architecture_design'],
  ] as const) assert.equal(inferSectorCategoryFromProfession(query), expected, query);
  for (const query of ['Import export de données', 'Importer des fichiers CSV', 'Exporter des contacts']) {
    assert.ok(!searchActivityJobs(query).some((result) => result.job === 'import_export'), query);
    assert.notEqual(inferSectorCategoryFromProfession(query), 'commerce_boutique', query);
  }
});

// Real registry loading, including every complement and actual template builder.
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

test('each of the fifty-eight professions has forty-eight distinct templates selected by its real ID, label and aliases', () => {
  const allKeys = new Set<string>();
  for (const entry of ACTIVITY_PROFESSION_COMPLEMENTS) {
    const keys = new Set<string>();
    for (const action of actions) for (const channel of channels) {
      const actual = registry.getTemplates(action, undefined, entry.sector, entry.professionKey, { channel });
      assert.ok(actual.length, `${entry.professionKey}/${action}/${channel}`);
      assert.ok(actual.every((template) => template.professionKey === entry.professionKey));
      for (const template of actual) {
        assert.equal(template.sectorCategory, entry.sector);
        assert.ok(template.title && template.subject && template.body && template.intelligent);
        keys.add(template.key);
      }
      for (const name of [entry.professionLabel, ...entry.aliases]) {
        assert.deepEqual(registry.getTemplates(action, undefined, entry.sector, name, { channel }).map((template) => template.key), actual.map((template) => template.key), name);
      }
    }
    assert.equal(keys.size, 48, entry.professionKey);
    for (const key of keys) { assert.ok(!allKeys.has(key), key); allKeys.add(key); }
  }
  assert.equal(allKeys.size, 58 * 48);
});
