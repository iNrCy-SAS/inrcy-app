import assert from "node:assert/strict";
import test from "node:test";

import { findJobValueByLabel, getJobLabel, getServicesForSectorAndJob } from "../../lib/activityCatalog.ts";
import { decodeBusinessSector, encodeBusinessSector, getActivitySectorLabel } from "../../lib/activitySectors.ts";
import {
  buildBusinessDnaProfessionCatalog,
  buildMissingBusinessDnaProfession,
  resolveBusinessDnaProfessionSuggestion,
} from "../../lib/businessDnaActivityAutofill.ts";
import { evaluateDashboardPreparationCompletion } from "../../lib/dashboardCompletion.ts";
import { getGeneratorRecommendation } from "../../lib/generatorSettings.ts";
import { inferInrSearchVisualTheme } from "../../lib/inrSearchVisualIdentity.ts";

const sectorCategory = "voyance_arts_divinatoires";
const divinationJobs = [
  "voyant", "medium", "tarologue", "cartomancien", "astrologue", "numerologue", "chiromancien", "radiesthesiste_divinatoire",
];
const profile = {
  first_name: "Camille", last_name: "Martin", phone: "0612345678", contact_email: "contact@example.fr",
  company_legal_name: "Cabinet exemple", hq_zip: "62000", hq_city: "Arras",
};

test("all eight divination professions reach ADN, their saved profile, eight services and the existing generator defaults", () => {
  const catalogue = buildBusinessDnaProfessionCatalog();
  const defaults = getGeneratorRecommendation(encodeBusinessSector("autre", "Métier libre"));
  for (const job of divinationJobs) {
    const label = getJobLabel(sectorCategory, job);
    assert.ok(label, job);
    assert.ok(catalogue.includes(`${sectorCategory}/${job} : ${label}`), job);
    const sourceQuote = `Notre activité professionnelle est ${label}`;
    const suggestion = resolveBusinessDnaProfessionSuggestion(
      { sectorCategory, job, confidence: "high", sourceQuote },
      [{ status: "analyzed", content: `${sourceQuote}. Retrouvez la présentation de notre cabinet.` }],
    );
    assert.deepEqual(suggestion, { sectorCategory, job }, job);
    const stored = buildMissingBusinessDnaProfession("", suggestion);
    const decoded = decodeBusinessSector(stored);
    assert.deepEqual(decoded, { sectorCategory, profession: label }, job);
    const restoredJob = findJobValueByLabel(decoded.sectorCategory, decoded.profession);
    assert.equal(restoredJob, job);
    const services = getServicesForSectorAndJob(decoded.sectorCategory, restoredJob);
    assert.equal(services.length, 8, job);
    assert.equal(new Set(services).size, 8, job);
    assert.equal(evaluateDashboardPreparationCompletion(profile, { sector: stored, services }).completed, true);
    assert.deepEqual(getGeneratorRecommendation(stored), {
      avgBasket: defaults.avgBasket,
      conversionRate: defaults.conversionRate,
      sectorCategory,
      sectorLabel: "Voyance / Arts divinatoires",
    });
  }
});

test("divination suggestions require source evidence and never replace an existing chosen activity", () => {
  const suggestion = { sectorCategory, job: "medium" };
  for (const stored of [
    "[[SECTOR:communication]] Agence de communication",
    "[[SECTOR:beaute_bien_etre]] Boutique de cosmétiques",
    encodeBusinessSector(sectorCategory, getJobLabel(sectorCategory, "tarologue")),
  ]) assert.equal(buildMissingBusinessDnaProfession(stored, suggestion), null);
  const proposal = { ...suggestion, confidence: "high", sourceQuote: "Notre cabinet propose des consultations de médiumnité" };
  assert.equal(resolveBusinessDnaProfessionSuggestion(proposal, [{ status: "analyzed", content: "Notre agence crée des sites web." }]), null);
  assert.equal(resolveBusinessDnaProfessionSuggestion(proposal, [{ status: "failed", content: proposal.sourceQuote }]), null);
});

test("divination public profiles keep the signature theme, including Médium, while media businesses retain digital", () => {
  for (const job of divinationJobs) {
    const label = getJobLabel(sectorCategory, job);
    for (const value of [job, label, `${label} ${getActivitySectorLabel(sectorCategory)}`, encodeBusinessSector(sectorCategory, label)]) {
      assert.equal(inferInrSearchVisualTheme(value), "signature", value);
    }
  }
  assert.equal(inferInrSearchVisualTheme("Médium Voyance / Arts divinatoires"), "signature");
  assert.equal(inferInrSearchVisualTheme("Agence média Communication"), "digital");
  assert.equal(inferInrSearchVisualTheme("Community manager / social media"), "digital");
});
