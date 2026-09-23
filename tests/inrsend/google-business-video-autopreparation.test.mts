import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  getGoogleBusinessVideoPreparationDecision,
} from "../../lib/googleBusinessMediaPolicy.ts";

const ROOT = process.cwd();
const read = (relativePath: string) =>
  fs.readFileSync(path.join(ROOT, relativePath), "utf8");

test("a sub-720p iNr'Send replacement is transformable instead of abandoned", () => {
  assert.deepEqual(
    getGoogleBusinessVideoPreparationDecision({
      name: "client-vertical.mp4",
      type: "video/mp4",
      storagePath: "client-vertical.mp4",
      sizeBytes: 8_000_000,
      durationSeconds: 16,
      width: 360,
      height: 640,
      videoCodec: "h264",
      audioCodec: "aac",
      frameRate: 30,
      hasAudio: true,
      containerFormats: ["mov", "mp4"],
      pixelFormat: "yuv420p",
    }),
    {
      action: "prepare",
      reason: "resolution_requires_normalization",
    },
  );

  const actions = read("lib/inrsend/publicationChannelActions.ts");
  assert.match(actions, /prepareInrSendGoogleBusinessVideo/);
  assert.match(
    actions,
    /if \(channel === "gmb"\) \{\s*video = await prepareInrSendGoogleBusinessVideo\(/,
  );

  const preparation = read(
    "lib/inrsend/googleBusinessVideoPreparation.ts",
  );
  assert.match(preparation, /prepareBoosterVideoVariantsOnServer/);
  assert.match(preparation, /size: attested\.sizeBytes/);
  assert.match(preparation, /generateMissing: true/);
  assert.match(preparation, /publicationProfile: GOOGLE_BUSINESS_VIDEO_PROFILE/);
  assert.match(preparation, /validateVideoPublicationForChannel\(\{/);
});

test("iNr'Send keeps the explicit 30-second Google Business limit", () => {
  const decision = getGoogleBusinessVideoPreparationDecision({
    durationSeconds: 31,
  });
  assert.equal(decision.action, "block");
  if (decision.action === "block") {
    assert.equal(decision.errorCode, "video_duration_too_long");
    assert.match(decision.errorMessage, /30 secondes maximum/);
    assert.match(decision.errorMessage, /n’a pas été coupée automatiquement/);
  }

  const preparation = read(
    "lib/inrsend/googleBusinessVideoPreparation.ts",
  );
  assert.match(
    preparation,
    /if \(decision\.action === "block"\) \{\s*throw new Error\(decision\.errorMessage\);/,
  );
});

test("iNrAgent and scheduled Agent publications converge on Booster's same video pipeline", () => {
  const agentExecute = read("app/api/agent/actions/execute/route.ts");
  assert.match(agentExecute, /publishNowBooster\(/);
  assert.match(agentExecute, /mediaModeByChannel/);
  assert.match(agentExecute, /videoSettingsByChannel/);

  const scheduledExecute = read(
    "app/api/agent/scheduled-actions/[id]/execute/route.ts",
  );
  assert.match(scheduledExecute, /\/api\/agent\/actions\/execute/);
  assert.match(scheduledExecute, /videoAsset/);
});
