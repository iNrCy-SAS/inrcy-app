import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { decodeBusinessSector } from "../../lib/activitySectors.ts";
import { DASHBOARD_PROFILE_COMPLETION_SELECT, evaluateDashboardProfileCompletion, evaluateDashboardActivityCompletion } from "../../lib/dashboardCompletion.ts";
import type * as Context from "../../lib/inrAssistantContext.ts";

type Call = { table: string; select: string; column: string; accountId: string };
type Fixture = { data?: unknown; error?: unknown; throws?: boolean };
function harness(fixtures: Record<string, Fixture> = {}) {
  const calls: Call[] = [];
  const supabase = { from(table: string) {
    const call = { table, select: "", column: "", accountId: "" };
    calls.push(call);
    const finish = () => {
      const fixture = fixtures[`${table}:${call.accountId}`] ?? { data: table === "integrations" ? [] : null };
      if (fixture.throws) return Promise.reject(new Error("Synthetic database outage"));
      return Promise.resolve({ data: fixture.data ?? null, error: fixture.error ?? null });
    };
    const query = {
      select(columns: string) { call.select = columns; return query; },
      eq(column: string, accountId: string) { call.column = column; call.accountId = accountId; return query; },
      order() { return query; }, limit() { return query; }, maybeSingle: finish,
      then(resolve: (value: unknown) => unknown, reject?: (reason: unknown) => unknown) { return finish().then(resolve, reject); },
    };
    return query;
  } };
  const dependencies: Record<string, unknown> = {
    "server-only": {}, "./activitySectors.ts": { decodeBusinessSector },
    "./dashboardCompletion.ts": { DASHBOARD_PROFILE_COMPLETION_SELECT, evaluateDashboardProfileCompletion, evaluateDashboardActivityCompletion },
  };
  const output = ts.transpileModule(readFileSync(new URL("../../lib/inrAssistantContext.ts", import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const moduleRecord = { exports: {} };
  vm.runInNewContext(`(function(require,module,exports){${output}\n})`, {})(
    (name: string) => { assert.ok(name in dependencies, `Unexpected import ${name}`); return dependencies[name]; }, moduleRecord, moduleRecord.exports,
  );
  const runtime = moduleRecord.exports as typeof Context;
  return { calls, load: (accountId = "account-a") => runtime.loadInrAssistantContext({ supabase: supabase as never, accountId }) };
}

const completeProfile = { first_name: "Camille", last_name: "Pro", phone: "0600000000", contact_email: "private@example.test", company_legal_name: "Atelier A", hq_zip: "75001", hq_city: "Paris" };
const completeBusiness = { sector: "[[SECTOR:artisan_btp]] Plombier", business_description: "Plomberie et dépannage.", services: ["Dépannage", "Rénovation"], tone: "warm", communication_style: "expert", ai_language: "fr" };

test("every read is scoped to the authenticated account and uses an explicit safe projection", async () => {
  const h = harness();
  await h.load();
  assert.equal(h.calls.length, 5);
  for (const call of h.calls) {
    assert.equal(call.accountId, "account-a");
    assert.equal(call.column, call.table === "business_ai_memories" ? "account_id" : "user_id");
    assert.doesNotMatch(call.select, /\*|access_token|refresh_token|password|account_email|email_address|referenceDocuments|extractedText/);
  }
});

test("a new account receives concrete setup guidance without invented business facts", async () => {
  const context = await harness().load();
  assert.equal(context.business.company, "");
  assert.equal(context.setup.profile.complete, false);
  assert.equal(context.setup.activity.complete, false);
  assert.equal(context.setup.dna.saved, false);
  assert.equal(context.setup.dna.completionPercent, null);
  assert.equal(context.setup.ai.configured, false);
  assert.ok(context.nextSteps.some(item => /premier canal/.test(item)));
  assert.ok(context.nextSteps.some(item => /Mon compte/.test(item)));
  assert.ok(context.nextSteps.some(item => /ADN/.test(item)));
});

test("configured accounts expose useful business facts and saved setup only", async () => {
  const h = harness({
    "profiles:account-a": { data: { ...completeProfile, secret: "never-emit", contact_email: "secret@example.test" } },
    "business_profiles:account-a": { data: { ...completeBusiness, ai_custom_instructions: "never-emit" } },
    "business_ai_memories:account-a": { data: { completion_score: 100, memory: { private: "never-emit" } } },
    "pro_tools_configs:account-a": { data: { website: "https://a.example.test", search_enabled: "true", search_slug: "atelier-a" } },
    "integrations:account-a": { data: [
      { source: "facebook", product: "ads", status: "connected" },
      { source: "tiktok", product: "tiktok", status: "connected", access_token_enc: "never-emit" },
      { source: "linkedin", product: "linkedin", status: "connected", needs_reconnect: "true" },
      { source: "instagram", product: "instagram", status: "account_connected" },
      { source: "threads", product: "threads", status: "connected" },
    ] },
  });
  const context = await h.load();
  assert.equal(context.business.company, "Atelier A");
  assert.equal(context.business.profession, "Plombier");
  assert.equal(context.setup.profile.complete, true);
  assert.equal(context.setup.ai.configured, true);
  assert.equal(context.setup.dna.completionPercent, 100);
  assert.equal(context.setup.channels.statusSource, "stored_database_not_live_verified");
  assert.equal(context.setup.channels.storedConnected.join(","), "site_web,tiktok,inr_search");
  assert.equal(context.setup.channels.needsAttention.join(","), "instagram,linkedin");
  assert.doesNotMatch(JSON.stringify(context), /never-emit|secret@example/);
});

test("query errors and thrown requests stay unknown, never disconnected or zero", async () => {
  const h = harness({
    "profiles:account-a": { error: { message: "schema failure" } },
    "business_profiles:account-a": { throws: true },
    "business_ai_memories:account-a": { error: true },
    "pro_tools_configs:account-a": { error: true },
    "integrations:account-a": { throws: true },
  });
  const context = await h.load();
  assert.equal(context.setup.profile.complete, null);
  assert.equal(context.setup.activity.complete, null);
  assert.equal(context.setup.ai.configured, null);
  assert.equal(context.setup.dna.completionPercent, null);
  assert.equal(context.setup.dna.saved, null);
  assert.equal(context.setup.channels.known, false);
  assert.equal(context.nextSteps.length, 1);
  assert.match(context.nextSteps[0], /n’ont pas pu être vérifiées/);
});

test("accounts have isolated fresh reads with no global cached context", async () => {
  const h = harness({
    "profiles:account-a": { data: { ...completeProfile, company_legal_name: "Entreprise A" } },
    "profiles:account-b": { data: { ...completeProfile, company_legal_name: "Entreprise B" } },
  });
  const [a, b] = await Promise.all([h.load("account-a"), h.load("account-b")]);
  assert.equal(a.business.company, "Entreprise A");
  assert.equal(b.business.company, "Entreprise B");
  assert.doesNotMatch(JSON.stringify(b), /Entreprise A/);
});

test("a saved DNA row with an invalid score stays unknown rather than becoming zero", async () => {
  const context = await harness({ "business_ai_memories:account-a": { data: { completion_score: "100" } } }).load();
  assert.equal(context.setup.dna.saved, true);
  assert.equal(context.setup.dna.completionPercent, null);
  assert.ok(context.nextSteps.some(item => /niveau de préparation n’est pas disponible/.test(item)));
});

test("serialized context stays below 4,000 characters even with escaping and oversized fields", async () => {
  const oversized = '"\\'.repeat(5000);
  const context = await harness({
    "profiles:account-a": { data: { company_legal_name: oversized, hq_city: oversized } },
    "business_profiles:account-a": { data: { sector: oversized, business_description: oversized, services: [oversized, oversized, oversized, oversized, oversized] } },
    "business_ai_memories:account-a": { data: { completion_score: 99 } },
    "integrations:account-a": { data: ["gmb", "facebook", "instagram", "linkedin", "tiktok", "youtube_shorts", "pinterest", "x"].map(source => ({ source, product: source, status: "account_connected" })) },
  }).load();
  assert.ok(JSON.stringify(context).length <= 4000, String(JSON.stringify(context).length));
});

test("blank scopes are rejected before the first database read", async () => {
  const h = harness();
  await assert.rejects(h.load(" "), /account scope/);
  assert.equal(h.calls.length, 0);
});
