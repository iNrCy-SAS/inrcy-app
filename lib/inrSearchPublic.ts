import { cache } from "react";
import { unstable_cache } from "next/cache";
import { getActivitySectorLabel, decodeBusinessSector } from "@/lib/activitySectors";
import { getChannelConnectionStates } from "@/lib/channelConnectionState";
import { filterEligibleInrSearchAccountIds, getInrSearchPublicationEligibility } from "@/lib/inrSearchEligibility";
import { LOGO_BUCKET, resolveProfileLogoUrl } from "@/lib/profileLogo";
import { createSafeStorageSignedUrl, probeStorageObject } from "@/lib/safeStorageSignedUrl";
import { createInrBadgePublicUrl, createInrBadgeQrTrackingUrl } from "@/lib/inrBadge";
import { resolveFrenchGeography } from "@/lib/frenchGeography";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { combineOpeningSchedule } from "@/lib/openingSchedule";
import {
  hasSuccessfulInrSearchChannel,
  mergeInrSearchPublicationFeeds,
} from "@/lib/inrSearchPublicationFeed";

export type InrSearchSectionKey =
  | "identity"
  | "presentation"
  | "contact"
  | "hours"
  | "services"
  | "sectors"
  | "areas"
  | "media"
  | "news"
  | "socials"
  | "faq"
  | "trust"
  | "cta";

export type InrSearchSections = Record<InrSearchSectionKey, boolean>;

export type InrSearchPublication = {
  id: string;
  title: string;
  content: string;
  imageUrl: string | null;
  videoUrl: string | null;
  videoMime: string;
  videoThumbnailUrl: string | null;
  createdAt: string | null;
};

export type InrSearchMedia = {
  id: string;
  title: string;
  url: string;
};

export type InrSearchSocialLink = {
  key: string;
  label: string;
  url: string;
};

export type InrSearchFaq = {
  question: string;
  answer: string;
};

export type InrSearchServiceDescriptions = Record<string, string>;

export type InrSearchPublicPageData = {
  userId: string;
  slug: string;
  pageTitle: string;
  pageDescription: string;
  enabled: boolean;
  sections: InrSearchSections;
  updatedAt: string | null;
  companyName: string;
  contactName: string;
  logoUrl: string;
  phone: string;
  email: string;
  address: string;
  zip: string;
  city: string;
  country: string;
  addressLine: string;
  description: string;
  sectorCategory: string;
  sectorLabel: string;
  profession: string;
  services: string[];
  serviceDescriptions: InrSearchServiceDescriptions;
  zones: string[];
  strengths: string[];
  customerTypes: string[];
  openingDays: string;
  openingHours: string;
  websiteUrl: string;
  googleBusinessUrl: string;
  socialLinks: InrSearchSocialLink[];
  publications: InrSearchPublication[];
  media: InrSearchMedia[];
  faq: InrSearchFaq[];
  inrBadgeUrl: string;
  inrBadgeQrUrl: string;
};

export type PublishedInrSearchCompany = {
  slug: string;
  companyName: string;
  pageTitle: string;
  pageDescription: string;
  city: string;
  citySlug: string;
  department: string;
  departmentSlug: string;
  region: string;
  regionSlug: string;
  profession: string;
  professionSlug: string;
  sectorCategory: string;
  sectorLabel: string;
  sectorSlug: string;
  updatedAt: string | null;
};


export type InrSearchPublicStatusReason =
  | "published"
  | "slug_missing"
  | "config_missing"
  | "page_disabled"
  | "bubble_disabled"
  | "subscription_inactive"
  | "profile_missing"
  | "data_unavailable";

export type InrSearchPublicStatus = {
  published: boolean;
  reason: InrSearchPublicStatusReason;
  slug: string;
  accountId: string | null;
  publicUrl: string;
};

export type InrSearchDirectoryEntry = {
  slug: string;
  label: string;
  count: number;
};

const DEFAULT_SECTIONS: InrSearchSections = {
  identity: true,
  presentation: true,
  contact: true,
  hours: true,
  services: true,
  sectors: true,
  areas: true,
  media: true,
  news: true,
  socials: true,
  faq: true,
  trust: true,
  cta: true,
};

const PUBLIC_ORIGIN = ((process.env.NEXT_PUBLIC_INRSEARCH_PUBLIC_ORIGIN || "https://app.inrcy.com").replace(/\/$/, "") === "https://inrcy.com" ? "https://app.inrcy.com" : (process.env.NEXT_PUBLIC_INRSEARCH_PUBLIC_ORIGIN || "https://app.inrcy.com").replace(/\/$/, ""));
const MEDIA_SIGNED_URL_TTL_SECONDS = 60 * 60 * 24 * 30;

export function getInrSearchPublicOrigin() {
  return PUBLIC_ORIGIN;
}

export function buildInrSearchPublicUrl(slug: string) {
  return `${PUBLIC_ORIGIN}/entreprises/${encodeURIComponent(slug)}`;
}

export function buildInrSearchProfessionUrl(professionSlug: string, citySlug?: string) {
  const base = `${PUBLIC_ORIGIN}/metiers/${encodeURIComponent(professionSlug)}`;
  return citySlug ? `${base}/${encodeURIComponent(citySlug)}` : base;
}

export function buildInrSearchSectorUrl(sectorSlug: string) {
  return `${PUBLIC_ORIGIN}/secteurs/${encodeURIComponent(sectorSlug)}`;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function clean(value: unknown, max = 5000) {
  return String(value ?? "").trim().slice(0, max).trim();
}

function latestIsoDate(values: unknown[]) {
  return values
    .map((value) => clean(value, 80))
    .filter(Boolean)
    .sort((left, right) => {
      const leftTime = Date.parse(left);
      const rightTime = Date.parse(right);
      if (!Number.isFinite(leftTime) || !Number.isFinite(rightTime)) return right.localeCompare(left);
      return rightTime - leftTime;
    })[0] || null;
}

export function normalizeInrSearchDirectorySlug(value: unknown) {
  return clean(value, 160)
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120);
}

function normalizeSections(value: unknown): InrSearchSections {
  const source = asRecord(value);
  const sections = { ...DEFAULT_SECTIONS };
  for (const key of Object.keys(DEFAULT_SECTIONS) as InrSearchSectionKey[]) {
    if (Object.prototype.hasOwnProperty.call(source, key)) sections[key] = Boolean(source[key]);
  }
  return sections;
}

function listFromUnknown(value: unknown): string[] {
  const raw = Array.isArray(value)
    ? value.flatMap((item) =>
      typeof item === "string" ? item.split(/\r?\n/) : [item],
    )
    : typeof value === "string"
      ? value.split(/\r?\n|,|;/)
      : [];

  return Array.from(
    new Set(
      raw
        .map((item) =>
          clean(item, 180)
            .replace(/^(?:[-–—•·▪◦*]+|\d+[.)])\s*/u, "")
            .replace(/^(?:et|ou)\s+/iu, "")
            .replace(/\s+/g, " ")
            .trim(),
        )
        .filter(Boolean),
    ),
  ).slice(0, 40);
}

function normalizeServiceDescriptionMap(...values: unknown[]): InrSearchServiceDescriptions {
  const result: InrSearchServiceDescriptions = {};

  const store = (keyValue: unknown, descriptionValue: unknown) => {
    const key = clean(keyValue, 180);
    const description = clean(descriptionValue, 900);
    if (!key || !description) return;
    result[key] = description;
    result[normalizeInrSearchDirectorySlug(key)] = description;
  };

  const visit = (value: unknown) => {
    if (!value) return;
    if (typeof value === "string") {
      try {
        visit(JSON.parse(value));
      } catch {
        return;
      }
      return;
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        const record = asRecord(item);
        store(
          record.service || record.name || record.title || record.key,
          record.description || record.text || record.content || record.body,
        );
      }
      return;
    }
    const record = asRecord(value);
    for (const [key, rawDescription] of Object.entries(record)) {
      if (typeof rawDescription === "string") {
        store(key, rawDescription);
      } else {
        const descriptionRecord = asRecord(rawDescription);
        store(
          descriptionRecord.service || descriptionRecord.name || descriptionRecord.title || key,
          descriptionRecord.description || descriptionRecord.text || descriptionRecord.content || descriptionRecord.body,
        );
      }
    }
  };

  for (const value of values) visit(value);
  return result;
}

function normalizeExternalUrl(value: unknown): string {
  const raw = clean(value, 1000);
  if (!raw) return "";
  try {
    const firstSegment = raw.split(/[/?#]/, 1)[0] || "";
    const looksLikeHostname =
      firstSegment.includes(".") ||
      firstSegment.includes(":") ||
      firstSegment.toLocaleLowerCase("en-US") === "localhost";
    const isInternalPath =
      !/^https?:\/\//i.test(raw) &&
      !raw.startsWith("//") &&
      !looksLikeHostname;
    const url = raw.startsWith("//")
      ? new URL(`https:${raw}`)
      : raw.startsWith("/") || isInternalPath
        ? new URL(`/${raw.replace(/^\/+/, "")}`, PUBLIC_ORIGIN)
        : new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!/^https?:$/.test(url.protocol)) return "";
    return url.toString();
  } catch {
    return "";
  }
}

function firstImageUrl(value: unknown): string | null {
  const candidates = Array.isArray(value) ? value : [];
  for (const candidate of candidates) {
    const record = asRecord(candidate);
    const raw = typeof candidate === "string"
      ? candidate
      : clean(
          record.url ||
          record.publicUrl ||
          record.public_url ||
          record.renderedUrl ||
          record.rendered_url ||
          record.originalPublicUrl ||
          record.original_public_url ||
          record.originalUrl ||
          record.original_url ||
          record.src,
          1000,
        );
    const url = normalizeExternalUrl(raw);
    if (url) return url;
  }
  return null;
}

function arrayFromUnknown(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

type StorageMediaCandidate = {
  bucket: string;
  storagePath: string;
};

function normalizeStoragePath(value: unknown) {
  const raw = clean(value, 1200).replace(/^\/+/, "");
  if (!raw || /^https?:\/\//i.test(raw) || raw.includes("..") || raw.includes("\\")) return "";
  return raw;
}

function normalizeStorageBucket(value: unknown, fallback = "booster") {
  return clean(value, 120) || fallback;
}

function addStorageCandidate(
  target: StorageMediaCandidate[],
  seen: Set<string>,
  storagePathValue: unknown,
  bucketValue: unknown = "booster",
) {
  const storagePath = normalizeStoragePath(storagePathValue);
  const bucket = normalizeStorageBucket(bucketValue);
  if (!storagePath || !bucket) return;
  const key = `${bucket}:${storagePath}`;
  if (seen.has(key)) return;
  seen.add(key);
  target.push({ bucket, storagePath });
}

function isVideoLikeRecord(value: unknown) {
  const record = asRecord(value);
  const mime = clean(
    record.type || record.mime || record.mimeType || record.mime_type || record.contentType || record.content_type,
    160,
  ).toLowerCase();
  const name = clean(record.name || record.filename || record.fileName, 400).toLowerCase();
  return mime.startsWith("video/") || /\.(?:mp4|mov|m4v|webm|avi|mkv)(?:$|[?#])/i.test(name);
}

function collectAttachmentRecords(...values: unknown[]) {
  const records: Record<string, unknown>[] = [];
  for (const value of values) {
    for (const item of arrayFromUnknown(value)) {
      const record = asRecord(item);
      if (Object.keys(record).length) records.push(record);
    }
  }
  return records;
}

function collectImageStorageCandidates(payload: Record<string, unknown>, post: Record<string, unknown>) {
  const candidates: StorageMediaCandidate[] = [];
  const seen = new Set<string>();

  // Prefer the durable Booster copies persisted with the channel post. These
  // paths survive expired delivery URLs and are valid for old publications too.
  for (const value of [
    post.storagePaths,
    post.publishableStoragePaths,
    post.socialFeedStoragePaths,
    payload.storagePaths,
    payload.publishableStoragePaths,
    payload.socialFeedStoragePaths,
  ]) {
    for (const storagePath of arrayFromUnknown(value)) {
      addStorageCandidate(candidates, seen, storagePath, "booster");
    }
  }

  for (const attachment of collectAttachmentRecords(post.attachments, payload.attachments, post.images, payload.images)) {
    if (isVideoLikeRecord(attachment)) continue;
    const bucket = normalizeStorageBucket(
      attachment.bucket || attachment.bucketName || attachment.bucket_name,
      "booster",
    );
    for (const storagePath of [
      attachment.storagePath,
      attachment.storage_path,
      attachment.renderedStoragePath,
      attachment.rendered_storage_path,
      attachment.originalStoragePath,
      attachment.original_storage_path,
      attachment.path,
    ]) {
      addStorageCandidate(candidates, seen, storagePath, bucket);
    }
  }

  return candidates;
}

function collectVideoRecords(payload: Record<string, unknown>, post: Record<string, unknown>) {
  const byChannel = asRecord(payload.videoByChannel);
  const queue: Array<{ value: unknown; trustedVideo: boolean }> = [
    { value: post.video, trustedVideo: true },
    { value: post.sourceVideo, trustedVideo: true },
    { value: byChannel.inr_search, trustedVideo: true },
    { value: payload.video, trustedVideo: true },
    ...arrayFromUnknown(post.attachments).map((value) => ({ value, trustedVideo: false })),
    ...arrayFromUnknown(payload.attachments).map((value) => ({ value, trustedVideo: false })),
  ];
  const records: Record<string, unknown>[] = [];
  const seen = new Set<Record<string, unknown>>();

  while (queue.length) {
    const entry = queue.shift();
    const record = asRecord(entry?.value);
    if (!Object.keys(record).length || seen.has(record)) continue;
    seen.add(record);

    const accepted = entry?.trustedVideo === true || isVideoLikeRecord(record);
    if (!accepted) continue;
    records.push(record);

    queue.push(
      { value: record.sourceVideo, trustedVideo: true },
      { value: record.source_video, trustedVideo: true },
      { value: record.transformedVariant, trustedVideo: true },
      { value: record.transformed_variant, trustedVideo: true },
      ...arrayFromUnknown(record.transformedVariants).map((value) => ({ value, trustedVideo: true })),
      ...arrayFromUnknown(record.transformed_variants).map((value) => ({ value, trustedVideo: true })),
    );
  }

  return records;
}

function collectVideoStorageCandidates(records: Record<string, unknown>[]) {
  const candidates: StorageMediaCandidate[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    const bucket = normalizeStorageBucket(
      record.bucket || record.bucketName || record.bucket_name,
      "booster",
    );
    for (const storagePath of [record.storagePath, record.storage_path, record.path]) {
      addStorageCandidate(candidates, seen, storagePath, bucket);
    }
  }
  return candidates;
}

function collectThumbnailStorageCandidates(records: Record<string, unknown>[]) {
  const candidates: StorageMediaCandidate[] = [];
  const seen = new Set<string>();
  for (const record of records) {
    const videoBucket = normalizeStorageBucket(
      record.bucket || record.bucketName || record.bucket_name,
      "booster",
    );
    const thumbnailBucket = normalizeStorageBucket(
      record.thumbnailBucket ||
      record.thumbnail_bucket ||
      record.video_thumbnail_bucket,
      videoBucket,
    );
    for (const storagePath of [
      record.thumbnailStoragePath,
      record.thumbnail_storage_path,
      record.video_thumbnail_storage_path,
    ]) {
      addStorageCandidate(candidates, seen, storagePath, thumbnailBucket);
    }
  }
  return candidates;
}

async function resolveStorageMediaUrl(candidates: StorageMediaCandidate[]) {
  for (const candidate of candidates) {
    const signedUrl = await createSafeStorageSignedUrl(
      candidate.bucket,
      candidate.storagePath,
      MEDIA_SIGNED_URL_TTL_SECONDS,
    );
    const normalizedSignedUrl = normalizeExternalUrl(signedUrl);
    if (normalizedSignedUrl) return normalizedSignedUrl;

    // The Booster bucket is intentionally public. Keep a stable public fallback
    // if signing is temporarily unavailable, without trusting an expired URL
    // persisted in the historical event.
    if (candidate.bucket === "booster") {
      const publicUrl = normalizeExternalUrl(
        supabaseAdmin.storage.from(candidate.bucket).getPublicUrl(candidate.storagePath)?.data?.publicUrl,
      );
      if (publicUrl) return publicUrl;
    }
  }
  return null;
}

async function loadRowsInBatches<T>(buildQuery: () => any, pageSize = 1000) {
  const rows: T[] = [];
  for (let offset = 0; offset < 100_000; offset += pageSize) {
    const result = await buildQuery().range(offset, offset + pageSize - 1);
    if (result.error || !Array.isArray(result.data)) return null;
    rows.push(...(result.data as T[]));
    if (result.data.length < pageSize) break;
  }
  return rows;
}

async function publicationImageUrl(payload: Record<string, unknown>, post: Record<string, unknown>) {
  const storageUrl = await resolveStorageMediaUrl(collectImageStorageCandidates(payload, post));
  if (storageUrl) return storageUrl;

  const videoRecords = collectVideoRecords(payload, post);
  const candidates = [
    ...arrayFromUnknown(post.siteCardPublishableUrls),
    ...arrayFromUnknown(post.socialFeedPublishableUrls),
    ...arrayFromUnknown(post.publishableUrls),
    ...arrayFromUnknown(post.images),
    ...arrayFromUnknown(post.attachments).filter((item) => !isVideoLikeRecord(item)),
    ...arrayFromUnknown(payload.siteCardPublishableUrls),
    ...arrayFromUnknown(payload.socialFeedPublishableUrls),
    ...arrayFromUnknown(payload.publishableUrls),
    ...arrayFromUnknown(payload.images),
    ...arrayFromUnknown(payload.attachments).filter((item) => !isVideoLikeRecord(item)),
    ...videoRecords.flatMap((video) => [video.thumbnailUrl, video.thumbnail_url, video.video_thumbnail_url]),
  ].filter(Boolean);
  return firstImageUrl(candidates);
}

async function publicationVideoUrl(payload: Record<string, unknown>, post: Record<string, unknown>) {
  const videoRecords = collectVideoRecords(payload, post);
  const storageUrl = await resolveStorageMediaUrl(collectVideoStorageCandidates(videoRecords));
  if (storageUrl) return storageUrl;

  const candidates = [
    ...videoRecords.flatMap((video) => [
      video.publicUrl,
      video.public_url,
      video.url,
      video.videoUrl,
      video.video_url,
    ]),
    payload.videoUrl,
    payload.video_url,
  ];
  for (const candidate of candidates) {
    const url = normalizeExternalUrl(candidate);
    if (url) return url;
  }
  return null;
}

function publicationVideoMime(payload: Record<string, unknown>, post: Record<string, unknown>) {
  const videoRecords = collectVideoRecords(payload, post);
  for (const video of videoRecords) {
    const mime = clean(
      video.type || video.mime || video.mimeType || video.mime_type || video.contentType || video.content_type,
      120,
    );
    if (mime) return mime;
  }
  return clean(payload.video_mime || "video/mp4", 120) || "video/mp4";
}

async function publicationVideoThumbnailUrl(payload: Record<string, unknown>, post: Record<string, unknown>) {
  const videoRecords = collectVideoRecords(payload, post);
  const storageUrl = await resolveStorageMediaUrl(collectThumbnailStorageCandidates(videoRecords));
  if (storageUrl) return storageUrl;

  return firstImageUrl([
    ...videoRecords.flatMap((video) => [
      video.thumbnailUrl,
      video.thumbnail_url,
      video.video_thumbnail_url,
    ]),
    payload.video_thumbnail_url,
  ]);
}

function hasLivePublicationChannel(payload: Record<string, unknown>) {
  return hasSuccessfulInrSearchChannel(payload);
}

async function normalizeBoosterPublicationEvents(value: unknown): Promise<InrSearchPublication[]> {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const publications: InrSearchPublication[] = [];

  for (const row of value) {
    const record = asRecord(row);
    const payload = asRecord(record.payload);
    if (!hasLivePublicationChannel(payload)) continue;

    const publicationId = clean(payload.publication_id || record.id, 120);
    if (!publicationId || seen.has(publicationId)) continue;

    const byChannel = asRecord(payload.postByChannel);
    const preferredPost = asRecord(byChannel.inr_search || payload.post);
    const fallbackPost = asRecord(payload.post);
    const title = clean(preferredPost.title || fallbackPost.title || payload.idea, 180);
    const content = clean(preferredPost.content || preferredPost.text || fallbackPost.content || fallbackPost.text, 2400);
    if (!title && !content) continue;

    const [imageUrl, videoUrl, videoThumbnailUrl] = await Promise.all([
      publicationImageUrl(payload, preferredPost),
      publicationVideoUrl(payload, preferredPost),
      publicationVideoThumbnailUrl(payload, preferredPost),
    ]);

    seen.add(publicationId);
    publications.push({
      id: publicationId,
      title: title || "Actualité",
      content,
      imageUrl,
      videoUrl,
      videoMime: publicationVideoMime(payload, preferredPost),
      videoThumbnailUrl,
      createdAt: clean(record.created_at, 80) || null,
    });
    if (publications.length >= 10) break;
  }

  return publications;
}

async function normalizeDurableInrSearchPublications(
  value: unknown,
): Promise<InrSearchPublication[]> {
  if (!Array.isArray(value)) return [];
  const publications: InrSearchPublication[] = [];

  for (const row of value) {
    const record = asRecord(row);
    const publicationId = clean(record.id, 120);
    if (!publicationId) continue;

    const metadata = asRecord(record.media_metadata);
    const inrSearchSnapshot = asRecord(metadata.inrSearch);
    const hasInrSearchSnapshot = Object.keys(inrSearchSnapshot).length > 0;
    const snapshotMediaMode = clean(inrSearchSnapshot.mediaMode, 40).toLowerCase();
    const storedPost = asRecord(inrSearchSnapshot.post);
    const metadataVideoByChannel = asRecord(metadata.videoByChannel);
    const storedVideoCandidates = hasInrSearchSnapshot
      ? snapshotMediaMode === "video"
        ? [inrSearchSnapshot.video]
        : []
      : [metadataVideoByChannel.inr_search, metadata.video];
    let storedVideo: Record<string, unknown> = {};
    for (const candidate of storedVideoCandidates) {
      const normalized = asRecord(candidate);
      if (!Object.keys(normalized).length) continue;
      storedVideo = normalized;
      break;
    }

    if (
      !Object.keys(storedVideo).length &&
      (!hasInrSearchSnapshot || snapshotMediaMode === "video") &&
      (record.video_path || record.video_url)
    ) {
      storedVideo = {
        storagePath: record.video_path,
        publicUrl: record.video_url,
        type: record.video_mime,
        thumbnailUrl: record.video_thumbnail_url,
      };
    }

    const snapshotImages = arrayFromUnknown(inrSearchSnapshot.images);
    const snapshotAttachments = arrayFromUnknown(inrSearchSnapshot.attachments);
    const durableImages = hasInrSearchSnapshot
      ? snapshotMediaMode === "images"
        ? snapshotImages
        : []
      : arrayFromUnknown(record.images);
    const durableAttachments = hasInrSearchSnapshot
      && snapshotMediaMode === "images"
      ? snapshotAttachments
      : [];
    const durablePost = {
      ...storedPost,
      images: durableImages,
      attachments: durableAttachments,
      storagePaths:
        snapshotMediaMode === "images" ? inrSearchSnapshot.storagePaths : [],
      publishableStoragePaths:
        snapshotMediaMode === "images"
          ? inrSearchSnapshot.publishableStoragePaths
          : [],
      socialFeedStoragePaths:
        snapshotMediaMode === "images"
          ? inrSearchSnapshot.socialFeedStoragePaths
          : [],
      publishableUrls:
        snapshotMediaMode === "images"
          ? inrSearchSnapshot.publishableUrls
          : [],
      socialFeedPublishableUrls:
        snapshotMediaMode === "images"
          ? inrSearchSnapshot.socialFeedPublishableUrls
          : [],
      siteCardPublishableUrls:
        snapshotMediaMode === "images"
          ? inrSearchSnapshot.siteCardPublishableUrls
          : [],
      video: storedVideo,
      sourceVideo: storedVideo,
    };
    const durablePayload = {
      images: durableImages,
      attachments: durableAttachments,
      video: storedVideo,
      videoByChannel: { inr_search: storedVideo },
      videoUrl:
        !hasInrSearchSnapshot || snapshotMediaMode === "video"
          ? record.video_url
          : null,
      video_mime:
        !hasInrSearchSnapshot || snapshotMediaMode === "video"
          ? record.video_mime
          : null,
      video_thumbnail_url:
        !hasInrSearchSnapshot || snapshotMediaMode === "video"
          ? record.video_thumbnail_url
          : null,
    };
    const title = clean(storedPost.title || record.title || record.idea, 180);
    const content = clean(
      storedPost.content || storedPost.text || record.content,
      2400,
    );
    if (!title && !content) continue;

    const [imageUrl, videoUrl, videoThumbnailUrl] = await Promise.all([
      publicationImageUrl(durablePayload, durablePost),
      publicationVideoUrl(durablePayload, durablePost),
      publicationVideoThumbnailUrl(durablePayload, durablePost),
    ]);

    publications.push({
      id: publicationId,
      title: title || "Actualité",
      content,
      imageUrl,
      videoUrl,
      videoMime:
        clean(record.video_mime, 120) ||
        publicationVideoMime(durablePayload, durablePost),
      videoThumbnailUrl,
      createdAt: clean(record.created_at, 80) || null,
    });
    if (publications.length >= 10) break;
  }

  return publications;
}

async function findPublishedConfigBySlug(slug: string) {
  const normalizedSlug = normalizeInrSearchDirectorySlug(slug);
  if (!normalizedSlug) return null;

  const direct = await supabaseAdmin
    .from("pro_tools_configs")
    .select("user_id,settings")
    .contains("settings", { inrSearch: { slug: normalizedSlug, enabled: true } })
    .limit(1)
    .maybeSingle();

  if (!direct.error && direct.data) return direct.data as { user_id: string; settings: unknown };

  const fallback = await loadRowsInBatches<{ user_id: string; settings: unknown }>(
    () => supabaseAdmin
      .from("pro_tools_configs")
      .select("user_id,settings")
      .order("user_id", { ascending: true }),
  );

  if (!fallback) return null;
  return fallback.find((row) => {
    const config = asRecord(asRecord(row.settings).inrSearch);
    return config.enabled === true && normalizeInrSearchDirectorySlug(config.slug) === normalizedSlug;
  }) ?? null;
}

async function loadMedia(userId: string): Promise<InrSearchMedia[]> {
  const result = await supabaseAdmin
    .from("pro_media_library")
    .select("id,bucket_name,storage_path,title,created_at")
    .eq("user_id", userId)
    .eq("media_type", "image")
    .eq("is_active", true)
    .order("created_at", { ascending: false })
    .limit(8);

  if (result.error || !Array.isArray(result.data)) return [];

  const media = await Promise.all(
    result.data.map(async (row: any): Promise<InrSearchMedia | null> => {
      const bucket = clean(row.bucket_name, 120) || "pro-media";
      const storagePath = clean(row.storage_path, 600);
      if (!storagePath) return null;
      const signedUrl = await createSafeStorageSignedUrl(
        bucket,
        storagePath,
        MEDIA_SIGNED_URL_TTL_SECONDS,
      );
      const url = normalizeExternalUrl(signedUrl);
      if (!url) return null;
      return {
        id: clean(row.id, 120) || storagePath,
        title: clean(row.title, 180) || "Photo de l’entreprise",
        url,
      };
    }),
  );

  return media.filter((item): item is InrSearchMedia => Boolean(item));
}

function buildFaq(input: {
  companyName: string;
  profession: string;
  city: string;
  services: string[];
  zones: string[];
  customerTypes: string[];
  phone: string;
  email: string;
  openingDays: string;
  openingHours: string;
}): InrSearchFaq[] {
  const faq: InrSearchFaq[] = [];
  if (input.profession || input.city) {
    faq.push({
      question: `Quelle est l’activité de ${input.companyName}${input.city ? ` à ${input.city}` : ""} ?`,
      answer: `${input.companyName}${input.profession ? ` exerce l’activité de ${input.profession.toLocaleLowerCase("fr-FR")}` : " est une entreprise"}${input.city ? ` à ${input.city}` : ""}. Retrouvez sur cette page ses services, sa zone d’intervention et ses coordonnées.`,
    });
  }
  if (input.services.length) {
    faq.push({
      question: `Quels services propose ${input.companyName} ?`,
      answer: `${input.companyName} propose notamment ${input.services.join(", ")}. Le détail du besoin peut être précisé directement auprès de l’entreprise.`,
    });
  }
  if (input.customerTypes.length) {
    faq.push({
      question: `À quels clients s’adresse ${input.companyName} ?`,
      answer: `${input.companyName} s’adresse notamment aux ${input.customerTypes.map((value) => value.toLocaleLowerCase("fr-FR")).join(", ")}.`,
    });
  }
  if (input.zones.length) {
    faq.push({
      question: `Dans quelles zones intervient ${input.companyName} ?`,
      answer: `${input.companyName} intervient notamment dans les zones suivantes : ${input.zones.join(", ")}. La disponibilité exacte dépend du besoin et peut être confirmée directement avec l’entreprise.`,
    });
  }
  if (input.openingDays || input.openingHours) {
    faq.push({
      question: `Quels sont les horaires de ${input.companyName} ?`,
      answer: `${input.companyName} est indiqué comme joignable ${[input.openingDays, input.openingHours].filter(Boolean).join(", ")}.`,
    });
  }
  if (input.phone || input.email) {
    const contactParts = [input.phone ? `par téléphone au ${input.phone}` : "", input.email ? `par email à ${input.email}` : ""].filter(Boolean);
    faq.push({
      question: `Comment contacter ${input.companyName} ?`,
      answer: `Vous pouvez contacter ${input.companyName} ${contactParts.join(" ou ")}. Le formulaire présent sur cette page permet également de transmettre une demande.`,
    });
  }
  return faq.slice(0, 6);
}

async function loadInrSearchPublicPageUncached(slug: string): Promise<InrSearchPublicPageData | null> {
  // Aperçu visuel local, volontairement inaccessible en production.
  // Il permet de contrôler toutes les scènes sans dépendre d’un compte Supabase.
  if (process.env.NODE_ENV !== "production" && normalizeInrSearchDirectorySlug(slug) === "demo-gravity-engine") {
    return {
      userId: "preview-only",
      slug: "demo-gravity-engine",
      pageTitle: "iNrCy — démonstration iNr’Search",
      pageDescription: "Une démonstration locale de la nouvelle expérience iNr’Search.",
      enabled: true,
      sections: { ...DEFAULT_SECTIONS },
      updatedAt: "2026-07-11T12:00:00.000Z",
      // Fixture volontairement longue : elle protège les scènes contre les
      // débordements rencontrés sur de vraies fiches professionnelles.
      companyName: "Écurie et élevage des frênes",
      contactName: "Équipe des frênes",
      logoUrl: "/logo-inrcy.png",
      phone: "06 22 08 21 79",
      email: "j.wright@inrcy.com",
      address: "1 rue de Fouquières",
      zip: "62440",
      city: "Haut-Lieu",
      country: "France",
      addressLine: "1 rue de Fouquières, 62440 Harnes, France",
      description: "Écurie et centre équestre à taille humaine, avec un accompagnement attentif pour les cavaliers et les chevaux.",
      sectorCategory: "equitation",
      sectorLabel: "Équitation",
      profession: "Écurie / Centre équestre",
      services: [
        "Pension cheval",
        "Balades",
        "Demi-pension",
        "Travail du cheval",
        "Cours",
        "Stage",
        "Sorties concours",
        "Visite découverte",
        "Élevage de chevaux de sport",
        "Vente de chevaux",
      ],
      serviceDescriptions: {},
      zones: ["Aulnoye-Aymeries", "La Capelle", "Trélon", "Maubeuge", "Fourmies", "Le Quesnoy", "Valenciennes", "Nord", "Aisne", "Pas-de-Calais"],
      strengths: ["Environnement naturel", "Accompagnement", "Écurie familiale", "À l’écoute", "Sérieux"],
      customerTypes: ["particuliers"],
      openingDays: "",
      openingHours: "Lundi–vendredi : 8h00–18h00",
      websiteUrl: "https://inrcy.com",
      googleBusinessUrl: "https://www.google.com/maps",
      socialLinks: [
        { key: "website", label: "Site internet", url: "https://inrcy.com" },
        { key: "google", label: "Google Business", url: "https://www.google.com" },
        { key: "facebook", label: "Facebook", url: "https://www.facebook.com" },
        { key: "instagram", label: "Instagram", url: "https://www.instagram.com" },
        { key: "linkedin", label: "LinkedIn", url: "https://www.linkedin.com" },
        { key: "tiktok", label: "TikTok", url: "https://www.tiktok.com" },
        { key: "youtube", label: "YouTube", url: "https://www.youtube.com" },
      ],
      publications: [
        { id: "preview-news-1", title: "iNr’Search donne une nouvelle gravité à votre présence en ligne", content: "Votre profil, vos expertises, vos réalisations et vos actualités se rejoignent désormais dans un parcours spectaculaire, lisible et conçu pour convertir.", imageUrl: "/icons/inr-search-logo.png", videoUrl: null, videoMime: "video/mp4", videoThumbnailUrl: null, createdAt: "2026-07-11T09:00:00.000Z" },
        { id: "preview-news-2", title: "Publiez une fois, rayonnez partout", content: "Les contenus envoyés depuis Booster Publier alimentent automatiquement la chronologie iNr’Search et montrent une entreprise réellement active.", imageUrl: "/icons/inr-search-bubble.png", videoUrl: null, videoMime: "video/mp4", videoThumbnailUrl: null, createdAt: "2026-07-09T09:00:00.000Z" },
        { id: "preview-news-3", title: "iNrBadge devient votre passeport de confiance", content: "Un QR code immédiatement accessible rassemble les informations essentielles et facilite le passage de la découverte au contact.", imageUrl: "/icons/inrbadge-dashboard.png", videoUrl: null, videoMime: "video/mp4", videoThumbnailUrl: null, createdAt: "2026-07-06T09:00:00.000Z" },
        { id: "preview-news-4", title: "Vos expertises deviennent immédiatement lisibles", content: "Chaque publication enrichit un profil professionnel clair et directement accessible.", imageUrl: "/logo-appli-inrcy.png", videoUrl: null, videoMime: "video/mp4", videoThumbnailUrl: null, createdAt: "2026-07-04T09:00:00.000Z" },
        { id: "preview-news-5", title: "Une actualité pensée pour tous les écrans", content: "Les textes et les médias restent accessibles sur ordinateur, tablette et mobile.", imageUrl: "/icons/inr-search-logo.png", videoUrl: null, videoMime: "video/mp4", videoThumbnailUrl: null, createdAt: "2026-07-02T09:00:00.000Z" },
        { id: "preview-news-6", title: "Booster alimente automatiquement votre profil", content: "Le canal iNrSearch reçoit le texte et le média sélectionnés dès que la publication aboutit.", imageUrl: "/icons/inr-search-bubble.png", videoUrl: null, videoMime: "video/mp4", videoThumbnailUrl: null, createdAt: "2026-06-30T09:00:00.000Z" },
        { id: "preview-news-7", title: "Votre activité reste vivante dans le temps", content: "Les dix actualités les plus récentes forment une chronologie simple à parcourir.", imageUrl: "/icons/inrbadge-dashboard.png", videoUrl: null, videoMime: "video/mp4", videoThumbnailUrl: null, createdAt: "2026-06-28T09:00:00.000Z" },
        { id: "preview-news-8", title: "Chaque média conserve son cadrage", content: "Les formats carrés, verticaux et horizontaux sont affichés sans découpe.", imageUrl: "/logo-appli-inrcy.png", videoUrl: null, videoMime: "video/mp4", videoThumbnailUrl: null, createdAt: "2026-06-26T09:00:00.000Z" },
        { id: "preview-news-9", title: "Une navigation directe et accessible", content: "Les numéros permettent d’ouvrir immédiatement l’actualité souhaitée.", imageUrl: "/icons/inr-search-logo.png", videoUrl: null, videoMime: "video/mp4", videoThumbnailUrl: null, createdAt: "2026-06-24T09:00:00.000Z" },
        { id: "preview-news-10", title: "Votre dernière publication toujours en avant", content: "La chronologie se réorganise automatiquement pour présenter les nouveautés en premier.", imageUrl: "/icons/inr-search-bubble.png", videoUrl: null, videoMime: "video/mp4", videoThumbnailUrl: null, createdAt: "2026-06-22T09:00:00.000Z" },
      ],
      media: [
        { id: "preview-media-1", title: "L’univers iNr’Search", url: "/icons/inr-search-logo.png" },
        { id: "preview-media-2", title: "Le moteur de visibilité", url: "/icons/inr-search-bubble.png" },
        { id: "preview-media-3", title: "Le passeport iNrBadge", url: "/icons/inrbadge-dashboard.png" },
        { id: "preview-media-4", title: "L’écosystème iNrCy", url: "/logo-appli-inrcy.png" },
      ],
      faq: [
        { question: "Qu’est-ce qu’iNr’Search ?", answer: "iNr’Search est une page professionnelle dynamique qui rassemble les informations utiles d’une entreprise dans un parcours horizontal original, lisible par les internautes comme par les moteurs." },
        { question: "Les actualités sont-elles mises à jour automatiquement ?", answer: "Oui. Les publications diffusées vers iNr’Search depuis Booster Publier rejoignent automatiquement la scène Actualités." },
        { question: "Comment présenter mon besoin ?", answer: "La scène Contact permet d’appeler, d’écrire, de localiser l’entreprise, de visiter son site ou d’ouvrir un formulaire de demande." },
        { question: "Puis-je consulter les réalisations en grand ?", answer: "Oui. Chaque réalisation peut être ouverte dans un observatoire plein écran, avec navigation au clavier et restauration du focus." },
        { question: "La page fonctionne-t-elle sur mobile ?", answer: "Oui. Chaque scène se simplifie sans perdre ses informations, tandis que le swipe, les contrôles tactiles et le clavier restent disponibles." },
        { question: "Où intervient iNrCy ?", answer: "iNrCy intervient notamment à Harnes, Arras, Béthune, Lens, Liévin, Douai et Carvin, sous réserve de confirmer le besoin." },
      ],
      inrBadgeUrl: "https://app.inrcy.com/inrbadge/preview-only",
      inrBadgeQrUrl: "https://app.inrcy.com/inrbadge/preview-only?src=inrsearch",
    };
  }

  const configRow = await findPublishedConfigBySlug(slug);
  if (!configRow?.user_id) return null;

  const userId = configRow.user_id;
  const eligibility = await getInrSearchPublicationEligibility(userId);
  if (!eligibility.allowed) return null;
  const rootSettings = asRecord(configRow.settings);
  const config = asRecord(rootSettings.inrSearch);
  const normalizedSlug = normalizeInrSearchDirectorySlug(config.slug);
  if (!normalizedSlug || config.enabled !== true) return null;

  const profileOwnerIds = Array.from(new Set([userId, eligibility.authUserId].filter(Boolean)));
  const [
    profileRes,
    businessRes,
    siteRes,
    integrationsRes,
    boosterEventsRes,
    inrSearchDeliveriesRes,
    media,
  ] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("*")
      .in("user_id", profileOwnerIds)
      .limit(2),
    supabaseAdmin
      .from("business_profiles")
      .select("*")
      .eq("user_id", userId)
      .order("updated_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
    supabaseAdmin
      .from("inrcy_site_configs")
      .select("site_url,settings")
      .eq("user_id", userId)
      .maybeSingle(),
    supabaseAdmin
      .from("integrations")
      .select("provider,source,product,category,account_email,settings,status,resource_id,resource_label,display_name,email_address,expires_at,access_token_enc,refresh_token_enc,meta,updated_at,created_at")
      .eq("user_id", userId),
    supabaseAdmin
      .from("app_events")
      .select("id,payload,created_at")
      .eq("user_id", userId)
      .eq("module", "booster")
      .eq("type", "publish")
      .order("created_at", { ascending: false })
      .limit(120),
    supabaseAdmin
      .from("publication_deliveries")
      .select("publication_id,status,created_at")
      .eq("user_id", userId)
      .eq("channel", "inr_search")
      .in("status", ["delivered", "published", "completed"])
      .order("created_at", { ascending: false })
      .limit(120),
    loadMedia(userId),
  ]);

  const profileRows = Array.isArray(profileRes.data)
    ? profileRes.data.map((row) => asRecord(row))
    : [];
  const accountProfile = profileRows.find(
    (row) => clean(row.user_id, 120) === userId,
  ) || null;
  const ownerProfile = profileRows.find(
    (row) => clean(row.user_id, 120) === eligibility.authUserId,
  ) || null;
  const selectedProfile = accountProfile || ownerProfile;
  if (profileRes.error || !selectedProfile) return null;

  const profile = selectedProfile;
  const business = asRecord(businessRes.data);
  const siteConfig = asRecord(siteRes.data);
  const deliveredPublicationIds = Array.from(
    new Set(
      (Array.isArray(inrSearchDeliveriesRes.data)
        ? inrSearchDeliveriesRes.data
        : [])
        .map((row) => clean(asRecord(row).publication_id, 120))
        .filter(Boolean),
    ),
  );
  const durablePublicationsRes = deliveredPublicationIds.length
    ? await supabaseAdmin
        .from("publications")
        .select("id,title,content,idea,images,created_at,media_type,video_url,video_path,video_mime,video_thumbnail_url,media_metadata")
        .eq("user_id", userId)
        .in("id", deliveredPublicationIds)
        .order("created_at", { ascending: false })
    : { data: [], error: null };

  // The active professional account remains the source of business identity,
  // but its logo may still live on the authenticated owner profile after a
  // multicompte migration. Resolve the first real object instead of silently
  // falling back to initials when the preferred row has no usable logo.
  const logoCandidates = Array.from(
    new Set([accountProfile, ownerProfile, ...profileRows].filter(Boolean)),
  ) as Array<Record<string, unknown>>;
  let logo = { logoPath: "", logoUrl: "" };
  for (const candidate of logoCandidates) {
    const resolvedLogo = await resolveProfileLogoUrl(supabaseAdmin, {
      logo_path: clean(candidate.logo_path, 600) || null,
      logo_url: clean(candidate.logo_url, 1000) || null,
    });
    if (!resolvedLogo.logoPath && !resolvedLogo.logoUrl) continue;

    if (resolvedLogo.logoPath) {
      const objectState = await probeStorageObject(
        LOGO_BUCKET,
        resolvedLogo.logoPath,
      );
      if (objectState === "missing") continue;
    }

    logo = resolvedLogo;
    break;
  }

  const channelStates = await getChannelConnectionStates(supabaseAdmin, userId, {
    profile,
    inrcySiteConfig: siteRes.data,
    proToolsConfig: configRow,
    integrations: Array.isArray(integrationsRes.data) ? integrationsRes.data : [],
  });

  const companyName = clean(profile.company_legal_name, 180) || clean(config.pageTitle, 180) || "Entreprise";
  const contactName = [clean(profile.first_name, 80), clean(profile.last_name, 80)].filter(Boolean).join(" ");
  const phone = clean(profile.phone, 80);
  const email = clean(profile.contact_email, 180);
  const address = clean(profile.hq_address, 240);
  const zip = clean(profile.hq_zip, 30);
  const city = clean(profile.hq_city, 120);
  const country = clean(profile.hq_country, 120) || "France";
  const addressLine = [address, [zip, city].filter(Boolean).join(" "), country].filter(Boolean).join(", ");
  const inrBadgeUrl = createInrBadgePublicUrl({
    userId,
    logoUrl: normalizeExternalUrl(logo.logoUrl),
    companyLegalName: companyName,
    firstName: clean(profile.first_name, 80),
    lastName: clean(profile.last_name, 80),
    phone,
    contactEmail: email,
  });
  const inrBadgeQrUrl = createInrBadgeQrTrackingUrl(inrBadgeUrl);

  const decodedSector = decodeBusinessSector(clean(business.sector, 300));
  const sectorLabel = getActivitySectorLabel(decodedSector.sectorCategory);
  const profession = clean(decodedSector.profession, 180);
  const services = listFromUnknown(Array.isArray(business.services) ? business.services : business.services_text);
  const serviceDescriptions = normalizeServiceDescriptionMap(
    config.serviceDescriptions,
    config.service_descriptions,
    business.service_descriptions,
    business.services_descriptions,
    business.service_details,
    business.services_details,
  );
  const zones = listFromUnknown(Array.isArray(business.intervention_zones) ? business.intervention_zones : business.intervention_zones_text);
  const strengths = listFromUnknown(Array.isArray(business.strengths) ? business.strengths : business.strengths_text);
  const customerTypes = listFromUnknown(business.customer_typologies);
  const openingDays = "";
  const openingHours = combineOpeningSchedule(
    business.opening_days,
    business.opening_hours,
  );
  const description = clean(config.pageDescription, 500)
    || clean(business.business_description || business.activity_description, 3000)
    || `${companyName}${profession ? `, ${profession.toLowerCase()}` : ""}${city ? ` à ${city}` : ""}.`;

  const websiteUrl = normalizeExternalUrl(
    channelStates.site_inrcy.url
      || channelStates.site_web.url
      || siteConfig.site_url,
  );
  const googleBusinessUrl = normalizeExternalUrl(channelStates.gmb.url);

  const socialLinks: InrSearchSocialLink[] = [
    { key: "website", label: "Site internet", url: websiteUrl },
    { key: "google", label: "Google Business", url: googleBusinessUrl },
    { key: "facebook", label: "Facebook", url: normalizeExternalUrl(channelStates.facebook.page_url) },
    { key: "instagram", label: "Instagram", url: normalizeExternalUrl(channelStates.instagram.profile_url) },
    { key: "linkedin", label: "LinkedIn", url: normalizeExternalUrl(channelStates.linkedin.organization_url || channelStates.linkedin.profile_url) },
    { key: "tiktok", label: "TikTok", url: normalizeExternalUrl(channelStates.tiktok.profile_url) },
    { key: "youtube", label: "YouTube", url: normalizeExternalUrl(channelStates.youtube_shorts.channel_url) },
    { key: "pinterest", label: "Pinterest", url: normalizeExternalUrl(channelStates.pinterest.profile_url) },
  ].filter((item) => Boolean(item.url));

  const faq = buildFaq({ companyName, profession, city, services, zones, customerTypes, phone, email, openingDays, openingHours });
  const [eventPublications, durablePublications] = await Promise.all([
    normalizeBoosterPublicationEvents(boosterEventsRes.data),
    normalizeDurableInrSearchPublications(durablePublicationsRes.data),
  ]);
  const publications = mergeInrSearchPublicationFeeds(
    eventPublications,
    durablePublications,
    10,
  );
  const updatedAt = latestIsoDate([
    config.updatedAt,
    profile.updated_at,
    business.updated_at,
    publications[0]?.createdAt,
  ]);

  return {
    userId,
    slug: normalizedSlug,
    pageTitle: clean(config.pageTitle, 180) || companyName,
    pageDescription: clean(config.pageDescription, 500) || description,
    enabled: true,
    sections: normalizeSections(config.sections),
    updatedAt,
    companyName,
    contactName,
    logoUrl: normalizeExternalUrl(logo.logoUrl),
    phone,
    email,
    address,
    zip,
    city,
    country,
    addressLine,
    description,
    sectorCategory: decodedSector.sectorCategory,
    sectorLabel,
    profession,
    services,
    serviceDescriptions,
    zones,
    strengths,
    customerTypes,
    openingDays,
    openingHours,
    websiteUrl,
    googleBusinessUrl,
    socialLinks,
    publications,
    media,
    faq,
    inrBadgeUrl,
    inrBadgeQrUrl,
  };
}

export function getInrSearchPublicPageCacheTag(slugValue: unknown) {
  const slug = normalizeInrSearchDirectorySlug(slugValue);
  return `inr-search-page:${slug || "unknown"}`;
}

const loadInrSearchPublicPageRequestCached = cache(loadInrSearchPublicPageUncached);

const loadInrSearchPublicPageCached = cache(async (slugValue: string) => {
  const slug = normalizeInrSearchDirectorySlug(slugValue);
  if (!slug) return null;
  const readCachedPage = unstable_cache(
    () => loadInrSearchPublicPageRequestCached(slug),
    ["inr-search-public-page-v3", slug],
    { revalidate: 300, tags: [getInrSearchPublicPageCacheTag(slug)] },
  );
  return readCachedPage();
});

export const loadInrSearchPublicPage = loadInrSearchPublicPageCached;

export async function getInrSearchPublicStatus(slugValue: unknown): Promise<InrSearchPublicStatus> {
  const slug = normalizeInrSearchDirectorySlug(slugValue);
  const base = { slug, accountId: null as string | null, publicUrl: slug ? buildInrSearchPublicUrl(slug) : "" };
  if (!slug) return { ...base, published: false, reason: "slug_missing" };

  const configRow = await findPublishedConfigBySlug(slug);
  if (!configRow?.user_id) return { ...base, published: false, reason: "config_missing" };

  const accountId = clean(configRow.user_id, 120);
  const config = asRecord(asRecord(configRow.settings).inrSearch);
  if (config.enabled !== true) return { ...base, accountId, published: false, reason: "page_disabled" };

  const eligibility = await getInrSearchPublicationEligibility(accountId);
  if (!eligibility.allowed) {
    return {
      ...base,
      accountId,
      published: false,
      reason: eligibility.reason === "subscription_inactive" ? "subscription_inactive" : "bubble_disabled",
    };
  }

  const profileOwnerIds = Array.from(new Set([accountId, eligibility.authUserId].filter(Boolean)));
  const profile = await supabaseAdmin.from("profiles").select("user_id").in("user_id", profileOwnerIds).limit(1);
  if (profile.error || !Array.isArray(profile.data) || !profile.data.length) {
    return { ...base, accountId, published: false, reason: "profile_missing" };
  }

  const page = await loadInrSearchPublicPageUncached(slug);
  if (!page) return { ...base, accountId, published: false, reason: "data_unavailable" };
  return { ...base, accountId, published: true, reason: "published" };
}


async function listPublishedInrSearchCompaniesUncached(): Promise<PublishedInrSearchCompany[]> {
  const configRows = await loadRowsInBatches<{ user_id: string; settings: unknown }>(
    () => supabaseAdmin
      .from("pro_tools_configs")
      .select("user_id,settings")
      .order("user_id", { ascending: true }),
  );

  if (!configRows) return [];

  const configs = configRows
    .map((row) => {
      const config = asRecord(asRecord(row.settings).inrSearch);
      const slug = normalizeInrSearchDirectorySlug(config.slug);
      const directoryEnabled = typeof config.directoryEnabled === "boolean"
        ? config.directoryEnabled
        : config.enabled === true;
      if (config.enabled !== true || !directoryEnabled || !slug) return null;
      return { userId: row.user_id, slug, config };
    })
    .filter((item): item is { userId: string; slug: string; config: Record<string, unknown> } => Boolean(item));

  if (!configs.length) return [];

  const eligibleUserIds = await filterEligibleInrSearchAccountIds(configs.map((item) => item.userId));
  const eligibleConfigs = configs.filter((item) => eligibleUserIds.has(item.userId));
  if (!eligibleConfigs.length) return [];

  const userIds = eligibleConfigs.map((item) => item.userId);
  const [profilesRes, businessRes] = await Promise.all([
    supabaseAdmin
      .from("profiles")
      .select("*")
      .in("user_id", userIds),
    supabaseAdmin
      .from("business_profiles")
      .select("*")
      .in("user_id", userIds),
  ]);

  const profiles = new Map<string, Record<string, unknown>>();
  for (const row of Array.isArray(profilesRes.data) ? profilesRes.data : []) profiles.set(clean((row as any).user_id, 120), asRecord(row));
  const businesses = new Map<string, Record<string, unknown>>();
  for (const row of Array.isArray(businessRes.data) ? businessRes.data : []) businesses.set(clean((row as any).user_id, 120), asRecord(row));

  return eligibleConfigs
    .map((item) => {
      const profile = profiles.get(item.userId) || {};
      const business = businesses.get(item.userId) || {};
      const decodedSector = decodeBusinessSector(clean(business.sector, 300));
      const companyName = clean(profile.company_legal_name, 180) || clean(item.config.pageTitle, 180) || "Entreprise";
      const pageDescription = clean(item.config.pageDescription, 300)
        || clean(business.business_description || business.activity_description, 300)
        || `${companyName}${clean(profile.hq_city, 120) ? ` à ${clean(profile.hq_city, 120)}` : ""}.`;
      const city = clean(profile.hq_city, 120);
      const geography = resolveFrenchGeography(profile.hq_zip, city);
      const department = clean(
        profile.hq_department
          || profile.department
          || profile.address_department,
        120,
      ) || geography?.department || "";
      const region = clean(
        profile.hq_region
          || profile.region
          || profile.address_region,
        160,
      ) || geography?.region || "";
      const profession = clean(decodedSector.profession, 180);
      const sectorLabel = getActivitySectorLabel(decodedSector.sectorCategory);
      return {
        slug: item.slug,
        companyName,
        pageTitle: clean(item.config.pageTitle, 180) || companyName,
        pageDescription,
        city,
        citySlug: normalizeInrSearchDirectorySlug(city),
        department,
        departmentSlug: normalizeInrSearchDirectorySlug(department),
        region,
        regionSlug: normalizeInrSearchDirectorySlug(region),
        profession,
        professionSlug: normalizeInrSearchDirectorySlug(profession),
        sectorCategory: decodedSector.sectorCategory,
        sectorLabel,
        sectorSlug: normalizeInrSearchDirectorySlug(sectorLabel),
        updatedAt: latestIsoDate([
          item.config.updatedAt,
          profile.updated_at,
          business.updated_at,
        ]),
      };
    })
    .sort((a, b) => a.companyName.localeCompare(b.companyName, "fr"));
}


export const listPublishedInrSearchCompanies = cache(listPublishedInrSearchCompaniesUncached);

function aggregateDirectoryEntries(
  companies: PublishedInrSearchCompany[],
  pick: (company: PublishedInrSearchCompany) => { slug: string; label: string },
): InrSearchDirectoryEntry[] {
  const entries = new Map<string, InrSearchDirectoryEntry>();
  for (const company of companies) {
    const item = pick(company);
    if (!item.slug || !item.label) continue;
    const current = entries.get(item.slug);
    entries.set(item.slug, { slug: item.slug, label: item.label, count: (current?.count || 0) + 1 });
  }
  return Array.from(entries.values()).sort((a, b) => a.label.localeCompare(b.label, "fr"));
}

export async function listInrSearchProfessions(): Promise<InrSearchDirectoryEntry[]> {
  return aggregateDirectoryEntries(await listPublishedInrSearchCompanies(), (company) => ({
    slug: company.professionSlug,
    label: company.profession,
  }));
}

export async function listInrSearchSectors(): Promise<InrSearchDirectoryEntry[]> {
  return aggregateDirectoryEntries(await listPublishedInrSearchCompanies(), (company) => ({
    slug: company.sectorSlug,
    label: company.sectorLabel,
  }));
}

export async function listInrSearchCitiesForProfession(professionSlug: string): Promise<InrSearchDirectoryEntry[]> {
  const normalized = normalizeInrSearchDirectorySlug(professionSlug);
  const companies = (await listPublishedInrSearchCompanies()).filter((company) => company.professionSlug === normalized);
  return aggregateDirectoryEntries(companies, (company) => ({ slug: company.citySlug, label: company.city }));
}

export async function listInrSearchCompaniesByProfession(professionSlug: string, citySlug?: string): Promise<PublishedInrSearchCompany[]> {
  const profession = normalizeInrSearchDirectorySlug(professionSlug);
  const city = normalizeInrSearchDirectorySlug(citySlug || "");
  return (await listPublishedInrSearchCompanies()).filter((company) =>
    company.professionSlug === profession && (!city || company.citySlug === city),
  );
}

export async function listInrSearchCompaniesBySector(sectorSlug: string): Promise<PublishedInrSearchCompany[]> {
  const sector = normalizeInrSearchDirectorySlug(sectorSlug);
  return (await listPublishedInrSearchCompanies()).filter((company) => company.sectorSlug === sector);
}
