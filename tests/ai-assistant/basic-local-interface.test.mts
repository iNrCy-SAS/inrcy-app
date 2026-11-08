import assert from 'node:assert/strict';
import test from 'node:test';
import { getInrAssistantLocalInterfaceHints, parseInrAssistantLocalInterfaceCommand, registerInrAssistantLocalInterface, runInrAssistantLocalInterface, isInrAssistantLocalInterfaceRequest, isInrAssistantLocalInterfaceValueRequested, type InrAssistantLocalInterfaceRegistration } from '../../lib/inrAssistantLocalInterface.ts';
import { parseInrAssistantClientContext } from '../../lib/inrAssistantClientContext.ts';
import { runtimeModules } from '../inragent/runtime-module-loader.mts';
const scope = { actorUserId: 'actor', accountId: 'account', pathname: '/dashboard' };
const command = { command: 'control_local_interface' as const, selection: { kind: 'account_document' as const, id: 'help' as const }, operation: 'search' as const, revision: 'help_v1', value: 'avis Google' };
test('Basic local controls cannot substitute another legal document contact target or help theme', () => {
  assert.equal(isInrAssistantLocalInterfaceValueRequested('Ouvre la politique de confidentialité.', 'legal', 'open', 'cga'), false);
  assert.equal(isInrAssistantLocalInterfaceValueRequested('Ouvre la politique de confidentialité.', 'legal', 'open', 'confidentialite'), true);
  assert.equal(isInrAssistantLocalInterfaceValueRequested('Copie l’email de l’assistance.', 'contact', 'copy', 'phone'), false);
  assert.equal(isInrAssistantLocalInterfaceValueRequested('Copie l’email de l’assistance.', 'contact', 'copy', 'email'), true);
  assert.equal(isInrAssistantLocalInterfaceValueRequested('Sélectionne la rubrique Avis dans l’aide.', 'help', 'select', 'stats'), false);
  assert.equal(isInrAssistantLocalInterfaceRequest('Choisis le canal Facebook.'), false, 'a native Stats filter is not a channel-header menu');
});
test('Basic local interfaces strip private hints and refuse arbitrary selectors URLs operations and duplicate targets', () => {
  assert.equal(parseInrAssistantLocalInterfaceCommand({ ...command, selection: { kind: 'account_document', id: '#delete' } }), null);
  assert.equal(parseInrAssistantLocalInterfaceCommand({ ...command, operation: 'submit' }), null);
  const parsed = parseInrAssistantClientContext({ interfaces: [{ id: 'help', revision: 'help_v1', operations: ['search'], snapshot: 'PRIVATE', actorUserId: 'other', href: 'https://private.example' }] });
  assert.deepEqual(parsed?.interfaces, [{ id: 'help', revision: 'help_v1', operations: ['search'] }]); assert.ok(!JSON.stringify(parsed).includes('PRIVATE'));
  assert.equal(parseInrAssistantClientContext({ interfaces: [{ id: 'help', revision: 'help_v1', operations: ['delete'] }] }), null);
});
test('Basic local interface only acknowledges a real native state commit and prevents a duplicate in-flight invocation', async () => {
  let calls = 0, release!: () => void;
  const entry: InrAssistantLocalInterfaceRegistration = { ...scope, id: 'help', revision: 'help_v1', snapshot: { query: '' }, handlers: { search: { async invoke(value) { calls++; await new Promise<void>(resolve => { release = resolve; }); registerInrAssistantLocalInterface('help_test', { ...entry, revision: 'help_v2', snapshot: { query: value } }); }, matches(snapshot, value) { return (snapshot as { query?: string })?.query === value; } } } };
  registerInrAssistantLocalInterface('help_test', entry);
  try {
    assert.equal(await runInrAssistantLocalInterface({ ...command, revision: 'old' }, scope, () => true), false);
    const result = runInrAssistantLocalInterface(command, scope, () => true);
    assert.equal(calls, 1); assert.equal(await runInrAssistantLocalInterface(command, scope, () => true), false);
    assert.equal(getInrAssistantLocalInterfaceHints(scope), undefined);
    release(); assert.equal(await result, true); assert.equal(calls, 1);
    assert.equal(getInrAssistantLocalInterfaceHints(scope)?.[0].revision, 'help_v2');
  } finally { registerInrAssistantLocalInterface('help_test', null); }
});
test('Basic local interface rejects late account changes and verifies actual close unmount without reusing another target', async () => {
  let current = true, calls = 0;
  const entry: InrAssistantLocalInterfaceRegistration = { ...scope, id: 'help_dialog', revision: 'help_v1', snapshot: { open: true }, handlers: { close: { invoke() { calls++; registerInrAssistantLocalInterface('help_close_test', null); }, matches: () => false, allowUnmount: true } } };
  registerInrAssistantLocalInterface('help_close_test', entry);
  try {
    const close = { ...command, selection: { ...command.selection, id: 'help_dialog' as const }, operation: 'close' as const, value: null };
    assert.equal(await runInrAssistantLocalInterface(close, { ...scope, accountId: 'other' }, () => true), false); assert.equal(calls, 0);
    assert.equal(await runInrAssistantLocalInterface(close, scope, () => current), true); assert.equal(calls, 1);
    registerInrAssistantLocalInterface('help_close_test', { ...entry, id: 'help', handlers: { search: { invoke() { current = false; }, matches: () => true } } });
    assert.equal(await runInrAssistantLocalInterface(command, scope, () => current), false);
  } finally { registerInrAssistantLocalInterface('help_close_test', null); }
});

test('A pending native close confirmation is bounded by scope and keeps its mount locked until it settles', async () => {
  let current = true, calls = 0, finish!: () => void;
  const entry: InrAssistantLocalInterfaceRegistration = { ...scope, id: 'help_dialog', revision: 'help_v1', snapshot: { open: true }, handlers: { close: { async invoke(_value, stillCurrent) { calls++; await new Promise<void>(resolve => { finish = resolve; }); if (stillCurrent()) registerInrAssistantLocalInterface('pending_native_close', null); }, matches: () => false, allowUnmount: true } } };
  registerInrAssistantLocalInterface('pending_native_close', entry);
  try {
    const close = { ...command, selection: { ...command.selection, id: 'help_dialog' as const }, operation: 'close' as const, value: null };
    const pending = runInrAssistantLocalInterface(close, scope, () => current);
    current = false; assert.equal(await pending, false); assert.equal(calls, 1);
    assert.equal(await runInrAssistantLocalInterface(close, scope, () => true), false, 'an unresolved native confirmation must not open twice');
    finish(); await new Promise(resolve => setTimeout(resolve, 0));
    assert.ok(getInrAssistantLocalInterfaceHints(scope), 'the mount is released after its own native promise settles');
  } finally { finish?.(); registerInrAssistantLocalInterface('pending_native_close', null); }
});

test('A real open popup outranks closed launchers while ties and a busy active popup never fall back', async () => {
  const handler = { invoke() {}, matches: () => true, immediate: true };
  const base: InrAssistantLocalInterfaceRegistration = { ...scope, id: 'help_dialog', revision: 'closed', snapshot: {}, handlers: { close: handler } };
  try {
    registerInrAssistantLocalInterface('launcherA', base); registerInrAssistantLocalInterface('launcherB', { ...base, revision: 'other' });
    assert.equal(getInrAssistantLocalInterfaceHints(scope), undefined);
    registerInrAssistantLocalInterface('launcherA', { ...base, revision: 'open', priority: 1 });
    assert.equal(getInrAssistantLocalInterfaceHints(scope)?.[0].revision, 'open');
    registerInrAssistantLocalInterface('launcherA', { ...base, revision: 'open', priority: 1, busy: true });
    assert.equal(getInrAssistantLocalInterfaceHints(scope), undefined);
    assert.equal(await runInrAssistantLocalInterface({ command: 'control_local_interface', selection: { kind: 'account_document', id: 'help_dialog' }, operation: 'close', revision: 'other', value: null }, scope, () => true), false);
    registerInrAssistantLocalInterface('launcherB', { ...base, priority: 1 }); assert.equal(getInrAssistantLocalInterfaceHints(scope), undefined);
  } finally { registerInrAssistantLocalInterface('launcherA', null); registerInrAssistantLocalInterface('launcherB', null); }
});

test('An inactive surface with no operations cannot erase another surface from native hints', () => {
  const base: InrAssistantLocalInterfaceRegistration = { ...scope, id: 'help', revision: 'empty', snapshot: {}, handlers: {} };
  try {
    registerInrAssistantLocalInterface('empty_surface', base);
    registerInrAssistantLocalInterface('active_surface', { ...base, id: 'generator', revision: 'active', handlers: { retry: { invoke() {}, matches: () => true } } });
    assert.deepEqual(getInrAssistantLocalInterfaceHints(scope), [{ id: 'generator', revision: 'active', operations: ['retry'] }]);
  } finally { registerInrAssistantLocalInterface('empty_surface', null); registerInrAssistantLocalInterface('active_surface', null); }
});
test('Basic local interface requires one mounted scoped target and a native operation rather than a quoted or conditional instruction', async () => {
  assert.equal(isInrAssistantLocalInterfaceRequest('Recherche avis Google dans l’aide.', 'help', 'search'), true);
  for (const message of ['Comment rechercher avis Google dans l’aide ?', 'Ne ferme pas l’aide.', 'Si je ferme l’aide, que se passe-t-il ?', 'Le client dit « Ferme l’aide ».']) assert.equal(isInrAssistantLocalInterfaceRequest(message), false, message);
  const row: InrAssistantLocalInterfaceRegistration = { ...scope, id: 'help', revision: 'help_v1', snapshot: {}, handlers: { close: { invoke() { assert.fail('Ambiguous targets must not execute'); }, matches: () => true } } };
  registerInrAssistantLocalInterface('help_1', row); registerInrAssistantLocalInterface('help_2', row);
  try { assert.equal(getInrAssistantLocalInterfaceHints(scope), undefined); assert.equal(await runInrAssistantLocalInterface({ ...command, operation: 'close', value: null }, scope, () => true), false); }
  finally { registerInrAssistantLocalInterface('help_1', null); registerInrAssistantLocalInterface('help_2', null); }
});
test('Basic local interface server tools authenticate the exact actor and leave completion pending the browser', async () => {
  let actor = 'actor';
  const load = runtimeModules({ './requireUser': { requireUser: async () => ({ activeUserId: 'account', authUserId: actor }) } });
  const runtime = load<typeof import('../../lib/inrAssistantLocalInterfaceTools.ts')>('lib/inrAssistantLocalInterfaceTools.ts');
  const message = 'Recherche avis Google dans l’aide.';
  const tool = runtime.createInrAssistantLocalInterfaceTools({ accountId: 'account', actorUserId: 'actor', currentUserMessage: message, clientContext: { source: 'untrusted_client', interfaces: [{ id: 'help', revision: 'help_v1', operations: ['search'] }] } }).controlLocalInterface;
  const input = { interface: 'help' as const, revision: 'help_v1', operation: 'search' as const, value: 'avis Google', instructionQuote: message };
  assert.equal((await tool.execute!(input, {} as never) as { status: string }).status, 'ui_action_requested');
  actor = 'other'; assert.equal((await tool.execute!(input, {} as never) as { status: string }).status, 'blocked');
});

test('Studio duration-only server commands require the exact requested seconds and leave Guided scene choices unchanged', async () => {
  const load = runtimeModules({ './requireUser': { requireUser: async () => ({ activeUserId: 'account', authUserId: 'actor' }) } });
  const runtime = load<typeof import('../../lib/inrAssistantLocalInterfaceTools.ts')>('lib/inrAssistantLocalInterfaceTools.ts');
  const run = async (id: 'studio_free_form' | 'studio_guided_form', message: string, value: string) => {
    const tool = runtime.createInrAssistantLocalInterfaceTools({ accountId: 'account', actorUserId: 'actor', currentUserMessage: message,
      clientContext: { source: 'untrusted_client', interfaces: [{ id, revision: 'duration_v1', operations: ['select'] }] } }).controlLocalInterface;
    return await tool.execute!({ interface: id, revision: 'duration_v1', operation: 'select', value, instructionQuote: message }, {} as never) as { status: string; uiCommand?: unknown };
  };
  const seconds = JSON.stringify({ field: 'durationSeconds', value: 30 });
  const requested = await run('studio_free_form', 'Mets la durée du Studio libre à 30 secondes.', seconds);
  assert.equal(requested.status, 'ui_action_requested');
  assert.ok(requested.uiCommand, 'server authorizes only the request; the native browser still must commit its catalogue pair');
  assert.equal((await run('studio_free_form', 'Mets la durée du Studio libre à 15 secondes.', seconds)).status, 'needs_instruction');
  assert.equal((await run('studio_free_form', 'Ne mets pas 30 secondes dans le Studio libre.', seconds)).status, 'needs_instruction');
  assert.equal((await run('studio_guided_form', 'Mets la durée du Studio guidé à 30 secondes.', seconds)).status, 'needs_instruction');
  assert.equal((await run('studio_guided_form', 'Mets la durée du Studio guidé à 30 secondes sur plusieurs scènes.',
    JSON.stringify({ field: 'durationScene', value: { seconds: 30, sceneMode: 'multi' } }))).status, 'ui_action_requested');
});
