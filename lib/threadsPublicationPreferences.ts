export const THREADS_PUBLICATION_PREFERENCES_VERSION = 1 as const;

export type ThreadsPublicationMode = "classic" | "ghost";
export type ThreadsPublicationSettings = { mode: ThreadsPublicationMode };
export type ThreadsPublicationPreferences = {
  version: typeof THREADS_PUBLICATION_PREFERENCES_VERSION;
  ghostEnabled: boolean;
  defaultMode: ThreadsPublicationMode;
};

export const DEFAULT_THREADS_PUBLICATION_PREFERENCES: ThreadsPublicationPreferences = Object.freeze({
  version: THREADS_PUBLICATION_PREFERENCES_VERSION, ghostEnabled: true, defaultMode: "classic",
});
export const CLASSIC_ONLY_THREADS_PUBLICATION_PREFERENCES: ThreadsPublicationPreferences = Object.freeze({
  version: THREADS_PUBLICATION_PREFERENCES_VERSION, ghostEnabled: false, defaultMode: "classic",
});

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
export function normalizeThreadsPublicationMode(value: unknown): ThreadsPublicationMode {
  return String(value || "").trim().toLowerCase() === "ghost" ? "ghost" : "classic";
}
export function isThreadsPublicationModeEnabled(mode: ThreadsPublicationMode, preferences: ThreadsPublicationPreferences): boolean {
  return mode === "classic" || preferences.ghostEnabled;
}
/** Coercion only normalizes a stored default; an explicit publication uses validation below. */
export function coerceThreadsPublicationMode(value: unknown, preferences: ThreadsPublicationPreferences): ThreadsPublicationMode {
  const mode = normalizeThreadsPublicationMode(value);
  return isThreadsPublicationModeEnabled(mode, preferences) ? mode : "classic";
}
export function normalizeThreadsPublicationPreferences(value: unknown): ThreadsPublicationPreferences {
  const raw = asRecord(value);
  const preferences: ThreadsPublicationPreferences = {
    version: THREADS_PUBLICATION_PREFERENCES_VERSION,
    ghostEnabled: typeof raw.ghostEnabled === "boolean" ? raw.ghostEnabled : DEFAULT_THREADS_PUBLICATION_PREFERENCES.ghostEnabled,
    defaultMode: "classic",
  };
  preferences.defaultMode = coerceThreadsPublicationMode(raw.defaultMode, preferences);
  return preferences;
}
export function parseThreadsPublicationPreferencesPatch(value: unknown): ThreadsPublicationPreferences {
  const raw = asRecord(value);
  if (typeof raw.ghostEnabled !== "boolean" || !["classic", "ghost"].includes(String(raw.defaultMode))) {
    throw new Error("Les formats Threads envoyés sont invalides.");
  }
  return normalizeThreadsPublicationPreferences(raw);
}
export function getEnabledThreadsPublicationModes(preferences: ThreadsPublicationPreferences): ThreadsPublicationMode[] {
  return ["classic", ...(preferences.ghostEnabled ? ["ghost"] as const : [])];
}
/** Old jobs without a selected format stay Classic, regardless of a new account default. */
export function parseThreadsPublicationSettings(value: unknown): ThreadsPublicationSettings {
  if (value == null) return { mode: "classic" };
  const raw = asRecord(value);
  if (!Object.hasOwn(raw, "mode") || !["classic", "ghost"].includes(String(raw.mode))) {
    throw new Error("Le format Threads demandé est invalide.");
  }
  return { mode: raw.mode as ThreadsPublicationMode };
}
export function getThreadsPublicationModeFailure(args: {
  mode: ThreadsPublicationMode;
  preferences: ThreadsPublicationPreferences;
  hasMedia?: boolean;
}): { code: string; error: string; retryable: false } | null {
  if (!isThreadsPublicationModeEnabled(args.mode, args.preferences)) return {
    code: "threads_publication_mode_disabled", retryable: false,
    error: "Le format Ghost Threads est désactivé dans les réglages du compte. Choisissez explicitement un autre format.",
  };
  if (args.mode === "ghost" && args.hasMedia) return {
    code: "threads_ghost_media_unsupported", retryable: false,
    error: "Les Ghost Posts Threads acceptent uniquement du texte. Retirez les images ou la vidéo de ce canal, ou choisissez Classique.",
  };
  return null;
}

/** A saved image association can coexist with Ghost; only its effective channel selection counts. */
export function hasSelectedThreadsPublicationMedia(value: unknown): boolean {
  const body = asRecord(value);
  const mode = asRecord(body.mediaModeByChannel).threads;
  if (mode === "none") return false;
  if (mode === "images" || mode === "video") return true;
  const channelImages = asRecord(body.imagesByChannel).threads;
  if (asRecord(body.videoByChannel).threads || (body.mediaType === "video" && body.video)) return true;
  if (Array.isArray(channelImages)) return channelImages.length > 0;
  return (Array.isArray(body.images) && body.images.length > 0) || Boolean(body.video);
}
