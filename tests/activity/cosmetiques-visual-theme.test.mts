import assert from "node:assert/strict";
import test from "node:test";

import { getJobLabel } from "../../lib/activityCatalog.ts";
import { encodeBusinessSector, getActivitySectorLabel } from "../../lib/activitySectors.ts";
import { inferInrSearchVisualTheme } from "../../lib/inrSearchVisualIdentity.ts";

const cosmeticsJobs = [
  "boutique_cosmetiques", "marque_cosmetique", "fabricant_cosmetiques", "formulateur_cosmetiques",
  "grossiste_cosmetiques", "parfumerie", "savonnerie", "cosmetiques_naturels", "vente_domicile_beaute",
  "boutique_beaute_en_ligne", "produits_capillaires", "maquillage_cosmetiques",
];
const sector = "beaute_bien_etre";

test("the twelve cosmetics product activities keep the beauty theme for IDs, labels and actual stored/public profession formats", () => {
  for (const job of cosmeticsJobs) {
    const label = getJobLabel(sector, job);
    assert.ok(label, `${job} must remain a catalogued primary activity`);
    for (const value of [
      job,
      label,
      `${job} ${sector}`,
      `${label} ${getActivitySectorLabel(sector)}`,
      `${sector} ${label}`,
      encodeBusinessSector(sector, job),
      encodeBusinessSector(sector, label),
    ]) assert.equal(inferInrSearchVisualTheme(value), "beauty", value);
  }
});

test("pharmacies and artisans keep their primary theme when cosmetics are an accessory or a quoted activity", () => {
  for (const value of [
    "Pharmacie / vente de cosmétiques",
    "Pharmacie proposant une boutique de cosmétiques",
    "Pharmacie avec un rayon de produits capillaires Beauté / Bien-être",
    "[[SECTOR:sante]] Pharmacie / vente de maquillage / cosmétiques",
    "Cabinet médical et conseils sur les cosmétiques naturels / bio",
  ]) assert.equal(inferInrSearchVisualTheme(value), "care", value);
  for (const value of [
    "Menuisier artisan proposant des présentoirs pour une savonnerie artisanale",
    "Artisan peintre pour boutique de cosmétiques",
    "[[SECTOR:artisan_btp]] Menuisier avec vente accessoire de cosmétiques naturels",
  ]) assert.equal(inferInrSearchVisualTheme(value), "craft", value);
});

test("the existing beauty, healthcare, craft, training and digital activities retain their themes", () => {
  const previousThemes = [
    ["Institut de beauté", "beauty"],
    ["Coiffeur / Barber", "beauty"],
    ["Spa / Bien-être", "care"],
    ["Institut de beauté Beauté / Bien-être", "care"],
    ["Pharmacie Santé", "care"],
    ["Artisan menuisier BTP", "craft"],
    ["formation_enseignement Auto-école", "motion"],
    ["plateformes_numeriques marketplace SaaS", "digital"],
  ] as const;
  for (const [value, theme] of previousThemes) assert.equal(inferInrSearchVisualTheme(value), theme, value);
});
