import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as setup from "../../app/dashboard/dashboard.channel-setup.ts";
import * as access from "../../lib/bubbleAccess.ts";
import * as edition from "../../lib/dashboardEdition.ts";
import * as completion from "../../lib/dashboardCompletion.ts";
import * as directory from "../../lib/inrDirectorySettings.ts";
import * as safe from "../../lib/tsSafe.ts";

type Row = Record<string, unknown>;
type ChannelResult = Row & { disconnected: string[]; unknown: string[]; channels: Array<Row & { missingPrerequisites: string[] }> };
type ChannelRuntime = { createInrAssistantChannelTools(options: unknown): { readChannelStatus: { execute(input: unknown): Promise<ChannelResult> } } };
function harness(options: { pilot?: boolean; edition?: edition.DashboardEdition; failed?: string; foreign?: boolean; accountConnectedPinterest?: boolean } = {}) {
  const calls: { table: string; account: string }[] = [];
  const rows: Record<string, unknown> = {
    profiles: { first_name: "Camille", last_name: "Pro", phone: "private-phone", contact_email: "private@example.test", company_legal_name: "Atelier", hq_zip: "75001", hq_city: "Paris" },
    pro_tools_configs: { settings: { site_web: { url: "https://atelier.example" }, inrSearch: { enabled: true, slug: "atelier" }, inrDirectory: { enabled: false }, pinterest: options.accountConnectedPinterest ? {} : { defaultBoardId: "private-board" } } },
    app_bubble_access: [],
    integrations: [...["gmb", "facebook", "instagram", "threads", "linkedin", "tiktok", "youtube_shorts", "pinterest"].map(key => ({ provider: key === "gmb" ? "google" : key === "youtube_shorts" ? "youtube" : key, source: key, product: key, status: "connected", resource_id: "private-resource", access_token_enc: "PRIVATE_TOKEN", refresh_token_enc: "PRIVATE_REFRESH", meta: key === "gmb" ? { account: "private-account" } : {} })), { category: "mail", provider: "gmail", status: "connected", settings: {}, account_email: "private-mail@example.test" }],
  };
  const db = { from(table: string) {
    let account = "";
    const finish = () => { calls.push({ table, account }); assert.equal(account, "active"); return { data: rows[table], error: options.failed === table ? { message: "PRIVATE outage" } : null }; };
    const query = { select() { return query; }, eq(_key: string, value: string) { account = value; return query; }, maybeSingle: async () => finish(), then(resolve: (value: unknown) => unknown) { return Promise.resolve(finish()).then(resolve); } };
    return query;
  } };
  const deps: Record<string, unknown> = {
    "server-only": {}, ai: { tool: (value: unknown) => value, jsonSchema: (value: unknown) => value },
    "@/lib/inrDirectorySettings": directory, "@/lib/tsSafe": safe,
    "@/lib/supabaseAdmin": { supabaseAdmin: db },
    "@/lib/tiktokSettings": { normalizeTiktokSettings: () => ({}) },
    "@/lib/tiktokOAuth": { buildTiktokProfileUrl: () => null },
    "@/lib/youtubeShortsOAuth": { applyYoutubeShortsIntegrationState: (_settings: unknown, row: Row) => ({ connected: Boolean(row.access_token_enc && row.resource_id) }) },
    "@/lib/publicationChannelAvailability": { hasUsableRefreshCredential: (present: boolean) => present },
    "@/lib/pinterestOAuth": { getPinterestApiEnvironment: () => "production" },
    "@/lib/observability/logger": { log: { error() {}, warn() {} } },
    "@/lib/googleStatsConnectionPolicy": { isGoogleStatsSiteBindingConnected: () => false },
    "@/lib/instagramAuthMode": { resolveInstagramAuthMode: () => "facebook_login" },
    "@/lib/metaChannelRolloutServer": { isMetaChannelPilotEnabledForAccount: async () => options.pilot !== false },
    "./metaChannelRolloutServer": { isMetaChannelPilotEnabledForActorAndAccount: async () => options.pilot !== false },
    "./bubbleAccess.ts": access, "./dashboardEdition.ts": edition, "./dashboardCompletion.ts": completion,
    "../app/dashboard/dashboard.channel-setup.ts": setup,
    "./requireUser": { requireUser: async () => ({ activeUserId: options.foreign ? "other" : "active", errorResponse: null }) },
  };
  function load<T = Row>(file: string): T {
    const compiled = ts.transpileModule(readFileSync(new URL(`../../${file}`, import.meta.url), "utf8"), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText;
    const moduleRecord = { exports: {} as Row };
    vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`, { URL, setTimeout, clearTimeout, process: { env: {} } })(
      (name: string) => { assert.ok(name in deps, `Unexpected import ${name}`); return deps[name]; }, moduleRecord, moduleRecord.exports,
    );
    return moduleRecord.exports as T;
  }
  deps["@/lib/connectionVersions"] = load("lib/connectionVersions.ts");
  deps["./channelConnectionState"] = load("lib/channelConnectionState.ts");
  const runtime = load<ChannelRuntime>("lib/inrAssistantChannelTools.ts");
  const tool = runtime.createInrAssistantChannelTools({ supabase: db, accountId: "active", edition: options.edition ?? "founder" }).readChannelStatus;
  return { read: () => tool.execute({}), tool, rows, calls };
}

test("12/14 is derived from real canonical state and names the actual two missing channels", async () => {
  const h = harness(); const result = await h.read();
  assert.equal(result.ok, true); assert.equal(result.visibleTotal, 14); assert.equal(result.connectedCount, 12);
  assert.deepEqual([...result.disconnected].sort(), ["inr_directory", "x"]);
  assert.equal(result.liveVerified, false); assert.equal(result.catalogTotal, setup.DASHBOARD_CHANNEL_SETUP.length);
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|private@example|private-mail|private-resource|private-board/);
  assert.ok(h.calls.every(call => call.account === "active"));
});

test("pilot and commercial rights match the cockpit instead of inventing absent or paid channels", async () => {
  const h = harness({ pilot: false, edition: "standard" }); const result = await h.read();
  assert.equal(result.visibleTotal, 13); assert.equal(result.connectedCount, 10);
  assert.equal(result.channels.some((channel: Row) => channel.key === "threads"), false);
  assert.equal(result.channels.find((channel: Row) => channel.key === "mails")!.cause, "premium_required");
});

test("recorded account access, reconnection and profile prerequisites remain distinct", async () => {
  const h = harness();
  h.rows.app_bubble_access = [{ bubble_key: "facebook", enabled: false }];
  (h.rows.profiles as Row).phone = "";
  (h.rows.integrations as Row[]).find(row => row.source === "linkedin")!.meta = { needs_reconnect: true };
  const result = await h.read();
  assert.equal(result.channels.find((channel: Row) => channel.key === "facebook")!.cause, "account_access_disabled");
  assert.equal(result.channels.find((channel: Row) => channel.key === "linkedin")!.status, "needs_update");
  assert.deepEqual([...result.channels.find((channel: Row) => channel.key === "inrbadge")!.missingPrerequisites], ["phone"]);
});

test("canonical Pinterest account without a selected board does not falsely count connected", async () => {
  const result = await harness({ accountConnectedPinterest: true }).read();
  assert.equal(result.connectedCount, 11);
  assert.equal(result.channels.find((channel: Row) => channel.key === "pinterest")!.cause, "resource_selection_required");
});

test("an unavailable source yields unknowns and no exact count instead of false disconnections", async () => {
  for (const failed of ["integrations", "app_bubble_access", "profiles"]) {
    const result = await harness({ failed }).read();
    assert.equal(result.ok, false); assert.equal(result.connectedCount, null); assert.ok(result.unknown.length > 0);
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE/);
  }
});

test("forged account input and active-account changes stop before any account query", async () => {
  const h = harness(); await assert.rejects(h.tool.execute({ accountId: "other" }), /invalide/); assert.equal(h.calls.length, 0);
  const switched = harness({ foreign: true }); assert.equal((await switched.read()).ok, false); assert.equal(switched.calls.length, 0);
});

