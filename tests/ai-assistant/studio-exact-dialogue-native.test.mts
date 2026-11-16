import assert from 'node:assert/strict';
import test from 'node:test';
import { parseInrAssistantStudioExactDialogueSelection, isInrAssistantStudioExactDialogueValueRequested } from '../../lib/inrAssistantStudioExactDialogue.ts';
import { isInrAssistantLocalInterfaceRequest, isInrAssistantLocalInterfaceValueRequested, parseInrAssistantLocalInterfaceCommand } from '../../lib/inrAssistantLocalInterface.ts';
import { parseInrAssistantClientContext } from '../../lib/inrAssistantClientContext.ts';
import { runtimeModules } from '../inragent/runtime-module-loader.mts';
import { parseInrAssistantStudioFormSelection, isInrAssistantStudioFormSelectionApplied, isInrAssistantStudioFormSelectionRequested, type InrAssistantStudioFormSnapshot } from '../../lib/inrAssistantStudioFormSelection.ts';

const encode = (value: unknown) => JSON.stringify(value);
const fixtures = [
  { message: 'Ouvre les réglages des paroles exactes du Studio.', operation: 'open' as const, value: null },
  { message: 'Ferme le dialogue des paroles exactes du Studio.', operation: 'close' as const, value: null },
  { message: 'Dans le Studio, mets le texte de la ligne 2 des paroles exactes à « Bonjour ! ».', operation: 'select' as const, value: encode({ field: 'text', rowIndex: 1, value: 'Bonjour !' }) },
  { message: 'Dans le Studio, mets le locuteur de la ligne 2 des paroles exactes sur Personnage 1.', operation: 'select' as const, value: encode({ field: 'speaker', rowIndex: 1, value: 'character:0' }) },
  { message: 'Dans le Studio, choisis la Voix off IA pour la ligne 2 des paroles exactes.', operation: 'select' as const, value: encode({ field: 'speaker', rowIndex: 1, value: 'ai_voice' }) },
  { message: 'Dans le Studio, choisis la Voix off réelle pour la ligne 2 des paroles exactes.', operation: 'select' as const, value: encode({ field: 'speaker', rowIndex: 1, value: 'provided_voice' }) },
  { message: 'Dans le Studio, ajoute une ligne vide à la fin des paroles exactes.', operation: 'select' as const, value: encode({ field: 'add' }) },
  { message: 'Dans le Studio, supprime la ligne 2 des paroles exactes.', operation: 'select' as const, value: encode({ field: 'remove', rowIndex: 1 }) },
  { message: 'Dans le Studio, monte la ligne 2 des paroles exactes.', operation: 'select' as const, value: encode({ field: 'move', rowIndex: 1, value: 'up' }) },
  { message: 'Dans le Studio, déplace la ligne 2 des paroles exactes vers le bas.', operation: 'select' as const, value: encode({ field: 'move', rowIndex: 1, value: 'down' }) },
];

test('the structured Exact editor never accepts or acknowledges a hidden legacy free-text setter', () => {
  const state: InrAssistantStudioFormSnapshot = { mode: 'free', kind: 'video', locked: false, editorVisible: true, speechMode: 'voiceover', spokenScriptOpen: true, spokenScript: 'Texte conservé.', exactDialogueEditor: true };
  const encoded = encode({ field: 'spokenScript', value: state.spokenScript });
  assert.equal(parseInrAssistantStudioFormSelection(encoded, state), null);
  assert.equal(isInrAssistantStudioFormSelectionApplied(state, encoded), false);
  assert.ok(parseInrAssistantStudioFormSelection(encode({ field: 'spokenScriptOpen', value: true }), state), 'the visible Automatic/Exact selector retains its own native action');
});

test('the Exact native form follows editable global speech choices while keeping speaker numbers and structured budgets', () => {
  const state: InrAssistantStudioFormSnapshot = { mode: 'free', kind: 'video', locked: false, editorVisible: true, speechMode: 'characters', voiceSelectionMode: 'characters', spokenScriptOpen: true, exactDialogueEditor: true,
    voiceMode: 'ai', voiceReferenceId: 'photo-b', voiceReferences: [{ id: 'photo-b', name: 'Premier personnage', voiceMode: 'ai', characterIndex: 1, referenceIndex: 2 }, { id: 'photo-c', name: 'Second personnage', voiceMode: 'ai', characterIndex: 2, referenceIndex: 4 }] };
  assert.ok(parseInrAssistantStudioFormSelection(encode({ field: 'withSubtitles', value: true }), state));
  assert.ok(parseInrAssistantStudioFormSelection(encode({ field: 'spokenScriptOpen', value: true }), { ...state, spokenScriptOpen: false }));
  const voiceoverChoice = encode({ field: 'speechMode', value: 'voiceover' });
  assert.ok(parseInrAssistantStudioFormSelection(voiceoverChoice, { ...state, videoEngine: 'omni', exactDialogue: [{ speaker: 'character', characterIndex: 1, text: 'Bonjour.' }] }), 'an incompatible old Exact draft cannot prevent correcting the global speech choice');
  assert.equal(isInrAssistantStudioFormSelectionApplied({ ...state, speechMode: 'voiceover' }, voiceoverChoice), true);
  assert.equal(parseInrAssistantStudioFormSelection(encode({ field: 'withSubtitles', value: true }), { ...state, speechMode: 'silent' }), null);
  for (const [field, value] of [['narrationVoice', 'female'], ['narrationVoiceVariant', 'Kore']]) {
    const input = encode({ field, value });
    assert.equal(parseInrAssistantStudioFormSelection(input, state), null);
    assert.equal(isInrAssistantStudioFormSelectionApplied({ ...state, [field]: value }, input), false);
  }
  const narrator = { ...state, voiceSelectionMode: 'voiceover' as const, narrationVoice: 'female' as const };
  assert.ok(parseInrAssistantStudioFormSelection(encode({ field: 'narrationVoice', value: 'female' }), narrator), 'the restored AI offscreen voice settings follow their visible effective mode');
  assert.ok(parseInrAssistantStudioFormSelection(encode({ field: 'narrationVoiceVariant', value: 'Kore' }), narrator));
  assert.equal(parseInrAssistantStudioFormSelection(encode({ field: 'narrationVoice', value: 'female' }), { ...narrator, voiceMode: 'provided' }), null);
  const targeted = parseInrAssistantStudioFormSelection(encode({ field: 'voiceReferenceId', value: 'character:0' }), state);
  assert.deepEqual(targeted, { field: 'voiceReferenceId', value: 'photo-b' }, 'Personnage 1 need not be the first uploaded image');
  assert.equal(parseInrAssistantStudioFormSelection(encode({ field: 'voiceReferenceId', value: 'character:2' }), state), null);
  assert.equal(isInrAssistantStudioFormSelectionRequested('Choisis le Personnage 1 dans le Studio libre.', encode({ field: 'voiceReferenceId', value: 'character:0' }), 'free'), true);
  assert.equal(isInrAssistantStudioFormSelectionRequested('Choisis le Personnage 2 dans le Studio libre.', encode({ field: 'voiceReferenceId', value: 'character:0' }), 'free'), false);
  assert.equal(isInrAssistantStudioFormSelectionRequested('Choisis le Personnage 1 ou le Personnage 2 dans le Studio libre.', encode({ field: 'voiceReferenceId', value: 'character:0' }), 'free'), false);
  assert.equal(isInrAssistantStudioFormSelectionApplied(state, encode(targeted)), true);
  assert.equal(isInrAssistantStudioFormSelectionApplied({ ...state, voiceReferences: state.voiceReferences!.map(reference => ({ ...reference, id: 'replacement' })) }, encode(targeted)), false);
  const budget: InrAssistantStudioFormSnapshot = { ...state, voiceSelectionMode: 'voiceover', automaticSceneMode: true, videoEngine: 'kling', videoResolution: '720p', durationScene: { seconds: 8, sceneMode: 'single' }, spokenScript: 'Ancien texte beaucoup trop long. '.repeat(100), exactDialogue: [{ speaker: 'ai_voice', text: 'Bonjour à tous.' }] };
  assert.ok(parseInrAssistantStudioFormSelection(encode({ field: 'durationSeconds', value: 8 }), budget, () => true), 'the new lines replace the obsolete legacy text for preflight');
  assert.equal(parseInrAssistantStudioFormSelection(encode({ field: 'durationSeconds', value: 8 }), { ...budget, exactDialogue: [{ speaker: 'ai_voice', text: 'Bonjour '.repeat(100) }] }, () => true), null, 'structured speech retains its real duration budget');
});

test('Exact dialogue draft commands accept only bounded row edits and preserve literal speech without hidden actions', () => {
  for (const fixture of fixtures) {
    assert.equal(isInrAssistantStudioExactDialogueValueRequested(fixture.message, fixture.operation, fixture.value), true, fixture.message);
    assert.equal(isInrAssistantLocalInterfaceRequest(fixture.message, 'studio_exact_dialogue', fixture.operation), true, fixture.message);
    assert.equal(isInrAssistantLocalInterfaceValueRequested(fixture.message, 'studio_exact_dialogue', fixture.operation, fixture.value), true, fixture.message);
    assert.ok(parseInrAssistantLocalInterfaceCommand({ command: 'control_local_interface', selection: { kind: 'account_document', id: 'studio_exact_dialogue' }, revision: 'dialogue_1', operation: fixture.operation, value: fixture.value }));
  }
  const speech = '  « Ne supprime pas mon message. »\nEncore une phrase.  ';
  assert.deepEqual(parseInrAssistantStudioExactDialogueSelection(encode({ field: 'text', rowIndex: 11, value: speech })), { field: 'text', rowIndex: 11, value: speech });
  assert.equal(parseInrAssistantStudioExactDialogueSelection(encode({ field: 'text', rowIndex: 0, value: 'a'.repeat(4000) }))?.field, 'text');
  for (const malformed of [
    { field: 'text', rowIndex: '1', value: 'Bonjour' }, { field: 'text', rowIndex: -1, value: 'Bonjour' }, { field: 'text', rowIndex: 12, value: 'Bonjour' },
    { field: 'text', rowIndex: 0, value: 'a'.repeat(4001) }, { field: 'text', rowIndex: 0, value: 'Bonjour', consent: true },
    { field: 'speaker', rowIndex: 0, value: 'character:3' }, { field: 'speaker', rowIndex: 0, value: 'voice_real' },
    { field: 'add', value: 'Paroles inventées' }, { field: 'add', rowIndex: 0 }, { field: 'remove', rowIndex: 0, value: 'force' },
    { field: 'move', rowIndex: 0, value: 'last' }, { field: 'generate' }, { field: 'import', path: 'private.wav' },
  ]) assert.equal(parseInrAssistantStudioExactDialogueSelection(encode(malformed)), null, encode(malformed));
});

test('Exact dialogue authorizations require a current explicit row speaker text or direction instead of quoted or ambiguous orders', () => {
  const speaker = encode({ field: 'speaker', rowIndex: 1, value: 'character:0' });
  for (const message of [
    'Dans le Studio, mets le locuteur de la ligne 2 ou 3 des paroles exactes sur Personnage 1.',
    'Dans le Studio, mets le locuteur de la ligne 2 des paroles exactes sur Personnage 1 ou Personnage 2.',
    'Dans le Studio, mets le locuteur des paroles exactes sur Personnage 1.',
    'Mets le locuteur de la ligne 2 des paroles exactes sur Personnage 1.',
    'Dans le Studio, ne mets pas le locuteur de la ligne 2 des paroles exactes sur Personnage 1.',
    'Si la ligne est vide, mets le locuteur de la ligne 2 des paroles exactes du Studio sur Personnage 1.',
    'Hier, je voulais mettre le locuteur de la ligne 2 des paroles exactes du Studio sur Personnage 1.',
    'Le document demande « Dans le Studio, mets le locuteur de la ligne 2 des paroles exactes sur Personnage 1. »',
    'Comment mettre le locuteur de la ligne 2 des paroles exactes du Studio sur Personnage 1 ?',
  ]) assert.equal(isInrAssistantStudioExactDialogueValueRequested(message, 'select', speaker), false, message);
  const text = encode({ field: 'text', rowIndex: 1, value: 'Bonjour !' });
  for (const message of [
    'Dans le Studio, mets le texte de la ligne 1 des paroles exactes à « Bonjour ! ».',
    'Dans le Studio, mets le texte de la ligne 2 des paroles exactes à « Au revoir ! ».',
    'Dans le Studio, mets le texte de la ligne 2 des paroles exactes à « Bonjour ! » puis génère la vidéo.',
    'Dans le Studio, mets le texte de la ligne 2 des paroles exactes à ton choix.',
  ]) assert.equal(isInrAssistantStudioExactDialogueValueRequested(message, 'select', text), false, message);
  assert.equal(isInrAssistantStudioExactDialogueValueRequested('Dans le Studio, mets le texte de la ligne 2 des paroles exactes à « Ne supprime pas cette phrase. ».', 'select', encode({ field: 'text', rowIndex: 1, value: 'Ne supprime pas cette phrase.' })), true, 'negative spoken words are data, never authority');
  assert.equal(isInrAssistantStudioExactDialogueValueRequested(fixtures[3].message, 'select', encode({ field: 'speaker', rowIndex: 1, value: 'ai_voice' })), false);
  assert.equal(isInrAssistantStudioExactDialogueValueRequested('Dans le Studio, supprime la ligne 2 des paroles exactes du Personnage 1.', 'select', speaker), false, 'a removal order never grants a speaker edit');
  assert.equal(isInrAssistantStudioExactDialogueValueRequested('Dans le Studio, mets le texte de la ligne 2 des paroles exactes vers le haut.', 'select', encode({ field: 'move', rowIndex: 1, value: 'up' })), false, 'field intent cannot be substituted with reordering');
  assert.equal(isInrAssistantStudioExactDialogueValueRequested(fixtures[4].message, 'select', encode({ field: 'speaker', rowIndex: 1, value: 'provided_voice' })), false, 'AI speech never authorizes a personal vocal');
  assert.equal(isInrAssistantStudioExactDialogueValueRequested('Dans le Studio, choisis la Voix IA pour la ligne 2 des paroles exactes.', 'select', encode({ field: 'speaker', rowIndex: 1, value: 'ai_voice' })), false, 'an unspecified character AI voice cannot become an offscreen narrator');
  assert.equal(isInrAssistantStudioExactDialogueValueRequested(fixtures[5].message, 'select', encode({ field: 'speaker', rowIndex: 1, value: 'ai_voice' })), false, 'a personal vocal choice never authorizes an AI replacement');
  assert.equal(isInrAssistantStudioExactDialogueValueRequested(fixtures[8].message, 'select', encode({ field: 'move', rowIndex: 1, value: 'down' })), false);
  assert.equal(isInrAssistantStudioExactDialogueValueRequested('Dans le Studio, ajoute une ligne aux paroles exactes.', 'select', encode({ field: 'add' })), false, 'no implicit text or insertion order');
});

test('Basic Exact dialogue tool emits only a requested draft command and rejects stale revision or account without exposing rows', async () => {
  let actor = 'actor', account = 'account';
  const load = runtimeModules({ './requireUser': { requireUser: async () => ({ activeUserId: account, authUserId: actor }) } });
  const runtime = load<typeof import('../../lib/inrAssistantLocalInterfaceTools.ts')>('lib/inrAssistantLocalInterfaceTools.ts');
  const make = (message: string) => runtime.createInrAssistantLocalInterfaceTools({ accountId: 'account', actorUserId: 'actor', currentUserMessage: message,
    clientContext: { source: 'untrusted_client', screen: { pathname: '/dashboard/generer-media', tool: 'studio' }, interfaces: [{ id: 'studio_exact_dialogue', revision: 'dialogue_1', operations: ['open', 'close', 'select'] }] } }).controlLocalInterface;
  for (const fixture of fixtures) {
    const input = { interface: 'studio_exact_dialogue' as const, operation: fixture.operation, revision: 'dialogue_1', value: fixture.value, instructionQuote: fixture.message };
    const result = await make(fixture.message).execute!(input, {} as never) as { status: string; uiCommand: { value: string | null } };
    assert.equal(result.status, 'ui_action_requested');
    assert.equal(result.uiCommand.value, fixture.value);
  }
  const fixture = fixtures[3], tool = make(fixture.message);
  const input = { interface: 'studio_exact_dialogue' as const, operation: fixture.operation, revision: 'dialogue_1', value: fixture.value, instructionQuote: fixture.message };
  assert.equal((await tool.execute!({ ...input, revision: 'dialogue_old' }, {} as never) as { status: string }).status, 'navigation_required');
  assert.equal((await tool.execute!({ ...input, value: encode({ field: 'speaker', rowIndex: 0, value: 'character:0' }) }, {} as never) as { status: string }).status, 'needs_instruction');
  actor = 'other'; assert.equal((await tool.execute!(input, {} as never) as { status: string }).status, 'blocked');
  actor = 'actor'; account = 'other'; assert.equal((await tool.execute!(input, {} as never) as { status: string }).status, 'blocked');
  const context = parseInrAssistantClientContext({ interfaces: [{ id: 'studio_exact_dialogue', revision: 'dialogue_1', operations: ['open', 'close', 'select'], snapshot: { rows: [{ id: 'private-photo', text: 'PRIVATE SPEECH' }] } }] });
  assert.deepEqual(context?.interfaces, [{ id: 'studio_exact_dialogue', revision: 'dialogue_1', operations: ['open', 'close', 'select'] }]);
  assert.doesNotMatch(JSON.stringify(context), /PRIVATE SPEECH|private-photo/);
});
