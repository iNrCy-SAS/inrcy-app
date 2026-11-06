import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import ts from 'typescript';
import { getJobsForSector, getServicesForSectorAndJob, findJobValueByLabel } from '../../lib/activityCatalog.ts';
import { searchActivityJobs } from '../../lib/activityJobSearch.ts';
import { decodeBusinessSector, encodeBusinessSector, inferSectorCategoryFromProfession } from '../../lib/activitySectors.ts';
import { plateforme_reservationJobTemplates as definition } from '../../lib/templates/sectors/plateformes_numeriques/plateforme_reservation.ts';

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
    assert.ok(target, `Unexpected external template dependency: ${specifier}`);
    return load(target);
  });
  return record.exports as T;
}
const shared = load<typeof import('../../lib/templates/sectors/shared.ts')>('lib/templates/sectors/shared');
const registry = load<typeof import('../../lib/messageTemplates.ts')>('lib/messageTemplates');
const directory = load<typeof import('../../lib/inrDirectoryCatalog.ts')>('lib/inrDirectoryCatalog');

test('reservation platforms keep their existing ID and eight service suggestions applicable to appointments stays and tickets', () => {
  assert.equal(definition.professionKey, 'plateforme_reservation');
  assert.equal(definition.sector, 'plateformes_numeriques');
  assert.ok(getJobsForSector(definition.sector).some(job => job.value === definition.professionKey && job.label === definition.professionLabel));
  const services = getServicesForSectorAndJob(definition.sector, definition.professionKey);
  assert.equal(services.length, 8); assert.equal(new Set(services).size, 8);
  assert.ok(services.includes('Rappels de réservation'));
  assert.ok(services.includes('Calendrier des disponibilités'));
  assert.ok(services.includes('Gestion des offres réservables'));
  assert.doesNotMatch(services.join(' '), /Rappels de rendez-vous|Planning en ligne|Espace prestataire/);
});

test('travel and ticketing aliases retain the same real catalogue selection saved profile and directory profession', () => {
  for (const name of ['Plateforme de réservation', 'Plateforme de réservation de voyages', 'Plateforme de billetterie touristique', 'Billetterie touristique en ligne']) {
    assert.equal(searchActivityJobs(name)[0]?.job, definition.professionKey, name);
    assert.equal(findJobValueByLabel(definition.sector, name), definition.professionKey, name);
    assert.equal(inferSectorCategoryFromProfession(name), definition.sector, name);
    const saved = encodeBusinessSector(definition.sector, name);
    const restored = decodeBusinessSector(saved);
    assert.equal(findJobValueByLabel(restored.sectorCategory, restored.profession), definition.professionKey);
    const listed = directory.resolveDirectoryProfession(saved);
    assert.equal(listed.catalogMatch, true); assert.equal(listed.profession, definition.professionLabel);
  }
});

test('the real forty-eight variants cover supported reservations while preserving appointment wording and canonical selectors', () => {
  const generated = shared.createJobTemplates(definition);
  assert.equal(generated.length, 48); assert.equal(new Set(generated.map(template => template.key)).size, 48);
  const bodies = generated.map(template => template.body).join('\n');
  for (const kind of ['créneaux', 'prestations', 'séjours', 'billets', 'rendez-vous']) assert.ok(bodies.includes(kind), kind);
  assert.match(definition.pack.signature, /réellement proposés/);
  assert.match(definition.pack.maintenance, /selon la réservation/);
  assert.doesNotMatch(JSON.stringify(definition.pack), /remplir leur planning|avant un rendez-vous ou pour compléter/);
  const seen = new Set<string>();
  for (const action of ['valoriser', 'avis', 'offres', 'informations', 'suivis', 'enquetes'] as const) {
    for (const channel of ['email', 'site_web', 'facebook', 'instagram', 'linkedin', 'google_business'] as const) {
      const templates = registry.getTemplates(action, undefined, definition.sector, definition.professionKey, { channel });
      assert.ok(templates.length > 0);
      for (const template of templates) {
        assert.equal(template.professionKey, definition.professionKey); assert.equal(template.sectorCategory, definition.sector);
        assert.ok(template.subject && template.body && template.intelligent); seen.add(template.key);
      }
    }
  }
  assert.deepEqual([...seen].sort(), generated.map(template => template.key).sort());
});
