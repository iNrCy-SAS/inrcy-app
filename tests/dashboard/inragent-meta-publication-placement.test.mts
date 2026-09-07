import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  applyInrAgentPublicationPlacement,
  publicationSettingsForInrAgentChannel,
  readInrAgentPublicationPlacement,
} from "../../lib/inrAgentPublicationPlacement.ts";

function read(relativePath: string) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const client = read("app/dashboard/agent/AgentClient.tsx");
const actionApi = read("app/api/agent/actions/route.ts");
const executeApi = read("app/api/agent/actions/execute/route.ts");
const scheduleApi = read("app/api/agent/actions/schedule/route.ts");
const scheduleClient = read("app/dashboard/agent/_lib/agent.schedule.ts");
const publishNow = read("app/api/booster/publish-now/route.ts");

test("iNrAgent remains Classic by default for old and newly generated actions", () => {
  assert.equal(readInrAgentPublicationPlacement({}, "facebook"), "classic");
  assert.equal(readInrAgentPublicationPlacement({}, "instagram"), "classic");
  assert.equal(publicationSettingsForInrAgentChannel({}, "facebook"), null);
  assert.equal(publicationSettingsForInrAgentChannel({}, "instagram"), null);
  assert.doesNotMatch(
    read("app/api/agent/actions/prepare-publish/route.ts"),
    /(?:facebook|instagram)PublicationSettings\s*:/,
  );
});

test("Facebook and Instagram placements are independent and use the publish-now contract", () => {
  const facebookReel = applyInrAgentPublicationPlacement(
    { postByChannel: { facebook: { content: "Texte Facebook" } } },
    "facebook",
    "reel",
  );
  const withInstagramStory = applyInrAgentPublicationPlacement(
    facebookReel,
    "instagram",
    "story",
  );

  assert.deepEqual(withInstagramStory.facebookPublicationSettings, {
    placement: "reel",
    mediaOnly: true,
  });
  assert.deepEqual(withInstagramStory.instagramPublicationSettings, {
    placement: "story",
    mediaOnly: true,
  });
  assert.deepEqual(
    publicationSettingsForInrAgentChannel(withInstagramStory, "facebook"),
    { placement: "reel" },
  );
  assert.deepEqual(
    publicationSettingsForInrAgentChannel(withInstagramStory, "instagram"),
    { placement: "story" },
  );
});

test("switching back to Classic restores the exact saved text and CTA", () => {
  const original = {
    postByChannel: {
      instagram: {
        title: "Titre conservé",
        content: "Texte manuel ou généré conservé mot pour mot",
        cta: "Appeler",
        ctaPhone: "0622082179",
      },
    },
  };
  const story = applyInrAgentPublicationPlacement(original, "instagram", "story");
  const classic = applyInrAgentPublicationPlacement(story, "instagram", "classic");

  assert.deepEqual(classic.postByChannel, original.postByChannel);
  assert.equal(classic.instagramPublicationSettings, undefined);
  assert.equal(
    (classic.publishPayload as Record<string, unknown>)
      .instagramPublicationSettings,
    undefined,
  );
  assert.equal(readInrAgentPublicationPlacement(classic, "instagram"), "classic");
});

test("the Channel card exposes the selector and media-only mode never erases content", () => {
  assert.match(client, /className=\{styles\.publishChannelCardMain\}/);
  assert.match(client, /className=\{styles\.publishPlacementSelect\}/);
  assert.match(client, /savePublishPlacement/);
  assert.match(client, /publication_mode_media_only_help/);
  assert.match(client, /publishMediaOnly\s*\?/);
  assert.doesNotMatch(
    client,
    /savePublishPlacement[\s\S]{0,2500}?setPostsByChannel\s*\(\s*\{\s*\}\s*\)/,
  );
});

test("the edit API gates optional formats by account preferences and requires media", () => {
  assert.match(actionApi, /editType === "publish_channel_placement"/);
  assert.match(actionApi, /isInstagramPublicationPlacementEnabled/);
  assert.match(actionApi, /isFacebookPublicationPlacementEnabled/);
  assert.match(actionApi, /INR_AGENT_PUBLICATION_PLACEMENT_DISABLED/);
  assert.match(actionApi, /INR_AGENT_PUBLICATION_MEDIA_REQUIRED/);
  assert.match(actionApi, /applyInrAgentPublicationPlacement/);
});

test("immediate and scheduled execution carry the selected placement and all images", () => {
  for (const source of [executeApi, scheduleApi]) {
    assert.match(source, /publicationSettingsForInrAgentChannel/);
    assert.match(source, /instagramPublicationSettings/);
    assert.match(source, /facebookPublicationSettings/);
    assert.match(source, /buildImagePayloadsFromAgentAction/);
    assert.match(source, /images:\s*imagePayloads/);
    assert.match(source, /imagesByChannel/);
  }
  assert.match(scheduleClient, /updateScheduledEditPublishPlacement/);
  assert.match(scheduleClient, /\.\.\.publishPayload/);
  assert.match(publishNow, /normalizeInstagramPublicationSettings/);
  assert.match(publishNow, /normalizeFacebookPublicationSettings/);
});
