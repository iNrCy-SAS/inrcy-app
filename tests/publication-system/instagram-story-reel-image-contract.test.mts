import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  DEFAULT_INSTAGRAM_PUBLICATION_PREFERENCES,
  coerceInstagramPublicationPlacement,
  getEnabledInstagramPublicationPlacements,
  normalizeInstagramPublicationPreferences,
} from "../../lib/instagramPublicationPreferences.ts";

function read(relativePath: string) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const editor = read(
  "app/dashboard/booster/publier/components/PublishContentEditorPanel.tsx",
);
const modal = read("app/dashboard/booster/publier/PublishModal.tsx");
const route = read("app/api/booster/publish-now/route.ts");
const foundations = read(
  "app/api/booster/publish-now/publishNow.foundations.ts",
);
const ingress = read("lib/boosterPublicationIngress.ts");
const motion = read("lib/instagramImageMotionVideo.ts");
const preferencesRoute = read(
  "app/api/integrations/instagram/publication-preferences/route.ts",
);
const instagramPanel = read("app/dashboard/_components/InstagramPanel.tsx");
const dashboardClient = read("app/dashboard/DashboardClient.tsx");
const finalReview = read(
  "app/dashboard/booster/publier/components/PublishFinalReviewModal.tsx",
);
const scheduleReview = read("app/dashboard/_components/PublishScheduleModal.tsx");
const preferencesSql = read(
  "ops/sql/2026-09-07_instagram_publication_preferences.sql",
);
const preferencesPostflight = read(
  "ops/sql/2026-09-07_instagram_publication_preferences_postflight_read_only.sql",
);

test("Instagram always exposes Classic, Reel and Story, including before media selection", () => {
  assert.match(
    editor,
    /activeCard === "instagram" \? \([\s\S]*?aria-label=\{i18nT\("instagram_publication_format"\)\}/,
  );
  assert.doesNotMatch(
    editor,
    /activeCard === "instagram" && instagramMediaMode !== "none" \? \(/,
  );
  assert.match(editor, /<option value="classic"[\s\S]*?instagram_classic/);
  assert.match(editor, /<option value="reel"[\s\S]*?instagram_reels/);
  assert.match(editor, /<option value="story"[\s\S]*?instagram_stories/);
  assert.match(
    editor,
    /const instagramMediaOnly =[\s\S]*?activeCard === "instagram" &&[\s\S]*?instagramPublicationPlacement !== "classic";/,
  );
  assert.doesNotMatch(
    editor,
    /const instagramMediaOnly =[\s\S]*?instagramMediaMode !== "none";/,
  );
  assert.match(editor, /disabled=\{activeMediaOnly\}/);
  assert.match(editor, /activeMediaMode === "images"[\s\S]*?instagram_image_motion_notice/);
  assert.doesNotMatch(
    editor,
    /activeCard === "instagram" && instagramMediaMode === "video"/,
  );
});

test("Instagram publication is blocked without the selected image or video in every mode", () => {
  assert.match(
    read("app/dashboard/booster/publier/publishModal.shared.tsx"),
    /const instagramMediaMissing =[\s\S]*?channel === "instagram"[\s\S]*?mediaMode === "none"[\s\S]*?mediaMode === "images" && !hasImage[\s\S]*?mediaMode === "video" && !hasVideo[\s\S]*?addMediaBlocker\([\s\S]*?"instagram_media_required"/,
  );
});

test("Classique is always enabled and remains the safe default", () => {
  assert.equal(DEFAULT_INSTAGRAM_PUBLICATION_PREFERENCES.defaultMode, "classic");
  assert.deepEqual(
    getEnabledInstagramPublicationPlacements(
      normalizeInstagramPublicationPreferences({
        reelsEnabled: false,
        storiesEnabled: false,
        defaultMode: "story",
      }),
    ),
    ["classic"],
  );
  assert.equal(
    coerceInstagramPublicationPlacement("reel", {
      ...DEFAULT_INSTAGRAM_PUBLICATION_PREFERENCES,
      reelsEnabled: false,
    }),
    "classic",
  );
  assert.match(instagramPanel, /type="checkbox" checked disabled/);
  assert.match(instagramPanel, /instagram_default_publication_mode/);
  assert.match(modal, /instagramPublicationPlacement !== "classic"/);
  assert.match(foundations, /\["classic", "classique", "normal", "feed"\]/);
});

test("Instagram mode preferences are account-scoped, preserved and atomic", () => {
  const updateRootSettingsStart = dashboardClient.indexOf(
    "const updateRootSettingsKey = useCallback(",
  );
  const updateRootSettingsEnd = dashboardClient.indexOf(
    "\nconst {",
    updateRootSettingsStart,
  );
  assert.notEqual(updateRootSettingsStart, -1);
  assert.notEqual(updateRootSettingsEnd, -1);
  const updateRootSettingsSource = dashboardClient.slice(
    updateRootSettingsStart,
    updateRootSettingsEnd,
  );
  const patchPreferencesStart = preferencesRoute.indexOf(
    "async function patchPreferences",
  );
  const patchPreferencesEnd = preferencesRoute.indexOf(
    "export const GET",
    patchPreferencesStart,
  );
  assert.notEqual(patchPreferencesStart, -1);
  assert.notEqual(patchPreferencesEnd, -1);
  const patchPreferencesSource = preferencesRoute.slice(
    patchPreferencesStart,
    patchPreferencesEnd,
  );
  const missingRpcDetectorStart = preferencesRoute.indexOf(
    "function isMissingAtomicRpc",
  );
  const missingRpcDetectorEnd = preferencesRoute.indexOf(
    "\nasync function getPreferences",
    missingRpcDetectorStart,
  );
  assert.notEqual(missingRpcDetectorStart, -1);
  assert.notEqual(missingRpcDetectorEnd, -1);
  const missingRpcDetector = preferencesRoute.slice(
    missingRpcDetectorStart,
    missingRpcDetectorEnd,
  );

  assert.match(preferencesRoute, /requireUser\(\)/);
  assert.match(preferencesRoute, /\.eq\("user_id", activeUserId\)/);
  assert.match(
    preferencesRoute,
    /inrcy_set_instagram_publication_preferences/,
  );
  assert.match(
    missingRpcDetector,
    /return error\.code === "PGRST202";/,
  );
  assert.doesNotMatch(missingRpcDetector, /42883|\.includes\s*\(/);
  assert.doesNotMatch(patchPreferencesSource, /\.from\("pro_tools_configs"\)/);
  assert.doesNotMatch(
    patchPreferencesSource,
    /\.(?:upsert|insert|update|delete)\s*\(/,
  );
  assert.match(
    patchPreferencesSource,
    /INSTAGRAM_PUBLICATION_PREFERENCES_MIGRATION_REQUIRED/,
  );
  assert.match(patchPreferencesSource, /\{ status: 503 \}/);

  assert.equal(
    (updateRootSettingsSource.match(/resolveActiveBrowserUserId\(user\.id\)/g) || [])
      .length,
    1,
  );
  assert.match(
    updateRootSettingsSource,
    /const scopedUserId = resolveActiveBrowserUserId\(user\.id\);[\s\S]*?\.eq\("user_id", scopedUserId\)[\s\S]*?user_id: scopedUserId/,
  );
  assert.match(
    dashboardClient,
    /key === "instagram" \|\| key === "facebook"[\s\S]*?currentChannel\.publicationPreferences[\s\S]*?preservedPublicationPreferences/,
  );
  assert.doesNotMatch(
    dashboardClient,
    /\[key\]: \{ \.\.\.currentChannel, \.\.\.nextChannel \}/,
  );
  assert.match(preferencesSql, /for update;/i);
  assert.match(preferencesSql, /security invoker/i);
  assert.match(preferencesSql, /set search_path = ''/i);
  assert.match(preferencesSql, /inrcy_can_access_account/);
  assert.match(
    preferencesSql,
    /for update;[\s\S]*?if not found then[\s\S]*?INSTAGRAM_PUBLICATION_PREFERENCES_ACCOUNT_FORBIDDEN/,
  );
  assert.match(
    preferencesSql,
    /update public\.pro_tools_configs[\s\S]*?returning config\.settings -> 'instagram' -> 'publicationPreferences'[\s\S]*?into v_result;[\s\S]*?if not found then[\s\S]*?INSTAGRAM_PUBLICATION_PREFERENCES_ACCOUNT_FORBIDDEN/,
  );
  assert.match(
    preferencesSql,
    /p_preferences is null[\s\S]{0,700}?then[\s\S]{0,180}?errcode = '22023'[\s\S]{0,180}?INSTAGRAM_PUBLICATION_PREFERENCES_INVALID/i,
  );
  assert.match(
    preferencesSql,
    /if jsonb_typeof\(v_root\) <> 'object' then[\s\S]{0,220}?errcode = 'P0001'[\s\S]{0,220}?INSTAGRAM_PUBLICATION_PREFERENCES_SETTINGS_INVALID/i,
  );
  assert.match(
    preferencesSql,
    /elsif jsonb_typeof\(v_instagram\) <> 'object' then[\s\S]{0,220}?errcode = 'P0001'[\s\S]{0,220}?INSTAGRAM_PUBLICATION_PREFERENCES_SETTINGS_INVALID/i,
  );
  assert.match(preferencesPostflight, /begin transaction read only;/i);
  assert.match(preferencesPostflight, /to_regprocedure/);
  assert.match(preferencesPostflight, /function_exists/);
  assert.match(preferencesPostflight, /function_empty_search_path/);
  assert.match(
    preferencesPostflight,
    /p\.proconfig @> array\['search_path=""'\]/,
  );
  assert.match(preferencesPostflight, /service_role_can_execute/);
  for (const privilege of ["SELECT", "INSERT", "UPDATE"]) {
    assert.match(
      preferencesPostflight,
      new RegExp(
        `has_table_privilege\\('authenticated', 'public\\.pro_tools_configs', '${privilege}'\\)`,
        "i",
      ),
    );
  }
  assert.match(preferencesPostflight, /from pg_policies/);
  assert.match(
    preferencesPostflight,
    /cmd in \('SELECT', 'INSERT', 'UPDATE', 'ALL'\)/,
  );
  assert.match(preferencesPostflight, /policyname,[\s\S]*?cmd,[\s\S]*?roles,[\s\S]*?qual,[\s\S]*?with_check/);
  assert.match(preferencesPostflight, /inrcy_can_access_account/);
  assert.match(preferencesPostflight, /authenticated_update_is_account_scoped/);
});

test("publish-now enforces account Instagram preferences only for Reel and Story", () => {
  const preflightHelperStart = route.indexOf(
    "async function getInstagramPlacementPreflightFailure",
  );
  const preflightHelperEnd = route.indexOf(
    "\nasync function publishNowHandler",
    preflightHelperStart,
  );
  assert.notEqual(preflightHelperStart, -1);
  assert.notEqual(preflightHelperEnd, -1);
  const preflightHelper = route.slice(preflightHelperStart, preflightHelperEnd);

  const requestGuardStart = route.indexOf(
    "const requestedInstagramPublicationSettings",
  );
  const requestGuardEnd = route.indexOf(
    "const dispatchableSelected",
    requestGuardStart,
  );
  assert.notEqual(requestGuardStart, -1);
  assert.notEqual(requestGuardEnd, -1);
  const requestGuard = route.slice(requestGuardStart, requestGuardEnd);

  assert.match(
    preflightHelper,
    /\.from\("pro_tools_configs"\)[\s\S]*?\.select\("settings"\)[\s\S]*?\.eq\("user_id", args\.userId\)[\s\S]*?\.maybeSingle\(\)/,
  );
  assert.match(
    preflightHelper,
    /normalizeInstagramPublicationPreferences\([\s\S]*?instagramSettings\.publicationPreferences/,
  );
  assert.match(
    preflightHelper,
    /isInstagramPublicationPlacementEnabled\(args\.placement, preferences\)/,
  );
  assert.match(
    preflightHelper,
    /if \(error\)[\s\S]*?instagram_publication_preferences_unavailable[\s\S]*?retryable: true/,
  );
  assert.match(
    preflightHelper,
    /instagram_publication_mode_disabled[\s\S]*?retryable: false/,
  );

  assert.match(
    requestGuard,
    /selected\.includes\([\s\S]*?"instagram"[\s\S]*?\)[\s\S]*?\? normalizeInstagramPublicationSettings\(body\.instagramPublicationSettings\)[\s\S]*?: null/,
  );
  assert.match(
    requestGuard,
    /if \([\s\S]*?requestedInstagramPublicationSettings[\s\S]*?!clientPreflightFailuresByChannel\.instagram[\s\S]*?getInstagramPlacementPreflightFailure\([\s\S]*?userId[\s\S]*?requestedInstagramPublicationSettings\.placement[\s\S]*?clientPreflightFailuresByChannel\.instagram = instagramPreflightFailure/,
  );
  assert.ok(
    requestGuardStart < route.indexOf("enqueueBoosterPublication({"),
    "the server preference gate must run before durable ingress",
  );
});

test("final and scheduled reviews warn on media-only formats and name Pinterest board", () => {
  assert.match(
    modal,
    /const instagramMediaOnly =[\s\S]*?channel === "instagram" &&[\s\S]*?instagramPublicationPlacement !== "classic";/,
  );
  assert.doesNotMatch(
    modal,
    /const instagramMediaOnly =[\s\S]*?resolveChannelMediaMode\(channel\) !== "none";/,
  );
  assert.match(modal, /instagram_review_media_only_warning/);
  assert.match(modal, /pinterest_review_board/);
  assert.match(finalReview, /details\?: string\[\]/);
  assert.match(finalReview, /min\(1080px, 100%\)/);
  assert.match(scheduleReview, /reviewWarnings/);
  assert.match(scheduleReview, /reviewDetails/);
  assert.match(scheduleReview, /min\(1080px, 100%\)/);
});

test("new Instagram format settings survive immediate and scheduled durable dispatch", () => {
  assert.ok(
    (modal.match(/instagramPublicationSettings:/g) || []).length >= 2,
    "immediate and scheduled payloads must both carry the setting",
  );
  assert.match(ingress, /instagramPublicationSettings: body\.instagramPublicationSettings/);
  assert.match(route, /normalizeInstagramPublicationSettings\(body\.instagramPublicationSettings\)/);
  assert.match(route, /channel === "instagram" && instagramPublicationSettings/);
  assert.match(foundations, /mediaType: story \? "STORIES" : "REELS"/);
  assert.match(foundations, /mediaOnly: true/);
});

test("an Instagram image is converted to a real vertical MP4 and never falls back to a photo", () => {
  assert.match(
    route,
    /instagramPublicationSettings &&[\s\S]*?mediaModeByChannel\[ch\] === "images"[\s\S]*?createInstagramImageMotionVideo/,
  );
  assert.match(route, /instagram_image_motion_preparation_failed/);
  assert.match(route, /const instagramCaption = instagramPublicationSettings[\s\S]*?\? ""/);
  assert.match(motion, /const OUTPUT_WIDTH = 1_080/);
  assert.match(motion, /const OUTPUT_HEIGHT = 1_920/);
  assert.match(motion, /const OUTPUT_DURATION_SECONDS = 8/);
  assert.match(motion, /"libx264"/);
  assert.match(motion, /"aac"/);
  assert.match(motion, /loadAiMediaSoundtrack/);
  assert.match(motion, /upsert: false/);
});

test("Instagram image jobs keep one stable storage source across Reel and Story continuations", () => {
  assert.match(
    foundations,
    /usesInstagramDerivative[\s\S]*?\? imageSet\.publishableStoragePaths\.length[\s\S]*?\? imageSet\.publishableStoragePaths[\s\S]*?: imageSet\.storagePaths/,
  );
  assert.match(
    foundations,
    /storagePath:\s*storagePath \|\| undefined[\s\S]*?publicationReady:\s*Boolean\(storagePath\)/,
  );
  assert.match(
    route,
    /selected[\s\S]*?\.filter\(\(channel\) => mediaModeByChannel\[channel\] === "images"\)[\s\S]*?buildAsyncPreparedImagePayloads\([\s\S]*?channel,[\s\S]*?rawChannelImages,[\s\S]*?imageSet/,
  );
  assert.match(
    route,
    /instagramSourceStoragePaths[\s\S]*?createInstagramImageMotionVideo\([\s\S]*?imageStoragePaths:\s*instagramSourceStoragePaths/,
  );
});
