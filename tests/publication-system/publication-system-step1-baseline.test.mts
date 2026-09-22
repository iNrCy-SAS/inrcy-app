import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import {
  getBoosterImageDecision,
  getBoosterImageSafetyBackgroundMode,
} from "../../lib/boosterImageDecision.ts";
import { normalizeVideoAdaptationMode } from "../../lib/boosterVideoSettings.ts";
import {
  INR_MEDIA_VIDEO_PUBLISH_MAX_BYTES,
  INR_MEDIA_VIDEO_SOURCE_MAX_BYTES,
} from "../../lib/mediaRules.ts";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, "../..");

function read(relativePath: string) {
  return fs.readFileSync(path.join(ROOT, relativePath), "utf8");
}

test("Adapter provenance is isolated per media instead of contaminating untouched images", () => {
  const customized = getBoosterImageDecision({
    channel: "facebook",
    meta: { width: 1600, height: 900 },
    customized: true,
  });
  const untouched = getBoosterImageDecision({
    channel: "facebook",
    meta: { width: 1200, height: 1200 },
    customized: false,
  });

  assert.equal(customized.mode, "customized");
  assert.equal(customized.reason, "manual_customization");
  assert.equal(untouched.mode, "original");
});

test("Adapter provenance remains channel-specific for the same media", () => {
  const instagram = getBoosterImageDecision({
    channel: "instagram",
    meta: { width: 1080, height: 1350 },
    customized: true,
  });
  const linkedin = getBoosterImageDecision({
    channel: "linkedin",
    meta: { width: 1080, height: 1350 },
    customized: false,
  });

  assert.equal(instagram.mode, "customized");
  assert.equal(linkedin.mode, "original");
});

test("Apply-to-all records an explicit decision for every media key", () => {
  const controller = read(
    "app/dashboard/booster/publier/usePublishImageController.ts",
  );

  assert.match(controller, /for \(const imageKey of imageKeysForChannel\)/);
  assert.match(
    controller,
    /transforms\[imageKey\] = \{[\s\S]*\.\.\.activeEditorTransform,[\s\S]*overlay: current\.transforms\[imageKey\]\?\.overlay,[\s\S]*\};/,
  );
  assert.match(controller, /customizedImageKeys\.add\(imageKey\)/);
  assert.match(controller, /customizedImageKeys\.delete\(imageKey\)/);
  assert.match(controller, /isBoosterImageExplicitlyCustomized/);
});

test("The product uses one 75 MB ceiling for source and publication", () => {
  assert.equal(INR_MEDIA_VIDEO_SOURCE_MAX_BYTES, 75_000_000);
  assert.equal(INR_MEDIA_VIDEO_PUBLISH_MAX_BYTES, 75_000_000);
});

test("Safety fallbacks never reactivate blurred image or video backgrounds", () => {
  assert.equal(getBoosterImageSafetyBackgroundMode("inrcy_site"), "transparent");
  assert.equal(getBoosterImageSafetyBackgroundMode("gmb"), "white");
  assert.equal(getBoosterImageSafetyBackgroundMode("instagram"), "black");
  assert.equal(normalizeVideoAdaptationMode("safe_blur"), "safe_frame");
});

test("Publication fan-out stays independent per channel and idempotent", () => {
  const route = read("app/api/booster/publish-now/route.ts");
  const asyncPublication = read("lib/boosterAsyncPublication.ts");

  assert.match(asyncPublication, /BOOSTER_ASYNC_CHANNEL_EVENT_TYPE/);
  assert.match(asyncPublication, /BOOSTER_ASYNC_CHANNEL_LOCK_TTL_MS/);
  assert.match(route, /channelEventIds/);
  assert.match(route, /Promise\.all/);
  assert.match(route, /idempotency/i);
});

test("A successful text publication with a media warning is not counted as a failed channel", () => {
  const asyncPublication = read("lib/boosterAsyncPublication.ts");
  const outcome = read("lib/boosterPublicationOutcome.ts");

  assert.match(asyncPublication, /classifyBoosterPublicationResult/);
  assert.match(outcome, /published_with_warning/);
  assert.match(asyncPublication, /const failures = entries\.filter\(\(entry\) => !entry\.ok\)/);
});

test("Strict workspace consumption cannot silently return to browser binaries", () => {
  const route = read("app/api/booster/publish-now/route.ts");
  const workspaceConsumption = read("lib/mediaWorkspaceConsumption.ts");
  const serverPreparation = read(
    "app/api/booster/publish-now/publishNow.server-preparation.ts",
  );

  assert.match(route, /resolveWorkspacePublicationConsumption/);
  assert.match(route, /mediaWorkspaceId/);
  assert.match(workspaceConsumption, /source: "media_workspace_v1"/);
  assert.doesNotMatch(serverPreparation, /blob:/);
});
