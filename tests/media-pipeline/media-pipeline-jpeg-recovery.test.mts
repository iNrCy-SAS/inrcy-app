import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import sharp from "sharp";
import {
  normalizeImageBuffer,
  normalizeImageAiPreviewBuffer,
  normalizeImageThumbnailBuffer,
  normalizeImageSourcePurposes,
} from "../../lib/mediaImageNormalizer.ts";
import {
  assertImageFullyDecodes,
  IMAGE_JPEG_RECOVERY_MAX_SOURCE_BYTES,
  isTruncatedJpegError,
  recoverTruncatedJpeg,
} from "../../lib/mediaImageRecovery.ts";

const prematureEnd = new Error("VipsJpeg: premature end of JPEG image");

async function jpegFixture(orientation = 1) {
  const pixels = Buffer.alloc(96 * 64 * 3);
  for (let index = 0; index < pixels.length; index += 1) {
    pixels[index] = (index * 37 + Math.floor(index / 19) * 13) % 256;
  }
  return await sharp(pixels, { raw: { width: 96, height: 64, channels: 3 } })
    .withMetadata({ orientation })
    .jpeg({ quality: 90 })
    .toBuffer();
}

test("un JPEG sain garde le chemin normal sans indicateur de récupération", async () => {
  const buffer = await jpegFixture();
  const normalized = await normalizeImageBuffer({ buffer, mimeType: "image/jpeg" });
  assert.equal(normalized.source.recovery, undefined);
  assert.equal(normalized.source.requiresCanonical, undefined);
  assert.equal(normalized.source.format, "jpeg");
  assert.equal(normalized.source.width, 96);
  assert.equal(normalized.source.height, 64);
});

test("un JPEG tronqué est récupéré sans modifier l'original ni perdre sa provenance", async () => {
  const complete = await jpegFixture(6);
  const buffer = complete.subarray(0, complete.length - 80);
  const originalBytes = Buffer.from(buffer);
  await assert.rejects(sharp(buffer, { failOn: "error" }).raw().toBuffer(), /premature end/i);
  const normalized = await normalizeImageBuffer({
    buffer,
    // The bytes, not a user-supplied extension or MIME type, authorize recovery.
    mimeType: "application/octet-stream",
    originalFileName: "photo.bin",
  });
  assert.deepEqual(buffer, originalBytes);
  assert.deepEqual(normalized.source, {
    probeProvenance: "server_sharp",
    width: 64,
    height: 96,
    format: "jpeg",
    hasAlpha: false,
    pages: 1,
    orientation: 6,
    decoder: "sharp",
    recovery: { kind: "truncated_jpeg", version: 1, requiresReview: true },
    requiresCanonical: true,
  });
  for (const variant of Object.values(normalized.variants)) {
    assert.equal(variant.width, 64);
    assert.equal(variant.height, 96);
    assert.equal(variant.metadata.source_format, "jpeg");
    assert.equal(variant.metadata.source_orientation, 6);
    assert.equal(variant.metadata.source_requires_canonical, true);
    assert.deepEqual(variant.metadata.source_recovery, normalized.source.recovery);
    const decoded = await sharp(variant.buffer, { failOn: "warning" }).raw()
      .toBuffer({ resolveWithObject: true });
    assert.equal(decoded.info.width, 64);
    assert.equal(decoded.info.height, 96);
    assert.equal(decoded.data.length, 64 * 96 * 3);
  }
});

test("les préparations aperçu et miniature propagent aussi la récupération", async () => {
  const complete = await jpegFixture();
  const buffer = complete.subarray(0, complete.length - 24);
  const preview = await normalizeImageAiPreviewBuffer({ buffer, mimeType: "image/jpeg" });
  const thumbnail = await normalizeImageThumbnailBuffer({ buffer, mimeType: "image/jpeg" });
  assert.equal(preview.source.requiresCanonical, true);
  assert.equal(thumbnail.source.requiresCanonical, true);
  assert.equal(preview.aiPreview.metadata.source_requires_canonical, true);
  assert.equal(thumbnail.thumbnail.metadata.source_requires_canonical, true);
});

test("le worker peut récupérer un fichier en conservant ses octets et les variantes demandées", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "inrcy-jpeg-recovery-"));
  const inputPath = path.join(directory, "source.jpg");
  try {
    const complete = await jpegFixture();
    const truncated = complete.subarray(0, complete.length - 80);
    await writeFile(inputPath, truncated);
    const normalized = await normalizeImageSourcePurposes({
      inputPath,
      mimeType: "image/jpeg",
      purposes: ["canonical"],
    });
    assert.equal(normalized.source.requiresCanonical, true);
    assert.deepEqual(Object.keys(normalized.variants), ["canonical"]);
    assert.deepEqual(await readFile(inputPath), truncated);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("la vérification finale lit les pixels et refuse un JPEG dont seul l'en-tête est valide", async () => {
  const complete = await jpegFixture();
  const truncated = complete.subarray(0, complete.length - 80);
  const metadata = await sharp(truncated).metadata();
  assert.equal(metadata.width, 96);
  await assert.rejects(assertImageFullyDecodes(truncated, 96, 64), /premature end/i);
  await assert.rejects(assertImageFullyDecodes(complete, 95, 64), /dimensions_mismatch/);
});

test("le secours refuse un autre format et toute erreur de corruption non ciblée", async () => {
  const png = await sharp({ create: {
    width: 16, height: 16, channels: 3, background: "red",
  } }).png().toBuffer();
  assert.equal(await recoverTruncatedJpeg(png, prematureEnd), null);
  assert.equal(await recoverTruncatedJpeg(await jpegFixture(), new Error("unsupported image format")), null);
  assert.equal(isTruncatedJpegError(prematureEnd), true);
  assert.equal(isTruncatedJpegError(new Error(`${prematureEnd.message}\n${prematureEnd.message}`)), true);
  assert.equal(isTruncatedJpegError(new Error(`${prematureEnd.message}\nVipsJpeg: Bogus Huffman table definition`)), false);
  assert.equal(isTruncatedJpegError(new Error("VipsJpeg: Corrupt JPEG data: 10 extraneous bytes before marker")), false);
  await assert.rejects(normalizeImageBuffer({ buffer: png.subarray(0, 40), mimeType: "image/jpeg" }));
});

test("la récupération borne les octets et les dimensions avant le décodage permissif", async () => {
  await assert.rejects(
    recoverTruncatedJpeg(Buffer.alloc(IMAGE_JPEG_RECOVERY_MAX_SOURCE_BYTES + 1), prematureEnd),
    /image_recovery_source_too_large/,
  );
  const oversized = await jpegFixture();
  const frame = oversized.indexOf(Buffer.from([0xff, 0xc0]));
  assert.ok(frame > 0);
  oversized.writeUInt16BE(6000, frame + 5);
  oversized.writeUInt16BE(5000, frame + 7);
  await assert.rejects(recoverTruncatedJpeg(oversized, prematureEnd), /image_recovery_failed/);
  await assert.rejects(
    recoverTruncatedJpeg(Buffer.from([0xff, 0xd8, 0xff, 0xe1]), prematureEnd),
    /image_recovery_failed/,
  );
});
