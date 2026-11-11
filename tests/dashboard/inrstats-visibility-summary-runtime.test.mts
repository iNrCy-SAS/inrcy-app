import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";

function runtime(options: {unauthorized?:boolean; failed?:boolean} = {}) {
  const filters: Record<string,unknown> = {}; let reads = 0;
  const query = {select(columns:string) {assert.equal(columns,"observed_on,score");return this;},eq(key:string,value:unknown) {filters[key]=value;return this;},order(key:string,opts:{ascending:boolean}) {assert.equal(key,"observed_on");assert.equal(opts.ascending,false);return this;},limit(count:number) {assert.equal(count,8);return this;},
    then(resolve:(value:unknown)=>unknown) {return Promise.resolve({data:[{observed_on:"2026-11-11",score:321,inputs:{private:"secret"}}],error:options.failed ? {message:"private database failure"} : null}).then(resolve);}};
  const dependencies: Record<string,unknown> = {
    "next/server":{NextResponse:{json:(body:unknown,init:ResponseInit = {}) => Response.json(body,init)}},
    "@/lib/requireUser":{requireUser:async () => ({activeUserId:"trusted-active-account",errorResponse:options.unauthorized ? Response.json({error:"unauthorized"},{status:401}) : null})},
    "@/lib/supabaseAdmin":{supabaseAdmin:{from(table:string) {reads++; assert.equal(table,"inrstats_visibility_snapshots","The summary cannot touch tracking, rewards or any other table");return query;}}},
    "@/lib/inrstats/visibilityIndexModel":{VISIBILITY_INDEX_CHANNELS:["facebook"],VISIBILITY_INDEX_MODEL:{version:"v1"}},
    "@/lib/inrstats/visibilityIndexSnapshots":{},
    "@/lib/inrstats/visibilityIndexRewards":{readVisibilityRewards:()=>assert.fail("read-only summary must not reconcile rewards"),reconcileVisibilityRewards:()=>assert.fail("read-only summary must not reconcile rewards")},
  };
  const exports: {GET?:(req:Request)=>Promise<Response>} = {};
  const code = ts.transpileModule(readFileSync(new URL("../../app/api/inrstats/visibility-index/route.ts",import.meta.url),"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
  new Function("exports","require","console",code)(exports,(id:string) => {assert.ok(id in dependencies,id);return dependencies[id];},{warn() {}});
  return {filters,reads:()=>reads,get:exports.GET!};
}

test("the summary is scoped to the trusted account, bounded, private and free of writes",async () => {
  const h = runtime(); const response = await h.get(new Request("https://app.test/api/inrstats/visibility-index?summary=1&userId=foreign-account"));
  assert.equal(response.status,200); const body = await response.json();
  assert.equal(body.scope,"trusted-active-account"); assert.equal(h.filters.user_id,"trusted-active-account"); assert.equal(h.filters.model_version,"v1");
  assert.deepEqual(body.records,[{date:"2026-11-11",value:321}]); assert.equal(h.reads(),1);
  assert.equal(response.headers.get("Cache-Control"),"private, no-store"); assert.doesNotMatch(JSON.stringify(body),/secret|inputs/);
});
test("unauthenticated summary requests cannot read the private table",async () => {
  const h = runtime({unauthorized:true}); assert.equal((await h.get(new Request("https://app.test/api/inrstats/visibility-index?summary=1"))).status,401); assert.equal(h.reads(),0);
});
test("a failed private read reports unavailable rather than fabricating a zero",async () => {
  const h = runtime({failed:true}); const response = await h.get(new Request("https://app.test/api/inrstats/visibility-index?summary=1"));
  assert.equal(response.status,503); assert.deepEqual(await response.json(),{error:"visibility_history_unavailable"});
});
