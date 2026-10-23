import type { ChannelKey, ChannelMediaMode } from "./publishModal.shared";

const ROUTINE_PUBLICATION_NOTICES = new Set([
  "pinterest_multi_image", "pinterest_board_selected", "pinterest_video_cover_auto",
  "tiktok_photo_settings_validated", "tiktok_video_settings_validated", "linkedin_video_finalization",
]);

export function getActionablePublicationWarningCodes(codes: readonly string[]) {
  return codes.filter((code) => !ROUTINE_PUBLICATION_NOTICES.has(code));
}

/** Defaults are applied when the media pool changes, before per-channel validation. */
export function getPublicationMediaPoolDefaults(
  channels: readonly ChannelKey[],
  imageKeys: readonly string[],
  hasVideo: boolean,
  imageLimit: (channel: ChannelKey) => number,
) {
  const modes: Partial<Record<ChannelKey, ChannelMediaMode>> = {};
  const selections: Partial<Record<ChannelKey, string[]>> = {};
  for (const channel of channels) {
    if (channel === "youtube_shorts") {
      modes[channel] = hasVideo ? "video" : "none";
    } else if (imageKeys.length) {
      modes[channel] = "images";
      selections[channel] = imageKeys.slice(0, imageLimit(channel));
    } else {
      modes[channel] = hasVideo ? "video" : "none";
    }
  }
  return { modes, selections };
}
