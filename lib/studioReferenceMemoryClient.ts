import type { AiMediaCharacterVoiceSample } from "./aiMediaCharacterVoices.ts";
import type { MediaGenerationInspirationImage, MediaGenerationReferenceRole, MediaGenerationReferenceUsage } from "./mediaGenerationClientRequest.ts";
import { normalizeStudioReferenceMemory, type StudioReferenceMemory, type StudioReferencesResponse } from "./studioReferences.ts";

export const STUDIO_REFERENCE_MEMORY_ENDPOINT = "/api/media-generation/references";
export const STUDIO_REFERENCE_MEMORY_EVENT = "inrcy:studio-reference-memory:v1";
export type StudioReferenceMemoryMetadata = { accountId: string; saved: boolean; fingerprint: string; origin: string; revision: number };
const memoryMetadata = new Map<string, StudioReferenceMemoryMetadata>();

export type StudioMemoryReference = MediaGenerationInspirationImage & {
  id: string;
  role?: MediaGenerationReferenceRole;
  usage?: MediaGenerationReferenceUsage;
  fromVideo: boolean;
  /** Private library identity, never included in a generation request. */
  libraryMediaId?: string;
};
export type StudioMemoryVoice = {
  id: string;
  sample: AiMediaCharacterVoiceSample;
  target: "narration" | { characterId: string } | null;
  gender: "auto" | "female" | "male";
};
export type StudioReferenceDraft = {
  references: StudioMemoryReference[];
  voices: StudioMemoryVoice[];
  activeNarrationVoiceId: string | null;
};

/** Temp WAV paths and uploaded-image identities do not change a saved draft. */
export function studioReferenceDraftFingerprint(draft: StudioReferenceDraft): string {
  return JSON.stringify({
    references: draft.references.map(reference => ({ id: reference.id, role: reference.role, usage: reference.usage,
      characterName: reference.characterName ?? "", voiceMode: reference.voiceMode ?? "ai" })),
    voices: draft.voices.map(voice => ({ id: voice.id, mediaId: voice.sample.libraryMediaId ?? voice.sample.path,
      target: voice.target, gender: voice.gender })),
    activeNarrationVoiceId: draft.activeNarrationVoiceId,
  });
}

/** Only saved/dirty metadata is shared between Image and Video; creative drafts stay independent. */
export function studioSavedReferenceFingerprint(memory: StudioReferenceMemory): string {
  return JSON.stringify({
    references: memory.references.map(reference => ({ id: reference.id, role: reference.role, usage: reference.usage,
      characterName: reference.characterName ?? "", voiceMode: reference.voiceMode })),
    voices: memory.voices.map(voice => ({ id: voice.id, mediaId: voice.libraryMediaId,
      target: voice.target && voice.target !== "narration" ? { characterId: voice.target.referenceId } : voice.target, gender: voice.gender })),
    activeNarrationVoiceId: memory.activeNarrationVoiceId,
  });
}
export function readStudioReferenceMemoryMetadata(accountId: string): StudioReferenceMemoryMetadata | undefined {
  return memoryMetadata.get(accountId);
}
export function publishStudioReferenceMemoryMetadata(accountId: string, memory: StudioReferenceMemory | null, origin: string): void {
  const metadata = { accountId, saved: Boolean(memory), fingerprint: memory ? studioSavedReferenceFingerprint(memory) : "", origin,
    revision: (memoryMetadata.get(accountId)?.revision ?? 0) + 1 };
  memoryMetadata.set(accountId, metadata);
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(STUDIO_REFERENCE_MEMORY_EVENT, { detail: metadata }));
}

type ScopedIo = { accountId: string; signal: AbortSignal; isCurrent: () => boolean };
function assertCurrent(scope: ScopedIo) {
  scope.signal.throwIfAborted();
  if (!scope.isCurrent()) throw new Error("studio_reference_memory_stale");
}
function headers(accountId: string) {
  return { "Content-Type": "application/json", "X-Inrcy-Account-Id": accountId };
}

export async function requestStudioReferenceMemory(method: "GET" | "PUT" | "DELETE", scope: ScopedIo, memory?: StudioReferenceMemory): Promise<StudioReferencesResponse> {
  assertCurrent(scope);
  const response = await fetch(STUDIO_REFERENCE_MEMORY_ENDPOINT, {
    method, credentials: "include", cache: "no-store", headers: headers(scope.accountId), signal: scope.signal,
    ...(method === "PUT" ? { body: JSON.stringify(memory) } : {}),
  });
  const body = await response.json().catch(() => null) as StudioReferencesResponse | null;
  assertCurrent(scope);
  if (!response.ok || body?.ok !== true || body.accountId !== scope.accountId || !Array.isArray(body.media) || !Array.isArray(body.unavailableMediaIds)) throw new Error("studio_reference_memory_unavailable");
  const normalized = body.memory === null ? null : normalizeStudioReferenceMemory(body.memory);
  if (method === "DELETE" && normalized !== null || method === "PUT" && JSON.stringify(normalized) !== JSON.stringify(memory)) throw new Error("studio_reference_memory_unconfirmed");
  body.memory = normalized;
  return body;
}

export function studioReferenceImageFile(reference: StudioMemoryReference): File {
  const extension = { "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp" }[reference.mimeType];
  if (!extension || !reference.data) throw new Error("studio_reference_memory_image_invalid");
  const bytes = Uint8Array.from(atob(reference.data), character => character.charCodeAt(0));
  const name = (reference.name || "reference").replace(/^.*[\\/]/, "").replace(/\.[^.]*$/, "").slice(0, 110);
  return new File([bytes], `${name || "reference"}${extension}`, { type: reference.mimeType });
}

/** Upload only on an explicit save; keep successful IDs even if a later upload fails. */
export async function prepareStudioReferenceMemory(draft: StudioReferenceDraft, scope: ScopedIo, upload: (file: File, reference: StudioMemoryReference) => Promise<string>, onUploaded: (id: string, mediaId: string) => void): Promise<StudioReferenceMemory> {
  assertCurrent(scope);
  if (!draft.references.length && !draft.voices.length) throw new Error("studio_reference_memory_empty");
  if (draft.references.some(reference => !reference.role || !reference.usage)) throw new Error("studio_reference_memory_incomplete");
  if (draft.voices.some(voice => !voice.sample.libraryMediaId)) throw new Error("studio_reference_memory_voice_unavailable");
  const voices = draft.voices.map(voice => ({ id: voice.id, libraryMediaId: voice.sample.libraryMediaId!,
    target: voice.target && voice.target !== "narration" ? { referenceId: voice.target.characterId } : voice.target, gender: voice.gender }));
  // Validate roles, names and links before uploading even the first image.
  normalizeStudioReferenceMemory({ version: 1, references: draft.references.map(reference => ({ id: reference.id,
    mediaLibraryId: reference.libraryMediaId ?? reference.id, role: reference.role, usage: reference.usage,
    ...(reference.characterName ? { characterName: reference.characterName } : {}), voiceMode: reference.voiceMode ?? "ai" })), voices,
    activeNarrationVoiceId: draft.activeNarrationVoiceId });
  const references: StudioReferenceMemory["references"] = [];
  for (const reference of draft.references) {
    assertCurrent(scope);
    const mediaLibraryId = reference.libraryMediaId ?? await upload(studioReferenceImageFile(reference), reference);
    assertCurrent(scope);
    if (!mediaLibraryId) throw new Error("studio_reference_memory_image_unavailable");
    if (!reference.libraryMediaId) onUploaded(reference.id, mediaLibraryId);
    references.push({ id: reference.id, mediaLibraryId, role: reference.role!, usage: reference.usage!,
      ...(reference.characterName ? { characterName: reference.characterName } : {}), voiceMode: reference.voiceMode ?? "ai" });
  }
  return normalizeStudioReferenceMemory({ version: 1, references, voices, activeNarrationVoiceId: draft.activeNarrationVoiceId })!;
}

/** IDs keep photos and dedicated voices together; no names or array positions are guessed. */
export async function hydrateStudioReferenceMemory(response: StudioReferencesResponse, scope: ScopedIo, prepareImage: (file: File) => Promise<MediaGenerationInspirationImage>): Promise<StudioReferenceDraft | null> {
  assertCurrent(scope);
  if (!response.memory) return null;
  if (response.accountId !== scope.accountId || response.unavailableMediaIds.length) throw new Error("studio_reference_memory_media_unavailable");
  const memory = response.memory;
  const references: StudioMemoryReference[] = [];
  const voices: StudioMemoryVoice[] = [];
  try {
    for (const reference of memory.references) {
      assertCurrent(scope);
      const media = response.media.find(item => item.id === reference.mediaLibraryId && item.media_type === "image");
      if (!media?.signed_url) throw new Error("studio_reference_memory_media_unavailable");
      const imageResponse = await fetch(media.signed_url, { cache: "no-store", signal: scope.signal });
      if (!imageResponse.ok) throw new Error("studio_reference_memory_media_unavailable");
      const blob = await imageResponse.blob();
      assertCurrent(scope);
      const image = await prepareImage(new File([blob], media.original_file_name || media.title || "reference.jpg", { type: blob.type || media.mime_type || "image/jpeg" }));
      assertCurrent(scope);
      references.push({ ...image, id: reference.id, libraryMediaId: reference.mediaLibraryId, role: reference.role, usage: reference.usage,
        voiceMode: reference.voiceMode, ...(reference.characterName ? { characterName: reference.characterName } : {}), fromVideo: false });
    }
    for (const voice of memory.voices) {
      assertCurrent(scope);
      const voiceResponse = await fetch("/api/media-generation/voice-reference", {
        method: "POST", credentials: "include", cache: "no-store", headers: headers(scope.accountId), signal: scope.signal,
        body: JSON.stringify({ mediaLibraryId: voice.libraryMediaId }),
      });
      const body = await voiceResponse.json().catch(() => null);
      // A late WAV belongs to this attempt only, never the new active account.
      if (body?.ok && body.sample?.path) voices.push({ id: voice.id, sample: body.sample as AiMediaCharacterVoiceSample,
        target: voice.target && voice.target !== "narration" ? { characterId: voice.target.referenceId } : voice.target, gender: voice.gender });
      assertCurrent(scope);
      if (!voiceResponse.ok || body?.ok !== true || !body.sample?.path || body.sample.libraryMediaId !== voice.libraryMediaId) throw new Error("studio_reference_memory_voice_unavailable");
    }
    return { references, voices, activeNarrationVoiceId: memory.activeNarrationVoiceId };
  } catch (error) {
    // Cleanup is deliberately scoped to a sample path, never its permanent library source.
    await Promise.allSettled(voices.map(voice => fetch(`/api/media-generation/voice-reference?path=${encodeURIComponent(voice.sample.path)}`, {
      method: "DELETE", credentials: "include", cache: "no-store", headers: { "X-Inrcy-Account-Id": scope.accountId },
    })));
    throw error;
  }
}
