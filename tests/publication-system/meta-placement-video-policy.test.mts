import assert from "node:assert/strict";
import test from "node:test";
import { getMetaPlacementVideoIssues, type MetaPlacementVideoInput } from "../../lib/metaPlacementVideoPolicy.ts";

const valid = { durationSeconds: 30, width: 1080, height: 1920, frameRate: 30, sizeBytes: 8 * 1024 * 1024, format: "original" };
const errors = (input: MetaPlacementVideoInput) => getMetaPlacementVideoIssues(input).filter(issue => issue.severity === "error");

test("the Sunga source fails only the selected optional placements and preserves Classic", () => {
  const source = { durationSeconds: 69.58, width: 464, height: 832, frameRate: 23.44, sizeBytes: 8.45 * 1024 * 1024, format: "original" };
  for (const channel of ["facebook", "instagram"] as const) {
    assert.deepEqual(getMetaPlacementVideoIssues({ ...source, channel, placement: "classic" }), []);
  }
  assert.deepEqual(errors({ ...source, channel: "facebook", placement: "story" }).map(issue => issue.code), [
    "facebook_story_video_duration_out_of_range", "facebook_story_video_resolution", "facebook_story_video_aspect_ratio", "facebook_story_video_frame_rate",
  ]);
  assert.deepEqual(errors({ ...source, channel: "instagram", placement: "story" }).map(issue => issue.code), ["instagram_story_video_duration_out_of_range"]);
  assert.ok(getMetaPlacementVideoIssues({ ...source, channel: "facebook", placement: "story" }).every(issue => /Facebook — Story/.test(issue.message)));
});

test("Story and Facebook Reel duration boundaries are independent", () => {
  for (const channel of ["facebook", "instagram"] as const) {
    for (const durationSeconds of [3, 60]) assert.deepEqual(errors({ ...valid, channel, placement: "story", durationSeconds }), []);
    for (const durationSeconds of [0, 2.99, 60.01, 90]) assert.ok(errors({ ...valid, channel, placement: "story", durationSeconds }).some(issue => issue.code.endsWith("duration_out_of_range")));
  }
  for (const durationSeconds of [3, 60, 90]) assert.deepEqual(errors({ ...valid, channel: "facebook", placement: "reel", durationSeconds }), []);
  assert.ok(errors({ ...valid, channel: "facebook", placement: "reel", durationSeconds: 90.01 }).some(issue => issue.code.endsWith("duration_out_of_range")));
});

test("final Facebook media requires vertical dimensions and 24–60 fps", () => {
  for (const frameRate of [24, 60]) assert.deepEqual(errors({ ...valid, channel: "facebook", placement: "story", width: 540, height: 960, frameRate }), []);
  assert.ok(errors({ ...valid, channel: "facebook", placement: "reel", frameRate: 23.976 }).some(issue => issue.code.endsWith("frame_rate")));
  assert.ok(errors({ ...valid, channel: "facebook", placement: "story", width: 1920, height: 1080 }).some(issue => issue.code.endsWith("aspect_ratio")));
  assert.ok(errors({ ...valid, channel: "facebook", placement: "story", width: 450, height: 800 }).some(issue => issue.code.endsWith("resolution")));
});

test("explicit 9:16 adaptation defers correctable source geometry and cadence but never duration", () => {
  const source = { ...valid, channel: "facebook" as const, placement: "story" as const, width: 464, height: 832, frameRate: 23.44, format: "9_16" };
  const provisional = getMetaPlacementVideoIssues(source);
  assert.equal(provisional.filter(issue => issue.severity === "error").length, 0);
  assert.equal(provisional.filter(issue => issue.severity === "warning").length, 3);
  assert.equal(errors({ ...source, durationSeconds: 69.58 }).length, 1);
  assert.equal(errors({ ...source, format: "original" }).length, 3, "the actual derivative is always checked again");
  assert.ok(errors({ ...valid, channel: "facebook", placement: "story", format: "1_1" }).some(issue => issue.code.endsWith("aspect_ratio")));
});

test("Instagram Story accepts 23 fps and non-vertical ratios while enforcing size and final bounds", () => {
  const source = { ...valid, channel: "instagram" as const, placement: "story" as const, frameRate: 23, width: 1280, height: 720, sizeBytes: 100 * 1024 * 1024 };
  assert.deepEqual(errors(source), []);
  assert.ok(getMetaPlacementVideoIssues(source).some(issue => issue.code.endsWith("vertical_recommended") && issue.severity === "warning"));
  assert.ok(errors({ ...source, sizeBytes: source.sizeBytes + 1 }).some(issue => issue.code.endsWith("size")));
  assert.ok(errors({ ...source, frameRate: 22.99 }).some(issue => issue.code.endsWith("frame_rate")));
  assert.ok(errors({ ...source, width: 3840, height: 2160 }).some(issue => issue.code.endsWith("width")));
  assert.deepEqual(errors({ ...source, format: "9_16", width: 3840, height: 2160 }), []);
});

test("missing or invalid metadata requires verification without falsely blocking the placement", () => {
  for (const metadata of [{}, { durationSeconds: null, width: 0, height: 0, frameRate: Number.NaN }, { durationSeconds: "", width: undefined, height: undefined, frameRate: Infinity }]) {
    for (const channel of ["facebook", "instagram"] as const) {
      const issues = getMetaPlacementVideoIssues({ ...metadata, channel, placement: "story" });
      assert.ok(issues.length > 0);
      assert.ok(issues.every(issue => issue.severity === "warning"));
    }
  }
  assert.deepEqual(errors({ ...valid, channel: "facebook", placement: "story", durationSeconds: "60", frameRate: "24" }), []);
});
