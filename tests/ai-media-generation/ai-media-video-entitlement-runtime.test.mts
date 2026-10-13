import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import ts from "typescript";
import * as policy from "../../lib/aiMediaGenerationQuotaPolicy.ts";

type Row=Record<string,unknown>;
function load<T>(path:string,modules:Record<string,unknown>):T {
  const output=ts.transpileModule(readFileSync(new URL(`../../${path}`,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const runtime={exports:{} as T};
  new Function("module","exports","require",output)(runtime,runtime.exports,(name:string)=>{
    assert.ok(Object.hasOwn(modules,name),`Unmocked dependency ${name}`);return modules[name];
  });return runtime.exports;
}
function fixture(plan:unknown=30,account:unknown=null,unavailable=false) {
  const calls:Row[]=[];
  const from=(table:string)=>{
    const query={select(){return query;},eq(key:string,value:unknown){calls.push({table,key,value});return query;},async maybeSingle(){
      return {error:unavailable?{message:"synthetic unavailable"}:null,data:table==="ai_media_plan_limits"?{video_max_duration_seconds:plan}:{video_max_duration_seconds_override:account}};
    }};return query;
  };
  const api=load<{getAiMediaVideoEntitlement(args:Row):Promise<{maxDurationSeconds:number;allowedDurationsSeconds:number[];source:string}>}>("lib/aiMediaVideoEntitlementServer.ts",{
    "server-only":{},"@/lib/aiMediaGenerationQuotaPolicy":policy,"@/lib/supabaseAdmin":{supabaseAdmin:{from}},
  });
  return {calls,get:()=>api.getAiMediaVideoEntitlement({accountId:"test-account",edition:"standard"})};
}

test("the account offers the global 4..30 range before any engine compatibility restriction",async()=>{
  const f=fixture();const result=await f.get();
  assert.equal(result.maxDurationSeconds,30);assert.equal(result.source,"plan");
  assert.deepEqual(result.allowedDurationsSeconds,Array.from({length:27},(_,index)=>index+4));
  assert.ok(f.calls.some(call=>call.table==="ai_media_account_limits"&&call.key==="account_id"&&call.value==="test-account"));
});
test("a deliberate account ceiling takes precedence, including an old ceiling below the new minimum",async()=>{
  const account=await fixture(30,16).get();assert.equal(account.source,"account");assert.equal(account.maxDurationSeconds,16);
  assert.deepEqual(account.allowedDurationsSeconds,Array.from({length:13},(_,index)=>index+4));
  const old=await fixture(30,3).get();assert.equal(old.maxDurationSeconds,3);assert.deepEqual(old.allowedDurationsSeconds,[]);
  assert.deepEqual((await fixture(8).get()).allowedDurationsSeconds,[4,5,6,7,8]);
});
test("missing or malformed plan data falls back to thirty seconds while rejecting fractional account limits",async()=>{
  for(const {plan,account,unavailable} of [{plan:undefined,account:null,unavailable:true},{plan:31,account:2.5,unavailable:false},{plan:null,account:null,unavailable:false}]) {
    const result=await fixture(plan,account,unavailable).get();
    assert.equal(result.source,"fallback");assert.equal(result.maxDurationSeconds,30);assert.equal(result.allowedDurationsSeconds[0],4);
  }
});
test("public quota presentation changes only the duration choices and unlimited monetary display",()=>{
  const api=load<{presentAiMediaQuota(snapshot:Row,unlimited:boolean,cap?:number):Row}>("lib/aiMediaQuotaPresentation.ts",{"@/lib/aiMediaGenerationQuotaPolicy":policy});
  const counter={unit:"credit",limit:715,used:70,reserved:20,remaining:625};
  const snapshot={accountId:"test-account",edition:"standard",creditsReady:true,studioEnabled:true,periodStart:"2026-10-01",resetAt:"2026-11-01",credits:counter,image:{...counter,unit:"item"},video:{...counter,unit:"second"}};
  const ordinary=api.presentAiMediaQuota(snapshot,false,8);
  assert.deepEqual(ordinary.videoAllowedDurationsSeconds,[4,5,6,7,8]);assert.deepEqual(ordinary.credits,counter);
  const admin=api.presentAiMediaQuota(snapshot,true,8);
  assert.equal((admin.credits as Row).remaining,null);assert.equal((admin.credits as Row).limit,null);
  assert.equal((admin.credits as Row).used,70);assert.equal((admin.credits as Row).reserved,20);
  assert.deepEqual(admin.videoAllowedDurationsSeconds,Array.from({length:27},(_,index)=>index+4));
});
