import assert from "node:assert/strict";
import test from "node:test";
import { defaultOpenaiDeliverySettings, normalizeOpenaiDeliverySettings, openaiAdsCalendarInstant, openaiAdsInstant, openaiAdsLegacyEndTime, openaiAdsLocalDateTime, openaiAdsTrackingTemplate, openaiNativeDelivery } from "../lib/adsOpenaiCampaignSettings.ts";
import { readOpenaiAdsPlanIntent, selectOpenaiAdsPlanLocations } from "../lib/adsOpenaiPlanIntent.ts";
import { openaiAdsResourcesConsentKey, type OpenaiAdsResources } from "../lib/adsOpenaiResources.ts";

const now = Date.parse("2026-10-08T12:00:00Z");
const legacy = { dailyBudgetEuros: 15, openaiBidEuros: 1, endDate: "2026-10-21" };
const total = () => ({ ...defaultOpenaiDeliverySettings(), budget: { type: "total" as const, totalEuros: 200, startAt: "2026-10-09T09:00:00+02:00", endAt: "2026-10-21T23:59:00+02:00" } });

test("une enveloppe totale ne transmet jamais un plafond quotidien", () => {
  const delivery = openaiNativeDelivery({ ...legacy, dailyBudgetEuros: 0, openaiDeliverySettings: total() }, now, "Europe/Paris");
  assert.deepEqual(delivery.budget, { lifetimeSpendLimitMicros: 200_000_000 });
  assert.equal(delivery.startTime, Date.parse("2026-10-09T07:00:00Z") / 1000);
  assert.equal(delivery.endTime, Date.parse("2026-10-21T21:59:00Z") / 1000);
  assert.equal(delivery.maxBidMicros, 1_000_000);
});
test("les vieux brouillons gardent exactement la fin du jour au fuseau du compte", () => {
  const delivery = openaiNativeDelivery({ ...legacy, trackingParameters: "utm_source=historical" }, now, "Europe/Paris");
  assert.deepEqual(delivery, { budget: { dailySpendLimitMicros: 15_000_000 }, maxBidMicros: 1_000_000, endTime: Date.parse("2026-10-21T21:59:59Z") / 1000 });
  assert.equal(openaiAdsLegacyEndTime("2026-11-01", "Europe/Paris"), Date.parse("2026-11-01T22:59:59Z") / 1000);
  assert.throws(() => openaiNativeDelivery(legacy, now), /fuseau/);
});
test("les limites, modes mixtes et stratégies non intégrées sont refusés", () => {
  for (const settings of [
    { ...total(), budget: { ...total().budget, totalEuros: 200.001 } },
    { ...defaultOpenaiDeliverySettings(), budget: { ...defaultOpenaiDeliverySettings().budget, totalEuros: 200 } },
    { ...total(), bidding: { strategy: "maximize_clicks" } },
    { ...total(), platforms: ["unknown"] },
    { ...total(), unexpected: true },
  ]) assert.ok(normalizeOpenaiDeliverySettings(settings).error);
  assert.throws(() => openaiNativeDelivery({ ...legacy, dailyBudgetEuros: 14 }, now, "UTC"), /15/);
  assert.throws(() => openaiNativeDelivery({ ...legacy, openaiBidEuros: 201, openaiDeliverySettings: total() }, now), /enchère/);
});
test("toutes plateformes omet le filtre ; une sélection conserve les clés natives", () => {
  const settings = total();
  const unrestricted = openaiNativeDelivery({ ...legacy, openaiDeliverySettings: settings }, now);
  assert.equal(Object.hasOwn(unrestricted, "platforms"), false);
  settings.platforms = ["ios_app", "android_app"];
  assert.deepEqual(openaiNativeDelivery({ ...legacy, openaiDeliverySettings: settings }, now).platforms, ["ios_app", "android_app"]);
  assert.deepEqual(normalizeOpenaiDeliverySettings({ ...settings, platforms: ["web", "web"] }).settings.platforms, ["web"]);
});
test("les dates impossibles et heures ambiguës ne sont pas déplacées silencieusement", () => {
  assert.equal(openaiAdsInstant("2026-02-30T10:00:00Z"), null);
  assert.equal(openaiAdsInstant("2026-10-09T25:00:00Z"), null);
  assert.equal(openaiAdsInstant("2026-10-09T09:00:00"), null);
  assert.equal(openaiAdsCalendarInstant("2026-03-29T02:30", "Europe/Paris"), null);
  assert.equal(openaiAdsCalendarInstant("2026-10-25T02:30", "Europe/Paris"), null);
  const instant = openaiAdsCalendarInstant("2026-10-09T09:00", "Europe/Paris");
  assert.equal(instant, "2026-10-09T07:00:00.000Z");
  assert.equal(openaiAdsLocalDateTime(instant, "Europe/Paris"), "2026-10-09T09:00");
});
test("un calendrier passé, inversé ou au-delà de 90 jours bloque la préparation", () => {
  for (const budget of [
    { ...total().budget, startAt: "2026-10-07T12:00:00Z" },
    { ...total().budget, endAt: "2026-10-09T06:00:00Z" },
    { ...total().budget, endAt: "2027-02-09T06:00:00Z" },
  ]) assert.throws(() => openaiNativeDelivery({ ...legacy, openaiDeliverySettings: { ...total(), budget } }, now));
});
test("le suffixe UTM reste natif et autorise uniquement les deux macros documentées", () => {
  const tracking = "utm_source=openai&utm_medium=paid&utm_campaign={campaign_id}&utm_content={ad_id}";
  assert.equal(openaiAdsTrackingTemplate(`?${tracking}`), tracking);
  assert.equal(openaiNativeDelivery({ ...legacy, trackingParameters: tracking, openaiDeliverySettings: total() }, now).queryStringTemplate, tracking);
  for (const bad of ["https://example.fr", "utm_content={email}", "utm_content=%7Bemail%7D", "utm_content={{ad_id}}", "x=a#b", "x=%0Ahello", "=value"]) assert.throws(() => openaiAdsTrackingTemplate(bad));
});
test("le brief conserve budget total et CPC explicite sans changer la durée de l’essai", () => {
  const plan = readOpenaiAdsPlanIntent({ intent: "Campagne Hauts-de-France. Budget total de 200 euros pour 14 jours. CPC maximal de 1,20 euro. Notre essai gratuit dure 21 jours.", now: new Date(now).toISOString(), timezone: "Europe/Paris" });
  assert.equal(plan.error, null);
  assert.equal(plan.budget?.type, "total");
  assert.equal(plan.budget?.totalEuros, 200);
  assert.equal(plan.budget?.dailyEuros, null);
  assert.equal(plan.bidEuros, 1.2);
  assert.equal(Date.parse(plan.budget!.endAt!) - now, 14 * 86400000);
});
test("les dates exactes de brief sont interprétées dans le calendrier indiqué", () => {
  const plan = readOpenaiAdsPlanIntent({ intent: "Campagne budget total 200 euros. Diffusion du 9 octobre 2026 à 09h00 au 21 octobre 2026 à 23h59, heure de Paris.", now: new Date(now).toISOString(), timezone: "Europe/Paris" });
  assert.equal(plan.error, null);
  assert.equal(plan.budget?.startAt, "2026-10-09T07:00:00.000Z");
  assert.equal(plan.budget?.endAt, "2026-10-21T21:59:00.000Z");
});
test("les demandes d’automatisation et les CPC incompatibles restent explicites", () => {
  for (const intent of ["Budget total 200 euros, enchères automatiques.", "Budget total 5 euros. CPC maximal 6 euros.", "Budget total 200 euros. CPC maximal 1 euro. Enchère fixe 2 euros.", "Budget total 200 euros. CPC maximal 1,234 euro."]) {
    const plan = readOpenaiAdsPlanIntent({ intent, now: new Date(now).toISOString() });
    assert.ok(plan.error, intent);
    assert.equal(plan.bidEuros, null);
  }
});
test("la géographie humaine ne dérive pas vers une autre région", () => {
  assert.deepEqual(selectOpenaiAdsPlanLocations({ intent: "Campagne dans les Hauts-de-France uniquement", locations: ["Paris", "Lyon"] }), ["Hauts-de-France"]);
});
test("le consentement public suit le compte et les revues, sans dépendre d’une recherche", () => {
  const resources: OpenaiAdsResources = { selectedAccountId: "adacct_123", account: { id: "adacct_123", name: "Entreprise", currencyCode: "EUR", timezone: "Europe/Paris", status: "active", brandReviewStatus: "approved", accountReviewStatus: null }, geographyOptions: [], verifiedAt: "first" };
  const key = openaiAdsResourcesConsentKey(resources);
  assert.equal(key, openaiAdsResourcesConsentKey({ ...resources, verifiedAt: "second", geographyOptions: [{ id: "geo_lille", name: "Lille", canonicalName: "Lille, France", countryCode: "FR", type: "city" }] }));
  assert.notEqual(key, openaiAdsResourcesConsentKey({ ...resources, account: { ...resources.account, status: "paused" } }));
  assert.equal(openaiAdsResourcesConsentKey({ ...resources, selectedAccountId: "adacct_other" }), null);
});
