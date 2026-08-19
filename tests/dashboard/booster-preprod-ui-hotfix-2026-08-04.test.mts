import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const publishModal = readFileSync("app/dashboard/booster/publier/PublishModal.tsx", "utf8");
const mediaPanel = readFileSync("app/dashboard/booster/publier/components/PublishImagesPanel.tsx", "utf8");
const creationPanel = readFileSync("app/dashboard/booster/publier/components/PublishCreationModePanel.tsx", "utf8");
const channelSelector = readFileSync("app/dashboard/booster/publier/components/PublishChannelSelector.tsx", "utf8");
const mailboxClient = readFileSync("app/dashboard/mails/MailboxClient.tsx", "utf8");

test("manual mode keeps real image and video file inputs mounted", () => {
  assert.match(publishModal, /creationMode !== "ai"/);
  assert.match(publishModal, /ref=\{fileInputRef\}[\s\S]*accept=\{BOOSTER_IMAGE_ACCEPT\}/);
  assert.match(publishModal, /ref=\{videoInputRef\}[\s\S]*accept=\{BOOSTER_VIDEO_ACCEPT\}/);
});

test("explicit per-channel media removal wins for TikTok and YouTube", () => {
  const noneIndex = mediaPanel.indexOf('if (explicit === "none") return "none"');
  const youtubeIndex = mediaPanel.indexOf('if (channel === "youtube_shorts")');
  const tiktokIndex = mediaPanel.indexOf('if (channel === "tiktok")');
  assert.ok(noneIndex >= 0);
  assert.ok(noneIndex < youtubeIndex);
  assert.ok(noneIndex < tiktokIndex);
});

test("creation mode helper is concise", () => {
  assert.match(creationPanel, /i18nT\("choisissez_votre_mode_de_creation_vous_4d39fb96"\)/);
  assert.doesNotMatch(creationPanel, /travail propre au mode actuel/);
});

test("Booster eagerly warms channel logos", () => {
  assert.match(channelSelector, /Object\.values\(CHANNEL_ICON_SRC\)/);
  assert.match(channelSelector, /const image = new Image\(\)/);
  assert.match(channelSelector, /loading="eager"/);
  assert.match(channelSelector, /fetchPriority="high"/);
});

test("iNrSend releases delete loading before background history refresh", () => {
  const successIndex = mailboxClient.indexOf('setDetailsActionSuccess(`Publication ${label} supprimée.`)');
  const releaseIndex = mailboxClient.indexOf("setDetailsActionBusy(false);", successIndex);
  const refreshIndex = mailboxClient.indexOf("void loadHistory();", successIndex);
  assert.ok(successIndex >= 0);
  assert.ok(releaseIndex > successIndex);
  assert.ok(refreshIndex > releaseIndex);
});
