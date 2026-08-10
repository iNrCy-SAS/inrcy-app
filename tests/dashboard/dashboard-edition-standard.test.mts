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
  hasPremiumDashboardAccess,
} from "../../lib/dashboardEdition.ts";
import {
  isStandardAgentActionDescriptor,
  isStandardAgentAutomationKey,
} from "../../lib/standardAgentPolicy.ts";
import {
  canUseInrBadgeAppointments,
  effectiveInrBadgeShareSettings,
  getInrBadgeLeadPresentation,
  resolveInrBadgePublicEmail,
} from "../../lib/inrBadgeEditionPolicy.ts";
import { DEFAULT_INRBADGE_SHARE_SETTINGS } from "../../lib/inrBadgeSettings.ts";

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
const settingsDrawerSource = readFileSync(
  new URL("../../app/dashboard/_components/DashboardSettingsDrawerContent.tsx", import.meta.url),
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
  new URL("../../ops/sql/2026-08-10_standard_premium_founder_and_stripe_webhook.sql", import.meta.url),
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
const agentClientSource = readFileSync(
  new URL("../../app/dashboard/agent/AgentClient.tsx", import.meta.url),
  "utf8",
);
const agentSettingsApiSource = readFileSync(
  new URL("../../app/api/agent/settings/route.ts", import.meta.url),
  "utf8",
);
const agentCronSource = readFileSync(
  new URL("../../app/api/cron/inr-agent/route.ts", import.meta.url),
  "utf8",
);
const scheduledAgentCronSource = readFileSync(
  new URL("../../app/api/cron/inr-agent-scheduled-actions/route.ts", import.meta.url),
  "utf8",
);
const badgePageSource = readFileSync(
  new URL("../../app/badge/[slug]/page.tsx", import.meta.url),
  "utf8",
);
const badgeRdvPageSource = readFileSync(
  new URL("../../app/badge/[slug]/rdv/page.tsx", import.meta.url),
  "utf8",
);
const badgeAppointmentApiSource = readFileSync(
  new URL("../../app/api/inrbadge/appointment-request/route.ts", import.meta.url),
  "utf8",
);
const badgeSettingsApiSource = readFileSync(
  new URL("../../app/api/inrbadge/settings/route.ts", import.meta.url),
  "utf8",
);
const badgeSettingsSource = readFileSync(
  new URL("../../app/dashboard/settings/_components/InrBadgeSettingsContent.tsx", import.meta.url),
  "utf8",
);
const badgeLeadApiSource = readFileSync(
  new URL("../../app/api/inrbadge/lead/route.ts", import.meta.url),
  "utf8",
);
const statsClientSource = readFileSync(
  new URL("../../app/dashboard/stats/StatsClient.tsx", import.meta.url),
  "utf8",
);
const statsFoundationsSource = readFileSync(
  new URL("../../app/dashboard/stats/stats.client-foundations.ts", import.meta.url),
  "utf8",
);
const boosterModalLayerSource = readFileSync(
  new URL("../../app/dashboard/_components/DashboardBoosterModalLayer.tsx", import.meta.url),
  "utf8",
);
const inertiaContentSource = readFileSync(
  new URL("../../app/dashboard/settings/_components/InertiaContent.tsx", import.meta.url),
  "utf8",
);
const dashboardHelpModalsSource = readFileSync(
  new URL("../../app/dashboard/_components/DashboardHelpModals.tsx", import.meta.url),
  "utf8",
);
const gpsClientSource = readFileSync(
  new URL("../../app/dashboard/gps/GpsClient.tsx", import.meta.url),
  "utf8",
);
const gpsEditionPolicySource = readFileSync(
  new URL("../../app/dashboard/gps/gpsEditionPolicy.ts", import.meta.url),
  "utf8",
);
const statsHooksSource = readFileSync(
  new URL("../../app/dashboard/stats/stats.client-hooks.ts", import.meta.url),
  "utf8",
);
const statsReportApiSource = readFileSync(
  new URL("../../app/api/agent/actions/send-stats-report/route.ts", import.meta.url),
  "utf8",
);
const inrSendFileDownloadSource = readFileSync(
  new URL("../../app/api/inrsend/history/files/[fileId]/download/route.ts", import.meta.url),
  "utf8",
);
const loyaltyAwardApiSource = readFileSync(
  new URL("../../app/api/loyalty/award/route.ts", import.meta.url),
  "utf8",
);
const loyaltySummaryApiSource = readFileSync(
  new URL("../../app/api/loyalty/weekly-summary/route.ts", import.meta.url),
  "utf8",
);

test("app_edition pilote officiellement l'interface avec un fallback compatible sur les anciens plans", () => {
  assert.equal(resolveDashboardEditionFromEdition("standard"), "standard");
  assert.equal(resolveDashboardEditionFromEdition("premium"), "premium");
  assert.equal(resolveDashboardEditionFromEdition("founder"), "founder");
  assert.equal(hasPremiumDashboardAccess("premium"), true);
  assert.equal(hasPremiumDashboardAccess("founder"), true);
  assert.equal(hasPremiumDashboardAccess("standard"), false);
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

test("iNrBadge Standard utilise le mail de Mon profil et exclut entièrement la prise de RDV", () => {
  const storedSettings = { ...DEFAULT_INRBADGE_SHARE_SETTINGS, appointment: true };
  const effectiveSettings = effectiveInrBadgeShareSettings(storedSettings, "standard");

  assert.equal(effectiveSettings.appointment, false);
  assert.equal(storedSettings.appointment, true, "la configuration Premium reste réversible");
  assert.equal(canUseInrBadgeAppointments("standard", storedSettings), false);
  assert.equal(canUseInrBadgeAppointments("premium", storedSettings), true);
  assert.equal(canUseInrBadgeAppointments("founder", storedSettings), true);
  assert.equal(resolveInrBadgePublicEmail({
    edition: "standard",
    profileEmail: "profil@example.fr",
    selectedMailAccountEmail: "boite-connectee@example.fr",
  }), "profil@example.fr");
  assert.equal(resolveInrBadgePublicEmail({
    edition: "premium",
    profileEmail: "profil@example.fr",
    selectedMailAccountEmail: "boite-connectee@example.fr",
  }), "boite-connectee@example.fr");

  assert.match(badgePageSource, /dashboardEdition !== "standard" && selectedMailAccountId/);
  assert.match(badgePageSource, /canUseInrBadgeAppointments\(dashboardEdition, shareSettings\)/);
  assert.match(badgeRdvPageSource, /canUseInrBadgeAppointments\(dashboardEdition, shareSettings\)/);
  assert.match(badgeAppointmentApiSource, /dashboardEdition === "standard"/);
  assert.match(badgeSettingsApiSource, /dashboardEdition === "standard"/);
  assert.match(badgeSettingsSource, /!standardMode \? \(/);
  assert.match(badgeSettingsSource, /Email de Mon profil/);
  assert.match(statsClientSource, /appointmentsEnabled: !standardMode/);
  assert.match(statsFoundationsSource, /appointmentsEnabled\s*\? \{ label: "RDV 30j"/);
});

test("la capture de contact iNrBadge reste autonome en Standard sans renvoyer vers le CRM Premium", () => {
  const standardPresentation = getInrBadgeLeadPresentation("standard");
  const premiumPresentation = getInrBadgeLeadPresentation("premium");

  assert.equal(standardPresentation.ctaPath, "/dashboard/stats");
  assert.equal(standardPresentation.emailActionLabel, "Voir iNr’Stats");
  assert.doesNotMatch(standardPresentation.emailFooter, /CRM/i);
  assert.equal(premiumPresentation.ctaPath, "/dashboard/crm");
  assert.match(premiumPresentation.emailFooter, /CRM/i);
  assert.match(badgeLeadApiSource, /getInrBadgeLeadPresentation\(dashboardEdition\)/);
  assert.match(badgeLeadApiSource, /cta_url: leadPresentation\.ctaPath/);
  assert.match(badgeLeadApiSource, /to: proEmail/);
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

test("le Bilan Booster reste distinct de iNrStats et ouvre la modale historique Booster", () => {
  assert.match(standardModulesSource, /onClick=\{openBoosterSummary\}/);
  assert.match(standardModulesSource, />\s*Bilan\s*</);
  assert.doesNotMatch(standardModulesSource, /href="\/dashboard\/stats"[\s\S]{0,240}Bilan/);
  assert.match(boosterModalLayerSource, /Bilan Booster/);
  assert.doesNotMatch(boosterModalLayerSource, /Statistiques Booster/);
});

test("Mon inertie Standard n'active que Booster et identifie les missions Premium", () => {
  assert.match(inertiaContentSource, /Booster est votre mission active/);
  assert.match(inertiaContentSource, /premiumOnly: edition === "standard"/);
  assert.match(inertiaContentSource, /Forfait Premium/);
  assert.match(inertiaContentSource, /PREMIUM_INERTIA_ACTION_KEYS\.has\(e\.action_key\)/);
  assert.match(dashboardHelpModalsSource, /edition === "standard" && row\.premiumOnly/);
  assert.match(dashboardHelpModalsSource, /Forfait Premium/);
  assert.match(loyaltyAwardApiSource, /dashboardEdition === "standard" && PREMIUM_ONLY_ACTION_KEYS\.has\(actionKey\)/);
  assert.match(loyaltySummaryApiSource, /includePremiumMissions: dashboardEdition !== "standard"/);
});

test("le GPS Standard adapte les rubriques mixtes et affiche les outils Premium en aperçu", () => {
  for (const sectionId of ["propulser", "fideliser", "crm", "agenda", "documents"]) {
    assert.match(gpsEditionPolicySource, new RegExp(`"${sectionId}"`));
  }
  assert.match(gpsEditionPolicySource, /programmer les publications Booster/i);
  assert.match(gpsEditionPolicySource, /colonne Publications/i);
  assert.match(gpsEditionPolicySource, /données des canaux Standard/i);
  assert.match(gpsEditionPolicySource, /Bilan Booster/);
  assert.match(gpsClientSource, /selectedSectionPremium/);
  assert.match(gpsClientSource, /Nous contacter pour Premium/);
  assert.match(gpsClientSource, /styles\.premiumBadge/);
});

test("les écrans Premium sont refusés tandis que les outils Standard et iNrAgent limité restent accessibles", () => {
  for (const path of [
    "/dashboard",
    "/dashboard/agent",
    "/dashboard/stats",
    "/dashboard/mails",
    "/dashboard/e-reputation",
  ]) {
    assert.equal(isStandardDashboardRouteAllowed(path), true, path);
  }

  for (const path of [
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

test("iNrAgent Standard ne conserve que Publications et Statistiques", () => {
  assert.equal(isStandardAgentAutomationKey("publish"), true);
  assert.equal(isStandardAgentAutomationKey("stats"), true);
  assert.equal(isStandardAgentAutomationKey("grow"), false);
  assert.equal(isStandardAgentAutomationKey("loyalty"), false);

  assert.equal(isStandardAgentActionDescriptor({
    automationKey: "publish",
    actionType: "publication",
    targetTool: "booster",
  }), true);
  assert.equal(isStandardAgentActionDescriptor({
    automation_key: "stats",
    action_type: "stats_report",
    target_tool: "inrstats",
  }), true);
  assert.equal(isStandardAgentActionDescriptor({
    automationKey: "grow",
    actionType: "campaign",
    targetTool: "propulser",
  }), false);
  assert.equal(isStandardAgentActionDescriptor({
    automationKey: "publish",
    actionType: "campaign",
    targetTool: "booster",
  }), false);

  for (const path of [
    "/api/agent/settings",
    "/api/agent/actions",
    "/api/agent/actions/pending-count",
    "/api/agent/actions/prepare-publish",
    "/api/agent/actions/send-stats-report",
    "/api/agent/actions/schedule",
    "/api/agent/actions/execute",
    "/api/agent/scheduled-actions",
    "/api/agent/scheduled-actions/123/execute",
  ]) {
    assert.equal(isStandardApiRouteAllowed(path), true, path);
  }
  assert.equal(
    isStandardApiRouteAllowed("/api/agent/actions/prepare-campaign"),
    false,
  );
  assert.equal(isStandardApiRouteAllowed("/api/templates/render"), false);
  assert.equal(isStandardApiRouteAllowed("/api/templates/generate-ai"), false);
  assert.equal(isStandardApiRouteAllowed("/api/inrstats/mails"), false);

  assert.match(agentClientSource, /visibleAutomations/);
  assert.match(agentClientSource, /isStandardAgentAutomationKey/);
  assert.match(agentClientSource, /standardMode && settingsAutomation\.key === "stats" && theme === "Mails"/);
  assert.match(agentClientSource, /standardMode && theme === "Mails"/);
  assert.match(agentSettingsApiSource, /standardAgentAutomationKeysForPersistence/);
  assert.match(agentCronSource, /reason: "premium_required"/);
  assert.match(scheduledAgentCronSource, /status: "cancelled"/);
});

test("iNrStats Standard exclut les données Mails de l'interface et des bilans iNrAgent", () => {
  assert.match(statsClientSource, /includeMailStats: !standardMode/);
  assert.match(statsClientSource, /!standardMode \? \[buildMailCubeModel/);
  assert.match(statsHooksSource, /includeMailStats/);
  assert.match(statsHooksSource, /if \(!includeMailStats\) return/);
  assert.match(statsReportApiSource, /includeMail: dashboardEdition !== "standard"/);
  assert.match(statsReportApiSource, /standardReport/);
  assert.match(statsReportApiSource, /sanitizeStatsInsightsForEdition/);
  assert.match(statsReportApiSource, /Ne cite jamais Propulser, Fidéliser, CRM, Agenda, Encaisser/);
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
  assert.equal(isStandardApiRouteAllowed("/api/billing/checkout"), true);
  assert.equal(isStandardApiRouteAllowed("/api/crm/contacts"), false);
  assert.match(inrSendFileDownloadSource, /dashboardEdition === "standard" && !isPublicationFile/);
  assert.match(inrSendFileDownloadSource, /file_role/);
});

test("Mon compte affiche les identifiants puis le forfait et renvoie vers Mon abonnement", () => {
  const professionalInfoPosition = accountContentSource.indexOf("<div style={card}>");
  const subscriptionPosition = accountContentSource.indexOf("Votre forfait");

  assert.notEqual(professionalInfoPosition, -1);
  assert.notEqual(subscriptionPosition, -1);
  assert.ok(professionalInfoPosition < subscriptionPosition);
  assert.doesNotMatch(accountContentSource, /StandardSubscriptionContent/);
  assert.doesNotMatch(accountContentSource, /\/api\/billing\//);
  assert.match(accountContentSource, /Voir Mon abonnement/);
  assert.match(settingsDrawerSource, /onOpenSubscription=\{\(\) => openPanel\("abonnement"\)\}/);
  assert.match(settingsDrawerSource, /panel === "abonnement"/);
  assert.match(settingsDrawerSource, /<StandardSubscriptionContent/);
  assert.match(settingsDrawerSource, /<AbonnementContent mode="drawer"/);
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

  assert.match(editionMigrationSource, /check \(app_edition in \('standard', 'premium', 'founder'\)\)/i);
  assert.match(editionMigrationSource, /set app_edition = 'founder'/i);
  assert.match(editionMigrationSource, /alter column app_edition set default 'standard'/i);
  assert.match(editionMigrationSource, /create table if not exists public\.stripe_webhook_events/i);

  assert.match(adminUsersApiSource, /ALLOWED_APP_EDITIONS/);
  assert.match(adminUsersApiSource, /"founder"/);
  assert.match(adminUsersApiSource, /app_edition: appEdition/);
  assert.match(adminUsersClientSource, /Édition iNrCy/);
  assert.match(adminUsersClientSource, /app_edition: event\.target\.value/);
});
