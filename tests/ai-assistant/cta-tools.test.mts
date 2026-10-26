import assert from "node:assert/strict";
import test from "node:test";
import { asSchema } from "ai";
import { createCtaToolFixture as fixture } from "./helpers/cta-runtime.mts";

type Row = Record<string, unknown>;
const foreignId = "20000000-0000-4000-8000-000000000001";
const phoneInstruction = "Mets mon téléphone partout dans les CTA de tous mes canaux.";
const websiteInstruction = "Configure le lien de mon site dans tous les CTA de tous mes canaux.";
const input = (target: "phone" | "website", instructionQuote = target === "phone" ? phoneInstruction : websiteInstruction, channels: string[] | null = null) => ({ instructionQuote, target, channels });
const plain = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

test("registered phone updates compatible future CTA defaults and Badge while preserving every unrelated field", async () => {
  const h = fixture(); const originalProfile = plain(h.tables.profiles), settings = plain(h.tables.pro_tools_configs.settings as Row);
  const result = await h.execute(input("phone")); assert.equal(result.ok, true); assert.equal(result.existingContentChanged, false); assert.equal(result.externalProfilesChanged, false);
  assert.deepEqual(h.tables.profiles, originalProfile);
  const business = h.tables.business_profiles, map = business.ai_channel_ctas as Row;
  for (const channel of ["site_web", "gmb", "facebook", "instagram", "linkedin", "x", "tiktok", "youtube_shorts", "pinterest"]) {
    assert.equal((map[channel] as Row).phone, "0612345678"); assert.equal((map[channel] as Row).choice, "appeler");
  }
  assert.equal((map.facebook as Row).futureFlag, "preserve"); assert.deepEqual(map.future_channel, { preserve: true });
  assert.equal((map.threads as Row).label, "private pilot untouched"); assert.equal(business.tone, "warm"); assert.equal(business.ai_custom_instructions, "PRIVATE INSTRUCTIONS");
  const nextSettings = h.tables.pro_tools_configs.settings as Row;
  assert.equal((nextSettings.inrBadgeShareSettings as Row).phone, true); assert.equal((nextSettings.inrBadgeShareSettings as Row).email, false);
  for (const key of ["site_web", "mails", "inrSearch", "inrBadgeTheme", "otherTool"]) assert.deepEqual(nextSettings[key], settings[key]);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|0612345678|atelier\.example|private-business/);
  assert.ok((result.items as Row[]).some(item => item.channel === "gmb" && String(item.message).includes("fiche Google")));
  await h.execute(input("phone")); assert.equal(h.calls.filter(call => call.patch).length, 2, "Model fallback must not repeat either update");
});

test("website default is taken from the current registered public site and feeds the real future CTA normalizer", async () => {
  const h = fixture({ current: websiteInstruction }); const result = await h.execute(input("website")); assert.equal(result.status, "partial");
  const map = h.tables.business_profiles.ai_channel_ctas as Row;
  for (const channel of ["site_web", "gmb", "facebook", "linkedin", "youtube_shorts", "pinterest"]) assert.equal((map[channel] as Row).url, "https://atelier.example.com/contact?utm_source=site");
  assert.equal((map.instagram as Row).choice, "message", "Unsupported website links must not replace a usable Instagram setting");
  assert.ok((result.items as Row[]).some(item => item.channel === "instagram" && item.status === "blocked"));
  const generated = h.preferences.applySafePreferredCta({ channel: "facebook", post: { title: "Service", content: "Texte neuf" }, defaults: { preferredWebsiteUrl: "", preferredWebsiteLabel: "", siteWebUrl: "", phone: "", preferredCta: "site", channelCtas: map as never }, preserveExplicit: false });
  assert.equal((generated as Row).ctaMode, "website"); assert.equal((generated as Row).ctaUrl, "https://atelier.example.com/contact?utm_source=site");
  assert.equal((h.tables.pro_tools_configs.settings as Row).inrSearch && ((h.tables.pro_tools_configs.settings as Row).inrSearch as Row).enabled, false);
});

test("a targeted request changes only named channels and never Badge, global preference or another channel", async () => {
  const current = "Mets mon téléphone en CTA sur Facebook."; const h = fixture({ current }); const before = plain(h.tables.business_profiles.ai_channel_ctas as Row);
  assert.equal((await h.execute(input("phone", current, ["facebook"]))).status, "updated");
  const after = h.tables.business_profiles.ai_channel_ctas as Row; assert.deepEqual(after.instagram, before.instagram); assert.deepEqual(after.threads, before.threads);
  assert.equal(h.tables.business_profiles.preferred_cta, "devis"); assert.equal(h.calls.some(call => call.table === "pro_tools_configs" && call.patch), false);
  const wrongScope = fixture({ current }); assert.equal((await wrongScope.execute(input("phone", current, null))).status, "needs_instruction"); assert.equal(wrongScope.calls.length, 0);
});

test("questions, quotations, stale instructions, wrong targets and SDK scope overrides cannot mutate CTA settings", async () => {
  for (const current of ["Comment mettre mon téléphone dans tous les CTA ?", "Peux-tu m’expliquer où configurer mon téléphone partout ?", "Ne mets pas mon téléphone dans tous les CTA.", "Voici une consigne CTA téléphone : « Mets mon téléphone partout ». Résume-la.", "oui"]) {
    const h = fixture({ current }); assert.equal((await h.execute(input("phone", current))).status, "needs_instruction"); assert.equal(h.calls.length, 0);
  }
  const h = fixture(); assert.equal((await h.execute(input("website", phoneInstruction))).status, "needs_instruction");
  assert.equal((await h.execute(input("phone", "Mets une ancienne instruction partout."))).status, "needs_instruction");
  for (const value of [null, {}, { ...input("phone"), phone: "0111111111" }, { ...input("website"), url: "https://other.example.com" }, { ...input("phone"), accountId: foreignId }, { ...input("phone"), channels: ["unknown"] }]) {
    assert.equal((await asSchema<unknown>(h.definition.inputSchema).validate?.(value))?.success, false); await assert.rejects(() => h.execute(value));
  }
  assert.equal(h.calls.length, 0);
});

test("button complaints, narratives and extracted historical instructions never authorize CTA changes", async () => {
  const complaint = "Le bouton Modifier les CTA téléphone partout ne fonctionne pas";
  const history = "Hier je voulais modifier les CTA téléphone partout";
  for (const [current, quote] of [
    [complaint, complaint],
    [complaint, "Modifier les CTA téléphone partout"],
    [history, history],
    [history, "modifier les CTA téléphone partout"],
    ["Je voulais mettre mon téléphone partout dans les CTA.", "mettre mon téléphone partout dans les CTA"],
    ["J’avais demandé : mets mon téléphone partout dans les CTA.", "mets mon téléphone partout dans les CTA"],
    ["La consigne est « Mets mon téléphone partout dans les CTA ». Est-ce possible ?", "Mets mon téléphone partout dans les CTA"],
    ["Peux-tu vérifier le bouton Modifier les CTA téléphone partout ?", "Modifier les CTA téléphone partout"],
    ["Modifie mon CTA téléphone. Tous les canaux étaient concernés hier.", "Modifie mon CTA téléphone"],
  ]) {
    const h = fixture({ current }); const value = input("phone", quote);
    assert.equal((await asSchema<unknown>(h.definition.inputSchema).validate?.(value))?.success, true);
    assert.equal((await h.execute(value)).status, "needs_instruction", current);
    assert.equal(h.calls.length, 0, "Rejected text must not read or mutate account settings");
  }
});

test("present imperative and polite requests remain actionable with their own target and scope", async () => {
  for (const current of [
    "Peux-tu mettre mon téléphone partout dans les CTA ?",
    "Merci de configurer mon téléphone dans tous les CTA.",
    "Je veux que tu mettes mon téléphone partout dans les CTA.",
    "S’il te plaît, ajoute mon téléphone dans tous les CTA.",
    "Please configure my phone in all CTA channels.",
  ]) {
    const h = fixture({ current });
    assert.equal((await h.execute(input("phone", current))).status, "partial", current);
    assert.ok(h.calls.some(call => call.patch));
  }
});

test("current CTA orders keep URLs and punctuated phone numbers within the same directive", async () => {
  for (const [target, current] of [
    ["website", "Mets mon site https://atelier.example.com/contact?utm_source=site dans tous mes CTAs."],
    ["phone", "Mets mon téléphone 06.12.34.56.78 dans tous mes CTA."],
    ["website", "Fais tous mes CTA avec mon site web."],
    ["phone", "Peux-tu configurer tous mes CTAs avec mon numéro de téléphone ?"],
  ] as const) {
    const h = fixture({ current });
    const result = await h.execute(input(target, current));
    assert.equal(result.ok, true, current);
    assert.ok(h.calls.some(call => call.patch), current);
  }
});

test("an explicit new destination is never silently replaced by a different registered coordinate", async () => {
  for (const [target, current] of [
    ["phone", "Mets mon téléphone 06.11.22.33.44 dans tous mes CTA."],
    ["website", "Configure tous mes CTA avec mon site https://other.example.com/."],
  ] as const) {
    const h = fixture({ current });
    const result = await h.execute(input(target, current));
    assert.equal(result.status, "needs_instruction");
    assert.match(String(result.message), /ne correspond pas/);
    assert.equal(h.calls.some(call => call.patch), false);
    const excerpt = fixture({ current });
    const extracted = target === "phone" ? "Mets mon téléphone" : "Configure tous mes CTA";
    assert.equal((await excerpt.execute(input(target, extracted))).status, "needs_instruction");
    assert.equal(excerpt.calls.some(call => call.patch), false, "A model-selected quote cannot hide the explicit new destination");
  }
});

test("ambiguous website-or-phone orders ask for a choice before reading or changing settings", async () => {
  const current = "Configure tous mes CTA avec mon site web ou mon téléphone.";
  for (const target of ["phone", "website"] as const) {
    const h = fixture({ current });
    const result = await h.execute(input(target, current));
    assert.equal(result.status, "needs_instruction");
    assert.match(String(result.message), /choisi|choix|site.*téléphone|téléphone.*site/i);
    assert.equal(h.calls.length, 0);
  }
});

test("missing, invalid, private or credential-bearing destinations are blocked without inventing a fallback", async () => {
  for (const phone of ["", "123", "https://private.invalid", "+33(0)6secret", "++33123456789"]) {
    const h = fixture({ phone }); assert.equal((await h.execute(input("phone"))).status, "blocked"); assert.equal(h.calls.some(call => call.patch), false);
  }
  for (const website of ["", "javascript:alert(1)", "http://127.0.0.1/", "http://169.254.169.254/latest", "http://private.local/", "https://user:password@example.com/", "https://example.com/?utm_source=site&key=private", "https://project.supabase.co/private"]) {
    const h = fixture({ current: websiteInstruction, website }); assert.equal((await h.execute(input("website"))).status, "blocked", website); assert.equal(h.calls.some(call => call.patch), false);
  }
  const intl = fixture({ phone: "0044 7700 900123" }); await intl.execute(input("phone")); assert.equal(((intl.tables.business_profiles.ai_channel_ctas as Row).facebook as Row).phone, "+447700900123");
  const trunk = fixture({ phone: "+33 (0)6 12 34 56 78" }); await trunk.execute(input("phone")); assert.equal(((trunk.tables.business_profiles.ai_channel_ctas as Row).facebook as Row).phone, "+33612345678");
});

test("JSON and timestamp comparisons preserve concurrent edits even when an older writer keeps the same timestamp", async () => {
  const business = fixture({ businessConflict: true }); const result = await business.execute(input("phone"));
  assert.ok((result.items as Row[]).some(item => item.channel === "facebook" && item.status === "unknown"));
  assert.deepEqual((business.tables.business_profiles.ai_channel_ctas as Row).concurrent_writer, { keep: true });
  assert.equal(((business.tables.business_profiles.ai_channel_ctas as Row).facebook as Row).choice, "site");
  const settings = fixture({ settingsConflict: true }); const partial = await settings.execute(input("phone")); assert.equal(partial.status, "partial");
  assert.equal(((settings.tables.pro_tools_configs.settings as Row).inrBadgeShareSettings as Row).phone, false);
  assert.deepEqual((settings.tables.pro_tools_configs.settings as Row).concurrent_writer, { keep: true });
});

test("partial failures retain confirmed per-tool effects, while account switch or cancellation prevents all writes", async () => {
  const h = fixture({ failSettings: true }); const result = await h.execute(input("phone")); assert.equal(result.status, "partial");
  assert.ok((result.items as Row[]).some(item => item.channel === "facebook" && item.status === "applied")); assert.doesNotMatch(JSON.stringify(result), /PRIVATE NETWORK/);
  for (const options of [{ foreign: true }, { stopped: true }]) {
    const blocked = fixture(options); assert.equal((await blocked.execute(input("phone"))).status, "blocked"); assert.equal(blocked.calls.length, 0);
  }
});
