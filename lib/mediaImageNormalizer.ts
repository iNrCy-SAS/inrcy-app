import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import bmp from "bmp-js";
import heicConvert from "heic-convert";
import sharp, { type Sharp } from "sharp";
import {
  IMAGE_AI_PREVIEW_JPEG_QUALITY,
  IMAGE_AI_PREVIEW_MAX_SIDE,
  IMAGE_CANONICAL_JPEG_QUALITY,
  IMAGE_CANONICAL_MAX_SIDE,
  IMAGE_NORMALIZATION_BMP_FALLBACK_MAX_BYTES,
  IMAGE_NORMALIZATION_BMP_MAX_INPUT_PIXELS,
  IMAGE_NORMALIZATION_HEIC_FALLBACK_MAX_BYTES,
  IMAGE_NORMALIZATION_MAX_INPUT_PIXELS,
  IMAGE_THUMBNAIL_JPEG_QUALITY,
  IMAGE_THUMBNAIL_MAX_SIDE,
  isBmpMimeOrName,
  isHeicMimeOrName,
  type ImageNormalizationPurpose,
} from "./mediaImageNormalizationPolicy.ts";

const WHITE_BACKGROUND = { r: 255, g: 255, b: 255, alpha: 1 } as const;

type SharpInput = string | Buffer;

export type NormalizedImageVariant = {
  purpose: ImageNormalizationPurpose;
  buffer: Buffer;
  mimeType: "image/jpeg" | "image/png";
  extension: "jpg" | "png";
  width: number;
  height: number;
  sizeBytes: number;
  transformSpec: Record<string, unknown>;
  metadata: Record<string, unknown>;
};

export type NormalizedImageBundle = {
  source: {
    probeProvenance: "server_sharp";
    width: number;
    height: number;
    format: string;
    hasAlpha: boolean;
    pages: number;
    orientation: number | null;
    decoder: "sharp" | "heic-convert" | "bmp-js";
  };
  variants: Record<ImageNormalizationPurpose, NormalizedImageVariant>;
};

export type PartialNormalizedImageBundle = Omit<
  NormalizedImageBundle,
  "variants"
> & {
  variants: Partial<Record<ImageNormalizationPurpose, NormalizedImageVariant>>;
};

function getOrientedDimensions(meta: {
  width?: number;
  height?: number;
  orientation?: number;
}) {
  const width = Number(meta.width || 0);
  const height = Number(meta.height || 0);
  const orientation = Number(meta.orientation || 1);
  const swapsAxes = orientation >= 5 && orientation <= 8;
  return {
    width: swapsAxes ? height : width,
    height: swapsAxes ? width : height,
  };
}

function createBasePipeline(input: SharpInput, maxSide: number): Sharp {
  return sharp(input, {
    failOn: "error",
    limitInputPixels: IMAGE_NORMALIZATION_MAX_INPUT_PIXELS,
    pages: 1,
  })
    .rotate()
    .resize({
      width: maxSide,
      height: maxSide,
      fit: "inside",
      withoutEnlargement: true,
      fastShrinkOnLoad: true,
    })
    .toColourspace("srgb");
}

function outputSha256(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function renderJpeg(params: {
  input: SharpInput;
  purpose: ImageNormalizationPurpose;
  maxSide: number;
  quality: number;
  sourceMetadata: Record<string, unknown>;
}) {
  const providerSafe = params.purpose === "ai_preview";
  const rendered = await createBasePipeline(params.input, params.maxSide)
    .flatten({ background: WHITE_BACKGROUND })
    .jpeg({
      quality: params.quality,
      // L'aperçu IA reste baseline pour une compatibilité maximale. Les
      // variantes de publication utilisent MozJPEG afin de gagner du poids
      // sans modifier les dimensions ni le cadrage.
      mozjpeg: !providerSafe,
      progressive: !providerSafe,
      chromaSubsampling: "4:2:0",
      optimiseCoding: true,
      optimiseScans: !providerSafe,
    })
    .toBuffer({ resolveWithObject: true });
  const sha256 = outputSha256(rendered.data);

  return {
    purpose: params.purpose,
    buffer: rendered.data,
    mimeType: "image/jpeg" as const,
    extension: "jpg" as const,
    width: rendered.info.width,
    height: rendered.info.height,
    sizeBytes: rendered.info.size,
    transformSpec: {
      operation: "normalize_image",
      fit: "inside",
      max_side: params.maxSide,
      without_enlargement: true,
      auto_orient: true,
      crop: false,
      flatten_background: "#ffffff",
      output: "jpeg",
      quality: params.quality,
      colourspace: "srgb",
      progressive: !providerSafe,
      mozjpeg: !providerSafe,
      ...(providerSafe ? { ai_provider_safe_version: 1 } : {}),
      metadata_stripped: true,
    },
    metadata: {
      ...params.sourceMetadata,
      output_sha256: sha256,
      output_format: "jpeg",
      ...(providerSafe ? { ai_provider_safe_version: 1 } : {}),
    },
  } satisfies NormalizedImageVariant;
}

async function renderCanonical(params: {
  input: SharpInput;
  hasAlpha: boolean;
  sourceMetadata: Record<string, unknown>;
}) {
  if (params.hasAlpha) {
    const rendered = await createBasePipeline(
      params.input,
      IMAGE_CANONICAL_MAX_SIDE,
    )
      .png({
        compressionLevel: 9,
        adaptiveFiltering: true,
        palette: false,
      })
      .toBuffer({ resolveWithObject: true });
    const sha256 = outputSha256(rendered.data);

    return {
      purpose: "canonical",
      buffer: rendered.data,
      mimeType: "image/png",
      extension: "png",
      width: rendered.info.width,
      height: rendered.info.height,
      sizeBytes: rendered.info.size,
      transformSpec: {
        operation: "normalize_image",
        fit: "inside",
        max_side: IMAGE_CANONICAL_MAX_SIDE,
        without_enlargement: true,
        auto_orient: true,
        crop: false,
        preserve_alpha: true,
        output: "png",
        colourspace: "srgb",
        metadata_stripped: true,
      },
      metadata: {
        ...params.sourceMetadata,
        output_sha256: sha256,
        output_format: "png",
      },
    } satisfies NormalizedImageVariant;
  }

  return await renderJpeg({
    input: params.input,
    purpose: "canonical",
    maxSide: IMAGE_CANONICAL_MAX_SIDE,
    quality: IMAGE_CANONICAL_JPEG_QUALITY,
    sourceMetadata: params.sourceMetadata,
  });
}

async function normalizeWithSharp(
  input: SharpInput,
  decoder: "sharp" | "heic-convert" | "bmp-js",
  purposes: readonly ImageNormalizationPurpose[],
): Promise<PartialNormalizedImageBundle> {
  const meta = await sharp(input, {
    failOn: "error",
    limitInputPixels: IMAGE_NORMALIZATION_MAX_INPUT_PIXELS,
    pages: 1,
  }).metadata();
  const oriented = getOrientedDimensions(meta);
  if (!oriented.width || !oriented.height) {
    throw new Error("image_dimensions_unavailable");
  }

  const pages = Math.max(1, Number(meta.pages || 1));
  const hasAlpha = Boolean(meta.hasAlpha);
  const sourceMetadata = {
    source_width: oriented.width,
    source_height: oriented.height,
    source_format: String(meta.format || "unknown"),
    source_has_alpha: hasAlpha,
    source_pages: pages,
    source_orientation: meta.orientation || null,
    animated_source_flattened_to_first_frame: pages > 1,
    decoder,
  };

  const requested = new Set(purposes);
  const entries = await Promise.all(
    [...requested].map(async (purpose) => {
      if (purpose === "canonical") {
        return [
          purpose,
          await renderCanonical({ input, hasAlpha, sourceMetadata }),
        ] as const;
      }
      if (purpose === "ai_preview") {
        return [
          purpose,
          await renderJpeg({
            input,
            purpose,
            maxSide: IMAGE_AI_PREVIEW_MAX_SIDE,
            quality: IMAGE_AI_PREVIEW_JPEG_QUALITY,
            sourceMetadata,
          }),
        ] as const;
      }
      return [
        purpose,
        await renderJpeg({
          input,
          purpose: "thumbnail",
          maxSide: IMAGE_THUMBNAIL_MAX_SIDE,
          quality: IMAGE_THUMBNAIL_JPEG_QUALITY,
          sourceMetadata,
        }),
      ] as const;
    }),
  );

  return {
    source: {
      probeProvenance: "server_sharp",
      width: oriented.width,
      height: oriented.height,
      format: String(meta.format || "unknown"),
      hasAlpha,
      pages,
      orientation: meta.orientation || null,
      decoder,
    },
    variants: Object.fromEntries(entries),
  };
}

async function readSharpInput(input: SharpInput) {
  return typeof input === "string" ? await readFile(input) : input;
}

async function convertHeicSource(source: SharpInput) {
  const input = await readSharpInput(source);
  if (input.byteLength > IMAGE_NORMALIZATION_HEIC_FALLBACK_MAX_BYTES) {
    throw new Error("heic_fallback_source_too_large");
  }
  const converted = await heicConvert({
    buffer: input,
    format: "JPEG",
    quality: 0.94,
  });
  const buffer = Buffer.from(converted);
  if (!buffer.byteLength) throw new Error("heic_conversion_empty");
  return buffer;
}

async function convertBmpSource(source: SharpInput) {
  const input = await readSharpInput(source);
  if (input.byteLength > IMAGE_NORMALIZATION_BMP_FALLBACK_MAX_BYTES) {
    throw new Error("bmp_fallback_source_too_large");
  }
  if (
    input.byteLength < 54 ||
    input.toString("ascii", 0, 2) !== "BM" ||
    input.readUInt32LE(14) < 40
  ) {
    throw new Error("bmp_header_invalid");
  }

  const declaredWidth = input.readInt32LE(18);
  const declaredHeight = Math.abs(input.readInt32LE(22));
  const declaredPixels = declaredWidth * declaredHeight;
  if (
    declaredWidth <= 0 ||
    declaredHeight <= 0 ||
    !Number.isSafeInteger(declaredPixels) ||
    declaredPixels > IMAGE_NORMALIZATION_BMP_MAX_INPUT_PIXELS
  ) {
    throw new Error("bmp_dimensions_unsafe");
  }

  const decoded = bmp.decode(input);
  const width = Number(decoded.width || 0);
  const height = Number(decoded.height || 0);
  const pixelCount = width * height;
  if (
    width !== declaredWidth ||
    height !== declaredHeight ||
    !Number.isSafeInteger(pixelCount) ||
    pixelCount <= 0 ||
    pixelCount > IMAGE_NORMALIZATION_BMP_MAX_INPUT_PIXELS ||
    decoded.data.byteLength !== pixelCount * 4
  ) {
    throw new Error("bmp_decode_dimensions_invalid");
  }

  let meaningfulAlpha = false;
  if (decoded.bitPP === 32) {
    for (let offset = 0; offset < decoded.data.length; offset += 4) {
      if (decoded.data[offset] !== 0) {
        meaningfulAlpha = true;
        break;
      }
    }
  }

  const channels: 3 | 4 = meaningfulAlpha ? 4 : 3;
  const pixels = Buffer.allocUnsafe(pixelCount * channels);
  for (
    let sourceOffset = 0, targetOffset = 0;
    sourceOffset < decoded.data.length;
    sourceOffset += 4, targetOffset += channels
  ) {
    pixels[targetOffset] = decoded.data[sourceOffset + 3];
    pixels[targetOffset + 1] = decoded.data[sourceOffset + 2];
    pixels[targetOffset + 2] = decoded.data[sourceOffset + 1];
    if (meaningfulAlpha) {
      pixels[targetOffset + 3] = decoded.data[sourceOffset];
    }
  }

  return await sharp(pixels, {
    raw: { width, height, channels },
    limitInputPixels: IMAGE_NORMALIZATION_BMP_MAX_INPUT_PIXELS,
  })
    .png({ compressionLevel: 6, adaptiveFiltering: true })
    .toBuffer();
}

async function normalizeImageInput(params: {
  input: SharpInput;
  mimeType: string;
  originalFileName?: string | null;
  purposes: readonly ImageNormalizationPurpose[];
}) {
  try {
    return await normalizeWithSharp(params.input, "sharp", params.purposes);
  } catch (sharpError) {
    if (isHeicMimeOrName(params.mimeType, params.originalFileName || "")) {
      const converted = await convertHeicSource(params.input);
      return await normalizeWithSharp(
        converted,
        "heic-convert",
        params.purposes,
      );
    }
    if (isBmpMimeOrName(params.mimeType, params.originalFileName || "")) {
      const converted = await convertBmpSource(params.input);
      return await normalizeWithSharp(converted, "bmp-js", params.purposes);
    }
    throw sharpError;
  }
}

export async function normalizeImageSourcePurposes(params: {
  inputPath: string;
  mimeType: string;
  originalFileName?: string | null;
  purposes: readonly ImageNormalizationPurpose[];
}) {
  return await normalizeImageInput({
    input: params.inputPath,
    mimeType: params.mimeType,
    originalFileName: params.originalFileName,
    purposes: params.purposes,
  });
}

export async function normalizeImageSource(params: {
  inputPath: string;
  mimeType: string;
  originalFileName?: string | null;
}) {
  return (await normalizeImageInput({
    input: params.inputPath,
    mimeType: params.mimeType,
    originalFileName: params.originalFileName,
    purposes: ["canonical", "ai_preview", "thumbnail"],
  })) as NormalizedImageBundle;
}

/**
 * Même normalisation que le worker, sans fichier temporaire. Elle sert au
 * contrôle/rattrapage à la lecture des variantes créées avant le correctif
 * binaire.
 */
export async function normalizeImageBuffer(params: {
  buffer: Buffer;
  mimeType: string;
  originalFileName?: string | null;
}) {
  return (await normalizeImageInput({
    input: params.buffer,
    mimeType: params.mimeType,
    originalFileName: params.originalFileName,
    purposes: ["canonical", "ai_preview", "thumbnail"],
  })) as NormalizedImageBundle;
}

export async function normalizeImageThumbnailBuffer(params: {
  buffer: Buffer;
  mimeType: string;
  originalFileName?: string | null;
}) {
  const normalized = await normalizeImageInput({
    input: params.buffer,
    mimeType: params.mimeType,
    originalFileName: params.originalFileName,
    purposes: ["thumbnail"],
  });
  const thumbnail = normalized.variants.thumbnail;
  if (!thumbnail) throw new Error("image_thumbnail_missing");
  return { source: normalized.source, thumbnail };
}

/**
 * Produit uniquement la copie JPEG destinée à un moteur IA. Cette variante
 * légère évite de calculer et de conserver les rendus de publication lorsqu'une
 * photo sert seulement de référence d'identité éphémère.
 */
export async function normalizeImageAiPreviewBuffer(params: {
  buffer: Buffer;
  mimeType: string;
  originalFileName?: string | null;
}) {
  const normalized = await normalizeImageInput({
    input: params.buffer,
    mimeType: params.mimeType,
    originalFileName: params.originalFileName,
    purposes: ["ai_preview"],
  });
  const aiPreview = normalized.variants.ai_preview;
  if (!aiPreview) throw new Error("image_ai_preview_missing");
  return { source: normalized.source, aiPreview };
}
