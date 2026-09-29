import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

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
  assert.match(unsupportedAdsConnectorReason({
    ...liveDraft,
    channelSettings: { ...liveDraft.channelSettings, targetingMode: "interests" },
  }) || "", /brouillon/);
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

test("le studio présente la hiérarchie réelle et les champs Pinterest remplis par l’IA", () => {
  const client = readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8");

  for (const label of [
    "Niveau 1 · Campagne Pinterest",
    "Niveau 2 · Groupe d’annonces",
    "Niveau 3 · Pin et annonce",
    "Objectif Pinterest",
    "Mode de ciblage Pinterest",
    "Description de l’épingle",
    "Titre de l’épingle",
    "Format de l’épingle",
    "URL de destination du Pin",
    "Budget quotidien moyen (€)",
  ]) assert.match(client, new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));

  assert.match(client, /Ciblage automatique — recommandé · publiable/);
  assert.match(client, /ce n’est pas une campagne Performance\+ complète/);
  assert.match(client, /pinterestTargetingLabel\(nativeSettings\.targetingMode\)/);
  assert.match(client, /pinterest: "Pinterest"/);
  assert.match(client, /`Créer une campagne \$\{CAMPAIGN_CHANNEL_NAMES\[channelId\]\}`/);
  assert.match(client, /const channelSettings = channelDraft \? adsChannelWizardSettingsFromBrief\(channelDraft\)/);
  assert.match(client, /dailyBudgetEuros: channelDraft\.budget\.amount/);
  assert.match(client, /primaryText: nativeCopy\.message/);
  assert.match(client, /mediaBrief: nativeCopy\.media/);
  assert.match(client, /destinationUrl: nativeCopy\.destination/);
  assert.match(client, /updatePinterestTargetingMode\(event\.target\.value/);
  assert.match(client, /Passer au ciblage automatique retirera/);
  assert.match(client, /Retirer les signaux manuels/);
  assert.match(client, /connectorConfigurationIssue[\s\S]*clearPinterestManualSignals/);
  assert.match(client, /channelDraft\?\.channel === "pinterest" && channelDraft\.targetingMode === "automatic"/);
});
