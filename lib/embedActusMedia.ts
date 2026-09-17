import "server-only";

import { createHmac, timingSafeEqual } from "crypto";

const ALLOWED_EMBED_MEDIA_BUCKETS = new Set(["booster", "inrcy-pro-media"]);
const EMBED_MEDIA_TOKEN_VERSION = "v1";

export type EmbedActusStorageReference = {
  bucket: string;
  storagePath: string;
};

function signingSecret() {
  return String(
    process.env.INRCY_WIDGETS_SIGNING_SECRET ||
      process.env.STORAGE_CONTENT_SECRET ||
      process.env.SUPABASE_SERVICE_ROLE_KEY ||
      "",
  ).trim();
}

function normalizeBucket(value: unknown) {
  const bucket = String(value || "").trim();
  return ALLOWED_EMBED_MEDIA_BUCKETS.has(bucket) ? bucket : "";
}

function normalizeStoragePath(value: unknown) {
  const storagePath = String(value || "")
    .trim()
    .replace(/^\/+/, "");
  if (
    !storagePath ||
    storagePath.length > 1000 ||
    storagePath.includes("..") ||
    storagePath.includes("\\")
  ) {
    return "";
  }
  return storagePath;
}

function tokenPayload(bucket: string, storagePath: string) {
  return `inrcy-embed-actus-media:${EMBED_MEDIA_TOKEN_VERSION}:${bucket}:${storagePath}`;
}

function signReference(bucket: string, storagePath: string) {
  const secret = signingSecret();
  if (!secret) return "";
  return createHmac("sha256", secret)
    .update(tokenPayload(bucket, storagePath))
    .digest("base64url");
}

export function normalizeEmbedActusStorageReference(
  bucketValue: unknown,
  pathValue: unknown,
): EmbedActusStorageReference | null {
  const bucket = normalizeBucket(bucketValue);
  let storagePath = normalizeStoragePath(pathValue);
  if (!bucket || !storagePath) return null;

  const bucketPrefix = `${bucket}/`;
  if (storagePath.startsWith(bucketPrefix)) {
    storagePath = normalizeStoragePath(storagePath.slice(bucketPrefix.length));
  }
  if (!storagePath) return null;

  return { bucket, storagePath };
}

export function extractEmbedActusStorageReference(
  input: unknown,
): EmbedActusStorageReference | null {
  const raw = String(input || "").trim();
  if (!raw) return null;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }

  const configuredSupabaseUrl = String(
    process.env.NEXT_PUBLIC_SUPABASE_URL || "",
  ).trim();
  if (configuredSupabaseUrl) {
    try {
      const expected = new URL(configuredSupabaseUrl);
      if (url.origin !== expected.origin) return null;
    } catch {
      return null;
    }
  }

  let pathname = url.pathname;
  try {
    pathname = decodeURIComponent(pathname);
  } catch {
    // Keep the encoded path if decoding fails.
  }

  const match = pathname.match(
    /\/storage\/v1\/(?:object|render\/image)\/(?:public|sign|authenticated)\/([^/]+)\/(.+)$/,
  );
  if (!match?.[1] || !match[2]) return null;

  return normalizeEmbedActusStorageReference(match[1], match[2]);
}

export function buildEmbedActusMediaUrl(
  bucketValue: unknown,
  pathValue: unknown,
) {
  const reference = normalizeEmbedActusStorageReference(
    bucketValue,
    pathValue,
  );
  if (!reference) return "";

  const token = signReference(reference.bucket, reference.storagePath);
  if (!token) return "";

  const params = new URLSearchParams({
    bucket: reference.bucket,
    path: reference.storagePath,
    token,
  });
  return `/embed/actus/media?${params.toString()}`;
}

export function buildStableEmbedActusMediaUrl(params: {
  sourceUrl?: unknown;
  bucket?: unknown;
  storagePath?: unknown;
}) {
  const explicitReference = normalizeEmbedActusStorageReference(
    params.bucket,
    params.storagePath,
  );
  const reference =
    explicitReference || extractEmbedActusStorageReference(params.sourceUrl);
  if (!reference) return "";
  return buildEmbedActusMediaUrl(reference.bucket, reference.storagePath);
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function parseRecord(value: unknown): Record<string, unknown> {
  if (typeof value !== "string") return asRecord(value);
  try {
    return asRecord(JSON.parse(value));
  } catch {
    return {};
  }
}

function parseImageUrls(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.map((item) => String(item || "").trim()).filter(Boolean);
  }
  if (typeof value !== "string") return [];

  const raw = value.trim();
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      return parsed.map((item) => String(item || "").trim()).filter(Boolean);
    }
  } catch {
    // Legacy PostgreSQL array strings are handled below.
  }
  if (raw.startsWith("{") && raw.endsWith("}")) {
    return raw
      .slice(1, -1)
      .split(",")
      .map((item) => item.replace(/^\"+|\"+$/g, "").trim())
      .filter(Boolean);
  }
  return [raw];
}

function stableOrOriginal(params: {
  sourceUrl?: unknown;
  bucket?: unknown;
  storagePath?: unknown;
}) {
  const raw = String(params.sourceUrl || "").trim();
  return buildStableEmbedActusMediaUrl(params) || raw;
}

/**
 * Replaces expiring Supabase signed URLs returned by the legacy JSON widget
 * with stable, application-signed media routes. External URLs are preserved.
 */
export function stabilizeEmbedActusArticleMedia(
  articleValue: Record<string, unknown>,
) {
  const article = { ...articleValue };
  const metadata = parseRecord(article.media_metadata);
  const videoMetadata = asRecord(metadata.video);

  article.images = parseImageUrls(article.images).map((sourceUrl) =>
    stableOrOriginal({ sourceUrl }),
  );

  const videoSourceUrl = String(
    article.video_url ||
      videoMetadata.publicUrl ||
      videoMetadata.public_url ||
      videoMetadata.url ||
      "",
  ).trim();
  const videoReference = extractEmbedActusStorageReference(videoSourceUrl);
  const videoBucket = String(
    videoMetadata.bucket ||
      videoMetadata.bucketName ||
      videoMetadata.bucket_name ||
      videoReference?.bucket ||
      "booster",
  ).trim();
  const videoStoragePath = String(
    article.video_path ||
      videoMetadata.storagePath ||
      videoMetadata.storage_path ||
      videoMetadata.path ||
      videoReference?.storagePath ||
      "",
  ).trim();
  const stableVideoUrl = stableOrOriginal({
    sourceUrl: videoSourceUrl,
    bucket: videoBucket,
    storagePath: videoStoragePath,
  });
  if (videoSourceUrl || videoStoragePath) article.video_url = stableVideoUrl;

  const thumbnailSourceUrl = String(
    article.video_thumbnail_url ||
      videoMetadata.thumbnailUrl ||
      videoMetadata.thumbnail_url ||
      "",
  ).trim();
  const thumbnailReference = extractEmbedActusStorageReference(
    thumbnailSourceUrl,
  );
  const thumbnailBucket = String(
    videoMetadata.thumbnailBucket ||
      videoMetadata.thumbnail_bucket ||
      videoMetadata.video_thumbnail_bucket ||
      thumbnailReference?.bucket ||
      videoBucket,
  ).trim();
  const thumbnailStoragePath = String(
    videoMetadata.thumbnailStoragePath ||
      videoMetadata.thumbnail_storage_path ||
      videoMetadata.video_thumbnail_storage_path ||
      thumbnailReference?.storagePath ||
      "",
  ).trim();
  const stableThumbnailUrl = stableOrOriginal({
    sourceUrl: thumbnailSourceUrl,
    bucket: thumbnailBucket,
    storagePath: thumbnailStoragePath,
  });
  if (thumbnailSourceUrl || thumbnailStoragePath) {
    article.video_thumbnail_url = stableThumbnailUrl;
  }

  if (Object.keys(videoMetadata).length > 0) {
    const stableVideoMetadata = { ...videoMetadata };
    if (stableVideoUrl) {
      if ("publicUrl" in stableVideoMetadata) stableVideoMetadata.publicUrl = stableVideoUrl;
      if ("public_url" in stableVideoMetadata) stableVideoMetadata.public_url = stableVideoUrl;
      if ("url" in stableVideoMetadata) stableVideoMetadata.url = stableVideoUrl;
    }
    if (stableThumbnailUrl) {
      if ("thumbnailUrl" in stableVideoMetadata) {
        stableVideoMetadata.thumbnailUrl = stableThumbnailUrl;
      }
      if ("thumbnail_url" in stableVideoMetadata) {
        stableVideoMetadata.thumbnail_url = stableThumbnailUrl;
      }
    }
    article.media_metadata = { ...metadata, video: stableVideoMetadata };
  }

  return article;
}

export function verifyEmbedActusMediaToken(
  bucketValue: unknown,
  pathValue: unknown,
  tokenValue: unknown,
) {
  const reference = normalizeEmbedActusStorageReference(
    bucketValue,
    pathValue,
  );
  const token = String(tokenValue || "").trim();
  if (!reference || !token) return false;

  const expected = signReference(reference.bucket, reference.storagePath);
  if (!expected) return false;

  const expectedBuffer = Buffer.from(expected);
  const receivedBuffer = Buffer.from(token);
  return (
    expectedBuffer.length === receivedBuffer.length &&
    timingSafeEqual(expectedBuffer, receivedBuffer)
  );
}
