export const FACEBOOK_PUBLICATION_PREFERENCES_VERSION = 1 as const;

export type FacebookPublicationPlacement = "classic" | "reel" | "story";

export type FacebookPublicationPreferences = {
  version: typeof FACEBOOK_PUBLICATION_PREFERENCES_VERSION;
  reelsEnabled: boolean;
  storiesEnabled: boolean;
  defaultMode: FacebookPublicationPlacement;
};

export const DEFAULT_FACEBOOK_PUBLICATION_PREFERENCES: FacebookPublicationPreferences =
  Object.freeze({
    version: FACEBOOK_PUBLICATION_PREFERENCES_VERSION,
    reelsEnabled: true,
    storiesEnabled: true,
    defaultMode: "classic",
  });

// Fail closed while the account-scoped settings are unavailable. Classic
// remains usable, but optional Meta placements are never exposed by mistake.
export const CLASSIC_ONLY_FACEBOOK_PUBLICATION_PREFERENCES: FacebookPublicationPreferences =
  Object.freeze({
    version: FACEBOOK_PUBLICATION_PREFERENCES_VERSION,
    reelsEnabled: false,
    storiesEnabled: false,
    defaultMode: "classic",
  });

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function normalizeFacebookPublicationPlacement(
  value: unknown,
): FacebookPublicationPlacement {
  const normalized = String(value || "")
    .trim()
    .toLowerCase();
  if (normalized === "reel" || normalized === "reels") return "reel";
  if (normalized === "story" || normalized === "stories") return "story";
  return "classic";
}

export function isFacebookPublicationPlacementEnabled(
  placement: FacebookPublicationPlacement,
  preferences: FacebookPublicationPreferences,
) {
  if (placement === "classic") return true;
  if (placement === "reel") return preferences.reelsEnabled;
  return preferences.storiesEnabled;
}

export function coerceFacebookPublicationPlacement(
  value: unknown,
  preferences: FacebookPublicationPreferences,
): FacebookPublicationPlacement {
  const placement = normalizeFacebookPublicationPlacement(value);
  return isFacebookPublicationPlacementEnabled(placement, preferences)
    ? placement
    : "classic";
}

export function normalizeFacebookPublicationPreferences(
  value: unknown,
): FacebookPublicationPreferences {
  const raw = asRecord(value);
  const reelsEnabled =
    typeof raw.reelsEnabled === "boolean"
      ? raw.reelsEnabled
      : typeof raw.reels === "boolean"
        ? raw.reels
        : DEFAULT_FACEBOOK_PUBLICATION_PREFERENCES.reelsEnabled;
  const storiesEnabled =
    typeof raw.storiesEnabled === "boolean"
      ? raw.storiesEnabled
      : typeof raw.stories === "boolean"
        ? raw.stories
        : DEFAULT_FACEBOOK_PUBLICATION_PREFERENCES.storiesEnabled;
  const preferences: FacebookPublicationPreferences = {
    version: FACEBOOK_PUBLICATION_PREFERENCES_VERSION,
    reelsEnabled,
    storiesEnabled,
    defaultMode: "classic",
  };
  preferences.defaultMode = coerceFacebookPublicationPlacement(
    raw.defaultMode ?? raw.defaultPlacement,
    preferences,
  );
  return preferences;
}

export function parseFacebookPublicationPreferencesPatch(
  value: unknown,
): FacebookPublicationPreferences {
  const raw = asRecord(value);
  if (
    typeof raw.reelsEnabled !== "boolean" ||
    typeof raw.storiesEnabled !== "boolean"
  ) {
    throw new Error("Les formats Facebook envoyés sont invalides.");
  }

  const preferences: FacebookPublicationPreferences = {
    version: FACEBOOK_PUBLICATION_PREFERENCES_VERSION,
    reelsEnabled: raw.reelsEnabled,
    storiesEnabled: raw.storiesEnabled,
    defaultMode: "classic",
  };
  preferences.defaultMode = coerceFacebookPublicationPlacement(
    normalizeFacebookPublicationPlacement(raw.defaultMode),
    preferences,
  );
  return preferences;
}

export function getEnabledFacebookPublicationPlacements(
  preferences: FacebookPublicationPreferences,
): FacebookPublicationPlacement[] {
  return [
    "classic",
    ...(preferences.reelsEnabled ? (["reel"] as const) : []),
    ...(preferences.storiesEnabled ? (["story"] as const) : []),
  ];
}
