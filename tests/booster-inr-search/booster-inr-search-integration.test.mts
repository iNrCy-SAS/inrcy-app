import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import test from "node:test";
import {
  INR_SEARCH_CONTENT_MAX_LENGTH,
  limitBoosterChannelContent,
} from "../../lib/boosterChannelRules.ts";
import { sanitizeInrAgentAutomationSettings } from "../../lib/inrAgentSettings.ts";

const root = process.cwd();
const read = (relativePath: string) =>
  readFile(join(root, relativePath), "utf8");

test("iNrSearch content is capped at 300 characters before publication", () => {
  const longText = "x".repeat(INR_SEARCH_CONTENT_MAX_LENGTH + 40);
  assert.equal(
    limitBoosterChannelContent("inr_search", longText).length,
    INR_SEARCH_CONTENT_MAX_LENGTH,
  );
  assert.equal(limitBoosterChannelContent("facebook", longText), longText);
});

test("Booster exposes iNrSearch in content, generation and image channel flows", async () => {
  const [modal, foundations, imageController, contentEditor, mediaPanel, shared, prompt, generation] =
    await Promise.all([
      read("app/dashboard/booster/publier/PublishModal.tsx"),
      read("app/dashboard/booster/publier/publishModal.foundations.ts"),
      read("app/dashboard/booster/publier/usePublishImageController.ts"),
      read("app/dashboard/booster/publier/components/PublishContentEditorPanel.tsx"),
      read("app/dashboard/booster/publier/components/PublishImagesPanel.tsx"),
      read("app/dashboard/booster/publier/publishModal.shared.tsx"),
      read("lib/boosterPrompt.ts"),
      read("lib/boosterPublishGeneration.ts"),
    ]);

  assert.match(foundations, /CHANNEL_KEYS: ChannelKey\[\] = BOOSTER_CHANNEL_ORDER/);
  assert.match(modal, /CHANNEL_KEYS\.filter\(\(channel\) => channels\[channel\] && connected\[channel\]\)/);
  assert.match(imageController, /BOOSTER_CHANNEL_ORDER\.filter/);
  assert.match(contentEditor, /i18nT\("phrase_courte_inr_search_ee6e97e1"\)/);
  assert.match(mediaPanel, /gridTemplateColumns: isMobile/);
  assert.match(mediaPanel, /repeat\(2, minmax\(0, 1fr\)\)/);
  assert.match(mediaPanel, /overflowX: "hidden"/);
  assert.match(shared, /content: INR_SEARCH_CONTENT_MAX_LENGTH/);
  assert.match(shared, /"site_web",\s*"gmb",\s*"inr_search"/);
  assert.match(prompt, /INR_SEARCH_CONTENT_MAX_LENGTH/);
  assert.match(generation, /inr_search:\s*12/);
  assert.match(generation, /limitBoosterGeneratedContent/);
});

test("the immediate and iNrSend publication paths enforce the same iNrSearch limit", async () => {
  const [publishRoute, channelContext, inrSend] = await Promise.all([
    read("app/api/booster/publish-now/route.ts"),
    read("app/api/booster/publish-now/publishNow.channel-context.ts"),
    read("lib/inrsend/publicationChannelActions.ts"),
  ]);

  assert.match(publishRoute, /createPublishNowPostResolver/);
  assert.match(channelContext, /limitBoosterChannelContent/);
  assert.match(inrSend, /limitBoosterChannelContent/);
});

test("iNrSearch is available in iNrAgent between Google Business and Facebook", async () => {
  const [agentConfig, agentSettings, preparePublish] = await Promise.all([
    read("app/dashboard/agent/_lib/agent.config.ts"),
    read("lib/inrAgentSettings.ts"),
    read("app/api/agent/actions/prepare-publish/route.ts"),
  ]);

  assert.match(agentConfig, /"gmb",\s*\n\s*"inrSearch",\s*\n\s*"facebook"/);
  assert.match(agentSettings, /"gmb", "inr_search", "facebook"/);
  assert.match(preparePublish, /inr_search/);
});

test("legacy iNrAgent publish settings receive iNrSearch once without overriding a later opt-out", () => {
  const migrated = sanitizeInrAgentAutomationSettings("publish", {
    allowedChannels: ["gmb", "facebook"],
    metadata: {},
  });
  assert.deepEqual(migrated.allowedChannels, ["gmb", "facebook", "inr_search"]);
  assert.equal(migrated.metadata.inrSearchChannelAdded, true);

  const optedOut = sanitizeInrAgentAutomationSettings("publish", {
    allowedChannels: ["gmb", "facebook"],
    metadata: { inrSearchChannelAdded: true },
  });
  assert.deepEqual(optedOut.allowedChannels, ["gmb", "facebook"]);
});
