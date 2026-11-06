import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { TRADE_ALIASES, TRADE_PROFESSIONS } from '../../lib/activityCatalogComplements/internationalTrade.ts';
import { getJobLabel, getJobsForSector, getServicesForSectorAndJob, findJobValueByLabel } from '../../lib/activityCatalog.ts';
import { searchActivityJobs } from '../../lib/activityJobSearch.ts';
import { decodeBusinessSector, encodeBusinessSector, inferSectorCategoryFromProfession } from '../../lib/activitySectors.ts';
import { buildBusinessDnaProfessionCatalog, resolveBusinessDnaProfessionSuggestion } from '../../lib/businessDnaActivityAutofill.ts';

const expected = {
  commerce_boutique: ['grossiste', 'distributeur_professionnel', 'negoce_marchandises', 'negoce_materiaux', 'centrale_achat'],
  services_entreprises: ['agent_commercial_independant', 'agent_sourcing', 'acheteur_international', 'consultant_export', 'consultant_douane', 'consultant_supply_chain'],
  transport: ['transitaire', 'commissionnaire_transport', 'affreteur', 'prestataire_logistique', 'entrepositaire', 'preparation_commandes', 'declarant_douane', 'representant_douane'],
};

// Execute the real registry/directory with their local imports, without
// replacing templates, selectors, profession data or search policies.
const cache = new Map<string, { exports: unknown }>();
function load<T>(relative: string): T {
  let filename = path.resolve(relative);
  if (!existsSync(filename)) filename += '.ts';
  else if (statSync(filename).isDirectory()) filename = path.join(filename, 'index.ts');
  if (cache.has(filename)) return cache.get(filename)!.exports as T;
  const record = { exports: {} }; cache.set(filename, record);
  const output = ts.transpileModule(readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  new Function('module', 'exports', 'require', output)(record, record.exports, (specifier: string) => {
    const target = specifier.startsWith('@/') ? path.resolve(specifier.slice(2))
      : specifier.startsWith('.') ? path.resolve(path.dirname(filename), specifier) : null;
    assert.ok(target, `Unexpected external catalogue dependency: ${specifier}`);
    return load(target);
  });
  return record.exports as T;
}
const registry = load<typeof import('../../lib/messageTemplates.ts')>('lib/messageTemplates');
const directory = load<typeof import('../../lib/inrDirectoryCatalog.ts')>('lib/inrDirectoryCatalog');
const shared = load<typeof import('../../lib/templates/sectors/shared.ts')>('lib/templates/sectors/shared');
const actions = ['valoriser', 'avis', 'offres', 'informations', 'suivis', 'enquetes'] as const;
const channels = ['email', 'site_web', 'facebook', 'instagram', 'linkedin', 'google_business'] as const;

test('the international trade audit has nineteen distinct complete professions with eight tailored services each', () => {
  assert.equal(TRADE_PROFESSIONS.length, 19);
  assert.equal(new Set(TRADE_PROFESSIONS.map(entry => entry.professionKey)).size, 19);
  assert.equal(new Set(TRADE_PROFESSIONS.map(entry => entry.pack.signature)).size, 19);
  for (const [sector, keys] of Object.entries(expected)) {
    assert.deepEqual(TRADE_PROFESSIONS.filter(entry => entry.sector === sector).map(entry => entry.professionKey).sort(), [...keys].sort());
  }
  for (const entry of TRADE_PROFESSIONS) {
    assert.equal(entry.services.length, 8); assert.equal(new Set(entry.services).size, 8);
    assert.ok(entry.aliases.length >= 3);
    assert.deepEqual(Object.keys(entry.pack).sort(), ['label', 'signature', 'promoLead', 'infoLead', 'followLead', 'surveyLead', 'seasonal', 'loyalty', 'maintenance', 'localHook', 'audience'].sort());
    assert.equal(entry.pack.label, entry.professionLabel);
    for (const value of [...entry.services, ...Object.values(entry.pack)]) assert.ok(value.trim().length >= 6, entry.professionKey);
    assert.doesNotMatch(JSON.stringify(entry), /agrément garanti|agréé par|certification garantie|dédouanement garanti|exonération automatique/i);
  }
});

for (const entry of TRADE_PROFESSIONS) {
  test(`${entry.professionKey}: real selection search inference restoration and directory retain the same profession and services`, () => {
    assert.ok(getJobsForSector(entry.sector).some(job => job.value === entry.professionKey && job.label === entry.professionLabel));
    assert.deepEqual(getServicesForSectorAndJob(entry.sector, entry.professionKey), entry.services);
    for (const name of [entry.professionLabel, ...entry.aliases]) {
      const result = searchActivityJobs(name)[0];
      assert.equal(result?.job, entry.professionKey, name); assert.equal(result?.sectorCategory, entry.sector, name);
      assert.equal(inferSectorCategoryFromProfession(name), entry.sector, name);
      assert.equal(findJobValueByLabel(entry.sector, name), entry.professionKey, name);
      const encoded = encodeBusinessSector(entry.sector, name);
      const restored = decodeBusinessSector(encoded);
      assert.equal(restored.sectorCategory, entry.sector);
      assert.equal(findJobValueByLabel(restored.sectorCategory, restored.profession), entry.professionKey);
      const listed = directory.resolveDirectoryProfession(encoded);
      assert.equal(listed.catalogMatch, true, name); assert.equal(listed.profession, entry.professionLabel, name);
      assert.equal(listed.sectorCategory, entry.sector, name);
      assert.equal(listed.professionSlug, directory.directorySlug(entry.professionLabel));
    }
    assert.ok(buildBusinessDnaProfessionCatalog().includes(`${entry.sector}/${entry.professionKey} : ${entry.professionLabel}`));
    const sourceQuote = `Notre métier est ${entry.professionLabel}.`;
    assert.deepEqual(resolveBusinessDnaProfessionSuggestion({ sectorCategory: entry.sector, job: entry.professionKey, confidence: 'high', sourceQuote }, [{ status: 'analyzed', content: sourceQuote }]), { sectorCategory: entry.sector, job: entry.professionKey });
  });
}

test('international trade variants and freight reuse their existing IDs instead of creating duplicate professions', () => {
  assert.deepEqual(TRADE_ALIASES.map(entry => entry.professionKey), ['import_export', 'marchandises']);
  for (const entry of TRADE_ALIASES) for (const name of entry.aliases) {
    assert.equal(findJobValueByLabel(entry.sector, name), entry.professionKey, name);
    assert.equal(searchActivityJobs(name)[0]?.job, entry.professionKey, name);
    assert.equal(inferSectorCategoryFromProfession(name), entry.sector, name);
    assert.equal(getServicesForSectorAndJob(entry.sector, entry.professionKey).length, 8);
    assert.equal(directory.resolveDirectoryProfession(encodeBusinessSector(entry.sector, name)).profession, getJobLabel(entry.sector, entry.professionKey));
  }
});

test('the real template registry supplies 912 dedicated variants and resolves every profession for all actions and channels', () => {
  const allKeys = new Set<string>();
  for (const entry of TRADE_PROFESSIONS) {
    const canonical = shared.createJobTemplates(entry);
    const canonicalByKey = new Map(canonical.map(item => [item.key, item]));
    assert.equal(canonical.length, 48, entry.professionKey);
    const actualKeys = new Set<string>();
    for (const action of actions) for (const channel of channels) {
      const templates = registry.getTemplates(action, undefined, entry.sector, entry.professionKey, { channel });
      assert.ok(templates.length > 0, `${entry.professionKey}/${action}/${channel}`);
      const byLabel = registry.getTemplates(action, undefined, entry.sector, entry.professionLabel, { channel });
      assert.deepEqual(byLabel.map(item => item.key), templates.map(item => item.key));
      for (const template of templates) {
        assert.equal(template.professionKey, entry.professionKey); assert.equal(template.sectorCategory, entry.sector);
        assert.ok(template.title && template.subject && template.body.length > 150);
        assert.equal(template.ctaLabel, canonicalByKey.get(template.key)?.ctaLabel, template.key);
        assert.ok(template.intelligent); actualKeys.add(template.key);
      }
    }
    assert.deepEqual([...actualKeys].sort(), canonical.map(item => item.key).sort());
    for (const key of actualKeys) { assert.ok(!allKeys.has(key)); allKeys.add(key); }
  }
  assert.equal(allKeys.size, 912);
});

test('commercial and customs additions preserve narrow existing professions and do not infer a client trade from a description', () => {
  for (const [name, sector, job] of [
    ['Agent commercial immobilier', 'immobilier', 'mandataire_immobilier'],
    ['Agent commercial en immobilier', 'immobilier', 'mandataire_immobilier'],
    ['Courtier en assurance', 'assurance', 'courtier_assurance'],
    ['Courtier immobilier', 'immobilier', 'courtier'],
    ['Négoce de bois', 'bois_foret', 'negoce_bois'],
    ['Grossiste en cosmétiques', 'beaute_bien_etre', 'grossiste_cosmetiques'],
    ['Grossiste capillaire', 'beaute_bien_etre', 'produits_capillaires'],
    ['Distributeur de cosmétiques', 'beaute_bien_etre', 'grossiste_cosmetiques'],
  ]) {
    assert.equal(searchActivityJobs(name)[0]?.job, job, name);
    assert.equal(inferSectorCategoryFromProfession(name), sector, name);
  }
  assert.notEqual(inferSectorCategoryFromProfession('Agence de communication pour un transitaire'), 'transport');
  assert.notEqual(inferSectorCategoryFromProfession('Consultant informatique pour un importateur'), 'commerce_boutique');
  assert.notEqual(searchActivityJobs('Import export de données')[0]?.job, 'import_export');
  assert.notEqual(inferSectorCategoryFromProfession('Recrutement et sourcing de candidats'), 'commerce_boutique');
});
