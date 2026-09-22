import type { BackgroundMode } from "@/app/dashboard/_components/channel-image-adapter/types";
import {
  getImageOverlayItems,
  resolveImageOverlayCoordinates,
  type ImageOverlay,
  type ImageOverlayItem,
} from "@/lib/imageOverlay";

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

function clamp(value: number, minimum: number, maximum: number) {
  return Math.min(maximum, Math.max(minimum, value));
}

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

function overlayCanvasFontFamily(value: ImageOverlayItem["fontFamily"]) {
  if (value === "arial") return "Arial, sans-serif";
  if (value === "georgia") return "Georgia, serif";
  if (value === "verdana") return "Verdana, sans-serif";
  return "Inter, Arial, sans-serif";
}

function drawOverlayItem(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  overlay: ImageOverlayItem,
) {
  if (!overlay?.text) return;

  const fontSize = Math.max(
    14,
    Math.min(160, Math.round(width * ((overlay.fontSize ?? 4.6) / 100))),
  );
  const lineHeight = Math.round(fontSize * 1.2);
  const paddingX = Math.round(fontSize * 0.72);
  const paddingY = Math.round(fontSize * 0.5);
  const edge = Math.round(fontSize * 0.8);
  const requestedBlockWidth = overlay.width
    ? (width * overlay.width) / 100
    : null;
  const maxTextWidth = Math.max(
    fontSize * 2,
    (requestedBlockWidth ?? width * 0.9) - paddingX * 2,
  );
  const lines: string[] = [];
  const fontWeight = overlay.bold === false ? 400 : 800;
  const fontStyle = overlay.italic ? "italic " : "";
  context.font = `${fontStyle}${fontWeight} ${fontSize}px ${overlayCanvasFontFamily(overlay.fontFamily)}`;
  for (const paragraph of overlay.text.split(/\r?\n/)) {
    if (!paragraph) {
      lines.push("");
      continue;
    }
    let line = "";
    for (const character of paragraph) {
      const candidate = `${line}${character}`;
      if (line && context.measureText(candidate).width > maxTextWidth) {
        lines.push(line);
        line = character === " " ? "" : character;
      } else {
        line = candidate;
      }
    }
    lines.push(line);
  }
  if (!lines.length) return;

  const blockWidth = Math.min(
    Math.max(1, width - edge * 2),
    requestedBlockWidth ??
      Math.max(
        fontSize * 4,
        Math.max(...lines.map((value) => context.measureText(value).width)) +
          paddingX * 2,
      ),
  );
  const naturalBlockHeight = lines.length * lineHeight + paddingY * 2;
  const blockHeight = Math.min(
    Math.max(1, height - edge * 2),
    overlay.height ? (height * overlay.height) / 100 : naturalBlockHeight,
  );
  const visibleLineCount = Math.max(
    1,
    Math.floor(Math.max(lineHeight, blockHeight - paddingY * 2) / lineHeight),
  );
  const visibleLines = lines.slice(0, visibleLineCount);
  const coordinates = resolveImageOverlayCoordinates(overlay);
  const blockX = clamp(
    (width * coordinates.x) / 100 - blockWidth / 2,
    edge,
    Math.max(edge, width - blockWidth - edge),
  );
  const blockY = clamp(
    (height * coordinates.y) / 100 - blockHeight / 2,
    edge,
    Math.max(edge, height - blockHeight - edge),
  );

  context.save();
  context.fillStyle =
    overlay.style === "glass"
      ? "rgba(255,255,255,0.2)"
      : "rgba(6,10,20,0.78)";
  context.strokeStyle = overlay.borderColor || "transparent";
  context.lineWidth = Math.max(
    1,
    Math.round((overlay.borderWidth ?? 0) * Math.max(1, width / 1000)),
  );
  context.beginPath();
  if (typeof context.roundRect === "function") {
    context.roundRect(
      blockX,
      blockY,
      blockWidth,
      blockHeight,
      Math.round(fontSize * 0.45),
    );
  } else {
    context.rect(blockX, blockY, blockWidth, blockHeight);
  }
  context.fill();
  if ((overlay.borderWidth ?? 0) > 0) context.stroke();
  context.fillStyle = overlay.color || "#ffffff";
  context.textAlign = "center";
  context.textBaseline = "middle";
  const textBlockHeight = visibleLines.length * lineHeight;
  const firstLineY = blockY + (blockHeight - textBlockHeight) / 2 + lineHeight / 2;
  visibleLines.forEach((value, index) => {
    const textY = firstLineY + lineHeight * index;
    context.fillText(
      value,
      blockX + blockWidth / 2,
      textY,
      maxTextWidth,
    );
    if (overlay.underline && value) {
      const measuredWidth = Math.min(
        maxTextWidth,
        context.measureText(value).width,
      );
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
    const dimensions = outputDimensions(params.width, params.height);
    const canvas = document.createElement("canvas");
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext("2d");
    if (!context) throw new Error("Le moteur de rendu est indisponible.");

    const sourceWidth = image.naturalWidth || params.width || 1;
    const sourceHeight = image.naturalHeight || params.height || 1;
    const baseScale =
      params.transform.fit === "cover"
        ? Math.max(canvas.width / sourceWidth, canvas.height / sourceHeight)
        : Math.min(canvas.width / sourceWidth, canvas.height / sourceHeight);
    const scale = baseScale * clamp(params.transform.zoom || 1, 0.4, 3);
    const drawWidth = sourceWidth * scale;
    const drawHeight = sourceHeight * scale;
    const maxX = Math.abs(drawWidth - canvas.width) / 2;
    const maxY = Math.abs(drawHeight - canvas.height) / 2;
    const drawX =
      (canvas.width - drawWidth) / 2 -
      (maxX * clamp(params.transform.offsetX || 0, -100, 100)) / 100;
    const drawY =
      (canvas.height - drawHeight) / 2 -
      (maxY * clamp(params.transform.offsetY || 0, -100, 100)) / 100;

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
