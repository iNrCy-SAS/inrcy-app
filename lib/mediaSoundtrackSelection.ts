export type MediaSoundtrackOption = { id: string; label: string; description: string; durationSeconds: number; audioPreview: string };
export type MediaSoundtrackChannel = "facebook" | "instagram";
export type MediaSoundtrackByChannel = Partial<Record<MediaSoundtrackChannel, string | null>>;

/** The server still validates catalogue membership before creating a video. */
export function normalizeMediaSoundtrackId(value: unknown): string | null {
  return typeof value === "string" && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value) && value.length <= 80 ? value : null;
}

/** Restore independent channel choices, migrating the former shared draft value. */
export function normalizeMediaSoundtrackByChannel(value: unknown, legacyValue?: unknown): MediaSoundtrackByChannel {
  const saved = value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
  const selection: MediaSoundtrackByChannel = {};
  for (const channel of ["facebook", "instagram"] as const) {
    selection[channel] = normalizeMediaSoundtrackId(Object.hasOwn(saved, channel) ? saved[channel] : legacyValue);
  }
  return selection;
}

/** Play only same-origin catalogue previews; never a URL from a saved draft. */
export function parseMediaSoundtrackOptions(value: unknown): MediaSoundtrackOption[] {
  if (!value || typeof value !== "object" || !("ok" in value) || value.ok !== true || !("soundtracks" in value) || !Array.isArray(value.soundtracks) || value.soundtracks.length > 100) return [];
  const tracks: MediaSoundtrackOption[] = [], seen = new Set<string>();
  for (const candidate of value.soundtracks) {
    if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) continue;
    const item = candidate as Record<string, unknown>, id = normalizeMediaSoundtrackId(item.id);
    if (!id || seen.has(id) || typeof item.label !== "string" || !item.label.trim() || item.label.length > 120 || typeof item.description !== "string" || item.description.length > 300 ||
      item.durationSeconds !== 8 || item.audioPreview !== `/api/booster/soundtracks/${id}/preview`) continue;
    seen.add(id);
    tracks.push({ id, label: item.label.trim(), description: item.description.trim(), durationSeconds: 8, audioPreview: item.audioPreview });
  }
  return tracks;
}
