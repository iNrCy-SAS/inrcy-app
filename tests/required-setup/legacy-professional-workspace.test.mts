import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { resolveLegacyBusinessActivityValues } from "../../lib/legacyProfessionalWorkspace.ts";

const root = process.cwd();
const read = (relativePath: string) => readFileSync(join(root, relativePath), "utf8");

test("empty canonical activity defaults never hide populated legacy fields", () => {
  const fixture = {
    business_description: "",
    activity_description: "Conseil historique aux artisans.",
    services: [],
    services_text: "Audit SEO\nCréation de site;Accompagnement local",
    intervention_zones: ["", "  "],
    intervention_zones_text: "Arras, Lens; Béthune",
    strengths: null,
    strengths_text: "Réactivité\nConnaissance locale",
    customer_typologies: [],
    customer_types: "Artisans; TPE",
  };

  assert.deepEqual(resolveLegacyBusinessActivityValues(fixture), {
    activityDescription: "Conseil historique aux artisans.",
    services: ["Audit SEO", "Création de site", "Accompagnement local"],
    interventionZones: ["Arras", "Lens", "Béthune"],
    strengths: ["Réactivité", "Connaissance locale"],
    customerTypes: ["Artisans", "TPE"],
  });
});

test("populated canonical activity values remain authoritative", () => {
  const fixture = {
    business_description: "Description actuelle",
    activity_description: "Description historique",
    services: ["Service actuel", "service actuel", ""],
    services_text: "Ancien service",
    intervention_zones: ["Paris"],
    intervention_zones_text: "Lille",
    strengths: ["Précision"],
    strengths_text: "Rapidité",
    customer_typologies: ["PME"],
    customer_types: "Particuliers",
  };

  assert.deepEqual(resolveLegacyBusinessActivityValues(fixture), {
    activityDescription: "Description actuelle",
    services: ["Service actuel"],
    interventionZones: ["Paris"],
    strengths: ["Précision"],
    customerTypes: ["PME"],
  });
});

test("profile and activity refuse persistence after an incomplete load", () => {
  const profile = read("app/dashboard/settings/_components/ProfilContent.tsx");
  const activity = read("app/dashboard/settings/_components/ActivityContent.tsx");

  for (const [name, source] of [["profile", profile], ["activity", activity]] as const) {
    assert.match(source, /const loadSucceededRef = useRef\(false\)/, `${name}: load guard ref`);
    assert.match(source, /loadSucceededRef\.current = false/, `${name}: pessimistic load start`);
    assert.match(source, /loadSucceededRef\.current = true/, `${name}: successful load marker`);

    const saveIndex = name === "profile"
      ? source.indexOf("const handleSave = async")
      : source.indexOf("const save = async");
    const guardIndex = source.indexOf("if (!loadSucceededRef.current)", saveIndex);
    const upsertIndex = source.indexOf(".upsert", saveIndex);
    assert.ok(saveIndex >= 0 && guardIndex > saveIndex, `${name}: save guard exists`);
    assert.ok(upsertIndex > guardIndex, `${name}: guard runs before persistence`);
  }
});

test("the compact profile save keeps relocated historical columns out of its patch", () => {
  const profile = read("app/dashboard/settings/_components/ProfilContent.tsx");
  const payload = profile.slice(
    profile.indexOf('supabase.from("profiles").upsert'),
    profile.indexOf('{ onConflict: "user_id" }'),
  );

  for (const historicalColumn of [
    "legal_form",
    "hq_address",
    "siren",
    "rcs_city",
    "capital_social",
    "vat_number",
    "avg_basket",
    "lead_conversion_rate",
  ]) {
    assert.doesNotMatch(payload, new RegExp(historicalColumn), historicalColumn);
  }
});
