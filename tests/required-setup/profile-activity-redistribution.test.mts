import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { evaluateDashboardRequiredSetupCompletion } from "../../lib/dashboardCompletion.ts";

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
  sector: "[[SECTOR:communication]] Agence de communication",
};

test("completion requires coordinates plus sector and profession, but no DNA enrichment", () => {
  assert.equal(
    evaluateDashboardRequiredSetupCompletion(completeProfile, completeActivity).completed,
    true,
  );
  assert.equal(
    evaluateDashboardRequiredSetupCompletion(completeProfile, {
      ...completeActivity,
      opening_days: "",
      opening_hours: "",
      intervention_zones: [],
      services: [],
      strengths: [],
      customer_typologies: [],
    }).completed,
    true,
  );

  for (const field of Object.keys(completeProfile)) {
    assert.equal(
      evaluateDashboardRequiredSetupCompletion(
        { ...completeProfile, [field]: "" },
        completeActivity,
      ).completed,
      false,
      field,
    );
  }

  assert.equal(
    evaluateDashboardRequiredSetupCompletion(completeProfile, { sector: "" }).completed,
    false,
  );
  assert.equal(
    evaluateDashboardRequiredSetupCompletion(completeProfile, {
      sector: "[[SECTOR:communication]]",
    }).completed,
    false,
  );
});

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
    assert.doesNotMatch(activityFieldsBlock, new RegExp(`"${field}"`));
  }
  assert.equal(Boolean(completeActivity.sector), true);
  assert.doesNotMatch(completionSource, /opening_days|opening_hours|opening_schedule/);
});

test("the browser completion cache is versioned with the redistributed required fields", () => {
  const completionHook = read("app/dashboard/_hooks/useDashboardCompletionChecks.ts");
  const browserCache = read("lib/browserAccountCache.ts");

  assert.match(
    completionHook,
    /COMPLETION_CACHE_KEY = "inrcy_dashboard_completion_state_v2"/,
  );
  assert.match(browserCache, /"inrcy_dashboard_completion_state_v1"/);
  assert.match(browserCache, /"inrcy_dashboard_completion_state_v2"/);
});

test("profile save rejects a missing sector or profession before persistence and success", () => {
  const source = read("app/dashboard/settings/_components/ActivityContent.tsx");
  const saveIndex = source.indexOf("const save = async");
  const guardIndex = source.indexOf("const missingRequiredFields", saveIndex);
  const persistenceIndex = source.indexOf(".upsert(payload", saveIndex);
  const successIndex = source.indexOf("await onActivitySaved?.()", saveIndex);

  assert.ok(saveIndex >= 0);
  assert.ok(guardIndex > saveIndex);
  assert.ok(persistenceIndex > guardIndex);
  assert.ok(successIndex > persistenceIndex);

  const guardSource = source.slice(guardIndex, persistenceIndex);
  assert.match(guardSource, /!form\.sectorCategory\.trim\(\)/);
  assert.match(guardSource, /!form\.sector\.trim\(\)/);
  assert.match(guardSource, /pour_continuer_completez_value_ad238d6f/);
  assert.match(guardSource, /if \(missingRequiredFields\.length > 0\)[\s\S]*return false/);
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

test("business enrichment collections live in Business DNA and stay out of the compact profile", () => {
  const source = read("app/dashboard/settings/_components/ActivityContent.tsx");
  const combined = read("app/dashboard/settings/_components/ProfileAndActivityContent.tsx");
  const dna = read("app/dashboard/settings/_components/AiMemoryContent.tsx");
  assert.match(combined, /contentScope="profile-core"/);
  assert.match(source, /!isProfileCore \? <div style=\{label\}>[\s\S]*values=\{form\.services\}/);
  assert.match(source, /!isProfileCore \? <section data-activity-section="positioning"/);
  assert.match(dna, /values=\{businessKnowledge\.services\}/);
  assert.match(dna, /values=\{businessKnowledge\.interventionZones\}/);
  assert.match(dna, /values=\{businessKnowledge\.strengths\}/);
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

test("profile and activity are grouped into one dedicated full-page profile tool", () => {
  const content = read("app/dashboard/_components/DashboardSettingsDrawerContent.tsx");
  const combined = read("app/dashboard/settings/_components/ProfileAndActivityContent.tsx");
  const page = read("app/dashboard/mon-profil/page.tsx");
  const routing = read("app/dashboard/_hooks/useDashboardPanelRouting.ts");
  const activity = read("app/dashboard/settings/_components/ActivityContent.tsx");
  const menu = read("app/dashboard/_components/UserMenu.tsx");
  const client = read("app/dashboard/DashboardClient.tsx");
  const drawer = read("app/dashboard/SettingsDrawer.tsx");

  assert.doesNotMatch(content, /<ProfileAndActivityContent/);
  assert.match(page, /data-profile-workspace-page/);
  assert.match(page, /<ProfileAndActivityContent/);
  assert.match(routing, /"\/dashboard\/mon-profil"/);
  assert.match(combined, /data-profile-block="general"/);
  assert.equal((combined.match(/data-profile-block=/g) || []).length, 1);
  assert.match(combined, /data-profile-segment="identity"/);
  assert.match(combined, /data-profile-segment="activity"/);
  assert.ok(combined.indexOf('data-profile-segment="identity"') < combined.indexOf('data-profile-segment="activity"'));
  assert.ok(combined.indexOf('data-profile-segment="activity"') < combined.indexOf('onClick={onOpenAiMemory}'));
  assert.match(combined, /<ProfilContent[\s\S]*showActions=\{false\}/);
  assert.match(combined, /<ActivityContent[\s\S]*showActions=\{false\}/);
  assert.match(combined, /handleSaveAll/);
  assert.match(activity, /data-activity-section="identity"/);
  assert.match(activity, /!isProfileCore \? <section data-activity-section="reach"/);
  assert.match(activity, /data-activity-section="positioning"/);
  assert.doesNotMatch(menu, /closeAndOpen\("activite"\)/);
  assert.doesNotMatch(content, /guidedOnboarding|onOnboarding/);
  assert.doesNotMatch(client, /guidedOnboarding|onboardingProgress/);
  assert.doesNotMatch(drawer, /presentation.*onboarding|contentDirection/);
});
