import "server-only";
import { createHash } from "node:crypto";
import { supabaseAdmin } from "./supabaseAdmin.ts";
import { TIKTOK_TRAFFIC_MAX_VIDEO_BYTES, TIKTOK_TRAFFIC_MAX_IMAGE_BYTES, TikTokTrafficPublisherError } from "./adsTikTokPublisherCore.ts";

export type TikTokSourceMediaRow = { id: unknown; media_type: unknown; mime_type: unknown; size_bytes: unknown; width: unknown; height: unknown; bucket_name: unknown; storage_path: unknown; is_active: unknown };
export type TikTokOwnedSourceReader = (userId: string, ids: string[]) => Promise<TikTokSourceMediaRow[]>;
const uuid = (value: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
async function read(userId: string, ids: string[]): Promise<TikTokSourceMediaRow[]> {
  const result = await supabaseAdmin.from("pro_media_library").select("id,media_type,mime_type,size_bytes,width,height,bucket_name,storage_path,is_active")
    .eq("user_id", userId).eq("is_active", true).in("id", ids).limit(2);
  if (result.error) throw new TikTokTrafficPublisherError("source_media_read_unavailable");
  return result.data || [];
}
/** Lightweight ownership/metadata read only; the publisher subsequently checks bytes and native info.
 * No arbitrary URL, signed capability or asset from another user's library can become a ready source.
 */
export async function checkTikTokOwnedSourceMedia(userId: string, videoId: string, thumbnailId: string, reader: TikTokOwnedSourceReader = read): Promise<{ ready: boolean; fingerprint: string | null }> {
  if (!userId || !uuid(videoId) || !uuid(thumbnailId) || videoId === thumbnailId) return { ready: false, fingerprint: null };
  const rows = await reader(userId, [videoId, thumbnailId]);
  if (!Array.isArray(rows) || rows.length !== 2 || new Set(rows.map((row) => row.id)).size !== 2) return { ready: false, fingerprint: null };
  const normalized: Array<Record<string, unknown>> = [];
  for (const [id, type, limit] of [[videoId, "video", TIKTOK_TRAFFIC_MAX_VIDEO_BYTES], [thumbnailId, "image", TIKTOK_TRAFFIC_MAX_IMAGE_BYTES]] as const) {
    const row = rows.find((entry) => entry.id === id), size = Number(row?.size_bytes), width = Number(row?.width), height = Number(row?.height);
    if (!row || row.is_active !== true || row.media_type !== type || typeof row.mime_type !== "string"
      || !(type === "video" ? ["video/mp4"] : ["image/png", "image/jpeg"]).includes(row.mime_type)
      || !Number.isSafeInteger(size) || size <= 0 || size > limit || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)
      || width < 540 || height < 960 || width * 16 !== height * 9
      || row.bucket_name !== "inrcy-pro-media"
      || typeof row.storage_path !== "string" || !row.storage_path.startsWith(`users/${userId}/`) || row.storage_path.length > 1024 || row.storage_path.includes("..") || row.storage_path.includes("\\")) return { ready: false, fingerprint: null };
    normalized.push({ id, type, mimeType: row.mime_type, size, width, height, bucket: row.bucket_name, path: row.storage_path });
  }
  return { ready: true, fingerprint: createHash("sha256").update(JSON.stringify(normalized)).digest("hex") };
}
