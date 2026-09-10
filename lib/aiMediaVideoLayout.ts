export const AI_MEDIA_VIDEO_TEXT_LAYOUT = "adaptive-overlay" as const;

export type AiMediaVideoOrientation = "landscape" | "portrait" | "square";

export type AiMediaVideoOverlayLayout = {
  width: number;
  height: number;
  orientation: AiMediaVideoOrientation;
  copy: {
    left: number;
    maxWidth: number;
    safeBottom: number;
    titleSize: number;
    bodySize: number;
    eyebrowSize: number;
    titleLineHeight: number;
    bodyLineHeight: number;
    titleMaxCharacters: number;
    titleMaxLines: number;
    bodyMaxCharacters: number;
    bodyMaxLines: number;
    accentWidth: number;
    accentHeight: number;
  };
  logo: {
    marginX: number;
    marginY: number;
  };
};

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

function roundedClamp(value: number, minimum: number, maximum: number) {
  return Math.round(clamp(value, minimum, maximum));
}

/**
 * Unique source of truth for exact text and logo placement on generated
 * videos. Nothing is reserved outside the picture: every format remains a
 * full-frame video and the branding is drawn as a transparent overlay.
 */
export function resolveAiMediaVideoOverlayLayout(args: {
  width: number;
  height: number;
}): AiMediaVideoOverlayLayout {
  const width = Math.max(2, Math.round(args.width));
  const height = Math.max(2, Math.round(args.height));
  const ratio = width / height;
  const orientation: AiMediaVideoOrientation = ratio >= 1.25
    ? "landscape"
    : ratio <= 0.8
      ? "portrait"
      : "square";
  const unit = Math.min(width, height);
  const marginRatio = orientation === "landscape" ? 0.055 : 0.06;
  const left = roundedClamp(width * marginRatio, 16, width * 0.1);
  const verticalMargin = roundedClamp(
    height * (orientation === "portrait" ? 0.06 : 0.052),
    16,
    height * 0.1,
  );
  const bottomSafety = roundedClamp(unit * 0.025, 8, 30);
  const availableWidth = width - left * 2;
  const maxWidth = orientation === "landscape"
    ? Math.min(availableWidth, Math.round(width * 0.68))
    : availableWidth;
  const titleSize = roundedClamp(
    unit * (orientation === "portrait" ? 0.068 : 0.064),
    20,
    92,
  );
  const bodySize = roundedClamp(unit * 0.028, 11, 40);
  const eyebrowSize = roundedClamp(unit * 0.022, 10, 31);
  const estimatedTitleCharacters = Math.floor(maxWidth / (titleSize * 0.55));
  const estimatedBodyCharacters = Math.floor(maxWidth / (bodySize * 0.52));

  return {
    width,
    height,
    orientation,
    copy: {
      left,
      maxWidth,
      safeBottom: height - verticalMargin - bottomSafety,
      titleSize,
      bodySize,
      eyebrowSize,
      titleLineHeight: Math.round(titleSize * 1.06),
      bodyLineHeight: Math.round(bodySize * 1.25),
      titleMaxCharacters: clamp(
        estimatedTitleCharacters,
        orientation === "landscape" ? 28 : 20,
        orientation === "landscape" ? 44 : orientation === "portrait" ? 29 : 34,
      ),
      titleMaxLines: orientation === "landscape" ? 2 : 3,
      bodyMaxCharacters: clamp(
        estimatedBodyCharacters,
        orientation === "landscape" ? 42 : 32,
        orientation === "landscape" ? 72 : orientation === "portrait" ? 48 : 56,
      ),
      bodyMaxLines: 2,
      accentWidth: Math.min(maxWidth, Math.max(52, Math.round(maxWidth * 0.2))),
      accentHeight: roundedClamp(unit * 0.006, 3, 7),
    },
    logo: {
      marginX: roundedClamp(width * 0.045, 16, width * 0.08),
      marginY: roundedClamp(height * 0.045, 16, height * 0.08),
    },
  };
}

/**
 * Computes one shared baseline model for the gradient and rasterized text.
 * Keeping this formula out of the renderer prevents the background and copy
 * from drifting apart when a format or font size changes.
 */
export function resolveAiMediaVideoCopyPlacement(args: {
  layout: AiMediaVideoOverlayLayout;
  titleLineCount: number;
  bodyLineCount: number;
}) {
  const { copy, height } = args.layout;
  const titleLineCount = Math.max(1, Math.round(args.titleLineCount));
  const bodyLineCount = Math.max(0, Math.round(args.bodyLineCount));
  const bodyFirstTop = bodyLineCount > 0
    ? copy.safeBottom - copy.bodySize - (bodyLineCount - 1) * copy.bodyLineHeight
    : copy.safeBottom;
  const titleLastBaseline = bodyLineCount > 0
    ? bodyFirstTop - Math.round(copy.bodySize * 0.55)
    : copy.safeBottom;
  const titleFirstTop = titleLastBaseline
    - copy.titleSize
    - (titleLineCount - 1) * copy.titleLineHeight;
  const eyebrowTop = titleFirstTop - Math.round(copy.eyebrowSize * 1.3);
  const accentTop = eyebrowTop - Math.round(copy.eyebrowSize * 0.55);
  const gradientStartPercent = clamp(
    Math.round(((accentTop - copy.titleSize * 1.1) / height) * 100),
    24,
    58,
  );

  return {
    titleFirstTop,
    bodyFirstTop,
    eyebrowTop,
    accentTop,
    gradientStartPercent,
    gradientMiddlePercent: clamp(gradientStartPercent + 24, 52, 82),
  };
}
