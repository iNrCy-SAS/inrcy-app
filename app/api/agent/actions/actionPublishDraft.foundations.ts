import type { InrAgentAction } from "@/lib/inrAgentActions";
import {
  INR_MEDIA_IMAGE_MAX_BYTES,
  INR_MEDIA_VIDEO_SOURCE_MAX_BYTES,
} from "@/lib/mediaRules";

const MAX_AGENT_IMAGE_BYTES = INR_MEDIA_IMAGE_MAX_BYTES;
const MAX_AGENT_VIDEO_BYTES = INR_MEDIA_VIDEO_SOURCE_MAX_BYTES;

export function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

export function cleanText(value: unknown, maxLength = 6000) {
  return String(value ?? "")
    .replace(/\r\n/g, "\n")
    .trim()
    .slice(0, maxLength);
}

export type PublishChannelKey =
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

const publishChannelAliases: Record<string, PublishChannelKey> = {
  inrcy_site: "inrcy_site",
  site_inrcy: "inrcy_site",
  siteInrcy: "inrcy_site",
  site_web: "site_web",
  siteWeb: "site_web",
  inr_search: "inr_search",
  inrSearch: "inr_search",
  gmb: "gmb",
  google_business: "gmb",
  facebook: "facebook",
  instagram: "instagram",
  linkedin: "linkedin",
  tiktok: "tiktok",
  youtube: "youtube_shorts",
  youtube_shorts: "youtube_shorts",
  pinterest: "pinterest",
};

const publishChannelReadAliases: Record<PublishChannelKey, string[]> = {
  inrcy_site: ["inrcy_site", "site_inrcy", "siteInrcy"],
  site_web: ["site_web", "siteWeb"],
  inr_search: ["inr_search", "inrSearch"],
  gmb: ["gmb", "google_business"],
  facebook: ["facebook"],
  instagram: ["instagram"],
  linkedin: ["linkedin"],
  tiktok: ["tiktok"],
  youtube_shorts: ["youtube_shorts", "youtube"],
  pinterest: ["pinterest"],
};

export function cleanPublishChannel(value: unknown): PublishChannelKey | null {
  const key = String(value ?? "").trim();
  return publishChannelAliases[key] || null;
}

export function cleanPublishHashtags(value: unknown) {
  const raw = Array.isArray(value)
    ? value
    : String(value ?? "")
        .split(/[\s,;]+/)
        .map((item) => item.trim());

  const seen = new Set<string>();
  const hashtags: string[] = [];
  for (const item of raw) {
    const clean = String(item ?? "")
      .trim()
      .replace(/^#+/, "")
      .replace(/\s+/g, "")
      .slice(0, 40);
    if (!clean || seen.has(clean.toLowerCase())) continue;
    seen.add(clean.toLowerCase());
    hashtags.push(clean);
  }
  return hashtags.slice(0, 8);
}

export function isPublishAction(action: InrAgentAction) {
  return (
    action.automationKey === "publish" &&
    action.targetTool === "booster" &&
    action.actionType === "publication"
  );
}

export function readPublishPost(
  postByChannel: Record<string, unknown>,
  channel: PublishChannelKey,
) {
  for (const key of publishChannelReadAliases[channel]) {
    const record = asRecord(postByChannel[key]);
    if (record) return record;
    const text = cleanText(postByChannel[key], 6000);
    if (text) return { content: text };
  }
  return {};
}

export function readPublishChannelValue(
  valuesByChannel: Record<string, unknown>,
  channel: PublishChannelKey,
) {
  for (const key of publishChannelReadAliases[channel]) {
    if (Object.prototype.hasOwnProperty.call(valuesByChannel, key)) {
      return valuesByChannel[key];
    }
  }
  return undefined;
}

export function removePublishChannelValue(
  valuesByChannel: Record<string, unknown>,
  channel: PublishChannelKey,
) {
  const nextValues = { ...valuesByChannel };
  for (const key of publishChannelReadAliases[channel]) {
    delete nextValues[key];
  }
  return nextValues;
}

export function buildPublishPreviewTextFromPosts(
  postByChannel: Record<string, unknown>,
  fallback: string,
) {
  const firstPost = Object.values(postByChannel)
    .map((value) => {
      const record = asRecord(value);
      if (!record) return cleanText(value, 1200);
      return cleanText(
        record.content ||
          record.text ||
          record.caption ||
          record.body ||
          record.message,
        1200,
      );
    })
    .find(Boolean);
  return firstPost || fallback;
}

export function publishChannelRequiresMedia(channel: PublishChannelKey) {
  return (
    channel === "instagram" ||
    channel === "tiktok" ||
    channel === "youtube_shorts" ||
    channel === "pinterest"
  );
}

export function publishChannelRequiresVideo(channel: PublishChannelKey) {
  return channel === "youtube_shorts";
}

export function cleanPublishMedia(value: unknown) {
  const record = asRecord(value);
  if (!record) return null;

  const url = cleanText(
    record.url ||
      record.publicUrl ||
      record.src ||
      record.downloadUrl ||
      record.signed_url,
    1200,
  );
  const storagePath = cleanText(
    record.storagePath || record.storage_path || record.path,
    900,
  );
  if (!url && !storagePath) return null;

  const mimeType =
    cleanText(record.mimeType || record.mime_type || record.type, 160) ||
    "application/octet-stream";
  const rawKind = cleanText(
    record.kind || record.mediaKind || record.mediaType || record.media_type,
    24,
  ).toLowerCase();
  const kind =
    rawKind === "video" || mimeType.startsWith("video/")
      ? "video"
      : rawKind === "image" || mimeType.startsWith("image/")
        ? "image"
        : null;
  if (!kind) return null;

  const size = Number(
    record.size ?? record.sizeBytes ?? record.size_bytes ?? 0,
  );

  if (
    kind === "image" &&
    Number.isFinite(size) &&
    size > MAX_AGENT_IMAGE_BYTES
  ) {
    return null;
  }
  if (
    kind === "video" &&
    Number.isFinite(size) &&
    size > MAX_AGENT_VIDEO_BYTES
  ) {
    return null;
  }

  const videoSettings = asRecord(record.videoSettings) || null;
  const videoSettingsByChannel =
    asRecord(record.videoSettingsByChannel) || null;
  const transformedVariants = Array.isArray(record.transformedVariants)
    ? record.transformedVariants.filter(Boolean).slice(0, 12)
    : [];

  return {
    id: cleanText(record.id, 160) || null,
    bucket:
      cleanText(
        record.bucket || record.bucketName || record.bucket_name,
        120,
      ) || "booster",
    path: storagePath,
    storagePath,
    publicUrl: url,
    url,
    name:
      cleanText(
        record.name || record.filename || record.fileName || record.title,
        240,
      ) ||
      storagePath.split("/").pop() ||
      "media",
    title:
      cleanText(record.title || record.name || record.filename, 240) ||
      storagePath.split("/").pop() ||
      "media",
    type: mimeType,
    mimeType,
    size: Number.isFinite(size) && size > 0 ? size : null,
    width: Number(record.width ?? 0) > 0 ? Math.round(Number(record.width)) : null,
    height:
      Number(record.height ?? 0) > 0 ? Math.round(Number(record.height)) : null,
    duration: Number(record.duration ?? record.duration_seconds ?? 0) || null,
    duration_seconds:
      Number(record.duration ?? record.duration_seconds ?? 0) || null,
    kind,
    mediaType: kind,
    source: cleanText(record.source, 120) || null,
    ...(kind === "video" && videoSettings ? { videoSettings } : {}),
    ...(kind === "video" && videoSettingsByChannel
      ? { videoSettingsByChannel }
      : {}),
    ...(kind === "video"
      ? {
          videoFormat: cleanText(record.videoFormat, 40) || null,
          videoAdaptationMode:
            cleanText(record.videoAdaptationMode, 40) || null,
          transformedVariants,
        }
      : {}),
  };
}

export function buildPublishMediaReadiness(
  channel: PublishChannelKey,
  media: ReturnType<typeof cleanPublishMedia>,
) {
  if (!media) {
    return publishChannelRequiresMedia(channel)
      ? {
          status: "blocked",
          ready: false,
          blockers: ["Ce canal exige un média."],
        }
      : { status: "ready", ready: true, blockers: [] };
  }

  if (publishChannelRequiresVideo(channel) && media.kind !== "video") {
    return {
      status: "blocked",
      ready: false,
      blockers: ["Ce canal exige une vidéo."],
    };
  }

  return {
    status: media.kind === "video" ? "ready_with_video" : "ready_with_image",
    ready: true,
    publishable: true,
    blockers: [],
    reason:
      media.kind === "video"
        ? "Vidéo prête pour ce canal."
        : "Image prête pour ce canal.",
  };
}

export function buildPublishMediaAdaptation(
  channel: PublishChannelKey,
  media: ReturnType<typeof cleanPublishMedia>,
) {
  const channelLabel = channel;
  if (!media) {
    return {
      channel,
      channelLabel,
      mediaType: "none",
      strategy: "text_only",
      userEditable: false,
      note: "Aucun média à adapter pour ce canal.",
    };
  }

  if (media.kind === "video") {
    return {
      channel,
      channelLabel,
      mediaType: "video",
      strategy: "booster_video_format",
      userEditable: true,
      note: "iNr’Agent garde la vidéo source et Booster prépare le format compatible au moment de publier.",
    };
  }

  return {
    channel,
    channelLabel,
    mediaType: "image",
    strategy: "booster_image_adapter",
    userEditable: true,
    note: "iNr’Agent garde l’image source et Booster génère une version adaptée au canal sans modifier l’original.",
  };
}


export type PublishDraftMedia = ReturnType<typeof cleanPublishMedia>;

export function publishCanRunWithoutMedia(channel: PublishChannelKey) {
  return ["inrcy_site", "site_web", "inr_search", "gmb", "facebook", "linkedin"].includes(
    channel,
  );
}

export function normalizePublishChannels(input: unknown): PublishChannelKey[] {
  const raw = Array.isArray(input) ? input : [];
  return Array.from(
    new Set(
      raw
        .map((item) => cleanPublishChannel(item))
        .filter((item): item is PublishChannelKey => Boolean(item)),
    ),
  );
}

export function cleanBoosterPost(value: unknown, fallbackText: string) {
  const record = asRecord(value) || {};
  const content = cleanText(
    record.content || record.text || record.body || record.message,
    6000,
  );
  const title = cleanText(record.title || record.subject, 180);
  const cta = cleanText(record.cta || record.callToAction, 180);
  const ctaModeRaw = cleanText(record.ctaMode, 24);
  const ctaMode = ["none", "website", "call", "message", "custom"].includes(
    ctaModeRaw,
  )
    ? ctaModeRaw
    : "none";
  const hashtags = cleanPublishHashtags(record.hashtags);
  return {
    ...record,
    title,
    subject: title,
    content: content || title || cleanText(fallbackText, 1200),
    text: content || title || cleanText(fallbackText, 1200),
    body: content || title || cleanText(fallbackText, 1200),
    cta,
    callToAction: cta,
    ctaMode,
    ctaUrl: cleanText(record.ctaUrl, 320),
    ctaPhone: cleanText(record.ctaPhone, 60),
    hashtags,
  };
}

export function fileExtensionFromMimeOrPath(mimeType: string, storagePath: string) {
  const mime = String(mimeType || "").toLowerCase();
  if (mime.includes("png")) return "png";
  if (mime.includes("webp")) return "webp";
  if (mime.includes("gif")) return "gif";
  if (mime.includes("quicktime")) return "mov";
  if (mime.includes("webm")) return "webm";
  if (mime.includes("mp4")) return "mp4";
  const fromPath = String(storagePath || "")
    .split(/[?#]/)[0]
    .split(".")
    .pop()
    ?.toLowerCase();
  if (
    fromPath &&
    /^[a-z0-9]{2,5}$/.test(fromPath) &&
    !fromPath.includes("/")
  ) {
    if (fromPath === "jpeg") return "jpg";
    if (fromPath === "m4v") return "mp4";
    return fromPath;
  }
  return mime.startsWith("video/") ? "mp4" : "jpg";
}
