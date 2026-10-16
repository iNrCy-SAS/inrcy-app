import "server-only";

import sharp from "sharp";
import { detectAiMediaUniformBorderCrop, scaleAiMediaFrameCrop } from "./aiMediaFullFrame.ts";

export type NormalizedAiImage = {
  kind: "image";
  buffer: Buffer;
  mimeType: "image/jpeg";
  extension: "jpg";
  width: number;
  height: number;
  durationSeconds: null;
};

export type NormalizedAiVideo = {
  kind: "video";
  buffer: Buffer;
  mimeType: "video/mp4";
  extension: "mp4";
  width: number;
  height: number;
  durationSeconds: number;
};

export type NormalizedAiMedia = NormalizedAiImage | NormalizedAiVideo;

export type AiImageNormalizationCanvasMode = "preset" | "source";

function resolveImageCanvasDimensions(options: {
  width?: number;
  height?: number;
  canvasMode?: AiImageNormalizationCanvasMode;
}) {
  const requestedWidth = Math.max(1, Math.trunc(options.width || 1080));
  const requestedHeight = Math.max(1, Math.trunc(options.height || 1080));
  if (options.canvasMode !== "source") {
    return {
      width: Math.max(320, Math.min(2_048, requestedWidth)),
      height: Math.max(320, Math.min(2_048, requestedHeight)),
    };
  }

  // Modifier garde le ratio source même lorsqu'un très grand fichier doit être
  // borné pour le stockage. Les deux axes sont réduits avec le même facteur :
  // aucun clamp indépendant ne peut transformer son cadrage.
  const scale = Math.min(1, 2_048 / Math.max(requestedWidth, requestedHeight));
  return {
    width: Math.max(1, Math.round(requestedWidth * scale)),
    height: Math.max(1, Math.round(requestedHeight * scale)),
  };
}

/**
 * Contrat de sortie unique pour toutes les images IA. La génération standard
 * remplit le format choisi sans canvas ajouté, bandes ni copie floutée.
 * Une modification garde le canvas autoritaire de sa source ; ses marges
 * graphiques existantes ne sont jamais assimilées à du padding fournisseur.
 */
export async function normalizeGeneratedAiImage(
  input: Buffer,
  options: {
    width?: number;
    height?: number;
    canvasMode?: AiImageNormalizationCanvasMode;
  } = {},
): Promise<NormalizedAiImage> {
  const { width, height } = resolveImageCanvasDimensions(options);
  const preservesSourceCanvas = options.canvasMode === "source";
  const base = sharp(input, {
    failOn: "error",
    limitInputPixels: 50_000_000,
    pages: 1,
  })
    .rotate()
    .toColourspace("srgb");
  if (!preservesSourceCanvas) {
    const [metadata, sample] = await Promise.all([
      base.metadata(),
      base.clone().resize({ width: 384, height: 384, fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#ffffff" }).removeAlpha().raw().toBuffer({ resolveWithObject: true }),
    ]);
    const detected = detectAiMediaUniformBorderCrop({ data: sample.data, ...sample.info });
    if (detected && metadata.width && metadata.height) {
      const rotated = Number(metadata.orientation || 1) >= 5 && Number(metadata.orientation || 1) <= 8;
      base.extract(scaleAiMediaFrameCrop(detected, sample.info, {
        width: rotated ? metadata.height : metadata.width,
        height: rotated ? metadata.width : metadata.height,
      }));
    }
  }
  const rendered = await base.resize({
      width, height, fit: "cover", position: preservesSourceCanvas ? "attention" : "centre",
      withoutEnlargement: false,
    })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .jpeg({
      quality: 92,
      mozjpeg: true,
      progressive: true,
      chromaSubsampling: "4:4:4",
      optimiseCoding: true,
      optimiseScans: true,
    })
    .toBuffer({ resolveWithObject: true });

  if (
    rendered.info.width !== width ||
    rendered.info.height !== height ||
    !rendered.data.byteLength
  ) {
    throw new Error("ai_image_normalization_invalid");
  }

  return {
    kind: "image",
    buffer: rendered.data,
    mimeType: "image/jpeg",
    extension: "jpg",
    width,
    height,
    durationSeconds: null,
  };
}
