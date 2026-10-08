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
  assert.match(picker, /<option value=\{option\.urn\} key=\{option\.urn\}>\{option\.name\}/);
  assert.doesNotMatch(picker, /type="checkbox"/);
  assert.match(client, /params\.append\("geoUrn", target\.urn\)/);

  const labelOnly = parseAdsCampaignInput(linkedInDraft({ linkedinGeoTargets: [{ name: "France" }] }), { purpose: "draft" });
  assert.match(labelOnly.error || "", /zones LinkedIn sélectionnées sont invalides/);
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
  assert.match(malformed.error || "", /zones LinkedIn sélectionnées sont invalides/);
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
  assert.match(client, /linkedinGeoTargets: normalizeLinkedInGeoTargets\(target \? \[\.\.\.retained, target\] : retained\)/);
  assert.match(client, /draft\.targetLocations\.filter\(\(label\) => !linkedInBriefGeoStatus\(label\)\.verified\)/);
  assert.match(client, /linkedInMissingGeoLocations\.length === 0/);
  assert.match(client, /linkedInMissingGeoLocations\.map\(\(label\) => `« \$\{label\} »`\)/);
  assert.match(client, /Voir les zones à compléter/);
  assert.match(client, /if \(!geoQueryOverride\) applyLinkedInProviderDefaults\(data\)/);
  assert.match(client, /current \|\| \{ \.\.\.data, selected: undefined, blockers: \[\] \}/);
  assert.match(client, /linkedInGeoTargets\.length <= 20/);
  assert.match(client, /&& linkedInBidPricing\s*&& !linkedInBudgetBelowProviderMinimum\s*&& !linkedInBidOutsideVerifiedRange/);
  assert.match(client, /"too_many_geo_targets", "budget_pricing_required"/);
  assert.match(client, /Zone refusée par LinkedIn, essayez une autre recherche/);
  assert.match(client, /data-rejected=\{status\?\.rejected \|\| undefined\}/);
  assert.match(client, /LinkedInAdsAudience/);
  assert.match(client, /onPendingChange=\{setLinkedInAudiencePending\}/);
});

test("le client relit le tarif multi-zone et n'applique que l'enchère vérifiée", () => {
  assert.match(client, /linkedInAdsAutomaticPreflightKey\(\s*externalStatuses\.linkedin\.selectedAccountId,\s*draft/);
  assert.match(client, /linkedInAutomaticLoadKey\.current === linkedInAutomaticLoadSignature/);
  assert.match(client, /linkedInResourcesLoader\.current\(false\)/);
  assert.match(client, /linkedInAdsVerifiedBidDefault\(\{[\s\S]*currentBid: current\.linkedinBidEuros,[\s\S]*suggestedBid,[\s\S]*pricing: pricing \|\| null,[\s\S]*dailyBudget: current\.dailyBudgetEuros/);
  assert.match(client, /LinkedIn n’a pas confirmé les bornes d’enchère/);
});

test("le lancement LinkedIn reste bloqué sans ressources, déclarations ou média, avec Active réservé au groupe ACTIVE", () => {
  assert.match(client, /channelId === "linkedin" && !linkedInComplianceReady/);
  assert.match(client, /const linkedInLaunchReadinessReason = channelId === "linkedin"[\s\S]*!linkedInSelectionsReady[\s\S]*!linkedInComplianceReady/);
  assert.match(client, /const launchBlockingMessage = incompleteLaunchMessage \|\| launchUnavailableReason \|\| linkedInLaunchReadinessReason/);
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
  assert.match(client, /channelId === "linkedin"[\s\S]*attachedCampaignMediaUrl[\s\S]*draft\.creativeType === "image"[\s\S]*draft\.mediaStrategy === "image"/);
  assert.match(client, /activeEnabled=\{demoDialog\.channelId === "linkedin"[\s\S]*canServeCampaigns[\s\S]*status === "ACTIVE"/);
  assert.match(client, /pausedEnabled=\{demoDialog\.channelId === "linkedin"[\s\S]*canManageCampaigns/);
  assert.match(client, /\/api\/ads\/linkedin\/accounts/);
  assert.match(client, /Média LinkedIn/);
  assert.match(client, /Titre de l’annonce<input value=\{draft\.headlines\[0\] \|\| ""\} maxLength=\{200\}/);
  assert.match(client, /headlines: \[event\.target\.value\]/);
  assert.match(delivery, /objective !== "BRAND_AWARENESS" && objective !== "VIDEO_VIEW"/);
});

test("un retrait manuel LinkedIn reste respecté pendant les nouveaux préflights", () => {
  assert.match(client, /const linkedInGeoDismissedUrns = useRef\(new Set<string>\(\)\)/);
  assert.match(client, /if \(previousUrn && previousUrn !== target\?\.urn\) linkedInGeoDismissedUrns\.current\.add\(previousUrn\)/);
  assert.match(client, /if \(target\) linkedInGeoDismissedUrns\.current\.delete\(target\.urn\)/);
  assert.match(client, /onRemove=\{\(urn\) => \{ linkedInGeoDismissedUrns\.current\.add\(urn\)/);
  assert.match(client, /!linkedInGeoDismissedUrns\.current\.has\(target\.urn\)/);
});
