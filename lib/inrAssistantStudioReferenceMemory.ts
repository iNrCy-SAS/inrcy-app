import { inrAssistantClauseIsAdvice, inrAssistantUnquotedRequest } from './inrAssistantRequestClauses.ts';

/** Persist only the mounted account's selected references, never guessed assets. */
export function requestedStudioReferenceMemoryAction(message: string): 'remember' | 'forget' | null {
  if (message.length > 1200) return null;
  const text = inrAssistantUnquotedRequest(message);
  if (inrAssistantClauseIsAdvice(text) || /\b(?:pas|jamais|non|si|ou|soit|quand|apres|avant|demain|hier|not|never|if|when)\b|\bn['’]|[\r\n]|[.!;]\s+\S/.test(text)) return null;
  if (!/\b(?:studio|inrstudio)\b/.test(text) || !/\b(?:medias|references|personnages|photos|vocaux|voix)\b/.test(text)) return null;
  if (/\b(?:autre|tous|chaque)\b.{0,20}\bcomptes?\b|\b(?:publie|genere|importe|supprime)\w*\b/.test(text)) return null;
  // The mounted interface cannot resolve a named account from free text.
  if (/\bcomptes?\b/.test(text)) return null;
  const wantsRemember = /\b(?:memorise(?:z)?|retiens|retenez|sauvegarde(?:z)?|mets? a jour|mettez a jour)\b/.test(text);
  const wantsForget = /\b(?:oublie(?:z)?|retire(?:z)?|efface(?:z)?)\b/.test(text);
  if (wantsRemember && wantsForget) return null;
  const direct = text.replace(/^(?:dans|sur)\s+(?:le|mon)\s+(?:studio|inrstudio)(?:\s+libre)?\s*[,;:]?\s*/, '')
    .replace(/^(?:(?:peux|pourrais)[ -]tu|(?:pouvez|pourriez)[ -]vous)\s+/, '');
  if (/^(?:oublie(?:z)?|retire(?:z)?|efface(?:z)?)\b/.test(direct)) {
    return /\b(?:memoire|memorisation|memorises?|memorisees?)\b/.test(text) ? 'forget' : null;
  }
  if (/^(?:memorise(?:z)?|retiens|retenez|sauvegarde(?:z)?|mets? a jour|mettez a jour)\b/.test(direct)) {
    return /\b(?:selection|selectionnes?|selectionnees?|actuels?|actuelles?|affiches?|affichees?|memoire|memorisation)\b/.test(text) ? 'remember' : null;
  }
  return null;
}
