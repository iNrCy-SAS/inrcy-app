import { APP_LANGUAGE_OPTIONS, APP_LANGUAGE_EVENT, type AppLanguageCode } from './appLanguage.ts';
import { APP_APPEARANCE_THEMES, type AppAppearanceTheme } from './appAppearanceTheme.ts';
import { inrAssistantMaskQuotedText, inrAssistantClauseIsAdvice } from './inrAssistantRequestClauses.ts';

export type InrAssistantApplicationPreferenceCommand = {
  command: 'configure_application_preferences';
  selection: { kind: 'account_document'; id: 'application_preferences' };
  preference: 'language' | 'theme'; value: string;
};
const plain = (value: string) => value.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase();
const languageAliases: Record<AppLanguageCode, readonly string[]> = { fr: ['fr', 'francais', 'french'], en: ['en', 'anglais', 'english'], es: ['es', 'espagnol', 'spanish'], it: ['it', 'italien', 'italian'], de: ['de', 'allemand', 'german'], nl: ['nl', 'neerlandais', 'dutch'], pt: ['pt', 'portugais', 'portuguese'], th: ['th', 'thai', 'thailandais', 'ไทย'], zh: ['zh', 'chinois', 'chinese', '中文'] };
export function parseInrAssistantApplicationPreferenceCommand(value: unknown): InrAssistantApplicationPreferenceCommand | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>, selection = row.selection as Record<string, unknown> | undefined;
  if (row.command !== 'configure_application_preferences' || selection?.kind !== 'account_document' || selection.id !== 'application_preferences' || typeof row.value !== 'string') return null;
  if (row.preference === 'theme' && APP_APPEARANCE_THEMES.includes(row.value as AppAppearanceTheme) || row.preference === 'language' && APP_LANGUAGE_OPTIONS.some(option => option.value === row.value)) return { command: row.command, selection: { kind: 'account_document', id: 'application_preferences' }, preference: row.preference as 'language' | 'theme', value: row.value };
  return null;
}
/** Only this application's display language/appearance. AI writing language,
 * Badge theme, post colors and quoted third-party requests are different objects. */
export function isInrAssistantApplicationPreferenceRequest(message: string): boolean {
  const clean = inrAssistantMaskQuotedText(message), text = plain(clean).trim();
  return !inrAssistantClauseIsAdvice(text) && !/\b(?:si|if|quand|when|apres|avant|demain|later|sans|never|not)\b|\bne\b.{0,50}\bpas\b|\bn['’]/.test(text)
    && /^(?:(?:(?:peux|pourrais)[ -]tu|(?:pouvez|pourriez)[ -]vous)\s+(?:me\s+|m['’]|nous\s+)?)?(?:mets|mettez|mettre|passe|passez|passer|change|changez|changer|modifie|modifiez|modifier|affiche|affichez|afficher|utilise|utilisez|utiliser|set|switch)\b/.test(text)
    && /\b(?:application|appli|interface|inrcy|app)\b/.test(text)
    && /\b(?:langue|language|theme|apparence|appearance)\b/.test(text)
    && !/\b(?:publication|post|image|photo|badge|widget|redaction|contenu|configuration ia)\b/.test(text);
}
export function applicationPreferenceValueRequested(message: string, preference: 'theme' | 'language', value: string): boolean {
  if (!isInrAssistantApplicationPreferenceRequest(message)) return false;
  const text = plain(message);
  const aliases = preference === 'language' ? languageAliases[value as AppLanguageCode] ?? [] : [value, value.replaceAll('-', ' ')];
  return aliases.some(alias => alias.length > 2 && text.includes(alias))
    || preference === 'language' && new RegExp(`(?:code|langue|language)\\s*[:=]\\s*${value}(?:$|[^a-z])`).test(text);
}
type BrowserPorts = {
  saveTheme(value: AppAppearanceTheme): void;
  readTheme(): string;
  persistLanguage(value: AppLanguageCode): Promise<boolean>;
  applyLanguage(value: AppLanguageCode): void;
  readLanguage(): string;
};
/** Injectable native ports allow testing saturation, stale scope and failed
 * readback without a provider write. The normal UI ACK is still mandatory. */
export async function executeInrAssistantApplicationPreference(command: InrAssistantApplicationPreferenceCommand, stillCurrent: () => boolean, ports: BrowserPorts): Promise<boolean> {
  if (!parseInrAssistantApplicationPreferenceCommand(command) || !stillCurrent()) return false;
  if (command.preference === 'theme') {
    ports.saveTheme(command.value as AppAppearanceTheme);
    return stillCurrent() && ports.readTheme() === command.value;
  }
  if (!await ports.persistLanguage(command.value as AppLanguageCode) || !stillCurrent()) return false;
  ports.applyLanguage(command.value as AppLanguageCode);
  return stillCurrent() && ports.readLanguage() === command.value;
}
export async function applyNativeInrAssistantApplicationPreference(command: InrAssistantApplicationPreferenceCommand, accountId: string, actorUserId: string, stillCurrent: () => boolean): Promise<boolean> {
  const theme = await import('./appAppearanceTheme.ts');
  const { persistBrowserAppLocale } = await import('../i18n/client-locale');
  const { APP_LANGUAGE_TO_LOCALE } = await import('../i18n/config');
  const { rememberVerifiedDashboardLanguage } = await import('../app/dashboard/_hooks/useDashboardLanguage');
  return executeInrAssistantApplicationPreference(command, stillCurrent, {
    saveTheme: value => { theme.saveAppAppearanceTheme(value); },
    readTheme: () => document.documentElement.dataset.inrcyTheme ?? '',
    async persistLanguage(value) {
      const { createClient } = await import('./supabaseClient');
      const db = createClient(), auth = await db.auth.getUser();
      if (auth.error || auth.data.user?.id !== actorUserId || !stillCurrent()) return false;
      const saved = await db.from('business_profiles').upsert({ user_id: accountId, app_language: value, updated_at: new Date().toISOString() }, { onConflict: 'user_id' });
      if (saved.error || !stillCurrent()) return false;
      const read = await db.from('business_profiles').select('app_language').eq('user_id', accountId).maybeSingle();
      if (read.error || read.data?.app_language !== value || !stillCurrent()) return false;
      rememberVerifiedDashboardLanguage(accountId, value);
      return true;
    },
    applyLanguage(value) {
      // Cookie/local storage/event use the same native sources as the language selector.
      persistBrowserAppLocale(APP_LANGUAGE_TO_LOCALE[value]);
      window.dispatchEvent(new CustomEvent(APP_LANGUAGE_EVENT, { detail: { language: value, appLanguage: value } }));
    },
    readLanguage: () => document.documentElement.lang.split('-')[0],
  });
}
