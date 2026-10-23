import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runtimeModules } from "./runtime-module-loader.mts";

const load = runtimeModules();
const { extractPublishMediaPreview } = load<typeof import("../../app/dashboard/agent/_lib/agent.publish-preview.ts")>("app/dashboard/agent/_lib/agent.publish-preview.ts");
const { updateScheduledEditPublishMedia } = load<typeof import("../../app/dashboard/agent/_lib/agent.schedule.ts")>("app/dashboard/agent/_lib/agent.schedule.ts");
const images = [1, 2, 3].map(index => ({ id: `image-${index}`, kind: "image", mediaType: "image", name: `Image ${index}`, url: `https://media.test/image-${index}.jpg` }));
const action = {
  id: "publication", automationKey: "publish", actionType: "publication", targetTool: "booster",
  title: "Publication", summary: "Sujet", previewText: "Sujet", targetChannels: ["facebook", "instagram"],
  targetThemes: [], recipients: [], imageAssets: images,
  payload: { imagesByChannel: { facebook: images, instagram: images },
    mediaModeByChannel: { facebook: "images", instagram: "images" },
    postByChannel: { facebook: { content: "Facebook" }, instagram: { content: "Instagram" } } },
  validationRequired: true, executionPolicy: "manual_validation", status: "pending_validation",
  scheduledFor: "2030-11-11T17:00:00.000Z", preparedAt: null, createdAt: null,
} satisfies Parameters<typeof extractPublishMediaPreview>[0];

test("le carrousel consulte chacune des trois images du canal sans toucher à la publication", () => {
  const before = structuredClone(action);
  for (let index = 0; index < images.length; index += 1) {
    const preview = extractPublishMediaPreview(action, "facebook", index);
    assert.equal(preview.activeIndex, index);
    assert.equal(preview.count, 3);
    assert.equal(preview.url, images[index].url);
  }
  assert.deepEqual(action, before);
});

test("modifier ou supprimer l’image affichée conserve les autres images et les autres canaux", () => {
  const replacement = { id: "replacement", kind: "image", url: "https://media.test/replacement.jpg" };
  const replaced = updateScheduledEditPublishMedia(action, "facebook", replacement, 1, "replace");
  assert.equal(extractPublishMediaPreview(replaced, "facebook", 1).url, replacement.url);
  assert.equal(extractPublishMediaPreview(replaced, "facebook", 0).url, images[0].url);
  assert.equal(extractPublishMediaPreview(replaced, "facebook", 2).url, images[2].url);
  assert.equal(extractPublishMediaPreview(replaced, "instagram", 1).url, images[1].url);
  const removed = updateScheduledEditPublishMedia(action, "facebook", null, 1, "remove");
  assert.deepEqual(extractPublishMediaPreview(removed, "facebook").items.map(item => item.url), [images[0].url, images[2].url]);
  assert.equal(extractPublishMediaPreview(removed, "instagram").count, 3);
});

test("la modale garde un aperçu entier et ferme avant le dialogue commun de régénération", () => {
  const client = readFileSync(new URL("../../app/dashboard/agent/AgentClient.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../../app/dashboard/agent/agent.module.css", import.meta.url), "utf8");
  const modal = client.slice(client.indexOf("{publishMediaPreviewOpen && isPublishView"), client.indexOf("<AgentScheduleModal"));
  assert.match(modal, /publishMediaPreviewColumn/);
  assert.match(modal, /<aside className=\{styles\.publishMediaControls\}/);
  assert.match(modal, /setPublishMediaPreviewOpen\(false\); requestPublishChannelRegeneration\("media"\)/);
  assert.match(modal, /publishMediaPreview\.activeIndex \+ 1\} \/ \{publishMediaPreview\.items\.length/);
  assert.doesNotMatch(modal, /publishMediaAdaptationBox|publishMediaGallery|modalEyebrow/);
  assert.match(css, /\.publishMediaModal \.publishMediaVisual img,[\s\S]*?object-fit: contain;[\s\S]*?object-position: center;/);
});
