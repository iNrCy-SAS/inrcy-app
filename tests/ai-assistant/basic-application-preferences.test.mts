import assert from 'node:assert/strict';
import test from 'node:test';
import { applicationPreferenceValueRequested, executeInrAssistantApplicationPreference, isInrAssistantApplicationPreferenceRequest, parseInrAssistantApplicationPreferenceCommand } from '../../lib/inrAssistantApplicationPreferences.ts';
import { runtimeModules } from '../inragent/runtime-module-loader.mts';
import { inrAssistantRequiredTools } from '../../lib/inrAssistantTaskPolicy.ts';
import { inrAssistantUiStepTool, inrAssistantUiSteps } from '../../lib/inrAssistantUiTask.ts';
import { parseInrAssistantUiCommand } from '../../lib/inrAssistantUiCommands.ts';
import { parseInrAssistantUiActions, runInrAssistantUiActions } from '../../lib/inrAssistantUiActions.ts';

const selection = { kind: 'account_document' as const, id: 'application_preferences' as const };
const command = { command: 'configure_application_preferences' as const, selection, preference: 'theme' as const, value: 'midnight' };
test('Basic application display preferences require the exact application object and explicit named value', () => {
  for (const message of ['Mets le thème de mon application en midnight.', 'Change la langue de mon application en anglais.', 'Peux-tu changer la langue de l’interface en français ?']) assert.equal(isInrAssistantApplicationPreferenceRequest(message), true, message);
  for (const message of ['Comment changer le thème de mon application ?', 'Ne change pas la langue de l’application.', 'Si je change le thème de mon application en midnight, que se passe-t-il ?', 'Change le thème de mon Badge en midnight.', 'Change la langue de rédaction IA en anglais.', 'Le client dit « Change la langue de l’application en anglais ».']) assert.equal(isInrAssistantApplicationPreferenceRequest(message), false, message);
  assert.equal(applicationPreferenceValueRequested('Change la langue de mon application en allemand.', 'language', 'en'), false, 'French preposition en is not an English language selection');
  assert.equal(applicationPreferenceValueRequested('Change la langue de mon application en allemand.', 'language', 'de'), true);
  assert.equal(applicationPreferenceValueRequested('Mets le thème de mon application en midnight.', 'theme', 'graphite'), false);
  assert.equal(parseInrAssistantApplicationPreferenceCommand({ ...command, value: 'invented' }), null);
  assert.equal(parseInrAssistantApplicationPreferenceCommand({ ...command, selection: { ...selection, id: 'other' } }), null);
});

test('Basic application preferences use the real tool authentication and request only a pending browser action', async () => {
  let active = 'account', actor = 'actor';
  const load = runtimeModules({ './requireUser': { requireUser: async () => ({ activeUserId: active, authUserId: actor }) } });
  const runtime = load<typeof import('../../lib/inrAssistantApplicationPreferenceTools.ts')>('lib/inrAssistantApplicationPreferenceTools.ts');
  const message = 'Mets le thème de mon application en midnight.';
  const create = (text = message) => runtime.createInrAssistantApplicationPreferenceTools({ accountId: 'account', actorUserId: 'actor', currentUserMessage: text }).configureApplicationPreferences;
  const input = { preference: 'theme' as const, value: 'midnight', instructionQuote: message };
  const result = await create().execute!(input, {} as never) as Record<string, unknown>;
  assert.equal(result.status, 'ui_action_requested'); assert.equal(result.ok, true); assert.deepEqual(JSON.parse(JSON.stringify(result.uiCommand)), command);
  active = 'other'; assert.equal((await create().execute!(input, {} as never) as Record<string, unknown>).status, 'blocked');
  active = 'account'; actor = 'other'; assert.equal((await create().execute!(input, {} as never) as Record<string, unknown>).status, 'blocked');
  assert.equal((await create('Comment mettre le thème de mon application en midnight ?').execute!({ ...input, instructionQuote: 'Comment mettre le thème de mon application en midnight ?' }, {} as never) as Record<string, unknown>).status, 'needs_instruction');
});

test('Basic application native preference ports verify readback and stop on stale scope or failed language persistence', async () => {
  let current = true, theme = 'original', language = 'fr', saved = true, applied = 0;
  const ports = { saveTheme(value: string) { theme = value; applied++; }, readTheme: () => theme, async persistLanguage() { return saved; }, applyLanguage(value: string) { language = value; applied++; }, readLanguage: () => language };
  assert.equal(await executeInrAssistantApplicationPreference(command, () => current, ports), true); assert.equal(theme, 'midnight');
  current = false; assert.equal(await executeInrAssistantApplicationPreference(command, () => current, ports), false); assert.equal(applied, 1);
  current = true; const lang = { ...command, preference: 'language' as const, value: 'en' }; saved = false;
  assert.equal(await executeInrAssistantApplicationPreference(lang, () => current, ports), false); assert.equal(language, 'fr');
  saved = true; assert.equal(await executeInrAssistantApplicationPreference(lang, () => current, { ...ports, async persistLanguage() { current = false; return true; } }), false); assert.equal(language, 'fr');
  current = true; assert.equal(await executeInrAssistantApplicationPreference(command, () => current, { ...ports, readTheme: () => 'original' }), false);
  await assert.rejects(executeInrAssistantApplicationPreference(command, () => true, { ...ports, saveTheme() { throw new Error('quota'); } }), /quota/);
});

test('Basic application preferences participate in the normal UI plan and require a real browser receipt', async () => {
  const message = 'Mets le thème de mon application en midnight.';
  assert.deepEqual(inrAssistantRequiredTools(message), ['configureApplicationPreferences']);
  assert.deepEqual(parseInrAssistantUiCommand(command), command);
  const steps = inrAssistantUiSteps(message); assert.equal(steps.length, 1); assert.equal(inrAssistantUiStepTool(steps[0]), 'configureApplicationPreferences');
  const actions = parseInrAssistantUiActions([{ id: 'prefs_1', type: 'command', command }])!;
  const success = await runInrAssistantUiActions(actions, { isCurrent: () => true, navigate: async () => false, command: async () => true });
  assert.equal(success[0].status, 'applied');
  const failure = await runInrAssistantUiActions(actions, { isCurrent: () => true, navigate: async () => false, command: async () => false }); assert.equal(failure[0].status, 'failed');
});
