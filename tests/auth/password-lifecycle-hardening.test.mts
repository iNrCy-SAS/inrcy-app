import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  getPasswordWriteDiagnostic,
  writeVerifiedPassword,
} from "../../lib/verifiedPasswordWrite.ts";

const read = (path: string) => readFileSync(path, "utf8");

test("invitation and reset share a recoverable server-side password finalizer", () => {
  const route = read("app/api/auth/finish-password/route.ts");

  assert.match(route, /PASSWORD_FINISH_COOKIE/);
  assert.match(route, /sealPasswordFinishContinuation/);
  assert.match(route, /openPasswordFinishContinuation/);
  assert.match(route, /export async function GET\(req: NextRequest\)/);
  assert.match(route, /supabaseAuth\.auth\.verifyOtp/);
  assert.match(route, /writeVerifiedPassword\(\{/);
  assert.match(route, /writeWithVerifiedSession/);
  assert.match(route, /writeWithAdminFallback/);
  assert.match(route, /password_policy_mismatch/);
  assert.match(route, /continuation_available: true/);
  assert.doesNotMatch(route, /continuation: continuationPayload/);
  assert.doesNotMatch(route, /adminUpdateError && !adminPasswordRejected/);
  assert.match(route, /"Cache-Control": "no-store"/);
});

test("a verified session is canonical and an admin write is only a transient fallback", async () => {
  const calls: string[] = [];
  const direct = await writeVerifiedPassword({
    writeWithVerifiedSession: async () => {
      calls.push("session");
      return { error: null };
    },
    writeWithAdminFallback: async () => {
      calls.push("admin");
      return { error: null };
    },
  });

  assert.equal(direct.ok, true);
  assert.equal(direct.source, "session");
  assert.deepEqual(calls, ["session"]);

  calls.length = 0;
  const recovered = await writeVerifiedPassword({
    writeWithVerifiedSession: async () => {
      calls.push("session");
      return { error: { code: "request_timeout", message: "temporary timeout" } };
    },
    writeWithAdminFallback: async () => {
      calls.push("admin");
      return { error: null };
    },
  });

  assert.equal(recovered.ok, true);
  assert.equal(recovered.source, "admin");
  assert.deepEqual(calls, ["session", "admin"]);
});

test("a backend password-policy mismatch is explicit and never causes a second write", async () => {
  const calls: string[] = [];
  const backendError = {
    code: "weak_password",
    message: "Password should be at least 108 characters.",
    reasons: ["length"],
  };
  const result = await writeVerifiedPassword({
    writeWithVerifiedSession: async () => {
      calls.push("session");
      return { error: backendError };
    },
    writeWithAdminFallback: async () => {
      calls.push("admin");
      return { error: null };
    },
  });

  assert.equal(result.ok, false);
  assert.equal(result.failureKind, "password_rejected");
  assert.deepEqual(calls, ["session"]);
  assert.deepEqual(getPasswordWriteDiagnostic(backendError), {
    code: "weak_password",
    reasons: ["length"],
    minimumLength: 108,
  });
});

test("the browser retries a verified password write without requesting a new link", () => {
  const client = read("app/auth/_components/FinishEmailLinkClient.tsx");

  assert.match(client, /payload\?\.continuation_available/);
  assert.match(client, /submitPassword\(null, false, true\)/);
  assert.match(client, /serverContinuationAvailable/);
  assert.match(client, /recoverAlreadyCommittedPassword/);
  assert.match(client, /supabase\.auth\.signInWithPassword/);
  assert.match(client, /waitForServerAuthSession\(\)/);
  assert.match(client, /data-testid="auth-link-error"/);
});

test("E2E authentication selectors are stable across every interface language", () => {
  const loginPage = read("app/login/page.tsx");
  const authHelper = read("tests/e2e/helpers/auth.ts");
  const publicSpec = read("tests/e2e/public.spec.ts");
  const recoverySpec = read("tests/e2e/auth-recovery.spec.ts");

  assert.match(loginPage, /data-testid="login-email"/);
  assert.match(loginPage, /data-testid="login-password"/);
  assert.match(loginPage, /data-testid="login-submit"/);
  assert.match(loginPage, /data-testid="forgot-password"/);
  assert.match(authHelper, /getByTestId\('login-email'\)/);
  assert.match(authHelper, /getByTestId\('login-password'\)/);
  assert.match(authHelper, /getByTestId\('login-submit'\)/);
  assert.match(publicSpec, /getByTestId\('login-email'\)/);
  assert.match(publicSpec, /getByTestId\('login-password'\)/);
  assert.match(publicSpec, /getByTestId\('login-submit'\)/);
  assert.match(recoverySpec, /getByTestId\('forgot-password'\)/);
  assert.match(recoverySpec, /getByTestId\('auth-link-error'\)/);
});

test("the legacy password page is only a bridge to the canonical flow", () => {
  const legacyPage = read("app/set-password/page.tsx");

  assert.match(legacyPage, /FinishEmailLinkClient/);
  assert.match(legacyPage, /allowSessionFallback/);
  assert.doesNotMatch(legacyPage, /auth\.updateUser/);
});

test("implicit and PKCE callbacks land on the same localized password flow", () => {
  const login = read("app/login/page.tsx");
  const callback = read("app/auth/callback/route.ts");

  assert.match(login, /\/auth\/finish-reset\/\$\{appLanguage\}/);
  assert.match(login, /\/auth\/finish-invite\/\$\{appLanguage\}/);
  assert.match(login, /source: "session"/);
  assert.doesNotMatch(login, /\/set-password\?mode=/);
  assert.match(callback, /if \(type === "recovery"\) return "\/auth\/finish-reset"/);
  assert.match(callback, /if \(type === "invite"\) return "\/auth\/finish-invite"/);
  assert.match(callback, /function localizeFinishPath/);
  assert.match(callback, /language \? `\$\{path\}\/\$\{language\}` : path/);
  assert.match(callback, /localizeFinishPath\(getFinishPath\(type\) \|\| "\/login", url\)/);
  assert.match(callback, /source", "session"/);
});

test("stale deleted-account cookies cannot block recovery routes", () => {
  const proxy = read("proxy.ts");
  const recoveryDeclaration = proxy.indexOf("function isAuthRecoveryPath");
  const invalidSessionBranch = proxy.lastIndexOf("if (invalidAuthSession)");
  const recoveryBranch = proxy.indexOf("isAuthRecoveryPath(pathname)", invalidSessionBranch);
  const genericApiRejection = proxy.indexOf('pathname.startsWith("/api/")', invalidSessionBranch);

  assert.ok(recoveryDeclaration >= 0);
  assert.match(proxy, /pathname === "\/api\/auth\/finish-password"/);
  assert.ok(recoveryBranch > invalidSessionBranch);
  assert.ok(genericApiRejection > recoveryBranch);
});

test("account deletion is retry-safe and clears browser authentication state", () => {
  const deletion = read("lib/deleteUserAccount.ts");
  const deletionApi = read("app/api/account/route.ts");
  const deletionUi = read("app/suppression-compte/DeletionRequestForm.tsx");
  const deletionWorkflow = read("app/api/account/deletion/route.ts");
  const firstCleanupGuard = deletion.indexOf("if (Object.keys(errors).length > 0)");
  const identityDeletion = deletion.indexOf("deleteUser(authUserId)");

  assert.ok(firstCleanupGuard >= 0 && firstCleanupGuard < identityDeletion);
  assert.match(deletionApi, /if \(!deletion\.ok\)/);
  assert.match(deletionWorkflow, /scheduleSubscriptionCancellationForUser/);
  assert.match(deletionWorkflow, /deleteUserDataCategories/);
  assert.match(deletionUi, /\/api\/account\/deletion/);
  assert.match(deletionUi, /purgeAllBrowserAccountCaches\(\)/);
  assert.match(deletionUi, /supabase\.auth\.signOut\(\{ scope: "local" \}\)/);
  assert.match(deletionUi, /window\.location\.replace\("\/login"\)/);
});

test("all supported languages include lifecycle and account-switch messages", () => {
  const locales = ["fr-FR", "en-GB", "es-ES", "it-IT", "de-DE", "nl-NL", "pt-PT", "th-TH", "zh-CN"];

  for (const locale of locales) {
    const auth = JSON.parse(read(`messages/${locale}/auth.json`));
    const settings = JSON.parse(read(`messages/${locale}/settings.json`));

    assert.equal(typeof auth.switchAccount?.title, "string", locale);
    assert.equal(typeof auth.password?.passwordRejected, "string", locale);
    assert.equal(typeof auth.password?.passwordPolicyMismatch, "string", locale);
    assert.equal(typeof auth.password?.retryWithoutNewLink, "string", locale);
    assert.equal(typeof auth.password?.accountUnavailable, "string", locale);
    for (const key of [
      "currentRequired",
      "currentIncorrect",
      "updateSuccess",
      "updateFailed",
      "accountLoadFailed",
    ]) {
      assert.equal(typeof auth.password?.[key], "string", `${locale}:password.${key}`);
    }
    for (const key of [
      "rgpd_export_done",
      "rgpd_export_failed",
      "rgpd_delete_done",
      "rgpd_delete_failed",
      "rgpd_cookie_saved",
    ]) {
      assert.equal(typeof settings[key], "string", `${locale}:${key}`);
    }
  }
});
