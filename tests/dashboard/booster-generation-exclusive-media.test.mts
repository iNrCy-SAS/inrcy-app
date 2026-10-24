import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getGenerationMediaSelectionError, getGenerationMediaSelectionPolicy } from "../../app/dashboard/booster/publier/generationMediaSelection.ts";
function read(path: string) { return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8"); }

test("generation keeps five image slots and one video slot independent", () => {
  const empty = getGenerationMediaSelectionPolicy({ imageCount: 0, hasVideo: false });
  assert.equal(empty.imagePickerDisabled, false); assert.equal(empty.videoPickerDisabled, false); assert.equal(empty.libraryMaxSelection, 6);
  const images = getGenerationMediaSelectionPolicy({ imageCount: 5, hasVideo: false });
  assert.equal(images.imagePickerDisabled, true); assert.equal(images.videoPickerDisabled, false); assert.equal(images.allowCameraVideo, true); assert.equal(images.libraryAccept, "video");
  const video = getGenerationMediaSelectionPolicy({ imageCount: 0, hasVideo: true });
  assert.equal(video.imagePickerDisabled, false); assert.equal(video.videoPickerDisabled, true); assert.equal(video.libraryAccept, "image"); assert.equal(video.libraryMaxSelection, 5);
  const full = getGenerationMediaSelectionPolicy({ imageCount: 5, hasVideo: true });
  assert.equal(full.imagePickerDisabled, true); assert.equal(full.videoPickerDisabled, true); assert.equal(full.cameraCaptureDisabled, true);
});

test("generation allows five images plus a video but rejects a sixth image and a second video", () => {
  assert.equal(getGenerationMediaSelectionError({ existingImageCount: 0, hasExistingVideo: false, selectedImageCount: 5, selectedVideoCount: 1 }), null);
  assert.equal(getGenerationMediaSelectionError({ existingImageCount: 3, hasExistingVideo: true, selectedImageCount: 2, selectedVideoCount: 0 }), null);
  assert.match(getGenerationMediaSelectionError({ existingImageCount: 3, hasExistingVideo: false, selectedImageCount: 3, selectedVideoCount: 0 })!, /5 images/);
  assert.match(getGenerationMediaSelectionError({ existingImageCount: 0, hasExistingVideo: false, selectedImageCount: 0, selectedVideoCount: 2 })!, /seule vidéo/);
  assert.match(getGenerationMediaSelectionError({ existingImageCount: 0, hasExistingVideo: true, selectedImageCount: 0, selectedVideoCount: 1 })!, /seule vidéo/);
});

test("the generation UI and preparation keep both families while the publisher keeps its channel choices", () => {
  const modal = read("app/dashboard/booster/publier/PublishModal.tsx");
  const intent = read("app/dashboard/booster/publier/components/PublishIntentPanel.tsx");
  assert.match(intent, /pickImagesDisabled = generationMediaPolicy\.imagePickerDisabled/);
  assert.match(intent, /pickVideoDisabled = generationMediaPolicy\.videoPickerDisabled/);
  assert.match(modal, /const shouldUseImagesForAI =\s*images\.length > 0 && useImagesForAI/);
  assert.match(modal, /shouldUseImagesForAI \? \["image" as const\]/);
  assert.match(modal, /hasVideoForGeneration \? \["video" as const\]/);
  const publication = read("app/dashboard/booster/publier/components/PublishImagesPanel.tsx");
  assert.match(publication, /setChannelMediaMode\(activeImageChannel, "video"\)/);
  assert.match(publication, /setChannelMediaMode\(activeImageChannel, "images"\)/);
});
