import assert from "node:assert/strict";
import test from "node:test";
import { adsUiText, translateAdsUiChoices } from "../app/dashboard/ads/adsUiCopy.ts";

test("ADS option translation copies labels while preserving connector values and source data", () => {
  const choices = Object.freeze([{ value: "website_traffic", label: "Trafic", id: "meta", format: "4:5", at: 12 }]);
  const translated = translateAdsUiChoices(choices, key => `[${key}]`);
  assert.notEqual(translated, choices);
  assert.match(translated[0].label, /^\[/);
  assert.deepEqual({ ...translated[0], label: choices[0].label }, choices[0]);
  assert.equal(choices[0].label, "Trafic");
});

test("ADS known validation templates preserve inserted names, amounts and punctuation", () => {
  const captured: Array<Record<string, string | number> | undefined> = [];
  const result = adsUiText((_key, values) => { captured.push(values); return "localized"; }, "Le lancement LinkedIn nécessite 50 € pour ce format.");
  assert.equal(result, "localized");
  assert.deepEqual(captured, [{ value0: "50 €" }]);
  let values: Record<string, string | number> | undefined;
  adsUiText((_key, input) => { values = input; return "localized"; }, "Client [A+B] · ID abc-123 · Administrateur");
  assert.deepEqual(values, { value0: "Client [A+B]", value1: "abc-123", value2: "Administrateur" });
});

test("ADS presentation helpers leave unknown content intact and retain standalone French defaults", () => {
  assert.equal(adsUiText(undefined, "{value0} au total", { value0: "50 €" }), "50 € au total");
  assert.equal(adsUiText(() => "changed", "My own campaign title 🌿"), "My own campaign title 🌿");
  assert.equal(adsUiText(() => "changed", null), "");
  assert.equal(adsUiText(() => "changed", undefined), "");
});
