import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  DASHBOARD_ONBOARDING_LAUNCH_PROOF_TTL_SECONDS,
  createDashboardOnboardingLaunchProof,
  matchesDashboardOnboardingLaunchProof,
} from "../../lib/dashboardOnboardingLaunchProof.ts";

const SECRET = "test-only-onboarding-launch-secret-123456789";
const ACCOUNT_A = "11111111-1111-4111-8111-111111111111";
const ACCOUNT_B = "22222222-2222-4222-8222-222222222222";
const NOW = Date.UTC(2026, 8, 1, 8, 0, 0);

function read(relativePath: string) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8");
}

test("the short-lived launch proof is signed, expiring and establishment-scoped", () => {
  const proof = createDashboardOnboardingLaunchProof(ACCOUNT_A, {
    now: NOW,
    secret: SECRET,
  });

  assert.equal(
    matchesDashboardOnboardingLaunchProof(proof, ACCOUNT_A, {
      now: NOW + 30_000,
      secret: SECRET,
    }),
    true,
  );
  assert.equal(
    matchesDashboardOnboardingLaunchProof(proof, ACCOUNT_B, {
      now: NOW + 30_000,
      secret: SECRET,
    }),
    false,
  );
  assert.equal(
    matchesDashboardOnboardingLaunchProof(`${proof}x`, ACCOUNT_A, {
      now: NOW + 30_000,
      secret: SECRET,
    }),
    false,
  );
  assert.equal(
    matchesDashboardOnboardingLaunchProof(proof, ACCOUNT_A, {
      now: NOW + DASHBOARD_ONBOARDING_LAUNCH_PROOF_TTL_SECONDS * 1000,
      secret: SECRET,
    }),
    false,
  );
});

test("dashboard history is independent from mutable profile and activity data", () => {
  const serverSource = read("lib/dashboardOnboardingServer.ts");

  assert.doesNotMatch(
    serverSource,
    /dashboardCompletion|evaluateDashboardRequiredSetupCompletion|DASHBOARD_PROFILE_COMPLETION|DASHBOARD_ACTIVITY_COMPLETION/,
  );
  assert.doesNotMatch(
    serverSource,
    /\.from\("profiles"\)|\.from\("business_profiles"\)/,
  );
  assert.match(
    serverSource,
    /hasMatchingCreationProof && shouldRunDashboardOnboarding\(row\)/,
  );
});

test("only account creation endpoints issue the launch proof", () => {
  const finishPasswordSource = read("app/api/auth/finish-password/route.ts");
  const multicompteSource = read("app/api/multicompte/accounts/route.ts");

  assert.match(
    finishPasswordSource,
    /if \(mode === "invite"\)[\s\S]*?buildDashboardOnboardingLaunchProofCookie\(userId\)/,
  );
  assert.equal(
    finishPasswordSource.match(/buildDashboardOnboardingLaunchProofCookie\(userId\)/g)?.length,
    1,
  );
  assert.match(
    multicompteSource,
    /response\.cookies\.set\(buildDashboardOnboardingLaunchProofCookie\(accountId\)\)/,
  );
});

test("dashboard reads never provision a missing row as pending", () => {
  const serverSource = read("lib/dashboardOnboardingServer.ts");
  const apiSource = read("app/api/dashboard/onboarding-state/route.ts");

  for (const source of [serverSource, apiSource]) {
    assert.doesNotMatch(
      source,
      /ensureInrcyAccountOnboardingState|inrcy_ensure_account_onboarding_state/,
    );
  }
  assert.match(
    serverSource,
    /if \(!row\) return terminalizeDashboardOnboardingRow\(accountId, null\)/,
  );
  assert.match(
    serverSource,
    /\.insert\(\{[\s\S]*?account_id: accountId,[\s\S]*?status: "deferred"/,
  );
  assert.match(
    serverSource,
    /cookieStore\.get\(DASHBOARD_ONBOARDING_LAUNCH_PROOF_COOKIE\)/,
  );
  assert.match(
    apiSource,
    /request\.cookies\.get\(DASHBOARD_ONBOARDING_LAUNCH_PROOF_COOKIE\)/,
  );
});
