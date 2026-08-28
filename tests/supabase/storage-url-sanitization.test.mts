import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  normalizeStorageDeliveryUrl,
  shouldUseRangeGetForStorageDeliveryUrl,
} from "../../lib/storageUrlSanitization.ts";

test("les URL Storage perdent uniquement les antislashs parasites de fin", () => {
  const base = "https://project.supabase.co/storage/v1/object/sign/booster/image.png?token=abc_DEF-123";

  assert.equal(normalizeStorageDeliveryUrl(`${base}\\`), base);
  assert.equal(normalizeStorageDeliveryUrl(`${base}%5C`), base);
  assert.equal(normalizeStorageDeliveryUrl(`${base}\\%5c`), base);
  assert.equal(
    normalizeStorageDeliveryUrl(`${base}&label=milieu%5Cvalide`),
    `${base}&label=milieu%5Cvalide`,
  );
});

test("détecte les URL privées à sonder avec un GET borné", () => {
  assert.equal(
    shouldUseRangeGetForStorageDeliveryUrl(
      "https://project.supabase.co/storage/v1/object/sign/booster/image.jpg?token=abc",
    ),
    true,
  );
  assert.equal(
    shouldUseRangeGetForStorageDeliveryUrl(
      "https://app.inrcy.com/api/storage/content?bucket=booster&path=image.jpg",
    ),
    true,
  );
  assert.equal(
    shouldUseRangeGetForStorageDeliveryUrl("https://cdn.example.test/image.jpg"),
    false,
  );
});

test("la normalisation couvre les signatures de lecture et d'upload", () => {
  const safeRead = readFileSync(
    new URL("../../lib/safeStorageSignedUrl.ts", import.meta.url),
    "utf8",
  );
  const signedUpload = readFileSync(
    new URL("../../lib/supabaseStorageUpload.ts", import.meta.url),
    "utf8",
  );

  assert.match(safeRead, /normalizeStorageDeliveryUrl\(data\.signedUrl\)/);
  assert.match(
    signedUpload,
    /normalizeStorageDeliveryUrl\(result\.data\.signedUrl\)/,
  );

  for (const relativePath of [
    "../../app/api/booster/video-upload-url/route.ts",
    "../../app/api/booster/transcription-upload-url/route.ts",
  ]) {
    const route = readFileSync(new URL(relativePath, import.meta.url), "utf8");
    assert.match(
      route,
      /normalizeStorageDeliveryUrl\(signed\.data\.signedUrl\)/,
    );
  }
});
