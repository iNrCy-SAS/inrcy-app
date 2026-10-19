/** Audio is a library-only format; publication upload policies stay visual. */
export const MEDIA_LIBRARY_AUDIO_MAX_BYTES = 3 * 1024 * 1024;
export const MEDIA_LIBRARY_AUDIO_MAX_DURATION_SECONDS = 300;
export type MediaLibraryAudioMimeType = "audio/wav" | "audio/mpeg";

export function getMediaLibraryAudioContentType(input: { name: string; mimeType: string }): MediaLibraryAudioMimeType | null {
  const mime = input.mimeType.toLowerCase().split(";")[0].trim();
  const extension = input.name.toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  if (["audio/wav", "audio/x-wav", "audio/wave", "audio/vnd.wave"].includes(mime)) return "audio/wav";
  if (["audio/mpeg", "audio/mp3"].includes(mime)) return "audio/mpeg";
  if (mime && mime !== "application/octet-stream") return null;
  return extension === "wav" ? "audio/wav" : extension === "mp3" ? "audio/mpeg" : null;
}

export function detectMediaLibraryAudioType(input: { name: string; mimeType: string }): "audio" | null {
  return getMediaLibraryAudioContentType(input) ? "audio" : null;
}

export function getMediaLibraryAudioExtension(input: { name: string; mimeType: string }): "wav" | "mp3" | null {
  const mime = getMediaLibraryAudioContentType(input);
  return mime === "audio/wav" ? "wav" : mime === "audio/mpeg" ? "mp3" : null;
}

export function isOwnedMediaLibraryAudioPath(accountId: string, value: unknown): value is string {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(accountId) || typeof value !== "string") return false;
  return new RegExp(`^users/${accountId}/audio/\\d{4}/[a-zA-Z0-9][a-zA-Z0-9._-]{0,220}\\.(?:wav|mp3)$`).test(value);
}
