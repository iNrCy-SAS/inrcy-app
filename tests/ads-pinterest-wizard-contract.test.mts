import { adsComponentModules } from "./helpers/ads-component-runtime.mts";
import { withUiCopy } from "./helpers/localized-ui-source.mjs";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { createRequire } from "node:module";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { defaultPinterestDeliverySettings } from "../lib/adsPinterestCampaignSettings.ts";

import type { PinterestAdsDraft } from "../lib/adsChannelDrafts.ts";
import {
  adsChannelWizardSettingsFromBrief,
  defaultAdsChannelWizardSettings,
  parseAdsChannelWizardSettings,
  type PinterestWizardSettings,
} from "../lib/adsChannelWizardSettings.ts";
import { unsupportedAdsConnectorReason } from "../lib/adsPublishMode.ts";
import { preparePinterestTargetingTransition } from "../lib/adsPinterestTargetingTransition.ts";

const pinterestBrief: PinterestAdsDraft = {
  schemaVersion: 1,
  channel: "pinterest",
  name: "Inspiration rénovation",
  budget: { amount: 24, currency: "EUR", period: "daily", level: "campaign" },
  audience: {
    locationBriefs: ["France"],
    audienceBrief: "Propriétaires qui préparent une rénovation énergétique",
  },
  objectiveType: "CONSIDERATION",
  intendedPromotionType: "STANDARD_AD",
  creativeType: "REGULAR",
  targetingMode: "automatic",
  creative: {
    pinTitle: "7 idées pour préparer votre rénovation",
    pinDescription: "Découvrez les étapes utiles avant de lancer vos travaux.",
    visualBrief: "Pin vertical montrant un avant/après réaliste et trois étapes lisibles.",
    destinationUrl: "https://example.fr/renovation",
  },
};

test("le brief IA Pinterest transporte le ciblage automatique jusque dans les réglages du studio", () => {
  const settings = adsChannelWizardSettingsFromBrief(pinterestBrief);
  assert.deepEqual(settings, {
    schemaVersion: 1,
    channel: "pinterest",
    objectiveType: "CONSIDERATION",
    intendedPromotionType: "STANDARD_AD",
    creativeType: "REGULAR",
    targetingMode: "automatic",
    conversionEvent: null,
  });
  assert.deepEqual(parseAdsChannelWizardSettings(settings, "pinterest"), { settings, error: null });
  const defaults = defaultAdsChannelWizardSettings("pinterest");
  assert.equal(defaults.channel, "pinterest");
  if (defaults.channel !== "pinterest") throw new Error("Réglages Pinterest attendus.");
  assert.equal(defaults.targetingMode, "automatic");
});

test("seul le ciblage automatique sans identifiant inventé suit le parcours publiable actuel", () => {
  const channelSettings = adsChannelWizardSettingsFromBrief(pinterestBrief);
  if (channelSettings.channel !== "pinterest") throw new Error("Réglages Pinterest attendus.");
  const liveDraft = {
    provider: "pinterest" as const,
    campaignType: "generic" as const,
    objective: "website_traffic" as const,
    conversionGoal: "website_visit" as const,
    conversionLocation: "website" as const,
    bidStrategy: "maximize_clicks" as const,
    metaPlacements: [],
    callToAction: "Découvrir",
    mediaStrategy: "image" as const,
    creativeType: "image" as const,
    creativeUrl: "https://cdn.example.fr/pin.jpg",
    channelSettings: channelSettings as PinterestWizardSettings,
  };
  assert.equal(unsupportedAdsConnectorReason(liveDraft), null);
  assert.match(withUiCopy(unsupportedAdsConnectorReason({
    ...liveDraft,
    channelSettings: { ...liveDraft.channelSettings, targetingMode: "interests" },
  }) || ""), /brouillon/);
});

test("le passage au ciblage automatique exige un accord avant de retirer les signaux manuels", () => {
  const transition = preparePinterestTargetingTransition(
    "keywords",
    "automatic",
    ["rénovation énergétique", "maison ancienne"],
  );
  assert.equal(transition.requiresConfirmation, true);
  assert.equal(transition.removedSignalCount, 2);
  assert.deepEqual(transition.keywords, []);

  const cancelledMode = preparePinterestTargetingTransition("interests", "interests", ["décoration"]);
  assert.equal(cancelledMode.requiresConfirmation, false);
  assert.deepEqual(cancelledMode.keywords, ["décoration"]);

  const generatedAutomatic = preparePinterestTargetingTransition("automatic", "automatic", ["ancien signal"]);
  assert.equal(generatedAutomatic.requiresConfirmation, false);
  assert.deepEqual(generatedAutomatic.keywords, []);
});

test("le studio présente les choix Pinterest utiles et les champs remplis par l’IA", () => {
  const client = ["../app/dashboard/ads/AdsClient.tsx", "../lib/adsCampaignPlanClient.ts"].map((file) => readFileSync(new URL(file, import.meta.url), "utf8")).join("\n");

  const controls = readFileSync(new URL("../app/dashboard/ads/PinterestAdsCampaignControls.tsx", import.meta.url), "utf8");
  for (const label of [
    "Objectif Pinterest",
    "Mode de ciblage Pinterest",
    "Description de l’épingle",
    "Titre de l’épingle",
    "Format de l’épingle",
    "URL de destination du Pin",
    "Budget et calendrier Pinterest",
    "Budget total (€)",
    "Budget quotidien fixe (€)",
    "Emplacements Pinterest",
  ]) assert.match(withUiCopy(client + controls), new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  assert.match(withUiCopy(client), /Ciblage automatique — recommandé · publiable/);
  assert.match(withUiCopy(client), /Pinterest optimise l’audience à partir du contenu de votre Pin, dans les zones choisies/);
  assert.match(withUiCopy(client), /hasKeywordsStep \? \["Découverte Pinterest"\] : \[\]/);
  assert.match(withUiCopy(client), /"Format du Pin"/);
  assert.match(withUiCopy(client), /"Budget et calendrier"/);
  assert.match(withUiCopy(client), /"Zones géographiques"/);
  assert.match(withUiCopy(client), /data-pinterest-geography="true"/);
  assert.match(withUiCopy(client), /Un seul titre · 100 caractères maximum/);
  assert.match(withUiCopy(client), /Choisissez un seul titre pour votre épingle/);
  assert.match(withUiCopy(client), /pinterestTargetingLabel\(nativeSettings\.targetingMode, i18nT\)/);
  assert.match(withUiCopy(client), /pinterest: "Pinterest"/);
  assert.match(withUiCopy(client), /i18nT\("ads_ui_4617896f39", \{ value0: CAMPAIGN_CHANNEL_NAMES\[channelId\] \}\)/);
  assert.match(withUiCopy(client), /const channelSettings = channelDraft \? adsChannelWizardSettingsFromBrief\(channelDraft\)/);
  assert.match(withUiCopy(client), /plan\.pinterestBudgetSuggestion/);
  assert.match(withUiCopy(client), /pinterestDeliverySettings: plan\.pinterestDeliverySuggestion/);
  assert.match(withUiCopy(client), /primaryText: channelDraft\.channel === "x"[\s\S]*?preparedXCopyWithDestination[\s\S]*?: nativeCopy\.message/);
  assert.match(withUiCopy(client), /mediaBrief: nativeCopy\.media/);
  assert.match(withUiCopy(client), /destinationUrl: nativeCopy\.destination/);
  assert.match(withUiCopy(client), /updatePinterestTargetingMode\(event\.target\.value/);
  assert.match(withUiCopy(client), /Passer au ciblage automatique retirera/);
  assert.match(withUiCopy(client), /Retirer les signaux manuels/);
  assert.match(withUiCopy(client), /connectorConfigurationIssue[\s\S]*clearPinterestManualSignals/);
  assert.match(withUiCopy(client), /channelDraft\?\.channel === "pinterest" && channelDraft\.targetingMode === "automatic"/);
});

test("les zones Pinterest ne sont ajoutées que par un choix explicite dans le compte associé", () => {
  const client = ["../app/dashboard/ads/AdsClient.tsx", "../lib/adsCampaignPlanClient.ts"].map((file) => readFileSync(new URL(file, import.meta.url), "utf8")).join("\n");
  const search = client.slice(client.indexOf("function PinterestLocationSearch("), client.indexOf("function GoogleAdCopyField("));
  assert.match(withUiCopy(search), /\/api\/ads\/pinterest\/targeting\?query=/);
  assert.match(withUiCopy(search), /response\.selectedAccountId !== accountId/);
  assert.match(withUiCopy(search), /requestId !== requestRef\.current/);
  assert.match(withUiCopy(search), /onClick=\{\(\) => onChange\(\[\.\.\.locations, option\.name\]\)\}/);
  assert.match(withUiCopy(search), /Pays entier/);
  assert.doesNotMatch(withUiCopy(search), /onChange\(response|onChange\(options/);
});


function nativeControls() {
  const source = readFileSync(new URL("../app/dashboard/ads/PinterestAdsCampaignControls.tsx", import.meta.url), "utf8");
  const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, esModuleInterop: true } }).outputText;
  const exports = {} as Record<string, (props: Record<string, unknown>) => ReturnType<typeof createElement>> & { pinterestAdsBudgetLabel: (draft: Record<string, unknown>) => string };
  const require = createRequire(import.meta.url);
  new Function("exports", "require", compiled)(exports, (name: string) => {
    const modules = adsComponentModules();
    if (Object.hasOwn(modules, name)) return modules[name as keyof typeof modules];
    return name === "@/lib/adsPinterestCampaignSettings" ? { defaultPinterestDeliverySettings } : name === "./ads.module.css" ? { default: new Proxy({}, { get: (_, key) => String(key) }) } : require(name);
  });
  return exports;
}

test("le budget natif Pinterest distingue le total, le plafond journalier et la moyenne flexible sans multiplier le total", () => {
  const controls = nativeControls();
  const settings = defaultPinterestDeliverySettings();
  const draft = { dailyBudgetEuros: 25, endDate: "2026-10-21", channelSettings: { objectiveType: "CONSIDERATION" }, pinterestDeliverySettings: settings };
  assert.match(withUiCopy(controls.pinterestAdsBudgetLabel(draft)), /25,00.*par jour.*plafond quotidien fixe/);
  settings.budget.flexibleDaily = true;
  assert.match(withUiCopy(controls.pinterestAdsBudgetLabel(draft)), /25,00.*par jour en moyenne/);
  settings.budget = { type: "total", totalEuros: 200, flexibleDaily: false, startAt: "2026-10-09T07:00:00.000Z", endAt: "2026-10-21T21:59:00.000Z" };
  assert.match(withUiCopy(controls.pinterestAdsBudgetLabel(draft)), /200,00.*au total/);
  assert.doesNotMatch(withUiCopy(controls.pinterestAdsBudgetLabel(draft)), /par jour|25,00/);
  const markup = renderToStaticMarkup(createElement(controls.PinterestAdsBudget, { settings, onChange: () => {}, dailyBudget: 25, endDate: "2026-10-21", onDailyChange: () => {}, onEndDateChange: () => {}, timeZone: "Europe/Paris" }));
  assert.match(withUiCopy(markup), /Budget total/);
  assert.match(withUiCopy(markup), /value="200"/);
  assert.match(withUiCopy(markup), /value="2026-10-09T09:00"/);
  assert.match(withUiCopy(markup), /value="2026-10-21T23:59"/);
  assert.doesNotMatch(withUiCopy(markup), /value="25"/);
});

test("les placements et enchères Pinterest proposent seulement les réglages natifs supportés", () => {
  const controls = nativeControls();
  const settings = defaultPinterestDeliverySettings();
  const placement = renderToStaticMarkup(createElement(controls.PinterestAdsDistribution, { settings, onChange: () => {} }));
  for (const value of ["ALL", "SEARCH", "BROWSE"]) assert.match(withUiCopy(placement), new RegExp(`value="${value}"`));
  assert.doesNotMatch(withUiCopy(placement), /value="OTHER"/);
  const bidding = renderToStaticMarkup(createElement(controls.PinterestAdsBidding, { objectiveType: "CONSIDERATION", settings, onChange: () => {}, budgetEuros: 25 }));
  assert.match(withUiCopy(bidding), /Clics sur l’épingle/);
  assert.match(withUiCopy(bidding), /value="automatic"/);
  assert.match(withUiCopy(bidding), /value="max_bid"/);
  assert.doesNotMatch(withUiCopy(bidding), /value="outbound_clicks"/);
  const draftOnly = renderToStaticMarkup(createElement(controls.PinterestAdsBidding, { objectiveType: "WEB_CONVERSION", settings, onChange: () => {}, budgetEuros: 25 }));
  assert.match(withUiCopy(draftOnly), /brouillon/);
});
