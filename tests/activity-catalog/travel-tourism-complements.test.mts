import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { TRAVEL_ALIASES, TRAVEL_PROFESSIONS } from '../../lib/activityCatalogComplements/travelTourism.ts';
import {
  findJobValueByLabel, getJobLabel, getJobsForSector, getServicesForSectorAndJob,
} from '../../lib/activityCatalog.ts';
import { searchActivityJobs } from '../../lib/activityJobSearch.ts';
import { decodeBusinessSector, encodeBusinessSector, inferSectorCategoryFromProfession } from '../../lib/activitySectors.ts';
import {
  buildBusinessDnaProfessionCatalog, buildMissingBusinessDnaProfession, resolveBusinessDnaProfessionSuggestion,
} from '../../lib/businessDnaActivityAutofill.ts';

const expectedJobs = [
  'agence_receptive', 'travel_planner', 'voyages_affaires', 'agence_croisieres', 'sejours_linguistiques',
  'voyages_scolaires', 'guide_conferencier', 'accompagnateur_voyages', 'accompagnateur_montagne',
  'guide_haute_montagne', 'animateur_touristique', 'residence_tourisme', 'village_vacances',
  'auberge_jeunesse', 'hebergement_insolite', 'autocariste', 'chauffeur_guide', 'navette_voyageurs',
];

test('travel complements contain eighteen distinct reviewed professions with eight specific service suggestions', () => {
  assert.deepEqual(TRAVEL_PROFESSIONS.map((entry) => entry.professionKey), expectedJobs);
  assert.equal(new Set(TRAVEL_PROFESSIONS.map((entry) => entry.pack.signature)).size, 18);
  for (const entry of TRAVEL_PROFESSIONS) {
    assert.equal(entry.services.length, 8, entry.professionKey);
    assert.equal(new Set(entry.services).size, 8, entry.professionKey);
    assert.equal(entry.pack.label, entry.professionLabel);
    assert.ok(entry.aliases.length >= 3, entry.professionKey);
    assert.deepEqual(Object.keys(entry.pack).sort(), ['label', 'signature', 'promoLead', 'infoLead', 'followLead',
      'surveyLead', 'seasonal', 'loyalty', 'maintenance', 'localHook', 'audience'].sort());
    for (const [field, value] of Object.entries(entry.pack)) assert.ok(value.trim().length >= 10, `${entry.professionKey}.${field}`);
  }
});

for (const entry of TRAVEL_PROFESSIONS) test(`${entry.professionLabel}: catalogue, search, aliases, restoration and ADN retain the same profession`, () => {
  const { sector, professionKey, professionLabel } = entry;
  assert.ok(getJobsForSector(sector).some((job) => job.value === professionKey && job.label === professionLabel));
  assert.equal(getJobLabel(sector, professionKey), professionLabel);
  assert.deepEqual(getServicesForSectorAndJob(sector, professionKey), entry.services);
  for (const query of [professionLabel, ...entry.aliases]) {
    const [result] = searchActivityJobs(query);
    assert.equal(result?.job, professionKey, query);
    assert.equal(result?.sectorCategory, sector, query);
    assert.equal(findJobValueByLabel(sector, query), professionKey, query);
    assert.equal(inferSectorCategoryFromProfession(query), sector, query);
    const stored = encodeBusinessSector(sector, query);
    assert.deepEqual(decodeBusinessSector(stored), { sectorCategory: sector, profession: query });
    assert.equal(findJobValueByLabel(sector, decodeBusinessSector(stored).profession), professionKey, query);
  }
  assert.ok(buildBusinessDnaProfessionCatalog().includes(`${sector}/${professionKey} : ${professionLabel}`));
  const sourceQuote = `Notre activité est ${professionLabel}`;
  const proposal = { sectorCategory: sector, job: professionKey, confidence: 'high', sourceQuote };
  const suggestion = resolveBusinessDnaProfessionSuggestion(proposal, [{ status: 'analyzed', content: sourceQuote }]);
  assert.deepEqual(suggestion, { sectorCategory: sector, job: professionKey });
  assert.equal(resolveBusinessDnaProfessionSuggestion(proposal, [{ status: 'analyzed', content: 'Notre atelier répare des vélos.' }]), null);
  assert.deepEqual(decodeBusinessSector(buildMissingBusinessDnaProfession('', suggestion)), { sectorCategory: sector, profession: professionLabel });
  const existing = encodeBusinessSector('autre', professionLabel);
  assert.equal(buildMissingBusinessDnaProfession(existing, suggestion), null);
  assert.deepEqual(decodeBusinessSector(existing), { sectorCategory: 'autre', profession: professionLabel });
});

for (const entry of TRAVEL_ALIASES) test(`existing ${entry.sector}/${entry.professionKey}: repaired aliases reach its original services`, () => {
  const services = getServicesForSectorAndJob(entry.sector, entry.professionKey);
  assert.equal(services.length, 8);
  for (const query of entry.aliases) {
    const [result] = searchActivityJobs(query);
    assert.equal(result?.sectorCategory, entry.sector, query);
    assert.equal(result?.job, entry.professionKey, query);
    assert.equal(findJobValueByLabel(entry.sector, query), entry.professionKey, query);
    assert.equal(inferSectorCategoryFromProfession(query), entry.sector, query);
    assert.deepEqual(getServicesForSectorAndJob(result.sectorCategory, result.job), services);
  }
});

test('travel services distinguish advice, guiding, mountain activities and actual transport without invented qualifications', () => {
  const byId = new Map(TRAVEL_PROFESSIONS.map((entry) => [entry.professionKey, entry]));
  const planner = byId.get('travel_planner')!;
  assert.match(planner.pack.signature, /disting[u]?uant le conseil des réservations/);
  assert.ok(!planner.services.includes('Réservation de voyages'));
  assert.ok(byId.get('accompagnateur_montagne')!.services.includes('Randonnée pédestre accompagnée'));
  assert.ok(!byId.get('accompagnateur_montagne')!.services.includes('Alpinisme'));
  assert.ok(byId.get('guide_haute_montagne')!.services.includes('Alpinisme'));
  assert.match(byId.get('guide_haute_montagne')!.pack.infoLead, /sans garantir/);
  assert.match(byId.get('chauffeur_guide')!.pack.infoLead, /non inclus/);
  assert.match(byId.get('sejours_linguistiques')!.pack.infoLead, /sans promettre/);
  for (const entry of TRAVEL_PROFESSIONS) assert.doesNotMatch(JSON.stringify(entry), /agréé|agrément|certifié|certification|sans risque|sécurité garantie|réussite garantie/i);
  for (const [query, id] of [
    ['Agence de communication', 'agence_communication'], ['Taxi', 'taxi'], ['VTC', 'vtc'],
    ['Guide touristique', 'guide_touristique'], ['Tour-opérateur', 'agence_voyages'], ['Voyagiste', 'agence_voyages'],
  ]) assert.equal(searchActivityJobs(query)[0]?.job, id, query);
});

// Execute the real registry, its builders and selector, with no mocked templates.
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

test('all eighteen travel professions expose their 864 distinct native templates across every action and channel', () => {
  const allKeys = new Set<string>();
  for (const entry of TRAVEL_PROFESSIONS) {
    const keys = new Set<string>();
    for (const action of actions) for (const channel of channels) {
      const templates = registry.getTemplates(action, undefined, entry.sector, entry.professionKey, { channel });
      assert.ok(templates.length, `${entry.professionKey}/${action}/${channel}`);
      assert.ok(templates.every((template) => template.professionKey === entry.professionKey));
      const byLabel = registry.getTemplates(action, undefined, entry.sector, entry.professionLabel, { channel });
      assert.deepEqual(byLabel.map((template) => template.key), templates.map((template) => template.key));
      for (const template of templates) {
        assert.equal(template.sectorCategory, entry.sector);
        assert.ok(template.intelligent && template.body && template.title && template.subject);
        keys.add(template.key);
      }
    }
    assert.equal(keys.size, 48, entry.professionKey);
    for (const key of keys) { assert.ok(!allKeys.has(key), key); allKeys.add(key); }
  }
  assert.equal(allKeys.size, 864);
});
