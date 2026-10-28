import "server-only";

import { buildMediaLibraryContentUrl } from "@/lib/mediaLibraryContentUrl";
import { buildStorageContentUrl } from "@/lib/storageContentUrl";

const IMAGE_BANK_BUCKET = "inrcy-image-bank";
const MEDIA_LIBRARY_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function isMediaRecord(value: unknown) {
  if (typeof value === "string") return Boolean(value.trim());
  const record = asRecord(value);
  return record && ["id", "mediaId", "media_id", "storagePath", "storage_path", "path", "url", "publicUrl", "src", "signed_url", "signedUrl"].some((key) => record[key]);
}

/** Refresh delivery addresses only. A bank UUID is not a professional library ID. */
export async function refreshPublishMediaUrl(media: unknown) {
  const rawString = typeof media === "string" ? media.trim() : "";
  const record = rawString
    ? MEDIA_LIBRARY_ID_PATTERN.test(rawString) ? { id: rawString } : { url: rawString }
    : asRecord(media);
  if (!record) return media;

  const storagePath = String(record.storagePath || record.storage_path || record.path || "").trim();
  const explicitBucket = String(record.bucket || record.bucket_name || "").trim();
  const librarySource = String(record.librarySource || "").trim();
  const fromImageBank = librarySource !== "pro_media_library" && (
    explicitBucket === IMAGE_BANK_BUCKET ||
    (librarySource === "inrcy_image_bank" && !explicitBucket)
  );
  const idCandidate = String(record.id || record.mediaId || record.media_id || "").trim();
  const urlCandidate = String(record.url || record.publicUrl || record.src || record.signed_url || record.signedUrl || "").trim();
  const mediaLibraryId = MEDIA_LIBRARY_ID_PATTERN.test(idCandidate)
    ? idCandidate
    : MEDIA_LIBRARY_ID_PATTERN.test(urlCandidate) ? urlCandidate : "";

  // Private media always retain the authenticated account-scoped library route,
  // even when an old storage path is also present in the prepared publication.
  if (mediaLibraryId && !fromImageBank) {
    const contentUrl = buildMediaLibraryContentUrl(mediaLibraryId);
    if (contentUrl) {
      const rawName = String(record.name || record.title || record.filename || "").trim();
      const safeName = rawName && !MEDIA_LIBRARY_ID_PATTERN.test(rawName)
        ? rawName
        : String(record.kind || record.mediaType || "").toLowerCase().includes("video")
          ? "Vidéo iNr’Agent" : "Image iNr’Agent";
      return { ...record, id: mediaLibraryId, name: safeName, title: safeName, url: contentUrl, publicUrl: contentUrl };
    }
    // Never bypass a failed private-content signature by minting a public path URL.
    return record;
  }

  const bucket = explicitBucket || IMAGE_BANK_BUCKET;
  if (!storagePath || !bucket) return record;
  const url = buildStorageContentUrl(bucket, storagePath);
  if (!url) return record;
  return { ...record, bucket, storagePath, path: storagePath, url, publicUrl: url };
}

export async function refreshImageAssetUrls(assets: unknown[]) {
  return Promise.all(assets.map(refreshPublishMediaUrl));
}

async function refreshMediaCollection(value: unknown) {
  if (!Array.isArray(value)) return value;
  return Promise.all(value.map((item) => isMediaRecord(item) ? refreshPublishMediaUrl(item) : item));
}

async function refreshMediaMap(value: unknown) {
  const map = asRecord(value);
  if (!map) return value;
  return Object.fromEntries(await Promise.all(Object.entries(map).map(async ([key, media]) => [
    key,
    Array.isArray(media) ? await refreshMediaCollection(media)
      : isMediaRecord(media) ? await refreshPublishMediaUrl(media) : media,
  ] as const)));
}

async function refreshPostByChannelMediaUrls(value: unknown) {
  const posts = asRecord(value);
  if (!posts) return value;
  return Object.fromEntries(await Promise.all(Object.entries(posts).map(async ([channel, value]) => {
    const post = asRecord(value);
    if (!post) return [channel, value] as const;
    const next = { ...post };
    for (const key of ["media", "mediaAsset", "image", "imageAsset", "video", "videoAsset", "file", "attachment"]) {
      if (isMediaRecord(next[key])) next[key] = await refreshPublishMediaUrl(next[key]);
    }
    return [channel, next] as const;
  })));
}

async function refreshFormatVariants(value: unknown) {
  const variants = asRecord(value);
  return variants && asRecord(variants.byFormat)
    ? { ...variants, byFormat: await refreshMediaMap(variants.byFormat) }
    : value;
}

/** Refresh stored image selections and formats without mutating the prepared publication. */
export async function refreshPublishPayloadMediaUrls(source: Record<string, unknown>) {
  const next = { ...source };
  for (const key of ["media", "mediaAsset", "image", "imageAsset", "selectedImage", "visual", "cover", "video", "videoAsset"]) {
    if (isMediaRecord(next[key])) next[key] = await refreshPublishMediaUrl(next[key]);
  }
  for (const key of ["images", "mediaAssets"]) {
    if (Array.isArray(next[key])) next[key] = await refreshMediaCollection(next[key]);
  }
  for (const key of ["imagesByChannel", "videoByChannel"]) {
    if (next[key]) next[key] = await refreshMediaMap(next[key]);
  }
  if (next.postByChannel) next.postByChannel = await refreshPostByChannelMediaUrls(next.postByChannel);
  const placements = asRecord(next.imagesByPlacement);
  if (placements) {
    next.imagesByPlacement = Object.fromEntries(await Promise.all(Object.entries(placements)
      .map(async ([channel, media]) => [channel, await refreshMediaMap(media)] as const)));
  }
  if (next.mediaFormatVariants) next.mediaFormatVariants = await refreshFormatVariants(next.mediaFormatVariants);
  const channelVariants = asRecord(next.mediaFormatVariantsByChannel);
  if (channelVariants) {
    next.mediaFormatVariantsByChannel = Object.fromEntries(await Promise.all(Object.entries(channelVariants)
      .map(async ([channel, variants]) => [channel, await refreshFormatVariants(variants)] as const)));
  }
  return next;
}
