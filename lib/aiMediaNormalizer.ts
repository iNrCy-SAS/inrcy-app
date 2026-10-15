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
  const base = sharp(input, {
    failOn: "error",
    limitInputPixels: 50_000_000,
    pages: 1,
  })
    .rotate()
    .toColourspace("srgb");
  let canvas: Buffer;
  if (preservesSourceCanvas) {
    canvas = await base.resize({
      width,
      height,
      fit: "cover", position: "attention",
      withoutEnlargement: false,
    }).png().toBuffer();
  } else {
    // Preserve the complete supplier composition, including text and faces.
    // The small ratio gap is filled from a blurred background copy; only that
    // background is cropped. The foreground is never stretched or cropped.
    const foreground = await base.clone().resize({ width, height, fit: "inside" })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .png().toBuffer({ resolveWithObject: true });
    if (foreground.info.width === width && foreground.info.height === height) {
      canvas = foreground.data;
    } else {
      const background = await base.clone()
        .resize({ width, height, fit: "cover", position: "centre" })
        .flatten({ background: { r: 255, g: 255, b: 255 } })
        .blur(Math.max(8, Math.min(width, height) / 30))
        .png().toBuffer();
      canvas = await sharp(background).composite([{
        input: foreground.data,
        left: Math.floor((width - foreground.info.width) / 2),
        top: Math.floor((height - foreground.info.height) / 2),
      }]).png().toBuffer();
    }
  }
  const rendered = await sharp(canvas)
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
