import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { assertUiCopy } from "../helpers/ui-copy-contract.mjs";
import { PUBLISH_CHANNEL_IDENTITY } from "../../app/dashboard/booster/publier/components/publishChannelIdentity.ts";

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
  assert.match(
    shared,
    /"linkedin",\s*"tiktok",\s*"youtube_shorts",\s*"pinterest",\s*"x"/,
  );
  assert.match(shared, /x:\s*"X"/);
  assert.equal(PUBLISH_CHANNEL_IDENTITY.x.icon, "/icons/x.svg");
});

test("X offers website and custom CTA links without promising native buttons", () => {
  const cta = read("lib/boosterCta.ts");
  const shared = read("app/dashboard/booster/publier/publishModal.shared.tsx");
  assert.match(
    cta,
    /x:\s*\["none", "website", "call", "message", "custom"\]/,
  );
  assert.match(
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
  assert.match(shared, /Le lien WhatsApp sera ajouté au texte du post X/);
  assert.match(shared, /Le lien sera ajouté au post X et comptera/);
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
  assert.match(editor, /const i18nT = useTranslations\("booster"\)/);
  assert.match(editor, /\{i18nT\("retirer_le_lien_du_cta_754fb2a5"\)\}/);
  assert.match(editor, /xUrlBlocked\s*\? i18nT\("editor_x_link_format_blocked"\)/);
  assertUiCopy("booster", "retirer_le_lien_du_cta_754fb2a5", "Retirer le lien du CTA");
  assertUiCopy("booster", "editor_x_link_format_blocked", "X est bloqué : corrigez le format de lien détecté.");
  assert.match(prompt, /X — RÈGLE TECHNIQUE PRIORITAIRE/);
  assert.match(prompt, /Les liens HTTP\(S\) fournis sont acceptés/);
  assert.doesNotMatch(prompt, /Ne propose jamais de CTA Site/);
  assert.match(prompt, /2 à 3 phrases complémentaires/);
  assert.match(prompt, /1 à 2 hashtags pertinents/);
  assert.match(prompt, /consigne explicite demande de ne pas ajouter de hashtags/);
  assert.doesNotMatch(prompt, /phrases courtes/);
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
