import { INR_SEARCH_CONTENT_MAX_LENGTH } from "@/lib/boosterChannelRules";
import {
  stripSiteTextFormattingForEditor,
  stripSiteTextFormattingPreserveLayout,
} from "@/lib/boosterFormatting";
import type { TiktokPublicationSettings } from "./components/TiktokPublicationSettingsModal";
import {
  BOOSTER_CHANNEL_ORDER,
  STYLE_OPTIONS,
  THEME_OPTIONS,
  extractVideoFramesForAI,
  isSiteDisplayKey,
  normalizePost,
  type BoosterVideoSourceMetadata,
  type ChannelKey,
  type ChannelPost,
  type StyleKey,
  type ThemeKey,
} from "./publishModal.shared";

export type ChannelConnectionDetail = {
  type?: string | null;
  label?: string | null;
  href?: string | null;
  connectionStatus?: string | null;
  requiresReconnect?: boolean;
  disabled?: boolean;
  availabilityError?: boolean;
};

export type PinterestBoardOption = {
  id: string;
  name: string;
};

export type PendingImmediatePublishAfterSchedule = {
  immediateChannels: ChannelKey[];
  preparedPostsByChannel: Partial<Record<ChannelKey, ChannelPost>>;
  tiktokSettingsForSchedule: TiktokPublicationSettings | null;
};

export const EMPTY_CHANNEL_DETAILS: Record<ChannelKey, ChannelConnectionDetail> = {
  inrcy_site: { type: "url", label: null, href: null },
  site_web: { type: "url", label: null, href: null },
  inr_search: { type: "page", label: null, href: null },
  gmb: { type: "location", label: null, href: null },
  facebook: { type: "page", label: null, href: null },
  instagram: { type: "account", label: null, href: null },
  linkedin: { type: "profile", label: null, href: null },
  tiktok: { type: "account", label: null, href: null },
  youtube_shorts: { type: "channel", label: null, href: null },
  pinterest: { type: "board", label: null, href: null },
};

export const AI_CONFIGURATION_STORAGE_KEY = "inrcy_ai_configuration";

export const CHANNEL_KEYS: ChannelKey[] = BOOSTER_CHANNEL_ORDER;

export function isChannelKey(value: unknown): value is ChannelKey {
  return CHANNEL_KEYS.includes(String(value || "") as ChannelKey);
}

export function isThemeKey(value: unknown): value is ThemeKey {
  const raw = String(value || "");
  return raw === "" || THEME_OPTIONS.some((option) => option.value === raw);
}

export function isStyleKey(value: unknown): value is StyleKey {
  const raw = String(value || "");
  return STYLE_OPTIONS.some((option) => option.value === raw);
}

export function normalizeExternalHref(input: unknown) {
  const raw = String(input || "").trim();
  if (!raw) return "";
  if (/^(https?:)?\/\//i.test(raw))
    return raw.startsWith("//") ? `https:${raw}` : raw;
  if (/^www\./i.test(raw)) return `https://${raw}`;
  if (/^[a-z0-9.-]+\.[a-z]{2,}(?:[/:?#].*)?$/i.test(raw))
    return `https://${raw}`;
  return raw;
}

export function truncateText(value: unknown, max = 32) {
  const text = String(value || "").trim();
  if (!text || text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trimEnd()}…`;
}

export function decodeChannelDisplayText(value: unknown) {
  let text = String(value || "").trim();
  if (!text) return "";
  text = text.replace(/\+/g, " ");
  for (let i = 0; i < 2; i += 1) {
    if (!/%[0-9a-f]{2}/i.test(text)) break;
    try {
      const decoded = decodeURIComponent(text);
      if (decoded === text) break;
      text = decoded;
    } catch {
      break;
    }
  }
  return text.replace(/\s+/g, " ").trim();
}

export function titleCaseChannelDisplayName(value: string) {
  const text = decodeChannelDisplayText(value)
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!text) return "";
  if (/[A-ZÀ-ÖØ-Þ]/.test(text)) return text;
  return text
    .split(" ")
    .map((part) =>
      part ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : part,
    )
    .join(" ");
}

export function normalizeChannelDisplayUrl(input: unknown) {
  const raw = decodeChannelDisplayText(input);
  if (!raw) return null;
  const candidate = /^(https?:)?\/\//i.test(raw)
    ? raw.startsWith("//")
      ? `https:${raw}`
      : raw
    : /^www\./i.test(raw) || /^[a-z0-9.-]+\.[a-z]{2,}(?:[/:?#].*)?$/i.test(raw)
      ? `https://${raw}`
      : "";
  if (!candidate) return null;
  try {
    return new URL(candidate);
  } catch {
    return null;
  }
}

export function firstChannelPathPart(url: URL, ignored: string[] = []) {
  const ignoredSet = new Set(ignored.map((part) => part.toLowerCase()));
  const parts = url.pathname
    .split("/")
    .map((part) => decodeChannelDisplayText(part))
    .filter(Boolean)
    .filter((part) => !ignoredSet.has(part.toLowerCase()));
  return parts[parts.length - 1] || "";
}

export function looksLikeTechnicalChannelLabel(value: string) {
  const text = decodeChannelDisplayText(value).trim();
  if (!text) return true;
  if (/^urn:/i.test(text)) return true;
  if (/^(accounts\/[^/]+\/)?locations\/\d+$/i.test(text)) return true;
  if (/^\d{6,}$/.test(text)) return true;
  if (/^[a-z]{1,8}_[a-z0-9_-]{18,}$/i.test(text)) return true;
  return false;
}

export function cleanChannelBusinessLabel(input: unknown) {
  let text = decodeChannelDisplayText(input);
  if (!text) return "";

  const url = normalizeChannelDisplayUrl(text);
  if (url) {
    const host = url.hostname.replace(/^www\./i, "");
    if (/google\./i.test(host)) {
      text = decodeChannelDisplayText(
        url.searchParams.get("query") ||
          url.searchParams.get("q") ||
          firstChannelPathPart(url),
      );
    } else if (/facebook\.com$/i.test(host)) {
      text = firstChannelPathPart(url, ["pages", "profile.php", "people"]);
    } else if (/linkedin\.com$/i.test(host)) {
      text = firstChannelPathPart(url, ["company", "in", "showcase", "school"]);
    } else if (/youtube\.com$/i.test(host) || /youtu\.be$/i.test(host)) {
      text = firstChannelPathPart(url, ["channel", "c", "user"]);
    } else {
      const hostOnly = host;
      const path = url.pathname.replace(/^\/+|\/+$/g, "");
      return path ? `${hostOnly}/${decodeChannelDisplayText(path)}` : hostOnly;
    }
  }

  text = decodeChannelDisplayText(text)
    .replace(/^accounts\/[^/]+\/locations\//i, "")
    .replace(/^locations\//i, "")
    .replace(/^pages\//i, "")
    .replace(/^company\//i, "")
    .replace(/^in\//i, "")
    .replace(/^@+/, "")
    .trim();

  if (looksLikeTechnicalChannelLabel(text)) return "";
  if (/^https?:\/\//i.test(text)) return "";
  if (/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(text))
    return text.replace(/^www\./i, "");

  return titleCaseChannelDisplayName(text);
}

export function cleanChannelHandleLabel(input: unknown) {
  let text = decodeChannelDisplayText(input);
  if (!text) return "";
  const url = normalizeChannelDisplayUrl(text);
  if (url) {
    const host = url.hostname.replace(/^www\./i, "");
    if (/(^|\.)tiktok\.com$/i.test(host) && !/^\/@/i.test(url.pathname)) {
      return "";
    }
    text = firstChannelPathPart(url);
  }
  text = decodeChannelDisplayText(text)
    .replace(/^@+/, "")
    .replace(/^\/+|\/+$/g, "")
    .trim();
  if (!text || looksLikeTechnicalChannelLabel(text) || /\s/.test(text))
    return "";
  return `@${text}`;
}

export function simplifyChannelDetail(key: ChannelKey, value: unknown) {
  const raw = decodeChannelDisplayText(value);
  if (!raw) return "";
  if (key === "instagram" || key === "tiktok") {
    return cleanChannelHandleLabel(raw) || cleanChannelBusinessLabel(raw);
  }
  return cleanChannelBusinessLabel(raw);
}

export function sanitizePatchForEditor(
  channel: ChannelKey,
  patch: Partial<ChannelPost>,
): Partial<ChannelPost> {
  const next: Partial<ChannelPost> = { ...patch };
  if (!isSiteDisplayKey(channel)) {
    if (typeof next.title === "string")
      next.title = stripSiteTextFormattingForEditor(next.title);
    if (typeof next.content === "string")
      next.content = stripSiteTextFormattingPreserveLayout(next.content);
    if (typeof next.cta === "string")
      next.cta = stripSiteTextFormattingForEditor(next.cta);
  }
  if (channel === "inr_search" && typeof next.content === "string") {
    next.content = next.content.slice(0, INR_SEARCH_CONTENT_MAX_LENGTH).trim();
  }
  if (next.ctaUrl !== undefined) next.ctaUrl = String(next.ctaUrl || "");
  if (next.ctaPhone !== undefined) next.ctaPhone = String(next.ctaPhone || "");
  if (next.hashtags !== undefined) {
    next.hashtags = Array.isArray(next.hashtags)
      ? next.hashtags
          .map((tag) =>
            String(tag || "")
              .replace(/^#+/, "")
              .trim(),
          )
          .filter(Boolean)
          .slice(0, 20)
      : [];
  }
  return next;
}

export function sanitizePostForEditor(
  channel: ChannelKey,
  post?: Partial<ChannelPost> | null,
): ChannelPost {
  return normalizePost(
    sanitizePatchForEditor(
      channel,
      normalizePost(post),
    ) as Partial<ChannelPost>,
  );
}

export function sanitizePostsForEditor(
  raw: unknown,
): Partial<Record<ChannelKey, ChannelPost>> {
  const node =
    raw && typeof raw === "object" && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  return CHANNEL_KEYS.reduce(
    (acc, channel) => {
      if (node[channel] !== undefined)
        acc[channel] = sanitizePostForEditor(
          channel,
          node[channel] as Partial<ChannelPost>,
        );
      return acc;
    },
    {} as Partial<Record<ChannelKey, ChannelPost>>,
  );
}

export function buildVideoFileName(file: Pick<File, "name" | "type">) {
  const rawName =
    String(file?.name || "video-inrcy")
      .split(/[\\/]/)
      .pop() || "video-inrcy";
  if (/\.(mp4|m4v|mov)$/i.test(rawName)) return rawName;
  const extension = "mp4";
  return `${rawName.replace(/\.[^.]*$/, "")}.${extension}`;
}

export function buildMediaLibraryFileName(item: {
  media_type: "image" | "video";
  original_file_name?: string | null;
  storage_path?: string | null;
  title?: string | null;
  mime_type?: string | null;
}) {
  const originalName = String(item.original_file_name || "").trim();
  const storageName =
    String(item.storage_path || "")
      .replace(/\\/g, "/")
      .split("/")
      .pop() || "";
  const title = String(item.title || "").trim();
  const fallbackName =
    item.media_type === "video" ? "video-inrcy.mp4" : "image-inrcy.jpg";
  const candidate = originalName || storageName || title || fallbackName;

  if (item.media_type === "video") {
    // Le titre de MÃ©diathÃ¨que est un libellÃ© d'affichage et peut ne pas avoir
    // d'extension. Booster valide un vrai nom de fichier : on garantit donc
    // ici l'extension vidÃ©o avant de reconstruire le File du navigateur.
    return buildVideoFileName({
      name: candidate,
      type: item.mime_type || "video/mp4",
    });
  }

  return candidate;
}

export function buildVideoRatioLabel(width: number | null, height: number | null) {
  if (!width || !height) return "Ratio inconnu";
  const ratio = width / height;
  const candidates = [
    { label: "9:16", value: 9 / 16 },
    { label: "1:1", value: 1 },
    { label: "4:5", value: 4 / 5 },
    { label: "16:9", value: 16 / 9 },
    { label: "4:3", value: 4 / 3 },
  ];
  let closestLabel = "";
  let closestDistance = Number.POSITIVE_INFINITY;
  for (const item of candidates) {
    const distance = Math.abs(item.value - ratio);
    if (distance < closestDistance) {
      closestDistance = distance;
      closestLabel = item.label;
    }
  }
  return closestDistance <= 0.08 ? closestLabel : `${width}:${height}`;
}

export function buildVideoOrientation(
  width: number | null,
  height: number | null,
): BoosterVideoSourceMetadata["orientation"] {
  if (!width || !height) return "unknown";
  const delta = Math.abs(width - height) / Math.max(width, height);
  if (delta <= 0.06) return "square";
  return width > height ? "horizontal" : "vertical";
}

export function getVideoOrientationLabel(
  orientation: BoosterVideoSourceMetadata["orientation"],
) {
  if (orientation === "horizontal") return "Horizontale";
  if (orientation === "vertical") return "Verticale";
  if (orientation === "square") return "Carrée";
  return "Orientation inconnue";
}

export type VideoAudioTranscriptCache = {
  key: string;
  text: string;
  rawText: string;
};

export type VideoFramesForAI = Awaited<
  ReturnType<typeof extractVideoFramesForAI>
>;

export type VideoFramesPreparationCache = {
  key: string;
  promise: Promise<VideoFramesForAI>;
};

export type VideoAudioFilePreparationCache = {
  key: string;
  promise: Promise<File | null>;
};

export const VIDEO_TRANSCRIPTION_TIMEOUT_MS = 55_000;

// Une Function Vercel peut refuser un gros multipart avant même que la route
// Next.js ne puisse l'analyser. La vidéo complète n'est donc conservée qu'en
// secours pour les très petits fichiers ; le chemin normal envoie l'audio seul.
export const MAX_DIRECT_VIDEO_TRANSCRIBE_BYTES = 4 * 1024 * 1024;

export function makeVideoTranscriptCacheKey(file: File) {
  return `${file.name}__${file.size}__${file.lastModified}`;
}
