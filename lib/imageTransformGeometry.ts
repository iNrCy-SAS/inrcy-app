export type ImageCanvasFit = "contain" | "cover";

export type ImageCanvasTransform = {
  fit: ImageCanvasFit;
  zoom?: number;
  offsetX?: number;
  offsetY?: number;
};

export type ImageCanvasLayout = {
  canvasWidth: number;
  canvasHeight: number;
  drawWidth: number;
  drawHeight: number;
  drawX: number;
  drawY: number;
  maxX: number;
  maxY: number;
};

function finite(value: unknown, fallback: number) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function clamp(value: unknown, min: number, max: number, fallback: number) {
  return Math.min(max, Math.max(min, finite(value, fallback)));
}

/**
 * Canonical geometry shared by the browser canvas, its preview and Sharp.
 *
 * `offsetX/Y` describe a percentage of the available crop/padding travel, not
 * pixels. A positive value moves the image towards the left/top, matching the
 * historic Booster adapter controls.
 */
export function computeImageCanvasLayout(params: {
  canvasWidth: number;
  canvasHeight: number;
  imageWidth: number;
  imageHeight: number;
  transform: ImageCanvasTransform;
  /** Sharp requires integer resize/composite coordinates. */
  roundPixels?: boolean;
}): ImageCanvasLayout {
  const canvasWidth = Math.max(0, finite(params.canvasWidth, 0));
  const canvasHeight = Math.max(0, finite(params.canvasHeight, 0));
  const imageWidth = Math.max(0, finite(params.imageWidth, 0));
  const imageHeight = Math.max(0, finite(params.imageHeight, 0));
  if (!canvasWidth || !canvasHeight || !imageWidth || !imageHeight) {
    return {
      canvasWidth,
      canvasHeight,
      drawWidth: 0,
      drawHeight: 0,
      drawX: 0,
      drawY: 0,
      maxX: 0,
      maxY: 0,
    };
  }

  const fit: ImageCanvasFit =
    params.transform.fit === "cover" ? "cover" : "contain";
  const baseScale =
    fit === "cover"
      ? Math.max(canvasWidth / imageWidth, canvasHeight / imageHeight)
      : Math.min(canvasWidth / imageWidth, canvasHeight / imageHeight);
  const zoom = clamp(params.transform.zoom, 0.4, fit === "cover" ? 3 : 1, 1);
  const rawDrawWidth = imageWidth * baseScale * zoom;
  const rawDrawHeight = imageHeight * baseScale * zoom;
  const drawWidth = params.roundPixels
    ? Math.max(1, Math.round(rawDrawWidth))
    : rawDrawWidth;
  const drawHeight = params.roundPixels
    ? Math.max(1, Math.round(rawDrawHeight))
    : rawDrawHeight;
  const maxX = Math.abs(drawWidth - canvasWidth) / 2;
  const maxY = Math.abs(drawHeight - canvasHeight) / 2;
  const rawDrawX =
    (canvasWidth - drawWidth) / 2 -
    (maxX * clamp(params.transform.offsetX, -100, 100, 0)) / 100;
  const rawDrawY =
    (canvasHeight - drawHeight) / 2 -
    (maxY * clamp(params.transform.offsetY, -100, 100, 0)) / 100;

  return {
    canvasWidth,
    canvasHeight,
    drawWidth,
    drawHeight,
    drawX: params.roundPixels ? Math.round(rawDrawX) : rawDrawX,
    drawY: params.roundPixels ? Math.round(rawDrawY) : rawDrawY,
    maxX,
    maxY,
  };
}
