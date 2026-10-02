import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import test from "node:test";

import { hasActiveAccountSubscription } from "../../lib/accountSubscriptionPolicy.ts";

const ROOT = resolve(import.meta.dirname, "../..");
const read = (relativePath: string) =>
  readFileSync(resolve(ROOT, relativePath), "utf8");
const NOW = Date.parse("2026-10-02T12:00:00.000Z");

test("un abonnement actif et un essai non échu permettent la publication programmée", () => {
  assert.equal(hasActiveAccountSubscription({ status: "active" }, NOW), true);
  assert.equal(
    hasActiveAccountSubscription(
      { status: "trialing", trial_end_at: "2026-10-02T12:00:01.000Z" },
      NOW,
    ),
    true,
  );
  assert.equal(
    hasActiveAccountSubscription(
      { status: "trialing", start_date: "2026-09-12T12:00:00.000Z" },
      NOW,
    ),
    true,
  );
});

test("l'essai expiré, y compris à l'instant exact de fin, bloque l'envoi", () => {
  for (const subscription of [
    { status: "trial_expired" },
    { status: "trialing", trial_end_at: "2026-10-02T11:59:59.000Z" },
    { status: "trialing", trial_end_at: "2026-10-02T12:00:00.000Z" },
    { status: "trialing", start_date: "2026-09-11T12:00:00.000Z" },
    { status: "trialing" },
    null,
  ]) {
    assert.equal(
      hasActiveAccountSubscription(subscription, NOW),
      false,
      `l'accès devrait être refusé pour ${JSON.stringify(subscription)}`,
    );
  }
});

test("la vérification serveur lit le statut et l'échéance de l'abonnement du titulaire", () => {
  const access = read("lib/accountSubscriptionAccess.ts");
  assert.match(access, /\.from\("inrcy_account_members"\)/);
  assert.match(access, /ownerByAccount\.get\(accountId\)/);
  assert.match(access, /\.select\("user_id,status,trial_end_at,start_date"\)/);
  assert.match(access, /hasActiveAccountSubscription\(subscription, nowMs\)/);
  assert.match(access, /if \(membershipError\) throw/);
  assert.match(access, /if \(subscriptionError\) throw/);
});

test("le cron écarte un compte expiré avant de réclamer puis d'exécuter sa publication", () => {
  const route = read("app/api/cron/inr-agent-scheduled-actions/route.ts");
  const process = route.slice(
    route.indexOf("async function processDueScheduledActions"),
    route.indexOf("export async function POST"),
  );
  const eligibilityLookup = process.indexOf("getActiveSubscriptionAccountIds(");
  const eligibilityGuard = process.indexOf("if (!activeAccountIds.has(row.user_id))");
  const claim = process.indexOf("claimAction(row)");
  const dispatch = process.indexOf("executeScheduledAction(claimed");

  assert.ok(eligibilityLookup >= 0, "le cron doit vérifier l'abonnement des comptes échus");
  assert.ok(eligibilityGuard > eligibilityLookup, "chaque ligne doit être filtrée par abonnement");
  assert.ok(claim > eligibilityGuard, "un compte expiré ne doit pas réclamer le job");
  assert.ok(dispatch > eligibilityGuard, "un compte expiré ne doit pas déclencher l'envoi");
  assert.match(process.slice(eligibilityGuard, claim), /subscription_inactive[\s\S]*?continue;/);
});

test("la route finale revérifie l'abonnement pour tout appel interne du cron", () => {
  const route = read("app/api/booster/publish-now/route.ts");
  const identity = route.indexOf("const cronUserId = isAuthorizedCronRequest(req)");
  const guard = route.indexOf("getActiveSubscriptionAccountIds([userId])", identity);
  const body = route.indexOf("let body = await req.json()", identity);
  const dispatch = route.indexOf("const internalAsyncDispatch =", body);

  assert.ok(identity >= 0, "le point d'entrée cron doit être identifié");
  assert.ok(body > identity && guard > body, "l'identifiant du parent doit être extrait avant le contrôle");
  assert.ok(dispatch > guard, "le refus doit intervenir avant toute préparation ou publication");
  assert.match(route.slice(body, dispatch), /terminateAsyncPublicationForInactiveSubscription/);
  assert.match(route.slice(body, dispatch), /code: "subscription_inactive"/);
  assert.match(route.slice(body, dispatch), /code: "subscription_check_unavailable"/);
});

test("les crons iNr'Agent ne préparent plus de contenu pour un essai expiré", () => {
  const automationCron = read("app/api/cron/inr-agent/route.ts");
  const automationGuard = automationCron.indexOf("if (!activeAccountIds.has(row.user_id))");
  const automationRun = automationCron.indexOf("processAutomation({ row, origin");
  assert.match(automationCron, /getActiveSubscriptionAccountIds\(/);
  assert.ok(automationGuard >= 0 && automationRun > automationGuard);

  const editorialCron = read("app/api/cron/inr-agent-editorial-plan/route.ts");
  const editorialGuard = editorialCron.indexOf("if (!activeAccountIds.has(row.user_id))");
  const editorialPlan = editorialCron.indexOf("reconcileInrAgentEditorialPlan({");
  const editorialPreparation = editorialCron.indexOf("prepareNextInrAgentEditorialSlot({");
  assert.match(editorialCron, /getActiveSubscriptionAccountIds\(/);
  assert.ok(editorialGuard >= 0 && editorialPlan > editorialGuard);
  assert.ok(editorialPreparation > editorialGuard);
});

test("les routes internes iNr'Agent refusent un compte expiré dès la résolution de requête", () => {
  const resolver = read("lib/inrAgentRequest.ts");
  const cronBranch = resolver.slice(
    resolver.indexOf("if (cronUserId) {"),
    resolver.indexOf("if (isAuthorizedCronRequest(request))"),
  );
  const subscriptionCheck = cronBranch.indexOf("getActiveSubscriptionAccountIds([cronUserId])");
  const serviceRoleReturn = cronBranch.indexOf("supabase: supabaseAdmin");

  assert.ok(subscriptionCheck >= 0 && serviceRoleReturn > subscriptionCheck);
  assert.match(cronBranch, /code: "subscription_inactive"/);
  assert.match(cronBranch, /code: "subscription_check_unavailable"/);
  assert.match(cronBranch, /errorResponse: subscriptionErrorResponse/);
});

test("une reprise Booster traite le refus d'abonnement comme terminal", () => {
  const cron = read("app/api/cron/booster-publications/route.ts");
  assert.match(
    cron,
    /response\.status !== 403[\s\S]*?body\.code === "subscription_inactive"/,
  );
  for (const [start, end] of [
    ["async function dispatchPreparationJob", "async function dispatchChannelJob"],
    ["async function dispatchChannelJob", "export async function GET"],
  ]) {
    const dispatch = cron.slice(cron.indexOf(start), cron.indexOf(end));
    const markerGuard = dispatch.indexOf("isAsyncPublicationMarkedSubscriptionInactive({");
    const networkCall = dispatch.indexOf("await fetch(");
    const inactiveResponse = dispatch.indexOf("isSubscriptionInactiveDispatchResponse(response)");
    assert.ok(markerGuard >= 0 && markerGuard < networkCall, `${start} doit relire le marqueur avant l'envoi`);
    assert.ok(inactiveResponse > networkCall, `${start} doit intercepter le 403 d'abonnement`);
    assert.match(dispatch.slice(inactiveResponse), /terminateAsyncPublicationForInactiveSubscription\(/);
  }
  assert.match(cron, /\.not\("payload->>subscriptionInactiveAt", "is", null\)/);
  assert.match(cron, /markedJobs\.map\(\(job\) =>[\s\S]*?terminateAsyncPublicationForInactiveSubscription\(/);

  const persistence = read("lib/boosterAsyncPublication.ts");
  const terminal = persistence.slice(
    persistence.indexOf("export async function terminateAsyncPublicationForInactiveSubscription"),
    persistence.indexOf("export async function readAsyncPublicationStatus"),
  );
  const markerWrite = terminal.indexOf("patch: { subscriptionInactiveAt }");
  const childFailure = terminal.indexOf('code: "subscription_inactive"');
  assert.ok(markerWrite >= 0 && childFailure > markerWrite, "le marqueur durable doit précéder l'échec des canaux");
  assert.match(terminal, /status: "failed"/);
  assert.match(terminal, /retryable: false/);
  assert.match(terminal, /return finalizeAsyncPublicationIfReady\(params\)/);
});
