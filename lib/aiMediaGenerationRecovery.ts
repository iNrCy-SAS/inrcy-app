export type AiMediaGenerationRecoveryPointer = {
  requestId: string;
  kind: "image" | "video";
  format: "square" | "portrait" | "story" | "landscape";
  /** Set only after success; allows acceptance/discard to clear this exact result. */
  mediaId?: string;
};
type RecoveryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
/** Keep attempts from older session-only releases recoverable during upgrades. */
export function createAiMediaRecoveryStorage(primary: RecoveryStorage | null, legacy: RecoveryStorage | null): RecoveryStorage | null {
  if (!primary && !legacy) return null;
  return {
    getItem(key) {
      let current: string | null = null; let previous: string | null = null;
      try { current = primary?.getItem(key) ?? null; } catch { /* Storage may be blocked. */ }
      try { previous = legacy?.getItem(key) ?? null; } catch { /* Storage may be blocked. */ }
      const savedAt = (value: string | null) => {
        try { const time = JSON.parse(value || "null")?.savedAt; return Number.isFinite(time) ? Number(time) : 0; } catch { return -1; }
      };
      if (previous && (!current || savedAt(previous) >= savedAt(current))) return previous;
      return current;
    },
    setItem(key, value) {
      if (primary) {
        try {
          primary.setItem(key, value);
          try { legacy?.removeItem(key); } catch { /* Best effort migration. */ }
          return;
        } catch {
          // Do not let an old persistent entry mask the new session fallback.
          try { primary.removeItem(key); } catch { /* savedAt still orders both entries. */ }
        }
      }
      legacy?.setItem(key, value);
    },
    removeItem(key) {
      try { primary?.removeItem(key); } catch { /* Best effort. */ }
      try { legacy?.removeItem(key); } catch { /* Best effort. */ }
    },
  };
}
const PREFIX = "inrcy:media-generation-recovery:v1:";
const REQUEST_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{7,179}$/i;
const MEDIA_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{0,179}$/i;

/** Per-account pointer only: never persist prompts, criteria or reference data. */
export function readAiMediaGenerationRecovery(storage: RecoveryStorage | null, accountId: string): AiMediaGenerationRecoveryPointer | null {
  if (!storage || !accountId) return null;
  try {
    const value = JSON.parse(storage.getItem(`${PREFIX}${encodeURIComponent(accountId)}`) || "null");
    if (value?.version !== 1 || typeof value.requestId !== "string" || !REQUEST_KEY_PATTERN.test(value.requestId) ||
      !["image", "video"].includes(value.kind) || !["square", "portrait", "story", "landscape"].includes(value.format)) return null;
    return { requestId: value.requestId, kind: value.kind, format: value.format,
      ...(typeof value.mediaId === "string" && MEDIA_KEY_PATTERN.test(value.mediaId) ? { mediaId: value.mediaId } : {}) };
  } catch { return null; }
}

export function writeAiMediaGenerationRecovery(storage: RecoveryStorage | null, accountId: string, pointer: AiMediaGenerationRecoveryPointer) {
  if (!storage || !accountId) return;
  try {
    storage.setItem(`${PREFIX}${encodeURIComponent(accountId)}`, JSON.stringify({
      version: 1, savedAt: Date.now(), requestId: pointer.requestId, kind: pointer.kind, format: pointer.format,
      ...(pointer.mediaId && MEDIA_KEY_PATTERN.test(pointer.mediaId) ? { mediaId: pointer.mediaId } : {}),
    }));
  } catch { /* Recovery remains available in memory if browser storage is blocked. */ }
}

/** A late acceptance must never clear a newer attempt from the same account. */
export function clearAiMediaGenerationRecoveryForMedia(storage: RecoveryStorage | null, accountId: string, mediaId: string) {
  const pointer = readAiMediaGenerationRecovery(storage, accountId);
  if (pointer?.mediaId === mediaId) clearAiMediaGenerationRecovery(storage, accountId, pointer.requestId);
}

export function clearAiMediaGenerationRecovery(storage: RecoveryStorage | null, accountId: string, requestId: string) {
  if (!storage || readAiMediaGenerationRecovery(storage, accountId)?.requestId !== requestId) return;
  try { storage.removeItem(`${PREFIX}${encodeURIComponent(accountId)}`); } catch { /* Best effort. */ }
}
