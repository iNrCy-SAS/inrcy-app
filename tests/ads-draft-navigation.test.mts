import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { adsDraftValidationStep } from "../lib/adsDraftNavigation.ts";

test("un brouillon reprend toujours sur la validation adaptée à son parcours", () => {
  assert.equal(adsDraftValidationStep({ provider: "google", campaignType: "search", creationMode: "manual" }), 7);
  assert.equal(adsDraftValidationStep({ provider: "google", campaignType: "search", creationMode: "inrcy" }), 8);
  assert.equal(adsDraftValidationStep({ provider: "meta", campaignType: "meta_traffic", creationMode: "manual" }), 8);
  assert.equal(adsDraftValidationStep({ provider: "pinterest", campaignType: "generic", creationMode: "inrcy" }), 9);
});

test("le menu iNr’ADS lit uniquement les brouillons et les rouvre sans dupliquer le stockage", () => {
  const menu = readFileSync(new URL("../app/dashboard/ads/AdsDraftsMenu.tsx", import.meta.url), "utf8");
  const client = readFileSync(new URL("../app/dashboard/ads/AdsClient.tsx", import.meta.url), "utf8");
  const route = readFileSync(new URL("../app/api/ads/campaigns/route.ts", import.meta.url), "utf8");

  assert.match(menu, /\/api\/ads\/campaigns\?status=draft/);
  assert.match(menu, /folder=campagnes-ads&boxView=drafts/);
  assert.match(client, /<AdsDraftsMenu refreshKey=\{draftsRevision\} onOpenDraft=\{openDraftFromHeader\}/);
  assert.match(client, /setStep\(adsDraftValidationStep\(campaign\.draft\)\)/);
  assert.match(client, /Toutes les étapes précédentes restent modifiables/);
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
