import { AI_MEDIA_SOUNDTRACKS } from "@/lib/aiMediaSoundtrackCatalog";

/** Only bundled original tracks may be selected; null/omission keeps Auto. */
export function normalizeBoosterSoundtrackId(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string" || !AI_MEDIA_SOUNDTRACKS.some(track => track.id === value)) {
    throw new Error("booster_soundtrack_invalid");
  }
  return value;
}

/** Public presentation data only. Never expose the server asset's path/hash. */
export function getBoosterSoundtrackCatalog() {
  return AI_MEDIA_SOUNDTRACKS.map(track => ({
    id: track.id,
    label: track.name,
    description: track.moods.join(" · "),
    durationSeconds: 8,
    audioPreview: `/api/booster/soundtracks/${encodeURIComponent(track.id)}/preview`,
  }));
}
