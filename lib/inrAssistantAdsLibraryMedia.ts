import type { MediaLibraryPickerItem } from "../app/dashboard/_components/MediaLibraryPickerModal";

export async function loadInrAssistantAdsLibraryMedia(id: string, isCurrent: () => boolean, fetcher: typeof fetch = fetch): Promise<MediaLibraryPickerItem | null> {
  if (!isCurrent() || !/^[a-f0-9]{8}-[a-f0-9]{4}-[1-5][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i.test(id)) return null;
  const response = await fetcher(`/api/media-library/items?id=${encodeURIComponent(id)}`, { cache: "no-store", signal: AbortSignal.timeout(15_000) });
  const body = await response.json().catch(() => null);
  if (!isCurrent() || !response.ok || !Array.isArray(body?.items)) return null;
  const item = body.items.find((entry: MediaLibraryPickerItem) => entry.id === id);
  return item && ["image", "video"].includes(item.media_type) && item.is_active !== false && item.source !== "ai_media_generation_draft" && Number(item.size_bytes) > 0
    && typeof item.signed_url === "string" && new RegExp(`^/api/media-library/items/${id}/content\\?token=[A-Za-z0-9_-]+$`).test(item.signed_url) ? item : null;
}
