import assert from "node:assert/strict";
import test from "node:test";
import { getInrStudioInitialCreationMode } from "../../lib/inrStudioModalPolicy.ts";

test("Booster direct or routed through Studio opens guided when its subject already exists", () => {
  assert.equal(getInrStudioInitialCreationMode({ source: "booster", origin: "booster", publicationBrief: "Notre menu de dimanche" }), "guided");
  assert.equal(getInrStudioInitialCreationMode({ source: "studio", origin: "booster", publicationBrief: "  Présenter notre atelier  " }), "guided");
});

test("a blank subject and ordinary Studio open free; explicit free-only callers retain their contract", () => {
  assert.equal(getInrStudioInitialCreationMode({ source: "studio", origin: "booster", publicationBrief: " \n\t " }), "free");
  assert.equal(getInrStudioInitialCreationMode({ source: "studio", origin: "menu", publicationBrief: "Sujet d'une autre surface" }), "free");
  assert.equal(getInrStudioInitialCreationMode({ source: "studio", origin: "booster", publicationBrief: "Menu", freeOnly: true }), "free");
  for (const origin of ["ads", "inragent", "inrsend"]) {
    assert.equal(getInrStudioInitialCreationMode({ source: "studio", origin, publicationBrief: "Consigne externe" }), "free");
  }
});
