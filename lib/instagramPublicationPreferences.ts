export const INSTAGRAM_PUBLICATION_PREFERENCES_VERSION = 1 as const;

export type InstagramPublicationPlacement = "classic" | "reel" | "story";

export type InstagramPublicationPreferences = {
  version: typeof INSTAGRAM_PUBLICATION_PREFERENCES_VERSION;
  reelsEnabled: boolean;
  storiesEnabled: boolean;
  defaultMode: InstagramPublicationPlacement;
};

export const DEFAULT_INSTAGRAM_PUBLICATION_PREFERENCES: InstagramPublicationPreferences =
  Object.freeze({
    version: INSTAGRAM_PUBLICATION_PREFERENCES_VERSION,
    reelsEnabled: true,
    storiesEnabled: true,
    defaultMode: "classic",
  });

// Fail closed while account preferences are loading or unavailable. This
// prevents optional placements from briefly reappearing for an account that
// explicitly disabled them.
export const CLASSIC_ONLY_INSTAGRAM_PUBLICATION_PREFERENCES: InstagramPublicationPreferences =
  Object.freeze({
    version: INSTAGRAM_PUBLICATION_PREFERENCES_VERSION,
    reelsEnabled: false,
    storiesEnabled: false,
    defaultMode: "classic",
  });

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function normalizeInstagramPublicationPlacement(
  value: unknown,
): InstagramPublicationPlacement {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "reel" || normalized === "reels") return "reel";
  if (normalized === "story" || normalized === "stories") return "story";
  return "classic";
}

export function isInstagramPublicationPlacementEnabled(
  placement: InstagramPublicationPlacement,
  preferences: InstagramPublicationPreferences,
) {
  if (placement === "classic") return true;
  if (placement === "reel") return preferences.reelsEnabled;
  return preferences.storiesEnabled;
}

export function coerceInstagramPublicationPlacement(
  value: unknown,
  preferences: InstagramPublicationPreferences,
): InstagramPublicationPlacement {
  const placement = normalizeInstagramPublicationPlacement(value);
  return isInstagramPublicationPlacementEnabled(placement, preferences)
    ? placement
    : "classic";
}

export function normalizeInstagramPublicationPreferences(
  value: unknown,
): InstagramPublicationPreferences {
  const raw = asRecord(value);
  const reelsEnabled =
    typeof raw.reelsEnabled === "boolean"
      ? raw.reelsEnabled
      : typeof raw.reels === "boolean"
        ? raw.reels
        : DEFAULT_INSTAGRAM_PUBLICATION_PREFERENCES.reelsEnabled;
  const storiesEnabled =
    typeof raw.storiesEnabled === "boolean"
      ? raw.storiesEnabled
      : typeof raw.stories === "boolean"
        ? raw.stories
        : DEFAULT_INSTAGRAM_PUBLICATION_PREFERENCES.storiesEnabled;
  const provisional: InstagramPublicationPreferences = {
    version: INSTAGRAM_PUBLICATION_PREFERENCES_VERSION,
    reelsEnabled,
    storiesEnabled,
    defaultMode: "classic",
  };
  provisional.defaultMode = coerceInstagramPublicationPlacement(
    raw.defaultMode ?? raw.defaultPlacement,
    provisional,
  );
  return provisional;
}

export function parseInstagramPublicationPreferencesPatch(
  value: unknown,
): InstagramPublicationPreferences {
  const raw = asRecord(value);
  if (
    typeof raw.reelsEnabled !== "boolean" ||
    typeof raw.storiesEnabled !== "boolean"
  ) {
    throw new Error("Les formats Instagram envoyés sont invalides.");
  }

  const requestedDefault = normalizeInstagramPublicationPlacement(
    raw.defaultMode,
  );
  const preferences: InstagramPublicationPreferences = {
    version: INSTAGRAM_PUBLICATION_PREFERENCES_VERSION,
    reelsEnabled: raw.reelsEnabled,
    storiesEnabled: raw.storiesEnabled,
    defaultMode: "classic",
  };
  preferences.defaultMode = coerceInstagramPublicationPlacement(
    requestedDefault,
    preferences,
  );
  return preferences;
}

export function getEnabledInstagramPublicationPlacements(
  preferences: InstagramPublicationPreferences,
): InstagramPublicationPlacement[] {
  return [
    "classic",
    ...(preferences.reelsEnabled ? (["reel"] as const) : []),
    ...(preferences.storiesEnabled ? (["story"] as const) : []),
  ];
}
