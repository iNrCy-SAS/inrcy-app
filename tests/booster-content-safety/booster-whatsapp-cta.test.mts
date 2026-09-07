import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  buildBoosterWhatsAppUrl,
  getBoosterWhatsAppPhoneFromUrl,
  isBoosterWhatsAppUrl,
  normalizeBoosterWhatsAppPhone,
} from "../../lib/boosterWhatsappCta.ts";

function read(relativePath: string) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

test("WhatsApp CTA normalizes French and international phone numbers", () => {
  assert.equal(normalizeBoosterWhatsAppPhone("06 12 34 56 78"), "33612345678");
  assert.equal(normalizeBoosterWhatsAppPhone("+33 (0)6 12 34 56 78"), "33612345678");
  assert.equal(normalizeBoosterWhatsAppPhone("0033 6 12 34 56 78"), "33612345678");
  assert.equal(normalizeBoosterWhatsAppPhone("+1 (415) 555-2671"), "14155552671");
  assert.equal(normalizeBoosterWhatsAppPhone("123"), "");
  assert.equal(buildBoosterWhatsAppUrl("06 12 34 56 78"), "https://wa.me/33612345678");
});

test("WhatsApp CTA recognizes only trusted WhatsApp hosts and restores the phone", () => {
  assert.equal(isBoosterWhatsAppUrl("https://wa.me/33612345678"), true);
  assert.equal(
    isBoosterWhatsAppUrl("https://api.whatsapp.com/send?phone=33612345678"),
    true,
  );
  assert.equal(isBoosterWhatsAppUrl("https://wa.me.example.com/33612345678"), false);
  assert.equal(isBoosterWhatsAppUrl("javascript:alert(1)"), false);
  assert.equal(
    getBoosterWhatsAppPhoneFromUrl("https://wa.me/33612345678?text=Bonjour"),
    "33612345678",
  );
  assert.equal(
    getBoosterWhatsAppPhoneFromUrl(
      "https://api.whatsapp.com/send?phone=33612345678&text=Bonjour",
    ),
    "33612345678",
  );
});

test("WhatsApp is wired through every CTA editor and AI preference layer", () => {
  const shared = read("app/dashboard/booster/publier/publishModal.shared.tsx");
  const booster = read(
    "app/dashboard/booster/publier/components/PublishContentEditorPanel.tsx",
  );
  const agent = read("app/dashboard/agent/AgentClient.tsx");
  const inrSend = read("app/dashboard/mails/_components/MailboxDetailsModal.tsx");
  const preferences = read("lib/boosterCtaPreferences.ts");
  const aiProfile = read("lib/aiGenerationProfile.ts");

  assert.match(shared, /\{ value: "whatsapp", label: "Écrire sur WhatsApp" \}/);
  assert.match(shared, /isBoosterWhatsAppUrl\(normalized\.ctaUrl\)/);
  assert.match(preferences, /if \(choice === "whatsapp"\)/);
  assert.match(preferences, /ctaMode: "custom"/);
  assert.match(aiProfile, /\| "whatsapp"/);

  for (const source of [booster, agent, inrSend]) {
    assert.match(source, /ctaChoice === "whatsapp"/);
    assert.match(source, /buildBoosterWhatsAppUrl/);
    assert.match(source, /getBoosterWhatsAppPhoneFromUrl/);
  }
});

test("Google Business CALL omits the forbidden URL while WhatsApp remains a LEARN_MORE link", () => {
  const cta = read("lib/boosterCta.ts");
  const google = read("lib/googleBusiness.ts");

  assert.match(cta, /return \{ actionType: "CALL" \};/);
  assert.doesNotMatch(cta, /actionType: "CALL", url:/);
  assert.match(cta, /mode === "custom"[\s\S]*actionType: "LEARN_MORE", url/);
  assert.match(google, /callToAction\?\.actionType === "CALL"/);
  assert.match(google, /payload\.callToAction = \{ actionType: "CALL" \}/);
});

test("website publications keep a clickable and safely rendered CTA", () => {
  const publishNow = read("app/api/booster/publish-now/route.ts");
  const inrSend = read("lib/inrsend/publicationChannelActions.ts");
  const widgetApi = read("app/api/widgets/actus/route.ts");
  const embedRoute = read("app/embed/actus/route.ts");
  const embedRenderer = read("app/embed/actus/_lib/render.ts");

  assert.match(publishNow, /cta: buildCtaTextForChannel\(ch, channelPost,/);
  assert.match(inrSend, /cta: buildCtaTextForChannel\(channel, nextPost,/);
  assert.match(widgetApi, /title, content, cta, images/);
  assert.match(embedRoute, /title, content, cta, images/);
  assert.match(embedRenderer, /function renderArticleCta/);
  assert.match(embedRenderer, /url\.protocol !== "https:"/);
  assert.match(embedRenderer, /rel="noopener noreferrer"/);
  assert.match(embedRenderer, /class="newsCta"/);
});
