import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath: string) => readFileSync(join(root, relativePath), "utf8");

const completeProfile = {
  first_name: "Apolline",
  last_name: "Martin",
  phone: "0612345678",
  contact_email: "bonjour@example.fr",
  company_legal_name: "Entreprise exemple",
  hq_zip: "62000",
  hq_city: "Arras",
};

const completeActivity = {
  sector: "communication::Agence de communication",
  opening_days: "",
  opening_hours: "Du lundi au vendredi, 9h-18h",
  services: ["Stratégie", "Création de contenus"],
  intervention_zones: ["Arras", "Lens"],
  strengths: ["Réactivité", "Sur mesure"],
  customer_typologies: ["professionnels"],
};

test("legal and generator-only values do not block required setup", () => {
  const completionSource = read("lib/dashboardCompletion.ts");
  const profileFieldsBlock = completionSource.match(
    /DASHBOARD_PROFILE_COMPLETION_FIELDS = \[([\s\S]*?)\] as const/,
  )?.[1] ?? "";

  for (const field of Object.keys(completeProfile)) {
    assert.match(profileFieldsBlock, new RegExp(`"${field}"`));
  }
  assert.doesNotMatch(
    profileFieldsBlock,
    /hq_address|hq_country|siren|rcs_city|capital_social|vat_number|avg_basket|lead_conversion_rate/,
  );

  const activityFieldsBlock = completionSource.match(
    /DASHBOARD_ACTIVITY_COMPLETION_FIELDS = \[([\s\S]*?)\] as const/,
  )?.[1] ?? "";
  for (const field of ["services", "intervention_zones", "strengths", "customer_typologies"]) {
    assert.match(activityFieldsBlock, new RegExp(`"${field}"`));
  }
  assert.equal(Boolean(completeActivity.opening_hours), true);
});

test("the profile form contains only the public essentials", () => {
  const source = read("app/dashboard/settings/_components/ProfilContent.tsx");
  assert.match(source, /companyName/);
  assert.match(source, /hqZip/);
  assert.match(source, /hqCity/);
  assert.doesNotMatch(source, /avg_basket|lead_conversion_rate|legal_form|hq_address|siren|rcs_city|capital_social|vat_number/);

  const companyIndex = source.indexOf('value={form.companyName}');
  const emailIndex = source.indexOf('value={form.contactEmail}');
  const firstNameIndex = source.indexOf('value={form.firstName}');
  const locationIndex = source.indexOf('value={form.hqZip}');
  const logoIndex = source.indexOf('ref={fileInputRef}');
  assert.ok(companyIndex >= 0);
  assert.ok(companyIndex < emailIndex);
  assert.ok(emailIndex < firstNameIndex);
  assert.ok(firstNameIndex < locationIndex);
  assert.ok(locationIndex < logoIndex);
});

test("activity collections use removable tags and no legacy free service field", () => {
  const source = read("app/dashboard/settings/_components/ActivityContent.tsx");
  assert.match(source, /<EditableTags[\s\S]*values=\{form\.services\}/);
  assert.match(source, /values=\{form\.interventionZones\}/);
  assert.match(source, /values=\{form\.strengths\}/);
  assert.doesNotMatch(source, /selectedServices|customServices|Autres prestations/);
});

test("Encaisser and the generator keep the exact historical database columns", () => {
  const legal = read("app/dashboard/settings/_components/BusinessLegalSettingsCard.tsx");
  const generator = read("app/dashboard/_components/GeneratorSettingsModal.tsx");

  assert.match(legal, /company_legal_name,legal_form,legal_form_other,hq_address,hq_zip,hq_city,hq_country,siren,rcs_city,capital_social,capital_dispense_ei,vat_number,vat_dispense/);
  assert.match(legal, /\.upsert\(payload, \{ onConflict: "user_id" \}\)/);
  assert.match(generator, /\.select\("avg_basket,lead_conversion_rate"\)/);
  assert.match(generator, /avg_basket: normalized\.avgBasket/);
  assert.match(generator, /lead_conversion_rate: normalized\.conversionRate/);
});

test("profile and activity are grouped into one regular profile panel", () => {
  const content = read("app/dashboard/_components/DashboardSettingsDrawerContent.tsx");
  const combined = read("app/dashboard/settings/_components/ProfileAndActivityContent.tsx");
  const activity = read("app/dashboard/settings/_components/ActivityContent.tsx");
  const menu = read("app/dashboard/_components/UserMenu.tsx");
  const client = read("app/dashboard/DashboardClient.tsx");
  const drawer = read("app/dashboard/SettingsDrawer.tsx");

  assert.match(content, /panel === "profil" \|\| panel === "activite"/);
  assert.match(content, /<ProfileAndActivityContent/);
  assert.match(combined, /data-profile-block="identity"/);
  assert.match(combined, /data-profile-block="activity"/);
  assert.match(combined, /<ProfilContent[\s\S]*showActions=\{false\}/);
  assert.match(combined, /<ActivityContent[\s\S]*showActions=\{false\}/);
  assert.match(combined, /handleSaveAll/);
  assert.match(activity, /data-activity-section="identity"/);
  assert.match(activity, /data-activity-section="reach"/);
  assert.match(activity, /data-activity-section="positioning"/);
  assert.doesNotMatch(menu, /closeAndOpen\("activite"\)/);
  assert.doesNotMatch(content, /guidedOnboarding|onOnboarding/);
  assert.doesNotMatch(client, /guidedOnboarding|onboardingProgress/);
  assert.doesNotMatch(drawer, /presentation.*onboarding|contentDirection/);
});
