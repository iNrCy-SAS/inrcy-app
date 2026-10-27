import { AI_MEDIA_SOUNDTRACKS, findAiMediaSoundtrack } from "@/lib/aiMediaSoundtrackCatalog";
import { META_IMAGE_SOUNDTRACK_ASSET_SECONDS } from "@/lib/metaImageMotionTiming";

export type BoosterSoundtrackChannel = "facebook" | "instagram";
export type BoosterSoundtrackByChannel = Partial<Record<BoosterSoundtrackChannel, string | null>>;

/** Only bundled original tracks may be selected; null/omission keeps Auto. */
export function normalizeBoosterSoundtrackId(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !findAiMediaSoundtrack(value)) {
    throw new Error("booster_soundtrack_invalid");
  }
  return value;
}

export function normalizeBoosterSoundtrackByChannel(value: unknown): BoosterSoundtrackByChannel {
  if (value === undefined) return {};
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("booster_soundtrack_invalid");
  const normalized: BoosterSoundtrackByChannel = {};
  for (const [channel, id] of Object.entries(value)) {
    if ((channel !== "facebook" && channel !== "instagram") || id === undefined) throw new Error("booster_soundtrack_invalid");
    normalized[channel] = normalizeBoosterSoundtrackId(id);
  }
  return normalized;
}

/** An own null explicitly selects Auto; omission preserves old global drafts. */
export function resolveBoosterSoundtrackByChannel(
  requested: BoosterSoundtrackByChannel,
  legacySoundtrackId: string | null,
  automaticSoundtrackId: string,
): Record<BoosterSoundtrackChannel, string> {
  return Object.fromEntries((["facebook", "instagram"] as const).map(channel => [
    channel,
    (Object.hasOwn(requested, channel) ? requested[channel] : legacySoundtrackId) ?? automaticSoundtrackId,
  ])) as Record<BoosterSoundtrackChannel, string>;
}

/** Public presentation data only. Never expose the server asset's path/hash. */
export function getBoosterSoundtrackCatalog() {
  return AI_MEDIA_SOUNDTRACKS.map(track => ({
    id: track.id,
    label: track.name,
    description: track.moods.join(" · "),
    durationSeconds: META_IMAGE_SOUNDTRACK_ASSET_SECONDS,
    audioPreview: `/api/booster/soundtracks/${encodeURIComponent(track.id)}/preview?v=${META_IMAGE_SOUNDTRACK_ASSET_SECONDS}`,
  }));
}
