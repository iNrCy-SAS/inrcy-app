import assert from "node:assert/strict";
import test from "node:test";
import { normalizeGoogleTargetLocationLabels } from "../lib/adsGoogleLocations.ts";

test("les formulations iNrADN de portée nationale deviennent une zone Google identifiable", () => {
  assert.deepEqual(
    normalizeGoogleTargetLocationLabels([
      "Hauts-de-France", "et toute la France", "Arras", "Lille", "France", "Valenciennes",
    ]),
    ["Hauts-de-France", "France", "Arras", "Lille", "Valenciennes"],
  );
  assert.deepEqual(normalizeGoogleTargetLocationLabels(["toute la France", "France entière"]), ["France"]);
});

test("les zones étrangères et les noms canoniques sont conservés", () => {
  assert.deepEqual(
    normalizeGoogleTargetLocationLabels(["Lille, Hauts-de-France, France", "Bruxelles, Belgique"]),
    ["Lille, Hauts-de-France, France", "Bruxelles, Belgique"],
  );
});
