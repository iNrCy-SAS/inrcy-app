import { readFileSync as readSubmissionSource } from "node:fs";
const submission = readSubmissionSource(new URL("../../app/dashboard/booster/publier/publicationSubmission.ts", import.meta.url), "utf8");
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { Children, isValidElement, type ReactElement, type ReactNode } from "react";
import ts from "typescript";
import { getMetaImageMotionDuration } from "../../lib/metaImageMotionTiming.ts";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";

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
const { findSimilarScheduledPublication } = runtimeModules()<typeof import("../../lib/scheduledPublicationDedupe.ts")>("lib/scheduledPublicationDedupe.ts");
const channelWorkspace = read("app/dashboard/_components/DashboardChannelWorkspace.tsx");
const channelBubble = read("app/dashboard/_components/DashboardFluxBubble.tsx");
const publicationTypes = read("app/dashboard/_components/ChannelPublicationTypes.tsx");
const hook = read("app/dashboard/_hooks/channels/useFacebookChannel.ts");
const api = read(
  "app/api/integrations/facebook/publication-preferences/route.ts",
);
const sql = read("ops/sql/2026-09-07_facebook_publication_preferences.sql");
const require = createRequire(import.meta.url);
const validationOptions: { default?: (props: Record<string, unknown>) => ReactNode } = {};
new Function("exports", "require", ts.transpileModule(read("app/dashboard/booster/publier/components/PublishValidationChannelOptions.tsx"), {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true },
}).outputText)(validationOptions, (name: string) => {
  if (name === "next-intl") return { useTranslations: () => (key: string) => key };
  if (name.endsWith(".css")) return { __esModule: true, default: new Proxy({}, { get: (_target, key) => String(key) }) };
  if (name === "@/lib/metaImageMotionTiming") return { getMetaImageMotionDuration };
  return require(name);
});
function elements(node: ReactNode): Array<ReactElement<Record<string, unknown>>> {
  return Children.toArray(node).flatMap(child => isValidElement<Record<string, unknown>>(child)
    ? [child, ...elements(child.props.children as ReactNode)] : []);
}

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

test("the Facebook bubble exposes Classic, Reel, Story and an account default", () => {
  const facebookBubble = channelWorkspace.slice(
    channelWorkspace.indexOf('case "facebook":'),
    channelWorkspace.indexOf('case "instagram":'),
  );
  assert.match(facebookBubble, /publicationTypes: \{ value: fb\.facebookPublicationPreferences/);
  assert.match(facebookBubble, /onLoad: fb\.loadFacebookPublicationPreferences/);
  assert.match(facebookBubble, /onChange: fb\.saveFacebookPublicationPreferences/);
  assert.match(channelBubble, /connection\?\.publicationTypes && hasResource \? <ChannelPublicationTypes name=\{item\.name\} channel=\{item\.key\} settings=\{connection\.publicationTypes\}/);
  assert.match(publicationTypes, /mode: "classic", label: "instagram_classic_mode", checked: true/);
  assert.match(publicationTypes, /type="checkbox" checked=\{option\.checked\} disabled=\{busy \|\| option\.mode === "classic"\}/);
  assert.match(publicationTypes, /checked: settings\.value\.reelsEnabled, key: "reelsEnabled"/);
  assert.match(publicationTypes, /checked: settings\.value\.storiesEnabled, key: "storiesEnabled"/);
  assert.match(publicationTypes, /then\(settings\.onLoad\)/);
  assert.match(publicationTypes, /await settings\.onChange\(patch\)/);
  assert.match(publicationTypes, /change\(\{ \[option\.key\]: event\.target\.checked \}\)/);
  assert.match(publicationTypes, /change\(\{ defaultMode: option\.mode \}\)/);
  assert.match(hook, /const loadFacebookPublicationPreferences = useCallback/);
  assert.match(hook, /const saveFacebookPublicationPreferences = useCallback/);
  assert.match(hook, /\/api\/integrations\/facebook\/publication-preferences/);
  assert.match(api, /requireUser\(\)/);
  assert.match(api, /inrcy_set_facebook_publication_preferences/);
  assert.match(sql, /security invoker/i);
  assert.match(sql, /for update;/i);
  assert.match(sql, /inrcy_can_access_account/);
});

test("Validation exposes one primary Facebook format plus an independent optional Story", () => {
  assert.ok(validationOptions.default);
  const state = { placement: "classic", story: false };
  const placementCalls: string[] = [];
  const preferences = { reelsEnabled: true, storiesEnabled: true };
  const controls = () => elements(validationOptions.default!({
    channel: "facebook", facebookPublicationPlacement: state.placement,
    facebookStoryEnabled: state.story, facebookPublicationPreferences: preferences,
    onFacebookPublicationPlacementChange: (value: string) => { placementCalls.push(value); state.placement = value; },
    onFacebookStoryEnabledChange: (value: boolean) => { state.story = value; },
  }));
  const input = (type: string, value?: string) => {
    const element = controls().find(element => element.type === "input" && element.props.type === type && (!value || element.props.value === value));
    assert.ok(element, `Real Facebook ${type} ${value || "Story"} control must exist`);
    return element.props;
  };
  assert.equal(controls().filter(element => element.props.role === "radiogroup").length, 1);
  assert.equal(controls().filter(element => element.type === "input" && element.props.type === "radio").length, 2);
  assert.equal(input("radio", "classic").name, input("radio", "reel").name, "Primary formats share one native radio group");
  assert.equal(input("radio", "classic").checked, true);
  assert.equal(input("radio", "reel").checked, false);
  (input("radio", "reel").onChange as () => void)();
  assert.equal(state.placement, "reel");
  assert.equal(input("radio", "classic").checked, false);
  (input("checkbox").onChange as (event: { target: { checked: boolean } }) => void)({ target: { checked: true } });
  (input("radio", "classic").onChange as () => void)();
  assert.deepEqual(state, { placement: "classic", story: true }, "Changing the primary format preserves the additional Story");
  state.placement = "story"; state.story = false;
  assert.equal(input("checkbox").checked, true, "Saved Story-only drafts retain their visible intent");
  (input("radio", "reel").onChange as () => void)();
  assert.deepEqual(state, { placement: "reel", story: true });
  preferences.reelsEnabled = false; preferences.storiesEnabled = false;
  assert.equal(input("radio", "reel").disabled, true);
  assert.equal(input("checkbox").disabled, true);
  const previousCallCount = placementCalls.length;
  (input("radio", "reel").onChange as () => void)();
  assert.equal(placementCalls.length, previousCallCount, "An unavailable control cannot call the format setter");
  assert.match(modal, /<PublishValidationChannelOptions\s+channel=\{channel\}/);
  assert.match(modal, /facebookPublicationPlacement=\{facebookPublicationPlacement\}/);
  assert.match(modal, /facebookStoryEnabled=\{facebookStoryEnabled\}/);
  assert.doesNotMatch(editor, /<MetaPublicationFormatControls|data-channel-validation-options/);
  assert.doesNotMatch(editor, /activeMediaOnly/);
  assert.match(
    modal,
    /buildMetaPublicationSelection\([\s\S]*?facebookPublicationPlacement,[\s\S]*?facebookStoryEnabled/,
  );
});

test("immediate, scheduled and single-channel continuation payloads keep the Facebook mode", async () => {
  assert.ok(
    (submission.match(/facebookPublicationSettings:/g) || []).length >= 2,
    "immediate and scheduled payloads must carry the setting",
  );
  assert.match(ingress, /facebookPublicationSettings: body\.facebookPublicationSettings/);
  assert.match(route, /normalizeMetaPublicationSelection\(body\.facebookPublicationSettings\)/);
  assert.match(route, /channel === "facebook"[\s\S]*?getMetaTargetSettings\(target\.placement\)/);
  assert.match(route, /channel === "facebook" && targetFacebookPublicationSettings/);
  // Exercise placement-sensitive deduplication rather than its internal key spelling.
  const scheduledAt = "2099-01-01T10:00:00Z";
  const post = { title: "Publication actuelle", content: "Un autre texte" };
  const image = { storagePath: "account/media/photo.jpg" };
  const supabase = { from: () => {
    const query = { select() { return this; }, eq() { return this; }, in() { return this; }, gte() { return this; }, lte() { return this; },
      async limit() { return { data: [{ id: "scheduled-one", channels: ["facebook"], scheduled_at: scheduledAt,
        payload: { publishPayload: { post: { title: "Publication programmée", content: "Texte précédent" }, images: [image], facebookPublicationSettings: { primaryPlacement: "classic", includeStory: false } } } }], error: null }; } };
    return query;
  } };
  for (const [placement, duplicate] of [["classic", true], ["reel", false], ["story", false]] as const) {
    const result = await findSimilarScheduledPublication({ supabase, userId: "account", channels: ["facebook"], scheduledAt,
      payload: { post, images: [image], facebookPublicationSettings: { primaryPlacement: placement, includeStory: false } } });
    assert.equal(result.duplicate, duplicate, `Facebook ${placement}`);
  }
  assert.match(foundations, /FacebookPublicationSettings[\s\S]*?mediaOnly: boolean/);
  assert.match(foundations, /mediaOnly: story/);
});

test("Facebook Reel and Story require media and use per-image timing for their 9:16 music videos", () => {
  assert.match(
    submission,
    /publishableChannels\.includes\("facebook"\)[\s\S]*?facebookPublicationPlacement === "reel" \|\| facebookPublicationPlacement === "story"[\s\S]*?facebookMode === "none"/,
  );
  assert.match(
    route,
    /facebookPublicationSettings &&[\s\S]*?mediaModeByChannel\[ch\] === "images"[\s\S]*?createFacebookImageMotionVideo/,
  );
  assert.match(route, /videoSettingsByChannel\.facebook = \{[\s\S]*?format: "9_16"/);
  assert.match(read("lib/facebookImageMotionVideo.ts"), /createInstagramImageMotionVideo/);
  assert.match(read("lib/instagramImageMotionVideo.ts"), /getMetaImageMotionDuration\(imageStoragePaths\.length, args\.placement\)/);
  assert.equal(getMetaImageMotionDuration(5, "reel"), 15); assert.equal(getMetaImageMotionDuration(1, "story"), 4);
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
