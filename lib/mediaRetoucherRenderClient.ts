import type { BackgroundMode } from "@/app/dashboard/_components/channel-image-adapter/types";
import {
  getImageOverlayItems,
  type ImageOverlay,
  type ImageOverlayItem,
} from "@/lib/imageOverlay";
import { imageOverlayFont, resolveImageOverlayTextLayout } from "./imageOverlayLayout.ts";
import { resolveRetoucherGeometry } from "./mediaRetoucherGeometry.ts";

export type MediaRetoucherRenderTransform = {
  fit: "contain" | "cover";
  zoom: number;
  offsetX: number;
  offsetY: number;
  backgroundMode: BackgroundMode;
  backgroundColor: string;
  overlay?: ImageOverlay;
};

const MAX_OUTPUT_SIDE = 4_096;
const MAX_OUTPUT_PIXELS = 20_000_000;

function backgroundFill(mode: BackgroundMode, customColor: string) {
  if (mode === "black") return "#0d1320";
  if (mode === "white") return "#ffffff";
  if (mode === "gray") return "#e5e7eb";
  if (mode === "sand") return "#e8dcc8";
  if (mode === "brand") return customColor || "#0f766e";
  return customColor || "#ffffff";
}

function loadImage(url: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.decoding = "async";
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error("Cette image ne peut pas être rendue."));
    image.src = url;
  });
}

function canvasBlob(
  canvas: HTMLCanvasElement,
  mimeType: "image/jpeg" | "image/png",
) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) =>
        blob
          ? resolve(blob)
          : reject(new Error("La retouche n’a pas pu être exportée.")),
      mimeType,
      mimeType === "image/jpeg" ? 0.92 : undefined,
    );
  });
}

function outputDimensions(width: number, height: number) {
  const safeWidth = Math.max(1, Math.round(width));
  const safeHeight = Math.max(1, Math.round(height));
  const scale = Math.min(
    1,
    MAX_OUTPUT_SIDE / Math.max(safeWidth, safeHeight),
    Math.sqrt(MAX_OUTPUT_PIXELS / (safeWidth * safeHeight)),
  );
  return {
    width: Math.max(1, Math.round(safeWidth * scale)),
    height: Math.max(1, Math.round(safeHeight * scale)),
  };
}

function drawOverlayItem(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  overlay: ImageOverlayItem,
) {
  if (!overlay?.text) return;

  context.save();
  const layout = resolveImageOverlayTextLayout(width, height, overlay, (text, font) => {
    context.font = font;
    return context.measureText(text).width;
  });
  const { x: blockX, y: blockY, width: blockWidth, height: blockHeight, fontSize, lineHeight, lines } = layout;
  context.font = imageOverlayFont(overlay, fontSize);
  context.fillStyle =
    overlay.style === "glass"
      ? "rgba(255,255,255,0.2)"
      : "rgba(6,10,20,0.78)";
  context.strokeStyle = overlay.borderColor || "transparent";
  context.lineWidth = layout.borderWidth || 1;
  context.beginPath();
  if (typeof context.roundRect === "function") {
    context.roundRect(
      blockX,
      blockY,
      blockWidth,
      blockHeight,
      layout.radius,
    );
  } else {
    context.rect(blockX, blockY, blockWidth, blockHeight);
  }
  context.fill();
  if ((overlay.borderWidth ?? 0) > 0) context.stroke();
  context.fillStyle = overlay.color || "#ffffff";
  context.textAlign = "center";
  context.textBaseline = "middle";
  lines.forEach((value, index) => {
    const textY = layout.firstLineY + lineHeight * index;
    context.fillText(
      value,
      blockX + blockWidth / 2,
      textY,
    );
    if (overlay.underline && value) {
      const measuredWidth = context.measureText(value).width;
      context.strokeStyle = overlay.color || "#ffffff";
      context.lineWidth = Math.max(1, fontSize / 18);
      context.beginPath();
      context.moveTo(blockX + (blockWidth - measuredWidth) / 2, textY + fontSize * 0.55);
      context.lineTo(blockX + (blockWidth + measuredWidth) / 2, textY + fontSize * 0.55);
      context.stroke();
    }
  });
  context.restore();
}

export function drawImageOverlayItems(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  overlayValue: ImageOverlay | undefined,
) {
  for (const overlay of getImageOverlayItems(overlayValue)) {
    drawOverlayItem(context, width, height, overlay);
  }
}

export async function renderMediaRetoucherFile(params: {
  sourceFile: File;
  width: number;
  height: number;
  transform: MediaRetoucherRenderTransform;
}) {
  const objectUrl = URL.createObjectURL(params.sourceFile);
  try {
    const image = await loadImage(objectUrl);
    // Export with the same loaded font metrics as the text preview.
    if (document.fonts?.ready) await document.fonts.ready;
    const dimensions = outputDimensions(params.width, params.height);
    const canvas = document.createElement("canvas");
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Le moteur de rendu est indisponible.");

    const sourceWidth = image.naturalWidth || params.width || 1;
    const sourceHeight = image.naturalHeight || params.height || 1;
    const { drawX, drawY, drawWidth, drawHeight } = resolveRetoucherGeometry({
      canvasWidth: canvas.width,
      canvasHeight: canvas.height,
      sourceWidth,
      sourceHeight,
      ...params.transform,
    });

    context.clearRect(0, 0, canvas.width, canvas.height);
    if (params.transform.backgroundMode !== "transparent") {
      context.fillStyle = backgroundFill(
        params.transform.backgroundMode,
        params.transform.backgroundColor,
      );
      context.fillRect(0, 0, canvas.width, canvas.height);
    }
    context.drawImage(image, drawX, drawY, drawWidth, drawHeight);
    drawImageOverlayItems(
      context,
      canvas.width,
      canvas.height,
      params.transform.overlay,
    );

    const mimeType =
      params.transform.backgroundMode === "transparent"
        ? "image/png"
        : "image/jpeg";
    const blob = await canvasBlob(canvas, mimeType);
    const stem =
      params.sourceFile.name.replace(/\.[^.]+$/, "").slice(0, 120) ||
      "image-inrstudio";
    return {
      file: new File(
        [blob],
        `${stem}-retouche.${mimeType === "image/png" ? "png" : "jpg"}`,
        { type: mimeType, lastModified: Date.now() },
      ),
      width: canvas.width,
      height: canvas.height,
    };
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
