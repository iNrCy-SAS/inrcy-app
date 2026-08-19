import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  GENERATION_MEDIA_EXCLUSIVE_MESSAGE,
  getGenerationMediaSelectionError,
  getGenerationMediaSelectionPolicy,
} from "../../app/dashboard/booster/publier/generationMediaSelection.ts";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

function between(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.notEqual(startIndex, -1, `missing source marker: ${start}`);
  assert.notEqual(endIndex, -1, `missing source marker: ${end}`);
  return source.slice(startIndex, endIndex);
}

const modal = read("app/dashboard/booster/publier/PublishModal.tsx");
const intent = read(
  "app/dashboard/booster/publier/components/PublishIntentPanel.tsx",
);
const imageController = read(
  "app/dashboard/booster/publier/usePublishImageController.ts",
);
const publicationMediaPanel = read(
  "app/dashboard/booster/publier/components/PublishImagesPanel.tsx",
);

test("generation starts with one exclusive family choice", () => {
  assert.deepEqual(
    getGenerationMediaSelectionPolicy({ imageCount: 0, hasVideo: false }),
    {
      imagePickerDisabled: false,
      videoPickerDisabled: false,
      cameraCaptureDisabled: false,
      allowCameraVideo: true,
      libraryAccept: "all",
      libraryMultiple: true,
      libraryMaxSelection: 5,
    },
  );

  const withImages = getGenerationMediaSelectionPolicy({
    imageCount: 3,
    hasVideo: false,
  });
  assert.equal(withImages.imagePickerDisabled, false);
  assert.equal(withImages.videoPickerDisabled, true);
  assert.equal(withImages.allowCameraVideo, false);
  assert.equal(withImages.libraryAccept, "image");
  assert.equal(withImages.libraryMaxSelection, 2);

  const withVideo = getGenerationMediaSelectionPolicy({
    imageCount: 0,
    hasVideo: true,
  });
  assert.equal(withVideo.imagePickerDisabled, true);
  assert.equal(withVideo.videoPickerDisabled, true);
  assert.equal(withVideo.cameraCaptureDisabled, true);
  assert.equal(withVideo.libraryAccept, "video");
  assert.equal(withVideo.libraryMultiple, false);
  assert.equal(withVideo.libraryMaxSelection, 1);
});

test("generation rejects a mixed library or camera selection", () => {
  assert.equal(
    getGenerationMediaSelectionError({
      existingImageCount: 0,
      hasExistingVideo: false,
      selectedImageCount: 2,
      selectedVideoCount: 1,
    }),
    GENERATION_MEDIA_EXCLUSIVE_MESSAGE,
  );
  assert.equal(
    getGenerationMediaSelectionError({
      existingImageCount: 2,
      hasExistingVideo: false,
      selectedImageCount: 0,
      selectedVideoCount: 1,
    }),
    GENERATION_MEDIA_EXCLUSIVE_MESSAGE,
  );
  assert.equal(
    getGenerationMediaSelectionError({
      existingImageCount: 0,
      hasExistingVideo: true,
      selectedImageCount: 1,
      selectedVideoCount: 0,
    }),
    GENERATION_MEDIA_EXCLUSIVE_MESSAGE,
  );
  assert.equal(
    getGenerationMediaSelectionError({
      existingImageCount: 2,
      hasExistingVideo: false,
      selectedImageCount: 2,
      selectedVideoCount: 0,
    }),
    null,
  );
});

test("the generation UI and all its entry points enforce images OR video", () => {
  assert.match(intent, /getGenerationMediaSelectionPolicy\(\{/);
  assert.match(intent, /pickImagesDisabled = generationMediaPolicy\.imagePickerDisabled/);
  assert.match(intent, /pickVideoDisabled = generationMediaPolicy\.videoPickerDisabled/);
  assert.match(intent, /getLocalizedBoosterMediaOptimization\("generation", runtimeT\)/);

  const librarySelection = between(
    modal,
    "const addMediaLibrarySelection",
    "const onTakePhotoClick",
  );
  assert.match(librarySelection, /destination\.kind === "generation"/);
  assert.match(librarySelection, /getGenerationMediaSelectionError\(\{/);

  const cameraSelection = between(
    modal,
    "const onCameraCapture",
    "const updatePost",
  );
  assert.match(cameraSelection, /cameraCaptureScope === "generation"/);
  assert.match(cameraSelection, /getGenerationMediaSelectionError\(\{/);

  assert.match(modal, /generationMediaSelectionPolicy\.libraryAccept/);
  assert.match(modal, /generationMediaSelectionPolicy\.allowCameraVideo/);
  assert.match(modal, /hasVideoForGeneration \? \["video"\] : \["image"\]/);
  assert.match(
    modal,
    /const shouldUseImagesForAI =\s*!hasVideoForGeneration && images\.length > 0 && useImagesForAI/,
  );
});

test("the publication-media block still supports the shared 5 + 1 pool", () => {
  assert.match(publicationMediaPanel, /getVideoChannelAction\(\{/);
  assert.match(publicationMediaPanel, /getImageChannelAction\(\{/);
  assert.match(publicationMediaPanel, /setChannelMediaMode\(activeImageChannel, "video"\)/);
  assert.match(publicationMediaPanel, /setChannelMediaMode\(activeImageChannel, "images"\)/);

  const addImages = between(
    imageController,
    "const addImageFiles",
    "const onImagesChange",
  );
  assert.doesNotMatch(addImages, /clearVideoMedia/);

  const addVideo = between(modal, "const addVideoFile", "const onVideoChange");
  assert.doesNotMatch(addVideo, /clearImagesMedia/);
  assert.doesNotMatch(addVideo, /setImages\(\[\]\)/);
  assert.match(addVideo, /hadImagesBeforeVideo/);
  assert.match(addVideo, /channelHasImages/);
});
