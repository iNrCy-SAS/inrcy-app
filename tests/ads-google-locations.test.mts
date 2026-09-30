import assert from "node:assert/strict";
import test from "node:test";
import { googleLocationSuggestions, normalizeGoogleTargetLocationLabels, selectGoogleTargetLocation } from "../lib/adsGoogleLocations.ts";

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

test("les suggestions Google conservent les homonymes canoniques et excluent les zones non utilisables", () => {
  const suggestion = (id: string, canonicalName: string, countryCode = "FR", status = "ENABLED") => ({ geoTargetConstant: {
    resourceName: `geoTargetConstants/${id}`, id, name: "Lille", canonicalName, countryCode, status,
  } });
  assert.deepEqual(googleLocationSuggestions({ geoTargetConstantSuggestions: [
    suggestion("100001", "Lille,Hauts-de-France,France"),
    suggestion("200002", "Lille,Flanders,Belgium", "BE"),
    suggestion("300003", "Lille,France", "FR", "REMOVAL_PLANNED"),
    suggestion("100001", "Lille,Hauts-de-France,France"),
    suggestion("not-an-id", "Lille,France"),
    suggestion("400004", ""),
  ] }), [
    { id: "100001", name: "Lille", canonicalName: "Lille,Hauts-de-France,France", country: "FR" },
    { id: "200002", name: "Lille", canonicalName: "Lille,Flanders,Belgium", country: "BE" },
  ]);
  assert.deepEqual(googleLocationSuggestions({}), []);
});

test("le choix explicite Google précise uniquement la zone homonyme et conserve les autres zones", () => {
  const option = { id: "100001", name: "Lille", canonicalName: "Lille,Hauts-de-France,France", country: "FR" };
  const before = ["Lille", "Arras"];
  assert.deepEqual(selectGoogleTargetLocation(before, option), [option.canonicalName, "Arras"]);
  assert.deepEqual(before, ["Lille", "Arras"]);
  assert.deepEqual(selectGoogleTargetLocation(["Arras"], option), ["Arras", option.canonicalName]);
  assert.deepEqual(selectGoogleTargetLocation([option.canonicalName], option), [option.canonicalName]);
  assert.deepEqual(selectGoogleTargetLocation(["Lille", option.canonicalName, "Arras"], option), [option.canonicalName, "Arras"]);
});
