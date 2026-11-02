import { readFileSync as readSubmissionSource } from "node:fs";
const submission = readSubmissionSource(new URL("../../app/dashboard/booster/publier/publicationSubmission.ts", import.meta.url), "utf8");
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

const modal = read("app/dashboard/booster/publier/PublishModal.tsx");
const route = read("app/api/booster/publish-now/route.ts");
const prewarm = read("app/api/media-pipeline/workspace/prewarm/route.ts");

test("mixed publications keep workspace media and build a fallback only for the missing type", () => {
  assert.match(submission, /workspaceCarriesImagesForPublish/);
  assert.match(submission, /workspaceCarriesVideoForPublish/);
  assert.match(
    submission,
    /shouldBuildImageFallbackPayload\s*=\s*hasAnyImagePublish\s*&&\s*!workspaceCarriesImagesForPublish/,
  );
  assert.match(
    submission,
    /shouldBuildVideoFallbackPayload\s*=\s*hasAnyVideoPublish\s*&&\s*!workspaceCarriesVideoForPublish/,
  );
  assert.match(submission, /if \(shouldBuildImageFallbackPayload\)/);
  assert.match(submission, /if \(shouldBuildVideoFallbackPayload\)/);
  assert.match(submission, /workspaceCarriesImagesForSchedule/);
  assert.match(submission, /workspaceCarriesVideoForSchedule/);
});

test("strict publish keeps the image fallback but rejects every legacy video fallback", () => {
  assert.match(route, /hasImageFallbackForChannel/);
  assert.match(
    route,
    /expectedMode === "images" && hasImageFallbackForChannel\(channel\)/,
  );
  assert.doesNotMatch(route, /hasVideoFallbackPayload/);
  assert.match(
    route,
    /const legacyVideoResult = hasAnyVideoChannel && !strictMediaCutover\s*\? await normalizeVideoPayload\(body\.video\)/,
  );
  assert.match(route, /!strictMediaCutover &&\s*internalAsyncPreparationDispatch/);
});

test("compatible original video remains a rollback-only prewarm fallback", () => {
  assert.match(
    prewarm,
    /allowOriginalVideoFallback\s*&&[\s\S]{0,100}allowsOriginalVideoFallback\(request\.channel\)\s*&&[\s\S]{0,80}sourceValidation\.ok/,
  );
  assert.doesNotMatch(
    prewarm,
    /allowOriginalVideoFallback\s*&&\s*generateMissingVideoVariants\s*&&\s*allowsOriginalVideoFallback/,
  );
  assert.match(
    prewarm,
    /const strictMediaCutover =[\s\S]{0,120}body\?\.mediaPipelineCutoverV1 === true[\s\S]{0,120}isLegacyMediaTransportCutoverEnabled\(\)/,
  );
  assert.match(
    prewarm,
    /const allowOriginalVideoFallback =[\s\S]{0,80}!strictMediaCutover && body\?\.allowOriginalVideoFallback === true/,
  );
  assert.doesNotMatch([modal, submission].join("\n"), /directOriginalAvailable/);
});
