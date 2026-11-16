import { normalizeAiMediaCharacterName } from './aiMediaCharacterVoices.ts';

export const STUDIO_REFERENCES_VERSION = 1 as const;
export const STUDIO_REFERENCES_NAMESPACE = 'studio_references' as const;
export const STUDIO_REFERENCES_ACCOUNT_HEADER = 'X-Inrcy-Account-Id';
export const STUDIO_REFERENCES_MAX_BODY_BYTES = 12_000;
export type StudioReferenceRole = 'character' | 'environment' | 'product' | 'inspiration';
export type StudioReferenceMemory = {
  version: 1;
  references: Array<{ id: string; mediaLibraryId: string; role: StudioReferenceRole; usage: 'required' | 'inspiration'; characterName?: string; voiceMode: 'ai' | 'provided' }>;
  voices: Array<{ id: string; libraryMediaId: string; target: null | 'narration' | { referenceId: string }; gender: 'auto' | 'female' | 'male' }>;
  activeNarrationVoiceId: string | null;
};
export type StudioReferenceMedia = {
  id: string; media_type: 'image' | 'audio'; mime_type: string | null; title: string | null; original_file_name: string | null;
  signed_url: string | null; size_bytes: number | null; width: number | null; height: number | null; duration_seconds: number | null;
};
export type StudioReferencesResponse = { ok: true; accountId: string; memory: StudioReferenceMemory | null; media: StudioReferenceMedia[]; unavailableMediaIds: string[] };

export class StudioReferencesValidationError extends Error {
  constructor() { super('studio_references_invalid'); this.name = 'StudioReferencesValidationError'; }
}
export class StudioReferencesVersionError extends Error {
  constructor() { super('studio_references_version_unsupported'); this.name = 'StudioReferencesVersionError'; }
}
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export const isStudioReferenceId = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);
function invalid(): never { throw new StudioReferencesValidationError(); }
function object(value: unknown, keys: readonly string[]) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return invalid();
  const row = value as Record<string, unknown>;
  if (Object.keys(row).some(key => !keys.includes(key))) return invalid();
  return row;
}
function id(value: unknown) { return isStudioReferenceId(value) ? value.toLowerCase() : invalid(); }

/** The durable contract accepts library IDs only, never bytes, URLs, consent or temporary paths. */
export function normalizeStudioReferenceMemory(value: unknown): StudioReferenceMemory {
  const row = object(value, ['version', 'references', 'voices', 'activeNarrationVoiceId']);
  if (row.version !== 1) throw new StudioReferencesVersionError();
  if (!Array.isArray(row.references) || row.references.length > 5 || !Array.isArray(row.voices) || row.voices.length > 3) return invalid();
  const references: StudioReferenceMemory['references'] = row.references.map(value => {
    const item = object(value, ['id', 'mediaLibraryId', 'role', 'usage', 'characterName', 'voiceMode']);
    if (typeof item.role !== 'string' || !['character', 'environment', 'product', 'inspiration'].includes(item.role) ||
      typeof item.usage !== 'string' || !['required', 'inspiration'].includes(item.usage) || typeof item.voiceMode !== 'string' || !['ai', 'provided'].includes(item.voiceMode)) return invalid();
    const characterName = item.characterName === undefined ? undefined : normalizeAiMediaCharacterName(item.characterName);
    if (characterName === null || item.role !== 'character' && (Boolean(characterName) || item.voiceMode !== 'ai')) return invalid();
    return { id: id(item.id), mediaLibraryId: id(item.mediaLibraryId), role: item.role as StudioReferenceRole,
      usage: item.usage as 'required' | 'inspiration', voiceMode: item.voiceMode as 'ai' | 'provided', ...(characterName ? { characterName } : {}) };
  });
  if (new Set(references.map(item => item.id)).size !== references.length || references.filter(item => item.role === 'character').length > 3) return invalid();
  const names = references.flatMap(item => item.characterName ? [item.characterName.toLowerCase()] : []);
  if (new Set(names).size !== names.length) return invalid();
  const voices: StudioReferenceMemory['voices'] = row.voices.map(value => {
    const item = object(value, ['id', 'libraryMediaId', 'target', 'gender']);
    if (typeof item.gender !== 'string' || !['auto', 'female', 'male'].includes(item.gender)) return invalid();
    let target: StudioReferenceMemory['voices'][number]['target'];
    if (item.target === null || item.target === 'narration') target = item.target;
    else { const assigned = object(item.target, ['referenceId']); target = { referenceId: id(assigned.referenceId) }; }
    return { id: id(item.id), libraryMediaId: id(item.libraryMediaId), target, gender: item.gender as 'auto' | 'female' | 'male' };
  });
  if (new Set(voices.map(item => item.id)).size !== voices.length) return invalid();
  const targets = voices.flatMap(item => item.target && typeof item.target === 'object' ? [item.target.referenceId] : []);
  if (new Set(targets).size !== targets.length || targets.some(target => !references.some(reference => reference.id === target && reference.role === 'character' && reference.voiceMode === 'provided'))) return invalid();
  if (references.some(reference => reference.voiceMode === 'provided' && !targets.includes(reference.id))) return invalid();
  const activeNarrationVoiceId = row.activeNarrationVoiceId === null ? null : id(row.activeNarrationVoiceId);
  if (activeNarrationVoiceId && !voices.some(voice => voice.id === activeNarrationVoiceId && voice.target === 'narration')) return invalid();
  return { version: 1, references, voices, activeNarrationVoiceId };
}

export function getStudioReferenceMediaIds(memory: StudioReferenceMemory): string[] {
  return [...new Set([...memory.references.map(reference => reference.mediaLibraryId), ...memory.voices.map(voice => voice.libraryMediaId)])];
}
