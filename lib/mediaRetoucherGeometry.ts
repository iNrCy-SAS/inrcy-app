export type RetoucherGeometryInput = {
  canvasWidth: number;
  canvasHeight: number;
  sourceWidth: number;
  sourceHeight: number;
  fit: "contain" | "cover";
  zoom: number;
  /** Translation in percent of the canvas; positive values move right/down. */
  offsetX: number;
  offsetY: number;
};

function finite(value: number, fallback: number) {
  return Number.isFinite(value) ? value : fallback;
}

/** The same coordinate system is used by the drag gesture, preview and export. */
export function resolveRetoucherGeometry(input: RetoucherGeometryInput) {
  const width = Math.max(1, finite(input.canvasWidth, 1));
  const height = Math.max(1, finite(input.canvasHeight, 1));
  const sourceWidth = Math.max(1, finite(input.sourceWidth, 1));
  const sourceHeight = Math.max(1, finite(input.sourceHeight, 1));
  const scale = (input.fit === "cover" ? Math.max : Math.min)(
    width / sourceWidth,
    height / sourceHeight,
  ) * Math.min(3, Math.max(0.4, finite(input.zoom, 1)));
  const drawWidth = sourceWidth * scale;
  const drawHeight = sourceHeight * scale;
  return {
    drawWidth,
    drawHeight,
    drawX: (width - drawWidth) / 2 + width * Math.min(100, Math.max(-100, finite(input.offsetX, 0))) / 100,
    drawY: (height - drawHeight) / 2 + height * Math.min(100, Math.max(-100, finite(input.offsetY, 0))) / 100,
  };
}
