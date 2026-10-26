import assert from "node:assert/strict";
import test from "node:test";

import { searchActivityJobs } from "../../lib/activityJobSearch.ts";
import { findJobValueByLabel, getServicesForSectorAndJob } from "../../lib/activityCatalog.ts";
import { decodeBusinessSector, encodeBusinessSector, inferSectorCategoryFromProfession } from "../../lib/activitySectors.ts";

test("trouve un métier à partir de quelques lettres", () => {
  const [result] = searchActivityJobs("paysa");
  assert.equal(result?.job, "paysagiste");
  assert.equal(result?.sectorCategory, "exterieur_jardin");
});

test("ignore les accents et les tirets", () => {
  const [result] = searchActivityJobs("auto ecole");
  assert.equal(result?.job, "auto_ecole");
  assert.equal(result?.sectorCategory, "formation_enseignement");
});

test("retrouve un métier depuis un alias courant", () => {
  const [result] = searchActivityJobs("permis bateau");
  assert.equal(result?.job, "bateau_ecole");
});

test("tolère une petite faute de frappe", () => {
  const [result] = searchActivityJobs("payagiste");
  assert.equal(result?.job, "paysagiste");
});

test("classe la correspondance métier exacte avant les résultats voisins", () => {
  const [result] = searchActivityJobs("agence de communication");
  assert.equal(result?.job, "agence_communication");
  assert.equal(result?.sectorCategory, "communication");
});

test("retrouve et conserve le métier E-commerce avec ses différents noms et ses prestations", () => {
  for (const query of ["e-commerce", "ecommerce", "boutique en ligne", "vente en ligne", "e-commerçant", "e-commerçante", "e-shop", "site marchand"]) {
    const [result] = searchActivityJobs(query);
    assert.equal(result?.sectorCategory, "commerce_boutique", query);
    assert.equal(result?.job, "e_commerce", query);
    assert.equal(findJobValueByLabel("commerce_boutique", query), "e_commerce", query);
    assert.equal(inferSectorCategoryFromProfession(query), "commerce_boutique", query);
  }
  const [result] = searchActivityJobs("E-commerce / Boutique en ligne");
  const saved = encodeBusinessSector(result.sectorCategory, result.jobLabel);
  assert.deepEqual(decodeBusinessSector(saved), { sectorCategory: "commerce_boutique", profession: "E-commerce / Boutique en ligne" });
  assert.equal(getServicesForSectorAndJob(result.sectorCategory, result.job).length, 8);
  assert.equal(searchActivityJobs("boutique de cosmétiques en ligne")[0]?.job, "boutique_beaute_en_ligne", "Les métiers spécialisés existants restent disponibles");
});
