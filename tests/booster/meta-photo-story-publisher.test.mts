import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";
import * as graph from "../../lib/metaGraphApi.ts";
import * as classification from "../../lib/metaGraphErrorClassification.ts";
import type * as Publisher from "../../lib/metaPhotoStoryPublisher.ts";

type Reply={status?:number;body?:unknown;raw?:string;advance?:number}|Error;
function load(file:string,dependencies:Record<string,unknown>,clock:{now:number}){
 const compiled=ts.transpileModule(readFileSync(new URL(`../../lib/${file}`,import.meta.url),"utf8"),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS}}).outputText;
 const moduleRecord={exports:{}};
 vm.runInNewContext(`(function(require,module,exports){${compiled}\n})`,{URL,URLSearchParams,AbortSignal,setTimeout,Date:{now:()=>clock.now},fetch:()=>assert.fail("Real Meta requests are forbidden")})((name:string)=>{assert.ok(Object.hasOwn(dependencies,name),`Unexpected native publisher dependency ${name}`);return dependencies[name]},moduleRecord,moduleRecord.exports);
 return moduleRecord.exports;
}
function harness(replies:Reply[]){
 const clock={now:Date.now()},calls:Array<{url:URL;method:string;body:URLSearchParams;signal:AbortSignal|undefined}>=[],sleeps:number[]=[];
 const auth=load("instagramAuthMode.ts",{"@/lib/metaGraphApi":graph},clock);
 const runtime=load("metaPhotoStoryPublisher.ts",{"server-only":{},"@/lib/metaGraphApi":graph,"@/lib/instagramAuthMode":auth,"@/lib/metaGraphErrorClassification":classification},clock) as typeof Publisher;
 const fetchImpl:typeof fetch=async(input,init)=>{
  const url=new URL(String(input)),method=String(init?.method||"GET");
  assert.ok(["graph.facebook.com","graph.instagram.com"].includes(url.hostname));
  assert.equal(url.protocol,"https:");assert.equal(init?.cache,"no-store");assert.ok(init?.signal instanceof AbortSignal);
  const body=method==="GET"?url.searchParams:new URLSearchParams(String(init?.body));
  assert.equal(body.get("access_token"),"synthetic-token");
  calls.push({url,method,body,signal:init?.signal??undefined});
  assert.ok(replies.length,"No unexpected retry or endpoint call is allowed");
  const reply=replies.shift()!;if(reply instanceof Error)throw reply;
  clock.now+=reply.advance||0;
  return reply.raw!==undefined?new Response(reply.raw,{status:reply.status||200}):Response.json(reply.body??{}, {status:reply.status||200});
 };
 const dependencies={fetchImpl,sleepImpl:async(milliseconds:number)=>{sleeps.push(milliseconds);clock.now+=milliseconds}};
 return {runtime,clock,calls,sleeps,dependencies,publish:(args:Parameters<typeof runtime.publishMetaPhotoStory>[0])=>runtime.publishMetaPhotoStory(args,dependencies)};
}
const base={remoteAccountId:"12345",accessToken:"synthetic-token",imageUrl:"https://public-assets.fixture.invalid/red.jpg"};
const error={message:"Synthetic Meta rejection",code:100};
const path=(suffix:string)=>`/${graph.META_GRAPH_API_VERSION}/${suffix}`;
const resultId=(channel:"facebook"|"instagram")=>channel==="facebook"?{post_id:"remote-story-1",success:true}:{id:"remote-story-1"};

test("Facebook uploads an unpublished photo then publishes exactly one native photo Story",async()=>{
 const h=harness([{body:{id:"photo-1"}},{body:resultId("facebook")}]);
 const result=await h.publish({...base,channel:"facebook"});
 assert.equal(result.ok,true);if(result.ok)assert.equal(result.remoteId,"remote-story-1");
 assert.deepEqual(h.calls.map(call=>[call.url.origin,call.url.pathname,call.method]),[["https://graph.facebook.com",path("12345/photos"),"POST"],["https://graph.facebook.com",path("12345/photo_stories"),"POST"]]);
 assert.deepEqual(Object.fromEntries(h.calls[0].body),{url:base.imageUrl,published:"false",access_token:base.accessToken});
 assert.deepEqual(Object.fromEntries(h.calls[1].body),{photo_id:"photo-1",access_token:base.accessToken});
 assert.deepEqual(h.sleeps,[]);
});

for(const authMode of [undefined,"facebook_login","instagram_login"] as const)test(`Instagram ${authMode??"default Facebook login"} uses its proper host and waits for FINISHED before media_publish`,async()=>{
 const h=harness([{body:{id:"container-1"}},{body:{status_code:"IN_PROGRESS"}},{body:{status_code:"FINISHED"}},{body:resultId("instagram")}]);
 const result=await h.publish({...base,channel:"instagram",authMode});assert.equal(result.ok,true);
 const origin=authMode==="instagram_login"?"https://graph.instagram.com":"https://graph.facebook.com";
 assert.ok(h.calls.every(call=>call.url.origin===origin));
 assert.deepEqual(h.calls.map(call=>[call.url.pathname,call.method]),[[path("12345/media"),"POST"],[path("container-1"),"GET"],[path("container-1"),"GET"],[path("12345/media_publish"),"POST"]]);
 assert.deepEqual(Object.fromEntries(h.calls[0].body),{media_type:"STORIES",image_url:base.imageUrl,access_token:base.accessToken});
 assert.deepEqual(Object.fromEntries(h.calls[1].body),{fields:"status_code",access_token:base.accessToken});
 assert.deepEqual(Object.fromEntries(h.calls[3].body),{creation_id:"container-1",access_token:base.accessToken});
 assert.deepEqual(h.sleeps,[1000]);
});

test("Instagram never publishes a container that remains in preparation or has a failed readiness status",async()=>{
 for(const status of ["IN_PROGRESS","ERROR","EXPIRED","PUBLISHED"]){
  const polls=status==="IN_PROGRESS"?Array.from({length:5},()=>({body:{status_code:status}})):[{body:{status_code:status}}];
  const h=harness([{body:{id:"container-1"}},...polls]);const result=await h.publish({...base,channel:"instagram"});
  assert.equal(result.ok,false);if(!result.ok){assert.equal(result.certainty,status==="PUBLISHED"?"unknown":"not_published");assert.equal(result.retryable,status!=="PUBLISHED")}
  assert.equal(h.calls.filter(call=>call.url.pathname.endsWith("media_publish")).length,0);
  assert.equal(h.sleeps.length,status==="IN_PROGRESS"?4:0);
 }
});

test("invalid input, expired preparation deadline and preparation failures have no Story dispatch",async()=>{
 for(const input of [{...base,imageUrl:"http://assets.invalid/red.jpg"},{...base,imageUrl:"https://user:password@assets.invalid/red.jpg"},{...base,remoteAccountId:"bad/id"},{...base,accessToken:""}]){
  const h=harness([]);assert.equal((await h.publish({...input,channel:"facebook"})).ok,false);assert.equal(h.calls.length,0);
 }
 for(const reply of [{status:500,body:{error}},{status:400,body:{error}},{raw:"not-json"},{body:{id:123}},{body:[]},new Error("Synthetic timeout")]){
  const h=harness([reply]);const result=await h.publish({...base,channel:"facebook"});
  assert.equal(result.ok,false);if(!result.ok)assert.equal(result.certainty,"not_published");assert.equal(h.calls.length,1);
 }
 const h=harness([]);const result=await h.publish({...base,channel:"facebook",deadlineAt:h.clock.now+500});
 assert.equal(result.ok,false);assert.equal(h.calls.length,0);
});

test("readiness errors and an exhausted post-preparation deadline stop before the final Instagram POST",async()=>{
 const rejected=harness([{body:{id:"container-1"}},{status:401,body:{error:{code:190,message:"Invalid access token"}}}]);
 const result=await rejected.publish({...base,channel:"instagram"});assert.equal(result.ok,false);
 if(!result.ok){assert.equal(result.certainty,"not_published");assert.equal(result.authorizationError,true)}
 assert.equal(rejected.calls.length,2);
 const h=harness([{body:{id:"container-1"}},{body:{status_code:"FINISHED"},advance:6000}]);
 const late=await h.publish({...base,channel:"instagram",deadlineAt:h.clock.now+10000});
 assert.equal(late.ok,false);if(!late.ok){assert.equal(late.certainty,"not_published");assert.equal(late.retryable,true)}
 assert.equal(h.calls.length,2);
});

for(const channel of ["facebook","instagram"] as const)test(`${channel} distinguishes certain 400 rejection from ambiguous post-dispatch failures without retrying`,async()=>{
 for(const response of [{status:400,body:{error}},{status:408,body:{error}},{status:500,body:{error}},new Error("Synthetic timeout after request")]){
  const prefix:Reply[]=[{body:{id:"prepared-1"}},...(channel==="instagram"?[{body:{status_code:"FINISHED"}}]:[])];
  const h=harness([...prefix,response]);const result=await h.publish({...base,channel});
  assert.equal(result.ok,false);
  if(!result.ok){const certain=!(response instanceof Error)&&response.status===400;assert.equal(result.certainty,certain?"not_published":"unknown");assert.equal(result.retryable,certain)}
  assert.equal(h.calls.filter(call=>call.url.pathname.endsWith(channel==="facebook"?"photo_stories":"media_publish")).length,1,"Never retry the irreversible POST after a timeout or server error");
 }
});

for(const channel of ["facebook","instagram"] as const)test(`${channel} malformed final replies never fabricate a remote Story ID`,async()=>{
 for(const final of [{body:{}},{raw:"not-json"},{body:{success:true}},{body:{...resultId(channel),success:false}},{body:channel==="facebook"?{id:"photo-id-only"}:{post_id:"wrong-contract-id"}}]){
  const h=harness([{body:{id:"prepared-1"}},...(channel==="instagram"?[{body:{status_code:"FINISHED"}}]:[]),final]);
  const result=await h.publish({...base,channel});assert.equal(result.ok,false);
  if(!result.ok){assert.equal(result.certainty,"unknown");assert.equal(result.retryable,false)}
  assert.equal(h.calls.length,channel==="facebook"?2:3);
 }
});

for(const channel of ["facebook","instagram"] as const)test(`${channel} contradictory error-plus-ID preparation replies cannot trigger a Story POST`,async()=>{
 for(const body of [{id:"prepared-1",error},{id:"prepared-1",success:false}]){
  const h=harness([{body},...(channel==="instagram"?[{body:{status_code:"FINISHED"}}]:[]),{body:resultId(channel)}]);
  const result=await h.publish({...base,channel});assert.equal(result.ok,false);if(!result.ok)assert.equal(result.certainty,"not_published");
  assert.equal(h.calls.length,1,"A preparation error must not dispatch its accompanying ID");
 }
});

for(const channel of ["facebook","instagram"] as const)test(`${channel} final error-plus-ID replies stay unknown even with HTTP 400`,async()=>{
 for(const status of [200,400]){
  const h=harness([{body:{id:"prepared-1"}},...(channel==="instagram"?[{body:{status_code:"FINISHED"}}]:[]),{status,body:{...resultId(channel),error}}]);
  const result=await h.publish({...base,channel});assert.equal(result.ok,false);
  if(!result.ok){assert.equal(result.certainty,"unknown");assert.equal(result.retryable,false)}
  assert.equal(h.calls.length,channel==="facebook"?2:3);
 }
});

test("an Instagram readiness error cannot borrow FINISHED from a contradictory payload",async()=>{
 const h=harness([{body:{id:"container-1"}},{body:{status_code:"FINISHED",error}},{body:resultId("instagram")}]);
 const result=await h.publish({...base,channel:"instagram"});assert.equal(result.ok,false);
 if(!result.ok)assert.equal(result.certainty,"not_published");assert.equal(h.calls.length,2);
});
