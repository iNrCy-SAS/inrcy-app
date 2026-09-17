import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function read(relativePath: string) {
  return readFileSync(new URL(`../../${relativePath}`, import.meta.url), "utf8").replace(
    /\r\n/g,
    "\n",
  );
}

test("les succès internes ne polluent plus les warnings Vercel", () => {
  const loginAlert = read("lib/loginFailureAlert.ts");
  const generationResult = read("app/api/booster/generation-result/route.ts");

  assert.match(loginAlert, /log\.info\("login_failure_alert_sent"/);
  assert.doesNotMatch(loginAlert, /log\.warn\("login_failure_alert_sent"/);
  assert.match(generationResult, /log\.info\("booster_generation_result_recovered"/);
  assert.doesNotMatch(generationResult, /console\.warn\("\[booster-generation-recovery\]/);
});

test("les retours OAuth attendus restent observables au niveau info", () => {
  const oauth = read("lib/observability/oauth.ts");

  assert.match(oauth, /input\.outcome === 'cancelled'/);
  assert.match(oauth, /'plusieurs propriétés ga4 correspondent à ce domaine'/);
  assert.match(oauth, /isExpectedHandledOAuthInput\(input\)/);
  assert.match(oauth, /isExpectedHandledOAuthMessage\(message\)[\s\S]*?\? 'info'/);
  assert.match(oauth, /if \(isUserResolvableOAuthException\(message\)\) return;/);
});

test("les cas utilisateur attendus sont info mais les défaillances fournisseur restent warn", () => {
  const instagram = read("app/api/integrations/instagram/accounts/route.ts");
  const finishPassword = read("app/api/auth/finish-password/route.ts");
  const stats = read("lib/stats/buildOverview.ts");

  assert.match(instagram, /discoveryHasProviderFailure \? "warn" : "info"/);
  assert.match(instagram, /handled: !discoveryHasProviderFailure/);
  assert.match(finishPassword, /isExpectedExpiredOtpError/);
  assert.match(finishPassword, /expectedExpiredLink \? "info" : "warn"/);
  assert.match(stats, /reconnectPersisted \? "info" : "warn"/);
  assert.match(stats, /log\.info\("gmb_stats_target_missing"/);
  assert.match(stats, /log\.warn\("gmb_stats_state_failed"/);
});

test("les journaux GMB incluent les diagnostics fournisseur déjà assainis", () => {
  const transport = read("lib/googleBusinessPostTransport.ts");
  const diagnostics = read("lib/channelPublishDiagnostics.ts");

  for (const field of [
    "providerCode",
    "providerStatus",
    "details",
    "fieldViolations",
  ]) {
    assert.match(transport, new RegExp(field));
  }
  assert.doesNotMatch(transport, /ignoredPayload/);
  assert.match(transport, /field_violations/);
  assert.match(diagnostics, /getGoogleBusinessPostErrorDiagnostics\(params\.error\)/);
  assert.match(diagnostics, /diagnostics,/);
});
