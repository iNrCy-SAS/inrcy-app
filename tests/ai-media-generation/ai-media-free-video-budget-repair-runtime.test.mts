import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import ts from 'typescript';
import * as prompts from '../../lib/aiMediaFreeGenerationPrompt.ts';
import * as contracts from '../../lib/aiMediaGenerationContracts.ts';
import * as catalog from '../../lib/aiMediaModelCatalog.ts';
import * as timeline from '../../lib/aiMediaVideoTimeline.ts';
import * as boundary from '../../lib/aiMediaVideoProviderContract.ts';
import * as globalRules from '../../lib/aiMediaGlobalConstraints.ts';
import * as characterVoices from '../../lib/aiMediaCharacterVoices.ts';
import * as sensitive from '../../lib/aiMediaSensitiveText.ts';
import * as types from '../../lib/aiVideoProviderTypes.ts';
import { bufferFromUint8ArrayView } from '../../lib/aiMediaBuffer.ts';
import { normalizeAiJsonResponseBeforeValidation } from '../../lib/aiJsonResponseNormalization.ts';
import { assertAiJsonMatchesSchema } from '../../lib/aiJsonSchemaValidation.ts';
import type { AiGenerateJsonOptions } from '../../lib/aiGatewayClient.ts';
import type { NormalizedAiGenerationProfile } from '../../lib/aiGenerationProfile.ts';

const image = { mimeType: 'image/png', data: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZO3cAAAAASUVORK5CYII=', role: 'character', usage: 'required', voiceMode: 'ai' };
const brief = 'Une équipe entretient un jardin ; conserver les trois personnes et la haie. '.repeat(6).slice(0, 400);
function request(engine: 'wan27' | 'wan3', overrides: Record<string, unknown> = {}) {
  return contracts.normalizeAiMediaGenerationRequest({ requestId: `video-budget-${engine}`, source: 'studio', operation: 'generate',
    creationMode: 'free', kind: 'video', format: 'story', videoEngine: engine, durationSeconds: engine === 'wan27' ? 15 : 30,
    freePrompt: brief, useBusinessDna: true, sceneMode: 'single', withNarration: false, withMusic: false,
    teamVideoSpeechMode: 'characters', identityConsent: true, teamVideoProviderConsent: engine,
    inspirationImages: [1, 2, 3].map(characterIndex => ({ ...image, characterIndex })), ...overrides });
}
function profile(size = 600) {
  return { business: { companyName: 'Atelier Test', services: [], strengths: [], interventionZones: [], customerTypologies: [] },
    memory: { targetAudiences: [], differentiators: [], recentNewsItems: [] },
    preferences: { language: 'fr', customInstructions: `CONSigne_IMPORTANTE ${'I'.repeat(Math.max(0, size - 21))}`,
      forbiddenInstructions: `INTERDICTION_EXACTE ${'P'.repeat(Math.max(0, size - 21))}` } } as unknown as NormalizedAiGenerationProfile;
}
function load<T>(file: string, modules: Record<string, unknown>): T {
  const source = ts.transpileModule(readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true,
  } }).outputText;
  const record = { exports: {} }; const native = createRequire(import.meta.url);
  new Function('module', 'exports', 'require', source)(record, record.exports, (name: string) => {
    if (name.startsWith('node:')) return native(name);
    assert.ok(Object.hasOwn(modules, name), `Unexpected fixture dependency: ${name}`); return modules[name];
  });
  return record.exports as T;
}
function planner(responses: Array<Record<string, unknown>>) {
  const calls: Array<{ input: Record<string, unknown>; deadline: number | undefined }> = [];
  const runtime = load<typeof import('../../lib/aiMediaFreeGenerationPlan.ts')>('lib/aiMediaFreeGenerationPlan.ts', {
    'server-only': {}, './aiMediaGlobalConstraints.ts': globalRules,
    '@/lib/aiGatewayClient': { aiGenerateJSON: async (input: AiGenerateJsonOptions) => {
      let last: unknown;
      for (const response of responses) {
        calls.push({ input: JSON.parse(input.input!), deadline: input.deadlineAt });
        try { const normalized = normalizeAiJsonResponseBeforeValidation(response, input.normalizeResponseBeforeValidation);
          assertAiJsonMatchesSchema(normalized, input.responseSchema!.schema); return normalized;
        } catch (error) { last = error; }
      }
      throw last;
    } }, '@/lib/aiEnginePreference': { getAiEngineOption: () => ({ model: 'local-only-planner' }) },
    '@/lib/aiMediaGenerationContracts': contracts, '@/lib/aiMediaVideoTimeline': timeline, '@/lib/aiMediaFreeGenerationPrompt': prompts,
  });
  return { runtime, calls };
}
function gateway() {
  let reservations = 0, submissions = 0;
  const noOperation = () => assert.fail('No network, upload or media operation is allowed in this fixture');
  const runtime = load<typeof import('../../lib/aiVideoProviderGateway.ts')>('lib/aiVideoProviderGateway.ts', {
    'server-only': {}, ai: { createDownload: () => noOperation, experimental_generateVideo: () => { submissions++; return noOperation(); } },
    '@/lib/aiGatewayAccountGuard': { reserveAiGatewayAccountAttempt: () => { reservations++; return noOperation(); },
      commitAiGatewayAccountAttempt: noOperation, rollbackAiGatewayAccountAttempt: noOperation, recordAiGatewayAccountFailure: noOperation },
    './aiMediaBuffer.ts': { bufferFromUint8ArrayView }, './aiMediaFreeGenerationPrompt.ts': prompts,
    '@/lib/aiMediaGenerationContracts': contracts, './aiMediaModelCatalog.ts': catalog, './aiMediaVideoTimeline.ts': timeline,
    './aiMediaCharacterVoices.ts': characterVoices, './aiMediaVideoProviderContract.ts': boundary,
    '@/lib/aiMediaSensitiveText': sensitive, '@/lib/aiVideoProviderTypes': types,
    './aiMediaVideoContinuity.ts': { extractAiMediaVideoContinuityFrame: noOperation },
    './aiMediaVideoTemporaryImages.ts': { createAiMediaVideoTemporaryImageStore: noOperation },
    '@/lib/aiVideoProviderGoogleVeo': { buildGoogleVideoScenePrompt: noOperation, buildGoogleVideoTeamSpeechDirection: () => '' },
  });
  return { runtime, counts: () => ({ reservations, submissions }) };
}
function provider(input: contracts.AiMediaGenerationRequest, plan: types.AiVideoProviderGenerationArgs['plan'], rules: string) {
  const canonicalPrompt = 'Local synthetic canonical prompt';
  return { accountId: 'local-synthetic-account', request: input, plan, contentLanguage: 'fr', brandColors: [], creativeBrief: '', profession: '',
    canonicalPrompt, canonicalPromptSha256: boundary.hashAiMediaCanonicalPrompt(canonicalPrompt), identityTeamProviderEgressConsent: input.videoEngine,
    providerContract: boundary.buildAiMediaVideoProviderContract({ request: input, durationSeconds: 8, brandColors: [], globalMediaConstraints: rules }),
    businessDnaDirection: 'Use exact requested business facts from the creative direction only; no automatic contact text, slogans, captions or subtitles. Explicit brief overrides business defaults.',
  } as types.AiVideoProviderGenerationArgs;
}

for (const engine of ['wan27', 'wan3'] as const) test(`${engine}: a 400-character visual brief with three characters fits the actual final engine ceiling on every clip`, async () => {
  const input = request(engine); const active = profile(800);
  assert.equal(input.freePrompt!.length, 400);
  const originalImages = JSON.stringify(input.inspirationImages);
  const durations = timeline.getAiMediaVideoSegmentDurations(input.durationSeconds!, engine, input.videoResolution, input.sceneMode);
  const response = { direction: 'D'.repeat(1_200), scenes: durations.map(() => ({ visualBrief: 'S'.repeat(300), spokenLine: 'Notre équipe soigne chaque jardin.' })) };
  const concise = { direction: 'Les trois personnes entretiennent la haie du jardin, ensemble, dans une lumière naturelle.',
    scenes: durations.map(() => ({ visualBrief: 'Les trois personnes taillent la haie ensemble.', spokenLine: 'Notre équipe soigne chaque jardin.' })) };
  const h = planner([response, concise]);
  const plan = await h.runtime.prepareAiMediaFreeCreativePlan({ accountId: 'synthetic-only', request: input, profile: active });
  assert.equal(h.calls[0].input.brief, brief);
  assert.ok(h.calls.length <= 2);
  if (engine === 'wan27') {
    assert.equal(h.calls.length, 2, 'The over-budget generated direction is rewritten inside the same bounded attempt');
    assert.ok(h.calls[1].input.rewrite_direction);
    assert.equal(h.calls[1].input.brief, brief);
    assert.equal(h.calls[0].deadline, h.calls[1].deadline);
  }
  const rules = globalRules.buildAiMediaGlobalConstraints(active);
  // Wan3 without supplied voices keeps the existing precomposed group path;
  // the three originals above remain intact in the saved Studio request.
  const transportInput = engine === 'wan3' ? { ...input, inspirationImages: [input.inspirationImages[0]] } : input;
  const args = provider(transportInput, plan, rules); const transport = gateway();
  if (engine === 'wan3') {
    args.identityTeamPrecomposed = true; args.identityTeamMemberCount = 3;
    args.providerContract = boundary.buildAiMediaVideoProviderContract({ request: transportInput, durationSeconds: 30, brandColors: [], globalMediaConstraints: rules,
      identityTeamPrecomposed: true, identityTeamMemberCount: 3 });
  }
  for (const [index] of durations.entries()) {
    const output = transport.runtime.buildGatewayAiVideoRequest(args, index, index ? { data: 'continuity-placeholder', mimeType: 'image/jpeg' } : undefined,
      undefined, [null, null, null], index ? 'https://provider-input.invalid/continuity.jpg' : undefined);
    const text = typeof output.prompt === 'string' ? output.prompt : output.prompt.text;
    assert.ok(text.length <= prompts.getAiMediaFreeVideoPromptMaxCharacters(engine));
    assert.ok(text.includes(rules), 'Every exact account rule survives compaction');
    assert.match(text, /Notre équipe soigne chaque jardin\./);
    if (engine === 'wan27') {
      assert.match(text, /Image 1.*character1/);
      assert.match(text, /Image 2.*character2/);
      assert.match(text, /Image 3.*character3/);
    } else assert.match(text, /group=3 adults, each once/);
    if (index) assert.match(text, /Continue.*prior final frame|Continue from the supplied prior final frame/);
  }
  assert.equal(JSON.stringify(input.inspirationImages), originalImages);
  assert.deepEqual(transport.counts(), { reservations: 0, submissions: 0 });
});

test('the longest allowed account rules reduce generated scene and direction budgets without removing one rule', async () => {
  const input = request('wan27'); const active = profile(1_200);
  const rules = globalRules.buildAiMediaGlobalConstraints(active);
  const budget = prompts.getAiMediaFreeVideoCreativeBudget({ request: input, globalMediaConstraints: rules });
  assert.ok(budget.sceneMaxCharacters < 300);
  const h = planner([{ direction: 'Trois personnes entretiennent ensemble une haie dans le jardin.', scenes: [
    { visualBrief: 'Trois personnes taillent la haie.', spokenLine: 'Notre équipe prend soin du jardin.' },
    { visualBrief: 'Les mêmes personnes terminent la haie.', spokenLine: 'Un jardin entretenu avec attention.' },
  ] }]);
  const plan = await h.runtime.prepareAiMediaFreeCreativePlan({ accountId: 'synthetic-only', request: input, profile: active });
  const args = provider(input, plan, rules);
  for (const [index, duration] of timeline.getAiMediaVideoSegmentDurations(15, 'wan27').entries()) {
    const prompt = prompts.buildAiMediaFreeVideoScenePrompt(args, index, duration, { continuationFrame: index > 0 });
    assert.ok(prompt.includes(rules));
    assert.ok(prompt.length + prompts.buildAiMediaVideoCharacterReferenceDirection(input).length <= 5_000);
  }
});

test('a generated 1,200-character direction plus exact visual copy no longer becomes a false duration failure', async () => {
  const visible = 'EXACT'.repeat(60);
  const input = request('wan3', { teamVideoSpeechMode: 'voiceover', withNarration: false, useBusinessDna: false,
    freePrompt: `Afficher exactement «${visible}». Montrer le jardin.` });
  const h = planner([{ direction: 'D'.repeat(1_200), scenes: ['Le jardin apparaît dans la lumière.'] }]);
  const plan = await h.runtime.prepareAiMediaFreeCreativePlan({ accountId: 'synthetic-only', request: input, profile: profile(20) });
  assert.ok(plan.subline.length > 1_400);
  assert.ok(plan.subline.includes(visible));
  assert.doesNotThrow(() => prompts.buildAiMediaFreeVideoScenePrompt(provider(input, plan, globalRules.buildAiMediaGlobalConstraints(profile(20))), 0, 30));
});

test('unavoidable mandatory overflow refuses the whole request before a provider reservation or video submission', async () => {
  const input = request('wan27'); const h = gateway();
  const rules = 'PROHIBITION_EXACTE '.repeat(500);
  const args = provider(input, { headline: '', subline: 'Une direction concise.', companyName: '', cta: '', scenes: [
    { visualBrief: 'Les personnes entretiennent le jardin.', spokenLine: 'Nous soignons le jardin.' },
    { visualBrief: 'La haie est entretenue.', spokenLine: 'Notre équipe vous accompagne.' },
  ] } as types.AiVideoProviderGenerationArgs['plan'], '');
  args.providerContract = { ...args.providerContract, globalMediaConstraints: rules,
    sha256: boundary.hashAiMediaVideoProviderContract({ ...args.providerContract, globalMediaConstraints: rules }) };
  await assert.rejects(h.runtime.createGatewayAiVideoProvider('wan27').generate(args), /instruction_contract_too_long/);
  assert.deepEqual(h.counts(), { reservations: 0, submissions: 0 });
});

test('every Gateway engine validates the final transported prompt, including Flash wrapper and character suffixes', () => {
  const h = gateway();
  for (const model of catalog.AI_MEDIA_VIDEO_MODELS.filter(model => model.transport === 'gateway')) {
    const duration = catalog.getAiMediaVideoNativeDurations(model.id, model.defaultResolution).find(value => value >= 4)!;
    const input = contracts.normalizeAiMediaGenerationRequest({ requestId: `final-cap-${model.id}`, source: 'studio', operation: 'generate', creationMode: 'free', kind: 'video',
      videoEngine: model.id, videoResolution: model.defaultResolution, durationSeconds: duration, sceneMode: 'single', format: 'story',
      freePrompt: 'Un objet tourne dans un jardin lumineux.', withNarration: false, withSubtitles: false,
      inspirationImages: [{ ...image, role: 'product', characterIndex: undefined }] });
    const plan = { headline: '', subline: 'L’objet tourne doucement dans le jardin.', companyName: '', cta: '',
      scenes: [{ eyebrow: '', title: '', body: '', spokenLine: '', spokenReply: '', visualBrief: 'L’objet tourne dans la lumière.', layout: 'hero' as const }] };
    const args = provider(input, plan, '');
    const output = h.runtime.buildGatewayAiVideoRequest(args);
    const text = typeof output.prompt === 'string' ? output.prompt : output.prompt.text;
    const limit = model.id === 'wan-flash' ? 1_500 : prompts.getAiMediaFreeVideoPromptMaxCharacters(model.id);
    assert.ok(text.length <= limit, `${model.id}: ${text.length}/${limit}`);
    const rules = 'R'.repeat(limit);
    args.providerContract = { ...args.providerContract, globalMediaConstraints: rules,
      sha256: boundary.hashAiMediaVideoProviderContract({ ...args.providerContract, globalMediaConstraints: rules }) };
    assert.throws(() => h.runtime.buildGatewayAiVideoRequest(args), /instruction_contract_too_long|consigne complète dépasse/, model.id);
  }
  assert.deepEqual(h.counts(), { reservations: 0, submissions: 0 });
});

test('a second continuity clip is compacted too and every clip is checked before a provider reservation', async () => {
  const input = request('wan27'); const h = gateway();
  const rules = globalRules.buildAiMediaGlobalConstraints(profile(500));
  const plan = { headline: '', subline: 'D'.repeat(1_200), companyName: '', cta: '', scenes: [
    { eyebrow: '', title: '', body: '', spokenReply: '', layout: 'hero' as const, visualBrief: 'Les personnes commencent la taille.', spokenLine: 'Nous entretenons votre jardin.' },
    { eyebrow: '', title: '', body: '', spokenReply: '', layout: 'hero' as const, visualBrief: 'Les mêmes personnes poursuivent la taille.', spokenLine: 'Chaque haie reçoit notre attention.' },
  ] };
  const args = provider(input, plan, rules);
  const output = h.runtime.buildGatewayAiVideoRequest(args, 1, { data: 'frame-placeholder', mimeType: 'image/jpeg' }, undefined, [null, null, null], 'https://provider-input.invalid/continuity.jpg');
  const text = typeof output.prompt === 'string' ? output.prompt : output.prompt.text;
  assert.ok(text.length <= 5_000);
  assert.match(text, /Continue supplied prior final frame/);
  assert.ok(text.includes(rules));
  plan.scenes[1].visualBrief = 'S'.repeat(5_000);
  await assert.rejects(h.runtime.createGatewayAiVideoProvider('wan27').generate(args), /instruction_contract_too_long/);
  assert.deepEqual(h.counts(), { reservations: 0, submissions: 0 });
});

test('Flash measures its real 1,500-character wire format and rewrites ACTION before both native clips', async () => {
  const visual = 'Un artisan prépare un jardin et entretient une haie. '.repeat(12).slice(0, 500);
  const input = contracts.normalizeAiMediaGenerationRequest({ requestId: 'flash-action-budget', source: 'studio', operation: 'generate', creationMode: 'free', kind: 'video',
    format: 'landscape', videoEngine: 'wan-flash', durationSeconds: 30, sceneMode: 'single', freePrompt: visual,
    useBusinessDna: false, withNarration: false, withMusic: false, teamVideoSpeechMode: 'voiceover',
    inspirationImages: [{ mimeType: 'image/png', data: 'A'.repeat(64), role: 'product', usage: 'required' }] });
  const active = profile(0); active.preferences.customInstructions = 'Quiet.'; active.preferences.forbiddenInstructions = 'No logos.';
  const rules = globalRules.buildAiMediaGlobalConstraints(active);
  const budget = prompts.getAiMediaFreeVideoCreativeBudget({ request: input, globalMediaConstraints: rules });
  assert.ok(budget.sceneMaxCharacters >= 40 && budget.sceneMaxCharacters < 100);
  const action = 'Un artisan taille la haie.';
  const h = planner([
    { direction: 'L’artisan entretient le jardin.', scenes: ['S'.repeat(300), 'S'.repeat(300)] },
    { direction: 'L’artisan entretient le jardin.', scenes: [action, action] },
  ]);
  const plan = await h.runtime.prepareAiMediaFreeCreativePlan({ accountId: 'synthetic-flash', request: input, profile: active });
  assert.equal(h.calls.length, 2);
  assert.equal(h.calls[0].deadline, h.calls[1].deadline);
  assert.equal(h.calls[1].input.brief, visual);
  assert.ok(h.calls[1].input.rewrite_direction);
  const args = provider(input, plan, rules); const transport = gateway();
  for (const index of [0, 1]) {
    const output = transport.runtime.buildGatewayAiVideoRequest(args, index, index ? { mimeType: 'image/jpeg', data: 'continuity-placeholder' } : undefined);
    const text = typeof output.prompt === 'string' ? output.prompt : output.prompt.text;
    assert.ok(text.length <= 1_500);
    assert.ok(text.includes(`USER: ${visual}`));
    assert.ok(text.includes(rules));
    assert.ok(text.includes(`ACTION: ${action}`));
    assert.ok(!text.includes('…'), 'The rewritten complete sentence is transmitted without a head/tail slice');
    assert.doesNotMatch(text, /PARAMS:/);
    if (index) assert.match(text, /Continue final frame; same cast\/place; no restart/);
  }
  assert.deepEqual(transport.counts(), { reservations: 0, submissions: 0 });
  active.preferences.forbiddenInstructions = 'No logos. '.repeat(100);
  const blocked = planner([{ direction: 'Ne doit pas être appelé.', scenes: [action, action] }]);
  await assert.rejects(blocked.runtime.prepareAiMediaFreeCreativePlan({ accountId: 'synthetic-flash', request: input, profile: active }), /instruction_contract_too_long/);
  assert.equal(blocked.calls.length, 0, 'An irreducible mandatory floor cannot trigger another paid preparation');
});
