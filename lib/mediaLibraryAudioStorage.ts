import "server-only";
import { randomUUID } from "node:crypto";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { MEDIA_LIBRARY_AUDIO_MAX_BYTES, MEDIA_LIBRARY_AUDIO_MAX_DURATION_SECONDS, type MediaLibraryAudioMimeType } from "./mediaLibraryAudio.ts";
import { detectMediaLibraryAudioBytes } from "./mediaLibraryAudioValidation.ts";

type AudioStorage = {
  getBucket(bucket: string): PromiseLike<{ data: { public: boolean } | null; error: unknown }>;
  from(bucket: string): {
    upload(path: string, body: Uint8Array, options: { contentType: string; cacheControl: string; upsert: boolean }): PromiseLike<{ error: unknown }>;
    remove(paths: string[]): PromiseLike<{ error: unknown }>;
  };
};
type AudioDatabase = {
  from(table: string): { insert(row: Record<string, unknown>): { select(columns: string): { single(): PromiseLike<{ data: { id: string; storage_path?: string } | null; error: unknown }> } } };
};

/** Persist a new audio asset for the authenticated caller's active account. */
export async function saveMediaLibraryAudio(args: {
  accountId: string; name: string; buffer: Buffer; mimeType: MediaLibraryAudioMimeType; durationSeconds: number;
  source?: string; storage?: AudioStorage; database?: AudioDatabase; now?: number;
}) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(args.accountId)) throw new Error("media_library_audio_account_invalid");
  if (!args.buffer.length || args.buffer.length > MEDIA_LIBRARY_AUDIO_MAX_BYTES) throw new Error("media_library_audio_size_invalid");
  if (detectMediaLibraryAudioBytes(args.buffer) !== args.mimeType) throw new Error("media_library_audio_format_invalid");
  if (!Number.isFinite(args.durationSeconds) || args.durationSeconds <= 0 || args.durationSeconds > MEDIA_LIBRARY_AUDIO_MAX_DURATION_SECONDS) throw new Error("media_library_audio_duration_invalid");
  const storage = args.storage ?? supabaseAdmin.storage;
  const database = args.database ?? supabaseAdmin;
  const bucketName = "inrcy-pro-media";
  let bucket;
  try { bucket = await storage.getBucket(bucketName); } catch { throw new Error("media_library_audio_storage_unavailable"); }
  if (bucket.error || !bucket.data || bucket.data.public !== false) throw new Error("media_library_audio_storage_unavailable");
  const extension = args.mimeType === "audio/wav" ? "wav" : "mp3";
  const now = new Date(args.now ?? Date.now());
  const storagePath = `users/${args.accountId}/audio/${now.getUTCFullYear()}/${randomUUID()}.${extension}`;
  const name = String(args.name || `vocal.${extension}`).replace(/[\u0000-\u001f\u007f/\\]/g, " ").trim().slice(0, 180) || `vocal.${extension}`;
  let uploaded;
  try { uploaded = await storage.from(bucketName).upload(storagePath, args.buffer, { contentType: args.mimeType, cacheControl: "0", upsert: false }); }
  catch { throw new Error("media_library_audio_storage_unavailable"); }
  if (uploaded.error) throw new Error("media_library_audio_storage_unavailable");
  try {
    const inserted = await database.from("pro_media_library").insert({
      user_id: args.accountId, bucket_name: bucketName, storage_path: storagePath, media_type: "audio", mime_type: args.mimeType,
      size_bytes: args.buffer.length, title: name.replace(/\.(wav|mp3)$/i, ""), original_file_name: name, tags: [],
      source: args.source || "studio_character_voice", width: null, height: null, duration_seconds: args.durationSeconds, is_active: true,
      upload_protocol: "signed", upload_status: "uploaded", upload_progress: 100, uploaded_at: now.toISOString(), pipeline_version: 1,
      media_metadata: { audio: { version: 1, validated: true, duration_seconds: args.durationSeconds } },
    }).select("id,storage_path").single();
    if (inserted.error || !inserted.data?.id) throw new Error("media_library_audio_save_failed");
    return { id: String(inserted.data.id), storagePath, name, mimeType: args.mimeType, durationSeconds: args.durationSeconds, sizeBytes: args.buffer.length };
  } catch {
    try { await storage.from(bucketName).remove([storagePath]); } catch { /* Only this new object can be rolled back. */ }
    throw new Error("media_library_audio_save_failed");
  }
}
