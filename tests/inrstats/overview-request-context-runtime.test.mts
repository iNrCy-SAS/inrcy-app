import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import { createStatsOverviewRequestContext } from "../../lib/stats/overviewRequestContext.ts";
import type { SupabaseClient } from "@supabase/supabase-js";

const overviewSource = readFileSync(new URL("../../lib/stats/buildOverview.ts", import.meta.url), "utf8");
const parsed = ts.createSourceFile("overview.ts", overviewSource, ts.ScriptTarget.Latest, true);
const builder = parsed.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === "buildStatsOverview") as ts.FunctionDeclaration;
const statements = builder.body!.statements;
const names = ["readContext", "metaPilotEnabled", "{ data: integrationsAll = [] }", "[proCfgRes, businessProfileRes]", "channelStatesPromise"];
const fragments = names.map(name => {
  const statement = statements.find(s => ts.isVariableStatement(s) && s.declarationList.declarations.some(d => d.name.getText(parsed) === name));
  assert.ok(statement, `missing production read: ${name}`);
  return statement.getText(parsed);
});

function loadOverviewReads(deps: Record<string, unknown>) {
  const code = ts.transpileModule(`return (async () => { ${fragments.join("\n")} return {integrationsAll, proCfgRes, businessProfileRes, channelStates: await channelStatesPromise, metaPilotEnabled}; })();`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;
  return new Function(...Object.keys(deps), code)(...Object.values(deps)) as Promise<{channelStates: {connected:boolean}; metaPilotEnabled:boolean}>;
}

function fixture() {
  const queries: string[] = [];
  let gateReads = 0, stateReads = 0, connected = true;
  const userId = "owned-account";
  const supabase = {from(table: string) {
    queries.push(table);
    const row = {data: table === "integrations" ? [{user_id:userId}] : {}, error:null};
    const query = {select() {return this;}, eq(column: string, account: string) {assert.equal(column,"user_id"); assert.equal(account,userId); return this;}, maybeSingle: async () => row, then: (resolve: (value: unknown) => unknown) => Promise.resolve(row).then(resolve)};
    return query;
  }} as unknown as SupabaseClient;
  const overviewContext = createStatsOverviewRequestContext({supabase, userId});
  const read = (context = overviewContext, pilot?: boolean) => loadOverviewReads({supabase, userId, args:{overviewContext:context, metaPilotEnabled:pilot},
    isMetaChannelPilotEnabledForAccount: async () => {gateReads++; return true;},
    getChannelConnectionStates: async (_db: unknown, id: string, preloaded: unknown, options: {metaPilotEnabled:boolean}) => {
      assert.equal(id,userId); assert.equal(preloaded,undefined); assert.equal(typeof options.metaPilotEnabled,"boolean");
      stateReads++; return {connected};
    }});
  return {queries, read, supabase, userId, overviewContext, disconnect: () => {connected=false;}, counts: () => ({gateReads,stateReads})};
}

test("twenty cube-period builders share each live database read within one refresh", async () => {
  const h = fixture();
  await Promise.all(Array.from({length:20}, () => h.read()));
  assert.deepEqual([...h.queries].sort(), ["business_profiles","integrations","pro_tools_configs"]);
  assert.deepEqual(h.counts(), {gateReads:1,stateReads:1});
});

test("a new request observes a disconnect immediately rather than reusing the earlier connection snapshot", async () => {
  const h = fixture();
  assert.equal((await h.read()).channelStates.connected,true);
  h.disconnect();
  assert.equal((await h.read(createStatsOverviewRequestContext({supabase:h.supabase,userId:h.userId}))).channelStates.connected,false);
  assert.equal(h.queries.filter(t => t === "integrations").length,2);
});

test("a request context cannot read another account or another authenticated client", async () => {
  const h = fixture(); let loads = 0;
  for (const [client,account] of [[h.supabase,"other-account"],[{} as SupabaseClient,h.userId]] as const) {
    assert.throws(() => h.overviewContext.read(client,account,"integrations",async () => {loads++; return [];}), /autre requête ou un autre compte/);
  }
  assert.equal(loads,0);
});

test("an actor without pilot permission stays disabled and does not reuse enabled channel flags", async () => {
  const h = fixture();
  assert.equal((await h.read()).metaPilotEnabled,true);
  assert.equal((await h.read(h.overviewContext,false)).metaPilotEnabled,false);
  assert.equal(h.counts().stateReads,2);
});

test("a failed request read is not retried per cube, and a later refresh can recover", async () => {
  const h = fixture(); let attempts = 0;
  const fail = () => {attempts++; return Promise.reject(new Error("database unavailable"));};
  const results = await Promise.allSettled(Array.from({length:20}, () => h.overviewContext.read(h.supabase,h.userId,"proTools",fail)));
  assert.ok(results.every(r => r.status === "rejected")); assert.equal(attempts,1);
  const next = createStatsOverviewRequestContext({supabase:h.supabase,userId:h.userId});
  assert.deepEqual(await next.read(h.supabase,h.userId,"proTools",async () => ({settings:{}})), {settings:{}});
});
