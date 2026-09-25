import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (relativePath: string) =>
  readFileSync(resolve(ROOT, relativePath), "utf8");

test("le planning iNrAgent est un agenda mensuel avec un carrousel par date", () => {
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
  assert.match(modal, /const visibleMonthItems = useMemo/);
  assert.match(modal, /const \[activeDayCarouselIndexes, setActiveDayCarouselIndexes\]/);
  assert.match(modal, /const justOpened = open && !wasOpenRef\.current/);
  assert.match(modal, /if \(!justOpened\) return/);
  assert.doesNotMatch(scheduleModalSource, />\s*1–15\s*<\/button>/);
  assert.doesNotMatch(scheduleModalSource, />\s*16–/);
  assert.match(modal, /moveMonth\(-1\)/);
  assert.match(modal, /moveMonth\(1\)/);
  assert.match(scheduleModalSource, /calendarModel\.slots\.map/);
  assert.match(
    scheduleModalSource,
    /Array\.from\(\{ length: Math\.max\(0, 16 - days\.length\) \}/
  );
  assert.match(scheduleModalSource, /const hasCalendarOverflow = calendarModel\.days\.length > 16/);
  assert.match(scheduleModalSource, /role="list"/);
  assert.match(scheduleModalSource, /role="listitem"/);
  assert.match(scheduleModalSource, /scheduleDayCarouselControls/);
  assert.match(scheduleModalSource, /disabled=\{!hasDayCarousel\}/);
  assert.match(scheduleModalSource, /styles\.scheduleDayOrigin/);
  assert.match(scheduleModalSource, /styles\.scheduleCalendarMediaBadge/);
  assert.match(
    scheduleModalSource,
    /\.slice\(\s*activeDayCarouselIndex,\s*activeDayCarouselIndex \+ 1\s*\)/
  );
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
  assert.match(scheduleModalSource, /scheduleCalendarCardType/);
  assert.match(scheduleModalSource, /const cardTypeLabel/);
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
  assert.match(styles, /\.scheduleCalendarCard\s*\{/);
  assert.match(styles, /\.scheduleFilters\s*\{/);
  assert.match(styles, /\.scheduleFilter\[data-filter="campaigns"\]/);
  assert.match(styles, /\.scheduleCalendarCard\[data-category="publications"\]/);
  assert.match(styles, /\.scheduleCalendarCard\[data-category="stats"\]/);
  assert.match(styles, /\.scheduleCalendarCard\[data-category="campaigns"\]/);
  assert.match(styles, /\.scheduleCalendarCardType\s*\{/);
  assert.match(styles, /\.scheduleApprovalIndicator\[data-state="approved"\]/);
  assert.match(styles, /\.scheduleApprovalIndicator\[data-state="pending"\]/);
  assert.match(styles, /\.scheduleApprovalIndicator\[data-state="refused"\]/);
  assert.match(styles, /\.scheduleCalendarCard\[data-approval="refused"\]/);
  assert.match(finalScheduleStyles, /width:\s*min\(1680px,/);
  assert.match(finalScheduleStyles, /height:\s*min\(94dvh, 1040px\)/);
  assert.match(finalScheduleStyles, /grid-template-columns:\s*repeat\(4, minmax\(0, 1fr\)\)/);
  assert.match(finalScheduleStyles, /grid-auto-rows:\s*160px/);
  assert.match(finalScheduleStyles, /\.scheduleDayCarouselControls\s*\{/);
  assert.match(
    finalScheduleStyles,
    /\.modalBackdrop:has\(\.scheduleModal\)\s*\{\s*padding:\s*8px 14px;/
  );
  assert.match(
    finalScheduleStyles,
    /height:\s*min\(calc\(100dvh - 16px\), 1160px\) !important;/
  );
  assert.match(finalScheduleStyles, /@media \(min-width: 761px\) and \(max-width: 1100px\)[\s\S]*?repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(finalScheduleStyles, /@media \(max-width: 760px\)[\s\S]*?grid-template-columns:\s*minmax\(0, 1fr\)/);
  assert.match(
    finalScheduleStyles,
    /\.scheduleCalendarCardTopline\s*\{\s*display:\s*contents;/
  );
  assert.match(
    finalScheduleStyles,
    /\.scheduleDayActions > \.scheduleCalendarCard\s*\{[\s\S]*?width:\s*100%;[\s\S]*?height:\s*100%;/
  );
  assert.match(
    finalScheduleStyles,
    /@media \(max-width: 760px\)[\s\S]*?\.scheduleCalendarCardTopline > \.scheduleCalendarCardControls\s*\{[\s\S]*?flex-direction:\s*row;/
  );
  assert.match(finalScheduleStyles, /height:\s*56px/);
  assert.match(finalScheduleStyles, /\.scheduleDayEmpty\s*\{\s*display:\s*block;/);
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

test("le rafraîchissement du planning conserve le mois choisi et masque les campagnes en Standard", () => {
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
      scheduleModalSource.indexOf("setVisibleMonth("),
    "le mois ne doit être réinitialisé qu'à l'ouverture de la modale"
  );
  assert.match(scheduleModalSource, /showCampaigns = true/);
  assert.match(scheduleModalSource, /scheduleFilterKey\(item\) !== "campaigns"/);
  assert.match(client, /showCampaigns=\{!standardMode\}/);
  assert.match(dashboardPlanning, /showCampaigns=\{!standardMode\}/);
});

test("les filtres restent sûrs et la corbeille retire toute publication éditoriale programmée", () => {
  const modal = read("app/dashboard/agent/_components/AgentActionModals.tsx");
  const client = read("app/dashboard/agent/AgentClient.tsx");
  const scheduleItems = read(
    "app/dashboard/agent/_lib/agent.schedule-items.ts"
  );
  const editorialItemSource = scheduleItems.slice(
    scheduleItems.indexOf("for (const action of editorialActions)"),
    scheduleItems.indexOf("for (const action of scheduledActions)")
  );

  assert.match(
    modal,
    /onChange=\{\(event\) => \{\s*const checked = event\.currentTarget\.checked;[\s\S]*?\[filter\.key\]: checked/,
  );
  assert.doesNotMatch(
    modal,
    /setActiveFilters\(\(current\) => \(\{[\s\S]*?event\.currentTarget\.checked/,
  );
  assert.match(editorialItemSource, /removable: true/);
  assert.match(
    modal,
    /data-schedule-action="delete"[\s\S]*?disabled=\{mutationState === "saving"\}/,
  );
  assert.match(
    client,
    /performCancelPreparedAction[\s\S]*?status: "cancelled"/,
  );
  assert.match(
    client,
    /item\.source === "editorial"[\s\S]*?cancelPreparedAction\(item\.preparedActionId\)/,
  );
});

test("une publication éditoriale iNr’Agent peut être reprogrammée sans changer de statut", () => {
  const client = read("app/dashboard/agent/AgentClient.tsx");
  const scheduleItems = read(
    "app/dashboard/agent/_lib/agent.schedule-items.ts"
  );
  const actionsRoute = read("app/api/agent/actions/route.ts").replace(/\r\n/g, "\n");
  const editorialItemSource = scheduleItems.slice(
    scheduleItems.indexOf("for (const action of editorialActions)"),
    scheduleItems.indexOf("for (const action of scheduledActions)")
  );
  const rescheduleRouteSource = actionsRoute.slice(
    actionsRoute.indexOf('if (editType === "reschedule_editorial")'),
    actionsRoute.indexOf('if (editType === "remove_publish_channel")')
  );
  const rescheduleUpdateSource = rescheduleRouteSource.slice(
    rescheduleRouteSource.indexOf(".update({"),
    rescheduleRouteSource.indexOf('})\n      .eq("id"')
  );

  assert.match(editorialItemSource, /editable: true/);
  assert.match(
    client,
    /item\.source === "editorial"[\s\S]*?setScheduleOnlyEdit\(\{[\s\S]*?source: "editorial"/,
  );
  assert.match(client, /editType: "reschedule_editorial"/);
  assert.match(rescheduleRouteSource, /scheduled_for: scheduledFor/);
  assert.match(
    rescheduleRouteSource,
    /editorialPlan:\s*\{[\s\S]*?scheduledFor,[\s\S]*?manuallyRescheduledAt/,
  );
  assert.doesNotMatch(rescheduleUpdateSource, /\bstatus:/);
});

test("Modifier depuis le planning ouvre bien la publication exacte, même hors carrousel", () => {
  const client = read("app/dashboard/agent/AgentClient.tsx");

  assert.match(client, /const explicitlySelectedPublication = actions\.find\(/);
  assert.match(
    client,
    /action\.id === selectedPreparedActionId[\s\S]*?action\.automationKey === "publish"[\s\S]*?action\.actionType === "publication"/
  );
  assert.match(client, /const publicationViewerActions =/);
  assert.match(client, /selectedPublicationCarouselIndex < 0/);
  assert.match(
    client,
    /selectedPreparedAction,[\s\S]*?\.\.\.publicationCarouselActions\.filter\([\s\S]*?action\.id !== selectedPreparedAction\.id/
  );
  assert.match(client, /setSelectedPreparedActionId\(item\.preparedActionId \|\| null\)/);
  assert.match(client, /publicationViewerActions\.length > 1/);
});

test("les boutons du planning conservent l'identité de chaque publication", () => {
  const client = read("app/dashboard/agent/AgentClient.tsx");
  const modal = read("app/dashboard/agent/_components/AgentActionModals.tsx");

  assert.match(modal, /onClick=\{\(\) => onOpenContent\(item\)\}/);
  assert.match(modal, /onClick=\{\(\) => onReschedule\(item\)\}/);
  assert.match(modal, /onClick=\{\(\) => onDelete\(item\)\}/);
  assert.match(
    client,
    /item\.source === "manual"\)[\s\S]*?openScheduledActionEditor\(item\.scheduledActionId\)/
  );
  assert.match(
    client,
    /item\.source === "editorial"[\s\S]*?setSelectedPreparedActionId\(item\.preparedActionId \|\| null\)[\s\S]*?setSelectedKey\("publish"\)/
  );
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
    "planning_day_carousel",
    "planning_previous_action",
    "planning_next_action",
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

test("le compteur du planning exclut les actions passées et hors mois", () => {
  const modal = read("app/dashboard/agent/_components/AgentActionModals.tsx");
  const scheduleModalSource = modal.slice(
    modal.indexOf("export function AgentScheduleModal"),
    modal.indexOf("type ValidationChoiceModalProps")
  );

  assert.match(scheduleModalSource, /const visibleMonthItems = useMemo/);
  assert.match(scheduleModalSource, /date\.getTime\(\) >= nowTimestamp/);
  assert.match(scheduleModalSource, /setNowTimestamp\(Date\.now\(\)\)/);
  assert.match(scheduleModalSource, /date\.getMonth\(\) === month/);
  assert.match(scheduleModalSource, /const filterCounts = useMemo/);
  assert.match(scheduleModalSource, /\[visibleMonthItems\]/);
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
  const mediaRequest = read("lib/inrAgentMediaRequest.ts");
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
  assert.match(mediaGeneration, /buildInrAgentMediaGenerationRequest/);
  assert.match(mediaRequest, /normalizeAiMediaGenerationRequest/);
  assert.match(mediaRequest, /inputMode: "essential"/);
  assert.match(mediaRequest, /subjectSource: "custom"/);
  assert.match(mediaGeneration, /idea: args\.idea/);
  assert.match(mediaRequest, /textMode: "none"/);
  assert.match(mediaRequest, /withText: false/);
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
