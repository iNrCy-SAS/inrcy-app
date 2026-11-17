import assert from "node:assert/strict";
import * as crypto from "node:crypto";
import { readFileSync } from "node:fs";
import { setTimeout as delay } from "node:timers/promises";
import test from "node:test";
import ts from "typescript";
import * as pending from "../../lib/aiMediaPendingVideo.ts";
import * as billing from "../../lib/aiMediaHeygenBilling.ts";
import * as catalog from "../../lib/aiMediaModelCatalog.ts";
import * as types from "../../lib/aiVideoProviderTypes.ts";
import { getAiMediaGenerationPublicError, isAiMediaProviderBillingFailure } from "../../lib/aiMediaGenerationPublicErrors.ts";
import type * as Api from "../../lib/aiVideoHeygenApi.ts";
import type * as Provider from "../../lib/aiVideoProviderHeygen.ts";

function load<T>(file: string, dependencies: Record<string,unknown>): T {
  const compiled = ts.transpileModule(readFileSync(new URL(`../../lib/${file}`, import.meta.url), "utf8"), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText;
  const record = { exports: {} };
  new Function("module", "exports", "require", compiled)(record, record.exports, (id: string) => {
    if (id === "server-only") return {};
    assert.ok(id in dependencies, `unexpected dependency: ${id}`);
    return dependencies[id];
  });
  return record.exports as T;
}
const api = load<typeof Api>("aiVideoHeygenApi.ts", { "node:timers/promises": { setTimeout: delay }, "./aiMediaPendingVideo.ts": pending });
const mp4 = Buffer.from("0000ftypisomTEST");

test("HeyGen V3 uses one idempotent Studio submission and only sends its key to the API origin", async () => {
  const calls: string[] = [];
  const client = api.createHeygenApiClient({ apiKey: "test-key", fetch: async (url, options) => {
    calls.push(String(url));
    if (String(url).startsWith("https://api.heygen.com")) {
      assert.equal((options!.headers as Record<string,string>)["X-Api-Key"], "test-key");
      if (options?.method === "POST") {
        assert.equal((options.headers as Record<string,string>)["Idempotency-Key"], "stable-job-key");
        assert.equal(JSON.parse(String(options.body)).type, "studio");
        return Response.json({ data: { video_id: "video-1" } });
      }
      return Response.json({ data: { id: "video-1", status: "completed", duration: 8, video_url: "https://resource2.heygen.ai/video.mp4" } });
    }
    assert.equal(options?.headers, undefined);
    assert.equal(options?.redirect, "error");
    return new Response(mp4);
  } });
  const id = await client.submitVideo({ title: "Test", resolution: "1080p", aspect_ratio: "9:16", scenes: [] }, "stable-job-key");
  const video = await client.getVideo(id);
  assert.deepEqual(await client.downloadVideo(video.videoUrl!), mp4);
  assert.equal(calls.length, 3);
});

test("a failed or malformed video acknowledgement never retries a potentially billable POST", async () => {
  for (const reply of [() => { throw new Error("private transport secret"); }, () => Response.json({ data: {} }), () => Response.json({ error: { code: "internal_error" } }, { status: 503 })]) {
    let calls = 0;
    const client = api.createHeygenApiClient({ apiKey: "test-key", fetch: async () => { calls++; return reply(); } });
    await assert.rejects(client.submitVideo({ title: "Test", resolution: "720p", aspect_ratio: "9:16", scenes: [] }, "same-job"), error => {
      assert.ok(error instanceof api.HeygenApiError && error.uncertain);
      assert.doesNotMatch(error.message, /private|secret/);
      return true;
    });
    assert.equal(calls, 1);
  }
});

test("billing and access failures are actionable without exposing HeyGen's raw response", async () => {
  for (const [status, expected] of [[402,"AI_MEDIA_PROVIDER_BALANCE_INSUFFICIENT"], [401,"AI_MEDIA_GATEWAY_NOT_CONFIGURED"], [403,"AI_MEDIA_GATEWAY_NOT_CONFIGURED"], [429,"AI_MEDIA_VIDEO_CAPACITY_REACHED"]] as const) {
    const client = api.createHeygenApiClient({ apiKey: "test-key", fetch: async () => Response.json({ error: { code: "request_failed", message: "private input URL token=secret" } }, { status }) });
    await assert.rejects(client.publicVoices("fr"), error => {
      assert.equal(getAiMediaGenerationPublicError(error).code, expected);
      assert.equal(isAiMediaProviderBillingFailure(error), status === 402);
      assert.doesNotMatch(getAiMediaGenerationPublicError(error).message, /private|token|secret/);
      return true;
    });
  }
});

test("private addresses, lookalike domains, redirects and mismatched video IDs cannot supply video bytes", async () => {
  let calls = 0;
  const client = api.createHeygenApiClient({ apiKey: "test-key", fetch: async () => { calls++; return Response.json({ data: { id: "other-job", status: "processing" } }); } });
  for (const url of ["http://resource2.heygen.ai/a.mp4", "https://127.0.0.1/a", "https://heygen.ai.evil.invalid/a", "https://user:pass@heygen.ai/a", "https://heygen.ai:8080/a", "file:///a.mp4"]) {
    await assert.rejects(client.downloadVideo(url), /video_url_invalid/);
  }
  assert.equal(calls, 0);
  await assert.rejects(client.getVideo("job-1"), /video_response_invalid/);
  assert.equal(calls, 1);
});

test("an accepted voice is tracked before its activation check and a failed clone cannot become a generic voice", async () => {
  const methods: string[] = [], tracked: string[] = [];
  const client = api.createHeygenApiClient({ apiKey: "test-key", fetch: async (_url, options) => {
    methods.push(options?.method || "GET");
    if (options?.method === "POST") return Response.json({ data: { voice_id: "my-voice" } }, { status: 202 });
    assert.deepEqual(tracked, ["my-voice"]);
    return Response.json({ data: { status: "FAILED", failure_reason: "private transcription" } });
  } });
  await assert.rejects(client.createVoice("https://owned.invalid/voice.wav", "Voice", "fr", "voice-job", undefined, id => tracked.push(id)), /voice_clone_failed/);
  assert.deepEqual(methods, ["POST", "GET"]);
});

function args(): types.AiVideoProviderGenerationArgs {
  return { accountId: "account-1", jobId: "job-1", canonicalPromptSha256: "a".repeat(64), contentLanguage: "fr", brandColors: ["#123456"],
    request: { videoEngine: "heygen-avatar", format: "story", durationSeconds: 16, videoResolution: "720p", teamVideoSpeechMode: "characters", withNarration: false,
      inspirationImages: [{ role: "character", characterIndex: 2, voiceMode: "provided" }, { role: "environment" }, { role: "character", characterIndex: 1, voiceMode: "provided" }],
      exactDialogue: [{ speaker: "character", characterIndex: 1, text: "Bonjour, je suis David." }, { speaker: "character", characterIndex: 2, text: "Bonjour, je suis Kathia." }] },
    plan: { scenes: [{ visualBrief: "Jardin", spokenTurns: [{ reference: 3, text: "David" }, { reference: 1, text: "Kathia" }] }] },
  } as unknown as types.AiVideoProviderGenerationArgs;
}
function providerHarness(options: { submission?: "rejected" | "uncertain"; invalidTemporaryIds?: boolean } = {}) {
  const events: string[] = [], submitted: Array<{ scenes: Api.HeygenStudioScene[] }> = [];
  const audioUploads: Buffer[] = [], clonedVoices: string[] = [], signedImages: Array<unknown[]> = [];
  const reservations: Array<{estimatedCostMicroUsd:number}> = [], commits: Array<{actualCostMicroUsd:number}> = [];
  const client = {
    uploadImage: async (buffer: Buffer) => ({ type: "asset_id", asset_id: options.invalidTemporaryIds ? "invalid/id" : buffer.toString() }),
    uploadAudio: async (buffer: Buffer) => { audioUploads.push(Buffer.from(buffer)); return { type: "asset_id", asset_id: "silence" }; },
    waitForAvatar: async (id:string) => {events.push("ready:"+id);}, createPhotoAvatar: async (asset: Api.HeygenAsset) => ({ id: `avatar-${asset.asset_id}`, groupId: `group-${asset.asset_id}` }),
    createVoice: async (url: string, _name: string, _language: string, _key: string, _signal: unknown, track: (id: string) => void) => { const id = `cloned-${url}`; track(id); clonedVoices.push(id); return id; },
    publicVoices: async () => { events.push("public-voices"); return ["ai-voice"]; },
    publicAvatar: async () => "public-avatar",
    submitVideo: async (input: { scenes: Api.HeygenStudioScene[] }) => { submitted.push(input); if (options.submission) throw new api.HeygenApiError(options.submission === "rejected" ? 402 : 503, "request_failed", options.submission === "uncertain"); return "video-1"; },
    deleteVoice: async (id: string) => { events.push(`delete:${id}`); }, deleteAvatarGroup: async (id: string) => { events.push(`delete:${id}`); }, deleteAsset: async (id: string) => { events.push(`delete:${id}`); },
  };
  const provider = load<typeof Provider>("aiVideoProviderHeygen.ts", {
    "node:crypto": crypto, "@/lib/aiGatewayAccountGuard": {
      reserveAiGatewayAccountAttempt: async (_account:string,input:{estimatedCostMicroUsd:number}) => { reservations.push(input); events.push("reserve"); return {}; },
      commitAiGatewayAccountAttempt: async (input:{actualCostMicroUsd:number}) => { commits.push(input); events.push("commit"); }, rollbackAiGatewayAccountAttempt: async () => { events.push("rollback"); }, recordAiGatewayAccountFailure: async () => {},
    }, "./aiVideoHeygenApi.ts": { ...api, createHeygenApiClient: () => client }, "./aiMediaPendingVideo.ts": pending,
    "./aiVideoHeygenBackground.ts": { prepareHeygenBackground: async () => Buffer.from("garden"), prepareHeygenAvatarImage: async (buffer:Buffer) => buffer, createHeygenSilenceWav: (duration:number) => Buffer.from("silence:"+duration) },
    "./aiMediaIdentityReferences.ts": { prepareAiMediaIdentityReferences: async (images:unknown[]) => ({ buffers: images.map((_,i)=>Buffer.from(i===1?"garden":i===0?"person2":i===2?"person1":"person3")) }) },
    "./aiMediaCharacterVoiceStorage.ts": { getAiMediaCharacterVoiceSignedUrls: async (input:{images:Array<{voiceMode?:string}>}) => { signedImages.push(input.images); return input.images.map((image,i)=>image.voiceMode==="provided"?"voice"+(i===0?2:i===2?1:3):null); } },
    "./aiMediaHeygenBilling.ts": billing,
    "./aiMediaModelCatalog.ts": catalog, "./aiVideoProviderTypes.ts": { ...types, assertAiVideoReferenceTeamProviderEgress: () => {} },
  });
  return { provider, submitted, events, audioUploads, clonedVoices, signedImages, reservations, commits };
}

test("dialogue slots keep their own original photo and voice even when references are reordered around a decor", async () => {
  const h = providerHarness();
  await assert.rejects(h.provider.heygenAiVideoProvider.generate(args()), error => {
    assert.ok(pending.isAiVideoProviderPending(error));
    assert.equal(error.task.videoId, "video-1");
    assert.deepEqual(error.task.temporaryVoiceIds, ["cloned-voice1","cloned-voice2"]);
    return true;
  });
  assert.equal(h.submitted.length, 1);
  const scenes = h.submitted[0].scenes as Array<Extract<Api.HeygenStudioScene,{type:"avatar_video"}>>;
  assert.deepEqual(scenes.map(scene => [scene.input.avatar_id, scene.input.voice_id, scene.input.script]), [
    ["avatar-person1","cloned-voice1","Bonjour, je suis David."], ["avatar-person2","cloned-voice2","Bonjour, je suis Kathia."],
  ]);
  assert.ok(scenes.every(scene => scene.input.remove_background === true));
  assert.ok(scenes.every(scene => scene.input.background?.source.asset_id === "garden"));
  assert.ok(scenes.every(scene => scene.input.motion_prompt === undefined));
  assert.ok(!h.events.includes("public-voices"));
  assert.deepEqual(h.events, ["reserve","ready:avatar-person1","ready:avatar-person2","commit"]);
});

test("automatic two-person turns preserve attribution; an unbound speaker never spends", () => {
  const h = providerHarness(), request = args(); delete request.request.exactDialogue;
  assert.deepEqual(h.provider.buildHeygenDialogueTurns(request).map(turn => [turn.reference,turn.text]), [[3,"David"],[1,"Kathia"]]);
  request.plan.scenes[0].spokenTurns = [{ reference: 2, speaker: "Decor", text: "Wrong decor" }];
  assert.throws(() => h.provider.buildHeygenDialogueTurns(request), /speaker_missing/);
  assert.deepEqual(h.events, []);
});

test("a definite submission rejection releases the supplier reservation and temporary voices; uncertain acceptance preserves them", async () => {
  for (const submission of ["rejected","uncertain"] as const) {
    const h = providerHarness({ submission });
    await assert.rejects(h.provider.heygenAiVideoProvider.generate(args()));
    assert.equal(h.submitted.length, 1);
    assert.equal(h.events.includes("rollback"), submission === "rejected");
    assert.equal(h.events.includes("commit"), submission === "uncertain");
    assert.equal(h.events.some(event => event.startsWith("delete:")), submission === "rejected");
  }
});

test("pending provider tasks contain only bounded private identifiers, never URLs, keys or incomplete accounting", () => {
  const valid = { provider: "heygen-direct", model: "heygen-avatar-iv", videoId: "job-1", temporaryVoiceIds: ["voice-1"], temporaryAvatarGroupIds: [], temporaryAssetIds: [], estimatedCostMicroUsd: 1_000_000 };
  assert.ok(pending.isAiMediaPendingVideo(valid));
  assert.ok(!pending.isAiMediaPendingVideo({ ...valid, videoId: "https://private.invalid?token=secret" }));
  assert.ok(!pending.isAiMediaPendingVideo({ ...valid, temporaryVoiceIds: Array(5).fill("voice") }));
  assert.ok(!pending.isAiMediaPendingVideo({ ...valid, estimatedCostMicroUsd: -1 }));
});

test("HeyGen rejected parameters retain the exact operation and field without storing request values", async () => {
  const client = api.createHeygenApiClient({ apiKey: "test-key", fetch: async () => Response.json({ error: {
    code: "invalid_parameter", param: "scenes[0].input.motion_prompt", message: "Private user speech at https://signed.invalid?token=secret"
  } }, { status: 400 }) });
  await assert.rejects(client.submitVideo({ title: "Test", resolution: "1080p", aspect_ratio: "9:16", scenes: [] }, "job"), error => {
    assert.ok(error instanceof api.HeygenApiError);
    assert.equal((error.cause as Error).message, "ai_video_heygen_request_post_videos:scenes[0].input.motion_prompt");
    assert.doesNotMatch(JSON.stringify(error) + String(error.cause), /Private user|signed.invalid|token=secret/);
    return true;
  });
});
test("HeyGen support metrics read only a bounded window and exclude unexpected payloads", async () => {
  const calls: string[] = [];
  const client = api.createHeygenApiClient({ apiKey: "test-key", fetch: async (url, options) => {
    calls.push(String(url)); assert.equal(options!.method, "GET");
    return Response.json({ data: [
      { endpoint: "/v3/videos", total: 2, failed: 2, failed_4xx: 2, failed_5xx: 0, prompt: "private" },
      { endpoint: "https://private.invalid?secret=value", total: 2, failed: 2, failed_4xx: 2, failed_5xx: 0 },
      { endpoint: "/v3/avatars", total: -1, failed: 0, failed_4xx: 0, failed_5xx: 0 }
    ] });
  } });
  assert.deepEqual(await client.errorMetrics(100, 200), [{ endpoint: "/v3/videos", total: 2, failed: 2, failed4xx: 2, failed5xx: 0 }]);
  assert.equal(calls.length, 1);
  await assert.rejects(client.errorMetrics(100, 5000), /diagnostic_window_invalid/);
  assert.equal(calls.length, 1);
});

 test("photo avatar training completes before any video is submitted; only read-only polls repeat",async()=>{
  const methods:string[]=[];let sleeps=0;const states=["processing","processing","completed"];
  const client=api.createHeygenApiClient({apiKey:"synthetic",sleep:async <T,>(_ms?:number,value?:T)=>{sleeps++;return value as T;},fetch:async(url,options)=>{methods.push(options?.method||"GET");assert.equal(String(url),"https://api.heygen.com/v3/avatars/looks/look-1");return Response.json({data:{id:"look-1",status:states.shift()}});}});
  await client.waitForAvatar("look-1");assert.deepEqual(methods,["GET","GET","GET"]);assert.equal(sleeps,2);
 });
 test("failed or mismatched avatar preparation stops before a billable video without exposing upstream text",async()=>{
  for(const data of [{id:"look-1",status:"failed",error:"secret"},{id:"another-look",status:"completed"}]){
   let calls=0;const client=api.createHeygenApiClient({apiKey:"synthetic",fetch:async()=>{calls++;return Response.json({data});}});
   await assert.rejects(client.waitForAvatar("look-1"),error=>{assert.doesNotMatch(String(error),/secret/);return true;});assert.equal(calls,1);
  }
 });
 test("automatic multi-plan dialogue uses the real Studio fifty-scene limit rather than the exact-editor twelve-turn cap",()=>{
  const h=providerHarness(),input=args();delete input.request.exactDialogue;
  input.plan.scenes=Array.from({length:2},()=>({...input.plan.scenes[0],spokenTurns:Array.from({length:7},(_,i)=>({reference:i%2?1:3,speaker:"Assigned",text:"Bonjour."}))}));
  assert.equal(h.provider.buildHeygenDialogueTurns(input).length,14);
 });

test("external voiceover keeps both original portraits in their garden as silent avatar scenes",async()=>{
 const h=providerHarness(),input=args();delete input.request.exactDialogue;
 input.request.teamVideoSpeechMode="voiceover";input.request.withNarration=false;
 await assert.rejects(h.provider.heygenAiVideoProvider.generate(input),error=>{
  assert.ok(pending.isAiVideoProviderPending(error));assert.equal(error.task.temporaryVoiceIds.length,0);
  assert.equal(error.task.temporaryAssetIds.length,4);return true;
 });
 const scenes=h.submitted[0].scenes;
 assert.deepEqual(scenes.map(scene=>scene.type==="avatar_video"?scene.input.avatar_id:null),["avatar-person2","avatar-person1"]);
 for(const scene of scenes){assert.equal(scene.type,"avatar_video");if(scene.type!=="avatar_video")continue;
  assert.equal(scene.input.audio_asset_id,"silence");assert.equal(scene.input.script,undefined);assert.equal(scene.input.voice_id,undefined);
  assert.equal(scene.input.background?.source.asset_id,"garden");assert.equal(scene.input.remove_background,true);
 }
 assert.equal(h.audioUploads.length,1);assert.equal(h.audioUploads[0].toString(),"silence:8");
 assert.equal(h.clonedVoices.length,0);assert.ok(!h.events.includes("public-voices"));
 assert.ok(h.signedImages[0].every(image=>(image as {voiceMode?:string}).voiceMode==="ai"));
 assert.equal(h.submitted.length,1);
});

test("three silent portraits share one audio asset and stay inside the private cleanup five-asset limit",async()=>{
 const h=providerHarness(),input=args();delete input.request.exactDialogue;
 input.request.teamVideoSpeechMode="voiceover";input.request.withNarration=false;
 input.request.inspirationImages.push({role:"character",characterIndex:3,voiceMode:"provided",data:"A".repeat(64),mimeType:"image/png"});
 await assert.rejects(h.provider.heygenAiVideoProvider.generate(input),error=>{
  assert.ok(pending.isAiVideoProviderPending(error));assert.ok(pending.isAiMediaPendingVideo(error.task));
  assert.equal(error.task.temporaryAvatarGroupIds.length,3);assert.equal(error.task.temporaryAssetIds.length,5);return true;
 });
 assert.equal(h.submitted[0].scenes.length,3);assert.equal(h.audioUploads.length,1);assert.equal(h.clonedVoices.length,0);
});

test("a silent exact-dialogue tail keeps both portraits visible instead of requiring an invented speaker",async()=>{
 const h=providerHarness(),input=args();delete input.request.exactDialogue;
 input.plan.scenes.push({...input.plan.scenes[0],spokenLine:"",spokenTurns:[]});
 await assert.rejects(h.provider.heygenAiVideoProvider.generate(input),pending.isAiVideoProviderPending);
 const scenes=h.submitted[0].scenes;
 assert.equal(scenes.length,4);assert.equal(h.audioUploads.length,1);assert.equal(h.clonedVoices.length,2);
 assert.ok(scenes.slice(0,2).every(scene=>scene.type==="avatar_video"&&typeof scene.input.script==="string"));
 assert.ok(scenes.slice(2).every(scene=>scene.type==="avatar_video"&&scene.input.audio_asset_id==="silence"&&scene.input.script===undefined));
});

test("an exact offscreen AI turn remains separate from the two real speakers without creating another person",async()=>{
 const h=providerHarness(),input=args();input.request.exactDialogue!.splice(1,0,{speaker:"ai_voice",text:"Le jardin vous attend."});
 await assert.rejects(h.provider.heygenAiVideoProvider.generate(input),pending.isAiVideoProviderPending);
 const scenes=h.submitted[0].scenes;
 assert.equal(scenes.length,3);assert.equal(scenes[1].type,"image");
 if(scenes[1].type==="image"){assert.equal(scenes[1].source.asset_id,"garden");assert.equal(scenes[1].script,"Le jardin vous attend.");assert.equal(scenes[1].voice_id,"ai-voice");}
 assert.deepEqual(scenes.filter(scene=>scene.type==="avatar_video").map(scene=>scene.input.voice_id),["cloned-voice1","cloned-voice2"]);
 assert.equal(h.audioUploads.length,0);assert.equal(h.clonedVoices.length,2);
});

test("voiceover without a portrait keeps its decor and does not create an unrequested public avatar",async()=>{
 const h=providerHarness(),input=args();delete input.request.exactDialogue;
 input.request.teamVideoSpeechMode="voiceover";input.request.withNarration=false;input.request.inspirationImages=[];
 await assert.rejects(h.provider.heygenAiVideoProvider.generate(input),pending.isAiVideoProviderPending);
 assert.deepEqual(h.submitted[0].scenes,[{type:"image",source:{type:"asset_id",asset_id:"garden"},duration:16}]);
 assert.equal(h.audioUploads.length,0);assert.equal(h.clonedVoices.length,0);assert.ok(!h.events.includes("public-voices"));
});

test("supplier reservation uses the actual prepared Auto words instead of the selected eight seconds",async()=>{
 const h=providerHarness(),input=args();delete input.request.exactDialogue;
 input.request.durationSeconds=8;input.request.videoResolution="1080p";
 const text="Bonjour à tous. ".repeat(50);input.plan.scenes[0].spokenTurns=[{reference:3,speaker:"David",text}];
 await assert.rejects(h.provider.heygenAiVideoProvider.generate(input),error=>{
  assert.ok(pending.isAiVideoProviderPending(error));assert.equal(error.task.estimatedCostMicroUsd,12_160_000);return true;
 });
 assert.equal(h.reservations[0].estimatedCostMicroUsd,12_160_000);assert.equal(h.commits[0].actualCostMicroUsd,12_160_000);
 assert.equal(h.submitted.length,1);const scene=h.submitted[0].scenes[0];assert.equal(scene.type,"avatar_video");
 if(scene.type==="avatar_video")assert.equal(scene.input.script,text);
});

test("invalid temporary identifiers stop before a paid render instead of failing while constructing its pending task",async()=>{
 const h=providerHarness({invalidTemporaryIds:true});
 await assert.rejects(h.provider.heygenAiVideoProvider.generate(args()));
 assert.equal(h.submitted.length,0);assert.ok(h.events.includes("rollback"));assert.equal(h.commits.length,0);
});

test("the bounded supplier estimate supports long accepted speech and rejects only malformed monetary values",()=>{
 const base={provider:"heygen-direct",model:"heygen-avatar-iv",videoId:"video-1",temporaryVoiceIds:[],temporaryAvatarGroupIds:[],temporaryAssetIds:[]};
 assert.ok(pending.isAiMediaPendingVideo({...base,estimatedCostMicroUsd:400_000_000}));
 for(const cost of [-1,Infinity,NaN,400_000_001])assert.ok(!pending.isAiMediaPendingVideo({...base,estimatedCostMicroUsd:cost}));
});
