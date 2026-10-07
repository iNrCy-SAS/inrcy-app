import { readFile, stat } from "node:fs/promises";
import sharp, { type Metadata } from "sharp";

// Recovery needs a complete decoded image in memory, unlike normal JPEG
// shrink-on-load. Keep its resource budget lower than the ordinary pipeline.
export const IMAGE_JPEG_RECOVERY_MAX_SOURCE_BYTES = 50 * 1024 * 1024;
export const IMAGE_JPEG_RECOVERY_MAX_INPUT_PIXELS = 25_000_000;

export type ImageSourceRecovery = {
  kind: "truncated_jpeg";
  version: 1;
  requiresReview: true;
};

export function isTruncatedJpegError(error: unknown) {
  if (!(error instanceof Error)) return false;
  const lines = error.message.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  return lines.length > 0 && lines.every((line) =>
    /^VipsJpeg: (?:premature end of JPEG image|Corrupt JPEG data: premature end of data segment)$/i.test(line),
  );
}

/** Metadata probing does not consume JPEG scan data. Validate every pixel. */
export async function assertImageFullyDecodes(
  buffer: Buffer,
  width: number,
  height: number,
) {
  const decoded = await sharp(buffer, {
    failOn: "warning",
    limitInputPixels: IMAGE_JPEG_RECOVERY_MAX_INPUT_PIXELS,
    pages: 1,
  }).raw().toBuffer({ resolveWithObject: true });
  if (decoded.info.width !== width || decoded.info.height !== height) {
    throw new Error("image_recovery_dimensions_mismatch");
  }
}

/**
 * Decode only the known truncated-JPEG failure once, into a new lossless
 * intermediate. Missing pixels are not restored; consumers must show review
 * information and must never select the damaged original for publication.
 */
export async function recoverTruncatedJpeg(
  input: string | Buffer,
  originalError: unknown,
): Promise<{ buffer: Buffer; metadata: Metadata } | null> {
  if (!isTruncatedJpegError(originalError)) return null;
  const size = typeof input === "string" ? (await stat(input)).size : input.byteLength;
  if (size > IMAGE_JPEG_RECOVERY_MAX_SOURCE_BYTES) {
    throw new Error("image_recovery_source_too_large");
  }
  const bytes = typeof input === "string" ? await readFile(input) : input;
  if (bytes.byteLength > IMAGE_JPEG_RECOVERY_MAX_SOURCE_BYTES) {
    throw new Error("image_recovery_source_too_large");
  }
  if (bytes.length < 3 || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[2] !== 0xff) {
    return null;
  }

  try {
    const metadata = await sharp(bytes, {
      failOn: "error",
      limitInputPixels: IMAGE_JPEG_RECOVERY_MAX_INPUT_PIXELS,
      pages: 1,
    }).metadata();
    const pixels = Number(metadata.width || 0) * Number(metadata.height || 0);
    if (metadata.format !== "jpeg" || !Number.isSafeInteger(pixels) || pixels <= 0 ||
      pixels > IMAGE_JPEG_RECOVERY_MAX_INPUT_PIXELS || Number(metadata.pages || 1) !== 1) {
      throw new Error("image_recovery_source_invalid");
    }

    const warnings: string[] = [];
    const recovered = await sharp(bytes, {
      failOn: "none",
      limitInputPixels: IMAGE_JPEG_RECOVERY_MAX_INPUT_PIXELS,
      pages: 1,
    })
      .on("warning", (warning: string) => warnings.push(warning))
      .rotate()
      .toColourspace("srgb")
      .png({ compressionLevel: 1 })
      .toBuffer({ resolveWithObject: true });
    if (warnings.some((warning) => !isTruncatedJpegError(new Error(warning)))) {
      throw new Error("image_recovery_unexpected_warning");
    }
    await assertImageFullyDecodes(recovered.data, recovered.info.width, recovered.info.height);
    return { buffer: recovered.data, metadata };
  } catch (cause) {
    throw new Error("image_recovery_failed", { cause });
  }
}
