import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const readSource = (path: string) => readFileSync(new URL(path, import.meta.url), "utf8");

const notificationsSource = readSource("../../app/api/cron/notifications/route.ts");
const searchLeadSource = readSource("../../app/api/inr-search/lead/route.ts");
const calendarReminderSource = readSource("../../app/api/cron/calendar-reminders/route.ts");
const campaignWorkerSource = readSource("../../lib/crmCampaigns.ts");
const campaignCompletionSource = readSource("../../lib/mailCampaignCompletionEmail.ts");

test("les digests et alertes iNr’Search n’envoient pas les comptes Standard vers le CRM ou iNr’Send", () => {
  assert.match(notificationsSource, /getDashboardEditionsForAccountIds/);
  assert.match(notificationsSource, /editionByUser\.get\(pref\.user_id\) \|\| "standard"/);
  assert.match(notificationsSource, /premiumToolsAvailable && crmLooksEmptyOrStale/);
  assert.match(notificationsSource, /premiumToolsAvailable && hasSocial && !hasMail/);

  assert.match(searchLeadSource, /hasCrmAccess \? "\/dashboard\/crm" : "\/dashboard\/stats"/);
  assert.match(searchLeadSource, /cta_url: actionPath/);
  assert.match(searchLeadSource, /Les coordonnées du prospect sont incluses dans cet email\./);
});

test("le cron Calendar vérifie l’édition avant toute notification ou tout rappel", () => {
  assert.match(calendarReminderSource, /getDashboardEditionsForAccountIds/);
  const editionGate = calendarReminderSource.indexOf("if (!hasPremiumDashboardAccess(editionByAccount.get(accountId) || \"standard\"))");
  const notificationWrite = calendarReminderSource.indexOf("await insertNotificationOnce({", editionGate);
  const emailSend = calendarReminderSource.indexOf("await sendTxMail({", editionGate);

  assert.ok(editionGate >= 0, "le worker doit bloquer les éditions autres que Premium/Founder");
  assert.ok(notificationWrite > editionGate, "aucune notification d’agenda ne doit précéder le contrôle de forfait");
  assert.ok(emailSend > editionGate, "aucun rappel email ne doit précéder le contrôle de forfait");
});

test("les campagnes différées sont arrêtées sur Standard et les bilans Premium ne sont pas envoyés", () => {
  assert.match(campaignWorkerSource, /getDashboardEditionsForAccountIds/);
  assert.match(campaignWorkerSource, /hasPremiumDashboardAccess\(editionByUser\.get\(userId\) \|\| "standard"\)/);
  assert.match(campaignWorkerSource, /pause_reason: "premium_required"/);
  assert.match(campaignWorkerSource, /premiumRestricted/);

  assert.match(campaignCompletionSource, /if \(!hasPremiumDashboardAccess\(edition\)\)\s*\{\s*return \{ sent: false, skippedReason: "premium_required" \};/);
});
