import * as nativeNarrationVoices from "../../lib/aiMediaNarrationVoices.ts";
import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as pending from "../../lib/aiMediaPendingVideo.ts";
import * as routes from "../../lib/aiMediaHeygenRoute.ts";
import * as boundary from "../../lib/aiMediaVideoProviderContract.ts";
import * as types from "../../lib/aiVideoProviderTypes.ts";
import type * as Api from "../../lib/aiVideoHeygenApi.ts";
import type * as Cinematic from "../../lib/aiVideoHeygenCinematic.ts";

function load<T>(file: string, dependencies: Record<string, unknown>): T {
  const output = ts.transpileModule(readFileSync(new URL("../../lib/" + file, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const record = { exports: {} };
  new Function("module", "exports", "require", output)(record, record.exports, (name: string) => {
    if (name === "server-only") return {};
    assert.ok(name in dependencies, "Unexpected cinematic dependency: " + name);
    return dependencies[name];
  });
  return record.exports as T;
}
const api = load<typeof Api>("aiVideoHeygenApi.ts", {
  "node:timers/promises": { setTimeout: async () => {} }, "./aiMediaPendingVideo.ts": pending,
});
const nativeRequest: Api.HeygenCinematicVideoRequest = {
  model: "heygen-video-1", mode: "text_to_video", prompt: "Des personnes échangent dans leur agence.",
  duration: 8, resolution: "768p", aspect_ratio: "9:16", prompt_enhancement: "quality",
};
function args(overrides: Partial<types.AiVideoProviderGenerationArgs["request"]> = {}): types.AiVideoProviderGenerationArgs {
  const request = { creationMode: "free", operation: "generate", kind: "video", format: "story", videoEngine: "heygen-avatar",
    freePrompt: "Plusieurs personnes discutent de notre application dans une agence de communication.",
    durationSeconds: 8, videoResolution: "720p", teamVideoSpeechMode: "voiceover", withNarration: true,
    withMusic: false, withSubtitles: false, inspirationImages: [], ...overrides,
  } as types.AiVideoProviderGenerationArgs["request"];
  const canonicalPrompt = "Complete offline authorized video";
  return { accountId: "account-1", jobId: "job-1", request, canonicalPrompt,
    canonicalPromptSha256: boundary.hashAiMediaCanonicalPrompt(canonicalPrompt),
    providerContract: boundary.buildAiMediaVideoProviderContract({ request, durationSeconds: request.durationSeconds || 8, brandColors: [] }),
    contentLanguage: "fr", plan: { scenes: [{ visualBrief: request.freePrompt || "", spokenLine: "" }] },
  } as types.AiVideoProviderGenerationArgs;
}
function harness(options: { rejection?: "definite" | "uncertain"; invalidAsset?: boolean } = {}) {
  const events: string[] = [], submissions: Api.HeygenCinematicVideoRequest[] = [];
  const reserves: number[] = [], commits: number[] = [], uploads: Buffer[] = [];
  const client = {
    uploadImage: async (buffer: Buffer) => {
      uploads.push(Buffer.from(buffer)); return { type: "asset_id", asset_id: options.invalidAsset ? "bad/id" : "source-" + uploads.length };
    },
    submitCinematicVideo: async (input: Api.HeygenCinematicVideoRequest) => {
      submissions.push(input); events.push("post");
      if (options.rejection) throw new api.HeygenApiError(options.rejection === "definite" ? 402 : 503,
        "synthetic_rejection", options.rejection === "uncertain");
      return "cinematic-video-1";
    },
    deleteAsset: async (id: string) => { events.push("delete:" + id); },
  };
  const runtime = load<typeof Cinematic>("aiVideoHeygenCinematic.ts", {
    "./aiMediaNarrationVoices.ts": nativeNarrationVoices,
    "node:crypto": crypto, "./aiVideoHeygenApi.ts": { ...api, createHeygenApiClient: () => client },
    "./aiMediaPendingVideo.ts": pending, "./aiMediaHeygenRoute.ts": routes,
    "./aiMediaVideoProviderContract.ts": boundary, "./aiVideoProviderTypes.ts": types,
    "./aiMediaIdentityReferences.ts": { prepareAiMediaIdentityReferences: async (images: Array<{data:string}>) => {
      events.push("prepare-references"); return { buffers: images.map(image => Buffer.from(image.data)) };
    } },
    "./aiVideoHeygenBackground.ts": {
      prepareHeygenAvatarImage: async (buffer: Buffer) => buffer,
      prepareHeygenBackground: () => assert.fail("A cinematic request must never generate an empty-location still"),
    },
    "@/lib/aiGatewayAccountGuard": {
      reserveAiGatewayAccountAttempt: async (_account: string, input: {estimatedCostMicroUsd:number}) => {
        events.push("reserve"); reserves.push(input.estimatedCostMicroUsd); return {};
      },
      commitAiGatewayAccountAttempt: async (input: {actualCostMicroUsd:number}) => {
        events.push("commit"); commits.push(input.actualCostMicroUsd);
      },
      rollbackAiGatewayAccountAttempt: async () => { events.push("rollback"); },
      recordAiGatewayAccountFailure: async () => {},
    },
  });
  return { runtime, events, submissions, reserves, commits, uploads };
}
async function accepted(h: ReturnType<typeof harness>, input = args()) {
  let receipt: pending.AiVideoProviderPending | undefined;
  await assert.rejects(h.runtime.generateHeygenCinematicVideo(input), error => {
    assert.ok(pending.isAiVideoProviderPending(error)); receipt = error; return true;
  });
  return receipt!;
}

test("HeyGen keeps Avatar IV only for a speaking character photograph", () => {
  assert.equal(routes.usesHeygenAvatarRoute({ teamVideoSpeechMode: "characters", inspirationImages: [{role:"character"}] }), true);
  for (const input of [
    {teamVideoSpeechMode:"characters",inspirationImages:[]},
    {teamVideoSpeechMode:"characters",inspirationImages:[{role:"product"}]},
    {teamVideoSpeechMode:"voiceover",inspirationImages:[{role:"character"}]},
  ]) assert.equal(routes.usesHeygenAvatarRoute(input), false);
});
test("cinematic native capabilities expose five seconds and actual resolution before a quote or reservation", () => {
  assert.throws(() => routes.getHeygenCinematicSettings({durationSeconds:4}), /duration_unsupported/);
  assert.throws(() => routes.getHeygenCinematicSettings({durationSeconds:31}), /duration_unsupported/);
  assert.deepEqual(routes.getHeygenCinematicSettings({durationSeconds:8,format:"story",videoResolution:"720p"}),
    {duration:8,resolution:"768p",aspectRatio:"9:16",resolutionAdapted:false,canvasCropRequired:false});
  const portrait = routes.getHeygenCinematicSettings({durationSeconds:8,format:"portrait",videoResolution:"1080p"});
  assert.equal(portrait.resolution,"768p");assert.equal(portrait.aspectRatio,"3:4");
  assert.equal(portrait.resolutionAdapted,true);assert.equal(portrait.canvasCropRequired,true);
});
test("cinematic API sends one native POST with its stable idempotency key to the fixed HeyGen origin", async () => {
  const calls: Array<{url:string;init:RequestInit|undefined}> = [];
  const client = api.createHeygenApiClient({apiKey:"synthetic-only",fetch:async (url,init) => {
    calls.push({url:String(url),init});
    return Response.json({data:{video_id:"native-1",status:"pending"}},{status:202});
  }});
  assert.equal(await client.submitCinematicVideo(nativeRequest,"same-job"),"native-1");
  assert.equal(calls.length,1);assert.equal(calls[0].url,"https://api.heygen.com/v3/models/videos");
  assert.equal(calls[0].init?.redirect,"error");
  assert.equal((calls[0].init?.headers as Record<string,string>)["X-Api-Key"],"synthetic-only");
  assert.equal((calls[0].init?.headers as Record<string,string>)["Idempotency-Key"],"same-job");
  assert.deepEqual(JSON.parse(String(calls[0].init?.body)),nativeRequest);
});
test("invalid cinematic capabilities and foreign fields stop before any HTTP request", async () => {
  let calls=0;const client=api.createHeygenApiClient({apiKey:"test",fetch:async()=>{calls++;return Response.json({data:{}});}});
  for(const invalid of [
    {...nativeRequest,duration:4},{...nativeRequest,resolution:"720p"},{...nativeRequest,resolution:"1080p",aspect_ratio:"1:1"},
    {...nativeRequest,duration:16,prompt_enhancement:"disabled"},{...nativeRequest,scenes:[]},
    {...nativeRequest,reference_images:[{type:"asset_id",asset_id:"image"}]},
    {...nativeRequest,mode:"reference_to_video",reference_images:[{type:"url",url:"https://127.0.0.1/a"}]},
  ])await assert.rejects(client.submitCinematicVideo(invalid as unknown as Api.HeygenCinematicVideoRequest,"same-job"),/cinematic_input_invalid/);
  assert.equal(calls,0);
});
test("uncertain cinematic acknowledgements never retry the potentially billable POST", async () => {
  for(const reply of [
    () => {throw new Error("private raw payload");},
    () => Response.json({data:{}},{status:202}),
    () => Response.json({error:{code:"internal_error"}},{status:503}),
  ]){
    let calls=0;const client=api.createHeygenApiClient({apiKey:"test",fetch:async()=>{calls++;return reply();}});
    await assert.rejects(client.submitCinematicVideo(nativeRequest,"same-job"),error=>{
      assert.ok(error instanceof api.HeygenApiError&&error.uncertain);assert.doesNotMatch(error.message,/private raw/);return true;
    });assert.equal(calls,1);
  }
});
test("cinematic polling reads the model endpoint and validates the workspace job identity and fresh signed result", async () => {
  const calls:string[]=[];const client=api.createHeygenApiClient({apiKey:"test",fetch:async url=>{
    calls.push(String(url));return Response.json({data:{video_id:"native-1",model:"heygen-video-1",status:"completed",
      video_url:"https://resource2.heygen.ai/native.mp4",duration:8,width:768,height:1344}});
  }});
  const result=await client.getCinematicVideo("native-1");
  assert.deepEqual(result,{id:"native-1",status:"completed",videoUrl:"https://resource2.heygen.ai/native.mp4",durationSeconds:8,width:768,height:1344});
  assert.deepEqual(calls,["https://api.heygen.com/v3/models/videos/native-1"]);
  await assert.rejects(client.getCinematicVideo("../foreign"));assert.equal(calls.length,1);
});
test("cancelled cinematic jobs normalize to a terminal failure without retaining the private message", async () => {
  const client=api.createHeygenApiClient({apiKey:"test",fetch:async()=>Response.json({data:{video_id:"native-1",model:"heygen-video-1",
    status:"cancelled",failure_code:"generation_cancelled",failure_message:"private audio URL and transcript"}})});
  assert.deepEqual(await client.getCinematicVideo("native-1"),{id:"native-1",status:"failed",failureCode:"generation_cancelled"});
});
test("the original people-in-an-office brief reaches a native video job without a generated empty-location picture", async () => {
  const h=harness(),input=args();const before=structuredClone(input.request);const receipt=await accepted(h,input);
  assert.equal(h.submissions.length,1);assert.equal(h.submissions[0].mode,"text_to_video");assert.equal(h.uploads.length,0);
  assert.ok(h.submissions[0].prompt.includes(input.request.freePrompt!));assert.match(h.submissions[0].prompt,/real moving video/);
  assert.match(h.submissions[0].prompt,/off-screen narrator speaks in fr/);assert.doesNotMatch(h.submissions[0].prompt,/EMPTY LOCATION|Do not draw people/);
  assert.equal(receipt.task.model,"heygen-video-1");assert.equal(receipt.task.videoId,"cinematic-video-1");assert.deepEqual(input.request,before);
  assert.equal(h.commits.length,0);await receipt.recordAcceptance();await receipt.recordAcceptance();assert.deepEqual(h.commits,[1_280_000]);
});
test("voiceoff with original people and product references preserves their order and roles in one native scene", async () => {
  const h=harness();const input=args({inspirationImages:[
    {role:"product",data:"original-product",mimeType:"image/png"},
    {role:"character",characterIndex:1,data:"original-person",mimeType:"image/png"},
    {role:"environment",data:"original-office",mimeType:"image/png"},
  ]});
  const receipt=await accepted(h,input);const wire=h.submissions[0];assert.equal(wire.mode,"reference_to_video");
  assert.deepEqual(h.uploads.map(image=>image.toString()),["original-product","original-person","original-office"]);
  assert.deepEqual(wire.reference_images,[1,2,3].map(id=>({type:"asset_id",asset_id:"source-"+id})));
  assert.match(wire.prompt,/<Picture 1> is the original product/);assert.match(wire.prompt,/<Picture 2> is the original character/);
  assert.equal(receipt.task.temporaryAvatarGroupIds.length,0);assert.equal(receipt.task.temporaryVoiceIds.length,0);
});
test("people generated without photographs receive native automatic dialogue and no invented public avatar", async () => {
  const h=harness();await accepted(h,args({teamVideoSpeechMode:"characters",withNarration:false}));
  assert.match(h.submissions[0].prompt,/visible characters speak naturally in fr/);
  assert.match(h.submissions[0].prompt,/Write concise natural speech/);assert.equal(h.uploads.length,0);
});
test("dedicated exact words, account directions and business context survive the native prompt intact", () => {
  const h=harness(),input=args({spokenScript:"Bienvenue dans notre agence, nous sommes ravis de vous accueillir."});
  input.businessDnaDirection="Entreprise de communication, conseils aux professionnels.";
  input.providerContract={...input.providerContract,globalMediaConstraints:"Ne pas montrer de plaque automobile."};
  const prompt=h.runtime.buildHeygenCinematicPrompt(input);
  assert.ok(prompt.includes(input.request.spokenScript!));assert.ok(prompt.includes(input.businessDnaDirection));
  assert.ok(prompt.includes(input.providerContract.globalMediaConstraints!));
  const silent=h.runtime.buildHeygenCinematicPrompt({...input,request:{...input.request,spokenScript:""}});
  assert.match(silent,/No dialogue, voice-over or intelligible speech/);assert.doesNotMatch(silent,/SPOKEN WORDS/);
});
test("unsupported duration or a changed canonical prompt cannot reserve budget or submit a native job", async () => {
  for(const input of [args({durationSeconds:4}),{...args(),canonicalPrompt:"tampered"}]){
    const h=harness();await assert.rejects(h.runtime.generateHeygenCinematicVideo(input));
    assert.equal(h.reserves.length,0);assert.equal(h.submissions.length,0);assert.equal(h.uploads.length,0);
  }
});
test("definite cinematic rejection cleans its assets while uncertain acceptance retains them and accounts conservatively", async () => {
  for(const rejection of ["definite","uncertain"] as const){
    const h=harness({rejection});await assert.rejects(h.runtime.generateHeygenCinematicVideo(args({inspirationImages:[
      {role:"product",data:"original",mimeType:"image/png"},
    ]})));
    assert.equal(h.submissions.length,1);
    assert.equal(h.events.includes("rollback"),rejection==="definite");
    assert.equal(h.events.includes("delete:source-1"),rejection==="definite");
    assert.equal(h.commits.length,rejection==="uncertain"?1:0);
  }
});
test("invalid temporary identifiers prevent the native POST rather than corrupting an already charged task", async () => {
  const h=harness({invalidAsset:true});await assert.rejects(h.runtime.generateHeygenCinematicVideo(args({inspirationImages:[
    {role:"inspiration",data:"original",mimeType:"image/png"},
  ]})));
  assert.equal(h.submissions.length,0);assert.ok(h.events.includes("rollback"));
});

test("automatic native captions are requested only when no exact local caption text exists", () => {
  const h=harness();
  const automatic=h.runtime.buildHeygenCinematicPrompt(args({withSubtitles:true}));
  assert.match(automatic,/synchronized subtitles faithful to the generated speech/);
  const exact=h.runtime.buildHeygenCinematicPrompt(args({withSubtitles:true,spokenScript:"Bienvenue au jardin."}));
  assert.doesNotMatch(exact,/synchronized subtitles faithful to the generated speech/);
  assert.match(exact,/exact selected subtitles are added separately/);
});
test("acceptance accounting callback remains one operation under concurrent checkpoint notifications", async () => {
  let commits=0;let release: (()=>void)|undefined;
  const task={provider:"heygen-direct" as const,model:"heygen-video-1" as const,videoId:"native-1",
    temporaryVoiceIds:[],temporaryAvatarGroupIds:[],temporaryAssetIds:[],estimatedCostMicroUsd:1_280_000};
  const receipt=new pending.AiVideoProviderPending(task,async()=>{commits++;await new Promise<void>(resolve=>{release=resolve;});});
  const first=receipt.recordAcceptance(),second=receipt.recordAcceptance();
  assert.equal(commits,1);assert.equal(first,second);release!();await Promise.all([first,second]);
});

test("native narrator gender and style selections reach the cinematic engine for Auto and Exact without proprietary voice identity claims", () => {
  const h = harness();
  for (const exact of [undefined, "  Bonjour, Océane !\n58 € — iNrCy.  "]) {
    const base = exact !== undefined ? { spokenScript: exact } : {};
    const female = h.runtime.buildHeygenCinematicPrompt(args({ ...base, narrationVoice: "female", narrationVoiceVariant: "Sulafat" }));
    const male = h.runtime.buildHeygenCinematicPrompt(args({ ...base, narrationVoice: "male", narrationVoiceVariant: "Orus" }));
    const upbeat = h.runtime.buildHeygenCinematicPrompt(args({ ...base, narrationVoice: "male", narrationVoiceVariant: "Puck" }));
    assert.match(female, /female off-screen narrator; warm, gentle and welcoming tone/);
    assert.match(male, /male off-screen narrator; assertive, direct and professional tone/);
    assert.match(upbeat, /male off-screen narrator; upbeat, positive and energetic tone/);
    assert.notEqual(female, male); assert.notEqual(male, upbeat);
    for (const prompt of [female, male, upbeat]) {
      assert.doesNotMatch(prompt, /Sulafat|Orus|Puck|Gemini/);
      if (exact !== undefined) assert.equal(prompt.split(exact).length, 2);
    }
  }
});

test("cinematic Exact carries the resolved language and subtitles-off priority without replacing requested visual lettering", () => {
  const h = harness(), exact = "你好，世界！\niNrCy — 12,50 €。";
  const input = args({ spokenScript: exact, withSubtitles: false, freePrompt: "Ajoute des sous-titres. Une enseigne doit afficher Atelier." });
  input.contentLanguage = "zh";
  const prompt = h.runtime.buildHeygenCinematicPrompt(input);
  assert.match(prompt, /off-screen narrator speaks in zh/); assert.equal(prompt.split(exact).length, 2);
  assert.match(prompt, /No subtitles or speech captions, even if the brief requests them/);
  assert.match(prompt, /preserve other explicitly requested visual lettering/); assert.ok(prompt.includes(input.request.freePrompt!));
});

test("a supplied exact narrator is preserved for external audio and never replaced by a cinematic native voice", () => {
  const h = harness(), exact = "  Ma voix réelle.\n12,50 € — iNrCy.  ";
  const input = args({ narrationVoiceMode: "provided", spokenScript: exact, withNarration: false, withSubtitles: false });
  const before = structuredClone(input.request), prompt = h.runtime.buildHeygenCinematicPrompt(input);
  assert.match(prompt, /No dialogue, voice-over or intelligible speech/);
  assert.doesNotMatch(prompt, /NARRATOR VOICE DIRECTION|SPOKEN WORDS/); assert.ok(!prompt.includes(exact));
  assert.deepEqual(input.request, before);
});
