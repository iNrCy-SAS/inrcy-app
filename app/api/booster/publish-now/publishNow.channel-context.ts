import { limitBoosterChannelContent } from "@/lib/boosterChannelRules";
import {
  sanitizeBoosterSiteText,
  stripSiteTextFormatting,
  stripSiteTextFormattingPreserveLayout,
} from "@/lib/boosterFormatting";
import type { VideoSettingsByChannel } from "@/lib/boosterVideoSettings";
import { getVariantForChannel } from "@/lib/boosterVideoTransforms";
import { validateVideoPublicationForChannel } from "@/lib/videoPublicationPolicy";
import {
  normalizeHashtag,
  type ChannelKey,
  type ChannelMediaMode,
  type ImagePayload,
  type ImageSet,
  type ImagesByChannel,
  type PersistedVideoAttachment,
  type PostByChannel,
  type PostPayload,
} from "./publishNow.foundations";

export function createPublishNowVideoContext(params: {
  publicationVideo: PersistedVideoAttachment | null;
  videoSettingsByChannel: VideoSettingsByChannel;
  selected: ChannelKey[];
  mediaModeByChannel: Partial<Record<ChannelKey, ChannelMediaMode>>;
}) {
  const {
    publicationVideo,
    videoSettingsByChannel,
    selected,
    mediaModeByChannel,
  } = params;

  const getPublicationVideoForChannel = (
    channel: ChannelKey,
  ): PersistedVideoAttachment | null => {
    if (!publicationVideo) return null;
    const settings = videoSettingsByChannel[channel];
    if (!settings) return publicationVideo;
    const usesOriginalSource = settings.format === "original";
    const sourceValidation = validateVideoPublicationForChannel({
      channel,
      name: publicationVideo.name,
      type: publicationVideo.type,
      storagePath: publicationVideo.storagePath,
      sizeBytes: publicationVideo.size,
      durationSeconds: publicationVideo.duration,
      width: publicationVideo.sourceMetadata?.width,
      height: publicationVideo.sourceMetadata?.height,
    });
    if (usesOriginalSource) {
      return sourceValidation.ok ? publicationVideo : null;
    }

    const variant = getVariantForChannel(
      publicationVideo.transformedVariants,
      channel as any,
      settings.format,
      settings.adaptationMode,
    );
    if (!variant?.publicUrl || !variant?.storagePath) {
      return null;
    }
    const variantValidation = validateVideoPublicationForChannel({
      channel,
      name: variant.name || `video-${channel}.mp4`,
      type: variant.contentType,
      storagePath: variant.storagePath,
      sizeBytes: variant.size,
      durationSeconds: variant.duration ?? publicationVideo.duration,
      width: variant.width,
      height: variant.height,
    });
    if (!variantValidation.ok) {
      return null;
    }

    return {
      ...publicationVideo,
      name: `${publicationVideo.name} — ${variant.target?.label || settings.format}`,
      type: variant.contentType || publicationVideo.type || "video/mp4",
      size: Number(variant.size || publicationVideo.size || 0),
      duration: variant.duration ?? publicationVideo.duration ?? null,
      url: variant.publicUrl,
      publicUrl: variant.publicUrl,
      // Server-generated publication variants are always persisted in the
      // public `booster` bucket, even when their original source is private.
      // Keep the durable storage identity aligned with the actual bytes.
      bucket: "booster",
      storagePath:
        variant.storagePath || publicationVideo.storagePath || null,
      sourceMetadata: {
        ...(publicationVideo.sourceMetadata || {}),
        duration: variant.duration ?? publicationVideo.duration ?? null,
        width: variant.width ?? null,
        height: variant.height ?? null,
      },
      transformedVariant: variant,
      sourceVideo: {
        ...publicationVideo,
        sourceVideo: null,
        transformedVariant: null,
      },
    };
  };

  const buildPublicationVideoByChannel = () => {
    if (!publicationVideo)
      return {} as Partial<Record<ChannelKey, PersistedVideoAttachment>>;
    return Object.fromEntries(
      selected
        .filter((channel) => mediaModeByChannel[channel] === "video")
        .map((channel) => [channel, getPublicationVideoForChannel(channel)]),
    ) as Partial<Record<ChannelKey, PersistedVideoAttachment>>;
  };

  return {
    getPublicationVideoForChannel,
    buildPublicationVideoByChannel,
  };
}

export function createPublishNowPostResolver(params: {
  post: PostPayload;
  postByChannel: PostByChannel;
}) {
  const { post, postByChannel } = params;
  const fallbackTitle = String(post.title || "").trim();
  const fallbackContent = String(post.content || "").trim();
  const fallbackCta = String(post.cta || "").trim();
  const fallbackHashtags = Array.isArray(post.hashtags)
    ? post.hashtags
        .map((h) => normalizeHashtag(String(h || "")))
        .filter(Boolean)
        .slice(0, 20)
    : [];

  const getChannelPost = (channel: ChannelKey): PostPayload => {
    const raw = ((channel === "inrcy_site"
      ? postByChannel?.inrcy_site || postByChannel?.site_web
      : channel === "site_web"
        ? postByChannel?.site_web || postByChannel?.inrcy_site
        : channel === "inr_search"
          ? postByChannel?.inr_search || postByChannel?.site_web || postByChannel?.inrcy_site
          : postByChannel?.[channel]) || {}) as PostPayload;
    const isSiteChannel = channel === "inrcy_site" || channel === "site_web" || channel === "inr_search";
    const rawTitle = String(raw.title || fallbackTitle || "").trim();
    const rawContent = limitBoosterChannelContent(
      channel,
      String(raw.content || fallbackContent || "").trim(),
    );
    const rawCta = String(raw.cta || fallbackCta || "").trim();
    const title = isSiteChannel
      ? sanitizeBoosterSiteText(rawTitle)
      : stripSiteTextFormatting(rawTitle);
    const content = isSiteChannel
      ? sanitizeBoosterSiteText(rawContent)
      : stripSiteTextFormattingPreserveLayout(rawContent);
    const cta = stripSiteTextFormatting(rawCta);
    const ctaMode = String(raw.ctaMode || "").trim();
    const ctaUrl = String(raw.ctaUrl || "").trim();
    const ctaPhone = String(raw.ctaPhone || "").trim();
    const hashtags = Array.isArray(raw.hashtags)
      ? raw.hashtags
          .map((h) => normalizeHashtag(String(h || "")))
          .filter(Boolean)
          .slice(0, 20)
      : fallbackHashtags;
    return { title, content, cta, ctaMode, ctaUrl, ctaPhone, hashtags };
  };

  return getChannelPost;
}

export type ChannelImageUrlKey =
  | "images"
  | "publishableUrls"
  | "instagramPublishableUrls"
  | "socialFeedPublishableUrls"
  | "gmbPublishableUrls";

export function createPublishNowImageContext(params: {
  publicationImageSet: ImageSet;
  channelImageSets: Partial<Record<ChannelKey, ImageSet>>;
  baseImageSet: ImageSet;
  imagesByChannel: ImagesByChannel;
  expectedImageCountByChannel?: Partial<Record<ChannelKey, number>>;
}) {
  const {
    publicationImageSet,
    channelImageSets,
    baseImageSet,
    imagesByChannel,
    expectedImageCountByChannel = {},
  } = params;

  const externalImageUrls = (
    publicationImageSet.publishableUrls.length
      ? publicationImageSet.publishableUrls
      : publicationImageSet.images
  ).slice(0, 5);
  const socialFeedImageUrls = (
    publicationImageSet.socialFeedPublishableUrls.length
      ? publicationImageSet.socialFeedPublishableUrls
      : externalImageUrls
  ).slice(0, 5);
  const instagramImageUrls = (
    publicationImageSet.instagramPublishableUrls.length
      ? publicationImageSet.instagramPublishableUrls
      : socialFeedImageUrls.length
        ? socialFeedImageUrls
        : externalImageUrls
  ).slice(0, 5);
  const gmbImageUrls = (
    publicationImageSet.gmbPublishableUrls.length
      ? publicationImageSet.gmbPublishableUrls
      : publicationImageSet.publishableUrls.length
        ? publicationImageSet.publishableUrls
        : publicationImageSet.images
  ).slice(0, 5);

  const getChannelImageSet = (channel: ChannelKey): ImageSet =>
    channelImageSets[channel] || baseImageSet;

  const getExpectedChannelImageCount = (channel: ChannelKey) => {
    const preservedExpectedCount = Math.max(
      0,
      Math.floor(Number(expectedImageCountByChannel[channel] || 0)),
    );
    if (preservedExpectedCount > 0) return preservedExpectedCount;
    const raw = Array.isArray(imagesByChannel?.[channel])
      ? (imagesByChannel[channel] as ImagePayload[])
      : [];
    const limited = raw.slice(0, 5);
    return limited.length;
  };

  /**
   * New Booster payloads carry a dedicated image set per channel. Once such
   * a set exists, never borrow a fallback from another channel: that could
   * publish the wrong crop/ratio. Complete derivative lists stay preferred,
   * while callers such as Instagram may explicitly accept the best partial
   * list and report the degradation instead of blocking publication. Legacy
   * payloads still use the historical global fallback passed by the caller.
   */
  const pickCompleteChannelImageUrls = (params: {
    channel: ChannelKey;
    candidates: ChannelImageUrlKey[];
    legacyFallback: string[];
    limit: number;
    allowPartial?: boolean;
  }) => {
    const {
      channel,
      candidates,
      legacyFallback,
      limit,
      allowPartial = false,
    } = params;
    const explicitSet = channelImageSets[channel];
    if (!explicitSet) {
      const legacyUrls = legacyFallback.filter(Boolean).slice(0, limit);
      const expected = Math.min(
        publicationImageSet.images.filter(Boolean).length,
        limit,
      );
      if (expected > 0 && legacyUrls.length < expected) {
        return allowPartial ? legacyUrls : [];
      }
      return expected > 0 ? legacyUrls.slice(0, expected) : legacyUrls;
    }

    const expected = Math.min(getExpectedChannelImageCount(channel), limit);
    let bestAvailable: string[] = [];
    for (const key of candidates) {
      const urls = (explicitSet[key] || []).filter(Boolean).slice(0, limit);
      if (urls.length > bestAvailable.length) bestAvailable = urls;
      if (expected > 0 && urls.length >= expected) {
        return urls.slice(0, expected);
      }
      if (expected === 0 && urls.length) {
        return urls.slice(0, limit);
      }
    }

    return allowPartial ? bestAvailable : [];
  };

  return {
    externalImageUrls,
    socialFeedImageUrls,
    instagramImageUrls,
    gmbImageUrls,
    getChannelImageSet,
    getExpectedChannelImageCount,
    pickCompleteChannelImageUrls,
  };
}
