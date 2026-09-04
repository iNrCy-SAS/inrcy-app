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

/**
 * Contrat de sortie unique pour toutes les images IA. GPT Image a déjà reçu
 * le Profil et le logo officiel ; cette étape ne crée aucun habillage et
 * applique seulement le canevas universel avant la Médiathèque. La composition
 * générée est toujours conservée en entier : aucun bord ne peut être coupé à
 * cette étape, même lorsque le format fournisseur diffère du format demandé.
 */
export async function normalizeGeneratedAiImage(
  input: Buffer,
  options: { width?: number; height?: number } = {},
): Promise<NormalizedAiImage> {
  const width = Math.max(320, Math.min(2_048, Math.trunc(options.width || 1080)));
  const height = Math.max(320, Math.min(2_048, Math.trunc(options.height || 1080)));
  const rendered = await sharp(input, {
    failOn: "error",
    limitInputPixels: 50_000_000,
    pages: 1,
  })
    .rotate()
    .resize({
      width,
      height,
      fit: "contain",
      position: "centre",
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
