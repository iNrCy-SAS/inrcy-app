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
  assert.match(
    shared,
    /"linkedin",\s*"tiktok",\s*"youtube_shorts",\s*"pinterest",\s*"x"/,
  );
  assert.match(shared, /x:\s*"X"/);
  assert.match(selector, /x:\s*"\/icons\/x\.svg"/);
});

test("X proposes only URL-free CTA choices", () => {
  const cta = read("lib/boosterCta.ts");
  const shared = read("app/dashboard/booster/publier/publishModal.shared.tsx");
  assert.match(
    cta,
    /x:\s*\["none", "call", "message"\]/,
  );
  assert.doesNotMatch(
    cta,
    /x:\s*\[[^\]]*"(?:website|custom)"/,
  );
  assert.match(
    cta,
    /function buildBoosterXPostText[\s\S]*?buildBoosterMessage\("x", post, context\)[\s\S]*?buildBoosterHashtagLine\(post, base, 2\)/,
  );
  assert.match(
    cta,
    /case "call":[\s\S]*?joinCtaLabelAndValue\(label, phone/,
  );
  assert.match(shared, /WhatsApp n’est pas proposé sur X/);
  assert.match(shared, /Les CTA avec lien ne sont pas proposés sur X/);
});

test("Booster keeps forbidden X URLs visible and blocks only X", () => {
  const modal = read("app/dashboard/booster/publier/PublishModal.tsx");
  const editor = read(
    "app/dashboard/booster/publier/components/PublishContentEditorPanel.tsx",
  );
  const prompt = read("lib/boosterPrompt.ts");
  const urlPolicy = read("lib/boosterXUrlPolicy.ts");

  assert.match(urlPolicy, /import \{ findForbiddenXUrl \} from "@\/lib\/xChannel"/);
  assert.match(urlPolicy, /"title", "titre", post\?\.title/);
  assert.match(urlPolicy, /"content", "contenu", post\?\.content/);
  assert.match(urlPolicy, /"hashtags", "hashtags", hashtagValue/);
  assert.match(urlPolicy, /"cta", "texte du CTA", post\?\.cta/);
  assert.match(urlPolicy, /"ctaUrl", "URL du CTA", post\?\.ctaUrl/);
  assert.match(urlPolicy, /"ctaPhone", "champ téléphone du CTA", post\?\.ctaPhone/);
  assert.match(urlPolicy, /La valeur n'est jamais modifiée/);
  assert.match(modal, /xForbiddenUrlFields\.length \? \["x_url_forbidden"\] : \[\]/);
  assert.match(modal, /getBoosterXUrlBlockerMessage\(xForbiddenUrlFields\)/);
  assert.match(
    modal,
    /Ne jamais la retirer silencieusement[\s\S]*?key === "x"[\s\S]*?normalizePost\(prepared\[key\]\)/,
  );
  assert.match(editor, /data-x-url-blocker="true"/);
  assert.match(editor, /Retirer le lien du CTA/);
  assert.match(editor, /X est bloqué : retirez le lien détecté/);
  assert.match(prompt, /X — RÈGLE TECHNIQUE PRIORITAIRE/);
  assert.match(prompt, /ne recopie et ne génère aucun lien ni aucune URL/);
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
