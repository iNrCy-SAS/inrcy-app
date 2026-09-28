import "server-only";

import sharp, { type Metadata } from "sharp";

import {
  assertMetaCreativeDimensions,
  META_CREATIVE_DIMENSION_RULES,
  type MetaCreativeAssetSlot,
  type MetaCreativeDimensionValidation,
} from "./adsMetaCreativeDimensions.ts";

const MAX_META_SOURCE_IMAGE_BYTES = 30 * 1024 * 1024;
const MAX_META_SOURCE_IMAGE_PIXELS = 40_000_000;

export type PreparedMetaCreativeImage = {
  buffer: Buffer;
  contentType: "image/jpeg";
  width: number;
  height: number;
  sourceWidth: number;
  sourceHeight: number;
  validation: MetaCreativeDimensionValidation;
};

/**
 * Inspects the actual bytes immediately before the Marketing API upload.
 * Database/browser dimensions are useful for the UI but are never trusted as
 * the publication boundary. The accepted image is auto-oriented and encoded
 * on the exact placement canvas so Meta never has to reuse or stretch the
 * other placement's asset.
 */
export async function prepareMetaCreativeImageForUpload(
  sourceValue: Buffer | Uint8Array,
  slot: MetaCreativeAssetSlot,
): Promise<PreparedMetaCreativeImage> {
  const source = Buffer.isBuffer(sourceValue)
    ? sourceValue
    : Buffer.from(sourceValue);
  if (!source.length) {
    throw new Error("L’image Meta Ads est vide.");
  }
  if (source.length > MAX_META_SOURCE_IMAGE_BYTES) {
    throw new Error("L’image Meta Ads dépasse la limite de 30 Mo.");
  }

  let metadata: Metadata;
  try {
    metadata = await sharp(source, {
      failOn: "error",
      limitInputPixels: MAX_META_SOURCE_IMAGE_PIXELS,
    }).metadata();
  } catch {
    throw new Error("Le fichier Meta Ads n’est pas une image valide.");
  }

  const validation = assertMetaCreativeDimensions(slot, {
    width: metadata.width,
    height: metadata.height,
    orientation: metadata.orientation,
  });
  const rule = META_CREATIVE_DIMENSION_RULES[slot];

  try {
    const buffer = await sharp(source, {
      failOn: "error",
      limitInputPixels: MAX_META_SOURCE_IMAGE_PIXELS,
    })
      .rotate()
      .resize(rule.recommendedWidth, rule.recommendedHeight, {
        fit: "cover",
        position: "attention",
      })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .jpeg({ quality: 88, mozjpeg: true })
      .toBuffer();

    return {
      buffer,
      contentType: "image/jpeg",
      width: rule.recommendedWidth,
      height: rule.recommendedHeight,
      sourceWidth: validation.width!,
      sourceHeight: validation.height!,
      validation,
    };
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("L’image Meta")) {
      throw error;
    }
    throw new Error("L’image Meta Ads n’a pas pu être préparée pour la publication.");
  }
}
