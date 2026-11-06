import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { BOOK_ALIASES, BOOK_PROFESSIONS } from '../../lib/activityCatalogComplements/bookPublishing.ts';
import { findJobValueByLabel, getJobsForSector, getServicesForSectorAndJob } from '../../lib/activityCatalog.ts';
import { searchActivityJobs } from '../../lib/activityJobSearch.ts';
import { decodeBusinessSector, encodeBusinessSector, inferSectorCategoryFromProfession } from '../../lib/activitySectors.ts';
import { normalizeBusinessProfession } from '../../lib/businessIdentity.ts';
import { buildBusinessDnaProfessionCatalog, buildMissingBusinessDnaProfession } from '../../lib/businessDnaActivityAutofill.ts';

const expected = [
  ['commerce_boutique', 'diffuseur_livres'], ['commerce_boutique', 'distributeur_livres'],
  ['culture_creation', 'agent_litteraire'], ['communication', 'correcteur_editorial'],
  ['culture_creation', 'traducteur_litteraire'], ['services_entreprises', 'traducteur_interprete'],
  ['culture_creation', 'responsable_editorial'], ['culture_creation', 'editeur_presse'],
  ['communication', 'journaliste'], ['communication', 'attache_presse'],
  ['culture_creation', 'editeur_livres_numeriques'], ['communication', 'maquettiste_pao'],
  ['communication', 'typographe'], ['communication', 'photograveur'],
  ['communication', 'faconnier_livre'], ['metiers_art', 'relieur_doreur'],
  ['culture_creation', 'scenariste'], ['services_particuliers', 'ecrivain_public'],
  ['commerce_boutique', 'bouquiniste'], ['culture_creation', 'bibliothecaire'],
  ['culture_creation', 'archiviste'],
] as const;

test('the complete audited book and press family has distinct eight-service professions and specific model packs', () => {
  assert.deepEqual(BOOK_PROFESSIONS.map(entry => [entry.sector, entry.professionKey]), expected);
  assert.equal(new Set(BOOK_PROFESSIONS.map(entry => entry.professionKey)).size, 21);
  assert.equal(new Set(BOOK_PROFESSIONS.map(entry => entry.pack.signature)).size, 21);
  assert.equal(new Set(BOOK_PROFESSIONS.map(entry => entry.pack.promoLead)).size, 21);
  assert.equal(new Set(BOOK_PROFESSIONS.map(entry => entry.pack.audience)).size, 21);
  for (const entry of BOOK_PROFESSIONS) {
    assert.equal(entry.services.length, 8, entry.professionKey);
    assert.equal(new Set(entry.services).size, 8, entry.professionKey);
    assert.equal(entry.pack.label, entry.professionLabel);
    assert.deepEqual(Object.keys(entry.pack).sort(), ['label', 'signature', 'promoLead', 'infoLead', 'followLead', 'surveyLead', 'seasonal', 'loyalty', 'maintenance', 'localHook', 'audience'].sort());
    for (const [field, value] of Object.entries(entry.pack)) assert.ok(value.trim().length > (field === 'label' ? 0 : 10), `${entry.professionKey}/${field}`);
    assert.doesNotMatch(entry.services.join(' '), /asserment[ée]|garantie de publication|carte de presse garantie|retombées garanties/i);
  }
});

for (const entry of BOOK_PROFESSIONS) {
  test(`${entry.professionKey}: real native and assistant catalogue restore every name and the same service choices`, () => {
    assert.ok(getJobsForSector(entry.sector).some(job => job.value === entry.professionKey && job.label === entry.professionLabel));
    assert.deepEqual(getServicesForSectorAndJob(entry.sector, entry.professionKey), entry.services);
    for (const name of [entry.professionLabel, ...entry.aliases]) {
      const found = searchActivityJobs(name)[0];
      assert.equal(found?.sectorCategory, entry.sector, name);
      assert.equal(found?.job, entry.professionKey, name);
      assert.equal(findJobValueByLabel(entry.sector, name), entry.professionKey, name);
      assert.equal(inferSectorCategoryFromProfession(name), entry.sector, name);
      const validated = normalizeBusinessProfession(entry.sector, name);
      assert.equal(validated.profession, entry.professionKey, name);
      assert.deepEqual(decodeBusinessSector(validated.sector), { sectorCategory: entry.sector, profession: entry.professionLabel });
    }
  });
}

test('existing book-related jobs gain aliases without replacement or duplicate profession records', () => {
  assert.deepEqual(BOOK_ALIASES.map(entry => entry.professionKey), ['librairie', 'imprimeur', 'graphiste', 'redacteur_web', 'ecrivain_auteur', 'illustrateur', 'editeur_livres']);
  for (const entry of BOOK_ALIASES) {
    const jobs = getJobsForSector(entry.sector).filter(job => job.value === entry.professionKey);
    assert.equal(jobs.length, 1);
    assert.ok(!BOOK_PROFESSIONS.some(job => job.professionKey === entry.professionKey));
    for (const name of entry.aliases) {
      assert.equal(searchActivityJobs(name)[0]?.job, entry.professionKey, name);
      assert.equal(findJobValueByLabel(entry.sector, name), entry.professionKey, name);
      assert.equal(normalizeBusinessProfession(entry.sector, name).profession, entry.professionKey, name);
    }
  }
});

test('commercial diffusion, physical distribution and the two translation activities retain different service scopes', () => {
  const services = (job: string) => BOOK_PROFESSIONS.find(entry => entry.professionKey === job)!.services;
  assert.ok(services('diffuseur_livres').includes('Représentation commerciale des éditeurs'));
  assert.ok(!services('diffuseur_livres').includes('Stockage des livres'));
  assert.ok(services('distributeur_livres').includes('Stockage des livres'));
  assert.ok(!services('distributeur_livres').includes('Représentation commerciale des éditeurs'));
  assert.ok(services('traducteur_litteraire').includes('Traduction de romans'));
  assert.ok(services('traducteur_interprete').includes('Traduction de documents professionnels'));
  assert.equal(searchActivityJobs('Traducteur')[0]?.job, 'traducteur_interprete');
  assert.equal(searchActivityJobs('Traducteur littéraire')[0]?.job, 'traducteur_litteraire');
  assert.equal(searchActivityJobs('Infographiste')[0]?.job, 'graphiste');
  assert.equal(searchActivityJobs('Infographiste éditorial')[0]?.job, 'maquettiste_pao');
  assert.equal(searchActivityJobs('Écrivain public')[0]?.job, 'ecrivain_public');
  assert.equal(searchActivityJobs('Romancier')[0]?.job, 'ecrivain_auteur');
});

test('book publishing does not hijack software, music or unrelated professional terms', () => {
  for (const name of ['Éditeur de logiciels', 'Éditeur musical', 'Distributeur de cosmétiques', 'Agent immobilier', 'Interprète musical']) {
    assert.ok(!searchActivityJobs(name).some(found => BOOK_PROFESSIONS.some(entry => entry.professionKey === found.job)), name);
  }
  assert.equal(findJobValueByLabel('culture_creation', 'Éditeur'), '');
  assert.ok(!BOOK_PROFESSIONS.some(entry => entry.aliases.includes('Éditeur')));
  assert.equal(searchActivityJobs('Distributeur de cosmétiques')[0]?.job, 'grossiste_cosmetiques');
  assert.ok(!BOOK_PROFESSIONS.some(entry => entry.aliases.includes('Interprète')));
  for (const name of ['Graphiste travaillant pour un éditeur', 'Graphiste pour une maison d’édition']) {
    assert.equal(inferSectorCategoryFromProfession(name), 'communication', name);
  }
});

test('ADN offers the new real IDs but preserves every already selected or custom activity', () => {
  const catalog = buildBusinessDnaProfessionCatalog();
  const existing = encodeBusinessSector('autre', 'Ma spécialité historique');
  for (const entry of BOOK_PROFESSIONS) {
    const choice = { sectorCategory: entry.sector, job: entry.professionKey };
    assert.ok(catalog.includes(`${entry.sector}/${entry.professionKey} : ${entry.professionLabel}`));
    assert.deepEqual(decodeBusinessSector(buildMissingBusinessDnaProfession('', choice)), { sectorCategory: entry.sector, profession: entry.professionLabel });
    assert.equal(buildMissingBusinessDnaProfession(existing, choice), null);
    assert.equal(buildMissingBusinessDnaProfession(encodeBusinessSector('culture_creation', 'Écrivain / Auteur'), choice), null);
  }
  assert.deepEqual(decodeBusinessSector(existing), { sectorCategory: 'autre', profession: 'Ma spécialité historique' });
});

// Compile the real selector and its pure imports; no catalogue, directory or
// template function is substituted and no database or network is loaded.
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
    assert.ok(target, `Unexpected catalogue dependency: ${specifier}`);
    return load(target);
  });
  return record.exports as T;
}
const registry = load<typeof import('../../lib/messageTemplates.ts')>('lib/messageTemplates');
const directory = load<typeof import('../../lib/inrDirectoryCatalog.ts')>('lib/inrDirectoryCatalog');

test('the real directory resolves each new profession and counts its own searchable facet without merging jobs', () => {
  const companies = BOOK_PROFESSIONS.map(entry => directory.resolveDirectoryProfession(encodeBusinessSector(entry.sector, entry.professionLabel)));
  assert.equal(new Set(companies.map(company => company.professionSlug)).size, 21);
  const facets = directory.getDirectoryProfessionFacets(companies);
  for (const [index, entry] of BOOK_PROFESSIONS.entries()) {
    const company = companies[index];
    assert.equal(company.catalogMatch, true);
    assert.equal(company.profession, entry.professionLabel);
    assert.equal(company.sectorCategory, entry.sector);
    const facet = facets.find(item => item.slug === company.professionSlug);
    assert.equal(facet?.label, entry.professionLabel);
    assert.equal(facet?.count, 1);
    for (const alias of entry.aliases) assert.equal(directory.resolveDirectoryProfession(encodeBusinessSector(entry.sector, alias)).professionSlug, company.professionSlug);
  }
});

test('all twenty-one professions have 48 distinct real models selectable for every action and channel', () => {
  const keys = new Set<string>();
  const actions = ['valoriser', 'avis', 'offres', 'informations', 'suivis', 'enquetes'] as const;
  const channels = ['email', 'site_web', 'facebook', 'instagram', 'linkedin', 'google_business'] as const;
  for (const entry of BOOK_PROFESSIONS) {
    const professionKeys = new Set<string>();
    for (const action of actions) for (const channel of channels) {
      const selected = registry.getTemplates(action, undefined, entry.sector, entry.professionKey, { channel });
      assert.ok(selected.length > 0, `${entry.professionKey}/${action}/${channel}`);
      assert.ok(selected.every(template => template.professionKey === entry.professionKey));
      const restored = registry.getTemplates(action, undefined, entry.sector, entry.aliases[0], { channel });
      assert.deepEqual(restored.map(template => template.key), selected.map(template => template.key));
      for (const template of selected) {
        assert.equal(template.sectorCategory, entry.sector);
        assert.ok(template.title && template.subject && template.body && template.intelligent);
        professionKeys.add(template.key);
      }
    }
    assert.equal(professionKeys.size, 48, entry.professionKey);
    for (const key of professionKeys) { assert.ok(!keys.has(key), key); keys.add(key); }
  }
  assert.equal(keys.size, 1008);
});
