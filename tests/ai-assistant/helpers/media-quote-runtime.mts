import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";
import * as sdk from "ai";
import * as contracts from "../../../lib/aiMediaGenerationContracts.ts";
import * as catalogue from "../../../lib/aiMediaModelCatalog.ts";
import * as pricing from "../../../lib/aiMediaCreditsPricing.ts";
import * as speech from "../../../lib/aiMediaVideoSpeechBudget.ts";
import * as durations from "../../../lib/aiMediaVideoClientOptions.ts";
import * as intent from "../../../lib/inrAssistantMediaIntent.ts";
import * as clauses from "../../../lib/inrAssistantRequestClauses.ts";
import * as preview from "../../../lib/inrAssistantMediaPreview.ts";
import * as quoteEvidence from "../../../lib/inrAssistantMediaQuote.ts";
import type * as MediaTools from "../../../lib/inrAssistantMediaTools.ts";
import type * as NativeQuote from "../../../lib/aiMediaCreditQuoteServer.ts";

function load<T>(file:string, dependencies:Record<string,unknown>):T {
  const compiled=ts.transpileModule(readFileSync(new URL("../../../lib/"+file,import.meta.url),"utf8"),{
    compilerOptions:{module:ts.ModuleKind.CommonJS,target:ts.ScriptTarget.ES2022},
  }).outputText;
  const record={exports:{}};
  vm.runInNewContext("(function(require,module,exports){"+compiled+"\n})",{Request,Response,Headers,URL,console,process:{env:{}}})((id:string)=>{
    assert.ok(Object.hasOwn(dependencies,id),"Closed native quote dependency: "+id);return dependencies[id];
  },record,record.exports);
  return record.exports as T;
}

/** Real SDK, MediaTools, normalization and native server pricing. Only session,
 * quota and HTTP routes are fixtures; no provider, database or filesystem write. */
export function createNativeMediaQuoteFixture(currentUserMessage:string, remaining:number|null=50) {
  const native=load<typeof NativeQuote>("aiMediaCreditQuoteServer.ts",{"server-only":{},"node:crypto":{createHash},
    "./aiMediaCreditsPricing.ts":pricing,"./aiMediaCharacterVoices.ts":{hasProvidedAiMediaCharacterVoice:()=>false},"./aiMediaModelCatalog.ts":catalogue});
  const calls:Array<{stage:string;body?:Record<string,unknown>}>=[], outputs:MediaTools.InrAssistantMediaResult[]=[];
  const forbid=async()=>{calls.push({stage:"forbidden_mutation"});assert.fail("Quote cannot dispatch media work or change a draft");};
  const mediaRuntime=load<typeof MediaTools>("inrAssistantMediaTools.ts",{"server-only":{},ai:sdk,
    "./aiMediaGenerationContracts.ts":contracts,"./aiMediaModelCatalog.ts":catalogue,"./aiMediaVideoSpeechBudget.ts":speech,
    "./aiMediaVideoClientOptions.ts":durations,"./inrAssistantMediaIntent.ts":intent,"./inrAssistantRequestClauses.ts":clauses,
    "./inrAssistantMediaPreview.ts":preview,"./inrAssistantMediaQuote.ts":quoteEvidence,
    "./inrAssistantMediaAccess.ts":{checkInrAssistantMediaGenerationAccess:async()=>{calls.push({stage:"access"});return {allowed:true,accountId:"fixture-active-account",authUserId:"fixture-member"};}},
    "./inrAssistantMediaSource.ts":{loadInrAssistantImageReference:async()=>{calls.push({stage:"reference"});return {format:"square",width:64,height:64,reference:{mimeType:"image/png",data:"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jlpQAAAAASUVORK5CYII=",role:"inspiration",usage:"inspiration"}};}},
    "@/app/api/media-generation/quota/route":{GET:async()=>{calls.push({stage:"quota"});return Response.json({ok:true,quota:{creditsReady:true,videoMaxDurationSeconds:30}});}},
    "@/app/api/media-generation/quote/route":{POST:async(request:Request)=>{const body=await request.json() as Record<string,unknown>;calls.push({stage:"quote",body});return Response.json({ok:true,quote:native.createAiMediaServerQuote("fixture-active-account",body as pricing.AiMediaCreditsQuoteInput),credits:{remaining}});}},
    "@/app/api/media-generation/generate/route":{POST:forbid},
    "@/app/api/media-generation/drafts/[id]/accept/route":{POST:forbid},
    "@/app/api/media-generation/drafts/[id]/route":{DELETE:forbid},
    "@/app/api/media-generation/status/route":{GET:forbid},
  });
  const tools=mediaRuntime.createInrAssistantMediaTools({request:new Request("https://fixture.invalid/api/assistant/chat"),requestId:"10000000-0000-4000-8000-000000000001",
    currentUserMessage,onWorkStarted:()=>assert.fail("A quote must not start work"),onResult:()=>assert.fail("A quote is not a generation result")});
  const tool={...tools.quoteMediaGeneration,execute:async(...args:Parameters<NonNullable<typeof tools.quoteMediaGeneration.execute>>)=>{
    const result=await tools.quoteMediaGeneration.execute!(...args);assert.ok("ok" in result,"Native media quotes return one result, not a stream");outputs.push(result);return result;
  }};
  return {tool,calls,outputs};
}
