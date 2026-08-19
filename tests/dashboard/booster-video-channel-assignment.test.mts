import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  assignVideoSourceToChannel,
  getVideoChannelAction,
} from "../../app/dashboard/booster/publier/videoChannelAssignment.ts";

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

const publishModal = read("app/dashboard/booster/publier/PublishModal.tsx");
const imagesPanel = read(
  "app/dashboard/booster/publier/components/PublishImagesPanel.tsx",
);
const videoManager = read(
  "app/dashboard/booster/publier/components/BoosterVideoFormatManager.tsx",
);

test("the channel action distinguishes picking, reusing and an assigned source", () => {
  assert.deepEqual(
    getVideoChannelAction({ hasVideoSource: false, mode: "none" }),
    { kind: "pick", label: "Ajouter une vidéo" },
  );
  assert.deepEqual(
    getVideoChannelAction({ hasVideoSource: true, mode: "images" }),
    { kind: "reuse", label: "Utiliser la même vidéo ici" },
  );
  assert.deepEqual(
    getVideoChannelAction({ hasVideoSource: true, mode: "video" }),
    { kind: "selected", label: "Vidéo" },
  );
});

test("assigning the global source changes only the requested channel", () => {
  const before = {
    linkedin: "images",
    instagram: "none",
    tiktok: "video",
  } as const;

  const after = assignVideoSourceToChannel(before, "instagram");

  assert.deepEqual(after, {
    linkedin: "images",
    instagram: "video",
    tiktok: "video",
  });
  assert.deepEqual(before, {
    linkedin: "images",
    instagram: "none",
    tiktok: "video",
  });
});

test("a channel picker targets one channel while synchronizing one global source", () => {
  const picker = between(
    publishModal,
    "const onPickVideoForChannel",
    "const removeVideo",
  );
  assert.match(picker, /videoPickerTargetChannelRef\.current = channel/);
  assert.match(picker, /videoInputRef\.current\?\.click\(\)/);

  const addVideo = between(
    publishModal,
    "const addVideoFile",
    "const onVideoChange",
  );
  assert.match(addVideo, /targetChannel\?: ChannelKey/);
  assert.match(addVideo, /channelModesBeforeVideo/);
  assert.match(addVideo, /resolveChannelMediaMode\(channel\)/);
  assert.match(
    addVideo,
    /return assignVideoSourceToChannel\(next, options\.targetChannel\)/,
  );
  assert.equal(
    [...addVideo.matchAll(/syncPersistentWorkspaceVideo\(/g)].length,
    1,
    "one selected file must create exactly one global workspace sync",
  );

  const onChange = between(
    publishModal,
    "const onVideoChange",
    "async function mediaLibraryItemToFile",
  );
  assert.match(onChange, /videoPickerTargetChannelRef\.current/);
  assert.match(onChange, /videoPickerTargetChannelRef\.current = null/);
  assert.match(onChange, /targetChannel: targetChannel \|\| undefined/);
});

test("reusing an existing video is a local channel-mode update", () => {
  assert.match(imagesPanel, /getVideoChannelAction\(/);
  assert.match(
    imagesPanel,
    /videoChannelAction\.kind === "pick"[\s\S]{0,180}onPickVideoForChannel\(activeImageChannel\)[\s\S]{0,180}setChannelMediaMode\(activeImageChannel, "video"\)/,
  );
  assert.doesNotMatch(imagesPanel, /syncPersistentWorkspaceVideo/);
  assert.doesNotMatch(imagesPanel, /addVideoFile/);
  assert.match(imagesPanel, /aria-pressed=\{active\}/);
  assert.match(imagesPanel, /aria-label=\{accessibleLabel\}/);
});

test("channel removal and global deletion are explicit and remain separate", () => {
  const channelRemoval = between(
    publishModal,
    "const removeMediaFromChannel",
    "function getCutoverVideoPreparationError",
  );
  assert.match(channelRemoval, /\[channel\]: "none"/);
  assert.doesNotMatch(channelRemoval, /syncPersistentWorkspaceVideo/);
  assert.doesNotMatch(channelRemoval, /clearVideoMedia/);

  const globalRemoval = between(
    publishModal,
    "const removeVideo",
    "const addVideoFile",
  );
  assert.match(globalRemoval, /clearVideoMedia/);
  assert.match(globalRemoval, /syncPersistentWorkspaceVideo\(null\)/);

  assert.match(
    videoManager,
    /removeFromChannelLabel \|\| i18nT\("retirer_de_ce_canal_76fbf864"\)/,
  );
  assert.match(
    videoManager,
    /deleteVideoLabel \|\| i18nT\("supprimer_partout_dfb790c4"\)/,
  );
  assert.match(videoManager, /aria-label=\{resolvedRemoveFromChannelLabel\}/);
  assert.match(videoManager, /aria-label=\{resolvedDeleteVideoLabel\}/);
});
