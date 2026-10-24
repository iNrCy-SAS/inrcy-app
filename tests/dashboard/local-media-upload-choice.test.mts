import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

test("the local upload chooser separates images and video in an accessible dialog", () => {
  const component = read("app/dashboard/_components/LocalMediaUploadChoice.tsx");
  assert.match(component, /createPortal\(/);
  assert.match(component, /role="dialog"/);
  assert.match(component, /aria-modal="true"/);
  assert.match(component, /event\.key === "Escape"/);
  assert.match(component, /event\.preventDefault\(\)/);
  assert.match(component, /event\.stopPropagation\(\)/);
  assert.match(component, /event\.stopImmediatePropagation\(\)/);
  assert.match(component, /data-local-media-choice="image"/);
  assert.match(component, /data-local-media-choice="video"/);
  assert.match(component, /image\.maxSelection \?\? 5/);
  assert.match(component, /local_upload_video_detail/);
});

test("the local upload dialog stays above the settings drawer", () => {
  const chooserStyles = read("app/dashboard/_components/LocalMediaUploadChoice.module.css");
  const settingsDrawer = read("app/dashboard/SettingsDrawer.tsx");
  const chooserZIndex = Number(
    chooserStyles.match(/\.backdrop\s*\{[\s\S]*?z-index:\s*(\d+)/)?.[1],
  );
  const drawerZIndex = Number(settingsDrawer.match(/zIndex:\s*(\d+)/)?.[1]);

  assert.ok(Number.isSafeInteger(chooserZIndex));
  assert.ok(Number.isSafeInteger(drawerZIndex));
  assert.ok(chooserZIndex > drawerZIndex);
  assert.ok(chooserZIndex < 2_147_483_647);
});

test("creation and edition surfaces preserve separate image and video choices", () => {
  const surfaces = [
    ["app/dashboard/booster/publier/components/PublishImagesPanel.tsx", "booster-publication-local-media-choice"],
    ["app/dashboard/ads/AdsClient.tsx", "ads-local-media-choice"],
    ["app/dashboard/agent/AgentClient.tsx", "agent-local-media-choice"],
    ["app/dashboard/mails/_components/MailboxDetailsModal.tsx", "mailbox-image-publication-local-media-choice"],
  ];

  for (const [surface, testId] of surfaces) {
    const source = read(surface);
    assert.match(source, /LocalMediaUploadChoice/, surface);
    assert.ok(source.includes(testId), `${surface}: ${testId}`);
  }
  const intent = read("app/dashboard/booster/publier/components/PublishIntentPanel.tsx");
  const picker = read("app/dashboard/booster/publier/components/PublishReferencePicker.tsx");
  assert.match(intent, /<PublishReferencePicker/);
  assert.match(picker, /data-testid="booster-reference-add"/);
  assert.match(picker, /key: "image"[\s\S]*?local_upload_image/);
  assert.match(picker, /key: "video"[\s\S]*?local_upload_video/);
  assert.match(picker, /if \(!choice.disabled\) choose\(choice.onSelect\)/);
  assert.match(picker, /role="dialog"[\s\S]*?aria-modal="true"/);
  assert.match(picker, /event.key === "Escape"/);
});

test("image file inputs stay multiple where five images are supported and videos stay single", () => {
  const booster = read("app/dashboard/booster/publier/components/PublishIntentPanel.tsx");
  assert.match(booster, /accept=\{BOOSTER_IMAGE_ACCEPT\}[\s\S]{0,100}?multiple/);
  assert.doesNotMatch(booster, /accept=\{BOOSTER_VIDEO_ACCEPT\}[\s\S]{0,100}?multiple/);

  const agent = read("app/dashboard/agent/AgentClient.tsx");
  assert.match(agent, /id="agent-publish-media-image"[\s\S]{0,140}?multiple/);
  assert.doesNotMatch(agent, /id="agent-publish-media-video"[\s\S]{0,140}?multiple/);

  const mailbox = read("app/dashboard/mails/_components/MailboxDetailsModal.tsx");
  const mailboxImageInput = mailbox.slice(
    mailbox.indexOf("id={publicationEditFileInputId}"),
    mailbox.indexOf("id={publicationVideoInputId}"),
  );
  const mailboxVideoInput = mailbox.slice(
    mailbox.indexOf("id={publicationVideoInputId}"),
    mailbox.indexOf("<MediaOptimizerModal"),
  );
  assert.match(mailboxImageInput, /multiple/);
  assert.doesNotMatch(mailboxVideoInput, /multiple/);
});

test("all locale catalogues expose the shared media chooser labels", () => {
  const keys = [
    "local_upload_trigger",
    "local_upload_dialog_title",
    "local_upload_dialog_description",
    "local_upload_image",
    "local_upload_images_detail",
    "local_upload_video",
    "local_upload_video_detail",
    "local_upload_close",
    "local_upload_unavailable",
  ];
  for (const locale of [
    "fr-FR",
    "en-GB",
    "es-ES",
    "it-IT",
    "de-DE",
    "nl-NL",
    "pt-PT",
    "th-TH",
    "zh-CN",
  ]) {
    const catalogue = JSON.parse(read(`messages/${locale}/media.json`));
    for (const key of keys) {
      assert.equal(typeof catalogue[key], "string", `${locale}.${key}`);
      assert.ok(catalogue[key].trim().length > 0, `${locale}.${key}`);
    }
  }
});

