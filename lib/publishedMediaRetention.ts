import type { SupabaseClient } from "@supabase/supabase-js";

export type PublishedMediaCandidate = {
  id: string;
  user_id: string;
  storage_path?: string | null;
  canonical_storage_path?: string | null;
  variant_storage_paths?: readonly string[];
};

/** Published content outlives the editable Booster workspace. */
export function publicationReferencesMedia(value: unknown, media: PublishedMediaCandidate): boolean {
  const storagePaths = [media.storage_path, media.canonical_storage_path, ...(media.variant_storage_paths || [])]
    .filter((value): value is string => Boolean(value));
  const references = new Set([media.id, ...storagePaths]);
  const visit = (input: unknown, depth: number): boolean => {
    if (depth > 24 || input == null) return false;
    if (typeof input === "string") {
      const text = input.trim();
      if (references.has(text)) return true;
      try {
        const url = new URL(text, "https://app.inrcy.com");
        const queryPath = url.searchParams.get("path");
        if (queryPath && references.has(queryPath)) return true;
        const decodedPath = decodeURIComponent(url.pathname);
        if (decodedPath === `/api/media-library/items/${media.id}/content`) return true;
        for (const candidate of storagePaths) {
          if (decodedPath.endsWith(`/${candidate}`)) return true;
        }
      } catch { /* Not a delivery URL. */ }
      if (text.startsWith("{") || text.startsWith("[")) {
        try { return visit(JSON.parse(text), depth + 1); } catch { /* Plain text. */ }
      }
      return false;
    }
    if (Array.isArray(input)) return input.some(item => visit(item, depth + 1));
    if (typeof input === "object") return Object.values(input).some(item => visit(item, depth + 1));
    return false;
  };
  return visit(value, 0);
}

/** Fail closed: an unavailable reference check must never authorize deletion. */
export async function isMediaReferencedByPublishedContent(db: SupabaseClient, media: PublishedMediaCandidate) {
  if (!media.id || !media.user_id) throw new Error("published_media_scope_missing");
  const pageSize = 200;
  for (const table of ["site_articles", "publications"] as const) {
    for (let offset = 0; ; offset += pageSize) {
      const result = await db.from(table)
        .select("id,video_path,video_url,images,media_metadata")
        .eq("user_id", media.user_id)
        .order("id", { ascending: true })
        .range(offset, offset + pageSize - 1);
      if (result.error) throw result.error;
      const rows = result.data || [];
      if (rows.some(row => publicationReferencesMedia(row, media))) return true;
      if (rows.length < pageSize) break;
    }
  }
  return false;
}
