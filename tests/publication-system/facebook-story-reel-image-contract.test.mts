import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DEFAULT_FACEBOOK_PUBLICATION_PREFERENCES,
  coerceFacebookPublicationPlacement,
  getEnabledFacebookPublicationPlacements,
  normalizeFacebookPublicationPreferences,
} from "../../lib/facebookPublicationPreferences.ts";

function read(relativePath: string) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const modal = read("app/dashboard/booster/publier/PublishModal.tsx");
const editor = read(
  "app/dashboard/booster/publier/components/PublishContentEditorPanel.tsx",
);
const route = read("app/api/booster/publish-now/route.ts");
const foundations = read(
  "app/api/booster/publish-now/publishNow.foundations.ts",
);
const provider = read("lib/facebookPublish.ts");
const ingress = read("lib/boosterPublicationIngress.ts");
const dedupe = read("lib/scheduledPublicationDedupe.ts");
const panel = read("app/dashboard/_components/FacebookPanel.tsx");
const hook = read("app/dashboard/_hooks/channels/useFacebookChannel.ts");
const api = read(
  "app/api/integrations/facebook/publication-preferences/route.ts",
);
const sql = read("ops/sql/2026-09-07_facebook_publication_preferences.sql");

test("Facebook keeps Classic available and safely coerces disabled optional modes", () => {
  assert.equal(DEFAULT_FACEBOOK_PUBLICATION_PREFERENCES.defaultMode, "classic");
  const disabled = normalizeFacebookPublicationPreferences({
    reelsEnabled: false,
    storiesEnabled: false,
    defaultMode: "story",
  });
  assert.deepEqual(getEnabledFacebookPublicationPlacements(disabled), ["classic"]);
  assert.equal(
    coerceFacebookPublicationPlacement("reel", disabled),
    "classic",
  );
});

test("Configurer Facebook exposes Classic, Reel, Story and an account default", () => {
  assert.match(panel, /type="checkbox" checked disabled/);
  assert.match(panel, /facebookPublicationPreferences\.reelsEnabled/);
  assert.match(panel, /facebookPublicationPreferences\.storiesEnabled/);
  assert.match(panel, /facebookPublicationPreferences\.defaultMode/);
  assert.match(hook, /\/api\/integrations\/facebook\/publication-preferences/);
  assert.match(api, /requireUser\(\)/);
  assert.match(api, /inrcy_set_facebook_publication_preferences/);
  assert.match(sql, /security invoker/i);
  assert.match(sql, /for update;/i);
  assert.match(sql, /inrcy_can_access_account/);
});

test("Booster exposes Facebook formats and disables text only for Stories", () => {
  assert.match(editor, /activeCard === "facebook" \? \(/);
  assert.match(editor, /value=\{facebookPublicationPlacement\}/);
  assert.match(editor, /<option value="classic"/);
  assert.match(editor, /facebookPublicationPreferences\.reelsEnabled/);
  assert.match(editor, /facebookPublicationPreferences\.storiesEnabled/);
  assert.match(
    editor,
    /const facebookMediaOnly =[\s\S]*?activeCard === "facebook" && facebookPublicationPlacement === "story"/,
  );
  assert.match(editor, /disabled=\{activeMediaOnly\}/);
  assert.doesNotMatch(editor, /setPostsByChannel\(\{\}\).*facebookMediaOnly/);
  assert.match(modal, /facebookPublicationPlacement:\s*nextFacebookPublicationPlacement/);
});

test("immediate, scheduled and single-channel continuation payloads keep the Facebook mode", () => {
  assert.ok(
    (modal.match(/facebookPublicationSettings:/g) || []).length >= 2,
    "immediate and scheduled payloads must carry the setting",
  );
  assert.match(ingress, /facebookPublicationSettings: body\.facebookPublicationSettings/);
  assert.match(route, /normalizeFacebookPublicationSettings\(body\.facebookPublicationSettings\)/);
  assert.match(route, /channel === "facebook" && facebookPublicationSettings/);
  assert.match(dedupe, /facebook-placement:/);
  assert.match(foundations, /FacebookPublicationSettings[\s\S]*?mediaOnly: boolean/);
  assert.match(foundations, /mediaOnly: story/);
});

test("Facebook Reel and Story require media and image inputs become an 8-second 9:16 music video", () => {
  assert.match(
    modal,
    /publishableChannels\.includes\("facebook"\)[\s\S]*?facebookPublicationPlacement !== "classic"[\s\S]*?facebookMode === "none"/,
  );
  assert.match(
    route,
    /facebookPublicationSettings &&[\s\S]*?mediaModeByChannel\[ch\] === "images"[\s\S]*?createFacebookImageMotionVideo/,
  );
  assert.match(route, /videoSettingsByChannel\.facebook = \{[\s\S]*?format: "9_16"/);
  assert.match(read("lib/facebookImageMotionVideo.ts"), /createInstagramImageMotionVideo/);
  assert.match(read("lib/instagramImageMotionVideo.ts"), /const OUTPUT_DURATION_SECONDS = 8/);
  assert.match(read("lib/instagramImageMotionVideo.ts"), /loadAiMediaSoundtrack/);
});

test("Facebook sends text and hashtags with Reels while Stories remain media-only", () => {
  assert.match(provider, /placement === "story" \? "video_stories" : "video_reels"/);
  assert.match(provider, /upload_phase", "start"/);
  assert.match(provider, /Authorization: `OAuth \$\{pageAccessToken\}`/);
  assert.match(provider, /file_url: hostedVideoUrl/);
  assert.match(provider, /upload_phase", "finish"/);
  assert.match(provider, /video_state", "PUBLISHED"/);
  const verticalStart = provider.indexOf("facebookPublishVerticalVideoToPage");
  assert.notEqual(verticalStart, -1);
  const verticalSource = provider.slice(verticalStart);
  assert.match(
    verticalSource,
    /if \(placement === "reel"\)[\s\S]*?finish\.append\("description", reelDescription\)/,
  );
  assert.match(verticalSource, /finish\.append\("title", reelTitle\)/);
  assert.match(
    route,
    /facebookPublishVerticalVideoToPage\(\{[\s\S]*?placement:[\s\S]*?description:[\s\S]*?buildBoosterHashtagLine\(channelPost, canonMessage, 8\)/,
  );
  assert.match(
    route,
    /facebookPublicationSettings\.placement === "reel"[\s\S]*?: undefined/,
  );
});

test("server-side preference gate runs before durable ingress", () => {
  const gate = route.indexOf("getFacebookPlacementPreflightFailure");
  const ingressCall = route.indexOf("enqueueBoosterPublication({");
  assert.ok(gate >= 0 && ingressCall > gate);
  assert.match(route, /facebook_publication_mode_disabled/);
  assert.match(route, /isFacebookPublicationPlacementEnabled/);
});
