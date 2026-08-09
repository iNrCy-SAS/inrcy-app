import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const reputation = readFileSync("lib/mailboxReputation.ts", "utf8");
const campaigns = readFileSync("lib/crmCampaigns.ts", "utf8");
const sender = readFileSync("lib/inrsend/sendMailFromIntegration.ts", "utf8");
const scanner = readFileSync("lib/mailBounceScanner.ts", "utf8");
const parser = readFileSync("lib/mailBounceParser.ts", "utf8");
const unsubscribe = readFileSync("app/api/inrsend/unsubscribe/route.ts", "utf8");
const googleStart = readFileSync("app/api/integrations/google/start/route.ts", "utf8");
const microsoftStart = readFileSync("app/api/integrations/microsoft/start/route.ts", "utf8");
const vercel = readFileSync("vercel.json", "utf8");
const sql = readFileSync("ops/sql/2026-07-27_inrsend_step3_reputation_protection.sql", "utf8");

test("la cadence devient adaptative sans jamais accelerer les garde-fous", () => {
  assert.match(reputation, /clampConfig/);
  assert.match(reputation, /Math\.min\(base\.batchSize/);
  assert.match(reputation, /Math\.max\(base\.sendDelayMs/);
  assert.match(reputation, /provider === "imap"/);
  assert.match(reputation, /healthStatus === "watch"/);
  assert.match(campaigns, /resolveMailboxReputationPolicy/);
  assert.match(campaigns, /campaignConfig\.sendDelayMs/);
});

test("SPF DKIM et DMARC sont controles sans bloquer aveuglement", () => {
  assert.match(reputation, /resolveTxt/);
  assert.match(reputation, /v=spf1/i);
  assert.match(reputation, /v=dmarc1/i);
  assert.match(reputation, /_domainkey/);
  assert.match(reputation, /warnings/);
});

test("les mails de campagne incluent le desabonnement en un clic", () => {
  assert.match(sender, /List-Unsubscribe/);
  assert.match(sender, /List-Unsubscribe-Post/);
  assert.match(sender, /List-Unsubscribe=One-Click/);
  assert.match(unsubscribe, /application\/x-www-form-urlencoded/);
  assert.match(unsubscribe, /url\.searchParams\.get\("campaignId"\)/);
});

test("les retours automatiques sont analyses sans lire les boites Gmail", () => {
  assert.doesNotMatch(scanner, /scanGmail|gmail\.readonly|gmail\.modify|gmail-inbox/);
  assert.match(scanner, /scanMicrosoft/);
  assert.match(scanner, /scanImap/);
  assert.match(scanner, /filterUnprocessedFeedbackIds/);
  assert.match(scanner, /loadConnectedMailboxes/);
  assert.match(scanner, /pendingEventIds/);
  assert.match(parser, /Final-Recipient/);
  assert.match(parser, /X-Failed-Recipients/);
  assert.match(vercel, /\/api\/cron\/mail-bounces/);
});

test("Google ne demande que l'envoi et jamais la lecture Gmail", () => {
  assert.match(googleStart, /gmail\.send/);
  assert.doesNotMatch(googleStart, /gmail\.readonly|gmail\.modify/);
  assert.match(microsoftStart, /Mail\.Read/);
});

test("la reputation est stockee et modifiee uniquement cote serveur", () => {
  assert.match(sql, /create table if not exists public\.mailbox_reputation_state/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /record_mailbox_reputation_outcome/);
  assert.match(sql, /grant execute[\s\S]*to service_role/);
  assert.match(sql, /alter table public\.mail_provider_events enable row level security/);
  assert.doesNotMatch(sql, /for update\s+to authenticated[\s\S]*mailbox_reputation_state/i);
});
