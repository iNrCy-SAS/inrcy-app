import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  buildUniqueBoosterHashtagLine,
  canonicalizeBoosterPhone,
  dedupeBoosterHashtagsInText,
  normalizeBoosterInstagramPostHashtags,
  getBoosterPhoneDisplayValue,
  removeMatchingBoosterPhone,
  removeMatchingBoosterUrl,
  sanitizeBoosterPostForStructuredCta,
  sanitizeGoogleBusinessPublicationText,
} from "../../lib/boosterPublicationSafety.ts";

test("French local and +33 phone formats are treated as the same number", () => {
  assert.equal(canonicalizeBoosterPhone("06.11.65.60.52"), "fr:611656052");
  assert.equal(canonicalizeBoosterPhone("+33 6 11 65 60 52"), "fr:611656052");
});

test("the structured call CTA removes the same phone from content and CTA label", () => {
  const post = sanitizeBoosterPostForStructuredCta(
    {
      title: "Alerte guêpes",
      content: "Intervention sécurisée.\n\n📞 06.11.65.60.52",
      cta: "Appelez-nous ! 06 11 65 60 52",
      ctaPhone: "+33 6 11 65 60 52",
    },
    "call",
  );

  assert.equal(post.content, "Intervention sécurisée.");
  assert.equal(post.cta, "Appelez-nous!");
  assert.equal(
    getBoosterPhoneDisplayValue({ ctaPhone: "0611656052" }),
    "06 11 65 60 52",
  );
});

test("phone cleanup preserves unrelated editorial numbers", () => {
  const input = "Nos 5 conseils restent valables en 2026. Appelez le 06 11 65 60 52.";
  assert.equal(
    removeMatchingBoosterPhone(input, "0611656052"),
    "Nos 5 conseils restent valables en 2026.",
  );
});

test("the structured website CTA removes only the matching URL", () => {
  const input = "Découvrez nos services sur https://www.inrcy.com/ et gardez example.fr comme référence.";
  assert.equal(
    removeMatchingBoosterUrl(input, "https://inrcy.com"),
    "et gardez example.fr comme référence.",
  );
});

test("hashtags already present in the body are not appended twice", () => {
  const base = "Intervention locale #Guêpes avec méthode. #sécurité #sécurité";
  const deduped = dedupeBoosterHashtagsInText(base);
  assert.equal(deduped, "Intervention locale #Guêpes avec méthode. #sécurité");
  assert.equal(
    buildUniqueBoosterHashtagLine(deduped, ["guepes", "désinsectisation", "Sécurité", "Oise"], 8),
    "#désinsectisation #Oise",
  );
});

test("Instagram moves every inline hashtag into one structured unique list", () => {
  const normalized = normalizeBoosterInstagramPostHashtags(
    {
      title: "Une intervention locale #Oise",
      content: "Un résultat durable.\n\n#Artisan #Local #Oise",
      cta: "Envoyez-nous un message #Contact",
      hashtags: ["local", "Visibilite", "#Artisan"],
    },
    8,
  );

  assert.equal(normalized.title, "Une intervention locale");
  assert.equal(normalized.content, "Un résultat durable.");
  assert.equal(normalized.cta, "Envoyez-nous un message");
  assert.deepEqual(normalized.hashtags, [
    "Oise",
    "Artisan",
    "Local",
    "Contact",
    "Visibilite",
  ]);
  assert.equal(
    buildUniqueBoosterHashtagLine("Texte\n\nEnvoyez-nous un message", normalized.hashtags, 8),
    "#Oise #Artisan #Local #Contact #Visibilite",
  );
});

test("Google Business final text strips contacts, URLs and hashtags at the last moment", () => {
  const input = [
    "Intervention locale en 2026",
    "Nos 5 conseils restent utiles.",
    "Appelez-nous au 06.11.65.60.52",
    "contact@example.fr",
    "https://example.fr",
    "#guêpes #Oise",
  ].join("\n\n");

  assert.equal(
    sanitizeGoogleBusinessPublicationText(input),
    "Intervention locale en 2026\n\nNos 5 conseils restent utiles.",
  );
});

test("Booster prompt and publication pipeline enforce structured contact fields", () => {
  const prompt = readFileSync(new URL("../../lib/boosterPrompt.ts", import.meta.url), "utf8");
  const cta = readFileSync(new URL("../../lib/boosterCta.ts", import.meta.url), "utf8");
  const route = readFileSync(new URL("../../app/api/booster/publish-now/route.ts", import.meta.url), "utf8");

  assert.match(prompt, /ne recopie jamais téléphone, email ni URL dans title, content ou cta/);
  assert.match(prompt, /Tous les hashtags doivent être placés exclusivement dans le tableau hashtags/);
  assert.match(cta, /sanitizeBoosterPostForStructuredCta/);
  assert.match(cta, /sanitizeGoogleBusinessPublicationText/);
  assert.match(cta, /normalizeBoosterInstagramPostHashtags/);
  assert.match(route, /buildBoosterHashtagLine/);
});
