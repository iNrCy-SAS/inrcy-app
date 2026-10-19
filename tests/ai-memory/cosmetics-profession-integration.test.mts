import assert from "node:assert/strict";
import test from "node:test";
import { findJobValueByLabel, getJobLabel, getServicesForSectorAndJob } from "../../lib/activityCatalog.ts";
import { decodeBusinessSector } from "../../lib/activitySectors.ts";
import {
  buildBusinessDnaProfessionCatalog,
  buildMissingBusinessDnaProfession,
  resolveBusinessDnaProfessionSuggestion,
} from "../../lib/businessDnaActivityAutofill.ts";
import { getGeneratorRecommendation } from "../../lib/generatorSettings.ts";

const sectorCategory = "beaute_bien_etre";
const cosmeticJobs = [
  "boutique_cosmetiques", "marque_cosmetique", "fabricant_cosmetiques", "formulateur_cosmetiques",
  "grossiste_cosmetiques", "parfumerie", "savonnerie", "cosmetiques_naturels",
  "vente_domicile_beaute", "boutique_beaute_en_ligne", "produits_capillaires", "maquillage_cosmetiques",
];

test("cosmetic professions travel from the ADN catalogue to a saved profile and back to their offers", () => {
  const catalogue = buildBusinessDnaProfessionCatalog();
  for (const job of cosmeticJobs) {
    const label = getJobLabel(sectorCategory, job);
    assert.ok(label, job);
    assert.ok(catalogue.includes(`${sectorCategory}/${job} : ${label}`), job);
    const sourceQuote = `Notre activité est ${label}`;
    const suggestion = resolveBusinessDnaProfessionSuggestion(
      { sectorCategory, job, confidence: "high", sourceQuote },
      [{ status: "analyzed", content: `${sourceQuote}. Découvrez notre entreprise.` }],
    );
    assert.deepEqual(suggestion, { sectorCategory, job }, job);
    const stored = buildMissingBusinessDnaProfession("", suggestion);
    const restored = decodeBusinessSector(stored);
    assert.deepEqual(restored, { sectorCategory, profession: label }, job);
    const restoredJob = findJobValueByLabel(restored.sectorCategory, restored.profession);
    assert.equal(restoredJob, job);
    assert.equal(getServicesForSectorAndJob(restored.sectorCategory, restoredJob).length, 8);
    const recommendation = getGeneratorRecommendation(stored);
    assert.equal(recommendation.sectorCategory, sectorCategory);
    assert.ok(recommendation.avgBasket > 0 && recommendation.conversionRate > 0);
  }
});

test("a cosmetic suggestion never replaces an existing professional activity or invents source evidence", () => {
  const suggestion = { sectorCategory, job: "boutique_cosmetiques" };
  for (const stored of ["[[SECTOR:communication]] Agence de communication", "[[SECTOR:beaute_bien_etre]] Institut de beauté"]) {
    assert.equal(buildMissingBusinessDnaProfession(stored, suggestion), null);
  }
  assert.equal(resolveBusinessDnaProfessionSuggestion(
    { ...suggestion, confidence: "high", sourceQuote: "Notre boutique vend des cosmétiques" },
    [{ status: "analyzed", content: "Notre atelier répare des vélos." }],
  ), null);
});
