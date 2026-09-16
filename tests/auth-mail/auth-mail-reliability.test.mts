import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();

async function source(relativePath: string) {
  return readFile(path.join(ROOT, relativePath), "utf8");
}

test("the first ambiguous transport failure becomes uncertainty without another professional send", async () => {
  const delivery = await source("lib/authMailDelivery.ts");
  const uncertainReplay = delivery.indexOf('row.status === "acceptance_uncertain"');
  const terminalFailure = delivery.indexOf("authMailStatusNeedsAlert(row.status)");

  assert.doesNotMatch(delivery, /MAX_PROVIDER_SEND_ATTEMPTS/);
  assert.match(
    delivery,
    /if \(isUncertainTransportFailure\(transportError\)\)[\s\S]*markDeliveryAcceptanceUncertain/,
  );
  assert.match(
    delivery,
    /status === "acceptance_uncertain"[\s\S]*accepted: true,[\s\S]*uncertain: true/,
  );
  assert.ok(uncertainReplay >= 0 && uncertainReplay < terminalFailure);
});

test("uncertain acceptance remains below sent, delivered and terminal provider failures", async () => {
  const migration = await source("supabase/migrations/20260914221305_auth_email_delivery_tracking.sql");
  const policy = await source("lib/authMailPolicy.ts");

  assert.match(migration, /mark_auth_email_delivery_acceptance_uncertain/);
  assert.match(migration, /then greatest\(delivery\.status_rank, 15\)/);
  assert.match(policy, /"email\.sent": \{ status: "sent", rank: 20 \}/);
  assert.match(policy, /"email\.delivered": \{ status: "delivered", rank: 50 \}/);
  assert.match(policy, /"email\.failed": \{ status: "failed", rank: 70 \}/);
  assert.match(migration, /delivery\.status_rank[\s\S]*greatest\(delivery\.status_rank, p_status_rank\)/i);
  assert.match(migration, /'acceptance_uncertain', 'failed', 'bounced', 'suppressed', 'complained'/);
});

test("positive provider reconciliation cancels a still-pending uncertainty alert", async () => {
  const migration = await source("supabase/migrations/20260914221305_auth_email_delivery_tracking.sql");
  const webhook = await source("app/api/webhooks/resend-auth-email/route.ts");

  assert.match(
    migration,
    /delivery\.status = 'acceptance_uncertain'[\s\S]*p_status in \('sent', 'delayed', 'delivered'\)[\s\S]*delivery\.alert_status in \('pending', 'retry_wait'\) then 'none'/,
  );
  assert.match(
    migration,
    /delivery\.status = 'acceptance_uncertain'[\s\S]*p_status in \('sent', 'delayed', 'delivered'\)[\s\S]*then null/,
  );
  assert.match(migration, /now\(\) \+ interval '5 minutes'/);
  assert.match(webhook, /const deliveryNeedsAlert = authMailStatusNeedsAlert/);
  assert.match(webhook, /recorded\.delivery_id && deliveryNeedsAlert/);
  assert.doesNotMatch(webhook, /hasPendingAlert \|\| authMailStatusNeedsAlert/);
});

test("the first Resend response without a message id becomes uncertainty", async () => {
  const delivery = await source("lib/authMailDelivery.ts");
  const missingMessageId = delivery.slice(
    delivery.indexOf("if (!providerMessageId)"),
    delivery.indexOf("await acceptDelivery"),
  );

  assert.doesNotMatch(missingMessageId, /send_attempt_count|MAX_PROVIDER_SEND_ATTEMPTS/);
  assert.match(missingMessageId, /markDeliveryAcceptanceUncertain/);
  assert.match(missingMessageId, /accepted: true,[\s\S]*uncertain: true/);
});

test("configuration and structured provider errors become alertable immediately", async () => {
  const delivery = await source("lib/authMailDelivery.ts");
  const providerFailure = delivery.slice(
    delivery.indexOf("if (response.error)"),
    delivery.indexOf("const providerMessageId"),
  );

  assert.match(delivery, /code: "auth_mail_not_configured"[\s\S]*retryable: false/);
  assert.match(
    delivery,
    /Configuration failures[\s\S]*await failDelivery\(message\.deliveryKey, transportError\);[\s\S]*throw transportError/,
  );
  assert.match(providerFailure, /await failDelivery\(message\.deliveryKey, error\)/);
  assert.doesNotMatch(providerFailure, /noteAttemptError|send_attempt_count/);
});

test("a dedicated auth Resend key overrides the Marketplace-managed fallback", async () => {
  const delivery = await source("lib/authMailDelivery.ts");

  assert.match(
    delivery,
    /process\.env\.AUTH_RESEND_API_KEY[\s\S]*\|\| requiredEnv\("RESEND_API_KEY"\)/,
  );
});

test("a concurrent Resend idempotency request is uncertain rather than terminal", async () => {
  const delivery = await source("lib/authMailDelivery.ts");
  const providerFailure = delivery.slice(
    delivery.indexOf("if (response.error)"),
    delivery.indexOf("const providerMessageId"),
  );
  const uncertainBranch = providerFailure.slice(
    providerFailure.indexOf("if (isConcurrentIdempotentProviderResponse(error))"),
    providerFailure.indexOf("// A structured provider error"),
  );

  assert.match(
    delivery,
    /function isConcurrentIdempotentProviderResponse[\s\S]*error\.code === "concurrent_idempotent_requests"/,
  );
  assert.match(uncertainBranch, /markDeliveryAcceptanceUncertain/);
  assert.match(uncertainBranch, /accepted: true,[\s\S]*uncertain: true/);
  assert.doesNotMatch(uncertainBranch, /failDelivery|throw error/);
  assert.match(providerFailure, /await failDelivery\(message\.deliveryKey, error\)/);
});

test("provider timeout leaves headroom inside the Supabase five-second hook budget", async () => {
  const delivery = await source("lib/authMailDelivery.ts");
  const timeout = delivery.match(/const PROVIDER_TIMEOUT_MS = ([\d_]+);/);

  assert.ok(timeout);
  assert.ok(Number(timeout[1].replaceAll("_", "")) <= 3_000);
});

test("the alert cron atomically promotes stale pending reservations without resending professionals", async () => {
  const migration = await source("supabase/migrations/20260914221305_auth_email_delivery_tracking.sql");
  const claimFunction = migration.slice(
    migration.indexOf("create or replace function public.claim_auth_email_delivery_alerts"),
  );

  assert.match(claimFunction, /language plpgsql/);
  assert.match(
    claimFunction,
    /update public\.auth_email_deliveries[\s\S]*status = 'acceptance_uncertain'[\s\S]*status_rank = greatest\(delivery\.status_rank, 15\)/,
  );
  assert.match(claimFunction, /delivery\.status = 'pending'/);
  assert.match(claimFunction, /now\(\) - interval '10 minutes'/);
  assert.match(claimFunction, /alert_status = 'pending'[\s\S]*alert_next_attempt_at = now\(\)/);
  assert.doesNotMatch(claimFunction, /resend|sendPreparedAuthEmail/i);
});

test("acceptance never clears diagnostics from a terminal delivery", async () => {
  const migration = await source("supabase/migrations/20260914221305_auth_email_delivery_tracking.sql");
  const acceptanceFunction = migration.slice(
    migration.indexOf("create or replace function public.accept_auth_email_delivery"),
    migration.indexOf("create or replace function public.mark_auth_email_delivery_acceptance_uncertain"),
  );

  assert.match(
    acceptanceFunction,
    /last_error_code = case[\s\S]*when delivery\.status_rank < 50 then null[\s\S]*else delivery\.last_error_code/,
  );
  assert.match(
    acceptanceFunction,
    /last_error_message = case[\s\S]*when delivery\.status_rank < 50 then null[\s\S]*else delivery\.last_error_message/,
  );
});

test("an expired alert lease consumes a new bounded attempt", async () => {
  const migration = await source("supabase/migrations/20260914221305_auth_email_delivery_tracking.sql");
  const claimFunction = migration.slice(
    migration.indexOf("create or replace function public.claim_auth_email_delivery_alerts"),
  );

  assert.match(
    claimFunction,
    /alert_attempt_count = least\([\s\S]*delivery\.alert_attempt_count \+ 1,[\s\S]*delivery\.alert_max_attempts/,
  );
  assert.doesNotMatch(
    claimFunction,
    /when delivery\.alert_status = 'processing' then delivery\.alert_attempt_count/,
  );
  assert.match(
    claimFunction,
    /exhausted_leases as \([\s\S]*alert_status = 'dead'[\s\S]*alert_attempt_count >= delivery\.alert_max_attempts/,
  );
});

test("a secured reconciliation cron processes only due internal alerts every fifteen minutes", async () => {
  const route = await source("app/api/cron/auth-email-alerts/route.ts");
  const delivery = await source("lib/authMailDelivery.ts");
  const vercel = JSON.parse(await source("vercel.json")) as {
    crons?: Array<{ path?: string; schedule?: string }>;
  };

  assert.match(route, /isAuthorizedCronRequest\(request\)/);
  assert.match(route, /hasHeaderCredential/);
  assert.match(route, /processDueAuthEmailFailureAlerts\(\{ limit: 10 \}\)/);
  assert.match(delivery, /export async function processDueAuthEmailFailureAlerts/);
  assert.doesNotMatch(route, /sendPreparedAuthEmail/);
  assert.ok(
    vercel.crons?.some(
      (cron) => cron.path === "/api/cron/auth-email-alerts" && cron.schedule === "*/15 * * * *",
    ),
  );
});
