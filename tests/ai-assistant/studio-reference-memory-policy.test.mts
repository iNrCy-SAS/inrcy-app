import test from 'node:test';
import assert from 'node:assert/strict';
import { requestedStudioReferenceMemoryAction } from '../../lib/inrAssistantStudioReferenceMemory.ts';
import { parseInrAssistantLocalInterfaceCommand, parseInrAssistantLocalInterfaceHints, isInrAssistantLocalInterfaceRequest, isInrAssistantLocalInterfaceValueRequested } from '../../lib/inrAssistantLocalInterface.ts';
import { runtimeModules } from '../inragent/runtime-module-loader.mts';
import { parseInrAssistantClientContext } from '../../lib/inrAssistantClientContext.ts';

const target = 'studio_reference_memory';
const command = (value: unknown, operation = 'select') => ({ command: 'control_local_interface', selection: { kind: 'account_document', id: target }, revision: 'mounted_42', operation, value });

test('Studio reference memory accepts only two finite native actions', () => {
  for (const value of ['remember', 'forget']) assert.equal(parseInrAssistantLocalInterfaceCommand(command(value))?.value, value);
  for (const value of [null, '', 'delete', 'upload', 'https://example.org', '{"accountId":"other"}']) assert.equal(parseInrAssistantLocalInterfaceCommand(command(value)), null);
  for (const op of ['open', 'clear', 'retry', 'review']) assert.equal(parseInrAssistantLocalInterfaceCommand(command('remember', op)), null);
  assert.ok(parseInrAssistantLocalInterfaceHints([{ id: target, revision: 'mounted_42', operations: ['select'] }]));
  assert.equal(parseInrAssistantLocalInterfaceHints([{ id: target, revision: 'mounted_42', operations: ['clear'] }]), undefined);
});

test('Studio reference memory requires an explicit current selection and binds save versus forget', () => {
  for (const message of ['Mémorise les médias sélectionnés dans le Studio', 'Dans mon Studio, retiens les personnages actuels', 'Mets à jour la mémoire des références du Studio']) {
    assert.equal(requestedStudioReferenceMemoryAction(message), 'remember', message);
    assert.ok(isInrAssistantLocalInterfaceRequest(message, target, 'select'), message);
    assert.ok(isInrAssistantLocalInterfaceValueRequested(message, target, 'select', 'remember'), message);
    assert.equal(isInrAssistantLocalInterfaceValueRequested(message, target, 'select', 'forget'), false, message);
  }
  const forget = 'Oublie les références mémorisées dans le Studio';
  assert.equal(requestedStudioReferenceMemoryAction(forget), 'forget');
  assert.ok(isInrAssistantLocalInterfaceValueRequested(forget, target, 'select', 'forget'));
  assert.equal(isInrAssistantLocalInterfaceValueRequested(forget, target, 'select', 'remember'), false);
});

test('Studio reference memory refuses advice, quotations, negation, other accounts and unrelated writes', () => {
  for (const message of [
    'Comment mémoriser les médias sélectionnés dans le Studio ?',
    'Ne mémorise pas les médias sélectionnés dans le Studio',
    '« Mémorise les médias sélectionnés dans le Studio »',
    'Le client dit : mémorise les médias sélectionnés dans le Studio',
    'Demain mémorise les médias sélectionnés dans le Studio',
    'Mémorise les médias sélectionnés du Studio dans tous les comptes',
    'Mémorise les médias sélectionnés du Studio dans un autre compte',
    'Mémorise les médias sélectionnés dans le Studio pour le compte Sajemma',
    'Oublie les références mémorisées dans le Studio pour le compte Guerlin',
    'Mémorise les médias actuels dans le Studio et oublie cette mémoire',
    'Oublie les références mémorisées dans le Studio et mémorise les médias actuels',
    'Mémorise ou oublie les médias sélectionnés du Studio',
    'Mémorise les médias sélectionnés du Studio et publie',
    'Supprime les médias mémorisés dans le Studio',
    'Mémorise le Studio',
    'Mémorise les photos dans le Studio',
  ]) {
    assert.equal(requestedStudioReferenceMemoryAction(message), null, message);
    assert.equal(isInrAssistantLocalInterfaceRequest(message, target, 'select'), false, message);
    assert.equal(isInrAssistantLocalInterfaceValueRequested(message, target, 'select', 'remember'), false, message);
  }
});

test('Studio reference memory tool binds actor account revision and explicit action without exposing media', async () => {
  let actor = 'actor', account = 'account';
  const load = runtimeModules({ './requireUser': { requireUser: async () => ({ activeUserId: account, authUserId: actor }) } });
  const runtime = load<typeof import('../../lib/inrAssistantLocalInterfaceTools.ts')>('lib/inrAssistantLocalInterfaceTools.ts');
  const message = 'Mémorise les médias sélectionnés dans le Studio';
  const tool = runtime.createInrAssistantLocalInterfaceTools({ accountId: 'account', actorUserId: 'actor', currentUserMessage: message,
    clientContext: { source: 'untrusted_client', interfaces: [{ id: target, revision: 'mounted_42', operations: ['select'] }] } }).controlLocalInterface;
  const input = { interface: target, operation: 'select', revision: 'mounted_42', value: 'remember', instructionQuote: message } as const;
  const invoke = async (change = {}) => await tool.execute!({ ...input, ...change }, {} as never) as {status: string};
  assert.equal((await invoke()).status, 'ui_action_requested');
  assert.equal((await invoke({ revision: 'old' })).status, 'navigation_required');
  assert.equal((await invoke({ value: 'forget' })).status, 'needs_instruction');
  for (const blockedMessage of [
    'Mémorise les médias sélectionnés dans le Studio pour le compte Sajemma',
    'Oublie les références mémorisées dans le Studio pour le compte Guerlin',
    'Mémorise les médias actuels dans le Studio et oublie cette mémoire',
    'Oublie les références mémorisées dans le Studio et mémorise les médias actuels',
  ]) {
    const guarded = runtime.createInrAssistantLocalInterfaceTools({ accountId: 'account', actorUserId: 'actor', currentUserMessage: blockedMessage,
      clientContext: { source: 'untrusted_client', interfaces: [{ id: target, revision: 'mounted_42', operations: ['select'] }] } }).controlLocalInterface;
    for (const value of ['remember', 'forget']) {
      const result = await guarded.execute!({ ...input, value, instructionQuote: blockedMessage }, {} as never) as { status: string };
      assert.equal(result.status, 'needs_instruction', blockedMessage);
    }
  }
  actor = 'other'; assert.equal((await invoke()).status, 'blocked');
  actor = 'actor'; account = 'other'; assert.equal((await invoke()).status, 'blocked');
  const context = parseInrAssistantClientContext({ interfaces: [{ id: target, revision: 'mounted_42', operations: ['select'], snapshot: { files: ['private-voice.wav'], accountId: 'private-account' } }] });
  assert.deepEqual(context?.interfaces, [{ id: target, revision: 'mounted_42', operations: ['select'] }]);
  assert.doesNotMatch(JSON.stringify(context), /private-/);
});
