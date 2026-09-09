import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) =>
  readFile(new URL(`../../${path}`, import.meta.url), "utf8");

test("Google Business keeps up to five images through Booster publication", async () => {
  const [controller, serverPreparation, publishRoute, googleBusiness] =
    await Promise.all([
      read("app/dashboard/booster/publier/usePublishImageController.ts"),
      read("lib/boosterImageServerPreparation.ts"),
      read("app/api/booster/publish-now/route.ts"),
      read("lib/googleBusiness.ts"),
    ]);

  assert.doesNotMatch(controller, /channel === "gmb"[^\n]*slice\(0,\s*1\)/);
  assert.doesNotMatch(controller, /channel === "gmb"[\s\S]{0,120}\[imageKey\]/);
  assert.match(controller, /return keys\.slice\(0, getBoosterMaxImageCountForChannel\(channel\)\)/);
  assert.match(serverPreparation, /channel === "gmb" \? exactChannelSources\.slice\(0, 5\)/);
  assert.match(publishRoute, /legacyFallback: gmbImageUrls,[\s\S]{0,80}limit: 5/);
  assert.doesNotMatch(publishRoute, /channel === "gmb" \? raw(?:ChannelImages)?\.slice\(0, 1\)/);
  assert.match(googleBusiness, /imageUrls[^\n]*slice\(0, 10\)/);
  assert.match(googleBusiness, /videoUrls[^\n]*slice\(0, 1\)/);
});

test("Google Business selects every uploaded image by default like the other channels", async () => {
  const shared = await read(
    "app/dashboard/booster/publier/publishModal.shared.tsx",
  );

  assert.match(shared, /const supportsImages = channelSupportsImages\(channel\)/);
  assert.doesNotMatch(
    shared,
    /channel === "gmb" \|\| !channelSupportsImages\(channel\)/,
  );
  assert.doesNotMatch(shared, /channel === "gmb"\s*\? \[\]\s*:\s*\[\.\.\.imageKeys\]/);
});

test("Booster no longer shows Google Business single-photo warnings", async () => {
  const [panel, modal, warningModals, shared] = await Promise.all([
    read("app/dashboard/booster/publier/components/PublishImagesPanel.tsx"),
    read("app/dashboard/booster/publier/PublishModal.tsx"),
    read("app/dashboard/booster/publier/components/PublishWarningModals.tsx"),
    read("app/dashboard/booster/publier/publishModal.shared.tsx"),
  ]);

  const joined = [panel, modal, warningModals, shared].join("\n");
  assert.doesNotMatch(joined, /1 seule photo par publication/i);
  assert.doesNotMatch(joined, /uniquement la première photo/i);
  assert.doesNotMatch(joined, /Aucune photo Google Business/i);
  assert.doesNotMatch(joined, /gmbNoImageWarning/i);
});

test("iNrSend can retain five Google Business images during an edit", async () => {
  const [client, details, actions] = await Promise.all([
    read("app/dashboard/mails/MailboxClient.tsx"),
    read("app/dashboard/mails/_components/MailboxDetailsModal.tsx"),
    read("lib/inrsend/publicationChannelActions.ts"),
  ]);

  assert.doesNotMatch(client, /channel === "gmb" \|\| channel === "pinterest"/);
  assert.doesNotMatch(details, /activePublicationEditChannelKey === "gmb" \|\|/);
  assert.match(actions, /gmbImageUrls[\s\S]{0,180}\.slice\(0, 5\)/);
});
