import assert from "node:assert/strict";
import test from "node:test";

import {
  compactInrAgentScheduledPayload,
  containsInlineInrAgentScheduledMedia,
} from "../../lib/inrAgentScheduledPayload.ts";

const INLINE_IMAGE = `data:image/jpeg;base64,${"a".repeat(12_000)}`;

test("scheduled payload compaction promotes a nested Storage identity", () => {
  const compacted = compactInrAgentScheduledPayload(
    {
      media: {
        imageKey: "hero",
        dataUrl: INLINE_IMAGE,
        publicUrl: INLINE_IMAGE,
        imageMeta: {
          bucket: "booster",
          storagePath: "account/agent-channel-images/hero/output.jpg",
        },
      },
    },
    {
      storageUrl: (bucket, storagePath) =>
        `https://app.inrcy.test/storage/${bucket}/${storagePath}`,
    },
  );

  const media = compacted.media as Record<string, unknown>;
  assert.equal(media.dataUrl, undefined);
  assert.equal(media.bucket, "booster");
  assert.equal(
    media.storagePath,
    "account/agent-channel-images/hero/output.jpg",
  );
  assert.equal(
    media.publicUrl,
    "https://app.inrcy.test/storage/booster/account/agent-channel-images/hero/output.jpg",
  );
  assert.equal(containsInlineInrAgentScheduledMedia(compacted), false);
});

test("a durable channel variant removes the matching inline source copy", () => {
  const compacted = compactInrAgentScheduledPayload({
    publishPayload: {
      images: [
        {
          imageKey: "image-1",
          dataUrl: INLINE_IMAGE,
          type: "image/jpeg",
        },
      ],
      imagesByChannel: {
        instagram: [
          {
            imageKey: "image-1",
            bucket: "booster",
            storagePath: "account/agent-channel-images/image-1/instagram/a.jpg",
            publicUrl: "https://cdn.example.test/a.jpg",
          },
        ],
      },
    },
  });

  const publishPayload = compacted.publishPayload as Record<string, unknown>;
  const source = (publishPayload.images as Array<Record<string, unknown>>)[0]!;
  assert.equal(source.dataUrl, undefined);
  assert.equal(source.bucket, "booster");
  assert.equal(
    source.storagePath,
    "account/agent-channel-images/image-1/instagram/a.jpg",
  );
  assert.equal(source.publicUrl, "https://cdn.example.test/a.jpg");
  assert.equal(containsInlineInrAgentScheduledMedia(compacted), false);
});

test("an unresolved inline image is preserved instead of being corrupted", () => {
  const payload = {
    media: { imageKey: "inline-only", dataUrl: INLINE_IMAGE },
  };
  const compacted = compactInrAgentScheduledPayload(payload);

  assert.equal(compacted.media.dataUrl, INLINE_IMAGE);
  assert.equal(containsInlineInrAgentScheduledMedia(compacted), true);
});
