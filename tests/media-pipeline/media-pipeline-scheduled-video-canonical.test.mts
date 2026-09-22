import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

function sliceBetween(source: string, start: string, end: string) {
  const startIndex = source.indexOf(start);
  const endIndex = source.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `missing start marker: ${start}`);
  assert.ok(endIndex > startIndex, `missing end marker after ${start}: ${end}`);
  return source.slice(startIndex, endIndex);
}

const modal = read("app/dashboard/booster/publier/PublishModal.tsx");
const hook = read(
  "app/dashboard/booster/publier/usePersistentMediaWorkspace.ts",
);
const client = read("lib/mediaWorkspaceClient.ts");
const prewarm = read("app/api/media-pipeline/workspace/prewarm/route.ts");

test("strict scheduled video never validates the browser original", () => {
  const ensure = sliceBetween(
    modal,
    "async function ensureCutoverVideoVariantsReady",
    "const syncActiveImagesToPersistentWorkspace",
  );
  const schedule = sliceBetween(
    modal,
    "if (hasAnyVideoPublish && workspaceCarriesVideoForSchedule)",
    "const emptyChannelImages",
  );

  assert.doesNotMatch(ensure, /directOriginalAvailable|source:\s*"original"/);
  assert.match(ensure, /mediaPipelineCutoverV1:\s*true/);
  assert.ok(
    (ensure.match(/allowOriginalVideoFallback:\s*false/g) || []).length >= 2,
    "initial lookup and regeneration must both reject the original fallback",
  );
  assert.match(schedule, /generateMissingVideoVariants:\s*false/);
  assert.doesNotMatch(schedule, /allowOriginalVideoFallback:\s*true/);
});

test("prewarm transports and enforces the strict cutover bit", () => {
  assert.match(hook, /mediaPipelineCutoverV1:\s*settings\?\.mediaPipelineCutoverV1/);
  assert.match(client, /mediaPipelineCutoverV1:\s*params\.mediaPipelineCutoverV1 === true/);
  assert.match(
    prewarm,
    /const strictMediaCutover =[\s\S]{0,120}body\?\.mediaPipelineCutoverV1 === true[\s\S]{0,120}isLegacyMediaTransportCutoverEnabled\(\)/,
  );
  assert.match(
    prewarm,
    /const allowOriginalVideoFallback =[\s\S]{0,80}!strictMediaCutover && body\?\.allowOriginalVideoFallback === true/,
  );
});

test("rollback outside strict cutover still supports the compatible original", () => {
  assert.match(prewarm, /function allowsOriginalVideoFallback/);
  assert.match(
    prewarm,
    /allowOriginalVideoFallback &&[\s\S]{0,100}allowsOriginalVideoFallback\(request\.channel\)[\s\S]{0,80}sourceValidation\.ok/,
  );
  assert.match(prewarm, /code:\s*"video_variant_fallback_to_original"/);
});
