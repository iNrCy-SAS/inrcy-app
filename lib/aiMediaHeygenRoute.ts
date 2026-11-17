type HeygenRouteInput = {
  teamVideoSpeechMode?: string;
  inspirationImages?: readonly { role?: string }[];
};

/** Speaking reference people retain their proven avatar/voice binding. */
export function usesHeygenAvatarRoute(input: HeygenRouteInput): boolean {
  return input.teamVideoSpeechMode === "characters" &&
    input.inspirationImages?.some(image => image.role === "character") === true;
}

export type HeygenCinematicSettings = {
  duration: number;
  resolution: "768p" | "1080p";
  aspectRatio: "16:9" | "9:16" | "1:1" | "3:4";
  resolutionAdapted: boolean;
  canvasCropRequired: boolean;
};

/** Public quote and provider share native capabilities before any reservation. */
export function getHeygenCinematicSettings(input: {
  format?: string;
  videoResolution?: string | null;
  durationSeconds?: number | null;
}): HeygenCinematicSettings {
  const duration = input.durationSeconds ?? 8;
  if (!Number.isInteger(duration) || duration < 5 || duration > 30) {
    throw new RangeError("ai_media_heygen_cinematic_duration_unsupported");
  }
  const format = input.format ?? "story";
  if (!["story", "portrait", "square", "landscape"].includes(format)) {
    throw new TypeError("ai_media_heygen_cinematic_format_unsupported");
  }
  const requestedResolution = input.videoResolution ?? "1080p";
  if (!["720p", "768p", "1080p"].includes(requestedResolution)) throw new TypeError("ai_media_heygen_cinematic_resolution_unsupported");
  const wideOrTall = format === "story" || format === "landscape";
  const resolution = requestedResolution === "1080p" && wideOrTall ? "1080p" : "768p";
  return {
    duration, resolution,
    aspectRatio: format === "story" ? "9:16" : format === "landscape" ? "16:9" : format === "square" ? "1:1" : "3:4",
    resolutionAdapted: requestedResolution === "1080p" && !wideOrTall,
    canvasCropRequired: format === "portrait",
  };
}
