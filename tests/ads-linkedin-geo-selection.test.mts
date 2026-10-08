import assert from "node:assert/strict";
import test from "node:test";
import { removeLinkedInBriefGeoTargets } from "../lib/adsLinkedInGeoSelection.ts";

const france = { urn: "urn:li:geo:105015875", name: "France" };
const region = { urn: "urn:li:geo:104570880", name: "Hauts-de-France" };
const lille = { urn: "urn:li:geo:100323840", name: "Lille" };
test("retirer France du brief retire aussi sa diffusion nationale", () => {
  assert.deepEqual(removeLinkedInBriefGeoTargets(["France", "Hauts-de-France"], ["Hauts-de-France"], [{ query: "France", suggestions: [france] }, { query: "Hauts-de-France", suggestions: [region] }], [france, region]), { targets: [region], dismissed: [france.urn] });
});
test("deux libellés encore reliés à la même zone ne perdent pas cette zone", () => {
  assert.deepEqual(removeLinkedInBriefGeoTargets(["Lille", "Lille et périphérie"], ["Lille"], [{ query: "Lille", suggestions: [lille] }, { query: "Lille et périphérie", suggestions: [lille] }], [lille]), { targets: [lille], dismissed: [] });
});
test("un ajout manuel indépendant du brief est conservé", () => {
  assert.deepEqual(removeLinkedInBriefGeoTargets(["France"], [], [{ query: "France", suggestions: [france] }, { query: "Lille", suggestions: [lille] }], [france, lille]), { targets: [lille], dismissed: [france.urn] });
});
test("la suppression respecte casse et espaces sans muter les listes", () => {
  const selected = [france, lille];
  assert.deepEqual(removeLinkedInBriefGeoTargets([" FRANCE "], [], [{ query: "France", suggestions: [france] }], selected), { targets: [lille], dismissed: [france.urn] });
  assert.deepEqual(selected, [france, lille]);
});

test("un candidat non choisi dans une zone conservée ne maintient pas une diffusion nationale supprimée", () => {
  const resolutions = [{ query: "France", suggestions: [france], autoSelectedUrn: france.urn }, { query: "Hauts-de-France", suggestions: [region, france], autoSelectedUrn: region.urn }];
  assert.deepEqual(removeLinkedInBriefGeoTargets(["France", "Hauts-de-France"], ["Hauts-de-France"], resolutions, [france, region]), { targets: [region], dismissed: [france.urn] });
});
test("retirer une ville d’un ancien brouillon avant le lookup retire son URN enregistrée", () => {
  const target = { ...lille, name: "Lille, Hauts-de-France, France" };
  assert.deepEqual(removeLinkedInBriefGeoTargets(["Lille"], [], [], [target]), { targets: [], dismissed: [lille.urn] });
});
test("une sélection manuelle liée à une autre recherche reste conservée même si le défaut natif diffère", () => {
  const rows = [{ query: "France", suggestions: [france], autoSelectedUrn: france.urn }, { query: "Nouvelle recherche", suggestions: [region, france], autoSelectedUrn: region.urn }];
  assert.deepEqual(removeLinkedInBriefGeoTargets(["France"], [], rows, [france], { "nouvelle recherche": france.urn }), { targets: [france], dismissed: [] });
});


test("une résolution ambiguë sans choix ne conserve pas un candidat national supprimé", () => {
  const rows = [{ query: "France", suggestions: [france] }, { query: "Hauts-de-France", suggestions: [region, france], autoSelectedUrn: null }];
  assert.deepEqual(removeLinkedInBriefGeoTargets(["France", "Hauts-de-France"], ["Hauts-de-France"], rows, [france, region]), { targets: [region], dismissed: [france.urn] });
});
