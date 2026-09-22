import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildBoosterPublicationTargets,
  buildMetaPublicationSelection,
  getMetaTargetSettings,
  isMetaStoryOnlySelection,
  normalizeMetaPublicationSelection,
  stripMetaStoryOnlyPostContent,
} from "../../lib/metaPublicationTargets.ts";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

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
  assert.deepEqual(buildMetaPublicationSelection("story", false), {
    version: 2,
    primaryPlacement: "story",
    includeStory: false,
    placements: ["story"],
  });
});

test("legacy iNrAgent and scheduled Story payloads remain Story-only", () => {
  assert.deepEqual(
    normalizeMetaPublicationSelection({ placement: "story" }).placements,
    ["story"],
  );
  assert.deepEqual(getMetaTargetSettings("story"), { placement: "story" });
  assert.equal(getMetaTargetSettings("classic"), null);
});

test("Story-only strips every textual field while + Story preserves the primary content", () => {
  const post = {
    title: "Titre",
    content: "Contenu",
    cta: "Voir le site",
    ctaMode: "website",
    ctaUrl: "https://example.com",
    ctaPhone: "+33123456789",
    hashtags: ["local", "pro"],
  };

  const storyOnly = buildMetaPublicationSelection("story", false);
  assert.equal(isMetaStoryOnlySelection(storyOnly), true);
  assert.deepEqual(stripMetaStoryOnlyPostContent(post, storyOnly), {
    title: "",
    content: "",
    cta: "",
    ctaMode: "none",
    ctaUrl: "",
    ctaPhone: "",
    hashtags: [],
  });

  const classicAndStory = buildMetaPublicationSelection("classic", true);
  assert.equal(isMetaStoryOnlySelection(classicAndStory), false);
  assert.equal(stripMetaStoryOnlyPostContent(post, classicAndStory), post);
});

test("Booster disables the Story-only editor and sanitizes immediate and durable payloads", () => {
  const editor = read(
    "app/dashboard/booster/publier/components/PublishContentEditorPanel.tsx",
  );
  const modal = read("app/dashboard/booster/publier/PublishModal.tsx");
  const ingress = read("lib/boosterPublicationIngress.ts");

  assert.match(editor, /const activeStoryOnly =/);
  assert.match(editor, /<fieldset[\s\S]*?disabled=\{activeStoryOnly\}/);
  assert.match(
    editor,
    /data-meta-story-only-content=\{activeStoryOnly \? "disabled" : "enabled"\}/,
  );
  assert.match(modal, /stripMetaStoryOnlyPostContent\(post, metaSelection\)/);
  assert.match(ingress, /stripMetaStoryOnlyPostContent\([\s\S]*?body\.facebookPublicationSettings/);
  assert.match(ingress, /stripMetaStoryOnlyPostContent\([\s\S]*?body\.instagramPublicationSettings/);
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
