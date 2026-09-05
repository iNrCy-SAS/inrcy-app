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
import type { AiMediaIdentityMode } from "@/lib/aiMediaGenerationContracts";
import { redactAiMediaSensitiveText } from "@/lib/aiMediaSensitiveText";

const DEFAULT_IMAGE_MODEL = "openai/gpt-image-2";
const DEFAULT_IMAGE_COST_MICRO_USD = 65_000;
const DEFAULT_IMAGE_REFERENCE_COST_MICRO_USD = 20_000;
const MAX_IMAGE_BYTES = 40 * 1024 * 1024;

export type AiMediaGatewayResult = {
  kind: "image";
  model: string;
  buffer: Buffer;
  mediaType: string;
  referenceImagesCount: number;
  identityReferenceImagesCount: number;
  genericReferenceImagesCount: number;
  officialLogoIncluded: boolean;
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

function configuredCost(referenceImagesCount: number) {
  const baseCost = positiveInt(
    process.env.AI_MEDIA_IMAGE_COST_MICRO_USD,
    DEFAULT_IMAGE_COST_MICRO_USD,
    50_000_000,
  );
  // Les images d'entrée sont facturables par le fournisseur. Cette réserve
  // conservatrice couvre jusqu'à trois références et le logo sans sous-estimer
  // le budget du compte. Elle n'est pas un quota produit facturé au client.
  const perReferenceCost = positiveInt(
    process.env.AI_MEDIA_IMAGE_REFERENCE_COST_MICRO_USD,
    DEFAULT_IMAGE_REFERENCE_COST_MICRO_USD,
    5_000_000,
  );
  return Math.min(
    50_000_000,
    baseCost + Math.min(4, Math.max(0, referenceImagesCount)) * perReferenceCost,
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
  return value
    .slice(0, 12)
    .map((warning) => redactAiMediaSensitiveText(warning, 500))
    .map((warning) => warning || "provider_warning");
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
  referenceImagesCount: number;
  operation: () => Promise<T>;
  signal?: AbortSignal;
}) {
  const costMicroUsd = configuredCost(args.referenceImagesCount);
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
  identityMode: AiMediaIdentityMode;
  /**
   * Références ponctuelles explicitement autorisées par le professionnel.
   * Elles restent en mémoire le temps de l'appel et ne sont pas inscrites en
   * Médiathèque ni dans ses préférences.
   */
  identityReferences?: readonly Buffer[];
  /** Logo officiel chargé depuis le stockage de l'établissement actif. */
  officialLogo?: Buffer | null;
  size?: "1024x1024" | "1024x1536" | "1536x1024";
  signal?: AbortSignal;
}): Promise<AiMediaGatewayResult> {
  args.signal?.throwIfAborted();
  assertGatewayCredentials();
  const configuredModel = resolveImageModel();
  const providedReferences = (args.identityReferences || [])
    .filter((image) => image.byteLength > 0)
    .slice(0, 3);
  const strictIdentityReferences =
    providedReferences.length > 0 &&
    (args.identityMode === "professional" ||
      args.identityMode === "brand_avatar" ||
      args.identityMode === "reference_team");
  // Toute identité autorisée est verrouillée sur le modèle audité. La
  // configuration générale ne peut pas rerouter ces portraits ailleurs.
  const model = strictIdentityReferences
    ? DEFAULT_IMAGE_MODEL
    : configuredModel;
  const officialLogoIncluded = Boolean(args.officialLogo?.byteLength);
  const referenceImages = [
    ...providedReferences,
    ...(officialLogoIncluded ? [args.officialLogo as Buffer] : []),
  ];
  const referenceImagesCount = referenceImages.length;
  const timeoutMs = positiveInt(
    process.env.AI_MEDIA_IMAGE_TIMEOUT_MS,
    210_000,
    300_000,
  );

  return await withEconomicGuard({
    accountId: args.accountId,
    model,
    referenceImagesCount,
    signal: args.signal,
    operation: async (): Promise<AiMediaGatewayResult> => {
      const referenceRoleRules = referenceImagesCount
        ? [
            "ORDRE DES IMAGES DE RÉFÉRENCE FOURNIES AU MODÈLE :",
            providedReferences.length && strictIdentityReferences
              ? args.identityMode === "reference_team"
                ? `- Les ${providedReferences.length} premières images représentent ${providedReferences.length} adultes distincts et autorisés : image 1 = personne 1, image 2 = personne 2${providedReferences.length === 3 ? ", image 3 = personne 3" : ""}. Faire apparaître chaque personne exactement une fois dans la même scène, préserver séparément son visage et ses signes distinctifs, et ne jamais fusionner, permuter, dupliquer ou remplacer une identité par une personne générique.`
                : args.identityMode === "professional"
                ? `- Les ${providedReferences.length} première${providedReferences.length > 1 ? "s" : ""} image${providedReferences.length > 1 ? "s" : ""} sont des références autorisées d’un professionnel adulte. Le rendu vise à préserver son identité visuelle sans substituer une personne générique ; le professionnel doit contrôler le résultat avant validation.`
                : `- Les ${providedReferences.length} première${providedReferences.length > 1 ? "s" : ""} image${providedReferences.length > 1 ? "s" : ""} sont des références autorisées pour construire ou préserver l’avatar illustré de la marque. Conserver ses signes distinctifs et faire contrôler le résultat avant validation.`
              : providedReferences.length
                ? `- Les ${providedReferences.length} première${providedReferences.length > 1 ? "s" : ""} image${providedReferences.length > 1 ? "s" : ""} sont uniquement des inspirations visuelles générales pour le sujet, l’ambiance ou la scène. Elles n’imposent aucune identité réelle à reproduire.`
              : "- Aucune référence d'identité n'est fournie.",
            officialLogoIncluded
              ? `- L'image ${referenceImagesCount} est exclusivement le logo officiel ; ne jamais la confondre avec une personne ni un décor.`
              : "- Aucun fichier de logo n'est fourni.",
          ].join("\n")
        : "";
      const result = await generateImage({
        model,
        prompt: referenceImagesCount
          ? {
              text: `${args.prompt}\n\n${referenceRoleRules}`,
              images: referenceImages,
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
                ...(strictIdentityReferences
                  ? { inputFidelity: "high" }
                  : {}),
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
        identityReferenceImagesCount: strictIdentityReferences
          ? providedReferences.length
          : 0,
        genericReferenceImagesCount: strictIdentityReferences
          ? 0
          : providedReferences.length,
        officialLogoIncluded,
        warnings: compactWarnings(result.warnings || []),
        usage: cleanUsage(result.usage),
      };
    },
  }).catch((error) => {
    if (NoImageGeneratedError.isInstance(error)) {
      throw new Error(
        strictIdentityReferences
          ? "ai_image_identity_not_generated"
          : "ai_image_not_generated",
        { cause: error },
      );
    }
    throw error;
  });
}
