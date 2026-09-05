import assert from "node:assert/strict";
import test from "node:test";

import sharp from "sharp";

import {
  AiMediaRequestValidationError,
  normalizeAiMediaGenerationRequest,
} from "../../lib/aiMediaGenerationContracts.ts";
import {
  AI_MEDIA_IDENTITY_REFERENCE_MAX_DIMENSION,
  AiMediaIdentityReferenceValidationError,
  prepareAiMediaIdentityReferences,
} from "../../lib/aiMediaIdentityReferences.ts";
import {
  normalizeAiMediaGeneratorPreferences,
  serializeAiMediaGeneratorPreferences,
} from "../../lib/aiMediaGenerationPreferences.ts";
import {
  redactAiMediaSensitiveText,
  safeAiMediaErrorMessage,
} from "../../lib/aiMediaSensitiveText.ts";

const BASE_REQUEST = {
  requestId: "media-runtime-contract-0001",
  kind: "image",
  source: "studio",
  subjectSource: "profile",
};

async function encodedImage(
  format: "jpeg" | "png" | "webp",
  width = 96,
  height = 72,
) {
  const pipeline = sharp({
    create: {
      width,
      height,
      channels: 4,
      background: { r: 36, g: 112, b: 194, alpha: 0.7 },
    },
  });
  const buffer =
    format === "jpeg"
      ? await pipeline.jpeg({ quality: 88 }).toBuffer()
      : format === "png"
        ? await pipeline.png().toBuffer()
        : await pipeline.webp({ quality: 88 }).toBuffer();
  return {
    mimeType: `image/${format}` as "image/jpeg" | "image/png" | "image/webp",
    data: buffer.toString("base64"),
  };
}

test("le contrat exécutable impose consentement, mode et limite de trois références", async () => {
  const reference = await encodedImage("jpeg");
  const referenceSetId = "identity-1757023445123-abcdefghij";

  const one = normalizeAiMediaGenerationRequest({
    ...BASE_REQUEST,
    peopleMode: "solo",
    identityMode: "professional",
    identityConsent: true,
    identityReferenceSetId: referenceSetId,
    inspirationImages: [reference],
  });
  assert.equal(one.identityMode, "professional");
  assert.equal(one.identityConsent, true);
  assert.equal(one.inspirationImages.length, 1);

  const three = normalizeAiMediaGenerationRequest({
    ...BASE_REQUEST,
    kind: "video",
    peopleMode: "team",
    identityMode: "brand_avatar",
    identityConsent: true,
    identityReferenceSetId: referenceSetId,
    inspirationImages: [reference, reference, reference],
  });
  assert.equal(three.inspirationImages.length, 3);
  assert.equal(three.videoCharacterMode, "brand_avatar");

  assert.throws(
    () =>
      normalizeAiMediaGenerationRequest({
        ...BASE_REQUEST,
        peopleMode: "solo",
        identityMode: "professional",
        identityConsent: false,
        inspirationImages: [reference],
      }),
    AiMediaRequestValidationError,
  );
  assert.throws(
    () =>
      normalizeAiMediaGenerationRequest({
        ...BASE_REQUEST,
        peopleMode: "solo",
        identityMode: "professional",
        identityConsent: true,
        inspirationImages: [],
      }),
    AiMediaRequestValidationError,
  );
  assert.throws(
    () =>
      normalizeAiMediaGenerationRequest({
        ...BASE_REQUEST,
        peopleMode: "team",
        identityMode: "brand_avatar",
        identityConsent: true,
        inspirationImages: [],
      }),
    AiMediaRequestValidationError,
  );
  assert.throws(
    () =>
      normalizeAiMediaGenerationRequest({
        ...BASE_REQUEST,
        peopleMode: "auto",
        identityMode: "auto",
        identityConsent: true,
        inspirationImages: [reference, reference, reference, reference],
      }),
    AiMediaRequestValidationError,
  );

  const withoutPeople = normalizeAiMediaGenerationRequest({
    ...BASE_REQUEST,
    peopleMode: "none",
    identityMode: "professional",
    identityConsent: true,
    identityReferenceSetId: referenceSetId,
    inspirationImages: [reference],
  });
  assert.equal(withoutPeople.identityMode, "auto");
  assert.equal(withoutPeople.identityConsent, false);
  assert.equal(withoutPeople.identityReferenceSetId, "");
  assert.deepEqual(withoutPeople.inspirationImages, []);
});

test("Sharp valide les vrais octets, borne les dimensions et retire EXIF/GPS", async () => {
  const jpegWithMetadata = await sharp({
    create: {
      width: 1_920,
      height: 1_080,
      channels: 3,
      background: { r: 182, g: 71, b: 96 },
    },
  })
    .jpeg({ quality: 90 })
    .withMetadata({ orientation: 6 })
    .toBuffer();
  const png = await encodedImage("png");
  const webp = await encodedImage("webp");

  const prepared = await prepareAiMediaIdentityReferences([
    { mimeType: "image/jpeg", data: jpegWithMetadata.toString("base64") },
    png,
    webp,
  ]);
  assert.equal(prepared.buffers.length, 3);
  assert.equal(prepared.providerImages.length, 3);

  for (const [index, buffer] of prepared.buffers.entries()) {
    const metadata = await sharp(buffer).metadata();
    assert.equal(metadata.format, "webp");
    assert.ok((metadata.width || 0) <= AI_MEDIA_IDENTITY_REFERENCE_MAX_DIMENSION);
    assert.ok((metadata.height || 0) <= AI_MEDIA_IDENTITY_REFERENCE_MAX_DIMENSION);
    assert.equal(metadata.exif, undefined);
    assert.equal(metadata.icc, undefined);
    assert.equal(metadata.xmp, undefined);
    assert.equal(metadata.orientation, undefined);
    assert.equal(prepared.providerImages[index].mimeType, "image/webp");
    assert.equal(
      Buffer.from(prepared.providerImages[index].data, "base64").equals(buffer),
      true,
    );
  }
});

test("la préparation serveur rejette MIME usurpé, octets arbitraires et bombe de pixels", async () => {
  const jpeg = await encodedImage("jpeg");
  await assert.rejects(
    prepareAiMediaIdentityReferences([
      { mimeType: "image/png", data: jpeg.data },
    ]),
    AiMediaIdentityReferenceValidationError,
  );
  await assert.rejects(
    prepareAiMediaIdentityReferences([
      {
        mimeType: "image/jpeg",
        data: Buffer.alloc(256, 65).toString("base64"),
      },
    ]),
    AiMediaIdentityReferenceValidationError,
  );

  const tooManyPixels = await sharp({
    create: {
      width: 4_473,
      height: 4_473,
      channels: 3,
      background: { r: 12, g: 34, b: 56 },
    },
  })
    .png({ compressionLevel: 9 })
    .toBuffer();
  await assert.rejects(
    prepareAiMediaIdentityReferences([
      { mimeType: "image/png", data: tooManyPixels.toString("base64") },
    ]),
    AiMediaIdentityReferenceValidationError,
  );
});

test("les préférences ne sérialisent jamais photo, consentement ou identifiant de référence", () => {
  const marker = Buffer.alloc(512, 90).toString("base64");
  const normalized = normalizeAiMediaGeneratorPreferences({
    version: 1,
    blocks: {
      5: {
        saved: true,
        defaults: {
          peopleMode: "solo",
          identityMode: "professional",
          identityConsent: true,
          identityReferenceSetId: "identity-secret",
          inspirationImages: [{ mimeType: "image/jpeg", data: marker }],
        },
      },
    },
  });
  const serialized = JSON.stringify(
    serializeAiMediaGeneratorPreferences(normalized),
  );
  assert.deepEqual(normalized.blocks[5].defaults, {
    peopleMode: "solo",
    identityMode: "professional",
    teamVideoMode: "montage",
    teamVideoSpeechMode: "voiceover",
  });
  assert.doesNotMatch(serialized, /identityConsent|identityReferenceSetId|inspirationImages/);
  assert.equal(serialized.includes(marker), false);
});

test("les erreurs persistables et observables expurgent data URL et base64 nu", () => {
  const payload = Buffer.alloc(2_048, 77).toString("base64");
  const dataUrl = `data:image/jpeg;base64,${payload}`;
  const samples = [
    new Error(`provider rejected ${dataUrl} after validation`),
    JSON.stringify({ imageBytes: payload, reason: "invalid" }),
    `raw binary ${payload} end`,
  ];

  for (const sample of samples) {
    const redacted = redactAiMediaSensitiveText(sample, 4_000);
    assert.match(redacted, /media-reference-redacted/);
    assert.equal(redacted.includes(payload.slice(0, 128)), false);
    assert.equal(redacted.includes("data:image"), false);
  }

  const safe = safeAiMediaErrorMessage(new Error(`failure:${dataUrl}`), 1_000);
  assert.equal(safe.includes(payload.slice(0, 128)), false);
  assert.match(safe, /media-reference-redacted/);
});
