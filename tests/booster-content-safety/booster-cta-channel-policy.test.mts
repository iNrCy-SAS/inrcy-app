import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { shouldPrefillConfiguredChannelCta } from "../../lib/channelCtaPrefillPolicy.ts";

function read(path: string) {
  return readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("each publication channel has an explicit CTA capability policy", () => {
  const cta = read("lib/boosterCta.ts");

  assert.match(cta, /inrcy_site: \["none", "website", "custom"\]/);
  assert.match(cta, /site_web: \["none", "website", "custom"\]/);
  assert.match(cta, /inr_search: \["none"\]/);
  assert.match(cta, /gmb: \["none", "website", "call", "custom"\]/);
  assert.match(cta, /facebook: \["none", "website", "message", "custom"\]/);
  assert.match(cta, /instagram: \["none", "message"\]/);
  assert.match(cta, /linkedin: \["none", "website", "custom"\]/);
  assert.match(cta, /x: \["none", "call", "message"\]/);
  assert.match(cta, /tiktok: \["none", "message"\]/);
  assert.match(cta, /youtube_shorts: \["none", "website", "custom"\]/);
  assert.match(cta, /pinterest: \["none", "website", "custom"\]/);
});

test("all CTA editors filter their choices with the shared channel policy", () => {
  const shared = read(
    "app/dashboard/booster/publier/publishModal.shared.tsx",
  );
  const editors = [
    read(
      "app/dashboard/booster/publier/components/PublishContentEditorPanel.tsx",
    ),
    read("app/dashboard/agent/AgentClient.tsx"),
    read("app/dashboard/mails/_components/MailboxDetailsModal.tsx"),
  ];

  assert.match(shared, /getSupportedPreferredCtasForChannel\(channel\)/);
  assert.match(
    shared,
    /return getPreferredWebsiteUrlForChannel\(channel, defaults\)/,
  );
  for (const editor of editors) {
    assert.match(editor, /getPreferredCtaOptionsForChannel\(/);
    assert.doesNotMatch(
      editor,
      /BOOSTER_PREFERRED_CTA_OPTIONS\.map\(\(option\)/,
    );
  }
});

test("the final publisher transforms incompatible CTAs and fails closed", () => {
  const cta = read("lib/boosterCta.ts");
  const preferences = read("lib/boosterCtaPreferences.ts");
  const publishNow = read("app/api/booster/publish-now/route.ts");
  const inrSend = read("lib/inrsend/publicationChannelActions.ts");

  assert.match(cta, /normalizeBoosterPostCtaForChannel/);
  assert.match(cta, /getFallbackCtaModeForChannel/);
  assert.match(cta, /case "website":[\s\S]*if \(!websiteUrl\) return ""/);
  assert.match(cta, /case "call":[\s\S]*: ""/);
  assert.match(cta, /getBoosterCtaDestinationUrlForChannel/);
  assert.match(preferences, /resolveUsablePreferredCtaChoice/);

  assert.match(
    publishNow,
    /getBoosterCtaDestinationUrlForChannel\([\s\S]*"pinterest"/,
  );
  assert.doesNotMatch(
    publishNow,
    /normalizePublicHttpUrl\(channelPost\.ctaUrl\) \|\|/,
  );
  assert.match(
    inrSend,
    /getBoosterCtaDestinationUrlForChannel\("pinterest"/,
  );
  assert.doesNotMatch(
    inrSend,
    /normalizePublicHttpUrl\(nextPost\.ctaUrl\) \|\|/,
  );
});

test("website defaults keep Site web and Site iNrCy as distinct sources", () => {
  const publishNow = read("app/api/booster/publish-now/route.ts");
  const inrSend = read("lib/inrsend/publicationChannelActions.ts");

  for (const source of [publishNow, inrSend]) {
    assert.match(source, /siteWebUrl/);
    assert.match(source, /inrcySiteUrl/);
    assert.match(source, /getPreferredWebsiteUrlForChannel/);
  }
  assert.doesNotMatch(
    inrSend,
    /proSiteWeb\.url \?\? inrcyCfg\.site_url/,
  );
});

test("Booster generation applies only configured channel CTAs", () => {
  const generation = read("app/api/booster/generate/route.ts");

  assert.match(generation, /loadBoosterCtaDefaults/);
  assert.match(generation, /const ctaDefaultsPromise = loadBoosterCtaDefaults\(\{/);
  assert.match(
    generation,
    /Promise\.all\(\[generationContextPromise, ctaDefaultsPromise\]\)/,
  );
  assert.match(generation, /versions: generatedVersions/);
  assert.match(
    generation,
    /applySafePreferredCta\(\{[\s\S]*?channel: channel as BoosterChannels,[\s\S]*?defaults: ctaDefaults,[\s\S]*?preserveExplicit: false/,
  );
  assert.match(generation, /postByChannel: versions/);
  assert.match(generation, /NextResponse\.json\(\{[\s\S]*?versions,/);
});

test("the Booster editor repairs stale CTA drafts and never displays a fake fallback", () => {
  const modal = read("app/dashboard/booster/publier/PublishModal.tsx");
  const foundations = read(
    "app/dashboard/booster/publier/publishModal.foundations.ts",
  );
  const shared = read(
    "app/dashboard/booster/publier/publishModal.shared.tsx",
  );
  const preferences = read("lib/boosterCtaPreferences.ts");

  assert.match(
    foundations,
    /sanitizePostsForEditor\([\s\S]*?ctaDefaults\?: BoosterCtaDefaults \| null/,
  );
  assert.match(foundations, /applySafePreferredCta\(\{/);
  assert.match(foundations, /normalizeBoosterPostCtaForChannel\(/);
  assert.match(modal, /sanitizePostsForEditor\(versions, ctaDefaults\)/);
  assert.match(modal, /prefillConfiguredChannelCtas\(/);
  assert.match(foundations, /normalizeBoosterPostCtaForChannel\(/);
  assert.match(shared, /isBoosterCtaLabelCompatibleWithMode\(mode, normalized\.cta\)/);
  assert.doesNotMatch(shared, /if \(supported\.has\("site"\)\) return "site"/);
  assert.doesNotMatch(shared, /if \(supported\.has\("message"\)\) return "message"/);
  assert.match(
    preferences,
    /isBoosterCtaLabelCompatibleWithMode\(mode, post\.cta\)/,
  );
});

test("channel CTA settings reach Booster and iNrAgent without reviving the legacy global default", () => {
  const defaults = read("lib/boosterCtaDefaultsServer.ts");
  const preferences = read("lib/boosterCtaPreferences.ts");
  const modal = read("app/dashboard/booster/publier/PublishModal.tsx");
  const foundations = read("app/dashboard/booster/publier/publishModal.foundations.ts");
  const agent = read("app/dashboard/agent/AgentClient.tsx");
  const prepare = read("app/api/agent/actions/prepare-publish/route.ts");

  assert.match(defaults, /\.select\("preferred_cta,ai_language,ai_channel_ctas,updated_at"\)/);
  assert.match(defaults, /channelCtas: normalizeAiChannelCtaMap\(businessProfile\.ai_channel_ctas\)/);
  assert.match(preferences, /const configured = args\.defaults\?\.channelCtas\?/);
  assert.match(preferences, /args\.preserveExplicit === false\s*\? \{ \.\.\.args\.post, \.\.\.emptyCta\(\) \}/);
  assert.doesNotMatch(preferences.slice(preferences.indexOf("export function applySafePreferredCta")), /choice: args\.defaults\?\.preferredCta/);
  assert.match(preferences, /choice === "site" \|\| choice === "devis"/);
  assert.match(preferences, /configured\.url \|\| getPreferredWebsiteUrlForChannel\(args\.channel, args\.defaults\)/);
  assert.match(preferences, /choice === "whatsapp"[\s\S]*?buildBoosterWhatsAppUrl\(phone\)/);
  assert.match(foundations, /shouldPrefillConfiguredChannelCta\(/);
  assert.match(modal, /channelCtas: normalizeAiChannelCtaMap\(json\?\.channelCtas\)/);
  const draftContentCheck = modal.slice(
    modal.indexOf("const hasGeneratedContent = Object.values(postsByChannel)"),
    modal.indexOf("const hasImages =", modal.indexOf("const hasGeneratedContent = Object.values(postsByChannel)")),
  );
  assert.doesNotMatch(draftContentCheck, /normalized\.cta/);
  assert.match(agent, /channelCtas: normalizeAiChannelCtaMap\(payload\?\.channelCtas\)/);
  assert.match(prepare, /source: "channel_configuration"/);
});

test("an existing post without CTA receives a configured default, but a manual none survives", () => {
  const emptyPost = { title: "Titre", content: "Texte", ctaMode: "none", cta: "" };
  assert.equal(shouldPrefillConfiguredChannelCta(undefined, false), true);
  assert.equal(shouldPrefillConfiguredChannelCta(emptyPost, false), true);
  assert.equal(shouldPrefillConfiguredChannelCta(emptyPost, true), false);
  assert.equal(shouldPrefillConfiguredChannelCta({ ...emptyPost, cta: "Appeler" }, false), false);
  assert.equal(shouldPrefillConfiguredChannelCta({ ...emptyPost, ctaMode: "website" }, false), false);
});

test("the final CTA guard replaces labels that contradict their structured mode", () => {
  const cta = read("lib/boosterCta.ts");

  assert.match(cta, /export function isBoosterCtaLabelCompatibleWithMode/);
  assert.match(
    cta,
    /isBoosterCtaLabelCompatibleWithMode\("website", source\.cta\)/,
  );
  assert.match(
    cta,
    /isBoosterCtaLabelCompatibleWithMode\("call", source\.cta\)/,
  );
  assert.match(
    cta,
    /isBoosterCtaLabelCompatibleWithMode\("message", source\.cta\)/,
  );
});
