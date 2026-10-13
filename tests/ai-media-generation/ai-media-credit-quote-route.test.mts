import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import * as crypto from "node:crypto";
import ts from "typescript";
import * as pricing from "../../lib/aiMediaCreditsPricing.ts";
import * as policy from "../../lib/aiMediaGenerationQuotaPolicy.ts";

type Row=Record<string,unknown>;
function load<T>(path:string,modules:Record<string,unknown>):T {
  const output=ts.transpileModule(readFileSync(new URL(`../../${path}`,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
  const runtime={exports:{} as T};
  new Function("module","exports","require","console",output)(runtime,runtime.exports,(name:string)=>{
    assert.ok(Object.hasOwn(modules,name),`Unmocked dependency: ${name}`);return modules[name];
  },{error(){}});
  return runtime.exports;
}
const quotes=load<{createAiMediaServerQuote(accountId:string,input:pricing.AiMediaCreditsQuoteInput):pricing.AiMediaCreditsQuote & {quoteId:string}}>("lib/aiMediaCreditQuoteServer.ts",{
  "server-only":{},"node:crypto":crypto,"./aiMediaCreditsPricing.ts":pricing,
});
const presentation=load<{presentAiMediaQuotaCounter(counter:Row,unlimited:boolean):Row}>("lib/aiMediaQuotaPresentation.ts",{"@/lib/aiMediaGenerationQuotaPolicy":policy});
function fixture(options:{authenticated?:boolean;creditsReady?:boolean;unlimited?:boolean;maxDuration?:number;accountId?:string}={}) {
  const accountId=options.accountId??"11111111-1111-4111-8111-111111111111";
  const actorId="22222222-2222-4222-8222-222222222222";
  const calls:Row[]=[];
  class QuotaError extends Error { code="test";httpStatus=503; }
  const api=load<{POST(request:Request):Promise<Response>}>("app/api/media-generation/quote/route.ts",{
    "next/server":{NextResponse:{json:(value:unknown,init?:ResponseInit)=>Response.json(value,init)}},
    "@/lib/aiMediaCreditQuoteServer":quotes,
    "@/lib/aiMediaGenerationQuota":{AiMediaGenerationQuotaError:QuotaError,getAiMediaQuotaSnapshot:async(args:Row)=>{
      calls.push({type:"wallet",...args});return {creditsReady:options.creditsReady!==false,credits:{unit:"credit",limit:715,used:3,reserved:0,remaining:712}};
    }},
    "@/lib/aiMediaQuotaPresentation":presentation,
    "@/lib/dashboardEditionServer":{getDashboardEditionForAccountId:async(id:string)=>{calls.push({type:"edition",id});return "standard";}},
    "@/lib/multicompte/server":{getCurrentInrcyAccountScope:async()=>options.authenticated===false?null:{supabase:{},scope:{activeUserId:accountId,authUserId:actorId}}},
    "@/lib/aiUsageQuota":{isAdminUserForAi:async()=>options.unlimited===true},
    "@/lib/aiMediaVideoEntitlementServer":{getAiMediaVideoEntitlement:async(args:Row)=>{calls.push({type:"entitlement",...args});return {maxDurationSeconds:options.maxDuration??30};}},
  });
  return {accountId,actorId,calls,post:(body:unknown)=>api.POST(new Request("https://example.invalid/api/media-generation/quote",{method:"POST",body:JSON.stringify(body),headers:{"Content-Type":"application/json"}}))};
}
const fourSeconds={kind:"video",videoEngine:"grok-lite",durationSeconds:4,withNarration:false};

test("quote rejects unauthenticated callers before wallet or edition access",async()=>{
  const f=fixture({authenticated:false});const response=await f.post(fourSeconds);
  assert.equal(response.status,401);assert.equal(f.calls.length,0);
});
test("quote refuses an unavailable migration with no paid or reservation operation",async()=>{
  const f=fixture({creditsReady:false});const response=await f.post(fourSeconds);
  assert.equal(response.status,503);assert.equal((await response.json()).code,"AI_MEDIA_CREDITS_NOT_READY");
  assert.ok(f.calls.every(call=>["wallet","edition"].includes(String(call.type))));
});
test("invalid engines and unsupported durations cannot obtain a usable quote",async()=>{
  for(const body of [{...fourSeconds,videoEngine:"unreviewed-engine"},{...fourSeconds,durationSeconds:0},{...fourSeconds,videoEngine:"omni",durationSeconds:21},{kind:"image",imageEngine:"unreviewed-engine"}]) {
    const response=await fixture().post(body);assert.equal(response.status,400);assert.equal((await response.json()).code,"AI_MEDIA_QUOTE_INVALID");
  }
});
test("a silent four-second clip costs twelve credits and quote identity belongs to the active account",async()=>{
  const first=fixture();const response=await first.post({...fourSeconds,accountId:"forged-account",expectedCredits:0});const body=await response.json();
  assert.equal(response.status,200);assert.match(response.headers.get("cache-control")??"",/no-store/);
  assert.equal(body.quote.totalCredits,12);assert.equal(body.credits.unit,"credit");
  assert.equal(body.quote.quoteId,quotes.createAiMediaServerQuote(first.accountId,fourSeconds).quoteId);
  assert.ok(first.calls.some(call=>call.type==="wallet"&&call.accountId===first.accountId&&call.actorAuthUserId===first.actorId));
  const other=fixture({accountId:"33333333-3333-4333-8333-333333333333"});const otherBody=await(await other.post(fourSeconds)).json();
  assert.equal(otherBody.quote.totalCredits,body.quote.totalCredits);assert.notEqual(otherBody.quote.quoteId,body.quote.quoteId);
});
test("outputs below four seconds are rejected for silent clips, narration and characters",async()=>{
  for(const durationSeconds of [1,2,3]) for(const speech of [{withNarration:false},{withNarration:true},{teamVideoSpeechMode:"characters"},{voiceMode:"characters",creationMode:"free"}]) {
    const response=await fixture().post({...fourSeconds,durationSeconds,...speech});
    assert.equal(response.status,400);
  }
});
test("account duration restrictions return 403; the global admin has an unlimited commercial counter",async()=>{
  const restricted=fixture({maxDuration:4});const input={...fourSeconds,durationSeconds:5};
  const response=await restricted.post(input);assert.equal(response.status,403);assert.equal((await response.json()).code,"AI_MEDIA_VIDEO_DURATION_NOT_ALLOWED");
  const admin=fixture({maxDuration:4,unlimited:true});const adminResponse=await admin.post(input);const body=await adminResponse.json();
  assert.equal(adminResponse.status,200);assert.equal(body.credits.limit,null);assert.equal(body.credits.remaining,null);
  assert.equal(body.quote.totalCredits,15);assert.ok(!admin.calls.some(call=>call.type==="entitlement"));
});

test("same-priced image formats have distinct account-scoped quote identities", () => {
  const square = quotes.createAiMediaServerQuote("account-a", {kind:"image",imageEngine:"flux",format:"square",inspirationImagesCount:1});
  const story = quotes.createAiMediaServerQuote("account-a", {kind:"image",imageEngine:"flux",format:"story",inspirationImagesCount:1});
  const other = quotes.createAiMediaServerQuote("account-b", {kind:"image",imageEngine:"flux",format:"square",inspirationImagesCount:1});
  assert.equal(square.totalCredits, story.totalCredits);
  assert.notEqual(square.quoteId, story.quoteId);
  assert.notEqual(square.quoteId, other.quoteId);
  assert.deepEqual(story.imageDimensions, {width:864,height:1536});
});
