import assert from "node:assert/strict";
import test from "node:test";
import { quoteAiMediaCredits, estimateAiMediaVideoSupplierCostMicroUsd } from "../../lib/aiMediaCreditsPricing.ts";
import { estimateHeygenBillableDurationSeconds, getHeygenQuotedBillableDurationSeconds } from "../../lib/aiMediaHeygenBilling.ts";
import { AI_MEDIA_HEYGEN_MAX_ESTIMATED_COST_MICRO_USD, isAiMediaPendingVideo } from "../../lib/aiMediaPendingVideo.ts";

const base={kind:"video",creationMode:"free",operation:"generate",format:"story",videoEngine:"heygen-avatar",
 videoResolution:"1080p",durationSeconds:8,sceneMode:"single",teamVideoSpeechMode:"characters",
 inspirationImagesCount:1,inspirationImages:[{role:"character",characterIndex:1}]};
function exact(text:string){return {...base,exactDialogue:[{speaker:"character" as const,characterIndex:1 as const,text}]};}

test("an exact long HeyGen script receives a proportional quote before generation while its selected duration remains intact",()=>{
 const small=exact("Bienvenue !"),large=exact("Bonjour à tous. ".repeat(50));const original=structuredClone(large);
 const shortQuote=quoteAiMediaCredits(small),longQuote=quoteAiMediaCredits(large);
 assert.equal(shortQuote.totalCredits,135);assert.equal(shortQuote.billableDurationSeconds,8);
 assert.equal(longQuote.durationSeconds,8);assert.equal(longQuote.billableDurationSeconds,76);assert.equal(longQuote.totalCredits,1223);
 assert.match(longQuote.breakdown[0].label,/76 s audio estimées/);
 assert.equal(estimateAiMediaVideoSupplierCostMicroUsd(small),1_280_000);assert.equal(estimateAiMediaVideoSupplierCostMicroUsd(large),12_160_000);
 assert.deepEqual(large,original,"pricing never rewrites exact copy or changes the chosen duration");
});

test("maximum valid exact speech increases its upfront quote without a duration rejection or a late task-cost rejection",()=>{
 const text="a ".repeat(1999)+"aa";assert.equal(text.length,4000);
 const input=exact(text);const quote=quoteAiMediaCredits(input),cost=estimateAiMediaVideoSupplierCostMicroUsd(input);
 assert.equal(quote.billableDurationSeconds,1001);assert.equal(quote.totalCredits,16023);assert.equal(cost,160_160_000);
 assert.ok(cost<AI_MEDIA_HEYGEN_MAX_ESTIMATED_COST_MICRO_USD);
 assert.ok(isAiMediaPendingVideo({provider:"heygen-direct",model:"heygen-avatar-iv",videoId:"video-1",
  temporaryVoiceIds:[],temporaryAvatarGroupIds:[],temporaryAssetIds:[],estimatedCostMicroUsd:cost}));
 assert.equal(input.exactDialogue[0].text,text);
});

test("speech pricing recognizes non-spaced languages and does not treat hundreds of characters as one spoken word",()=>{
 for(const text of ["中".repeat(300),"あ".repeat(300),"ก".repeat(300),"مرحبا بكم ".repeat(50),"안녕하세요 여러분 ".repeat(50)]){
  const quote=quoteAiMediaCredits(exact(text));assert.equal(quote.billableDurationSeconds,51);assert.equal(quote.totalCredits,823);
 }
});

test("Auto and separate voiceover retain the selected upfront amount while final Auto supplier usage uses prepared speech",()=>{
 assert.equal(quoteAiMediaCredits(base).totalCredits,135);
 assert.equal(quoteAiMediaCredits({...base,teamVideoSpeechMode:"voiceover",withNarration:true,spokenScript:"Bonjour à tous. ".repeat(50)}).totalCredits,135);
 assert.equal(estimateHeygenBillableDurationSeconds({durationSeconds:8,script:"Bonjour à tous. ".repeat(50),turnCount:1}),76);
 assert.equal(estimateHeygenBillableDurationSeconds({durationSeconds:8,script:"",silentSeconds:8}),8);
});

test("raw exact copy and mixed offscreen turns use the same nonblocking billing estimate",()=>{
 const script="Bonjour à tous. ".repeat(50);
 assert.equal(quoteAiMediaCredits({...base,spokenScript:script}).totalCredits,quoteAiMediaCredits(exact(script)).totalCredits);
 const turns=[{speaker:"character" as const,characterIndex:1 as const,text:script},{speaker:"ai_voice" as const,text:"Bienvenue."}];
 const quote=quoteAiMediaCredits({...base,exactDialogue:turns});
 assert.equal(quote.billableDurationSeconds,78);assert.equal(quote.totalCredits,1255);
});

test("two full generated plans fit the supplier estimation envelope and the prevalidated private task",()=>{
 const scene="a ".repeat(1999)+"aa";const script=[scene,scene].join("\n");
 const seconds=estimateHeygenBillableDurationSeconds({durationSeconds:16,script,turnCount:2});
 assert.equal(seconds,2002);assert.ok(seconds*160_000<=AI_MEDIA_HEYGEN_MAX_ESTIMATED_COST_MICRO_USD);
});

test("Wan, Kling and image totals keep their fixed-duration pricing when long exact text is present",()=>{
 const text="Bonjour à tous. ".repeat(50);
 for(const videoEngine of ["wan27","kling"]){
  const input={...exact(text),videoEngine};const quote=quoteAiMediaCredits(input);
  assert.equal(quote.billableDurationSeconds,undefined);assert.equal(quote.totalCredits,videoEngine==="wan27"?127:200);
 }
 assert.equal(quoteAiMediaCredits({kind:"image",imageEngine:"flux",format:"story",inspirationImagesCount:0}).totalCredits,5);
});

test("explicit native offscreen turns are estimated even when no visible character speaks",()=>{
 const text="Bonjour à tous. ".repeat(50);
 for(const speaker of ["ai_voice","provided_voice"] as const){
  assert.equal(getHeygenQuotedBillableDurationSeconds({...base,exactDialogue:[{speaker,text}]}),76);
 }
});

test("normalized all-offscreen Studio narration remains external and does not charge for extra native HeyGen speech",()=>{
 const text="Bonjour à tous. ".repeat(50);
 for(const speaker of ["ai_voice","provided_voice"] as const){
  const quote=quoteAiMediaCredits({...base,exactDialogue:[{speaker,text}]});
  assert.equal(quote.billableDurationSeconds,8);assert.equal(quote.totalCredits,135);
 }
});

test("inline legacy exact dialogue is priced from its original words before an eight-second render",()=>{
 const words="mot ".repeat(100).trim();const freePrompt="Une personne dit : « "+words+" » dans un jardin.";
 assert.ok(freePrompt.length<=500);
 const input={...base,freePrompt};const before=structuredClone(input);
 const quote=quoteAiMediaCredits(input);assert.equal(quote.billableDurationSeconds,51);assert.equal(quote.totalCredits,823);
 assert.equal(estimateAiMediaVideoSupplierCostMicroUsd(input),8_160_000);assert.deepEqual(input,before);
 assert.equal(quoteAiMediaCredits({...input,spokenScript:""}).totalCredits,135,"an explicit silent block overrides old visual-prompt quotations");
 assert.equal(quoteAiMediaCredits({...input,spokenScript:"Bienvenue !"}).totalCredits,135,"the dedicated copy overrides old inline dialogue");
});

test("an Auto visual brief and genuine external voiceover quotes retain their selected duration",()=>{
 assert.equal(quoteAiMediaCredits({...base,freePrompt:"Une personne marche et présente un jardin."}).totalCredits,135);
 const freePrompt="Une personne dit : « "+"mot ".repeat(100).trim()+" ».";
 assert.equal(quoteAiMediaCredits({...base,teamVideoSpeechMode:"voiceover",withNarration:true,freePrompt}).totalCredits,135);
});

test("cinematic HeyGen retains the selected duration even when inline character copy would lengthen an avatar",()=>{
 const freePrompt="Une équipe dit : « "+"mot ".repeat(100).trim()+" » dans un jardin.";
 for(const input of [{...base,inspirationImagesCount:0,inspirationImages:[],freePrompt},{...base,inspirationImages:[{role:"decor"}],freePrompt}]){
  const quote=quoteAiMediaCredits(input);
  assert.equal(quote.billableDurationSeconds,8);assert.equal(quote.totalCredits,135);
  assert.equal(estimateAiMediaVideoSupplierCostMicroUsd(input),1280000);
 }
});
