import {
  getDefaultChannelVideoSettings,
  isBoosterVideoChannelKey,
  normalizeVideoAdaptationMode,
  normalizeVideoFormat,
  type BoosterVideoChannelKey,
  type VideoAdaptationMode,
  type VideoFormat,
} from "./boosterVideoSettings.ts";
import { INR_MEDIA_VIDEO_PUBLISH_MAX_BYTES } from "./mediaRules.ts";
import {
  GOOGLE_BUSINESS_VIDEO_PROFILE,
  GOOGLE_BUSINESS_VIDEO_MAX_BYTES,
} from "./googleBusinessMediaPolicy.ts";

export type VideoPublicationProfile =
  | "default"
  | "light_background"
  | typeof GOOGLE_BUSINESS_VIDEO_PROFILE;

export type BoosterVideoTransformTarget = {
  format: VideoFormat;
  width: number | null;
  height: number | null;
  aspectRatio: string;
  label: string;
};

export type BoosterVideoQualityProfile = {
  label: string;
  crf: number;
  preset: "veryfast" | "superfast";
  maxVideoKbps: number;
  maxrate: string;
  bufsize: string;
  audioBitrate: string;
  maxOutputBytes: number;
};

export type BoosterVideoTransformRequestVariant = {
  key?: string;
  channel?: BoosterVideoChannelKey;
  format?: VideoFormat;
  adaptationMode?: VideoAdaptationMode;
  publicationProfile?: VideoPublicationProfile;
};

export type BoosterVideoTransformVariantPlan = {
  key: string;
  channel: BoosterVideoChannelKey | null;
  format: VideoFormat;
  adaptationMode: VideoAdaptationMode;
  publicationProfile: VideoPublicationProfile;
  target: BoosterVideoTransformTarget;
  signature: string;
};

export type BoosterVideoTransformedVariant =
  Omit<BoosterVideoTransformVariantPlan, "publicationProfile"> & {
    publicationProfile?: VideoPublicationProfile;
    storagePath: string;
    publicUrl: string;
    contentType: string;
    size: number;
    duration: number | null;
    width?: number | null;
    height?: number | null;
    generatedAt: string;
    quality?: BoosterVideoQualityProfile;
    // Compatibilité avec les anciennes données / payloads côté UI.
    url?: string | null;
    name?: string | null;
    type?: string | null;
  };

export type BoosterVideoTransformSource = {
  bucket?: string | null;
  storagePath?: string | null;
  publicUrl?: string | null;
  url?: string | null;
  name?: string | null;
  type?: string | null;
  size?: number | null;
  duration?: number | null;
  sourceMetadata?: {
    width?: number | null;
    height?: number | null;
    duration?: number | null;
    videoCodec?: string | null;
    audioCodec?: string | null;
    frameRate?: number | null;
    fps?: number | null;
    hasAudio?: boolean | null;
    containerFormats?: string[] | null;
    pixelFormat?: string | null;
    compatibilityProof?: "server_ffmpeg" | "canonical_derivative" | null;
    [key: string]: unknown;
  } | null;
};

export const VIDEO_TRANSFORM_TARGETS: Record<
  Exclude<VideoFormat, "original">,
  BoosterVideoTransformTarget
> = {
  "9_16": {
    format: "9_16",
    width: 720,
    height: 1280,
    aspectRatio: "9:16",
    label: "9:16 vertical",
  },
  "1_1": {
    format: "1_1",
    width: 720,
    height: 720,
    aspectRatio: "1:1",
    label: "1:1 carré",
  },
  "16_9": {
    format: "16_9",
    width: 1280,
    height: 720,
    aspectRatio: "16:9",
    label: "16:9 horizontal",
  },
};

export const VIDEO_TRANSFORM_QUALITY_PROFILES: Record<
  VideoFormat,
  BoosterVideoQualityProfile
> = {
  "9_16": {
    label: "Qualité verticale rapide",
    crf: 22,
    preset: "veryfast",
    maxVideoKbps: 4_500,
    maxrate: "4500k",
    bufsize: "9000k",
    audioBitrate: "96k",
    maxOutputBytes: INR_MEDIA_VIDEO_PUBLISH_MAX_BYTES,
  },
  "1_1": {
    label: "Qualité carrée rapide",
    crf: 22,
    preset: "veryfast",
    maxVideoKbps: 4_000,
    maxrate: "4000k",
    bufsize: "8000k",
    audioBitrate: "96k",
    maxOutputBytes: INR_MEDIA_VIDEO_PUBLISH_MAX_BYTES,
  },
  "16_9": {
    label: "Qualité horizontale rapide",
    crf: 21,
    preset: "veryfast",
    maxVideoKbps: 5_500,
    maxrate: "5500k",
    bufsize: "11000k",
    audioBitrate: "96k",
    maxOutputBytes: INR_MEDIA_VIDEO_PUBLISH_MAX_BYTES,
  },
  original: {
    label: "Original optimisé",
    crf: 21,
    preset: "veryfast",
    maxVideoKbps: 5_500,
    maxrate: "5500k",
    bufsize: "11000k",
    audioBitrate: "96k",
    maxOutputBytes: INR_MEDIA_VIDEO_PUBLISH_MAX_BYTES,
  },
};

const GOOGLE_BUSINESS_QUALITY_PROFILE: BoosterVideoQualityProfile = {
  label: "Google Business sécurisé",
  crf: 21,
  preset: "superfast",
  maxVideoKbps: 6_000,
  maxrate: "6000k",
  bufsize: "12000k",
  audioBitrate: "128k",
  maxOutputBytes: GOOGLE_BUSINESS_VIDEO_MAX_BYTES,
};

export function getVideoTransformQualityProfile(
  format: VideoFormat,
  publicationProfile: VideoPublicationProfile = "default",
): BoosterVideoQualityProfile {
  if (publicationProfile === GOOGLE_BUSINESS_VIDEO_PROFILE) {
    return GOOGLE_BUSINESS_QUALITY_PROFILE;
  }
  return (
    VIDEO_TRANSFORM_QUALITY_PROFILES[format] ||
    VIDEO_TRANSFORM_QUALITY_PROFILES.original
  );
}

export function getVideoPublicationProfileForChannel(
  channel: BoosterVideoChannelKey | null | undefined,
): VideoPublicationProfile {
  if (channel === "gmb") return GOOGLE_BUSINESS_VIDEO_PROFILE;
  if (
    channel === "site_web" ||
    channel === "inr_search"
  ) {
    return "light_background";
  }
  return "default";
}

export function getVideoTransformTarget(
  format: VideoFormat,
): BoosterVideoTransformTarget {
  if (format === "original") {
    return {
      format: "original",
      width: null,
      height: null,
      aspectRatio: "original",
      label: "Format original optimisé",
    };
  }
  return VIDEO_TRANSFORM_TARGETS[format] || getVideoTransformTarget("original");
}

function sanitizeVariantKey(value: string) {
  return (
    String(value || "")
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[^a-zA-Z0-9._-]+/g, "-")
      .replace(/[-_]{2,}/g, "-")
      .replace(/^[-_.]+|[-_.]+$/g, "")
      .toLowerCase()
      .slice(0, 90) || "variant"
  );
}

export function buildVideoTransformSignature(
  format: VideoFormat,
  adaptationMode: VideoAdaptationMode,
  publicationProfile: VideoPublicationProfile = "default",
) {
  const base = `${format}:${adaptationMode}`;
  return publicationProfile === "default" ? base : `${base}:${publicationProfile}`;
}

export function normalizeVideoTransformVariant(
  raw: BoosterVideoTransformRequestVariant,
  index: number,
): BoosterVideoTransformVariantPlan | null {
  const channel = isBoosterVideoChannelKey(raw.channel) ? raw.channel : null;
  const channelDefaults = channel
    ? getDefaultChannelVideoSettings(channel)
    : {
        format: "original" as VideoFormat,
        adaptationMode: "safe_frame" as VideoAdaptationMode,
      };
  const format = channel
    ? normalizeVideoFormat(channel, raw.format || channelDefaults.format)
    : raw.format || "original";
  const adaptationMode = normalizeVideoAdaptationMode(
    raw.adaptationMode || channelDefaults.adaptationMode,
  );
  const publicationProfile =
    raw.publicationProfile || getVideoPublicationProfileForChannel(channel);
  const signature = buildVideoTransformSignature(
    format,
    adaptationMode,
    publicationProfile,
  );
  const key = sanitizeVariantKey(
    raw.key ||
      (channel
        ? `${channel}-${signature}`
        : `variant-${index + 1}-${signature}`),
  );

  return {
    key,
    channel,
    format,
    adaptationMode,
    publicationProfile,
    target: getVideoTransformTarget(format),
    signature,
  };
}

export function buildVideoTransformPlan(
  variants: readonly BoosterVideoTransformRequestVariant[],
): BoosterVideoTransformVariantPlan[] {
  const seen = new Set<string>();
  const plans: BoosterVideoTransformVariantPlan[] = [];

  variants.forEach((variant, index) => {
    const normalized = normalizeVideoTransformVariant(variant, index);
    if (!normalized) return;
    const dedupeKey = normalized.signature;
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    plans.push(normalized);
  });

  return plans;
}

export function getVariantForChannel(
  variants: readonly BoosterVideoTransformedVariant[] | null | undefined,
  channel: BoosterVideoChannelKey,
  format: VideoFormat,
  adaptationMode: VideoAdaptationMode,
) {
  const profile = getVideoPublicationProfileForChannel(channel);
  const signature = buildVideoTransformSignature(
    format,
    adaptationMode,
    profile,
  );
  const exact = (variants || []).find(
    (variant) => variant.signature === signature,
  );
  if (exact) return exact;

  // Compatibilité temporaire : une ancienne variante sans profil reste
  // utilisable uniquement si elle respecte ensuite la validation du canal.
  if (profile === GOOGLE_BUSINESS_VIDEO_PROFILE) {
    const legacySignature = buildVideoTransformSignature(
      format,
      adaptationMode,
    );
    const legacy = (variants || []).find(
      (variant) => variant.signature === legacySignature,
    );
    if (legacy) return legacy;
  }

  if (format === "original") return null;
  return (
    (variants || []).find(
      (variant) => !variant.signature && variant.channel === channel,
    ) || null
  );
}
