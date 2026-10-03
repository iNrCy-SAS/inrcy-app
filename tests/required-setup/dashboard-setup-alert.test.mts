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

test("the first dashboard arrival claims one durable account-scoped setup alert", () => {
  const hook = read("app/dashboard/_hooks/useDashboardSetupAlert.ts");
  const dashboard = read("app/dashboard/DashboardClient.tsx");
  const route = read("app/api/dashboard/setup-intro/route.ts");
  const migration = read("supabase/migrations/20260928082926_dashboard_setup_intro_once.sql");

  assert.match(hook, /fetch\("\/api\/dashboard\/setup-intro"/);
  assert.match(hook, /claimsInFlight\.get\(accountId\)/);
  assert.match(hook, /if \(!browserAccountId\) return;/);
  assert.match(hook, /body: JSON\.stringify\(\{ accountId \}\)/);
  assert.match(hook, /ACTIVE_INRCY_ACCOUNT_EVENT/);
  assert.match(hook, /BROWSER_SIGN_OUT_START_EVENT/);
  assert.doesNotMatch(hook, /readAccountCacheValue|writeAccountCacheValue|profileIncomplete|activityIncomplete/);
  assert.match(hook, /confirmInrcy\(\{/);
  assert.match(hook, /steps:\s*\[\s*t\("stepChannels"\),\s*t\("stepDna"\),\s*t\("stepAi"\),\s*t\("stepFirstPublication"\),\s*\]/);
  assert.doesNotMatch(hook, /t\("stepProfile"\)/);
  assert.match(hook, /confirmLabel: t\("confirm"\)/);
  assert.match(hook, /cancelLabel: t\("cancel"\)/);
  assert.match(hook, /if \(shouldOpenChannels && !cancelled && sequence === requestSequence\) onOpenChannels\(\)/);
  assert.match(dashboard, /useDashboardSetupAlert\(\{/);
  assert.match(dashboard, /onOpenChannels: openInitialChannelConnections/);
  assert.match(route, /resolveActiveInrcyAccountId\(supabase, user\.id\)/);
  assert.match(route, /body\?\.accountId !== accountId/);
  assert.match(route, /supabaseAdmin[\s\S]*?\.from\("inrcy_accounts"\)/);
  assert.match(route, /\.is\("dashboard_setup_intro_seen_at", null\)/);
  assert.match(route, /\.select\("id"\);/);
  assert.doesNotMatch(route, /\.select\("id"\)\s*\.maybeSingle\(\)/);
  assert.match(route, /if \(error\) \{[\s\S]*?claim failed/);
  assert.match(route, /show: Array\.isArray\(data\) && data\.length > 0/);
  assert.match(migration, /add column if not exists dashboard_setup_intro_seen_at timestamptz/);
  assert.match(migration, /default timestamptz '2026-09-28 08:24:04\+00'/);
  assert.match(migration, /alter column dashboard_setup_intro_seen_at drop default/);
});

test("the French setup copy follows the approved four-step order and channel CTA", () => {
  const messages = JSON.parse(read("messages/fr-FR/dashboard.json")) as {
    setupAlert: Record<string, string>;
  };

  assert.equal(messages.setupAlert.title, "4 étapes pour bien démarrer");
  assert.deepEqual(
    [
      messages.setupAlert.stepChannels,
      messages.setupAlert.stepDna,
      messages.setupAlert.stepAi,
      messages.setupAlert.stepFirstPublication,
    ],
    [
      "Connecter mes canaux",
      "Enrichir l'ADN de mon entreprise",
      "Configurer mon IA",
      "Publier",
    ],
  );
  assert.equal(messages.setupAlert.confirm, "Connecter mes canaux");
  assert.equal("stepProfile" in messages.setupAlert, false);
});

test("the setup journey enlarges only dialogs that contain onboarding steps", () => {
  const provider = read("app/_components/InrcyDialogProvider.tsx");
  const dialogContract = read("lib/inrcyDialog.ts");

  assert.match(dialogContract, /steps\?: string\[\]/);
  assert.match(provider, /dialog\.options\.steps/);
  assert.match(provider, /steps\.length \? stepsCardStyle : null/);
  assert.match(provider, /<ol style=\{stepsListStyle\}>/);
  assert.match(provider, /width: "min\(760px, calc\(100vw - 24px\)\)"/);
});

test("the business DNA workspace clears profile and activity warnings immediately then revalidates", () => {
  const businessDnaPage = read("app/dashboard/adn-entreprise/page.tsx");
  const completionHook = read(
    "app/dashboard/_hooks/useDashboardCompletionChecks.ts",
  );
  const combinedProfile = read(
    "app/dashboard/settings/_components/ProfileAndActivityContent.tsx",
  );

  assert.match(
    businessDnaPage,
    /markProfileCompleted\(\);[\s\S]*?void checkProfile\(\);/,
  );
  assert.match(
    businessDnaPage,
    /markActivityCompleted\(\);[\s\S]*?void checkActivity\(\);/,
  );
  assert.match(completionHook, /const markProfileCompleted = useCallback/);
  assert.match(completionHook, /const markActivityCompleted = useCallback/);
  assert.match(combinedProfile, /onProfileSaved=\{onProfileSaved\}/);
  assert.match(combinedProfile, /onActivitySaved=\{onActivitySaved\}/);
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
