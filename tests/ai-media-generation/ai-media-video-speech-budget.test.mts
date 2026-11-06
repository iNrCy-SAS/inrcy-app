import assert from 'node:assert/strict';
import test from 'node:test';
import { AI_MEDIA_AVAILABLE_VIDEO_MODELS } from '../../lib/aiMediaModelCatalog.ts';
import { getAiMediaVideoDurationSceneOptions } from '../../lib/aiMediaVideoTimeline.ts';
import { getAiMediaVisualBriefMaxChars, getAiMediaVideoSpeechState, getAiMediaFreeSpeechBudget, detectAiMediaVideoVisualBriefSpeech } from '../../lib/aiMediaVideoSpeechBudget.ts';
import { normalizeAiMediaGenerationRequest, normalizeAiMediaSpokenScript } from '../../lib/aiMediaGenerationContracts.ts';
import { getAiMediaGenerationPublicError } from '../../lib/aiMediaGenerationPublicErrors.ts';

const base = { kind: 'video', creationMode: 'free', videoEngine: 'veo', durationSeconds: 8, sceneMode: 'single', teamVideoSpeechMode: 'characters', withNarration: false } as const;
const request = (overrides: Record<string, unknown> = {}) => normalizeAiMediaGenerationRequest({ requestId: 'speech-budget-boundary-test', source: 'studio', operation: 'generate',
  format: 'landscape', freePrompt: 'Un atelier filmé en lumière naturelle.', ...base, ...overrides });

test('video visual briefs stop at 500 independently of unchanged image and guided-image budgets', () => {
  assert.equal(getAiMediaVisualBriefMaxChars('video', 'free'), 500);
  assert.equal(getAiMediaVisualBriefMaxChars('video', 'guided'), 500);
  assert.equal(getAiMediaVisualBriefMaxChars('image', 'free'), 4000);
  assert.equal(getAiMediaVisualBriefMaxChars('image', 'guided'), 1600);
  assert.equal(request({ freePrompt: 'a'.repeat(500), spokenScript: 'Bonjour.' }).freePrompt, 'a'.repeat(500));
  assert.throws(() => request({ freePrompt: 'a'.repeat(501) }), /500/);
  assert.equal(request({ kind: 'image', videoEngine: undefined, durationSeconds: undefined, freePrompt: 'a'.repeat(4000) }).freePrompt?.length, 4000);
  assert.throws(() => request({ kind: 'image', durationSeconds: undefined, freePrompt: 'a'.repeat(4001) }), /4.?000/);
  assert.throws(() => request({ creationMode: 'guided', idea: 'a'.repeat(501) }), /500/);
  const automated = request({ source: 'booster', creationMode: 'guided', idea: 'a'.repeat(800), aiInstruction: '' });
  assert.equal(automated.idea, 'a'.repeat(800), 'the Studio human brief cap never truncates or rejects an Agent publication used as internal video context');
});

test('native characters use their actual duration even when narration is disabled and no exact text is shortened', () => {
  const fits = Array.from({ length: 14 }, () => 'mot').join(' ');
  const accepted = getAiMediaVideoSpeechState({ ...base, spokenScript: fits });
  assert.equal(accepted.mode, 'characters'); assert.equal(accepted.maxUnits, 14); assert.equal(accepted.units, 14);
  assert.equal(accepted.issue, null); assert.equal(accepted.script, fits);
  assert.equal(request({ spokenScript: fits }).spokenScript, fits);
  const tooLong = `${fits} autre`;
  const refused = getAiMediaVideoSpeechState({ ...base, spokenScript: tooLong });
  assert.equal(refused.script, tooLong); assert.equal(refused.issue?.code, 'AI_MEDIA_EXACT_DIALOGUE_TOO_LONG');
  assert.throws(() => request({ spokenScript: tooLong }), /AI_MEDIA_EXACT_DIALOGUE_TOO_LONG/);
});

test('every available engine uses its real duration/scene options and aggregates exactly those clip budgets', () => {
  for (const model of AI_MEDIA_AVAILABLE_VIDEO_MODELS) for (const option of getAiMediaVideoDurationSceneOptions(model.id, model.defaultResolution)) {
    const state = getAiMediaVideoSpeechState({ ...base, videoEngine: model.id, videoResolution: model.defaultResolution,
      durationSeconds: option.durationSeconds, sceneMode: option.sceneMode, spokenScript: 'Bonjour à tous.' });
    assert.equal(state.segmentBudgets.length, option.sceneCount, `${model.id}/${option.durationSeconds}/${option.sceneMode}`);
    assert.equal(state.segmentBudgets.reduce((sum, segment) => sum + segment.durationSeconds, 0), option.durationSeconds);
    assert.equal(state.maxUnits, state.segmentBudgets.reduce((sum, segment) => sum + segment.maxUnits, 0));
    assert.equal(state.segmentBudgets.map(segment => segment.script).join(''), state.script);
    assert.equal(state.issue, null, `${model.id}/${option.durationSeconds}/${option.sceneMode}`);
  }
  const invalid = getAiMediaVideoSpeechState({ ...base, durationSeconds: 7 });
  assert.equal(invalid.issue?.code, 'AI_MEDIA_VIDEO_DURATION_INVALID');
});

test('Chinese, Japanese and Thai count spoken characters and preserve original non-Latin copy and spacing', () => {
  for (const script of ['你好，欢迎来到我的工作室。', 'こんにちは、私の工房へようこそ。', 'ยินดีต้อนรับ']) {
    const exact = `  ${script}\n`;
    const state = getAiMediaVideoSpeechState({ ...base, spokenScript: exact });
    assert.equal(state.unit, 'caractères prononcés');
    assert.equal(state.units, Array.from(exact.replace(/[^\p{L}\p{N}]/gu, '')).length);
    assert.equal(state.script, exact); assert.equal(state.issue, null);
    assert.equal(request({ spokenScript: exact }).spokenScript, exact);
  }
  const script = '你'.repeat(43);
  assert.equal(getAiMediaFreeSpeechBudget(8, 'zh', script).maxUnits, 42);
  assert.equal(getAiMediaVideoSpeechState({ ...base, spokenScript: script }).issue?.code, 'AI_MEDIA_EXACT_DIALOGUE_TOO_LONG');
});

test('dedicated and legacy exact narration/dialogue share budgets while explicit silence never revives an old quote', () => {
  const script = 'Bonjour '.repeat(15).trim();
  const narration = getAiMediaVideoSpeechState({ ...base, teamVideoSpeechMode: 'voiceover', withNarration: true, freePrompt: `Un atelier. Voix off : « ${script} »` });
  assert.equal(narration.issue?.code, 'AI_MEDIA_EXACT_NARRATION_TOO_LONG');
  const characters = getAiMediaVideoSpeechState({ ...base, freePrompt: `Un homme dit « ${script} »` });
  assert.equal(characters.issue?.code, 'AI_MEDIA_EXACT_DIALOGUE_TOO_LONG');
  const silent = getAiMediaVideoSpeechState({ ...base, spokenScript: '', freePrompt: `Un homme dit « ${script} »` });
  assert.equal(silent.mode, 'silent'); assert.equal(silent.script, ''); assert.equal(silent.issue, null);
  const kept = '  Salut !\n';
  assert.equal(getAiMediaVideoSpeechState({ ...base, spokenScript: kept, freePrompt: `Un homme dit « ${script} »` }).script, kept);
  const longTechnical = 'x'.repeat(4000);
  assert.equal(normalizeAiMediaSpokenScript(longTechnical), longTechnical, 'technical parsing remains independent from natural speech validation');
  assert.equal(getAiMediaVideoSpeechState({ ...base, spokenScript: longTechnical + 'x' }).issue?.code, 'AI_MEDIA_SPOKEN_SCRIPT_TOO_LONG');
});

test('speech warnings identify speech markers without misclassifying visual quotations or pronunciation guides', () => {
  assert.equal(detectAiMediaVideoVisualBriefSpeech('Le personnage dit « Bonjour tout le monde. »')?.script, 'Bonjour tout le monde.');
  assert.equal(detectAiMediaVideoVisualBriefSpeech('Voix off : « Bienvenue dans notre atelier. »')?.mode, 'voiceover');
  assert.ok(detectAiMediaVideoVisualBriefSpeech('La femme dit : bonjour tout le monde.'));
  assert.equal(detectAiMediaVideoVisualBriefSpeech('Un homme parle devant la caméra.'), null);
  for (const brief of ['Une enseigne avec le texte « Bienvenue ».', 'La pancarte dit « Bonjour ».', 'Une pancarte dit : «Bienvenue au jardin».',
    'Un panneau qui dit «Bienvenue».', 'A sign says "Welcome".', 'Un écran affiche le slogan « Le personnage dit bonjour ».',
    'La marque se prononce « inertie ».', 'Une femme présente une pancarte avec le texte exact : « Notre atelier ».']) {
    assert.equal(detectAiMediaVideoVisualBriefSpeech(brief), null, brief);
  }
  assert.deepEqual(detectAiMediaVideoVisualBriefSpeech('Une pancarte dit «Bienvenue». Puis un personnage dit «Bonjour».'), { script: 'Bonjour', mode: 'characters' });
});

test('public errors distinguish exact dialogue timing from internal visual assembly density', () => {
  const exact = getAiMediaGenerationPublicError(new Error('AI_MEDIA_EXACT_DIALOGUE_TOO_LONG'));
  assert.equal(exact.code, 'AI_MEDIA_EXACT_DIALOGUE_TOO_LONG'); assert.equal(exact.status, 422);
  assert.match(exact.message, /paroles exactes|réplique/i);
  for (const code of ['ai_media_exact_narration_too_long', 'ai_media_exact_dialogue_unfit', 'La préparation des voix des personnages est incomplète.']) {
    const publicError = getAiMediaGenerationPublicError(new Error(code));
    assert.match(publicError.message, /Paroles à prononcer/);
    assert.doesNotMatch(publicError.message, /dans votre prompt|entre guillemets/);
  }
  const assembly = getAiMediaGenerationPublicError(new Error('ai_media_exact_text_too_dense'));
  assert.equal(assembly.code, 'AI_MEDIA_EXACT_TEXT_TOO_DENSE');
  assert.doesNotMatch(assembly.message, /durée|secondes|plus longue/i);
});
