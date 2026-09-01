import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath: string) =>
  readFileSync(join(root, relativePath), "utf8");

test("the former three-step startup flow is absent from the runtime", () => {
  const removedFiles = [
    "app/dashboard/_hooks/useDashboardOnboardingState.ts",
    "app/dashboard/settings/_components/OnboardingStepFooter.tsx",
    "app/api/dashboard/onboarding-state/route.ts",
    "app/api/dashboard/runtime-snapshot/route.ts",
    "app/api/dashboard/setup-state/route.ts",
    "lib/dashboardOnboarding.ts",
    "lib/dashboardOnboardingServer.ts",
    "lib/dashboardOnboardingLaunchProof.ts",
  ];

  for (const relativePath of removedFiles) {
    assert.equal(existsSync(join(root, relativePath)), false, relativePath);
  }

  const dashboard = read("app/dashboard/DashboardClient.tsx");
  const page = read("app/dashboard/page.tsx");
  const drawer = read("app/dashboard/SettingsDrawer.tsx");
  const drawerContent = read(
    "app/dashboard/_components/DashboardSettingsDrawerContent.tsx",
  );

  for (const source of [dashboard, page, drawer, drawerContent]) {
    assert.doesNotMatch(
      source,
      /guidedOnboarding|initialOnboardingState|setCurrentOnboardingStep|OnboardingStepFooter/,
    );
  }
});

test("the first dashboard arrival shows one account-scoped setup alert", () => {
  const hook = read("app/dashboard/_hooks/useDashboardSetupAlert.ts");
  const dashboard = read("app/dashboard/DashboardClient.tsx");

  assert.match(hook, /inrcy_dashboard_setup_alert_seen_v1/);
  assert.match(hook, /readAccountCacheValue\([^;]*accountId/);
  assert.match(hook, /writeAccountCacheValue\([^;]*"1", accountId\)/);
  assert.match(hook, /!profileIncomplete && !activityIncomplete/);
  assert.match(hook, /alertInrcy\(\{/);
  assert.match(dashboard, /useDashboardSetupAlert\(\{/);
});

test("profile and activity saves clear their warning immediately then revalidate", () => {
  const dashboard = read("app/dashboard/DashboardClient.tsx");
  const completionHook = read(
    "app/dashboard/_hooks/useDashboardCompletionChecks.ts",
  );
  const drawerContent = read(
    "app/dashboard/_components/DashboardSettingsDrawerContent.tsx",
  );

  assert.match(
    dashboard,
    /markProfileCompleted\(\);[\s\S]*?void checkProfile\(\);/,
  );
  assert.match(
    dashboard,
    /markActivityCompleted\(\);[\s\S]*?void checkActivity\(\);/,
  );
  assert.match(completionHook, /const markProfileCompleted = useCallback/);
  assert.match(completionHook, /const markActivityCompleted = useCallback/);
  assert.match(drawerContent, /onProfileSaved=\{onProfileSaved\}/);
  assert.match(drawerContent, /onActivitySaved=\{onActivitySaved\}/);
});

test("account creation and password completion no longer create launch state", () => {
  const provisioning = read("lib/inrcyAccountProvisioning.ts");
  const passwordRoute = read("app/api/auth/finish-password/route.ts");
  const accountRoute = read("app/api/multicompte/accounts/route.ts");

  for (const source of [provisioning, passwordRoute, accountRoute]) {
    assert.doesNotMatch(
      source,
      /DashboardOnboarding|inrcy_onboarding_states|inrcy_ensure_account_onboarding_state|LaunchProof/,
    );
  }
});
