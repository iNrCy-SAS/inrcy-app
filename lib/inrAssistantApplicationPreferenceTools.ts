import 'server-only';
import { jsonSchema, tool } from 'ai';
import { requireUser } from './requireUser';
import { applicationPreferenceValueRequested, parseInrAssistantApplicationPreferenceCommand } from './inrAssistantApplicationPreferences.ts';
import { matchesInrAssistantActionClause } from './inrAssistantActionClause.ts';

type Input = { preference: 'language' | 'theme'; value: string; instructionQuote: string };
export function createInrAssistantApplicationPreferenceTools(options: { accountId: string; actorUserId: string; currentUserMessage: string; canStartWork?: () => boolean }) {
  return { configureApplicationPreferences: tool({
    strict: true,
    description: 'Changer explicitement la langue affichée de l’application iNrCy ou son thème local. Une préférence par appel : language fr/en/es/it/de/nl/pt/th/zh, theme original/midnight/graphite/soft-violet/pearl-light/azure-light. Valeur citée dans la demande actuelle, distincte de la langue IA et des thèmes Badge/widget. Langue du compte vérifiée puis affichage natif ; thème de ce navigateur uniquement. Aucun mot de passe, abonnement ou consentement. Résultat à confirmer par le navigateur.',
    inputSchema: jsonSchema<Input>({ type: 'object', additionalProperties: false, required: ['preference', 'value', 'instructionQuote'], properties: { preference: { type: 'string', enum: ['language', 'theme'] }, value: { type: 'string', maxLength: 40 }, instructionQuote: { type: 'string', minLength: 1, maxLength: 1200 } } }, { validate: value => {
      const row = value as Input;
      if (!row || Object.keys(row).length !== 3 || typeof row.instructionQuote !== 'string' || !row.instructionQuote.trim() || row.instructionQuote.length > 1200 || !parseInrAssistantApplicationPreferenceCommand({ command: 'configure_application_preferences', selection: { kind: 'account_document', id: 'application_preferences' }, preference: row.preference, value: row.value })) return { success: false, error: new Error('Préférence invalide') };
      return { success: true, value: row };
    } }),
    execute: async input => {
      if (!matchesInrAssistantActionClause(options.currentUserMessage, input.instructionQuote, (current, quote) => applicationPreferenceValueRequested(current, input.preference, input.value) && applicationPreferenceValueRequested(quote, input.preference, input.value))) return { ok: false, status: 'needs_instruction', message: 'Précisez la langue de l’application ou le thème souhaité.' };
      if (options.canStartWork?.() === false) return { ok: false, status: 'blocked', message: 'La demande doit être reprise avant de modifier cette préférence.' };
      const auth = await requireUser();
      if (auth.errorResponse || auth.activeUserId !== options.accountId || auth.authUserId !== options.actorUserId) return { ok: false, status: 'blocked', message: 'L’établissement ou la session a changé.' };
      return { ok: true, status: 'ui_action_requested', uiCommand: { command: 'configure_application_preferences', selection: { kind: 'account_document', id: 'application_preferences' }, preference: input.preference, value: input.value }, message: 'Le changement de la préférence d’affichage est transmis au navigateur ; son résultat reste à confirmer.' };
    },
  }) };
}
