import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseAdsCampaignInput } from "../lib/adsValidation.ts";
import { buildLinkedInGeoQueries } from "../lib/adsLinkedInGeoQueries.ts";

const client = readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8");

function linkedInDraft(overrides: Record<string, unknown> = {}) {
  const endDate = new Date(Date.now() + 8 * 86_400_000).toISOString().slice(0, 10);
  return {
    provider: "linkedin",
    creationMode: "manual",
    adAccountId: "",
    accountCurrency: "EUR",
    name: "Campagne LinkedIn",
    offer: "Accompagnement professionnel",
    dailyBudgetEuros: 30,
    endDate,
    destinationUrl: "https://example.com/offre",
    targetLocations: ["France"],
    targetAudiences: ["Décideurs de PME"],
    languages: ["fr"],
    primaryText: "Découvrez notre accompagnement pour les entreprises.",
    creativeType: "image",
    mediaStrategy: "image",
    headlines: ["Un accompagnement pour avancer"],
    descriptions: [],
    keywords: [],
    negativeKeywords: [],
    ...overrides,
  };
}

test("un nouveau parcours LinkedIn affiche NOT_POLITICAL cochée, mais exige une action anti-discrimination", () => {
  assert.match(client, /provider === "linkedin"[\s\S]*linkedinPoliticalIntentConfirmed: true,[\s\S]*linkedinTargetingNoticeAcknowledged: false/);
  assert.match(client, /data-linkedin-political-confirmation="true"/);
  assert.match(client, /data-linkedin-targeting-notice="true"/);
  assert.match(client, /NOT_POLITICAL/);
  assert.match(client, /Aucune annonce de cette campagne ne constitue une publicité politique/);
  assert.match(client, /politiques LinkedIn et les exigences réglementaires applicables/);
  assert.match(client, /ne doivent pas être utilisés pour discriminer/);
});

test("un brouillon LinkedIn historique sans confirmations reste non confirmé à la réouverture", () => {
  const parsed = parseAdsCampaignInput(linkedInDraft(), { purpose: "draft" });
  assert.equal(parsed.error, null);
  assert.equal(parsed.draft?.linkedinPoliticalIntentConfirmed, false);
  assert.equal(parsed.draft?.linkedinTargetingNoticeAcknowledged, false);
});

test("les seules ressources LinkedIn vérifiées sont présélectionnées sans masquer les choix manuels", () => {
  assert.match(client, /data-linkedin-provider-resources="true"/);
  assert.match(client, /Sélectionnez un groupe vérifié/);
  assert.match(client, /Sélectionnez une Page autorisée/);
  assert.match(client, /linkedinCampaignGroupId: event\.target\.value/);
  assert.match(client, /linkedinOrganizationUrn: event\.target\.value/);
  assert.match(client, /function applyLinkedInProviderDefaults/);
  assert.match(client, /selected\.campaignGroup/);
  assert.match(client, /selected\.organization/);
  assert.match(client, /selected\.verifiedGeoTargets/);
  assert.match(client, /selected\.bidAmount/);
  assert.match(client, /linkedInAutomaticLoadKey/);
  assert.match(client, /Vérification automatique des ressources LinkedIn/);
  assert.doesNotMatch(client, /Charger les ressources LinkedIn/);
  assert.match(client, /CONTENT_ADMINISTRATOR/);
  assert.match(client, /Administrateur de contenu/);
  for (const field of [
    "linkedinCampaignGroupId",
    "linkedinOrganizationUrn",
    "linkedinGeoTargets",
    "linkedinBidEuros",
    "linkedinPoliticalIntentConfirmed",
    "linkedinTargetingNoticeAcknowledged",
  ]) {
    assert.match(client, new RegExp(`NATIVE_BRIEF_SAFE_EDITS[\\s\\S]{0,800}"${field}"`), field);
  }
  assert.doesNotMatch(client, /linkedInCampaignGroups\s*\[\s*0\s*\]/);
  assert.doesNotMatch(client, /linkedInOrganizations\s*\[\s*0\s*\]/);
});

test("les zones LinkedIn conservent ensemble leur libellé et leur URN vérifiée", () => {
  const geoTargets = [
    { urn: "urn:li:geo:105015875", name: "France" },
    { urn: "urn:li:geo:102264497", name: "Lyon et périphérie" },
  ];
  const parsed = parseAdsCampaignInput(linkedInDraft({ linkedinGeoTargets: geoTargets }), { purpose: "draft" });
  assert.equal(parsed.error, null);
  assert.deepEqual(parsed.draft?.linkedinGeoTargets, geoTargets);
  assert.match(client, /target\.name} · \{target\.urn/);
  assert.match(client, /params\.append\("geoUrn", target\.urn\)/);

  const labelOnly = parseAdsCampaignInput(linkedInDraft({ linkedinGeoTargets: [{ name: "France" }] }), { purpose: "draft" });
  assert.match(labelOnly.error || "", /zones LinkedIn sélectionnées sont invalides/);
});

test("le préflight vérifie chaque tag du brief et garde une recherche manuelle avec huit zones", () => {
  const eight = ["Arras", "Lille", "Valenciennes", "Saint-Omer", "Cambrai", "Sallaumines", "Harnes", "Lens"];
  assert.deepEqual(buildLinkedInGeoQueries(["Arras", " arras ", "Lille"]).queries, ["Arras", "Lille"]);
  assert.deepEqual(buildLinkedInGeoQueries(eight), { queries: eight, manualOnly: false });
  assert.deepEqual(buildLinkedInGeoQueries(eight, "Douai"), { queries: ["Douai"], manualOnly: true });
  assert.deepEqual(buildLinkedInGeoQueries(eight.slice(0, 7), "Douai"), {
    queries: ["Douai"], manualOnly: true,
  });
  assert.deepEqual(buildLinkedInGeoQueries(eight, "Arras"), { queries: ["Arras"], manualOnly: true });
  assert.throws(() => buildLinkedInGeoQueries([...eight, "Douai"]), /huit zones/);
  assert.match(client, /for \(const query of geoQueries\) params\.append\("geo", query\)/);
  assert.match(client, /\? \[\.\.\.linkedInGeoTargets, \{ urn: target\.urn, name: target\.name \}\]/);
  assert.match(client, /draft\.targetLocations\.every\(\(label\) => linkedInBriefGeoStatus\(label\)\.verified\)/);
  assert.match(client, /if \(!geoQueryOverride\) applyLinkedInProviderDefaults\(data\)/);
  assert.match(client, /current \|\| \{ \.\.\.data, selected: undefined, blockers: \[\] \}/);
  assert.match(client, /linkedInGeoTargets\.length <= 20/);
  assert.match(client, /&& linkedInBidPricing\s*&& !linkedInBudgetBelowProviderMinimum\s*&& !linkedInBidOutsideVerifiedRange/);
  assert.match(client, /"too_many_geo_targets", "budget_pricing_required", "bid_out_of_range"/);
  assert.match(client, /Zone refusée par LinkedIn, essayez une autre recherche/);
  assert.match(client, /data-rejected=\{status\?\.rejected \|\| undefined\}/);
  assert.match(client, /Retirer les pistes coupées/);
  assert.match(client, /keywords: draft\.keywords\.filter\(\(signal\) => !isPossiblyTruncatedLinkedInSignal\(signal\)\)/);
});

test("le client relit le tarif multi-zone et n'applique que l'enchère vérifiée", () => {
  assert.match(client, /linkedInAdsAutomaticPreflightKey\(\s*externalStatuses\.linkedin\.selectedAccountId,\s*draft/);
  assert.match(client, /linkedInAutomaticLoadKey\.current === linkedInAutomaticLoadSignature/);
  assert.match(client, /linkedInResourcesLoader\.current\(false\)/);
  assert.match(client, /linkedInAdsVerifiedBidDefault\(\{[\s\S]*currentBid: current\.linkedinBidEuros,[\s\S]*suggestedBid,[\s\S]*pricing: pricing \|\| null,[\s\S]*dailyBudget: current\.dailyBudgetEuros/);
  assert.match(client, /LinkedIn n’a pas confirmé les bornes d’enchère pour ces zones/);
});

test("le lancement LinkedIn reste bloqué sans ressources, déclarations ou média, avec Active réservé au groupe ACTIVE", () => {
  assert.match(client, /!linkedInSelectionsReady \|\| !linkedInComplianceReady/);
  assert.match(client, /channelId === "linkedin"[\s\S]*attachedCampaignMediaUrl[\s\S]*draft\.creativeType === "image"[\s\S]*draft\.mediaStrategy === "image"/);
  assert.match(client, /activeEnabled=\{demoDialog\.channelId === "linkedin"[\s\S]*canServeCampaigns[\s\S]*status === "ACTIVE"/);
  assert.match(client, /pausedEnabled=\{demoDialog\.channelId === "linkedin"[\s\S]*canManageCampaigns/);
  assert.match(client, /\/api\/ads\/linkedin\/accounts/);
  assert.match(client, /Média LinkedIn/);
  assert.match(client, /title\.length > \(channelId === "pinterest" \? 100 : 200\)/);
  assert.match(client, /caractères maximum par titre ; reformulez tout dépassement/);
});
