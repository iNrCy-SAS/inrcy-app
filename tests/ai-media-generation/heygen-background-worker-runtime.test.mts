import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import sharp from "sharp";
import ts from "typescript";
import * as requestSizes from "../../lib/aiMediaImageProviderRequest.ts";
import type * as Background from "../../lib/aiVideoHeygenBackground.ts";
import type * as Worker from "../../lib/aiMediaPendingVideoWorker.ts";
import type { AiVideoProviderGenerationArgs } from "../../lib/aiVideoProviderTypes.ts";

function load<T>(file:string,dependencies:Record<string,unknown>,clock=Date):T {
 const js=ts.transpileModule(readFileSync(new URL("../../lib/"+file,import.meta.url),"utf8"),{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022,esModuleInterop:true}}).outputText;
 const record={exports:{}};new Function("module","exports","require","Date",js)(record,record.exports,(id:string)=>{if(id==="server-only")return {};assert.ok(id in dependencies,"unexpected import "+id);return dependencies[id];},clock);return record.exports as T;
}

function args(environment=false):AiVideoProviderGenerationArgs {return {accountId:"account-1",signal:new AbortController().signal,
 creativeBrief:"A garden",request:{format:"story",freePrompt:"Nous présentons notre entreprise dans un jardin en automne.",
 inspirationImages:[{role:"character",data:"PRIVATE_PERSON_PHOTO"},...(environment?[{role:"environment"}]:[])]},
 plan:{scenes:[{visualBrief:"Sunlit autumn garden"}]}} as unknown as AiVideoProviderGenerationArgs;}
async function backgroundHarness(){const calls:Array<Record<string,unknown>>=[];
 const image=await sharp({create:{width:32,height:48,channels:3,background:"#228844"}}).png().toBuffer();
 const runtime=load<typeof Background>("aiVideoHeygenBackground.ts",{sharp,
 "@/lib/aiMediaGateway":{generateAiMediaImage:async(input:Record<string,unknown>)=>{calls.push(input);return {buffer:image};}},
 "./aiMediaImageProviderRequest.ts":requestSizes});return {runtime,calls,image};}
test("a requested garden becomes one empty environment image and no portrait is sent to its generator",async()=>{
 const h=await backgroundHarness();const input=args();const before=structuredClone(input.request);
 const result=await h.runtime.prepareHeygenBackground(input,[Buffer.from("original-person")]);
 assert.equal(h.calls.length,1);assert.deepEqual(h.calls[0].identityReferences,[]);assert.equal(h.calls[0].officialLogo,null);
 assert.match(String(h.calls[0].prompt),/jardin en automne/);assert.match(String(h.calls[0].prompt),/Do not draw people/);
 assert.doesNotMatch(JSON.stringify(h.calls),/PRIVATE_PERSON_PHOTO|original-person/);
 assert.deepEqual(input.request,before);const metadata=await sharp(result).metadata();assert.equal(metadata.format,"png");assert.equal(metadata.height,1280);
});
test("an attached Decor is used directly without an extra paid image request",async()=>{
 const h=await backgroundHarness();await h.runtime.prepareHeygenBackground(args(true),[Buffer.from("original-person"),h.image]);
 assert.equal(h.calls.length,0);
});
test("a cancelled background preparation submits nothing",async()=>{
 const h=await backgroundHarness();const input=args();input.signal=AbortSignal.abort();
 await assert.rejects(h.runtime.prepareHeygenBackground(input,[]));assert.equal(h.calls.length,0);
});

test("the accepted render continues by scoped reads until completion, including without a cron",async()=>{
 const calls:unknown[]=[];const scope={accountId:"account-1",jobId:"job-1"};let polls=0;const waits:number[]=[];
 const runtime=load<typeof Worker>("aiMediaPendingVideoWorker.ts",{
 "node:timers/promises":{setTimeout:async(ms:number)=>{waits.push(ms);}},
 "./aiMediaCompositionRecovery.ts":{recoverNextAiMediaCompositionCheckpoint:async(value:unknown)=>{calls.push(value);return {status:++polls===3?"completed":"retry_pending"};}}});
 await runtime.continuePendingAiMediaVideo(scope,Date.now()+120_000);
 assert.equal(polls,3);assert.deepEqual(calls,[scope,scope,scope]);assert.deepEqual(waits,[30_000,30_000]);
});
test("the local continuation never submits another video after a transient provider read error",async()=>{
 let polls=0;const runtime=load<typeof Worker>("aiMediaPendingVideoWorker.ts",{
 "node:timers/promises":{setTimeout:async()=>{}},
 "./aiMediaCompositionRecovery.ts":{recoverNextAiMediaCompositionCheckpoint:async()=>{if(++polls===1)throw new Error("temporary");return {status:"failed"};}}});
 await runtime.continuePendingAiMediaVideo({accountId:"account-1",jobId:"job-1"},Date.now()+120_000);assert.equal(polls,2);
});

test("a temporary release failure retains the owned token, retries it and completes the accepted job once",async()=>{
 const scope={accountId:"account-1",jobId:"job-1"};const checkpoint={...scope,leaseToken:"our-token"};
 let now=0,releases=0,polls=0,activeChecks=0,completions=0,released=false;const waits:number[]=[];
 class Clock extends Date {static now(){return now;}}
 const runtime=load<typeof Worker>("aiMediaPendingVideoWorker.ts",{
  "node:timers/promises":{setTimeout:async(ms:number)=>{waits.push(ms);now+=ms;}},
  "./aiMediaCompositionRecovery.ts":{
   releaseAiMediaCompositionCheckpoint:async(value:unknown)=>{assert.deepEqual(value,checkpoint);if(++releases===1)throw new Error("temporary release outage");released=true;return true;},
   recoverNextAiMediaCompositionCheckpoint:async(value:unknown)=>{assert.deepEqual(value,scope);polls++;if(!released)return {status:"idle"};completions++;return {status:"completed"};},
   hasActiveAiMediaCompositionCheckpoint:async(value:unknown)=>{assert.deepEqual(value,scope);activeChecks++;return true;},
  },
 },Clock);
 await runtime.continuePendingAiMediaVideo(scope,120_000,checkpoint);
 assert.equal(releases,2);assert.equal(polls,2);assert.equal(activeChecks,1);assert.equal(completions,1);assert.deepEqual(waits,[30_000]);
});

test("an already transferred lease is never released again and the worker exits when its owning job completes",async()=>{
 const scope={accountId:"account-1",jobId:"job-1"};const checkpoint={...scope,leaseToken:"old-owned-token"};
 let now=0,releases=0,polls=0,activeChecks=0;const waits:number[]=[];
 class Clock extends Date {static now(){return now;}}
 const runtime=load<typeof Worker>("aiMediaPendingVideoWorker.ts",{
  "node:timers/promises":{setTimeout:async(ms:number)=>{waits.push(ms);now+=ms;}},
  "./aiMediaCompositionRecovery.ts":{
   releaseAiMediaCompositionCheckpoint:async(value:unknown)=>{assert.deepEqual(value,checkpoint);releases++;return false;},
   recoverNextAiMediaCompositionCheckpoint:async()=>{polls++;return {status:"idle"};},
   hasActiveAiMediaCompositionCheckpoint:async()=>++activeChecks===1,
  },
 },Clock);
 await runtime.continuePendingAiMediaVideo(scope,120_000,checkpoint);
 assert.equal(releases,1);assert.equal(polls,2);assert.equal(activeChecks,2);assert.deepEqual(waits,[30_000]);
});

test("an unavailable active-job read after idle keeps the same accepted job until completion",async()=>{
 let now=0,polls=0,activeChecks=0;const waits:number[]=[];
 class Clock extends Date {static now(){return now;}}
 const runtime=load<typeof Worker>("aiMediaPendingVideoWorker.ts",{
  "node:timers/promises":{setTimeout:async(ms:number)=>{waits.push(ms);now+=ms;}},
  "./aiMediaCompositionRecovery.ts":{
   recoverNextAiMediaCompositionCheckpoint:async()=>({status:++polls===1?"idle":"completed"}),
   hasActiveAiMediaCompositionCheckpoint:async()=>{activeChecks++;throw new Error("temporary status outage");},
  },
 },Clock);
 await runtime.continuePendingAiMediaVideo({accountId:"account-1",jobId:"job-1"},120_000);
 assert.equal(polls,2);assert.equal(activeChecks,1);assert.deepEqual(waits,[30_000]);
});

test("an idle job without an active checkpoint exits without waiting or submitting any work",async()=>{
 let polls=0,activeChecks=0;
 const runtime=load<typeof Worker>("aiMediaPendingVideoWorker.ts",{
  "node:timers/promises":{setTimeout:async()=>assert.fail("no pending work should be polled")},
  "./aiMediaCompositionRecovery.ts":{
   recoverNextAiMediaCompositionCheckpoint:async()=>{polls++;return {status:"idle"};},
   hasActiveAiMediaCompositionCheckpoint:async()=>{activeChecks++;return false;},
  },
 });
 await runtime.continuePendingAiMediaVideo({accountId:"account-1",jobId:"job-1"},Date.now()+120_000);
 assert.equal(polls,1);assert.equal(activeChecks,1);
});

test("an occupied lease is followed only until the existing execution deadline",async()=>{
 let now=0,polls=0,activeChecks=0;const waits:number[]=[];
 class Clock extends Date {static now(){return now;}}
 const runtime=load<typeof Worker>("aiMediaPendingVideoWorker.ts",{
  "node:timers/promises":{setTimeout:async(ms:number)=>{waits.push(ms);now+=ms;}},
  "./aiMediaCompositionRecovery.ts":{
   recoverNextAiMediaCompositionCheckpoint:async()=>{polls++;return {status:"idle"};},
   hasActiveAiMediaCompositionCheckpoint:async()=>{activeChecks++;return true;},
  },
 },Clock);
 await runtime.continuePendingAiMediaVideo({accountId:"account-1",jobId:"job-1"},95_000);
 assert.equal(now,85_000);assert.equal(polls,3);assert.equal(activeChecks,3);assert.deepEqual(waits,[30_000,30_000,25_000]);
});

test("a checkpoint from another account or job is rejected before any read or release",async()=>{
 const runtime=load<typeof Worker>("aiMediaPendingVideoWorker.ts",{
  "node:timers/promises":{setTimeout:async()=>assert.fail("no foreign work should be polled")},
  "./aiMediaCompositionRecovery.ts":{},
 });
 const scope={accountId:"account-1",jobId:"job-1"};
 for(const checkpoint of [{...scope,accountId:"account-2",leaseToken:"foreign"},{...scope,jobId:"job-2",leaseToken:"foreign"}]){
  await assert.rejects(runtime.continuePendingAiMediaVideo(scope,Date.now()+120_000,checkpoint),/ai_media_composition_scope_invalid/);
 }
});

test("portrait uploads preserve their source framing in every output format without generating another person",async()=>{
 const h=await backgroundHarness();const top=await sharp({create:{width:20,height:12,channels:3,background:"#ff0000"}}).png().toBuffer();
 const source=await sharp({create:{width:20,height:40,channels:4,background:"#00ff00"}}).composite([{input:top,left:0,top:0}]).png().toBuffer();
 const original=Buffer.from(source);
 for(const format of ["square","portrait","story","landscape"] as const){
  const result=await h.runtime.prepareHeygenAvatarImage(source,format);const meta=await sharp(result).metadata();
  assert.equal(meta.width,20);assert.equal(meta.height,40);assert.equal(meta.format,"png");assert.equal(meta.channels,3);assert.equal(meta.space,"srgb");
  const head=await sharp(result).extract({left:0,top:0,width:1,height:1}).raw().toBuffer();
  const bottom=await sharp(result).extract({left:0,top:39,width:1,height:1}).raw().toBuffer();
  assert.ok(head[0]>250&&head[1]<5,"the original head remains in frame");
  assert.ok(bottom[0]<5&&bottom[1]>250,"the bottom of the source photo is not cropped");
 }
 assert.deepEqual(source,original);assert.equal(h.calls.length,0);
});

test("large original portraits are bounded for asset upload while retaining their aspect ratio",async()=>{
 const h=await backgroundHarness();const source=await sharp({create:{width:2400,height:1200,channels:3,background:"#ffcc88"}}).png().toBuffer();
 const result=await h.runtime.prepareHeygenAvatarImage(source,"story");const meta=await sharp(result).metadata();
 assert.equal(meta.width,1280);assert.equal(meta.height,640);assert.equal(meta.format,"png");
 assert.ok(result.length<=4*1024*1024);assert.equal(h.calls.length,0);
});

test("silent avatar audio has a bounded PCM header, exact duration and no speech samples",async()=>{
 const h=await backgroundHarness();
 for(const duration of [0.5,4,8,15.25,30]){
  const wav=h.runtime.createHeygenSilenceWav(duration);
  assert.equal(wav.toString("ascii",0,4),"RIFF");assert.equal(wav.toString("ascii",8,12),"WAVE");
  assert.equal(wav.readUInt16LE(20),1);assert.equal(wav.readUInt16LE(22),1);assert.equal(wav.readUInt16LE(34),16);
  assert.equal(wav.readUInt32LE(24),16000);assert.equal(wav.length,44+duration*32000);
  assert.equal(wav.readUInt32LE(40),duration*32000);assert.ok(wav.subarray(44).every(value=>value===0));
 }
 for(const duration of [0,-1,Infinity,NaN,31]) assert.throws(()=>h.runtime.createHeygenSilenceWav(duration),/silence_duration_invalid/);
 assert.equal(h.calls.length,0);
});
