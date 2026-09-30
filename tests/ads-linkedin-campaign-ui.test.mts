import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseAdsCampaignInput } from "../lib/adsValidation.ts";

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

test("le groupe et la Page sont des choix explicites persistés, jamais le premier élément choisi silencieusement", () => {
  assert.match(client, /data-linkedin-provider-resources="true"/);
  assert.match(client, /Sélectionnez un groupe vérifié/);
  assert.match(client, /Sélectionnez une Page autorisée/);
  assert.match(client, /linkedinCampaignGroupId: event\.target\.value/);
  assert.match(client, /linkedinOrganizationUrn: event\.target\.value/);
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

test("le lancement LinkedIn reste bloqué sans ressources, déclarations ou média, avec Active réservé au groupe ACTIVE", () => {
  assert.match(client, /!linkedInSelectionsReady \|\| !linkedInComplianceReady/);
  assert.match(client, /channelId === "linkedin"[\s\S]*attachedCampaignMediaUrl[\s\S]*draft\.creativeType === "image"[\s\S]*draft\.mediaStrategy === "image"/);
  assert.match(client, /activeEnabled=\{demoDialog\.channelId === "linkedin"[\s\S]*canServeCampaigns[\s\S]*status === "ACTIVE"/);
  assert.match(client, /pausedEnabled=\{demoDialog\.channelId === "linkedin"[\s\S]*canManageCampaigns/);
  assert.match(client, /\/api\/ads\/linkedin\/accounts/);
  assert.match(client, /Média LinkedIn/);
  assert.match(client, /maxLength=\{channelId === "pinterest" \? 100 : channelId === "linkedin" \? 200/);
});
