import type { BackgroundMode } from "@/app/dashboard/_components/channel-image-adapter/types";
import {
  normalizeImageOverlay,
  type ImageOverlay,
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

function drawOverlay(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  overlayValue: ImageOverlay | undefined,
) {
  const overlay = normalizeImageOverlay(overlayValue);
  if (!overlay?.text) return;

  const fontSize = Math.max(24, Math.min(72, Math.round(width * 0.046)));
  const lineHeight = Math.round(fontSize * 1.2);
  const maxTextWidth = width * 0.82;
  const words = overlay.text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  context.font = `800 ${fontSize}px Inter, Arial, sans-serif`;
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (line && context.measureText(candidate).width > maxTextWidth) {
      lines.push(line);
      line = word;
    } else {
      line = candidate;
    }
  }
  if (line) lines.push(line);
  if (!lines.length) return;

  const paddingX = Math.round(fontSize * 0.72);
  const paddingY = Math.round(fontSize * 0.5);
  const blockWidth = Math.min(
    width * 0.9,
    Math.max(
      fontSize * 4,
      Math.max(...lines.map((value) => context.measureText(value).width)) +
        paddingX * 2,
    ),
  );
  const blockHeight = lines.length * lineHeight + paddingY * 2;
  const edge = Math.round(fontSize * 0.8);
  const blockX = (width - blockWidth) / 2;
  const blockY =
    overlay.position === "top"
      ? edge
      : overlay.position === "bottom"
        ? height - blockHeight - edge
        : (height - blockHeight) / 2;

  context.save();
  context.fillStyle =
    overlay.style === "glass"
      ? "rgba(255,255,255,0.2)"
      : "rgba(6,10,20,0.78)";
  context.strokeStyle = "rgba(255,255,255,0.28)";
  context.lineWidth = Math.max(1, Math.round(fontSize / 18));
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
  context.stroke();
  context.fillStyle = "#ffffff";
  context.textAlign = "center";
  context.textBaseline = "middle";
  lines.forEach((value, index) => {
    context.fillText(
      value,
      width / 2,
      blockY + paddingY + lineHeight * index + lineHeight / 2,
      maxTextWidth,
    );
  });
  context.restore();
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
    drawOverlay(
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
