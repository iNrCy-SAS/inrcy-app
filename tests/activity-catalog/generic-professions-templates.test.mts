import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import type { TemplateAction, TemplateDef } from '../../lib/messageTemplates.ts';

// Exercise the production registry, aliases, builders and renderer without
// replacing templates or making database/provider calls.
const cache = new Map<string, { exports: unknown }>();
function load<T>(relative: string): T {
  let filename = path.resolve(relative);
  if (existsSync(filename) && statSync(filename).isDirectory()) filename = path.join(filename, 'index.ts');
  else if (!filename.endsWith('.ts')) filename += '.ts';
  const cached = cache.get(filename);
  if (cached) return cached.exports as T;
  const record = { exports: {} };
  cache.set(filename, record);
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
const renderer = load<typeof import('../../lib/templateEngine.ts')>('lib/templateEngine');
const { chirurgienJobTemplates } = load<typeof import('../../lib/templates/sectors/sante/chirurgien.ts')>('lib/templates/sectors/sante/chirurgien');
const { formateurJobTemplates } = load<typeof import('../../lib/templates/sectors/formation_enseignement/formateur.ts')>('lib/templates/sectors/formation_enseignement/formateur');
const actions: TemplateAction[] = ['valoriser', 'avis', 'offres', 'informations', 'suivis', 'enquetes'];
const channels = ['email', 'site_web', 'facebook', 'instagram', 'linkedin', 'google_business'] as const;
const sharedCounts = [8, 4, 10, 6, 10, 10];

for (const [definition, counts] of [
  [chirurgienJobTemplates, [4, 4, 4, 4, 4, 4]],
  [formateurJobTemplates, sharedCounts],
] as const) {
  test(`${definition.professionLabel} selects its own native templates for all six actions and channels by key and label`, () => {
    const uniqueKeys = new Set<string>();
    for (const [index, action] of actions.entries()) for (const channel of channels) {
      const selected = registry.getTemplates(action, undefined, definition.sector, definition.professionKey, { channel });
      assert.equal(selected.length, counts[index], `${action}/${channel}`);
      assert.ok(selected.every(template => template.professionKey === definition.professionKey && template.sectorCategory === definition.sector));
      assert.deepEqual(registry.getTemplates(action, undefined, definition.sector, definition.professionLabel, { channel }).map(template => template.key), selected.map(template => template.key));
      for (const template of selected) {
        assert.ok(template.title && template.subject && template.body && template.intelligent);
        assert.equal(registry.TEMPLATES.filter(candidate => candidate.key === template.key).length, 1, template.key);
        uniqueKeys.add(template.key);
      }
    }
    assert.equal(uniqueKeys.size, counts.reduce((sum, count) => sum + count, 0));
  });
}

test('Chirurgien copy stays informative across every action without commercial urgency, medical promises or an imposed specialty', () => {
  const templates = registry.TEMPLATES.filter(template => template.professionKey === 'chirurgien');
  assert.equal(templates.length, 24);
  for (const template of templates) {
    const publicCopy = [template.title, template.subject, template.body, template.ctaLabel].join('\n');
    assert.doesNotMatch(publicCopy, /promotion|offre flash|offre limit[ée]e|r[ée]duction|fid[ée]lit[ée]|urgent|prioritaire|garanti|gu[ée]rison|r[ée]ussite assur[ée]e|orthop[ée]d|cardio|plastique|chirurgie esth[ée]tique/i, template.key);
    assert.notEqual(template.intelligent?.objective, 'urgence', template.key);
    if (template.action === 'offres') assert.equal(template.ctaLabel, 'Contacter le cabinet');
    if (template.action === 'avis') assert.match(template.body, /sans détail sur votre santé/);
    if (template.action === 'enquetes') assert.match(template.body, /ne communiquez pas de détail médical/);
  }
  const copy = templates.map(template => template.body).join('\n');
  for (const service of [/consultation chirurgicale/i, /bilan préopératoire/i, /préparation de l’intervention/i, /suivi postopératoire/i, /consultation de contrôle/i, /coordination/i]) assert.match(copy, service);
});

test('Formateur copy uses learning context without inheriting driving, permits or invented accreditation', () => {
  const templates = registry.TEMPLATES.filter(template => template.professionKey === 'formateur');
  assert.equal(templates.length, 48);
  const copy = [...Object.values(formateurJobTemplates.pack), ...templates.flatMap(template => [template.title, template.subject, template.body, template.ctaLabel || ''])].join('\n');
  assert.doesNotMatch(copy, /permis|conduite|code de la route|routi[èe]r|chirurg|qualiopi|\bcpf\b|\brncp\b|certifi[ée]|r[ée]ussite garantie/i);
  for (const topic of [/objectifs/i, /prérequis/i, /évaluation des acquis/i, /ateliers pratiques/i, /suivi des apprenants/i, /à distance/i]) assert.match(copy, topic);
});

test('the two professions render free service entries without requiring a specialty or another profile field', () => {
  for (const definition of [chirurgienJobTemplates, formateurJobTemplates]) {
    const services = ['Prestation choisie par le professionnel', 'Autre prestation libre'];
    const context = renderer.buildDefaultContext({
      profile: { company_legal_name: 'Établissement exemple', hq_city: 'Lille' },
      business: { sector: `[[SECTOR:${definition.sector}]] ${definition.professionLabel}`, services, preferred_cta: 'site' },
      links: { site_url: 'https://example.test/contact', review_url: 'https://example.test/avis' },
    });
    assert.equal(context.metier, definition.professionLabel);
    const templates = actions.flatMap(action => registry.getTemplates(action, undefined, definition.sector, definition.professionKey));
    assert.ok(templates.some(template => template.body.includes('{{services}}')));
    for (const template of templates.filter(template => template.body.includes('{{services}}'))) {
      const rendered = renderer.renderWithContext(template.body, context);
      for (const service of services) assert.ok(rendered.includes(service), template.key);
      assert.doesNotMatch(rendered, /\{\{/);
    }
  }
});

test('existing general professions and all six driving packs keep their dedicated selection', () => {
  const existing = [
    ['hotel_restaurant', 'hotel'], ['tourisme', 'camping'], ['juridique', 'avocat'],
    ['services_entreprises', 'organisme_formation'], ['sante', 'medecin_generaliste'],
    ['formation_enseignement', 'auto_ecole'], ['formation_enseignement', 'moto_ecole'],
    ['formation_enseignement', 'bateau_ecole'], ['formation_enseignement', 'formation_poids_lourd_transport'],
    ['formation_enseignement', 'recuperation_points'], ['formation_enseignement', 'formation_code_route'],
  ] as const;
  for (const [sector, profession] of existing) for (const [index, action] of actions.entries()) {
    const templates: TemplateDef[] = registry.getTemplates(action, undefined, sector, profession);
    assert.equal(templates.length, sharedCounts[index], `${profession}/${action}`);
    assert.ok(templates.every(template => template.professionKey === profession && template.sectorCategory === sector));
  }
  for (const action of actions) assert.ok(registry.getTemplates(action, undefined, 'formation_enseignement', 'auto_ecole').some(template => /conduite|permis/i.test(template.body)), action);
});
