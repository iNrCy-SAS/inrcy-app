import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath: string) => readFileSync(join(root, relativePath), "utf8");

const formerGuardFiles = [
  "lib/dashboardRequiredSetupAccess.ts",
  "lib/dashboardRequiredSetupServer.ts",
  "app/dashboard/_components/DashboardRequiredSetupGate.tsx",
  "app/dashboard/_components/RequiredSetupLock.tsx",
  "app/dashboard/_components/RequiredSetupLock.module.css",
];

const formerlyProtectedRoutes = [
  "agent",
  "mails",
  "propulser",
  "fideliser",
  "booster",
  "generer-media",
  "factures",
  "devis",
  "e-reputation",
];

const accessSurfaces = [
  "app/dashboard/DashboardClient.tsx",
  "app/dashboard/page.tsx",
  "app/dashboard/layout.tsx",
  "app/dashboard/_components/DashboardTopbar.tsx",
  "app/dashboard/_components/DashboardChannelsSection.tsx",
  "app/dashboard/_components/DashboardFluxBubble.tsx",
  "app/dashboard/_components/DashboardModulesCard.tsx",
  "app/dashboard/_components/DashboardStandardModulesCard.tsx",
  "app/dashboard/_components/ResponsiveBottomNav.tsx",
];

test("profile completion no longer owns a dashboard access-control layer", () => {
  for (const file of formerGuardFiles) {
    assert.equal(existsSync(join(root, file)), false, `${file} doit rester supprimé`);
  }

  for (const route of formerlyProtectedRoutes) {
    assert.equal(
      existsSync(join(root, `app/dashboard/${route}/layout.tsx`)),
      false,
      `${route} ne doit plus avoir de garde profil`,
    );
  }
});

test("dashboard buttons and direct URLs never branch on profile completion", () => {
  const sources = accessSurfaces.map(read).join("\n");

  assert.doesNotMatch(sources, /RequiredSetupLock/);
  assert.doesNotMatch(sources, /requiredSetup(?:AccessAllowed|LockVisible|Locked|Completed|Incomplete)/);
  assert.doesNotMatch(sources, /isDashboardRequiredSetupProtected/);
  assert.doesNotMatch(sources, /openRequiredSetupPanel|goToRequiredSetupAwareModule/);
  assert.doesNotMatch(sources, /requireDashboardRequiredSetupCompleted/);

  assert.match(read("app/dashboard/DashboardClient.tsx"), /mode=\{dashboardBoosterModal\}/);
  assert.match(read("app/dashboard/_components/DashboardStandardModulesCard.tsx"), /data-testid="standard-booster-publish"/);
  assert.match(read("app/dashboard/_components/DashboardStandardModulesCard.tsx"), /onClick=\{openPublishModal\}/);
});

test("completion remains an informational onboarding and preview signal", () => {
  const completion = read("lib/dashboardCompletion.ts");
  const hook = read("app/dashboard/_hooks/useDashboardCompletionChecks.ts");
  const setupAlert = read("app/dashboard/_hooks/useDashboardSetupAlert.ts");
  const dashboard = read("app/dashboard/DashboardClient.tsx");

  assert.match(completion, /evaluateDashboardPreparationCompletion/);
  assert.match(hook, /informational \(onboarding and profile-dependent previews\), never an access gate/);
  assert.match(setupAlert, /profileIncomplete/);
  assert.match(setupAlert, /activityIncomplete/);
  assert.match(dashboard, /const inrBadgeProfileReady = profileCheckReady/);
  assert.match(dashboard, /createInrBadgePublicUrl\(inrBadgeProfile\)/);
});

test("the E2E completion bypass cannot grant tool access", () => {
  const provider = read("app/dashboard/_components/DashboardCompletionBypassProvider.tsx");
  const layout = read("app/dashboard/layout.tsx");
  const flags = read("lib/e2eServerFlags.ts");

  assert.match(provider, /Dashboard access never depends on this context/);
  assert.match(layout, /DashboardCompletionBypassProvider enabled=\{bypassCompletionChecks\}/);
  assert.match(flags, /isDashboardCompletionE2EBypassEnabled/);
  assert.doesNotMatch(provider, /router|redirect|NEXT_PUBLIC_/);
  assert.doesNotMatch(flags, /NEXT_PUBLIC_/);
});
