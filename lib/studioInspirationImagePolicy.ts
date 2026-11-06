export const STUDIO_INSPIRATION_IMAGES_ONLY_MESSAGE = "Pour vous inspirer, ajoutez uniquement des images. Les vidéos ne sont pas acceptées ici.";

export class StudioInspirationImageOnlyError extends Error {
  constructor(message = STUDIO_INSPIRATION_IMAGES_ONLY_MESSAGE) {
    super(message);
    this.name = "StudioInspirationImageOnlyError";
  }
}

type ReferenceMetadata = {
  name?: unknown; type?: unknown; mimeType?: unknown; mime_type?: unknown;
  original_file_name?: unknown; title?: unknown; media_type?: unknown;
};
const VIDEO_EXTENSIONS = new Set(["mp4", "m4v", "mov", "webm", "mkv", "avi", "mpeg", "mpg", "mp2", "mpe", "3gp", "3g2", "mts", "m2ts", "ogv", "wmv", "vob"]);

/** A misleading image MIME must never override an explicit video extension. */
export function isStudioInspirationVideoReference(value: ReferenceMetadata | null | undefined): boolean {
  if (String(value?.media_type || "").trim().toLowerCase() === "video") return true;
  const mimeTypes = [value?.type, value?.mimeType, value?.mime_type].map(type => String(type || "").toLowerCase().split(";")[0].trim());
  if (mimeTypes.some(type => type.startsWith("video/") || ["application/mp4", "application/x-matroska", "application/vnd.rn-realmedia"].includes(type))) return true;
  return [value?.name, value?.original_file_name, value?.title].some(name => {
    const extension = String(name || "").trim().toLowerCase().split(/[?#]/, 1)[0].split(".").at(-1) || "";
    return VIDEO_EXTENSIONS.has(extension);
  });
}

export function assertStudioInspirationImageMetadata(value: ReferenceMetadata, message?: string): void {
  if (isStudioInspirationVideoReference(value)) throw new StudioInspirationImageOnlyError(message);
}

/** Recognize video containers even after both filename and MIME were changed.
 * HEIC/HEIF and AVIF use the same ISO container; their image brands stay valid. */
export function studioInspirationBytesAreVideo(bytes: ArrayLike<number>): boolean {
  const ascii = (start: number, end: number) => Array.from({ length: Math.max(0, Math.min(end, bytes.length) - start) }, (_, offset) => String.fromCharCode(bytes[start + offset])).join("");
  if (bytes.length >= 12 && ascii(4, 8) === "ftyp") {
    const imageBrands = new Set(["avif", "avis", "heic", "heix", "hevc", "hevx", "heim", "heis", "mif1", "msf1"]);
    return !imageBrands.has(ascii(8, 12));
  }
  if (bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3) return true;
  if (bytes.length >= 12 && ascii(0, 4) === "RIFF" && ascii(8, 12) === "AVI ") return true;
  return bytes.length >= 4 && bytes[0] === 0 && bytes[1] === 0 && bytes[2] === 1 && [0xba, 0xb3].includes(bytes[3]);
}

export function studioInspirationBase64IsVideo(data: string): boolean {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const bytes: number[] = [];
  let bits = 0, available = 0;
  for (const character of data.slice(0, 128)) {
    const index = alphabet.indexOf(character);
    if (index < 0) break;
    bits = (bits << 6) | index;
    available += 6;
    if (available >= 8) { available -= 8; bytes.push((bits >> available) & 255); }
  }
  return studioInspirationBytesAreVideo(bytes);
}

export async function assertStudioInspirationImageFile(file: File, message?: string): Promise<void> {
  assertStudioInspirationImageMetadata(file, message);
  const prefix = new Uint8Array(await file.slice(0, 96).arrayBuffer());
  if (studioInspirationBytesAreVideo(prefix)) throw new StudioInspirationImageOnlyError(message);
}
