type JsonRecord = Record<string, unknown>;
const record = (value: unknown): JsonRecord => value && typeof value === "object" && !Array.isArray(value) ? value as JsonRecord : {};
const kind = (value: unknown) => String(record(value).kind || record(value).mediaType || record(value).type || record(value).mimeType || "").toLowerCase();
const mediaList = (value: unknown) => Array.isArray(value) ? value.filter(item => Object.keys(record(item)).length) : [];

/** Builds a single new channel from existing owned assets, with no media generation. */
export function preparedAgentChannelUsingExistingMedia(args: {
  channel: string; post: JsonRecord; payload: JsonRecord; imageAssets: unknown[];
}) {
  const payload = args.payload;
  const common = record(payload.mediaAsset || payload.media || payload.imageAsset || payload.image);
  const video = record(payload.video || payload.videoAsset || (kind(common).includes("video") ? common : null));
  const mappedImages = Object.values(record(payload.imagesByChannel)).map(mediaList).find(items => items.length) || [];
  const images = [mediaList(payload.images), mediaList(args.imageAssets).filter(item => !kind(item).includes("video")), mappedImages, Object.keys(common).length && !kind(common).includes("video") ? [common] : []].find(items => items.length) || [];
  const useVideo = Object.keys(video).length > 0 && (kind(common).includes("video") || payload.mediaType === "video" || !images.length);
  return {
    channel: args.channel, post: args.post,
    mediaModeByChannel: useVideo ? "video" : images.length ? "images" : "none",
    ...(useVideo ? { videoByChannel: video } : { imagesByChannel: images }),
    ...(args.channel === "tiktok" && !useVideo ? { tiktokPhotoFullScreen: false } : {}),
  };
}
