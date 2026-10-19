/** Public Studio catalogue. Provider cost estimates are USD, never credit sale prices.
 * Gateway IDs/capabilities verified on 2026-10-13; Wan 2.7 verified on 2026-10-19 against /v1/models.
 */
export type AiMediaVideoEngine =
  | "omni" | "veo" | "veo-lite" | "minimax-h3"
  | "wan-flash" | "wan27" | "wan3" | "grok-lite" | "grok" | "heygen";
export type AiMediaImageEngine = "openai" | "gemini" | "flux" | "grok" | "recraft";
export type AiMediaImageFormat = "square" | "portrait" | "story" | "landscape";
export type AiMediaImageDimensions = Readonly<{ width: number; height: number }>;
export type AiMediaImageModel = Readonly<{
  id: AiMediaImageEngine;
  label: string;
  provider: "openai" | "google" | "bfl" | "spacexai" | "recraft";
  providerLabel: string;
  transport: "existing" | "gateway-image";
  modelId: string | null;
  description: string;
  baseCredits: number;
  referenceInputCredits: number;
  supportsReferences: boolean;
  supportsModify: boolean;
  maxReferenceImages: number;
  supplierBaseCostMicroUsd: number | null;
  supplierReferenceCostMicroUsd: number;
}>;

// Bounds deliberately use decimal megapixels: valid under either MP convention.
export const AI_MEDIA_IMAGE_REFERENCE_MAX_PIXELS = 1_000_000;
export const AI_MEDIA_FLUX_OUTPUT_MAX_PIXELS = 2_000_000;
export type AiMediaVideoResolution = "720p" | "768p" | "1080p";
export type AiMediaVideoSceneMode = "single" | "multi";
export type AiMediaVideoModel = Readonly<{
  id: AiMediaVideoEngine;
  label: string;
  family: "Google" | "MiniMax" | "Alibaba" | "Grok" | "HeyGen";
  provider: "google" | "minimax" | "alibaba" | "spacexai" | "heygen";
  providerLabel: string;
  transport: "google-direct" | "gateway";
  modelId: string;
  description: string;
  costTier: "economy" | "balanced" | "premium";
  creditsPerSecond: number;
  creditsByResolution: Readonly<Partial<Record<AiMediaVideoResolution, number>>>;
  durationsSeconds: readonly number[];
  maxDurationSeconds: number;
  resolutions: readonly AiMediaVideoResolution[];
  defaultResolution: AiMediaVideoResolution;
  nativeAudio: boolean;
  frenchDialogue: "supported" | "to-verify";
  supportsTextToVideo: boolean;
  supportsImageToVideo: boolean;
  maxReferenceImages: number;
  pricingUsdPerSecond: Readonly<Partial<Record<AiMediaVideoResolution, number>>>;
  supplierReferenceCostMicroUsd: number;
  referenceInputCredits: number;
}>;

const range = (from: number, to: number) =>
  Object.freeze(Array.from({ length: to - from + 1 }, (_, index) => from + index));

export const AI_MEDIA_VIDEO_MODELS: readonly AiMediaVideoModel[] = Object.freeze([
  {
    id: "omni", label: "Gemini Omni", family: "Google", provider: "google", providerLabel: "Google",
    transport: "google-direct", modelId: "gemini-omni-1.1-flash",
    description: "Vidéo polyvalente et audio natif, moteur actuel du Studio.", costTier: "premium",
    creditsPerSecond: 10, creditsByResolution: { "720p": 10 },
    durationsSeconds: range(4, 10), maxDurationSeconds: 20, resolutions: ["720p"], defaultResolution: "720p",
    nativeAudio: true, frenchDialogue: "to-verify", supportsTextToVideo: true, supportsImageToVideo: true,
    maxReferenceImages: 5, pricingUsdPerSecond: { "720p": 0.1 }, supplierReferenceCostMicroUsd: 0, referenceInputCredits: 0,
  },
  {
    id: "veo", label: "Veo 3.1 Fast", family: "Google", provider: "google", providerLabel: "Google",
    transport: "google-direct", modelId: "veo-3.1-fast-generate-001",
    description: "Plans cinématiques et dialogues natifs.", costTier: "premium",
    creditsPerSecond: 10, creditsByResolution: { "720p": 10, "1080p": 12 },
    durationsSeconds: [4, 6, 8], maxDurationSeconds: 16, resolutions: ["720p", "1080p"], defaultResolution: "720p",
    nativeAudio: true, frenchDialogue: "to-verify", supportsTextToVideo: true, supportsImageToVideo: true,
    maxReferenceImages: 3, pricingUsdPerSecond: { "720p": 0.1, "1080p": 0.12 }, supplierReferenceCostMicroUsd: 0, referenceInputCredits: 0,
  },
  {
    id: "veo-lite", label: "Veo 3.1 Lite", family: "Google", provider: "google", providerLabel: "Google",
    transport: "gateway", modelId: "google/veo-3.1-lite-generate-001",
    description: "Alternative Google économique avec audio.", costTier: "economy",
    creditsPerSecond: 5, creditsByResolution: { "720p": 5, "1080p": 8 },
    durationsSeconds: [4, 6, 8], maxDurationSeconds: 16, resolutions: ["720p", "1080p"], defaultResolution: "720p",
    nativeAudio: true, frenchDialogue: "to-verify", supportsTextToVideo: true,
    // Google's spec supports one starting image; multiple style references are unavailable.
    supportsImageToVideo: true, maxReferenceImages: 1,
    pricingUsdPerSecond: { "720p": 0.05, "1080p": 0.08 }, supplierReferenceCostMicroUsd: 0, referenceInputCredits: 0,
  },
  {
    id: "minimax-h3", label: "MiniMax H3", family: "MiniMax", provider: "minimax", providerLabel: "MiniMax",
    transport: "gateway", modelId: "minimax/minimax-h3",
    description: "Références multiples et dialogues en français annoncés par MiniMax.", costTier: "balanced",
    creditsPerSecond: 8, creditsByResolution: { "768p": 8 },
    durationsSeconds: range(4, 15), maxDurationSeconds: 30, resolutions: ["768p"], defaultResolution: "768p",
    nativeAudio: true, frenchDialogue: "supported", supportsTextToVideo: true, supportsImageToVideo: true,
    maxReferenceImages: 9, pricingUsdPerSecond: { "768p": 0.08 }, supplierReferenceCostMicroUsd: 0, referenceInputCredits: 0,
  },
  {
    id: "wan-flash", label: "Wan 2.6 Flash", family: "Alibaba", provider: "alibaba", providerLabel: "Alibaba",
    transport: "gateway", modelId: "alibaba/wan-v2.6-i2v-flash",
    description: "Animation économique d'une photo avec audio natif.", costTier: "economy",
    creditsPerSecond: 5, creditsByResolution: { "720p": 5, "1080p": 7.5 },
    durationsSeconds: range(4, 15), maxDurationSeconds: 30, resolutions: ["720p", "1080p"], defaultResolution: "720p",
    nativeAudio: true, frenchDialogue: "to-verify", supportsTextToVideo: false, supportsImageToVideo: true,
    maxReferenceImages: 1, pricingUsdPerSecond: { "720p": 0.05, "1080p": 0.075 }, supplierReferenceCostMicroUsd: 0, referenceInputCredits: 0,
  },
  {
    id: "wan27", label: "Wan 2.7 R2V", family: "Alibaba", provider: "alibaba", providerLabel: "Alibaba",
    transport: "gateway", modelId: "alibaba/wan-v2.7-r2v",
    description: "Personnages de référence avec voix fournie et audio synchronisé.", costTier: "premium",
    creditsPerSecond: 10, creditsByResolution: { "720p": 10, "1080p": 15 },
    durationsSeconds: range(2, 10), maxDurationSeconds: 20, resolutions: ["720p", "1080p"], defaultResolution: "720p",
    nativeAudio: true, frenchDialogue: "to-verify", supportsTextToVideo: false, supportsImageToVideo: true,
    maxReferenceImages: 5, pricingUsdPerSecond: { "720p": 0.1, "1080p": 0.15 }, supplierReferenceCostMicroUsd: 0, referenceInputCredits: 0,
  },
  {
    id: "wan3", label: "Wan 3.0", family: "Alibaba", provider: "alibaba", providerLabel: "Alibaba",
    transport: "gateway", modelId: "alibaba/wan-v3.0-video",
    description: "Vidéo et audio synchronisés, références et clips jusqu'à 30 secondes.", costTier: "premium",
    creditsPerSecond: 10, creditsByResolution: { "720p": 10, "1080p": 20 },
    durationsSeconds: range(4, 30), maxDurationSeconds: 30, resolutions: ["720p", "1080p"], defaultResolution: "720p",
    nativeAudio: true, frenchDialogue: "to-verify", supportsTextToVideo: true, supportsImageToVideo: true,
    maxReferenceImages: 10, pricingUsdPerSecond: { "720p": 0.1, "1080p": 0.2 }, supplierReferenceCostMicroUsd: 0, referenceInputCredits: 0,
  },
  {
    id: "grok-lite", label: "Grok Imagine Lite", family: "Grok", provider: "spacexai", providerLabel: "Grok",
    transport: "gateway", modelId: "spacexai/grok-imagine-video-1.5-lite",
    description: "Clips courts et audio natif à faible consommation.", costTier: "economy",
    creditsPerSecond: 3, creditsByResolution: { "720p": 3, "1080p": 14 },
    durationsSeconds: range(4, 15), maxDurationSeconds: 30, resolutions: ["720p", "1080p"], defaultResolution: "720p",
    nativeAudio: true, frenchDialogue: "to-verify", supportsTextToVideo: true, supportsImageToVideo: true,
    maxReferenceImages: 1, pricingUsdPerSecond: { "720p": 0.03, "1080p": 0.14 }, supplierReferenceCostMicroUsd: 10_000, referenceInputCredits: 1,
  },
  {
    id: "grok", label: "Grok Imagine 1.5", family: "Grok", provider: "spacexai", providerLabel: "Grok",
    transport: "gateway", modelId: "spacexai/grok-imagine-video-1.5",
    description: "Vidéo avec audio natif et références multiples.", costTier: "premium",
    creditsPerSecond: 14, creditsByResolution: { "720p": 14, "1080p": 25 },
    durationsSeconds: range(4, 15), maxDurationSeconds: 30, resolutions: ["720p", "1080p"], defaultResolution: "720p",
    nativeAudio: true, frenchDialogue: "to-verify", supportsTextToVideo: true, supportsImageToVideo: true,
    maxReferenceImages: 7, pricingUsdPerSecond: { "720p": 0.14, "1080p": 0.25 }, supplierReferenceCostMicroUsd: 10_000, referenceInputCredits: 1,
  },
  {
    id: "heygen", label: "HeyGen Video", family: "HeyGen", provider: "heygen", providerLabel: "HeyGen",
    transport: "gateway", modelId: "heygen/heygen-video-1",
    description: "Clips avec dialogues et ambiance synchronisés, à partir d'un texte ou d'une image de départ.", costTier: "balanced",
    creditsPerSecond: 4, creditsByResolution: { "768p": 4, "1080p": 10 },
    durationsSeconds: range(5, 15), maxDurationSeconds: 30, resolutions: ["768p", "1080p"], defaultResolution: "768p",
    nativeAudio: true, frenchDialogue: "to-verify", supportsTextToVideo: true, supportsImageToVideo: true,
    // Only first-frame I2V is enabled: multiple references use a different tariff.
    maxReferenceImages: 1,
    // Conservative non-promotional bounds: the launch offer ends 2026-10-31.
    // The endpoint also lists an image input fee despite its prose description.
    pricingUsdPerSecond: { "768p": 0.036, "1080p": 0.1 }, supplierReferenceCostMicroUsd: 40_000, referenceInputCredits: 4,
  },
].map((model) => Object.freeze(model)) as AiMediaVideoModel[]);

export const AI_MEDIA_IMAGE_MODELS: readonly AiMediaImageModel[] = Object.freeze([
  { id: "openai", label: "OpenAI Image", provider: "openai", providerLabel: "OpenAI", transport: "existing", modelId: null,
    description: "Création et retouche, notamment pour les compositions avec texte précis.",
    baseCredits: 7, referenceInputCredits: 2, supportsReferences: true, supportsModify: true, maxReferenceImages: 5,
    supplierBaseCostMicroUsd: null, supplierReferenceCostMicroUsd: 0 },
  { id: "gemini", label: "Gemini Image", provider: "google", providerLabel: "Google", transport: "existing", modelId: null,
    description: "Création et retouche polyvalentes avec images de référence.",
    baseCredits: 7, referenceInputCredits: 2, supportsReferences: true, supportsModify: true, maxReferenceImages: 5,
    supplierBaseCostMicroUsd: null, supplierReferenceCostMicroUsd: 0 },
  { id: "flux", label: "FLUX.2 Pro", provider: "bfl", providerLabel: "Black Forest Labs", transport: "gateway-image", modelId: "bfl/flux-2-pro",
    description: "Photos de produits, couleurs de marque et retouche avec références, sortie bornée à 2 MP.",
    baseCredits: 5, referenceInputCredits: 2, supportsReferences: true, supportsModify: true, maxReferenceImages: 5,
    supplierBaseCostMicroUsd: 45_000, supplierReferenceCostMicroUsd: 15_000 },
  { id: "grok", label: "Grok Imagine Image", provider: "spacexai", providerLabel: "Grok", transport: "gateway-image", modelId: "spacexai/grok-imagine-image",
    description: "Création et retouche économiques avec au maximum trois images de référence.",
    baseCredits: 2, referenceInputCredits: 1, supportsReferences: true, supportsModify: true, maxReferenceImages: 3,
    supplierBaseCostMicroUsd: 20_000, supplierReferenceCostMicroUsd: 2_000 },
  { id: "recraft", label: "Recraft V4.1", provider: "recraft", providerLabel: "Recraft", transport: "gateway-image", modelId: "recraft/recraft-v4.1",
    description: "Illustrations et compositions graphiques raster, sans photo de référence ni retouche dans ce parcours.",
    baseCredits: 4, referenceInputCredits: 0, supportsReferences: false, supportsModify: false, maxReferenceImages: 0,
    supplierBaseCostMicroUsd: 35_000, supplierReferenceCostMicroUsd: 0 },
].map((model) => Object.freeze(model)) as AiMediaImageModel[]);

const FLUX_IMAGE_DIMENSIONS: Readonly<Record<AiMediaImageFormat, AiMediaImageDimensions>> = Object.freeze({
  square: Object.freeze({ width: 1024, height: 1024 }),
  portrait: Object.freeze({ width: 1024, height: 1280 }),
  story: Object.freeze({ width: 864, height: 1536 }),
  landscape: Object.freeze({ width: 1536, height: 864 }),
});
// Standard raster V4.1 sizes, not its separately priced Pro or SVG variants.
const RECRAFT_IMAGE_DIMENSIONS: Readonly<Record<AiMediaImageFormat, AiMediaImageDimensions>> = Object.freeze({
  square: Object.freeze({ width: 1024, height: 1024 }),
  portrait: Object.freeze({ width: 896, height: 1152 }),
  story: Object.freeze({ width: 768, height: 1344 }),
  landscape: Object.freeze({ width: 1344, height: 768 }),
});

export function normalizeAiMediaImageFormat(value: unknown): AiMediaImageFormat | null {
  return value === "square" || value === "portrait" || value === "story" || value === "landscape" ? value : null;
}

export function getAiMediaImageModel(engine: unknown): AiMediaImageModel {
  const model = AI_MEDIA_IMAGE_MODELS.find((candidate) => candidate.id === normalizeAiMediaImageEngine(engine));
  if (!model) throw new Error("ai_media_image_engine_invalid");
  return model;
}

/** Shared fixed canvas for quote and transport; Grok specifies aspect ratio instead. */
export function getAiMediaImageDimensions(engine: "flux" | "recraft", format?: unknown): AiMediaImageDimensions;
export function getAiMediaImageDimensions(engine: unknown, format?: unknown): AiMediaImageDimensions | null;
export function getAiMediaImageDimensions(engine: unknown, format: unknown = "square"): AiMediaImageDimensions | null {
  const model = getAiMediaImageModel(engine);
  const normalized = normalizeAiMediaImageFormat(format);
  if (!normalized) throw new Error("ai_media_image_format_invalid");
  return model.id === "flux" ? FLUX_IMAGE_DIMENSIONS[normalized]
    : model.id === "recraft" ? RECRAFT_IMAGE_DIMENSIONS[normalized] : null;
}

export function getAiMediaImageBaseCredits(engine: unknown, format: unknown = "square"): number {
  if (!normalizeAiMediaImageFormat(format)) throw new Error("ai_media_image_format_invalid");
  return getAiMediaImageModel(engine).baseCredits;
}

export function isAiMediaImageModelCompatible(input: { engine: unknown; operation?: string; inspirationImagesCount?: number }): boolean {
  const engine = normalizeAiMediaImageEngine(input.engine);
  const references = input.inspirationImagesCount ?? 0;
  if (!engine || !Number.isSafeInteger(references) || references < 0 ||
    (input.operation !== undefined && input.operation !== "generate" && input.operation !== "modify")) return false;
  const model = getAiMediaImageModel(engine);
  return references <= model.maxReferenceImages && (!references || model.supportsReferences)
    && (input.operation !== "modify" || (model.supportsModify && references > 0));
}

export function normalizeAiMediaVideoEngine(value: unknown): AiMediaVideoEngine | null {
  const normalized = String(value ?? "").trim().toLowerCase();
  const alias = normalized === "google-gemini-omni" || normalized === "gemini-omni" || normalized === "omni-flash"
    ? "omni" : ["google-veo-fast", "google-veo", "veo-fast", "gemini"].includes(normalized) ? "veo" : normalized;
  return AI_MEDIA_VIDEO_MODELS.find((model) => model.id === alias)?.id ?? null;
}

export function getAiMediaVideoModel(engine: unknown): AiMediaVideoModel {
  const id = normalizeAiMediaVideoEngine(engine);
  const model = AI_MEDIA_VIDEO_MODELS.find((candidate) => candidate.id === id);
  if (!model) throw new Error("ai_media_video_engine_invalid");
  return model;
}

export function getAiMediaVideoResolution(engine: unknown, resolution?: unknown): AiMediaVideoResolution {
  const model = getAiMediaVideoModel(engine);
  const value = String(resolution ?? "").trim();
  if (!value) return model.defaultResolution;
  if (!model.resolutions.includes(value as AiMediaVideoResolution)) throw new Error("ai_media_video_resolution_invalid");
  return value as AiMediaVideoResolution;
}

export function getAiMediaVideoNativeDurations(engine: unknown, resolution?: unknown): readonly number[] {
  const model = getAiMediaVideoModel(engine);
  const selectedResolution = getAiMediaVideoResolution(engine, resolution);
  // Veo's 1080p route supports eight-second output; four/six seconds are 720p.
  return model.provider === "google" && selectedResolution === "1080p" ? [8] : model.durationsSeconds;
}

/** Studio duration choices use at most two native clips, each at least four seconds. */
export function getAiMediaVideoDurations(engine: unknown, resolution?: unknown, sceneMode: AiMediaVideoSceneMode = "single"): readonly number[] {
  const model = getAiMediaVideoModel(engine);
  const native = getAiMediaVideoNativeDurations(engine, resolution).filter((duration) => duration >= 4);
  return range(4, model.maxDurationSeconds).filter((duration) =>
    (sceneMode === "single" && native.includes(duration)) ||
    native.some((first) => native.includes(duration - first)));
}

export function normalizeAiMediaImageEngine(value: unknown): AiMediaImageEngine | null {
  return value === "openai" || value === "gemini" || value === "flux" || value === "grok" || value === "recraft" ? value : null;
}
