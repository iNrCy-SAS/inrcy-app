import sharp from "sharp";

import type { AiMediaInspirationImage } from "@/lib/aiMediaGenerationContracts";

export const AI_MEDIA_IDENTITY_REFERENCE_MAX_DIMENSION = 1_280;
export const AI_MEDIA_IDENTITY_REFERENCE_MAX_INPUT_PIXELS = 20_000_000;
export const AI_MEDIA_IDENTITY_REFERENCE_MAX_OUTPUT_BYTES = 2 * 1024 * 1024;

type SupportedIdentityReferenceFormat = "jpeg" | "png" | "webp";

const FORMAT_BY_MIME: Record<
  AiMediaInspirationImage["mimeType"],
  SupportedIdentityReferenceFormat
> = {
  "image/jpeg": "jpeg",
  "image/png": "png",
  "image/webp": "webp",
};

export class AiMediaIdentityReferenceValidationError extends Error {
  code = "ai_media_identity_reference_invalid" as const;

  constructor() {
    super(
      "Une photo de référence n’est pas exploitable. Utilisez une image JPG, PNG ou WebP nette et réessayez."
    );
    this.name = "AiMediaIdentityReferenceValidationError";
  }
}

function detectImageFormat(
  input: Buffer
): SupportedIdentityReferenceFormat | null {
  if (
    input.length >= 3 &&
    input[0] === 0xff &&
    input[1] === 0xd8 &&
    input[2] === 0xff
  ) {
    return "jpeg";
  }
  if (
    input.length >= 8 &&
    input
      .subarray(0, 8)
      .equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))
  ) {
    return "png";
  }
  if (
    input.length >= 12 &&
    input.toString("ascii", 0, 4) === "RIFF" &&
    input.toString("ascii", 8, 12) === "WEBP"
  ) {
    return "webp";
  }
  return null;
}

export type PreparedAiMediaIdentityReferences = {
  /** Buffers éphémères destinés au fournisseur image. */
  buffers: Buffer[];
  /** Même contenu assaini, destiné aux fournisseurs vidéo. */
  providerImages: AiMediaInspirationImage[];
};

/**
 * Valide les vrais octets (et pas seulement le MIME déclaré), borne le nombre
 * de pixels, applique l’orientation, redimensionne et réencode en WebP. Sharp
 * retire EXIF/IPTC/XMP/GPS par défaut tant que `withMetadata()` n’est pas
 * appelé. Les octets sources et les sorties restent exclusivement en mémoire.
 */
export async function prepareAiMediaIdentityReferences(
  images: readonly AiMediaInspirationImage[],
  options: { format?: "webp" | "png"; signal?: AbortSignal } = {},
): Promise<PreparedAiMediaIdentityReferences> {
  options.signal?.throwIfAborted();
  if (!images.length) return { buffers: [], providerImages: [] };
  const outputFormat = options.format || "webp";
  // PNG preserves every decoded pixel. Its worst-case size at the existing
  // 1280px bound is larger than WebP, within the private video input budget.
  const maxOutputBytes = outputFormat === "png" ? 20 * 1024 * 1024 : AI_MEDIA_IDENTITY_REFERENCE_MAX_OUTPUT_BYTES;

  try {
    const buffers = await Promise.all(
      images.map(async (image) => {
        options.signal?.throwIfAborted();
        const input = Buffer.from(image.data, "base64");
        if (input.byteLength < 48 || (outputFormat === "png" && input.byteLength > 20 * 1024 * 1024)) {
          throw new AiMediaIdentityReferenceValidationError();
        }

        const detectedFormat = detectImageFormat(input);
        const declaredFormat = FORMAT_BY_MIME[image.mimeType];
        if (!detectedFormat || detectedFormat !== declaredFormat) {
          throw new AiMediaIdentityReferenceValidationError();
        }

        const source = sharp(input, {
          failOn: "error",
          limitInputPixels: AI_MEDIA_IDENTITY_REFERENCE_MAX_INPUT_PIXELS,
          pages: 1,
          sequentialRead: true,
        });
        const metadata = await source.metadata();
        if (
          !metadata.width ||
          !metadata.height ||
          metadata.format !== detectedFormat ||
          (metadata.pages || 1) !== 1 ||
          metadata.width >
            Math.floor(
              AI_MEDIA_IDENTITY_REFERENCE_MAX_INPUT_PIXELS / metadata.height
            )
        ) {
          throw new AiMediaIdentityReferenceValidationError();
        }

        const normalized = source
          .rotate()
          .resize({
            width: AI_MEDIA_IDENTITY_REFERENCE_MAX_DIMENSION,
            height: AI_MEDIA_IDENTITY_REFERENCE_MAX_DIMENSION,
            fit: "inside",
            withoutEnlargement: true,
          });
        const { data, info } = await (outputFormat === "png"
          ? normalized.png({ compressionLevel: 9 })
          : normalized.webp({ quality: 90, effort: 4 }))
          .toBuffer({ resolveWithObject: true });
        options.signal?.throwIfAborted();

        if (
          !data.byteLength ||
          data.byteLength > maxOutputBytes ||
          info.format !== outputFormat ||
          info.width > AI_MEDIA_IDENTITY_REFERENCE_MAX_DIMENSION ||
          info.height > AI_MEDIA_IDENTITY_REFERENCE_MAX_DIMENSION
        ) {
          throw new AiMediaIdentityReferenceValidationError();
        }
        return { data, image };
      })
    );

    return {
      buffers: buffers.map(({ data }) => data),
      providerImages: buffers.map(({ data, image }) => ({
        mimeType: outputFormat === "png" ? "image/png" as const : "image/webp" as const,
        data: data.toString("base64"),
        ...(image.role ? { role: image.role } : {}),
        ...(image.usage ? { usage: image.usage } : {}),
        ...(image.characterIndex
          ? { characterIndex: image.characterIndex }
          : {}),
        ...(image.voiceMode ? { voiceMode: image.voiceMode } : {}),
        ...(image.voiceMode === "provided" && image.voiceSample
          ? { voiceSample: { ...image.voiceSample } }
          : {}),
      })),
    };
  } catch (error) {
    options.signal?.throwIfAborted();
    if (error instanceof AiMediaIdentityReferenceValidationError) throw error;
    throw new AiMediaIdentityReferenceValidationError();
  }
}

/** Google Gateway first frames require actual JPEG/PNG bytes, not WebP relabelled as PNG. */
export async function prepareGoogleAiVideoReferenceImages(
  images: readonly AiMediaInspirationImage[],
  signal?: AbortSignal,
): Promise<AiMediaInspirationImage[]> {
  return (await prepareAiMediaIdentityReferences(images, { format: "png", signal })).providerImages;
}
