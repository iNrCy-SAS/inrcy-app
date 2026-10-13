import {
  getAiMediaVideoModel,
  getAiMediaVideoResolution,
  normalizeAiMediaImageEngine,
  type AiMediaImageEngine,
  type AiMediaVideoEngine,
  type AiMediaVideoResolution,
  type AiMediaVideoSceneMode,
} from "./aiMediaModelCatalog.ts";
import { getAiMediaVideoSegmentDurations } from "./aiMediaVideoTimeline.ts";

/** Commercial credit units, independent of supplier USD and credit pack prices. */
export const AI_MEDIA_CREDIT_TARIFF_VERSION = "inrstudio-media-credits-2026-10-v2" as const;
export type AiMediaCreditsQuoteInput = {
  kind: string;
  operation?: string;
  creationMode?: string;
  imageEngine?: unknown;
  videoEngine?: unknown;
  durationSeconds?: number | null;
  videoResolution?: unknown;
  inspirationImagesCount?: number;
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
}>;

export function quoteAiMediaCredits(input: AiMediaCreditsQuoteInput): AiMediaCreditsQuote {
  const inputReferences = input.inspirationImagesCount ?? 0;
  if (!Number.isSafeInteger(inputReferences) || inputReferences < 0 || inputReferences > 5) throw new Error("ai_media_credit_reference_count_invalid");
  // The server composes approved team portraits into one master image before egress.
  const composeFirstFrame = input.kind === "video" && (input.identityMode === "reference_team" || input.inputMode === "essential") && inputReferences > 0;
  const references = composeFirstFrame ? 1 : inputReferences;
  if (input.kind === "image") {
    const engine = normalizeAiMediaImageEngine(input.imageEngine ?? "openai");
    if (!engine) throw new Error("ai_media_image_engine_invalid");
    const referenceCredits = references * 2;
    return {
      tariffVersion: AI_MEDIA_CREDIT_TARIFF_VERSION,
      totalCredits: 7 + referenceCredits,
      breakdown: [
        { key: "image", label: input.operation === "modify" ? "Modification d'image" : "Génération d'image", credits: 7 },
        ...(referenceCredits ? [{ key: "references", label: "Images de référence", credits: referenceCredits }] : []),
      ],
      modelLabel: engine === "gemini" ? "Gemini Image" : "OpenAI Image",
      engine, durationSeconds: null, resolution: null, sceneMode: null,
    };
  }
  if (input.kind !== "video") throw new Error("ai_media_credit_kind_invalid");
  const model = getAiMediaVideoModel(input.videoEngine ?? "omni");
  const resolution = getAiMediaVideoResolution(model.id, input.videoResolution);
  const durationSeconds = input.durationSeconds ?? 8;
  let segments: readonly number[];
  try { segments = getAiMediaVideoSegmentDurations(durationSeconds, model.id, resolution, input.sceneMode as AiMediaVideoSceneMode); }
  catch { throw new Error("ai_media_video_duration_invalid"); }
  if (!references && !model.supportsTextToVideo) throw new Error("ai_media_video_reference_required");
  if (references && (!model.supportsImageToVideo || references > model.maxReferenceImages)) throw new Error("ai_media_video_references_unsupported");
  if (model.id === "veo" && references > 1 &&
    (input.sceneMode === "multi" ? segments.some((duration) => duration !== 8) : segments[0] !== 8)) throw new Error("ai_media_video_references_require_eight_seconds");
  const videoCredits = Math.ceil(durationSeconds * (model.creditsByResolution[resolution] ?? model.creditsPerSecond));
  const transmittedReferences = segments.length === 1 ? references
    : input.sceneMode === "multi" ? references * segments.length : references + 1;
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
  };
}

/** Conservative guard estimate only: never use this amount to debit Studio credits. */
export function estimateAiMediaVideoSupplierCostMicroUsd(input: AiMediaCreditsQuoteInput): number {
  const quote = quoteAiMediaCredits({ ...input, kind: "video" });
  const model = getAiMediaVideoModel(quote.engine);
  const rate = model.pricingUsdPerSecond[quote.resolution!];
  if (rate === undefined) throw new Error("ai_media_video_supplier_rate_missing");
  const rawReferences = input.inspirationImagesCount ?? 0;
  const effectiveReferences = (input.identityMode === "reference_team" || input.inputMode === "essential") && rawReferences > 0 ? 1 : rawReferences;
  const segments = getAiMediaVideoSegmentDurations(quote.durationSeconds!, model.id, quote.resolution, input.sceneMode as AiMediaVideoSceneMode);
  const referenceCount = segments.length === 1 ? effectiveReferences
    : input.sceneMode === "multi" ? effectiveReferences * segments.length : effectiveReferences + 1;
  const referenceUsd = model.provider === "spacexai" ? referenceCount * 0.01 : 0;
  return Math.ceil(((quote.durationSeconds ?? 0) * rate + referenceUsd) * 1_000_000);
}
