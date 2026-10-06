import assert from "node:assert/strict";
import test from "node:test";
import type { LinkedInWizardSettings } from "../lib/adsChannelWizardSettings.ts";
import {
  linkedInAdsAutomaticPreflightKey,
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
