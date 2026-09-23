import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildSiteImageInteractionMetadata,
  getMediaImageInteractions,
  imageInteractionsFromOverlay,
  normalizeImageInteractions,
  withMediaImageInteractions,
} from "../../lib/imageInteractions.ts";
import { hasImageOverlay } from "../../lib/imageOverlay.ts";

const overlay = { items: [
  { id: "offer", text: "Notre offre", linkUrl: "https://example.com/offre", x: 20, y: 25, width: 30, height: 12 },
  { id: "booking", text: "Réserver\nune visite", linkUrl: "https://example.com/reserver?a=1&b=2", x: 65, y: 78, width: 40, height: 18 },
] };
const read = (file: string) => readFileSync(file, "utf8");

test("baked interactions preserve every linked block, text and geometry separately from visual overlays", () => {
  const interactions = imageInteractionsFromOverlay(overlay)!;
  assert.equal(interactions.version, 1);
  assert.equal(interactions.items.length, 2);
  for (let index = 0; index < overlay.items.length; index++) {
    for (const [key, value] of Object.entries(overlay.items[index])) {
      assert.equal(interactions.items[index][key as keyof typeof interactions.items[number]], value);
    }
  }
  const meta = withMediaImageInteractions({ width: 1200, height: 800, ratio: 1.5 }, { image_interactions: interactions });
  assert.deepEqual(meta.interactions, interactions);
  assert.equal("overlay" in meta, false);
  assert.equal(hasImageOverlay(meta), false);
});

test("only complete http(s) links attached to text survive interaction normalization", () => {
  const interactions = imageInteractionsFromOverlay({ items: [
    { text: "Danger", linkUrl: "javascript:alert(1)" },
    { text: "Fichier", linkUrl: "data:text/html,hello" },
    { text: "Brouillon", linkUrl: "www.example.com" },
    { linkUrl: "https://example.com/empty" },
    { text: "Sans lien" },
    overlay.items[0],
  ] });
  assert.equal(interactions?.items.length, 1);
  assert.equal(interactions?.items[0].id, "offer");
  assert.equal(normalizeImageInteractions({ version: 2, items: overlay.items }), undefined);
  assert.equal(normalizeImageInteractions({ version: 1, items: "wrong" }), undefined);
});

test("Studio handoff JSON and saved library metadata preserve the same interactions", () => {
  const interactions = imageInteractionsFromOverlay(overlay);
  const returned = JSON.parse(JSON.stringify({ version: 1, action: "retouch", item: { image_interactions: interactions } }));
  assert.deepEqual(getMediaImageInteractions(returned.item), interactions);
  assert.deepEqual(getMediaImageInteractions({ media_metadata: { image_interactions: interactions } }), interactions);
  assert.deepEqual(getMediaImageInteractions({ media_metadata: { studio_action: "retouch", transform: { overlay } } }), interactions);
  assert.equal(getMediaImageInteractions({ media_metadata: { transform: { overlay } } }), undefined);
});

test("image payload keeps baked links after automatic transforms have discarded visual overlays", () => {
  const meta = withMediaImageInteractions({ width: 1200, height: 800, ratio: 1.5 }, {
    image_interactions: imageInteractionsFromOverlay(overlay),
  });
  const image = JSON.parse(JSON.stringify({ imageKey: "baked", imageMeta: meta, transform: { fit: "contain", zoom: 1 } }));
  const site = buildSiteImageInteractionMetadata([image], ["baked"], 1);
  assert.equal(site[0]?.interactions.items.length, 2);
  assert.equal(image.transform.overlay, undefined);
});

test("site interactions follow published image keys and preserve empty index slots", () => {
  const interaction = imageInteractionsFromOverlay(overlay);
  const images = [
    { imageKey: "with-links", imageMeta: { interactions: interaction } },
    { imageKey: "without-links" },
  ];
  const entries = buildSiteImageInteractionMetadata(images, ["without-links", "with-links"], 2);
  assert.equal(entries.length, 2);
  assert.equal(entries[0], null);
  assert.equal(entries[1]?.imageKey, "with-links");
  assert.deepEqual(entries[1]?.interactions, interaction);
  assert.deepEqual(buildSiteImageInteractionMetadata(images, ["absent"], 1), [null]);
});

test("Booster return and library selection transfer metadata with the file", () => {
  const studio = read("app/dashboard/generer-media/MediaGeneratorStudioClient.tsx");
  const publish = read("app/dashboard/booster/publier/PublishModal.tsx");
  const controller = read("app/dashboard/booster/publier/usePublishImageController.ts");
  assert.match(studio, /image_interactions: imageInteractions/g);
  assert.match(publish, /replaceImageFile\(imageKey, file, returnedItem\)/);
  assert.match(publish, /addImageFiles\(\s*files,[\s\S]*?selectedImages,/);
  assert.match(controller, /withMediaImageInteractions\(presentation\.meta, transferredMetadata\)/);
  assert.match(controller, /transferredMetadata\[pickedFiles\.indexOf\(file\)\]/);
});

test("workspace, draft reload and server probe retain interactions without a visual layer", () => {
  const controller = read("app/dashboard/booster/publier/usePublishImageController.ts");
  const publish = read("app/dashboard/booster/publier/PublishModal.tsx");
  const workspace = read("lib/mediaWorkspaceConsumption.ts");
  assert.match(controller, /source_metadata: nextMetaByKey\[makeImageKey\(file\)\]/);
  assert.match(controller, /image_interactions: imageMetaByKey\[makeImageKey\(file\)\]\?\.interactions/);
  assert.match(controller, /normalizeImageInteractions\(interactionsByKey\?\.\[key\]\)/);
  assert.match(publish, /restorePublicationDraftImages\(imageDrafts, payload\.imageInteractionsByKey\)/);
  assert.match(publish, /next\[makeImageKey\(file\)\] = \{\s*\.\.\.next\[makeImageKey\(file\)\]/);
  assert.equal((workspace.match(/\.\.\.\(interactions \? \{ interactions \} : \{\}\)/g) || []).length, 2);
  assert.match(read("app/api/booster/publish-now/route.ts"), /siteMediaMetadata\.imageInteractions = siteImageInteractions/);
});
