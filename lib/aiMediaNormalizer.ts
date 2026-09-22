import "server-only";

import sharp from "sharp";

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
  durationSeconds: 8 | 16 | 24;
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
 * conserve le rendu fournisseur en entier dans son preset. Une modification
 * remplit au contraire le canvas autoritaire de la source : le padding imposé
 * par les tailles fournisseur est recadré au lieu de devenir une bordure.
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
  const framing = preservesSourceCanvas
    ? ({ fit: "cover", position: "attention" } as const)
    : ({ fit: "contain", position: "centre" } as const);
  const rendered = await sharp(input, {
    failOn: "error",
    limitInputPixels: 50_000_000,
    pages: 1,
  })
    .rotate()
    .resize({
      width,
      height,
      // Les presets de génération conservent historiquement tout le rendu.
      // Modifier, lui, doit supprimer le letterbox éventuel du fournisseur et
      // remplir exactement le canvas source, sans fabriquer de bandes.
      ...framing,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
      withoutEnlargement: false,
    })
    .flatten({ background: { r: 255, g: 255, b: 255 } })
    .toColourspace("srgb")
    .jpeg({
      quality: 90,
      mozjpeg: true,
      progressive: true,
      chromaSubsampling: "4:2:0",
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
