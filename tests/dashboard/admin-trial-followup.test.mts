import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  ADMIN_TRIAL_FOLLOWUP_OFFSETS,
  adminTrialFollowupDedupeKey,
  adminTrialFollowupOffset,
  calendarDaysUntil,
} from "../../lib/trialFollowup.ts";

const read = (path: string) =>
  readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");

test("les rappels Admin ciblent précisément J-3 et J-2", () => {
  const now = new Date("2026-09-10T18:30:00.000Z");
  assert.deepEqual(ADMIN_TRIAL_FOLLOWUP_OFFSETS, [3, 2]);
  assert.equal(calendarDaysUntil("2026-09-13T02:00:00.000Z", now), 3);
  assert.equal(adminTrialFollowupOffset("2026-09-13T23:59:00.000Z", now), 3);
  assert.equal(adminTrialFollowupOffset("2026-09-12T00:05:00.000Z", now), 2);
  assert.equal(adminTrialFollowupOffset("2026-09-11T00:05:00.000Z", now), null);
});

test("la clé de rappel distingue le compte, l'échéance et le seuil", () => {
  assert.equal(
    adminTrialFollowupDedupeKey({
      trialUserId: "pro-123",
      trialEndAt: "2026-10-01T10:00:00.000Z",
      daysBeforeEnd: 3,
    }),
    "admin:trial-followup:pro-123:2026-10-01:d-3",
  );
});

test("le bloc Périodes d'essai remplace un emplacement libre dans Admin", () => {
  const adminHome = read("app/dashboard/admin/page.tsx");
  assert.match(adminHome, /href: "\/dashboard\/admin\/trials"/);
  assert.match(adminHome, /title: "Périodes d’essai"/);
  assert.match(adminHome, /Array\.from\(\{ length: 4 \}/);
  assert.match(adminHome, /const activeToolCount = tools\.length/);
});

test("l'API du cockpit reste admin-only et lit les vraies dates Supabase", () => {
  const route = read("app/api/admin/trials/route.ts");
  assert.match(route, /requireAdminApi\(\)/);
  assert.match(route, /\.from\("subscriptions"\)/);
  assert.match(route, /trial_start_at,trial_end_at/);
  assert.match(route, /\.from\("profiles"\)/);
  assert.match(route, /first_name,last_name,company_legal_name,phone/);
  assert.match(route, /hasScheduledSubscription/);
  assert.doesNotMatch(route, /NEXT_PUBLIC_SUPABASE_SERVICE_ROLE_KEY/);
});

test("le cockpit est plein écran, filtrable et exploitable sur mobile", () => {
  const client = read("app/dashboard/admin/trials/AdminTrialsClient.tsx");
  const css = read("app/dashboard/admin/trials/trials.module.css");
  assert.match(client, /À rappeler/);
  assert.match(client, /Abonnements prévus/);
  assert.match(client, /href=\{`tel:/);
  assert.match(client, /href=\{`mailto:/);
  assert.match(css, /height:\s*100dvh/);
  assert.match(css, /\.tableBody\s*\{[\s\S]*?overflow-y:\s*auto/);
  assert.match(css, /@media \(max-width: 560px\)/);
});

test("le cron alerte l'Admin sans relancer les abonnements déjà programmés", () => {
  const cron = read("app/api/cron/billing/route.ts");
  const writer = read("lib/adminTrialFollowupNotifications.ts");
  assert.match(cron, /hasScheduledStripeSubscription\s*\?\s*null\s*:\s*adminTrialFollowupOffset/);
  assert.match(cron, /sendAdminTrialFollowupNotifications/);
  assert.match(writer, /insertNotificationOnce/);
  assert.match(writer, /INRCY_SUBSCRIPTION_ALERT_EMAIL/);
  assert.match(writer, /admin_email_sent_at/);
  assert.match(writer, /category: "action"/);
});
