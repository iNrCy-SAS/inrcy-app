import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import test from "node:test";
import ts from "typescript";
import {experimental_generateVideo as generateVideo} from "ai";
import {summarizeAiSdkWarnings,installSafeAiSdkWarningLogger,safeAiSdkWarningLogger} from "../../lib/aiSdkSafeWarnings.ts";

test("only the count and allowlisted warning types survive untrusted SDK diagnostic payloads",()=>{
 const value={provider:"PRIVATE_PROVIDER",model:"PRIVATE_MODEL",warnings:[
  {type:"unsupported",feature:"PRIVATE_FEATURE",details:"PRIVATE_INPUT"},
  {type:"compatibility",feature:"PRIVATE_TEXT",details:"https://private.invalid/?token=SECRET"},
  {type:"other",message:"Bearer PRIVATE_SECRET"},
  {type:"PRIVATE_ARBITRARY_TYPE",message:"PRIVATE"}]};
 const before=structuredClone(value);const summary=summarizeAiSdkWarnings(value);
 assert.deepEqual(summary,{count:4,types:["compatibility","other","unsupported"]});
 assert.doesNotMatch(JSON.stringify(summary),/PRIVATE|SECRET|https|token|Bearer/);assert.deepEqual(value,before);
 assert.deepEqual(summarizeAiSdkWarnings(null),{count:0,types:[]});
});

test("the installed real SDK logs safe metadata for simultaneous synthetic video generations while preserving returned warnings",async()=>{
 const previous=globalThis.AI_SDK_LOG_WARNINGS,previousWarn=console.warn;const logs:unknown[][]=[];let oldLoggerCalls=0;
 globalThis.AI_SDK_LOG_WARNINGS=()=>{oldLoggerCalls++;};console.warn=(...args:unknown[])=>{logs.push(args);};
 try{
  installSafeAiSdkWarningLogger();const installed=globalThis.AI_SDK_LOG_WARNINGS;installSafeAiSdkWarningLogger();assert.equal(globalThis.AI_SDK_LOG_WARNINGS,installed);
  const warnings=[{type:"other" as const,message:"PRIVATE_SPEECH https://private.invalid/signed.wav?token=SECRET"}];
  const model={specificationVersion:"v3" as const,provider:"PRIVATE_PROVIDER",modelId:"PRIVATE_MODEL",maxVideosPerCall:1,
   doGenerate:async()=>({videos:[{type:"binary" as const,mediaType:"video/mp4",data:new Uint8Array([1,2,3])}],warnings,
    response:{timestamp:new Date(),modelId:"PRIVATE_MODEL",headers:{}}})};
  const results=await Promise.all([generateVideo({model,prompt:"synthetic",maxRetries:0}),generateVideo({model,prompt:"synthetic",maxRetries:0})]);
  assert.equal(oldLoggerCalls,0);assert.equal(logs.length,2);
  for(const log of logs)assert.deepEqual(log,["[ai-sdk] provider warnings",{count:1,types:["other"]}]);
  assert.doesNotMatch(JSON.stringify(logs),/PRIVATE|SECRET|https|token/);
  assert.ok(results.every(result=>result.warnings[0].type==="other"&&result.warnings[0].message===warnings[0].message),"the application can still sanitize and inspect returned warnings");
  assert.equal(globalThis.AI_SDK_LOG_WARNINGS,installed,"concurrent requests never restore an unsafe logger");
 }finally{console.warn=previousWarn;globalThis.AI_SDK_LOG_WARNINGS=previous;}
});

test("Node and Edge server registration installs the safe policy before Sentry initialization",async()=>{
 const previous=globalThis.AI_SDK_LOG_WARNINGS;
 const source=readFileSync(new URL("../../instrumentation.ts",import.meta.url),"utf8");
 const compiled=ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022}}).outputText;
 try{for(const runtime of ["nodejs","edge"]){
  const loaded:string[]=[];const record={exports:{} as {register:()=>Promise<void>}};
  new Function("module","exports","require","process",compiled)(record,record.exports,(id:string)=>{
   if(id==="@sentry/nextjs")return {captureRequestError:()=>{}};
   if(id==="./lib/aiSdkSafeWarnings.ts")return {installSafeAiSdkWarningLogger};
   if(id==="./sentry.server.config"||id==="./sentry.edge.config"){assert.equal(globalThis.AI_SDK_LOG_WARNINGS,safeAiSdkWarningLogger);loaded.push(id);return {};}
   throw Error("Unexpected instrumentation dependency");
  },{env:{NEXT_RUNTIME:runtime}});
  globalThis.AI_SDK_LOG_WARNINGS=undefined;await record.exports.register();
  assert.deepEqual(loaded,[runtime==="nodejs"?"./sentry.server.config":"./sentry.edge.config"]);
 }}finally{globalThis.AI_SDK_LOG_WARNINGS=previous;}
});
