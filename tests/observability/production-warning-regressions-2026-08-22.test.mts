import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();
const read = (relativePath: string) =>
  readFileSync(path.join(ROOT, relativePath), "utf8").replace(/\r\n/g, "\n");

function sourceFiles(directory: string): string[] {
  return readdirSync(path.join(ROOT, directory), { withFileTypes: true }).flatMap(
    (entry) => {
      const relativePath = path.join(directory, entry.name);
      if (entry.isDirectory()) return sourceFiles(relativePath);
      return /\.(?:ts|tsx|js|mjs)$/.test(entry.name) ? [relativePath] : [];
    },
  );
}

test("la clé i18n e-réputation correspond aux catalogues", () => {
  const page = read("app/dashboard/e-reputation/page.tsx");
  assert.match(page, /repondez_a_vos_avis_avec_inrcy_49a4b027/);
  assert.doesNotMatch(page, /repondez_a_vos_avis_avec_inrcy_49a4a027/);
  for (const locale of ["fr-FR", "en-GB"]) {
    assert.match(
      read(`messages/${locale}/reputation.json`),
      /repondez_a_vos_avis_avec_inrcy_49a4b027/,
    );
  }
});

test("les URL Storage privées passent toutes par le service de signature protégé", () => {
  const helper = read("lib/safeStorageSignedUrl.ts");
  const exportedService = helper.slice(
    helper.indexOf("export async function createSafeStorageSignedUrl"),
  );
  assert.ok(
    exportedService.indexOf("probeStorageObject(") <
      exportedService.indexOf("signWithRetry("),
  );
  assert.match(helper, /if \(objectState === "missing"\) return null/);
  assert.match(helper, /const signingInFlight = new Map/);
  assert.match(helper, /if \(isMissingObjectError\(error\)\)/);

  const offenders = [...sourceFiles("app"), ...sourceFiles("lib")].filter(
    (relativePath) =>
      relativePath !== path.join("lib", "safeStorageSignedUrl.ts") &&
      /\.createSignedUrl\s*\(/.test(read(relativePath)),
  );
  assert.deepEqual(offenders, []);
});

test("un refus SMTP ouvre un coupe-circuit lié aux identifiants", () => {
  const circuit = read("lib/txSmtpCircuit.ts");
  const mailer = read("lib/txMailer.ts");
  const reminders = read("app/api/cron/calendar-reminders/route.ts");

  assert.match(circuit, /DEFAULT_AUTH_BACKOFF_SECONDS = 60 \* 60/);
  assert.match(circuit, /responseCode === 535/);
  assert.match(circuit, /code === "EAUTH"/);
  assert.match(circuit, /\.update\(\[host, port, user, pass, secure\]\.join/);
  assert.match(circuit, /TX_SMTP_AUTH_BACKOFF/);
  assert.match(mailer, /await assertTxSmtpCircuitClosed\(identity\)/);
  assert.match(mailer, /await openTxSmtpCircuit\(error, identity\)/);
  assert.match(reminders, /isTxSmtpCircuitOpenError\(mailError\)/);
  assert.match(reminders, /\? console\.info/);
});

test("les notifications utilisateurs et les alertes internes ont des identités séparées", () => {
  const mailer = read("lib/txMailer.ts");
  const health = read("app/api/cron/health/route.ts");
  const signup = read("app/api/admin/new-user-alert/route.ts");
  const subscriptions = read("lib/subscriptionAdmin.ts");
  const reminders = read("app/api/cron/calendar-reminders/route.ts");

  assert.match(mailer, /`MONITORING_\$\{suffix\}`/);
  assert.match(mailer, /export async function sendMonitoringMail/);
  for (const internalAlert of [health, signup, subscriptions]) {
    assert.match(internalAlert, /sendMonitoringMail\(/);
    assert.doesNotMatch(internalAlert, /sendTxMail\(/);
  }
  assert.match(reminders, /sendTxMail\(/);
});

test("la santé déduplique les erreurs répétées sans masquer le statut dégradé", () => {
  const health = read("app/api/cron/health/route.ts");
  assert.match(health, /HEALTHCHECK_FAILURE_LOG_DEDUPE_SECONDS/);
  assert.match(health, /createHash\("sha256"\)/);
  assert.match(health, /cron_health_failure_deduplicated/);
  assert.match(health, /status: report\.ok \? 200 : 503/);
});

test("les routes publiques expéditrices sont limitées et piégées contre les robots", () => {
  const expected = [
    ["app/api/inrbadge/lead/route.ts", "inrbadge_public_lead", 8],
    ["app/api/inrbadge/appointment-request/route.ts", "inrbadge_public_appointment", 6],
    ["app/api/public/privacy/deletion-request/route.ts", "privacy_deletion_public", 3],
    ["app/api/diagnostic/send-report/route.ts", "diagnostic_report_public", 10],
  ] as const;

  for (const [relativePath, name, limit] of expected) {
    const source = read(relativePath);
    assert.match(source, /enforceRateLimit\(\{/);
    assert.match(source, new RegExp(`name: "${name}"`));
    assert.match(source, new RegExp(`limit: ${limit}`));
  }
  for (const relativePath of expected.slice(0, 3).map(([file]) => file)) {
    assert.match(read(relativePath), /website/);
  }
});

test("YouTube explique les 400 et réduit les métriques incompatibles", () => {
  const youtube = read("lib/youtubeShortsAnalytics.ts");
  assert.match(youtube, /class YoutubeAnalyticsRequestError extends Error/);
  assert.match(youtube, /errors\[0\]\?\.message/);
  assert.match(youtube, /errors\[0\]\?\.reason/);
  assert.match(youtube, /const totalsMetricCandidates = \[/);
  assert.match(youtube, /"views,estimatedMinutesWatched,averageViewDuration"/);
  assert.match(youtube, /"views"/);
  assert.match(youtube, /error\.status === 400/);
  assert.match(youtube, /totalsFallbackReason/);
});

test("les suppressions Instagram refusées par les permissions restent un résultat attendu", () => {
  const instagram = read("lib/inrsend/publicationChannelActions.ts");
  assert.match(instagram, /instagram_delete_remote_unsupported/);
  assert.match(instagram, /log\.info\("instagram_delete_remote_unsupported"/);
  assert.match(instagram, /log\.warn\("instagram_delete_attempt_failed"/);
  assert.match(instagram, /graphCode === 10/);
});

test("Stripe rattache un Checkout au compte même sans metadata", () => {
  const checkout = read("app/api/billing/checkout/route.ts");
  const webhook = read("app/api/stripe/webhook/route.ts");
  assert.match(checkout, /sessionParams\.set\("client_reference_id", userId\)/);
  assert.match(webhook, /session\?\.client_reference_id/);
  assert.match(webhook, /metadataUserId \|\| clientReferenceId/);
});
