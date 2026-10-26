import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import { asSchema, jsonSchema, tool } from "ai";
import * as validation from "../../lib/adsValidation.ts";
import * as metrics from "../../lib/adsCampaignMetrics.ts";
import * as lifecycle from "../../lib/adsCampaignLifecycle.ts";
import * as publicUrl from "../../lib/channelPublicUrl.ts";
import * as resources from "../../lib/adsProviderResources.ts";
import type * as Advertising from "../../lib/inrAssistantAdvertisingTools.ts";

type Row = Record<string, unknown>;
const root = resolve(import.meta.dirname, "../..");
const accountId = "10000000-0000-4000-8000-000000000001";
const foreignId = "20000000-0000-4000-8000-000000000001";
const campaignId = "30000000-0000-4000-8000-000000000001";
const otherCampaignId = "40000000-0000-4000-8000-000000000001";
const endDate = new Date(Date.now() + 10 * 86_400_000).toISOString().slice(0, 10);
const laterDate = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
const createInstruction = `Prépare une campagne Google pour mon atelier, à 20 € par jour jusqu’au ${endDate}, destination https://atelier.example/offre`;
const prepare = (instructionQuote = createInstruction) => ({ instructionQuote, provider: "google" as const, name: "Campagne Atelier", offer: "Accompagnement local", dailyBudgetEuros: 20, endDate, destinationUrl: "https://atelier.example/offre", primaryText: "Découvrez notre atelier local.", headlines: ["Notre atelier"], descriptions: ["Un service de proximité."], targetLocations: [] });
const manage = (action: string, instructionQuote: string, changes: Row = {}) => ({ instructionQuote, campaignId, action, name: null, dailyBudgetEuros: null, endDate: null, ...changes });
const read = (mode = "list", id: string | null = null) => ({ mode, campaignId: id, offset: 0 });
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value));

function fixture(options: { current?: string; status?: string; provider?: string; rows?: Row[]; edition?: "standard" | "premium" | "founder"; denied?: boolean; commitError?: boolean; remoteError?: boolean; metrics?: unknown; conflict?: boolean } = {}) {
  let activeAccount = accountId;
  let commitError = options.commitError;
  const calls: Array<{ kind: string; value?: unknown }> = [];
  const nativeDraft = validation.parseAdsCampaignInput({ ...prepare(), provider: options.provider || "google", accountCurrency: "EUR", adAccountId: "", creationMode: "manual" }, { purpose: "draft" }).draft;
  assert.ok(nativeDraft);
  const row: Row = { id: campaignId, user_id: accountId, provider: options.provider || "google", ad_account_id: "PRIVATE AD ACCOUNT", name: "Campagne Atelier", daily_budget_cents: 2000, end_date: endDate, status: options.status || "draft", draft: nativeDraft, provider_resources: options.status && options.status !== "draft" ? { campaignResourceName: "PRIVATE REMOTE ID", access_token: "PRIVATE TOKEN" } : {}, published_at: options.status && options.status !== "draft" ? "2026-10-25T12:00:00Z" : null, updated_at: "2026-10-26T10:00:00Z", created_at: "2026-10-26T10:00:00Z", last_error: "PRIVATE DATABASE ERROR" };
  const rows = new Map<string, Row>((options.rows || [row, { ...clone(row), id: otherCampaignId, user_id: foreignId, name: "FOREIGN CAMPAIGN" }]).map(value => [String(value.id), clone(value)]));
  const database = { from(table: string) {
    assert.equal(table, "ads_campaigns"); const filters: Array<[string, unknown]> = []; let payload: Row | undefined;
    const selected = () => [...rows.values()].filter(value => filters.every(([key, expected]) => Array.isArray(expected) ? expected.includes(value[key]) : value[key] === expected));
    const query = {
      select() { return query; },
      eq(key: string, value: unknown) { filters.push([key, value]); return query; },
      in(key: string, values: unknown[]) { filters.push([key, values]); return query; },
      order() { return query; },
      async range(start: number, end: number) { calls.push({ kind: "db:list", value: filters }); assert.ok(filters.some(([key, value]) => key === "user_id" && value === activeAccount)); const values = selected(); return { data: clone(values.slice(start, end + 1)), count: values.length, error: null }; },
      async maybeSingle() { calls.push({ kind: "db:read", value: filters }); assert.ok(filters.some(([key, value]) => key === "user_id" && value === activeAccount)); return { data: clone(selected()[0] || null), error: null }; },
      insert(value: Row) { payload = value; return query; },
      async single() {
        assert.ok(payload); calls.push({ kind: "db:insert", value: clone(payload) }); assert.equal(payload.user_id, activeAccount);
        const key = String(payload.id || randomUUID());
        if (rows.has(key)) return { data: null, error: { code: "23505" } };
        rows.set(key, { ...clone(payload), id: key, status: "draft", provider_resources: {}, published_at: null, created_at: new Date().toISOString() });
        if (commitError) { commitError = false; return { data: null, error: { code: "NETWORK_UNCERTAIN" } }; }
        return { data: { id: key, status: "draft" }, error: null };
      },
    }; return query;
  }, async rpc(name: string, args: Row) {
    calls.push({ kind: `rpc:${name}`, value: args }); assert.equal(args.p_user_id, activeAccount);
    const found = rows.get(String(args.p_campaign_id));
    if (!found || options.conflict || found.user_id !== activeAccount || found.status !== "draft" || found.published_at !== null || Object.keys(found.provider_resources as Row).length || args.p_expected_updated_at !== found.updated_at) return { data: null, error: null };
    if (name === "inrcy_delete_ads_draft") rows.delete(String(found.id));
    else if (name === "inrcy_extend_ads_draft") { found.end_date = args.p_next_end_date; found.draft = clone(args.p_draft); found.updated_at = new Date().toISOString(); }
    else if (name === "inrcy_update_ads_draft") { Object.assign(found, { name: args.p_name, provider: args.p_provider, draft: args.p_draft, end_date: args.p_end_date, daily_budget_cents: args.p_daily_budget_cents, updated_at: new Date().toISOString() }); }
    else assert.fail(name);
    return { data: args.p_campaign_id, error: null };
  } };
  const auth = async () => ({ activeUserId: activeAccount, authUserId: "actor-a", errorResponse: null });
  const modules: Record<string, unknown> = {
    "server-only": {}, ai: { jsonSchema, tool }, "node:crypto": { createHash, randomUUID },
    "next/server": { NextResponse: { json: (value: unknown, init?: ResponseInit) => Response.json(value, init) } },
    "./requireUser": { requireUser: auth },
    "./adsValidation.ts": validation, "@/lib/adsValidation": validation,
    "./adsCampaignMetrics.ts": metrics, "./adsCampaignLifecycle.ts": lifecycle, "./channelPublicUrl.ts": publicUrl,
    "@/lib/adsProviderResources": resources,
    "@/lib/supabaseAdmin": { supabaseAdmin: database },
    "@/lib/rateLimit": { enforceRateLimit: async () => null },
    "@/lib/adsServer": {
      requirePremiumAdsUser: async () => options.denied ? { user: null, errorResponse: Response.json({ error: "PRIVATE DENIAL" }, { status: 403 }) } : { user: await auth(), errorResponse: null },
      adsRequestOriginAllowed: (request: Request) => !request.headers.get("origin") || request.headers.get("origin") === new URL(request.url).origin,
      adsBadOriginResponse: () => Response.json({}, { status: 403 }), isAdsPilotAdmin: async () => false,
      isAdsChannelUserAllowed: async (_actor: string, _owner: string, provider: string) => ["meta", "google", "linkedin", "pinterest", "openai"].includes(provider), adsPilotOnlyResponse: () => Response.json({}, { status: 403 }),
    },
    "@/app/api/ads/campaigns/[id]/metrics/route": { GET: async () => { calls.push({ kind: "native:metrics" }); return Response.json({ metrics: options.metrics ?? null, privateField: "PRIVATE METRICS" }); } },
    "@/app/api/ads/campaigns/[id]/preflight/route": { GET: async (request: Request) => { assert.equal(new URL(request.url).searchParams.get("mode"), "paused"); calls.push({ kind: "native:preflight" }); return Response.json({ ready: true, selectedAccountId: "PRIVATE ACCOUNT", resourcesKey: "PRIVATE KEY", consentKey: "PRIVATE CONSENT" }); } },
    "@/app/api/ads/campaigns/[id]/lifecycle/route": { PATCH: async (request: Request, context: { params: Promise<{ id: string }> }) => {
      const { id } = await context.params; const body = await request.json(); calls.push({ kind: "native:lifecycle", value: body });
      assert.deepEqual(Object.keys(body).sort(), ["action", "changes"]); assert.notEqual(body.action, "resume"); assert.notEqual(body.action, "delete");
      if (options.remoteError) throw new Error("PRIVATE UNCERTAIN PROVIDER FAILURE");
      const value = rows.get(id)!; assert.equal(value.user_id, activeAccount);
      if (body.action === "pause") value.status = "paused";
      else { const changes = body.changes as Row; value.name = changes.name ?? value.name; value.daily_budget_cents = changes.dailyBudgetEuros === undefined ? value.daily_budget_cents : Number(changes.dailyBudgetEuros) * 100; value.end_date = changes.endDate ?? value.end_date; }
      return Response.json({ campaign: clone(value) });
    } },
  };
  const cache = new Map<string, { exports: unknown }>();
  function load<T>(file: string): T {
    const cached = cache.get(file); if (cached) return cached.exports as T;
    const moduleRecord = { exports: {} }; cache.set(file, moduleRecord);
    const compiled = ts.transpileModule(readFileSync(file, "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, { Request, Response, Headers, URL, Buffer, Date, setTimeout, clearTimeout, fetch: () => assert.fail("No real provider, payment or database request is allowed in fixtures") })((name: string) => {
      if (name in modules) return modules[name];
      let target = name.startsWith("@/") ? resolve(root, name.slice(2)) : resolve(dirname(file), name);
      if (!target.endsWith(".ts")) target += ".ts";
      return load(target);
    }, moduleRecord, moduleRecord.exports);
    return moduleRecord.exports as T;
  }
  const runtime = load<typeof Advertising>(resolve(root, "lib/inrAssistantAdvertisingTools.ts"));
  const makeTools = (current = options.current || createInstruction, actionRequestId = "logical-turn-a") => runtime.createInrAssistantAdvertisingTools({ request: new Request("https://app.inrcy.test/api/assistant/chat", { headers: { cookie: "session=scoped" } }), accountId, edition: options.edition || "premium", currentUserMessage: current, actionRequestId });
  const tools = makeTools();
  const execute = async (name: keyof typeof tools, input: unknown) => await tools[name].execute!(input as never, { toolCallId: "test", messages: [] }) as unknown as Row;
  return { rows, calls, tools, execute, makeTools, switchAccount: () => { activeAccount = foreignId; }, native: load<{ POST: (request: Request) => Promise<Response> }>(resolve(root, "app/api/ads/campaigns/route.ts")) };
}

test("the actual native draft handler is account-scoped and idempotent, including an uncertain successful insert", async () => {
  const h = fixture({ commitError: true }); const first = await h.execute("prepareAdvertisingCampaign", prepare());
  assert.equal(first.ok, true); assert.equal(first.status, "already_processed");
  const id = String(first.campaignId); assert.ok(h.rows.has(id));
  assert.equal(h.calls.filter(call => call.kind === "db:insert").length, 1);
  (h.rows.get(id)!.draft as Row).offer = "Later manual edit";
  const fresh = h.makeTools();
  const repeated = await fresh.prepareAdvertisingCampaign.execute!(prepare(), { toolCallId: "retry", messages: [] }) as unknown as Row;
  assert.equal(repeated.campaignId, id); assert.equal(repeated.status, "already_processed");
  assert.equal((h.rows.get(id)!.draft as Row).offer, "Later manual edit");
  assert.equal(h.calls.filter(call => call.kind === "db:insert").length, 1);
  assert.equal(h.calls.some(call => call.kind === "native:lifecycle"), false);
  h.rows.get(id)!.status = "active";
  const activeReplay = await h.makeTools().prepareAdvertisingCampaign.execute!(prepare(), { toolCallId: "active-retry", messages: [] }) as unknown as Row;
  assert.equal(activeReplay.storedStatus, "active"); assert.equal(activeReplay.published, undefined);
  assert.equal((activeReplay.nextAction as Row).href, "/dashboard/mails?folder=campagnes-ads");
  assert.equal(h.calls.filter(call => call.kind === "db:insert").length, 1);
});

test("ordinary native draft clients retain their legacy create/update behavior and bad keys fail closed", async () => {
  const h = fixture(); const body = { ...prepare(), accountCurrency: "EUR", creationMode: "manual", adAccountId: "" };
  const request = (payload: unknown, key?: string) => new Request("https://app.inrcy.test/api/ads/campaigns", { method: "POST", headers: { "Content-Type": "application/json", ...(key ? { "Idempotency-Key": key } : {}) }, body: JSON.stringify(payload) });
  assert.equal((await h.native.POST(request(body))).status, 200);
  assert.equal((await h.native.POST(request({ ...body, id: campaignId, name: "Edited legacy draft" }))).status, 200);
  assert.equal(h.rows.get(campaignId)!.name, "Edited legacy draft");
  assert.equal((await h.native.POST(request(body, "bad"))).status, 400);
  assert.equal((await h.native.POST(request({ ...body, id: campaignId }, "a".repeat(64)))).status, 400);
});

test("concurrent native requests create one row and the same key is isolated between establishments", async () => {
  const h = fixture(); const key = "b".repeat(64);
  const request = () => new Request("https://app.inrcy.test/api/ads/campaigns", { method: "POST", headers: { "Content-Type": "application/json", "Idempotency-Key": key }, body: JSON.stringify({ ...prepare(), accountCurrency: "EUR", creationMode: "manual", adAccountId: "" }) });
  const responses = await Promise.all([h.native.POST(request()), h.native.POST(request())]);
  assert.ok(responses.every(response => response.status === 200));
  const results = await Promise.all(responses.map(response => response.json()));
  assert.equal(results[0].campaign.id, results[1].campaign.id);
  assert.equal(h.rows.size, 3, "Only one draft may be committed by simultaneous requests");
  h.switchAccount(); const other = await (await h.native.POST(request())).json();
  assert.notEqual(other.campaign.id, results[0].campaign.id);
  assert.equal(h.rows.get(results[0].campaign.id)!.user_id, accountId);
  assert.equal(h.rows.get(other.campaign.id)!.user_id, foreignId);
});

test("all five public channels use the actual draft validator without choosing advertiser accounts or consent", async () => {
  for (const [provider, label] of [["google", "Google"], ["meta", "Meta"], ["linkedin", "LinkedIn"], ["pinterest", "Pinterest"], ["openai", "ChatGPT"]]) {
    const current = createInstruction.replace("Google", label); const h = fixture({ current });
    const result = await h.execute("prepareAdvertisingCampaign", { ...prepare(current), provider }); assert.equal(result.status, "draft", provider);
    const saved = h.rows.get(String(result.campaignId))!; const draft = saved.draft as Row;
    assert.equal(draft.adAccountId, ""); assert.equal(draft.noSpecialCategoryConfirmed, false); assert.equal(draft.notEuPoliticalConfirmed, false);
    assert.equal(saved.status, "draft"); assert.deepEqual(saved.provider_resources, {}); assert.equal(result.published, false);
  }
});

test("draft preparation rejects invented financial values, historic instructions, pilot channels and schema overrides", async () => {
  for (const current of [
    "Comment préparer une campagne Google à 20 € par jour ?",
    `Hier je voulais préparer une campagne Google à 20 € par jour jusqu’au ${endDate}, destination https://atelier.example/offre`,
    `Le bouton Préparer une campagne Google à 20 € par jour jusqu’au ${endDate} ne fonctionne pas`,
    `Prépare une campagne Google à 20 € par mois jusqu’au ${endDate}, destination https://atelier.example/offre`,
    `Prépare une campagne Google à 20 € par jour, destination https://atelier.example/offre`,
    `Prépare une campagne Google. Hier j’avais demandé 20 € par jour jusqu’au ${endDate}, destination https://atelier.example/offre`,
  ]) {
    const h = fixture({ current }); assert.equal((await h.execute("prepareAdvertisingCampaign", prepare(current))).status, "needs_instruction", current); assert.equal(h.calls.length, 0);
  }
  const h = fixture();
  assert.equal((await h.execute("prepareAdvertisingCampaign", { ...prepare(), dailyBudgetEuros: 30 })).status, "needs_instruction");
  for (const value of [{ ...prepare(), provider: "tiktok" }, { ...prepare(), provider: "x" }, { ...prepare(), accountId: foreignId }, { ...prepare(), adAccountId: "123456" }, { ...prepare(), destinationUrl: "http://127.0.0.1/" }, { ...prepare(), destinationUrl: "https://example.com/?token=private" }]) {
    assert.equal((await asSchema<unknown>(h.tools.prepareAdvertisingCampaign.inputSchema).validate?.(value))?.success, false);
    await assert.rejects(() => h.execute("prepareAdvertisingCampaign", value));
  }
  assert.equal(h.calls.length, 0);
});

test("native reads project only public account fields and measured metrics, never provider credentials or consent proofs", async () => {
  const actualMetrics = { period: "last_30_days", source: "google", impressions: 0, clicks: 0, spendEuros: 0, conversions: null, fetchedAt: new Date().toISOString(), providerPayload: "PRIVATE PAYLOAD" };
  const h = fixture({ status: "active", metrics: actualMetrics });
  const list = await h.execute("readAdvertisingCampaigns", read()); assert.equal((list.campaigns as Row[]).length, 1); assert.doesNotMatch(JSON.stringify(list), /PRIVATE|FOREIGN/); assert.ok(JSON.stringify(list).length <= 6000);
  const measured = await h.execute("readAdvertisingCampaigns", read("metrics", campaignId)); assert.equal((measured.metrics as Row).impressions, 0); assert.doesNotMatch(JSON.stringify(measured), /PRIVATE/);
  const checked = await h.execute("readAdvertisingCampaigns", read("preflight", campaignId)); assert.equal(checked.ready, true); assert.doesNotMatch(JSON.stringify(checked), /PRIVATE|consentKey|resourcesKey|selectedAccount/);
  const unknown = fixture({ status: "active" }); const absent = await unknown.execute("readAdvertisingCampaigns", read("metrics", campaignId)); assert.equal(absent.metrics, null); assert.equal(absent.ok, false);
});

test("oversized public lists remain bounded and pagination does not skip the omitted visible campaigns", async () => {
  const rows = Array.from({ length: 40 }, (_, index) => ({ id: `50000000-0000-4000-8000-${String(index).padStart(12, "0")}`, user_id: accountId, provider: "google", name: '"'.repeat(100), daily_budget_cents: 2000, end_date: endDate, status: "draft", draft: { offer: '"'.repeat(180), primaryText: '"'.repeat(300) } }));
  const h = fixture({ rows }); const result = await h.execute("readAdvertisingCampaigns", read());
  assert.ok(JSON.stringify(result).length <= 6000); assert.equal(result.truncated, true);
  assert.equal(result.nextOffset, (result.campaigns as Row[]).length);
  const next = await h.execute("readAdvertisingCampaigns", { ...read(), offset: result.nextOffset });
  assert.equal((next.campaigns as Row[])[0].id, rows[Number(result.nextOffset)].id);
});

test("pause is absolute and called once; uncertain mutations remain uncertain on retry", async () => {
  const current = `Mets en pause la campagne ADS ${campaignId}`;
  const h = fixture({ current, status: "active" }); const input = manage("pause", current);
  assert.equal((await h.execute("manageAdvertisingCampaign", input)).status, "updated"); await h.execute("manageAdvertisingCampaign", input);
  assert.equal(h.calls.filter(call => call.kind === "native:lifecycle").length, 1);
  const alreadyPaused = fixture({ current, status: "paused" });
  assert.equal((await alreadyPaused.execute("manageAdvertisingCampaign", input)).status, "updated");
  assert.equal(alreadyPaused.calls.filter(call => call.kind === "native:lifecycle").length, 1, "A recorded pause is checked through the native absolute pause, never assumed to prove remote state");
  const uncertain = fixture({ current, status: "active", remoteError: true });
  assert.equal((await uncertain.execute("manageAdvertisingCampaign", input)).status, "unknown");
  assert.equal((await uncertain.execute("manageAdvertisingCampaign", input)).status, "unknown");
  assert.equal(uncertain.calls.filter(call => call.kind === "native:lifecycle").length, 1);
});

test("remote edits send only literal absolute changes while preserving every unrelated setting", async () => {
  const current = `Modifie le budget de la campagne ADS ${campaignId} à 25 € par jour jusqu’au ${laterDate}`;
  const h = fixture({ current, status: "active" }); const before = clone(h.rows.get(campaignId)!.draft);
  assert.equal((await h.execute("manageAdvertisingCampaign", manage("update", current, { dailyBudgetEuros: 25, endDate: laterDate }))).ok, true);
  assert.deepEqual(h.calls.find(call => call.kind === "native:lifecycle")!.value, { action: "update", changes: { dailyBudgetEuros: 25, endDate: laterDate } });
  assert.deepEqual(h.rows.get(campaignId)!.draft, before);
  const wrong = fixture({ current, status: "active" }); assert.equal((await wrong.execute("manageAdvertisingCampaign", manage("update", current, { dailyBudgetEuros: 30 }))).status, "needs_instruction"); assert.equal(wrong.calls.length, 0);
});

test("draft deletion and extension use the real account-scoped CAS handlers; paid resume and remote deletion stay native", async () => {
  const deletion = `Supprime le brouillon de campagne ADS ${campaignId}`;
  const h = fixture({ current: deletion }); assert.equal((await h.execute("manageAdvertisingCampaign", manage("delete", deletion))).status, "deleted"); assert.equal(h.rows.has(campaignId), false); assert.equal(h.rows.has(otherCampaignId), true);
  const extension = `Modifie la date de la campagne ADS ${campaignId} jusqu’au ${laterDate}`;
  const extend = fixture({ current: extension }); const before = clone(extend.rows.get(campaignId)!.draft as Row);
  assert.equal((await extend.execute("manageAdvertisingCampaign", manage("update", extension, { endDate: laterDate }))).ok, true);
  assert.deepEqual(extend.rows.get(campaignId)!.draft, { ...before, endDate: laterDate });
  const conflict = fixture({ current: extension, conflict: true }); assert.equal((await conflict.execute("manageAdvertisingCampaign", manage("update", extension, { endDate: laterDate }))).status, "unknown"); assert.equal(conflict.rows.get(campaignId)!.end_date, endDate);
  for (const [action, current] of [["resume", `Reprends la campagne ADS ${campaignId}`], ["delete", `Supprime la campagne ADS ${campaignId}`]]) {
    const native = fixture({ current, status: "paused" }); const result = await native.execute("manageAdvertisingCampaign", manage(action, current)); assert.equal(result.status, "requires_native_confirmation"); assert.equal((result.nextAction as Row).href, "/dashboard/mails?folder=campagnes-ads"); assert.equal(native.calls.some(call => call.kind.startsWith("native:lifecycle") || call.kind.startsWith("rpc:")), false);
  }
});

test("Standard, denied native access, account switches and ambiguous names never mutate another campaign", async () => {
  const standard = fixture({ edition: "standard" }); assert.equal((await standard.execute("prepareAdvertisingCampaign", prepare())).status, "blocked"); assert.equal(standard.calls.length, 0);
  const denied = fixture({ denied: true }); assert.equal((await denied.execute("readAdvertisingCampaigns", read())).ok, false); assert.equal(denied.calls.length, 0);
  const switched = fixture(); switched.switchAccount(); assert.equal((await switched.execute("prepareAdvertisingCampaign", prepare())).status, "blocked"); assert.equal(switched.calls.length, 0);
  const current = "Mets en pause la campagne ADS Campagne Atelier"; const named = fixture({ current, status: "active" });
  assert.equal((await named.execute("manageAdvertisingCampaign", manage("pause", current))).status, "needs_instruction");
  await named.execute("readAdvertisingCampaigns", read()); assert.equal((await named.execute("manageAdvertisingCampaign", manage("pause", current))).ok, true);
  const first = clone(named.rows.get(campaignId)!);
  const duplicate = fixture({ current, rows: [first, { ...clone(first), id: otherCampaignId }] });
  await duplicate.execute("readAdvertisingCampaigns", read());
  assert.equal((await duplicate.execute("manageAdvertisingCampaign", manage("pause", current))).status, "needs_instruction");
  assert.equal(duplicate.calls.some(call => call.kind === "native:lifecycle"), false);
});

test("a historical reference or budget in another sentence cannot redirect the current campaign operation", async () => {
  const current = `Mets en pause la campagne ADS ${otherCampaignId}. Hier je parlais de la campagne ${campaignId}`;
  const h = fixture({ current, status: "active" });
  assert.equal((await h.execute("manageAdvertisingCampaign", manage("pause", current))).status, "needs_instruction");
  assert.equal(h.calls.some(call => call.kind === "native:lifecycle"), false);
  const oldBudget = `Modifie le nom de la campagne ADS ${campaignId}. Hier le budget était de 25 € par jour`;
  const budget = fixture({ current: oldBudget, status: "active" });
  assert.equal((await budget.execute("manageAdvertisingCampaign", manage("update", oldBudget, { dailyBudgetEuros: 25 }))).status, "needs_instruction");
  assert.equal(budget.calls.length, 0);
});
