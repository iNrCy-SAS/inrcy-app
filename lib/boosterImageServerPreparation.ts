import { createHash } from "node:crypto";
import sharp from "sharp";
import {
  isBoosterImageExplicitlyCustomized,
  normalizeBoosterImageCustomizationScope,
} from "@/lib/boosterImageCustomization";
import { supabaseAdmin } from "@/lib/supabaseAdmin";
import { toExactStorageArrayBuffer } from "@/lib/supabaseStorageBinary";
import {
  canUseAutomaticCover,
  getBoosterImageDecision,
  getBoosterImageDisplayPlan,
  getBoosterImageRenderDimensions,
  getBoosterImageSafetyBackgroundMode,
  getBoosterImageSequenceTargetRatio,
  type BoosterImageChannel,
  type BoosterImageMetaLike,
  type ComparableImageTransform,
} from "@/lib/boosterImageDecision";

type JsonRecord = Record<string, unknown>;

type ServerImageTransform = {
  fit: "contain" | "cover";
  zoom: number;
  offsetX: number;
  offsetY: number;
  blurBackground: boolean;
  backgroundMode?: string;
  backgroundColor?: string;
};

type ChannelSettings = {
  imageKeys: string[];
  transforms: Record<string, ServerImageTransform>;
  customizedImageKeys: string[];
};

export type BoosterServerImagePayload = {
  mediaId?: string;
  name: string;
  type: string;
  dataUrl?: string;
  bucket?: string;
  storagePath?: string;
  publicUrl?: string;
  renderedUrl?: string;
  originalUrl?: string | null;
  originalPublicUrl?: string | null;
  originalStoragePath?: string | null;
  originalName?: string | null;
  originalType?: string | null;
  imageKey?: string | null;
  transform?: unknown;
  imageMeta?: unknown;
  imageDecisionMode?: "original" | "adapted" | "customized" | "unsupported";
  imageDecisionLabel?: "Originale" | "Adaptée" | "Personnalisée" | "Indisponible";
  isCustomized?: boolean;
  publicationReady?: boolean;
};

export type BoosterServerImagePreparationResult = {
  imagesByChannel: Partial<Record<BoosterImageChannel, BoosterServerImagePayload[]>>;
  imageSettingsByChannel: Partial<Record<BoosterImageChannel, JsonRecord>>;
  warnings: Array<{ channel: BoosterImageChannel; imageKey: string; reason: string }>;
};

const CHANNEL_RENDER_BASE: Record<BoosterImageChannel, { width: number; height: number }> = {
  inrcy_site: { width: 1440, height: 900 },
  site_web: { width: 1440, height: 900 },
  inr_search: { width: 1440, height: 900 },
  gmb: { width: 1200, height: 675 },
  facebook: { width: 1200, height: 1200 },
  instagram: { width: 1080, height: 1350 },
  linkedin: { width: 1200, height: 1200 },
  tiktok: { width: 1080, height: 1920 },
  youtube_shorts: { width: 1080, height: 1920 },
  pinterest: { width: 1000, height: 1500 },
};

// Bump both signatures whenever the encoded bytes contract changes. This
// invalidates the old progressive derivatives instead of serving them again.
const CHANNEL_IMAGE_VARIANT_PIPELINE_VERSION = 8;
const TIKTOK_CHANNEL_IMAGE_VARIANT_PIPELINE_VERSION = 10;
const CHANNEL_IMAGE_VARIANT_BUCKET = "booster";
const TIKTOK_PHOTO_MAX_BYTES = 20_000_000;
const TIKTOK_LANDSCAPE_MAX_WIDTH = 1920;
const TIKTOK_LANDSCAPE_MAX_HEIGHT = 1080;
const TIKTOK_PORTRAIT_MAX_WIDTH = 1080;
const TIKTOK_PORTRAIT_MAX_HEIGHT = 1920;

function getChannelImagePipelineVersion(channel: BoosterImageChannel) {
  return channel === "tiktok"
    ? TIKTOK_CHANNEL_IMAGE_VARIANT_PIPELINE_VERSION
    : CHANNEL_IMAGE_VARIANT_PIPELINE_VERSION;
}

function getChannelJpegOptions(channel: BoosterImageChannel, quality = 87) {
  if (channel === "tiktok") {
    return {
      quality: Math.max(50, Math.min(100, quality === 87 ? 90 : quality)),
      // Sharp's mozjpeg preset enables optimizeScans and can emit a
      // progressive JPEG even when progressive=false is requested.
      mozjpeg: false,
      progressive: false,
      chromaSubsampling: "4:2:0" as const,
    };
  }
  return {
    quality,
    mozjpeg: true,
    // Baseline JPEG is the portable publication contract. Progressive scans
    // are visually valid but are intermittently rejected by Google Business
    // and can leave TikTok's pull worker in PROCESSING_DOWNLOAD.
    progressive: false,
  };
}

async function inspectTikTokPhotoContract(input: Buffer) {
  if (!input.length || input.length > TIKTOK_PHOTO_MAX_BYTES) return null;
  const metadata = await sharp(input, { failOn: "none" })
    .metadata()
    .catch(() => null);
  if (!metadata || metadata.format !== "jpeg") return null;
  if (metadata.isProgressive === true) return null;
  if (String(metadata.space || "").toLowerCase() !== "srgb") return null;
  if (String(metadata.chromaSubsampling || "") !== "4:2:0") return null;

  const oriented = getOrientedDimensions(metadata);
  if (!oriented.width || !oriented.height) return null;
  const landscape = oriented.width >= oriented.height;
  const maxWidth = landscape
    ? TIKTOK_LANDSCAPE_MAX_WIDTH
    : TIKTOK_PORTRAIT_MAX_WIDTH;
  const maxHeight = landscape
    ? TIKTOK_LANDSCAPE_MAX_HEIGHT
    : TIKTOK_PORTRAIT_MAX_HEIGHT;
  if (oriented.width > maxWidth || oriented.height > maxHeight) return null;
  return oriented;
}

async function ensureTikTokPhotoContract(input: Buffer) {
  const compatible = await inspectTikTokPhotoContract(input);
  if (compatible) {
    return {
      output: input,
      mime: "image/jpeg" as const,
      extension: "jpg" as const,
      width: compatible.width,
      height: compatible.height,
    };
  }

  const metadata = await sharp(input, { failOn: "none" }).metadata();
  const oriented = getOrientedDimensions(metadata);
  if (!oriented.width || !oriented.height) {
    throw new Error("tiktok_image_dimensions_missing");
  }
  const landscape = oriented.width >= oriented.height;
  const maxWidth = landscape
    ? TIKTOK_LANDSCAPE_MAX_WIDTH
    : TIKTOK_PORTRAIT_MAX_WIDTH;
  const maxHeight = landscape
    ? TIKTOK_LANDSCAPE_MAX_HEIGHT
    : TIKTOK_PORTRAIT_MAX_HEIGHT;
  const render = (quality: number) =>
    sharp(input, { failOn: "none" })
      .rotate()
      .resize({
        width: maxWidth,
        height: maxHeight,
        fit: "inside",
        withoutEnlargement: true,
      })
      .flatten({ background: { r: 255, g: 255, b: 255, alpha: 1 } })
      .toColourspace("srgb")
      .jpeg(getChannelJpegOptions("tiktok", quality))
      .toBuffer();

  let quality = 90;
  let output = await render(quality);
  while (output.length > TIKTOK_PHOTO_MAX_BYTES && quality > 50) {
    quality -= 5;
    output = await render(quality);
  }
  const verified = await inspectTikTokPhotoContract(output);
  if (!verified) throw new Error("tiktok_image_contract_failed");
  return {
    output,
    mime: "image/jpeg" as const,
    extension: "jpg" as const,
    width: verified.width,
    height: verified.height,
  };
}

type ChannelImageVariantRow = {
  id: string;
  media_id: string;
  channel: string | null;
  signature: string | null;
  bucket_name: string | null;
  storage_path: string | null;
  mime_type: string | null;
  size_bytes: number | null;
  width: number | null;
  height: number | null;
};

function safeStorageSegment(value: unknown, fallback: string) {
  const clean = String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 100);
  return clean || fallback;
}

function buildChannelImageSignature(value: Record<string, unknown>) {
  const pipelineVersion = Number(
    value.pipelineVersion || CHANNEL_IMAGE_VARIANT_PIPELINE_VERSION,
  );
  const hash = createHash("sha256")
    .update(JSON.stringify(value))
    .digest("hex");
  return {
    hash,
    pipelineVersion,
    signature: `inrcy:image:channel_publish:v${pipelineVersion}:${hash}`,
  };
}

function cachedVariantKey(mediaId: string, channel: string, signature: string) {
  return `${mediaId}:${channel}:${signature}`;
}

async function loadCachedChannelImageVariants(params: {
  accountId?: string;
  workspaceId?: string;
  mediaIds: string[];
  channels: BoosterImageChannel[];
}) {
  const cache = new Map<string, ChannelImageVariantRow>();
  if (
    !params.accountId ||
    !params.workspaceId ||
    !params.mediaIds.length ||
    !params.channels.length
  ) {
    return cache;
  }
  const result = await supabaseAdmin
    .from("media_variants")
    .select(
      "id,media_id,channel,signature,bucket_name,storage_path,mime_type,size_bytes,width,height",
    )
    .eq("account_id", params.accountId)
    .eq("workspace_id", params.workspaceId)
    .eq("purpose", "channel_publish")
    .eq("status", "ready")
    .in("media_id", params.mediaIds)
    .in("channel", params.channels);
  if (result.error) throw result.error;
  for (const row of (result.data || []) as ChannelImageVariantRow[]) {
    if (!row.media_id || !row.channel || !row.signature) continue;
    cache.set(
      cachedVariantKey(row.media_id, row.channel, row.signature),
      row,
    );
  }
  return cache;
}

async function persistChannelImageVariant(params: {
  accountId: string;
  workspaceId: string;
  mediaId: string;
  channel: BoosterImageChannel;
  signature: string;
  hash: string;
  output: Buffer;
  mime: string;
  extension: string;
  width: number;
  height: number;
  transform: Record<string, unknown>;
  metadata: Record<string, unknown>;
  pipelineVersion: number;
}) {
  const account = safeStorageSegment(params.accountId, "account");
  const media = safeStorageSegment(params.mediaId, "media");
  const storagePath = `${account}/workspace-channel-images/${media}/${params.hash}.${params.extension}`;
  const uploaded = await supabaseAdmin.storage
    .from(CHANNEL_IMAGE_VARIANT_BUCKET)
    .upload(storagePath, toExactStorageArrayBuffer(params.output), {
      contentType: params.mime,
      cacheControl: "31536000",
      upsert: true,
    });
  if (uploaded.error) throw uploaded.error;

  const readyAt = new Date().toISOString();
  const record = {
    account_id: params.accountId,
    media_id: params.mediaId,
    workspace_id: params.workspaceId,
    purpose: "channel_publish",
    channel: params.channel,
    signature: params.signature,
    status: "ready",
    bucket_name: CHANNEL_IMAGE_VARIANT_BUCKET,
    storage_path: storagePath,
    mime_type: params.mime,
    size_bytes: params.output.length,
    width: params.width,
    height: params.height,
    duration_seconds: null,
    pipeline_version: params.pipelineVersion,
    transform_spec: params.transform,
    variant_metadata: params.metadata,
    error_code: null,
    error_message: null,
    ready_at: readyAt,
  };
  const existing = await supabaseAdmin
    .from("media_variants")
    .select("id")
    .eq("account_id", params.accountId)
    .eq("media_id", params.mediaId)
    .eq("workspace_id", params.workspaceId)
    .eq("purpose", "channel_publish")
    .eq("channel", params.channel)
    .eq("signature", params.signature)
    .maybeSingle();
  if (existing.error) throw existing.error;
  const saved = existing.data?.id
    ? await supabaseAdmin
        .from("media_variants")
        .update(record)
        .eq("id", existing.data.id)
        .select(
          "id,media_id,channel,signature,bucket_name,storage_path,mime_type,size_bytes,width,height",
        )
        .single()
    : await supabaseAdmin
        .from("media_variants")
        .insert(record)
        .select(
          "id,media_id,channel,signature,bucket_name,storage_path,mime_type,size_bytes,width,height",
        )
        .single();
  if (saved.error?.code === "23505") {
    const winner = await supabaseAdmin
      .from("media_variants")
      .select(
        "id,media_id,channel,signature,bucket_name,storage_path,mime_type,size_bytes,width,height",
      )
      .eq("account_id", params.accountId)
      .eq("media_id", params.mediaId)
      .eq("workspace_id", params.workspaceId)
      .eq("purpose", "channel_publish")
      .eq("channel", params.channel)
      .eq("signature", params.signature)
      .single();
    if (winner.error) throw winner.error;
    return winner.data as ChannelImageVariantRow;
  }
  if (saved.error) throw saved.error;
  return saved.data as ChannelImageVariantRow;
}

function channelImagePayloadFromVariant(params: {
  row: ChannelImageVariantRow;
  name: string;
  mediaId: string;
}) {
  const bucket = String(
    params.row.bucket_name || CHANNEL_IMAGE_VARIANT_BUCKET,
  );
  const storagePath = String(params.row.storage_path || "");
  const publicUrl =
    supabaseAdmin.storage.from(bucket).getPublicUrl(storagePath).data
      .publicUrl || "";
  return {
    mediaId: params.mediaId,
    name: params.name,
    type: String(params.row.mime_type || "image/jpeg"),
    bucket,
    storagePath,
    publicUrl,
    renderedUrl: publicUrl,
    publicationReady: true,
  } satisfies BoosterServerImagePayload;
}

function asObject(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function parseDataUrl(value: string) {
  const match = /^data:([^;]+);base64,(.+)$/i.exec(String(value || ""));
  if (!match) return null;
  return { mime: match[1] || "application/octet-stream", buffer: Buffer.from(match[2], "base64") };
}

function extensionFromMime(mime: string) {
  const normalized = String(mime || "").toLowerCase();
  if (normalized.includes("png")) return "png";
  if (normalized.includes("webp")) return "webp";
  return "jpg";
}

async function resolveImageBuffer(image: BoosterServerImagePayload) {
  // Always rebuild from the canonical original when one is available. This
  // prevents an old channel canvas (white bars/crop) from becoming the source
  // of a new publication after the media-pipeline cutover.
  const bucket = String(image.bucket || "booster").trim() || "booster";
  const storageCandidates = Array.from(
    new Set(
      [image.originalStoragePath, image.storagePath]
        .map((value) => String(value || "").trim())
        .filter(Boolean),
    ),
  );
  for (const storagePath of storageCandidates) {
    const downloaded = await supabaseAdmin.storage.from(bucket).download(storagePath);
    if (!downloaded.error && downloaded.data) {
      return {
        mime:
          downloaded.data.type ||
          image.originalType ||
          image.type ||
          "application/octet-stream",
        buffer: Buffer.from(await downloaded.data.arrayBuffer()),
      };
    }
  }

  const parsed = image.dataUrl ? parseDataUrl(image.dataUrl) : null;
  if (parsed) return parsed;

  const urlCandidates = Array.from(
    new Set(
      [
        image.originalPublicUrl,
        image.originalUrl,
        image.publicUrl,
        image.renderedUrl,
      ]
        .map((value) => String(value || "").trim())
        .filter((value) => /^https?:\/\//i.test(value)),
    ),
  );
  for (const url of urlCandidates) {
    const response = await fetch(url);
    if (!response.ok) continue;
    return {
      mime:
        response.headers.get("content-type") ||
        image.originalType ||
        image.type ||
        "application/octet-stream",
      buffer: Buffer.from(await response.arrayBuffer()),
    };
  }
  return null;
}

function getOrientedDimensions(meta: { width?: number; height?: number; orientation?: number }) {
  const width = Number(meta.width || 0);
  const height = Number(meta.height || 0);
  const orientation = Number(meta.orientation || 1);
  const swapsAxes = orientation >= 5 && orientation <= 8;
  return { width: swapsAxes ? height : width, height: swapsAxes ? width : height };
}

async function readImageMeta(buffer: Buffer): Promise<BoosterImageMetaLike> {
  const meta = await sharp(buffer, { failOn: "none" }).metadata();
  const oriented = getOrientedDimensions(meta);
  if (!oriented.width || !oriented.height) return {};
  return {
    width: oriented.width,
    height: oriented.height,
    ratio: oriented.width / oriented.height,
  };
}

function readKnownImageMeta(value: unknown): BoosterImageMetaLike | null {
  const raw = asObject(value);
  const width = Number(raw.width || 0);
  const height = Number(raw.height || 0);
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    return null;
  }
  return {
    width,
    height,
    ratio: width / height,
  };
}

function mergeImageMeta(existing: unknown, meta: BoosterImageMetaLike) {
  return { ...asObject(existing), ...meta };
}

function getStableOriginalUrl(image: BoosterServerImagePayload) {
  return String(
    image.originalPublicUrl || image.originalUrl || image.publicUrl || "",
  ).trim() || null;
}

const ORIGINAL_IMAGE_MIME_TYPES_BY_CHANNEL: Record<
  BoosterImageChannel,
  ReadonlySet<string>
> = {
  inrcy_site: new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/avif",
  ]),
  site_web: new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/avif",
  ]),
  inr_search: new Set([
    "image/jpeg",
    "image/png",
    "image/webp",
    "image/gif",
    "image/avif",
  ]),
  gmb: new Set(["image/jpeg", "image/png"]),
  facebook: new Set(["image/jpeg", "image/png"]),
  instagram: new Set(["image/jpeg"]),
  linkedin: new Set(["image/jpeg", "image/png"]),
  // TikTok always goes through a channel variant, including the visual
  // "Originale" mode. A declared MIME type cannot prove that JPEG bytes are
  // baseline, sRGB and 4:2:0, so bypassing the byte guard is unsafe.
  tiktok: new Set(),
  youtube_shorts: new Set(),
  pinterest: new Set(["image/jpeg", "image/png"]),
};

function normalizedImageMime(value: unknown) {
  const mime = String(value || "")
    .trim()
    .toLowerCase()
    .split(";")[0];
  return mime === "image/jpg" ? "image/jpeg" : mime;
}

function canSendOriginalImageToChannel(
  channel: BoosterImageChannel,
  image: BoosterServerImagePayload,
) {
  return ORIGINAL_IMAGE_MIME_TYPES_BY_CHANNEL[channel].has(
    normalizedImageMime(image.originalType || image.type),
  );
}

async function renderTechnicalImageCompatibility(params: {
  buffer: Buffer;
  channel: BoosterImageChannel;
}) {
  if (params.channel === "tiktok") {
    return ensureTikTokPhotoContract(params.buffer);
  }
  const oriented = sharp(params.buffer, { failOn: "none" }).rotate();
  const metadata = await oriented.metadata();
  const width = Number(metadata.width || 0);
  const height = Number(metadata.height || 0);
  if (!width || !height) throw new Error("image_dimensions_missing");
  return {
    output: await oriented
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .jpeg(getChannelJpegOptions(params.channel))
      .toBuffer(),
    mime: "image/jpeg",
    extension: "jpg",
    width,
    height,
  } as const;
}

function clamp(value: unknown, min: number, max: number, fallback = 0) {
  const numeric = Number(value);
  const resolved = Number.isFinite(numeric) ? numeric : fallback;
  return Math.min(max, Math.max(min, resolved));
}

function normalizeTransform(value: unknown, fallback: ServerImageTransform): ServerImageTransform {
  const raw = asObject(value);
  const fit = raw.fit === "cover" ? "cover" : raw.fit === "contain" ? "contain" : fallback.fit;
  const rawBackgroundMode = String(raw.backgroundMode || "").trim().toLowerCase();
  const backgroundMode =
    rawBackgroundMode === "blur" || raw.blurBackground === true
      ? String(fallback.backgroundMode || "black")
      : rawBackgroundMode || String(fallback.backgroundMode || "black");
  return {
    fit,
    zoom: clamp(raw.zoom, 0.4, fit === "cover" ? 3 : 1, fallback.zoom),
    offsetX: clamp(raw.offsetX, -100, 100, fallback.offsetX),
    offsetY: clamp(raw.offsetY, -100, 100, fallback.offsetY),
    // Kept in the persisted shape for backward compatibility, but blur is
    // deliberately disabled everywhere in the publication pipeline.
    blurBackground: false,
    backgroundMode,
    backgroundColor: String(raw.backgroundColor || fallback.backgroundColor || "").trim() || undefined,
  };
}

function normalizeChannelSettings(value: unknown): ChannelSettings {
  const raw = asObject(value);
  const transformsNode = asObject(raw.transforms);
  const transforms = Object.fromEntries(
    Object.entries(transformsNode).map(([key, transform]) => [
      key,
      normalizeTransform(transform, {
        fit: "contain",
        zoom: 1,
        offsetX: 0,
        offsetY: 0,
        blurBackground: false,
        backgroundMode: "color",
        backgroundColor: "#ffffff",
      }),
    ]),
  );
  return {
    imageKeys: Array.isArray(raw.imageKeys)
      ? raw.imageKeys.map((key) => String(key || "").trim()).filter(Boolean).slice(0, 5)
      : [],
    transforms,
    customizedImageKeys: Array.isArray(raw.customizedImageKeys)
      ? raw.customizedImageKeys.map((key) => String(key || "").trim()).filter(Boolean).slice(0, 5)
      : [],
  };
}

function backgroundRgba(transform: ServerImageTransform, forceOpaque = false) {
  const mode = transform.backgroundMode || (transform.backgroundColor ? "color" : "black");
  if (mode === "transparent" && !forceOpaque) {
    return { r: 0, g: 0, b: 0, alpha: 0 };
  }
  const raw = String(transform.backgroundColor || "").trim();
  const hex = /^#?([0-9a-f]{6})$/i.exec(raw)?.[1];
  if (hex) {
    return {
      r: Number.parseInt(hex.slice(0, 2), 16),
      g: Number.parseInt(hex.slice(2, 4), 16),
      b: Number.parseInt(hex.slice(4, 6), 16),
      alpha: 1,
    };
  }
  if (["white", "gray", "sand", "brand", "color"].includes(mode)) {
    if (mode === "gray") return { r: 214, g: 218, b: 226, alpha: 1 };
    if (mode === "sand") return { r: 239, g: 228, b: 211, alpha: 1 };
    return { r: 255, g: 255, b: 255, alpha: 1 };
  }
  return { r: 13, g: 19, b: 32, alpha: 1 };
}

function originalReferenceTransform(): ServerImageTransform {
  // Must stay visually equivalent to getOptimizedTransform() on the client.
  // It is metadata only: original publication never renders a fixed canvas.
  return {
    fit: "contain",
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    blurBackground: false,
    backgroundMode: "color",
    backgroundColor: "#ffffff",
  };
}

function automaticTransformForDecision(params: {
  channel: BoosterImageChannel;
  sourceRatio: number;
  targetRatio: number;
  forceContain?: boolean;
}): ServerImageTransform {
  const fit = params.forceContain
    ? "contain"
    : canUseAutomaticCover(params.sourceRatio, params.targetRatio)
      ? "cover"
      : "contain";
  return {
    fit,
    zoom: 1,
    offsetX: 0,
    offsetY: 0,
    blurBackground: false,
    // Last-resort safety frame only. No blur is ever generated.
    backgroundMode:
      fit === "contain"
        ? getBoosterImageSafetyBackgroundMode(params.channel)
        : "black",
  };
}

async function renderImageTransform(params: {
  buffer: Buffer;
  channel: BoosterImageChannel;
  transform: ServerImageTransform;
  targetRatio?: number | null;
}) {
  const base = CHANNEL_RENDER_BASE[params.channel];
  const dimensions = getBoosterImageRenderDimensions({
    baseWidth: base.width,
    baseHeight: base.height,
    targetRatio: params.targetRatio,
  });
  const oriented = sharp(params.buffer, { failOn: "none" }).rotate();
  const meta = await oriented.metadata();
  const imageWidth = Number(meta.width || 0);
  const imageHeight = Number(meta.height || 0);
  if (!imageWidth || !imageHeight) throw new Error("image_dimensions_missing");

  const baseScale = params.transform.fit === "cover"
    ? Math.max(dimensions.width / imageWidth, dimensions.height / imageHeight)
    : Math.min(dimensions.width / imageWidth, dimensions.height / imageHeight);
  const maxZoom = params.transform.fit === "cover" ? 3 : 1;
  const zoom = clamp(params.transform.zoom, 0.4, maxZoom, 1);
  const drawWidth = Math.max(1, Math.round(imageWidth * baseScale * zoom));
  const drawHeight = Math.max(1, Math.round(imageHeight * baseScale * zoom));
  const maxX = Math.abs(drawWidth - dimensions.width) / 2;
  const maxY = Math.abs(drawHeight - dimensions.height) / 2;
  const dx = Math.round(
    (dimensions.width - drawWidth) / 2 -
      (maxX * clamp(params.transform.offsetX, -100, 100, 0)) / 100,
  );
  const dy = Math.round(
    (dimensions.height - drawHeight) / 2 -
      (maxY * clamp(params.transform.offsetY, -100, 100, 0)) / 100,
  );

  const resized = await sharp(params.buffer, { failOn: "none" })
    .rotate()
    .resize({ width: drawWidth, height: drawHeight, fit: "fill" })
    .png()
    .toBuffer();

  const cropLeft = Math.max(0, -dx);
  const cropTop = Math.max(0, -dy);
  const destinationLeft = Math.max(0, dx);
  const destinationTop = Math.max(0, dy);
  const visibleWidth = Math.min(
    drawWidth - cropLeft,
    dimensions.width - destinationLeft,
  );
  const visibleHeight = Math.min(
    drawHeight - cropTop,
    dimensions.height - destinationTop,
  );
  if (visibleWidth <= 0 || visibleHeight <= 0) {
    throw new Error("image_transform_outside_canvas");
  }
  const overlay = await sharp(resized)
    .extract({
      left: cropLeft,
      top: cropTop,
      width: visibleWidth,
      height: visibleHeight,
    })
    .png()
    .toBuffer();

  const rawRequestedMode = String(params.transform.backgroundMode || "black").toLowerCase();
  const requestedMode =
    rawRequestedMode === "blur"
      ? getBoosterImageSafetyBackgroundMode(params.channel)
      : rawRequestedMode;
  const transparent = requestedMode === "transparent" && params.channel !== "gmb";
  const normalizedTransform = {
    ...params.transform,
    blurBackground: false,
    backgroundMode: requestedMode,
  };
  const background = backgroundRgba(normalizedTransform, params.channel === "gmb");
  const foreground = { input: overlay, left: destinationLeft, top: destinationTop };

  const canvas = sharp({
    create: {
      width: dimensions.width,
      height: dimensions.height,
      channels: 4,
      background,
    },
  }).composite([foreground]);

  if (transparent) {
    return {
      output: await canvas.png({ compressionLevel: 9, adaptiveFiltering: true }).toBuffer(),
      mime: "image/png",
      extension: "png",
      width: dimensions.width,
      height: dimensions.height,
    } as const;
  }
  return {
    output: await canvas
      .flatten({ background })
      .jpeg(getChannelJpegOptions(params.channel))
      .toBuffer(),
    mime: "image/jpeg",
    extension: "jpg",
    width: dimensions.width,
    height: dimensions.height,
  } as const;
}

async function renderAutomaticAdaptation(params: {
  buffer: Buffer;
  channel: BoosterImageChannel;
  sourceRatio: number;
  targetRatio: number;
  forceContain?: boolean;
}) {
  const transform = automaticTransformForDecision({
    channel: params.channel,
    sourceRatio: params.sourceRatio,
    targetRatio: params.targetRatio,
    forceContain: params.forceContain,
  });
  const rendered = await renderImageTransform({
    buffer: params.buffer,
    channel: params.channel,
    transform,
    targetRatio: params.targetRatio,
  });
  return { ...rendered, fit: transform.fit } as const;
}

/**
 * Server counterpart of Booster's client image preparation.
 *
 * Étape 8 accepte aussi les réglages légers envoyés par Booster. Le serveur
 * recrée alors les adaptations et personnalisations directement depuis la
 * version canonique privée du workspace : aucun JPEG/PNG dérivé ne traverse
 * plus le navigateur lors de Générer / Publier / Programmer.
 */
export async function prepareBoosterImagesByChannelOnServer(params: {
  accountId?: string;
  workspaceId?: string;
  channels: BoosterImageChannel[];
  images: BoosterServerImagePayload[];
  settingsByChannel?: Partial<Record<BoosterImageChannel, unknown>>;
  /** iNrAgent protège toujours la composition IA complète avant validation. */
  automaticFit?: "contain";
}): Promise<BoosterServerImagePreparationResult> {
  const channels = Array.from(new Set(params.channels));
  const sourceImages = params.images.slice(0, 5);
  const warnings: BoosterServerImagePreparationResult["warnings"] = [];

  const resolved = await Promise.all(
    sourceImages.map(async (image, index) => {
      let inputPromise: ReturnType<typeof resolveImageBuffer> | null = null;
      const resolveInput = async () => {
        inputPromise ||= resolveImageBuffer(image);
        const input = await inputPromise;
        if (!input) throw new Error("image_source_unavailable");
        return input;
      };
      let meta = readKnownImageMeta(image.imageMeta);
      if (!meta) {
        const input = await resolveInput().catch(() => null);
        if (!input) return null;
        meta = await readImageMeta(input.buffer).catch(() => ({}));
        if (!meta.width || !meta.height) return null;
      }
      return {
        image,
        meta,
        imageKey: String(image.imageKey || `image-${index + 1}`),
        resolveInput,
      };
    }),
  );
  const valid = resolved.filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
  const technicalCompatibilityBySource = new Map<
    string,
    ReturnType<typeof renderTechnicalImageCompatibility>
  >();
  let cachedVariantsPromise: ReturnType<typeof loadCachedChannelImageVariants> | null = null;
  const getCachedVariants = () => {
    cachedVariantsPromise ||= loadCachedChannelImageVariants({
      accountId: params.accountId,
      workspaceId: params.workspaceId,
      mediaIds: valid
        .map((entry) => String(entry.image.mediaId || ""))
        .filter(Boolean),
      channels,
    });
    return cachedVariantsPromise;
  };

  const imagesByChannel: BoosterServerImagePreparationResult["imagesByChannel"] = {};
  const imageSettingsByChannel: BoosterServerImagePreparationResult["imageSettingsByChannel"] = {};

  // Les canaux sont indépendants mais partagent les mêmes promesses de
  // téléchargement et le même chargement de cache. On conserve ainsi un temps
  // proche entre 1 et 10 canaux sans télécharger/décoder la source dix fois.
  await Promise.all(channels.map(async (channel) => {
    if (channel === "youtube_shorts" || !valid.length) {
      imagesByChannel[channel] = [];
      imageSettingsByChannel[channel] = { imageKeys: [], transforms: {}, customizedImageKeys: [] };
      return;
    }

    const rawChannelSettings = params.settingsByChannel?.[channel];
    const rawChannelSettingsNode = asObject(rawChannelSettings);
    const hasExplicitImageSelection = Object.prototype.hasOwnProperty.call(
      rawChannelSettingsNode,
      "imageKeys",
    );
    const rawRequestedSettings = normalizeChannelSettings(rawChannelSettings);
    const byKey = new Map(valid.map((entry) => [entry.imageKey, entry]));
    const requestedSettings =
      normalizeBoosterImageCustomizationScope<ServerImageTransform>({
        availableImageKeys: valid.map((entry) => entry.imageKey),
        requestedImageKeys: rawRequestedSettings.imageKeys,
        transforms: rawRequestedSettings.transforms,
        customizedImageKeys: rawRequestedSettings.customizedImageKeys,
        maxImages: 5,
        fallbackToAvailableWhenSelectionEmpty: !hasExplicitImageSelection,
      });
    const exactChannelSources = requestedSettings.imageKeys
      .map((key) => byKey.get(key))
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));
    const channelSources =
      channel === "gmb" ? exactChannelSources.slice(0, 5) : exactChannelSources;
    const firstImageKey = channelSources[0]?.imageKey || "";
    const firstCustomized = isBoosterImageExplicitlyCustomized(
      requestedSettings.customizedImageKeys,
      firstImageKey,
    );
    const sequenceTargetRatio = getBoosterImageSequenceTargetRatio({
      channel,
      metas: channelSources.map((entry) => entry.meta),
      firstImageCustomizedTargetRatio:
        (channel === "instagram" || channel === "pinterest") && firstCustomized
          ? CHANNEL_RENDER_BASE[channel].width / CHANNEL_RENDER_BASE[channel].height
          : null,
    });
    const forcePinterestSequenceCanvas =
      channel === "pinterest" &&
      channelSources.length > 1 &&
      Number(sequenceTargetRatio) > 0;
    const prepared: BoosterServerImagePayload[] = [];
    const transforms: Record<string, unknown> = {};
    const customizedImageKeys: string[] = [];

    for (const entry of channelSources) {
      try {
        const initialDecision = getBoosterImageDecision({
          channel,
          meta: entry.meta,
          requiredTargetRatio: sequenceTargetRatio,
          forceRequiredTargetCanvas: forcePinterestSequenceCanvas,
        });
        if (initialDecision.mode === "unsupported") continue;
        const sourceRatio = Number(initialDecision.sourceRatio || entry.meta.ratio || 0);
        const targetRatio = Number(initialDecision.targetRatio || sourceRatio || 0);
        const automaticTransform =
          initialDecision.mode === "original"
            ? originalReferenceTransform()
            : sourceRatio > 0 && targetRatio > 0
              ? automaticTransformForDecision({
                  channel,
                  sourceRatio,
                  targetRatio,
                  forceContain: params.automaticFit === "contain",
                })
              : originalReferenceTransform();
        const currentTransform = normalizeTransform(
          requestedSettings.transforms[entry.imageKey],
          automaticTransform,
        );
        const explicitlyCustomized = isBoosterImageExplicitlyCustomized(
          requestedSettings.customizedImageKeys,
          entry.imageKey,
        );
        const displayPlan = getBoosterImageDisplayPlan({
          channel,
          meta: entry.meta,
          customized: explicitlyCustomized,
          currentTransform: currentTransform as ComparableImageTransform,
          automaticTransform: automaticTransform as ComparableImageTransform,
          requiredTargetRatio: sequenceTargetRatio,
          forceRequiredTargetCanvas: forcePinterestSequenceCanvas,
        });

        const originalUrl = getStableOriginalUrl(entry.image);
        const common = {
          originalUrl,
          originalPublicUrl: originalUrl,
          originalStoragePath: entry.image.originalStoragePath || entry.image.storagePath || null,
          originalName: entry.image.originalName || entry.image.name,
          originalType:
            entry.image.originalType ||
            entry.image.type ||
            "application/octet-stream",
          imageKey: entry.imageKey,
          imageMeta: mergeImageMeta(entry.image.imageMeta, entry.meta),
          imageDecisionMode: displayPlan.decision.mode,
          imageDecisionLabel: displayPlan.decision.label,
          isCustomized: displayPlan.decision.mode === "customized",
        } as const;

        const getPreparedVariantIdentity = (
          mode: "adapted" | "customized",
          transform: ServerImageTransform,
        ) =>
          buildChannelImageSignature({
            pipelineVersion: getChannelImagePipelineVersion(channel),
            mediaId: String(entry.image.mediaId || "").trim(),
            sourcePath: entry.image.storagePath || "",
            imageKey: entry.imageKey,
            channel,
            mode,
            transform,
            sequenceTargetRatio: sequenceTargetRatio || null,
          });

        const readCachedPreparedVariant = async (
          mode: "adapted" | "customized",
          name: string,
          transform: ServerImageTransform,
        ) => {
          const mediaId = String(entry.image.mediaId || "").trim();
          if (!params.accountId || !params.workspaceId || !mediaId) return null;
          const identity = getPreparedVariantIdentity(mode, transform);
          const cachedVariants = await getCachedVariants();
          const row = cachedVariants.get(
            cachedVariantKey(mediaId, channel, identity.signature),
          );
          if (!row?.storage_path) return null;
          return {
            ...channelImagePayloadFromVariant({ row, name, mediaId }),
            ...common,
            transform,
          };
        };

        const buildPreparedVariant = async (variant: {
          mode: "adapted" | "customized";
          name: string;
          transform: ServerImageTransform;
          output: Buffer;
          mime: string;
          extension: string;
          width: number;
          height: number;
        }) => {
          const publicationVariant =
            channel === "tiktok"
              ? await ensureTikTokPhotoContract(variant.output)
              : variant;
          const publicationName =
            channel === "tiktok"
              ? variant.name.replace(/\.[^.]+$/, "") + ".jpg"
              : variant.name;
          const mediaId = String(entry.image.mediaId || "").trim();
          const signed = getPreparedVariantIdentity(
            variant.mode,
            variant.transform,
          );
          if (params.accountId && params.workspaceId && mediaId) {
            const cachedVariants = await getCachedVariants();
            const key = cachedVariantKey(mediaId, channel, signed.signature);
            let row = cachedVariants.get(key);
            if (!row?.storage_path) {
              row = await persistChannelImageVariant({
                accountId: params.accountId,
                workspaceId: params.workspaceId,
                mediaId,
                channel,
                signature: signed.signature,
                hash: signed.hash,
                pipelineVersion: signed.pipelineVersion,
                output: publicationVariant.output,
                mime: publicationVariant.mime,
                extension: publicationVariant.extension,
                width: publicationVariant.width,
                height: publicationVariant.height,
                transform: { ...variant.transform },
                metadata: {
                  imageKey: entry.imageKey,
                  decisionMode: variant.mode,
                  sourceStoragePath: entry.image.storagePath || null,
                },
              });
              cachedVariants.set(key, row);
            }
            return {
              ...channelImagePayloadFromVariant({
                row,
                name: publicationName,
                mediaId,
              }),
              ...common,
              transform: variant.transform,
            };
          }
          return {
            mediaId: mediaId || undefined,
            name: publicationName,
            type: publicationVariant.mime,
            dataUrl: `data:${publicationVariant.mime};base64,${publicationVariant.output.toString("base64")}`,
            ...common,
            transform: variant.transform,
          };
        };

        if (
          displayPlan.decision.mode === "original" &&
          canSendOriginalImageToChannel(channel, entry.image)
        ) {
          // The workspace source has already passed the media-pipeline
          // validation contract. "Originale" is reference-only: no Storage
          // download, Sharp render, channel upload or media_variants write.
          prepared.push({
            ...entry.image,
            ...common,
            transform: automaticTransform,
            publicationReady:
              entry.image.publicationReady === true ||
              (entry.image.bucket === CHANNEL_IMAGE_VARIANT_BUCKET &&
                Boolean(entry.image.storagePath || entry.image.publicUrl)),
          });
          transforms[entry.imageKey] = automaticTransform;
          continue;
        }

        if (displayPlan.decision.mode === "original") {
          // Le ratio est dÃ©jÃ  bon, seul le format binaire n'est pas garanti par
          // le fournisseur (ex. PNG Instagram ou WebP Google). Conversion
          // technique sans crop, pad ni redimensionnement, puis cache canal.
          const transform = {
            ...originalReferenceTransform(),
            technicalCompatibility: normalizedImageMime(
              entry.image.originalType || entry.image.type,
            ),
          };
          const nameBase = String(
            entry.image.name || `image-${entry.imageKey}`,
          ).replace(/\.[^.]+$/, "");
          const outputName = `${nameBase}-${channel}-compatible.jpg`;
          const cached = await readCachedPreparedVariant(
            "adapted",
            outputName,
            transform,
          );
          if (cached) {
            prepared.push({
              ...cached,
              imageDecisionMode: "adapted",
              imageDecisionLabel: "Adapt\u00e9e",
            });
            transforms[entry.imageKey] = transform;
            continue;
          }
          const compatibilityProfile =
            channel === "tiktok" ? "tiktok" : "portable-jpeg";
          const compatibilityKey = `${entry.imageKey}:${compatibilityProfile}`;
          let compatiblePromise =
            technicalCompatibilityBySource.get(compatibilityKey);
          if (!compatiblePromise) {
            compatiblePromise = entry.resolveInput().then((input) =>
              renderTechnicalImageCompatibility({
                buffer: input.buffer,
                channel,
              }),
            );
            technicalCompatibilityBySource.set(
              compatibilityKey,
              compatiblePromise,
            );
          }
          const compatible = await compatiblePromise;
          prepared.push({
            ...(await buildPreparedVariant({
              mode: "adapted",
              name: outputName,
              transform,
              ...compatible,
            })),
            imageDecisionMode: "adapted",
            imageDecisionLabel: "Adapt\u00e9e",
          });
          transforms[entry.imageKey] = transform;
          continue;
        }

        if (displayPlan.decision.mode === "adapted") {
          const adaptedTargetRatio = Number(displayPlan.decision.targetRatio || targetRatio || 0);
          if (!(sourceRatio > 0 && adaptedTargetRatio > 0)) {
            throw new Error("missing_ratio_for_adaptation");
          }
          const transform = automaticTransformForDecision({
            channel,
            sourceRatio,
            targetRatio: adaptedTargetRatio,
            forceContain: params.automaticFit === "contain",
          });
          const nameBase = String(entry.image.name || `image-${entry.imageKey}`).replace(/\.[^.]+$/, "");
          const outputName = `${nameBase}-${channel}-adaptee.jpg`;
          const cached = await readCachedPreparedVariant(
            "adapted",
            outputName,
            transform,
          );
          if (cached) {
            prepared.push(cached);
            transforms[entry.imageKey] = transform;
            continue;
          }
          const input = await entry.resolveInput();
          const adapted = await renderAutomaticAdaptation({
            buffer: input.buffer,
            channel,
            sourceRatio,
            targetRatio: adaptedTargetRatio,
            forceContain: params.automaticFit === "contain",
          });
          prepared.push(
            await buildPreparedVariant({
              mode: "adapted",
              name: outputName,
              transform,
              ...adapted,
            }),
          );
          transforms[entry.imageKey] = transform;
          continue;
        }

        const customizedTargetRatio = (channel === "instagram" || channel === "pinterest") && sequenceTargetRatio
          ? sequenceTargetRatio
          : CHANNEL_RENDER_BASE[channel].width / CHANNEL_RENDER_BASE[channel].height;
        const nameBase = String(entry.image.name || `image-${entry.imageKey}`).replace(/\.[^.]+$/, "");
        const customizedExtension =
          currentTransform.backgroundMode === "transparent" && channel !== "gmb"
            ? "png"
            : "jpg";
        const outputName = `${nameBase}-${channel}-personnalisee.${customizedExtension}`;
        const cached = await readCachedPreparedVariant(
          "customized",
          outputName,
          currentTransform,
        );
        if (cached) {
          prepared.push(cached);
          transforms[entry.imageKey] = currentTransform;
          customizedImageKeys.push(entry.imageKey);
          continue;
        }
        const input = await entry.resolveInput();
        const customized = await renderImageTransform({
          buffer: input.buffer,
          channel,
          transform: currentTransform,
          targetRatio: customizedTargetRatio,
        });
        prepared.push(
          await buildPreparedVariant({
            mode: "customized",
            name: `${nameBase}-${channel}-personnalisee.${customized.extension}`,
            transform: currentTransform,
            ...customized,
          }),
        );
        transforms[entry.imageKey] = currentTransform;
        customizedImageKeys.push(entry.imageKey);
      } catch (error) {
        warnings.push({
          channel,
          imageKey: entry.imageKey,
          reason: error instanceof Error ? error.message : "image_preparation_failed",
        });
      }
    }

    if (prepared.length === channelSources.length) {
      imagesByChannel[channel] = prepared;
      imageSettingsByChannel[channel] = {
        imageKeys: prepared.map((image) => image.imageKey).filter(Boolean),
        transforms,
        customizedImageKeys,
        policy: params.settingsByChannel?.[channel]
          ? "booster_workspace_exact_settings_v1"
          : "booster_intelligent_matrix_v1",
      };
    }
  }));

  return { imagesByChannel, imageSettingsByChannel, warnings };
}

export function inferBoosterImageExtension(mime: string) {
  return extensionFromMime(mime);
}
