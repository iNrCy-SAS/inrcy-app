import assert from "node:assert/strict";
import test from "node:test";

import {
  UNIVERSAL_MEDIA_STANDARD_UPLOAD_MAX_BYTES,
  UNIVERSAL_MEDIA_TUS_CHUNK_SIZE_BYTES,
  buildDirectStorageResumableEndpoint,
  detectUniversalUploadMediaType,
  getUniversalMediaContentType,
  getUniversalMediaProductMaxBytes,
  getUniversalMediaProductMaxLabel,
  selectUniversalMediaUploadProtocol,
  targetAcceptsUniversalMediaType,
} from "../../lib/mediaUploadPolicy.ts";

test("le transport standard reste réservé aux fichiers de 6 Mo ou moins", () => {
  assert.equal(UNIVERSAL_MEDIA_STANDARD_UPLOAD_MAX_BYTES, 6 * 1024 * 1024);
  assert.equal(UNIVERSAL_MEDIA_TUS_CHUNK_SIZE_BYTES, 6 * 1024 * 1024);
  assert.equal(
    selectUniversalMediaUploadProtocol(UNIVERSAL_MEDIA_STANDARD_UPLOAD_MAX_BYTES),
    "signed",
  );
  assert.equal(
    selectUniversalMediaUploadProtocol(
      UNIVERSAL_MEDIA_STANDARD_UPLOAD_MAX_BYTES + 1,
    ),
    "tus",
  );
});

test("les formats courants sont reconnus même lorsque le navigateur fournit peu de MIME", () => {
  assert.equal(
    detectUniversalUploadMediaType({ name: "photo.HEIC", mimeType: "" }),
    "image",
  );
  assert.equal(
    detectUniversalUploadMediaType({ name: "visite.MKV", mimeType: "" }),
    "video",
  );
  assert.equal(
    detectUniversalUploadMediaType({ name: "photo.JFIF", mimeType: "" }),
    "image",
  );
  assert.equal(
    detectUniversalUploadMediaType({ name: "camera.MTS", mimeType: "" }),
    "video",
  );
  assert.equal(
    detectUniversalUploadMediaType({ name: "sans-extension", mimeType: "video/mp4" }),
    "video",
  );
  assert.equal(
    getUniversalMediaContentType({
      name: "clip.mov",
      mimeType: "",
      mediaType: "video",
    }),
    "video/quicktime",
  );
  assert.equal(
    getUniversalMediaContentType({
      name: "camera.m2ts",
      mimeType: "",
      mediaType: "video",
    }),
    "video/mp2t",
  );
});


test("les plafonds produit sont alignés sur Booster", () => {
  assert.equal(getUniversalMediaProductMaxBytes("image"), 50 * 1024 * 1024);
  assert.equal(getUniversalMediaProductMaxLabel("image"), "50 Mo");
  assert.equal(getUniversalMediaProductMaxBytes("video"), 75_000_000);
  assert.equal(getUniversalMediaProductMaxLabel("video"), "75 Mo");
});

test("les destinations n'acceptent jamais un type incohérent", () => {
  assert.equal(
    targetAcceptsUniversalMediaType("booster_prepared_image", "image"),
    true,
  );
  assert.equal(
    targetAcceptsUniversalMediaType("booster_prepared_image", "video"),
    false,
  );
  assert.equal(
    targetAcceptsUniversalMediaType("booster_video_source", "video"),
    true,
  );
  assert.equal(
    targetAcceptsUniversalMediaType("booster_video_source", "image"),
    false,
  );
  assert.equal(targetAcceptsUniversalMediaType("workspace_source", "image"), true);
  assert.equal(targetAcceptsUniversalMediaType("workspace_source", "video"), true);
  assert.equal(
    targetAcceptsUniversalMediaType("ai_identity_reference", "image"),
    true,
  );
  assert.equal(
    targetAcceptsUniversalMediaType("ai_identity_reference", "video"),
    false,
  );
});

test("l'endpoint TUS utilise le hostname Storage direct du projet", () => {
  assert.equal(
    buildDirectStorageResumableEndpoint("https://abcxyz.supabase.co"),
    "https://abcxyz.storage.supabase.co/storage/v1/upload/resumable/sign",
  );
});
