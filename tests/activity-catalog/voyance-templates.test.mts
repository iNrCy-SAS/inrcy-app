import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

const cache = new Map<string, { exports: unknown }>();
function load<T>(relative: string): T {
  let filename = path.resolve(relative);
  if (existsSync(filename) && statSync(filename).isDirectory()) filename = path.join(filename, 'index.ts');
  else if (!filename.endsWith('.ts')) filename += '.ts';
  const cached = cache.get(filename); if (cached) return cached.exports as T;
  const record = { exports: {} }; cache.set(filename, record);
  const output = ts.transpileModule(readFileSync(filename, 'utf8'), { fileName: filename,
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  new Function('module', 'exports', 'require', output)(record, record.exports, (specifier: string) => {
    const target = specifier.startsWith('@/') ? path.resolve(specifier.slice(2))
      : specifier.startsWith('.') ? path.resolve(path.dirname(filename), specifier) : null;
    assert.ok(target, `Unexpected registry dependency: ${specifier}`); return load(target);
  });
  return record.exports as T;
}

const sector = load<typeof import('../../lib/templates/sectors/voyance_arts_divinatoires/index.ts')>('lib/templates/sectors/voyance_arts_divinatoires');
const shared = load<typeof import('../../lib/templates/sectors/shared.ts')>('lib/templates/sectors/shared');
const registry = load<typeof import('../../lib/messageTemplates.ts')>('lib/messageTemplates');
const catalog = load<typeof import('../../lib/activityCatalog.ts')>('lib/activityCatalog');
const ranking = load<typeof import('../../lib/templates/intelligentContext.ts')>('lib/templates/intelligentContext');
const definitions = sector.VOYANCE_JOB_TEMPLATE_DEFINITIONS;
const SECTOR = 'voyance_arts_divinatoires';
const KEYS = ['voyant', 'medium', 'tarologue', 'cartomancien', 'astrologue', 'numerologue', 'chiromancien', 'radiesthesiste_divinatoire'];
const ACTIONS = ['valoriser', 'avis', 'offres', 'informations', 'suivis', 'enquetes'] as const;
const CHANNELS = ['email', 'site_web', 'facebook', 'instagram', 'linkedin', 'google_business'] as const;
const jobs = sector.buildVoyanceArtsDivinatoiresJobTemplates();
const generic = sector.createVoyanceSectorTemplates(sector.voyance_arts_divinatoiresTemplates);

test('eight complete profession packs match the dedicated divination activity catalogue', () => {
  assert.deepEqual(definitions.map((definition) => definition.professionKey), KEYS);
  assert.equal(new Set(definitions.map((definition) => definition.pack.signature)).size, 8);
  for (const definition of definitions) {
    assert.equal(definition.sector, SECTOR);
    assert.equal(definition.professionLabel, catalog.ACTIVITY_CATALOG[SECTOR].jobs[definition.professionKey].label);
    assert.deepEqual(Object.keys(definition.pack).sort(), ['label', 'signature', 'promoLead', 'infoLead', 'followLead', 'surveyLead',
      'seasonal', 'loyalty', 'maintenance', 'localHook', 'audience'].sort());
    for (const [field, value] of Object.entries(definition.pack)) {
      assert.ok(value.trim().length >= (field === 'label' ? 3 : 10), `${definition.professionKey}.${field}`);
    }
  }
});

test('all 384 profession variants and 48 sector variants retain canonical keys and intelligent ranking metadata', () => {
  const seen = new Set<string>();
  for (const definition of definitions) {
    const templates = jobs.filter((template) => template.professionKey === definition.professionKey);
    const canonical = shared.createJobTemplates(definition);
    assert.equal(templates.length, 48);
    assert.deepEqual(templates.map((template) => template.key), canonical.map((template) => template.key));
    for (const [index, template] of templates.entries()) {
      assert.ok(!seen.has(template.key)); seen.add(template.key);
      assert.deepEqual(template.intelligent, canonical[index].intelligent);
      assert.ok(template.title && template.subject && template.ctaLabel && template.body.length > 150);
    }
  }
  assert.equal(seen.size, 8 * 48);
  assert.deepEqual(generic.map((template) => template.key), shared.createSectorTemplates(sector.voyance_arts_divinatoiresTemplates).map((template) => template.key));
});

test('real registry resolves each profession and label across every action and communication channel', () => {
  for (const definition of definitions) for (const action of ACTIONS) for (const channel of CHANNELS) {
    const templates = registry.getTemplates(action, undefined, SECTOR, definition.professionKey, { channel });
    assert.ok(templates.length > 0);
    assert.ok(templates.every((template) => template.professionKey === definition.professionKey && template.sectorCategory === SECTOR));
    const byLabel = registry.getTemplates(action, undefined, SECTOR, definition.professionLabel, { channel });
    assert.deepEqual(byLabel.map((template) => template.key), templates.map((template) => template.key));
  }
});

test('sector and unknown-profession fallback use only the descriptive divination sector copy', () => {
  for (const action of ACTIONS) for (const profession of [undefined, 'ancien_metier_inconnu']) for (const channel of CHANNELS) {
    const templates = registry.getTemplates(action, undefined, SECTOR, profession, { channel });
    assert.ok(templates.length > 0);
    assert.ok(templates.every((template) => template.sectorCategory === SECTOR && !template.professionKey));
    assert.deepEqual(new Set(templates.map((template) => template.key)), new Set(generic.filter((template) => template.action === action).map((template) => template.key)));
  }
});

test('all generic and profession copy describes methods, questions and practical conditions without outcome claims or pressure', () => {
  for (const template of [...generic, ...jobs]) {
    const text = `${template.title} ${template.subject} ${template.body} ${template.ctaLabel}`;
    assert.doesNotMatch(text, /résultat|problème résolu|garanti|certitude|prédi(?:re|ction certaine)|guér|diagnostic|médical|retour affectif|désenvoût|malédiction|envoût|danger imminent|avenir certain|chance assurée|intervention urgente/i, template.key);
    assert.match(text, /consultation|échange|méthode|déroulement|questions|préférences/i);
    if (template.action === 'offres') {
      assert.match(template.body, /Tarif et conditions/); assert.match(template.body, /Durée de consultation/);
    }
    if (template.action === 'avis') assert.match(template.body, /propre expérience/);
  }
  const packs = new Map(definitions.map((definition) => [definition.professionKey, definition.pack]));
  assert.match(packs.get('tarologue')!.signature, /tarot|arcanes/);
  assert.match(packs.get('astrologue')!.signature, /thème astrologique/);
  assert.match(packs.get('numerologue')!.signature, /nombres/);
  assert.match(packs.get('chiromancien')!.signature, /lignes de la main/);
  assert.match(packs.get('radiesthesiste_divinatoire')!.signature, /pendule/);
  assert.match(packs.get('medium')!.signature, /praticien décrit ses ressentis/);
});

test('the new fallback restriction leaves all existing sectors and their default sorting unchanged', () => {
  for (const sectorKey of ['beaute_bien_etre', 'medecine_douce', 'commerce_boutique', undefined] as const) for (const action of ACTIONS) {
    const moduleName = action === 'valoriser' || action === 'avis' || action === 'offres' ? 'booster' : 'fideliser';
    const context = ranking.buildIntelligentTemplateContext({ action, module: moduleName, channel: 'email' });
    const previous = registry.TEMPLATES.filter((template) => template.action === action && template.module === moduleName &&
      !template.professionKey && (!template.sectorCategory || Boolean(sectorKey && template.sectorCategory === sectorKey)));
    assert.deepEqual(registry.getTemplates(action, undefined, sectorKey), ranking.sortTemplatesByIntelligentContext(previous, context));
  }
});
