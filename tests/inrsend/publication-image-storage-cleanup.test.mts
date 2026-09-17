import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createPublicationImageUseGuard,
  removeCreatedPublicationImagePathsBestEffort,
} from "../../lib/inrsend/publicationImageStorageCleanup.ts";

function read(relativePath: string) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

test("le nettoyage Storage ne reçoit que les nouveaux chemins suivis", async () => {
  const calls: Array<{ bucket: string; paths: string[] }> = [];
  const client = {
    storage: {
      from: (bucket: string) => ({
        remove: async (paths: string[]) => {
          calls.push({ bucket, paths });
          return { error: null };
        },
      }),
    },
  };

  const result = await removeCreatedPublicationImagePathsBestEffort({
    client,
    paths: ["new/original.jpg", "", "new/instagram.jpg", "new/original.jpg"],
  });

  assert.deepEqual(result, {
    attemptedPaths: ["new/original.jpg", "new/instagram.jpg"],
    error: null,
  });
  assert.deepEqual(calls, [
    {
      bucket: "booster",
      paths: ["new/original.jpg", "new/instagram.jpg"],
    },
  ]);
  assert.equal(calls[0].paths.includes("persisted/old.jpg"), false);
});

test("un échec de nettoyage reste best-effort et ne masque pas l'erreur initiale", async () => {
  const result = await removeCreatedPublicationImagePathsBestEffort({
    client: {
      storage: {
        from: () => ({
          remove: async () => {
            throw new Error("storage unavailable");
          },
        }),
      },
    },
    paths: ["new/original.jpg"],
  });

  assert.deepEqual(result, {
    attemptedPaths: ["new/original.jpg"],
    error: "storage unavailable",
  });
});

test("une mutation externe ambiguë interdit définitivement le rollback Storage", () => {
  const guard = createPublicationImageUseGuard();
  assert.equal(guard.canCleanupUnusedAssets(), true);
  guard.markAssetsMayBeInUse();
  assert.equal(guard.canCleanupUnusedAssets(), false);
  guard.markAssetsMayBeInUse();
  assert.equal(guard.canCleanupUnusedAssets(), false);
});

test("iNrSend ne nettoie les nouveaux uploads qu'avant toute mutation susceptible de les utiliser", () => {
  const source = read("lib/inrsend/publicationChannelActions.ts");
  const genericStart = source.indexOf("async function uploadPublicationImages");
  const instagramStart = source.indexOf(
    "async function uploadInstagramPublicationImagesBestEffort",
  );
  const rebuildStart = source.indexOf(
    "async function rebuildGoogleBusinessImagesFromSources",
  );
  const patchStart = source.indexOf("  async function PATCH(");
  const deleteStart = source.indexOf("  async function DELETE(", patchStart);
  const replaceStart = source.indexOf("async function replaceChannelDelivery");
  const removeStart = source.indexOf("async function removeChannelDelivery");
  const payloadStart = source.indexOf("function buildUpdatedPayload");
  const payloadEnd = source.indexOf("function buildDeletedPayload", payloadStart);

  const genericUpload = source.slice(genericStart, instagramStart);
  const instagramUpload = source.slice(instagramStart, rebuildStart);
  const patchHandler = source.slice(patchStart, deleteStart);
  const replaceHandler = source.slice(replaceStart, removeStart);
  const payloadBuilder = source.slice(payloadStart, payloadEnd);

  assert.match(genericUpload, /createdStoragePaths\.push\(originalPath\)/);
  assert.match(genericUpload, /createdStoragePaths\.push\(instagramPath\)/);
  assert.match(genericUpload, /paths:\s*createdStoragePaths[\s\S]*?stage:\s*"image_preparation"/);

  assert.match(instagramUpload, /const createdForImage: string\[\] = \[\]/);
  assert.match(instagramUpload, /createdForImage\.push\(originalPath\)/);
  assert.match(instagramUpload, /createdForImage\.push\(instagramPath\)/);
  assert.match(instagramUpload, /paths:\s*createdForImage[\s\S]*?channel:\s*"instagram"/);
  assert.match(instagramUpload, /createdStoragePaths\.push\(\.\.\.createdForImage\)/);

  assert.match(
    patchHandler,
    /unpersistedCreatedStoragePaths\s*=\s*imageSet\?\.createdStoragePaths\s*\|\|\s*\[\]/,
  );
  assert.match(
    patchHandler,
    /onAssetsMayBeInUse:\s*imageUseGuard\.markAssetsMayBeInUse/,
  );
  assert.match(
    patchHandler,
    /catch \(e: unknown\)[\s\S]*?if \(imageUseGuard\.canCleanupUnusedAssets\(\)\)[\s\S]*?paths:\s*unpersistedCreatedStoragePaths[\s\S]*?stage:\s*"before_external_use"/,
  );
  assert.doesNotMatch(
    patchHandler,
    /await replaceChannelDelivery\([\s\S]*?unpersistedCreatedStoragePaths\s*=\s*\[\]/,
  );
  const persistIndex = patchHandler.indexOf("await persistEventPayload(");
  const persistedMarkIndex = patchHandler.indexOf(
    "imageUseGuard.markAssetsMayBeInUse();",
    persistIndex,
  );
  const syncIndex = patchHandler.indexOf("await syncDeliveryRow(", persistIndex);
  assert.ok(
    persistIndex >= 0 &&
      persistedMarkIndex > persistIndex &&
      syncIndex > persistedMarkIndex,
    "une persistance réussie doit protéger les médias avant les étapes suivantes",
  );

  assert.match(
    replaceHandler,
    /markAssetsMayBeInUse\(\);[\s\S]{0,300}?\.from\("site_articles"\)[\s\S]{0,100}?\.update\(/,
  );
  for (const externalWrite of [
    "facebookPublishVideoToPage",
    "facebookPublishToPage",
    "instagramPublishVideoWithTokenFallback",
    "instagramPublishImagesBestEffortWithTokenFallback",
    "linkedinPublishVideo",
    "linkedinPublishMultiImage",
    "linkedinPublishImage",
    "gmbCreateLocalPost",
    "createPinterestVideoPin",
    "createPinterestImagePin",
  ]) {
    const callIndex = replaceHandler.indexOf(`${externalWrite}(`);
    const markIndex = replaceHandler.lastIndexOf(
      "markAssetsMayBeInUse();",
      callIndex,
    );
    assert.ok(callIndex >= 0, `${externalWrite} doit rester couvert`);
    assert.ok(
      markIndex >= 0 && callIndex - markIndex < 500,
      `${externalWrite} doit désarmer le rollback juste avant son écriture`,
    );
  }
  assert.doesNotMatch(patchHandler, /paths:\s*retainedImages/);
  assert.doesNotMatch(payloadBuilder, /createdStoragePaths/);
});
