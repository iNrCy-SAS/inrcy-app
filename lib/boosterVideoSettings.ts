export type BoosterVideoChannelKey =
  | "inrcy_site"
  | "site_web"
  | "inr_search"
  | "gmb"
  | "facebook"
  | "instagram"
  | "linkedin"
  | "tiktok"
  | "youtube_shorts"
  | "pinterest";

export type VideoFormat = "original" | "9_16" | "1_1" | "16_9";
export type VideoAdaptationMode = "safe_frame" | "cover_crop";

export type ChannelVideoSettings = {
  format: VideoFormat;
  adaptationMode: VideoAdaptationMode;
};

export type VideoSettingsByChannel = Partial<Record<BoosterVideoChannelKey, ChannelVideoSettings>>;
export type VideoFormatByChannel = Partial<Record<BoosterVideoChannelKey, VideoFormat>>;
export type VideoAdaptationModeByChannel = Partial<Record<BoosterVideoChannelKey, VideoAdaptationMode>>;

export const VIDEO_FORMAT_LABELS: Record<VideoFormat, string> = {
  original: "Original",
  "9_16": "9:16",
  "1_1": "1:1",
  "16_9": "16:9",
};

export const VIDEO_FORMAT_ASPECT_RATIOS: Record<VideoFormat, string> = {
  original: "16 / 9",
  "9_16": "9 / 16",
  "1_1": "1 / 1",
  "16_9": "16 / 9",
};

export const VIDEO_ADAPTATION_MODE_LABELS: Record<VideoAdaptationMode, string> = {
  safe_frame: "Vidéo entière sur fond sobre",
  cover_crop: "Recadrer plein écran",
};

type VideoSettingsTranslator = (
  key: string,
  values?: Record<string, string | number>,
) => string;

const VIDEO_ADAPTATION_MODE_MESSAGE_KEYS = {
  safe_frame: "video_adaptation_safe_frame",
  cover_crop: "video_adaptation_cover_crop",
} as const satisfies Record<VideoAdaptationMode, string>;

const VIDEO_ORIENTATION_MESSAGE_KEYS = {
  horizontal: "video_orientation_horizontal",
  vertical: "video_orientation_vertical",
  square: "video_orientation_square",
  unknown: "video_orientation_unknown",
} as const;

export const VIDEO_RECOMMENDED_FORMAT_BY_CHANNEL: Record<BoosterVideoChannelKey, VideoFormat> = {
  inrcy_site: "original",
  site_web: "original",
  inr_search: "original",
  gmb: "original",
  facebook: "16_9",
  instagram: "16_9",
  linkedin: "16_9",
  tiktok: "9_16",
  youtube_shorts: "9_16",
  pinterest: "1_1",
};

export const VIDEO_FORMAT_OPTIONS_BY_CHANNEL: Record<BoosterVideoChannelKey, VideoFormat[]> = {
  inrcy_site: ["original", "16_9", "1_1", "9_16"],
  site_web: ["original", "16_9", "1_1", "9_16"],
  inr_search: ["original", "16_9", "1_1", "9_16"],
  gmb: ["original", "16_9", "1_1", "9_16"],
  facebook: ["9_16", "1_1", "16_9", "original"],
  instagram: ["9_16", "1_1", "16_9", "original"],
  linkedin: ["1_1", "16_9", "9_16", "original"],
  tiktok: ["9_16", "1_1", "16_9", "original"],
  youtube_shorts: ["9_16", "1_1", "16_9", "original"],
  pinterest: ["1_1", "9_16", "16_9", "original"],
};

export function isBoosterVideoChannelKey(value: unknown): value is BoosterVideoChannelKey {
  return ["inrcy_site", "site_web", "inr_search", "gmb", "facebook", "instagram", "linkedin", "tiktok", "youtube_shorts", "pinterest"].includes(String(value || ""));
}

export function normalizeVideoFormat(channel: BoosterVideoChannelKey, value: unknown): VideoFormat {
  const raw = String(value || "").trim() as VideoFormat;
  const allowed = VIDEO_FORMAT_OPTIONS_BY_CHANNEL[channel] || [];
  if (allowed.includes(raw)) return raw;
  // Missing/invalid settings must never trigger an implicit reframe.
  return "original";
}

export function normalizeVideoAdaptationMode(value: unknown): VideoAdaptationMode {
  // Legacy `safe_blur` values are deliberately migrated to a non-blurred frame.
  return value === "cover_crop" ? "cover_crop" : "safe_frame";
}

type VideoSourceMetadataLike = {
  orientation?: unknown;
  width?: unknown;
  height?: unknown;
} | null | undefined;

export function getVideoSourceOrientation(sourceMetadata?: VideoSourceMetadataLike): "horizontal" | "vertical" | "square" | "unknown" {
  const rawOrientation = String(sourceMetadata?.orientation || "").trim().toLowerCase();
  if (rawOrientation === "horizontal" || rawOrientation === "vertical" || rawOrientation === "square") return rawOrientation;

  const width = Number(sourceMetadata?.width || 0);
  const height = Number(sourceMetadata?.height || 0);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return "unknown";
  const ratio = width / height;
  if (ratio > 1.08) return "horizontal";
  if (ratio < 0.92) return "vertical";
  return "square";
}

export function getRecommendedVideoFormatForSource(
  channel: BoosterVideoChannelKey,
  sourceMetadata?: VideoSourceMetadataLike,
): VideoFormat {
  const orientation = getVideoSourceOrientation(sourceMetadata);
  if (orientation === "horizontal") return "16_9";
  if (orientation === "vertical") return "9_16";
  if (orientation === "square") return "1_1";
  return VIDEO_RECOMMENDED_FORMAT_BY_CHANNEL[channel] || "original";
}

export function getVideoFormatLabel(channel: BoosterVideoChannelKey, format: VideoFormat, sourceMetadata?: VideoSourceMetadataLike) {
  const normalized = normalizeVideoFormat(channel, format);
  const label = VIDEO_FORMAT_LABELS[normalized] || VIDEO_FORMAT_LABELS.original;
  const recommended = getRecommendedVideoFormatForSource(channel, sourceMetadata);
  return normalized === recommended ? `${label} recommandé` : label;
}

export function getLocalizedVideoFormatLabel(
  channel: BoosterVideoChannelKey,
  format: VideoFormat,
  sourceMetadata: VideoSourceMetadataLike,
  translate: VideoSettingsTranslator,
) {
  const normalized = normalizeVideoFormat(channel, format);
  const label =
    normalized === "original"
      ? translate("video_format_original")
      : VIDEO_FORMAT_LABELS[normalized];
  const recommended = getRecommendedVideoFormatForSource(channel, sourceMetadata);
  return normalized === recommended
    ? translate("video_format_recommended", { format: label })
    : label;
}

export function getLocalizedVideoAdaptationModeLabel(
  mode: VideoAdaptationMode,
  translate: VideoSettingsTranslator,
) {
  return translate(VIDEO_ADAPTATION_MODE_MESSAGE_KEYS[mode]);
}

export function getLocalizedVideoOrientationLabel(
  orientation: "horizontal" | "vertical" | "square" | "unknown" | null | undefined,
  translate: VideoSettingsTranslator,
) {
  return translate(VIDEO_ORIENTATION_MESSAGE_KEYS[orientation || "unknown"]);
}

export function getDefaultChannelVideoSettings(
  channel: BoosterVideoChannelKey,
  sourceMetadata?: VideoSourceMetadataLike,
): ChannelVideoSettings {
  // Original-first: recommendations remain visible in the Adapter, but no
  // transform is selected until the pro explicitly chooses and applies one.
  void channel;
  void sourceMetadata;
  return {
    format: "original",
    adaptationMode: "safe_frame",
  };
}

function readChannelSettingNode(node: unknown): Record<string, unknown> | null {
  return node && typeof node === "object" && !Array.isArray(node) ? (node as Record<string, unknown>) : null;
}

export function normalizeChannelVideoSettings(
  channel: BoosterVideoChannelKey,
  value: unknown,
  fallbackFormat?: unknown,
  fallbackAdaptationMode?: unknown,
  sourceMetadata?: VideoSourceMetadataLike,
): ChannelVideoSettings {
  const node = readChannelSettingNode(value);
  return {
    format: normalizeVideoFormat(channel, node?.format ?? fallbackFormat ?? "original"),
    adaptationMode: normalizeVideoAdaptationMode(node?.adaptationMode ?? node?.fitMode ?? fallbackAdaptationMode),
  };
}

export function buildVideoSettingsByChannel(params: {
  channels: readonly BoosterVideoChannelKey[];
  videoSettingsByChannel?: unknown;
  videoFormatByChannel?: unknown;
  videoAdaptationModeByChannel?: unknown;
  sourceMetadata?: VideoSourceMetadataLike;
}): VideoSettingsByChannel {
  const settingsNode = readChannelSettingNode(params.videoSettingsByChannel) || {};
  const formatNode = readChannelSettingNode(params.videoFormatByChannel) || {};
  const adaptationNode = readChannelSettingNode(params.videoAdaptationModeByChannel) || {};

  return Array.from(new Set(params.channels.filter(isBoosterVideoChannelKey))).reduce<VideoSettingsByChannel>((acc, channel) => {
    acc[channel] = normalizeChannelVideoSettings(
      channel,
      settingsNode[channel],
      formatNode[channel],
      adaptationNode[channel],
      params.sourceMetadata,
    );
    return acc;
  }, {});
}

export function getAutomaticVideoSettingsForPublication(params: {
  channel: BoosterVideoChannelKey;
  settings?: ChannelVideoSettings | null;
  durationSeconds?: unknown;
}): ChannelVideoSettings {
  // Respect the professional's selected format. A short YouTube video is not
  // automatically converted to 9:16: the original is published when accepted,
  // and a variant is created only after an explicit adaptation choice or a real
  // channel incompatibility.
  return normalizeChannelVideoSettings(params.channel, params.settings);
}

export function splitVideoSettingsByChannel(settings: VideoSettingsByChannel): {
  videoFormatByChannel: VideoFormatByChannel;
  videoAdaptationModeByChannel: VideoAdaptationModeByChannel;
} {
  return Object.entries(settings).reduce(
    (acc, [rawChannel, rawSettings]) => {
      if (!isBoosterVideoChannelKey(rawChannel)) return acc;
      const normalized = normalizeChannelVideoSettings(rawChannel, rawSettings);
      acc.videoFormatByChannel[rawChannel] = normalized.format;
      acc.videoAdaptationModeByChannel[rawChannel] = normalized.adaptationMode;
      return acc;
    },
    {
      videoFormatByChannel: {} as VideoFormatByChannel,
      videoAdaptationModeByChannel: {} as VideoAdaptationModeByChannel,
    },
  );
}

export function getVideoPreviewAspectRatio(
  format: VideoFormat | null | undefined,
  sourceMetadata?: VideoSourceMetadataLike,
): string {
  const normalized = format || "original";
  const width = Number(sourceMetadata?.width || 0);
  const height = Number(sourceMetadata?.height || 0);
  if (normalized === "original" && Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return `${width} / ${height}`;
  }
  return VIDEO_FORMAT_ASPECT_RATIOS[normalized] || VIDEO_FORMAT_ASPECT_RATIOS.original;
}

export function getVideoPreviewFitMode(mode: VideoAdaptationMode | null | undefined): "contain" | "cover" {
  return normalizeVideoAdaptationMode(mode) === "cover_crop" ? "cover" : "contain";
}
