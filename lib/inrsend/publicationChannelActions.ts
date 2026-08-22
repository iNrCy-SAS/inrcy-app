import { NextResponse } from "next/server";
import { requireUser } from "@/lib/requireUser";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { toExactStorageArrayBuffer } from "@/lib/supabaseStorageBinary";
import { tryDecryptToken } from "@/lib/oauthCrypto";
import { facebookPublishToPage, facebookPublishVideoToPage } from "@/lib/facebookPublish";
import { instagramPublishCarouselWithTokenFallback, instagramPublishPhotoWithTokenFallback, instagramPublishVideoWithTokenFallback, isInstagramAuthorizationErrorResult } from "@/lib/instagramPublish";
import { linkedinPublishImage, linkedinPublishMultiImage, linkedinPublishText, linkedinPublishVideo, linkedinResharePost } from "@/lib/linkedinPublish";
import { getGmbToken, gmbCreateLocalPost } from "@/lib/googleBusiness";
import { isGoogleBusinessPostOutcomeUnknown } from "@/lib/googleBusinessPostTransport";
import { filterGoogleBusinessMediaUrls } from "@/lib/googleBusinessMediaProbe";
import { optimizeForGoogleBusiness, optimizeForInstagram, optimizeForSiteCard, optimizeForSocialFeed } from "@/lib/imageOptimizer";
import { createHash, randomUUID } from "crypto";
import { jsonUserFacingError } from "@/lib/apiUserFacingErrors";
import { buildBoosterGmbSummary, buildBoosterHashtagLine, buildBoosterInstagramCaption, buildBoosterMessage, getBoosterGmbCallToAction } from "@/lib/boosterCta";
import { log } from "@/lib/observability/logger";
import { captureApiException } from "@/lib/observability/sentry";
import { getLinkedInAccessToken } from "@/lib/linkedinOAuth";
import { getPinterestAccessToken } from "@/lib/pinterestOAuth";
import {
  createPinterestImagePin,
  createPinterestVideoPin,
  deletePinterestPin,
  isPinterestPinEditRestrictedError,
  updatePinterestPin,
} from "@/lib/pinterestPublish";
import { buildVideoSettingsByChannel, normalizeChannelVideoSettings } from "@/lib/boosterVideoSettings";
import { INSTAGRAM_RECONNECT_USER_MESSAGE, isInstagramAuthorizationLikeMessage } from "@/lib/userFacingErrors";
import { getPublishChannelUserMessage, logPublishChannelFailure } from "@/lib/channelPublishDiagnostics";
import { ensureSystemManagedInrSearch, notifyInrSearchIndexing, revalidateInrSearchPublicRoutes } from "@/lib/inrSearchProvisioning";
import { getInrSearchPublicStatus } from "@/lib/inrSearchPublic";
import { limitBoosterChannelContent } from "@/lib/boosterChannelRules";
import { buildMetaGraphUrl } from "@/lib/metaGraphApi";
import { getChannelConnectionStates } from "@/lib/channelConnectionState";
import {
  isOfficialPublicationChannelConnected,
  publicationChannelRequiresReconnect,
} from "@/lib/publicationChannelAvailability";
import { getAppBubbleAccessMapForUser } from "@/lib/appBubbleAccessServer";
import { isBubbleEnabled, type AppBubbleKey } from "@/lib/bubbleAccess";
const LINKEDIN_VERSION = "202603";
const TIKTOK_INRSEND_EXTERNAL_ACTION_MESSAGE =
  "TikTok ne permet pas la modification ou la suppression réelle depuis iNrCy. Ouvrez TikTok pour gérer cette publication.";

export type ChannelKey = "inrcy_site" | "site_web" | "inr_search" | "gmb" | "facebook" | "instagram" | "linkedin" | "tiktok" | "pinterest";
type JsonRecord = Record<string, unknown>;

const CHANNEL_BUBBLE_KEYS: Record<ChannelKey, AppBubbleKey> = {
  inrcy_site: "site_inrcy",
  site_web: "site_web",
  inr_search: "inr_search",
  gmb: "gmb",
  facebook: "facebook",
  instagram: "instagram",
  linkedin: "linkedin",
  tiktok: "tiktok",
  pinterest: "pinterest",
};

const CHANNEL_LABELS: Record<ChannelKey, string> = {
  inrcy_site: "Site iNrCy",
  site_web: "Site web",
  inr_search: "iNr'Search",
  gmb: "Google Business",
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  tiktok: "TikTok",
  pinterest: "Pinterest",
};

type InstagramDeleteTokenCandidate = {
  source: string;
  token: string;
  preview: string;
};

type InstagramDeleteAttempt = {
  source: string;
  token_preview: string;
  requested_external_id?: string;
  delete_target_id?: string;
  delete_target_media_type?: string | null;
  verified?: boolean;
  verify_http_status?: number | null;
  verify_error?: ReturnType<typeof extractGraphErrorMeta> | null;
  delete_http_status?: number | null;
  delete_error?: ReturnType<typeof extractGraphErrorMeta> | null;
  success: boolean;
};

type InstagramDeleteResult = {
  ok: boolean;
  external_id: string;
  delete_target_id?: string;
  delete_target_media_type?: string | null;
  carousel_parent_protected?: boolean;
  verified: boolean;
  attempts: InstagramDeleteAttempt[];
  error?: string | null;
};

type AppEventRow = {
  id: string | number;
  payload?: unknown;
  created_at?: string;
};

type PostPayload = {
  title: string;
  content: string;
  cta: string;
  ctaMode?: string;
  ctaUrl?: string;
  ctaPhone?: string;
  hashtags: string[];
  images?: string[];
  attachments?: unknown[];
  publishableUrls?: string[];
  instagramPublishableUrls?: string[];
  socialFeedPublishableUrls?: string[];
  siteCardPublishableUrls?: string[];
  gmbPublishableUrls?: string[];
};

type ImagePayload = {
  name: string;
  type: string;
  dataUrl: string;
  originalUrl?: string | null;
  originalPublicUrl?: string | null;
  originalName?: string | null;
  originalType?: string | null;
  imageKey?: string | null;
  transform?: unknown;
  imageMeta?: unknown;
};

type EditableImageAttachment = {
  name: string;
  type?: string | null;
  url: string;
  renderedUrl: string;
  publicUrl: string;
  originalUrl?: string | null;
  originalPublicUrl?: string | null;
  originalName?: string | null;
  originalType?: string | null;
  imageKey?: string | null;
  transform?: unknown;
  imageMeta?: unknown;
};

type ImageSet = {
  images: string[];
  instagramPublishableUrls: string[];
  socialFeedPublishableUrls: string[];
  siteCardPublishableUrls: string[];
  gmbPublishableUrls: string[];
  editableAttachments?: EditableImageAttachment[];
};

type PublicationMediaType = "images" | "video";

type PersistedVideoAttachment = {
  name: string;
  type: string;
  size: number;
  duration: number | null;
  url: string;
  publicUrl: string;
  storagePath: string | null;
  thumbnailUrl: string | null;
  thumbnailStoragePath?: string | null;
  thumbnailBucket?: string | null;
  sourceMetadata?: unknown;
  sourceVideo?: unknown;
  transformedVariants?: unknown[];
  videoSettings?: unknown;
};

function asRecord(v: unknown): JsonRecord {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as JsonRecord) : {};
}

function normalizeHashtag(input: string): string {
  return String(input || "")
    .trim()
    .replace(/^#+/, "")
    .replace(/[^\p{L}\p{N}_]/gu, "")
    .slice(0, 40);
}

function normalizePublicHttpUrl(value: unknown): string {
  const raw = String(value || "").trim();
  if (!/^https?:\/\//i.test(raw)) return "";
  try {
    return new URL(raw).toString();
  } catch {
    return "";
  }
}

function dataUrlToBuffer(dataUrl: string) {
  const match = /^data:(.+?);base64,(.+)$/.exec(dataUrl || "");
  if (!match) return null;
  const mime = match[1];
  const b64 = match[2];
  return { mime, buffer: Buffer.from(b64, "base64") };
}

async function canGoogleFetchImageUrl(url: string): Promise<boolean> {
  const target = String(url || "").trim();
  if (!target) return false;

  for (const method of ["HEAD", "GET"] as const) {
    try {
      const response = await fetch(target, {
        method,
        redirect: "follow",
        cache: "no-store",
      });
      if (!response.ok) continue;
      const contentType = String(response.headers.get("content-type") || "").toLowerCase();
      if (contentType.startsWith("image/")) return true;
      if (method === "GET") return false;
    } catch {
      // Ignore and try the next strategy.
    }
  }

  return false;
}

function errorMessage(error: unknown, fallback = ""): string {
  if (error instanceof Error) return error.message || fallback;
  if (typeof error === "string") return error || fallback;
  const record = asRecord(error);
  return String(record.message || record.error || record.error_description || fallback || "");
}

function isGoogleBusinessImageError(error: unknown): boolean {
  const message = errorMessage(error).toLowerCase();
  return [
    "image",
    "images",
    "photo",
    "media",
    "sourceurl",
    "source url",
    "url",
    "fetch",
    "download",
    "content-type",
    "content type",
    "invalid media",
    "mediaitem",
  ].some((needle) => message.includes(needle));
}

async function getGoogleBusinessPublishableUrl(path: string): Promise<string | null> {
  const publicUrl = String(supabaseAdmin.storage.from("booster").getPublicUrl(path)?.data?.publicUrl || "").trim();
  if (publicUrl && await canGoogleFetchImageUrl(publicUrl)) return publicUrl;
  return null;
}

async function uploadPublicationImages(userId: string, newImages: ImagePayload[]): Promise<ImageSet> {
  const uploadedUrls: string[] = [];
  const instagramPublishableUrls: string[] = [];
  const socialFeedPublishableUrls: string[] = [];
  const siteCardPublishableUrls: string[] = [];
  const gmbPublishableUrls: string[] = [];
  const editableAttachments: EditableImageAttachment[] = [];

  for (const img of newImages.slice(0, 5)) {
    const parsed = dataUrlToBuffer(img.dataUrl);
    if (!parsed) throw new Error(`Image invalide : ${img?.name || "image"}.`);

    const ext = (img.name || "image").split(".").pop() || "jpg";
    const originalPath = `${userId}/${randomUUID()}.${ext}`;
    const originalUpload = await supabaseAdmin.storage.from("booster").upload(originalPath, toExactStorageArrayBuffer(parsed.buffer), {
      contentType: parsed.mime || img.type || "application/octet-stream",
      upsert: false,
    });
    if (originalUpload.error) throw originalUpload.error;

    const originalPublic = supabaseAdmin.storage.from("booster").getPublicUrl(originalPath);
    const originalUrl = String(originalPublic?.data?.publicUrl || "").trim();
    if (!originalUrl) throw new Error(`URL publique introuvable pour ${img?.name || "image"}.`);
    uploadedUrls.push(originalUrl);
    const sourceOriginalUrl = String(img.originalPublicUrl || img.originalUrl || originalUrl || "").trim();
    editableAttachments.push({
      name: String(img.originalName || img.name || "image.jpg").trim() || "image.jpg",
      type: String(img.originalType || img.type || parsed.mime || "image/jpeg").trim() || "image/jpeg",
      url: originalUrl,
      renderedUrl: originalUrl,
      publicUrl: originalUrl,
      originalUrl: sourceOriginalUrl || originalUrl,
      originalPublicUrl: sourceOriginalUrl || originalUrl,
      imageKey: String(img.imageKey || "").trim() || null,
      transform: img.transform || null,
      imageMeta: img.imageMeta || null,
    });

    const instagramOptimized = await optimizeForInstagram(parsed.buffer);
    const instagramPath = `${userId}/instagram/${randomUUID()}.${instagramOptimized.extension}`;
    const instagramUpload = await supabaseAdmin.storage.from("booster").upload(instagramPath, toExactStorageArrayBuffer(instagramOptimized.buffer), {
      contentType: instagramOptimized.mime,
      upsert: false,
    });
    if (instagramUpload.error) throw instagramUpload.error;
    const instagramUrl = String(
      supabaseAdmin.storage.from("booster").getPublicUrl(instagramPath)?.data
        ?.publicUrl || "",
    ).trim();
    if (!instagramUrl) throw new Error(`URL Instagram introuvable pour ${img?.name || "image"}.`);
    instagramPublishableUrls.push(instagramUrl);

    const socialOptimized = await optimizeForSocialFeed(parsed.buffer, {
      nativeFirst: true,
    });
    const socialPath = `${userId}/social-feed/${randomUUID()}.${socialOptimized.extension}`;
    const socialUpload = await supabaseAdmin.storage.from("booster").upload(socialPath, toExactStorageArrayBuffer(socialOptimized.buffer), {
      contentType: socialOptimized.mime,
      upsert: false,
    });
    if (socialUpload.error) throw socialUpload.error;
    const socialUrl = String(
      supabaseAdmin.storage.from("booster").getPublicUrl(socialPath)?.data
        ?.publicUrl || "",
    ).trim();
    if (!socialUrl) throw new Error(`URL social introuvable pour ${img?.name || "image"}.`);
    socialFeedPublishableUrls.push(socialUrl);

    const siteOptimized = await optimizeForSiteCard(parsed.buffer);
    const sitePath = `${userId}/site-card/${randomUUID()}.${siteOptimized.extension}`;
    const siteUpload = await supabaseAdmin.storage.from("booster").upload(sitePath, toExactStorageArrayBuffer(siteOptimized.buffer), {
      contentType: siteOptimized.mime,
      upsert: false,
    });
    if (siteUpload.error) throw siteUpload.error;
    const siteUrl = String(
      supabaseAdmin.storage.from("booster").getPublicUrl(sitePath)?.data
        ?.publicUrl || "",
    ).trim();
    if (!siteUrl) throw new Error(`URL site introuvable pour ${img?.name || "image"}.`);
    siteCardPublishableUrls.push(siteUrl);

    const gmbOptimized = await optimizeForGoogleBusiness(parsed.buffer);
    const gmbPath = `${userId}/gmb/${randomUUID()}.${gmbOptimized.extension}`;
    const gmbUpload = await supabaseAdmin.storage.from("booster").upload(gmbPath, toExactStorageArrayBuffer(gmbOptimized.buffer), {
      contentType: gmbOptimized.mime,
      upsert: false,
    });
    if (gmbUpload.error) throw gmbUpload.error;
    const gmbUrl = await getGoogleBusinessPublishableUrl(gmbPath);
    if (!gmbUrl) throw new Error(`URL Google Business introuvable pour ${img?.name || "image"}.`);
    gmbPublishableUrls.push(gmbUrl);
  }

  return { images: uploadedUrls, instagramPublishableUrls, socialFeedPublishableUrls, siteCardPublishableUrls, gmbPublishableUrls, editableAttachments };
}

function filterUrlsByIndexes(values: unknown, indexes: number[]): string[] {
  const items = Array.isArray(values) ? values.map((value) => String(value || "").trim()) : [];
  return indexes.map((index) => items[index]).filter(Boolean);
}

function emptyImageSet(): ImageSet {
  return { images: [], instagramPublishableUrls: [], socialFeedPublishableUrls: [], siteCardPublishableUrls: [], gmbPublishableUrls: [], editableAttachments: [] };
}

function getRenderedImageUrl(value: unknown): string {
  const record = asRecord(value);
  if (Object.keys(record).length) {
    return String(record.renderedUrl || record.rendered_url || record.url || record.publicUrl || record.public_url || "").trim();
  }
  return String(value || "").trim();
}

function getChannelImageSet(eventPayload: JsonRecord, publication: JsonRecord, channel: ChannelKey): ImageSet {
  const postByChannel = asRecord(eventPayload.postByChannel);
  const fallbackChannelPost = channel === "inrcy_site" ? postByChannel.site_web : channel === "site_web" ? postByChannel.inrcy_site : channel === "inr_search" ? (postByChannel.site_web || postByChannel.inrcy_site) : null;
  const raw = asRecord(postByChannel[channel] ?? fallbackChannelPost);
  const publicationImages = Array.isArray(publication.images)
    ? publication.images.map((value) => String(value || "").trim()).filter(Boolean)
    : [];

  const images = Array.isArray(raw.images)
    ? raw.images.map((value) => String(value || "").trim()).filter(Boolean)
    : Array.isArray(raw.attachments)
      ? raw.attachments.map(getRenderedImageUrl).filter(Boolean)
      : publicationImages;

  const inheritedIndexes = images.map((url) => publicationImages.indexOf(url)).filter((index) => index >= 0);

  return {
    images,
    instagramPublishableUrls: Array.isArray(raw.instagramPublishableUrls)
      ? raw.instagramPublishableUrls.map((value) => String(value || "").trim()).filter(Boolean)
      : filterUrlsByIndexes(eventPayload.instagramPublishableUrls, inheritedIndexes),
    socialFeedPublishableUrls: Array.isArray(raw.socialFeedPublishableUrls)
      ? raw.socialFeedPublishableUrls.map((value) => String(value || "").trim()).filter(Boolean)
      : filterUrlsByIndexes(eventPayload.socialFeedPublishableUrls, inheritedIndexes),
    siteCardPublishableUrls: Array.isArray(raw.siteCardPublishableUrls)
      ? raw.siteCardPublishableUrls.map((value) => String(value || "").trim()).filter(Boolean)
      : filterUrlsByIndexes(eventPayload.siteCardPublishableUrls, inheritedIndexes),
    gmbPublishableUrls: Array.isArray(raw.gmbPublishableUrls)
      ? raw.gmbPublishableUrls.map((value) => String(value || "").trim()).filter(Boolean)
      : filterUrlsByIndexes(eventPayload.gmbPublishableUrls, inheritedIndexes),
  };
}

function getChannelEditableAttachments(eventPayload: JsonRecord, publication: JsonRecord, channel: ChannelKey): EditableImageAttachment[] {
  const postByChannel = asRecord(eventPayload.postByChannel);
  const fallbackChannelPost = channel === "inrcy_site" ? postByChannel.site_web : channel === "site_web" ? postByChannel.inrcy_site : channel === "inr_search" ? (postByChannel.site_web || postByChannel.inrcy_site) : null;
  const raw = asRecord(postByChannel[channel] ?? fallbackChannelPost);
  const imageSet = getChannelImageSet(eventPayload, publication, channel);
  const rawAttachments = Array.isArray(raw.attachments) ? raw.attachments : [];
  return imageSet.images.map((url, index) => {
    const rawAttachment = rawAttachments[index];
    const record = asRecord(rawAttachment);
    const renderedUrl = String(record.renderedUrl || record.rendered_url || record.url || record.publicUrl || record.public_url || url || "").trim();
    const originalUrl = String(record.originalUrl || record.original_url || record.originalPublicUrl || record.original_public_url || renderedUrl || "").trim();
    return {
      name: String(record.originalName || record.original_name || record.name || `image-${index + 1}.jpg`).trim() || `image-${index + 1}.jpg`,
      type: String(record.originalType || record.original_type || record.type || "image/jpeg").trim() || "image/jpeg",
      url: renderedUrl || url,
      renderedUrl: renderedUrl || url,
      publicUrl: String(record.publicUrl || record.public_url || renderedUrl || url || "").trim() || renderedUrl || url,
      originalUrl: originalUrl || null,
      originalPublicUrl: originalUrl || null,
      originalName: String(record.originalName || record.original_name || record.name || "").trim() || null,
      originalType: String(record.originalType || record.original_type || record.type || "").trim() || null,
      imageKey: String(record.imageKey || record.image_key || "").trim() || null,
      transform: record.transform || null,
      imageMeta: record.imageMeta || record.image_meta || null,
    };
  });
}

async function updatePublicationImages(params: {
  userId: string;
  publication: JsonRecord;
  eventPayload: JsonRecord;
  channel: ChannelKey;
  retainedImages?: string[];
  newImages?: ImagePayload[];
}): Promise<ImageSet> {
  const { userId, publication, eventPayload, channel, retainedImages = [], newImages = [] } = params;
  const currentImageSet = getChannelImageSet(eventPayload, publication, channel);
  const currentImages = currentImageSet.images;
  const sanitizedRetained = retainedImages.map((value) => String(value || "").trim()).filter(Boolean);
  const retainedIndexes = sanitizedRetained
    .map((url) => currentImages.indexOf(url))
    .filter((index, position, arr) => index >= 0 && arr.indexOf(index) === position);

  const currentAttachments = getChannelEditableAttachments(eventPayload, publication, channel);
  const baseImageSet: ImageSet = {
    images: retainedIndexes.map((index) => currentImages[index]).filter(Boolean),
    instagramPublishableUrls: filterUrlsByIndexes(currentImageSet.instagramPublishableUrls, retainedIndexes),
    socialFeedPublishableUrls: filterUrlsByIndexes(currentImageSet.socialFeedPublishableUrls, retainedIndexes),
    siteCardPublishableUrls: filterUrlsByIndexes(currentImageSet.siteCardPublishableUrls, retainedIndexes),
    gmbPublishableUrls: filterUrlsByIndexes(currentImageSet.gmbPublishableUrls, retainedIndexes),
    editableAttachments: retainedIndexes.map((index) => currentAttachments[index]).filter(Boolean),
  };

  const uploadedSet = newImages.length ? await uploadPublicationImages(userId, newImages) : emptyImageSet();
  return {
    images: [...baseImageSet.images, ...uploadedSet.images].slice(0, 5),
    instagramPublishableUrls: [...baseImageSet.instagramPublishableUrls, ...uploadedSet.instagramPublishableUrls].slice(0, 10),
    socialFeedPublishableUrls: [...baseImageSet.socialFeedPublishableUrls, ...uploadedSet.socialFeedPublishableUrls].slice(0, 20),
    siteCardPublishableUrls: [...baseImageSet.siteCardPublishableUrls, ...uploadedSet.siteCardPublishableUrls].slice(0, 20),
    gmbPublishableUrls: [...baseImageSet.gmbPublishableUrls, ...uploadedSet.gmbPublishableUrls].slice(0, 20),
    editableAttachments: [...(baseImageSet.editableAttachments || []), ...(uploadedSet.editableAttachments || [])].slice(0, 5),
  };
}

function cloneRecord<T extends JsonRecord>(input: T): T {
  return JSON.parse(JSON.stringify(input || {})) as T;
}

function isDeletedResult(result: JsonRecord | null | undefined): boolean {
  if (!result) return false;
  return result.deleted === true || String(result.status || "").toLowerCase() === "deleted";
}

function normalizePublicationMediaType(value: unknown): PublicationMediaType {
  return String(value || "").toLowerCase() === "video" ? "video" : "images";
}

function looksLikeVideoRecord(input: unknown): boolean {
  const record = asRecord(input);
  const type = String(record.type || record.mime || record.mimeType || record.video_mime || "").toLowerCase();
  const url = String(record.url || record.publicUrl || record.public_url || record.videoUrl || record.video_url || record.href || "").toLowerCase().split("?")[0];
  const name = String(record.name || record.filename || record.fileName || record.video_name || "").toLowerCase().split("?")[0];
  return type.startsWith("video/") || /\.(mp4|mov|webm|ogg|m4v)$/.test(url) || /\.(mp4|mov|webm|ogg|m4v)$/.test(name);
}

function normalizeVideoAttachment(input: unknown): PersistedVideoAttachment | null {
  const record = asRecord(input);
  if (!Object.keys(record).length) return null;

  const nested = asRecord(record.video);
  const src = Object.keys(nested).length ? { ...record, ...nested } as JsonRecord : record;
  const url = String(src.publicUrl || src.public_url || src.url || src.videoUrl || src.video_url || src.href || "").trim();
  const storagePath = String(src.storagePath || src.storage_path || src.video_path || src.path || "").trim();
  if (!url && !storagePath) return null;

  const type = String(src.type || src.mime || src.mimeType || src.video_mime || "video/mp4").trim() || "video/mp4";
  if (!looksLikeVideoRecord({ ...src, type, url })) return null;

  const durationRaw = Number(src.duration ?? src.video_duration_seconds ?? src.durationSeconds ?? 0);
  const sizeRaw = Number(src.size ?? src.video_size ?? src.bytes ?? 0);
  const publicUrl = url || (storagePath && /^https?:\/\//i.test(storagePath) ? storagePath : "");
  if (!publicUrl) return null;

  return {
    name: String(src.name || src.filename || src.fileName || src.video_name || "video-inrcy.mp4").trim() || "video-inrcy.mp4",
    type,
    size: Number.isFinite(sizeRaw) && sizeRaw > 0 ? sizeRaw : 0,
    duration: Number.isFinite(durationRaw) && durationRaw > 0 ? durationRaw : null,
    url: publicUrl,
    publicUrl,
    storagePath: storagePath || null,
    thumbnailUrl: String(src.thumbnailUrl || src.thumbnail_url || src.video_thumbnail_url || "").trim() || null,
    thumbnailStoragePath: String(src.thumbnailStoragePath || src.thumbnail_storage_path || "").trim() || null,
    thumbnailBucket:
      String(
        src.thumbnailBucket ||
          src.thumbnail_bucket ||
          src.video_thumbnail_bucket ||
          "",
      ).trim() || null,
    sourceMetadata: src.sourceMetadata || src.source_metadata || null,
    sourceVideo: src.sourceVideo || src.source_video || null,
    transformedVariants: Array.isArray(src.transformedVariants || src.transformed_variants) ? (src.transformedVariants || src.transformed_variants) as unknown[] : [],
    videoSettings: src.videoSettings || src.video_settings || null,
  };
}

function firstVideoAttachment(...candidates: unknown[]): PersistedVideoAttachment | null {
  for (const candidate of candidates) {
    if (!candidate) continue;
    if (Array.isArray(candidate)) {
      for (const item of candidate) {
        const normalized = normalizeVideoAttachment(item);
        if (normalized) return normalized;
      }
      continue;
    }
    const normalized = normalizeVideoAttachment(candidate);
    if (normalized) return normalized;
  }
  return null;
}

function getPublicationVideo(eventPayload: JsonRecord, publication: JsonRecord, channel?: ChannelKey): PersistedVideoAttachment | null {
  const postByChannel = asRecord(eventPayload.postByChannel);
  const channelPost = channel ? asRecord(postByChannel[channel]) : {};
  const post = asRecord(eventPayload.post);
  const publicationMetadata = asRecord(publication.media_metadata);
  const eventMetadata = asRecord(eventPayload.media_metadata);

  return firstVideoAttachment(
    channelPost.video,
    channelPost.attachments,
    channelPost.media,
    eventPayload.video,
    eventPayload.videoDraft,
    post.video,
    post.attachments,
    eventMetadata.video,
    publicationMetadata.video,
    {
      name: "video-inrcy.mp4",
      type: publication.video_mime,
      size: publication.video_size,
      duration: publication.video_duration_seconds,
      publicUrl: publication.video_url,
      url: publication.video_url,
      storagePath: publication.video_path,
      thumbnailUrl: publication.video_thumbnail_url,
    }
  );
}

function getEventPublicationMediaType(eventPayload: JsonRecord, publication: JsonRecord, channel?: ChannelKey): PublicationMediaType {
  const postByChannel = asRecord(eventPayload.postByChannel);
  const channelPost = channel ? asRecord(postByChannel[channel]) : {};
  return normalizePublicationMediaType(channelPost.mediaType || eventPayload.mediaType || eventPayload.media_type || publication.media_type || (getPublicationVideo(eventPayload, publication, channel) ? "video" : "images"));
}

function getChannelPost(eventPayload: JsonRecord, publication: JsonRecord, channel: ChannelKey): PostPayload {
  const postByChannel = asRecord(eventPayload.postByChannel);
  const fallbackChannelPost = channel === "inrcy_site" ? postByChannel.site_web : channel === "site_web" ? postByChannel.inrcy_site : channel === "inr_search" ? (postByChannel.site_web || postByChannel.inrcy_site) : null;
  const raw = asRecord(postByChannel[channel] ?? fallbackChannelPost ?? eventPayload.post);
  const eventPost = asRecord(eventPayload.post);
  const publicationTags = Array.isArray(publication.hashtags) ? publication.hashtags : [];
  const eventPostTags = Array.isArray(eventPost.hashtags) ? eventPost.hashtags : [];
  const rawTags = Array.isArray(raw.hashtags) ? raw.hashtags : eventPostTags.length ? eventPostTags : publicationTags;

  return {
    title: String(raw.title ?? publication.title ?? "").trim(),
    content: limitBoosterChannelContent(
      channel,
      String(raw.content ?? raw.text ?? raw.message ?? publication.content ?? "").trim(),
    ),
    cta: String(raw.cta ?? publication.cta ?? "").trim(),
    ctaMode: String(raw.ctaMode ?? "").trim(),
    ctaUrl: String(raw.ctaUrl ?? "").trim(),
    ctaPhone: String(raw.ctaPhone ?? "").trim(),
    hashtags: rawTags.map((tag: unknown) => normalizeHashtag(String(tag || ""))).filter(Boolean).slice(0, 20),
  };
}

async function getLatestIntegrationRow(userId: string, provider: string, source: string, product: string, columns: string) {
  const { data, error } = await supabaseAdmin
    .from("integrations")
    .select(columns)
    .eq("user_id", userId)
    .eq("provider", provider)
    .eq("source", source)
    .eq("product", product)
    .order("updated_at", { ascending: false })
    .order("created_at", { ascending: false })
    .limit(1);

  if (error) throw error;
  return Array.isArray(data) ? data[0] ?? null : null;
}

async function loadPublicationContext(userId: string, publicationId: string) {
  const { data: publication, error: publicationError } = await supabaseAdmin
    .from("publications")
    .select("id,user_id,title,content,cta,hashtags,images,idea,created_at,media_type,video_url,video_path,video_mime,video_size,video_duration_seconds,video_thumbnail_url,media_metadata")
    .eq("id", publicationId)
    .eq("user_id", userId)
    .maybeSingle();

  if (publicationError) throw publicationError;
  if (!publication) return null;

  const { data: events, error: eventsError } = await supabaseAdmin
    .from("app_events")
    .select("id,payload,created_at")
    .eq("user_id", userId)
    .eq("module", "booster")
    .eq("type", "publish")
    .order("created_at", { ascending: false })
    .limit(200);

  if (eventsError) throw eventsError;

  const event = ((events || []) as AppEventRow[]).find((row) => String(asRecord(row.payload).publication_id || "") === publicationId) ?? null;
  const eventPayload = asRecord(event?.payload);

  const { data: delivery, error: deliveryError } = await supabaseAdmin
    .from("publication_deliveries")
    .select("id,status,error,channel")
    .eq("user_id", userId)
    .eq("publication_id", publicationId);

  if (deliveryError) throw deliveryError;

  return {
    publication: asRecord(publication),
    event,
    eventPayload,
    deliveries: Array.isArray(delivery) ? delivery : [],
  };
}

async function deleteFacebookPost(externalId: string, pageAccessToken: string) {
  if (!externalId) return;
  const qs = new URLSearchParams({ access_token: pageAccessToken });
  const res = await fetch(`${buildMetaGraphUrl(encodeURIComponent(externalId))}?${qs.toString()}`, {
    method: "DELETE",
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error?.message || `Suppression Facebook impossible (${res.status})`);
  }
}

async function updateFacebookPost(externalId: string, pageAccessToken: string, message: string) {
  if (!externalId) throw new Error("Publication Facebook introuvable.");
  const body = new URLSearchParams({ access_token: pageAccessToken, message });
  const res = await fetch(buildMetaGraphUrl(encodeURIComponent(externalId)), {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json?.success === false) {
    throw new Error(json?.error?.message || `Modification Facebook impossible (${res.status})`);
  }
}

function areImageListsEqual(left: string[], right: string[]) {
  if (left.length !== right.length) return false;
  return left.every((value, index) => String(value || "").trim() === String(right[index] || "").trim());
}

async function verifyInstagramMediaId(externalId: string, accessToken: string) {
  const qs = new URLSearchParams({
    fields: "id,media_type,media_product_type,permalink,timestamp,username,children{id,media_type,permalink}",
    access_token: accessToken,
  });
  const res = await fetch(`${buildMetaGraphUrl(encodeURIComponent(externalId))}?${qs.toString()}`, {
    method: "GET",
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

async function deleteInstagramMedia(externalId: string, accessToken: string) {
  const qs = new URLSearchParams({ access_token: accessToken });
  const res = await fetch(`${buildMetaGraphUrl(encodeURIComponent(externalId))}?${qs.toString()}`, {
    method: "DELETE",
    cache: "no-store",
  });
  const json = await res.json().catch(() => ({}));
  return { res, json };
}

function previewToken(token: string) {
  if (!token) return "absent";
  const digest = createHash("sha256").update(token).digest("hex").slice(0, 10);
  return `tok_${digest}`;
}

function buildInstagramDeleteTokenCandidates(entries: Array<{ sourceLabel: string; row: unknown }>): InstagramDeleteTokenCandidate[] {
  const candidates: InstagramDeleteTokenCandidate[] = [];
  const seen = new Set<string>();

  const pushCandidate = (source: string, raw: unknown) => {
    const token = tryDecryptToken(String(raw || "")) || "";
    if (!token || seen.has(token)) return;
    seen.add(token);
    candidates.push({ source, token, preview: previewToken(token) });
  };

  for (const entry of entries) {
    const row = asRecord(entry.row);
    const meta = asRecord(row.meta);
    pushCandidate(`${entry.sourceLabel}.access_token_enc`, row.access_token_enc);
    pushCandidate(`${entry.sourceLabel}.meta.standard_user_access_token_enc`, meta.standard_user_access_token_enc);
    pushCandidate(`${entry.sourceLabel}.meta.business_user_access_token_enc`, meta.business_user_access_token_enc);
    pushCandidate(`${entry.sourceLabel}.meta.user_access_token_enc`, meta.user_access_token_enc);
    pushCandidate(`${entry.sourceLabel}.meta.user_access_token`, meta.user_access_token);
  }

  return candidates;
}

function extractGraphErrorMeta(errorLike: unknown) {
  const err = asRecord(asRecord(errorLike).error);
  return {
    message: String(err.message ?? "").trim() || null,
    graph_code: typeof err.code === "number" ? err.code : Number(err.code || 0) || null,
    graph_subcode: typeof err.error_subcode === "number" ? err.error_subcode : Number(err.error_subcode || 0) || null,
    fbtrace_id: String(err.fbtrace_id ?? "").trim() || null,
  };
}

function isInstagramDeletePermissionError(error: unknown) {
  const candidate =
    error && typeof error === "object"
      ? (error as { message?: unknown; graph_code?: unknown; code?: unknown })
      : null;
  const graphCode = Number(candidate?.graph_code || candidate?.code || 0);
  const message = String(
    error instanceof Error ? error.message : candidate?.message || error || "",
  ).toLowerCase();
  return (
    graphCode === 10
    || message.includes("insufficient")
    || message.includes("permission")
    || message.includes("access this data")
    || message.includes("not authorized")
    || message.includes("not authorised")
    || message.includes("unsupported request")
    || message.includes("access token")
    || message.includes("oauth")
  );
}

function extractInstagramResultMeta(channelResult: JsonRecord, fallbackExternalId: string) {
  const diagnostics = asRecord(channelResult.diagnostics);
  const nestedDiagnostics = asRecord(diagnostics.diagnostics);
  const mediaType = String(channelResult.instagram_media_type ?? diagnostics.mediaType ?? nestedDiagnostics.mediaType ?? "").trim();
  const parentMediaId = String(
    channelResult.instagram_parent_media_id
    ?? diagnostics.parentMediaId
    ?? nestedDiagnostics.parentMediaId
    ?? (mediaType === "CAROUSEL_ALBUM" || mediaType === "CAROUSEL" ? channelResult.external_id : "")
    ?? ""
  ).trim();
  const rawChildren = channelResult.instagram_child_media_ids ?? diagnostics.childMediaIds ?? nestedDiagnostics.childMediaIds ?? diagnostics.childContainerIds ?? nestedDiagnostics.childContainerIds;
  const childIds = Array.isArray(rawChildren) ? rawChildren.map((value) => String(value || "").trim()).filter(Boolean) : [];
  return {
    mediaType: mediaType || null,
    parentMediaId: parentMediaId || fallbackExternalId || null,
    childIds,
  };
}

function resolveInstagramDeleteTarget(params: {
  requestedExternalId: string;
  channelResult?: JsonRecord | null;
}) {
  const requestedExternalId = String(params.requestedExternalId || "").trim();
  const channelResult = asRecord(params.channelResult);
  const meta = extractInstagramResultMeta(channelResult, requestedExternalId);
  const mediaType = String(meta.mediaType || "").toUpperCase();
  const childSet = new Set(meta.childIds);
  const isCarousel = mediaType === "CAROUSEL" || mediaType === "CAROUSEL_ALBUM";

  if (isCarousel && meta.parentMediaId) {
    return {
      requestedExternalId,
      deleteTargetId: meta.parentMediaId,
      deleteTargetMediaType: "CAROUSEL_ALBUM",
      carouselParentProtected: true,
    };
  }

  if (requestedExternalId && childSet.has(requestedExternalId) && meta.parentMediaId) {
    return {
      requestedExternalId,
      deleteTargetId: meta.parentMediaId,
      deleteTargetMediaType: "CAROUSEL_ALBUM",
      carouselParentProtected: true,
    };
  }

  return {
    requestedExternalId,
    deleteTargetId: requestedExternalId,
    deleteTargetMediaType: meta.mediaType,
    carouselParentProtected: false,
  };
}

async function deleteInstagramMediaWithFallback(
  externalId: string,
  options: {
    igRow?: unknown;
    fbRow?: unknown;
    channelResult?: JsonRecord | null;
    allowLocalFallback?: boolean;
  } = {},
): Promise<InstagramDeleteResult> {
  const target = resolveInstagramDeleteTarget({ requestedExternalId: externalId, channelResult: options.channelResult });
  const emptyResult: InstagramDeleteResult = {
    ok: true,
    external_id: externalId,
    delete_target_id: target.deleteTargetId || externalId,
    delete_target_media_type: target.deleteTargetMediaType,
    carousel_parent_protected: target.carouselParentProtected,
    verified: false,
    attempts: [],
  };
  if (!externalId) return emptyResult;

  const candidates = buildInstagramDeleteTokenCandidates([
    { sourceLabel: "instagram", row: options.igRow },
    { sourceLabel: "facebook", row: options.fbRow },
  ]);

  if (!candidates.length) {
    const message = "Votre compte Instagram n’est pas encore correctement relié.";
    if (options.allowLocalFallback) {
      return {
        ok: false,
        external_id: externalId,
        delete_target_id: target.deleteTargetId || externalId,
        delete_target_media_type: target.deleteTargetMediaType,
        carousel_parent_protected: target.carouselParentProtected,
        verified: false,
        attempts: [],
        error: message,
      };
    }
    throw new Error(message);
  }

  const attempts: InstagramDeleteAttempt[] = [];
  let lastErrorMessage = "Suppression Instagram impossible.";

  for (const candidate of candidates) {
    const attempt: InstagramDeleteAttempt = {
      source: candidate.source,
      token_preview: candidate.preview,
      requested_external_id: externalId,
      delete_target_id: target.deleteTargetId || externalId,
      delete_target_media_type: target.deleteTargetMediaType,
      verified: false,
      verify_http_status: null,
      verify_error: null,
      delete_http_status: null,
      delete_error: null,
      success: false,
    };

    try {
      const verify = await verifyInstagramMediaId(target.deleteTargetId || externalId, candidate.token);
      attempt.verify_http_status = verify.res.status;
      if (!verify.res.ok) {
        attempt.verify_error = extractGraphErrorMeta(verify.json);
        lastErrorMessage = attempt.verify_error.message || `Vérification Instagram impossible (${verify.res.status})`;
        attempts.push(attempt);
        log.warn("instagram_delete_verify_failed", {
          route: "inrsend_instagram_delete",
          external_id: externalId,
          delete_target_id: target.deleteTargetId || externalId,
          delete_target_media_type: target.deleteTargetMediaType,
          carousel_parent_protected: target.carouselParentProtected,
          source: candidate.source,
          token_preview: candidate.preview,
          http_status: verify.res.status,
          graph_error: attempt.verify_error,
        });
        continue;
      }

      attempt.verified = true;
      const deleted = await deleteInstagramMedia(target.deleteTargetId || externalId, candidate.token);
      attempt.delete_http_status = deleted.res.status;

      if (deleted.res.ok && deleted.json?.success !== false) {
        attempt.success = true;
        attempts.push(attempt);
        log.info("instagram_delete_success", {
          route: "inrsend_instagram_delete",
          external_id: externalId,
          delete_target_id: target.deleteTargetId || externalId,
          delete_target_media_type: target.deleteTargetMediaType,
          carousel_parent_protected: target.carouselParentProtected,
          source: candidate.source,
          token_preview: candidate.preview,
          verify_http_status: attempt.verify_http_status,
          delete_http_status: attempt.delete_http_status,
        });
        return {
          ok: true,
          external_id: externalId,
          delete_target_id: target.deleteTargetId || externalId,
          delete_target_media_type: target.deleteTargetMediaType,
          carousel_parent_protected: target.carouselParentProtected,
          verified: true,
          attempts,
        };
      }

      attempt.delete_error = extractGraphErrorMeta(deleted.json);
      lastErrorMessage = attempt.delete_error.message || `Suppression Instagram impossible (${deleted.res.status})`;
      attempts.push(attempt);
      const deleteFailureContext = {
        route: "inrsend_instagram_delete",
        external_id: externalId,
        delete_target_id: target.deleteTargetId || externalId,
        delete_target_media_type: target.deleteTargetMediaType,
        carousel_parent_protected: target.carouselParentProtected,
        source: candidate.source,
        token_preview: candidate.preview,
        verify_http_status: attempt.verify_http_status,
        delete_http_status: attempt.delete_http_status,
        graph_error: attempt.delete_error,
      };
      if (isInstagramDeletePermissionError(attempt.delete_error)) {
        // Meta does not expose remote deletion for every media/token shape. The
        // caller deliberately removes the local delivery in that known case.
        log.info("instagram_delete_remote_unsupported", deleteFailureContext);
      } else {
        log.warn("instagram_delete_attempt_failed", deleteFailureContext);
      }
    } catch (error) {
      lastErrorMessage = error instanceof Error ? error.message : String(error || "Suppression Instagram impossible.");
      attempt.delete_error = { message: lastErrorMessage, graph_code: null, graph_subcode: null, fbtrace_id: null };
      attempts.push(attempt);
      log.warn("instagram_delete_attempt_exception", {
        route: "inrsend_instagram_delete",
        external_id: externalId,
        delete_target_id: target.deleteTargetId || externalId,
        delete_target_media_type: target.deleteTargetMediaType,
        carousel_parent_protected: target.carouselParentProtected,
        source: candidate.source,
        token_preview: candidate.preview,
        error: lastErrorMessage,
      });
    }
  }

  const result: InstagramDeleteResult = {
    ok: false,
    external_id: externalId,
    delete_target_id: target.deleteTargetId || externalId,
    delete_target_media_type: target.deleteTargetMediaType,
    carousel_parent_protected: target.carouselParentProtected,
    verified: attempts.some((attempt) => attempt.verified === true),
    attempts,
    error: lastErrorMessage,
  };

  const permissionDenied = attempts.some((attempt) =>
    isInstagramDeletePermissionError(attempt.delete_error),
  );
  if (options.allowLocalFallback || permissionDenied || isInstagramDeletePermissionError(lastErrorMessage)) return result;

  const error = new Error(lastErrorMessage) as Error & { instagramDeleteResult?: InstagramDeleteResult };
  error.instagramDeleteResult = result;
  throw error;
}

async function deleteLinkedInPost(externalId: string, accessToken: string) {
  if (!externalId) return;
  const res = await fetch(`https://api.linkedin.com/rest/posts/${encodeURIComponent(externalId)}`, {
    method: "DELETE",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "X-Restli-Protocol-Version": "2.0.0",
      "X-RestLi-Method": "DELETE",
      "Linkedin-Version": LINKEDIN_VERSION,
    },
    cache: "no-store",
  });
  if (!res.ok && res.status !== 404) {
    const raw = await res.text().catch(() => "");
    throw new Error(raw || `Suppression LinkedIn impossible (${res.status})`);
  }
}

async function deleteGmbPost(externalId: string, accessToken: string) {
  if (!externalId) return;
  const res = await fetch(`https://mybusiness.googleapis.com/v4/${externalId}`, {
    method: "DELETE",
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: "no-store",
  });
  const raw = await res.text().catch(() => "");
  if (!res.ok && res.status !== 404) {
    throw new Error(raw || `Suppression Google Business impossible (${res.status})`);
  }
}

async function syncDeliveryRow(params: {
  userId: string;
  publicationId: string;
  channel: ChannelKey;
  status: string;
  error?: string | null;
}) {
  const { userId, publicationId, channel, status, error } = params;
  const { error: upError } = await supabaseAdmin
    .from("publication_deliveries")
    .update({ status, error: error || null })
    .eq("user_id", userId)
    .eq("publication_id", publicationId)
    .eq("channel", channel);

  if (upError) throw upError;
}

async function persistEventPayload(userId: string, publicationId: string, nextPayload: JsonRecord) {
  const { data: events, error } = await supabaseAdmin
    .from("app_events")
    .select("id,payload")
    .eq("user_id", userId)
    .eq("module", "booster")
    .eq("type", "publish")
    .order("created_at", { ascending: false })
    .limit(200);

  if (error) throw error;
  const ids = ((events || []) as AppEventRow[])
    .filter((row) => String(asRecord(row.payload).publication_id || "") === publicationId)
    .map((row) => String(row.id));

  if (!ids.length) return;
  const { error: upError } = await supabaseAdmin.from("app_events").update({ payload: nextPayload }).in("id", ids).eq("user_id", userId);
  if (upError) throw upError;
}

async function logInstagramAction(params: {
  userId: string;
  publicationId?: string | null;
  action: "verify_delete" | "delete" | "replace";
  externalId?: string | null;
  result: JsonRecord;
}) {
  try {
    await supabaseAdmin.from("instagram_action_logs").insert({
      id: randomUUID(),
      user_id: params.userId,
      publication_id: params.publicationId || null,
      action: params.action,
      external_id: params.externalId || null,
      payload: params.result,
    });
  } catch (error) {
    log.warn("instagram_action_log_insert_failed", {
      route: "inrsend_instagram_actions",
      action: params.action,
      publication_id: params.publicationId || null,
      external_id: params.externalId || null,
      error: error instanceof Error ? error.message : String(error || ""),
    });
  }
}

async function replaceChannelDelivery(params: {
  userId: string;
  publicationId?: string | null;
  channel: ChannelKey;
  previousExternalId?: string | null;
  publication: JsonRecord;
  eventPayload: JsonRecord;
  nextPost: PostPayload;
  mediaType?: PublicationMediaType;
  video?: PersistedVideoAttachment | null;
  imageSet?: ImageSet | null;
}) {
  const { userId, publicationId, channel, previousExternalId, publication, eventPayload, nextPost, imageSet } = params;
  const [publicationStates, bubbleAccess] = await Promise.all([
    getChannelConnectionStates(supabaseAdmin, userId),
    getAppBubbleAccessMapForUser(supabaseAdmin, userId),
  ]);
  const channelLabel = CHANNEL_LABELS[channel];
  if (!isBubbleEnabled(bubbleAccess, CHANNEL_BUBBLE_KEYS[channel])) {
    throw new Error(`${channelLabel} est désactivé dans Bubble Access.`);
  }

  const officialState = channel === "inrcy_site"
    ? publicationStates.site_inrcy
    : channel === "site_web"
      ? publicationStates.site_web
      : channel === "inr_search"
        ? publicationStates.inr_search
        : publicationStates[channel];
  const officiallyConnected = channel === "inrcy_site" || channel === "site_web"
    ? officialState.connected === true
    : isOfficialPublicationChannelConnected(officialState);
  if (!officiallyConnected) {
    const reconnectRequired = "connection_status" in officialState
      && publicationChannelRequiresReconnect(officialState);
    throw new Error(
      reconnectRequired
        ? `${channelLabel} à reconnecter. Rendez-vous dans Canaux.`
        : `${channelLabel} à connecter. Rendez-vous dans Canaux.`,
    );
  }

  const mediaType = params.mediaType || getEventPublicationMediaType(eventPayload, publication, channel);
  const video = params.video || getPublicationVideo(eventPayload, publication, channel);
  const isVideoPublication = mediaType === "video";
  const videoUrl = String(video?.publicUrl || video?.url || "").trim();
  if (isVideoPublication && (!video || !videoUrl)) {
    throw new Error(
      "La vidéo prévue pour ce canal est introuvable ou inaccessible. Le texte n’a pas été publié à sa place.",
    );
  }
  const resolvedImageSet = imageSet ?? getChannelImageSet(eventPayload, publication, channel);
  const images = resolvedImageSet.images;
  const socialFeedImageUrls = resolvedImageSet.socialFeedPublishableUrls.length ? resolvedImageSet.socialFeedPublishableUrls : images;
  const instagramImageUrls = resolvedImageSet.instagramPublishableUrls.length ? resolvedImageSet.instagramPublishableUrls : images;
  const siteCardImageUrls = resolvedImageSet.siteCardPublishableUrls.length ? resolvedImageSet.siteCardPublishableUrls : socialFeedImageUrls;
  const gmbImageUrls = (resolvedImageSet.gmbPublishableUrls.length ? resolvedImageSet.gmbPublishableUrls : socialFeedImageUrls)
    .filter(Boolean)
    .slice(0, 5);

  const [profileRes, inrcyCfgRes, proCfgRes] = await Promise.all([
    supabaseAdmin.from("profiles").select("phone").eq("user_id", userId).maybeSingle(),
    supabaseAdmin.from("inrcy_site_configs").select("site_url").eq("user_id", userId).maybeSingle(),
    supabaseAdmin.from("pro_tools_configs").select("settings").eq("user_id", userId).maybeSingle(),
  ]);
  const profile = asRecord(profileRes.data);
  const inrcyCfg = asRecord(inrcyCfgRes.data);
  const proCfg = asRecord(proCfgRes.data);
  const proSettings = asRecord(proCfg.settings);
  const proSiteWeb = asRecord(proSettings.site_web);
  const websiteUrl = String(proSiteWeb.url ?? inrcyCfg.site_url ?? "").trim();
  const phone = String(profile.phone ?? "").trim();

  const canonMessage = buildBoosterMessage(channel, nextPost, { websiteUrl, phone });

  if (channel === "inr_search") {
    const provisioned = await ensureSystemManagedInrSearch(supabaseAdmin, userId);
    const slug = String(provisioned.inrSearch?.publishedSlug || provisioned.inrSearch?.slug || "").trim();
    const publicStatus = await getInrSearchPublicStatus(slug);
    if (!publicStatus.published) {
      throw new Error("La page iNr’Search n’est pas disponible. Vérifiez Bubble Access et les informations du profil.");
    }
    revalidateInrSearchPublicRoutes(slug);
    await notifyInrSearchIndexing(slug);
    return {
      externalId: previousExternalId || publicationId || randomUUID(),
      status: "delivered",
      error: null,
      externalUrl: publicStatus.publicUrl,
    };
  }

  if (channel === "inrcy_site" || channel === "site_web") {
    const { data: article, error: articleError } = await supabaseAdmin
      .from("site_articles")
      .update({
        title: nextPost.title,
        content: nextPost.content,
        cta: nextPost.cta,
        hashtags: nextPost.hashtags,
        images: isVideoPublication ? [] : (siteCardImageUrls.length ? siteCardImageUrls : images),
        ...(isVideoPublication && video ? {
          media_type: "video",
          video_url: video.publicUrl,
          video_path: video.storagePath,
          video_mime: video.type,
          video_size: video.size,
          video_duration_seconds: video.duration,
          video_thumbnail_url: video.thumbnailUrl,
          media_metadata: { video },
        } : {}),
      })
      .eq("id", previousExternalId || "")
      .eq("user_id", userId)
      .eq("source", channel)
      .select("id")
      .maybeSingle();

    if (articleError) throw articleError;
    if (!article?.id) throw new Error("Article du site introuvable.");
    return { externalId: article.id, status: "delivered", error: null };
  }

  const [fbRow, gmbRow, igRow, liRow] = await Promise.all([
    getLatestIntegrationRow(userId, "facebook", "facebook", "facebook", "status,resource_id,access_token_enc,meta,expires_at"),
    getLatestIntegrationRow(userId, "google", "gmb", "gmb", "status,resource_id,meta,expires_at"),
    getLatestIntegrationRow(userId, "instagram", "instagram", "instagram", "status,resource_id,access_token_enc,resource_label,meta,expires_at"),
    getLatestIntegrationRow(userId, "linkedin", "linkedin", "linkedin", "status,resource_id,access_token_enc,meta,expires_at"),
  ]);

  if (channel === "facebook") {
    const fb = asRecord(fbRow);
    const pageId = String(fb.resource_id ?? "");
    const pageToken = tryDecryptToken(String(fb.access_token_enc ?? "")) || "";
    if (!pageId || !pageToken) {
      const facebookUserError = "Facebook à connecter. Rendez-vous dans Canaux.";
      logPublishChannelFailure({
        route: "inrsend_publication_channel_action",
        channel: "facebook",
        userId,
        publicationId: publicationId || null,
        stage: "precheck",
        error: "not_connected",
        userMessage: facebookUserError,
      });
      throw new Error(facebookUserError);
    }

    if (isVideoPublication && videoUrl) {
      const resp = await facebookPublishVideoToPage({
        pageId,
        pageAccessToken: pageToken,
        description: canonMessage,
        videoUrl,
        title: nextPost.title || undefined,
      });
      if (!resp.ok) {
        const facebookUserError = getPublishChannelUserMessage("facebook", resp.error);
        logPublishChannelFailure({
          route: "inrsend_publication_channel_action",
          channel: "facebook",
          userId,
          publicationId: publicationId || null,
          stage: "publish_video",
          error: resp.error,
          userMessage: facebookUserError,
          diagnostics: resp,
        });
        throw new Error(facebookUserError);
      }
      if (previousExternalId && previousExternalId !== resp.postId) {
        await deleteFacebookPost(previousExternalId, pageToken).catch((error) => {
          console.warn("[inrsend] previous Facebook post cleanup failed", {
            previousExternalId,
            message: error instanceof Error ? error.message : String(error || ""),
          });
        });
      }
      return {
        externalId: resp.postId,
        status: "delivered",
        error: null,
        warning: null,
        warningMessage: null,
      };
    }

    const currentImageSet = getChannelImageSet(eventPayload, publication, channel);
    const facebookImagesChanged = !areImageListsEqual(currentImageSet.images, resolvedImageSet.images);

    if (previousExternalId && !facebookImagesChanged) {
      try {
        await updateFacebookPost(previousExternalId, pageToken, canonMessage);
        return { externalId: previousExternalId, status: "delivered", error: null };
      } catch {
        // Create the replacement first. Deleting here would lose the existing
        // post if Facebook times out while accepting the replacement.
      }
    }

    const resp = await facebookPublishToPage({ pageId, pageAccessToken: pageToken, message: canonMessage, imageUrls: socialFeedImageUrls });
    if (!resp.ok) {
      const facebookUserError = getPublishChannelUserMessage("facebook", resp.error);
      logPublishChannelFailure({
        route: "inrsend_publication_channel_action",
        channel: "facebook",
        userId,
        publicationId: publicationId || null,
        stage: "publish",
        error: resp.error,
        userMessage: facebookUserError,
        diagnostics: resp,
      });
      throw new Error(facebookUserError);
    }
    if (previousExternalId && previousExternalId !== resp.postId) {
      await deleteFacebookPost(previousExternalId, pageToken).catch((error) => {
        console.warn("[inrsend] previous Facebook post cleanup failed", {
          previousExternalId,
          message: error instanceof Error ? error.message : String(error || ""),
        });
      });
    }
    const facebookWarning = socialFeedImageUrls.length > 0 && Number(resp.failedImages || 0) > 0
      ? Number(resp.uploadedImages || 0) > 0
        ? {
            code: "published_with_partial_images",
            message:
              "Facebook a publié uniquement les images acceptées. Une ou plusieurs images n'ont pas pu être jointes.",
          }
        : {
            code: "published_without_image",
            message:
              "Facebook a publié le texte, mais aucune image n'a pu être jointe cette fois-ci.",
          }
      : null;
    return {
      externalId: resp.postId,
      status: "delivered",
      error: null,
      warning: facebookWarning?.code || null,
      warningMessage: facebookWarning?.message || null,
    };
  }

  if (channel === "instagram") {
    const ig = asRecord(igRow);
    const igUserId = String(ig.resource_id ?? "");
    const igToken = tryDecryptToken(String(ig.access_token_enc ?? "")) || "";
    if (!igUserId || !igToken) {
      const instagramUserError = "Instagram à connecter. Rendez-vous dans Canaux.";
      logPublishChannelFailure({
        route: "inrsend_publication_channel_action",
        channel: "instagram",
        userId,
        publicationId: publicationId || null,
        stage: "precheck",
        error: "not_connected",
        userMessage: instagramUserError,
      });
      throw new Error(instagramUserError);
    }
    let previousDeleteResult: InstagramDeleteResult | null = null;
    if (isVideoPublication && videoUrl) {
      if (previousExternalId) {
        previousDeleteResult = await deleteInstagramMediaWithFallback(previousExternalId, { igRow, fbRow, channelResult: asRecord(asRecord(eventPayload.results).instagram), allowLocalFallback: true });
        await logInstagramAction({
          userId,
          publicationId: publicationId || null,
          action: "replace",
          externalId: previousExternalId,
          result: previousDeleteResult as unknown as JsonRecord,
        });
      }
      const instagramTokenCandidates = buildInstagramDeleteTokenCandidates([
        { sourceLabel: "instagram", row: igRow },
        { sourceLabel: "facebook", row: fbRow },
      ]).map((candidate) => ({ source: candidate.source, accessToken: candidate.token }));
      const caption = buildBoosterInstagramCaption(nextPost, { websiteUrl, phone });
      const resp = await instagramPublishVideoWithTokenFallback({
        igUserId,
        accessToken: igToken,
        tokenCandidates: instagramTokenCandidates,
        caption,
        videoUrl,
      });
      if (!resp.ok) {
        const instagramUserError = (isInstagramAuthorizationErrorResult(resp) || isInstagramAuthorizationLikeMessage(`instagram ${resp.error}`))
          ? INSTAGRAM_RECONNECT_USER_MESSAGE
          : getPublishChannelUserMessage("instagram", resp.error, "La publication Instagram a échoué.");
        logPublishChannelFailure({
          route: "inrsend_publication_channel_action",
          channel: "instagram",
          userId,
          publicationId: publicationId || null,
          stage: "publish_video",
          error: resp.error,
          userMessage: instagramUserError,
          diagnostics: resp,
        });
        throw new Error(instagramUserError);
      }
      return {
        externalId: resp.mediaId,
        status: "delivered",
        error: previousDeleteResult && !previousDeleteResult.ok
          ? "Nouvelle version publiée. Instagram n’a pas confirmé la suppression automatique de l’ancien post."
          : null,
        instagramMeta: {
          instagram_media_type: resp.mediaType,
          instagram_parent_media_id: resp.parentMediaId || resp.mediaId,
          instagram_child_media_ids: resp.childMediaIds || resp.childContainerIds || [],
          instagram_delete_previous_result: previousDeleteResult || null,
        },
      };
    }

    const instagramImages = instagramImageUrls.filter(Boolean).slice(0, 10);
    if (!instagramImages.length) throw new Error("Instagram nécessite au moins 1 image.");
    if (previousExternalId) {
      previousDeleteResult = await deleteInstagramMediaWithFallback(previousExternalId, { igRow, fbRow, channelResult: asRecord(asRecord(eventPayload.results).instagram), allowLocalFallback: true });
      await logInstagramAction({
        userId,
        publicationId: publicationId || null,
        action: "replace",
        externalId: previousExternalId,
        result: previousDeleteResult as unknown as JsonRecord,
      });
    }
    const instagramTokenCandidates = buildInstagramDeleteTokenCandidates([
      { sourceLabel: "instagram", row: igRow },
      { sourceLabel: "facebook", row: fbRow },
    ]).map((candidate) => ({ source: candidate.source, accessToken: candidate.token }));
    const caption = buildBoosterInstagramCaption(nextPost, { websiteUrl, phone });
    const resp = instagramImages.length > 1
      ? await instagramPublishCarouselWithTokenFallback({
          igUserId,
          accessToken: igToken,
          tokenCandidates: instagramTokenCandidates,
          caption,
          imageUrls: instagramImages,
        })
      : await instagramPublishPhotoWithTokenFallback({
          igUserId,
          accessToken: igToken,
          tokenCandidates: instagramTokenCandidates,
          caption,
          imageUrl: instagramImages[0],
        });
    if (!resp.ok) {
      const instagramUserError = (isInstagramAuthorizationErrorResult(resp) || isInstagramAuthorizationLikeMessage(`instagram ${resp.error}`))
        ? INSTAGRAM_RECONNECT_USER_MESSAGE
        : getPublishChannelUserMessage("instagram", resp.error, "La publication Instagram a échoué.");
      logPublishChannelFailure({
        route: "inrsend_publication_channel_action",
        channel: "instagram",
        userId,
        publicationId: publicationId || null,
        stage: "publish",
        error: resp.error,
        userMessage: instagramUserError,
        diagnostics: resp,
      });
      throw new Error(instagramUserError);
    }
    return {
      externalId: resp.mediaId,
      status: "delivered",
      error: previousDeleteResult && !previousDeleteResult.ok
        ? "Nouvelle version publiée. Instagram n’a pas confirmé la suppression automatique de l’ancien post."
        : null,
      instagramMeta: {
        instagram_media_type: resp.mediaType,
        instagram_parent_media_id: resp.parentMediaId || resp.mediaId,
        instagram_child_media_ids: resp.childMediaIds || resp.childContainerIds || [],
        instagram_delete_previous_result: previousDeleteResult || null,
      },
    };
  }

  if (channel === "linkedin") {
    const li = asRecord(liRow);
    const auth = await getLinkedInAccessToken({ userId });
    const accessToken = auth.accessToken || "";
    const liMeta = asRecord(li.meta);
    const linkedinSettings = asRecord(proSettings.linkedin);
    const shouldShareLinkedInPageToProfile =
      linkedinSettings.shareToPersonalProfile === true ||
      linkedinSettings.shareToPersonalProfile === "true" ||
      linkedinSettings.autoShareToPersonalProfile === true ||
      linkedinSettings.autoShareToPersonalProfile === "true";
    const rawAuthorUrn = auth.authorUrn || String(li.resource_id ?? "");
    const memberAuthorUrn = rawAuthorUrn.startsWith("urn:li:person:") ? rawAuthorUrn : "";
    const selectedOrgId = String(liMeta.org_id || "").trim();
    const organizationAuthorUrn = auth.orgUrn || String(liMeta.org_urn || "") || (selectedOrgId ? `urn:li:organization:${selectedOrgId}` : "");
    const authorUrn = organizationAuthorUrn || memberAuthorUrn;
    if (!accessToken || !authorUrn) {
      const linkedInRawError = auth.error || "not_connected";
      const linkedInUserError = getPublishChannelUserMessage("linkedin", linkedInRawError, "LinkedIn à connecter. Rendez-vous dans Canaux.");
      logPublishChannelFailure({
        route: "inrsend_publication_channel_action",
        channel: "linkedin",
        userId,
        publicationId: publicationId || null,
        stage: "precheck",
        error: linkedInRawError,
        userMessage: linkedInUserError,
        diagnostics: { refreshTokenPresent: auth.refreshTokenPresent, refreshed: auth.refreshed, canReconnectSilently: auth.canReconnectSilently },
      });
      throw new Error(linkedInUserError);
    }
    const linkedInImages = socialFeedImageUrls.filter(Boolean).slice(0, 20);
    let linkedInWarning: { code: string; message: string } | null = null;
    let resp = isVideoPublication && videoUrl
      ? await linkedinPublishVideo({ accessToken, authorUrn, text: canonMessage, videoUrl, title: nextPost.title || undefined })
      : linkedInImages.length > 1
        ? await linkedinPublishMultiImage({ accessToken, authorUrn, text: canonMessage, imageUrls: linkedInImages, title: nextPost.title || undefined })
        : linkedInImages[0]
          ? await linkedinPublishImage({ accessToken, authorUrn, text: canonMessage, imageUrl: linkedInImages[0], title: nextPost.title || undefined })
          : await linkedinPublishText({ accessToken, authorUrn, text: canonMessage });

    if (
      !resp.ok &&
      !isVideoPublication &&
      linkedInImages.length > 0 &&
      resp.safeTextFallback === true
    ) {
      const mediaResp = resp;
      const fallbackResp = await linkedinPublishText({ accessToken, authorUrn, text: canonMessage });
      if (fallbackResp.ok) {
        linkedInWarning = {
          code: "published_without_image",
          message:
            "LinkedIn a publié le texte, mais les images n'ont pas pu être jointes cette fois-ci.",
        };
        resp = {
          ...fallbackResp,
          diagnostics: {
            mediaPublishError: mediaResp.error,
            mediaPublishDiagnostics: mediaResp.diagnostics,
            fallback: "text_only",
          },
        };
      }
    }
    if (!resp.ok) {
      const linkedInUserError = getPublishChannelUserMessage("linkedin", resp.error);
      logPublishChannelFailure({
        route: "inrsend_publication_channel_action",
        channel: "linkedin",
        userId,
        publicationId: publicationId || null,
        stage: "publish",
        error: resp.error,
        userMessage: linkedInUserError,
        diagnostics: resp,
      });
      throw new Error(linkedInUserError);
    }
    if (previousExternalId && previousExternalId !== resp.postUrn) {
      await deleteLinkedInPost(previousExternalId, accessToken).catch((error) => {
        console.warn("[inrsend] previous LinkedIn post cleanup failed", {
          previousExternalId,
          message: error instanceof Error ? error.message : String(error || ""),
        });
      });
    }
    let linkedInPersonalShareUrn: string | null = null;
    const canSharePagePostToProfile = Boolean(
      shouldShareLinkedInPageToProfile &&
        organizationAuthorUrn &&
        memberAuthorUrn &&
        resp.postUrn,
    );

    if (canSharePagePostToProfile) {
      const shareResp = await linkedinResharePost({
        accessToken,
        authorUrn: memberAuthorUrn,
        parentPostUrn: String(resp.postUrn),
      });
      if (shareResp.ok) {
        linkedInPersonalShareUrn = shareResp.postUrn || null;
      } else {
        logPublishChannelFailure({
          route: "inrsend_publication_channel_action",
          channel: "linkedin",
          userId,
          publicationId: publicationId || null,
          stage: "share_to_profile",
          error: shareResp.error,
          userMessage: "Publié sur la page LinkedIn. Le partage sur le profil personnel a échoué.",
          diagnostics: shareResp,
        });
      }
    }

    return {
      externalId: resp.postUrn || null,
      status: "delivered",
      error: null,
      warning: linkedInWarning?.code || null,
      warningMessage: linkedInWarning?.message || null,
      linkedinPersonalShareId: linkedInPersonalShareUrn,
    };
  }

  if (channel === "gmb") {
    const gmb = asRecord(gmbRow);
    const gmbState = publicationStates.gmb;
    const accountName = String(gmbState.account_name || "").trim();
    const locationName = String(gmbState.resource_id || "").trim();
    if (!isOfficialPublicationChannelConnected(gmbState) || !accountName || !locationName) {
      const gmbUserError = "Google Business à connecter. Rendez-vous dans Canaux.";
      logPublishChannelFailure({
        route: "inrsend_publication_channel_action",
        channel: "gmb",
        userId,
        publicationId: publicationId || null,
        stage: "precheck",
        error: "not_connected",
        userMessage: gmbUserError,
        diagnostics: {
          official_connected: gmbState.connected,
          connection_status: gmbState.connection_status,
          requires_update: gmbState.requiresUpdate,
          raw_status: String(gmb.status || "") || null,
          has_location: Boolean(locationName),
          has_account: Boolean(accountName),
        },
      });
      throw new Error(gmbUserError);
    }
    const token = await getGmbToken({
      supabase: supabaseAdmin,
      userId,
    });
    if (!token?.accessToken) {
      const gmbUserError = getPublishChannelUserMessage("gmb", "token expired");
      logPublishChannelFailure({
        route: "inrsend_publication_channel_action",
        channel: "gmb",
        userId,
        publicationId: publicationId || null,
        stage: "token",
        error: "missing_or_expired_token",
        userMessage: gmbUserError,
      });
      throw new Error(gmbUserError);
    }
    try {
      if (previousExternalId) await deleteGmbPost(previousExternalId, token.accessToken);
      let gmbWarning: { code: string; message: string } | null = null;
      let resp: unknown;
      const gmbSummary = buildBoosterGmbSummary(nextPost, { websiteUrl, phone });
      const gmbCallToAction = getBoosterGmbCallToAction(nextPost, { websiteUrl, phone });
      const rawGmbVideoUrls = isVideoPublication && videoUrl ? [videoUrl] : [];
      const checkedImages = !isVideoPublication && gmbImageUrls.length
        ? await filterGoogleBusinessMediaUrls({ urls: gmbImageUrls, kind: "image" })
        : { acceptedUrls: [] as string[] };
      const checkedVideos = isVideoPublication && rawGmbVideoUrls.length
        ? await filterGoogleBusinessMediaUrls({ urls: rawGmbVideoUrls, kind: "video" })
        : { acceptedUrls: [] as string[] };
      const safeGmbImageUrls = checkedImages.acceptedUrls.slice(0, 5);
      const gmbVideoUrls = checkedVideos.acceptedUrls.slice(0, 1);
      if (!isVideoPublication && gmbImageUrls.length && !safeGmbImageUrls.length) {
        gmbWarning = {
          code: "published_without_image",
          message: "Google Business a publié le texte sans image, car le média n’était plus accessible ou conforme.",
        };
      }
      if (isVideoPublication && !gmbVideoUrls.length) {
        throw new Error(
          "La vidéo Google Business n’est plus accessible ou conforme. La publication texte n’a pas été envoyée à la place.",
        );
      }
      const hasMedia = Boolean(safeGmbImageUrls.length || gmbVideoUrls.length);

      const publishGmb = (options?: { withoutMedia?: boolean; withoutCta?: boolean }) =>
        gmbCreateLocalPost({
          accessToken: token.accessToken,
          accountName,
          locationName,
          summary: gmbSummary,
          imageUrls: !options?.withoutMedia && !isVideoPublication && safeGmbImageUrls.length ? safeGmbImageUrls : undefined,
          videoUrls: !options?.withoutMedia && isVideoPublication && gmbVideoUrls.length ? gmbVideoUrls : undefined,
          languageCode: "fr-FR",
          callToAction: !options?.withoutCta && gmbCallToAction ? gmbCallToAction : undefined,
        });

      try {
        resp = await publishGmb();
      } catch (gmbFirstError: unknown) {
        // La création Local Post n'a pas de clé d'idempotence provider. Si le
        // POST a pu atteindre Google mais que sa réponse a été perdue, un
        // fallback immédiat sans média/CTA pourrait créer un second post.
        if (isGoogleBusinessPostOutcomeUnknown(gmbFirstError)) {
          throw gmbFirstError;
        }
        const retryWarnings: Array<{ code: string; message: string; publish: () => Promise<unknown> }> = [];

        if (hasMedia && !isVideoPublication) {
          retryWarnings.push({
            code: isGoogleBusinessImageError(gmbFirstError)
              ? "published_without_image"
              : "published_after_retry_without_image",
            message: isGoogleBusinessImageError(gmbFirstError)
                ? "Google Business a publié le texte, mais n'a pas pu récupérer l'image."
                : "Google Business a publié le texte après une reprise automatique. L'image n'a pas pu être jointe cette fois-ci.",
            publish: () => publishGmb({ withoutMedia: true }),
          });
        }

        if (gmbCallToAction) {
          retryWarnings.push({
            code: "published_without_cta",
            message: "Google Business a publié le texte sans bouton CTA.",
            publish: () => publishGmb({ withoutCta: true }),
          });
        }

        if (hasMedia && gmbCallToAction && !isVideoPublication) {
          retryWarnings.push({
            code: "published_without_media_and_cta",
            message:
              "Google Business a publié le texte, sans image ni bouton CTA.",
            publish: () => publishGmb({ withoutMedia: true, withoutCta: true }),
          });
        }

        let lastRetryError: unknown = gmbFirstError;
        for (const retry of retryWarnings) {
          try {
            resp = await retry.publish();
            gmbWarning = { code: retry.code, message: retry.message };
            lastRetryError = null;
            break;
          } catch (retryError: unknown) {
            if (isGoogleBusinessPostOutcomeUnknown(retryError)) {
              throw retryError;
            }
            lastRetryError = retryError;
          }
        }

        if (lastRetryError) throw lastRetryError;
      }
      return {
        externalId: String(asRecord(resp).name ?? "") || null,
        status: "delivered",
        error: null,
        warning: gmbWarning?.code || null,
        warningMessage: gmbWarning?.message || null,
      };
    } catch (gmbError: unknown) {
      const gmbUserError = getPublishChannelUserMessage("gmb", gmbError);
      logPublishChannelFailure({
        route: "inrsend_publication_channel_action",
        channel: "gmb",
        userId,
        publicationId: publicationId || null,
        stage: "publish",
        error: gmbError,
        userMessage: gmbUserError,
      });
      throw new Error(gmbUserError);
    }
  }

  if (channel === "tiktok") {
    throw new Error(TIKTOK_INRSEND_EXTERNAL_ACTION_MESSAGE);
  }

  if (channel === "pinterest") {
    const accessToken = await getPinterestAccessToken(userId);
    if (!accessToken) throw new Error("Pinterest à reconnecter. Rendez-vous dans Canaux.");
    if (!previousExternalId) throw new Error("Épingle Pinterest introuvable dans l’historique iNr’Send.");

    const channelResult = asRecord(asRecord(eventPayload.results).pinterest);
    const boardId = String(channelResult.board_id || "").trim();
    if (!boardId) throw new Error("Tableau Pinterest introuvable. Configurez Pinterest puis réessayez.");

    const tagLine = buildBoosterHashtagLine(nextPost, canonMessage, 8);
    const description = [canonMessage, tagLine].filter(Boolean).join("\n\n").slice(0, 500);
    const link = normalizePublicHttpUrl(nextPost.ctaUrl) || normalizePublicHttpUrl(websiteUrl) || null;

    if (isVideoPublication && videoUrl && video) {
      const created = await createPinterestVideoPin({
        accessToken,
        userId,
        boardId,
        title: nextPost.title || "Publication iNrCy",
        description,
        videoUrl,
        videoStoragePath: video.storagePath,
        videoContentType: video.type,
        videoFileName: video.name,
        coverImageUrl: video.thumbnailUrl,
        coverStoragePath: video.thumbnailStoragePath,
        coverBucket: video.thumbnailBucket,
        link,
      });
      if (!created.id) {
        throw new Error(
          "Pinterest n'a pas renvoyé l’identifiant de la nouvelle épingle vidéo.",
        );
      }

      try {
        await deletePinterestPin(accessToken, previousExternalId);
      } catch (deleteOldError) {
        try {
          await deletePinterestPin(accessToken, created.id);
        } catch {
          // Rollback best effort : on conserve l’erreur originale, plus utile au pro.
        }
        throw deleteOldError;
      }

      return {
        externalId: created.id,
        status: "delivered",
        error: null,
        pinterestMeta: {
          board_id: boardId,
          external_url: created.url || null,
          media_type: "video",
          media_id: created.media_id || null,
          media_status: created.media_status || null,
          cover_image_url: created.cover_image_url || null,
        },
      };
    }

    const pinterestImageUrls = socialFeedImageUrls.filter(Boolean).slice(0, 5);
    if (!pinterestImageUrls.length) throw new Error("Pinterest nécessite au moins 1 image.");
    const currentImageSet = getChannelImageSet(eventPayload, publication, channel);
    const currentPinterestImageUrls = (
      currentImageSet.socialFeedPublishableUrls.length
        ? currentImageSet.socialFeedPublishableUrls
        : currentImageSet.images
    ).filter(Boolean).slice(0, 5);
    const imageChanged = !areImageListsEqual(currentPinterestImageUrls, pinterestImageUrls);

    const replacePinterestPin = async (params: {
      imageUrls: string[];
      warning?: string | null;
      warningMessage?: string | null;
    }) => {
      const created = await createPinterestImagePin({
        accessToken,
        userId,
        boardId,
        title: nextPost.title || "Publication iNrCy",
        description,
        imageUrls: params.imageUrls,
        link,
      });
      if (!created.id) {
        throw new Error(
          "Pinterest n'a pas renvoyé l’identifiant de la nouvelle épingle.",
        );
      }

      try {
        await deletePinterestPin(accessToken, previousExternalId);
      } catch (deleteOldError) {
        try {
          await deletePinterestPin(accessToken, created.id);
        } catch {
          // Rollback best effort : on conserve l’erreur originale, plus utile au pro.
        }
        throw deleteOldError;
      }

      return {
        externalId: created.id,
        status: "delivered",
        error: null,
        warning: params.warning || null,
        warningMessage: params.warningMessage || null,
        pinterestMeta: {
          board_id: boardId,
          external_url: created.url || null,
          media_type: "image",
          image_count: params.imageUrls.length,
          images_harmonized: Boolean(created.images_harmonized),
          image_preparation_message: created.images_harmonized
            ? "Les images Pinterest ont été harmonisées automatiquement pour conserver un format identique."
            : null,
          target_width: created.target_width || null,
          target_height: created.target_height || null,
        },
      };
    };

    if (!imageChanged) {
      try {
        const updated = await updatePinterestPin({
          accessToken,
          pinId: previousExternalId,
          boardId,
          title: nextPost.title || "Publication iNrCy",
          description,
          link,
        });
        return {
          externalId: updated.id || previousExternalId,
          status: "delivered",
          error: null,
          pinterestMeta: {
            board_id: boardId,
            external_url: updated.url || null,
            media_type: "image",
            image_count: currentPinterestImageUrls.length || pinterestImageUrls.length,
          },
        };
      } catch (updateError) {
        const canFallbackReplace = isPinterestPinEditRestrictedError(updateError);
        if (!canFallbackReplace) throw updateError;

        const stableExistingImageUrls = currentPinterestImageUrls.length
          ? currentPinterestImageUrls
          : pinterestImageUrls;
        return replacePinterestPin({
          imageUrls: stableExistingImageUrls,
          warning: "pinterest_pin_replaced",
          warningMessage:
            "Pinterest a remplacé l’épingle pour appliquer la modification. Son identifiant et ses statistiques repartent de zéro.",
        });
      }
    }

    return replacePinterestPin({ imageUrls: pinterestImageUrls });
  }

  throw new Error("Canal non supporté.");
}

async function removeChannelDelivery(params: {
  userId: string;
  publicationId?: string | null;
  channel: ChannelKey;
  previousExternalId?: string | null;
  eventPayload?: JsonRecord | null;
}) {
  const { userId, publicationId, channel, previousExternalId } = params;

  if (channel === "tiktok") {
    throw new Error(TIKTOK_INRSEND_EXTERNAL_ACTION_MESSAGE);
  }

  if (channel === "inr_search") {
    const provisioned = await ensureSystemManagedInrSearch(supabaseAdmin, userId);
    const slug = String(provisioned.inrSearch?.publishedSlug || provisioned.inrSearch?.slug || "").trim();
    revalidateInrSearchPublicRoutes(slug);
    await notifyInrSearchIndexing(slug);
    return;
  }

  if (channel === "pinterest") {
    const accessToken = await getPinterestAccessToken(userId);
    if (!accessToken) throw new Error("Pinterest à reconnecter. Rendez-vous dans Canaux.");
    if (!previousExternalId) throw new Error("Épingle Pinterest introuvable dans l’historique iNr’Send.");
    await deletePinterestPin(accessToken, previousExternalId);
    return;
  }

  if (channel === "inrcy_site" || channel === "site_web") {
    if (previousExternalId) {
      const { error } = await supabaseAdmin.from("site_articles").delete().eq("id", previousExternalId).eq("user_id", userId).eq("source", channel);
      if (error) throw error;
    }
    return;
  }

  const [fbRow, _gmbRow, igRow, liRow] = await Promise.all([
    getLatestIntegrationRow(userId, "facebook", "facebook", "facebook", "status,resource_id,access_token_enc,meta"),
    getLatestIntegrationRow(userId, "google", "gmb", "gmb", "status,resource_id,meta"),
    getLatestIntegrationRow(userId, "instagram", "instagram", "instagram", "status,resource_id,access_token_enc,meta"),
    getLatestIntegrationRow(userId, "linkedin", "linkedin", "linkedin", "status,resource_id,access_token_enc"),
  ]);

  if (channel === "facebook") {
    const token = tryDecryptToken(String(asRecord(fbRow).access_token_enc ?? "")) || "";
    if (!token) throw new Error("Votre compte Facebook n’est pas encore correctement relié.");
    if (previousExternalId) await deleteFacebookPost(previousExternalId, token);
    return;
  }

  if (channel === "instagram") {
    const candidates = buildInstagramDeleteTokenCandidates([{ sourceLabel: "instagram", row: igRow }, { sourceLabel: "facebook", row: fbRow }]);
    if (!candidates.length) throw new Error("Votre compte Instagram n’est pas encore correctement relié.");
    if (previousExternalId) {
      const instagramChannelResult = asRecord(asRecord(params.eventPayload).results).instagram
        ? asRecord(asRecord(asRecord(params.eventPayload).results).instagram)
        : null;
      const deleteResult = await deleteInstagramMediaWithFallback(previousExternalId, {
        igRow,
        fbRow,
        channelResult: instagramChannelResult,
        allowLocalFallback: true,
      });
      await logInstagramAction({
        userId,
        publicationId: publicationId || null,
        action: "delete",
        externalId: previousExternalId,
        result: deleteResult as unknown as JsonRecord,
      });
    }
    return;
  }

  if (channel === "linkedin") {
    const auth = await getLinkedInAccessToken({ userId });
    const token = auth.accessToken || "";
    if (!token) throw new Error(auth.error || "Votre compte LinkedIn n’est pas encore correctement relié.");
    if (previousExternalId) await deleteLinkedInPost(previousExternalId, token);
    return;
  }

  if (channel === "gmb") {
    const token = await getGmbToken({
      supabase: supabaseAdmin,
      userId,
    });
    if (!token?.accessToken) throw new Error("La connexion Google a expiré. Merci de reconnecter votre compte.");
    if (previousExternalId) await deleteGmbPost(previousExternalId, token.accessToken);
  }
}

function buildUpdatedPayload(params: {
  eventPayload: JsonRecord;
  publication: JsonRecord;
  channel: ChannelKey;
  nextPost: PostPayload;
  externalId: string | null;
  mediaType?: PublicationMediaType;
  video?: PersistedVideoAttachment | null;
  imageSet?: ImageSet | null;
  instagramMeta?: JsonRecord | null;
  tiktokMeta?: JsonRecord | null;
  pinterestMeta?: JsonRecord | null;
  warning?: string | null;
  warningMessage?: string | null;
  videoSettings?: JsonRecord | null;
}) {
  const { eventPayload, publication, channel, nextPost, externalId, imageSet, instagramMeta, tiktokMeta, pinterestMeta } = params;
  const mediaType = params.mediaType || getEventPublicationMediaType(eventPayload, publication, channel);
  const video = params.video || getPublicationVideo(eventPayload, publication, channel);
  const isVideoPublication = mediaType === "video";
  const results = cloneRecord(asRecord(eventPayload.results));
  const channelResult = asRecord(results[channel]);
  results[channel] = {
    ...channelResult,
    ok: true,
    status: "delivered",
    deleted: false,
    error: null,
    external_id: externalId,
    ...(params.warning ? { warning: params.warning, warning_message: params.warningMessage || null } : {}),
    ...(channel === "instagram" && instagramMeta ? instagramMeta : {}),
    ...(channel === "tiktok" && tiktokMeta ? tiktokMeta : {}),
    ...(channel === "pinterest" && pinterestMeta ? pinterestMeta : {}),
    updated_at: new Date().toISOString(),
  };

  const currentPostByChannel = asRecord(eventPayload.postByChannel);
  const currentChannelPost = asRecord(currentPostByChannel[channel]);
  const rootVideoSettings = buildVideoSettingsByChannel({
    channels: [channel],
    videoSettingsByChannel: eventPayload.videoSettingsByChannel,
    videoFormatByChannel: eventPayload.videoFormatByChannel,
    videoAdaptationModeByChannel: eventPayload.videoAdaptationModeByChannel,
  });
  const requestedVideoSettings = asRecord(params.videoSettings);
  const channelVideoSettings = normalizeChannelVideoSettings(
    channel,
    Object.keys(requestedVideoSettings).length ? requestedVideoSettings : (currentChannelPost.videoSettings || rootVideoSettings[channel]),
    currentChannelPost.videoFormat,
    currentChannelPost.videoAdaptationMode,
  );
  const nextChannelPost: JsonRecord = {
    ...currentChannelPost,
    ...nextPost,
    videoSettings: channelVideoSettings,
    videoFormat: channelVideoSettings.format,
    videoAdaptationMode: channelVideoSettings.adaptationMode,
  };

  const existingChannelVideo = asRecord(currentChannelPost.video);
  const existingRootVideo = asRecord(eventPayload.video);
  const originalVideoForWork = isVideoPublication && video
    ? normalizeVideoAttachment(
        asRecord(video).sourceVideo ||
        asRecord(video).source_video ||
        currentChannelPost.sourceVideo ||
        currentChannelPost.source_video ||
        existingChannelVideo.sourceVideo ||
        existingChannelVideo.source_video ||
        eventPayload.sourceVideo ||
        eventPayload.source_video ||
        existingRootVideo.sourceVideo ||
        existingRootVideo.source_video ||
        video,
      )
    : null;

  if (isVideoPublication && video) {
    nextChannelPost.mediaType = "video";
    nextChannelPost.images = [];
    nextChannelPost.video = video;
    nextChannelPost.sourceVideo = originalVideoForWork || video;
    nextChannelPost.attachments = [video];
    nextChannelPost.publishableUrls = [];
    nextChannelPost.instagramPublishableUrls = [];
    nextChannelPost.socialFeedPublishableUrls = [];
    nextChannelPost.siteCardPublishableUrls = [];
    nextChannelPost.gmbPublishableUrls = [];
  } else if (imageSet) {
    nextChannelPost.mediaType = "images";
    nextChannelPost.images = imageSet.images;
    nextChannelPost.attachments = imageSet.editableAttachments?.length ? imageSet.editableAttachments : imageSet.images;
    nextChannelPost.publishableUrls = imageSet.images;
    nextChannelPost.instagramPublishableUrls = imageSet.instagramPublishableUrls;
    nextChannelPost.socialFeedPublishableUrls = imageSet.socialFeedPublishableUrls;
    nextChannelPost.siteCardPublishableUrls = imageSet.siteCardPublishableUrls;
    nextChannelPost.gmbPublishableUrls = imageSet.gmbPublishableUrls;
  }

  const nextPayload: JsonRecord = {
    ...eventPayload,
    channels: Array.from(new Set([...(Array.isArray(eventPayload.channels) ? eventPayload.channels : []), channel])),
    videoSettingsByChannel: {
      ...asRecord(eventPayload.videoSettingsByChannel),
      [channel]: channelVideoSettings,
    },
    videoFormatByChannel: {
      ...asRecord(eventPayload.videoFormatByChannel),
      [channel]: channelVideoSettings.format,
    },
    videoAdaptationModeByChannel: {
      ...asRecord(eventPayload.videoAdaptationModeByChannel),
      [channel]: channelVideoSettings.adaptationMode,
    },
    postByChannel: {
      ...currentPostByChannel,
      [channel]: nextChannelPost,
    },
    post: channel === "inrcy_site" || channel === "site_web" || channel === "inr_search" ? asRecord(eventPayload.post) : eventPayload.post,
    results,
    mediaType: isVideoPublication ? "video" : (eventPayload.mediaType || eventPayload.media_type || "images"),
    ...(isVideoPublication && video ? { video, sourceVideo: originalVideoForWork || asRecord(video).sourceVideo || asRecord(video).source_video || null } : {}),
  };

  if (!asRecord(nextPayload.post).title && !asRecord(nextPayload.post).content) {
    nextPayload.post = getChannelPost(eventPayload, publication, channel);
  }

  return nextPayload;
}

function buildDeletedPayload(params: {
  eventPayload: JsonRecord;
  channel: ChannelKey;
  previousExternalId: string | null;
}) {
  const { eventPayload, channel, previousExternalId } = params;
  const results = cloneRecord(asRecord(eventPayload.results));
  const channelResult = asRecord(results[channel]);
  results[channel] = {
    ...channelResult,
    ok: false,
    status: "deleted",
    deleted: true,
    error: null,
    deleted_at: new Date().toISOString(),
    external_id: previousExternalId || channelResult.external_id || null,
  };

  return {
    ...eventPayload,
    channels: Array.from(new Set([...(Array.isArray(eventPayload.channels) ? eventPayload.channels : []), channel])),
    results,
  } as JsonRecord;
}

function isCancelledResult(result: JsonRecord) {
  const status = String(result.tiktok_status || result.status || "").toUpperCase();
  return result.cancelled === true || status === "CANCELLED" || status === "CANCELED";
}

function isPendingTiktokResult(result: JsonRecord) {
  if (isCancelledResult(result)) return false;

  const diagnostics = asRecord(result.diagnostics);
  const statusDiagnostics = asRecord(diagnostics.status);
  const status = String(
    result.tiktok_status ||
      result.status ||
      statusDiagnostics.status ||
      "",
  ).toUpperCase();
  const publishId = String(
    result.external_id ||
      result.publish_id ||
      diagnostics.publish_id ||
      "",
  ).trim();
  const complete = ["PUBLISH_COMPLETE", "DONE", "SUCCESS"].includes(status);
  const failed =
    ["FAILED", "PUBLISH_FAILED", "ERROR"].includes(status) ||
    (result.ok === false && status !== "STATUS_FETCH_ERROR");

  return !complete && !failed && Boolean(publishId || result.warning || status);
}

function buildCancelledPayload(params: {
  eventPayload: JsonRecord;
  channel: ChannelKey;
  previousExternalId: string | null;
}) {
  const { eventPayload, channel, previousExternalId } = params;
  const results = cloneRecord(asRecord(eventPayload.results));
  const channelResult = asRecord(results[channel]);
  const diagnostics = asRecord(channelResult.diagnostics);
  const cancelledAt = new Date().toISOString();
  const message =
    "Publication annulée dans iNr’Send. Le suivi automatique est arrêté. Une tentative déjà acceptée par TikTok ne peut pas être interrompue à distance.";

  results[channel] = {
    ...channelResult,
    status: "cancelled",
    cancelled: true,
    cancelled_at: cancelledAt,
    error: null,
    warning: false,
    warning_message: null,
    external_id: previousExternalId || channelResult.external_id || null,
    ...(channel === "tiktok"
      ? {
          tiktok_status: "CANCELLED",
          tiktok_status_label: "Annulé",
          tiktok_status_message: message,
          tiktok_cancelled_at: cancelledAt,
          tiktok_status_fetch_failed: false,
          tiktok_stalled: false,
          diagnostics: {
            ...diagnostics,
            cancelled: true,
            cancelled_at: cancelledAt,
          },
        }
      : {}),
  };

  return {
    ...eventPayload,
    channels: Array.from(new Set([...(Array.isArray(eventPayload.channels) ? eventPayload.channels : []), channel])),
    results,
  } as JsonRecord;
}

export function createPublicationChannelHandlers(channel: ChannelKey) {
  async function PATCH(req: Request, context: { params: Promise<{ publicationId: string }> }) {
    try {
      const { user, activeUserId, errorResponse } = await requireUser();
      if (errorResponse) return errorResponse;

      const params = await context.params;
      const publicationId = String(params.publicationId || "").trim();
      if (!publicationId) return jsonUserFacingError("Paramètres invalides.", { status: 400, code: "invalid_input" });

      if (channel === "tiktok") {
        return jsonUserFacingError(TIKTOK_INRSEND_EXTERNAL_ACTION_MESSAGE, { status: 409, code: "tiktok_external_action_required" });
      }
      const body = (await req.json().catch(() => null)) as JsonRecord | null;
      if (!body) return jsonUserFacingError("Bad payload", { status: 400, code: "invalid_payload" });

      const ctx = await loadPublicationContext(activeUserId, publicationId);
      if (!ctx) return jsonUserFacingError("Publication introuvable.", { status: 404, code: "publication_not_found" });

      const results = asRecord(ctx.eventPayload.results);
      const channelResult = asRecord(results[channel]);
      if (isDeletedResult(channelResult)) {
        return jsonUserFacingError("Ce canal est déjà supprimé.", { status: 409, code: "channel_already_deleted" });
      }

      const currentPost = getChannelPost(ctx.eventPayload, ctx.publication, channel);
      const nextPost: PostPayload = {
        title: String(body.title ?? currentPost.title ?? "").trim(),
        content: String(body.content ?? currentPost.content ?? "").trim(),
        cta: String(body.cta ?? currentPost.cta ?? "").trim(),
        ctaMode: String(body.ctaMode ?? currentPost.ctaMode ?? "").trim(),
        ctaUrl: String(body.ctaUrl ?? currentPost.ctaUrl ?? "").trim(),
        ctaPhone: String(body.ctaPhone ?? currentPost.ctaPhone ?? "").trim(),
        hashtags: Array.isArray(body.hashtags)
          ? body.hashtags.map((tag: unknown) => normalizeHashtag(String(tag || ""))).filter(Boolean).slice(0, 20)
          : currentPost.hashtags,
      };

      const mediaType = normalizePublicationMediaType(body.mediaType || getEventPublicationMediaType(ctx.eventPayload, ctx.publication, channel));
      const requestedVideoSettings = asRecord(body.videoSettings);
      const incomingVideo = normalizeVideoAttachment(body.video || body.newVideo || body.retainedVideo);
      const video = mediaType === "video" ? (incomingVideo || getPublicationVideo(ctx.eventPayload, ctx.publication, channel)) : null;

      const retainedImages = mediaType === "images"
        ? Array.isArray(body.retainedImages)
          ? body.retainedImages.map((value: unknown) => String(value || "").trim()).filter(Boolean)
          : getChannelImageSet(ctx.eventPayload, ctx.publication, channel).images
        : [];
      const newImages = mediaType === "images" && Array.isArray(body.newImages)
        ? body.newImages
            .map((value: unknown) => asRecord(value))
            .map((value) => ({
              name: String(value.name ?? "image").trim() || "image",
              type: String(value.type ?? "image/jpeg").trim() || "image/jpeg",
              dataUrl: String(value.dataUrl ?? "").trim(),
              originalUrl: String(value.originalUrl ?? value.originalPublicUrl ?? "").trim() || null,
              originalPublicUrl: String(value.originalPublicUrl ?? value.originalUrl ?? "").trim() || null,
              originalName: String(value.originalName ?? value.name ?? "").trim() || null,
              originalType: String(value.originalType ?? value.type ?? "").trim() || null,
              imageKey: String(value.imageKey ?? "").trim() || null,
              transform: value.transform || null,
              imageMeta: value.imageMeta || null,
            }))
            .filter((value) => value.dataUrl)
        : [];
      if (retainedImages.length + newImages.length > 5) {
        return jsonUserFacingError("Maximum 5 images par publication.", { status: 400, code: "too_many_images" });
      }
      if (
        mediaType === "video" &&
        !video?.publicUrl &&
        !video?.storagePath
      ) {
        return jsonUserFacingError(
          "Vidéo introuvable. Merci de relancer la publication depuis Booster.",
          { status: 400, code: "video_missing" },
        );
      }

      const imageSet = mediaType === "images"
        ? await updatePublicationImages({
            userId: activeUserId,
            publication: ctx.publication,
            eventPayload: ctx.eventPayload,
            channel,
            retainedImages,
            newImages,
          })
        : null;

      const previousExternalId = String(body.externalId ?? channelResult.external_id ?? "").trim() || null;
      const replaceResult = await replaceChannelDelivery({
        userId: activeUserId,
        publicationId,
        channel,
        previousExternalId,
        publication: ctx.publication,
        eventPayload: ctx.eventPayload,
        nextPost,
        mediaType,
        video,
        imageSet,
      });

      const nextPayload = buildUpdatedPayload({
        eventPayload: ctx.eventPayload,
        publication: ctx.publication,
        channel,
        nextPost,
        externalId: replaceResult.externalId,
        mediaType,
        video,
        imageSet,
        instagramMeta: asRecord((replaceResult as JsonRecord).instagramMeta),
        tiktokMeta: asRecord((replaceResult as JsonRecord).tiktokMeta),
        pinterestMeta: asRecord((replaceResult as JsonRecord).pinterestMeta),
        warning: String((replaceResult as JsonRecord).warning || "").trim() || null,
        warningMessage: String((replaceResult as JsonRecord).warningMessage || replaceResult.error || "").trim() || null,
        videoSettings: requestedVideoSettings,
      });

      await persistEventPayload(activeUserId, publicationId, nextPayload);
      await syncDeliveryRow({ userId: activeUserId, publicationId, channel, status: replaceResult.status, error: replaceResult.error });
      if (channel === "inr_search") {
        const provisioned = await ensureSystemManagedInrSearch(supabaseAdmin, activeUserId);
        const slug = String(provisioned.inrSearch?.publishedSlug || provisioned.inrSearch?.slug || "");
        revalidateInrSearchPublicRoutes(slug);
        await notifyInrSearchIndexing(slug);
      }

      return NextResponse.json({ ok: true, publication_id: publicationId, channel, external_id: replaceResult.externalId, payload: nextPayload });
    } catch (e: unknown) {
      captureApiException(req, e, {
        area: "booster",
        operation: `PATCH /api/inrsend/publications/:publicationId/${channel}`,
        statusCode: 500,
        provider: channel,
      });
      const userMessage = getPublishChannelUserMessage(channel, e, "La modification de la publication a échoué.");
      logPublishChannelFailure({
        route: "inrsend_publication_channel_update",
        channel,
        stage: "exception",
        error: e,
        userMessage,
      });
      return jsonUserFacingError(userMessage, { status: 500, fallback: userMessage, code: "publication_update_failed" });
    }
  }

  async function DELETE(req: Request, context: { params: Promise<{ publicationId: string }> }) {
    try {
      const { user, activeUserId, errorResponse } = await requireUser();
      if (errorResponse) return errorResponse;

      const params = await context.params;
      const publicationId = String(params.publicationId || "").trim();
      if (!publicationId) return jsonUserFacingError("Paramètres invalides.", { status: 400, code: "invalid_input" });

      const body = (await req.json().catch(() => ({}))) as JsonRecord;

      if (channel === "tiktok") {
        if (String(body.action || "").trim() !== "cancel_pending") {
          return jsonUserFacingError(TIKTOK_INRSEND_EXTERNAL_ACTION_MESSAGE, { status: 409, code: "tiktok_external_action_required" });
        }

        const ctx = await loadPublicationContext(activeUserId, publicationId);
        if (!ctx) return jsonUserFacingError("Publication introuvable.", { status: 404, code: "publication_not_found" });

        const results = asRecord(ctx.eventPayload.results);
        const channelResult = asRecord(results[channel]);
        const previousExternalId = String(body.externalId ?? channelResult.external_id ?? "").trim() || null;

        if (isCancelledResult(channelResult)) {
          const payload = buildCancelledPayload({ eventPayload: ctx.eventPayload, channel, previousExternalId });
          return NextResponse.json({
            ok: true,
            cancelled: true,
            remote_cancellation_supported: false,
            message: "Cette publication est déjà annulée dans iNr’Send.",
            payload,
          });
        }

        if (!isPendingTiktokResult(channelResult)) {
          return jsonUserFacingError(
            "Seule une publication TikTok encore en attente peut être annulée depuis iNr’Send.",
            { status: 409, code: "tiktok_not_pending" },
          );
        }

        const nextPayload = buildCancelledPayload({ eventPayload: ctx.eventPayload, channel, previousExternalId });
        await syncDeliveryRow({ userId: activeUserId, publicationId, channel, status: "deleted", error: null });
        await persistEventPayload(activeUserId, publicationId, nextPayload);

        return NextResponse.json({
          ok: true,
          cancelled: true,
          remote_cancellation_supported: false,
          message: "Publication annulée dans iNr’Send. Le suivi automatique est arrêté.",
          payload: nextPayload,
        });
      }
      const ctx = await loadPublicationContext(activeUserId, publicationId);
      if (!ctx) return jsonUserFacingError("Publication introuvable.", { status: 404, code: "publication_not_found" });

      const results = asRecord(ctx.eventPayload.results);
      const channelResult = asRecord(results[channel]);
      const previousExternalId = String(body.externalId ?? channelResult.external_id ?? "").trim() || null;

      if (isDeletedResult(channelResult)) {
        const payload = buildDeletedPayload({ eventPayload: ctx.eventPayload, channel, previousExternalId });
        return NextResponse.json({ ok: true, deleted: true, removed_publication: false, payload });
      }

      await removeChannelDelivery({ userId: activeUserId, publicationId, channel, previousExternalId, eventPayload: ctx.eventPayload });

      const nextPayload = buildDeletedPayload({ eventPayload: ctx.eventPayload, channel, previousExternalId });
      await persistEventPayload(activeUserId, publicationId, nextPayload);
      await syncDeliveryRow({ userId: activeUserId, publicationId, channel, status: "deleted", error: null });
      if (channel === "inr_search") {
        const provisioned = await ensureSystemManagedInrSearch(supabaseAdmin, activeUserId);
        const slug = String(provisioned.inrSearch?.publishedSlug || provisioned.inrSearch?.slug || "");
        revalidateInrSearchPublicRoutes(slug);
        await notifyInrSearchIndexing(slug);
      }

      return NextResponse.json({ ok: true, deleted: true, removed_publication: false, payload: nextPayload });
    } catch (e: unknown) {
      captureApiException(req, e, {
        area: "booster",
        operation: `DELETE /api/inrsend/publications/:publicationId/${channel}`,
        statusCode: 500,
        provider: channel,
      });
      const userMessage = getPublishChannelUserMessage(channel, e, "La suppression de la publication a échoué.");
      logPublishChannelFailure({
        route: "inrsend_publication_channel_delete",
        channel,
        stage: "exception",
        error: e,
        userMessage,
      });
      return jsonUserFacingError(userMessage, { status: 500, fallback: userMessage, code: "publication_delete_failed" });
    }
  }

  return { PATCH, DELETE };
}
