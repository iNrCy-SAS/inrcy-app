/**
 * Shared image-decision policy for Booster.
 *
 * Step 1 deliberately centralizes the decision only. The publication pipeline
 * is not changed here: later steps can consume the same policy in Booster and
 * on the server without duplicating channel rules.
 */

export type BoosterImageChannel =
  | "inrcy_site"
  | "site_web"
  | "inr_search"
  | "gmb"
  | "facebook"
  | "instagram"
  | "linkedin"
  | "x"
  | "tiktok"
  | "youtube_shorts"
  | "pinterest";


export type BoosterImageSafetyBackgroundMode = "transparent" | "white" | "black";

const BOOSTER_IMAGE_SAFETY_BACKGROUND_BY_CHANNEL: Readonly<
  Record<BoosterImageChannel, BoosterImageSafetyBackgroundMode>
> = Object.freeze({
  inrcy_site: "transparent",
  site_web: "transparent",
  inr_search: "transparent",
  gmb: "white",
  facebook: "black",
  instagram: "black",
  linkedin: "black",
  x: "black",
  tiktok: "black",
  youtube_shorts: "black",
  pinterest: "black",
});

/**
 * Last-resort canvas policy. This is used only when a channel imposes a hard
 * ratio and a light crop would remove too much content. It never uses blur.
 */
export function getBoosterImageSafetyBackgroundMode(
  channel: BoosterImageChannel,
): BoosterImageSafetyBackgroundMode {
  return BOOSTER_IMAGE_SAFETY_BACKGROUND_BY_CHANNEL[channel] || "black";
}

export type BoosterImageDecisionMode =
  | "original"
  | "adapted"
  | "customized"
  | "unsupported";

export type BoosterImageDecisionLabel =
  | "Originale"
  | "Adaptée"
  | "Personnalisée"
  | "Indisponible";

export type BoosterImageGeometry =
  | "very_tall"
  | "portrait"
  | "square"
  | "landscape"
  | "very_wide"
  | "unknown";

export type BoosterImageMetaLike = {
  width?: number | null;
  height?: number | null;
  ratio?: number | null;
};

export type ComparableImageTransform = {
  fit?: "contain" | "cover" | null;
  zoom?: number | null;
  offsetX?: number | null;
  offsetY?: number | null;
  blurBackground?: boolean | null;
  backgroundMode?: string | null;
  backgroundColor?: string | null;
};

type RatioRange = {
  min?: number;
  max?: number;
};

export type BoosterImageChannelPolicy = {
  supportsImages: boolean;
  /** Ratios that can stay visually untouched by the automatic policy. */
  originalRatioRange?: RatioRange;
  /** Automatic target used only when the source is below the accepted range. */
  tooTallTargetRatio?: number;
  /** Automatic target used only when the source is above the accepted range. */
  tooWideTargetRatio?: number;
};

export type BoosterImageDecision = {
  channel: BoosterImageChannel;
  mode: BoosterImageDecisionMode;
  label: BoosterImageDecisionLabel;
  geometry: BoosterImageGeometry;
  sourceRatio: number | null;
  targetRatio: number | null;
  reason:
    | "manual_customization"
    | "ratio_supported"
    | "ratio_too_tall"
    | "ratio_too_wide"
    | "ratio_unknown_preserve_original"
    | "channel_preserves_original"
    | "sequence_target_ratio"
    | "images_unsupported";
  /** Shared safety curtain: never force an automatic crop above this loss. */
  maxAutomaticCropLoss: number;
  fallbackFit: "contain";
};

export type BoosterImageDisplayPlan = {
  decision: BoosterImageDecision;
  /** Ratio shown by Booster for the automatic result. */
  previewRatio: number | null;
  /** Automatic visual fit. Customised images keep their current Adapter fit. */
  automaticFit: "contain" | "cover";
  /** True when Booster must display the untouched source composition. */
  preserveSourceComposition: boolean;
};

export const BOOSTER_IMAGE_DECISION_LABELS: Record<
  BoosterImageDecisionMode,
  BoosterImageDecisionLabel
> = {
  original: "Originale",
  adapted: "Adaptée",
  customized: "Personnalisée",
  unsupported: "Indisponible",
};

/** Existing safety curtain preserved and shared across client/server rules. */
export const BOOSTER_AUTO_CROP_MAX_LOSS = 0.08;
export const BOOSTER_AUTO_ADAPT_FALLBACK_FIT = "contain" as const;

const INSTAGRAM_MIN_RATIO = 4 / 5;
const INSTAGRAM_MAX_RATIO = 1.91;
const PINTEREST_MIN_RATIO = 2 / 3;

/**
 * Single source of truth for automatic image decisions.
 *
 * - Most channels preserve the source composition by default.
 * - Instagram adapts only outside its accepted image-ratio window.
 * - Pinterest adapts only images taller than 2:3 in the agreed iNrCy policy.
 * - YouTube does not accept photo publications in the current Booster flow.
 */
export const BOOSTER_IMAGE_CHANNEL_POLICIES: Readonly<
  Record<BoosterImageChannel, BoosterImageChannelPolicy>
> = Object.freeze({
  inrcy_site: { supportsImages: true },
  site_web: { supportsImages: true },
  inr_search: { supportsImages: true },
  gmb: { supportsImages: true },
  facebook: { supportsImages: true },
  instagram: {
    supportsImages: true,
    originalRatioRange: {
      min: INSTAGRAM_MIN_RATIO,
      max: INSTAGRAM_MAX_RATIO,
    },
    tooTallTargetRatio: INSTAGRAM_MIN_RATIO,
    tooWideTargetRatio: INSTAGRAM_MAX_RATIO,
  },
  linkedin: { supportsImages: true },
  x: { supportsImages: true },
  tiktok: { supportsImages: true },
  youtube_shorts: { supportsImages: false },
  pinterest: {
    supportsImages: true,
    originalRatioRange: { min: PINTEREST_MIN_RATIO },
    tooTallTargetRatio: PINTEREST_MIN_RATIO,
  },
});

export function getBoosterImageRatio(
  meta?: BoosterImageMetaLike | null,
): number | null {
  const explicitRatio = Number(meta?.ratio);
  if (Number.isFinite(explicitRatio) && explicitRatio > 0) {
    return explicitRatio;
  }

  const width = Number(meta?.width);
  const height = Number(meta?.height);
  if (
    Number.isFinite(width) &&
    width > 0 &&
    Number.isFinite(height) &&
    height > 0
  ) {
    return width / height;
  }

  return null;
}

export function classifyBoosterImageGeometry(
  meta?: BoosterImageMetaLike | null,
): BoosterImageGeometry {
  const ratio = getBoosterImageRatio(meta);
  if (!ratio) return "unknown";
  if (ratio < 2 / 3) return "very_tall";
  if (ratio < 0.98) return "portrait";
  if (ratio <= 1.02) return "square";
  if (ratio <= 1.91) return "landscape";
  return "very_wide";
}

export function getImageCropLossFraction(
  sourceRatio: number,
  targetRatio: number,
): number {
  if (
    !Number.isFinite(sourceRatio) ||
    sourceRatio <= 0 ||
    !Number.isFinite(targetRatio) ||
    targetRatio <= 0
  ) {
    return Number.POSITIVE_INFINITY;
  }

  if (sourceRatio > targetRatio) {
    return 1 - targetRatio / sourceRatio;
  }

  return 1 - sourceRatio / targetRatio;
}

export function canUseAutomaticCover(
  sourceRatio: number,
  targetRatio: number,
): boolean {
  return (
    getImageCropLossFraction(sourceRatio, targetRatio) <=
    BOOSTER_AUTO_CROP_MAX_LOSS
  );
}

/**
 * Converts a conceptual target ratio into integer canvas dimensions without
 * accidentally exceeding the requested ratio because of pixel rounding.
 *
 * This matters for hard upper bounds such as Instagram 1.91:1: 1080 / 565
 * is 1.9115 and can be rejected, while 1080 / 566 stays safely below 1.91.
 */
export function getBoosterImageRenderDimensions(params: {
  baseWidth: number;
  baseHeight: number;
  targetRatio?: number | null;
}): { width: number; height: number } {
  const baseWidth = Math.max(1, Math.round(Number(params.baseWidth) || 1));
  const baseHeight = Math.max(1, Math.round(Number(params.baseHeight) || 1));
  const targetRatio = Number(params.targetRatio);

  if (!Number.isFinite(targetRatio) || targetRatio <= 0) {
    return { width: baseWidth, height: baseHeight };
  }

  // Tiny epsilon avoids turning an exact integer division into +1 px because
  // of floating-point noise, while Math.ceil keeps max-ratio targets safe.
  const height = Math.max(
    1,
    Math.ceil(baseWidth / targetRatio - 1e-9),
  );
  return { width: baseWidth, height };
}

function normalizeTransformNumber(value: unknown, fallback = 0) {
  return Math.round((Number(value) || fallback) * 100) / 100;
}

function normalizeBackgroundMode(transform?: ComparableImageTransform | null) {
  if (!transform) return "";
  const rawMode = String(transform.backgroundMode || "").trim().toLowerCase();
  // Legacy blur settings are intentionally downgraded to a sober solid frame.
  // They must never recreate a blurred background after the Original First fix.
  if (rawMode === "blur" || transform.blurBackground) return "black";
  if (rawMode) return rawMode;
  return transform.backgroundColor ? "color" : "black";
}

/**
 * Visual equivalence helper used by the Adapter UI to decide whether the pro
 * has really changed a setting. Publication itself never infers provenance
 * from a transform delta: only the explicit customized flag is authoritative.
 */
export function areBoosterImageTransformsEquivalent(
  a?: ComparableImageTransform | null,
  b?: ComparableImageTransform | null,
): boolean {
  if (!a || !b) return false;
  return (
    a.fit === b.fit &&
    normalizeTransformNumber(a.zoom, 1) === normalizeTransformNumber(b.zoom, 1) &&
    normalizeTransformNumber(a.offsetX) === normalizeTransformNumber(b.offsetX) &&
    normalizeTransformNumber(a.offsetY) === normalizeTransformNumber(b.offsetY) &&
    normalizeBackgroundMode(a) === normalizeBackgroundMode(b) &&
    String(a.backgroundColor || "")
      .trim()
      .toLowerCase() ===
      String(b.backgroundColor || "")
        .trim()
        .toLowerCase()
  );
}

export function getBoosterImageDecision(params: {
  channel: BoosterImageChannel;
  meta?: BoosterImageMetaLike | null;
  /** Explicit persisted Adapter provenance. Stronger than automatic rules. */
  customized?: boolean;
  /** Current transform, when available. */
  currentTransform?: ComparableImageTransform | null;
  /** Automatic reference transform for the same channel/image. */
  automaticTransform?: ComparableImageTransform | null;
  /**
   * Optional collection-level target. Instagram uses the first image ratio
   * and Pinterest requires one exact ratio for every image of a multi-image
   * Pin.
   */
  requiredTargetRatio?: number | null;
  /**
   * Forces a real canvas even when the source ratio is numerically equal to
   * the collection ratio. Pinterest needs this to guarantee identical pixel
   * ratios for every item, not just visually close ratios.
   */
  forceRequiredTargetCanvas?: boolean;
}): BoosterImageDecision {
  const {
    channel,
    meta,
    customized = false,
    currentTransform,
    automaticTransform,
    requiredTargetRatio,
    forceRequiredTargetCanvas = false,
  } = params;
  const policy = BOOSTER_IMAGE_CHANNEL_POLICIES[channel];
  const sourceRatio = getBoosterImageRatio(meta);
  const geometry = classifyBoosterImageGeometry(meta);
  const base = {
    channel,
    geometry,
    sourceRatio,
    maxAutomaticCropLoss: BOOSTER_AUTO_CROP_MAX_LOSS,
    fallbackFit: BOOSTER_AUTO_ADAPT_FALLBACK_FIT,
  } as const;

  if (!policy.supportsImages) {
    return {
      ...base,
      mode: "unsupported",
      label: BOOSTER_IMAGE_DECISION_LABELS.unsupported,
      targetRatio: null,
      reason: "images_unsupported",
    };
  }

  // Original-first invariant: stale/default transform objects must never turn
  // an untouched source into a personalized canvas. The Adapter persists an
  // explicit customized provenance when the pro actually validates a change.
  void currentTransform;
  void automaticTransform;
  if (customized) {
    return {
      ...base,
      mode: "customized",
      label: BOOSTER_IMAGE_DECISION_LABELS.customized,
      targetRatio: sourceRatio,
      reason: "manual_customization",
    };
  }

  if (!sourceRatio) {
    return {
      ...base,
      mode: "original",
      label: BOOSTER_IMAGE_DECISION_LABELS.original,
      targetRatio: null,
      reason: "ratio_unknown_preserve_original",
    };
  }

  const sequenceTargetRatio = Number(requiredTargetRatio);
  if (Number.isFinite(sequenceTargetRatio) && sequenceTargetRatio > 0) {
    const relativeDelta =
      Math.abs(sourceRatio - sequenceTargetRatio) / sequenceTargetRatio;
    if (relativeDelta > 0.005 || forceRequiredTargetCanvas) {
      return {
        ...base,
        mode: "adapted",
        label: BOOSTER_IMAGE_DECISION_LABELS.adapted,
        targetRatio: sequenceTargetRatio,
        reason: "sequence_target_ratio",
      };
    }
  }

  const range = policy.originalRatioRange;
  if (!range) {
    return {
      ...base,
      mode: "original",
      label: BOOSTER_IMAGE_DECISION_LABELS.original,
      targetRatio: sourceRatio,
      reason: "channel_preserves_original",
    };
  }

  if (range.min && sourceRatio < range.min) {
    return {
      ...base,
      mode: "adapted",
      label: BOOSTER_IMAGE_DECISION_LABELS.adapted,
      targetRatio: policy.tooTallTargetRatio || range.min,
      reason: "ratio_too_tall",
    };
  }

  if (range.max && sourceRatio > range.max) {
    return {
      ...base,
      mode: "adapted",
      label: BOOSTER_IMAGE_DECISION_LABELS.adapted,
      targetRatio: policy.tooWideTargetRatio || range.max,
      reason: "ratio_too_wide",
    };
  }

  return {
    ...base,
    mode: "original",
    label: BOOSTER_IMAGE_DECISION_LABELS.original,
    targetRatio: sourceRatio,
    reason: "ratio_supported",
  };
}

/**
 * Collection-level target used by channels whose carousel geometry is driven
 * by the first image. Instagram follows the first item. Pinterest additionally
 * rejects a multi-image Pin when width/height ratios are not identical.
 */
export function getBoosterImageSequenceTargetRatio(params: {
  channel: BoosterImageChannel;
  metas: Array<BoosterImageMetaLike | null | undefined>;
  /** Manual first-image canvas wins because the complete carousel follows it. */
  firstImageCustomizedTargetRatio?: number | null;
}): number | null {
  const { channel, metas, firstImageCustomizedTargetRatio } = params;
  if ((channel !== "instagram" && channel !== "pinterest") || metas.length < 2) {
    return null;
  }

  const customizedTarget = Number(firstImageCustomizedTargetRatio);
  if (Number.isFinite(customizedTarget) && customizedTarget > 0) {
    return customizedTarget;
  }

  if (channel === "pinterest") {
    const firstRatio = getBoosterImageRatio(metas[0]);
    if (!firstRatio) return PINTEREST_MIN_RATIO;

    const firstWidth = Number(metas[0]?.width || 0);
    const firstHeight = Number(metas[0]?.height || 0);
    const allSameRatio = metas.every((meta) => {
      const ratio = getBoosterImageRatio(meta);
      if (!ratio) return false;
      const width = Number(meta?.width || 0);
      const height = Number(meta?.height || 0);
      if (
        firstWidth > 0 &&
        firstHeight > 0 &&
        width > 0 &&
        height > 0
      ) {
        return firstWidth * height === width * firstHeight;
      }
      return Math.abs(ratio - firstRatio) <= 1e-9;
    });

    if (allSameRatio && firstRatio >= PINTEREST_MIN_RATIO) return null;
  }

  const firstDecision = getBoosterImageDecision({
    channel,
    meta: metas[0],
  });

  const target = firstDecision.targetRatio || firstDecision.sourceRatio;
  return Number.isFinite(Number(target)) && Number(target) > 0
    ? Number(target)
    : null;
}

/**
 * UI plan derived from the exact same decision matrix as the publication policy.
 *
 * Step 2 uses this to make Booster honest:
 * - Originale => source ratio/composition shown as-is;
 * - Adaptée => target ratio shown with the 8% crop curtain;
 * - Personnalisée => caller renders the persisted Adapter transform.
 */
export function getBoosterImageDisplayPlan(params: Parameters<typeof getBoosterImageDecision>[0]): BoosterImageDisplayPlan {
  const decision = getBoosterImageDecision(params);

  if (decision.mode === "original") {
    return {
      decision,
      previewRatio: decision.sourceRatio,
      automaticFit: "contain",
      preserveSourceComposition: true,
    };
  }

  if (decision.mode === "adapted") {
    const sourceRatio = decision.sourceRatio;
    const targetRatio = decision.targetRatio;
    return {
      decision,
      previewRatio: targetRatio,
      automaticFit:
        sourceRatio && targetRatio && canUseAutomaticCover(sourceRatio, targetRatio)
          ? "cover"
          : BOOSTER_AUTO_ADAPT_FALLBACK_FIT,
      preserveSourceComposition: false,
    };
  }

  return {
    decision,
    previewRatio: null,
    automaticFit: params.currentTransform?.fit || "contain",
    preserveSourceComposition: false,
  };
}
