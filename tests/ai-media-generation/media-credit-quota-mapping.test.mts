import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as policy from "../../lib/aiMediaGenerationQuotaPolicy.ts";

type Row=Record<string,unknown>;
const account="11111111-1111-4111-8111-111111111111",actor="22222222-2222-4222-8222-222222222222";
const output=ts.transpileModule(readFileSync(new URL("../../lib/aiMediaGenerationQuota.ts",import.meta.url),"utf8"),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;
function fixture(rows:Row[]) {
  const calls:Row[]=[];
  const rpc=async(name:string,args:Row)=>{calls.push({name,args});return {data:rows,error:null};};
  const modules:Record<string,unknown>={"server-only":{},"node:crypto":crypto,"@/lib/supabaseAdmin":{supabaseAdmin:{rpc}},"@/lib/aiMediaGenerationQuotaPolicy":policy};
  const runtime={exports:{} as {getAiMediaQuotaSnapshot(args:Row):Promise<Row>}};
  new Function("module","exports","require",output)(runtime,runtime.exports,(name:string)=>{
    assert.ok(Object.hasOwn(modules,name),`Unexpected dependency ${name}`);return modules[name];
  });return {calls,get:()=>runtime.exports.getAiMediaQuotaSnapshot({accountId:account,actorAuthUserId:actor,edition:"standard"})};
}
const base=(kind:string):Row=>({account_id:account,edition:"standard",studio_enabled:true,media_kind:kind,quota_unit:kind==="image"?"item":"second",
  limit_count:kind==="image"?45:104,used_count:0,reserved_count:0,remaining_count:kind==="image"?45:104,period_start:"2026-10-01",reset_at:"2026-11-01T00:00:00Z"});
const breakdown=(kind:string):Row=>({included_remaining_count:kind==="image"?25:54,included_limit_count:kind==="image"?25:54,included_used_count:0,included_reserved_count:0,
  purchased_remaining_count:kind==="image"?20:50,purchased_reserved_count:0,purchased_debt_count:0,purchased_held_count:0,purchased_suspended_deficit_count:0});
test("quota v3 maps included and purchased counters independently for images and videos",async()=>{
  const f=fixture([ {...base("image"),...breakdown("image")}, {...base("video"),...breakdown("video")} ]),q=await f.get();
  assert.equal(f.calls[0].name,"get_ai_media_generation_quota_v3");
  assert.deepEqual(q.image,{unit:"item",limit:45,used:0,reserved:0,remaining:45,includedRemaining:25,includedLimit:25,includedUsed:0,includedReserved:0,purchasedRemaining:20,purchasedReserved:0,purchasedDebt:0,purchasedHeld:0,purchasedSuspendedDeficit:0});
  assert.equal((q.video as Row).purchasedRemaining,50);assert.equal((q.video as Row).includedLimit,54);
});
test("month2 image mapping keeps lifetime bought consumption out of included monthly usage",async()=>{
  const image={...base("image"),...breakdown("image"),limit_count:45,used_count:1,remaining_count:44,purchased_remaining_count:19};
  const q=await fixture([image,{...base("video"),...breakdown("video")}]).get();
  assert.equal((q.image as Row).used,1);assert.equal((q.image as Row).includedUsed,0);assert.equal((q.image as Row).purchasedRemaining,19);
});
test("legacy mock rows omit purchased fields; image suspension defaults and malformed counts remain validated",async()=>{
  const q=await fixture([base("image"),base("video")]).get();
  assert.equal(Object.hasOwn(q.image as Row,"purchasedRemaining"),false);
  const image={...base("image"),...breakdown("image"),purchased_held_count:undefined,purchased_suspended_deficit_count:undefined};
  const old=await fixture([image,base("video")]).get();assert.equal((old.image as Row).purchasedHeld,0);
  await assert.rejects(fixture([{...image,purchased_remaining_count:-1},base("video")]).get(),/purchased_remaining_count/);
});
