import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';

// Load the actual TypeScript registry and its sector modules, without an alias
// loader or network dependencies. Type-only circular imports are erased.
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
    assert.ok(target, `Unexpected template dependency: ${specifier}`); return load(target);
  });
  return record.exports as T;
}

const beauty = load<typeof import('../../lib/templates/sectors/beaute_bien_etre/index.ts')>('lib/templates/sectors/beaute_bien_etre');
const shared = load<typeof import('../../lib/templates/sectors/shared.ts')>('lib/templates/sectors/shared');
const registry = load<typeof import('../../lib/messageTemplates.ts')>('lib/messageTemplates');
const catalog = load<typeof import('../../lib/activityCatalog.ts')>('lib/activityCatalog');
const definitions = beauty.COSMETIC_PRODUCT_JOB_TEMPLATE_DEFINITIONS;
const KEYS = ['boutique_cosmetiques', 'marque_cosmetique', 'fabricant_cosmetiques', 'formulateur_cosmetiques',
  'grossiste_cosmetiques', 'parfumerie', 'savonnerie', 'cosmetiques_naturels', 'vente_domicile_beaute',
  'boutique_beaute_en_ligne', 'produits_capillaires', 'maquillage_cosmetiques'];
const ACTIONS = ['valoriser', 'avis', 'offres', 'informations', 'suivis', 'enquetes'] as const;
const CHANNELS = ['email', 'site_web', 'facebook', 'instagram', 'linkedin', 'google_business'] as const;
const flat = beauty.buildBeauteBienEtreJobTemplates();

test('all twelve cosmetics activities have distinct complete packs matching the real activity catalogue', () => {
  assert.deepEqual(definitions.map((definition) => definition.professionKey), KEYS);
  assert.equal(new Set(definitions.map((definition) => definition.pack.signature)).size, 12);
  for (const definition of definitions) {
    assert.equal(definition.sector, 'beaute_bien_etre');
    assert.equal(definition.professionLabel, catalog.ACTIVITY_CATALOG.beaute_bien_etre.jobs[definition.professionKey].label);
    assert.deepEqual(Object.keys(definition.pack).sort(), ['label', 'signature', 'promoLead', 'infoLead', 'followLead',
      'surveyLead', 'seasonal', 'loyalty', 'maintenance', 'localHook', 'audience'].sort());
    for (const [field, value] of Object.entries(definition.pack)) assert.ok(value.trim().length >= 10, `${definition.professionKey}.${field}`);
  }
});

test('every cosmetics profession retains all canonical variant keys and intelligent metadata', () => {
  const keys = new Set<string>();
  for (const definition of definitions) {
    const actual = flat.filter((template) => template.professionKey === definition.professionKey);
    const canonical = shared.createJobTemplates(definition);
    assert.equal(actual.length, 48, definition.professionKey);
    assert.deepEqual(actual.map((template) => template.key), canonical.map((template) => template.key));
    for (const [index, template] of actual.entries()) {
      assert.ok(!keys.has(template.key), template.key); keys.add(template.key);
      assert.deepEqual(template.intelligent, canonical[index].intelligent);
      assert.ok(template.title && template.subject && template.body.length > 150 && template.ctaLabel);
      assert.equal(template.sectorCategory, 'beaute_bien_etre');
    }
  }
  assert.equal(keys.size, 12 * 48);
});

test('the real template selector resolves every action and channel to this profession, without salon or generic fallback', () => {
  for (const definition of definitions) for (const action of ACTIONS) for (const channel of CHANNELS) {
    const selected = registry.getTemplates(action, undefined, 'beaute_bien_etre', definition.professionKey, { channel });
    assert.ok(selected.length > 0, `${definition.professionKey}/${action}/${channel}`);
    assert.ok(selected.every((template) => template.professionKey === definition.professionKey));
    const byLabel = registry.getTemplates(action, undefined, 'beaute_bien_etre', definition.professionLabel, { channel });
    assert.deepEqual(byLabel.map((template) => template.key), selected.map((template) => template.key));
    for (const template of selected) {
      assert.doesNotMatch(`${template.title} ${template.subject} ${template.body} ${template.ctaLabel}`,
        /rendez[- ]vous|créneaux?|séances?|\bcures?\b|\bprestations?\b|\binterventions?\b|réserver/i, template.key);
      assert.doesNotMatch(template.body, /guérir|soigner|hypoallergénique|efficacité garantie|zéro allergie|certifié bio/i, template.key);
    }
  }
});

test('manufacturing and formulation qualify professional projects; wholesale stays a reseller supply activity', () => {
  for (const key of ['fabricant_cosmetiques', 'formulateur_cosmetiques', 'grossiste_cosmetiques']) {
    const templates = flat.filter((template) => template.professionKey === key);
    for (const template of templates) assert.doesNotMatch(`${template.body} ${template.ctaLabel}`, /ajouter au panier|acheter maintenant|notre boutique|nos savons fabriqués/i);
    const offers = templates.filter((template) => template.action === 'offres');
    for (const template of offers) {
      if (key === 'fabricant_cosmetiques') { assert.match(template.body, /projet étudié|fabrication/); assert.equal(template.ctaLabel, 'Présenter mon projet de fabrication'); }
      if (key === 'formulateur_cosmetiques') { assert.match(template.body, /développement|technique/); assert.equal(template.ctaLabel, 'Présenter mon brief de formulation'); }
      if (key === 'grossiste_cosmetiques') {
        assert.match(template.body, /revendeur|réassort/); assert.match(template.body, /marques distribuées/);
        assert.doesNotMatch(template.body, /notre fabrication|notre laboratoire|nous fabriquons/);
      }
    }
  }
});

test('natural labels, soap use and personal product copy remain tied to documented product information', () => {
  const natural = definitions.find((definition) => definition.professionKey === 'cosmetiques_naturels')!.pack;
  assert.match(natural.signature, /documentées/); assert.match(natural.infoLead, /attestés|disponibles/);
  const soap = definitions.find((definition) => definition.professionKey === 'savonnerie')!.pack;
  assert.match(soap.infoLead, /précautions/); assert.match(soap.maintenance, /étiquette|stockage/);
  for (const key of ['produits_capillaires', 'maquillage_cosmetiques', 'parfumerie']) {
    assert.match(definitions.find((definition) => definition.professionKey === key)!.pack.infoLead, /fabricants|notices|produits/);
  }
});

test('existing beauty service professions still use their original unmodified templates', () => {
  for (const key of ['coiffeur', 'estheticienne', 'spa']) {
    const jobModule = load<Record<string, Parameters<typeof shared.createJobTemplates>[0]>>(`lib/templates/sectors/beaute_bien_etre/${key}`);
    assert.deepEqual(flat.filter((template) => template.professionKey === key), shared.createJobTemplates(jobModule[`${key}JobTemplates`]));
  }
});
