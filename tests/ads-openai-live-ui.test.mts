import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const client = readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8");
const dialog = readFileSync(new URL("../app/dashboard/ads/AdsCampaignDemoDialog.tsx", import.meta.url), "utf8");
const settings = readFileSync(new URL("../app/dashboard/ads/OpenaiAdsConnectionSettings.tsx", import.meta.url), "utf8");

test("le studio ChatGPT Ads sépare la disponibilité Active et En pause renvoyée par le backend", () => {
  assert.match(client, /pausedCreationEnabled\?: boolean; liveDeliveryEnabled\?: boolean/);
  assert.match(client, /setOpenaiAccountReady\(status\.connected === true && status\.pausedCreationEnabled === true/);
  assert.match(client, /setOpenaiLiveReady\(status\.connected === true && status\.liveDeliveryEnabled === true/);
  assert.match(client, /launchStatus = liveReady \? "active" : "paused"/);
  assert.match(client, /demoDialog\.channelId === "openai" \? openaiLiveReady/);
  assert.match(client, /demoDialog\.channelId === "openai" \? openaiAccountReady/);
  assert.match(client, /activeDisabledReason=\{demoDialog\.channelId === "openai"/);
});

test("le lancement Active ChatGPT Ads exige la confirmation explicite de la facturation", () => {
  assert.match(client, /confirmation\.channelId === "openai" && !paused && confirmedSpend \? \{ billingConfirmed: true \}/);
  assert.match(client, /facturation est configurée et validée dans ChatGPT Ads Manager/);
  assert.match(client, /une dépense peut démarrer après la validation de l’annonce par ChatGPT Ads/);
  assert.match(dialog, /Budget autorisé/);
  assert.match(dialog, /engager des dépenses dès qu’elle aura été validée par la plateforme/);
});

test("la configuration ChatGPT Ads n’annonce plus une création exclusivement en pause", () => {
  assert.match(settings, /vous pourrez choisir Active ou En pause lors de la validation finale/);
  assert.match(settings, /une dépense peut démarrer uniquement après votre confirmation explicite/);
  assert.doesNotMatch(settings, /Les campagnes créées via iNr’ADS sont envoyées <strong>en pause<\/strong>/);
  assert.match(client, /Prête pour un lancement Active ou En pause/);
  assert.doesNotMatch(client, /Créer en pause sur ChatGPT Ads/);
});
