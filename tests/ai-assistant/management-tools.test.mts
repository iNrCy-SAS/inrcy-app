import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { asSchema, jsonSchema, tool } from "ai";
import * as settingsLib from "../../lib/inrAgentSettings.ts";
import { inrAgentMonthlyDateCount } from "../../lib/inrAgentMonthSchedule.ts";
import { currentSubscriptionOffer } from "../../lib/subscriptionOffers.ts";
import type * as Management from "../../lib/inrAssistantManagementTools.ts";

const accountId = "10000000-0000-4000-8000-000000000001", actorUserId = "20000000-0000-4000-8000-000000000001";
const actionRequestId = `${accountId}_30000000-0000-4000-8000-000000000001`;
type Row = Record<string, unknown>;
type AgentInput = Parameters<NonNullable<ReturnType<typeof Management.createInrAssistantManagementTools>["configureAgentAutomation"]["execute"]>>[0];
const weekly = { frequency: "weekly", timezone: "Europe/Paris", slots: [{ dayOfWeek: 1, time: "09:00" }], monthDays: null, time: null } as const;
function harness(options: { message?: string; edition?: "standard" | "premium" | "founder"; initial?: settingsLib.InrAgentSettings;
  state?: { value: settingsLib.InrAgentSettings }; scopeMismatchAt?: number; tableMissing?: boolean; getFailure?: boolean;
  postCode?: string; postFailure?: boolean; adjusted?: boolean } = {}) {
  const state = options.state ?? { value: options.initial ?? settingsLib.sanitizeInrAgentSettings(null) };
  let authCalls = 0;
  const requests: Request[] = [], posts: Row[] = [];
  const dependencies: Record<string, unknown> = {
    "server-only": {}, "node:crypto": { createHash }, ai: { jsonSchema, tool },
    "./inrAgentSettings.ts": settingsLib, "./inrAgentMonthSchedule.ts": { inrAgentMonthlyDateCount },
    "./subscriptionOffers.ts": { currentSubscriptionOffer },
    "@/lib/requireUser": { requireUser: async () => { authCalls++; return { authUserId: actorUserId,
      activeUserId: authCalls === options.scopeMismatchAt ? "foreign" : accountId, errorResponse: null }; } },
    "@/app/api/agent/settings/route": {
      GET: async (request: Request) => { requests.push(request); if (options.getFailure) throw new Error("PRIVATE GET STACK AND TOKEN");
        return Response.json({ settings: state.value, tableMissing: options.tableMissing ?? false }); },
      POST: async (request: Request) => { requests.push(request); const body = await request.json(); posts.push(body);
        if (options.postFailure) throw new Error("PRIVATE POST STACK AND TOKEN");
        if (options.postCode) return Response.json({ code: options.postCode, error: "PRIVATE API ERROR", impact: { secret: "PRIVATE CONTRACT" } }, { status: 409 });
        state.value = settingsLib.sanitizeInrAgentSettings(body.settings);
        if (options.adjusted) state.value.automations.stats.enabled = false;
        return Response.json({ saved: true, settings: state.value, private: "PRIVATE SERVER DETAILS" }); },
    },
  };
  const compiled = ts.transpileModule(readFileSync(new URL("../../lib/inrAssistantManagementTools.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const moduleRecord = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, {
    Date, Intl, URL, Request, Response, Headers, fetch() { assert.fail("No financial/provider request may run in management tests"); },
  })((name: string) => { assert.ok(Object.hasOwn(dependencies, name), `Unexpected dependency ${name}`); return dependencies[name]; }, moduleRecord, moduleRecord.exports);
  const runtime = moduleRecord.exports as typeof Management;
  const source = new Request("https://app.inrcy.com/api/assistant/chat", { headers: { cookie: "PRIVATE SESSION", authorization: "Bearer PRIVATE AUTH", "x-account-id": "foreign", "x-extra-secret": "PRIVATE HEADER" } });
  const tools = runtime.createInrAssistantManagementTools({ accountId, actorUserId, request: source, edition: options.edition ?? "standard",
    currentUserMessage: options.message ?? "Active l’agent Statistiques chaque lundi à neuf heures.", actionRequestId });
  const configure = async (input: unknown): Promise<Row> => await tools.configureAgentAutomation.execute!(input as AgentInput, { toolCallId: "test", messages: [] }) as Row;
  const billing = async (input: unknown): Promise<Row> => await tools.prepareSubscriptionAction.execute!(input as never, { toolCallId: "test", messages: [] }) as Row;
  return { configure, billing, tools, state, posts, requests, source, get authCalls() { return authCalls; } };
}

test("billing prepares current catalogue and real UI destinations without invoking checkout, cancellation or contract reads", async () => {
  const h = harness({ message: "Je veux gérer mon abonnement Premium annuel et mes factures." });
  for (const action of ["compare", "subscribe", "change_plan", "manage", "cancel", "invoices"]) {
    const result = await h.billing({ action, plan: "Premium", billingCycle: "yearly" });
    assert.equal(result.ok, true);
    assert.equal(result.status, "requires_user_completion");
    assert.equal(result.billingChanged, false);
    assert.equal((result.link as Row).href, action === "invoices" ? "/dashboard?panel=factures" : "/dashboard?panel=abonnement");
    assert.equal((result.catalogue as Row[])[0].yearlyEur, currentSubscriptionOffer("Premium").yearlyPriceEur);
    assert.equal((result.catalogue as Row[])[0].source, "public_web_catalogue_not_personal_contract");
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|stripe_customer|stripe_subscription|checkout\.stripe|signature|token/);
  }
  assert.equal(h.requests.length, 0);
  assert.equal(h.posts.length, 0);
  assert.equal((await h.billing({ action: "subscribe", plan: "Premium", billingCycle: null })).status, "details_required");
  assert.equal((await harness({ message: "Bonjour" }).billing({ action: "subscribe", plan: "Premium", billingCycle: "yearly" })).status, "instruction_required");
});

test("activation requires a current instruction and explicit schedule, never a question or old tool result", async () => {
  for (const message of ["Comment activer l’agent Stats ?", "Explique les réglages de l’agent Stats", "Bonjour", "N’active pas l’agent Stats",
    "Active l’agent Publications chaque lundi à neuf heures", "Active mon agent chaque lundi à neuf heures"]) {
    const h = harness({ message });
    assert.equal((await h.configure({ agent: "stats", enabled: true, schedule: weekly })).status, "instruction_required");
    assert.equal(h.requests.length, 0);
  }
  const missing = harness();
  assert.equal((await missing.configure({ agent: "stats", enabled: true })).status, "schedule_required");
  assert.equal(missing.posts.length, 0);
  for (const [message, enabled] of [["Ne désactive pas l’agent Stats", false], ["Ne change pas les réglages de l’agent Stats", null]] as const) {
    const h = harness({ message });
    assert.equal((await h.configure({ agent: "stats", enabled, schedule: weekly })).status, "instruction_required");
    assert.equal(h.requests.length, 0);
  }
});

test("Standard gates email agents and mail statistics before private API reads", async () => {
  const h = harness({ message: "Active tous mes agents et les statistiques mails" });
  for (const agent of ["grow", "loyalty"]) assert.equal((await h.configure({ agent, enabled: true, schedule: weekly })).status, "not_included");
  assert.equal((await h.configure({ agent: "stats", themes: ["mails"] })).status, "not_included");
  assert.equal(h.requests.length, 0);
});

test("actual API request preserves authentication and merges a single agent without losing references or other agents", async () => {
  const initial = settingsLib.sanitizeInrAgentSettings(null);
  initial.automations.publish.metadata = { ...initial.automations.publish.metadata, references: { token: "PRIVATE REFERENCE", ids: ["PRIVATE MEDIA"] }, customOption: "keep" };
  initial.automations.grow.metadata = { ...initial.automations.grow.metadata, privateEmails: ["PRIVATE CLIENT"] };
  const h = harness({ initial });
  const result = await h.configure({ agent: "stats", enabled: true, schedule: weekly });
  assert.equal(result.status, "saved");
  assert.equal(h.posts.length, 1);
  const saved = (h.posts[0].settings as settingsLib.InrAgentSettings);
  assert.equal(saved.automations.stats.enabled, true);
  assert.equal(saved.automations.stats.time, "09:00");
  assert.equal(saved.automations.stats.dayOfWeek, 1);
  assert.equal(saved.globalEnabled, true);
  assert.deepEqual(saved.automations.publish, initial.automations.publish);
  assert.deepEqual(saved.automations.grow, initial.automations.grow);
  assert.deepEqual(saved.automations.loyalty, initial.automations.loyalty);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|references|metadata|assistantManagementAction/);
  for (const request of h.requests) {
    assert.equal(new URL(request.url).pathname, "/api/agent/settings");
    assert.equal(new URL(request.url).origin, "https://app.inrcy.com");
    assert.equal(request.headers.get("cookie"), "PRIVATE SESSION");
    assert.equal(request.headers.get("authorization"), "Bearer PRIVATE AUTH");
    assert.equal(request.headers.get("x-account-id"), null);
    assert.equal(request.headers.get("x-extra-secret"), null);
  }
});

test("in-flight duplicate calls and stable retry after another factory cannot repeat activation side effects", async () => {
  const state = { value: settingsLib.sanitizeInrAgentSettings(null) };
  const h = harness({ state });
  const input = { agent: "stats", enabled: true, schedule: weekly };
  await Promise.all([h.configure(input), h.configure(input)]);
  assert.equal(h.posts.length, 1);
  const retry = harness({ state });
  assert.equal((await retry.configure(input)).status, "previous_attempt_recorded");
  assert.equal(retry.posts.length, 0);
});

test("matching state is a no-op even without an earlier assistant marker", async () => {
  const initial = settingsLib.sanitizeInrAgentSettings(null);
  initial.globalEnabled = true; initial.enabled = true; initial.automations.stats.enabled = true; initial.automations.stats.time = "09:00";
  const h = harness({ initial });
  assert.equal((await h.configure({ agent: "stats", enabled: true, schedule: weekly })).status, "already_configured");
  assert.equal(h.posts.length, 0);
});

test("monthly schedules use exact selected dates and weekly slots replace only obsolete schedule metadata", async () => {
  const h = harness({ message: "Configure l’agent Statistiques deux fois par mois les 5 et 20 à dix heures." });
  const result = await h.configure({ agent: "stats", schedule: { frequency: "biweekly", timezone: "Europe/Paris", monthDays: [20, 5], time: "10:00", slots: null } });
  assert.equal(result.status, "saved");
  assert.deepEqual(JSON.parse(JSON.stringify((h.posts[0].settings as settingsLib.InrAgentSettings).automations.stats.metadata.monthDays)), [5, 20]);
  const other = harness({ message: "Configure les statistiques lundi et jeudi à neuf heures" });
  assert.equal((await other.configure({ agent: "stats", schedule: { ...weekly, frequency: "twice_weekly", slots: [{ dayOfWeek: 1, time: "09:00" }, { dayOfWeek: 4, time: "09:00" }] } })).status, "saved");
});

test("disabling one agent preserves another active agent and does not require an invented schedule", async () => {
  const initial = settingsLib.sanitizeInrAgentSettings(null);
  initial.globalEnabled = true; initial.automations.stats.enabled = true; initial.automations.publish.enabled = true;
  const h = harness({ initial, message: "Désactive l’agent Statistiques" });
  assert.equal((await h.configure({ agent: "stats", enabled: false })).status, "saved");
  const saved = h.posts[0].settings as settingsLib.InrAgentSettings;
  assert.equal(saved.automations.stats.enabled, false);
  assert.equal(saved.automations.publish.enabled, true);
  assert.equal(saved.globalEnabled, true);
});

test("native module confirmations and quota refusals are preserved without auto-confirmation or leaking impact payloads", async () => {
  for (const [postCode, status] of [["EDITORIAL_PLAN_CHANGE_CONFIRMATION_REQUIRED", "confirmation_required"], ["EDITORIAL_PLAN_QUOTA_INSUFFICIENT", "quota_insufficient"], ["OTHER_PRIVATE_CODE", "save_unconfirmed"]]) {
    const h = harness({ postCode });
    const result = await h.configure({ agent: "stats", enabled: true, schedule: weekly });
    assert.equal(result.status, status);
    assert.equal(h.posts.length, 1);
    assert.equal(h.posts[0].editorialPlanApplyMode, undefined);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|impact|OTHER_PRIVATE_CODE/);
  }
});

test("scope changes, unavailable settings and unexpected API exceptions fail closed or unconfirmed", async () => {
  const changed = harness({ scopeMismatchAt: 2 });
  await assert.rejects(changed.configure({ agent: "stats", enabled: true, schedule: weekly }), /établissement actif/);
  assert.equal(changed.posts.length, 0);
  const missing = harness({ tableMissing: true });
  assert.equal((await missing.configure({ agent: "stats", enabled: true, schedule: weekly })).status, "unavailable");
  assert.equal(missing.posts.length, 0);
  for (const options of [{ getFailure: true }, { postFailure: true }]) {
    const h = harness(options), result = await h.configure({ agent: "stats", enabled: true, schedule: weekly });
    assert.equal(result.status, "operation_unconfirmed");
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|STACK|TOKEN/);
  }
});

test("global timezone changes are not silently applied to other agents and API adjustments remain truthful", async () => {
  const h = harness();
  assert.equal((await h.configure({ agent: "stats", enabled: true, schedule: { ...weekly, timezone: "America/New_York" } })).status, "timezone_confirmation_required");
  assert.equal(h.posts.length, 0);
  const adjusted = harness({ adjusted: true });
  const result = await adjusted.configure({ agent: "stats", enabled: true, schedule: weekly });
  assert.equal(result.status, "saved_with_adjustments");
  assert.equal((result.settings as Row).enabled, false);
});

test("strict tools reject account/provider injection, malformed schedules, dangerous modes and invalid runtime values", async () => {
  const h = harness();
  const schema = asSchema(h.tools.configureAgentAutomation.inputSchema);
  for (const input of [
    { agent: "stats", enabled: true, accountId: "foreign" }, { agent: "stats", url: "/api/billing/cancel" },
    { agent: "stats", model: "other" }, { agent: "stats", planningHorizonDays: "7" },
    { agent: "stats", schedule: { ...weekly, slots: [{ dayOfWeek: 9, time: "25:99" }] } },
    { agent: "stats", schedule: { ...weekly, frequency: "twice_weekly", slots: [{ dayOfWeek: 1, time: "09:00" }, { time: "09:00", dayOfWeek: 1 }] } },
    { agent: "stats", schedule: { frequency: "biweekly", timezone: "Europe/Paris", monthDays: [5], time: "10:00" } },
    { agent: "stats", schedule: { ...weekly, timezone: "PRIVATE TOKEN" } },
    { agent: "grow", channels: ["facebook"] }, { agent: "stats", themes: ["conseils"] },
  ]) {
    assert.equal((await schema.validate?.(input))?.success, false);
    await assert.rejects(h.configure(input), /Précisez/);
  }
  await assert.rejects(h.configure({ agent: "stats", validationMode: "draft_only" }), /Précisez/);
  assert.equal(h.posts.length, 0);
});
