import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { resolve } from "node:path";

import {
  isInternalProductIdentity,
  resolveProfessionalCompanyName,
  sanitizeProfessionalIdentityText,
  sanitizeProfessionalIdentityValue,
} from "../../lib/professionalBusinessIdentity.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (path: string) => readFileSync(resolve(ROOT, path), "utf8");

test("iNrCy products can never become the professional company fallback", () => {
  for (const name of [
    "iNrCy",
    "iNr’Search",
    "iNrBadge",
    "iNr'Agent",
    "iNrSend",
    "iNrStats",
    "iNrADN",
    "Site iNrCy",
  ]) {
    assert.equal(isInternalProductIdentity(name), true, name);
  }

  assert.equal(
    resolveProfessionalCompanyName("iNr’Search", "Ouest Nettoyage Industriel & Express"),
    "Ouest Nettoyage Industriel & Express",
  );
  assert.equal(resolveProfessionalCompanyName("iNrCy", "iNr’Badge"), "");
});

test("contaminated company statements are repaired with the canonical profile name", () => {
  const company = "Ouest Nettoyage Industriel & Express";

  assert.equal(
    sanitizeProfessionalIdentityText(
      "iNrCy est une entreprise spécialisée dans le nettoyage professionnel.",
      company,
    ),
    `${company} est une entreprise spécialisée dans le nettoyage professionnel.`,
  );
  assert.equal(
    sanitizeProfessionalIdentityText(
      "<p>iNr’Search est une société de rénovation.</p>",
      company,
    ),
    `<p>${company} est une société de rénovation.</p>`,
  );
  assert.equal(
    sanitizeProfessionalIdentityText(
      "L’entreprise iNr’Badge accompagne les professionnels.",
      company,
    ),
    `${company} accompagne les professionnels.`,
  );
});

test("legitimate product references stay untouched", () => {
  const source = "Ouest Nettoyage utilise iNrCy pour publier sur iNr’Search.";
  assert.equal(
    sanitizeProfessionalIdentityText(source, "Ouest Nettoyage"),
    source,
  );
});

test("the guard recursively protects every generated Business DNA text block", () => {
  const sanitized = sanitizeProfessionalIdentityValue({
    description: "iNrCy est une entreprise de nettoyage.",
    memory: {
      mission: "iNr’Search accompagne les entreprises locales.",
      vocabulary: ["Publier sur iNr’Search", "Chez iNr’Agent, la qualité prime."],
    },
  }, "Ouest Nettoyage");

  assert.equal(sanitized.description, "Ouest Nettoyage est une entreprise de nettoyage.");
  assert.equal(sanitized.memory.mission, "Ouest Nettoyage accompagne les entreprises locales.");
  assert.equal(sanitized.memory.vocabulary[0], "Publier sur iNr’Search");
  assert.equal(sanitized.memory.vocabulary[1], "Chez Ouest Nettoyage, la qualité prime.");
});

test("analysis, public badge, directory and shared AI profile all use the guard", () => {
  const analysis = read("app/api/ai-memory/analyze-channels/route.ts");
  const memoryRoute = read("app/api/ai-memory/route.ts");
  const badge = read("app/badge/[slug]/page.tsx");
  const directory = read("lib/inrSearchPublic.ts");
  const profile = read("lib/aiGenerationProfile.ts");

  assert.match(analysis, /IDENTITE_CANONIQUE/);
  assert.match(analysis, /platformAndToolNames: INTERNAL_PRODUCT_COMPANY_NAMES/);
  assert.match(analysis, /sanitizeProfessionalIdentityValue/);
  assert.doesNotMatch(
    analysis,
    /select\(\s*["']business_description,activity_description/,
  );
  assert.match(memoryRoute, /sanitizeProfessionalIdentityValue/);
  assert.match(badge, /sanitizeProfessionalIdentityText/);
  assert.match(directory, /sanitizeProfessionalIdentityText/);
  assert.match(profile, /sanitizeProfessionalIdentityText/);
});
