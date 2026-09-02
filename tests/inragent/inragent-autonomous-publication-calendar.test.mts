import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (relativePath: string) =>
  readFileSync(resolve(ROOT, relativePath), "utf8");

test("le planning iNrAgent est un calendrier par quinzaine avec les actions conservées", () => {
  const modal = read(
    "app/dashboard/agent/_components/AgentActionModals.tsx",
  );
  const styles = read("app/dashboard/agent/agent.module.css");

  assert.match(modal, /function groupScheduleItems/);
  assert.match(modal, /const \[visibleHalf, setVisibleHalf\]/);
  assert.match(modal, />1–15<\/button>/);
  assert.match(modal, />16–\{calendarModel\.finalDay\}<\/button>/);
  assert.match(modal, /moveMonth\(-1\)/);
  assert.match(modal, /moveMonth\(1\)/);
  assert.match(modal, /role="grid"/);
  assert.match(modal, /onModify\(item\)/);
  assert.match(modal, /onDelete\(item\)/);
  assert.match(styles, /\.scheduleCalendar\s*\{/);
  assert.match(styles, /grid-template-columns:\s*repeat\(7,/);
  assert.match(styles, /\.scheduleCalendarCard\s*\{/);
});

test("les fréquences 1 à 3 fois par semaine ou par mois traversent tout le contrat", () => {
  const contract = read("lib/inrAgentSettings.ts");
  const config = read("app/dashboard/agent/_lib/agent.config.ts");
  const settingsRoute = read("app/api/agent/settings/route.ts");
  const cron = read("app/api/cron/inr-agent/route.ts");
  const migration = read(
    "ops/sql/2026-09-02_inr_agent_extended_publication_frequencies.sql",
  );

  for (const frequency of [
    "twice_weekly",
    "three_times_weekly",
    "biweekly",
    "three_times_monthly",
  ]) {
    for (const source of [contract, config, settingsRoute, cron, migration]) {
      assert.ok(source.includes(frequency), `${frequency} doit rester pris en charge`);
    }
  }
  assert.match(config, /2 fois par mois/);
  assert.match(config, /3 fois par mois/);
  assert.match(cron, /isThirdScheduledWeekdayOfMonth/);
  assert.match(cron, /scheduleSlots/);
});

test("iNrAgent construit seul une publication contextualisée et utilise les quotas du Studio", () => {
  const publishRoute = read("app/api/agent/actions/prepare-publish/route.ts");
  const mediaGeneration = read("lib/inrAgentMediaGeneration.ts");
  const chooseThemeSource = publishRoute.slice(
    publishRoute.indexOf("function chooseTheme"),
    publishRoute.indexOf("function normalizeCatalogText"),
  );

  assert.match(publishRoute, /getBoosterGenerationContext/);
  assert.match(
    publishRoute,
    /chooseTheme\(automation\.allowedThemes, recentPublications\)/,
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

