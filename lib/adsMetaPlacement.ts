import { META_CALL_TO_ACTIONS, type MetaCallToAction } from "./adsMetaCampaignSettings.ts";
export type MetaAdsPlacement =
  | "facebook_feed"
  | "instagram_feed"
  | "stories"
  | "reels"
  | "messenger";

const FEED_IMAGE_LABEL = "inrcy_feed_image";
const STORY_REEL_IMAGE_LABEL = "inrcy_story_reel_image";

type MetaPlacementSelection = {
  publisher_platforms: Array<"facebook" | "instagram">;
  facebook_positions?: string[];
  instagram_positions?: string[];
};

function unique<T>(values: readonly T[]): T[] {
  return [...new Set(values)];
}

function normalizedPlacements(placements: readonly MetaAdsPlacement[]): MetaAdsPlacement[] {
  const selected = unique(placements);
  if (!selected.length) {
    throw new Error("Sélectionnez au moins un placement Meta avant la publication.");
  }
  if (selected.includes("messenger")) {
    // Messenger has several objective-dependent positions. Do not silently map
    // it to a feed until that exact Marketing API contract is certified.
    throw new Error("Le placement Messenger n’est pas encore pris en charge par le connecteur Meta iNr’ADS. Choisissez les fils, les Stories ou les Reels.");
  }
  return selected;
}

export function metaPlacementsNeedFeedImage(placements: readonly MetaAdsPlacement[]): boolean {
  return placements.some((placement) => placement === "facebook_feed" || placement === "instagram_feed");
}

export function metaPlacementsNeedStoryReelImage(placements: readonly MetaAdsPlacement[]): boolean {
  return placements.some((placement) => placement === "stories" || placement === "reels");
}

export function metaPlacementsNeedInstagramIdentity(placements: readonly MetaAdsPlacement[]): boolean {
  return placements.some((placement) => placement === "instagram_feed" || placement === "stories" || placement === "reels");
}

export function metaCreativeAssetUrls(input: {
  placements: readonly MetaAdsPlacement[];
  imageUrl?: string;
  metaCreativeAssets?: {
    feedImageUrl?: string;
    storyReelImageUrl?: string;
  };
}) {
  const placements = normalizedPlacements(input.placements);
  const needsFeed = metaPlacementsNeedFeedImage(placements);
  const needsStoryReel = metaPlacementsNeedStoryReelImage(placements);
  // `imageUrl` is a compatibility path for old feed drafts only. It must never
  // become a vertical asset because that would silently crop the advertiser's
  // creative for Stories/Reels.
  const feedImageUrl = String(
    input.metaCreativeAssets?.feedImageUrl || (needsFeed ? input.imageUrl : "") || "",
  ).trim();
  const storyReelImageUrl = String(input.metaCreativeAssets?.storyReelImageUrl || "").trim();
  if (needsFeed && !feedImageUrl) {
    throw new Error("Ajoutez un visuel Meta au format fil (1:1 ou 4:5) pour les placements sélectionnés.");
  }
  if (needsStoryReel && !storyReelImageUrl) {
    throw new Error("Ajoutez un visuel Meta vertical 9:16 pour les Stories et Reels sélectionnés. Le visuel du fil ne sera jamais recadré automatiquement.");
  }
  return { feedImageUrl: needsFeed ? feedImageUrl : "", storyReelImageUrl: needsStoryReel ? storyReelImageUrl : "" };
}

function placementSelection(
  placements: readonly MetaAdsPlacement[],
  family: "feed" | "story_reel" | "all",
): MetaPlacementSelection {
  const selected = normalizedPlacements(placements);
  const facebookPositions: string[] = [];
  const instagramPositions: string[] = [];

  if ((family === "feed" || family === "all") && selected.includes("facebook_feed")) {
    facebookPositions.push("feed");
  }
  if ((family === "feed" || family === "all") && selected.includes("instagram_feed")) {
    instagramPositions.push("stream");
  }
  if (family === "story_reel" || family === "all") {
    if (selected.includes("stories")) {
      facebookPositions.push("story");
      instagramPositions.push("story");
    }
    if (selected.includes("reels")) {
      facebookPositions.push("facebook_reels");
      instagramPositions.push("reels");
    }
  }

  const publisherPlatforms: Array<"facebook" | "instagram"> = [];
  if (facebookPositions.length) publisherPlatforms.push("facebook");
  if (instagramPositions.length) publisherPlatforms.push("instagram");
  if (!publisherPlatforms.length) {
    throw new Error(`Aucun placement Meta compatible n’est sélectionné pour le format ${family === "feed" ? "fil" : "vertical"}.`);
  }

  return {
    publisher_platforms: publisherPlatforms,
    ...(facebookPositions.length ? { facebook_positions: unique(facebookPositions) } : {}),
    ...(instagramPositions.length ? { instagram_positions: unique(instagramPositions) } : {}),
  };
}

/** Target only the placements explicitly selected in the studio. */
export function metaPlacementTargeting(placements: readonly MetaAdsPlacement[]) {
  return {
    age_min: 18,
    ...placementSelection(placements, "all"),
  };
}

/** Backward-compatible helper retained for existing feed-only callers/tests. */
export function metaFeedTargeting() {
  return metaPlacementTargeting(["facebook_feed", "instagram_feed"]);
}

export function metaAssetFeedSpec(input: {
  placements: readonly MetaAdsPlacement[];
  destinationUrl: string;
  primaryText: string;
  headline: string;
  description?: string;
  feedImageHash?: string;
  storyReelImageHash?: string;
  callToAction?: MetaCallToAction;
}) {
  const placements = normalizedPlacements(input.placements);
  const needsFeed = metaPlacementsNeedFeedImage(placements);
  const needsStoryReel = metaPlacementsNeedStoryReelImage(placements);
  if (needsFeed && !input.feedImageHash) {
    throw new Error("Ajoutez un visuel Meta au format fil (1:1 ou 4:5) pour les placements sélectionnés.");
  }
  if (needsStoryReel && !input.storyReelImageHash) {
    throw new Error("Ajoutez un visuel Meta vertical 9:16 pour les Stories et Reels sélectionnés.");
  }
  if (needsFeed && needsStoryReel && input.feedImageHash === input.storyReelImageHash) {
    throw new Error("Les placements Meta Feed et Story/Reel doivent utiliser deux images distinctes, sans recadrage implicite.");
  }
  if (input.callToAction && !META_CALL_TO_ACTIONS.includes(input.callToAction)) throw new Error("L’appel à l’action Meta n’est pas pris en charge.");
  const usePlacementCustomization = needsFeed && needsStoryReel;

  const images = [
    ...(needsFeed ? [{
      hash: input.feedImageHash!,
      ...(usePlacementCustomization ? { adlabels: [{ name: FEED_IMAGE_LABEL }] } : {}),
    }] : []),
    ...(needsStoryReel ? [{
      hash: input.storyReelImageHash!,
      ...(usePlacementCustomization ? { adlabels: [{ name: STORY_REEL_IMAGE_LABEL }] } : {}),
    }] : []),
  ];
  const assetCustomizationRules = [
    ...(needsFeed ? [{
      customization_spec: placementSelection(placements, "feed"),
      image_label: { name: FEED_IMAGE_LABEL },
      priority: 1,
    }] : []),
    ...(needsStoryReel ? [{
      customization_spec: placementSelection(placements, "story_reel"),
      image_label: { name: STORY_REEL_IMAGE_LABEL },
      priority: needsFeed ? 2 : 1,
    }] : []),
  ];

  return {
    ad_formats: ["SINGLE_IMAGE"],
    images,
    bodies: [{ text: input.primaryText }],
    titles: [{ text: input.headline }],
    ...(input.description ? { descriptions: [{ text: input.description }] } : {}),
    link_urls: [{
      website_url: input.destinationUrl,
    }],
    call_to_action_types: [input.callToAction || "LEARN_MORE"],
    // Meta placement customization expects a real choice between asset
    // families. With only one family, omit the rules instead of sending a
    // meaningless single-rule customization set.
    ...(usePlacementCustomization
      ? { optimization_type: "PLACEMENT", asset_customization_rules: assetCustomizationRules }
      : {}),
  };
}

export function metaCreativeIdentity(input: {
  pageId: string;
  instagramUserId?: string;
}) {
  return {
    page_id: input.pageId,
    ...(input.instagramUserId ? { instagram_user_id: input.instagramUserId } : {}),
  };
}

/** Legacy single-picture story kept for non-iNr'ADS callers. */
export function metaLinkCreativeStory(input: {
  pageId: string;
  instagramUserId: string;
  destinationUrl: string;
  primaryText: string;
  imageUrl: string;
}) {
  return {
    page_id: input.pageId,
    instagram_user_id: input.instagramUserId,
    link_data: {
      link: input.destinationUrl,
      message: input.primaryText,
      picture: input.imageUrl,
      call_to_action: { type: "LEARN_MORE" },
    },
  };
}
