import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(relativePath: string) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const editor = read(
  "app/dashboard/booster/publier/components/PublishContentEditorPanel.tsx",
);
const modal = read("app/dashboard/booster/publier/PublishModal.tsx");
const route = read("app/api/booster/publish-now/route.ts");
const foundations = read(
  "app/api/booster/publish-now/publishNow.foundations.ts",
);
const ingress = read("lib/boosterPublicationIngress.ts");
const motion = read("lib/instagramImageMotionVideo.ts");

test("Instagram exposes Reel and Story for both image and video media", () => {
  assert.match(
    editor,
    /activeCard === "instagram" && instagramMediaMode !== "none"/,
  );
  assert.match(editor, /<option value="reel"[\s\S]*?instagram_reels/);
  assert.match(editor, /<option value="story"[\s\S]*?instagram_stories/);
  assert.match(editor, /disabled=\{instagramMediaOnly\}/);
  assert.match(editor, /instagramMediaMode === "images"[\s\S]*?instagram_image_motion_notice/);
  assert.doesNotMatch(
    editor,
    /activeCard === "instagram" && instagramMediaMode === "video"/,
  );
});

test("new Instagram format settings survive immediate and scheduled durable dispatch", () => {
  assert.ok(
    (modal.match(/instagramPublicationSettings:/g) || []).length >= 2,
    "immediate and scheduled payloads must both carry the setting",
  );
  assert.match(ingress, /instagramPublicationSettings: body\.instagramPublicationSettings/);
  assert.match(route, /normalizeInstagramPublicationSettings\(body\.instagramPublicationSettings\)/);
  assert.match(route, /channel === "instagram" && instagramPublicationSettings/);
  assert.match(foundations, /mediaType: story \? "STORIES" : "REELS"/);
  assert.match(foundations, /mediaOnly: true/);
});

test("an Instagram image is converted to a real vertical MP4 and never falls back to a photo", () => {
  assert.match(
    route,
    /instagramPublicationSettings &&[\s\S]*?mediaModeByChannel\[ch\] === "images"[\s\S]*?createInstagramImageMotionVideo/,
  );
  assert.match(route, /instagram_image_motion_preparation_failed/);
  assert.match(route, /const instagramCaption = instagramPublicationSettings[\s\S]*?\? ""/);
  assert.match(motion, /const OUTPUT_WIDTH = 1_080/);
  assert.match(motion, /const OUTPUT_HEIGHT = 1_920/);
  assert.match(motion, /const OUTPUT_DURATION_SECONDS = 8/);
  assert.match(motion, /"libx264"/);
  assert.match(motion, /"aac"/);
  assert.match(motion, /loadAiMediaSoundtrack/);
  assert.match(motion, /upsert: false/);
});
