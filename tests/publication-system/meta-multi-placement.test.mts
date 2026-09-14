import assert from "node:assert/strict";
import test from "node:test";

import {
  buildBoosterPublicationTargets,
  buildMetaPublicationSelection,
  getMetaTargetSettings,
  normalizeMetaPublicationSelection,
} from "../../lib/metaPublicationTargets.ts";

test("Booster combines exactly one primary Meta format with optional Story", () => {
  assert.deepEqual(buildMetaPublicationSelection("classic", false), {
    version: 2,
    primaryPlacement: "classic",
    includeStory: false,
    placements: ["classic"],
  });
  assert.deepEqual(
    buildMetaPublicationSelection("classic", true).placements,
    ["classic", "story"],
  );
  assert.deepEqual(
    buildMetaPublicationSelection("reel", true).placements,
    ["reel", "story"],
  );
});

test("legacy iNrAgent and scheduled Story payloads remain Story-only", () => {
  assert.deepEqual(
    normalizeMetaPublicationSelection({ placement: "story" }).placements,
    ["story"],
  );
  assert.deepEqual(getMetaTargetSettings("story"), { placement: "story" });
  assert.equal(getMetaTargetSettings("classic"), null);
});

test("Meta combinations become independent durable publication targets", () => {
  const targets = buildBoosterPublicationTargets({
    channels: ["facebook", "instagram", "linkedin"],
    facebookPublicationSettings: buildMetaPublicationSelection("classic", true),
    instagramPublicationSettings: buildMetaPublicationSelection("reel", true),
  });

  assert.deepEqual(targets, [
    { key: "facebook:classic", channel: "facebook", placement: "classic" },
    { key: "facebook:story", channel: "facebook", placement: "story" },
    { key: "instagram:reel", channel: "instagram", placement: "reel" },
    { key: "instagram:story", channel: "instagram", placement: "story" },
    { key: "linkedin", channel: "linkedin", placement: null },
  ]);
  assert.equal(new Set(targets.map((target) => target.key)).size, targets.length);
});
