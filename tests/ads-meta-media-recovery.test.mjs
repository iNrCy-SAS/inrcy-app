import { withUiCopy } from "./helpers/localized-ui-source.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import { mergeMetaCreativeAssetUrls } from "../lib/adsCampaignMediaPolicy.ts";

const generator = readFileSync(new URL("../app/dashboard/ads/AdsCampaignAutoMediaGenerator.tsx", import.meta.url), "utf8");
const client = readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8");
const mediaPack = readFileSync(new URL("../app/dashboard/ads/MetaAdsMediaPack.tsx", import.meta.url), "utf8");

test("un visuel Meta accepté reste associé si le second format échoue", () => {
  assert.match(withUiCopy(generator), /const metaResults: MetaPackResults = \{\};/);
  assert.match(withUiCopy(generator), /const accepted = await acceptDraft\(generated\);\s*if \(slot === "feed"\) metaResults\.feed = accepted;\s*else metaResults\.storyReel = accepted;/);
  assert.match(withUiCopy(generator), /if \(provider === "meta" && \(metaResults\.feed \|\| metaResults\.storyReel\)\) \{\s*callbacksRef\.current\.onMetaPackComplete\(metaResults, message\);/);
  assert.match(withUiCopy(client), /onMetaPackComplete=\{\(results, generationError\) => \{/);
  assert.match(withUiCopy(client), /mergeMetaCreativeAssetUrls\(current\.metaCreativeAssets/);
  assert.match(withUiCopy(client), /if \(generationError \|\| \(needsFeed && !feedImageUrl\) \|\| \(needsStoryReel && !storyReelImageUrl\)\) \{/);
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
  assert.match(withUiCopy(client), /const selected = draft\.metaPlacements\.includes\(option\.value\);/);
  assert.match(withUiCopy(client), /const disabled = Boolean\(option\.disabled && !selected\);/);
  assert.match(withUiCopy(client), /<input type="checkbox" disabled=\{disabled\} checked=\{selected\}/);
  assert.match(withUiCopy(client), /\{ value: "messenger", label: "Messenger", format: "bientôt", disabled: true \}/);
});

test("le pack Meta ne déclare prêt qu’un visuel dont les dimensions et le ratio ont été contrôlés", () => {
  assert.match(withUiCopy(mediaPack), /validateMetaCreativeDimensions/);
  assert.match(withUiCopy(mediaPack), /width: image\.naturalWidth, height: image\.naturalHeight/);
  assert.match(withUiCopy(mediaPack), /dimensionValidation\.valid\s*\? "valid"\s*:\s*"invalid"/);
  assert.match(withUiCopy(mediaPack), /formatStatus === "valid"\s*\? "ready"/);
  assert.doesNotMatch(withUiCopy(mediaPack), /hasImage\s*\?\s*"ready"/);
  assert.match(withUiCopy(mediaPack), /Dimensions non vérifiables dans l’aperçu\. Le serveur les contrôlera/);
  assert.match(withUiCopy(client), /metaMediaFormatStatus\.feed === "invalid"/);
  assert.match(withUiCopy(client), /Feed 4:5 à vérifier/);
  assert.match(withUiCopy(client), /step === mediaStep && channelId === "meta" && !livePublisherMediaReady/);
  assert.match(withUiCopy(client), /Pack média obligatoire/);
  assert.doesNotMatch(withUiCopy(client), /if \(dx < 0 && current === mediaStep && channelId === "meta" && !livePublisherMediaReady\) return current/);
  assert.doesNotMatch(withUiCopy(client), /disabled=\{busy === "plan"[^}]*step === mediaStep && channelId === "meta"/);
});
