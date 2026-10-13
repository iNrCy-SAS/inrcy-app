export type AiMediaGenerationRecoveryPointer = {
  requestId: string;
  kind: "image" | "video";
  format: "square" | "portrait" | "story" | "landscape";
};
type RecoveryStorage = Pick<Storage, "getItem" | "setItem" | "removeItem">;
const PREFIX = "inrcy:media-generation-recovery:v1:";
const REQUEST_KEY_PATTERN = /^[a-z0-9][a-z0-9_-]{7,179}$/i;

/** Per-account pointer only: never persist prompts, criteria or reference data. */
export function readAiMediaGenerationRecovery(storage: RecoveryStorage | null, accountId: string): AiMediaGenerationRecoveryPointer | null {
  if (!storage || !accountId) return null;
  try {
    const value = JSON.parse(storage.getItem(`${PREFIX}${encodeURIComponent(accountId)}`) || "null");
    if (value?.version !== 1 || typeof value.requestId !== "string" || !REQUEST_KEY_PATTERN.test(value.requestId) ||
      !["image", "video"].includes(value.kind) || !["square", "portrait", "story", "landscape"].includes(value.format)) return null;
    return { requestId: value.requestId, kind: value.kind, format: value.format };
  } catch { return null; }
}

export function writeAiMediaGenerationRecovery(storage: RecoveryStorage | null, accountId: string, pointer: AiMediaGenerationRecoveryPointer) {
  if (!storage || !accountId) return;
  try {
    storage.setItem(`${PREFIX}${encodeURIComponent(accountId)}`, JSON.stringify({
      version: 1, requestId: pointer.requestId, kind: pointer.kind, format: pointer.format,
    }));
  } catch { /* Recovery remains available in memory if browser storage is blocked. */ }
}

export function clearAiMediaGenerationRecovery(storage: RecoveryStorage | null, accountId: string, requestId: string) {
  if (!storage || readAiMediaGenerationRecovery(storage, accountId)?.requestId !== requestId) return;
  try { storage.removeItem(`${PREFIX}${encodeURIComponent(accountId)}`); } catch { /* Best effort. */ }
}
