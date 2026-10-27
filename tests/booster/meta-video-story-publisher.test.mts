import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as graph from "../../lib/metaGraphApi.ts";
import * as classification from "../../lib/metaGraphErrorClassification.ts";
import type * as Publisher from "../../lib/metaPhotoStoryPublisher.ts";

type Reply={status?:number;body?:unknown;raw?:string;advance?:number}|Error;
type Args=Parameters<typeof Publisher.publishMetaVideoStory>[0];
const base={channel:"facebook" as const,remoteAccountId:"12345",accessToken:"synthetic-token",videoUrl:"https://public-assets.fixture.invalid/clip-8s.mp4"};
const graphPath=(suffix:string)=>`/${graph.META_GRAPH_API_VERSION}/${suffix}`;
const uploadUrl=`https://rupload.facebook.com/video-upload/${graph.META_GRAPH_API_VERSION}/video-1`;
const start={body:{video_id:"video-1",upload_url:uploadUrl}},transfer={body:{success:true}};
const metaError={message:"Synthetic Meta refusal",code:100};

function load(file:string,dependencies:Record<string,unknown>,clock:{now:number}){
 const compiled=ts.transpileModule(readFileSync(new URL(`../../lib/${file}`,import.meta.url),"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const moduleRecord={exports:{}};
 vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`,{URL,URLSearchParams,AbortSignal,setTimeout,Date:{now:()=>clock.now},fetch:()=>assert.fail("Real Meta requests are forbidden")})((name:string)=>{assert.ok(Object.hasOwn(dependencies,name),`Unexpected video publisher dependency ${name}`);return dependencies[name]},moduleRecord,moduleRecord.exports);
 return moduleRecord.exports;
}
function harness(queue:Reply[],allowedTokens=[base.accessToken]){
 const clock={now:Date.now()},events:string[]=[],prepared:Array<string|null>=[],sleeps:number[]=[];
 const calls:Array<{url:URL;method:string;body:URLSearchParams;headers:Headers}>=[];
 const auth=load("instagramAuthMode.ts",{"@/lib/metaGraphApi":graph},clock);
 const runtime=load("metaPhotoStoryPublisher.ts",{"server-only":{},"@/lib/metaGraphApi":graph,"@/lib/instagramAuthMode":auth,"@/lib/metaGraphErrorClassification":classification},clock) as typeof Publisher;
 const fetchImpl:typeof fetch=async(input,init)=>{
  const url=new URL(String(input)),method=String(init?.method||"GET"),body=method==="GET"?url.searchParams:new URLSearchParams(String(init?.body||"")),headers=new Headers(init?.headers);
  assert.ok(["graph.facebook.com","graph.instagram.com","rupload.facebook.com"].includes(url.hostname));assert.equal(url.protocol,"https:");
  assert.equal(init?.cache,"no-store");assert.equal(init?.redirect,"error");assert.ok(init?.signal instanceof AbortSignal);
  if(url.hostname==="rupload.facebook.com"){assert.ok(allowedTokens.some(token=>headers.get("Authorization")===`OAuth ${token}`));assert.equal(headers.get("file_url"),base.videoUrl);assert.equal(body.has("access_token"),false)}
  else assert.ok(allowedTokens.includes(body.get("access_token")||""));
  calls.push({url,method,body,headers});events.push(`request:${url.pathname}:${body.get("upload_phase")||method}`);
  assert.ok(queue.length,"No additional retry or unregistered endpoint call is allowed");const reply=queue.shift()!;
  if(reply instanceof Error)throw reply;clock.now+=reply.advance||0;
  return reply.raw!==undefined?new Response(reply.raw,{status:reply.status||200}):Response.json(reply.body??{},{status:reply.status||200});
 };
 const defaults:Args={...base,onPrepared:async id=>{prepared.push(id);events.push(`prepared:${id}`)},onPublishStarting:async()=>{events.push("publish-starting")}};
 const dependencies={fetchImpl,sleepImpl:async(milliseconds:number)=>{assert.ok(milliseconds>0&&milliseconds<=2000);sleeps.push(milliseconds);clock.now+=milliseconds}};
 return {runtime,clock,calls,events,prepared,sleeps,queue,publish:(override:Partial<Args>={})=>runtime.publishMetaVideoStory({...defaults,...override},dependencies)};
}
const commitCalls=(h:ReturnType<typeof harness>)=>h.calls.filter(call=>call.url.pathname.endsWith("media_publish")||call.body.get("upload_phase")==="finish");

test("Facebook stages a video, persists its real ID and durable commit marker before one native finish",async()=>{
 const h=harness([start,transfer,{body:{success:true}}]);const result=await h.publish();
 assert.equal(result.ok,true);if(result.ok)assert.equal(result.remoteId,"video-1","Facebook finish acknowledges success using the actual staged native video ID");
 assert.deepEqual(h.calls.map(call=>[call.url.origin,call.url.pathname,call.method]),[["https://graph.facebook.com",graphPath("12345/video_stories"),"POST"],["https://rupload.facebook.com",graphPath("video-1").replace(`/${graph.META_GRAPH_API_VERSION}`,`/video-upload/${graph.META_GRAPH_API_VERSION}`),"POST"],["https://graph.facebook.com",graphPath("12345/video_stories"),"POST"]]);
 assert.deepEqual(Object.fromEntries(h.calls[0].body),{upload_phase:"start",access_token:base.accessToken});
 assert.deepEqual(Object.fromEntries(h.calls[2].body),{upload_phase:"finish",video_id:"video-1",access_token:base.accessToken});
 assert.deepEqual(h.prepared,["video-1"]);
 assert.ok(h.events.indexOf("prepared:video-1")>h.events.indexOf(`request:/video-upload/${graph.META_GRAPH_API_VERSION}/video-1:POST`));
 assert.ok(h.events.indexOf("publish-starting")>h.events.indexOf("prepared:video-1"));
 assert.ok(h.events.indexOf(`request:${graphPath("12345/video_stories")}:finish`)>h.events.indexOf("publish-starting"));
});

test("Facebook reuses a durable prepared ID without starting or transferring another video",async()=>{
 const h=harness([{body:{success:true,post_id:"published-story-1"}}]);const result=await h.publish({preparedId:"video-1"});
 assert.equal(result.ok,true);if(result.ok)assert.equal(result.remoteId,"published-story-1");
 assert.equal(h.calls.length,1);assert.equal(h.calls[0].body.get("upload_phase"),"finish");assert.deepEqual(h.prepared,[]);assert.equal(h.events[0],"publish-starting");
});

for(const authMode of [undefined,"facebook_login","instagram_login"] as const)test(`Instagram video ${authMode??"default Facebook login"} persists its container and waits for FINISHED before committing`,async()=>{
 const h=harness([{body:{id:"container-1"}},{body:{status_code:"IN_PROGRESS"}},{body:{status_code:"FINISHED"}},{body:{id:"published-story-1"}}]);
 const result=await h.publish({channel:"instagram",authMode});assert.equal(result.ok,true);
 const origin=authMode==="instagram_login"?"https://graph.instagram.com":"https://graph.facebook.com";
 assert.ok(h.calls.every(call=>call.url.origin===origin));
 assert.deepEqual(Object.fromEntries(h.calls[0].body),{media_type:"STORIES",video_url:base.videoUrl,access_token:base.accessToken});
 assert.deepEqual(h.calls.map(call=>[call.url.pathname,call.method]),[[graphPath("12345/media"),"POST"],[graphPath("container-1"),"GET"],[graphPath("container-1"),"GET"],[graphPath("12345/media_publish"),"POST"]]);
 assert.deepEqual(Object.fromEntries(h.calls[3].body),{creation_id:"container-1",access_token:base.accessToken});
 assert.ok(h.events.indexOf("prepared:container-1")<h.events.indexOf(`request:${graphPath("container-1")}:GET`));
 assert.ok(h.events.indexOf("publish-starting")>h.events.lastIndexOf(`request:${graphPath("container-1")}:GET`));assert.equal(h.sleeps.length,1);
});

test("an Instagram video still processing at the deadline reuses its container on the next attempt",async()=>{
 const h=harness([{body:{id:"container-1"}},{body:{status_code:"IN_PROGRESS"},advance:53_000}]);
 const paused=await h.publish({channel:"instagram"});assert.equal(paused.ok,false);if(!paused.ok){assert.equal(paused.certainty,"not_published");assert.equal(paused.retryable,true)}
 assert.deepEqual(h.prepared,["container-1"]);assert.equal(commitCalls(h).length,0);
 h.queue.push({body:{status_code:"FINISHED"}},{body:{id:"published-story-1"}});
 const done=await h.publish({channel:"instagram",preparedId:"container-1"});assert.equal(done.ok,true);
 assert.equal(h.calls.filter(call=>call.url.pathname.endsWith("/media")).length,1);assert.equal(commitCalls(h).length,1);
});

test("ERROR and EXPIRED invalidate only the prepared Instagram container, while PUBLISHED blocks every new commit",async()=>{
 for(const status of ["ERROR","EXPIRED","PUBLISHED"]){
  const h=harness([{body:{status_code:status}}]);const result=await h.publish({channel:"instagram",preparedId:"container-1"});
  assert.equal(result.ok,false);if(!result.ok){assert.equal(result.certainty,status==="PUBLISHED"?"unknown":"not_published");assert.equal(result.retryable,status!=="PUBLISHED")}
  assert.deepEqual(h.prepared,status==="PUBLISHED"?[]:[null]);assert.equal(commitCalls(h).length,0);
 }
});

test("missing callbacks, invalid IDs and unsafe video URLs cause no Meta request",async()=>{
 for(const override of [{onPrepared:undefined},{onPublishStarting:undefined},{preparedId:"bad/id"},{videoUrl:"http://assets.invalid/clip.mp4"},{videoUrl:"https://user:secret@assets.invalid/clip.mp4"},{videoUrl:"https://assets.invalid/clip.mp4\n"},{remoteAccountId:"bad/id"}]){
  const h=harness([]);const result=await h.publish(override);assert.equal(result.ok,false);assert.equal(h.calls.length,0);
 }
});

test("untrusted Facebook upload destinations never receive the access token or source URL",async()=>{
 for(const upload_url of ["https://evil.invalid/video-upload/v25.0/video-1","https://rupload.facebook.com.evil.invalid/video-upload/v25.0/video-1","http://rupload.facebook.com/video-upload/v25.0/video-1","https://user:secret@rupload.facebook.com/video-upload/v25.0/video-1","https://rupload.facebook.com:444/video-upload/v25.0/video-1","https://rupload.facebook.com/unregistered/video-1","https://rupload.facebook.com/video-upload/v25.0/other-video"]){
  const h=harness([{body:{video_id:"video-1",upload_url}}]);const result=await h.publish();
  assert.equal(result.ok,false);assert.equal(h.calls.length,1);assert.deepEqual(h.prepared,[]);assert.equal(commitCalls(h).length,0);
 }
});

test("Facebook transfer failures remain certain unpublished and cannot advance to a Story finish",async()=>{
 for(const failure of [{status:500,body:{error:metaError}},{status:302,body:{}},{body:{success:false}},{body:{success:true,error:metaError}},{raw:"not-json"},new Error("Transfer timeout")]){
  const h=harness([start,failure]);const result=await h.publish();assert.equal(result.ok,false);
  if(!result.ok){assert.equal(result.certainty,"not_published");assert.equal(result.retryable,true)}
  assert.equal(h.calls.length,2);assert.deepEqual(h.prepared,[]);assert.equal(commitCalls(h).length,0);
 }
});

test("durable preparation and commit callback failures stop before irreversible publication",async()=>{
 for(const channel of ["facebook","instagram"] as const){
  const preparation=harness(channel==="facebook"?[start,transfer]:[{body:{id:"container-1"}}]);
  const failed=await preparation.publish({channel,onPrepared:async()=>{throw Error("CAS unavailable")}});assert.equal(failed.ok,false);assert.equal(commitCalls(preparation).length,0);
  const commit=harness(channel==="instagram"?[{body:{status_code:"FINISHED"}}]:[]);
  const stopped=await commit.publish({channel,preparedId:channel==="facebook"?"video-1":"container-1",onPublishStarting:async()=>{throw Error("CAS lost")}});
  assert.equal(stopped.ok,false);if(!stopped.ok)assert.equal(stopped.certainty,"not_published");assert.equal(commitCalls(commit).length,0);
 }
 const ack=harness([start,transfer]);const badAck=await ack.publish({onPrepared:async()=>null as never});assert.equal(badAck.ok,false);assert.equal(commitCalls(ack).length,0);
 const commitAck=harness([]);const badCommitAck=await commitAck.publish({preparedId:"video-1",onPublishStarting:async()=>null as never});assert.equal(badCommitAck.ok,false);assert.equal(commitCalls(commitAck).length,0);
});

test("an Instagram readiness error never borrows FINISHED from an error payload",async()=>{
 const h=harness([{body:{status_code:"FINISHED",error:metaError}}]);const result=await h.publish({channel:"instagram",preparedId:"container-1"});
 assert.equal(result.ok,false);if(!result.ok)assert.equal(result.certainty,"not_published");assert.equal(commitCalls(h).length,0);
});

for(const channel of ["facebook","instagram"] as const)test(`${channel} video final failures distinguish a certain rejection from unknown delivery without a second POST`,async()=>{
 const id=channel==="facebook"?{post_id:"published-story-1"}:{id:"published-story-1"};
 for(const failure of [{status:400,body:{error:metaError}},{status:408,body:{error:metaError}},{status:500,body:{error:metaError}},{status:400,body:{...id,error:metaError}},{body:{...id,error:metaError}},{body:{}},{raw:"not-json"},new Error("Socket timeout after final POST")]){
  const h=harness([...(channel==="instagram"?[{body:{status_code:"FINISHED"}}]:[]),failure]);
  const result=await h.publish({channel,preparedId:channel==="facebook"?"video-1":"container-1"});assert.equal(result.ok,false);
  if(!result.ok){const certain=!(failure instanceof Error)&&failure.status===400&&!('post_id' in (failure.body||{}))&&!('id' in (failure.body||{}));assert.equal(result.certainty,certain?"not_published":"unknown");assert.equal(result.retryable,certain)}
  assert.equal(commitCalls(h).length,1);assert.equal(h.events.filter(event=>event==="publish-starting").length,1);
 }
});

test("abort or a depleted budget before and after durable callbacks never dispatches a final POST",async()=>{
 const controller=new AbortController();controller.abort();const fresh=harness([]);assert.equal((await fresh.publish({signal:controller.signal})).ok,false);assert.equal(fresh.calls.length,0);
 const expired=harness([]);assert.equal((await expired.publish({deadlineAt:expired.clock.now+1000})).ok,false);assert.equal(expired.calls.length,0);
 const callback=harness([start,transfer]);const result=await callback.publish({onPrepared:async()=>{callback.clock.now+=60_000}});
 assert.equal(result.ok,false);if(!result.ok)assert.equal(result.certainty,"not_published");assert.equal(commitCalls(callback).length,0);
 const cancelled=new AbortController(),commit=harness([]);
 const stopped=await commit.publish({preparedId:"video-1",signal:cancelled.signal,onPublishStarting:async()=>{cancelled.abort()}});
 assert.equal(stopped.ok,false);if(!stopped.ok)assert.equal(stopped.certainty,"not_published");assert.equal(commitCalls(commit).length,0);
});

test("Instagram Page token fallback is used only after a certain primary authorization refusal",async()=>{
 const candidates=[{source:"primary",accessToken:base.accessToken},{source:"page",accessToken:"synthetic-page-token"}];
 const ok=harness([{body:{id:"container-1"}},{body:{status_code:"FINISHED"}},{body:{id:"published-story-1"}}],[base.accessToken,"synthetic-page-token"]);
 assert.equal((await ok.publish({channel:"instagram",authMode:"facebook_login",tokenCandidates:candidates})).ok,true);
 assert.ok(ok.calls.every(call=>call.body.get("access_token")===base.accessToken));
 const fallback=harness([{status:400,body:{error:{code:190,message:"Invalid access token"}}},{body:{id:"container-1"}},{body:{status_code:"FINISHED"}},{body:{id:"published-story-1"}}],[base.accessToken,"synthetic-page-token"]);
 const result=await fallback.publish({channel:"instagram",authMode:"facebook_login",tokenCandidates:candidates});assert.equal(result.ok,true);
 assert.deepEqual(fallback.calls.map(call=>call.body.get("access_token")),[base.accessToken,"synthetic-page-token","synthetic-page-token","synthetic-page-token"]);
 assert.equal(commitCalls(fallback).length,1);
});

test("an authorization fallback reuses the durably acknowledged Instagram container",async()=>{
 const h=harness([{body:{id:"container-1"}},{body:{status_code:"FINISHED"}},{status:400,body:{error:{code:190,message:"Invalid access token"}}},{body:{status_code:"FINISHED"}},{body:{id:"published-story-1"}}],[base.accessToken,"synthetic-page-token"]);
 const result=await h.publish({channel:"instagram",tokenCandidates:[{source:"page",accessToken:"synthetic-page-token"}]});assert.equal(result.ok,true);
 assert.equal(h.calls.filter(call=>call.url.pathname.endsWith("/media")).length,1);assert.deepEqual(h.prepared,["container-1"]);
 assert.deepEqual(commitCalls(h).map(call=>call.body.get("creation_id")),["container-1","container-1"]);
});

test("an uncertain final Instagram POST never rotates tokens or attempts a second publication",async()=>{
 for(const failure of [new Error("Socket timeout after dispatch"),{status:500,body:{error:{code:190,message:"Authentication or delivery unknown"}}},{status:400,body:{id:"possible-published-id",error:{code:190,message:"Contradictory response"}}}]){
  const h=harness([{body:{id:"container-1"}},{body:{status_code:"FINISHED"}},failure],[base.accessToken,"synthetic-page-token"]);
  const result=await h.publish({channel:"instagram",tokenCandidates:[{source:"page",accessToken:"synthetic-page-token"}]});assert.equal(result.ok,false);
  if(!result.ok){assert.equal(result.certainty,"unknown");assert.equal(result.retryable,false)}
  assert.equal(commitCalls(h).length,1);assert.equal(h.calls.length,3);assert.ok(h.calls.every(call=>call.body.get("access_token")===base.accessToken));
 }
});

test("direct Instagram login and Facebook never switch to a Page candidate",async()=>{
 for(const channel of ["facebook","instagram"] as const){
  const h=harness([{status:400,body:{error:{code:190,message:"Invalid access token"}}}],[base.accessToken,"synthetic-page-token"]);
  const result=await h.publish({channel,authMode:"instagram_login",tokenCandidates:[{source:"page",accessToken:"synthetic-page-token"}]});assert.equal(result.ok,false);
  assert.equal(h.calls.length,1);assert.equal(h.calls[0].body.get("access_token"),base.accessToken);
 }
});

test("preparation transport/5xx failures and an exhausted shared deadline never rotate Instagram tokens",async()=>{
 for(const failure of [new Error("Preparation socket timeout"),{status:500,body:{error:{code:190,message:"Server error with misleading OAuth code"}}},{status:400,body:{error:{code:190,message:"Invalid access token"}},advance:58_000}]){
  const h=harness([failure],[base.accessToken,"synthetic-page-token"]);
  const result=await h.publish({channel:"instagram",tokenCandidates:[{source:"page",accessToken:"synthetic-page-token"}]});
  assert.equal(result.ok,false);assert.equal(h.calls.length,1);assert.equal(commitCalls(h).length,0);
 }
});
