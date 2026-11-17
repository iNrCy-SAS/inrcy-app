import { AI_MEDIA_AVAILABLE_VIDEO_MODELS, getAiMediaVideoModel, getAiMediaVideoModelForCharacterVoice, getAiMediaVideoCreditRate, getAiMediaVideoCreditRateLimitIssue, type AiMediaVideoAudioChoice, type AiMediaVideoEngine, type AiMediaVideoResolution, type AiMediaVideoSceneMode } from "./aiMediaModelCatalog.ts";
import { isAiMediaCharacterVoiceEngine } from "./aiMediaCharacterVoices.ts";
import { canGenerateAiMediaVideoDuration, getAiMediaVideoDurationSceneOptions, getAiMediaVideoSegmentDurations } from "./aiMediaVideoTimeline.ts";

export type AiMediaVideoQualityContext = {
  format?: unknown;
  teamVideoSpeechMode?: unknown;
  hasCharacterReferences?: boolean;
};

/** Avatar IV supports all canvases; native cinematic 1080p supports wide/tall only. */
export function isMediaVideoQualityCompatible(engine: unknown, resolution: AiMediaVideoResolution, context: AiMediaVideoQualityContext = {}): boolean {
  const model = getAiMediaVideoModel(engine);
  if (!model.resolutions.includes(resolution)) return false;
  return model.transport !== "heygen-direct" || resolution !== "1080p" ||
    context.format !== "square" && context.format !== "portrait" ||
    context.hasCharacterReferences === true && context.teamVideoSpeechMode === "characters";
}

/** Resolve before requesting a quote, rather than pricing an unavailable quality. */
export function getMediaVideoContextResolution(engine: unknown, preferred: AiMediaVideoResolution, context: AiMediaVideoQualityContext = {}): AiMediaVideoResolution {
  const model = getAiMediaVideoModel(engine);
  return [preferred, model.defaultResolution, ...model.resolutions].find(resolution =>
    isMediaVideoQualityCompatible(model.id, resolution, context)) ?? model.defaultResolution;
}

/** Each visible choice is an actual model/resolution pair from the provider catalogue. */
export function getMediaVideoEngineQualityChoices(hasProvidedVoice = false, audioChoice: AiMediaVideoAudioChoice = {}, context: AiMediaVideoQualityContext = {}) {
  return AI_MEDIA_AVAILABLE_VIDEO_MODELS.flatMap((base) => {
    const model = getAiMediaVideoModelForCharacterVoice(base.id, hasProvidedVoice);
    const input = { ...audioChoice, hasProvidedCharacterVoice: hasProvidedVoice };
    return model.resolutions.filter(resolution => !getAiMediaVideoCreditRateLimitIssue(model.id, resolution, input) &&
      isMediaVideoQualityCompatible(model.id, resolution, { ...context, teamVideoSpeechMode: audioChoice.teamVideoSpeechMode })).map((resolution) => ({
    value: `${model.id}:${resolution}`, engine: model.id, resolution,
    label: model.label, family: model.family,
    creditsPerSecond: getAiMediaVideoCreditRate(model.id, resolution, input),
    }));
  });
}

export type AiMediaVideoReferenceChoice = {
  inspirationImagesCount?: number;
  hasProvidedCharacterVoice?: boolean;
  providedCharacterVoicesCount?: number;
  durationSeconds?: number | null;
  videoResolution?: unknown;
  sceneMode?: unknown;
};
export type AiMediaVideoReferenceCompatibilityIssue = {
  code: "AI_MEDIA_VIDEO_REFERENCE_COUNT_INVALID" | "AI_MEDIA_VIDEO_CHARACTER_VOICE_COUNT_INVALID" |
    "AI_MEDIA_VIDEO_VOICE_ENGINE_UNSUPPORTED" | "AI_MEDIA_VIDEO_PHOTO_REQUIRED" |
    "AI_MEDIA_VIDEO_REFERENCES_UNSUPPORTED" | "AI_MEDIA_VIDEO_REFERENCE_LIMIT" | "AI_MEDIA_VIDEO_REFERENCE_DURATION_UNSUPPORTED";
  message: string;
};

/** Direct generation transmits every original photo, without a composed bypass.
 * Three supplied voices is the existing Gateway/Kling/HeyGen protocol bound. */
export function getAiMediaVideoReferenceCompatibilityIssue(engine: unknown, input: AiMediaVideoReferenceChoice = {}): AiMediaVideoReferenceCompatibilityIssue | null {
  const references = input.inspirationImagesCount ?? 0;
  const voices = input.providedCharacterVoicesCount ?? 0;
  if (!Number.isSafeInteger(references) || references < 0) return { code: "AI_MEDIA_VIDEO_REFERENCE_COUNT_INVALID", message: "Le nombre de photos de référence est invalide." };
  if (!Number.isSafeInteger(voices) || voices < 0 || voices > 3 || voices > references) return { code: "AI_MEDIA_VIDEO_CHARACTER_VOICE_COUNT_INVALID", message: "Associez au maximum trois vocaux aux photos des personnages correspondants." };
  const hasProvidedVoice = input.hasProvidedCharacterVoice === true || voices > 0;
  const model = getAiMediaVideoModelForCharacterVoice(engine, hasProvidedVoice);
  if (hasProvidedVoice && !isAiMediaCharacterVoiceEngine(model.id)) return { code: "AI_MEDIA_VIDEO_VOICE_ENGINE_UNSUPPORTED", message: `${model.label} ne prend pas en charge les vocaux fournis des personnages. Choisissez un moteur compatible.` };
  if (!references && (hasProvidedVoice || !model.supportsTextToVideo)) return { code: "AI_MEDIA_VIDEO_PHOTO_REQUIRED", message: `Ajoutez une photo de référence pour utiliser ${model.label}.` };
  if (references && !model.supportsImageToVideo) return { code: "AI_MEDIA_VIDEO_REFERENCES_UNSUPPORTED", message: `${model.label} accepte uniquement un prompt sans photo.` };
  if (references > model.maxReferenceImages) return { code: "AI_MEDIA_VIDEO_REFERENCE_LIMIT", message: `${model.label} accepte au maximum ${model.maxReferenceImages} photos de référence originales. Choisissez un autre moteur ou retirez des photos.` };
  if (model.id === "veo" && references > 1 && input.durationSeconds != null) {
    let compatible = false;
    try { compatible = getAiMediaVideoSegmentDurations(input.durationSeconds, model.id,
      input.videoResolution as AiMediaVideoResolution | undefined, input.sceneMode as AiMediaVideoSceneMode | undefined).every(duration => duration === 8); }
    catch { /* Unsupported native durations also cannot carry multiple photos. */ }
    if (!compatible) return { code: "AI_MEDIA_VIDEO_REFERENCE_DURATION_UNSUPPORTED", message: "Avec plusieurs photos, Veo 3.1 Fast exige des séquences de 8 secondes. Choisissez une vidéo de 8 ou 16 secondes." };
  }
  return null;
}

export function isMediaVideoBriefCompatible(engine: AiMediaVideoEngine, brief: string) {
  return engine !== "wan-flash" || brief.trim().length <= 1_500;
}

/** Duration belongs to the professional's brief, independently of the chosen model. */
export function getMediaVideoDurationChoices(maxDuration = 30): readonly number[] {
  const max = Math.min(30, Math.floor(maxDuration));
  return Array.from({ length: Math.max(0, max - 3) }, (_, index) => index + 4);
}

/** Studio selects the shortest execution path for a duration, without a montage choice. */
export function getAutomaticMediaVideoDurationOptions(engine: AiMediaVideoEngine, resolution?: AiMediaVideoResolution | null) {
  const choices = getAiMediaVideoDurationSceneOptions(engine, resolution);
  const minimum = getAiMediaVideoModel(engine).transport === "heygen-direct" ? 5 : 4;
  return choices.filter((option, index) => option.durationSeconds >= minimum &&
    choices.findIndex((candidate) => candidate.durationSeconds === option.durationSeconds) === index);
}

/** Preserve the requested duration; a different model may use its own native quality. */
export function getCompatibleMediaVideoResolution(
  engine: AiMediaVideoEngine, duration: number, preferred: AiMediaVideoResolution,
  sceneMode: AiMediaVideoSceneMode = "single",
): AiMediaVideoResolution | null {
  const model = getAiMediaVideoModel(engine);
  const candidates = [...new Set([preferred, model.defaultResolution, ...model.resolutions])];
  return candidates.find((resolution) => model.resolutions.includes(resolution) &&
    canGenerateAiMediaVideoDuration(engine, duration, resolution, sceneMode)) ?? null;
}
