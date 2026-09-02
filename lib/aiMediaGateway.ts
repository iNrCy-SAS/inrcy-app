import "server-only";

import {
  experimental_generateImage as generateImage,
  NoImageGeneratedError,
} from "ai";

import {
  commitAiGatewayAccountAttempt,
  recordAiGatewayAccountFailure,
  reserveAiGatewayAccountAttempt,
  rollbackAiGatewayAccountAttempt,
} from "@/lib/aiGatewayAccountGuard";
import { bufferFromUint8ArrayView } from "@/lib/aiMediaBuffer";

const DEFAULT_IMAGE_MODEL = "openai/gpt-image-2";
const DEFAULT_IMAGE_COST_MICRO_USD = 65_000;
const MAX_IMAGE_BYTES = 40 * 1024 * 1024;

export type AiMediaGatewayResult = {
  kind: "image";
  model: string;
  buffer: Buffer;
  mediaType: string;
  referenceImagesCount: 0 | 1;
  warnings: string[];
  usage: Record<string, unknown> | null;
};

function positiveInt(value: unknown, fallback: number, max: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(max, parsed)
    : fallback;
}

function resolveImageModel() {
  const configured = String(
    process.env.AI_GATEWAY_IMAGE_MODEL || process.env.AI_MEDIA_IMAGE_MODEL || "",
  ).trim();
  const model = configured || DEFAULT_IMAGE_MODEL;
  if (!/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i.test(model)) {
    throw new Error("ai_media_model_invalid");
  }
  return model;
}

function configuredCost() {
  return positiveInt(
    process.env.AI_MEDIA_IMAGE_COST_MICRO_USD,
    DEFAULT_IMAGE_COST_MICRO_USD,
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
  model: string;
  operation: () => Promise<T>;
  signal?: AbortSignal;
}) {
  const costMicroUsd = configuredCost();
  const reservation = await reserveAiGatewayAccountAttempt(args.accountId, {
    estimatedInputTokens: 0,
    reservedOutputTokens: 0,
    estimatedCostMicroUsd: costMicroUsd,
  });
  try {
    const result = await args.operation();
    await commitAiGatewayAccountAttempt({
      reservation,
      feature: "media.image",
      model: args.model,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 },
      actualCostMicroUsd: costMicroUsd,
    });
    return result;
  } catch (error) {
    await rollbackAiGatewayAccountAttempt(reservation).catch(() => undefined);
    if (!args.signal?.aborted) {
      await recordAiGatewayAccountFailure({
        accountId: args.accountId,
        feature: "media.image",
        model: args.model,
      }).catch(() => undefined);
    }
    throw error;
  }
}

export async function generateAiMediaImage(args: {
  accountId: string;
  prompt: string;
  /**
   * Seule image de référence autorisée dans le Studio : le logo officiel
   * chargé depuis le stockage de l'établissement actif. Les photos de la
   * Médiathèque ne font volontairement pas partie de ce contrat.
   */
  officialLogo?: Buffer | null;
  size?: "1024x1024" | "1024x1536" | "1536x1024";
  signal?: AbortSignal;
}): Promise<AiMediaGatewayResult> {
  args.signal?.throwIfAborted();
  assertGatewayCredentials();
  const model = resolveImageModel();
  const timeoutMs = positiveInt(
    process.env.AI_MEDIA_IMAGE_TIMEOUT_MS,
    210_000,
    300_000,
  );

  return await withEconomicGuard({
    accountId: args.accountId,
    model,
    signal: args.signal,
    operation: async (): Promise<AiMediaGatewayResult> => {
      const referenceImagesCount = args.officialLogo?.byteLength ? 1 : 0;
      const result = await generateImage({
        model,
        prompt: referenceImagesCount
          ? {
              text: args.prompt,
              // Une collection n'est jamais acceptée ici : cette propriété
              // serveur représente exclusivement le logo officiel.
              images: [args.officialLogo as Buffer],
            }
          : args.prompt,
        n: 1,
        maxImagesPerCall: 1,
        size: args.size || "1024x1024",
        maxRetries: 0,
        abortSignal: args.signal
          ? AbortSignal.any([args.signal, AbortSignal.timeout(timeoutMs)])
          : AbortSignal.timeout(timeoutMs),
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
        referenceImagesCount,
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
