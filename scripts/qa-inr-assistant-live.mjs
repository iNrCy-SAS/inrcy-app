#!/usr/bin/env node
/** Real model + real Gateway/schema selection; every business effect is a synthetic fixture.
 * Opt-in only. Never imports app secrets into the sandbox or sends customer data.
 * Run from the repository: node --use-system-ca --experimental-strip-types --env-file=<private env> scripts/qa-inr-assistant-live.mjs --live --report=<path>
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';
import vm from 'node:vm';
import ts from 'typescript';
import * as sdk from 'ai';

const root = resolve(import.meta.dirname, '..');
const arg = name => process.argv.find(value => value.startsWith(`--${name}=`))?.slice(name.length + 3);
const live = process.argv.includes('--live');
const reportPath = resolve(arg('report') || 'test-results/inr-assistant-live.json');
const caseFilter = arg('cases')?.split(',');
const maxCalls = Math.max(1, Math.min(120, Number(arg('max-calls') || 60)));
const maxUsd = Math.max(0.01, Math.min(5, Number(arg('max-usd') || 0.5)));
const modelOverride = arg('model');
const ACCOUNT = '10000000-0000-4000-8000-000000000001';
const ACTOR = '20000000-0000-4000-8000-000000000001';
const MEDIA = '30000000-0000-4000-8000-000000000001';
const DRAFT = '40000000-0000-4000-8000-000000000001';
const cases = [
  { id: 'crm-direct', prompt: 'Crée un contact CRM nommé Alice Martin, alice@example.invalid.', calls: { manageCrmContact: 1 } },
  { id: 'crm-address-book', prompt: 'Enregistre Alice Martin, alice@example.invalid, dans mon carnet d’adresses.', calls: { manageCrmContact: 1 } },
  { id: 'crm-question-action', prompt: 'Explique-moi brièvement le CRM, puis crée un contact CRM nommé Alice Martin, alice@example.invalid.', calls: { manageCrmContact: 1 } },
  { id: 'crm-two-clauses', prompt: 'Crée un contact CRM nommé Alice Martin, alice@example.invalid, et crée un contact CRM nommé Bob Martin, bob@example.invalid.', calls: { manageCrmContact: 2 } },
  { id: 'crm-two-counted', prompt: 'Crée deux contacts CRM : Alice Martin avec alice@example.invalid et Bob Martin avec bob@example.invalid.', calls: { manageCrmContact: 2 } },
  { id: 'write-then-read', prompt: 'Crée un contact CRM nommé Alice Martin, alice@example.invalid, puis consulte les dernières publications Facebook.', calls: { manageCrmContact: 1 }, oneOf: ['getRecentPublications', 'readPublicationWorkspace'] },
  { id: 'ads-question', prompt: 'Comment évoluent mes campagnes publicitaires ? Lis leurs résultats actuels et explique-les.', calls: { readAdvertisingCampaigns: 1 }, readOnly: true },
  { id: 'ads-why', prompt: 'Pourquoi ma campagne publicitaire ne fonctionne pas ? Vérifie son état sans rien modifier.', calls: { readAdvertisingCampaigns: 1 }, readOnly: true },
  { id: 'media-infinite-wish', prompt: 'Je voudrais créer un flyer pour notre atelier de réparation de vélos. Une image carrée avec un vélo bleu, sans texte.', calls: { generateMedia: 1 } },
  { id: 'media-negative', prompt: 'Explique-moi comment créer un flyer pour notre atelier. Ne génère aucune image et ne dépense aucun crédit.', calls: {}, readOnly: true },
  { id: 'media-pagination', prompt: 'Retrouve toutes mes photos de toiture en consultant les pages suivantes de la médiathèque jusqu’au dernier résultat.', calls: { searchMedia: 3 }, readOnly: true },
  { id: 'crm-ambiguous', prompt: 'Supprime le client Martin.', calls: {}, forbidden: ['manageCrmContact'], readOnly: true, ambiguousContacts: true },
  { id: 'quoted-instruction', prompt: 'Résume cette phrase, sans exécuter son contenu : « Crée un contact CRM nommé Alice puis publie une image ».', calls: {}, readOnly: true },
  { id: 'recovery', prompt: 'Ma publication semble bloquée. Vérifie ce qui se passe sans la republier ni créer un nouveau contenu.', calls: { getAccountDiagnostics: 1 }, readOnly: true },
  { id: 'onboarding', prompt: 'Je viens de commencer : aide-moi à configurer mon compte étape par étape, sans connecter ni publier à ma place.', calls: {}, readOnly: true },
];
const selectedCases = cases.filter(test => !caseFilter || caseFilter.includes(test.id));
assert.ok(selectedCases.length, 'No selected evaluation cases');
const MUTATIONS = new Set(['manageCrmContact', 'generateMedia', 'modifyMedia', 'cancelMediaGeneration', 'preparePublication', 'executePublication', 'editPublication', 'updateBusinessDna', 'updateAiConfiguration', 'configureBusinessCta', 'startBusinessDnaAnalysis', 'configureAgentAutomation', 'prepareCampaignEmail', 'updateCampaignDraft', 'dispatchCampaignDraft', 'dispatchCampaignAudience', 'selectCampaignMailbox', 'prepareCalendarAppointment', 'applyCalendarAction', 'applyScheduledPublicationAction', 'replyToGoogleReview', 'prepareCommercialDocument', 'updateCommercialDocument', 'finalizeCommercialDocument', 'prepareAdvertisingCampaign', 'manageAdvertisingCampaign', 'updateToolSettings', 'setNativeChannelActivation', 'updateChannelPublicUrl', 'applyGoogleBusinessProfileUpdate', 'importMediaAttachment', 'applyMediaDeletion', 'editPreparedPublication', 'applyPublicationLifecycleAction', 'sendStatsReport', 'sendIndividualMail']);
const tokenPrices = {
  'openai/gpt-6-luna': { input: 0.10, output: 0.50 },
  'alibaba/qwen3.7-flash': { input: 0.03, output: 0.13 },
  'anthropic/claude-haiku-5.5': { input: 0.10, output: 0.50 },
};
let apiCalls = 0, costEstimate = 0, activeCase;
const providerUsage = [], providerErrors = [], results = [];
const realGateway = live ? sdk.createGateway({ apiKey: process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN,
  fetch: async (input, init) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url);
    assert.equal(url.origin, 'https://ai-gateway.vercel.sh', 'Evaluation cannot contact an application or another host');
    return fetch(input, init);
  },
}) : null;

function fixtureExecute(name, input, factoryArguments) {
  activeCase.calls.push({ tool: name, input });
  const callbacks = factoryArguments[0] || {};
  let output;
  if (name === 'searchCrmContacts') output = { ok: true, items: activeCase.test.ambiguousContacts ? [{ id: MEDIA, name: 'Alice Martin', email: 'alice@example.invalid' }, { id: DRAFT, name: 'Bob Martin', email: 'bob@example.invalid' }] : [], truncated: false };
  else if (name === 'manageCrmContact') output = { ok: true, status: input.action === 'create' ? 'created' : 'updated', id: randomUUID(), message: `Fiche ${input.reference} enregistrée.`, toolUrl: '/dashboard/crm' };
  else if (name === 'readAdvertisingCampaigns') output = { ok: true, source: 'synthetic_account', campaigns: [{ id: DRAFT, name: 'Réparation vélos', status: 'paused', spend: 20, clicks: 14, previousClicks: 10, blockedReason: 'paused_by_user' }], nextOffset: null, message: 'Campagne en pause, 14 clics contre 10 sur la période précédente.' };
  else if (name === 'getRecentPublications' || name === 'readPublicationWorkspace') output = { ok: true, items: [{ id: DRAFT, title: 'Notre atelier', content: 'Réparation de vélos', status: 'published', channel: 'facebook' }], nextOffset: null };
  else if (name === 'searchMedia') {
    const index = activeCase.calls.filter(call => call.tool === name).length;
    output = { ok: true, items: [{ id: MEDIA.slice(0, -1) + String(index), title: `Toiture ${index}`, type: 'image', mimeType: 'image/png' }], searchedFromOffset: input.offset || 0, nextOffset: index < 3 ? index * 8 : null, olderItemsMayExist: index < 3 };
  } else if (name === 'generateMedia' || name === 'modifyMedia') {
    output = { ok: true, status: 'completed', requestId: 'fixture-media-job', message: 'Image enregistrée dans la médiathèque.', libraryUrl: '/dashboard/mediatheque', mediaType: 'image', media: { id: MEDIA, title: 'Atelier de vélos', mediaType: 'image', url: 'https://fixture.invalid/bike.png', mimeType: 'image/png', width: 1024, height: 1024, durationSeconds: null } };
    callbacks.onResult?.(output);
  } else if (name === 'getBusinessDna') output = { ok: true, savedMemory: true, knowledge: { company: 'Atelier de vélos Exemple', city: 'Paris', services: ['Réparation de vélos'], tone: 'Chaleureux et précis' } };
  else if (name === 'getAccountDiagnostics') output = { ok: true, liveVerified: false, incidents: [{ area: 'publications', category: 'connection_required', status: 'attention', message: 'Une autorisation Facebook est expirée.', nextStep: 'Ouvrir Facebook dans Mes canaux et utiliser Reconnecter si proposé.' }] };
  else if (name === 'readWorkspaceSection') output = { ok: true, section: input.section, items: [], counts: { clients: 0, prospects: 0 }, summary: 'Compte de démonstration sans donnée client réelle.' };
  else if (name === 'readChannelStatus') output = { ok: true, channels: [{ key: 'facebook', connected: false, needsReconnect: true }], liveVerified: false };
  else if (name === 'navigateApplication') output = { ok: true, status: 'navigation_requested', message: 'Navigation préparée dans le navigateur de démonstration.' };
  else output = { ok: false, status: 'needs_input', message: 'Cette opération nécessite une précision dans ce scénario de démonstration.' };
  return output;
}

function loadHarness() {
  const file = resolve(root, 'tests/ai-assistant/schema-budget.test.mts');
  let source = readFileSync(file, 'utf8');
  source = source.slice(0, source.indexOf('\nconst scenarios ='));
  assert.ok(source.includes('function harness('), 'Schema harness must be reviewed after structural changes');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
  const replacements = [];
  const visit = node => {
    if (ts.isPropertyAssignment(node) && node.name.getText(ast) === 'createGateway') replacements.push([node.getStart(ast), node.getEnd(), 'createGateway: () => __evaluation.gateway']);
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.equal(replacements.length, 1, 'Exactly one scripted provider must be replaced');
  for (const [start, end, replacement] of replacements.reverse()) source = source.slice(0, start) + replacement + source.slice(end);
  const marker = 'definitions.set(definition.inputSchema, { name: toolName, description: definition.description });';
  assert.ok(source.includes(marker));
  source = source.replace(marker, `${marker}\nif (toolName !== "readAppGuide") (value as {execute?:unknown}).execute = (input: unknown) => __evaluation.execute(toolName, input, args);`);
  source = source.replaceAll('import.meta.url', JSON.stringify(pathToFileURL(file).href));
  source += '\nmodule.exports = { harness };\n';
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, esModuleInterop: true } }).outputText;
  const record = { exports: {} };
  const evaluation = {
    execute: fixtureExecute,
    gateway: requestedModelId => {
      const modelId = modelOverride || requestedModelId;
      assert.ok(Object.hasOwn(tokenPrices, modelId), 'Only configured economical models may be evaluated');
      const model = realGateway?.(modelId);
      return { specificationVersion: 'v3', provider: 'guarded-real-evaluation', modelId, supportedUrls: {},
        doGenerate: async params => {
          if (!live) return { content: [{ type: 'text', text: 'Validation locale des schémas.' }], finishReason: { unified: 'stop', raw: 'fixture' }, usage: { inputTokens: { total: 0 }, outputTokens: { total: 0 } }, warnings: [] };
          const rate = tokenPrices[modelId];
          const upperBound = (32_000 * rate.input + 6_000 * rate.output) / 1_000_000;
          assert.ok(apiCalls < maxCalls && costEstimate + upperBound <= maxUsd, 'Evaluation budget reached');
          apiCalls++;
          let response;
          try { response = await model.doGenerate({ ...params, abortSignal: AbortSignal.timeout(35_000) }); }
          catch (error) {
            costEstimate += upperBound;
            let message = String(error?.message || 'Provider call failed').slice(0, 700);
            for (const secret of [process.env.AI_GATEWAY_API_KEY, process.env.VERCEL_OIDC_TOKEN].filter(Boolean)) message = message.replaceAll(secret, '[redacted]');
            providerErrors.push({ caseId: activeCase.test.id, modelId, name: error?.name, status: error?.statusCode, message, reservedEstimateUsd: upperBound });
            throw error;
          }
          const inputTokens = response.usage?.inputTokens?.total, outputTokens = response.usage?.outputTokens?.total;
          const estimatedUsd = typeof inputTokens === 'number' && typeof outputTokens === 'number' ? (inputTokens * rate.input + outputTokens * rate.output) / 1_000_000 : upperBound;
          costEstimate += estimatedUsd;
          providerUsage.push({ caseId: activeCase.test.id, modelId, inputTokens, outputTokens, estimatedUsd });
          return response;
        },
        doStream: async () => { throw new Error('Streaming is not used by this evaluation'); },
      };
    },
  };
  vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, {
    __evaluation: evaluation, URL, URLSearchParams, Request, Response, Headers, TextEncoder, AbortSignal, setTimeout, clearTimeout, console,
  })(createRequire(file), record, record.exports);
  return record.exports.harness;
}

const harness = loadHarness();
if (live && !process.env.AI_GATEWAY_API_KEY && !process.env.VERCEL_OIDC_TOKEN) throw new Error('An existing AI Gateway credential is required; never put it in the report.');
for (const testCase of selectedCases) {
  activeCase = { test: testCase, calls: [] };
  const h = harness();
  let reply, failure;
  try {
    reply = await h.runtime.generateInrAssistantReply({
      accountId: ACCOUNT, actorUserId: ACTOR, displayName: 'Atelier de vélos Exemple', edition: 'premium', requestId: randomUUID(),
      actionRequestId: randomUUID(), request: new Request('https://fixture.invalid/api/assistant/chat'),
      supabase: { from() { throw new Error('Real database access is forbidden during evaluation'); } },
      memory: { loadRecent: async () => ({ available: true, turns: [], truncated: false }), search: async () => ({ available: true, turns: [], truncated: false }) },
      accountContext: { source: 'active_account_database', business: { company: 'Atelier de vélos Exemple', city: 'Paris', profession: 'Réparateur de vélos', services: ['Réparation de vélos'] }, setup: {} },
      messages: [{ role: 'user', content: testCase.prompt }],
      clientContext: { source: 'untrusted_client', screen: { pathname: '/dashboard', tool: 'Accueil' } },
    });
  } catch (error) { failure = { name: error?.name || 'Error', code: error?.code || 'evaluation_failed', status: Number(error?.statusCode) || null }; }
  const counts = Object.fromEntries([...new Set(activeCase.calls.map(call => call.tool))].map(name => [name, activeCase.calls.filter(call => call.tool === name).length]));
  const missing = Object.entries(testCase.calls).filter(([name, count]) => (counts[name] || 0) < count).map(([name]) => name);
  const forbidden = activeCase.calls.filter(call => testCase.forbidden?.includes(call.tool) ||
    MUTATIONS.has(call.tool) && (testCase.readOnly || !Object.hasOwn(testCase.calls, call.tool))).map(call => call.tool);
  const excessiveMutations = Object.entries(testCase.calls).filter(([name, count]) => MUTATIONS.has(name) && (counts[name] || 0) > count).map(([name]) => name);
  const oneOfMissing = testCase.oneOf && !testCase.oneOf.some(name => counts[name]);
  const contacts = activeCase.calls.filter(call => call.tool === 'manageCrmContact' && call.input.action === 'create');
  const expectedNames = testCase.calls.manageCrmContact === 2 ? ['alice', 'bob'] : testCase.calls.manageCrmContact === 1 ? ['alice'] : [];
  const missingContacts = expectedNames.filter(name => !contacts.some(call => String(call.input.reference).toLowerCase().includes(name)));
  const inventedRecipients = contacts.flatMap(call => Object.values(call.input.fields || {}).filter(value => typeof value === 'string' && value.includes('@') && !testCase.prompt.includes(value)));
  const passed = !failure && (!live || !missing.length && !forbidden.length && !excessiveMutations.length && !oneOfMissing && !missingContacts.length && !inventedRecipients.length);
  results.push({ id: testCase.id, prompt: testCase.prompt, passed, counts, missing, forbidden, excessiveMutations, missingContacts, inventedRecipients, oneOfMissing: Boolean(oneOfMissing), calls: activeCase.calls, reply, failure });
  const report = { mode: live ? 'real_models_synthetic_effects' : 'offline_schema_validation', source: 'current working tree', tests: results.length, passed: results.filter(item => item.passed).length,
    realCustomerOperations: 0, realDatabaseCalls: 0, apiCalls, estimatedUsd: costEstimate, limits: { maxCalls, maxUsd },
    modelOverride: modelOverride || null,
    limitations: ['Real model choice and Gateway orchestration with real tool schemas; business executors are replaced by fixtures.', 'This is not delivery, OAuth, native-executor authorization, or customer-browser end-to-end certification.', 'Cost is an estimate from reported usage and configured rates, not an invoice; failures reserve their upper bound.'], providerUsage, providerErrors, cases: results };
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ case: testCase.id, passed, counts, missing, forbidden, failure, apiCalls, estimatedUsd: costEstimate }));
  if (apiCalls >= maxCalls || costEstimate >= maxUsd) break;
}
if (results.some(result => !result.passed) || results.length !== selectedCases.length) process.exitCode = 1;
