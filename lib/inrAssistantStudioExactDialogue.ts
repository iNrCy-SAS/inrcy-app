import { AI_MEDIA_EXACT_DIALOGUE_MAX_CHARS, AI_MEDIA_EXACT_DIALOGUE_MAX_TURNS } from './aiMediaExactDialogue.ts';
import { inrAssistantClauseIsAdvice, inrAssistantMaskQuotedText, inrAssistantRequestClauses } from './inrAssistantRequestClauses.ts';

export const INR_ASSISTANT_STUDIO_EXACT_DIALOGUE_MAX_ROWS = AI_MEDIA_EXACT_DIALOGUE_MAX_TURNS;
export type InrAssistantStudioExactDialogueSelection =
  | { field: 'add' }
  | { field: 'text'; rowIndex: number; value: string }
  | { field: 'speaker'; rowIndex: number; value: 'ai_voice' | 'provided_voice' | `character:${0 | 1 | 2}` }
  | { field: 'remove'; rowIndex: number }
  | { field: 'move'; rowIndex: number; value: 'up' | 'down' };

/** Only draft dialogue controls; no provider, file, consent or generation operation. */
export function parseInrAssistantStudioExactDialogueSelection(encoded: unknown): InrAssistantStudioExactDialogueSelection | null {
  if (typeof encoded !== 'string' || encoded.length > 25000) return null;
  let raw: unknown;
  try { raw = JSON.parse(encoded); } catch { return null; }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const row = raw as Record<string, unknown>;
  const keys = Object.keys(row);
  if (row.field === 'add') return keys.length === 1 ? { field: 'add' } : null;
  if (!Number.isInteger(row.rowIndex) || Number(row.rowIndex) < 0 || Number(row.rowIndex) >= INR_ASSISTANT_STUDIO_EXACT_DIALOGUE_MAX_ROWS) return null;
  const rowIndex = Number(row.rowIndex);
  if (row.field === 'remove') return keys.length === 2 && keys.includes('rowIndex') ? { field: 'remove', rowIndex } : null;
  if (keys.length !== 3 || !keys.includes('value') || typeof row.value !== 'string') return null;
  if (row.field === 'text') return row.value.length <= AI_MEDIA_EXACT_DIALOGUE_MAX_CHARS ? { field: 'text', rowIndex, value: row.value } : null;
  if (row.field === 'speaker') return ['ai_voice', 'provided_voice'].includes(row.value) || /^character:[0-2]$/.test(row.value) ? { field: 'speaker', rowIndex, value: row.value as 'ai_voice' | 'provided_voice' | `character:${0 | 1 | 2}` } : null;
  if (row.field === 'move') return row.value === 'up' || row.value === 'down' ? { field: 'move', rowIndex, value: row.value } : null;
  return null;
}

function directive(message: string): string | null {
  if (message.length > 10000) return null;
  const text = inrAssistantMaskQuotedText(message).normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().trim();
  const command = message.replace(/^(?:dans|sur)\s+(?:le|mon)\s+studio(?:\s+(?:libre|guidé|guide))?\s*[,;:]?\s*/iu, '');
  if (inrAssistantRequestClauses(command).length !== 1) return null;
  if (!/\bstudio\b/.test(text) || !/\bparoles?\s+exactes?\b|\bdialogue\b/.test(text) || inrAssistantClauseIsAdvice(text)) return null;
  if (/\b(?:pas|jamais|ne|non|si|ou|soit|comment|pourquoi|hier|demain|quand|apres|avant|sans|not|never|if|when)\b|\bn['’]|\?|[\r\n]|[.!;]\s+\S/.test(text)) return null;
  return text.replace(/^(?:dans|sur)\s+(?:le|mon)\s+studio(?:\s+(?:libre|guide))?\s*[,;:]?\s*/, '')
    .replace(/^(?:(?:peux|pourrais)[ -]tu|(?:pouvez|pourriez)[ -]vous)\s+/, '');
}

/** Quoted text is literal data. Only the unquoted current directive grants a draft edit. */
export function isInrAssistantStudioExactDialogueRequest(message: string, operation: 'open' | 'close' | 'select'): boolean {
  const text = directive(message);
  if (!text) return false;
  if (operation === 'open') return /^(?:ouvre\w*|affiche\w*|montre\w*)\b/.test(text);
  if (operation === 'close') return /^(?:ferme\w*|referme\w*|masque\w*)\b/.test(text);
  return /^(?:mets|mettez|renseigne\w*|ecris|ecrivez|remplace\w*|modifie\w*|change\w*|choisis|selectionne\w*|affecte\w*|associe\w*|ajoute\w*|supprime\w*|retire\w*|deplace\w*|monte\w*|remonte\w*|descends?|descendez)\b/.test(text);
}

function exactLiteralRequested(message: string, value: string): boolean {
  const quoted = [...message.matchAll(/«([\s\S]*?)»|“([\s\S]*?)”|"([\s\S]*?)"|‘([\s\S]*?)’|(?<![\p{L}\p{N}])'([^'\r\n]*)'(?![\p{L}\p{N}])/gu)]
    .map(match => match.slice(1).find(part => part !== undefined));
  if (quoted.length) return quoted.length === 1 && (quoted[0] === value || value === value.trim() && quoted[0]?.trim() === value);
  if (!value || !message.endsWith(value)) return false;
  const prefix = message.slice(0, -value.length);
  return /(?:\s(?:à|avec)|[:=])\s*$/.test(prefix);
}

export function isInrAssistantStudioExactDialogueValueRequested(message: string, operation: 'open' | 'close' | 'select', encoded: string | null): boolean {
  if (!isInrAssistantStudioExactDialogueRequest(message, operation)) return false;
  if (operation !== 'select') return encoded === null;
  const selection = parseInrAssistantStudioExactDialogueSelection(encoded);
  const text = directive(message)!;
  if (!selection) return false;
  const indices = [...text.matchAll(/\b(?:ligne|replique)\s*(?:n[°o]?\.?\s*)?(\d+)\b/g)].map(match => Number(match[1]) - 1);
  if (selection.field === 'add') return indices.length === 0 && /^ajoute\w*\b/.test(text) && /\b(?:une|1)\s+(?:nouvelle\s+)?ligne\s+vide\b/.test(text) && /\b(?:a la fin|en fin|en dernier)\b/.test(text);
  if (indices.length !== 1 || indices[0] !== selection.rowIndex) return false;
  if (selection.field === 'remove') return /^(?:supprime\w*|retire\w*)\b/.test(text);
  if (selection.field === 'move') {
    if (!/^(?:deplace\w*|monte\w*|remonte\w*|descends?|descendez)\b/.test(text)) return false;
    const up = /\b(?:monte\w*|remonte\w*)\b|\bvers le haut\b/.test(text);
    const down = /\b(?:descends?|descendez)\b|\bvers le bas\b/.test(text);
    return up !== down && selection.value === (up ? 'up' : 'down');
  }
  if (selection.field === 'text') return /\b(?:texte|paroles?|replique)\b/.test(text) && /^(?:mets|mettez|renseigne\w*|ecris|ecrivez|remplace\w*|modifie\w*|change\w*)\b/.test(text) && exactLiteralRequested(message, selection.value);
  if (!/^(?:mets|mettez|modifie\w*|change\w*|choisis|selectionne\w*|affecte\w*|associe\w*)\b/.test(text)) return false;
  const characters = [...text.matchAll(/\bpersonnage\s*(?:n[°o]?\.?\s*)?(\d+)\b/g)].map(match => Number(match[1]) - 1);
  const aiVoice = /\b(?:voix\s+off\s+ia|narration\s+ia)\b/.test(text);
  const providedVoice = /\bvoix\s+(?:off\s+)?reelle\b/.test(text);
  if (!/\b(?:locuteur|voix|personnage)\b/.test(text)) return false;
  if (selection.value === 'provided_voice') return providedVoice && !aiVoice && characters.length === 0;
  return selection.value === 'ai_voice' ? aiVoice && !providedVoice && characters.length === 0 : !aiVoice && !providedVoice && characters.length === 1 && selection.value === `character:${characters[0]}`;
}
