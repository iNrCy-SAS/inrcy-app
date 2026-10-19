import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { AI_MEDIA_CHARACTER_VOICE_MAX_UPLOAD_BYTES } from "./aiMediaCharacterVoices.ts";

/** Resolve a library identifier against the active account, never a browser-supplied URL. */
export async function readAiMediaCharacterVoiceFromLibrary(args: {
  accountId: string; mediaId: string; signal?: AbortSignal; client?: typeof supabaseAdmin;
}) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(args.accountId) || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(args.mediaId)) throw new Error("voice_library_reference_invalid");
  args.signal?.throwIfAborted();
  const client = args.client ?? supabaseAdmin;
  const result = await client.from("pro_media_library")
    .select("id,bucket_name,storage_path,media_type,mime_type,size_bytes,title,original_file_name")
    .eq("id", args.mediaId).eq("user_id", args.accountId).eq("media_type", "audio").eq("is_active", true).maybeSingle()
    .then((value) => value, () => { throw new Error("voice_library_reference_unavailable"); });
  args.signal?.throwIfAborted();
  const row = result.data;
  if (result.error || !row || row.bucket_name !== "inrcy-pro-media" ||
    typeof row.storage_path !== "string" || !row.storage_path.startsWith(`users/${args.accountId}/audio/`) ||
    row.storage_path.includes("\\") || row.storage_path.split("/").some((part: string) => !part || part === "." || part === "..") || /[%?#\u0000-\u001f]/.test(row.storage_path) ||
    !["audio/wav", "audio/mpeg"].includes(row.mime_type) ||
    !(Number(row.size_bytes) > 0 && Number(row.size_bytes) <= AI_MEDIA_CHARACTER_VOICE_MAX_UPLOAD_BYTES)) throw new Error("voice_library_reference_unavailable");
  const bucket = await client.storage.getBucket("inrcy-pro-media").catch(() => null);
  if (!bucket || bucket.error || bucket.data?.public !== false) throw new Error("voice_storage_unavailable");
  const downloaded = await client.storage.from("inrcy-pro-media").download(row.storage_path).catch(() => null);
  if (!downloaded || downloaded.error || !downloaded.data || !downloaded.data.size || downloaded.data.size > AI_MEDIA_CHARACTER_VOICE_MAX_UPLOAD_BYTES) throw new Error("voice_library_reference_unavailable");
  const buffer = Buffer.from(await downloaded.data.arrayBuffer());
  args.signal?.throwIfAborted();
  return { buffer, name: String(row.original_file_name || row.title || "vocal.wav").slice(0, 120), mediaId: String(row.id) };
}
