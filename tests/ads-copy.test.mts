import assert from "node:assert/strict";
import test from "node:test";
import {
  ADS_COPY_CHANNELS,
  buildAdsCopyInput,
  buildAdsCopySystemPrompt,
  isUsableSuggestedAdsCopy,
  normalizeSuggestedAdsCopy,
  parseAdsCopyChannel,
} from "../lib/adsCopy.ts";

test("accepts six stable channel identifiers and legacy provider identifiers", () => {
  assert.deepEqual(ADS_COPY_CHANNELS, ["meta", "google", "linkedin", "tiktok", "pinterest", "x"]);
  for (const channel of ADS_COPY_CHANNELS) assert.equal(parseAdsCopyChannel(channel), channel);
  assert.equal(parseAdsCopyChannel("unknown"), null);
  assert.equal(parseAdsCopyChannel(undefined), null);
});

test("builds channel-specific prompts without suggesting that copy is automatically approved", () => {
  const prompts = Object.fromEntries(ADS_COPY_CHANNELS.map((channel) => [channel, buildAdsCopySystemPrompt(channel)]));
  assert.match(prompts.meta, /Facebook et Instagram/);
  assert.match(prompts.meta, /pas une limite générale de Meta/);
  assert.match(prompts.google, /30 caractères maximum/);
  assert.match(prompts.google, /90 caractères maximum/);
  assert.match(prompts.linkedin, /Single Image/);
  assert.match(prompts.linkedin, /3 000/);
  assert.match(prompts.tiktok, /vise 60 caractères maximum/);
  assert.match(prompts.pinterest, /800 caractères maximum/);
  assert.match(prompts.x, /257 caractères maximum/);
  for (const prompt of Object.values(prompts)) {
    assert.match(prompt, /sans garantir son acceptation/);
    assert.match(prompt, /Ne crée ni ne publie/);
  }
});

test("builds a bounded generation input with the selected channel and verified brief", () => {
  assert.equal(
    buildAdsCopyInput("linkedin", "Atelier Nord", "Réparation de vélos à Lille, sur rendez-vous."),
    "Canal : LinkedIn Ads\nEntreprise : Atelier Nord\nOffre et informations vérifiées par le professionnel : Réparation de vélos à Lille, sur rendez-vous.",
  );
  assert.match(buildAdsCopyInput("meta", "", "Offre vérifiée"), /Entreprise : non précisée/);
});

test("normalizes each channel to its own output fields and character limits", () => {
  const google = normalizeSuggestedAdsCopy("google", {
    primaryText: "résumé",
    headlines: ["a".repeat(31), "Titre correct", "Deux", "Trois", "Quatre", "Cinq"],
    descriptions: ["d".repeat(91), "Description correcte", "Deuxième description"],
    keywords: ["réparation vélo", "réglage freins"],
  });
  assert.deepEqual(google.headlines, ["Titre correct", "Deux", "Trois", "Quatre", "Cinq"]);
  assert.deepEqual(google.descriptions, ["Description correcte", "Deuxième description"]);
  assert.equal(isUsableSuggestedAdsCopy("google", google), true);

  const linkedin = normalizeSuggestedAdsCopy("linkedin", {
    primaryText: "Intro",
    headlines: ["h".repeat(201), "Un titre LinkedIn"],
    descriptions: ["d".repeat(301), "Une description"],
    keywords: ["motif ignoré"],
  });
  assert.deepEqual(linkedin.headlines, ["Un titre LinkedIn"]);
  assert.deepEqual(linkedin.descriptions, ["Une description"]);
  assert.deepEqual(linkedin.keywords, []);
  assert.equal(isUsableSuggestedAdsCopy("linkedin", linkedin), false);

  const tiktok = normalizeSuggestedAdsCopy("tiktok", {
    primaryText: "t".repeat(120), headlines: ["ignored"], descriptions: ["ignored"], keywords: ["ignored"],
  });
  assert.equal(tiktok.primaryText.length, 100);
  assert.deepEqual(tiktok.headlines, []);
  assert.deepEqual(tiktok.descriptions, []);
  assert.deepEqual(tiktok.keywords, []);
});

test("requires the right minimum assets for Meta, Pinterest, and X", () => {
  const meta = normalizeSuggestedAdsCopy("meta", { primaryText: "Une offre claire pour vos clients." });
  assert.equal(isUsableSuggestedAdsCopy("meta", meta), true);

  const pinterest = normalizeSuggestedAdsCopy("pinterest", {
    primaryText: "", headlines: ["Titre de Pin"], descriptions: ["Description de Pin"], keywords: ["vélo"],
  });
  assert.equal(isUsableSuggestedAdsCopy("pinterest", pinterest), true);

  const x = normalizeSuggestedAdsCopy("x", { primaryText: "x".repeat(300) });
  assert.equal(x.primaryText.length, 257);
  assert.equal(isUsableSuggestedAdsCopy("x", x), true);
});
