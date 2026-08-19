import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  beginWorkspaceFamilyMutation,
  beginWorkspaceGlobalClear,
  createWorkspaceMediaMutationClock,
  getWorkspaceMediaFamilyFailure,
  getWorkspaceSourcePosition,
  isWorkspaceMediaMutationCurrent,
  replaceWorkspaceMediaFamilyStates,
  type WorkspaceMediaFamily,
} from "../../app/dashboard/booster/publier/persistentMediaWorkspaceMutations.ts";

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

const workspaceHook = read(
  "app/dashboard/booster/publier/usePersistentMediaWorkspace.ts",
);
const publishModal = read("app/dashboard/booster/publier/PublishModal.tsx");
const imageController = read(
  "app/dashboard/booster/publier/usePublishImageController.ts",
);
const shared = read("app/dashboard/booster/publier/publishModal.shared.tsx");
const intentPanel = read(
  "app/dashboard/booster/publier/components/PublishIntentPanel.tsx",
);
const imagesPanel = read(
  "app/dashboard/booster/publier/components/PublishImagesPanel.tsx",
);

test("image and video mutations stay current independently", () => {
  let clock = createWorkspaceMediaMutationClock();
  const imageMutation = beginWorkspaceFamilyMutation(clock, "image");
  clock = imageMutation.clock;
  const videoMutation = beginWorkspaceFamilyMutation(clock, "video");
  clock = videoMutation.clock;

  assert.equal(
    isWorkspaceMediaMutationCurrent(clock, imageMutation.token),
    true,
  );
  assert.equal(
    isWorkspaceMediaMutationCurrent(clock, videoMutation.token),
    true,
  );
});

test("rapid replacements cancel only the stale mutation from the same family", async () => {
  let clock = createWorkspaceMediaMutationClock();
  const firstImage = beginWorkspaceFamilyMutation(clock, "image");
  clock = firstImage.clock;
  const video = beginWorkspaceFamilyMutation(clock, "video");
  clock = video.clock;
  const latestImage = beginWorkspaceFamilyMutation(clock, "image");
  clock = latestImage.clock;

  const committed = await Promise.all([
    Promise.resolve().then(() =>
      isWorkspaceMediaMutationCurrent(clock, firstImage.token)
        ? "image-old"
        : null,
    ),
    Promise.resolve().then(() =>
      isWorkspaceMediaMutationCurrent(clock, video.token) ? "video" : null,
    ),
    Promise.resolve().then(() =>
      isWorkspaceMediaMutationCurrent(clock, latestImage.token)
        ? "image-new"
        : null,
    ),
  ]);

  assert.deepEqual(committed, [null, "video", "image-new"]);
});

test("an explicit global clear invalidates both families atomically", () => {
  let clock = createWorkspaceMediaMutationClock();
  const image = beginWorkspaceFamilyMutation(clock, "image");
  clock = image.clock;
  const video = beginWorkspaceFamilyMutation(clock, "video");
  clock = video.clock;
  const clear = beginWorkspaceGlobalClear(clock);
  clock = clear.clock;

  assert.equal(isWorkspaceMediaMutationCurrent(clock, image.token), false);
  assert.equal(isWorkspaceMediaMutationCurrent(clock, video.token), false);
  assert.equal(isWorkspaceMediaMutationCurrent(clock, clear.token), true);

  const postClearVideo = beginWorkspaceFamilyMutation(clock, "video");
  clock = postClearVideo.clock;
  assert.equal(isWorkspaceMediaMutationCurrent(clock, clear.token), true);
  assert.equal(
    isWorkspaceMediaMutationCurrent(clock, postClearVideo.token),
    true,
  );
});

test("replacing or clearing one state family preserves the other one", () => {
  type State = { mediaType: WorkspaceMediaFamily; label: string };
  const initial: Record<string, State> = {
    imageA: { mediaType: "image", label: "image A" },
    videoA: { mediaType: "video", label: "video A" },
  };

  const imagesCleared = replaceWorkspaceMediaFamilyStates<State>(
    initial,
    "image",
    {},
  );
  assert.deepEqual(imagesCleared, {
    videoA: { mediaType: "video", label: "video A" },
  });

  const videoReplaced = replaceWorkspaceMediaFamilyStates<State>(
    initial,
    "video",
    { videoB: { mediaType: "video", label: "video B" } },
  );
  assert.deepEqual(videoReplaced, {
    imageA: { mediaType: "image", label: "image A" },
    videoB: { mediaType: "video", label: "video B" },
  });
});

test("five image positions and the video position cannot collide", () => {
  assert.deepEqual(
    Array.from({ length: 5 }, (_, index) =>
      getWorkspaceSourcePosition("image", index),
    ),
    [0, 1, 2, 3, 4],
  );
  assert.equal(getWorkspaceSourcePosition("video", 0), 5);
});

test("a failed family never leaks into the other family's wait", () => {
  const failures = {
    image: "image upload failed",
    video: "video upload failed",
  };

  assert.equal(
    getWorkspaceMediaFamilyFailure(failures, ["image"]),
    "image upload failed",
  );
  assert.equal(
    getWorkspaceMediaFamilyFailure(failures, ["video"]),
    "video upload failed",
  );
  assert.equal(getWorkspaceMediaFamilyFailure(failures, []), "");
  assert.equal(
    getWorkspaceMediaFamilyFailure({ image: "image upload failed" }, [
      "video",
    ]),
    "",
  );
});

test("the hook scopes routine clears by family and keeps global clear explicit", () => {
  const familySync = between(
    workspaceHook,
    "const scheduleSync",
    "const syncImages",
  );
  const globalClear = between(
    workspaceHook,
    "const clearWorkspaceMedia",
    "const linkDraft",
  );

  assert.match(familySync, /beginWorkspaceFamilyMutation/);
  assert.match(familySync, /operationAbortRef\.current\[mediaType\]/);
  assert.match(
    familySync,
    /activeFamilyTaskRef\.current\[mediaType\] \|\| Promise\.resolve\(\)/,
  );
  assert.match(familySync, /replaceWorkspaceMediaFamilyStates/);
  assert.match(familySync, /mediaType,/);
  assert.doesNotMatch(familySync, /mediaType:\s*undefined/);

  assert.match(globalClear, /beginWorkspaceGlobalClear/);
  assert.match(globalClear, /mediaType:\s*undefined/);
  assert.match(globalClear, /reason:\s*"remove_all_media"/);
  assert.match(globalClear, /Object\.values\(operationAbortRef\.current\)/);
});

test("image and video UI removals mutate only their own persistent family", () => {
  const imageSync = between(
    publishModal,
    "const syncActiveImagesToPersistentWorkspace",
    "const {",
  );
  const removeVideo = between(
    publishModal,
    "const removeVideo",
    "const addVideoFile",
  );
  const clearImages = between(
    imageController,
    "const clearImagesMedia",
    "const onPickImagesClick",
  );
  const removeImage = between(
    imageController,
    "const removeImage",
    "function getSafeDraftImagePath",
  );

  assert.match(imageSync, /syncPersistentWorkspaceImages\(nextImages/);
  assert.doesNotMatch(imageSync, /syncPersistentWorkspaceVideo/);
  assert.doesNotMatch(imageSync, /clearPersistentWorkspaceMedia/);

  assert.match(removeVideo, /syncPersistentWorkspaceVideo\(null\)/);
  assert.doesNotMatch(removeVideo, /syncPersistentWorkspaceImages/);
  assert.doesNotMatch(removeVideo, /clearPersistentWorkspaceMedia/);

  assert.match(clearImages, /syncPersistentWorkspaceImages\?\.\(\[\]\)/);
  assert.match(removeImage, /syncPersistentWorkspaceImages\?\.\(/);
});

test("generation library is exclusive while publication keeps the 5 + 1 path", () => {
  const selection = between(
    publishModal,
    "const addMediaLibrarySelection",
    "const onTakePhotoClick",
  );
  const readiness = between(
    publishModal,
    "const waitForPersistentWorkspaceReadiness",
    "// Les captures",
  );

  assert.match(selection, /destination\.kind === "generation"/);
  assert.match(selection, /getGenerationMediaSelectionError\(\{/);
  assert.match(selection, /videos\.length > 1/);
  assert.match(selection, /const \[files, selectedVideo\] = await Promise\.all/);
  assert.match(
    selection,
    /await addImageFiles\([\s\S]{0,180}destination\.kind === "channel" \? destination\.channel : undefined/,
  );
  assert.match(selection, /await addVideoFile\(selectedVideo,[\s\S]*hasImages:/);
  assert.match(
    publishModal,
    /mediaLibraryPickerScope === "generation"[\s\S]{0,180}generationMediaSelectionPolicy\.libraryMaxSelection[\s\S]{0,100}BOOSTER_MAX_IMAGE_COUNT \+ 1/,
  );

  assert.match(readiness, /mediaType:\s*"image" as const/);
  assert.match(readiness, /mediaType:\s*"video" as const/);
  assert.match(
    readiness,
    /verifyPersistentWorkspaceSources\(sourceExpectations,[\s\S]{0,100}signal: readinessSignal/,
  );
});

test("a full publication reset remains the one atomic global-clear path", () => {
  const reset = between(
    publishModal,
    "const clearPublicationWork",
    "const onReset",
  );
  assert.match(reset, /clearImagesMedia\(\)/);
  assert.match(reset, /clearVideoMedia\(/);
  assert.match(reset, /clearPersistentWorkspaceMedia\(\)/);
});

test("publication promises 5 + 1 while generation promises images OR video", () => {
  assert.match(shared, /BOOSTER_GENERATION_MEDIA_OPTIMIZATION_LABEL/);
  assert.match(shared, /BOOSTER_PUBLICATION_MEDIA_OPTIMIZATION_LABEL/);
  assert.match(intentPanel, /getLocalizedBoosterMediaOptimization\("generation", runtimeT\)/);
  assert.match(imagesPanel, /getLocalizedBoosterMediaOptimization\("publication", runtimeT\)/);
});

test("publish, schedule and channel failures use each family's real presence", () => {
  assert.match(
    publishModal,
    /workspaceCarriesImagesForPublish\s*=\s*mediaPipelineCutoverEnabled && images\.length > 0/,
  );
  assert.match(
    publishModal,
    /workspaceCarriesVideoForPublish\s*=\s*mediaPipelineCutoverEnabled && Boolean\(videoFile\)/,
  );
  assert.match(
    publishModal,
    /workspaceCarriesImagesForSchedule\s*=\s*mediaPipelineCutoverEnabled && images\.length > 0/,
  );
  assert.match(
    publishModal,
    /workspaceCarriesVideoForSchedule\s*=\s*mediaPipelineCutoverEnabled && Boolean\(videoFile\)/,
  );
  assert.doesNotMatch(
    publishModal,
    /workspaceCarries(?:Images|Video)For(?:Publish|Schedule)[\s\S]{0,100}publicationMediaType/,
  );
  assert.match(
    publishModal,
    /relevantWorkspaceStates[\s\S]{0,140}state\.mediaType === \(mode === "video" \? "video" : "image"\)/,
  );
  assert.match(
    publishModal,
    /workspaceSourceExpected[\s\S]{0,180}mode === "video" && Boolean\(videoFile\)[\s\S]{0,100}mode === "images" && images\.length > 0/,
  );
});

test("publish and schedule settle once, then freeze only their required families", () => {
  assert.match(
    workspaceHook,
    /options\?: \{[\s\S]{0,140}mediaTypes\?: readonly WorkspaceMediaFamily\[\][\s\S]{0,100}tolerateFailures\?: boolean/,
  );
  assert.match(
    workspaceHook,
    /getWorkspaceMediaFamilyFailure\([\s\S]{0,100}options\?\.mediaTypes/,
  );
  assert.match(
    workspaceHook,
    /filter\(\(state\) => includesFamily\(state\.mediaType\)\)/,
  );
  assert.match(workspaceHook, /options\?\.mediaTypes/);
  assert.match(
    workspaceHook,
    /activeFamilyTaskRef\.current\[mediaType\]/,
  );

  assert.match(
    publishModal,
    /settledWorkspaceStates = persistentMediaWorkspaceEnabled[\s\S]{0,400}tolerateFailures: true[\s\S]{0,220}buildFinalReviewItems\([\s\S]{0,140}settledWorkspaceStates/,
  );
  assert.match(
    publishModal,
    /mediaTypes: requestedWorkspaceMediaTypes,[\s\S]{0,80}tolerateFailures: true/,
  );
  assert.match(
    publishModal,
    /requiredPublishMediaTypes[\s\S]{0,180}hasAnyImagePublish[\s\S]{0,180}hasAnyVideoPublish/,
  );
  assert.match(
    publishModal,
    /waitForPersistentWorkspaceReadiness\([\s\S]{0,800}requiredPublishMediaTypes/,
  );
  assert.match(
    publishModal,
    /requiredScheduleMediaTypes[\s\S]{0,180}hasAnyImagePublish[\s\S]{0,180}hasAnyVideoPublish/,
  );
  assert.match(
    publishModal,
    /waitForPersistentWorkspaceReadiness\([\s\S]{0,800}requiredScheduleMediaTypes/,
  );
  assert.match(
    publishModal,
    /workspaceStatesOverride \|\| persistentMediaStates/,
  );
  assert.match(
    publishModal,
    /waitForPersistentWorkspaceIdle\(undefined, \{[\s\S]{0,80}mediaTypes: \["video"\]/,
  );
});
