import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

const root = process.cwd();
const read = (relativePath: string) => readFileSync(join(root, relativePath), "utf8");

function assertAppearsBefore(
  source: string,
  first: string,
  second: string,
  message: string,
) {
  const firstIndex = source.indexOf(first);
  const secondIndex = source.indexOf(second);
  assert.notEqual(firstIndex, -1, `${message}: ${first} is missing`);
  assert.notEqual(secondIndex, -1, `${message}: ${second} is missing`);
  assert.ok(firstIndex < secondIndex, message);
}

function stripDollarQuotedBodies(sql: string) {
  return sql.replace(/\$\$[\s\S]*?\$\$/g, "$$");
}

const provisioningSource = read("lib/inrcyAccountProvisioning.ts");
const publicSignupSource = read("app/api/public/trial-signup/route.ts");
const adminSignupSource = read("app/api/admin/create-trial/route.ts");
const establishmentRouteSource = read("app/api/multicompte/accounts/route.ts");
const onboardingApiSource = read("app/api/dashboard/onboarding-state/route.ts");
const finishPasswordSource = read("app/api/auth/finish-password/route.ts");
const onboardingHookSource = read(
  "app/dashboard/_hooks/useDashboardOnboardingState.ts",
);
const onboardingServerSource = read("lib/dashboardOnboardingServer.ts");
const dashboardClientSource = read("app/dashboard/DashboardClient.tsx");
const authProvisioningSql = read(
  "ops/sql/2026-07-05_multicompte_step4_ui_admin_creation.sql",
);
const onboardingSql = read(
  "ops/sql/2026-07-25_dashboard_onboarding_state.sql",
);
const securityFacadeSql = read(
  "ops/sql/2026-08-19_security_definer_api_facades.sql",
);
const reliabilitySql = read(
  "ops/sql/2026-09-01_onboarding_provisioning_reliability.sql",
);

test("the database trigger chain provisions every new Auth account as pending/profile", () => {
  assert.match(
    authProvisioningSql,
    /create trigger inrcy_provision_auth_account_after_insert[\s\S]*?after insert on auth\.users/i,
  );
  assert.match(
    authProvisioningSql,
    /insert into public\.inrcy_accounts[\s\S]*?values \(new\.id, v_display_name, new\.id\)/i,
  );
  assert.match(
    authProvisioningSql,
    /insert into public\.inrcy_account_members[\s\S]*?values \(new\.id, new\.id, 'owner', true\)/i,
  );
  assert.match(
    authProvisioningSql,
    /insert into public\.inrcy_multi_account_config[\s\S]*?values \(new\.id, false, 1\)/i,
  );
  assert.match(
    onboardingSql,
    /create trigger inrcy_provision_onboarding_state_after_insert[\s\S]*?after insert on public\.inrcy_accounts/i,
  );
  assert.match(
    onboardingSql,
    /values \(new\.id, 1, 'pending', 'profile'\)/i,
  );

  assert.match(
    reliabilitySql,
    /create or replace function private\.inrcy_ensure_account_provisioning\([\s\S]*?p_auth_user_id uuid,[\s\S]*?p_account_id uuid,[\s\S]*?p_display_name text,[\s\S]*?p_is_default boolean default false[\s\S]*?\)\s*returns public\.inrcy_onboarding_states/i,
  );
  assert.match(
    reliabilitySql,
    /create or replace function private\.inrcy_ensure_account_onboarding\([\s\S]*?p_account_id uuid[\s\S]*?values \(p_account_id, 1, 'pending', 'profile'\)[\s\S]*?on conflict \(account_id\) do nothing/i,
  );
  assert.match(
    reliabilitySql,
    /create or replace function public\.inrcy_provision_auth_account\(\)[\s\S]*?private\.inrcy_ensure_account_provisioning\([\s\S]*?new\.id,[\s\S]*?new\.id,[\s\S]*?true[\s\S]*?t\.tgname = 'inrcy_provision_auth_account_after_insert'[\s\S]*?t\.tgfoid = 'public\.inrcy_provision_auth_account\(\)'::regprocedure/i,
  );
  assert.doesNotMatch(
    reliabilitySql,
    /create(?: or replace)? trigger inrcy_provision_auth_account_after_insert|alter table auth\.users\s+enable trigger/i,
  );
  assert.match(
    reliabilitySql,
    /create or replace function public\.inrcy_provision_onboarding_state\(\)[\s\S]*?private\.inrcy_ensure_account_onboarding\(new\.id\)[\s\S]*?create(?: or replace)? trigger inrcy_provision_onboarding_state_after_insert[\s\S]*?after insert on public\.inrcy_accounts/i,
  );
});

test("the reliability migration atomically covers principal and secondary accounts without a global backfill", () => {
  for (const table of [
    "inrcy_multi_account_config",
    "inrcy_accounts",
    "inrcy_account_members",
  ]) {
    assert.match(
      reliabilitySql,
      new RegExp(`insert into public\\.${table}`),
      table,
    );
  }
  assert.match(
    reliabilitySql,
    /v_state := private\.inrcy_ensure_account_onboarding\(p_account_id\)/,
  );
  assert.match(
    reliabilitySql,
    /create or replace function private\.inrcy_create_establishment\(p_display_name text\)[\s\S]*?private\.inrcy_ensure_account_provisioning\([\s\S]*?v_auth_user_id,[\s\S]*?v_account_id,[\s\S]*?v_display_name,[\s\S]*?false/i,
  );
  assert.match(
    reliabilitySql,
    /create or replace function public\.inrcy_ensure_auth_account_provisioned[\s\S]*?select private\.inrcy_ensure_account_provisioning/i,
  );
  assert.match(
    reliabilitySql,
    /create or replace function public\.inrcy_ensure_account_onboarding_state[\s\S]*?select private\.inrcy_ensure_account_onboarding/i,
  );

  const topLevelSql = stripDollarQuotedBodies(reliabilitySql);
  assert.doesNotMatch(
    topLevelSql,
    /\binsert\s+into\b/i,
    "the reliability migration must not silently classify existing accounts",
  );
  assert.doesNotMatch(
    topLevelSql,
    /\bupdate\s+public\.(?:inrcy_accounts|inrcy_account_members|inrcy_multi_account_config|inrcy_onboarding_states)\b/i,
    "the reliability migration must remain future-only",
  );
});

test("the server provisioning helper guarantees the complete principal account graph", () => {
  assert.match(
    provisioningSource,
    /export async function ensurePrincipalInrcyAccountProvisioned\(/,
  );
  assert.match(
    provisioningSource,
    /export async function ensureInrcyAccountOnboardingState\(/,
  );

  for (const table of [
    "inrcy_accounts",
    "inrcy_account_members",
    "inrcy_multi_account_config",
    "inrcy_onboarding_states",
  ]) {
    assert.match(provisioningSource, new RegExp(`\\.from\\(\\"${table}\\"\\)`), table);
  }

  assert.match(
    provisioningSource,
    /\.rpc\(\s*"inrcy_ensure_auth_account_provisioned"/,
  );
  assert.match(
    provisioningSource,
    /\.rpc\(\s*"inrcy_ensure_account_onboarding_state"/,
  );
  assert.match(
    provisioningSource,
    /INRCY_ONBOARDING_STATE_NOT_FOUND_AFTER_PROVISIONING[\s\S]*?ensureError\?\.message/,
    "an RPC error may be tolerated only when the database postcondition exists",
  );
  assert.match(provisioningSource, /INRCY_PRINCIPAL_ACCOUNT_VERIFICATION_FAILED/);
  assert.match(provisioningSource, /INRCY_ONBOARDING_STATE_NOT_FOUND_AFTER_PROVISIONING/);
  assert.match(
    provisioningSource,
    /ensureInrcyAccountOnboardingState\((?:user\.)?id\)/,
  );
});

test("public and Admin signups verify principal provisioning before continuing", () => {
  for (const [name, source, inviteMarker] of [
    ["public signup", publicSignupSource, "const invitedUser = invite.user"],
    ["Admin signup", adminSignupSource, "const userId = invite.user.id"],
  ] as const) {
    assert.match(
      source,
      /import \{[^}]*ensurePrincipalInrcyAccountProvisioned[^}]*\} from "@\/lib\/inrcyAccountProvisioning"/,
      name,
    );
    assert.match(
      source,
      /await ensurePrincipalInrcyAccountProvisioned\(/,
      name,
    );
    assert.doesNotMatch(
      source,
      /ensurePrincipalInrcyAccountProvisioned\([^;]*?\.catch\(/,
      `${name} must not swallow incomplete provisioning`,
    );
    assertAppearsBefore(
      source,
      inviteMarker,
      "await ensurePrincipalInrcyAccountProvisioned(",
      `${name} must provision only after Supabase Auth returned the user`,
    );
    assertAppearsBefore(
      source,
      "await ensurePrincipalInrcyAccountProvisioned(",
      "await provisionNewAccountBubbleAccess(",
      `${name} must reject incomplete account provisioning before optional setup`,
    );
  }
});

test("secondary establishment creation refuses success until onboarding is pending/profile", () => {
  const postSource = establishmentRouteSource.slice(
    establishmentRouteSource.indexOf("export async function POST"),
  );

  assert.match(
    establishmentRouteSource,
    /import \{[^}]*ensureInrcyAccountOnboardingState[^}]*\} from "@\/lib\/inrcyAccountProvisioning"/,
  );
  assert.match(
    postSource,
    /await ensureInrcyAccountOnboardingState\(accountId\)/,
  );
  assert.doesNotMatch(
    postSource,
    /ensureInrcyAccountOnboardingState\(accountId\)[^;]*?\.catch\(/,
  );
  assertAppearsBefore(
    postSource,
    "await ensureInrcyAccountOnboardingState(accountId)",
    "ok: true",
    "an establishment without onboarding state must never receive a successful response",
  );
  assert.match(
    postSource,
    /ensureInrcyAccountOnboardingState\(accountId\)[\s\S]*?catch[\s\S]*?status:\s*503/,
  );
});

test("the final establishment RPC facade keeps the account insert behind the private implementation", () => {
  assert.match(
    securityFacadeSql,
    /'public\.inrcy_create_establishment\(text\)'/i,
  );
  assert.match(
    securityFacadeSql,
    /execute format\('alter function %s set schema private', v_public_function\)/i,
  );
  assert.match(
    securityFacadeSql,
    /create or replace function public\.inrcy_create_establishment[\s\S]*?select private\.inrcy_create_establishment\(p_display_name\)/i,
  );
});

test("finishing an invitation proves the creation flow without repairing historical accounts", () => {
  assert.match(
    finishPasswordSource,
    /import \{[^}]*buildDashboardOnboardingLaunchProofCookie[^}]*\} from "@\/lib\/dashboardOnboardingLaunchProof"/,
  );
  assert.match(
    finishPasswordSource,
    /if \(mode === "invite"\)\s*\{\s*response\.cookies\.set\(buildDashboardOnboardingLaunchProofCookie\(userId\)\);?\s*\}/,
  );
  assert.doesNotMatch(
    finishPasswordSource,
    /ensurePrincipalInrcyAccountProvisioned|ensureInrcyAccountOnboardingState/,
    "password finalization must never recreate a pending onboarding row",
  );
  assert.equal(
    finishPasswordSource.match(/buildDashboardOnboardingLaunchProofCookie\(userId\)/g)?.length,
    1,
    "password recovery must never receive the creation proof",
  );
});

test("a missing onboarding row reached from the dashboard becomes terminal", () => {
  assert.doesNotMatch(
    onboardingApiSource,
    /ensureInrcyAccountOnboardingState|inrcy_ensure_account_onboarding_state/,
  );
  assert.match(
    onboardingApiSource,
    /resolveDashboardOnboardingForDashboardAccess\([\s\S]*?DASHBOARD_ONBOARDING_LAUNCH_PROOF_COOKIE/,
  );
  assert.doesNotMatch(
    onboardingServerSource,
    /ensureInrcyAccountOnboardingState|inrcy_ensure_account_onboarding_state/,
  );
  assert.match(
    onboardingServerSource,
    /if \(!current\)[\s\S]*?\.insert\(\{[\s\S]*?status: "deferred"[\s\S]*?current_step: "profile"/,
  );
  assert.match(
    onboardingServerSource,
    /if \(!row\) return terminalizeDashboardOnboardingRow\(accountId, null\)/,
  );
});

test("an onboarding load error permanently abandons the journey without blocking the dashboard", () => {
  assert.match(onboardingHookSource, /onboardingError:\s*true/);
  assert.match(onboardingHookSource, /ONBOARDING_ABANDONED_KEY/);
  assert.match(onboardingHookSource, /rememberAbandonedOnboarding\(accountId\)/);
  assert.match(onboardingHookSource, /action: "abandon_after_fail_open"/);
  assert.doesNotMatch(onboardingHookSource, /window\.setInterval/);
  assert.doesNotMatch(dashboardClientSource, /SetupRecoveryScreen/);
  assert.doesNotMatch(dashboardClientSource, /if \(onboardingStateLoading\)/);
  assert.match(dashboardClientSource, /data-onboarding-error=/);
  assert.match(dashboardClientSource, /!onboardingAbandoned/);
  assert.match(
    onboardingApiSource,
    /action === "abandon_after_fail_open"[\s\S]*?abandonDashboardOnboardingForAccount/,
  );
  assert.match(
    onboardingServerSource,
    /function terminalizeDashboardOnboardingRow[\s\S]*?current\?\.status === "completed" \|\| current\?\.status === "deferred"/,
  );
  assert.match(
    onboardingServerSource,
    /\.in\("status", \["pending", "in_progress"\]\)/,
  );
  assert.match(
    onboardingServerSource,
    /current\.status === "deferred" && params\.status !== "deferred"/,
  );
  assert.match(
    onboardingServerSource,
    /accountId: activeUserId,[\s\S]*?row: null,[\s\S]*?onboardingError: true/,
  );
});
