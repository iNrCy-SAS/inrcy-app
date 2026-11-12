import type { MediaWorkspaceSnapshot } from "./mediaWorkspaceClient";

type RecordValue = Record<string, unknown>;
const record = (value: unknown): RecordValue => value && typeof value === "object" && !Array.isArray(value) ? value as RecordValue : {};
const text = (value: unknown) => typeof value === "string" ? value.trim() : "";
const mediaFields = ["images", "video", "imagesByChannel", "videoByChannel", "media", "mediaAsset", "image", "imageAsset", "videoAsset"] as const;
const originalKey = "scheduledMediaPreviewOriginal";
const aliases: Record<string, string> = { siteWeb: "site_web", inrSearch: "inr_search", youtube: "youtube_shorts" };
const channelKey = (value: string) => aliases[value] || value;

export function scheduledPublicationPreviewWorkspaceId(value: unknown) {
  const payload = record(value);
  return text(record(payload.publishPayload).mediaWorkspaceId) || text(payload.mediaWorkspaceId);
}

function imageKey(clientMediaKey: string | undefined, mediaId: string) {
  const parts = text(clientMediaKey).split(":");
  if (parts.length < 4) return `workspace:${mediaId}`;
  const modified = parts.pop() || "0", size = parts.pop() || "0", name = parts.pop() || "image";
  return `${name}__${size}__${modified}`;
}

/** Resolve the immutable scheduled workspace for display, without changing its saved payload. */
export function withScheduledPublicationWorkspacePreview(value: unknown, workspace: MediaWorkspaceSnapshot, channels: readonly string[]) {
  const payload = record(value), publish = record(payload.publishPayload);
  if (workspace.workspaceId !== scheduledPublicationPreviewWorkspaceId(payload)) throw new Error("Espace média de publication incorrect.");
  const assets = workspace.media
    .filter(item => item.uploadStatus === "uploaded")
    .sort((a, b) => a.position - b.position)
    .map(item => {
      const url = item.publicUrl || item.canonicalUrl || "";
      if (!url) throw new Error("Le média de cette publication est indisponible. Réessayez dans quelques instants.");
      return { id: item.mediaId, mediaId: item.mediaId, imageKey: imageKey(item.clientMediaKey, item.mediaId),
        name: item.fileName, type: item.mimeType, kind: item.mediaType, size: item.sizeBytes,
        bucket: item.bucket, storagePath: item.storagePath, url, publicUrl: url,
        duration: item.durationSeconds, thumbnailUrl: item.mediaType === "video" ? item.previewUrl : null,
        imageMeta: { width: item.width, height: item.height, ratio: item.width && item.height ? item.width / item.height : undefined } };
    });
  const images = assets.filter(item => item.kind === "image"), video = assets.find(item => item.kind === "video") || null;
  const modes = { ...record(payload.mediaModeByChannel), ...record(publish.mediaModeByChannel) };
  const settings = { ...record(payload.imageSettingsByChannel), ...record(publish.imageSettingsByChannel) };
  const byImages = { ...record(payload.imagesByChannel), ...record(publish.imagesByChannel) };
  const byVideos = { ...record(payload.videoByChannel), ...record(publish.videoByChannel) };
  for (const rawChannel of channels) {
    const channel = channelKey(rawChannel), mode = modes[channel] || modes[rawChannel];
    if (!Object.hasOwn(byImages, channel)) {
      const keys = record(settings[channel] || settings[rawChannel]).imageKeys;
      byImages[channel] = mode === "video" || mode === "none" ? [] : Array.isArray(keys)
        ? keys.flatMap(key => images.filter(image => image.imageKey === key)) : images;
    }
    if (!Object.hasOwn(byVideos, channel)) byVideos[channel] = mode === "images" || mode === "none" ? null : video;
  }
  const original = (source: RecordValue) => Object.fromEntries(mediaFields.filter(key => Object.hasOwn(source, key)).map(key => [key, source[key]]));
  return { ...payload, [originalKey]: { root: original(payload), publish: original(publish) },
    images, video, imagesByChannel: byImages, videoByChannel: byVideos,
    publishPayload: { ...publish, images, video, imagesByChannel: byImages, videoByChannel: byVideos } };
}

