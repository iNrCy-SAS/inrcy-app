import { AI_MEDIA_VIDEO_MODELS, getAiMediaVideoModel, type AiMediaVideoEngine, type AiMediaVideoResolution, type AiMediaVideoSceneMode } from "./aiMediaModelCatalog.ts";
import { canGenerateAiMediaVideoDuration } from "./aiMediaVideoTimeline.ts";

/** Each visible choice is an actual model/resolution pair from the provider catalogue. */
export function getMediaVideoEngineQualityChoices() {
  return AI_MEDIA_VIDEO_MODELS.flatMap((model) => model.resolutions.map((resolution) => ({
    value: `${model.id}:${resolution}`, engine: model.id, resolution,
    label: model.label, family: model.family,
    creditsPerSecond: model.creditsByResolution[resolution] ?? model.creditsPerSecond,
  })));
}

export function isMediaVideoBriefCompatible(engine: AiMediaVideoEngine, brief: string) {
  return engine !== "wan-flash" || brief.trim().length <= 1_500;
}

/** Duration belongs to the professional's brief, independently of the chosen model. */
export function getMediaVideoDurationChoices(maxDuration = 30): readonly number[] {
  const max = Math.min(30, Math.floor(maxDuration));
  return Array.from({ length: Math.max(0, max - 3) }, (_, index) => index + 4);
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
