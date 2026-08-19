import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const report = readFileSync("lib/mailCampaignReport.ts", "utf8");
const reportServer = readFileSync("lib/mailCampaignReportServer.ts", "utf8");
const campaigns = readFileSync("lib/crmCampaigns.ts", "utf8");
const completion = readFileSync("lib/mailCampaignCompletionEmail.ts", "utf8");
const reportRoute = readFileSync("app/api/inrsend/campaigns/[id]/report/route.ts", "utf8");
const summaryRoute = readFileSync("app/api/inrsend/campaigns/[id]/completion-summary/route.ts", "utf8");
const client = readFileSync("app/dashboard/mails/MailboxClient.tsx", "utf8");
const modal = readFileSync("app/dashboard/mails/_components/MailboxDetailsModal.tsx", "utf8");
const sql = readFileSync("ops/sql/2026-07-27_inrsend_step4_professional_experience.sql", "utf8");

test("le rapport est calcule et persiste a chaque progression", () => {
  assert.match(report, /estimateCampaignDurationMs/);
  assert.match(report, /progressPercent/);
  assert.match(reportServer, /report_summary/);
  assert.match(campaigns, /loadAndPersistMailCampaignReport/);
});

test("le suivi est actualise automatiquement sans recharger toute la page", () => {
  assert.match(reportRoute, /loadAndPersistMailCampaignReport/);
  assert.doesNotMatch(client, /setInterval/);
  assert.match(client, /document\.hidden/);
  assert.match(client, /visibilitychange/);
  assert.match(client, /schedule\(0\)/);
  assert.match(client, /120_000/);
  assert.match(modal, /i18nT\("suivi_automatique_toutes_les_2_minutes_8ff76207"\)/);
  assert.match(modal, /!isCampaignFinishedStatus/);
  assert.match(modal, /progressPercent/);
});

test("le bilan mail est trace et peut etre renvoye", () => {
  assert.match(completion, /sendTrackedMailCampaignCompletionSummary/);
  assert.match(completion, /completion_email_status/);
  assert.match(summaryRoute, /force: true/);
  assert.match(modal, /i18nT\("renvoyer_le_bilan_c0b47db8"\)/);
  assert.match(sql, /claim_mail_campaign_completion_email/);
});

test("la migration ajoute les champs d'experience sans toucher aux contenus", () => {
  assert.match(sql, /progress_percent/);
  assert.match(sql, /estimated_completion_at/);
  assert.match(sql, /report_summary jsonb/);
  assert.match(sql, /completion_email_sent_at/);
});
