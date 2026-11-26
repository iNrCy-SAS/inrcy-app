import type {
  MediaGenerationFormat,
  MediaGenerationKind,
  MediaGenerationNarrationVoice,
  MediaGenerationNarrationVoiceVariant,
  MediaGenerationVideoSceneMode,
} from "./mediaGenerationClientRequest";
import type { MediaExactDialogueRow } from "./mediaExactDialogueEditor";
import type { StudioReferenceDraft } from "./studioReferenceMemoryClient";

export type StudioWorkingPanel = StudioReferenceDraft & {
  format: MediaGenerationFormat;
  useBusinessDna: boolean;
  duration: number;
  sceneMode: MediaGenerationVideoSceneMode;
  withMusic: boolean;
  soundtrackId: string | null;
  spokenScript: string;
  spokenScriptOpen: boolean;
  exactRows: MediaExactDialogueRow[];
  withSubtitles: boolean;
  speechMode: "voiceover" | "characters" | "silent";
  voice: MediaGenerationNarrationVoice;
  voiceVariant: MediaGenerationNarrationVoiceVariant;
  voiceSourcePreference: "ai" | "provided";
  voiceReferenceId: string | null;
};

export type StudioWorkingDraft = {
  prompt: string;
  mediaType: MediaGenerationKind;
  panels: Partial<Record<MediaGenerationKind, StudioWorkingPanel | null>>;
};

const CACHE = "inrcy-studio-working-draft-v1";
const MAX_AGE_MS = 24 * 60 * 60 * 1000;
type DraftWrite = { next: StudioWorkingDraft | null | undefined; done: Promise<void> };
const pendingWrites = new Map<string, DraftWrite>();

function draftRequest(key: string) {
  return new Request(`${window.location.origin}/__inrcy_studio_working_draft__/${encodeURIComponent(key)}`);
}

export async function readStudioWorkingDraft(key: string): Promise<StudioWorkingDraft | null> {
  await pendingWrites.get(key)?.done;
  try {
    const cache = await window.caches.open(CACHE);
    const request = draftRequest(key);
    const response = await cache.match(request);
    if (!response) return null;
    const entry = await response.json();
    if (typeof entry?.savedAt === "number" && Date.now() - entry.savedAt <= MAX_AGE_MS &&
        typeof entry.draft?.prompt === "string" && ["image", "video"].includes(entry.draft.mediaType) && entry.draft.panels) {
      return entry.draft;
    }
    await cache.delete(request);
  } catch {
    // Privacy modes can disable browser storage. The exit confirmation still works.
  }
  return null;
}

/** Keep one atomic revision and coalesce edits while a write is in flight. */
export function saveStudioWorkingDraft(key: string, draft: StudioWorkingDraft | null) {
  const pending = pendingWrites.get(key);
  if (pending) {
    pending.next = draft;
    return pending.done;
  }
  const write: DraftWrite = { next: draft, done: Promise.resolve() };
  pendingWrites.set(key, write);
  write.done = Promise.resolve().then(async () => {
    try {
      const cache = await window.caches.open(CACHE);
      const request = draftRequest(key);
      while (write.next !== undefined) {
        const next = write.next;
        write.next = undefined;
        if (next) await cache.put(request, Response.json({ savedAt: Date.now(), draft: next }));
        else await cache.delete(request);
      }
    } catch {
      // Keep editing and the confirmation available if the browser rejects storage.
    } finally {
      pendingWrites.delete(key);
    }
  });
  return write.done;
}
