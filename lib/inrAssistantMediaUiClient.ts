import type { MediaLibraryPickerItem } from "../app/dashboard/_components/MediaLibraryPickerModal";
import { UNIVERSAL_MEDIA_VIDEO_HARD_MAX_BYTES } from "./mediaUploadPolicy.ts";

/** The ID is an owned native API lookup, never a model-supplied file URL. */
export async function loadInrAssistantLibraryVideo(mediaId: string, stillCurrent: () => boolean, fetcher: typeof fetch = fetch): Promise<MediaLibraryPickerItem | null> {
  if (!stillCurrent() || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(mediaId)) return null;
  const response = await fetcher(`/api/media-library/items?id=${encodeURIComponent(mediaId)}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const payload = await response.json().catch(() => null);
  if (!stillCurrent() || !response.ok || !Array.isArray(payload?.items)) return null;
  const item = payload.items.find((value: MediaLibraryPickerItem) => value.id === mediaId);
  if (!item || item.media_type !== "video" || item.is_active === false || item.source === "ai_media_generation_draft"
    || !Number.isFinite(Number(item.size_bytes)) || Number(item.size_bytes) <= 0 || Number(item.size_bytes) > UNIVERSAL_MEDIA_VIDEO_HARD_MAX_BYTES
    || typeof item.signed_url !== "string" || !new RegExp(`^/api/media-library/items/${mediaId}/content\\?token=[A-Za-z0-9_-]+$`).test(item.signed_url)) return null;
  return item;
}
