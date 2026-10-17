import assert from "node:assert/strict";
import test from "node:test";
import { generateInrAgentVideoWithFallback, isRecoverableInrAgentVideoFailure } from "../../lib/inrAgentVideoFallback.ts";
import { buildInrAgentMediaGenerationRequest } from "../../lib/inrAgentMediaRequest.ts";
import { resolveInrAgentMediaMix } from "../../lib/inrAgentMediaMix.ts";
import { buildAiMediaVideoProviderContract, hashAiMediaCanonicalPrompt } from "../../lib/aiMediaVideoProviderContract.ts";
import { AiVideoProviderBillableFailure, type AiVideoProviderGenerationArgs, type AiVideoProviderResult } from "../../lib/aiVideoProviderTypes.ts";

function input(): AiVideoProviderGenerationArgs {
  const request=buildInrAgentMediaGenerationRequest({requestId:"fallback-regression",idea:"Un artisan façonne un vase dans son atelier.",theme:"services",kind:"video",videoDurationSeconds:8,
    mediaMix:resolveInrAgentMediaMix({kind:"video",theme:"services",seed:"same-slot",studioMediaPreferencePercent:0}),outputFormat:"story"});
  return {accountId:"account-test",request,plan:{scenes:[{visualBrief:"Le vase prend forme."}]} as AiVideoProviderGenerationArgs["plan"],canonicalPrompt:"Reviewed scene",canonicalPromptSha256:hashAiMediaCanonicalPrompt("Reviewed scene"),
    providerContract:buildAiMediaVideoProviderContract({request,durationSeconds:8,brandColors:[]}),brandColors:[],profession:"artisan",creativeBrief:""};
}
const result:AiVideoProviderResult={provider:"vercel-ai-gateway:spacexai",model:"spacexai/grok-imagine-video-1.5-lite",clips:[],warnings:[],estimatedCostMicroUsd:240000};
const rejected=()=>Object.assign(new Error("Provider temporarily unavailable"),{statusCode:503});

test("a definite Veo Lite outage uses exactly one cheaper 720p fallback with the same contract",async()=>{
  const args=input(),calls:AiVideoProviderGenerationArgs[]=[];
  const output=await generateInrAgentVideoWithFallback(args,async(call)=>{calls.push(call);if(calls.length===1)throw new Error("redacted failure",{cause:rejected()});return result;});
  assert.deepEqual(calls.map(c=>c.request.videoEngine),["veo-lite","grok-lite"]);
  assert.equal(calls[1].request.videoResolution,"720p");
  assert.equal(calls[1].request.requestId,args.request.requestId);
  assert.equal(calls[1].providerContract,args.providerContract);
  assert.equal(calls[1].canonicalPromptSha256,args.canonicalPromptSha256);
  for(const key of ["format","durationSeconds","withNarration","teamVideoSpeechMode"] as const)assert.equal(calls[1].request[key],args.request[key]);
  assert.ok(output.warnings.includes("inr_agent_veo_lite_fallback_to_grok_lite"));
});

test("success never invokes the fallback; both engines failing stop after two calls",async()=>{
  let calls=0;
  assert.equal(await generateInrAgentVideoWithFallback(input(),async()=>{calls++;return result;}),result);
  assert.equal(calls,1);calls=0;
  const second=new Error("fallback unavailable");
  await assert.rejects(generateInrAgentVideoWithFallback(input(),async()=>{if(++calls===1)throw rejected();throw second;}),error=>error===second);
  assert.equal(calls,2);
});

test("lost responses, timeouts, policy, account fuses and chargeable output never trigger another submission",async()=>{
  for(const error of [new Error("fetch failed"),new Error("ai_video_gateway_timeout"),Object.assign(new Error("socket closed"),{statusCode:503}),
    Object.assign(new Error("safety policy rejection"),{statusCode:500}),Object.assign(new Error("AiGatewayAccountLimitError"),{statusCode:503}),
    new AiVideoProviderBillableFailure({provider:"google",model:"veo",stage:"download"}),new Error("unknown rejection")]){
    let calls=0;
    await assert.rejects(generateInrAgentVideoWithFallback(input(),async()=>{calls++;throw error;}),value=>value===error);
    assert.equal(calls,1);assert.equal(isRecoverableInrAgentVideoFailure(error),false);
  }
});

test("no cross-provider fallback for a cancelled call, identities, native characters or another selected engine",async()=>{
  for(const patch of [{identityMode:"professional"},{teamVideoSpeechMode:"characters"},{videoEngine:"omni"},{videoResolution:"1080p"}] as const){
    const args=input();Object.assign(args.request,patch);let calls=0;
    await assert.rejects(generateInrAgentVideoWithFallback(args,async()=>{calls++;throw rejected();}));assert.equal(calls,1);
  }
  const args=input(),controller=new AbortController();args.signal=controller.signal;let calls=0;
  await assert.rejects(generateInrAgentVideoWithFallback(args,async()=>{calls++;controller.abort();throw rejected();}));assert.equal(calls,1);
});
