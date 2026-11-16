import "server-only";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { buildMediaLibraryContentUrl } from "@/lib/mediaLibraryContentUrl";
import { getStudioReferenceMediaIds, type StudioReferenceMemory, type StudioReferenceMedia } from "./studioReferences.ts";

export class StudioReferenceMediaUnavailableError extends Error {
  constructor() { super("studio_references_media_unavailable"); }
}

const MEDIA_COLUMNS = "id,user_id,media_type,mime_type,title,original_file_name,size_bytes,width,height,duration_seconds,bucket_name,storage_path,is_active,source";

/** Private URLs are issued only after both the account and each library ID were checked. */
export async function readStudioReferenceMedia(accountId: string, memory: StudioReferenceMemory, options: {
  strict?: boolean; client?: typeof supabaseAdmin;
} = {}): Promise<{ media: StudioReferenceMedia[]; unavailableMediaIds: string[] }> {
  const ids = getStudioReferenceMediaIds(memory);
  if (!ids.length) return { media: [], unavailableMediaIds: [] };
  const { data, error } = await (options.client ?? supabaseAdmin).from("pro_media_library")
    .select(MEDIA_COLUMNS).eq("user_id", accountId).eq("is_active", true).in("id", ids);
  if (error) throw new Error("studio_references_storage_unavailable");
  const types = new Map<string, Set<string>>();
  for (const reference of memory.references) types.set(reference.mediaLibraryId, new Set([...(types.get(reference.mediaLibraryId) ?? []), "image"]));
  for (const voice of memory.voices) types.set(voice.libraryMediaId, new Set([...(types.get(voice.libraryMediaId) ?? []), "audio"]));
  const rows = new Map((data ?? []).map(row => [String(row.id).toLowerCase(), row]));
  const media: StudioReferenceMedia[] = [];
  const unavailableMediaIds: string[] = [];
  for (const id of ids) {
    const row = rows.get(id);
    const path = row?.storage_path;
    const safe = row && row.user_id === accountId && row.is_active === true && types.get(id)?.size === 1 && types.get(id)?.has(row.media_type)
      && row.bucket_name === "inrcy-pro-media" && row.source !== "ai_media_generation_draft"
      && typeof path === "string" && path.startsWith(`users/${accountId}/`) && !/[\\%?#\u0000-\u001f]/.test(path)
      && path.split("/").every((part: string) => Boolean(part) && part !== "." && part !== "..")
      && (row.media_type !== "audio" || path.startsWith(`users/${accountId}/audio/`) && ["audio/wav", "audio/mpeg"].includes(row.mime_type));
    if (!safe) { unavailableMediaIds.push(id); continue; }
    const number = (value: unknown) => value !== null && value !== undefined && Number.isFinite(Number(value)) ? Number(value) : null;
    media.push({ id, media_type: row.media_type, mime_type: row.mime_type ?? null, title: row.title ?? null,
      original_file_name: row.original_file_name ?? null, signed_url: buildMediaLibraryContentUrl(id),
      size_bytes: number(row.size_bytes), width: number(row.width), height: number(row.height), duration_seconds: number(row.duration_seconds) });
  }
  if (options.strict && unavailableMediaIds.length) throw new StudioReferenceMediaUnavailableError();
  return { media, unavailableMediaIds };
}
