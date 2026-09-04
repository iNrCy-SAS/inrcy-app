import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (relativePath: string) =>
  readFileSync(resolve(ROOT, relativePath), "utf8");

test("le planning iNrAgent est un calendrier par quinzaine avec les actions conservées", () => {
  const modal = read("app/dashboard/agent/_components/AgentActionModals.tsx");
  const styles = read("app/dashboard/agent/agent.module.css");
  const scheduleModalSource = modal.slice(
    modal.indexOf("export function AgentScheduleModal"),
    modal.indexOf("type ValidationChoiceModalProps")
  );
  const finalScheduleStyles = styles.slice(
    styles.indexOf("Agenda iNrCy — disposition finale desktop et grille mobile")
  );

  assert.match(modal, /function groupScheduleItems/);
  assert.match(modal, /const \[visibleHalf, setVisibleHalf\]/);
  assert.match(modal, /const justOpened = open && !wasOpenRef\.current/);
  assert.match(modal, /if \(!justOpened\) return/);
  assert.match(modal, />\s*1–15\s*<\/button>/);
  assert.match(modal, />\s*16–\{calendarModel\.lastDay\}\s*<\/button>/);
  assert.match(modal, /moveMonth\(-1\)/);
  assert.match(modal, /moveMonth\(1\)/);
  assert.match(modal, /role="grid"/);
  assert.match(modal, /onOpenContent\(item\)/);
  assert.match(modal, /onReschedule\(item\)/);
  assert.match(modal, /onDelete\(item\)/);
  assert.match(modal, /type="checkbox"/);
  assert.match(modal, /data-category=\{category\}/);
  assert.match(modal, /scheduleApprovalIndicator/);
  assert.match(modal, /data-state=\{approvalState\}/);
  assert.match(
    modal,
    /scheduleFilterKey\(item\) === "stats" \|\| item\.source === "manual"/
  );
  assert.match(modal, /<svg\s+viewBox="0 0 24 24"/);
  assert.match(modal, /item\.statusKey === "cancelled"/);
  assert.match(modal, /item\.statusKey === "refused"/);
  assert.match(scheduleModalSource, /scheduleHeaderPeriodControls/);
  assert.match(scheduleModalSource, /scheduleCalendarCardControls/);
  assert.match(scheduleModalSource, /scheduleCalendarCardMeta/);
  assert.match(scheduleModalSource, /scheduleCalendarChannels/);
  assert.doesNotMatch(scheduleModalSource, /scheduleCalendarToolbar/);
  assert.doesNotMatch(scheduleModalSource, /actions_sur_la_periode/);
  assert.doesNotMatch(scheduleModalSource, /styles\.modalEyebrow/);
  assert.doesNotMatch(scheduleModalSource, /<span>\{item\.typeLabel\}<\/span>/);
  assert.doesNotMatch(scheduleModalSource, /🕘/);
  assert.ok(
    scheduleModalSource.indexOf("onOpenContent(item)") <
      scheduleModalSource.indexOf("onReschedule(item)")
  );
  assert.ok(
    scheduleModalSource.indexOf("onReschedule(item)") <
      scheduleModalSource.indexOf("onDelete(item)")
  );
  assert.ok(
    scheduleModalSource.indexOf("onDelete(item)") <
      scheduleModalSource.indexOf("styles.scheduleApprovalIndicator")
  );
  assert.match(styles, /\.scheduleCalendar\s*\{/);
  assert.match(styles, /grid-template-columns:\s*repeat\(7,/);
  assert.match(styles, /\.scheduleCalendarCard\s*\{/);
  assert.match(styles, /\.scheduleFilters\s*\{/);
  assert.match(styles, /\.scheduleFilter\[data-filter="campaigns"\]/);
  assert.match(styles, /\.scheduleCalendarCard\[data-category="stats"\]/);
  assert.match(styles, /\.scheduleApprovalIndicator\[data-state="approved"\]/);
  assert.match(styles, /\.scheduleApprovalIndicator\[data-state="pending"\]/);
  assert.match(styles, /\.scheduleApprovalIndicator\[data-state="refused"\]/);
  assert.match(styles, /\.scheduleCalendarCard\[data-approval="refused"\]/);
  assert.match(finalScheduleStyles, /width:\s*min\(1680px,/);
  assert.match(finalScheduleStyles, /height:\s*min\(94dvh, 1040px\)/);
  assert.match(finalScheduleStyles, /grid-auto-rows:\s*206px/);
  assert.match(finalScheduleStyles, /height:\s*206px/);
  assert.match(finalScheduleStyles, /height:\s*140px/);
  assert.match(
    finalScheduleStyles,
    /\.modalBackdrop:has\(\.scheduleModal\)\s*\{\s*padding:\s*8px 14px;/
  );
  assert.match(
    finalScheduleStyles,
    /height:\s*min\(calc\(100dvh - 16px\), 1160px\) !important;/
  );
  assert.match(
    finalScheduleStyles,
    /grid-template-columns:\s*repeat\(3, minmax\(0, 1fr\)\)/
  );
  assert.match(finalScheduleStyles, /grid-auto-rows:\s*164px/);
  assert.match(
    finalScheduleStyles,
    /\.scheduleCalendarCardTopline\s*\{\s*display:\s*contents;/
  );
  assert.match(finalScheduleStyles, /grid-auto-rows:\s*140px/);
  assert.match(
    finalScheduleStyles,
    /@media \(min-width: 1101px\)[\s\S]*?\.scheduleDayActions\s*\{[\s\S]*?display:\s*flex;[\s\S]*?overflow-x:\s*auto;/
  );
  assert.match(
    finalScheduleStyles,
    /\.scheduleDayActions > \.scheduleCalendarCard\s*\{[\s\S]*?flex:\s*0 0 calc\(\(100% - 6px\) \/ 2\);/
  );
  assert.match(
    finalScheduleStyles,
    /@media \(max-width: 760px\)[\s\S]*?\.scheduleCalendarCardTopline > \.scheduleCalendarCardControls\s*\{[\s\S]*?flex-direction:\s*row;/
  );
  assert.match(finalScheduleStyles, /height:\s*56px/);
  assert.match(
    finalScheduleStyles,
    /\.scheduleWeekday,\s*\.scheduleDayEmpty\s*\{\s*display:\s*none;/
  );
  assert.match(finalScheduleStyles, /overflow-x:\s*hidden/);
  assert.match(
    styles,
    /\.modalBackdrop\s*\{[\s\S]*?--inrcy-mobile-bottom-nav-total-height/
  );
  assert.match(
    finalScheduleStyles,
    /@media \(max-width: 760px\)[\s\S]*?\.scheduleModal\s*\{[\s\S]*?height:\s*100% !important;/
  );
});

test("le rafraîchissement du planning conserve la quinzaine choisie et masque les campagnes en Standard", () => {
  const modal = read("app/dashboard/agent/_components/AgentActionModals.tsx");
  const client = read("app/dashboard/agent/AgentClient.tsx");
  const dashboardPlanning = read(
    "app/dashboard/agent/_components/DashboardAgentPlanningModal.tsx"
  );
  const scheduleModalSource = modal.slice(
    modal.indexOf("export function AgentScheduleModal"),
    modal.indexOf("type ValidationChoiceModalProps")
  );

  assert.match(scheduleModalSource, /const justOpened = open && !wasOpenRef\.current/);
  assert.match(scheduleModalSource, /if \(!justOpened\) return/);
  assert.ok(
    scheduleModalSource.indexOf("if (!justOpened) return") <
      scheduleModalSource.indexOf("setVisibleHalf("),
    "la quinzaine ne doit être réinitialisée qu'à l'ouverture de la modale"
  );
  assert.match(scheduleModalSource, /showCampaigns = true/);
  assert.match(scheduleModalSource, /scheduleFilterKey\(item\) !== "campaigns"/);
  assert.match(client, /showCampaigns=\{!standardMode\}/);
  assert.match(dashboardPlanning, /showCampaigns=\{!standardMode\}/);
});

test("les libellés de filtres et de validation du planning existent dans toutes les langues", () => {
  const locales = [
    "de-DE",
    "en-GB",
    "es-ES",
    "fr-FR",
    "it-IT",
    "nl-NL",
    "pt-PT",
    "th-TH",
    "zh-CN",
  ];
  const requiredKeys = [
    "planning_filter_label",
    "planning_filter_publications",
    "planning_filter_stats",
    "planning_filter_campaigns",
    "planning_filter_empty",
    "planning_status_approved",
    "planning_status_pending",
    "planning_status_refused",
    "publication_validation_pending",
    "previous_publication",
    "next_publication",
  ];

  for (const locale of locales) {
    const messages = JSON.parse(read(`messages/${locale}/agent.json`));
    for (const key of requiredKeys) {
      assert.equal(typeof messages[key], "string", `${locale}: ${key}`);
      assert.ok(
        messages[key].trim().length > 0,
        `${locale}: ${key} ne doit pas être vide`
      );
    }
  }
});

test("les fréquences 1 à 3 fois par semaine ou par mois traversent tout le contrat", () => {
  const contract = read("lib/inrAgentSettings.ts");
  const config = read("app/dashboard/agent/_lib/agent.config.ts");
  const settingsRoute = read("app/api/agent/settings/route.ts");
  const cron = read("app/api/cron/inr-agent/route.ts");
  const migration = read(
    "ops/sql/2026-09-02_inr_agent_extended_publication_frequencies.sql"
  );

  for (const frequency of [
    "twice_weekly",
    "three_times_weekly",
    "biweekly",
    "three_times_monthly",
  ]) {
    for (const source of [contract, config, settingsRoute, cron, migration]) {
      assert.ok(
        source.includes(frequency),
        `${frequency} doit rester pris en charge`
      );
    }
  }
  assert.match(config, /2 fois par mois/);
  assert.match(config, /3 fois par mois/);
  assert.match(cron, /normalizeInrAgentMonthDays/);
  assert.match(cron, /isInrAgentScheduledMonthDay/);
  assert.match(cron, /inrAgentMonthlyOccurrenceIndex/);
  assert.match(cron, /scheduleSlots/);
});

test("le compteur du planning exclut les actions passées et hors quinzaine", () => {
  const modal = read("app/dashboard/agent/_components/AgentActionModals.tsx");
  const scheduleModalSource = modal.slice(
    modal.indexOf("export function AgentScheduleModal"),
    modal.indexOf("type ValidationChoiceModalProps")
  );

  assert.match(scheduleModalSource, /const visiblePeriodItems = useMemo/);
  assert.match(scheduleModalSource, /date\.getTime\(\) >= nowTimestamp/);
  assert.match(scheduleModalSource, /setNowTimestamp\(Date\.now\(\)\)/);
  assert.match(scheduleModalSource, /date\.getMonth\(\) === month/);
  assert.match(scheduleModalSource, /const filterCounts = useMemo/);
  assert.match(scheduleModalSource, /\[visiblePeriodItems\]/);
});

test("les fréquences mensuelles stockent des dates numériques et non des jours de semaine", () => {
  const helper = read("lib/inrAgentMonthSchedule.ts");
  const settings = read("app/dashboard/agent/_lib/agent.settings.ts");
  const client = read("app/dashboard/agent/AgentClient.tsx");
  const settingsRoute = read("app/api/agent/settings/route.ts");
  const cron = read("app/api/cron/inr-agent/route.ts");

  assert.match(helper, /1:\s*\[10\]/);
  assert.match(helper, /2:\s*\[10, 20\]/);
  assert.match(helper, /3:\s*\[10, 20, 30\]/);
  assert.match(settings, /monthDays:/);
  assert.match(client, /settingsMonthlyDateCount/);
  assert.match(client, /updateConfigMonthDay/);
  assert.match(client, /Array\.from\(\{ length: 31 \}/);
  assert.match(settingsRoute, /metadata\?\.monthDays/);
  assert.match(cron, /asRecord\(row\.metadata\)\.monthDays/);
});

test("iNrAgent construit seul une publication contextualisée et utilise les quotas du Studio", () => {
  const publishRoute = read("app/api/agent/actions/prepare-publish/route.ts");
  const mediaGeneration = read("lib/inrAgentMediaGeneration.ts");
  const chooseThemeSource = publishRoute.slice(
    publishRoute.indexOf("function chooseTheme"),
    publishRoute.indexOf("function normalizeCatalogText")
  );

  assert.match(publishRoute, /getBoosterGenerationContext/);
  assert.match(
    publishRoute,
    /chooseTheme\(automation\.allowedThemes, recentPublications\)/
  );
  assert.match(publishRoute, /recentTopics/);
  assert.match(publishRoute, /angle nettement différent/);
  assert.doesNotMatch(chooseThemeSource, /Math\.random/);
  assert.match(publishRoute, /automation\.preferredMediaSource/);
  assert.match(publishRoute, /loadRecentMediaUsage/);
  assert.match(publishRoute, /generateInrAgentMedia/);
  assert.match(publishRoute, /generateBoosterPosts/);
  assert.match(publishRoute, /mediaReadinessByChannel/);

  assert.match(mediaGeneration, /reserveAiMediaGeneration/);
  assert.match(mediaGeneration, /completeAiMediaGeneration/);
  assert.match(mediaGeneration, /failAiMediaGeneration/);
  assert.match(mediaGeneration, /subjectSource: "custom"/);
  assert.match(mediaGeneration, /idea: args\.idea/);
  assert.match(mediaGeneration, /withText: false/);
  assert.match(mediaGeneration, /source: "inr_agent"/);
});

test("l'espace Publier garde le média, la navigation et les commandes dans un cockpit lisible", () => {
  const client = read("app/dashboard/agent/AgentClient.tsx");
  const styles = read("app/dashboard/agent/agent.module.css");

  assert.match(client, /publicationCarouselActions/);
  assert.match(client, /startPublicationSwipe/);
  assert.match(client, /movePublication\(-1\)/);
  assert.match(client, /movePublication\(1\)/);
  assert.match(client, /data-has-media=\{Boolean\(publishMediaPreview\?\.url\)\}/);
  assert.match(client, /className=\{styles\.publishInlineMedia\}/);
  assert.match(client, /className=\{styles\.publishCtaStandalone\}/);
  assert.match(client, /className=\{styles\.agentCommandRailIdentity\}/);
  assert.doesNotMatch(client, /robotStepsByAutomation/);
  assert.match(
    styles,
    /\.publishPostCard\[data-has-media="true"\][\s\S]*?grid-template-columns:\s*minmax\(230px, 34%\) minmax\(0, 1fr\)/,
  );
  assert.match(styles, /\.publishInlineMediaStage img,[\s\S]*?object-fit:\s*contain/);
  assert.match(styles, /\.previewMetaPublish \.channelNavArrow:hover:not\(:disabled\)/);
  assert.match(styles, /\.automationGridStandard\s*\{\s*grid-template-rows:\s*270px repeat\(2, 68px\)/);
});
