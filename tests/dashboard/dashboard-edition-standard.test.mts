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
import { getChannelTone } from "../../app/dashboard/_components/dashboard-channel-presentation.ts";

const dashboardClientSource = readFileSync(
  new URL("../../app/dashboard/DashboardClient.tsx", import.meta.url),
  "utf8",
);
const channelsSectionSource = readFileSync(
  new URL("../../app/dashboard/_components/DashboardChannelsSection.tsx", import.meta.url),
  "utf8",
);
const channelsModalSource = readFileSync(
  new URL("../../app/dashboard/_components/DashboardChannelsModal.tsx", import.meta.url),
  "utf8",
);
const channelsModalCssSource = readFileSync(
  new URL("../../app/dashboard/_components/DashboardChannelsModal.module.css", import.meta.url),
  "utf8",
);
const standardModulesSource = readFileSync(
  new URL("../../app/dashboard/_components/DashboardStandardModulesCard.tsx", import.meta.url),
  "utf8",
);
const sharedModulesSource = readFileSync(
  new URL("../../app/dashboard/_components/DashboardModulesCard.tsx", import.meta.url),
  "utf8",
);
const sharedModulesCssSource = readFileSync(
  new URL("../../app/dashboard/_components/DashboardSignatureTools.module.css", import.meta.url),
  "utf8",
);
const campaignChoicesSource = readFileSync(
  new URL("../../app/dashboard/_components/DashboardCampaignChoices.tsx", import.meta.url),
  "utf8",
);
const fluxBubblesSource = readFileSync(
  new URL("../../app/dashboard/dashboard.flux-bubbles.ts", import.meta.url),
  "utf8",
);
const fluxBubbleSource = readFileSync(
  new URL("../../app/dashboard/_components/DashboardFluxBubble.tsx", import.meta.url),
  "utf8",
);
const dashboardAgentPlanningSource = readFileSync(
  new URL(
    "../../app/dashboard/agent/_components/DashboardAgentPlanningModal.tsx",
    import.meta.url,
  ),
  "utf8",
);
const agentActionModalsSource = readFileSync(
  new URL(
    "../../app/dashboard/agent/_components/AgentActionModals.tsx",
    import.meta.url,
  ),
  "utf8",
);
const agentStylesSource = readFileSync(
  new URL("../../app/dashboard/agent/agent.module.css", import.meta.url),
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
const subscriptionContentSource = readFileSync(
  new URL("../../app/dashboard/settings/_components/StandardSubscriptionContent.tsx", import.meta.url),
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
const agentActionsApiSource = readFileSync(
  new URL("../../app/api/agent/actions/route.ts", import.meta.url),
  "utf8",
);
const agentScheduleSource = readFileSync(
  new URL("../../app/dashboard/agent/_lib/agent.schedule.ts", import.meta.url),
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
const publicationResultModalSource = readFileSync(
  new URL("../../app/dashboard/_components/PublishExecutionResultModal.tsx", import.meta.url),
  "utf8",
);
const dashboardI18nSource = readFileSync(
  new URL("../../messages/fr-FR/dashboard.json", import.meta.url),
  "utf8",
);
const boosterI18nSource = readFileSync(
  new URL("../../messages/fr-FR/booster.json", import.meta.url),
  "utf8",
);
const gpsI18n = JSON.parse(
  readFileSync(new URL("../../messages/fr-FR/gps.json", import.meta.url), "utf8"),
) as Record<string, string>;
const dashboardCssSource = readFileSync(
  new URL("../../app/dashboard/dashboard.module.css", import.meta.url),
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
const inrSendClientSource = readFileSync(
  new URL("../../app/dashboard/mails/MailboxClient.tsx", import.meta.url),
  "utf8",
);
const inrSendToolbarSource = readFileSync(
  new URL("../../app/dashboard/mails/_components/MailboxToolbar.tsx", import.meta.url),
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

test("plan pilote les droits, avec fallback compatible sur les anciens plans", () => {
  assert.equal(resolveDashboardEditionFromEdition("standard"), "standard");
  assert.equal(resolveDashboardEditionFromEdition("premium"), "premium");
  assert.equal(resolveDashboardEditionFromEdition("founder"), "founder");
  assert.equal(hasPremiumDashboardAccess("premium"), true);
  assert.equal(hasPremiumDashboardAccess("founder"), true);
  assert.equal(hasPremiumDashboardAccess("standard"), false);
  assert.equal(resolveDashboardEdition({ edition: "standard", plan: "Trial", production: true }), "standard");
  assert.equal(resolveDashboardEdition({ edition: "premium", plan: "Standard", production: true }), "standard");
  assert.equal(resolveDashboardEdition({ edition: "standard", plan: "Premium", production: true }), "premium");
  assert.equal(resolveDashboardEdition({ edition: "standard", plan: "Founder", production: true }), "founder");
  assert.equal(resolveDashboardEdition({ edition: "founder", plan: "Starter", production: true }), "founder");

  assert.equal(resolveDashboardEditionFromPlan("Standard"), "standard");
  assert.equal(resolveDashboardEditionFromPlan("  inrcy-standard  "), "standard");

  assert.equal(resolveDashboardEditionFromPlan("Trial"), "standard");
  assert.equal(resolveDashboardEditionFromPlan("Founder"), "founder");
  for (const historicPlan of ["Starter", "Accel", "Speed", "Premium"]) {
    assert.equal(resolveDashboardEditionFromPlan(historicPlan), "premium");
  }
  for (const unknownPlan of ["", null, undefined, "valeur-inconnue"]) {
    assert.equal(resolveDashboardEditionFromPlan(unknownPlan), "standard");
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

test("Standard contient exactement onze destinations de publication et iNrBadge en bonus", () => {
  assert.equal(STANDARD_PUBLICATION_CHANNEL_KEYS.length, 11);
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
  assert.match(badgeSettingsSource, /i18nT\("email_de_mon_profil_value_fd93f05f"/);
  assert.match(statsClientSource, /appointmentsEnabled: !standardMode/);
  assert.match(statsFoundationsSource, /appointmentsEnabled\s*\? \{ label: t\("rdv_30j_395436a0"\)/);
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

test("Standard et Premium partagent le même dashboard, avec un adaptateur Standard conservant ses droits", () => {
  assert.match(dashboardClientSource, /<DashboardHero/);
  assert.match(dashboardClientSource, /<DashboardChannelsSection/);
  assert.match(dashboardClientSource, /standardMode=\{isStandardEdition\}/);
  assert.doesNotMatch(dashboardClientSource, /DashboardStandardExperience/);
  assert.match(channelsSectionSource, /standardMode \? \(/);
  assert.match(channelsSectionSource, /<DashboardStandardModulesCard/);
  assert.match(channelsSectionSource, /<DashboardModulesCard/);
  assert.match(standardModulesSource, /\{ onOpenPremium, \.\.\.props \}/);
  assert.match(standardModulesSource, /<DashboardModulesCard \{\.\.\.props\} standardMode openPanel=\{onOpenPremium\}/);
  assert.doesNotMatch(standardModulesSource, /module\.css|<section|<article|useState/);
  assert.match(sharedModulesSource, /const standardMode = standardModeOverride \|\| dashboardEdition === "standard"/);
});

test("Standard conserve les vraies bulles de connexion avec Voir et Configurer", () => {
  assert.match(channelsSectionSource, /<DashboardChannelsModal items=\{fluxBubbleItems\}/);
  assert.match(channelsModalSource, /<DashboardFluxBubble key=\{selected\.key\} item=\{selectedItem!\}/);
  assert.match(channelsModalSource, /const selectedItem = selected \? \{\s*\.\.\.selected,/);
  assert.match(channelsModalSource, /onConfigure: \(\) => \{ closeDialog\(\); selected\.onConfigure\(\); \}/);
  assert.doesNotMatch(channelsModalSource, /(?:configureDisabled|createDisabled|premiumLocked):\s*false/);
  assert.match(dashboardClientSource, /STANDARD_DASHBOARD_BUBBLE_KEYS/);
  assert.match(dashboardClientSource, /STANDARD_BONUS_CHANNEL_KEYS/);
  assert.match(connectionBubbleSource, /item\.viewFallbackLabel \|\| i18nT\("voir_8a754f1f"\)/);
  assert.match(connectionBubbleSource, /item\.configureLabel \|\| i18nT\("configurer_382efbe9"\)/);
  assert.match(connectionBubbleSource, /disabled=\{item\.configureDisabled \|\| configureLoadingVisible\}/);
  assert.match(channelsSectionSource, /fluxBubbleItems\.filter\(\(item\) => getChannelTone\(item\) === "connected"\)\.length/);
  assert.match(channelsSectionSource, /const total = fluxBubbleItems\.length/);
  assert.match(channelsSectionSource, /summary=\{\{ connected, total \}\}/);
});

test("un canal desactive reste gris tandis qu'un canal a connecter garde son etat disponible", () => {
  const channel = (bubbleStatus: Parameters<typeof getChannelTone>[0]["bubbleStatus"], bubbleStatusText: string) => ({
    key: "test", name: "Test", description: "", accent: "blue", logoSrc: "/test.svg", logoAlt: "", bubbleStatus, bubbleStatusText, onConfigure: () => {},
  });
  assert.equal(getChannelTone(channel("coming", "À venir")), "disabled");
  assert.equal(getChannelTone(channel("coming", "Token expiré")), "disabled");
  assert.equal(getChannelTone(channel("available", "À connecter")), "available");
  assert.equal(getChannelTone(channel("connected", "Connecté")), "connected");
  assert.equal(getChannelTone(channel("reconnect", "Connexion requise")), "warning");
  assert.match(channelsModalSource, /const tone = getChannelTone\(item\)/);
  assert.match(channelsModalSource, /styles\.satellite\} \$\{styles\[tone\]\}/);
  assert.match(channelsModalSource, /data-tone=\{getChannelTone\(selected\)\}/);
  assert.match(channelsModalCssSource, /\.disabled\s*\{[^}]*filter: saturate\(\.45\)/);
  assert.match(channelsModalCssSource, /\.disabled \.satelliteStatus\s*\{[^}]*background: #8794ad/);
  assert.match(channelsModalCssSource, /\.available \.satelliteStatus, \.warning \.satelliteStatus\s*\{[^}]*background: #ffc863/);
  assert.match(channelsModalCssSource, /\.selectedBubble\[data-tone="disabled"\] > article\s*\{[^}]*border-color: #9ba7c0/);
});

test("les blocs inférieurs Standard conservent Stats, Publications, Réputation, Booster, iNrAgent et iNrStudio", () => {
  assert.match(sharedModulesSource, /\/dashboard\/stats/);
  assert.match(sharedModulesSource, /path: standardMode \? "\/dashboard\/mails\?folder=publications&boxView=sent" : "\/dashboard\/mails"/);
  assert.match(sharedModulesSource, /description: standardT\("sendDescription"\)/);
  assert.match(sharedModulesSource, /\/dashboard\/e-reputation/);
  assert.match(sharedModulesSource, /onClick=\{openPublishModal\}/);
  assert.match(sharedModulesSource, /data-dashboard-prefetch=\{agentPath\}/);
  assert.match(sharedModulesSource, /signatureStyles\.agentCard/);
  assert.match(sharedModulesSource, /const studioPath = "\/dashboard\/generer-media"/);
  assert.match(sharedModulesSource, /data-testid=\{standardMode \? "standard-studio-open" : "premium-studio-open"\}/);
  assert.match(sharedModulesSource, /data-dashboard-prefetch=\{studioPath\}/);
  assert.match(sharedModulesSource, /signatureStyles\.studioCard/);
  assert.match(dashboardI18nSource, /"boosterCta": "Créer une publication"/);
  assert.match(dashboardI18nSource, /"studioCta": "Studio Médias"/);
  assert.doesNotMatch(standardModulesSource, /dashboard\/crm/);
  assert.doesNotMatch(standardModulesSource, /dashboard\/agenda/);
  assert.doesNotMatch(standardModulesSource, /dashboard\/propulser/);
  assert.doesNotMatch(standardModulesSource, /dashboard\/fideliser/);
  // The adapter cannot introduce its own unlocked routes; the shared renderer
  // checks premiumOnly at both action and prefetch boundaries (tested below).
  assert.match(sharedModulesSource, /signatureStyles\.boosterCard/);
  assert.match(sharedModulesSource, /signatureStyles\.toolButton/);
  assert.match(sharedModulesSource, /startModuleNavigation\("\/dashboard\/adn-entreprise"\)/);
});

test("Standard reprend la même rangée ADS, Studio et Agent, avec Studio et Agent de même largeur", () => {
  assert.match(sharedModulesSource, /data-dashboard-standard-secondary-tools=\{standardMode \? "true" : undefined\}/);
  assert.match(sharedModulesCssSource, /\.creationGrid\s*\{[^}]*grid-template-columns:\s*1\.3fr 1fr 1fr/);
  assert.match(sharedModulesCssSource, /@media \(max-width: 700px\)[\s\S]*?\.creationGrid\s*\{\s*grid-template-columns:\s*1fr 1fr/);
  assert.match(sharedModulesCssSource, /@media \(max-width: 700px\)[\s\S]*?\.adsCard\s*\{\s*grid-column:\s*1 \/ -1/);
  for (const key of ["studioEyebrow", "studioLine1", "studioLine2", "studioCta"]) {
    assert.match(dashboardI18nSource, new RegExp(`"${key}":\\s*"[^"]+"`));
  }
});

test("le raccourci calendrier du bloc iNrAgent réutilise la modale sans dupliquer le bouton Planning", () => {
  const planningTriggers =
    sharedModulesSource.match(/"standard-agent-planning(?:-icon)?"/g) ?? [];

  assert.deepEqual(planningTriggers, ['"standard-agent-planning-icon"']);
  assert.doesNotMatch(
    standardModulesSource,
    /className=\{standardStyles\.agentPlanningButton\}/,
  );
  assert.match(sharedModulesSource, /data-testid=\{standardMode \? "standard-agent-pilotage" : "premium-agent-pilotage"\}/);
  assert.match(sharedModulesSource, /standardT\("agentPlanning"\)/);
  assert.match(sharedModulesSource, /<DashboardAgentPlanningModal[\s\S]*?standardMode=\{standardMode\}/);
  assert.match(
    dashboardAgentPlanningSource,
    /import \{ AgentScheduleModal \} from "\.\/AgentActionModals"/,
  );
  assert.match(dashboardAgentPlanningSource, /<AgentScheduleModal/);
  assert.match(dashboardAgentPlanningSource, /standardMode = true/);
  assert.match(dashboardAgentPlanningSource, /showCampaigns=\{!standardMode\}/);
  assert.match(dashboardAgentPlanningSource, /buildAgentScheduleItems/);
  assert.match(agentClientSource, /buildAgentScheduleItems/);
  assert.match(agentClientSource, /showCampaigns=\{!standardMode\}/);
  assert.match(agentActionModalsSource, /readOnly = false/);
  assert.doesNotMatch(dashboardAgentPlanningSource, /role="dialog"/);
});

test("le planning affiche uniquement les dates actives avec un carrousel local lisible", () => {
  const monthlyAgendaStyles = agentStylesSource.slice(
    agentStylesSource.lastIndexOf("Planning iNrAgent — agenda mensuel"),
  );

  assert.match(agentActionModalsSource, /calendarModel\.slots\.map/);
  assert.match(agentActionModalsSource, /className=\{styles\.scheduleDayEmpty\}/);
  assert.match(agentActionModalsSource, /data-has-actions="true"/);
  assert.match(agentActionModalsSource, /role="listitem"/);
  assert.match(agentActionModalsSource, /styles\.scheduleDayCarouselControls/);
  assert.match(
    agentActionModalsSource,
    /activeDayCarouselIndex \+ 1\}\/{dayGroups\.length\}/,
  );
  assert.match(agentActionModalsSource, /styles\.scheduleDayDate/);
  assert.match(agentActionModalsSource, /styles\.scheduleIconButtonLabel/);
  assert.match(monthlyAgendaStyles, /grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(monthlyAgendaStyles, /\.scheduleWeekday,\s*\.scheduleDayEmpty\s*\{\s*display:\s*none/);
  assert.match(
    monthlyAgendaStyles,
    /@media \(max-width: 760px\)[\s\S]*?\.scheduleCalendar\s*\{[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/,
  );
});

test("le planning conserve Modifier et Reprogrammer dans la vue de consultation", () => {
  assert.match(dashboardAgentPlanningSource, /readOnly/);
  assert.match(
    agentActionModalsSource,
    /data-schedule-action="edit"[\s\S]*?data-schedule-action="reschedule"[\s\S]*?\{!readOnly \? \([\s\S]*?data-schedule-action="delete"/,
  );
  assert.match(agentActionModalsSource, /onClick=\{\(\) => onOpenContent\(item\)\}/);
  assert.match(agentActionModalsSource, /onClick=\{\(\) => onReschedule\(item\)\}/);
});

test("le CTA Booster Standard reste accessible quel que soit l'état du profil", () => {
  assert.match(channelsSectionSource, /<DashboardStandardModulesCard/);
  assert.match(sharedModulesSource, /data-testid=\{standardMode \? "standard-booster-publish" : "premium-booster-publish"\}/);
  assert.match(sharedModulesSource, /onClick=\{openPublishModal\}/);
  assert.match(sharedModulesSource, /disabled=\{isVisible\("modal:publish"\)\}/);
  assert.doesNotMatch(sharedModulesSource, /RequiredSetupLock|requiredSetupLocked/);
  assert.doesNotMatch(channelsSectionSource, /requiredSetupLockVisible/);
});

test("le tableau Standard montre tous les outils Premium, mais verrouille ceux qui demandent Premium", () => {
  assert.match(sharedModulesSource, /path: "\/dashboard\/agenda"[^\n]*premiumOnly: true/);
  assert.match(sharedModulesSource, /path: "\/dashboard\/crm"[^\n]*premiumOnly: true/);
  assert.match(sharedModulesSource, /data-dashboard-prefetch=\{standardMode && tool\.premiumOnly \? undefined : tool\.path\}/);
  assert.match(sharedModulesSource, /onClick=\{standardMode && tool\.premiumOnly \? \(\) => startPanelOpening\("abonnement"\)/);
  assert.match(standardModulesSource, /onOpenPremium/);
  assert.match(sharedModulesSource, /onClick=\{\(\) => startPanelOpening\(standardMode \? "abonnement" : tool\.panel!\)\}/);
  assert.match(sharedModulesSource, /\{tool\.panel && \(!standardMode \|\| tool\.premiumOnly\) \? \(/);
  assert.match(sharedModulesSource, /standardMode && tool\.premiumOnly \? <><DashboardPremiumLockIcon \/>\{t\.modules\.campaignsPremiumLabel\}/);
  assert.match(sharedModulesSource, /const openCampaignModal = \(\) => \{\s*if \(standardMode\) \{\s*startPanelOpening\("abonnement"\);\s*return;/);
  assert.match(sharedModulesSource, /!standardMode && campaignModalOpen \?/);
  assert.match(sharedModulesSource, /data-testid=\{standardMode \? "standard-campaign-mails" : "premium-campaign-open"\}/);
  assert.match(sharedModulesSource, /adsPilotEnabled \? \(standardMode \? "standard-campaign-ads" : "premium-campaign-ads"\) : "campaign-ads-coming-soon"/);
  assert.match(sharedModulesSource, /disabled=\{!adsPilotEnabled \|\| isModuleLoadingVisible\("\/dashboard\/ads"\)\}/);
  assert.match(campaignChoicesSource, /data-testid=\{locked \? "standard-campaign-mails"/);
  assert.match(campaignChoicesSource, /data-testid=\{adsComingSoon \? "campaign-ads-coming-soon" : locked \? "standard-campaign-ads"/);
  assert.match(campaignChoicesSource, /DashboardPremiumLockIcon/);
  assert.match(campaignChoicesSource, /locked \? <>\<DashboardPremiumLockIcon \/>\{premiumLabel\}<\/>/);
  assert.match(campaignChoicesSource, /adsComingSoon \? <>À venir<\/>/);
  assert.doesNotMatch(standardModulesSource, /lockedToolHint/);
  assert.doesNotMatch(campaignChoicesSource, /campaignPremiumHint/);
  assert.doesNotMatch(sharedModulesCssSource, /\.lockedToolHint|\.campaignPremiumHint/);
  assert.match(fluxBubblesSource, /const mailPremiumLocked = standardMode && m\.key === "mails";/);
  assert.match(fluxBubblesSource, /premiumLocked: mailPremiumLocked/);
  assert.match(fluxBubblesSource, /premiumLabel: copy\.modules\.campaignsPremiumLabel/);
  assert.match(fluxBubblesSource, /openPanel\("abonnement"\)/);
  assert.match(fluxBubbleSource, /item\.premiumLocked/);
  assert.match(fluxBubbleSource, /DashboardPremiumLockIcon/);
  // The old channel pill was removed; the selected real bubble still owns the Premium lock.
  assert.match(channelsSectionSource, /<DashboardChannelsModal items=\{fluxBubbleItems\}/);
  assert.match(channelsModalSource, /const selectedItem = selected \? \{\s*\.\.\.selected,/);
  assert.match(channelsModalSource, /<DashboardFluxBubble key=\{selected\.key\} item=\{selectedItem!\}/);
  assert.doesNotMatch(channelsModalSource, /premiumLocked:\s*false/);
  assert.match(fluxBubbleSource, /\{item\.premiumLocked \? \([\s\S]*?DashboardPremiumLockIcon/);
  assert.match(fluxBubbleSource, /\{!item\.premiumLocked \? \(/);
});

test("le Bilan Booster reste distinct de iNrStats et ouvre la modale historique Booster", () => {
  assert.match(sharedModulesSource, /onClick=\{openBoosterSummary\}/);
  assert.match(sharedModulesSource, /standardT\("boosterSummary"\)/);
  assert.match(dashboardI18nSource, /"boosterSummary": "Bilan"/);
  assert.doesNotMatch(sharedModulesSource, /href="\/dashboard\/stats"[\s\S]{0,240}Bilan/);
  assert.match(boosterModalLayerSource, /aria-label=\{i18nT\("bilan_booster_f20fce08"\)\}/);
  assert.match(boosterModalLayerSource, /i18nT\("bilan_a80c4623"\)/);
  assert.match(boosterI18nSource, /"bilan_booster_f20fce08": "Bilan Booster"/);
  assert.match(boosterI18nSource, /"bilan_a80c4623": "Bilan"/);
  assert.doesNotMatch(boosterModalLayerSource, />\s*Bilan Booster\s*<\/span>/);
  assert.doesNotMatch(boosterModalLayerSource, /Statistiques Booster/);
});

test("le cockpit reflète le parcours communication et les bilans utilisent le bon pluriel", () => {
  assert.match(dashboardI18nSource, /"flowContacts": "Publications"/);
  assert.match(dashboardI18nSource, /"flowQuotes": "Visibilité"/);
  assert.match(dashboardI18nSource, /"flowRevenue": "Résultats"/);
  assert.match(
    dashboardI18nSource,
    /"generatorDesc": "Le reflet de l’efficacité de vos canaux de communication\."/,
  );
  assert.doesNotMatch(
    dashboardI18nSource,
    /Production de prospects et de clients dès qu.un module est connecté/,
  );
  assert.doesNotMatch(publicationResultModalSource, /canal\$\{[^\n]*"aux/);
  assert.match(publicationResultModalSource, /"canaux traités"/);
});

test("les cartes Premium conservent leurs couleurs propres sans assombrissement global final", () => {
  for (const className of [
    "loop_cyan",
    "loop_purple",
    "loop_pink",
    "loop_orange",
    "gear_cyan",
    "gear_purple",
    "gear_pink",
    "gear_orange",
  ]) {
    assert.match(dashboardCssSource, new RegExp(`\\.${className}\\s*\\{`));
  }
  assert.match(dashboardCssSource, /\.loopWrap\s*\{[\s\S]*rgba\(var\(--cockpit-cyan\), 0\.06\)/);
  assert.match(dashboardCssSource, /\.gearWrap\s*\{[\s\S]*rgba\(var\(--cockpit-violet\), 0\.14\)/);
  assert.doesNotMatch(dashboardCssSource, /Finition lumière Premium/);
});

test("Mon inertie Standard n'active que Booster et identifie les missions Premium", () => {
  assert.match(inertiaContentSource, /i18nT\("booster_est_votre_mission_active_les_93914a0a"\)/);
  assert.match(inertiaContentSource, /premiumOnly: edition === "standard"/);
  assert.match(inertiaContentSource, /i18nT\("forfait_premium_65aaf9d2"\)/);
  assert.match(inertiaContentSource, /PREMIUM_INERTIA_ACTION_KEYS\.has\(e\.action_key\)/);
  assert.match(dashboardHelpModalsSource, /edition === "standard" && row\.premiumOnly/);
  assert.match(dashboardHelpModalsSource, /i18nT\("forfait_premium_65aaf9d2"\)/);
  assert.match(loyaltyAwardApiSource, /dashboardEdition === "standard" && PREMIUM_ONLY_ACTION_KEYS\.has\(actionKey\)/);
  assert.match(loyaltySummaryApiSource, /includePremiumMissions: dashboardEdition !== "standard"/);
});

test("le GPS Standard adapte les rubriques mixtes et affiche les outils Premium en aperçu", () => {
  for (const sectionId of ["propulser", "fideliser", "crm", "agenda", "documents"]) {
    assert.match(gpsEditionPolicySource, new RegExp(`"${sectionId}"`));
  }
  assert.match(gpsEditionPolicySource, /programmer_les_publications_booster_et_recevoir_2e05ae9b/);
  assert.equal(
    gpsI18n.programmer_les_publications_booster_et_recevoir_2e05ae9b,
    "Programmer les publications Booster et recevoir les bilans automatiques iNr’Stats.",
  );
  assert.ok(Object.values(gpsI18n).some((message) => message.includes("colonne **Publications**")));
  assert.ok(Object.values(gpsI18n).some((message) => message.includes("données des canaux Standard")));
  assert.ok(Object.values(gpsI18n).some((message) => message.includes("Bilan Booster")));
  assert.match(gpsClientSource, /selectedSectionPremium/);
  assert.match(gpsClientSource, /i18nT\("nous_contacter_pour_premium_149750a6"\)/);
  assert.equal(gpsI18n.nous_contacter_pour_premium_149750a6, "Nous contacter pour Premium");
  assert.match(gpsClientSource, /styles\.premiumBadge/);
});

test("les écrans Premium sont refusés tandis que les outils Standard et iNrAgent limité restent accessibles", () => {
  for (const path of [
    "/dashboard",
    "/dashboard/agent",
    "/dashboard/stats",
    "/dashboard/mails",
    "/dashboard/e-reputation",
    "/dashboard/generer-media",
  ]) {
    assert.equal(isStandardDashboardRouteAllowed(path), true, path);
  }

  for (const path of [
    "/dashboard/ads",
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
    "/api/agent/actions/regenerate-channel",
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
  assert.equal(
    isStandardApiRouteAllowed("/api/agent/actions/future-standard-capability"),
    true,
    "une nouvelle fonction iNrAgent ne doit pas devenir Premium par omission",
  );
  assert.equal(isStandardApiRouteAllowed("/api/templates/render"), false);
  assert.equal(isStandardApiRouteAllowed("/api/templates/generate-ai"), false);
  assert.equal(isStandardApiRouteAllowed("/api/inrstats/mails"), false);

  assert.match(agentClientSource, /visibleAutomations/);
  assert.match(agentClientSource, /isStandardAgentAutomationKey/);
  assert.match(agentClientSource, /standardMode\s*&&[\s\S]{0,80}?settingsAutomation\.key === "stats"\s*&&[\s\S]{0,80}?theme === "Mails"/);
  assert.match(agentClientSource, /standardMode && theme === "Mails"/);
  assert.match(agentSettingsApiSource, /standardAgentAutomationKeysForPersistence/);
  assert.match(agentCronSource, /reason: "premium_required"/);
  assert.match(scheduledAgentCronSource, /status: "cancelled"/);
});

test("les fonctions Standard récentes restent accessibles de bout en bout", () => {
  const standardSurfaces = [
    "/dashboard/agent",
    "/dashboard/adn-entreprise",
    "/dashboard/booster/publier",
    "/dashboard/generer-media",
    "/dashboard/mediatheque",
  ];
  for (const path of standardSurfaces) {
    assert.equal(isStandardDashboardRouteAllowed(path), true, path);
  }

  const standardApis = [
    // iNrAgent Publications / Statistiques
    "/api/agent/actions/prepare-publish",
    "/api/agent/actions/regenerate-channel",
    "/api/agent/actions/send-stats-report",
    "/api/agent/actions/schedule",
    "/api/agent/actions/execute",
    "/api/agent/scheduled-actions/123/execute",
    // iNrADN, y compris les documents de référence ajoutés récemment
    "/api/ai-memory",
    "/api/ai-memory/analyze-channels",
    "/api/ai-memory/documents",
    // Booster / Publier et ses dépendances média / réseaux
    "/api/booster/connected-channels",
    "/api/booster/cta-defaults",
    "/api/booster/events",
    "/api/booster/generate",
    "/api/booster/publish-now",
    "/api/booster/transcribe",
    "/api/booster/upload-prepared",
    "/api/booster/video-upload-url",
    "/api/integrations/channel-states",
    "/api/integrations/status",
    "/api/integrations/x/status",
    "/api/media-generation/generate",
    "/api/media-generation/normalize-reference",
    "/api/media-generation/preferences",
    "/api/media-generation/quota",
    "/api/media-library/upload",
    "/api/media-pipeline/upload-intent",
  ];
  for (const path of standardApis) {
    assert.equal(isStandardApiRouteAllowed(path), true, path);
  }

  for (const premiumPath of [
    "/api/ads/accounts",
    "/api/ads/campaigns",
    "/api/ads/campaigns/123/publish",
    "/api/ads/generate",
    "/api/ads/oauth/meta/start",
    "/api/agent/actions/prepare-campaign",
    "/api/crm/contacts",
    "/api/propulser/campaigns",
    "/api/fideliser/campaigns",
  ]) {
    assert.equal(isStandardApiRouteAllowed(premiumPath), false, premiumPath);
  }
});

test("iNr’Agent retire un canal, refuse le dernier et garde un pupitre responsive lisible", () => {
  assert.match(agentClientSource, /editType: "remove_publish_channel"/);
  assert.match(agentClientSource, /styles\.removePublishChannelButton/);
  assert.match(agentClientSource, /styles\.publishMobileStatus/);
  assert.match(agentClientSource, /remove_publication_last_channel/);
  assert.match(
    agentClientSource,
    /if \(preparedChannels\.length <= 1\) \{\s*await updateActionStatus\("refused"\);/,
  );
  assert.match(agentScheduleSource, /removeScheduledEditPublishChannel/);

  assert.match(agentActionsApiSource, /editType === "remove_publish_channel"/);
  assert.match(agentActionsApiSource, /\.eq\("user_id", activeUserId\)/);
  assert.match(agentActionsApiSource, /currentChannels\.length <= 1/);
  assert.match(agentActionsApiSource, /status: "refused"/);
  assert.match(agentActionsApiSource, /publicationRefused: true/);
  assert.match(agentActionsApiSource, /target_channels: remainingTargetChannels/);

  assert.match(agentStylesSource, /"save edit remove"/);
  assert.match(agentStylesSource, /"status status status"/);
  assert.match(
    agentStylesSource,
    /\.previewMetaPublish \.channelScroller button \{[\s\S]*?width: 32px !important;/,
  );
});

test("le compteur de publication desktop est dans Statut et le pupitre réserve la place à la date", () => {
  assert.match(
    agentClientSource,
    /styles\.publishInfoStatus[\s\S]*?styles\.publishStatusHeading[\s\S]*?styles\.publishStatusCounter[\s\S]*?publishValidationLabel/,
  );
  assert.doesNotMatch(agentClientSource, /styles\.publishPostCounter/);
  assert.doesNotMatch(agentClientSource, /\+ \{Math\.max\(0, selectedPublicationIndex\)/);
  assert.match(
    agentStylesSource,
    /\.publishInfoStatus \.publishStatusHeading \{[\s\S]*?justify-content: space-between;/,
  );
  assert.match(
    agentStylesSource,
    /\.previewMetaPublish \.channelScrollerWrapPublish \{[\s\S]*?width: min\(100%, 380px\) !important;/,
  );
  assert.match(
    agentStylesSource,
    /\.previewMetaPublish \.channelNavArrow \{[\s\S]*?width: 28px !important;/,
  );
  assert.match(
    agentStylesSource,
    /\.automationGrid \.automationCard \.cardPendingCount::after,[\s\S]*?content: none !important;/,
  );
  assert.match(
    agentStylesSource,
    /button\[data-channel="linkedin"\][\s\S]*?img\.channelLogoLinkedin \{[\s\S]*?width: 32px !important;[\s\S]*?max-height: 32px !important;/,
  );
  assert.doesNotMatch(
    agentStylesSource,
    /img\.channelLogoLinkedin \{[\s\S]{0,180}?width: 18px !important;/,
  );
});

test("les réglages iNr’Agent restent entièrement accessibles sur mobile", () => {
  assert.match(agentClientSource, /styles\.automationSettingsModal/);
  assert.match(
    agentStylesSource,
    /\.automationSettingsModal \{[\s\S]*?padding-bottom: calc\(84px \+ env\(safe-area-inset-bottom\)\)/,
  );
  assert.match(
    agentStylesSource,
    /grid-template-areas:\s*"heading close"\s*"heading switch"/,
  );
  assert.match(
    agentStylesSource,
    /\.automationSettingsModal \.settingsModalHeaderActions \{\s*display: contents !important;/,
  );
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
  assert.equal(
    isStandardApiRouteAllowed(
      "/api/inrsend/history",
      new URLSearchParams("folder=publications&boxView=drafts"),
    ),
    true,
  );
  assert.equal(
    isStandardApiRouteAllowed(
      "/api/inrsend/history",
      new URLSearchParams("folder=publications&boxView=unknown"),
    ),
    false,
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

test("iNrSend Standard donne accès aux brouillons de Publications et conserve la vue", () => {
  assert.match(
    inrSendToolbarSource,
    /onBoxViewChange\(boxView === "drafts" \? "sent" : "drafts"\)/,
  );
  assert.match(inrSendToolbarSource, /aria-pressed=\{boxView === "drafts"\}/);
  assert.doesNotMatch(
    inrSendToolbarSource,
    /\{!publicationOnly \? \(\s*<button[\s\S]{0,300}draftsToggleBtn/,
  );
  assert.match(
    inrSendClientSource,
    /requestedBoxView === "drafts" \? "drafts" : "sent"/,
  );
  assert.match(
    inrSendClientSource,
    /params\.set\("countsOnly", "1"\);\s*params\.set\("folder", context\.folder\);\s*params\.set\("boxView", context\.boxView\);/,
  );
});

test("Mon compte affiche les identifiants puis le forfait et renvoie vers Mon abonnement", () => {
  const professionalInfoPosition = accountContentSource.indexOf("<div style={card}>");
  const subscriptionPosition = accountContentSource.indexOf('i18nT("votre_forfait_6d06f631")');

  assert.notEqual(professionalInfoPosition, -1);
  assert.notEqual(subscriptionPosition, -1);
  assert.ok(professionalInfoPosition < subscriptionPosition);
  assert.doesNotMatch(accountContentSource, /StandardSubscriptionContent/);
  assert.doesNotMatch(accountContentSource, /\/api\/billing\//);
  assert.match(accountContentSource, /i18nT\("voir_mon_abonnement_d5b2da25"\)/);
  assert.match(settingsDrawerSource, /onOpenSubscription=\{\(\) => openPanel\("abonnement"\)\}/);
  assert.match(settingsDrawerSource, /panel === "abonnement"/);
  assert.match(settingsDrawerSource, /<StandardSubscriptionContent/);
  assert.match(settingsDrawerSource, /<AbonnementContent mode="drawer"/);
  assert.match(subscriptionContentSource, /<SubscriptionPlanFeatures edition="premium"/);
  assert.match(
    readFileSync(new URL("../../app/dashboard/settings/_components/SubscriptionComparison.tsx", import.meta.url), "utf8"),
    /\["ADS", t\("subscription_multichannel_ads"\)\]/,
  );
  const settingsCatalogue = JSON.parse(readFileSync(new URL("../../messages/fr-FR/settings.json", import.meta.url), "utf8"));
  assert.equal(settingsCatalogue.subscription_multichannel_ads, "Publicités multiplateformes");
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

  assert.match(adminUsersApiSource, /ALLOWED_PLANS/);
  assert.match(adminUsersApiSource, /"Founder"/);
  assert.match(adminUsersApiSource, /plan: requestedPlan/);
  assert.match(adminUsersClientSource, /Plan iNrCy/);
  assert.match(adminUsersClientSource, /plan: event\.target\.value/);
});
