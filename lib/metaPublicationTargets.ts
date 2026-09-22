import type { BoosterPublicationChannelKey } from "@/lib/boosterPublicationPolicy";

export type MetaPublicationPlacement = "classic" | "reel" | "story";
// The primary placement may now be Story on its own.  `includeStory` remains
// available for the existing "Classique/Reel + Story" combinations.
export type MetaPrimaryPublicationPlacement = MetaPublicationPlacement;

export type MetaPublicationSelection = {
  version: 2;
  primaryPlacement: MetaPrimaryPublicationPlacement;
  includeStory: boolean;
  placements: MetaPublicationPlacement[];
};

export type BoosterPublicationTarget = {
  key: string;
  channel: BoosterPublicationChannelKey;
  placement: MetaPublicationPlacement | null;
};

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function normalizeMetaPublicationPlacement(
  value: unknown,
): MetaPublicationPlacement | null {
  const placement = String(value || "")
    .trim()
    .toLowerCase();
  if (["classic", "classique", "normal", "feed"].includes(placement)) {
    return "classic";
  }
  if (placement === "reel" || placement === "reels") return "reel";
  if (placement === "story" || placement === "stories") return "story";
  return null;
}

/**
 * Normalise both the historical one-placement payload and Booster's v2
 * primary-format + optional Story payload.
 *
 * A legacy `{ placement: "story" }` deliberately remains Story-only so old
 * iNr'Agent actions and already scheduled publications keep their semantics.
 */
export function normalizeMetaPublicationSelection(
  value: unknown,
): MetaPublicationSelection {
  const raw = asRecord(value);
  const explicitPlacements = Array.isArray(raw.placements)
    ? raw.placements
        .map(normalizeMetaPublicationPlacement)
        .filter(
          (placement): placement is MetaPublicationPlacement =>
            placement !== null,
        )
    : [];
  const explicitPrimary = normalizeMetaPublicationPlacement(
    raw.primaryPlacement ?? raw.primary ?? raw.feedPlacement,
  );
  const legacyPlacement = normalizeMetaPublicationPlacement(
    raw.placement ?? raw.mode,
  );
  const hasV2Shape =
    explicitPlacements.length > 0 ||
    explicitPrimary !== null ||
    typeof raw.includeStory === "boolean" ||
    typeof raw.storyEnabled === "boolean";

  if (!hasV2Shape && legacyPlacement === "story") {
    return {
      version: 2,
      primaryPlacement: "story",
      includeStory: false,
      placements: ["story"],
    };
  }

  const primaryFromList =
    explicitPlacements.find(
      (placement) => placement === "classic" || placement === "reel",
    ) ?? (explicitPlacements.includes("story") ? "story" : undefined);
  const primaryPlacement: MetaPrimaryPublicationPlacement =
    explicitPrimary === "reel" ||
    explicitPrimary === "classic" ||
    explicitPrimary === "story"
      ? explicitPrimary
      : primaryFromList ??
        (legacyPlacement === "reel"
          ? "reel"
          : legacyPlacement === "story"
            ? "story"
            : "classic");
  const includeStory =
    primaryPlacement !== "story" &&
    (explicitPlacements.includes("story") ||
      raw.includeStory === true ||
      raw.storyEnabled === true);

  return {
    version: 2,
    primaryPlacement,
    includeStory,
    placements:
      primaryPlacement === "story"
        ? ["story"]
        : [primaryPlacement, ...(includeStory ? (["story"] as const) : [])],
  };
}

export function buildMetaPublicationSelection(
  primaryPlacement: MetaPrimaryPublicationPlacement,
  includeStory: boolean,
): MetaPublicationSelection {
  return normalizeMetaPublicationSelection({
    version: 2,
    primaryPlacement,
    includeStory,
  });
}

export function isMetaStoryOnlySelection(value: unknown): boolean {
  const selection = normalizeMetaPublicationSelection(value);
  return (
    selection.primaryPlacement === "story" &&
    selection.placements.length === 1 &&
    selection.placements[0] === "story"
  );
}

type MetaPublicationTextContent = {
  title?: unknown;
  content?: unknown;
  cta?: unknown;
  ctaMode?: unknown;
  ctaUrl?: unknown;
  ctaPhone?: unknown;
  hashtags?: unknown;
};

/**
 * A Story-only Meta publication carries media and nothing else.  Keeping this
 * rule next to the placement normalizer prevents a disabled editor from being
 * bypassed by a draft restore, a scheduled send or a direct payload.
 */
export function stripMetaStoryOnlyPostContent<
  T extends MetaPublicationTextContent,
>(post: T, selection: unknown): T {
  if (!isMetaStoryOnlySelection(selection)) return post;
  return {
    ...post,
    title: "",
    content: "",
    cta: "",
    ctaMode: "none",
    ctaUrl: "",
    ctaPhone: "",
    hashtags: [],
  } as T;
}

export function buildBoosterPublicationTargets(params: {
  channels: BoosterPublicationChannelKey[];
  instagramPublicationSettings?: unknown;
  facebookPublicationSettings?: unknown;
}): BoosterPublicationTarget[] {
  return params.channels.flatMap<BoosterPublicationTarget>((channel) => {
    const placements =
      channel === "instagram"
        ? normalizeMetaPublicationSelection(
            params.instagramPublicationSettings,
          ).placements
        : channel === "facebook"
          ? normalizeMetaPublicationSelection(
              params.facebookPublicationSettings,
            ).placements
          : [];

    if (!placements.length) {
      return [{ key: channel, channel, placement: null }];
    }
    if (placements.length === 1) {
      return [{ key: channel, channel, placement: placements[0] }];
    }
    return placements.map((placement) => ({
      key: `${channel}:${placement}`,
      channel,
      placement,
    }));
  });
}

export function normalizeBoosterPublicationTargets(params: {
  value: unknown;
  channels: BoosterPublicationChannelKey[];
  instagramPublicationSettings?: unknown;
  facebookPublicationSettings?: unknown;
}): BoosterPublicationTarget[] {
  const allowedChannels = new Set(params.channels);
  const rawTargets = Array.isArray(params.value) ? params.value : [];
  const targets = rawTargets.flatMap((value) => {
    const raw = asRecord(value);
    const channel = String(raw.channel || "").trim() as BoosterPublicationChannelKey;
    if (!allowedChannels.has(channel)) return [];
    const placement =
      channel === "instagram" || channel === "facebook"
        ? normalizeMetaPublicationPlacement(raw.placement)
        : null;
    const key = String(raw.key || "").trim();
    if (!key) return [];
    return [{ key, channel, placement }];
  });
  const uniqueKeys = new Set(targets.map((target) => target.key));
  if (targets.length && uniqueKeys.size === targets.length) return targets;
  return buildBoosterPublicationTargets(params);
}

export function getMetaTargetSettings(
  placement: MetaPublicationPlacement | null,
) {
  return placement && placement !== "classic" ? { placement } : null;
}
