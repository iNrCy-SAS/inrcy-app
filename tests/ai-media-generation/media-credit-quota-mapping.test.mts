import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as policy from "../../lib/aiMediaGenerationQuotaPolicy.ts";
import { deterministicEditorialActionId } from "../../lib/inrAgentEditorialRecoveryPolicy.ts";

type Row=Record<string,unknown>;

test("hashed editorial UUIDs reach the owner-checked RPC without changing stable IDs", async () => {
  const row={...base("image"),quota_unit:"credit",quota_amount:7,outcome:"reserved",job_id:account,job_status:"reserved",is_replay:false};
  const args={accountId:account,actorAuthUserId:actor,edition:"standard",requestKey:"automatic-id-regression",requestFingerprint:"a".repeat(64),mediaKind:"image",surface:"booster",quotaUnit:"credit",quotaAmount:7};
  const ids=["40e44c0e-51df-8aaf-6da6-641ab73f1177","618816e0-0ac5-de22-87e6-ce6ee848215b","1eb7c1f0-3a8f-ca5a-c512-9a0d88ce960b",
    ...Array.from({length:64},(_,i)=>deterministicEditorialActionId({version:1,userId:account,slotKey:`slot-${i}`}))];
  for(const id of ids) {
    const f=fixture([row],true);
    await f.api.reserveAiMediaGeneration({...args,automaticEditorialActionId:id});
    assert.equal(f.calls[0].name,"reserve_inr_agent_media_generation_v1");
    assert.equal((f.calls[0].args as Row).p_editorial_action_id,id);
  }
  const invalid=fixture([row],true);
  for(const id of ["not-a-uuid",`${account}' OR true`,account.replaceAll("-","")])
    await assert.rejects(invalid.api.reserveAiMediaGeneration({...args,automaticEditorialActionId:id}),/invalide/);
  await assert.rejects(invalid.api.reserveAiMediaGeneration({...args,accountId:ids[0]}),/invalide/);
  assert.equal(invalid.calls.length,0);
});
const account="11111111-1111-4111-8111-111111111111",actor="22222222-2222-4222-8222-222222222222";
const output=ts.transpileModule(readFileSync(new URL("../../lib/aiMediaGenerationQuota.ts",import.meta.url),"utf8"),{
  compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
}).outputText;
function fixture(rows:Row[], unified = false, respond?: (name:string,args:Row)=>Promise<{data:unknown;error:unknown}>) {
  const calls:Row[]=[];
  const rpc=async(name:string,args:Row)=>{calls.push({name,args});if(respond)return respond(name,args);return name === "get_ai_media_generation_quota_v4" && !unified
    ? { data: null, error: { code: "PGRST202", message: "Could not find get_ai_media_generation_quota_v4" } } : {data:rows,error:null};};
  const modules:Record<string,unknown>={"server-only":{},"node:crypto":crypto,"@/lib/supabaseAdmin":{supabaseAdmin:{rpc}},"@/lib/aiMediaGenerationQuotaPolicy":policy};
  const runtime={exports:{} as {getAiMediaQuotaSnapshot(args:Row):Promise<Row>;reserveAiMediaGeneration(args:Row):Promise<Row>;completeAiMediaGeneration(args:Row):Promise<Row>;failAiMediaGeneration(args:Row):Promise<Row>}};
  new Function("module","exports","require",output)(runtime,runtime.exports,(name:string)=>{
    assert.ok(Object.hasOwn(modules,name),`Unexpected dependency ${name}`);return modules[name];
  });return {calls,api:runtime.exports,get:()=>runtime.exports.getAiMediaQuotaSnapshot({accountId:account,actorAuthUserId:actor,edition:"standard"})};
}
const base=(kind:string):Row=>({account_id:account,edition:"standard",studio_enabled:true,media_kind:kind,quota_unit:kind==="image"?"item":"second",
  limit_count:kind==="image"?45:104,used_count:0,reserved_count:0,remaining_count:kind==="image"?45:104,period_start:"2026-10-01",reset_at:"2026-11-01T00:00:00Z"});
const breakdown=(kind:string):Row=>({included_remaining_count:kind==="image"?25:54,included_limit_count:kind==="image"?25:54,included_used_count:0,included_reserved_count:0,
  purchased_remaining_count:kind==="image"?20:50,purchased_reserved_count:0,purchased_debt_count:0,purchased_held_count:0,purchased_suspended_deficit_count:0});
test("quota v3 maps included and purchased counters independently for images and videos",async()=>{
  const f=fixture([ {...base("image"),...breakdown("image")}, {...base("video"),...breakdown("video")} ]),q=await f.get();
  assert.equal(f.calls[0].name,"get_ai_media_generation_quota_v4");
  assert.equal(f.calls[1].name,"get_ai_media_generation_quota_v3");
  assert.equal(q.creditsReady,false);
  assert.equal((q.credits as Row).remaining,0);
  assert.deepEqual(q.image,{unit:"item",limit:45,used:0,reserved:0,remaining:45,includedRemaining:25,includedLimit:25,includedUsed:0,includedReserved:0,purchasedRemaining:20,purchasedReserved:0,purchasedDebt:0,purchasedHeld:0,purchasedSuspendedDeficit:0});
  assert.equal((q.video as Row).purchasedRemaining,50);assert.equal((q.video as Row).includedLimit,54);
});

test("credit reservations pass the frozen amount to v3 and never reinterpret it as seconds",async()=>{
  const row={...base("video"),quota_unit:"credit",quota_amount:37,outcome:"reserved",job_id:account,job_status:"reserved",is_replay:false};
  const f=fixture([row],true);
  const result=await f.api.reserveAiMediaGeneration({accountId:account,actorAuthUserId:actor,edition:"standard",requestKey:"credit-request",requestFingerprint:"a".repeat(64),mediaKind:"video",surface:"studio",quotaUnit:"credit",quotaAmount:37,metadata:{quote_version:"price-v1"}});
  assert.equal(f.calls[0].name,"reserve_ai_media_generation_v3");
  assert.equal((f.calls[0].args as Row).p_quota_amount,37);
  assert.equal(result.quotaAmount,37);
  assert.equal((result.quota as Row).unit,"credit");
});

test("missing credit RPCs fail closed; fallback is only explicit legacy completion",async()=>{
  const missing=(name:string)=>({data:null,error:{code:"PGRST202",message:`Could not find ${name}`}});
  const f=fixture([],true,async name=>missing(name));
  const args={accountId:account,jobId:actor,mediaId:account,quotaUnit:"credit"};
  await assert.rejects(f.api.completeAiMediaGeneration(args),/indisponible/);
  assert.deepEqual(f.calls.map(call=>call.name),["complete_ai_media_generation_v3"]);
  const row={...base("video"),job_id:actor,job_status:"completed",media_id:account,quota_amount:8};
  const legacy=fixture([],false,async name=>name.endsWith("_v3")?missing(name):{data:[row],error:null});
  await legacy.api.completeAiMediaGeneration({...args,quotaUnit:"second"});
  assert.deepEqual(legacy.calls.map(call=>call.name),["complete_ai_media_generation_v3","complete_ai_media_generation_v2"]);
});

test("authorization failures on the unified RPC cannot fall back to the old wallet",async()=>{
  const f=fixture([],true,async()=>({data:null,error:{code:"42501",message:"permission denied"}}));
  await assert.rejects(f.get(),/indisponible/);
  assert.equal(f.calls.length,1);
});

test("unified snapshot exposes one credit pool and compatibility counters are derived equivalents",async()=>{
  const row={...base("media"),...breakdown("image"),quota_unit:"credit",wallet_ready:true,
    limit_count:1215,used_count:21,reserved_count:70,remaining_count:1124,
    included_limit_count:715,included_used_count:21,included_reserved_count:70,included_remaining_count:624,
    purchased_remaining_count:500};
  const f=fixture([row],true),q=await f.get();
  assert.equal(f.calls.length,1);assert.equal(q.creditsReady,true);
  assert.equal((q.credits as Row).remaining,1124);
  assert.equal((q.credits as Row).periodStart,"2026-10-01");
  assert.equal((q.image as Row).remaining,Math.floor(1124/7));
  assert.equal((q.video as Row).remaining,Math.floor(1124/10));
});

test("a credit advance remains signed; legacy equivalents and non-balance counts remain nonnegative",async()=>{
  const row={...base("media"),...breakdown("image"),quota_unit:"credit",wallet_ready:true,
    limit_count:735,used_count:835,reserved_count:0,remaining_count:-100,
    included_limit_count:735,included_used_count:835,included_reserved_count:0,included_remaining_count:-100,purchased_remaining_count:0};
  const q=await fixture([row],true).get();
  assert.equal((q.credits as Row).remaining,-100);assert.equal((q.credits as Row).includedRemaining,-100);
  for(const kind of ["image","video"]){assert.equal((q[kind] as Row).remaining,0);assert.equal((q[kind] as Row).includedRemaining,0);}
  await assert.rejects(fixture([{...row,used_count:-1}],true).get(),/used_count/);
  await assert.rejects(fixture([{...row,purchased_remaining_count:-1}],true).get(),/purchased_remaining_count/);
});

test("only the explicit automatic server context selects the private advance RPC",async()=>{
  const row={...base("image"),quota_unit:"credit",quota_amount:7,remaining_count:-7,outcome:"reserved",job_id:account,job_status:"reserved",is_replay:false};
  const args={accountId:account,actorAuthUserId:actor,edition:"standard",requestKey:"automatic-request",requestFingerprint:"a".repeat(64),mediaKind:"image",surface:"booster",quotaUnit:"credit",quotaAmount:7};
  const f=fixture([row],true);await f.api.reserveAiMediaGeneration({...args,automaticEditorialActionId:actor});
  assert.equal(f.calls[0].name,"reserve_inr_agent_media_generation_v1");
  assert.equal((f.calls[0].args as Row).p_editorial_action_id,actor);
  const manual=fixture([row],true);await manual.api.reserveAiMediaGeneration({...args,metadata:{credit_overdraft_allowed:true,automatic_editorial_action_id:actor}});
  assert.equal(manual.calls[0].name,"reserve_ai_media_generation_v3");
  assert.equal(Object.hasOwn(manual.calls[0].args as Row,"p_editorial_action_id"),false);
  await assert.rejects(f.api.reserveAiMediaGeneration({...args,surface:"studio",automaticEditorialActionId:actor}),/automatiques/);
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
