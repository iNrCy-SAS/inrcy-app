import { NextResponse } from "next/server";
import { enforceRateLimit } from "@/lib/rateLimit";
import { requireUser } from "@/lib/requireUser";
import {
  MediaWorkspaceConsumptionError,
  resolveWorkspacePublicationConsumption,
} from "@/lib/mediaWorkspaceConsumption";
import {
  prepareBoosterImagesByChannelOnServer,
} from "@/lib/boosterImageServerPreparation";
import { prepareBoosterVideoVariantsOnServer } from "@/lib/boosterVideoVariantServer";
import {
  buildVideoSettingsByChannel,
  getAutomaticVideoSettingsForPublication,
  isBoosterVideoChannelKey,
  type BoosterVideoChannelKey,
} from "@/lib/boosterVideoSettings";
import {
  buildVideoTransformSignature,
  getVideoPublicationProfileForChannel,
} from "@/lib/boosterVideoTransforms";
import { validateVideoPublicationForChannel } from "@/lib/videoPublicationPolicy";
import {
  getGoogleBusinessVideoPreparationDecision,
} from "@/lib/googleBusinessMediaPolicy";
import type { BoosterImageChannel } from "@/lib/boosterImageDecision";
import { createSafeStorageSignedUrl } from "@/lib/safeStorageSignedUrl";
import { isLegacyMediaTransportCutoverEnabled } from "@/lib/mediaPipelineLegacyCutoverPolicy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

const ALLOWED_CHANNELS = new Set<BoosterVideoChannelKey>([
  "inrcy_site",
  "site_web",
  "inr_search",
  "gmb",
  "facebook",
  "instagram",
  "linkedin",
  "x",
  "tiktok",
  "youtube_shorts",
  "pinterest",
]);

function allowsOriginalVideoFallback(channel: BoosterVideoChannelKey) {
  return ["inrcy_site", "site_web", "inr_search"].includes(channel);
}

function cleanText(value: unknown, max = 100) {
  return String(value || "").trim().slice(0, max);
}

function cleanChannels(value: unknown) {
  if (!Array.isArray(value)) return [] as BoosterVideoChannelKey[];
  return Array.from(
    new Set(
      value
        .map((channel) => cleanText(channel, 40))
        .filter(
          (channel): channel is BoosterVideoChannelKey =>
            isBoosterVideoChannelKey(channel) && ALLOWED_CHANNELS.has(channel),
        ),
    ),
  );
}

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function POST(request: Request) {
  try {
    const { errorResponse, activeUserId } = await requireUser();
    if (errorResponse) return errorResponse;

    const limited = await enforceRateLimit({
      name: "media_pipeline_workspace_prewarm",
      identifier: activeUserId,
      limit: 24,
      fallbackLimit: 24,
      window: "10 m",
      failClosed: false,
    });
    if (limited) return limited;

    const body = await request.json().catch(() => null);
    const workspaceId = cleanText(body?.workspaceId, 80);
    const selectedChannels = cleanChannels(body?.selectedChannels);
    const requestedMediaType =
      body?.requestedMediaType === "images" || body?.requestedMediaType === "video"
        ? body.requestedMediaType
        : null;
    if (!workspaceId) {
      return NextResponse.json(
        { ok: false, code: "workspace_required", error: "Espace média manquant." },
        { status: 400 },
      );
    }
    if (!selectedChannels.length) {
      return NextResponse.json({
        ok: true,
        workspaceId,
        status: "skipped",
        reason: "no_selected_channel",
      });
    }

    const consumption = await resolveWorkspacePublicationConsumption({
      accountId: activeUserId,
      workspaceId,
      purpose: "publish",
    });

    if (
      consumption.images.length > 0 &&
      requestedMediaType !== "video"
    ) {
      const prepared = await prepareBoosterImagesByChannelOnServer({
        accountId: activeUserId,
        workspaceId,
        channels: selectedChannels as BoosterImageChannel[],
        images: consumption.images,
        settingsByChannel: asObject(body?.imageSettingsByChannel) as any,
      });
      return NextResponse.json({
        ok: prepared.warnings.length === 0,
        workspaceId,
        status: "ready",
        mediaType: "images",
        preparedChannels: Object.keys(prepared.imagesByChannel),
        warnings: prepared.warnings,
      });
    }

    if (consumption.video && requestedMediaType !== "images") {
      const video = consumption.video;
      const generateMissingVideoVariants =
        body?.generateMissingVideoVariants !== false;
      const strictMediaCutover =
        body?.mediaPipelineCutoverV1 === true &&
        isLegacyMediaTransportCutoverEnabled();
      const allowOriginalVideoFallback =
        !strictMediaCutover && body?.allowOriginalVideoFallback === true;
      const settings = buildVideoSettingsByChannel({
        channels: selectedChannels,
        videoSettingsByChannel: body?.videoSettingsByChannel,
        sourceMetadata: video.sourceMetadata,
      });
      if (selectedChannels.includes("youtube_shorts")) {
        settings.youtube_shorts = getAutomaticVideoSettingsForPublication({
          channel: "youtube_shorts",
          settings: settings.youtube_shorts,
          durationSeconds: video.duration,
        });
      }
      const sourceWidth = Number(video.sourceMetadata?.width || 0) || null;
      const sourceHeight = Number(video.sourceMetadata?.height || 0) || null;
      const signedSourceUrl = await createSafeStorageSignedUrl(
        video.bucket,
        video.storagePath,
        60 * 60,
      );

      const mediaWarnings: Array<{
        channel: BoosterVideoChannelKey;
        code: string;
        message: string;
      }> = [];
      const durationBlockedChannels: Array<{
        channel: BoosterVideoChannelKey;
        signature: string;
        reason: string;
        message: string;
      }> = [];
      const requestedVariants = selectedChannels.flatMap((channel) => {
        if (channel === "gmb") {
          const decision = getGoogleBusinessVideoPreparationDecision({
            name: video.name,
            type: video.type,
            storagePath: video.storagePath,
            sizeBytes: video.size,
            durationSeconds: video.duration,
            width: sourceWidth,
            height: sourceHeight,
            videoCodec: video.sourceMetadata?.videoCodec,
            audioCodec: video.sourceMetadata?.audioCodec,
            frameRate: video.sourceMetadata?.frameRate,
            hasAudio: video.sourceMetadata?.hasAudio,
            containerFormats: video.sourceMetadata?.containerFormats,
            pixelFormat: video.sourceMetadata?.pixelFormat,
          });
          if (decision.action === "block") {
            durationBlockedChannels.push({
              channel,
              signature: `${channel}:duration`,
              reason: decision.errorCode,
              message: decision.errorMessage,
            });
            return [];
          }
        }
        return [{
          key: `${channel}-${settings[channel]?.format || "original"}-${settings[channel]?.adaptationMode || "safe_frame"}`,
          channel,
          format: settings[channel]?.format,
          adaptationMode: settings[channel]?.adaptationMode,
          publicationProfile: getVideoPublicationProfileForChannel(channel),
        }];
      });

      const prepared = await prepareBoosterVideoVariantsOnServer({
        accountId: activeUserId,
        workspaceId,
        mediaId: video.mediaId,
        generateMissing: generateMissingVideoVariants,
        trustedSourceCompatibilityProof: true,
        source: {
          ...video,
          publicUrl: signedSourceUrl,
          url: signedSourceUrl,
        },
        variants: requestedVariants,
      });
      const signatureFor = (request: (typeof requestedVariants)[number]) =>
        buildVideoTransformSignature(
          request.format || "original",
          request.adaptationMode || "safe_frame",
          request.publicationProfile,
        );
      const requiredSignatures = Array.from(
        new Set(requestedVariants.map(signatureFor)),
      );
      const invalidChannels = [
        ...durationBlockedChannels,
        ...requestedVariants.flatMap((request) => {
        const signature = signatureFor(request);
        const variant = prepared.variants.find(
          (candidate) => candidate.signature === signature,
        );
        const sourceValidation = validateVideoPublicationForChannel({
          channel: request.channel,
          name: video.name,
          type: video.type,
          storagePath: video.storagePath,
          sizeBytes: video.size,
          durationSeconds: video.duration,
          width: sourceWidth,
          height: sourceHeight,
        });
        if (!variant?.publicUrl || !variant?.storagePath) {
          if (
            allowOriginalVideoFallback &&
            allowsOriginalVideoFallback(request.channel) &&
            sourceValidation.ok
          ) {
            mediaWarnings.push({
              channel: request.channel,
              code: "video_variant_fallback_to_original",
              message:
                "La variante optimisée n’a pas pu être préparée. La vidéo originale compatible sera utilisée.",
            });
            return [];
          }
          return [{
            channel: request.channel,
            signature,
            reason: sourceValidation.ok
              ? "variant_missing"
              : sourceValidation.reason,
            message: sourceValidation.ok
              ? "La variante vidéo demandée n’est pas encore prête."
              : sourceValidation.message,
          }];
        }
        const validation = validateVideoPublicationForChannel({
          channel: request.channel,
          name: variant.name || `video-${request.channel}.mp4`,
          type: variant.contentType,
          storagePath: variant.storagePath,
          sizeBytes: variant.size,
          durationSeconds: variant.duration ?? video.duration,
          width: variant.width,
          height: variant.height,
        });
        if (validation.ok) return [];
        if (
          allowOriginalVideoFallback &&
          allowsOriginalVideoFallback(request.channel) &&
          sourceValidation.ok
        ) {
          mediaWarnings.push({
            channel: request.channel,
            code: "video_variant_fallback_to_original",
            message:
              "La variante optimisée reste incompatible. La vidéo originale compatible sera utilisée.",
          });
          return [];
        }
        return [{
          channel: request.channel,
          signature,
          reason: validation.reason,
          message: validation.message,
        }];
        }),
      ];
      const invalidSignatures = Array.from(
        new Set(invalidChannels.map((item) => item.signature)),
      );
      const fallbackOriginalChannels = allowOriginalVideoFallback
        ? requestedVariants
            .filter((request) => {
              if (!allowsOriginalVideoFallback(request.channel)) return false;
              const signature = signatureFor(request);
              const variant = prepared.variants.find(
                (candidate) => candidate.signature === signature,
              );
              const variantValidation =
                variant?.publicUrl && variant?.storagePath
                  ? validateVideoPublicationForChannel({
                      channel: request.channel,
                      name: variant.name || `video-${request.channel}.mp4`,
                      type: variant.contentType,
                      storagePath: variant.storagePath,
                      sizeBytes: variant.size,
                      durationSeconds: variant.duration ?? video.duration,
                      width: variant.width,
                      height: variant.height,
                    })
                  : null;
              if (variantValidation?.ok) return false;
              return validateVideoPublicationForChannel({
                channel: request.channel,
                name: video.name,
                type: video.type,
                storagePath: video.storagePath,
                sizeBytes: video.size,
                durationSeconds: video.duration,
                width: sourceWidth,
                height: sourceHeight,
              }).ok;
            })
            .map((request) => request.channel)
        : [];
      const ready = invalidChannels.length === 0;
      return NextResponse.json({
        ok: ready,
        workspaceId,
        status: ready ? "ready" : "partial",
        mediaType: "video",
        preparedVariants: prepared.variants.length,
        requiredVariants: requiredSignatures.length,
        invalidSignatures,
        invalidChannels,
        fallbackOriginalChannels,
        mediaWarnings,
        errors: prepared.errors,
      });
    }

    return NextResponse.json({
      ok: true,
      workspaceId,
      status: "skipped",
      mediaType: "none",
    });
  } catch (error) {
    if (error instanceof MediaWorkspaceConsumptionError) {
      return NextResponse.json(
        { ok: false, code: error.code, error: error.message },
        { status: error.status },
      );
    }
    console.error("[media-pipeline] workspace prewarm failed", error);
    return NextResponse.json(
      {
        ok: false,
        code: "workspace_prewarm_failed",
        error:
          error instanceof Error
            ? error.message
            : "La préparation anticipée des médias a échoué.",
      },
      { status: 500 },
    );
  }
}
