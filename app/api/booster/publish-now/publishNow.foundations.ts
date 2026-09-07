import {
  INR_MEDIA_VIDEO_SOURCE_MAX_BYTES,
  INR_MEDIA_VIDEO_SOURCE_MAX_MB_LABEL,
} from "@/lib/mediaRules";
import type { findSimilarUpcomingScheduledPublication } from "@/lib/scheduledPublicationDedupe";
import { cleanExecutionIdempotencyKey } from "@/lib/executionIdempotency";
import type { TiktokPublicationSettings } from "@/lib/tiktokPublish";
import type { BoosterVideoTransformedVariant } from "@/lib/boosterVideoTransforms";
import {
  BOOSTER_PUBLICATION_CHANNEL_LABELS as CHANNEL_LABELS,
  isBoosterPublishFailureRetryable,
  type BoosterPublicationChannelKey,
} from "@/lib/boosterPublicationPolicy";
import { classifyBoosterPublicationResult } from "@/lib/boosterPublicationOutcome";

export type ChannelKey = BoosterPublicationChannelKey;

export type JsonRecord = Record<string, unknown>;

export const asRecord = (v: unknown): JsonRecord =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as JsonRecord) : {};

export const IMMEDIATE_PUBLISH_DUPLICATE_LOOKAHEAD_MINUTES = 240;

export function formatDuplicateScheduledAt(value?: string | null) {
  const time = Date.parse(String(value || ""));
  if (!Number.isFinite(time)) return "prochainement";
  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "short",
    timeStyle: "short",
    timeZone: "Europe/Paris",
  }).format(new Date(time));
}

export function buildImmediateDuplicateMessage(
  duplicate: Awaited<
    ReturnType<typeof findSimilarUpcomingScheduledPublication>
  >,
) {
  const channels = (duplicate.overlappingChannels || [])
    .map((channel) => CHANNEL_LABELS[channel as ChannelKey] || channel)
    .filter(Boolean)
    .join(", ");
  const dateLabel = formatDuplicateScheduledAt(duplicate.existingScheduledAt);
  return `Cette publication semble déjà programmée${channels ? ` sur ${channels}` : ""} pour ${dateLabel}. Pour éviter une double publication, annulez la programmation existante ou modifiez le contenu avant de publier maintenant.`;
}

export const PUBLISH_IDEMPOTENCY_SCOPE = "booster_publish";

export const PUBLISH_IDEMPOTENCY_TTL_MS = 30 * 60 * 1000;

export function buildPublishIdempotencyKey(args: {
  body: any;
  origin: JsonRecord | null;
}) {
  const explicit = cleanExecutionIdempotencyKey(
    args.body.idempotencyKey ||
      args.body.idempotency_key ||
      args.origin?.idempotencyKey ||
      args.origin?.idempotency_key,
  );
  if (explicit) return explicit;

  const scheduledActionId = cleanExecutionIdempotencyKey(
    args.body.origin?.scheduledActionId || args.origin?.scheduledActionId,
  );
  if (scheduledActionId) return `scheduled_publication:${scheduledActionId}`;

  return "";
}

export function buildPublishIdempotencyMetadata(args: {
  origin: JsonRecord | null;
  channels: ChannelKey[];
  source: string;
}) {
  return {
    source: args.source || null,
    origin: args.origin || null,
    channels: args.channels,
    workflow: "booster_publish",
  };
}

export function buildResultsSummary(
  results: Record<string, any>,
  selected: ChannelKey[],
) {
  const entries = selected.map((channel) => {
    const value = results[channel] || {};
    const outcome = classifyBoosterPublicationResult(value);
    const ok = outcome.ok;
    const code = String(value?.code || "").trim() || null;
    const retryable = isBoosterPublishFailureRetryable({
      ok,
      code,
      retryable: value?.retryable,
    });
    return {
      channel,
      label: CHANNEL_LABELS[channel] || channel,
      ok,
      status: outcome.status,
      code,
      retryable,
      error: !ok ? String(value?.error || "erreur") : null,
      warning: outcome.warningCode,
      warning_kind: outcome.warningKind,
      warning_message: outcome.warningMessage,
    };
  });

  const successes = entries.filter((entry) => entry.ok);
  const failures = entries.filter((entry) => !entry.ok);
  const warnings = entries.filter(
    (entry) => entry.status === "published_with_warning",
  );
  const pending = entries.filter((entry) => entry.status === "processing");

  return {
    total: entries.length,
    successCount: successes.length,
    failureCount: failures.length,
    warningCount: warnings.length,
    mediaWarningCount: warnings.filter(
      (entry) => entry.warning_kind === "media_degraded",
    ).length,
    pendingCount: pending.length,
    allSucceeded: failures.length === 0,
    allFailed: successes.length === 0,
    entries,
    successChannels: successes.map((entry) => entry.channel),
    failedChannels: failures.map((entry) => entry.channel),
  };
}

export function slugify(input: string): string {
  return String(input || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "")
    .slice(0, 80);
}

export type ImagePayload = {
  mediaId?: string;
  name: string;
  type: string;
  dataUrl?: string; // base64 data URL
  storagePath?: string; // Supabase Storage path
  bucket?: string;
  publicUrl?: string;
  renderedUrl?: string;
  originalUrl?: string;
  originalPublicUrl?: string;
  originalStoragePath?: string;
  originalName?: string;
  originalType?: string;
  imageKey?: string;
  transform?: unknown;
  imageMeta?: unknown;
  imageDecisionMode?: "original" | "adapted" | "customized" | "unsupported";
  imageDecisionLabel?:
    "Originale" | "Adaptée" | "Personnalisée" | "Indisponible";
  isCustomized?: boolean;
  publicationReady?: boolean;
};

export type PublicationMediaType = "images" | "video";

export type ChannelMediaMode = "video" | "images" | "none";

export type InstagramPublicationPlacement = "reel" | "story";

export type InstagramPublicationSettings = {
  placement: InstagramPublicationPlacement;
  mediaType: "REELS" | "STORIES";
  shareToFeed: boolean;
  mediaOnly: true;
};

export type VideoPayload = {
  name?: string;
  type?: string;
  size?: number;
  lastModified?: number;
  duration?: number | null;
  storagePath?: string;
  publicUrl?: string;
  url?: string;
  thumbnailUrl?: string | null;
  thumbnailStoragePath?: string | null;
  thumbnailBucket?: string | null;
};

export type PersistedVideoAttachment = {
  mediaId?: string | null;
  name: string;
  type: string;
  size: number;
  duration: number | null;
  url: string;
  publicUrl: string;
  storagePath: string | null;
  bucket?: string | null;
  thumbnailUrl: string | null;
  thumbnailStoragePath: string | null;
  thumbnailBucket: string | null;
  sourceMetadata?: {
    width?: number | null;
    height?: number | null;
    duration?: number | null;
    [key: string]: unknown;
  } | null;
  transformedVariants?: BoosterVideoTransformedVariant[];
  transformedVariant?: BoosterVideoTransformedVariant | null;
  sourceVideo?: PersistedVideoAttachment | null;
};

export const BOOSTER_MAX_VIDEO_SOURCE_BYTES = INR_MEDIA_VIDEO_SOURCE_MAX_BYTES;

export const BOOSTER_MAX_VIDEO_SOURCE_MB_LABEL = INR_MEDIA_VIDEO_SOURCE_MAX_MB_LABEL;

export function normalizePublicationMediaType(value: unknown): PublicationMediaType {
  return value === "video" ? "video" : "images";
}

export function normalizeChannelMediaMode(
  value: unknown,
  fallback: ChannelMediaMode,
): ChannelMediaMode {
  return value === "video" || value === "images" || value === "none"
    ? value
    : fallback;
}

export function normalizeInstagramPublicationSettings(
  value: unknown,
): InstagramPublicationSettings | null {
  const raw = asRecord(value);
  const requested = String(raw.placement || raw.mode || "")
    .trim()
    .toLowerCase();
  if (!["reel", "reels", "story", "stories"].includes(requested)) {
    return null;
  }
  const story = requested === "story" || requested === "stories";
  return {
    placement: story ? "story" : "reel",
    mediaType: story ? "STORIES" : "REELS",
    shareToFeed: !story,
    mediaOnly: true,
  };
}

export function normalizeTiktokPublicationSettings(
  value: unknown,
): TiktokPublicationSettings | null {
  const raw = asRecord(value);
  const privacyLevel = String(raw.privacyLevel || "").trim();
  const commercialContentRaw = String(raw.commercialContent || "").trim();
  const commercialContent = ["none", "self", "branded", "both"].includes(
    commercialContentRaw,
  )
    ? commercialContentRaw
    : "";
  if (!privacyLevel || !commercialContent) return null;
  return {
    privacyLevel,
    allowComments: raw.allowComments === true,
    allowDuo: raw.allowDuo === true,
    allowStitch: raw.allowStitch === true,
    commercialContent:
      commercialContent as TiktokPublicationSettings["commercialContent"],
    aiContent: raw.aiContent === true,
    photoAutoMusic: raw.photoAutoMusic === true,
    musicUsageConfirmed: raw.musicUsageConfirmed === true,
  };
}

export type EditableImageAttachment = {
  name: string;
  type?: string | null;
  url: string;
  renderedUrl: string;
  publicUrl: string;
  originalUrl?: string | null;
  originalPublicUrl?: string | null;
  originalStoragePath?: string | null;
  originalName?: string | null;
  originalType?: string | null;
  imageKey?: string | null;
  transform?: unknown;
  imageMeta?: unknown;
  imageDecisionMode?: string | null;
  imageDecisionLabel?: string | null;
  isCustomized?: boolean;
};

export type PostPayload = {
  title: string;
  content: string;
  cta: string;
  ctaMode?: string;
  ctaUrl?: string;
  ctaPhone?: string;
  hashtags?: string[];
};

export type PostByChannel = Partial<Record<ChannelKey, PostPayload>>;

export type ImagesByChannel = Partial<Record<ChannelKey, ImagePayload[]>>;

export type ImageSet = {
  images: string[];
  publishableUrls: string[];
  instagramPublishableUrls: string[];
  socialFeedPublishableUrls: string[];
  siteCardPublishableUrls: string[];
  gmbPublishableUrls: string[];
  storagePaths: string[];
  publishableStoragePaths: string[];
  socialFeedStoragePaths: string[];
  imageKeys?: string[];
  editableAttachments?: EditableImageAttachment[];
};

export function buildAsyncPreparedImagePayloads(
  channel: ChannelKey,
  rawImages: ImagePayload[],
  imageSet: ImageSet,
): ImagePayload[] {
  const usesSocialDerivative = [
    "facebook",
    "linkedin",
    "tiktok",
    "pinterest",
  ].includes(channel);
  const usesInstagramDerivative = channel === "instagram";
  const usesGmbDerivative = channel === "gmb";
  const preferredUrls =
    usesInstagramDerivative && imageSet.instagramPublishableUrls.length
      ? imageSet.instagramPublishableUrls
      : usesGmbDerivative && imageSet.gmbPublishableUrls.length
        ? imageSet.gmbPublishableUrls
        : usesSocialDerivative && imageSet.socialFeedPublishableUrls.length
          ? imageSet.socialFeedPublishableUrls
          : imageSet.publishableUrls.length
            ? imageSet.publishableUrls
            : imageSet.images;
  const preferredStoragePaths = usesSocialDerivative
    ? imageSet.socialFeedStoragePaths
    : usesInstagramDerivative || usesGmbDerivative
      ? []
      : imageSet.publishableStoragePaths.length
        ? imageSet.publishableStoragePaths
        : imageSet.storagePaths;

  return preferredUrls.slice(0, 5).map((url, index) => {
    const raw = rawImages[index] || ({} as ImagePayload);
    const storagePath = String(preferredStoragePaths[index] || "").trim();
    const originalUrl = String(
      imageSet.images[index] ||
        raw.originalPublicUrl ||
        raw.publicUrl ||
        url,
    ).trim();
    return {
      name: String(raw.name || `image-${index + 1}.jpg`),
      type: String(raw.type || "image/jpeg"),
      publicUrl: url,
      renderedUrl: url,
      storagePath: storagePath || undefined,
      bucket: storagePath ? "booster" : undefined,
      originalPublicUrl: originalUrl || undefined,
      originalUrl: originalUrl || undefined,
      originalStoragePath:
        String(raw.originalStoragePath || "").trim() || undefined,
      originalName:
        String(raw.originalName || raw.name || "").trim() || undefined,
      originalType:
        String(raw.originalType || raw.type || "").trim() || undefined,
      imageKey:
        String(raw.imageKey || imageSet.imageKeys?.[index] || "").trim() ||
        undefined,
      transform: raw.transform,
      imageMeta: raw.imageMeta,
      imageDecisionMode: raw.imageDecisionMode,
      imageDecisionLabel: raw.imageDecisionLabel,
      isCustomized: raw.isCustomized === true,
      publicationReady: Boolean(storagePath),
    };
  });
}

export function buildQueuedPublicationSummary(selected: ChannelKey[]) {
  return {
    total: selected.length,
    successCount: 0,
    failureCount: 0,
    pendingCount: selected.length,
    allSucceeded: false,
    allFailed: false,
    entries: selected.map((channel) => ({
      channel,
      label: CHANNEL_LABELS[channel] || channel,
      ok: null,
      status: "queued",
      code: null,
      retryable: false,
      error: null,
      warning: null,
      warning_message: null,
    })),
    successChannels: [] as ChannelKey[],
    failedChannels: [] as ChannelKey[],
  };
}

export function imageExtensionFromMime(mimeType: unknown, fallbackName: unknown) {
  const mime = String(mimeType || "")
    .toLowerCase()
    .split(";")[0]
    ?.trim();
  if (mime === "image/png") return "png";
  if (mime === "image/webp") return "webp";
  if (mime === "image/avif") return "avif";
  if (mime === "image/gif") return "gif";
  if (mime === "image/jpeg" || mime === "image/jpg") return "jpg";
  const fallbackExtension = String(fallbackName || "")
    .split(".")
    .pop()
    ?.toLowerCase()
    .replace(/[^a-z0-9]/g, "");
  return fallbackExtension || "jpg";
}

export function normalizeHashtag(input: string): string {
  return String(input || "")
    .trim()
    .replace(/^#+/, "")
    .replace(/[^\p{L}\p{N}_]/gu, "")
    .slice(0, 40);
}

export function normalizePublicHttpUrl(input: unknown) {
  const raw = String(input || "").trim();
  return /^https?:\/\//i.test(raw) ? raw : "";
}

export function isExpired(expiresAt: unknown, skewSeconds = 60) {
  const iso = String(expiresAt || "").trim();
  if (!iso) return false;
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return false;
  return t <= Date.now() + skewSeconds * 1000;
}

export type ImageOptimizationFormats = {
  instagram?: boolean;
  socialFeed?: boolean;
  socialFeedNativeFirst?: boolean;
  siteCard?: boolean;
  gmb?: boolean;
};

export const EMPTY_IMAGE_FORMATS: ImageOptimizationFormats = {};

export function hasFinalImageGeometryDecision(img: ImagePayload) {
  return (
    img.imageDecisionMode === "original" ||
    img.imageDecisionMode === "adapted" ||
    img.imageDecisionMode === "customized"
  );
}

export function getRequiredImageFormatsForChannel(
  channel: ChannelKey,
): ImageOptimizationFormats {
  if (channel === "instagram") return { instagram: true };
  if (
    channel === "facebook" ||
    channel === "linkedin" ||
    channel === "tiktok" ||
    channel === "pinterest"
  ) {
    return { socialFeed: true, socialFeedNativeFirst: true };
  }
  if (channel === "gmb") return { gmb: true };
  // Site iNrCy / Site web use the original prepared image in the article payload.
  // Avoid generating social/Instagram/GMB derivatives when they are not needed.
  return EMPTY_IMAGE_FORMATS;
}

export function mergeImageFormats(
  ...formatsList: ImageOptimizationFormats[]
): ImageOptimizationFormats {
  return formatsList.reduce<ImageOptimizationFormats>(
    (acc, formats) => ({
      instagram: Boolean(acc.instagram || formats.instagram),
      socialFeed: Boolean(acc.socialFeed || formats.socialFeed),
      socialFeedNativeFirst: Boolean(
        acc.socialFeedNativeFirst || formats.socialFeedNativeFirst,
      ),
      siteCard: Boolean(acc.siteCard || formats.siteCard),
      gmb: Boolean(acc.gmb || formats.gmb),
    }),
    {},
  );
}

export function buildEditableImageAttachments(
  rawImages: ImagePayload[],
  imageSet: ImageSet,
  originalSourceUrlByKey?: ReadonlyMap<string, string>,
): EditableImageAttachment[] {
  return imageSet.images.map((renderedUrl, index) => {
    const raw = rawImages[index] || ({} as ImagePayload);
    const imageKey = String(raw.imageKey || "").trim();
    const mappedOriginalUrl = imageKey
      ? String(originalSourceUrlByKey?.get(imageKey) || "").trim()
      : "";
    const originalUrl = String(
      raw.originalPublicUrl ||
        raw.originalUrl ||
        mappedOriginalUrl ||
        raw.publicUrl ||
        renderedUrl ||
        "",
    ).trim();
    const name =
      String(raw.originalName || raw.name || `image-${index + 1}.jpg`).trim() ||
      `image-${index + 1}.jpg`;
    const type =
      String(raw.originalType || raw.type || "image/jpeg").trim() ||
      "image/jpeg";
    return {
      name,
      type,
      url: renderedUrl,
      renderedUrl,
      publicUrl: renderedUrl,
      originalUrl: originalUrl || null,
      originalPublicUrl: originalUrl || null,
      originalStoragePath: String(raw.originalStoragePath || "").trim() || null,
      originalName: String(raw.originalName || raw.name || "").trim() || null,
      originalType: String(raw.originalType || raw.type || "").trim() || null,
      imageKey: imageKey || null,
      transform: raw.transform || null,
      imageMeta: raw.imageMeta || null,
      imageDecisionMode: String(raw.imageDecisionMode || "").trim() || null,
      imageDecisionLabel: String(raw.imageDecisionLabel || "").trim() || null,
      isCustomized: raw.isCustomized === true,
    };
  });
}

/**
 * Builds the immutable media snapshot kept by iNrSend.
 *
 * Publication derivatives (crop, padding, social format) are deliberately
 * excluded: the history must always expose the reusable source selected by
 * the professional, even when a channel received an adapted rendition.
 */
export function buildOriginalImageAttachments(
  imageSet: ImageSet,
): EditableImageAttachment[] {
  const editableAttachments = Array.isArray(imageSet.editableAttachments)
    ? imageSet.editableAttachments
    : [];
  const sourceAttachments: EditableImageAttachment[] = editableAttachments.length
    ? editableAttachments
    : imageSet.images.map((url, index) => ({
        name: `image-${index + 1}.jpg`,
        type: "image/jpeg",
        url,
        renderedUrl: url,
        publicUrl: url,
        originalUrl: url,
        originalPublicUrl: url,
      }));

  return sourceAttachments.flatMap((attachment, index) => {
    const originalUrl = String(
      attachment.originalPublicUrl ||
        attachment.originalUrl ||
        attachment.publicUrl ||
        attachment.url ||
        attachment.renderedUrl ||
        "",
    ).trim();
    if (!originalUrl) return [];

    const originalName =
      String(
        attachment.originalName ||
          attachment.name ||
          `image-${index + 1}.jpg`,
      ).trim() || `image-${index + 1}.jpg`;
    const originalType =
      String(attachment.originalType || attachment.type || "image/jpeg").trim() ||
      "image/jpeg";

    return [
      {
        ...attachment,
        name: originalName,
        type: originalType,
        url: originalUrl,
        renderedUrl: originalUrl,
        publicUrl: originalUrl,
        originalUrl,
        originalPublicUrl: originalUrl,
        originalName,
        originalType,
        transform: null,
        isCustomized: false,
      },
    ];
  });
}
