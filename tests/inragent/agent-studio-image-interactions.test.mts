import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { mediaPatchFromLibraryItem } from "../../app/dashboard/agent/_lib/agent.publish-media-foundations.ts";
import { imageInteractionsFromOverlay } from "../../lib/imageInteractions.ts";

const interactions = imageInteractionsFromOverlay({
  items: [
    {
      id: "details",
      text: "Voir les détails",
      linkUrl: "https://example.test/details",
      x: 42,
      y: 63,
      width: 36,
      height: 14,
    },
  ],
});

test("iNrAgent action patch keeps Studio links as interaction-only metadata", () => {
  const patch = mediaPatchFromLibraryItem({
    id: "studio-image",
    bucket_name: "inrcy-pro-media",
    storage_path: "account/studio-image.jpg",
    media_type: "image",
    mime_type: "image/jpeg",
    size_bytes: 123,
    title: "Studio image",
    tags: null,
    width: 1200,
    height: 800,
    duration_seconds: null,
    created_at: null,
    signed_url: "https://example.test/studio-image.jpg",
    image_interactions: interactions,
  });

  assert.deepEqual(patch.image_interactions, interactions);
  assert.deepEqual(patch.imageMeta?.interactions, interactions);
  assert.equal(patch.imageMeta?.ratio, 1.5);
  assert.equal("transform" in patch, false);
});

test("agent execution preserves interactions through every image source branch", () => {
  const draftFoundations = readFileSync(
    "app/api/agent/actions/actionPublishDraft.foundations.ts",
    "utf8",
  );
  const execute = readFileSync(
    "app/api/agent/actions/execute/route.ts",
    "utf8",
  );
  const preparation = readFileSync(
    "lib/boosterImageServerPreparation.ts",
    "utf8",
  );

  assert.match(
    draftFoundations,
    /getMediaImageInteractions\(record\)[\s\S]*?\{ imageMeta \}/,
  );
  assert.match(
    draftFoundations,
    /\{ image_interactions: imageInteractions \}/,
  );
  assert.match(
    execute,
    /normalizeImageInteractions\(imageMeta\.interactions\)[\s\S]*?getMediaImageInteractions\(media\)/,
  );
  assert.equal(
    (execute.match(/\.\.\.preservedImageMeta/g) || []).length,
    3,
  );
  assert.match(
    preparation,
    /imageMeta: mergeImageMeta\(entry\.image\.imageMeta, entry\.meta\)/,
  );
});
