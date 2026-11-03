const CHANNEL_SOURCE_KEYS: Record<string, string> = {
  site_web: "website", gmb: "google_business", facebook: "facebook", instagram: "instagram",
  threads: "threads", linkedin: "linkedin", x: "x", tiktok: "tiktok", youtube_shorts: "youtube", pinterest: "pinterest",
};

/** Undefined preserves the existing full analysis. An explicit empty list means documents only. */
export function parseBusinessDnaAnalysisSelection(value: unknown): string[] | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid_analysis_selection");
  const input = (value as Record<string, unknown>).selectedChannels;
  if (input === undefined) return undefined;
  if (!Array.isArray(input) || input.length > 10 || input.some((key) => typeof key !== "string" || !Object.hasOwn(CHANNEL_SOURCE_KEYS, key))) {
    throw new Error("invalid_analysis_selection");
  }
  return [...new Set(input.map((key) => CHANNEL_SOURCE_KEYS[key]))];
}
