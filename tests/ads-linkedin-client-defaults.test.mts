import assert from "node:assert/strict";
import test from "node:test";
import type { LinkedInWizardSettings } from "../lib/adsChannelWizardSettings.ts";
import {
  linkedInAdsAutomaticPreflightKey,
  linkedInAdsContextualGeoDefaults,
  linkedInAdsVerifiedBidDefault,
} from "../lib/adsLinkedInClientDefaults.ts";

const france = { urn: "urn:li:geo:105015875", name: "France" };
const lille = { urn: "urn:li:geo:102613894", name: "Lille" };
const pricing = {
  currency: "EUR", bidMin: 0, bidMax: 3, dailyBudgetMin: 10, dailyBudgetDefault: 25,
};

test("LinkedIn automatic preflight follows every requested zone and selected provider URN", () => {
  const draft = {
    targetLocations: ["Arras"], linkedinGeoTargets: [], dailyBudgetEuros: 25,
    channelSettings: undefined,
  };
  const initial = linkedInAdsAutomaticPreflightKey("123", draft);
  const twoZones = linkedInAdsAutomaticPreflightKey("123", {
    ...draft, targetLocations: ["Arras", "Lille"],
  });
  const verified = linkedInAdsAutomaticPreflightKey("123", {
    ...draft, targetLocations: ["Arras", "Lille"], linkedinGeoTargets: [france, lille],
  });
  assert.notEqual(initial, twoZones);
  assert.notEqual(twoZones, verified);
  assert.equal(verified, linkedInAdsAutomaticPreflightKey("123", {
    ...draft, targetLocations: ["Lille", "Arras"], linkedinGeoTargets: [lille, france],
  }));
  assert.notEqual(verified, linkedInAdsAutomaticPreflightKey("123", {
    ...draft, targetLocations: ["Arras"], linkedinGeoTargets: [france],
  }));
  assert.notEqual(verified, linkedInAdsAutomaticPreflightKey("123", {
    ...draft, targetLocations: ["Arras", "Lille"], linkedinGeoTargets: [france, lille], dailyBudgetEuros: 30,
  }));
  assert.notEqual(verified, linkedInAdsAutomaticPreflightKey("456", {
    ...draft, targetLocations: ["Arras", "Lille"], linkedinGeoTargets: [france, lille],
  }));
  const settings: LinkedInWizardSettings = {
    schemaVersion: 1, channel: "linkedin", objectiveType: "WEBSITE_VISIT", format: "STANDARD_UPDATE",
    targetingFacet: "titles", locale: { country: "FR", language: "fr" },
  };
  const french = linkedInAdsAutomaticPreflightKey("123", {
    ...draft, targetLocations: ["Arras", "Lille"], linkedinGeoTargets: [france, lille], channelSettings: settings,
  });
  assert.notEqual(french, linkedInAdsAutomaticPreflightKey("123", {
    ...draft, targetLocations: ["Arras", "Lille"], linkedinGeoTargets: [france, lille],
    channelSettings: { ...settings, locale: { country: "GB", language: "en" } },
  }));
});

test("Applying the provider CPC does not schedule another automatic preflight", () => {
  const draft = {
    targetLocations: ["Arras", "Lille"], linkedinGeoTargets: [france, lille],
    dailyBudgetEuros: 25, channelSettings: undefined, linkedinBidEuros: undefined as number | undefined,
  };
  const before = linkedInAdsAutomaticPreflightKey("123", draft);
  const suggested = linkedInAdsVerifiedBidDefault({
    currentBid: draft.linkedinBidEuros, suggestedBid: 1.5, pricing, dailyBudget: draft.dailyBudgetEuros,
  });
  assert.equal(suggested, 1.5);
  const withProviderBid = { ...draft, linkedinBidEuros: suggested ?? undefined };
  assert.equal(linkedInAdsAutomaticPreflightKey("123", withProviderBid), before);
});

test("LinkedIn contextual defaults resolve only exact provider places in a verified common area", () => {
  const verifiedGeoTargets = [
    { urn: "urn:li:geo:1", name: "Valenciennes, Hauts-de-France, France" },
    { urn: "urn:li:geo:2", name: "Sallaumines, Hauts-de-France, France" },
  ];
  const arras = { urn: "urn:li:geo:3", name: "Arras, Hauts-de-France, France" };
  const lilleFrance = { urn: "urn:li:geo:4", name: "Lille, Hauts-de-France, France" };
  const lilleBelgium = { urn: "urn:li:geo:5", name: "Lille, Flemish Region, Belgium" };
  const cambraiFrance = { urn: "urn:li:geo:6", name: "Cambrai, Hauts-de-France, France" };
  const cambraiAustralia = { urn: "urn:li:geo:7", name: "Cambrai, South Australia, Australia" };
  const saintOmer = { urn: "urn:li:geo:12", name: "St. Omer, Hauts-de-France, France" };
  const result = linkedInAdsContextualGeoDefaults({
    targetLocations: ["Arras", "Lille", "Cambrai", "Harnes", "Saint-Omer"],
    verifiedGeoTargets,
    geoResolutions: [
      { query: "Arras", suggestions: [arras, { urn: "urn:li:geo:8", name: "Arras-sur-Rhône, France" }] },
      { query: "Lille", suggestions: [lilleBelgium, lilleFrance, { urn: "urn:li:geo:9", name: "Greater Lille Metropolitan Area, France" }] },
      { query: "Cambrai", suggestions: [cambraiAustralia, cambraiFrance] },
      { query: "Saint-Omer", suggestions: [saintOmer] },
      { query: "Harnes", suggestions: [{ urn: "urn:li:geo:10", name: "Harnes, Hauts-de-France, France" }], status: "provider_rejected" },
      { query: "Douai", suggestions: [{ urn: "urn:li:geo:11", name: "Douai, Hauts-de-France, France" }] },
    ],
  });
  assert.deepEqual(result.map((target) => target.urn), [
    "urn:li:geo:1", "urn:li:geo:2", "urn:li:geo:3", "urn:li:geo:4", "urn:li:geo:6", "urn:li:geo:12",
  ]);
});

test("LinkedIn contextual defaults leave ambiguous or unsupported areas for manual selection", () => {
  const verifiedGeoTargets = [
    { urn: "urn:li:geo:1", name: "Valenciennes, Hauts-de-France, France" },
    { urn: "urn:li:geo:2", name: "Sallaumines, Hauts-de-France, France" },
  ];
  const ambiguous = [
    { urn: "urn:li:geo:3", name: "Lille, Hauts-de-France, France" },
    { urn: "urn:li:geo:4", name: "Lille, Hauts-de-France, France" },
  ];
  const input = {
    targetLocations: ["Lille"],
    verifiedGeoTargets,
    geoResolutions: [{ query: "Lille", suggestions: ambiguous }],
  };
  assert.deepEqual(linkedInAdsContextualGeoDefaults(input), verifiedGeoTargets);
  assert.deepEqual(linkedInAdsContextualGeoDefaults({
    ...input, verifiedGeoTargets: [verifiedGeoTargets[0]],
  }), [verifiedGeoTargets[0]]);
  assert.deepEqual(linkedInAdsContextualGeoDefaults({
    ...input, verifiedGeoTargets: [verifiedGeoTargets[0], { urn: "urn:li:geo:5", name: "Bruges, Flemish Region, Belgium" }],
  }), [verifiedGeoTargets[0], { urn: "urn:li:geo:5", name: "Bruges, Flemish Region, Belgium" }]);
  assert.deepEqual(linkedInAdsContextualGeoDefaults({
    ...input, geoResolutions: [{ query: "Lille", suggestions: [{ urn: "urn:li:geo:invalid", name: "Lille, Hauts-de-France, France" }] }],
  }), verifiedGeoTargets);
});

test("LinkedIn CPC default uses only a cent-safe suggestion inside verified provider and budget bounds", () => {
  const input = { currentBid: undefined, suggestedBid: 0.01, pricing, dailyBudget: 25 };
  assert.equal(linkedInAdsVerifiedBidDefault(input), 0.01, "zero provider minimum still permits a positive cent");
  assert.equal(linkedInAdsVerifiedBidDefault({ ...input, currentBid: 0 }), 0.01);
  assert.equal(linkedInAdsVerifiedBidDefault({ ...input, currentBid: 1.25 }), null, "valid human bid is retained");
  assert.equal(linkedInAdsVerifiedBidDefault({ ...input, currentBid: 4 }), 0.01, "out-of-range bid is replaced");
  assert.equal(linkedInAdsVerifiedBidDefault({ ...input, currentBid: 0.001 }), 0.01, "fractional cents are replaced");
  assert.equal(linkedInAdsVerifiedBidDefault({ ...input, suggestedBid: 3.01 }), null);
  assert.equal(linkedInAdsVerifiedBidDefault({ ...input, suggestedBid: 0.001 }), null);
  assert.equal(linkedInAdsVerifiedBidDefault({ ...input, suggestedBid: 0 }), null);
  assert.equal(linkedInAdsVerifiedBidDefault({ ...input, suggestedBid: 2, dailyBudget: 1 }), null);
  assert.equal(linkedInAdsVerifiedBidDefault({ ...input, pricing: { ...pricing, bidMax: 30 }, suggestedBid: 20, dailyBudget: 15 }), null);
  assert.equal(linkedInAdsVerifiedBidDefault({ ...input, dailyBudget: 9 }), null, "provider daily minimum is enforced");
  assert.equal(linkedInAdsVerifiedBidDefault({ ...input, pricing: null }), null, "no unverified fallback bid");
  assert.equal(linkedInAdsVerifiedBidDefault({ ...input, pricing: { ...pricing, currency: "USD" } }), null);
  assert.equal(linkedInAdsVerifiedBidDefault({ ...input, pricing: { ...pricing, dailyBudgetMin: Number.NaN } }), null);
  assert.equal(linkedInAdsVerifiedBidDefault({ ...input, pricing: { ...pricing, bidMin: -1 } }), null);
  assert.equal(linkedInAdsVerifiedBidDefault({ ...input, pricing: { ...pricing, bidMin: 1.5 }, suggestedBid: 1 }), null);
  assert.equal(linkedInAdsVerifiedBidDefault({ ...input, pricing: { ...pricing, bidMin: 1.5 }, suggestedBid: 1.5 }), 1.5);
});
