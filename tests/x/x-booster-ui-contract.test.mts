import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  BOOSTER_PUBLICATION_CHANNELS,
  normalizeBoosterPublicationChannels,
} from "../../lib/boosterPublicationPolicy.ts";
import {
  X_POST_MAX_IMAGES,
  X_POST_WEIGHTED_LENGTH_MAX,
  getXPostTextMetrics,
} from "../../lib/xChannel.ts";

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("Booster exposes X as one canonical channel alongside every existing channel", () => {
  assert.equal(BOOSTER_PUBLICATION_CHANNELS.includes("x"), true);
  assert.deepEqual(
    normalizeBoosterPublicationChannels(["x", "facebook", "x", "instagram"]),
    { channels: ["x", "facebook", "instagram"], invalidChannels: [] },
  );

  const shared = read("app/dashboard/booster/publier/publishModal.shared.tsx");
  const selector = read(
    "app/dashboard/booster/publier/components/PublishChannelSelector.tsx",
  );
  assert.match(shared, /"linkedin",\s*"x",\s*"tiktok"/);
  assert.match(shared, /x:\s*"X"/);
  assert.match(selector, /x:\s*"\/icons\/x\.svg"/);
});

test("X CTA destinations are rendered in the post text without a native button", () => {
  const cta = read("lib/boosterCta.ts");
  assert.match(
    cta,
    /x:\s*\["none", "website", "call", "message", "custom"\]/,
  );
  assert.match(
    cta,
    /function buildBoosterXPostText[\s\S]*?buildBoosterMessage\("x", post, context\)[\s\S]*?buildBoosterHashtagLine\(post, base, 2\)/,
  );
  assert.match(
    cta,
    /case "website":[\s\S]*?joinCtaLabelAndValue\(label, websiteUrl/,
  );
  assert.match(
    cta,
    /case "call":[\s\S]*?joinCtaLabelAndValue\(label, phone/,
  );
});

test("Booster enforces the exact X weighted counter and four-image contract", () => {
  const shared = read("app/dashboard/booster/publier/publishModal.shared.tsx");
  const modal = read("app/dashboard/booster/publier/PublishModal.tsx");
  const imageController = read(
    "app/dashboard/booster/publier/usePublishImageController.ts",
  );
  const preparation = read("lib/boosterImageServerPreparation.ts");

  assert.equal(X_POST_WEIGHTED_LENGTH_MAX, 280);
  assert.equal(X_POST_MAX_IMAGES, 4);
  assert.equal(getXPostTextMetrics("a".repeat(281)).valid, false);
  assert.match(shared, /channel === "x" \? X_POST_MAX_IMAGES/);
  assert.match(shared, /"x_text_too_long"/);
  assert.match(shared, /"x_gif_combination_invalid"/);
  assert.match(shared, /un GIF animé doit être publié seul/);
  assert.match(modal, /getXPostTextMetrics\(xPostText\)/);
  assert.match(modal, /xGifCount/);
  assert.match(imageController, /getBoosterMaxImageCountForChannel\(channel\)/);
  assert.match(preparation, /x:\s*\{ width: 1200, height: 675 \}/);
  assert.match(
    preparation,
    /x:\s*new Set\(\["image\/jpeg", "image\/png", "image\/webp", "image\/gif"\]\)/,
  );
});

test("X keeps generic text, image and video publishing without Reels or Stories", () => {
  const shared = read("app/dashboard/booster/publier/publishModal.shared.tsx");
  const preview = read(
    "app/dashboard/_components/channel-image-adapter/publication-preview.tsx",
  );
  const editor = read(
    "app/dashboard/booster/publier/components/PublishContentEditorPanel.tsx",
  );

  assert.match(shared, /x:\s*\{[\s\S]*?width: 1200,[\s\S]*?height: 675/);
  assert.match(preview, /channel: "facebook" \| "linkedin" \| "x"/);
  assert.match(editor, /activeCard === "x"/);
  assert.match(editor, /manual-voice:x:hashtags/);
  assert.doesNotMatch(editor, /xPublicationPlacement/);
});
