/** Public Studio catalogue. Provider cost estimates are USD, never credit sale prices.
 * Gateway IDs/capabilities verified on 2026-10-13 against /v1/models.
 */
export type AiMediaVideoEngine =
  | "omni" | "veo" | "veo-lite" | "minimax-h3"
  | "wan-flash" | "wan3" | "grok-lite" | "grok";
export type AiMediaImageEngine = "openai" | "gemini";
export type AiMediaVideoResolution = "720p" | "768p" | "1080p";
export type AiMediaVideoSceneMode = "single" | "multi";
export type AiMediaVideoModel = Readonly<{
  id: AiMediaVideoEngine;
  label: string;
  family: "Google" | "MiniMax" | "Alibaba" | "Grok";
  provider: "google" | "minimax" | "alibaba" | "spacexai";
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
    maxReferenceImages: 5, pricingUsdPerSecond: { "720p": 0.1 }, referenceInputCredits: 0,
  },
  {
    id: "veo", label: "Veo 3.1 Fast", family: "Google", provider: "google", providerLabel: "Google",
    transport: "google-direct", modelId: "veo-3.1-fast-generate-001",
    description: "Plans cinématiques et dialogues natifs.", costTier: "premium",
    creditsPerSecond: 10, creditsByResolution: { "720p": 10, "1080p": 12 },
    durationsSeconds: [4, 6, 8], maxDurationSeconds: 16, resolutions: ["720p", "1080p"], defaultResolution: "720p",
    nativeAudio: true, frenchDialogue: "to-verify", supportsTextToVideo: true, supportsImageToVideo: true,
    maxReferenceImages: 3, pricingUsdPerSecond: { "720p": 0.1, "1080p": 0.12 }, referenceInputCredits: 0,
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
    pricingUsdPerSecond: { "720p": 0.05, "1080p": 0.08 }, referenceInputCredits: 0,
  },
  {
    id: "minimax-h3", label: "MiniMax H3", family: "MiniMax", provider: "minimax", providerLabel: "MiniMax",
    transport: "gateway", modelId: "minimax/minimax-h3",
    description: "Références multiples et dialogues en français annoncés par MiniMax.", costTier: "balanced",
    creditsPerSecond: 8, creditsByResolution: { "768p": 8 },
    durationsSeconds: range(4, 15), maxDurationSeconds: 30, resolutions: ["768p"], defaultResolution: "768p",
    nativeAudio: true, frenchDialogue: "supported", supportsTextToVideo: true, supportsImageToVideo: true,
    maxReferenceImages: 9, pricingUsdPerSecond: { "768p": 0.08 }, referenceInputCredits: 0,
  },
  {
    id: "wan-flash", label: "Wan 2.6 Flash", family: "Alibaba", provider: "alibaba", providerLabel: "Alibaba",
    transport: "gateway", modelId: "alibaba/wan-v2.6-i2v-flash",
    description: "Animation économique d'une photo avec audio natif.", costTier: "economy",
    creditsPerSecond: 5, creditsByResolution: { "720p": 5, "1080p": 7.5 },
    durationsSeconds: range(4, 15), maxDurationSeconds: 30, resolutions: ["720p", "1080p"], defaultResolution: "720p",
    nativeAudio: true, frenchDialogue: "to-verify", supportsTextToVideo: false, supportsImageToVideo: true,
    maxReferenceImages: 1, pricingUsdPerSecond: { "720p": 0.05, "1080p": 0.075 }, referenceInputCredits: 0,
  },
  {
    id: "wan3", label: "Wan 3.0", family: "Alibaba", provider: "alibaba", providerLabel: "Alibaba",
    transport: "gateway", modelId: "alibaba/wan-v3.0-video",
    description: "Vidéo et audio synchronisés, références et clips jusqu'à 30 secondes.", costTier: "premium",
    creditsPerSecond: 10, creditsByResolution: { "720p": 10, "1080p": 20 },
    durationsSeconds: range(4, 30), maxDurationSeconds: 30, resolutions: ["720p", "1080p"], defaultResolution: "720p",
    nativeAudio: true, frenchDialogue: "to-verify", supportsTextToVideo: true, supportsImageToVideo: true,
    maxReferenceImages: 10, pricingUsdPerSecond: { "720p": 0.1, "1080p": 0.2 }, referenceInputCredits: 0,
  },
  {
    id: "grok-lite", label: "Grok Imagine Lite", family: "Grok", provider: "spacexai", providerLabel: "Grok",
    transport: "gateway", modelId: "spacexai/grok-imagine-video-1.5-lite",
    description: "Clips courts et audio natif à faible consommation.", costTier: "economy",
    creditsPerSecond: 3, creditsByResolution: { "720p": 3, "1080p": 14 },
    durationsSeconds: range(4, 15), maxDurationSeconds: 30, resolutions: ["720p", "1080p"], defaultResolution: "720p",
    nativeAudio: true, frenchDialogue: "to-verify", supportsTextToVideo: true, supportsImageToVideo: true,
    maxReferenceImages: 1, pricingUsdPerSecond: { "720p": 0.03, "1080p": 0.14 }, referenceInputCredits: 1,
  },
  {
    id: "grok", label: "Grok Imagine 1.5", family: "Grok", provider: "spacexai", providerLabel: "Grok",
    transport: "gateway", modelId: "spacexai/grok-imagine-video-1.5",
    description: "Vidéo avec audio natif et références multiples.", costTier: "premium",
    creditsPerSecond: 14, creditsByResolution: { "720p": 14, "1080p": 25 },
    durationsSeconds: range(4, 15), maxDurationSeconds: 30, resolutions: ["720p", "1080p"], defaultResolution: "720p",
    nativeAudio: true, frenchDialogue: "to-verify", supportsTextToVideo: true, supportsImageToVideo: true,
    maxReferenceImages: 7, pricingUsdPerSecond: { "720p": 0.14, "1080p": 0.25 }, referenceInputCredits: 1,
  },
].map((model) => Object.freeze(model)) as AiMediaVideoModel[]);

export const AI_MEDIA_IMAGE_MODELS = Object.freeze([
  { id: "openai" as const, label: "OpenAI Image", providerLabel: "OpenAI", baseCredits: 7 },
  { id: "gemini" as const, label: "Gemini Image", providerLabel: "Google", baseCredits: 7 },
]);

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
  const native = getAiMediaVideoNativeDurations(engine, resolution);
  return range(4, model.maxDurationSeconds).filter((duration) =>
    (sceneMode === "single" && native.includes(duration)) ||
    native.some((first) => native.includes(duration - first)));
}

export function normalizeAiMediaImageEngine(value: unknown): AiMediaImageEngine | null {
  return value === "openai" || value === "gemini" ? value : null;
}
