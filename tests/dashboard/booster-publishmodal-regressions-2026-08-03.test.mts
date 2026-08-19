import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

const publishModal = read("app/dashboard/booster/publier/PublishModal.tsx");
const contentEditor = read(
  "app/dashboard/booster/publier/components/PublishContentEditorPanel.tsx",
);
const imagesPanel = read(
  "app/dashboard/booster/publier/components/PublishImagesPanel.tsx",
);
const videoAdapter = read(
  "app/dashboard/booster/publier/components/PublishVideoAdapterPanel.tsx",
);
const videoManager = read(
  "app/dashboard/booster/publier/components/BoosterVideoFormatManager.tsx",
);

test("channel titles keep raw spaces while the user is typing", () => {
  assert.ok(
    (contentEditor.match(/\{ title: e\.target\.value \},\s*\{ sanitize: false \}/g) || [])
      .length >= 2,
  );
  assert.doesNotMatch(publishModal, /\[ctaDefaults, postsByChannel\]/);
  assert.match(publishModal, /\}, \[ctaDefaults\]\);/);
});

test("block 4 exposes scoped media removal and global video removal", () => {
  assert.match(publishModal, /removeVideo=\{removeVideo\}/);
  assert.match(imagesPanel, /removeVideo: \(\) => void/);
  assert.match(imagesPanel, /onDeleteVideo=\{removeVideo\}/);
  assert.match(videoAdapter, /onDeleteVideo=\{onDeleteVideo\}/);
  assert.match(publishModal, /removeMediaFromChannel/);
  assert.match(imagesPanel, /onRemoveMediaFromChannel/);
  assert.match(videoAdapter, /onRemoveMediaFromChannel/);
  assert.match(videoManager, /i18nT\("retirer_de_ce_canal_76fbf864"\)/);
  assert.match(videoManager, /i18nT\("supprimer_partout_dfb790c4"\)/);
  assert.doesNotMatch(videoManager, /\) : onDeleteVideo \? \(/);
});

test("a scoped removal keeps an explicit empty media mode", () => {
  assert.match(publishModal, /if \(explicit === "none"\) return "none"/);
  assert.match(imagesPanel, /if \(explicit === "none"\) return "none"/);
  assert.match(publishModal, /current === "none" \|\|/);
});
