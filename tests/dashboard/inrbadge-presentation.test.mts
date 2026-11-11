import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { getInrBadgePresentation, INRBADGE_PRESENTATION_MAX_CHARACTERS } from "../../lib/inrBadgePresentation.ts";
import { INRBADGE_LANGUAGE_OPTIONS } from "../../lib/inrBadgeLanguage.ts";

test("the observed Inaveo description becomes its complete verified activity without address or source report", () => {
  const description = "Inaveo est une entreprise de sécurité implantée au 6 avenue Sébastopol à Metz. Le site officiel indique qu’elle s’adresse exclusivement aux professionnels et qu’elle intervient en…";
  const source = Object.freeze({ description, sector: "[[SECTOR:securite]] Agent de sécurité" });
  const result = getInrBadgePresentation(source);
  assert.equal(result, "Inaveo est une entreprise de sécurité.");
  assert.doesNotMatch(result, /Sébastopol|Metz|site officiel|exclusivement|…/u);
  assert.equal(source.description, description, "The public projection does not replace the complete business field");
});

test("the observed iNrCy description retains its complete main phrase instead of clipping the purpose clause", () => {
  const description = "Application de publication instantanée multicanale permettant à un professionnel d'améliorer sa visibilité sans perdre de temps et de développer son activité";
  assert.equal(getInrBadgePresentation({ description }), "Application de publication instantanée multicanale.");
});

test("short source sentences and abbreviations stay whole and later paragraphs do not fill the card", () => {
  assert.equal(getInrBadgePresentation({ description: "Nous fabriquons des menuiseries sur mesure. " + "Une présentation détaillée de nos procédés. ".repeat(30) }), "Nous fabriquons des menuiseries sur mesure.");
  assert.equal(getInrBadgePresentation({ description: "Dr. Martin propose des soins dentaires. Découvrez le cabinet." }), "Dr. Martin propose des soins dentaires.");
  assert.equal(getInrBadgePresentation({ description: "Installation d’alarmes et de vidéosurveillance" }), "Installation d’alarmes et de vidéosurveillance.");
});

test("short sentences keep their whole main clause after an incise and long incises never become a bare subject", () => {
  for (const description of ["Notre entreprise, située à Lille, répare et entretient les vélos.", "Notre plateforme, qui permet de gérer vos publications, est dédiée aux artisans."]) assert.equal(getInrBadgePresentation({ description }), description);
  const description = "Notre entreprise " + "au nom particulièrement long ".repeat(8) + ", située à Lille, répare et entretient les vélos.";
  assert.equal(getInrBadgePresentation({ description, sector: "[[SECTOR:loisirs_sport]] Réparateur de vélos" }), "Notre activité : Réparateur de vélos.");
});

test("a long indivisible sentence falls back to the actual decoded profession without a character or word cutoff", () => {
  const description = "Nous réalisons " + "des travaux très variés et soigneusement décrits ".repeat(20);
  for (const profession of ["agent_securite", "Agent de sécurité"]) {
    const result = getInrBadgePresentation({ description, sector: `[[SECTOR:securite]] ${profession}` });
    assert.equal(result, "Notre activité : Agent de sécurité.");
    assert.ok(Array.from(result).length <= INRBADGE_PRESENTATION_MAX_CHARACTERS);
    assert.doesNotMatch(result, /\[\[|SECTOR|agent_securite|…/u);
  }
  assert.equal(getInrBadgePresentation({ description, sector: "[[SECTOR:securite]]" }), "Notre activité : Sécurité.");
  assert.equal(getInrBadgePresentation({ description, sector: "securite" }), "Notre activité : Sécurité.");
});

test("report-only, incomplete or address-only text never invents an activity or exposes a forced company identity", () => {
  const expected = "Découvrez notre activité et contactez-nous.";
  for (const description of ["", "Le site officiel indique une adresse à Metz.", "Notre entreprise de sécurité intervient en…", "Nous sommes au 6 avenue Sébastopol à Metz."]) {
    assert.equal(getInrBadgePresentation({ description }), expected);
  }
  assert.equal(getInrBadgePresentation({ sector: "[[SECTOR:autre]]" }), expected);
  assert.equal(getInrBadgePresentation({ sector: "unknown_machine_code" }), expected);
  const longName = "Entreprise au nom particulièrement long ".repeat(8);
  assert.equal(getInrBadgePresentation({ description: `${longName} installe des alarmes.`, sector: "[[SECTOR:securite]] agent_securite" }), "Notre activité : Agent de sécurité.");
});

test("each supported language preserves a supplied short sentence and uses its own neutral fallback", () => {
  const sentences = {
    fr: "Nous installons des systèmes d’alarme.", en: "We install alarm systems.", es: "Instalamos sistemas de alarma.", it: "Installiamo sistemi di allarme.",
    de: "Wir installieren Alarmanlagen.", nl: "Wij installeren alarmsystemen.", pt: "Instalamos sistemas de alarme.", th: "เราติดตั้งระบบสัญญาณเตือนภัย", zh: "我们安装报警系统。",
  };
  const fallbacks = new Set<string>();
  for (const { value: language } of INRBADGE_LANGUAGE_OPTIONS) {
    assert.equal(getInrBadgePresentation({ description: sentences[language], language }), sentences[language]);
    const fallback = getInrBadgePresentation({ language });
    assert.ok(fallback.trim()); assert.ok(Array.from(fallback).length <= INRBADGE_PRESENTATION_MAX_CHARACTERS); fallbacks.add(fallback);
  }
  assert.equal(fallbacks.size, INRBADGE_LANGUAGE_OPTIONS.length);
});

test("the public card uses the bounded projection and lets its complete presentation and long identity wrap", () => {
  const page = readFileSync(new URL("../../app/badge/[slug]/page.tsx", import.meta.url), "utf8");
  const css = readFileSync(new URL("../../app/badge/[slug]/badge.module.css", import.meta.url), "utf8");
  assert.match(page, /getInrBadgePresentation\(\{ description: fullBusinessDescription, sector: business\.sector, language: badgeLanguage \}\)/u);
  assert.match(page, /const fullBusinessDescription = sanitizeProfessionalIdentityText/u);
  for (const selector of ["description", "headerInfoLine"]) {
    const rule = [...css.matchAll(new RegExp(`\\.${selector}\\s*\\{([^}]+)\\}`, "g"))].map(match => match[1]).join("\n"); assert.ok(rule);
    assert.match(rule, /overflow-wrap:\s*anywhere/u);
    assert.doesNotMatch(rule, /line-clamp|overflow:\s*hidden|text-overflow:\s*ellipsis|white-space:\s*nowrap|(?:^|;|\n)\s*(?:max-)?height:/u);
  }
});
