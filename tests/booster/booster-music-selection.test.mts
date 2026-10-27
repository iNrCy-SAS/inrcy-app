import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";
import type { LoadedAiMediaSoundtrack } from "../../lib/aiMediaGenerationSoundtracks.ts";

const account="11111111-1111-4111-8111-111111111111",publication="22222222-2222-4222-8222-222222222222",nextPublication="33333333-3333-4333-8333-333333333333";
const manualId="cinema-inspirant";
const actual=runtimeModules();
const soundtracks=actual<typeof import("../../lib/boosterSoundtracks.ts")>("lib/boosterSoundtracks.ts");
const assets=actual<typeof import("../../lib/aiMediaGenerationSoundtracks.ts")>("lib/aiMediaGenerationSoundtracks.ts");
type Row={id:string;user_id:string;type:string;payload:Record<string,unknown>};

function series(){
 const rows=new Map<string,Row>(),renders:Array<{publicationId:string;loadedSoundtrack:LoadedAiMediaSoundtrack}>=[],native:number[]=[],loads:Array<{soundtrackId?:string;selectionKey?:string}>=[];
 let databaseCalls=0,leaseCalls=0,failAt=-1;
 const database={from(table:string){
  databaseCalls++;assert.equal(table,"app_events");let action="read",value:Record<string,unknown>={};const filters=new Map<string,unknown>();
  const query={select(){return query},eq(key:string,expected:unknown){filters.set(key,expected);return query},insert(input:Record<string,unknown>){action="insert";value=input;return query},update(input:Record<string,unknown>){action="update";value=input;return query},async maybeSingle(){
   if(action==="insert"){const row=structuredClone(value) as Row;assert.equal(row.user_id,account);if(rows.has(row.id))return {data:null,error:{code:"23505"}};rows.set(row.id,row);return {data:{id:row.id},error:null}}
   assert.equal(filters.get("user_id"),account);assert.equal(filters.get("type"),"publish_meta_story_sequence");
   const row=rows.get(String(filters.get("id")));if(!row||![...filters].every(([key,expected])=>key==="payload->>revision"?String(row.payload.revision)===expected:row[key as keyof Row]===expected))return {data:null,error:null};
   if(action==="update"){assert.ok(filters.has("payload->>revision"));row.payload=structuredClone(value.payload) as Record<string,unknown>;return {data:{id:row.id},error:null}}
   return {data:structuredClone(row),error:null};
  }};return query;
 }};
 const load=runtimeModules({
  "@/lib/supabaseAdmin":{supabaseAdmin:database},
  "@/lib/executionIdempotency":{async acquireExecutionIdempotencyLock(){leaseCalls++;return {state:"acquired",lock:{id:"synthetic-lease"}}},async completeExecutionIdempotencyLockOrThrow(){},async failExecutionIdempotencyLock(){}},
  "@/lib/aiMediaGenerationSoundtracks":{async loadAiMediaSoundtrack(prompt:string,options:Parameters<typeof assets.loadAiMediaSoundtrack>[1]){loads.push({...options});return assets.loadAiMediaSoundtrack(prompt,options)}},
  "@/lib/instagramImageMotionVideo":{async createInstagramImageMotionVideo(input:typeof renders[number]){renders.push(input);return {publicUrl:`https://storage.fixture.invalid/${input.publicationId}.mp4`}}},
  "@/lib/metaPhotoStoryPublisher":{async publishMetaVideoStory(input:{videoUrl:string;preparedId?:string;onPrepared:(id:string|null)=>Promise<void>;onPublishStarting:()=>Promise<void>}){
   const index=Number(input.videoUrl.match(/-(\d+)\.mp4$/)![1]);native.push(index);if(!input.preparedId)await input.onPrepared(`prepared-${index}`);await input.onPublishStarting();
   return index===failAt?{ok:false,certainty:"not_published",retryable:true,error:"Synthetic refusal before publication"}:{ok:true,remoteId:`story-${index}`};
  }},
 });
 const api=load<typeof import("../../lib/metaStorySequenceStorage.ts")>("lib/metaStorySequenceStorage.ts");
 const args={accountId:account,publicationId:publication,channel:"instagram" as const,remoteAccountId:"12345",accessToken:"synthetic-token",soundtrackPrompt:"Une ambiance nature et détente",photos:Array.from({length:5},(_,index)=>({url:`https://storage.fixture.invalid/${index}.jpg`,storagePath:`${account}/photo-${index}.jpg`,sourceIdentity:`jpeg-sha256:${String(index+1).repeat(64)}`}))};
 return {rows,renders,native,loads,args,fail(index:number){failAt=index},run(overrides:Partial<Omit<typeof args,"channel">>&{channel?:"facebook"|"instagram";soundtrackId?:string|null;resumeRef?:unknown}={}){return api.publishPersistedMetaStorySequence({...args,...overrides})},get databaseCalls(){return databaseCalls},get leaseCalls(){return leaseCalls}};
}

test("the public catalogue contains 24 bundled tracks and only exact IDs or Auto are accepted",()=>{
 const catalogue=soundtracks.getBoosterSoundtrackCatalog();assert.equal(catalogue.length,24);assert.equal(new Set(catalogue.map(track=>track.id)).size,24);
 assert.equal(soundtracks.normalizeBoosterSoundtrackId(undefined),null);assert.equal(soundtracks.normalizeBoosterSoundtrackId(null),null);
 for(const track of catalogue){assert.equal(soundtracks.normalizeBoosterSoundtrackId(track.id),track.id);assert.equal(track.durationSeconds,8);assert.equal(track.audioPreview,`/api/booster/soundtracks/${track.id}/preview`);assert.ok(track.label&&track.description);assert.deepEqual(Object.keys(track).sort(),["audioPreview","description","durationSeconds","id","label"])}
 for(const invalid of ["",`${manualId} `,manualId.toUpperCase(),"../secret","https://attacker.invalid/audio.wav",{},[],12])assert.throws(()=>soundtracks.normalizeBoosterSoundtrackId(invalid),/booster_soundtrack_invalid/);
 assert.doesNotMatch(JSON.stringify(catalogue),/absolutePath|soundtrackSha|assets\/|accessToken/);
});

test("channel choices reject unknown channels and malformed values, while explicit Auto overrides the legacy shared track",()=>{
 const normalize=soundtracks.normalizeBoosterSoundtrackByChannel,resolve=soundtracks.resolveBoosterSoundtrackByChannel;
 assert.deepEqual(normalize(undefined),{});assert.deepEqual(normalize({facebook:manualId,instagram:null}),{facebook:manualId,instagram:null});
 for(const invalid of [null,[],manualId,{threads:manualId},{gmb:null},{tiktok:manualId},{facebook:undefined},{instagram:"unregistered-track"},{facebook:12},{instagram:{}},JSON.parse('{"__proto__":"cinema-inspirant"}')])assert.throws(()=>normalize(invalid),/booster_soundtrack_invalid/);
 const automatic="horizon-clair",instagram="nocturne-elegant";
 assert.deepEqual(resolve(normalize({facebook:manualId,instagram}),null,automatic),{facebook:manualId,instagram});
 assert.deepEqual(resolve(normalize({facebook:null}),manualId,automatic),{facebook:automatic,instagram:manualId});
 assert.deepEqual(resolve(normalize(undefined),manualId,automatic),{facebook:manualId,instagram:manualId});
 assert.deepEqual(resolve(normalize({}),null,automatic),{facebook:automatic,instagram:automatic});
 const route=readFileSync(new URL("../../app/api/booster/publish-now/route.ts",import.meta.url),"utf8"),guard=route.indexOf("normalizeBoosterSoundtrackByChannel(body.soundtrackByChannel)");
 assert.ok(guard>route.indexOf("body = resolvedPreparation.body"));assert.ok(guard<route.indexOf("body = normalizeSiteWebPublicationPayload(body)"));assert.ok(guard<route.indexOf("const ingress = await enqueueBoosterPublication("));
});

test("catalogue and preview routes return actual original WAV assets and reject traversal before filesystem access",async()=>{
 const load=runtimeModules({"next/server":{NextResponse:{json:(body:unknown,options?:ResponseInit)=>Response.json(body,options)}}});
 const catalog=load<typeof import("../../app/api/booster/soundtracks/route.ts")>("app/api/booster/soundtracks/route.ts");
 const response=await catalog.GET();assert.equal(response.status,200);assert.equal((await response.json()).soundtracks.length,24);
 const preview=load<typeof import("../../app/api/booster/soundtracks/[id]/preview/route.ts")>("app/api/booster/soundtracks/[id]/preview/route.ts");
 const audio=await preview.GET(new Request("https://fixture.invalid"),{params:Promise.resolve({id:manualId})});assert.equal(audio.status,200);assert.equal(audio.headers.get("content-type"),"audio/wav");assert.equal(audio.headers.get("x-content-type-options"),"nosniff");
 const bytes=Buffer.from(await audio.arrayBuffer());assert.equal(bytes.toString("ascii",0,4),"RIFF");assert.equal(bytes.toString("ascii",8,12),"WAVE");
 assert.deepEqual(bytes,readFileSync(new URL(`../../assets/media-generation/soundtracks/${manualId}-8s.wav`,import.meta.url)));
 let reads=0;const isolated=runtimeModules({"node:fs/promises":{async readFile(){reads++;assert.fail("Invalid IDs must never reach file IO")}}});
 const badPreview=isolated<typeof preview>("app/api/booster/soundtracks/[id]/preview/route.ts");
 for(const id of ["../secret",`${manualId} `,"unregistered-track"]){assert.equal((await badPreview.GET(new Request("https://fixture.invalid"),{params:Promise.resolve({id})})).status,404)}
 assert.equal(reads,0);
});

test("an invalid soundtrack stops before DB, lease, rendering or native publication",async()=>{
 const h=series();const result=await h.run({soundtrackId:"unregistered-track"});assert.equal(result.ok,false);assert.equal(result.code,"booster_soundtrack_invalid");
 assert.equal(h.databaseCalls,0);assert.equal(h.leaseCalls,0);assert.equal(h.loads.length,0);assert.equal(h.renders.length,0);assert.equal(h.native.length,0);
 const route=readFileSync(new URL("../../app/api/booster/publish-now/route.ts",import.meta.url),"utf8");
 const guard=route.indexOf("normalizeBoosterSoundtrackId(body.soundtrackId)");assert.ok(guard>route.indexOf("await req.json()"));assert.ok(guard>route.indexOf("body = resolvedPreparation.body"));assert.ok(guard<route.indexOf("body = normalizeSiteWebPublicationPayload(body)"));assert.ok(guard<route.indexOf("const ingress = await enqueueBoosterPublication("));
});

test("one manual choice loads one actual track and injects the identical asset into all five Story clips",async()=>{
 const h=series();const result=await h.run({soundtrackId:manualId});assert.equal(result.ok,true);assert.deepEqual(h.native,[0,1,2,3,4]);assert.equal(h.loads.length,1);assert.equal(h.loads[0].soundtrackId,manualId);
 assert.equal(h.renders.length,5);assert.ok(h.renders.every(render=>render.loadedSoundtrack===h.renders[0].loadedSoundtrack));
 const loaded=h.renders[0].loadedSoundtrack;assert.equal(loaded.id,manualId);assert.equal(loaded.durationSeconds,8);assert.ok(loaded.sizeBytes>44);
 const row=h.rows.get(String(result.story_sequence_resume_ref))!;assert.equal(row.payload.soundtrackId,manualId);assert.equal(row.payload.soundtrackSha256,loaded.sha256);
});

test("Facebook and Instagram keep distinct real soundtracks across five Stories and each channel's Reel",async()=>{
 const requested=soundtracks.normalizeBoosterSoundtrackByChannel({facebook:manualId,instagram:"nocturne-elegant"}),resolved=soundtracks.resolveBoosterSoundtrackByChannel(requested,null,"horizon-clair");
 const h=series(),shaByChannel=new Map<string,string>();
 for(const channel of ["facebook","instagram"] as const){
  const before=h.renders.length,result=await h.run({channel,soundtrackId:resolved[channel]});assert.equal(result.ok,true);
  const clips=h.renders.slice(before);assert.equal(clips.length,5);assert.ok(clips.every(clip=>clip.loadedSoundtrack===clips[0].loadedSoundtrack));
  const track=clips[0].loadedSoundtrack;assert.equal(track.id,resolved[channel]);shaByChannel.set(channel,track.sha256);
  const saved=h.rows.get(String(result.story_sequence_resume_ref))!;assert.equal(saved.payload.channel,channel);assert.equal(saved.payload.soundtrackSha256,track.sha256);
  const downloads:string[]=[],reelTracks:LoadedAiMediaSoundtrack[]=[];const load=runtimeModules({"@/lib/supabaseAdmin":{supabaseAdmin:{storage:{from:()=>({async download(key:string){downloads.push(key);return {data:new Blob([new Uint8Array(2048)],{type:"video/mp4"}),error:null}},getPublicUrl:(key:string)=>({data:{publicUrl:`https://storage.fixture.invalid/${key}`}})})}}},"@/lib/aiMediaGenerationSoundtracks":{async loadAiMediaSoundtrack(prompt:string,options:Parameters<typeof assets.loadAiMediaSoundtrack>[1]){const loaded=await assets.loadAiMediaSoundtrack(prompt,options);reelTracks.push(loaded);return loaded}}});
  const factory=channel==="facebook"?load<typeof import("../../lib/facebookImageMotionVideo.ts")>("lib/facebookImageMotionVideo.ts").createFacebookImageMotionVideo:load<typeof import("../../lib/instagramImageMotionVideo.ts")>("lib/instagramImageMotionVideo.ts").createInstagramImageMotionVideo;
  const reel=await factory({accountId:account,publicationId:publication,imageStoragePaths:h.args.photos.map(photo=>photo.storagePath),placement:"reel",soundtrackPrompt:"The brief must not replace the selected channel music",soundtrackId:resolved[channel]});
  assert.equal(reel.sourceMetadata?.soundtrackId,track.id);assert.equal(reelTracks[0].sha256,track.sha256);assert.equal(downloads.length,1);
 }
 assert.notEqual(shaByChannel.get("facebook"),shaByChannel.get("instagram"));assert.equal(h.rows.size,2);assert.equal(h.native.length,10);
});

test("Auto remains deterministic within a saved sequence and a retry cannot replace its manual music",async()=>{
 const auto=series();const automatic=await auto.run({soundtrackId:null});assert.equal(automatic.ok,true);assert.ok(soundtracks.getBoosterSoundtrackCatalog().some(track=>track.id===auto.renders[0].loadedSoundtrack.id));
 assert.equal(auto.loads[0].soundtrackId,undefined);
 const h=series();h.fail(3);const first=await h.run({soundtrackId:manualId});assert.equal(first.ok,false);assert.equal(first.published_image_count,3);
 const ref=String(first.story_sequence_resume_ref),sha=h.renders[0].loadedSoundtrack.sha256;h.fail(-1);
 const completed=await h.run({publicationId:nextPublication,resumeRef:ref,soundtrackId:"horizon-clair",soundtrackPrompt:"A changed brief must not change saved music"});assert.equal(completed.ok,true);
 assert.deepEqual(h.native,[0,1,2,3,3,4]);assert.equal(completed.soundtrack_id,manualId);assert.equal(completed.soundtrack_selection_preserved,true);
 assert.ok(h.renders.every(render=>render.loadedSoundtrack.id===manualId&&render.loadedSoundtrack.sha256===sha));assert.equal(h.loads[1].soundtrackId,manualId);
 assert.equal(h.rows.get(ref)!.payload.soundtrackId,manualId);assert.equal(h.rows.get(ref)!.payload.soundtrackSha256,sha);
});

test("both real Meta motion factories honor manual music for Stories and Reels and separate their cached selection",async()=>{
 const downloads:string[]=[];
 const load=runtimeModules({"@/lib/supabaseAdmin":{supabaseAdmin:{storage:{from:()=>({async download(key:string){downloads.push(key);return {data:new Blob([new Uint8Array(2048)],{type:"video/mp4"}),error:null}},getPublicUrl:(key:string)=>({data:{publicUrl:`https://storage.fixture.invalid/${key}`}})})}}}});
 const instagram=load<typeof import("../../lib/instagramImageMotionVideo.ts")>("lib/instagramImageMotionVideo.ts");
 const facebook=load<typeof import("../../lib/facebookImageMotionVideo.ts")>("lib/facebookImageMotionVideo.ts");
 for(const create of [instagram.createInstagramImageMotionVideo,facebook.createFacebookImageMotionVideo])for(const placement of ["story","reel"] as const){
  const args={accountId:account,publicationId:publication,imageStoragePaths:[`${account}/first.jpg`,`${account}/second.jpg`],placement,soundtrackPrompt:"A nature prompt must not override a manual cinematic track",soundtrackId:manualId};
  const selected=await create(args);assert.equal(selected.sourceMetadata?.soundtrackId,manualId);
  assert.equal((await create(args)).storagePath,selected.storagePath,"Retry keeps the same track/cache key");
  assert.notEqual((await create({...args,soundtrackId:"horizon-clair"})).storagePath,selected.storagePath,"A different explicit track must not reuse stale audio");
 }
 assert.equal(downloads.length,12);
});
