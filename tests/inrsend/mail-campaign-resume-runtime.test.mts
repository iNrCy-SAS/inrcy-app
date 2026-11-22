import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";

type Row = Record<string, unknown>;
const ACCOUNT = "account-a", CAMPAIGN = "campaign-a", INTEGRATION = "integration-a";
const baseConfig = { batchSize: 5, sendDelayMs: 8_000, batchPauseMs: 60_000, hourlyLimit: 150, dailyLimit: 300, maxActivePerIntegration: 1, lockLeaseSeconds: 180 };
const adaptiveConfig = { ...baseConfig, batchSize: 2, hourlyLimit: 60, dailyLimit: 150 };
const load = runtimeModules();
const connections = load<typeof import("../../lib/connectionVersions.ts")>("lib/connectionVersions.ts");
const source = ts.transpileModule(readFileSync(new URL("../../app/api/crm/campaigns/[id]/retry/route.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText;

function nativeReputationFunction(name: string, context: Row): (...args: unknown[]) => unknown {
  const text = readFileSync(new URL("../../lib/mailboxReputation.ts", import.meta.url), "utf8");
  const ast = ts.createSourceFile("mailboxReputation.ts", text, ts.ScriptTarget.ES2022, true);
  const declaration = ast.statements.find((node): node is ts.FunctionDeclaration => ts.isFunctionDeclaration(node) && node.name?.text === name);
  assert.ok(declaration);
  const js = ts.transpileModule(`return (${declaration.getText(ast).replace(/^export /, "")});`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(context), js)(...Object.values(context));
}

function fixture(options: {
  campaign?: Row; integration?: Row | null; recipients?: Row[]; reputationBlocked?: boolean;
  dispatch?: "ready" | "paused" | "waiting_turn"; readError?: string; updateError?: string;
  noUpdatedCampaign?: boolean; quotaError?: boolean; suppressed?: string[];
  concurrentChange?: Row;
} = {}) {
  const campaign: Row = { id: CAMPAIGN, user_id: ACCOUNT, status: "paused", integration_id: INTEGRATION,
    pause_reason: "mailbox_reputation_paused", resume_at: "2026-11-18T21:12:18Z", updated_at: "2026-11-18T15:12:18Z", ...options.campaign };
  const integration = options.integration === null ? null : { id: INTEGRATION, user_id: ACCOUNT, category: "mail", provider: "microsoft", status: "connected", account_email: "sender@example.test", settings: {}, ...options.integration };
  const recipients: Row[] = options.recipients || Array.from({ length: 216 }, (_, index) => ({ id: `recipient-${index}`, user_id: ACCOUNT, campaign_id: CAMPAIGN, email: `recipient-${index}@example.test`, status: index < 20 ? "sent" : "queued", attempt_count: index < 20 ? 1 : 0 }));
  const operations: string[] = [], capturedErrors: unknown[] = [], quotaCalls: Row[] = [];
  const updates: Array<{ table: string; patch: Row; filters: Map<string, unknown> }> = [];
  function from(table: string) {
    const filters = new Map<string, unknown>(), inFilters = new Map<string, unknown[]>();
    let patch: Row | null = null, single = false;
    const query = {
      select() { return query; }, eq(key: string, value: unknown) { filters.set(key, value); return query; },
      is(key: string, value: null) { filters.set(key, value); return query; },
      in(key: string, value: unknown[]) { inFilters.set(key, value); return query; }, limit() { return query; },
      maybeSingle() { single = true; return query; }, update(value: Row) { patch = value; return query; },
      then(resolve: (result: { data: unknown; error: unknown }) => unknown, reject: (error: unknown) => unknown) {
        try {
          assert.equal(filters.get("user_id"), ACCOUNT, "Every request-scoped database access stays in the active account");
          operations.push(`${patch ? "update" : "read"}:${table}`);
          if (options.readError === table && !patch) return Promise.resolve({ data: null, error: new Error("PRIVATE_SQL_FAILURE") }).then(resolve, reject);
          if (patch && table === "mail_campaigns" && options.concurrentChange) Object.assign(campaign, options.concurrentChange);
          const sourceRows = table === "mail_campaigns" ? [campaign] : table === "integrations" ? integration ? [integration] : [] : table === "mail_campaign_recipients" ? recipients : [];
          let rows = sourceRows.filter(row => [...filters].every(([key, value]) => row[key] === value) && [...inFilters].every(([key, values]) => values.includes(row[key])));
          if (patch) {
            updates.push({ table, patch, filters });
            if (options.updateError === table) return Promise.resolve({ data: null, error: new Error("PRIVATE_SQL_UPDATE_FAILURE") }).then(resolve, reject);
            if (options.noUpdatedCampaign && table === "mail_campaigns") rows = [];
            for (const row of rows) Object.assign(row, patch);
          }
          const snapshots = rows.map(row => ({ ...row }));
          return Promise.resolve({ data: single ? snapshots[0] || null : snapshots, error: null }).then(resolve, reject);
        } catch (error) { return Promise.reject(error).then(resolve, reject); }
      },
    };
    return query;
  }
  const modules: Record<string, unknown> = {
    "next/server": { NextResponse: { json: (body: unknown, init?: ResponseInit) => Response.json(body, init) } },
    "@/lib/requireUser": { requireUser: async () => ({ supabase: { from }, activeUserId: ACCOUNT, authUserId: "different-actor", errorResponse: null }) },
    "@/lib/rateLimit": { enforceRateLimit: async () => null },
    "@/lib/mailSuppression": { fetchSuppressedEmailsByUser: async (userId: string) => { assert.equal(userId, ACCOUNT); operations.push("suppression"); return new Map((options.suppressed || []).map(email => [email, {}])); } },
    "@/lib/mailCampaignPacing": { getMailCampaignDeliveryConfig: () => baseConfig },
    "@/lib/connectionVersions": connections,
    "@/lib/mailboxReputation": { resolveMailboxReputationPolicy: async (args: Row) => {
      assert.equal(args.userId, ACCOUNT); assert.equal(args.integrationId, INTEGRATION);
      operations.push("reputation");
      return { blocked: options.reputationBlocked === true, blockedReason: "La réputation de cette boîte nécessite une vérification avant de reprendre les campagnes.",
        resumeAt: "2026-11-18T21:12:18Z", config: adaptiveConfig };
    } },
    "@/lib/crmCampaigns": { evaluateCampaignDispatchState: async (args: Row) => {
      quotaCalls.push(args); operations.push("quota");
      assert.equal(args.userId, ACCOUNT); assert.equal(args.integrationId, INTEGRATION); assert.equal(args.currentCampaignId, CAMPAIGN);
      assert.equal(args.config, adaptiveConfig, "Manual resume uses the same mailbox policy limits as the worker");
      if (options.quotaError) throw new Error("PRIVATE_QUOTA_DATABASE_ERROR");
      const state = options.dispatch || "ready";
      return { state, reason: state === "paused" ? "Quota horaire atteint." : state === "waiting_turn" ? "Une autre campagne est en cours." : null,
        pauseReason: state === "paused" ? "hourly_quota" : state === "waiting_turn" ? "waiting_turn" : null,
        resumeAt: state === "ready" ? null : "2026-11-18T21:12:18Z", availableNow: state === "ready" ? 2 : 0 };
    } },
    "@/lib/observability/sentry": { captureApiException: (_req: Request, error: unknown) => capturedErrors.push(error) },
    "@/lib/observability/request": { getRequestId: (req: Request) => req.headers.get("x-request-id") },
    "@/lib/observability/withApi": { withApi: (handler: unknown) => handler },
  };
  const loaded = { exports: {} as { POST: (req: Request, ctx: unknown) => Promise<Response> } };
  new Function("require", "module", "exports", "fetch", source)((name: string) => {
    assert.ok(name in modules, `Unexpected production dependency: ${name}`);
    return modules[name];
  }, loaded, loaded.exports, () => { throw new Error("SMTP, Graph and all network calls are forbidden in these tests"); });
  return { campaign, recipients, operations, updates, quotaCalls, capturedErrors, async run() {
    const response = await loaded.exports.POST(new Request(`https://fixture.invalid/api/crm/campaigns/${CAMPAIGN}/retry`, { method: "POST", headers: { "x-request-id": "request-test" } }), { params: Promise.resolve({ id: CAMPAIGN }) });
    return { status: response.status, body: await response.json() };
  } };
}

test("Paul's 20 accepted and 196 pending remain unchanged throughout an active reputation cooldown", async () => {
  const h = fixture({ reputationBlocked: true });
  const before = JSON.stringify(h.recipients);
  const result = await h.run();
  assert.equal(result.status, 200); assert.equal(result.body.resumed, false);
  assert.equal(result.body.retried, 0); assert.equal(result.body.queuedForBackgroundDispatch, false);
  assert.equal(result.body.reasonCode, "mailbox_reputation_paused");
  assert.equal(result.body.pauseReason, "mailbox_reputation_paused");
  assert.equal(result.body.campaignStatus, "paused"); assert.equal(result.body.resumeAt, "2026-11-18T21:12:18Z");
  assert.equal(result.body.hourlyLimit, 60); assert.equal(result.body.dailyLimit, 150);
  assert.equal(JSON.stringify(h.recipients), before); assert.equal(h.updates.length, 0);
  assert.equal(h.quotaCalls.length, 0); assert.ok(!h.operations.includes("read:mail_campaign_recipients"));
});

for (const state of ["paused", "waiting_turn"] as const) test(`a ${state} dispatch state cannot reset recipient retries or claim the campaign resumed`, async () => {
  const h = fixture({ dispatch: state });
  const result = await h.run();
  assert.equal(result.status, 200); assert.equal(result.body.resumed, false);
  assert.equal(result.body.retried, 0); assert.equal(result.body.queuedForBackgroundDispatch, false);
  assert.equal(result.body.distributionState, state); assert.equal(result.body.campaignStatus, "paused");
  assert.equal(h.updates.length, 0); assert.equal(h.campaign.resume_at, "2026-11-18T21:12:18Z");
});

test("after readiness is confirmed, a paused campaign with no failed recipients is queued without touching accepted mails", async () => {
  const h = fixture(); const before = JSON.stringify(h.recipients);
  const result = await h.run();
  assert.equal(result.status, 200); assert.equal(result.body.resumed, true);
  assert.equal(result.body.retried, 0); assert.equal(result.body.campaignStatus, "queued");
  assert.equal(result.body.queuedForBackgroundDispatch, true); assert.equal(result.body.reasonCode, null);
  assert.equal(h.campaign.pause_reason, null); assert.equal(h.campaign.resume_at, null);
  assert.equal(JSON.stringify(h.recipients), before);
  assert.equal(h.updates.length, 1);
  assert.ok(h.operations.indexOf("reputation") < h.operations.indexOf("update:mail_campaigns"));
});

for (const pauseReason of ["rate_limited", "provider_quota", "quota_exceeded", "provider_unavailable", "provider_issue", "outlook_transfer_budget", "outlook_transfer_unavailable"]) test(`a future ${pauseReason} deadline is respected even when mailbox reputation and local quotas permit sending`, async () => {
  const resumeAt = new Date(Date.now() + 120_000).toISOString();
  const h = fixture({ campaign: { pause_reason: pauseReason, resume_at: resumeAt } });
  const before = JSON.stringify(h.recipients); const result = await h.run();
  assert.equal(result.status, 200); assert.equal(result.body.resumed, false);
  assert.equal(result.body.reasonCode, pauseReason === "quota_exceeded" ? "provider_quota" : pauseReason);
  assert.equal(result.body.resumeAt, resumeAt); assert.equal(result.body.queuedForBackgroundDispatch, false);
  assert.equal(h.quotaCalls.length, 0); assert.equal(h.updates.length, 0);
  assert.equal(JSON.stringify(h.recipients), before);
});

test("after the provider deadline expires, a valid mailbox can queue the 196 pending recipients without resetting the 20 accepted", async () => {
  const h = fixture({ campaign: { pause_reason: "rate_limited", resume_at: new Date(Date.now() - 1_000).toISOString() } });
  const before = JSON.stringify(h.recipients); const result = await h.run();
  assert.equal(result.status, 200); assert.equal(result.body.resumed, true);
  assert.equal(result.body.queuedForBackgroundDispatch, true); assert.equal(h.quotaCalls.length, 1);
  assert.equal(h.recipients.filter(row => row.status === "sent").length, 20);
  assert.equal(h.recipients.filter(row => row.status === "queued").length, 196);
  assert.equal(JSON.stringify(h.recipients), before);
});

for (const integration of [null, { user_id: "foreign-account" }, { category: "social" }]) test("an absent, foreign or non-mail integration is not silently rebound to another connected Microsoft account", async () => {
  const h = fixture({ integration });
  const result = await h.run();
  assert.equal(result.status, 409); assert.equal(result.body.code, "mailbox_missing");
  assert.equal(h.updates.length, 0); assert.equal(h.quotaCalls.length, 0);
  assert.equal(h.campaign.integration_id, INTEGRATION);
});

for (const integration of [{ status: "disconnected" }, { settings: { needs_reconnect: true } }]) test("a disconnected or revoked mailbox is refused before policy and recipient changes", async () => {
  const h = fixture({ integration }); const result = await h.run();
  assert.equal(result.status, 409); assert.equal(result.body.code, "mailbox_reconnect_required");
  assert.equal(h.updates.length, 0); assert.ok(!h.operations.includes("reputation"));
});

test("only eligible failed recipients are reset; accepted, waiting, hard-bounced and suppressed recipients are preserved", async () => {
  const row = (id: string, status: string, extra: Row = {}) => ({ id, user_id: ACCOUNT, campaign_id: CAMPAIGN, email: `${id}@example.test`, status, attempt_count: 2, ...extra });
  const h = fixture({ recipients: [row("sent", "sent"), row("waiting", "queued"), row("retry", "failed"), row("hard", "failed", { bounce_type: "hard" }), row("optout", "failed", { suppression_reason: "opt_out" }), row("suppressed", "failed")], suppressed: ["suppressed@example.test"] });
  const result = await h.run();
  assert.equal(result.status, 200); assert.equal(result.body.retried, 1); assert.equal(result.body.blocked, 3);
  assert.equal(h.recipients.find(row => row.id === "retry")?.status, "queued");
  assert.equal(h.recipients.find(row => row.id === "retry")?.attempt_count, 0);
  for (const id of ["hard", "optout", "suppressed"]) assert.equal(h.recipients.find(row => row.id === id)?.status, "failed");
  assert.equal(h.recipients.find(row => row.id === "sent")?.attempt_count, 2);
  assert.equal(h.recipients.find(row => row.id === "waiting")?.attempt_count, 2);
  assert.ok(h.operations.indexOf("quota") < h.operations.indexOf("update:mail_campaign_recipients"));
});

for (const options of [{ readError: "mail_campaigns" }, { readError: "integrations" }, { readError: "mail_campaign_recipients" }, { quotaError: true }, { updateError: "mail_campaigns" }]) test("database failures never become a successful resume or expose raw SQL", async () => {
  const h = fixture(options); const result = await h.run();
  assert.equal(result.status, 500); assert.equal(result.body.success, false);
  assert.equal(result.body.code, "campaign_resume_unavailable"); assert.equal(result.body.request_id, "request-test");
  assert.doesNotMatch(JSON.stringify(result.body), /PRIVATE_|SQL|QUOTA_DATABASE/);
  assert.equal(h.capturedErrors.length, 1); assert.equal(h.campaign.status, "paused");
});

test("a failed recipient reset is not followed by a campaign resume", async () => {
  const h = fixture({ updateError: "mail_campaign_recipients", recipients: [{ id: "failed", user_id: ACCOUNT, campaign_id: CAMPAIGN, email: "failed@example.test", status: "failed", attempt_count: 2 }] });
  const result = await h.run();
  assert.equal(result.status, 500); assert.equal(result.body.code, "campaign_resume_unavailable");
  assert.equal(h.recipients[0].status, "failed"); assert.equal(h.campaign.status, "paused");
  assert.ok(!h.operations.includes("update:mail_campaigns"));
});

test("a campaign whose old mailbox reference became null gets an actionable guard without a database UUID error", async () => {
  const h = fixture({ campaign: { integration_id: null } }); const result = await h.run();
  assert.equal(result.status, 409); assert.equal(result.body.code, "mailbox_missing");
  assert.ok(!h.operations.includes("read:integrations")); assert.equal(h.updates.length, 0);
});

test("the native reputation policy expires a timed pause into cautious watch, while future and indefinite pauses stay blocked", async () => {
  const clampConfig = nativeReputationFunction("clampConfig", {});
  const buildAdaptiveMailboxConfig = nativeReputationFunction("buildAdaptiveMailboxConfig", { clampConfig, getMailCampaignDeliveryConfig: () => baseConfig });
  for (const pause of ["past", "future", "indefinite"]) {
    const pausedUntil = pause === "indefinite" ? null : new Date(Date.now() + (pause === "future" ? 60_000 : -60_000)).toISOString();
    const policy = nativeReputationFunction("resolveMailboxReputationPolicy", {
      normalizeProvider: () => "microsoft",
      loadReputationRow: async () => ({ health_status: "paused", paused_until: pausedUntil, accepted_count: 20 }),
      auditFromRow: () => ({ checkedAt: new Date().toISOString(), customDomain: false, spf: "managed", dkim: "managed", dmarc: "managed", warnings: [] }),
      buildAdaptiveMailboxConfig,
      auditMailDomainAuthentication: () => { throw new Error("No network is allowed in policy expiration tests"); },
    });
    const result = await policy({ userId: ACCOUNT, integrationId: INTEGRATION, provider: "microsoft", accountEmail: "fixture@outlook.com" }) as Row;
    assert.equal(result.blocked, pause !== "past");
    assert.equal(result.healthStatus, pause === "past" ? "watch" : "paused");
    if (pause === "past") {
      assert.equal(result.mode, "cautious"); assert.equal((result.config as Row).hourlyLimit, 60);
    }
  }
});

test("a campaign update affecting no row is not reported as resumed", async () => {
  const h = fixture({ noUpdatedCampaign: true }); const result = await h.run();
  assert.equal(result.status, 409); assert.equal(result.body.code, "campaign_state_changed");
  assert.equal(h.campaign.status, "paused");
});

for (const concurrentChange of [{ status: "completed" }, { integration_id: "replacement-mailbox" }]) test("a concurrent campaign state or mailbox change is preserved instead of overwritten by resume", async () => {
  const h = fixture({ concurrentChange }); const result = await h.run();
  assert.equal(result.status, 409); assert.equal(result.body.code, "campaign_state_changed");
  const attemptedUpdate = h.updates.find(update => update.table === "mail_campaigns")!;
  assert.equal(attemptedUpdate.filters.get("status"), "paused");
  assert.equal(attemptedUpdate.filters.get("integration_id"), INTEGRATION);
  for (const [key, value] of Object.entries(concurrentChange)) assert.equal(h.campaign[key], value);
  assert.equal(h.recipients.filter(row => row.status === "sent").length, 20);
  assert.equal(h.recipients.filter(row => row.status === "queued").length, 196);
  assert.ok(!h.operations.includes("update:mail_campaign_recipients"));
});

test("a campaign owned by another account cannot reach mailbox policy or mutations", async () => {
  const h = fixture({ campaign: { user_id: "foreign-account" } }); const result = await h.run();
  assert.equal(result.status, 404); assert.equal(result.body.code, "campaign_not_found");
  assert.equal(h.updates.length, 0); assert.equal(h.operations.length, 1);
});

test("a newer paused cooldown with the same mailbox and status cannot be cleared by an older resume request", async () => {
  const newResumeAt = new Date(Date.now() + 3_600_000).toISOString();
  const h = fixture({ concurrentChange: { status: "paused", pause_reason: "rate_limited", resume_at: newResumeAt, updated_at: "2026-11-18T15:13:19Z" } });
  const result = await h.run();
  assert.equal(result.status, 409); assert.equal(result.body.code, "campaign_state_changed");
  assert.equal(h.campaign.resume_at, newResumeAt); assert.equal(h.campaign.pause_reason, "rate_limited");
  assert.equal(h.campaign.status, "paused"); assert.equal(h.campaign.integration_id, INTEGRATION);
  assert.equal(h.updates.at(-1)?.filters.get("updated_at"), "2026-11-18T15:12:18Z");
  assert.ok(!h.operations.includes("update:mail_campaign_recipients"));
});

test("a legacy null campaign version remains resumable until a concurrent writer gives it a newer version", async () => {
  const unchanged = fixture({ campaign: { updated_at: null } });
  assert.equal((await unchanged.run()).status, 200);
  assert.equal(unchanged.updates.at(-1)?.filters.get("updated_at"), null);
  const changed = fixture({ campaign: { updated_at: null }, concurrentChange: { updated_at: "2026-11-18T15:13:19Z", pause_reason: "rate_limited" } });
  assert.equal((await changed.run()).status, 409);
  assert.equal(changed.campaign.status, "paused");
  assert.equal(changed.campaign.pause_reason, "rate_limited");
});
