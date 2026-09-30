import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { adsDraftHasKeywordsStep, adsDraftHasMediaStep, adsDraftValidationStep } from "../lib/adsDraftNavigation.ts";

test("un brouillon reprend toujours sur la validation adaptée à son parcours", () => {
  assert.equal(adsDraftValidationStep({ provider: "google", campaignType: "search", creationMode: "manual" }), 7);
  assert.equal(adsDraftValidationStep({ provider: "google", campaignType: "search", creationMode: "inrcy" }), 8);
  assert.equal(adsDraftValidationStep({ provider: "meta", campaignType: "meta_traffic", creationMode: "manual" }), 8);
  assert.equal(adsDraftValidationStep({ provider: "pinterest", campaignType: "generic", creationMode: "manual" }), 8);
  assert.equal(adsDraftValidationStep({ provider: "pinterest", campaignType: "generic", creationMode: "inrcy" }), 9);
});

test("Pinterest automatique omet Découverte, les trois ciblages manuels la conservent", () => {
  const draft = { provider: "pinterest" as const, campaignType: "generic" as const, creationMode: "inrcy" as const };
  assert.equal(adsDraftHasKeywordsStep(draft), false);
  for (const targetingMode of ["automatic", "interests", "keywords", "audiences"] as const) {
    const configured = { ...draft, channelSettings: { schemaVersion: 1 as const, channel: "pinterest" as const,
      objectiveType: "CONSIDERATION" as const, intendedPromotionType: "STANDARD_AD" as const,
      creativeType: "REGULAR" as const, targetingMode, conversionEvent: null } };
    assert.equal(adsDraftHasKeywordsStep(configured), targetingMode !== "automatic");
    assert.equal(adsDraftValidationStep(configured), targetingMode === "automatic" ? 9 : 10);
  }
  for (const provider of ["google", "meta", "linkedin", "tiktok", "x"] as const) {
    assert.equal(adsDraftHasKeywordsStep({ provider }), true);
  }
});

test("seuls Google Search et le post X textuel omettent l’étape médias", () => {
  assert.equal(adsDraftHasMediaStep({ provider: "google", campaignType: "search" }), false);
  assert.equal(adsDraftHasMediaStep({ provider: "google", campaignType: "performance_max" }), true);
  assert.equal(adsDraftHasMediaStep({ provider: "meta", campaignType: "meta_traffic" }), true);
  assert.equal(adsDraftHasMediaStep({ provider: "linkedin", campaignType: "generic", channelSettings: { schemaVersion: 1, channel: "linkedin", objectiveType: "WEBSITE_VISIT", format: "TEXT_AD", targetingFacet: "titles", locale: { country: "FR", language: "fr" } } }), true);
  assert.equal(adsDraftHasMediaStep({ provider: "tiktok", campaignType: "generic" }), true);
  assert.equal(adsDraftHasMediaStep({ provider: "pinterest", campaignType: "generic", channelSettings: { schemaVersion: 1, channel: "pinterest", objectiveType: "SALES", intendedPromotionType: "CATALOG", creativeType: null, targetingMode: "automatic", conversionEvent: "CHECKOUT" } }), true);
  assert.equal(adsDraftHasMediaStep({ provider: "x", campaignType: "generic", channelSettings: { schemaVersion: 1, channel: "x", objective: "website_traffic", format: "text", targetingMode: "broad" } }), false);
  assert.equal(adsDraftHasMediaStep({ provider: "x", campaignType: "generic", channelSettings: { schemaVersion: 1, channel: "x", objective: "website_traffic", format: "image", targetingMode: "broad" } }), true);
  assert.equal(adsDraftValidationStep({ provider: "x", campaignType: "generic", creationMode: "manual", channelSettings: { schemaVersion: 1, channel: "x", objective: "website_traffic", format: "text", targetingMode: "broad" } }), 7);
  assert.equal(adsDraftValidationStep({ provider: "x", campaignType: "generic", creationMode: "manual", channelSettings: { schemaVersion: 1, channel: "x", objective: "website_traffic", format: "video", targetingMode: "broad" } }), 8);
});

test("le menu iNr’ADS lit uniquement les brouillons et les rouvre sans dupliquer le stockage", () => {
  const menu = readFileSync(new URL("../app/dashboard/ads/AdsDraftsMenu.tsx", import.meta.url), "utf8");
  const client = readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8");
  const route = readFileSync(new URL("../app/api/ads/campaigns/route.ts", import.meta.url), "utf8");

  assert.match(menu, /\/api\/ads\/campaigns\?status=draft/);
  assert.match(menu, /folder=campagnes-ads&boxView=drafts/);
  assert.match(client, /<AdsDraftsMenu refreshKey=\{draftsRevision\} onOpenDraft=\{openDraftFromHeader\}/);
  assert.match(client, /setStep\(adsDraftValidationStep\(campaign\.draft\)\)/);
  assert.doesNotMatch(client, /setNotice\(`Brouillon.*rouvert/);
  assert.match(route, /requestedStatus !== null && requestedStatus !== "draft"/);
  assert.match(route, /query = query\.eq\("status", "draft"\)/);
  assert.doesNotMatch(route, /from\("send_items"\)/);
});

test("iNr’Send expose une vue ADS Brouillons et un accès direct au studio", () => {
  const folder = readFileSync(new URL("../app/dashboard/mails/_components/AdsCampaignsFolder.tsx", import.meta.url), "utf8");
  const details = readFileSync(new URL("../app/dashboard/mails/_components/AdsCampaignDetailsModal.tsx", import.meta.url), "utf8");
  const mailbox = readFileSync(new URL("../app/dashboard/mails/MailboxClient.tsx", import.meta.url), "utf8");

  assert.match(mailbox, /draftOnly=\{searchParams\?\.get\("boxView"\) === "drafts"\}/);
  assert.match(folder, /params\.set\("status", "draft"\)/);
  assert.match(folder, /draftOnly \? "Brouillons ADS" : "ADS"/);
  assert.match(folder, /editCampaign=\$\{encodeURIComponent\(campaign\.id\)\}/);
  assert.match(details, /channel=\$\{encodeURIComponent\(campaign\.provider\)\}&editCampaign=/);
  assert.match(folder, /Toutes les campagnes/);
});
