import type { BoosterVideoChannelKey } from "./boosterVideoSettings.ts";
import {
  INR_MEDIA_VIDEO_SOURCE_MAX_BYTES,
  INR_MEDIA_VIDEO_SOURCE_MAX_MB_LABEL,
  INR_MEDIA_VIDEO_TOO_LARGE_MESSAGE,
} from "./mediaRules.ts";
import { canPublishVideoSourceDirectly } from "./mediaVideoSourceCompatibility.ts";
import {
  GOOGLE_BUSINESS_VIDEO_MAX_DURATION_SECONDS,
  GOOGLE_BUSINESS_VIDEO_MIN_SHORT_EDGE,
  GOOGLE_BUSINESS_VIDEO_MAX_BYTES,
} from "./googleBusinessMediaPolicy.ts";

export type YoutubeLongUploadsStatus =
  | "allowed"
  | "eligible"
  | "disallowed"
  | "unknown";

export type VideoPublicationPolicy = {
  channel: BoosterVideoChannelKey;
  maxBytes: number;
  maxBytesLabel: string;
  minDurationSeconds: number | null;
  maxDurationSeconds: number | null;
  minShortEdgePixels: number | null;
  requiresMp4: boolean;
};

export type VideoDurationFailureReason =
  | "video_duration_unknown"
  | "video_duration_too_short"
  | "video_duration_too_long"
  | "video_duration_account_limit_unknown"
  | "video_duration_long_upload_not_allowed";

export type VideoDurationValidation =
  | {
      ok: true;
      policy: VideoPublicationPolicy;
      durationSeconds: number | null;
      rule: string | null;
    }
  | {
      ok: false;
      policy: VideoPublicationPolicy;
      reason: VideoDurationFailureReason;
      message: string;
      durationSeconds: number | null;
      rule: string;
    };

export type VideoPublicationValidation =
  | { ok: true; policy: VideoPublicationPolicy }
  | {
      ok: false;
      policy: VideoPublicationPolicy;
      reason:
        | "video_size_unknown"
        | "video_too_large"
        | "video_format_invalid"
        | VideoDurationFailureReason
        | "video_resolution_unknown"
        | "video_resolution_too_small";
      message: string;
    };

export const VIDEO_CHANNEL_LABELS: Record<BoosterVideoChannelKey, string> = {
  inrcy_site: "Site iNrCy",
  site_web: "Site web",
  inr_search: "iNr'Search",
  gmb: "Google Business",
  facebook: "Facebook",
  instagram: "Instagram",
  linkedin: "LinkedIn",
  x: "X",
  tiktok: "TikTok",
  youtube_shorts: "YouTube",
  pinterest: "Pinterest",
};

const DEFAULT_POLICY = {
  maxBytes: INR_MEDIA_VIDEO_SOURCE_MAX_BYTES,
  maxBytesLabel: INR_MEDIA_VIDEO_SOURCE_MAX_MB_LABEL,
  minDurationSeconds: null,
  maxDurationSeconds: null,
  minShortEdgePixels: null,
  requiresMp4: true,
} as const;

export const PINTEREST_VIDEO_MAX_DURATION_SECONDS = 15 * 60;
export const TIKTOK_VIDEO_TECHNICAL_MAX_DURATION_SECONDS = 10 * 60;
export const YOUTUBE_SHORT_MAX_DURATION_SECONDS = 3 * 60;
export const YOUTUBE_LONG_UPLOAD_THRESHOLD_SECONDS = 15 * 60;
export const YOUTUBE_VIDEO_MAX_DURATION_SECONDS = 12 * 60 * 60;

/**
 * Compatibilité avec les anciens consommateurs. Les nouvelles interfaces
 * utilisent `validateVideoDurationForChannel`, qui ajoute la durée réelle et
 * la règle complète du canal.
 */
export const PINTEREST_VIDEO_TOO_LONG_MESSAGE =
  "Vidéo de plus de 15 minutes non autorisée sur une épingle vidéo Pinterest standard.";

/**
 * Booster accepte un original MP4/M4V/MOV H.264/AAC compatible jusqu'à 75 Mo. Les
 * adaptations de cadrage explicitement choisies restent isolées par canal.
 * La durée n'est jamais coupée silencieusement : elle est contrôlée par canal.
 */
export const VIDEO_PUBLICATION_POLICY_BY_CHANNEL: Record<
  BoosterVideoChannelKey,
  VideoPublicationPolicy
> = {
  inrcy_site: { channel: "inrcy_site", ...DEFAULT_POLICY },
  site_web: { channel: "site_web", ...DEFAULT_POLICY },
  inr_search: { channel: "inr_search", ...DEFAULT_POLICY },
  gmb: {
    channel: "gmb",
    ...DEFAULT_POLICY,
    maxBytes: GOOGLE_BUSINESS_VIDEO_MAX_BYTES,
    maxBytesLabel: "75 Mo",
    maxDurationSeconds: GOOGLE_BUSINESS_VIDEO_MAX_DURATION_SECONDS,
    minShortEdgePixels: GOOGLE_BUSINESS_VIDEO_MIN_SHORT_EDGE,
  },
  facebook: {
    channel: "facebook",
    ...DEFAULT_POLICY,
    maxDurationSeconds: 4 * 60 * 60,
  },
  instagram: {
    channel: "instagram",
    ...DEFAULT_POLICY,
    minDurationSeconds: 3,
    maxDurationSeconds: 15 * 60,
  },
  linkedin: {
    channel: "linkedin",
    ...DEFAULT_POLICY,
    minDurationSeconds: 3,
    maxDurationSeconds: 30 * 60,
  },
  x: { channel: "x", ...DEFAULT_POLICY },
  tiktok: {
    channel: "tiktok",
    ...DEFAULT_POLICY,
    // Le plafond du compte renvoyé par creator-info peut être inférieur.
    maxDurationSeconds: TIKTOK_VIDEO_TECHNICAL_MAX_DURATION_SECONDS,
  },
  youtube_shorts: {
    channel: "youtube_shorts",
    ...DEFAULT_POLICY,
    maxDurationSeconds: YOUTUBE_VIDEO_MAX_DURATION_SECONDS,
  },
  pinterest: {
    channel: "pinterest",
    ...DEFAULT_POLICY,
    minDurationSeconds: 4,
    maxDurationSeconds: PINTEREST_VIDEO_MAX_DURATION_SECONDS,
  },
};

export function getVideoPublicationPolicy(
  channel: BoosterVideoChannelKey,
): VideoPublicationPolicy {
  return VIDEO_PUBLICATION_POLICY_BY_CHANNEL[channel];
}

function positiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

export function formatVideoDuration(secondsValue: unknown) {
  const seconds = positiveNumber(secondsValue);
  if (seconds === null) return "durée inconnue";
  const rounded = Math.max(1, Math.round(seconds));
  const hours = Math.floor(rounded / 3600);
  const minutes = Math.floor((rounded % 3600) / 60);
  const remainingSeconds = rounded % 60;
  const parts: string[] = [];
  if (hours) parts.push(`${hours} h`);
  if (minutes) parts.push(`${minutes} min`);
  if (remainingSeconds || !parts.length) parts.push(`${remainingSeconds} s`);
  return parts.join(" ");
}

function formatFriendlyDurationLimit(seconds: number) {
  if (Number.isInteger(seconds / 60)) {
    const minutes = seconds / 60;
    return `${minutes} minute${minutes > 1 ? "s" : ""}`;
  }
  return formatVideoDuration(seconds);
}

export function normalizeYoutubeLongUploadsStatus(
  value: unknown,
): YoutubeLongUploadsStatus {
  const normalized = String(value || "").trim().toLowerCase();
  if (
    normalized === "allowed" ||
    normalized === "eligible" ||
    normalized === "disallowed"
  ) {
    return normalized;
  }
  return "unknown";
}

function getEffectiveTiktokMaxDurationSeconds(value: unknown) {
  const accountMax = positiveNumber(value);
  return accountMax === null
    ? TIKTOK_VIDEO_TECHNICAL_MAX_DURATION_SECONDS
    : Math.min(accountMax, TIKTOK_VIDEO_TECHNICAL_MAX_DURATION_SECONDS);
}

export function getVideoDurationRuleDescription(input: {
  channel: BoosterVideoChannelKey;
  tiktokMaxDurationSeconds?: unknown;
}) {
  switch (input.channel) {
    case "gmb":
      return "30 secondes maximum.";
    case "facebook":
      return "4 heures maximum.";
    case "instagram":
      return "entre 3 secondes et 15 minutes.";
    case "linkedin":
      return "entre 3 secondes et 30 minutes.";
    case "tiktok": {
      const max = getEffectiveTiktokMaxDurationSeconds(
        input.tiktokMaxDurationSeconds,
      );
      return input.tiktokMaxDurationSeconds == null
        ? "10 minutes maximum."
        : `${formatVideoDuration(max)} maximum.`;
    }
    case "youtube_shorts":
      return "jusqu’à 3 minutes : Short automatique ; au-delà : vidéo classique ; au-delà de 15 minutes : vidéos longues autorisées sur la chaîne ; 12 heures maximum.";
    case "pinterest":
      return "entre 4 secondes et 15 minutes pour une épingle vidéo standard ; la limite de 5 minutes concerne les Idea Ads.";
    default:
      return null;
  }
}

export function validateVideoDurationForChannel(input: {
  channel: BoosterVideoChannelKey;
  durationSeconds?: unknown;
  tiktokMaxDurationSeconds?: unknown;
  tiktokAccountLimitVerified?: boolean;
  youtubeLongUploadsStatus?: unknown;
  enforceAccountCapabilities?: boolean;
}): VideoDurationValidation {
  const policy = getVideoPublicationPolicy(input.channel);
  const label = VIDEO_CHANNEL_LABELS[input.channel];
  const durationSeconds = positiveNumber(input.durationSeconds);
  const rule = getVideoDurationRuleDescription(input);
  const hasDurationConstraint =
    policy.minDurationSeconds !== null || policy.maxDurationSeconds !== null;

  if (!hasDurationConstraint) {
    return { ok: true, policy, durationSeconds, rule };
  }

  if (durationSeconds === null) {
    return {
      ok: false,
      policy,
      reason: "video_duration_unknown",
      message: `${label} bloqué — la durée de la vidéo n’a pas pu être vérifiée. Règle ${label} : ${rule}`,
      durationSeconds,
      rule: rule || "durée à vérifier avant publication.",
    };
  }

  const effectiveMax =
    input.channel === "tiktok"
      ? getEffectiveTiktokMaxDurationSeconds(input.tiktokMaxDurationSeconds)
      : policy.maxDurationSeconds;

  if (
    policy.minDurationSeconds !== null &&
    durationSeconds < policy.minDurationSeconds
  ) {
    return {
      ok: false,
      policy,
      reason: "video_duration_too_short",
      message: `${label} bloqué — cette vidéo dure ${formatVideoDuration(durationSeconds)}. Règle ${label} : ${rule}`,
      durationSeconds,
      rule: rule || "durée minimale non respectée.",
    };
  }

  if (effectiveMax !== null && durationSeconds > effectiveMax) {
    const message =
      input.channel === "tiktok"
        ? `Cette vidéo est trop longue pour TikTok. Choisissez une vidéo de ${formatFriendlyDurationLimit(effectiveMax)} maximum.`
        : `${label} bloqué — cette vidéo dure ${formatVideoDuration(durationSeconds)}. Règle ${label} : ${rule}`;
    return {
      ok: false,
      policy,
      reason: "video_duration_too_long",
      message,
      durationSeconds,
      rule: rule || "durée maximale dépassée.",
    };
  }

  if (
    input.channel === "tiktok" &&
    input.enforceAccountCapabilities === true &&
    input.tiktokAccountLimitVerified === false
  ) {
    return {
      ok: false,
      policy,
      reason: "video_duration_account_limit_unknown",
      message: "La limite de durée TikTok n’a pas pu être vérifiée. Actualisez la page puis réessayez.",
      durationSeconds,
      rule: rule || "limite du compte à vérifier avant publication.",
    };
  }

  if (
    input.channel === "youtube_shorts" &&
    durationSeconds > YOUTUBE_LONG_UPLOAD_THRESHOLD_SECONDS &&
    input.enforceAccountCapabilities === true
  ) {
    const status = normalizeYoutubeLongUploadsStatus(
      input.youtubeLongUploadsStatus,
    );
    if (status === "unknown") {
      return {
        ok: false,
        policy,
        reason: "video_duration_account_limit_unknown",
        message: `YouTube bloqué — cette vidéo dure ${formatVideoDuration(durationSeconds)} et dépasse 15 minutes. Règle YouTube : les vidéos longues doivent être autorisées sur la chaîne. iNrCy n’a pas pu vérifier cette autorisation ; actualisez puis réessayez.`,
        durationSeconds,
        rule: rule || "autorisation des vidéos longues requise.",
      };
    }
    if (status !== "allowed") {
      return {
        ok: false,
        policy,
        reason: "video_duration_long_upload_not_allowed",
        message: `YouTube bloqué — cette vidéo dure ${formatVideoDuration(durationSeconds)} et dépasse 15 minutes. Règle YouTube : les vidéos longues doivent être autorisées sur la chaîne ; cette chaîne ne les autorise pas actuellement.`,
        durationSeconds,
        rule: rule || "autorisation des vidéos longues requise.",
      };
    }
  }

  return { ok: true, policy, durationSeconds, rule };
}

export function getYoutubePublicationTypeForDuration(durationSeconds: unknown) {
  const duration = positiveNumber(durationSeconds);
  return duration !== null && duration <= YOUTUBE_SHORT_MAX_DURATION_SECONDS
    ? ("short" as const)
    : ("video" as const);
}

export function validateVideoPublicationForChannel(input: {
  channel: BoosterVideoChannelKey;
  name?: unknown;
  type?: unknown;
  mimeType?: unknown;
  storagePath?: unknown;
  sizeBytes?: unknown;
  durationSeconds?: unknown;
  width?: unknown;
  height?: unknown;
  tiktokMaxDurationSeconds?: unknown;
  tiktokAccountLimitVerified?: boolean;
  youtubeLongUploadsStatus?: unknown;
  enforceAccountCapabilities?: boolean;
  videoCodec?: unknown;
  audioCodec?: unknown;
  frameRate?: unknown;
  fps?: unknown;
  hasAudio?: unknown;
  containerFormats?: unknown;
  pixelFormat?: unknown;
  /** Ã€ activer uniquement pour le binaire source original. */
  requireCodecProof?: boolean;
}): VideoPublicationValidation {
  const policy = getVideoPublicationPolicy(input.channel);
  const label = VIDEO_CHANNEL_LABELS[input.channel];
  const durationValidation = validateVideoDurationForChannel(input);

  // La durée est non récupérable : on la contrôle avant d'essayer de convertir
  // le poids, le codec ou les dimensions.
  if (!durationValidation.ok) {
    return {
      ok: false,
      policy,
      reason: durationValidation.reason,
      message: durationValidation.message,
    };
  }

  const sizeBytes = Number(input.sizeBytes || 0);
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return {
      ok: false,
      policy,
      reason: "video_size_unknown",
      message: `La taille de la vidéo ${label} est inconnue. Relancez sa préparation.`,
    };
  }

  if (sizeBytes > policy.maxBytes) {
    return {
      ok: false,
      policy,
      reason: "video_too_large",
      message: INR_MEDIA_VIDEO_TOO_LARGE_MESSAGE,
    };
  }

  if (
    policy.requiresMp4 &&
    !canPublishVideoSourceDirectly({
      name: input.name,
      type: input.type,
      mimeType: input.mimeType,
      storagePath: input.storagePath,
      sizeBytes,
      maxBytes: policy.maxBytes,
      videoCodec: input.videoCodec,
      audioCodec: input.audioCodec,
      frameRate: input.frameRate ?? input.fps,
      hasAudio: input.hasAudio,
      containerFormats: input.containerFormats,
      pixelFormat: input.pixelFormat,
      requireCodecProof: input.requireCodecProof === true,
    })
  ) {
    return {
      ok: false,
      policy,
      reason: "video_format_invalid",
      message: `La vidéo ${label} doit être préparée en MP4 compatible avant publication.`,
    };
  }

  if (policy.minShortEdgePixels !== null) {
    const width = positiveNumber(input.width);
    const height = positiveNumber(input.height);
    if (width === null || height === null) {
      return {
        ok: false,
        policy,
        reason: "video_resolution_unknown",
        message: `La résolution de la vidéo ${label} est inconnue. Relancez sa préparation.`,
      };
    }
    if (Math.min(width, height) < policy.minShortEdgePixels) {
      return {
        ok: false,
        policy,
        reason: "video_resolution_too_small",
        message: `La vidéo ${label} doit atteindre au moins ${policy.minShortEdgePixels} px sur son côté court.`,
      };
    }
  }

  return { ok: true, policy };
}
