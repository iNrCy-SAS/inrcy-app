import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  applyReferenceImageOrder,
  getImageChannelAction,
  moveImageKeyToTarget,
  setImageKeysForChannel,
} from "../../app/dashboard/booster/publier/imageChannelAssignment.ts";
import {
  extendBoosterChannelImageSelectionForGlobalAdd,
  mergeBoosterChannelImageSelection,
} from "../../lib/boosterChannelImageSelection.ts";

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
const imageController = read(
  "app/dashboard/booster/publier/usePublishImageController.ts",
);
const imagesPanel = read(
  "app/dashboard/booster/publier/components/PublishImagesPanel.tsx",
);
const cardPanel = read(
  "app/dashboard/_components/channel-image-adapter/cards-panel.tsx",
);
const intentPanel = read(
  "app/dashboard/booster/publier/components/PublishIntentPanel.tsx",
);

type Channel = "A" | "B" | "C" | "D" | "E";
type Editor = { imageKeys: string[]; transforms: Record<string, unknown> };

const fallbackEditor = (): Editor => ({ imageKeys: [], transforms: {} });

test("one five-image pool supports independent ordered mappings per channel", () => {
  const pool = ["A", "B", "C", "D", "E"];
  let editors: Partial<Record<Channel, Editor>> = {};

  editors = setImageKeysForChannel(editors, "A", ["A", "B", "C"], {
    fallback: fallbackEditor(),
  });
  editors = setImageKeysForChannel(editors, "B", ["A", "D", "E"], {
    fallback: fallbackEditor(),
  });
  editors = setImageKeysForChannel(editors, "C", ["C", "D"], {
    fallback: fallbackEditor(),
  });

  const mediaModes = {
    A: "images",
    B: "images",
    C: "images",
    E: "video",
  } as const;

  assert.deepEqual(pool, ["A", "B", "C", "D", "E"]);
  assert.deepEqual(editors.A?.imageKeys, ["A", "B", "C"]);
  assert.deepEqual(editors.B?.imageKeys, ["A", "D", "E"]);
  assert.deepEqual(editors.C?.imageKeys, ["C", "D"]);
  assert.equal(editors.E, undefined);
  assert.equal(mediaModes.E, "video");

  editors = setImageKeysForChannel(editors, "A", [], {
    fallback: fallbackEditor(),
  });
  assert.deepEqual(editors.A?.imageKeys, []);
  assert.deepEqual(editors.B?.imageKeys, ["A", "D", "E"]);
  assert.deepEqual(editors.C?.imageKeys, ["C", "D"]);

  editors = setImageKeysForChannel(editors, "D", pool, {
    fallback: fallbackEditor(),
  });
  assert.deepEqual(editors.D?.imageKeys, pool);
});

test("drag-and-drop moves a media to the target position", () => {
  assert.deepEqual(
    moveImageKeyToTarget(["A", "B", "C", "D"], "A", "C"),
    ["B", "C", "A", "D"],
  );
  assert.deepEqual(
    moveImageKeyToTarget(["A", "B", "C", "D"], "D", "B"),
    ["A", "D", "B", "C"],
  );
});

test("applying one channel order preserves every other channel subset", () => {
  assert.deepEqual(
    applyReferenceImageOrder(["C", "B", "A"], ["A", "C"]),
    ["C", "A"],
  );
  assert.deepEqual(
    applyReferenceImageOrder(["C", "A"], ["A", "B", "C", "D"]),
    ["C", "A", "B", "D"],
    "media intentionally absent from the source stays selected only on its target channel",
  );
});

test("the channel action picks only without a pool and otherwise reuses it", () => {
  assert.deepEqual(
    getImageChannelAction({
      hasImagePool: false,
      assignedImageCount: 0,
      mode: "none",
    }),
    { kind: "pick", label: "Ajouter des images" },
  );
  assert.deepEqual(
    getImageChannelAction({
      hasImagePool: true,
      assignedImageCount: 0,
      mode: "none",
    }),
    {
      kind: "reuse",
      label: "Utiliser les images existantes ici",
    },
  );
  assert.deepEqual(
    getImageChannelAction({
      hasImagePool: true,
      assignedImageCount: 3,
      mode: "images",
    }),
    { kind: "selected", label: "Photos" },
  );
});

test("new physical keys are never auto-assigned to existing channel mappings", () => {
  assert.deepEqual(
    mergeBoosterChannelImageSelection({
      availableKeys: ["A", "B", "C", "D", "E"],
      previousAvailableKeys: ["A", "B", "C", "D"],
      previousSelectedKeys: ["A", "B", "C"],
      supportsImages: true,
    }),
    ["A", "B", "C"],
  );
  assert.deepEqual(
    mergeBoosterChannelImageSelection({
      availableKeys: ["A", "B", "C", "D", "E"],
      previousAvailableKeys: ["A", "B", "C", "D"],
      previousSelectedKeys: ["C", "D"],
      supportsImages: true,
    }),
    ["C", "D"],
  );
  assert.deepEqual(
    mergeBoosterChannelImageSelection({
      availableKeys: ["A", "B", "C", "D", "E"],
      previousSelectedKeys: ["A", "D", "E"],
      supportsImages: true,
    }),
    ["A", "D", "E"],
    "a restored draft keeps both its subset and its order",
  );
});

test("a global add extends only channels that still used the complete image pool", () => {
  assert.deepEqual(
    extendBoosterChannelImageSelectionForGlobalAdd({
      previousAvailableKeys: ["A"],
      previousSelectedKeys: ["A"],
      newKeys: ["B", "C"],
      supportsImages: true,
      maxImages: 5,
    }),
    ["A", "B", "C"],
  );
  assert.deepEqual(
    extendBoosterChannelImageSelectionForGlobalAdd({
      previousAvailableKeys: ["A", "B"],
      previousSelectedKeys: ["A"],
      newKeys: ["C"],
      supportsImages: true,
      maxImages: 5,
    }),
    ["A"],
    "an intentional per-channel subset stays authoritative",
  );
  assert.deepEqual(
    extendBoosterChannelImageSelectionForGlobalAdd({
      previousAvailableKeys: ["A"],
      previousSelectedKeys: [],
      newKeys: ["B"],
      supportsImages: true,
      maxImages: 5,
    }),
    [],
    "a channel with images disabled stays disabled",
  );
});

test("reuse and removal mutate only the selected channel and never sync the pool", () => {
  const assign = between(
    imageController,
    "const assignExistingImagesToChannel",
    "const removeImagesFromChannel",
  );
  assert.match(assign, /setImageKeysForChannel\(prev, channel, selectedImageKeys/);
  assert.match(assign, /getBoosterMaxImageCountForChannel\(channel\)/);
  assert.match(assign, /\[channel\]: "images"/);
  assert.doesNotMatch(assign, /syncPersistentWorkspaceImages/);
  assert.doesNotMatch(assign, /fileInputRef\.current/);

  const remove = between(
    imageController,
    "const removeImagesFromChannel",
    "const removeImage",
  );
  assert.match(remove, /setImageKeysForChannel\(prev, channel, \[\]/);
  assert.match(remove, /\[channel\]: "none"/);
  assert.doesNotMatch(remove, /syncPersistentWorkspaceImages/);

  const removeOne = between(
    imageController,
    "const toggleChannelImage",
    "const resetChannelImage",
  );
  assert.match(removeOne, /current\.imageKeys\.filter/);
  assert.match(removeOne, /getImpactedImageChannels\(channel\)/);
  assert.doesNotMatch(removeOne, /syncPersistentWorkspaceImages/);
  assert.doesNotMatch(removeOne, /setImages\(/);

  assert.match(
    publishModal,
    /onUseExistingImagesForChannel=\{[\s\S]{0,100}assignExistingImagesToChannel/,
  );
  assert.match(
    publishModal,
    /onRemoveImagesFromChannel=\{removeImagesFromChannel\}/,
  );
});

test("the first channel picker assigns only its target after one pool sync", () => {
  const picker = between(
    imageController,
    "const onPickImagesForChannel",
    "const addImageFiles",
  );
  assert.match(picker, /if \(images\.length > 0/);
  assert.match(picker, /imagePickerTargetChannelRef\.current = channel/);
  assert.match(picker, /fileInputRef\.current\?\.click\(\)/);

  const add = between(
    imageController,
    "const addImageFiles",
    "const replaceImageFile",
  );
  assert.equal(
    [...add.matchAll(/syncPersistentWorkspaceImages\?\.\(/g)].length,
    1,
  );
  assert.match(add, /if \(channel === targetChannel\) continue/);
  assert.match(add, /prev\[channel\]\?\.imageKeys/);
  assert.match(add, /setImageKeysForChannel\(next, targetChannel, targetKeys/);
  assert.match(add, /extendBoosterChannelImageSelectionForGlobalAdd/);

  const change = between(
    imageController,
    "const onImagesChange",
    "const assignExistingImagesToChannel",
  );
  assert.match(change, /imagePickerTargetChannelRef\.current/);
  assert.match(change, /imagePickerTargetChannelRef\.current = null/);
  assert.match(change, /resolvedTargetChannel/);
});

test("block 4 exposes reuse and explicit local versus global deletion labels", () => {
  assert.match(imagesPanel, /imageChannelAction\.kind === "pick"/);
  assert.match(
    imagesPanel,
    /onPickImagesForChannel\(activeImageChannel\)/,
  );
  assert.match(
    imagesPanel,
    /onUseExistingImagesForChannel\(activeImageChannel\)/,
  );
  assert.match(imagesPanel, /i18nT\("retirer_les_images_de_ce_canal_b025e5ef"\)/);
  assert.match(imagesPanel, /i18nT\("supprimer_partout_dfb790c4"\)/);
  assert.match(cardPanel, /aria-label=\{`\$\{item\.removeLabel/);
  assert.match(
    cardPanel,
    /aria-label=\{`\$\{item\.removeEverywhereLabel/,
  );
  assert.match(
    intentPanel,
    /i18nT\("supprimer_l_image_value_pour_tous_561091e2", \{ value0: index \+ 1 \}\)/,
  );
});

test("visible media order is the publish order and supports drag-and-drop", () => {
  assert.match(imagesPanel, /const orderedImageKeys = \[/);
  assert.match(imagesPanel, /items=\{orderedImageKeys\.map\(/);
  assert.doesNotMatch(imagesPanel, /items=\{imageKeys\.map\(/);
  assert.match(imagesPanel, /onAdapt: \(\) => openImageRetoucher\(activeImageChannel, key\)/);
  assert.match(imagesPanel, /onModify: \(\) => openImageModifier\(activeImageChannel, key\)/);
  assert.match(publishModal, /openInrStudioImageTool = async \(/);
  assert.match(publishModal, /tab: "modify" \| "retouch"/);
  assert.match(publishModal, /source: \{[\s\S]*?file: sourceFile \|\| null,[\s\S]*?url: sourceUrl/);
  assert.match(publishModal, /context: \{[\s\S]*?channel,[\s\S]*?imageKey,/);
  assert.doesNotMatch(publishModal, /sidebarItems=\{/);
  assert.match(imagesPanel, /removeImage\(imageKeys\.indexOf\(key\)\)/);
  assert.match(imagesPanel, /onMoveTo: included/);
  assert.match(imagesPanel, /moveChannelImageTo\(/);

  assert.match(cardPanel, /draggable=\{canDrag\}/);
  assert.match(cardPanel, /onDragStart=/);
  assert.match(cardPanel, /onDragOver=/);
  assert.match(cardPanel, /onDrop=/);
  assert.match(cardPanel, /sourceItem\.onMoveTo\(item\.key\)/);
  assert.match(cardPanel, /item\.onMovePrevious/);
  assert.match(cardPanel, /item\.onMoveNext/);
  assert.match(cardPanel, /onClick=\{item\.onModify\}/);
  assert.match(cardPanel, /onClick=\{item\.onAdapt\}/);
  assert.match(cardPanel, /modifier_image_3f1a7c90/);
  const previousControl = cardPanel.indexOf("onClick={item.onMovePrevious}");
  const selectionControl = cardPanel.indexOf('type="checkbox"', previousControl);
  const imageTitle = cardPanel.indexOf("{item.title ||", selectionControl);
  const dragHandle = cardPanel.indexOf("⠿", imageTitle);
  const nextControl = cardPanel.indexOf("onClick={item.onMoveNext}", dragHandle);
  const imageFrame = cardPanel.indexOf("<FinalImageFrame", nextControl);
  const modifyAction = cardPanel.indexOf("onClick={item.onModify}", imageFrame);
  const retouchAction = cardPanel.indexOf("onClick={item.onAdapt}", modifyAction);
  const resetAction = cardPanel.indexOf("onClick={item.onReset}", retouchAction);
  const removeAction = cardPanel.indexOf("onClick={item.onRemove}", resetAction);
  assert.deepEqual(
    [
      previousControl,
      selectionControl,
      imageTitle,
      dragHandle,
      nextControl,
      imageFrame,
      modifyAction,
      retouchAction,
      resetAction,
      removeAction,
    ].every((position, index, positions) =>
      position >= 0 && (index === 0 || position > positions[index - 1]),
    ),
    true,
  );
  assert.match(cardPanel, /removeEverywhereLabel[\s\S]*?whiteSpace: "normal"[\s\S]*?textOverflow: "clip"/);
  assert.doesNotMatch(cardPanel, /fitLabel=\{item\.fitLabel\}/);
});

test("one action applies the active media order without changing channel selections", () => {
  const applyEverywhere = between(
    imageController,
    "const applyChannelImageOrderToSelectedChannels",
    "const applyCurrentImageToSelectedChannels",
  );
  assert.match(applyEverywhere, /for \(const channel of selectedChannels\)/);
  assert.match(applyEverywhere, /applyReferenceImageOrder\(/);
  assert.match(applyEverywhere, /current\.imageKeys/);
  assert.doesNotMatch(applyEverywhere, /imageKeys\.slice\(\)/);
  assert.match(
    imagesPanel,
    /i18nT\("apply_media_order_everywhere"\)/,
  );
  assert.match(
    publishModal,
    /applyChannelImageOrderToAllChannels=\{[\s\S]{0,100}applyChannelImageOrderToSelectedChannels/,
  );
});

test("prepared publication media keeps the exact channel order", () => {
  const payloadBuilder = between(
    imageController,
    "const buildChannelImagesPayload",
    "return {",
  );
  assert.match(
    payloadBuilder,
    /const imageKeysToRender = customizationScope\.imageKeys/,
  );
  assert.doesNotMatch(payloadBuilder, /imageKeysToRender\.sort/);
});

test("drafts and scheduled publications preserve channel imageKeys mappings", () => {
  const draftSettings = between(
    imageController,
    "function getDraftImageSettingsByChannel",
    "async function uploadPublicationDraftImages",
  );
  assert.match(draftSettings, /channelImageEditors\[channel\]/);
  assert.match(draftSettings, /imageKeysForChannel\.slice/);
  assert.doesNotMatch(draftSettings, /imageKeysForChannel\.sort/);

  assert.match(
    publishModal,
    /imageSettingsByChannel: getDraftImageSettingsByChannel\(\)/,
  );

  const schedule = between(
    publishModal,
    "const scheduleGroups",
    "setChannels((prev) =>",
  );
  assert.match(schedule, /postBoosterScheduledAction\(/);
  assert.match(
    schedule,
    /imageSettingsByChannel: buildChannelRecord\([\s\S]{0,80}channelSettings,[\s\S]{0,80}groupChannels/,
  );
});
