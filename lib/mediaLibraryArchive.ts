import "server-only";
import { Zip, ZipPassThrough } from "fflate";

import { isOwnedMediaLibraryAudioPath } from "@/lib/mediaLibraryAudio";
import { createSafeStorageSignedUrl } from "@/lib/safeStorageSignedUrl";
import { supabaseAdmin } from "@/lib/supabaseAdmin";

export const MEDIA_LIBRARY_ARCHIVE_MAX_ITEMS = 200;
export const MEDIA_LIBRARY_ARCHIVE_MAX_BYTES = 512 * 1024 * 1024;
const BUCKET = "inrcy-pro-media";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SOURCE_TIMEOUT_MS = 60_000;
const CHUNK_SIZE = 64 * 1024;
// The signing cache retains URLs for 80% of their TTL: at least 360 s remain,
// exceeding the whole 280 s archive request even when the cached URL is reused.
const SIGNED_URL_TTL_SECONDS = 1800;

export class MediaLibraryArchiveError extends Error {
  constructor(public readonly status: 400 | 404 | 413 | 503, message: string) {
    super(message);
    this.name = "MediaLibraryArchiveError";
  }
}

const unavailable = () => new MediaLibraryArchiveError(503, "Les médias sont momentanément indisponibles. Réessayez.");
const missing = () => new MediaLibraryArchiveError(404, "Un média sélectionné est introuvable ou n’est plus disponible. Actualisez la médiathèque.");
const tooLarge = () => new MediaLibraryArchiveError(413, "La sélection dépasse 512 Mo. Téléchargez vos médias en plusieurs lots.");

export function parseMediaLibraryArchiveIds(value: unknown): string[] {
  if (!Array.isArray(value) || !value.length || value.length > MEDIA_LIBRARY_ARCHIVE_MAX_ITEMS || value.some((id) => typeof id !== "string" || !UUID.test(id))) {
    throw new MediaLibraryArchiveError(400, "Sélectionnez entre 1 et 200 médias valides.");
  }
  return [...new Set(value.map((id: string) => id.toLowerCase()))];
}

type ArchiveRow = {
  id: string;
  user_id: string;
  bucket_name: string;
  storage_path: string;
  media_type: string;
  mime_type: string;
  title: string | null;
  original_file_name: string | null;
  is_active: boolean;
  source: string | null;
};

export type PreparedMediaArchiveEntry = { name: string; url: string; size: number; etag: string | null };

function safeLeaf(value: unknown): string {
  return String(value ?? "").normalize("NFKC").split(/[\\/]/).pop()!
    .replace(/[\u0000-\u001f\u007f<>:"/\\|?*\u200e\u200f\u202a-\u202e\u2066-\u2069]/g, "-")
    .replace(/\s+/g, " ").replace(/^\.+|[. ]+$/g, "").trim();
}

const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": ".jpg", "image/png": ".png", "image/webp": ".webp", "image/gif": ".gif", "image/avif": ".avif",
  "video/mp4": ".mp4", "video/webm": ".webm", "video/quicktime": ".mov",
  "audio/mpeg": ".mp3", "audio/mp3": ".mp3", "audio/wav": ".wav", "audio/x-wav": ".wav",
};

/** Flat, portable UTF-8 filenames; duplicate names never overwrite another ZIP entry. */
export function mediaLibraryArchiveNames(rows: Array<Pick<ArchiveRow, "original_file_name" | "title" | "storage_path" | "mime_type" | "media_type">>): string[] {
  const used = new Set<string>();
  return rows.map((row) => {
    const name = safeLeaf(row.original_file_name) || safeLeaf(row.title) || `media-inrcy`;
    const extension = MIME_EXTENSIONS[String(row.mime_type).toLowerCase()] || safeLeaf(row.storage_path).match(/\.[a-z0-9]{2,10}$/i)?.[0] || ".bin";
    let stem = name.replace(/\.[a-z0-9]{2,10}$/i, "");
    if (/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(stem)) stem = `media-${stem}`;
    // Bound bytes, not UTF-16 units, and preserve surrogate pairs/accents.
    let short = "";
    for (const character of stem) {
      if (Buffer.byteLength(short + character, "utf8") > 160) break;
      short += character;
    }
    stem = short.replace(/[. ]+$/g, "") || "media-inrcy";
    let candidate = `${stem}${extension}`;
    for (let number = 2; used.has(candidate.toLocaleLowerCase("en-US")); number++) candidate = `${stem} (${number})${extension}`;
    used.add(candidate.toLocaleLowerCase("en-US"));
    return candidate;
  });
}

function ownedPath(accountId: string, row: ArchiveRow): boolean {
  const path = row.storage_path;
  return row.user_id === accountId && row.bucket_name === BUCKET && row.is_active !== false && row.source !== "ai_media_generation_draft" &&
    ["image", "video", "audio"].includes(row.media_type) && typeof path === "string" && path.startsWith(`users/${accountId}/`) &&
    !/[%?#\\\u0000-\u001f\u007f]/.test(path) && !path.split("/").some((part) => !part || part === "." || part === "..") &&
    (row.media_type !== "audio" || isOwnedMediaLibraryAudioPath(accountId, path));
}

/** Only URLs created for this exact owned Storage object may reach fetch. */
function checkedSignedUrl(value: string, path: string): string {
  try {
    const origin = new URL(process.env.NEXT_PUBLIC_SUPABASE_URL || "");
    const url = new URL(value);
    if (url.protocol !== "https:" || url.origin !== origin.origin || url.username || url.password || url.hash ||
      decodeURIComponent(url.pathname) !== `/storage/v1/object/sign/${BUCKET}/${path}` || !url.searchParams.get("token")) throw new Error();
    return url.toString();
  } catch { throw unavailable(); }
}

function sourceSize(response: Response): number {
  const range = response.headers.get("content-range");
  const raw = response.status === 206 ? range?.match(/^bytes 0-0\/(\d+)$/)?.[1] : response.status === 200 ? response.headers.get("content-length") : null;
  const size = raw && /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(size) || size <= 0 || (response.headers.get("content-encoding") && response.headers.get("content-encoding") !== "identity")) throw unavailable();
  return size;
}

function abortable<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  signal.throwIfAborted();
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => { signal.removeEventListener("abort", onAbort); reject(signal.reason); };
    signal.addEventListener("abort", onAbort, { once: true });
    operation.then(
      (value) => { signal.removeEventListener("abort", onAbort); resolve(value); },
      (error) => { signal.removeEventListener("abort", onAbort); reject(error); },
    );
  });
}

/** Validate every row and source before any ZIP bytes are sent. Nothing here mutates the library. */
export async function prepareMediaLibraryArchive(accountId: string, ids: string[], signal: AbortSignal): Promise<PreparedMediaArchiveEntry[]> {
  signal.throwIfAborted();
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(accountId)) throw missing();
  const requested = parseMediaLibraryArchiveIds(ids);
  const result = await supabaseAdmin.from("pro_media_library")
    .select("id,user_id,bucket_name,storage_path,media_type,mime_type,title,original_file_name,is_active,source")
    .eq("user_id", accountId).in("id", requested).abortSignal(signal);
  if (result.error) throw unavailable();
  const rows = (result.data ?? []) as ArchiveRow[];
  const byId = new Map(rows.map((row) => [row.id, row]));
  if (byId.size !== requested.length || requested.some((id) => !byId.has(id))) throw missing();
  const ordered = requested.map((id) => byId.get(id)!);
  if (ordered.some((row) => !ownedPath(accountId, row))) throw missing();
  const names = mediaLibraryArchiveNames(ordered);
  const prepared = new Array<PreparedMediaArchiveEntry>(ordered.length);
  let cursor = 0;
  let total = 0;
  const probesAbort = new AbortController();
  const probesSignal = AbortSignal.any([signal, probesAbort.signal]);
  // A bounded number of metadata probes keeps large selections responsive.
  try { await Promise.all(Array.from({ length: Math.min(6, ordered.length) }, async () => {
    while (cursor < ordered.length) {
      probesSignal.throwIfAborted();
      const index = cursor++;
      const row = ordered[index];
      const signed = await abortable(createSafeStorageSignedUrl(BUCKET, row.storage_path, SIGNED_URL_TTL_SECONDS), probesSignal);
      probesSignal.throwIfAborted();
      if (!signed) throw unavailable();
      const url = checkedSignedUrl(signed, row.storage_path);
      // Some Storage versions reject HEAD; a one-byte GET works on both versions.
      const response = await fetch(url, {
        headers: { Range: "bytes=0-0", "Accept-Encoding": "identity" }, cache: "no-store", redirect: "error",
        signal: AbortSignal.any([probesSignal, AbortSignal.timeout(15_000)]),
      });
      try {
        if (response.status === 404) throw missing();
        const size = sourceSize(response);
        total += size;
        if (total > MEDIA_LIBRARY_ARCHIVE_MAX_BYTES) throw tooLarge();
        prepared[index] = { name: names[index], url, size, etag: response.headers.get("etag") };
      } finally { await response.body?.cancel(); }
    }
  })); } catch (error) { probesAbort.abort(); throw error; }
  signal.throwIfAborted();
  return prepared;
}

/** Pull-driven ZIP output: one source at a time, without materializing any full file. */
export function createMediaLibraryArchiveStream(entries: PreparedMediaArchiveEntry[], requestSignal: AbortSignal): ReadableStream<Uint8Array> {
  const abort = new AbortController();
  const signal = AbortSignal.any([requestSignal, abort.signal]);
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const iterator = (async function* () {
    const output: Uint8Array[] = [];
    const zip = new Zip((error, chunk) => { if (error) throw unavailable(); if (chunk.length) output.push(chunk); });
    let total = 0;
    try {
      for (const entry of entries) {
        signal.throwIfAborted();
        const response = await fetch(entry.url, {
          headers: { "Accept-Encoding": "identity", ...(entry.etag ? { "If-Match": entry.etag } : {}) },
          cache: "no-store", redirect: "error", signal: AbortSignal.any([signal, AbortSignal.timeout(SOURCE_TIMEOUT_MS)]),
        });
        activeReader = response.body?.getReader();
        if (!response.ok || !activeReader || sourceSize(response) !== entry.size) throw unavailable();
        const file = new ZipPassThrough(entry.name);
        zip.add(file);
        while (output.length) yield output.shift()!;
        let bytes = 0;
        for (;;) {
          signal.throwIfAborted();
          const part = await activeReader.read();
          if (part.done) break;
          bytes += part.value.byteLength;
          total += part.value.byteLength;
          if (bytes > entry.size || total > MEDIA_LIBRARY_ARCHIVE_MAX_BYTES) throw tooLarge();
          for (let offset = 0; offset < part.value.byteLength; offset += CHUNK_SIZE) {
            file.push(part.value.subarray(offset, offset + CHUNK_SIZE));
            while (output.length) yield output.shift()!;
          }
        }
        activeReader.releaseLock();
        activeReader = undefined;
        if (bytes !== entry.size) throw unavailable();
        file.push(new Uint8Array(), true);
        while (output.length) yield output.shift()!;
      }
      zip.end();
      while (output.length) yield output.shift()!;
    } finally {
      zip.terminate();
      await activeReader?.cancel().catch(() => undefined);
      activeReader?.releaseLock();
    }
  })();
  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const next = await iterator.next();
        if (next.done) controller.close(); else controller.enqueue(next.value);
      } catch {
        // Never finish a valid-looking partial ZIP or expose an upstream signed URL.
        abort.abort();
        controller.error(unavailable());
      }
    },
    async cancel() {
      abort.abort();
      await activeReader?.cancel().catch(() => undefined);
      await iterator.return(undefined);
    },
  }, { highWaterMark: 0 });
}
