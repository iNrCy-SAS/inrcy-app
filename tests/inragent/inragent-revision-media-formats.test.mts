import assert from "node:assert/strict";
import test from "node:test";
import { runtimeModules } from "./runtime-module-loader.mts";

test("la revalidation conserve le média régénéré du canal et les variantes des autres canaux", async () => {
  const oldImage = { id: "old", url: "https://media.test/old", kind: "image" };
  const newImage = { id: "new-facebook", url: "https://media.test/new", kind: "image" };
  const oldVariants = { version: 1, kind: "image", defaultFormat: "portrait", byFormat: { portrait: [oldImage] } };
  const newVariants = { version: 1, kind: "image", defaultFormat: "portrait", byFormat: { portrait: [newImage] } };
  const payload = { mediaFormatVariants: oldVariants,
    mediaFormatVariantsByChannel: { facebook: newVariants },
    imagesByChannel: { facebook: [newImage], instagram: [oldImage] },
    imagesByPlacement: { facebook: { classic: [newImage] }, instagram: { classic: [oldImage] } },
    mediaModeByChannel: { facebook: "images", instagram: "images" },
    postByChannel: { facebook: { content: "Facebook" }, instagram: { content: "Instagram" } },
  };
  const snapshot = structuredClone(payload);
  const load = runtimeModules({ "@/lib/mediaLibraryContentUrl": { buildMediaLibraryContentUrl: () => { throw new Error("No generation expected"); } } });
  const { ensureInrAgentMediaFormats } = load<{ ensureInrAgentMediaFormats: (args: Record<string, unknown>) => Promise<{ payload: typeof payload; createdFormats: string[] }> }>("lib/inrAgentMediaFormatGeneration.ts");
  const saved = await ensureInrAgentMediaFormats({ supabase: {}, accountId: "account", actorAuthUserId: "actor", actionId: "source",
    payload, channels: ["facebook", "instagram"], allowGeneration: false });
  assert.equal(saved.payload.imagesByChannel.facebook[0].id, newImage.id);
  assert.equal(saved.payload.imagesByChannel.instagram[0].id, oldImage.id);
  assert.equal(saved.payload.imagesByPlacement.facebook.classic[0].id, newImage.id);
  assert.equal(saved.payload.imagesByPlacement.instagram.classic[0].id, oldImage.id);
  assert.deepEqual(saved.payload.postByChannel, snapshot.postByChannel);
  assert.deepEqual(saved.createdFormats, []);
  assert.deepEqual(payload, snapshot);
});
