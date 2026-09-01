import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  isDashboardRequiredSetupProtectedDestination,
  isDashboardRequiredSetupProtectedLocation,
} from "../../lib/dashboardRequiredSetupAccess.ts";

const protectedDestinations = [
  "/dashboard?action=publish",
  "/dashboard?stats=1",
  "/dashboard?draftId=abc",
  "/dashboard?action=cash",
  "/dashboard/booster",
  "/dashboard/agent",
  "/dashboard/mails",
  "/dashboard/propulser",
  "/dashboard/fideliser",
  "/dashboard/factures",
  "/dashboard/factures/new",
  "/dashboard/devis",
  "/dashboard/devis/new?saveId=abc",
  "/dashboard/e-reputation",
  "/dashboard?panel=inrbadge",
  "/dashboard?panel=inr_search",
  "https://app.inrcy.com/dashboard/agent",
];

const allowedDestinations = [
  "/dashboard",
  "/dashboard?panel=profil",
  "/dashboard?panel=activite",
  "/dashboard?panel=ia",
  "/dashboard/stats",
  "/dashboard/crm",
  "/dashboard/agenda",
  "/dashboard/mediatheque",
  "/dashboard/gps",
];

test("protects every module that requires Profil and Activité", () => {
  for (const href of protectedDestinations) {
    assert.equal(isDashboardRequiredSetupProtectedDestination(href), true, href);
  }
});

test("keeps dashboard, settings, iNrStats and iNrCRM accessible", () => {
  for (const href of allowedDestinations) {
    assert.equal(isDashboardRequiredSetupProtectedDestination(href), false, href);
  }
});

test("classifies the current dashboard location with readonly search params", () => {
  const query = new URLSearchParams("action=publish");
  assert.equal(isDashboardRequiredSetupProtectedLocation("/dashboard", query), true);
  assert.equal(isDashboardRequiredSetupProtectedLocation("/dashboard/stats", query), false);
});

const layoutSource = readFileSync(
  new URL("../../app/dashboard/layout.tsx", import.meta.url),
  "utf8",
);
const gateSource = readFileSync(
  new URL("../../app/dashboard/_components/DashboardRequiredSetupGate.tsx", import.meta.url),
  "utf8",
);
const dashboardClientSource = readFileSync(
  new URL("../../app/dashboard/DashboardClient.tsx", import.meta.url),
  "utf8",
);
const bottomNavSource = readFileSync(
  new URL("../../app/dashboard/_components/ResponsiveBottomNav.tsx", import.meta.url),
  "utf8",
);
const modulesSource = readFileSync(
  new URL("../../app/dashboard/_components/DashboardModulesCard.tsx", import.meta.url),
  "utf8",
);
const completionHookSource = readFileSync(
  new URL("../../app/dashboard/_hooks/useDashboardCompletionChecks.ts", import.meta.url),
  "utf8",
);
const serverGuardSource = readFileSync(
  new URL("../../lib/dashboardRequiredSetupServer.ts", import.meta.url),
  "utf8",
);
const e2eServerFlagsSource = readFileSync(
  new URL("../../lib/e2eServerFlags.ts", import.meta.url),
  "utf8",
);
const dashboardPageSource = readFileSync(
  new URL("../../app/dashboard/page.tsx", import.meta.url),
  "utf8",
);

test("dashboard layout blocks direct URLs before rendering protected tools", () => {
  assert.match(layoutSource, /DashboardRequiredSetupGate/);
  assert.match(gateSource, /isDashboardRequiredSetupProtectedLocation/);
  assert.match(gateSource, /router\.replace\("\/dashboard"\)/);
  assert.match(gateSource, /completionCheckReady/);
  assert.match(gateSource, /requiredSetupCompleted/);
});

test("dashboard buttons stay clickable while completion checks load and guide known incomplete accounts", () => {
  assert.match(dashboardClientSource, /const requiredSetupAccessAllowed = !completionCheckReady \|\| requiredSetupCompleted/);
  assert.match(dashboardClientSource, /goToRequiredSetupAwareModule/);
  assert.match(dashboardClientSource, /openRequiredSetupPanel/);
  assert.match(bottomNavSource, /isDashboardRequiredSetupProtectedDestination\(href\)/);
  assert.match(bottomNavSource, /!completionCheckReady \|\| requiredSetupCompleted/);
  assert.match(modulesSource, /onRequiredSetupBlocked\(\)/);
  assert.doesNotMatch(modulesSource, /if \(!requiredSetupAccessAllowed\) return;/);
});

test("completion state synchronizes across dashboard, gate and responsive navigation", () => {
  assert.match(completionHookSource, /DASHBOARD_COMPLETION_STATE_EVENT/);
  assert.match(completionHookSource, /broadcastCompletionState/);
  assert.match(completionHookSource, /completionRefreshGenerationByAccount/);
});

test("protected pages are also rejected server-side", () => {
  assert.match(serverGuardSource, /evaluateDashboardRequiredSetupCompletion/);
  assert.match(serverGuardSource, /activeUserId/);
  assert.match(serverGuardSource, /redirect\("\/dashboard"\)/);
  assert.match(dashboardPageSource, /requireDashboardRequiredSetupCompleted/);

  for (const directory of ["agent", "mails", "propulser", "fideliser", "booster", "factures", "devis", "e-reputation"]) {
    const source = readFileSync(
      new URL(`../../app/dashboard/${directory}/layout.tsx`, import.meta.url),
      "utf8",
    );
    assert.match(source, /requireDashboardRequiredSetupCompleted/);
  }
});

const bypassProviderSource = readFileSync(
  new URL("../../app/dashboard/_components/DashboardRequiredSetupBypassProvider.tsx", import.meta.url),
  "utf8",
);

test("Playwright required-setup bypass is propagated from the server without a public env variable", () => {
  assert.match(layoutSource, /isRequiredSetupE2EBypassEnabled\(\)/);
  assert.match(serverGuardSource, /isRequiredSetupE2EBypassEnabled\(\)/);
  assert.match(e2eServerFlagsSource, /process\.env\.E2E_BYPASS_REQUIRED_SETUP === "true"/);
  assert.match(layoutSource, /DashboardRequiredSetupBypassProvider enabled=\{bypassRequiredSetup\}/);
  assert.match(bypassProviderSource, /createContext<boolean>\(false\)/);
  assert.match(gateSource, /useDashboardRequiredSetupBypass/);
  assert.match(completionHookSource, /BYPASSED_COMPLETION_STATE/);
  assert.match(completionHookSource, /requiredSetupCompleted: true/);
  assert.doesNotMatch(bypassProviderSource, /NEXT_PUBLIC_/);
  assert.doesNotMatch(e2eServerFlagsSource, /NEXT_PUBLIC_/);
});
