/** Browser-safe character voice references; recordings never enter the generation JSON. */
export const AI_MEDIA_CHARACTER_VOICE_MAX_UPLOAD_BYTES = 3 * 1024 * 1024;
export const AI_MEDIA_CHARACTER_VOICE_MIN_SECONDS = 1;
export const AI_MEDIA_CHARACTER_VOICE_MAX_SECONDS = 10;
export const AI_MEDIA_CHARACTER_VOICE_SAMPLE_RATE = 16_000;
export const AI_MEDIA_CHARACTER_VOICE_MAX_NORMALIZED_BYTES = 320_044;
export const AI_MEDIA_CHARACTER_VOICE_RETENTION_MS = 24 * 60 * 60 * 1000;
export const AI_MEDIA_CHARACTER_VOICE_STORAGE_ROOT = "_studio-voice-references";
export const AI_MEDIA_CHARACTER_VOICE_VIDEO_ENGINES = Object.freeze(["wan27", "wan3", "heygen"] as const);
export type AiMediaCharacterVoiceVideoEngine = typeof AI_MEDIA_CHARACTER_VOICE_VIDEO_ENGINES[number];
export const AI_MEDIA_CHARACTER_VOICE_WAN3_MAX_TOTAL_SECONDS = 15;

export type AiMediaCharacterVoiceSample = {
  path: string;
  name: string;
  mimeType: "audio/wav";
  durationSeconds: number;
  sizeBytes: number;
  /** Permanent library copy; deleting the temporary reference leaves it intact. */
  libraryMediaId?: string;
};
export type AiMediaCharacterVoiceReference = {
  role?: string;
  voiceMode?: "ai" | "provided";
  voiceSample?: AiMediaCharacterVoiceSample;
};

export function isAiMediaCharacterVoiceEngine(engine: unknown): engine is AiMediaCharacterVoiceVideoEngine {
  return typeof engine === "string" && (AI_MEDIA_CHARACTER_VOICE_VIDEO_ENGINES as readonly string[]).includes(engine);
}

/** Count every attached character voice, including references used only for visual inspiration. */
export function getAiMediaCharacterVoiceTotalDurationSeconds(images: readonly AiMediaCharacterVoiceReference[]): number {
  return images.reduce((seconds, image) => seconds +
    (image.role === "character" && image.voiceMode === "provided" && image.voiceSample ? image.voiceSample.durationSeconds : 0), 0);
}

export function exceedsAiMediaCharacterVoiceEngineDuration(engine: unknown, images: readonly AiMediaCharacterVoiceReference[]): boolean {
  return engine === "wan3" && getAiMediaCharacterVoiceTotalDurationSeconds(images) > AI_MEDIA_CHARACTER_VOICE_WAN3_MAX_TOTAL_SECONDS;
}

const VOICE_PATH = /^_studio-voice-references\/(\d{4}-\d{2}-\d{2})\/([a-zA-Z0-9_-]{1,128})__(\d{13})__([0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})\.wav$/;

export function parseAiMediaCharacterVoicePath(value: unknown) {
  if (typeof value !== "string") return null;
  const match = VOICE_PATH.exec(value);
  if (!match) return null;
  const createdAt = Number(match[3]);
  if (!Number.isSafeInteger(createdAt) || new Date(createdAt).toISOString().slice(0, 10) !== match[1]) return null;
  return { path: value, accountId: match[2], createdAt };
}

export function isOwnedAiMediaCharacterVoicePath(accountId: string, path: unknown, now = Date.now()) {
  const parsed = parseAiMediaCharacterVoicePath(path);
  return Boolean(parsed && parsed.accountId === accountId && parsed.createdAt <= now + 60_000 &&
    parsed.createdAt > now - AI_MEDIA_CHARACTER_VOICE_RETENTION_MS);
}

export function normalizeAiMediaCharacterVoiceSample(value: unknown): AiMediaCharacterVoiceSample | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const sample = value as Record<string, unknown>;
  const duration = Number(sample.durationSeconds);
  const size = Number(sample.sizeBytes);
  if (!parseAiMediaCharacterVoicePath(sample.path) || sample.mimeType !== "audio/wav" ||
    !Number.isFinite(duration) || duration < AI_MEDIA_CHARACTER_VOICE_MIN_SECONDS || duration > AI_MEDIA_CHARACTER_VOICE_MAX_SECONDS ||
    !Number.isSafeInteger(size) || size < 44 || size > AI_MEDIA_CHARACTER_VOICE_MAX_NORMALIZED_BYTES) return null;
  return {
    path: String(sample.path),
    name: String(sample.name || "vocal.wav").replace(/[\u0000-\u001f\u007f/\\]/g, " ").trim().slice(0, 120) || "vocal.wav",
    mimeType: "audio/wav", durationSeconds: duration, sizeBytes: size,
    ...(typeof sample.libraryMediaId === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(sample.libraryMediaId)
      ? { libraryMediaId: sample.libraryMediaId } : {}),
  };
}

export function hasProvidedAiMediaCharacterVoice(images: readonly AiMediaCharacterVoiceReference[]) {
  return images.some((image) => image.role === "character" && image.voiceMode === "provided");
}
