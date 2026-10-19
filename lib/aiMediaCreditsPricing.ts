import {
  getAiMediaImageDimensions,
  getAiMediaImageModel,
  isAiMediaImageModelCompatible,
  normalizeAiMediaImageFormat,
  getAiMediaVideoModelForCharacterVoice,
  getAiMediaVideoResolution,
  normalizeAiMediaImageEngine,
  type AiMediaImageEngine,
  type AiMediaImageFormat,
  type AiMediaImageDimensions,
  type AiMediaVideoEngine,
  type AiMediaVideoResolution,
  type AiMediaVideoSceneMode,
} from "./aiMediaModelCatalog.ts";
import { getAiMediaVideoSegmentDurations } from "./aiMediaVideoTimeline.ts";
import { isAiMediaCharacterVoiceEngine } from "./aiMediaCharacterVoices.ts";

/** Commercial credit units, independent of supplier USD and credit pack prices. */
export const AI_MEDIA_CREDIT_TARIFF_VERSION = "inrstudio-media-credits-2026-10-v4" as const;
export type AiMediaCreditsQuoteInput = {
  kind: string;
  operation?: string;
  creationMode?: string;
  imageEngine?: unknown;
  format?: unknown;
  videoEngine?: unknown;
  durationSeconds?: number | null;
  videoResolution?: unknown;
  inspirationImagesCount?: number;
  hasProvidedCharacterVoice?: boolean;
  withNarration?: boolean;
  voiceMode?: string;
  teamVideoSpeechMode?: string;
  identityMode?: string;
  inputMode?: string;
  sceneMode?: string;
};
export type AiMediaCreditsQuote = Readonly<{
  tariffVersion: typeof AI_MEDIA_CREDIT_TARIFF_VERSION;
  totalCredits: number;
  breakdown: readonly { key: string; label: string; credits: number }[];
  modelLabel: string;
  engine: AiMediaVideoEngine | AiMediaImageEngine;
  durationSeconds: number | null;
  resolution: AiMediaVideoResolution | null;
  sceneMode: AiMediaVideoSceneMode | null;
  imageFormat: AiMediaImageFormat | null;
  imageDimensions: AiMediaImageDimensions | null;
}>;

function transmittedVideoReferences(input: AiMediaCreditsQuoteInput, model: ReturnType<typeof getAiMediaVideoModelForCharacterVoice>, references: number, segmentCount: number) {
  if (input.hasProvidedCharacterVoice || model.id === "wan27") {
    // R2V repeats original image/voice associations for every clip. Only Wan 2.7
    // also accepts a distinct continuation image when there is room for it.
    return references * segmentCount + (model.id === "wan27" && segmentCount > 1 && input.sceneMode !== "multi" && references < model.maxReferenceImages ? segmentCount - 1 : 0);
  }
  return segmentCount === 1 ? references : input.sceneMode === "multi" ? references * segmentCount : references + segmentCount - 1;
}

export function quoteAiMediaCredits(input: AiMediaCreditsQuoteInput): AiMediaCreditsQuote {
  const inputReferences = input.inspirationImagesCount ?? 0;
  if (!Number.isSafeInteger(inputReferences) || inputReferences < 0 || inputReferences > 5) throw new Error("ai_media_credit_reference_count_invalid");
  if (input.hasProvidedCharacterVoice !== undefined && typeof input.hasProvidedCharacterVoice !== "boolean") throw new Error("ai_media_credit_voice_option_invalid");
  const hasProvidedVoice = input.hasProvidedCharacterVoice === true;
  const videoModel = input.kind === "video" ? getAiMediaVideoModelForCharacterVoice(input.videoEngine ?? "omni", hasProvidedVoice) : null;
  if (hasProvidedVoice && (input.kind !== "video" || !isAiMediaCharacterVoiceEngine(videoModel?.id))) throw new Error("ai_media_video_voice_engine_unsupported");
  // R2V retains each original portrait and its voice binding. Other engines use a composed first frame.
  const composeFirstFrame = input.kind === "video" && videoModel?.id !== "wan27" && !hasProvidedVoice &&
    (input.identityMode === "reference_team" || input.inputMode === "essential") && inputReferences > 0;
  const references = composeFirstFrame ? 1 : inputReferences;
  if (input.kind === "image") {
    const engine = normalizeAiMediaImageEngine(input.imageEngine ?? "openai");
    if (!engine) throw new Error("ai_media_image_engine_invalid");
    const format = normalizeAiMediaImageFormat(input.format ?? "square");
    if (!format) throw new Error("ai_media_image_format_invalid");
    const model = getAiMediaImageModel(engine);
    if (!isAiMediaImageModelCompatible({ engine, operation: input.operation, inspirationImagesCount: references })) {
      throw new Error(input.operation === "modify" ? "ai_media_image_modification_unsupported" : "ai_media_image_references_unsupported");
    }
    const referenceCredits = references * model.referenceInputCredits;
    return {
      tariffVersion: AI_MEDIA_CREDIT_TARIFF_VERSION,
      totalCredits: model.baseCredits + referenceCredits,
      breakdown: [
        { key: "image", label: input.operation === "modify" ? "Modification d'image" : "Génération d'image", credits: model.baseCredits },
        ...(referenceCredits ? [{ key: "references", label: "Images de référence", credits: referenceCredits }] : []),
      ],
      modelLabel: model.label,
      engine, durationSeconds: null, resolution: null, sceneMode: null,
      imageFormat: format,
      // Editing preserves a custom source canvas, bounded by the provider's
      // flat tariff. A preset must not be reported as its actual dimensions.
      imageDimensions: input.operation === "modify" ? null : getAiMediaImageDimensions(engine, format),
    };
  }
  if (input.kind !== "video") throw new Error("ai_media_credit_kind_invalid");
  const model = videoModel!;
  const resolution = getAiMediaVideoResolution(model.id, input.videoResolution);
  const durationSeconds = input.durationSeconds ?? 8;
  let segments: readonly number[];
  try { segments = getAiMediaVideoSegmentDurations(durationSeconds, model.id, resolution, input.sceneMode as AiMediaVideoSceneMode); }
  catch { throw new Error("ai_media_video_duration_invalid"); }
  if (!references && (hasProvidedVoice || !model.supportsTextToVideo)) throw new Error("ai_media_video_reference_required");
  if (references && (!model.supportsImageToVideo || references > model.maxReferenceImages)) throw new Error("ai_media_video_references_unsupported");
  if (model.id === "veo" && references > 1 &&
    (input.sceneMode === "multi" ? segments.some((duration) => duration !== 8) : segments[0] !== 8)) throw new Error("ai_media_video_references_require_eight_seconds");
  const videoCredits = Math.ceil(durationSeconds * (model.creditsByResolution[resolution] ?? model.creditsPerSecond));
  const transmittedReferences = transmittedVideoReferences(input, model, references, segments.length);
  const referenceCredits = transmittedReferences * model.referenceInputCredits;
  // Libre always runs the creative director; this also covers optional logo preparation.
  // With uploaded references the first-frame package replaces, rather than adds to, that fee.
  const preparationCredits = composeFirstFrame ? 7 + inputReferences * 2 : input.creationMode === "free" ? 7 : 0;
  const preparationLabel = composeFirstFrame ? "Préparation de la première image" : "Préparation créative";
  const nativeDialogue = input.teamVideoSpeechMode === "characters" || input.voiceMode === "characters";
  const narrationCredits = input.withNarration && input.creationMode !== "free" && !nativeDialogue ? 2 : 0;
  return {
    tariffVersion: AI_MEDIA_CREDIT_TARIFF_VERSION,
    totalCredits: videoCredits + referenceCredits + narrationCredits + preparationCredits,
    breakdown: [
      { key: "video", label: `${model.label} · ${durationSeconds} s · ${resolution}`, credits: videoCredits },
      ...(preparationCredits ? [{ key: "preparation", label: preparationLabel, credits: preparationCredits }] : []),
      ...(referenceCredits ? [{ key: "references", label: "Images de référence", credits: referenceCredits }] : []),
      ...(narrationCredits ? [{ key: "narration", label: "Voix off", credits: narrationCredits }] : []),
    ],
    modelLabel: model.label, engine: model.id, durationSeconds, resolution, sceneMode: input.sceneMode === "multi" ? "multi" : "single",
    imageFormat: null, imageDimensions: null,
  };
}

/** Bounded upstream reservation only; commercial credits remain a separate tariff. */
export function estimateAiMediaImageSupplierCostMicroUsd(input: { engine: unknown; referenceImagesCount?: number; format?: unknown; operation?: string }): number {
  const model = getAiMediaImageModel(input.engine);
  const references = input.referenceImagesCount ?? 0;
  if (!isAiMediaImageModelCompatible({ engine: model.id, operation: input.operation, inspirationImagesCount: references })) {
    throw new Error("ai_media_image_references_unsupported");
  }
  if (!normalizeAiMediaImageFormat(input.format ?? "square")) throw new Error("ai_media_image_format_invalid");
  if (model.supplierBaseCostMicroUsd === null) throw new Error("ai_media_image_supplier_rate_missing");
  return model.supplierBaseCostMicroUsd + references * model.supplierReferenceCostMicroUsd;
}

/** Conservative guard estimate only: never use this amount to debit Studio credits. */
export function estimateAiMediaVideoSupplierCostMicroUsd(input: AiMediaCreditsQuoteInput): number {
  const quote = quoteAiMediaCredits({ ...input, kind: "video" });
  const model = getAiMediaVideoModelForCharacterVoice(quote.engine, input.hasProvidedCharacterVoice);
  const rate = model.pricingUsdPerSecond[quote.resolution!];
  if (rate === undefined) throw new Error("ai_media_video_supplier_rate_missing");
  const rawReferences = input.inspirationImagesCount ?? 0;
  const effectiveReferences = model.id !== "wan27" && !input.hasProvidedCharacterVoice && (input.identityMode === "reference_team" || input.inputMode === "essential") && rawReferences > 0 ? 1 : rawReferences;
  const segments = getAiMediaVideoSegmentDurations(quote.durationSeconds!, model.id, quote.resolution, input.sceneMode as AiMediaVideoSceneMode);
  const referenceCount = transmittedVideoReferences(input, model, effectiveReferences, segments.length);
  return Math.ceil((quote.durationSeconds ?? 0) * rate * 1_000_000)
    + referenceCount * model.supplierReferenceCostMicroUsd;
}
