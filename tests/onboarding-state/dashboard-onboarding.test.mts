import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getDashboardOnboardingPanel,
  getDashboardOnboardingProgress,
  isDashboardOnboardingFirstOpening,
  normalizeDashboardOnboardingRow,
  shouldRunDashboardOnboarding,
} from "../../lib/dashboardOnboarding.ts";

const baseRow = {
  account_id: "11111111-1111-4111-8111-111111111111",
  version: 1,
  status: "pending",
  current_step: "profile",
  started_at: null,
  completed_at: null,
  deferred_at: null,
  created_at: "2026-07-25T20:00:00.000Z",
  updated_at: "2026-07-25T20:00:00.000Z",
};

test("normalizes a pending onboarding row", () => {
  const row = normalizeDashboardOnboardingRow(baseRow);
  assert.ok(row);
  assert.equal(row.accountId, baseRow.account_id);
  assert.equal(row.status, "pending");
  assert.equal(row.currentStep, "profile");
});

test("detects the first dashboard opening", () => {
  const row = normalizeDashboardOnboardingRow(baseRow);
  assert.equal(isDashboardOnboardingFirstOpening(row), true);
  assert.equal(shouldRunDashboardOnboarding(row), true);
});

test("completed existing accounts do not run onboarding", () => {
  const row = normalizeDashboardOnboardingRow({
    ...baseRow,
    status: "completed",
    current_step: "completed",
    started_at: "2026-07-25T20:00:00.000Z",
    completed_at: "2026-07-25T20:00:00.000Z",
  });
  assert.ok(row);
  assert.equal(isDashboardOnboardingFirstOpening(row), false);
  assert.equal(shouldRunDashboardOnboarding(row), false);
});

test("rejects inconsistent completed states", () => {
  const row = normalizeDashboardOnboardingRow({
    ...baseRow,
    status: "completed",
    current_step: "profile",
    completed_at: "2026-07-25T20:00:00.000Z",
  });
  assert.equal(row, null);
});

const migrationSql = readFileSync(
  new URL("../../ops/sql/2026-07-25_dashboard_onboarding_state.sql", import.meta.url),
  "utf8",
);

test("migration keeps existing accounts completed and future accounts pending", () => {
  assert.match(
    migrationSql,
    /from public\.inrcy_accounts a[\s\S]*on conflict \(account_id\) do nothing;/i,
  );
  assert.match(
    migrationSql,
    /values \(new\.id, 1, 'pending', 'profile'\)/i,
  );
  assert.match(
    migrationSql,
    /values[\s\S]*'completed'[\s\S]*'completed'/i,
  );
});

test("migration scopes reads and mutations to accessible establishments", () => {
  assert.match(
    migrationSql,
    /using \(public\.inrcy_can_access_account\(account_id\)\)/i,
  );
  assert.match(
    migrationSql,
    /not public\.inrcy_can_access_account\(p_account_id\)/i,
  );
  assert.match(
    migrationSql,
    /grant execute on function public\.inrcy_save_onboarding_state/i,
  );
});


test("maps onboarding steps to the existing dashboard drawers", () => {
  assert.equal(getDashboardOnboardingPanel("profile"), "profil");
  assert.equal(getDashboardOnboardingPanel("activity"), "activite");
  assert.equal(getDashboardOnboardingPanel("ai"), "ia");
  assert.equal(getDashboardOnboardingPanel("completed"), null);
});

test("exposes the three-step progress indicator", () => {
  assert.deepEqual(getDashboardOnboardingProgress("profile"), { current: 1, total: 3 });
  assert.deepEqual(getDashboardOnboardingProgress("activity"), { current: 2, total: 3 });
  assert.deepEqual(getDashboardOnboardingProgress("ai"), { current: 3, total: 3 });
  assert.equal(getDashboardOnboardingProgress("completed"), null);
});

const dashboardClientSource = readFileSync(
  new URL("../../app/dashboard/DashboardClient.tsx", import.meta.url),
  "utf8",
);
const commonMessages = JSON.parse(
  readFileSync(new URL("../../messages/fr-FR/common.json", import.meta.url), "utf8"),
) as { dashboardBoot: string };

test("dashboard chains existing drawers without creating replacement forms", () => {
  assert.match(dashboardClientSource, /checkProfile\(\)[\s\S]*profileCompleted/);
  assert.match(dashboardClientSource, /setCurrentOnboardingStep\("activity"\)/);
  assert.match(dashboardClientSource, /replacePanelDirect\("activite"\)/);
  assert.match(dashboardClientSource, /checkActivity\(\)[\s\S]*activityCompleted/);
  assert.match(dashboardClientSource, /setCurrentOnboardingStep\("ai"\)/);
  assert.match(dashboardClientSource, /replacePanelDirect\("ia"\)/);
  assert.match(dashboardClientSource, /completeOnboardingFromAi/);
  assert.match(dashboardClientSource, /onboardingT\("progress"/);
});

const onboardingHookSource = readFileSync(
  new URL("../../app/dashboard/_hooks/useDashboardOnboardingState.ts", import.meta.url),
  "utf8",
);
const onboardingApiSource = readFileSync(
  new URL("../../app/api/dashboard/onboarding-state/route.ts", import.meta.url),
  "utf8",
);
const panelRoutingSource = readFileSync(
  new URL("../../app/dashboard/_hooks/useDashboardPanelRouting.ts", import.meta.url),
  "utf8",
);

test("successful onboarding saves use a direct guarded-safe panel transition", () => {
  const directTransition = panelRoutingSource.match(
    /const replacePanelDirect = useCallback\([\s\S]*?\n  \);/,
  )?.[0] ?? "";

  assert.match(directTransition, /window\.history\.replaceState/);
  assert.match(directTransition, /setPanel\(name\)[\s\S]*window\.history\.replaceState/);
  assert.doesNotMatch(directTransition, /requestNavigation/);
  assert.match(
    dashboardClientSource,
    /setSettingsDrawerHasUnsavedChanges\(false\)[\s\S]*replacePanelDirect\("activite"\)/,
  );
  assert.match(
    dashboardClientSource,
    /setSettingsDrawerHasUnsavedChanges\(false\)[\s\S]*replacePanelDirect\("ia"\)/,
  );
});

test("stale onboarding mutations cannot restore the previous establishment", () => {
  assert.match(onboardingHookSource, /mutationSequenceRef/);
  assert.match(onboardingHookSource, /activeAccountIdRef/);
  assert.match(onboardingHookSource, /activeAccountIdRef\.current !== accountId/);
  assert.match(onboardingApiSource, /expectedAccountId !== activeUserId/);
  assert.match(onboardingHookSource, /mutationSequenceRef\.current \+= 1/);
  assert.match(onboardingHookSource, /activeAccountIdRef\.current = null/);
});

const settingsDrawerSource = readFileSync(
  new URL("../../app/dashboard/SettingsDrawer.tsx", import.meta.url),
  "utf8",
);
const onboardingFooterSource = readFileSync(
  new URL("../../app/dashboard/settings/_components/OnboardingStepFooter.tsx", import.meta.url),
  "utf8",
);
const settingsContentSource = readFileSync(
  new URL("../../app/dashboard/_components/DashboardSettingsDrawerContent.tsx", import.meta.url),
  "utf8",
);
const activityContentSource = readFileSync(
  new URL("../../app/dashboard/settings/_components/ActivityContent.tsx", import.meta.url),
  "utf8",
);
const aiConfigurationSource = readFileSync(
  new URL("../../app/dashboard/settings/_components/AiConfigurationContent.tsx", import.meta.url),
  "utf8",
);
const dashboardPageSource = readFileSync(
  new URL("../../app/dashboard/page.tsx", import.meta.url),
  "utf8",
);

const googleBusinessChannelSource = readFileSync(
  new URL(
    "../../app/dashboard/_hooks/channels/useGoogleBusinessChannel.ts",
    import.meta.url,
  ),
  "utf8",
);
test("first onboarding uses a dedicated desktop presentation and a Passer action", () => {
  assert.match(settingsDrawerSource, /presentation\?: "drawer" \| "onboarding"/);
  assert.match(settingsDrawerSource, /isDesktopOnboarding/);
  assert.match(settingsDrawerSource, /#06101f/);
  assert.match(dashboardClientSource, /presentation=\{guidedOnboardingActive \? "onboarding" : "drawer"\}/);
  assert.match(dashboardClientSource, /closeLabel=\{guidedOnboardingActive \? onboardingT\("skip"\) : undefined\}/);
});

test("dashboard only boots while onboarding state loads and never waits for an URL mirror", () => {
  assert.match(dashboardClientSource, /onboardingStateLoading/);
  assert.match(dashboardClientSource, /StableBootScreen label=\{commonT\("dashboardBoot"\)\}/);
  assert.equal(commonMessages.dashboardBoot, "Chargement de votre dashboard iNrCy…");
  assert.doesNotMatch(dashboardClientSource, /onboardingInitialPreparationBlocking/);
  assert.doesNotMatch(dashboardClientSource, /StableBootScreen label=\{commonT\("initialSetup"\)\}/);
  assert.doesNotMatch(dashboardPageSource, /getDashboardInitialOnboardingStateServer/);
  assert.doesNotMatch(dashboardPageSource, /initialOnboardingState=/);
});

test("panel routing updates React immediately and then mirrors the browser URL", () => {
  assert.match(panelRoutingSource, /const \[panel, setPanel\] = useState<string \| null>\(urlPanel\)/);
  assert.match(panelRoutingSource, /useEffect\(\(\) => \{\s*setPanel\(urlPanel\);\s*\}, \[urlPanel\]\)/);
  assert.match(panelRoutingSource, /setPanel\(name\)[\s\S]*router\.push/);
  assert.match(panelRoutingSource, /setPanel\(name\)[\s\S]*window\.history\.replaceState/);
  assert.match(panelRoutingSource, /setPanel\(null\)[\s\S]*router\.replace/);
});

test("login auth events cannot race the explicit dashboard redirect", () => {
  const loginSource = readFileSync(
    new URL("../../app/login/page.tsx", import.meta.url),
    "utf8",
  );
  const listenerBlock = loginSource.match(/supabase\.auth\.onAuthStateChange\([\s\S]*?return \(\) =>/i)?.[0] || "";
  assert.match(listenerBlock, /setActiveBrowserUserId\(session\.user\.id\)/);
  assert.doesNotMatch(listenerBlock, /redirectToDashboard\(\)/);
  assert.match(loginSource, /waitForServerAuthSession\(\)/);
  assert.match(
    loginSource,
    /const localizedDashboardHref = buildLocalizedDashboardPath\(appLanguage\)/,
  );
  assert.match(
    loginSource,
    /window\.location\.replace\(localizedDashboardHref\)/,
  );
  assert.doesNotMatch(loginSource, /window\.location\.replace\("\/dashboard"\)/);
});

test("dashboard navigation waits until the SSR session is readable", () => {
  const readyRouteSource = readFileSync(
    new URL("../../app/api/auth/session-ready/route.ts", import.meta.url),
    "utf8",
  );
  const browserReadySource = readFileSync(
    new URL("../../lib/browserAuthSessionReady.ts", import.meta.url),
    "utf8",
  );
  const finishPasswordSource = readFileSync(
    new URL("../../app/auth/_components/FinishEmailLinkClient.tsx", import.meta.url),
    "utf8",
  );
  assert.match(readyRouteSource, /supabase\.auth\.getUser\(\)/);
  assert.match(browserReadySource, /fetch\("\/api\/auth\/session-ready"/);
  assert.match(browserReadySource, /credentials: "include"/);
  assert.match(finishPasswordSource, /waitForServerAuthSession\(\)/);
});

test("skipping required onboarding warns that tools remain unavailable", () => {
  assert.match(dashboardClientSource, /onboardingT\("continueLaterMessage"\)/);
  assert.match(dashboardClientSource, /onboardingT\("continueLater"\)/);
  assert.match(dashboardClientSource, /onboardingT\("returnToSetup"\)/);
});

test("the three pages use one autosaving previous-next-reset navigation", () => {
  assert.match(onboardingFooterSource, /data-onboarding-step-footer/);
  assert.match(onboardingFooterSource, /t\("previous"\)/);
  assert.match(onboardingFooterSource, /t\("next"\)/);
  assert.match(onboardingFooterSource, /t\("reset"\)/);
  assert.match(activityContentSource, /requireComplete: false,[\s\S]*onSuccess: onOnboardingPrevious/);
  assert.match(activityContentSource, /requireComplete: true,[\s\S]*onSuccess: onOnboardingNext/);
  assert.match(aiConfigurationSource, /onPrevious=\{\(\) => save\(onOnboardingPrevious\)\}/);
  assert.match(aiConfigurationSource, /onNext=\{\(\) => save\(onOnboardingNext\)\}/);
});

test("activity and AI are split into three framed, understandable sections", () => {
  for (const section of ["identity", "reach", "positioning"]) {
    assert.match(activityContentSource, new RegExp(`data-onboarding-activity-section="${section}"`));
  }
  for (const section of ["foundation", "voice", "goals"]) {
    assert.match(aiConfigurationSource, new RegExp(`data-onboarding-ai-section="${section}"`));
  }
});

test("backward navigation persists the step and the onboarding shell never exposes the dashboard", () => {
  assert.match(dashboardClientSource, /setCurrentOnboardingStep\("profile"\)[\s\S]*replacePanelDirect\("profil"\)/);
  assert.match(dashboardClientSource, /setCurrentOnboardingStep\("activity"\)[\s\S]*replacePanelDirect\("activite"\)/);
  assert.match(dashboardClientSource, /isOpen=\{guidedOnboardingActive \|\| isDrawerPanel\(panel\)\}/);
  assert.match(dashboardClientSource, /contentDirection=\{onboardingTransitionDirection\}/);
  assert.match(settingsDrawerSource, /inrcy-onboarding-page-forward/);
  assert.match(settingsDrawerSource, /inrcy-onboarding-page-backward/);
  assert.match(settingsContentSource, /const visibleOnboardingPanel = onboardingPanel \?\? panel/);
});

test("returning to the dashboard reuses the establishment onboarding cache", () => {
  assert.match(onboardingHookSource, /ONBOARDING_CACHE_KEY/);
  assert.match(onboardingHookSource, /readAccountCacheValue/);
  assert.match(onboardingHookSource, /writeAccountCacheValue/);
  assert.match(onboardingHookSource, /readCachedOnboardingState\(\) \?\? INITIAL_ONBOARDING_STATE/);
});

test("Google OAuth uses a full browser navigation and cannot be prefetched by Next", () => {
  assert.match(
    googleBusinessChannelSource,
    /window\.location\.href\s*=\s*`\/api\/integrations\/google-business\/start\?returnTo=\$\{returnTo\}`/,
  );
  assert.match(
    googleBusinessChannelSource,
    /encodeURIComponent\("\/dashboard\?panel=gmb"\)/,
  );
  assert.doesNotMatch(googleBusinessChannelSource, /router\.(?:push|replace)\(/);
});
