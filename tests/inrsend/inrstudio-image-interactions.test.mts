import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildSiteImageInteractionMetadata,
  imageInteractionsFromOverlay,
} from "../../lib/imageInteractions.ts";

const read = (file: string) => readFileSync(file, "utf8");

const interactions = imageInteractionsFromOverlay({
  items: [
    {
      id: "book",
      text: "Réserver",
      linkUrl: "https://example.test/reserver",
      x: 50,
      y: 75,
      width: 30,
      height: 12,
    },
  ],
});

test("iNrSend keeps Studio interactions beside the baked image", () => {
  const mailbox = read("app/dashboard/mails/MailboxClient.tsx");
  const types = read("app/dashboard/mails/_lib/mailboxPhase1.tsx");

  assert.match(mailbox, /withMediaImageInteractions\(dimensions, item\)/);
  assert.match(mailbox, /imageMeta: asset\.imageMeta \|\| null/g);
  assert.match(types, /interactions\?: ImageInteractions/g);
  assert.doesNotMatch(
    mailbox,
    /withMediaImageInteractions\([^)]*transform\.overlay/,
  );
});

test("iNrSend upload and site update retain aligned interaction metadata", () => {
  const actions = read("lib/inrsend/publicationChannelActions.ts");

  assert.match(actions, /imageMeta: img\.imageMeta \|\| null/g);
  assert.match(
    actions,
    /buildSiteImageInteractionMetadata\(\s*siteAttachments,\s*siteImageKeys,\s*siteImages\.length/,
  );
  assert.match(
    actions,
    /imageMediaMetadata\.imageInteractions = siteImageInteractions/,
  );
  assert.match(actions, /: \{ media_metadata: imageMediaMetadata \}/);
});

test("iNrSend converts an image interaction into a channel CTA without leaking it to video", () => {
  const actions = read("lib/inrsend/publicationChannelActions.ts");

  assert.match(
    actions,
    /const imageInteractionLink =\s*mediaType === "images"\s*\? getPrimaryImageInteractionLink\(imageSet\?\.editableAttachments \|\| \[\]\)\s*:\s*null/,
  );
  assert.match(
    actions,
    /const interactionAwarePost = applyImageInteractionCtaFallback\(\s*channel,\s*nextPost,\s*facebookStoryLinkUnsupported \? null : imageInteractionLink/,
  );
  assert.equal(
    (actions.match(/nextPost: interactionAwarePost/g) || []).length,
    2,
  );
  assert.match(
    actions,
    /getBoosterCtaDestinationUrlForChannel\("linkedin", nextPost/,
  );
  assert.equal(
    (actions.match(/landingPageUrl: linkedInLandingPageUrl/g) || []).length,
    3,
  );
});

test("iNrSend keeps Facebook Story image links visible without inventing a native sticker", () => {
  const actions = read("lib/inrsend/publicationChannelActions.ts");

  assert.match(
    actions,
    /channel === "facebook"\s*&&\s*isFacebookStoryOnlyPublication\(ctx\.eventPayload\)\s*&&\s*imageInteractionLink/,
  );
  assert.match(actions, /facebook_story_link_sticker_required/);
  assert.match(
    actions,
    /l’API Facebook ne permet pas d’ajouter un sticker Lien cliquable à une Story/,
  );
});

test("site metadata keeps empty slots and never turns interactions into a visual overlay", () => {
  const attachments = [
    { imageKey: "plain", imageMeta: null },
    { imageKey: "linked", imageMeta: { interactions } },
  ];
  const metadata = buildSiteImageInteractionMetadata(
    attachments,
    ["plain", "linked"],
    2,
  );

  assert.deepEqual(metadata[0], null);
  assert.deepEqual(metadata[1]?.interactions, interactions);
  assert.equal("overlay" in (metadata[1]?.interactions || {}), false);
});
