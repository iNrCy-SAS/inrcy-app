import {
  getAiMediaVideoDurations, getAiMediaVideoNativeDurations,
  type AiMediaVideoEngine, type AiMediaVideoResolution, type AiMediaVideoSceneMode,
} from "./aiMediaModelCatalog.ts";

/** One continuous scene uses one native clip when possible, otherwise two connected clips. */
export function getAiMediaVideoSegmentDurations(
  durationSeconds: number,
  engine: AiMediaVideoEngine | null = "omni",
  resolution?: AiMediaVideoResolution | null,
  sceneMode: AiMediaVideoSceneMode | null = "single",
): readonly number[] {
  const selected = engine || "omni";
  const mode = sceneMode || "single";
  if ((mode !== "single" && mode !== "multi") || !Number.isSafeInteger(durationSeconds) ||
    !getAiMediaVideoDurations(selected, resolution, mode).includes(durationSeconds)) {
    throw new Error("ai_media_video_duration_unsupported");
  }
  const native = getAiMediaVideoNativeDurations(selected, resolution);
  if (mode === "single" && native.includes(durationSeconds)) return [durationSeconds];
  // Balanced valid halves make the two plans comparable; never invent a provider duration.
  const first = [...native].filter((value) => native.includes(durationSeconds - value))
    .sort((a, b) => Math.abs(a - durationSeconds / 2) - Math.abs(b - durationSeconds / 2) || b - a)[0];
  if (first === undefined) throw new Error("ai_media_video_duration_unsupported");
  return [first, durationSeconds - first];
}

export function canGenerateAiMediaVideoDuration(
  engine: AiMediaVideoEngine | null, durationSeconds: number,
  resolution?: AiMediaVideoResolution | null, sceneMode: AiMediaVideoSceneMode | null = "single",
): boolean {
  try { getAiMediaVideoSegmentDurations(durationSeconds, engine, resolution, sceneMode); return true; }
  catch { return false; }
}

export type AiMediaVideoDurationSceneOption = Readonly<{
  durationSeconds: number;
  sceneMode: AiMediaVideoSceneMode;
  sceneCount: 1 | 2;
}>;

/** A displayed scene is one real provider clip, never a hidden second segment. */
export function getAiMediaVideoDurationSceneOptions(
  engine: AiMediaVideoEngine | null = "omni",
  resolution?: AiMediaVideoResolution | null,
): readonly AiMediaVideoDurationSceneOption[] {
  const selected = engine || "omni";
  const oneScene = getAiMediaVideoNativeDurations(selected, resolution)
    .filter((duration) => duration >= 4 && duration <= 30)
    .map((durationSeconds): AiMediaVideoDurationSceneOption => ({ durationSeconds, sceneMode: "single", sceneCount: 1 }));
  const twoScenes = getAiMediaVideoDurations(selected, resolution, "multi")
    .filter((duration) => duration >= 4 && duration <= 30)
    .map((durationSeconds): AiMediaVideoDurationSceneOption => ({ durationSeconds, sceneMode: "multi", sceneCount: 2 }));
  return Object.freeze([...oneScene, ...twoScenes]
    .sort((first, second) => first.durationSeconds - second.durationSeconds || first.sceneCount - second.sceneCount)
    .map((option) => Object.freeze(option)));
}

export function getAiMediaVideoSegmentCount(
  durationSeconds: number,
  engine: AiMediaVideoEngine | null = "omni",
  resolution?: AiMediaVideoResolution | null,
  sceneMode: AiMediaVideoSceneMode | null = "single",
) {
  return getAiMediaVideoSegmentDurations(durationSeconds, engine, resolution, sceneMode).length;
}
