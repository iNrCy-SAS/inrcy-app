import "server-only";

import {
  createDownload,
  experimental_generateImage as generateImage,
  experimental_generateVideo as generateVideo,
  NoImageGeneratedError,
  NoVideoGeneratedError,
} from "ai";

import {
  commitAiGatewayAccountAttempt,
  recordAiGatewayAccountFailure,
  reserveAiGatewayAccountAttempt,
  rollbackAiGatewayAccountAttempt,
} from "@/lib/aiGatewayAccountGuard";
import { bufferFromUint8ArrayView } from "@/lib/aiMediaBuffer";
import type { AiMediaKind } from "@/lib/aiMediaGenerationContracts";

const DEFAULT_IMAGE_MODEL = "openai/gpt-image-2";
const DEFAULT_VIDEO_MODEL = "bfl/flux-3-video";
const DEFAULT_IMAGE_COST_MICRO_USD = 65_000;
// FLUX.3 full HD costs $0.17/s. An eight-second render is $1.36; the
// reservation keeps a small safety margin without pricing it as a longer clip.
const DEFAULT_VIDEO_COST_MICRO_USD = 1_500_000;
const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
const MAX_VIDEO_BYTES = 100 * 1024 * 1024;
const DEFAULT_VIDEO_GATEWAY_POLL_TIMEOUT_MS = 540_000;
const MAX_VIDEO_GATEWAY_POLL_TIMEOUT_MS = 560_000;
const downloadGeneratedVideo = createDownload({ maxBytes: MAX_VIDEO_BYTES });

export type AiMediaGatewayResult = {
  kind: AiMediaKind;
  model: string;
  buffer: Buffer;
  mediaType: string;
  warnings: string[];
  usage: Record<string, unknown> | null;
};

function positiveInt(value: unknown, fallback: number, max: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(max, parsed)
    : fallback;
}

function resolveModel(kind: AiMediaKind) {
  const configured = String(
    (kind === "image"
      ? process.env.AI_GATEWAY_IMAGE_MODEL || process.env.AI_MEDIA_IMAGE_MODEL
      : process.env.AI_GATEWAY_VIDEO_MODEL || process.env.AI_MEDIA_VIDEO_MODEL) ?? "",
  ).trim();
  const model = configured || (kind === "image" ? DEFAULT_IMAGE_MODEL : DEFAULT_VIDEO_MODEL);
  if (!/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i.test(model)) {
    throw new Error("ai_media_model_invalid");
  }
  return model;
}

function configuredCost(kind: AiMediaKind) {
  return positiveInt(
    kind === "image"
      ? process.env.AI_MEDIA_IMAGE_COST_MICRO_USD
      : process.env.AI_MEDIA_VIDEO_COST_MICRO_USD,
    kind === "image"
      ? DEFAULT_IMAGE_COST_MICRO_USD
      : DEFAULT_VIDEO_COST_MICRO_USD,
    50_000_000,
  );
}

function assertGatewayCredentials() {
  if (
    !String(process.env.AI_GATEWAY_API_KEY || "").trim() &&
    !String(process.env.VERCEL_OIDC_TOKEN || "").trim()
  ) {
    throw new Error("ai_gateway_credentials_missing");
  }
}

function compactWarnings(value: readonly unknown[]) {
  return value.slice(0, 12).map((warning) => {
    if (typeof warning === "string") return warning.slice(0, 500);
    try {
      return JSON.stringify(warning).slice(0, 500);
    } catch {
      return "provider_warning";
    }
  });
}

function cleanUsage(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, item]) => ["string", "number", "boolean"].includes(typeof item))
    .slice(0, 20);
  return Object.fromEntries(entries);
}

async function withEconomicGuard<T>(args: {
  accountId: string;
  kind: AiMediaKind;
  model: string;
  operation: () => Promise<T>;
}) {
  const costMicroUsd = configuredCost(args.kind);
  const reservation = await reserveAiGatewayAccountAttempt(args.accountId, {
    estimatedInputTokens: 0,
    reservedOutputTokens: 0,
    estimatedCostMicroUsd: costMicroUsd,
  });
  try {
    const result = await args.operation();
    await commitAiGatewayAccountAttempt({
      reservation,
      feature: args.kind === "image" ? "media.image" : "media.video",
      model: args.model,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      actualCostMicroUsd: costMicroUsd,
    });
    return result;
  } catch (error) {
    await rollbackAiGatewayAccountAttempt(reservation).catch(() => undefined);
    await recordAiGatewayAccountFailure({
      accountId: args.accountId,
      feature: args.kind === "image" ? "media.image" : "media.video",
      model: args.model,
    }).catch(() => undefined);
    throw error;
  }
}

export async function generateAiMediaImage(args: {
  accountId: string;
  prompt: string;
}): Promise<AiMediaGatewayResult> {
  assertGatewayCredentials();
  const model = resolveModel("image");
  const timeoutMs = positiveInt(
    process.env.AI_MEDIA_IMAGE_TIMEOUT_MS,
    210_000,
    300_000,
  );

  return await withEconomicGuard({
    accountId: args.accountId,
    kind: "image",
    model,
    operation: async (): Promise<AiMediaGatewayResult> => {
      const result = await generateImage({
        model,
        prompt: args.prompt,
        n: 1,
        maxImagesPerCall: 1,
        size: "1024x1024",
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(timeoutMs),
        providerOptions: model.startsWith("openai/")
          ? {
              openai: {
                quality: "medium",
                outputFormat: "jpeg",
              },
            }
          : undefined,
      });
      const image = result.image || result.images[0];
      if (!image?.uint8Array?.byteLength) {
        throw new Error("ai_image_empty");
      }
      if (image.uint8Array.byteLength > MAX_IMAGE_BYTES) {
        throw new Error("ai_image_too_large");
      }
      return {
        kind: "image",
        model,
        buffer: bufferFromUint8ArrayView(image.uint8Array),
        mediaType: image.mediaType || "image/png",
        warnings: compactWarnings(result.warnings || []),
        usage: cleanUsage(result.usage),
      };
    },
  }).catch((error) => {
    if (NoImageGeneratedError.isInstance(error)) {
      throw new Error("ai_image_not_generated", { cause: error });
    }
    throw error;
  });
}

export async function generateAiMediaVideo(args: {
  accountId: string;
  prompt: string;
}): Promise<AiMediaGatewayResult> {
  assertGatewayCredentials();
  const model = resolveModel("video");
  // AI SDK 6 / VideoModelV3 laisse le polling FLUX au flux SSE Gateway.
  // L'AbortSignal est donc son vrai budget de polling dans cette version. Il
  // expire assez tôt pour réserver la fin des 800 s à FFmpeg, Storage et SQL.
  const pollTimeoutMs = positiveInt(
    process.env.AI_MEDIA_VIDEO_TIMEOUT_MS,
    DEFAULT_VIDEO_GATEWAY_POLL_TIMEOUT_MS,
    MAX_VIDEO_GATEWAY_POLL_TIMEOUT_MS,
  );

  return await withEconomicGuard({
    accountId: args.accountId,
    kind: "video",
    model,
    operation: async (): Promise<AiMediaGatewayResult> => {
      const result = await generateVideo({
        model,
        prompt: args.prompt,
        n: 1,
        maxVideosPerCall: 1,
        duration: 8,
        aspectRatio: "1:1",
        resolution: "1080x1080",
        generateAudio: false,
        maxRetries: 0,
        abortSignal: AbortSignal.timeout(pollTimeoutMs),
        download: downloadGeneratedVideo,
        providerOptions: model.startsWith("bfl/")
          ? {
              blackForestLabs: {
                resolution: "hd",
                aspectRatio: "1:1",
                safetyTolerance: 2,
                draft: false,
              },
            }
          : undefined,
      });
      const video = result.video || result.videos[0];
      if (!video?.uint8Array?.byteLength) {
        throw new Error("ai_video_empty");
      }
      if (video.uint8Array.byteLength > MAX_VIDEO_BYTES) {
        throw new Error("ai_video_too_large");
      }
      return {
        kind: "video",
        model,
        buffer: bufferFromUint8ArrayView(video.uint8Array),
        mediaType: video.mediaType || "video/mp4",
        warnings: compactWarnings(result.warnings || []),
        usage: null,
      };
    },
  }).catch((error) => {
    if (NoVideoGeneratedError.isInstance(error)) {
      throw new Error("ai_video_not_generated", { cause: error });
    }
    throw error;
  });
}

export function getAiMediaGatewayModel(kind: AiMediaKind) {
  return resolveModel(kind);
}
