import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeLinkedInDeliverySuggestion, readLinkedInHumanDeliveryConstraints, type LinkedInDeliverySuggestion } from "../lib/adsLinkedInPlanDelivery.ts";
import { linkedInAdsCampaignPlanResponseSchema, normalizeAdsCampaignPlan } from "../lib/adsCampaignPlan.ts";
import { assertAiJsonMatchesSchema } from "../lib/aiJsonSchemaValidation.ts";
import { assessAdsChannelDraft } from "../lib/adsChannelDrafts.ts";

const context = { now: "2026-10-08T10:00:00.000Z", timezone: "Europe/Paris", objectiveType: "WEBSITE_VISIT", format: "STANDARD_UPDATE" };
const valid: LinkedInDeliverySuggestion = { locationType: "recent_or_permanent", budget: { startAt: "2026-10-09T09:00:00+02:00", endAt: "2026-10-21T23:59:00+02:00" }, placements: { audienceNetwork: false, audienceExpansion: false }, bidding: { strategy: "maximum_delivery", amountEuros: null } };

test("explicit residence and French calendar override missing or contradictory AI advice without IDs", () => {
  const result = normalizeLinkedInDeliverySuggestion({ ...valid, budget: { startAt: null, endAt: "2026-10-16T21:59:00.000Z" } }, { ...context, intent: "Résidence permanente. Campagne du 9 octobre 2026 à 09:00 au 21 octobre 2026 à 23:59, heure de Paris." });
  assert.equal(result.error, null);
  assert.equal(result.suggestion?.locationType, "permanent");
  assert.deepEqual(result.suggestion?.budget, { startAt: "2026-10-09T07:00:00.000Z", endAt: "2026-10-21T21:59:00.000Z" });
  assert.equal(normalizeLinkedInDeliverySuggestion(undefined, { ...context, intent: "Résidence permanente." }).suggestion?.locationType, "permanent");
  assert.doesNotMatch(JSON.stringify(result), /urn:/);
});

test("ISO offsets and numeric French dates are normalized to the exact same instants", () => {
  assert.deepEqual(normalizeLinkedInDeliverySuggestion(valid, context).suggestion?.budget, { startAt: "2026-10-09T07:00:00.000Z", endAt: "2026-10-21T21:59:00.000Z" });
  for (const intent of ["Du 09/10/2026 à 09:00 au 21/10/2026 à 23:59, heure de Paris.", "Du 2026-10-09T09:00+02:00 au 2026-10-21T23:59+02:00."]) {
    const result = normalizeLinkedInDeliverySuggestion(undefined, { ...context, intent });
    assert.equal(result.error, null, intent);
    assert.deepEqual(result.suggestion?.budget, { startAt: "2026-10-09T07:00:00.000Z", endAt: "2026-10-21T21:59:00.000Z" });
  }
});

test("IANA conversion uses each date's DST offset and refuses ambiguous or nonexistent local hours", () => {
  const acrossChange = normalizeLinkedInDeliverySuggestion(undefined, { ...context, intent: "Du 24 octobre 2026 à 09:00 au 26 octobre 2026 à 23:59, heure de Paris." });
  assert.equal(acrossChange.error, null);
  assert.deepEqual(acrossChange.suggestion?.budget, { startAt: "2026-10-24T07:00:00.000Z", endAt: "2026-10-26T22:59:00.000Z" });
  for (const intent of ["Du 25 octobre 2026 à 02:30 au 26 octobre 2026 à 23:59.", "Du 28 mars 2027 à 02:30 au 29 mars 2027 à 23:59."]) {
    const result = normalizeLinkedInDeliverySuggestion(undefined, { ...context, intent });
    assert.equal(result.suggestion, null);
    assert.ok(result.error);
  }
});

test("invalid, past, inverted, timezone-less and overflowing dates are never replaced by defaults", () => {
  for (const budget of [
    { ...valid.budget, startAt: "2026-02-31T09:00:00+02:00" },
    { ...valid.budget, startAt: "2026-10-09T25:00:00+02:00" },
    { ...valid.budget, startAt: "2026-10-09T09:00:00" },
    { ...valid.budget, startAt: "2026-10-01T09:00:00+02:00" },
    { ...valid.budget, endAt: "2026-10-08T09:00:00+02:00" },
    { startAt: null, endAt: "2026-10-07T09:00:00+02:00" },
  ]) {
    const result = normalizeLinkedInDeliverySuggestion({ ...valid, budget }, context);
    assert.equal(result.suggestion, null, JSON.stringify(budget));
    assert.ok(result.error);
  }
  assert.ok(readLinkedInHumanDeliveryConstraints({ ...context, intent: "Du 31 février 2027 à 09:00 au 5 mars 2027 à 23:59." }).error);
  assert.ok(normalizeLinkedInDeliverySuggestion(undefined, { ...context, timezone: "Unknown/TimeZone", intent: "Du 9 octobre 2026 à 09:00 au 21 octobre 2026 à 23:59." }).error);
});

test("native validation enforces money cents and bidding objective compatibility", () => {
  const manual = normalizeLinkedInDeliverySuggestion({ ...valid, bidding: { strategy: "manual_cpc", amountEuros: 1.25 } }, context);
  assert.deepEqual(manual.suggestion?.bidding, { strategy: "manual_cpc", amountEuros: 1.25 });
  for (const amountEuros of [0, -1, 501, 1.234]) assert.ok(normalizeLinkedInDeliverySuggestion({ ...valid, bidding: { strategy: "manual_cpc", amountEuros } }, context).error);
  assert.ok(normalizeLinkedInDeliverySuggestion({ ...valid, bidding: { strategy: "manual_cpc", amountEuros: 1.25 } }, { ...context, objectiveType: "BRAND_AWARENESS" }).error);
  assert.ok(normalizeLinkedInDeliverySuggestion({ ...valid, bidding: { strategy: "cost_cap", amountEuros: 1.25 } }, { ...context, objectiveType: "WEBSITE_CONVERSION" }).error);
  assert.equal(normalizeLinkedInDeliverySuggestion(valid, { ...context, objectiveType: "VIDEO_VIEW", format: "SINGLE_VIDEO" }).error, null);
  const forced = normalizeLinkedInDeliverySuggestion(valid, { ...context, intent: "CPC manuel à 1,50 €." });
  assert.deepEqual(forced.suggestion?.bidding, { strategy: "manual_cpc", amountEuros: 1.5 });
});

test("the application's 90-day planning horizon is checked against the trusted route clock", () => {
  const max = new Date(Date.parse(context.now) + 90 * 86_400_000).toISOString();
  assert.equal(normalizeLinkedInDeliverySuggestion({ ...valid, budget: { ...valid.budget, endAt: max } }, context).error, null);
  assert.ok(normalizeLinkedInDeliverySuggestion({ ...valid, budget: { ...valid.budget, endAt: new Date(Date.parse(max) + 1_000).toISOString() } }, context).error);
  assert.ok(normalizeLinkedInDeliverySuggestion({ ...valid, budget: { startAt: max, endAt: new Date(Date.parse(max) + 86_400_000).toISOString() } }, context).error);
});

test("lead generation can still be prepared as a reviewable draft while native publication stays blocked", () => {
  const plan = normalizeAdsCampaignPlan({
    name: "Demande de démonstration", offer: "Centralisation de la communication", campaignType: "generic", objective: "leads", conversionGoal: "lead_form", conversionLocation: "instant_form",
    channelDraft: { schemaVersion: 1, channel: "linkedin", name: "Demande de démonstration", budget: { amount: 10, currency: "EUR", period: "daily", level: "campaign" }, audience: { locationBriefs: ["Hauts-de-France"], audienceBrief: "Indépendants et petites entreprises locales" }, objectiveType: "LEAD_GENERATION", format: "LEAD_GENERATION_FORM_SPONSORED_CONTENT", locale: { country: "FR", language: "fr" }, creative: { introText: "Découvrez comment centraliser vos outils de communication. Demandez une démonstration adaptée à votre entreprise.", headline: "Découvrez les outils de communication", mediaBrief: "Une image du tableau de bord avec les outils de communication, sans promesse chiffrée.", destinationUrl: "https://inrcy.example/offre", leadFormBrief: "Formulaire de demande de démonstration avec les coordonnées professionnelles nécessaires au rendez-vous." } },
  }, { provider: "linkedin", companyName: "iNrCy", destinationUrl: "https://inrcy.example/offre", locations: ["Hauts-de-France"], locationsAreSelected: true, now: context.now, timezone: context.timezone });
  assert.equal(plan.channelDraft?.channel, "linkedin");
  assert.equal(assessAdsChannelDraft(plan.channelDraft).briefComplete, true);
  assert.equal(assessAdsChannelDraft(plan.channelDraft).publicationReady, false);
  assert.equal(plan.linkedinDeliverySuggestion?.bidding.strategy, "maximum_delivery");
});

test("explicit network and audience choices win over model booleans and malformed options fail", () => {
  const result = normalizeLinkedInDeliverySuggestion({ ...valid, placements: { audienceNetwork: true, audienceExpansion: true } }, { ...context, intent: "LinkedIn uniquement, sans extension d’audience." });
  assert.deepEqual(result.suggestion?.placements, { audienceNetwork: false, audienceExpansion: false });
  assert.deepEqual(normalizeLinkedInDeliverySuggestion(undefined, { ...context, intent: "Activer Audience Network et autoriser l’extension d’audience." }).suggestion?.placements, { audienceNetwork: true, audienceExpansion: true });
  assert.ok(normalizeLinkedInDeliverySuggestion({ ...valid, placements: { audienceNetwork: "yes", audienceExpansion: false } }, context).error);
  assert.ok(normalizeLinkedInDeliverySuggestion({ ...valid, organizationUrn: "urn:li:organization:999" }, context).error);
  assert.ok(normalizeLinkedInDeliverySuggestion({ ...valid, placements: { audienceNetwork: true, audienceExpansion: false } }, { ...context, format: "TEXT_AD" }).error);
});

test("strict delivery advice is required and every field is a native setting or calendar instant", () => {
  const schema = linkedInAdsCampaignPlanResponseSchema().schema;
  assert.ok((schema.required as string[]).includes("linkedinDeliverySuggestion"));
  const plan = normalizeAdsCampaignPlan({
    name: "Communication locale", offer: "Centralisation de la communication", objective: "website_traffic", conversionGoal: "website_visit", campaignType: "generic", linkedinDeliverySuggestion: valid,
    channelDraft: { schemaVersion: 1, channel: "linkedin", name: "Communication locale", budget: { amount: 10, currency: "EUR", period: "daily", level: "campaign" }, audience: { locationBriefs: ["Hauts-de-France"], audienceBrief: "Indépendants et petites entreprises locales" }, objectiveType: "WEBSITE_VISIT", format: "STANDARD_UPDATE", locale: { country: "FR", language: "fr" }, creative: { introText: "Retrouvez vos outils de communication dans un espace commun. Découvrez le fonctionnement du service pour votre entreprise.", headline: "Retrouvez vos outils de communication", mediaBrief: "Une image du tableau de bord présentant les différents outils sans promesse chiffrée.", destinationUrl: "https://inrcy.example/offre", leadFormBrief: "" } },
  }, { provider: "linkedin", companyName: "iNrCy", destinationUrl: "https://inrcy.example/offre", locations: ["Hauts-de-France"], locationsAreSelected: true, ...context });
  assert.doesNotThrow(() => assertAiJsonMatchesSchema(plan, schema));
  const missing = { ...plan };
  delete missing.linkedinDeliverySuggestion;
  assert.throws(() => assertAiJsonMatchesSchema(missing, schema), /linkedinDeliverySuggestion/);
  assert.throws(() => assertAiJsonMatchesSchema({ ...plan, linkedinDeliverySuggestion: { ...plan.linkedinDeliverySuggestion, accountId: "999" } }, schema), /accountId/);
});
