import "server-only";

import {
  prepareBoosterVideoVariantsOnServer,
  probeStoredBoosterVideoForPublication,
} from "@/lib/boosterVideoVariantServer";
import {
  getVariantForChannel,
  type BoosterVideoTransformedVariant,
} from "@/lib/boosterVideoTransforms";
import { normalizeChannelVideoSettings } from "@/lib/boosterVideoSettings";
import {
  getGoogleBusinessVideoPreparationDecision,
  GOOGLE_BUSINESS_VIDEO_PROFILE,
} from "@/lib/googleBusinessMediaPolicy";
import { validateVideoPublicationForChannel } from "@/lib/videoPublicationPolicy";

type JsonRecord = Record<string, unknown>;

export type InrSendGoogleBusinessVideo = {
  name: string;
  type: string;
  size: number;
  duration: number | null;
  url: string;
  publicUrl: string;
  bucket: string | null;
  storagePath: string | null;
  thumbnailUrl: string | null;
  thumbnailStoragePath?: string | null;
  thumbnailBucket?: string | null;
  sourceMetadata?: unknown;
  sourceVideo?: unknown;
  transformedVariants?: unknown[];
  transformedVariant?: unknown;
  videoSettings?: unknown;
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function positiveNumber(value: unknown) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

function buildVariantAttachment(params: {
  currentVideo: InrSendGoogleBusinessVideo;
  sourceVideo: InrSendGoogleBusinessVideo;
  variant: BoosterVideoTransformedVariant;
  allVariants: readonly BoosterVideoTransformedVariant[];
}): InrSendGoogleBusinessVideo {
  const { currentVideo, sourceVideo, variant, allVariants } = params;
  const canonicalSource = {
    ...sourceVideo,
    sourceVideo: null,
    transformedVariant: null,
  };
  return {
    ...currentVideo,
    name: variant.name || currentVideo.name || "video-google-business.mp4",
    type: variant.contentType || "video/mp4",
    size: Number(variant.size || 0),
    duration: variant.duration ?? sourceVideo.duration ?? null,
    url: variant.publicUrl,
    publicUrl: variant.publicUrl,
    bucket: "booster",
    storagePath: variant.storagePath,
    sourceMetadata: {
      ...asRecord(currentVideo.sourceMetadata),
      width: variant.width ?? null,
      height: variant.height ?? null,
      duration: variant.duration ?? sourceVideo.duration ?? null,
      compatibilityProof: "canonical_derivative",
    },
    sourceVideo: canonicalSource,
    transformedVariant: variant,
    transformedVariants: Array.from(
      new Map(
        [
          ...(currentVideo.transformedVariants || []),
          ...allVariants,
        ]
          .filter(
            (candidate): candidate is BoosterVideoTransformedVariant =>
              Boolean(candidate && typeof candidate === "object"),
          )
          .map((candidate) => [candidate.signature, candidate]),
      ).values(),
    ),
  };
}

/**
 * Guarantees that an iNr'Send replacement aimed at Google Business keeps a
 * publishable video. Legacy publications and newly selected files can still
 * contain the source rather than the dedicated Google derivative; in that
 * case this function prepares the 720 px MP4 variant before the former post is
 * replaced. The source is never silently trimmed when it exceeds 30 seconds.
 */
export async function prepareInrSendGoogleBusinessVideo(params: {
  accountId: string;
  video: InrSendGoogleBusinessVideo;
  videoSettings?: unknown;
}): Promise<InrSendGoogleBusinessVideo> {
  const settings = normalizeChannelVideoSettings(
    "gmb",
    params.videoSettings || params.video.videoSettings,
  );
  const storagePath = String(params.video.storagePath || "").trim();
  if (!storagePath) {
    throw new Error(
      "La vidéo Google Business doit être réimportée dans iNrCy avant sa préparation automatique : sa référence de stockage sécurisée est absente.",
    );
  }

  // The client payload is not proof of ownership, duration or resolution.
  // Re-attest the exact stored object server-side before deciding whether it
  // can be sent directly or must be converted. In particular, never follow a
  // nested sourceVideo/public URL supplied by the browser here.
  const attested = await probeStoredBoosterVideoForPublication({
    accountId: params.accountId,
    bucket: params.video.bucket,
    storagePath,
  });
  const sourceMetadata = {
    ...asRecord(params.video.sourceMetadata),
    width: attested.width,
    height: attested.height,
    duration: attested.duration,
    videoCodec: attested.videoCodec,
    audioCodec: attested.audioCodec,
    frameRate: attested.frameRate,
    hasAudio: attested.hasAudio,
    containerFormats: attested.containerFormats,
    pixelFormat: attested.pixelFormat,
    compatibilityProof: attested.compatibilityProof,
  };
  const sourceVideo: InrSendGoogleBusinessVideo = {
    ...params.video,
    size: attested.sizeBytes,
    duration: attested.duration,
    url: attested.publicUrl,
    publicUrl: attested.publicUrl,
    bucket: attested.bucket,
    storagePath: attested.storagePath,
    sourceMetadata,
  };
  const sourceValidation = validateVideoPublicationForChannel({
    channel: "gmb",
    name: sourceVideo.name,
    type: sourceVideo.type,
    storagePath: sourceVideo.storagePath,
    sizeBytes: sourceVideo.size,
    durationSeconds: sourceVideo.duration,
    width: sourceMetadata.width,
    height: sourceMetadata.height,
  });

  const decision = getGoogleBusinessVideoPreparationDecision({
    name: sourceVideo.name,
    type: sourceVideo.type,
    storagePath: sourceVideo.storagePath,
    sizeBytes: sourceVideo.size,
    durationSeconds: sourceVideo.duration,
    width: sourceMetadata.width,
    height: sourceMetadata.height,
    videoCodec: sourceMetadata.videoCodec,
    audioCodec: sourceMetadata.audioCodec,
    frameRate: sourceMetadata.frameRate,
    hasAudio: sourceMetadata.hasAudio,
    containerFormats: sourceMetadata.containerFormats,
    pixelFormat: sourceMetadata.pixelFormat,
  });
  if (decision.action === "block") {
    throw new Error(decision.errorMessage);
  }
  if (decision.action === "direct" && sourceValidation.ok) {
    return sourceVideo;
  }

  const prepared = await prepareBoosterVideoVariantsOnServer({
    accountId: params.accountId,
    generateMissing: true,
    trustedSourceCompatibilityProof: true,
    source: {
      bucket: sourceVideo.bucket,
      storagePath: sourceVideo.storagePath,
      publicUrl: sourceVideo.publicUrl,
      url: sourceVideo.url,
      name: sourceVideo.name,
      type: sourceVideo.type,
      size: sourceVideo.size,
      duration: sourceVideo.duration,
      sourceMetadata: sourceMetadata as any,
    },
    variants: [
      {
        key: `inrsend-gmb-${settings.format}-${settings.adaptationMode}`,
        channel: "gmb",
        format: settings.format,
        adaptationMode: settings.adaptationMode,
        publicationProfile: GOOGLE_BUSINESS_VIDEO_PROFILE,
      },
    ],
  });
  const variant = getVariantForChannel(
    prepared.variants,
    "gmb",
    settings.format,
    settings.adaptationMode,
  );
  if (!variant?.publicUrl || !variant.storagePath) {
    const detail = prepared.errors
      .map((entry) => String(entry.message || "").trim())
      .filter(Boolean)
      .join(" ")
      .slice(0, 1_200);
    throw new Error(
      [
        "Google Business n’a pas reçu la vidéo : iNrCy n’a pas pu préparer sa variante MP4 d’au moins 720 px.",
        detail,
      ]
        .filter(Boolean)
        .join(" "),
    );
  }

  const validation = validateVideoPublicationForChannel({
    channel: "gmb",
    name: variant.name || "video-google-business.mp4",
    type: variant.contentType,
    storagePath: variant.storagePath,
    sizeBytes: variant.size,
    durationSeconds: variant.duration ?? sourceVideo.duration,
    width: variant.width,
    height: variant.height,
  });
  if (!validation.ok) throw new Error(validation.message);

  return buildVariantAttachment({
    currentVideo: params.video,
    sourceVideo,
    variant,
    allVariants: prepared.variants,
  });
}
