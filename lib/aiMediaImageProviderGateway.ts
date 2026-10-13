import "server-only";

import sharp from "sharp";
import { experimental_generateImage as generateImage } from "ai";
import {
  commitAiGatewayAccountAttempt, recordAiGatewayAccountFailure,
  reserveAiGatewayAccountAttempt, rollbackAiGatewayAccountAttempt,
} from "@/lib/aiGatewayAccountGuard";
import { bufferFromUint8ArrayView } from "./aiMediaBuffer.ts";
import {
  AI_MEDIA_IMAGE_REFERENCE_MAX_PIXELS, AI_MEDIA_FLUX_OUTPUT_MAX_PIXELS, getAiMediaImageDimensions, getAiMediaImageModel,
} from "./aiMediaModelCatalog.ts";
import { estimateAiMediaImageSupplierCostMicroUsd } from "./aiMediaCreditsPricing.ts";
import { redactAiMediaSensitiveText } from "./aiMediaSensitiveText.ts";
import type { AiMediaOperation, AiMediaOutputFormat } from "./aiMediaGenerationContracts.ts";
import type { AiMediaGatewayResult, AiMediaImageProviderInput } from "./aiMediaGateway";

export type AiMediaGatewayImageEngine = "flux" | "grok" | "recraft";
const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
const MAX_REFERENCE_BYTES = 20 * 1024 * 1024;
const RASTER_FORMATS = new Set(["jpeg", "png", "webp"]);

function safeDiagnostic(value: unknown) {
  return redactAiMediaSensitiveText(value, 700).replace(/https?:\/\/[^\s"'<>]+/g, "[provider-url-redacted]");
}

/** Only an explicit HTTP rejection proves that a submitted job was not accepted. */
function isExplicitUnbillableImageRejection(error: unknown): boolean {
  const rejectedStatuses = new Set([400, 401, 403, 404, 422, 429]);
  const visited = new Set<object>();
  let current = error;
  while (current && typeof current === "object" && !visited.has(current)) {
    visited.add(current);
    const record = current as { statusCode?: unknown; status?: unknown; cause?: unknown };
    for (const candidate of [record.statusCode, record.status]) {
      if (typeof candidate !== "number" && typeof candidate !== "string") continue;
      const status = Number(candidate);
      if (Number.isInteger(status) && status >= 400 && status <= 599) return rejectedStatuses.has(status);
    }
    current = record.cause;
  }
  return false;
}

function dimensionsFromSize(size?: `${number}x${number}`) {
  const match = String(size || "1024x1024").match(/^(\d{2,5})x(\d{2,5})$/);
  if (!match) throw new Error("ai_image_gateway_size_invalid");
  const width = Number(match[1]);
  const height = Number(match[2]);
  if (width < 256 || height < 256 || width > 4096 || height > 4096) throw new Error("ai_image_gateway_size_invalid");
  return { width, height };
}

function nearestFormat(width: number, height: number): AiMediaOutputFormat {
  const formats = ["square", "portrait", "story", "landscape"] as const;
  return formats.reduce((best, format) => {
    const candidate = getAiMediaImageDimensions("flux", format)!;
    const prior = getAiMediaImageDimensions("flux", best)!;
    const ratio = width / height;
    return Math.abs(Math.log(ratio / (candidate.width / candidate.height))) < Math.abs(Math.log(ratio / (prior.width / prior.height))) ? format : best;
  }, "square" as AiMediaOutputFormat);
}

/** Native FLUX editing keeps the source ratio within the application's flat 2MP tariff. */
export function resolveAiMediaGatewayImageSize(engine: AiMediaGatewayImageEngine, size?: `${number}x${number}`, format?: AiMediaOutputFormat): {
  width: number; height: number; size?: `${number}x${number}`; aspectRatio?: `${number}:${number}`;
} {
  const desired = format ? (getAiMediaImageDimensions(engine, format) || getAiMediaImageDimensions("flux", format)!) : dimensionsFromSize(size);
  if (engine === "recraft") {
    const dimensions = getAiMediaImageDimensions(engine, format || nearestFormat(desired.width, desired.height))!;
    return { ...dimensions, size: `${dimensions.width}x${dimensions.height}` as `${number}x${number}` };
  }
  if (engine === "grok") {
    const ratios = ["1:1", "9:16", "16:9", "3:2", "2:3", "3:4", "4:3", "2:1", "1:2"] as const;
    const ratio = desired.width / desired.height;
    const aspectRatio = ratios.reduce((best, candidate) => {
      const [width, height] = candidate.split(":").map(Number);
      const [priorWidth, priorHeight] = best.split(":").map(Number);
      return Math.abs(Math.log(ratio / (width / height))) < Math.abs(Math.log(ratio / (priorWidth / priorHeight))) ? candidate : best;
    }, "1:1" as typeof ratios[number]);
    return { ...desired, aspectRatio };
  }
  const scale = Math.min(1, Math.sqrt(AI_MEDIA_FLUX_OUTPUT_MAX_PIXELS / (desired.width * desired.height)), 1920 / Math.max(desired.width, desired.height));
  const width = Math.max(256, Math.floor(desired.width * scale / 16) * 16);
  const height = Math.max(256, Math.floor(desired.height * scale / 16) * 16);
  if (width * height > AI_MEDIA_FLUX_OUTPUT_MAX_PIXELS || width / height > 4 || height / width > 4) throw new Error("ai_image_gateway_size_invalid");
  return { width, height, size: `${width}x${height}` as `${number}x${number}` };
}

/** Synchronous capability gate, usable before paying for any creative preparation. */
export function assertAiMediaGatewayImageInputs(args: {
  engine: AiMediaGatewayImageEngine; operation?: AiMediaOperation;
  referenceImagesCount: number; size?: `${number}x${number}`; format?: AiMediaOutputFormat; prompt?: string;
}): void {
  const model = getAiMediaImageModel(args.engine);
  if (!model.modelId) throw new Error("ai_image_gateway_model_missing");
  if (!["flux", "grok", "recraft"].includes(args.engine)) throw new Error("ai_image_gateway_engine_invalid");
  if (args.operation === "modify" && !model.supportsModify) throw new Error("ai_image_gateway_modify_unsupported");
  if (!Number.isInteger(args.referenceImagesCount) || args.referenceImagesCount < 0 || args.referenceImagesCount > model.maxReferenceImages) throw new Error("ai_image_gateway_reference_count_unsupported");
  if (args.referenceImagesCount > 0 && !model.supportsReferences) throw new Error("ai_image_gateway_references_unsupported");
  if (args.operation === "modify" && args.referenceImagesCount === 0) throw new Error("ai_image_gateway_modify_source_required");
  if (args.prompt !== undefined && (!args.prompt.trim() || (args.engine === "recraft" && args.prompt.length > 10_000))) throw new Error("ai_image_gateway_prompt_invalid");
  resolveAiMediaGatewayImageSize(args.engine, args.size, args.format);
}

/** Decode trusted in-memory raster inputs and bound each billed reference to one megapixel. */
export async function prepareAiMediaGatewayImageReferences(args: {
  engine: AiMediaGatewayImageEngine; references: readonly Buffer[]; signal?: AbortSignal;
}): Promise<Buffer[]> {
  assertAiMediaGatewayImageInputs({ engine: args.engine, referenceImagesCount: args.references.length });
  const output: Buffer[] = [];
  for (const buffer of args.references) {
    args.signal?.throwIfAborted();
    if (!buffer.byteLength || buffer.byteLength > MAX_REFERENCE_BYTES) throw new Error("ai_image_gateway_reference_invalid");
    const metadata = await sharp(buffer, { failOn: "error", limitInputPixels: 50_000_000, pages: 1 }).metadata();
    if (!metadata.width || !metadata.height || !RASTER_FORMATS.has(metadata.format || "") || (metadata.pages || 1) !== 1) throw new Error("ai_image_gateway_reference_raster_required");
    const rotated = metadata.orientation && metadata.orientation >= 5 && metadata.orientation <= 8;
    const width = rotated ? metadata.height : metadata.width;
    const height = rotated ? metadata.width : metadata.height;
    const scale = Math.min(1, Math.sqrt(AI_MEDIA_IMAGE_REFERENCE_MAX_PIXELS / (width * height)), 2048 / Math.max(width, height));
    const resized = await sharp(buffer, { failOn: "error", limitInputPixels: 50_000_000, pages: 1 }).rotate().resize({
      width: Math.max(1, Math.floor(width * scale)), height: Math.max(1, Math.floor(height * scale)), fit: "inside", withoutEnlargement: true,
    }).png().toBuffer({ resolveWithObject: true });
    if (resized.info.width * resized.info.height > AI_MEDIA_IMAGE_REFERENCE_MAX_PIXELS || resized.data.byteLength > MAX_REFERENCE_BYTES) throw new Error("ai_image_gateway_reference_size_invalid");
    output.push(resized.data);
  }
  return output;
}

export async function generateAiMediaImageWithGatewayModel(args: {
  accountId: string; engine: AiMediaGatewayImageEngine; prompt: string;
  operation?: AiMediaOperation; input: AiMediaImageProviderInput; referenceRoleRules: string;
  size?: `${number}x${number}`; format?: AiMediaOutputFormat; signal?: AbortSignal;
}): Promise<AiMediaGatewayResult> {
  args.signal?.throwIfAborted();
  const fullPrompt = args.referenceRoleRules ? `${args.prompt}\n\n${args.referenceRoleRules}` : args.prompt;
  assertAiMediaGatewayImageInputs({ ...args, referenceImagesCount: args.input.referenceImages.length, prompt: fullPrompt });
  if (!String(process.env.AI_GATEWAY_API_KEY || process.env.VERCEL_OIDC_TOKEN || "").trim()) throw new Error("ai_gateway_credentials_missing");
  const model = getAiMediaImageModel(args.engine);
  const dimensions = resolveAiMediaGatewayImageSize(args.engine, args.size, args.operation === "modify" ? undefined : args.format);
  const modelId = model.modelId;
  if (!modelId) throw new Error("ai_image_gateway_model_missing");
  const references = await prepareAiMediaGatewayImageReferences({ engine: args.engine, references: args.input.referenceImages, signal: args.signal });
  args.signal?.throwIfAborted();
  const costMicroUsd = estimateAiMediaImageSupplierCostMicroUsd({ engine: args.engine, referenceImagesCount: references.length, format: args.format, operation: args.operation });
  const reservation = await reserveAiGatewayAccountAttempt(args.accountId, { feature: "media.image", estimatedInputTokens: 0, reservedOutputTokens: 0, estimatedCostMicroUsd: costMicroUsd });
  let billable = false;
  let submitted = false;
  let committed = false;
  const commit = async () => {
    if (committed) return;
    await commitAiGatewayAccountAttempt({ reservation, feature: "media.image", model: modelId,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, actualCostMicroUsd: costMicroUsd });
    committed = true;
  };
  try {
    args.signal?.throwIfAborted();
    submitted = true;
    const result = await generateImage({
      model: modelId, prompt: references.length ? { text: fullPrompt, images: references } : fullPrompt,
      n: 1, maxImagesPerCall: 1, maxRetries: 0,
      ...(args.engine === "grok" ? { aspectRatio: dimensions.aspectRatio }
        : args.engine === "recraft" ? { size: dimensions.size, providerOptions: { recraft: { style: "any" } } }
          : { providerOptions: { blackForestLabs: { width: dimensions.width, height: dimensions.height, outputFormat: "jpeg", pollTimeoutMillis: 180_000 } } }),
      abortSignal: args.signal ? AbortSignal.any([args.signal, AbortSignal.timeout(210_000)]) : AbortSignal.timeout(210_000),
    });
    billable = result.images.length > 0;
    if (result.images.length !== 1) throw new Error("ai_image_gateway_output_count_invalid");
    if (references.length && result.warnings.some((warning) => warning.type === "unsupported" && /image|file|reference|edit/i.test(warning.feature))) {
      throw new Error("ai_image_gateway_references_unsupported");
    }
    const image = result.images[0];
    const buffer = bufferFromUint8ArrayView(image.uint8Array);
    if (!buffer.byteLength || buffer.byteLength > MAX_IMAGE_BYTES || image.mediaType === "image/svg+xml") throw new Error("ai_image_gateway_output_raster_required");
    const metadata = await sharp(buffer, { failOn: "error", limitInputPixels: 50_000_000, pages: 1 }).metadata();
    if (!RASTER_FORMATS.has(metadata.format || "") || !metadata.width || !metadata.height || (metadata.pages || 1) !== 1) throw new Error("ai_image_gateway_output_raster_required");
    await commit();
    return {
      kind: "image", provider: "vercel-ai-gateway", engine: args.engine, upstreamProvider: model.provider,
      model: modelId, buffer, mediaType: image.mediaType || `image/${metadata.format}`,
      referenceImagesCount: references.length, identityReferenceImagesCount: args.input.strictIdentityReferences ? args.input.characterReferenceCount : 0,
      genericReferenceImagesCount: args.input.providedReferences.length - (args.input.strictIdentityReferences ? args.input.characterReferenceCount : 0),
      officialLogoIncluded: args.input.officialLogoIncluded,
      warnings: result.warnings.slice(0, 12).map(safeDiagnostic),
      usage: result.usage ? { inputTokens: result.usage.inputTokens, outputTokens: result.usage.outputTokens, totalTokens: result.usage.totalTokens } : null,
    };
  } catch (error) {
    const uncertainCost = submitted && !billable && !isExplicitUnbillableImageRejection(error);
    if (billable || uncertainCost) await commit().catch(() => undefined);
    else await rollbackAiGatewayAccountAttempt(reservation).catch(() => undefined);
    if (!args.signal?.aborted) await recordAiGatewayAccountFailure({ accountId: args.accountId, feature: "media.image", model: modelId }).catch(() => undefined);
    const code = safeDiagnostic(error);
    throw new Error(billable ? `ai_image_gateway_billable_failure:${args.engine}:${code}`
      : uncertainCost ? `ai_image_gateway_uncertain_failure:${args.engine}:${code}` : code);
  }
}
