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
  AiMediaOperation,
} from "@/lib/aiMediaGenerationContracts";
import { redactAiMediaSensitiveText } from "@/lib/aiMediaSensitiveText";

const DEFAULT_IMAGE_MODEL = "openai/gpt-image-2.5-flare";
const DEFAULT_IMAGE_EDIT_MODEL = "openai/gpt-image-2.5-sunburst";
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
    Pick<AiMediaInspirationImage, "role" | "usage" | "characterIndex">
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

function resolveImageEditModel() {
  const configured = String(
    process.env.AI_GATEWAY_IMAGE_EDIT_MODEL ||
      process.env.AI_MEDIA_IMAGE_EDIT_MODEL ||
      "",
  ).trim();
  const model = configured || DEFAULT_IMAGE_EDIT_MODEL;
  if (!/^[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$/i.test(model)) {
    throw new Error("ai_media_edit_model_invalid");
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
    Pick<AiMediaInspirationImage, "role" | "usage" | "characterIndex">
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
    if (explicit?.role) {
      return {
        ...explicit,
        usage:
          explicit.usage ||
          (legacyStrictIdentity && explicit.role === "character"
            ? ("required" as const)
            : ("inspiration" as const)),
      };
    }
    return legacyStrictIdentity
      ? {
          role: "character" as const,
          usage: "required" as const,
          characterIndex: (index + 1) as 1 | 2 | 3,
        }
      : { usage: "inspiration" as const };
  });
  const characterReferenceCount = providedReferenceRoles.filter(
    (reference) =>
      reference.role === "character" && reference.usage === "required"
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
  operation?: AiMediaOperation;
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
  if (args.operation === "modify") {
    return [
      "CONTRAT DES IMAGES FOURNIES — MODE MODIFICATION :",
      "- Image 1 est l’image source exacte à modifier. Elle n’est ni une inspiration, ni un simple guide, ni un élément à intégrer dans une nouvelle scène.",
      "- Partir de cette image comme canvas. Appliquer strictement la consigne utilisateur aux seules zones nécessaires et conserver tous les pixels, sujets, identités, objets, cadrages et détails non concernés aussi fidèlement que possible.",
      "- Ne jamais produire une nouvelle scène libre, un collage, une planche avant/après, un cadre ou une variante seulement inspirée de la source.",
    ].join("\n");
  }
  return [
    "ORDRE DES IMAGES DE RÉFÉRENCE FOURNIES AU MODÈLE :",
    ...providedReferences.map((_, index) => {
      const reference = providedReferenceRoles[index];
      const imageNumber = index + 1;
      if (reference?.usage === "inspiration") {
        if (reference.role === "character") {
          return `- Image ${imageNumber} = inspiration uniquement, rôle Personnage : s’en servir pour guider librement le casting, la présence humaine, les attitudes ou l’énergie de la scène. Ne préserver ni recopier aucune identité, aucun visage, aucune silhouette ni tenue exacte.`;
        }
        if (reference.role === "product") {
          return `- Image ${imageNumber} = inspiration uniquement, rôle Produit : s’en servir pour guider librement la catégorie, le langage de formes, les matières ou la mise en valeur du produit. Ne reproduire ni imposer sa forme, sa marque, ses détails distinctifs ni son apparence exacte.`;
        }
        if (reference.role === "environment") {
          return `- Image ${imageNumber} = inspiration uniquement, rôle Décor : s’en servir pour guider librement l’ambiance, l’architecture, la lumière ou la palette du lieu. Ne reproduire ni imposer son plan, ses éléments reconnaissables ni son décor exact.`;
        }
        return `- Image ${imageNumber} = inspiration uniquement, rôle Inspiration libre : en extraire librement une ambiance, une palette, un rythme ou une idée de composition. Ne préserver ni recopier aucune identité, aucun produit, aucun décor, aucune pose ni aucun cadrage exact.`;
      }
      if (reference?.role === "character") {
        return `- Image ${imageNumber} = média Personnage obligatoire, adulte(s) autorisé(s). Détecter toutes les personnes distinctes visibles dans cette image, qu'il y en ait une ou plusieurs. Préserver séparément le visage, les traits, la silhouette et les signes distinctifs de chacune ; les faire toutes apparaître exactement une fois et les mettre naturellement en action selon le brief, sans fusion, permutation, duplication, omission ni substitution générique. Imaginer librement une nouvelle pose, un nouveau cadrage et un nouvel arrière-plan adaptés au sujet, sauf consigne explicite ou référence obligatoire qui les fixe. Ne jamais recopier ces éléments par défaut ; l'identité reste fidèle.`;
      }
      if (reference?.role === "environment") {
        return `- Image ${imageNumber} = décor de référence. Recréer son lieu, son ambiance et ses éléments reconnaissables comme environnement plein cadre de la nouvelle scène ; ne jamais l’utiliser comme une photo fixe ou un fond simplement déplacé.`;
      }
      if (reference?.role === "product") {
        return `- Image ${imageNumber} = produit à intégrer. Préserver son apparence, sa forme et ses détails distinctifs, puis l’intégrer naturellement une seule fois dans la nouvelle scène ; ne jamais le confondre avec un personnage ou un décor.`;
      }
      if (reference?.role === "inspiration") {
        return `- Image ${imageNumber} = média obligatoire non catégorisé : utiliser réellement tout contenu identifiable utile au brief. Conserver fidèlement les personnes, produits, objets, marques et lieux visibles ; ne transformer que leur mise en scène, leur action ou leur cadrage lorsque la consigne l'exige.`;
      }
      return strictIdentityReferences
        ? `- Image ${imageNumber} = référence d’identité autorisée. Préserver l’identité dans une scène entièrement nouvelle.`
        : `- Image ${imageNumber} = inspiration visuelle. En extraire les éléments pertinents sans recopier la photo source.`;
    }),
    officialLogoIncluded
      ? `- L'image ${referenceImagesCount} est exclusivement le logo officiel ; ne jamais la confondre avec une personne ni un décor.`
      : "- Aucun fichier de logo n'est fourni.",
    "- Une référence obligatoire est une source autoritaire : ses éléments liés au rôle choisi doivent réellement apparaître et rester reconnaissables. Une référence marquée inspiration ne fournit qu'une direction créative libre. Dans tous les cas, produire une scène plein cadre sans collage, cadre, planche comparative ni simple remise en page de la photo source.",
  ].join("\n");
}

function resolveGoogleImageAspectRatio(
  size: `${number}x${number}` | undefined
) {
  const [width, height] = String(size || "1024x1024")
    .split("x")
    .map((value) => Number.parseInt(value, 10));
  const ratio = width > 0 && height > 0 ? width / height : 1;
  const supported = [
    ["1:4", 1 / 4],
    ["9:16", 9 / 16],
    ["2:3", 2 / 3],
    ["3:4", 3 / 4],
    ["4:5", 4 / 5],
    ["1:1", 1],
    ["5:4", 5 / 4],
    ["4:3", 4 / 3],
    ["3:2", 3 / 2],
    ["16:9", 16 / 9],
    ["21:9", 21 / 9],
    ["4:1", 4],
  ] as const;
  return supported.reduce((closest, candidate) =>
    Math.abs(Math.log(ratio / candidate[1])) <
    Math.abs(Math.log(ratio / closest[1]))
      ? candidate
      : closest,
  )[0];
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
  operation?: AiMediaOperation;
  identityMode: AiMediaIdentityMode;
  /**
   * Références ponctuelles explicitement autorisées par le professionnel.
   * Elles restent en mémoire le temps de l'appel et ne sont pas inscrites en
   * Médiathèque ni dans ses préférences.
   */
  identityReferences?: readonly Buffer[];
  referenceRoles?: ReadonlyArray<
    Pick<AiMediaInspirationImage, "role" | "usage" | "characterIndex">
  >;
  /** Logo officiel chargé depuis le stockage de l'établissement actif. */
  officialLogo?: Buffer | null;
  size?: `${number}x${number}`;
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
  // Les modifications locales privilégient le modèle qualité/édition. Flare
  // reste le modèle rapide par défaut pour les générations ordinaires.
  const providerModel =
    args.operation === "modify" ? resolveImageEditModel() : model;
  const timeoutMs = positiveInt(
    process.env.AI_MEDIA_IMAGE_TIMEOUT_MS,
    210_000,
    300_000
  );

  return await withEconomicGuard({
    accountId: args.accountId,
    model: providerModel,
    referenceImagesCount,
    signal: args.signal,
    operation: async (): Promise<AiMediaGatewayResult> => {
      const referenceRoleRules = buildImageReferenceRoleRules({
        identityMode: args.identityMode,
        operation: args.operation,
        input,
      });
      const result = await generateImage({
        model: providerModel,
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
        providerOptions: providerModel.startsWith("openai/")
          ? {
              openai: {
                quality: args.operation === "modify" ? "high" : "medium",
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
        model: providerModel,
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
  operation?: AiMediaOperation;
  identityMode: AiMediaIdentityMode;
  identityReferences?: readonly Buffer[];
  referenceRoles?: ReadonlyArray<
    Pick<AiMediaInspirationImage, "role" | "usage" | "characterIndex">
  >;
  officialLogo?: Buffer | null;
  size?: `${number}x${number}`;
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
        operation: args.operation,
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
