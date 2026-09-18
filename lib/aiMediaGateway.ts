import "server-only";

import {
  experimental_generateImage as generateImage,
  NoImageGeneratedError,
} from "ai";
import { GoogleGenAI } from "@google/genai";

import {
  commitAiGatewayAccountAttempt,
  recordAiGatewayAccountFailure,
  reserveAiGatewayAccountAttempt,
  rollbackAiGatewayAccountAttempt,
} from "@/lib/aiGatewayAccountGuard";
import { bufferFromUint8ArrayView } from "@/lib/aiMediaBuffer";
import type {
  AiMediaIdentityMode,
  AiMediaInspirationImage,
} from "@/lib/aiMediaGenerationContracts";
import { redactAiMediaSensitiveText } from "@/lib/aiMediaSensitiveText";

const DEFAULT_IMAGE_MODEL = "openai/gpt-image-2";
const DEFAULT_GOOGLE_IMAGE_MODEL = "gemini-3.1-flash-image";
const DEFAULT_IMAGE_COST_MICRO_USD = 65_000;
const DEFAULT_IMAGE_REFERENCE_COST_MICRO_USD = 20_000;
const MAX_IMAGE_BYTES = 40 * 1024 * 1024;

export type AiMediaGatewayResult = {
  kind: "image";
  provider: "vercel-ai-gateway" | "google-gemini-direct";
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

type AiMediaImageProviderInput = {
  providedReferences: Buffer[];
  providedReferenceRoles: Array<
    Pick<AiMediaInspirationImage, "role" | "characterIndex">
  >;
  characterReferenceCount: number;
  strictIdentityReferences: boolean;
  officialLogoIncluded: boolean;
  referenceImages: Buffer[];
  referenceMimeTypes: Array<"image/webp" | "image/png">;
  referenceImagesCount: number;
};

function positiveInt(value: unknown, fallback: number, max: number) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  return Number.isFinite(parsed) && parsed > 0
    ? Math.min(max, parsed)
    : fallback;
}

function resolveImageModel() {
  const configured = String(
    process.env.AI_GATEWAY_IMAGE_MODEL || process.env.AI_MEDIA_IMAGE_MODEL || ""
  ).trim();
  const model = configured || DEFAULT_IMAGE_MODEL;
  if (!/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i.test(model)) {
    throw new Error("ai_media_model_invalid");
  }
  return model;
}

function resolveGoogleImageModel() {
  const configured = String(
    process.env.AI_MEDIA_GOOGLE_IMAGE_MODEL || ""
  ).trim();
  const model = configured || DEFAULT_GOOGLE_IMAGE_MODEL;
  if (!/^[a-z0-9][a-z0-9._-]*$/i.test(model)) {
    throw new Error("ai_image_google_model_invalid");
  }
  return model;
}

function configuredCost(referenceImagesCount: number) {
  const baseCost = positiveInt(
    process.env.AI_MEDIA_IMAGE_COST_MICRO_USD,
    DEFAULT_IMAGE_COST_MICRO_USD,
    50_000_000
  );
  // Les images d'entrée sont facturables par le fournisseur. Cette réserve
  // conservatrice couvre jusqu'à cinq références et le logo sans sous-estimer
  // le budget du compte. Elle n'est pas un quota produit facturé au client.
  const perReferenceCost = positiveInt(
    process.env.AI_MEDIA_IMAGE_REFERENCE_COST_MICRO_USD,
    DEFAULT_IMAGE_REFERENCE_COST_MICRO_USD,
    5_000_000
  );
  return Math.min(
    50_000_000,
    baseCost + Math.min(6, Math.max(0, referenceImagesCount)) * perReferenceCost
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

function googleImageApiKey() {
  const value = String(
    process.env.GEMINI_API_KEY || process.env.GOOGLE_GENERATIVE_AI_API_KEY || ""
  ).trim();
  if (!value) throw new Error("ai_image_google_credentials_missing");
  return value;
}

function prepareImageProviderInput(args: {
  identityMode: AiMediaIdentityMode;
  identityReferences?: readonly Buffer[];
  referenceRoles?: ReadonlyArray<
    Pick<AiMediaInspirationImage, "role" | "characterIndex">
  >;
  officialLogo?: Buffer | null;
}): AiMediaImageProviderInput {
  const providedReferences = (args.identityReferences || [])
    .filter((image) => image.byteLength > 0)
    .slice(0, 5);
  const legacyStrictIdentity =
    args.identityMode === "professional" ||
    args.identityMode === "brand_avatar" ||
    args.identityMode === "reference_team";
  const providedReferenceRoles = providedReferences.map((_, index) => {
    const explicit = args.referenceRoles?.[index];
    if (explicit?.role) return explicit;
    return legacyStrictIdentity
      ? { role: "character" as const, characterIndex: (index + 1) as 1 | 2 | 3 }
      : {};
  });
  const characterReferenceCount = providedReferenceRoles.filter(
    (reference) => reference.role === "character"
  ).length;
  const strictIdentityReferences =
    characterReferenceCount > 0 && legacyStrictIdentity;
  const officialLogoIncluded = Boolean(args.officialLogo?.byteLength);
  const referenceImages = [
    ...providedReferences,
    ...(officialLogoIncluded ? [args.officialLogo as Buffer] : []),
  ];
  return {
    providedReferences,
    providedReferenceRoles,
    characterReferenceCount,
    strictIdentityReferences,
    officialLogoIncluded,
    referenceImages,
    referenceMimeTypes: [
      ...providedReferences.map(() => "image/webp" as const),
      ...(officialLogoIncluded ? (["image/png"] as const) : []),
    ],
    referenceImagesCount: referenceImages.length,
  };
}

function buildImageReferenceRoleRules(args: {
  identityMode: AiMediaIdentityMode;
  input: AiMediaImageProviderInput;
}) {
  const {
    providedReferences,
    providedReferenceRoles,
    strictIdentityReferences,
    officialLogoIncluded,
    referenceImagesCount,
  } = args.input;
  if (!referenceImagesCount) return "";
  return [
    "ORDRE DES IMAGES DE RÉFÉRENCE FOURNIES AU MODÈLE :",
    ...providedReferences.map((_, index) => {
      const reference = providedReferenceRoles[index];
      const imageNumber = index + 1;
      if (reference?.role === "character") {
        return `- Image ${imageNumber} = personnage ${
          reference.characterIndex || imageNumber
        }, adulte autorisé. Préserver séparément son visage et ses signes distinctifs, le faire apparaître exactement une fois dans la nouvelle scène, sans fusion, permutation, duplication ni substitution générique. Ne jamais recopier sa photo, sa posture, son cadrage ou son arrière-plan.`;
      }
      if (reference?.role === "environment") {
        return `- Image ${imageNumber} = décor de référence. Recréer son lieu, son ambiance et ses éléments reconnaissables comme environnement plein cadre de la nouvelle scène ; ne jamais l’utiliser comme une photo fixe ou un fond simplement déplacé.`;
      }
      if (reference?.role === "product") {
        return `- Image ${imageNumber} = produit à intégrer. Préserver son apparence, sa forme et ses détails distinctifs, puis l’intégrer naturellement une seule fois dans la nouvelle scène ; ne jamais le confondre avec un personnage ou un décor.`;
      }
      return strictIdentityReferences
        ? `- Image ${imageNumber} = référence d’identité autorisée. Préserver l’identité dans une scène entièrement nouvelle.`
        : `- Image ${imageNumber} = inspiration visuelle. En extraire les éléments pertinents sans recopier la photo source.`;
    }),
    officialLogoIncluded
      ? `- L'image ${referenceImagesCount} est exclusivement le logo officiel ; ne jamais la confondre avec une personne ni un décor.`
      : "- Aucun fichier de logo n'est fourni.",
    "- Hors logo officiel, chaque image fournie est uniquement un guide de génération : ne jamais la remettre en page comme résultat, la coller dans le visuel, l’entourer d’un cadre ou livrer une variante quasi identique. Produire une nouvelle scène plein cadre qui matérialise réellement le sujet demandé.",
  ].join("\n");
}

function resolveGoogleImageAspectRatio(
  size: "1024x1024" | "1024x1536" | "1536x1024" | undefined
) {
  if (size === "1024x1536") return "2:3" as const;
  if (size === "1536x1024") return "3:2" as const;
  return "1:1" as const;
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
    feature: "media.image",
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
  referenceRoles?: ReadonlyArray<
    Pick<AiMediaInspirationImage, "role" | "characterIndex">
  >;
  /** Logo officiel chargé depuis le stockage de l'établissement actif. */
  officialLogo?: Buffer | null;
  size?: "1024x1024" | "1024x1536" | "1536x1024";
  signal?: AbortSignal;
}): Promise<AiMediaGatewayResult> {
  args.signal?.throwIfAborted();
  assertGatewayCredentials();
  const configuredModel = resolveImageModel();
  const input = prepareImageProviderInput(args);
  const {
    providedReferences,
    characterReferenceCount,
    strictIdentityReferences,
    officialLogoIncluded,
    referenceImages,
    referenceImagesCount,
  } = input;
  // Toute identité autorisée est verrouillée sur le modèle audité. La
  // configuration générale ne peut pas rerouter ces portraits ailleurs.
  const model = strictIdentityReferences
    ? DEFAULT_IMAGE_MODEL
    : configuredModel;
  const timeoutMs = positiveInt(
    process.env.AI_MEDIA_IMAGE_TIMEOUT_MS,
    210_000,
    300_000
  );

  return await withEconomicGuard({
    accountId: args.accountId,
    model,
    referenceImagesCount,
    signal: args.signal,
    operation: async (): Promise<AiMediaGatewayResult> => {
      const referenceRoleRules = buildImageReferenceRoleRules({
        identityMode: args.identityMode,
        input,
      });
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
        provider: "vercel-ai-gateway",
        model,
        buffer: bufferFromUint8ArrayView(image.uint8Array),
        mediaType: image.mediaType || "image/png",
        referenceImagesCount,
        identityReferenceImagesCount: strictIdentityReferences
          ? characterReferenceCount
          : 0,
        genericReferenceImagesCount:
          providedReferences.length -
          (strictIdentityReferences ? characterReferenceCount : 0),
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
        { cause: error }
      );
    }
    throw error;
  });
}

/**
 * Second moteur de génération pour les images fixes uniquement. Il reçoit les
 * mêmes références éphémères et les mêmes règles d'identité que le moteur
 * nominal. Il ne doit jamais être remplacé par un collage local des sources.
 */
export async function generateAiMediaImageWithGoogle(args: {
  accountId: string;
  prompt: string;
  identityMode: AiMediaIdentityMode;
  identityReferences?: readonly Buffer[];
  referenceRoles?: ReadonlyArray<
    Pick<AiMediaInspirationImage, "role" | "characterIndex">
  >;
  officialLogo?: Buffer | null;
  size?: "1024x1024" | "1024x1536" | "1536x1024";
  signal?: AbortSignal;
}): Promise<AiMediaGatewayResult> {
  args.signal?.throwIfAborted();
  const key = googleImageApiKey();
  const model = resolveGoogleImageModel();
  const input = prepareImageProviderInput(args);
  const timeoutMs = positiveInt(
    process.env.AI_MEDIA_GOOGLE_IMAGE_TIMEOUT_MS ||
      process.env.AI_MEDIA_IMAGE_TIMEOUT_MS,
    180_000,
    300_000
  );

  return await withEconomicGuard({
    accountId: args.accountId,
    model,
    referenceImagesCount: input.referenceImagesCount,
    signal: args.signal,
    operation: async (): Promise<AiMediaGatewayResult> => {
      const referenceRoleRules = buildImageReferenceRoleRules({
        identityMode: args.identityMode,
        input,
      });
      const ai = new GoogleGenAI({ apiKey: key });
      const interaction = await ai.interactions.create(
        {
          model,
          input: [
            {
              type: "text",
              text: referenceRoleRules
                ? `${args.prompt}\n\n${referenceRoleRules}`
                : args.prompt,
            },
            ...input.referenceImages.map((image, index) => ({
              type: "image" as const,
              mime_type: input.referenceMimeTypes[index],
              data: image.toString("base64"),
            })),
          ],
          store: false,
          response_format: {
            type: "image",
            aspect_ratio: resolveGoogleImageAspectRatio(args.size),
            image_size: "1K",
            mime_type: "image/jpeg",
            delivery: "inline",
          },
        },
        {
          timeout: timeoutMs,
          maxRetries: 0,
          ...(args.signal ? { fetchOptions: { signal: args.signal } } : {}),
        }
      );
      const encoded = String(interaction.output_image?.data || "").trim();
      if (!encoded || encoded.length > MAX_IMAGE_BYTES * 2) {
        throw new Error("ai_image_google_empty");
      }
      const buffer = Buffer.from(encoded, "base64");
      if (!buffer.byteLength) throw new Error("ai_image_google_empty");
      if (buffer.byteLength > MAX_IMAGE_BYTES) {
        throw new Error("ai_image_google_too_large");
      }
      return {
        kind: "image",
        provider: "google-gemini-direct",
        model,
        buffer,
        mediaType: interaction.output_image?.mime_type || "image/jpeg",
        referenceImagesCount: input.referenceImagesCount,
        identityReferenceImagesCount: input.strictIdentityReferences
          ? input.characterReferenceCount
          : 0,
        genericReferenceImagesCount:
          input.providedReferences.length -
          (input.strictIdentityReferences ? input.characterReferenceCount : 0),
        officialLogoIncluded: input.officialLogoIncluded,
        warnings: [],
        usage: cleanUsage(interaction.usage),
      };
    },
  });
}
