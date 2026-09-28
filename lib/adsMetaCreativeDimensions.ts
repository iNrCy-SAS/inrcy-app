import { META_ADS_CREATIVE_SPECS } from "./adsCampaignMediaPolicy.ts";

export type MetaCreativeAssetSlot = "feed" | "storyReel";

export type MetaCreativeImageMetadataLike = {
  width?: number | null;
  height?: number | null;
  /** EXIF orientation as exposed by Sharp (1 to 8). */
  orientation?: number | null;
};

export type MetaCreativeDimensionIssue =
  | "missing_dimensions"
  | "below_minimum"
  | "wrong_aspect_ratio";

export type MetaCreativeDimensionValidation = {
  valid: boolean;
  issue: MetaCreativeDimensionIssue | null;
  message: string | null;
  slot: MetaCreativeAssetSlot;
  width: number | null;
  height: number | null;
  actualRatio: number | null;
  targetRatio: number;
  relativeRatioDeviation: number | null;
  ratioTolerance: number;
  minimumWidth: number;
  minimumHeight: number;
  recommendedWidth: number;
  recommendedHeight: number;
};

/**
 * Meta can technically accept several ratios and then crop them itself, but
 * iNrCy deliberately supplies placement-specific assets. A small tolerance
 * accepts harmless encoder rounding while rejecting an asset meant for the
 * other placement family (or an arbitrary portrait image).
 */
export const META_CREATIVE_RATIO_TOLERANCE = 0.02;

export const META_CREATIVE_DIMENSION_RULES = {
  feed: {
    label: "Meta Feed",
    aspectRatioLabel: "4:5",
    targetRatio: 4 / 5,
    minimumWidth: 600,
    minimumHeight: 750,
    recommendedWidth: META_ADS_CREATIVE_SPECS.feed.width,
    recommendedHeight: META_ADS_CREATIVE_SPECS.feed.height,
  },
  storyReel: {
    label: "Meta Story/Reel",
    aspectRatioLabel: "9:16",
    targetRatio: 9 / 16,
    minimumWidth: 540,
    minimumHeight: 960,
    recommendedWidth: META_ADS_CREATIVE_SPECS.storyReel.width,
    recommendedHeight: META_ADS_CREATIVE_SPECS.storyReel.height,
  },
} as const;

function positivePixelDimension(value: number | null | undefined): number | null {
  const parsed = Math.round(Number(value || 0));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

/** Returns dimensions as a person sees the image after EXIF rotation. */
export function getMetaCreativeVisualDimensions(
  metadata: MetaCreativeImageMetadataLike,
): { width: number; height: number } | null {
  const encodedWidth = positivePixelDimension(metadata.width);
  const encodedHeight = positivePixelDimension(metadata.height);
  if (!encodedWidth || !encodedHeight) return null;

  const orientation = Math.round(Number(metadata.orientation || 1));
  const swapsAxes = orientation >= 5 && orientation <= 8;
  return swapsAxes
    ? { width: encodedHeight, height: encodedWidth }
    : { width: encodedWidth, height: encodedHeight };
}

export function validateMetaCreativeDimensions(
  slot: MetaCreativeAssetSlot,
  metadata: MetaCreativeImageMetadataLike,
): MetaCreativeDimensionValidation {
  const rule = META_CREATIVE_DIMENSION_RULES[slot];
  const dimensions = getMetaCreativeVisualDimensions(metadata);
  const base = {
    slot,
    targetRatio: rule.targetRatio,
    ratioTolerance: META_CREATIVE_RATIO_TOLERANCE,
    minimumWidth: rule.minimumWidth,
    minimumHeight: rule.minimumHeight,
    recommendedWidth: rule.recommendedWidth,
    recommendedHeight: rule.recommendedHeight,
  };

  if (!dimensions) {
    return {
      ...base,
      valid: false,
      issue: "missing_dimensions",
      message: `Impossible de lire les dimensions de l’image ${rule.label}.`,
      width: null,
      height: null,
      actualRatio: null,
      relativeRatioDeviation: null,
    };
  }

  const actualRatio = dimensions.width / dimensions.height;
  const relativeRatioDeviation =
    Math.abs(actualRatio - rule.targetRatio) / rule.targetRatio;

  if (
    dimensions.width < rule.minimumWidth ||
    dimensions.height < rule.minimumHeight
  ) {
    return {
      ...base,
      ...dimensions,
      valid: false,
      issue: "below_minimum",
      message: `L’image ${rule.label} doit mesurer au moins ${rule.minimumWidth} × ${rule.minimumHeight} px. Dimensions reçues : ${dimensions.width} × ${dimensions.height} px.`,
      actualRatio,
      relativeRatioDeviation,
    };
  }

  if (relativeRatioDeviation > META_CREATIVE_RATIO_TOLERANCE) {
    return {
      ...base,
      ...dimensions,
      valid: false,
      issue: "wrong_aspect_ratio",
      message: `L’image ${rule.label} doit respecter le format vertical ${rule.aspectRatioLabel}. Dimensions reçues : ${dimensions.width} × ${dimensions.height} px.`,
      actualRatio,
      relativeRatioDeviation,
    };
  }

  return {
    ...base,
    ...dimensions,
    valid: true,
    issue: null,
    message: null,
    actualRatio,
    relativeRatioDeviation,
  };
}

export function assertMetaCreativeDimensions(
  slot: MetaCreativeAssetSlot,
  metadata: MetaCreativeImageMetadataLike,
): MetaCreativeDimensionValidation {
  const validation = validateMetaCreativeDimensions(slot, metadata);
  if (!validation.valid) {
    throw new Error(validation.message || "Le format de l’image Meta Ads est invalide.");
  }
  return validation;
}
