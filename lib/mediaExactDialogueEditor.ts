import { normalizeAiMediaCharacterName } from './aiMediaCharacterVoices.ts';
import type { AiMediaExactDialogueTurn } from './aiMediaExactDialogue.ts';
import { getAiMediaVideoSpeechState, type AiMediaVideoSpeechBudgetInput } from './aiMediaVideoSpeechBudget.ts';

export const MEDIA_EXACT_DIALOGUE_MAX_ROWS = 12;
export const MEDIA_EXACT_DIALOGUE_MAX_CHARS = 4_000;
export type MediaExactDialogueRow = { id: string; speaker: 'ai_voice' | 'provided_voice' | 'character' | 'unassigned'; characterId?: string; text: string };
export type MediaExactDialogueCharacter = { id: string; characterIndex: 1 | 2 | 3; referenceIndex: number; name?: string; preview?: string; voiceLabel?: string };

export function buildMediaExactDialogueCharacters(references: readonly { id: string; role?: string; characterName?: string }[]): MediaExactDialogueCharacter[] {
  return references.flatMap((reference, referenceIndex) => reference.role === 'character' ? [{
    id: reference.id, referenceIndex, characterIndex: 1 as 1 | 2 | 3, name: reference.characterName,
  }] : []).slice(0, 3).map((character, index) => ({ ...character, characterIndex: index + 1 as 1 | 2 | 3 }));
}

export function countMediaExactDialogueCharacters(rows: readonly MediaExactDialogueRow[]) {
  return rows.reduce((sum, row) => sum + row.text.length, Math.max(0, rows.length - 1));
}

/** Display the current duration's speech allowance even before the first word.
 * This does not replace structured target validation or generation preflight. */
export function getMediaExactDialogueDisplayBudget(rows: readonly MediaExactDialogueRow[], input: Pick<AiMediaVideoSpeechBudgetInput, 'durationSeconds' | 'videoEngine' | 'videoResolution' | 'sceneMode' | 'language'>) {
  const script = rows.map(row => row.text).join('\n');
  return getAiMediaVideoSpeechState({ ...input, kind: 'video', creationMode: 'free', freePrompt: '',
    ...(script.trim() ? { spokenScript: script } : {}), withNarration: true,
    teamVideoSpeechMode: rows.some(row => row.speaker === 'character') ? 'characters' : 'voiceover' });
}

export function createMediaExactDialogueRow(speaker: MediaExactDialogueRow['speaker'] = 'ai_voice', text = ''): MediaExactDialogueRow {
  return { id: globalThis.crypto.randomUUID(), speaker, text };
}

/** Enter Exact without changing existing speech or assigning a different person by index. */
export function initializeMediaExactDialogueRows(rows: readonly MediaExactDialogueRow[], legacyScript: string, characters: readonly MediaExactDialogueCharacter[], defaults: {
  speechMode: 'characters' | 'voiceover' | 'silent'; characterId?: string | null; narrationVoiceMode?: 'ai' | 'provided';
}): MediaExactDialogueRow[] {
  if (rows.length) return [...rows];
  const imported = importMediaExactDialogueText(legacyScript, characters);
  if (imported.length) return imported;
  if (defaults.speechMode === 'characters') {
    const character = defaults.characterId ? characters.find(character => character.id === defaults.characterId) : characters[0];
    return character ? [{ ...createMediaExactDialogueRow('character'), characterId: character.id }] : [createMediaExactDialogueRow('unassigned')];
  }
  return [createMediaExactDialogueRow(defaults.narrationVoiceMode === 'provided' ? 'provided_voice' : 'ai_voice')];
}

/** The global speech choice is explicit. Narration never destroys dormant photo bindings. */
export function projectMediaExactDialogueRows(rows: readonly MediaExactDialogueRow[], speechMode: 'characters' | 'voiceover' | 'silent', narrationVoiceMode: 'ai' | 'provided'): MediaExactDialogueRow[] {
  if (speechMode === 'silent') return [];
  if (speechMode === 'characters') return [...rows];
  return rows.map(row => ({ ...row, speaker: narrationVoiceMode === 'provided' ? 'provided_voice' : 'ai_voice', characterId: undefined }));
}

/** Apply text, order and row changes from the effective editor to the same stable draft IDs. */
export function mergeMediaExactDialogueRows(previous: readonly MediaExactDialogueRow[], edited: readonly MediaExactDialogueRow[], speechMode: 'characters' | 'voiceover' | 'silent'): MediaExactDialogueRow[] {
  if (speechMode !== 'voiceover') return [...edited];
  const byId = new Map(previous.map(row => [row.id, row]));
  return edited.map(row => {
    const saved = byId.get(row.id);
    return saved ? { ...saved, text: row.text } : { ...row };
  });
}

/** Keep photo IDs in drafts. Their current numbered slots are used only on send. */
export function serializeMediaExactDialogueRows(rows: readonly MediaExactDialogueRow[], characters: readonly MediaExactDialogueCharacter[]) {
  const turns: AiMediaExactDialogueTurn[] = [];
  if (!rows.length || rows.some(row => !row.text.trim())) return { turns, issue: 'empty' as const };
  if (rows.length > MEDIA_EXACT_DIALOGUE_MAX_ROWS || new Set(rows.map(row => row.id)).size !== rows.length ||
    countMediaExactDialogueCharacters(rows) > MEDIA_EXACT_DIALOGUE_MAX_CHARS) return { turns, issue: 'too_long' as const };
  if (rows.some(row => row.speaker === 'provided_voice') && rows.some(row => row.speaker !== 'provided_voice')) return { turns, issue: 'provided_mix' as const };
  for (const row of rows) {
    if (row.speaker === 'unassigned') return { turns: [], issue: 'unassigned' as const };
    if (row.speaker === 'ai_voice') { turns.push({ speaker: 'ai_voice', text: row.text }); continue; }
    if (row.speaker === 'provided_voice') { turns.push({ speaker: 'provided_voice', text: row.text }); continue; }
    const character = characters.find(item => item.id === row.characterId);
    if (!character) return { turns: [], issue: 'missing_character' as const };
    turns.push({ speaker: 'character', characterIndex: character.characterIndex, text: row.text });
  }
  return { turns, issue: null };
}

/** Legacy text is never discarded or assigned by guessing a name or a filename. */
export function importMediaExactDialogueText(script: string, characters: readonly MediaExactDialogueCharacter[]): MediaExactDialogueRow[] {
  if (!script) return [];
  const matches = [...script.matchAll(/(?:^|\n)[ \t]*([\p{L}][\p{L}\p{M}\p{N} '’_()\-]{0,69}?)\s*:[ \t]*/gu)];
  if (!matches.length || script.slice(0, matches[0].index).trim()) return [createMediaExactDialogueRow('unassigned', script)];
  const result: MediaExactDialogueRow[] = [];
  for (const [index, match] of matches.entries()) {
    const label = match[1].trim(), explicit = /^(?:personnage|character)\s*([1-3])$/iu.exec(label);
    const named = /^(.{1,40}?)\s*\((?:personnage|character)\s*([1-3])\)$/iu.exec(label);
    const normalized = normalizeAiMediaCharacterName(named ? named[1] : label)?.toLowerCase();
    const candidates = explicit || named
      ? characters.filter(character => character.characterIndex === Number(explicit?.[1] ?? named?.[2]))
      : characters.filter(character => normalized && normalizeAiMediaCharacterName(character.name ?? '')?.toLowerCase() === normalized);
    if (candidates.length !== 1) return [createMediaExactDialogueRow('unassigned', script)];
    const text = script.slice(match.index! + match[0].length, matches[index + 1]?.index ?? script.length);
    result.push({ ...createMediaExactDialogueRow('character', text), characterId: candidates[0].id });
  }
  return result;
}
