import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(relativePath: string) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

const dashboardClient = read("app/dashboard/DashboardClient.tsx");
const dashboardBootstrap = read("app/dashboard/dashboard.bootstrap-cache.ts");
const publishModal = read("app/dashboard/booster/publier/PublishModal.tsx");
const notificationsHook = read("app/dashboard/_hooks/useDashboardNotifications.ts");
const dashboardTopbar = read("app/dashboard/_components/DashboardTopbar.tsx");
const pendingCountHook = read("app/dashboard/_hooks/useInrAgentPendingCount.ts");
const preparationScoresHook = read("app/dashboard/_hooks/useDashboardPreparationScores.ts");
const accountCache = read("lib/browserAccountCache.ts");
const settingsDrawer = read("app/dashboard/SettingsDrawer.tsx");
const settingsDrawerContent = read("app/dashboard/_components/DashboardSettingsDrawerContent.tsx");

test("generator power keeps the confirmed snapshot visible until live checks settle", () => {
  assert.match(dashboardBootstrap, /GENERATOR_POWER_SNAPSHOT_CACHE_KEY = "inrcy_generator_power_snapshot_v2"/);
  assert.match(accountCache, /"inrcy_generator_power_percent_v2"/);
  assert.match(accountCache, /"inrcy_generator_power_snapshot_v2"/);
  assert.match(
    dashboardClient,
    /readCachedGeneratorPowerPercent\(\) \?\? readCachedGeneratorPowerSnapshot\(\)\?\.power \?\? null/,
  );
  assert.match(dashboardClient, /const generatorPower = displayedGeneratorPower \?\? 0;/);
  assert.match(
    dashboardClient,
    /const generatorPowerIsSettling = generatorPowerReady && generatorPower !== computedGeneratorPower;/,
  );
  assert.match(
    dashboardClient,
    /const settleTimer = window\.setTimeout\(\(\) => \{[\s\S]*setDisplayedGeneratorPower\(computedGeneratorPower\);[\s\S]*GENERATOR_POWER_SETTLE_MS/,
  );
  assert.match(
    dashboardClient,
    /if \(!generatorPowerReady \|\| generatorPowerIsSettling\) return;[\s\S]*setDisplayedGeneratorPowerSnapshot\(nextSnapshot\);[\s\S]*writeCachedGeneratorPowerSnapshot\(nextSnapshot\)/,
  );
});

test("Booster selects every newly confirmed connected channel without overriding the pro or a draft", () => {
  assert.match(publishModal, /const manuallyControlledChannelsRef = useRef<Set<ChannelKey>>\(new Set\(\)\)/);
  assert.match(publishModal, /const draftChannelsRestoredRef = useRef\(false\)/);
  assert.match(
    publishModal,
    /!draftChannelsRestoredRef\.current[\s\S]*!manuallyControlledChannelsRef\.current\.has\(key\)[\s\S]*nextSelection\[key\] = true/,
  );
  assert.match(publishModal, /applyConnectedChannels\(nextConnected\)/);
  assert.match(publishModal, /manuallyControlledChannelsRef\.current\.add\(key\)/);
  assert.match(publishModal, /draftChannelsRestoredRef\.current = true;[\s\S]*setChannels\(nextChannels\)/);
});

test("notification and iNrAgent badges hydrate from account-scoped caches before background refresh", () => {
  assert.match(notificationsHook, /DASHBOARD_NOTIFICATIONS_CACHE_KEY = "inrcy_dashboard_notifications_v1"/);
  assert.match(notificationsHook, /\(\) => readCachedNotifications\(\)\.items/);
  assert.match(notificationsHook, /ACTIVE_INRCY_ACCOUNT_EVENT/);
  assert.match(pendingCountHook, /INR_AGENT_PENDING_COUNT_CACHE_KEY =\s*"inrcy_inr_agent_pending_count_v1"/);
  assert.match(pendingCountHook, /readCachedPendingInrAgentCount\(nextAccountId\)/);
  assert.match(pendingCountHook, /ACTIVE_INRCY_ACCOUNT_EVENT/);
  assert.match(dashboardTopbar, /useInrAgentPendingCount\([^)]*\)/);
  assert.match(accountCache, /"inrcy_dashboard_notifications_v1"/);
  assert.match(accountCache, /"inrcy_inr_agent_pending_count_v1"/);
});

test("ADN and IA scores hydrate from a strictly account-scoped cache before silent refresh", () => {
  assert.match(
    preparationScoresHook,
    /DASHBOARD_PREPARATION_SCORES_CACHE_KEY =\s*\n?\s*"inrcy_dashboard_preparation_scores_v1"/,
  );
  assert.match(
    preparationScoresHook,
    /readAccountCacheValue\(DASHBOARD_PREPARATION_SCORES_CACHE_KEY, accountId\)/,
  );
  assert.match(
    preparationScoresHook,
    /useState<PreparationScoreState>\(\(\) => \(\s*createPreparationScoreState\(currentAccountId\)/,
  );
  assert.match(
    preparationScoresHook,
    /currentAccountIdRef\.current !== refreshAccountId/,
  );
  assert.match(
    preparationScoresHook,
    /if \(!dnaSucceeded && !aiSucceeded\) return;/,
  );
  assert.match(
    preparationScoresHook,
    /writeAccountCacheValue\([\s\S]*DASHBOARD_PREPARATION_SCORES_CACHE_KEY[\s\S]*state\.accountId/,
  );
  assert.match(accountCache, /"inrcy_dashboard_preparation_scores_v1"/);
});

test("visited channel settings stay mounted and restore their scroll position", () => {
  assert.match(settingsDrawer, /const \[hasBeenOpened, setHasBeenOpened\] = useState\(isOpen\)/);
  assert.match(settingsDrawer, /if \(!hasBeenOpened \|\| !portalReady\) return null/);
  assert.match(settingsDrawer, /display: isOpen \? "flex" : "none"/);
  assert.match(settingsDrawerContent, /const MEMORIZED_CHANNEL_PANELS = new Set\(/);
  assert.match(settingsDrawerContent, /const \[visitedChannelPanels, setVisitedChannelPanels\]/);
  assert.match(settingsDrawerContent, /data-memorized-channel-panel="true"/);
  assert.match(settingsDrawerContent, /panelScrollPositionsRef\.current\.set\(previousPanel, scrollContainer\.scrollTop\)/);
  assert.match(settingsDrawerContent, /scrollContainer\.scrollTop = panelScrollPositionsRef\.current\.get\(panel\) \?\? 0/);
  assert.match(settingsDrawerContent, /key=\{`youtube_shorts:\$\{discardRevisions\.youtube_shorts \?\? 0\}`\}/);
  assert.match(settingsDrawerContent, /key=\{`pinterest:\$\{discardRevisions\.pinterest \?\? 0\}`\}/);
  assert.match(settingsDrawerContent, /active=\{panel === "inr_search"\}/);
  assert.match(dashboardClient, /settingsPanelDiscardRevisions/);
  assert.match(dashboardClient, /key=\{completionAccountId \|\| "dashboard-channel-settings"\}/);
});
