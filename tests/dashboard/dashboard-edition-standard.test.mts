import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  STANDARD_BONUS_CHANNEL_KEYS,
  STANDARD_PUBLICATION_CHANNEL_KEYS,
  isStandardApiRouteAllowed,
  isStandardDashboardRouteAllowed,
  resolveDashboardEdition,
  resolveDashboardEditionFromEdition,
  resolveDashboardEditionFromPlan,
} from "../../lib/dashboardEdition.ts";

const dashboardClientSource = readFileSync(
  new URL("../../app/dashboard/DashboardClient.tsx", import.meta.url),
  "utf8",
);
const channelsSectionSource = readFileSync(
  new URL("../../app/dashboard/_components/DashboardChannelsSection.tsx", import.meta.url),
  "utf8",
);
const standardModulesSource = readFileSync(
  new URL("../../app/dashboard/_components/DashboardStandardModulesCard.tsx", import.meta.url),
  "utf8",
);
const connectionBubbleSource = readFileSync(
  new URL("../../app/dashboard/_components/DashboardFluxBubble.tsx", import.meta.url),
  "utf8",
);
const accountContentSource = readFileSync(
  new URL("../../app/dashboard/settings/_components/AccountContent.tsx", import.meta.url),
  "utf8",
);
const trialSubscriptionSource = readFileSync(
  new URL("../../lib/trialSubscription.ts", import.meta.url),
  "utf8",
);
const publicSignupSource = readFileSync(
  new URL("../../app/api/public/trial-signup/route.ts", import.meta.url),
  "utf8",
);
const adminSignupSource = readFileSync(
  new URL("../../app/api/admin/create-trial/route.ts", import.meta.url),
  "utf8",
);
const billingCronSource = readFileSync(
  new URL("../../app/api/cron/billing/route.ts", import.meta.url),
  "utf8",
);
const stripeWebhookSource = readFileSync(
  new URL("../../app/api/stripe/webhook/route.ts", import.meta.url),
  "utf8",
);
const editionMigrationSource = readFileSync(
  new URL("../../ops/sql/2026-08-10_subscriptions_app_edition.sql", import.meta.url),
  "utf8",
);
const adminUsersApiSource = readFileSync(
  new URL("../../app/api/admin/users/route.ts", import.meta.url),
  "utf8",
);
const adminUsersClientSource = readFileSync(
  new URL("../../app/dashboard/admin/users/AdminUsersClient.tsx", import.meta.url),
  "utf8",
);

test("app_edition pilote officiellement l'interface avec un fallback compatible sur les anciens plans", () => {
  assert.equal(resolveDashboardEditionFromEdition("standard"), "standard");
  assert.equal(resolveDashboardEditionFromEdition("premium"), "premium");
  assert.equal(resolveDashboardEdition({ edition: "standard", plan: "Trial", production: true }), "standard");
  assert.equal(resolveDashboardEdition({ edition: "premium", plan: "Standard", production: true }), "premium");

  assert.equal(resolveDashboardEditionFromPlan("Standard"), "standard");
  assert.equal(resolveDashboardEditionFromPlan("  inrcy-standard  "), "standard");

  for (const historicPlan of ["Trial", "Starter", "Accel", "Speed", "Premium", "", null, undefined, "valeur-inconnue"]) {
    assert.equal(resolveDashboardEditionFromPlan(historicPlan), "premium");
  }
});

test("l'aperçu local ne peut jamais forcer Standard en production", () => {
  assert.equal(resolveDashboardEdition({
    plan: "Premium",
    developmentOverride: "standard",
    production: false,
  }), "standard");
  assert.equal(resolveDashboardEdition({
    plan: "Premium",
    developmentOverride: "standard",
    production: true,
  }), "premium");
});

test("Standard contient exactement dix destinations de publication et iNrBadge en bonus", () => {
  assert.equal(STANDARD_PUBLICATION_CHANNEL_KEYS.length, 10);
  assert.deepEqual(STANDARD_BONUS_CHANNEL_KEYS, ["inrbadge"]);
  assert.equal(STANDARD_PUBLICATION_CHANNEL_KEYS.includes("inrbadge" as never), false);
  assert.equal(STANDARD_PUBLICATION_CHANNEL_KEYS.includes("mails" as never), false);
});

test("Standard conserve le dashboard actuel et ne remplace que les deux blocs inférieurs", () => {
  assert.match(dashboardClientSource, /<DashboardHero/);
  assert.match(dashboardClientSource, /<DashboardChannelsSection/);
  assert.match(dashboardClientSource, /standardMode=\{isStandardEdition\}/);
  assert.doesNotMatch(dashboardClientSource, /DashboardStandardExperience/);
  assert.match(channelsSectionSource, /standardMode \? \(/);
  assert.match(channelsSectionSource, /<DashboardStandardModulesCard/);
  assert.match(channelsSectionSource, /<DashboardModulesCard/);
});

test("Standard conserve les vraies bulles de connexion avec Voir et Configurer", () => {
  assert.match(channelsSectionSource, /<DashboardFluxBubble/);
  assert.match(dashboardClientSource, /STANDARD_DASHBOARD_BUBBLE_KEYS/);
  assert.match(dashboardClientSource, /STANDARD_BONUS_CHANNEL_KEYS/);
  assert.match(connectionBubbleSource, /item\.viewFallbackLabel \|\| "Voir"/);
  assert.match(connectionBubbleSource, /item\.configureLabel \|\| "Configurer"/);
});

test("les blocs inférieurs Standard ne contiennent que Stats, Publications, Réputation et Booster", () => {
  assert.match(standardModulesSource, /\/dashboard\/stats/);
  assert.match(standardModulesSource, /folder=publications&boxView=sent/);
  assert.match(standardModulesSource, /\/dashboard\/e-reputation/);
  assert.match(standardModulesSource, /Créer une publication/);
  assert.doesNotMatch(standardModulesSource, /dashboard\/crm/);
  assert.doesNotMatch(standardModulesSource, /dashboard\/agenda/);
  assert.doesNotMatch(standardModulesSource, /dashboard\/propulser/);
  assert.doesNotMatch(standardModulesSource, /dashboard\/fideliser/);
  assert.match(standardModulesSource, /standardStyles\.boosterPanel/);
  assert.doesNotMatch(standardModulesSource, /gearboxTitle|gearboxSub|boosterStage|boosterCard/);
  assert.match(standardModulesSource, /standardStyles\.toolAction/);
});

test("les écrans Premium sont refusés tandis que les quatre outils Standard restent accessibles", () => {
  for (const path of [
    "/dashboard",
    "/dashboard/stats",
    "/dashboard/mails",
    "/dashboard/e-reputation",
  ]) {
    assert.equal(isStandardDashboardRouteAllowed(path), true, path);
  }

  for (const path of [
    "/dashboard/agent",
    "/dashboard/crm",
    "/dashboard/agenda",
    "/dashboard/propulser",
    "/dashboard/fideliser",
    "/dashboard/factures",
  ]) {
    assert.equal(isStandardDashboardRouteAllowed(path), false, path);
  }

  assert.equal(
    isStandardDashboardRouteAllowed("/dashboard", new URLSearchParams("action=cash")),
    false,
  );
  assert.equal(
    isStandardDashboardRouteAllowed("/dashboard", new URLSearchParams("panel=ia")),
    true,
  );
});

test("iNrSend Standard n'expose que l'historique Publications", () => {
  assert.equal(
    isStandardApiRouteAllowed(
      "/api/inrsend/history",
      new URLSearchParams("folder=publications&boxView=sent"),
    ),
    true,
  );
  assert.equal(isStandardApiRouteAllowed("/api/inrsend/history", new URLSearchParams()), false);
  assert.equal(
    isStandardApiRouteAllowed("/api/inrsend/history", new URLSearchParams("folder=mails")),
    false,
  );
  assert.equal(isStandardApiRouteAllowed("/api/inrsend/signature"), false);
  assert.equal(isStandardApiRouteAllowed("/api/inrsend/campaigns/123/report"), false);
  assert.equal(isStandardApiRouteAllowed("/api/inrsend/publications/123/facebook"), true);
  assert.equal(isStandardApiRouteAllowed("/api/billing/checkout"), false);
  assert.equal(isStandardApiRouteAllowed("/api/crm/contacts"), false);
});

test("Mon compte affiche les informations du professionnel avant les forfaits Standard et Premium", () => {
  const professionalInfoPosition = accountContentSource.indexOf("<div style={card}>");
  const subscriptionPosition = accountContentSource.lastIndexOf("<StandardSubscriptionContent");

  assert.notEqual(professionalInfoPosition, -1);
  assert.notEqual(subscriptionPosition, -1);
  assert.ok(professionalInfoPosition < subscriptionPosition);
});

test("toute nouvelle inscription officielle reçoit Standard tout en conservant le cycle d'essai", () => {
  assert.match(trialSubscriptionSource, /NEW_ACCOUNT_EDITION = "standard" as const/);
  assert.match(trialSubscriptionSource, /plan: "Trial"/);
  assert.match(trialSubscriptionSource, /app_edition: NEW_ACCOUNT_EDITION/);
  assert.match(trialSubscriptionSource, /status: "trialing"/);

  for (const signupSource of [publicSignupSource, adminSignupSource]) {
    assert.match(signupSource, /const \{ edition, trialDays/);
    assert.match(signupSource, /app_edition: edition/);
  }

  assert.match(billingCronSource, /\.eq\("plan", "Trial"\)/);
  assert.match(stripeWebhookSource, /plan: "Trial"/);

  assert.match(editionMigrationSource, /add column if not exists app_edition text/i);
  assert.match(editionMigrationSource, /set app_edition = 'premium'/i);
  assert.match(editionMigrationSource, /alter column app_edition set default 'standard'/i);
  assert.match(editionMigrationSource, /check \(app_edition in \('standard', 'premium'\)\)/i);

  assert.match(adminUsersApiSource, /ALLOWED_APP_EDITIONS/);
  assert.match(adminUsersApiSource, /app_edition: appEdition/);
  assert.match(adminUsersClientSource, /Édition iNrCy/);
  assert.match(adminUsersClientSource, /app_edition: event\.target\.value/);
});
