import "server-only";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { inspectAiMediaCharacterVoiceWav } from "./aiMediaCharacterVoiceAudio.ts";
import {
  AI_MEDIA_CHARACTER_VOICE_STORAGE_ROOT, AI_MEDIA_CHARACTER_VOICE_RETENTION_MS,
  AI_MEDIA_CHARACTER_VOICE_MAX_NORMALIZED_BYTES,
  isOwnedAiMediaCharacterVoicePath, parseAiMediaCharacterVoicePath,
  type AiMediaCharacterVoiceReference, type AiMediaCharacterVoiceSample,
} from "./aiMediaCharacterVoices.ts";

const BUCKET = "inrcy-pro-media";
const SIGNED_URL_SECONDS = 30 * 60;
type Storage = {
  getBucket(bucket: string): Promise<{ data: { public: boolean } | null; error: unknown }>;
  from(bucket: string): {
    upload(path: string, body: Uint8Array, options: { contentType: string; cacheControl: string; upsert: boolean }): Promise<{ error: unknown }>;
    download(path: string): Promise<{ data: Blob | null; error: unknown }>;
    createSignedUrl(path: string, seconds: number): Promise<{ data: { signedUrl: string } | null; error: unknown }>;
    remove(paths: string[]): Promise<{ error: unknown }>;
    list(path: string, options: { limit: number; offset: number; sortBy: { column: string; order: "asc" } }): Promise<{ data: { name: string; id?: string | null }[] | null; error: unknown }>;
  };
};

async function privateStorage(storage: Storage) {
  const result = await storage.getBucket(BUCKET).catch(() => null);
  if (!result || result.error || !result.data || result.data.public !== false) throw new Error("voice_storage_unavailable");
  return storage.from(BUCKET);
}

export async function saveAiMediaCharacterVoice(args: {
  accountId: string; name: string; buffer: Buffer; storage?: Storage; now?: number;
}): Promise<AiMediaCharacterVoiceSample> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(args.accountId)) throw new Error("voice_account_invalid");
  if (args.buffer.length > AI_MEDIA_CHARACTER_VOICE_MAX_NORMALIZED_BYTES) throw new Error("voice_audio_size_invalid");
  const inspected = inspectAiMediaCharacterVoiceWav(args.buffer);
  const now = args.now ?? Date.now();
  const path = `${AI_MEDIA_CHARACTER_VOICE_STORAGE_ROOT}/${new Date(now).toISOString().slice(0, 10)}/${args.accountId}__${now}__${randomUUID()}.wav`;
  const bucket = await privateStorage(args.storage ?? supabaseAdmin.storage);
  const result = await bucket.upload(path, args.buffer, { contentType: "audio/wav", cacheControl: "0", upsert: false }).catch(() => null);
  if (!result || result.error) throw new Error("voice_storage_unavailable");
  return {
    path, name: args.name.replace(/[\u0000-\u001f\u007f/\\]/g, " ").trim().slice(0, 120) || "vocal.wav",
    mimeType: "audio/wav", durationSeconds: inspected.durationSeconds, sizeBytes: args.buffer.length,
  };
}

export async function readAiMediaCharacterVoice(args: {
  accountId: string; path: string; storage?: Storage; signal?: AbortSignal; now?: number;
}) {
  args.signal?.throwIfAborted();
  if (!isOwnedAiMediaCharacterVoicePath(args.accountId, args.path, args.now)) throw new Error("voice_reference_invalid_or_expired");
  const bucket = await privateStorage(args.storage ?? supabaseAdmin.storage);
  const result = await bucket.download(args.path).catch(() => null);
  if (!result || result.error || !result.data || result.data.size > 320_044) throw new Error("voice_reference_unavailable");
  const buffer = Buffer.from(await result.data.arrayBuffer());
  inspectAiMediaCharacterVoiceWav(buffer);
  args.signal?.throwIfAborted();
  return { buffer, bucket };
}

/** Sign only this account's validated voice objects, preserving image-index association. */
export async function getAiMediaCharacterVoiceSignedUrls(args: {
  accountId: string; images: readonly AiMediaCharacterVoiceReference[]; signal?: AbortSignal; storage?: Storage; now?: number;
}): Promise<readonly (string | null)[]> {
  const urls: (string | null)[] = [];
  for (const image of args.images) {
    if (image.voiceMode !== "provided") { urls.push(null); continue; }
    if (image.role !== "character" || !image.voiceSample) throw new Error("voice_reference_missing");
    const { bucket } = await readAiMediaCharacterVoice({ ...args, path: image.voiceSample.path });
    const result = await bucket.createSignedUrl(image.voiceSample.path, SIGNED_URL_SECONDS).catch(() => null);
    if (!result || result.error || !result.data?.signedUrl) throw new Error("voice_storage_unavailable");
    let url: URL;
    try { url = new URL(result.data.signedUrl); } catch { throw new Error("voice_storage_unavailable"); }
    if (url.protocol !== "https:" || url.username || url.password) throw new Error("voice_storage_unavailable");
    urls.push(url.toString());
  }
  return urls;
}

export async function preflightAiMediaCharacterVoices(args: Parameters<typeof getAiMediaCharacterVoiceSignedUrls>[0]) {
  await getAiMediaCharacterVoiceSignedUrls(args);
}

export async function removeAiMediaCharacterVoice(args: { accountId: string; path: string; storage?: Storage }) {
  const parsed = parseAiMediaCharacterVoicePath(args.path);
  if (!parsed || parsed.accountId !== args.accountId) throw new Error("voice_reference_invalid_or_expired");
  const bucket = await privateStorage(args.storage ?? supabaseAdmin.storage);
  const result = await bucket.remove([parsed.path]).catch(() => null);
  if (!result || result.error) throw new Error("voice_storage_unavailable");
}

/** Existing daily orphan cleanup also removes abandoned samples after 24 hours. */
export async function purgeExpiredAiMediaCharacterVoices(args: { storage?: Storage; now?: number } = {}) {
  const bucket = await privateStorage(args.storage ?? supabaseAdmin.storage);
  const now = args.now ?? Date.now();
  let inspected = 0;
  let removed = 0;
  const errors: string[] = [];
  const prefixes: string[] = [];
  const today = new Date(now).toISOString().slice(0, 10);
  // Finish enumerating date folders before deleting their final files:
  // empty virtual folders disappear and would shift later offset pages.
  for (let offset = 0; offset < 10_000; offset += 100) {
    const dates = await bucket.list(AI_MEDIA_CHARACTER_VOICE_STORAGE_ROOT, { limit: 100, offset, sortBy: { column: "name", order: "asc" } }).catch(() => ({ data: null, error: true }));
    if (dates.error || !dates.data) { errors.push("voice_cleanup_list_failed"); break; }
    for (const folder of dates.data) {
      if (folder.id || !/^\d{4}-\d{2}-\d{2}$/.test(folder.name) || folder.name > today) continue;
      prefixes.push(`${AI_MEDIA_CHARACTER_VOICE_STORAGE_ROOT}/${folder.name}`);
    }
    if (dates.data.length < 100) break;
  }
  for (const prefix of prefixes) {
    const expired: string[] = [];
    for (let fileOffset = 0; fileOffset < 10_000; fileOffset += 100) {
      const files = await bucket.list(prefix, { limit: 100, offset: fileOffset, sortBy: { column: "name", order: "asc" } }).catch(() => ({ data: null, error: true }));
      if (files.error || !files.data) { errors.push("voice_cleanup_list_failed"); break; }
      for (const file of files.data) {
        const parsed = parseAiMediaCharacterVoicePath(`${prefix}/${file.name}`);
        inspected++;
        if (parsed && parsed.createdAt <= now - AI_MEDIA_CHARACTER_VOICE_RETENTION_MS) expired.push(parsed.path);
      }
      if (files.data.length < 100) break;
    }
    for (let index = 0; index < expired.length; index += 100) {
      const paths = expired.slice(index, index + 100);
      const result = await bucket.remove(paths).catch(() => ({ error: true }));
      if (result.error) errors.push("voice_cleanup_remove_failed"); else removed += paths.length;
    }
  }
  return { inspected, removed, errors };
}
