import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { mergeMetaCreativeAssetUrls } from "../lib/adsCampaignMediaPolicy.ts";

const generator = readFileSync(new URL("../app/dashboard/ads/AdsCampaignAutoMediaGenerator.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8");
const mediaPack = readFileSync(new URL("../app/dashboard/ads/MetaAdsMediaPack.tsx", import.meta.url), "utf8");

test("un visuel Meta accepté reste associé si le second format échoue", () => {
  assert.match(generator, /const metaResults: MetaPackResults = \{\};/);
  assert.match(generator, /const accepted = await acceptDraft\(generated\);\s*if \(slot === "feed"\) metaResults\.feed = accepted;\s*else metaResults\.storyReel = accepted;/);
  assert.match(generator, /if \(provider === "meta" && \(metaResults\.feed \|\| metaResults\.storyReel\)\) \{\s*callbacksRef\.current\.onMetaPackComplete\(metaResults, message\);/);
  assert.match(client, /onMetaPackComplete=\{\(results, generationError\) => \{/);
  assert.match(client, /mergeMetaCreativeAssetUrls\(current\.metaCreativeAssets/);
  assert.match(client, /if \(generationError \|\| \(needsFeed && !feedImageUrl\) \|\| \(needsStoryReel && !storyReelImageUrl\)\) \{/);
  assert.deepEqual(
    mergeMetaCreativeAssetUrls(
      { feedImageUrl: "https://cdn.test/feed.jpg", storyReelImageUrl: "" },
      { feedImageUrl: "", storyReelImageUrl: "https://cdn.test/story.jpg" },
    ),
    {
      feedImageUrl: "https://cdn.test/feed.jpg",
      storyReelImageUrl: "https://cdn.test/story.jpg",
    },
  );
  assert.deepEqual(
    mergeMetaCreativeAssetUrls(
      { feedImageUrl: "https://cdn.test/feed.jpg", storyReelImageUrl: "https://cdn.test/story.jpg" },
      { feedImageUrl: "", storyReelImageUrl: "" },
    ),
    {
      feedImageUrl: "https://cdn.test/feed.jpg",
      storyReelImageUrl: "https://cdn.test/story.jpg",
    },
  );
});

test("Messenger existant peut être décoché sans redevenir sélectionnable", () => {
  assert.match(client, /const selected = draft\.metaPlacements\.includes\(option\.value\);/);
  assert.match(client, /const disabled = Boolean\(option\.disabled && !selected\);/);
  assert.match(client, /<input type="checkbox" disabled=\{disabled\} checked=\{selected\}/);
  assert.match(client, /\{ value: "messenger", label: "Messenger", format: "bientôt", disabled: true \}/);
});

test("le pack Meta ne déclare prêt qu’un visuel dont les dimensions et le ratio ont été contrôlés", () => {
  assert.match(mediaPack, /validateMetaCreativeDimensions/);
  assert.match(mediaPack, /width: image\.naturalWidth, height: image\.naturalHeight/);
  assert.match(mediaPack, /dimensionValidation\.valid\s*\? "valid"\s*:\s*"invalid"/);
  assert.match(mediaPack, /formatStatus === "valid"\s*\? "ready"/);
  assert.doesNotMatch(mediaPack, /hasImage\s*\?\s*"ready"/);
  assert.match(mediaPack, /Dimensions non vérifiables dans l’aperçu\. Le serveur les contrôlera/);
  assert.match(client, /metaMediaFormatStatus\.feed === "invalid"/);
  assert.match(client, /Feed 4:5 à vérifier/);
  assert.match(client, /step === mediaStep && channelId === "meta" && !livePublisherMediaReady/);
  assert.match(client, /Pack média obligatoire/);
});
