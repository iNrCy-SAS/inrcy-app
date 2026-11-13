import { withUiCopy } from "./helpers/localized-ui-source.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { normalizeLinkedInGeoTargets, parseAdsCampaignInput } from "../lib/adsValidation.ts";
import { buildLinkedInGeoQueries } from "../lib/adsLinkedInGeoQueries.ts";

const picker = readFileSync(new URL("../app/dashboard/ads/LinkedInAdsLocationPicker.tsx", import.meta.url), "utf8");
const delivery = readFileSync(new URL("../app/dashboard/ads/LinkedInAdsDelivery.tsx", import.meta.url), "utf8");
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
  assert.match(withUiCopy(client), /provider === "linkedin"[\s\S]*linkedinPoliticalIntentConfirmed: true,[\s\S]*linkedinTargetingNoticeAcknowledged: false/);
  assert.match(withUiCopy(client), /data-linkedin-political-confirmation="true"/);
  assert.match(withUiCopy(client), /data-linkedin-targeting-notice="true"/);
  assert.match(withUiCopy(client), /NOT_POLITICAL/);
  assert.match(withUiCopy(client), /Aucune annonce de cette campagne ne constitue une publicité politique/);
  assert.match(withUiCopy(client), /politiques LinkedIn et les exigences réglementaires applicables/);
  assert.match(withUiCopy(client), /ne doivent pas être utilisés pour discriminer/);
});

test("un brouillon LinkedIn historique sans confirmations reste non confirmé à la réouverture", () => {
  const parsed = parseAdsCampaignInput(linkedInDraft(), { purpose: "draft" });
  assert.equal(parsed.error, null);
  assert.equal(parsed.draft?.linkedinPoliticalIntentConfirmed, false);
  assert.equal(parsed.draft?.linkedinTargetingNoticeAcknowledged, false);
});

test("les seules ressources LinkedIn vérifiées sont présélectionnées sans masquer les choix manuels", () => {
  assert.match(withUiCopy(client), /data-linkedin-provider-resources="true"/);
  assert.match(withUiCopy(client), /Sélectionnez un groupe vérifié/);
  assert.match(withUiCopy(client), /Sélectionnez une Page autorisée/);
  assert.match(withUiCopy(client), /linkedinCampaignGroupId: event\.target\.value/);
  assert.match(withUiCopy(client), /linkedinOrganizationUrn: event\.target\.value/);
  assert.match(withUiCopy(client), /function applyLinkedInProviderDefaults/);
  assert.match(withUiCopy(client), /selected\.campaignGroup/);
  assert.match(withUiCopy(client), /selected\.organization/);
  assert.match(withUiCopy(client), /selected\.verifiedGeoTargets/);
  assert.match(withUiCopy(client), /selected\.bidAmount/);
  assert.match(withUiCopy(client), /linkedInAutomaticLoadKey/);
  assert.match(withUiCopy(client), /Vérification automatique des ressources LinkedIn/);
  assert.doesNotMatch(withUiCopy(client), /Charger les ressources LinkedIn/);
  assert.match(withUiCopy(client), /CONTENT_ADMINISTRATOR/);
  assert.match(withUiCopy(client), /Administrateur de contenu/);
  for (const field of [
    "linkedinCampaignGroupId",
    "linkedinOrganizationUrn",
    "linkedinGeoTargets",
    "linkedinBidEuros",
    "linkedinPoliticalIntentConfirmed",
    "linkedinTargetingNoticeAcknowledged",
  ]) {
    assert.match(withUiCopy(client), new RegExp(`NATIVE_BRIEF_SAFE_EDITS[\\s\\S]{0,800}"${field}"`), field);
  }
  assert.doesNotMatch(withUiCopy(client), /linkedInCampaignGroups\s*\[\s*0\s*\]/);
  assert.doesNotMatch(withUiCopy(client), /linkedInOrganizations\s*\[\s*0\s*\]/);
});

test("les zones LinkedIn conservent ensemble leur libellé et leur URN vérifiée", () => {
  const geoTargets = [
    { urn: "urn:li:geo:105015875", name: "France" },
    { urn: "urn:li:geo:102264497", name: "Lyon et périphérie" },
  ];
  const parsed = parseAdsCampaignInput(linkedInDraft({ linkedinGeoTargets: geoTargets }), { purpose: "draft" });
  assert.equal(parsed.error, null);
  assert.deepEqual(parsed.draft?.linkedinGeoTargets, geoTargets);
  assert.match(withUiCopy(picker), /<option value=\{option\.urn\} key=\{option\.urn\}>\{option\.name\}/);
  assert.doesNotMatch(withUiCopy(picker), /type="checkbox"/);
  assert.match(withUiCopy(client), /params\.append\("geoUrn", target\.urn\)/);

  const labelOnly = parseAdsCampaignInput(linkedInDraft({ linkedinGeoTargets: [{ name: "France" }] }), { purpose: "draft" });
  assert.match(withUiCopy(labelOnly.error || ""), /zones LinkedIn sélectionnées sont invalides/);
});

test("plusieurs recherches d'une même zone LinkedIn ne bloquent pas le lancement", () => {
  const arras = { urn: "urn:li:geo:104609892", name: "Arras, Hauts-de-France, France" };
  const lille = { urn: "urn:li:geo:100323840", name: "Lille, Hauts-de-France, France" };
  const selected = [arras, lille, { ...arras, source: "Arras" }];
  assert.deepEqual(normalizeLinkedInGeoTargets(selected), [arras, lille]);

  const parsed = parseAdsCampaignInput(linkedInDraft({ linkedinGeoTargets: selected }), { purpose: "draft" });
  assert.equal(parsed.error, null);
  assert.deepEqual(parsed.draft?.linkedinGeoTargets, [arras, lille]);

  const malformed = parseAdsCampaignInput(linkedInDraft({
    linkedinGeoTargets: [...selected, { urn: "Arras", name: "Arras" }],
  }), { purpose: "draft" });
  assert.match(withUiCopy(malformed.error || ""), /zones LinkedIn sélectionnées sont invalides/);
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
  assert.match(withUiCopy(client), /for \(const query of geoQueries\) params\.append\("geo", query\)/);
  assert.match(withUiCopy(client), /linkedinGeoTargets: normalizeLinkedInGeoTargets\(target \? \[\.\.\.retained, target\] : retained\)/);
  assert.match(withUiCopy(client), /draft\.targetLocations\.filter\(\(label\) => !linkedInBriefGeoStatus\(label\)\.verified\)/);
  assert.match(withUiCopy(client), /linkedInMissingGeoLocations\.length === 0/);
  assert.match(withUiCopy(client), /linkedInMissingGeoLocations\.map\(\(label\) => `« \$\{label\} »`\)/);
  assert.match(withUiCopy(client), /Voir les zones à compléter/);
  assert.match(withUiCopy(client), /if \(!geoQueryOverride\) applyLinkedInProviderDefaults\(data\)/);
  assert.match(withUiCopy(client), /current \|\| \{ \.\.\.data, selected: undefined, blockers: \[\] \}/);
  assert.match(withUiCopy(client), /linkedInGeoTargets\.length <= 20/);
  assert.match(withUiCopy(client), /&& linkedInBidPricing\s*&& !linkedInBudgetBelowProviderMinimum\s*&& !linkedInBidOutsideVerifiedRange/);
  assert.match(withUiCopy(client), /"too_many_geo_targets", "budget_pricing_required"/);
  assert.match(withUiCopy(client), /Zone refusée par LinkedIn, essayez une autre recherche/);
  assert.match(withUiCopy(client), /data-rejected=\{status\?\.rejected \|\| undefined\}/);
  assert.match(withUiCopy(client), /LinkedInAdsAudience/);
  assert.match(withUiCopy(client), /onPendingChange=\{setLinkedInAudiencePending\}/);
});

test("le client relit le tarif multi-zone et n'applique que l'enchère vérifiée", () => {
  assert.match(withUiCopy(client), /linkedInAdsAutomaticPreflightKey\(\s*externalStatuses\.linkedin\.selectedAccountId,\s*draft/);
  assert.match(withUiCopy(client), /linkedInAutomaticLoadKey\.current === linkedInAutomaticLoadSignature/);
  assert.match(withUiCopy(client), /linkedInResourcesLoader\.current\(false\)/);
  assert.match(withUiCopy(client), /linkedInAdsVerifiedBidDefault\(\{[\s\S]*currentBid: current\.linkedinBidEuros,[\s\S]*suggestedBid,[\s\S]*pricing: pricing \|\| null,[\s\S]*dailyBudget: current\.dailyBudgetEuros/);
  assert.match(withUiCopy(client), /LinkedIn n’a pas confirmé les bornes d’enchère/);
});

test("le lancement LinkedIn reste bloqué sans ressources, déclarations ou média, avec Active réservé au groupe ACTIVE", () => {
  assert.match(withUiCopy(client), /channelId === "linkedin" && !linkedInComplianceReady/);
  assert.match(withUiCopy(client), /const linkedInLaunchReadinessReason = channelId === "linkedin"[\s\S]*!linkedInSelectionsReady[\s\S]*!linkedInComplianceReady/);
  assert.match(withUiCopy(client), /const launchBlockingMessage = incompleteLaunchMessage \|\| launchUnavailableReason \|\| linkedInLaunchReadinessReason/);
  const source = ts.createSourceFile("AdsClient.tsx", client, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let disabled: ts.Expression | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isJsxOpeningElement(node) && node.tagName.getText(source) === "button") {
      const onClick = node.attributes.properties.find((attribute) => ts.isJsxAttribute(attribute) && attribute.name.getText(source) === "onClick");
      if (onClick?.getText(source).includes("openLaunchDialog(")) {
        const attribute = node.attributes.properties.find((value) => ts.isJsxAttribute(value) && value.name.getText(source) === "disabled") as ts.JsxAttribute | undefined;
        if (attribute?.initializer && ts.isJsxExpression(attribute.initializer)) disabled = attribute.initializer.expression;
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(source);
  assert.ok(disabled, "the actual final launch button must keep its gate");
  const evaluate = new Function("busy", "launchBlocked", "channelId", "creationPath", "confirmedSpend", `return (${disabled.getText(source)});`);
  for (const busy of [null, "demo"] as const) {
    for (const blocked of [false, true]) {
      for (const consent of [false, true]) {
        assert.equal(evaluate(busy, blocked, "linkedin", "inrcy", consent), busy !== null || blocked || !consent);
        assert.equal(evaluate(busy, blocked, "linkedin", "manual", consent), busy !== null || blocked);
      }
    }
  }
  assert.match(withUiCopy(client), /channelId === "linkedin"[\s\S]*attachedCampaignMediaUrl[\s\S]*draft\.creativeType === "image"[\s\S]*draft\.mediaStrategy === "image"/);
  assert.match(withUiCopy(client), /activeEnabled=\{demoDialog\.channelId === "linkedin"[\s\S]*canServeCampaigns[\s\S]*status === "ACTIVE"/);
  assert.match(withUiCopy(client), /pausedEnabled=\{demoDialog\.channelId === "linkedin"[\s\S]*canManageCampaigns/);
  assert.match(withUiCopy(client), /\/api\/ads\/linkedin\/accounts/);
  assert.match(withUiCopy(client), /Média LinkedIn/);
  assert.match(withUiCopy(client), /Titre de l’annonce[\s\S]{0,100}<input value=\{draft\.headlines\[0\] \|\| ""\} maxLength=\{200\}/);
  assert.match(withUiCopy(client), /headlines: \[event\.target\.value\]/);
  assert.match(withUiCopy(delivery), /objective !== "BRAND_AWARENESS" && objective !== "VIDEO_VIEW"/);
});

test("un retrait manuel LinkedIn reste respecté pendant les nouveaux préflights", () => {
  assert.match(withUiCopy(client), /const linkedInGeoDismissedUrns = useRef\(new Set<string>\(\)\)/);
  assert.match(withUiCopy(client), /if \(previousUrn && previousUrn !== target\?\.urn\) linkedInGeoDismissedUrns\.current\.add\(previousUrn\)/);
  assert.match(withUiCopy(client), /if \(target\) linkedInGeoDismissedUrns\.current\.delete\(target\.urn\)/);
  assert.match(withUiCopy(client), /onRemove=\{\(urn\) => \{ linkedInGeoDismissedUrns\.current\.add\(urn\)/);
  assert.match(withUiCopy(client), /!linkedInGeoDismissedUrns\.current\.has\(target\.urn\)/);
});
