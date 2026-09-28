import assert from "node:assert/strict";
import { test } from "node:test";
import { adsDestinationReviewState, resolveAdsCampaignDestination } from "../lib/adsDestination.ts";

test("explicit campaign destination wins over the professional website and Google Business", () => {
  assert.deepEqual(resolveAdsCampaignDestination({
    explicitUrl: "https://offre.example/rdv",
    profileWebsiteUrl: "https://entreprise.example",
    googleBusinessConnected: true,
    googleBusinessUrl: "https://www.google.com/maps/search/?api=1&query=Entreprise",
  }), { url: "https://offre.example/rdv", source: "explicit" });
});

test("the profile or connected site is used before Google Business", () => {
  assert.deepEqual(resolveAdsCampaignDestination({
    profileWebsiteUrl: "entreprise.example/contact",
    connectedWebsiteUrl: "https://autre.example",
    googleBusinessConnected: true,
    googleBusinessUrl: "https://www.google.com/maps/search/?api=1&query=Entreprise",
  }), { url: "https://entreprise.example/contact", source: "website" });
  assert.deepEqual(resolveAdsCampaignDestination({
    connectedWebsiteUrl: "https://site-connecte.example",
    inrcyWebsiteUrl: "https://site-inrcy.example",
  }), { url: "https://site-connecte.example/", source: "website" });
});

test("a selected Google Business listing is the fallback, never an unconnected listing", () => {
  const googleBusinessUrl = "https://www.google.com/maps/search/?api=1&query=Entreprise";
  assert.deepEqual(resolveAdsCampaignDestination({ googleBusinessConnected: true, googleBusinessUrl }), {
    url: googleBusinessUrl,
    source: "google_business",
  });
  assert.deepEqual(resolveAdsCampaignDestination({ googleBusinessConnected: false, googleBusinessUrl }), {
    url: "",
    source: "none",
  });
});

test("unsafe or unverifiable destinations never enter the generated campaign", () => {
  assert.deepEqual(resolveAdsCampaignDestination({
    explicitUrl: "javascript:alert(1)",
    profileWebsiteUrl: "http://entreprise.example",
    googleBusinessConnected: true,
    googleBusinessUrl: "https://www.google.com/maps/search/?api=1&query=Entreprise",
  }).source, "google_business");
  assert.deepEqual(resolveAdsCampaignDestination({
    profileWebsiteUrl: "https://user:pass@entreprise.example",
    googleBusinessConnected: false,
  }), { url: "", source: "none" });
});

test("an AI-proposed website link requires explicit confirmation at Diffusion", () => {
  const args = {
    assisted: true,
    fieldVisible: true,
    websiteRequired: true,
    destinationUrl: "https://entreprise.example/offre",
  };
  assert.deepEqual(adsDestinationReviewState({ ...args, confirmedUrl: "" }), {
    required: true, valid: true, confirmed: false, canContinue: false,
  });
  assert.equal(adsDestinationReviewState({ ...args, confirmedUrl: args.destinationUrl }).canContinue, true);
  assert.equal(adsDestinationReviewState({ ...args, destinationUrl: "https://entreprise.example/autre", confirmedUrl: args.destinationUrl }).canContinue, false);
  assert.equal(adsDestinationReviewState({ ...args, destinationUrl: "http://entreprise.example/offre", confirmedUrl: "" }).valid, false);
  assert.equal(adsDestinationReviewState({ ...args, destinationUrl: "", confirmedUrl: "" }).canContinue, false);
});

test("manual and non-website campaigns without a destination are not blocked", () => {
  assert.equal(adsDestinationReviewState({ assisted: false, fieldVisible: true, websiteRequired: true, destinationUrl: "", confirmedUrl: "" }).canContinue, true);
  assert.equal(adsDestinationReviewState({ assisted: true, fieldVisible: false, websiteRequired: false, destinationUrl: "", confirmedUrl: "" }).canContinue, true);
  assert.equal(adsDestinationReviewState({ assisted: true, fieldVisible: true, websiteRequired: false, destinationUrl: "", confirmedUrl: "" }).canContinue, true);
});
