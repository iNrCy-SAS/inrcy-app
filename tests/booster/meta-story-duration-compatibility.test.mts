import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";
import type { LoadedAiMediaSoundtrack } from "../../lib/aiMediaGenerationSoundtracks.ts";

const account="11111111-1111-4111-8111-111111111111",publication="22222222-2222-4222-8222-222222222222",legacyRef="33333333-3333-4333-8333-333333333333",trackId="cinema-inspirant";
const actual=runtimeModules(),assets=actual<typeof import("../../lib/aiMediaGenerationSoundtracks.ts")>("lib/aiMediaGenerationSoundtracks.ts");
type Row={id:string;user_id:string;type:string;payload:Record<string,unknown>};
type Prepared={preparedId?:string;videoUrl:string;onPrepared:(id:string|null)=>Promise<void>;onPublishStarting:()=>Promise<void>};
const photos=Array.from({length:5},(_,index)=>({url:`https://storage.fixture.invalid/${index}.jpg`,storagePath:`${account}/photo-${index}.jpg`,sourceIdentity:`jpeg-sha256:${String(index+1).repeat(64)}`}));

function fixture(seed?:Row){
 const rows=new Map<string,Row>(seed?[[seed.id,structuredClone(seed)]]:[]),renders:Array<{durationSeconds?:number;loadedSoundtrack:LoadedAiMediaSoundtrack;publicationId:string}>=[],native:Array<{index:number;preparedId?:string}>=[],loads:Array<{soundtrackId?:string;durationSeconds?:number}>=[];
 let leases=0;
 const database={from(table:string){assert.equal(table,"app_events");let action="read",input:Record<string,unknown>={};const where=new Map<string,unknown>();const query={select(){return query},eq(key:string,value:unknown){where.set(key,value);return query},insert(value:Record<string,unknown>){action="insert";input=value;return query},update(value:Record<string,unknown>){action="update";input=value;return query},async maybeSingle(){
  if(action==="insert"){const row=structuredClone(input) as Row;assert.equal(row.user_id,account);assert.equal(row.type,"publish_meta_story_sequence");if(rows.has(row.id))return {data:null,error:{code:"23505"}};rows.set(row.id,row);return {data:{id:row.id},error:null}}
  assert.equal(where.get("user_id"),account);assert.equal(where.get("type"),"publish_meta_story_sequence");const row=rows.get(String(where.get("id")));
  if(!row||![...where].every(([key,value])=>key==="payload->>revision"?String(row.payload.revision)===value:row[key as keyof Row]===value))return {data:null,error:null};
  if(action==="update"){assert.ok(where.has("payload->>revision"));row.payload=structuredClone(input.payload) as Record<string,unknown>;return {data:{id:row.id},error:null}}
  return {data:structuredClone(row),error:null};
 }};return query}};
 const load=runtimeModules({
  "@/lib/supabaseAdmin":{supabaseAdmin:database},
  "@/lib/executionIdempotency":{async acquireExecutionIdempotencyLock(){leases++;return {state:"acquired",lock:{id:"fixture-lease"}}},async completeExecutionIdempotencyLockOrThrow(){},async failExecutionIdempotencyLock(){}},
  "@/lib/aiMediaGenerationSoundtracks":{async loadAiMediaSoundtrack(prompt:string,options:Parameters<typeof assets.loadAiMediaSoundtrack>[1]){loads.push({...options});return assets.loadAiMediaSoundtrack(prompt,options)}},
  "@/lib/instagramImageMotionVideo":{async createInstagramImageMotionVideo(input:typeof renders[number]){renders.push(input);return {publicUrl:`https://storage.fixture.invalid/${input.publicationId}.mp4`}}},
  "@/lib/metaPhotoStoryPublisher":{async publishMetaVideoStory(input:Prepared){const index=Number(input.videoUrl.match(/-(\d+)\.mp4$/)![1]);native.push({index,preparedId:input.preparedId});if(!input.preparedId)await input.onPrepared(`new-container-${index}`);await input.onPublishStarting();return {ok:true,remoteId:`new-story-${index}`}}},
 });
 const api=load<typeof import("../../lib/metaStorySequenceStorage.ts")>("lib/metaStorySequenceStorage.ts");
 return {rows,renders,native,loads,get leases(){return leases},run(resumeRef?:string){return api.publishPersistedMetaStorySequence({accountId:account,publicationId:publication,channel:"instagram",remoteAccountId:"12345",accessToken:"synthetic-private-token",authMode:"facebook_login",photos,soundtrackPrompt:"A changed brief must not alter an already prepared Story",soundtrackId:resumeRef?"horizon-clair":trackId,...(resumeRef?{resumeRef}:{})})}};
}

async function legacyCheckpoint(started=false):Promise<Row>{
 const track=await assets.loadAiMediaSoundtrack("",{soundtrackId:trackId,durationSeconds:8}),sources=photos.map(photo=>photo.sourceIdentity),scope=`${account}:${legacyRef}:instagram:12345:facebook_login`;
 return {id:legacyRef,user_id:account,type:"publish_meta_story_sequence",payload:{version:1,nativeStageVersion:1,mediaKind:"video",audioMode:"shared",publicationId:"44444444-4444-4444-8444-444444444444",channel:"instagram",remoteAccountId:"12345",authMode:"facebook_login",sources,revision:7,soundtrackId:trackId,soundtrackSha256:track.sha256,nativePreparations:sources.map((_,index)=>({preparedId:index<=2?`legacy-container-${index}`:null,publishStarted:index<2||index===2&&started})),state:{version:1,fingerprint:createHash("sha256").update(JSON.stringify([scope,sources])).digest("hex"),items:sources.map((source,index)=>index<2?{index,source,status:"published",remoteId:`legacy-story-${index}`}:{index,source,status:index===2?"dispatching":"queued"})}}};
}

test("new Story sequences persist four-second clips backed by the same original 24-second track",async()=>{
 const h=fixture(),result=await h.run();assert.equal(result.ok,true);assert.deepEqual(h.native.map(call=>call.index),[0,1,2,3,4]);assert.equal(h.renders.length,5);
 assert.ok(h.renders.every(render=>render.durationSeconds===4));assert.ok(h.renders.every(render=>render.loadedSoundtrack===h.renders[0].loadedSoundtrack));
 assert.equal(h.loads.length,1);assert.equal(h.loads[0].durationSeconds,24);assert.equal(h.renders[0].loadedSoundtrack.durationSeconds,24);
 const row=h.rows.get(String(result.story_sequence_resume_ref))!;assert.equal(row.payload.clipDurationSeconds,4);assert.equal(row.payload.soundtrackAssetDurationSeconds,24);assert.equal(row.payload.soundtrackId,trackId);
 assert.equal(row.payload.soundtrackSha256,h.renders[0].loadedSoundtrack.sha256);
});

test("a legacy eight-second checkpoint preserves its audio SHA, prepared container and confirmed remote IDs",async()=>{
 const legacy=await legacyCheckpoint(),h=fixture(legacy),result=await h.run(legacyRef);assert.equal(result.ok,true);
 assert.deepEqual(h.native,[{index:2,preparedId:"legacy-container-2"},{index:3,preparedId:undefined},{index:4,preparedId:undefined}]);
 assert.deepEqual(result.story_ids,["legacy-story-0","legacy-story-1","new-story-2","new-story-3","new-story-4"]);
 assert.equal(h.renders.length,3);assert.ok(h.renders.every(render=>render.durationSeconds===8));assert.ok(h.renders.every(render=>render.loadedSoundtrack.id===trackId&&render.loadedSoundtrack.sha256===legacy.payload.soundtrackSha256));
 assert.equal(h.loads.length,1);assert.equal(h.loads[0].durationSeconds,8);assert.equal(h.loads[0].soundtrackId,trackId);
 const saved=h.rows.get(legacyRef)!;assert.equal(saved.payload.clipDurationSeconds,8);assert.equal(saved.payload.soundtrackAssetDurationSeconds,8);assert.equal(saved.payload.soundtrackSha256,legacy.payload.soundtrackSha256);
 const before=h.native.length,replay=await h.run(legacyRef);assert.equal(replay.ok,true);assert.equal(h.native.length,before);assert.equal(h.renders.length,3);
});

test("legacy commit uncertainty stays blocked across the duration change and never re-renders or posts",async()=>{
 const h=fixture(await legacyCheckpoint(true)),result=await h.run(legacyRef);assert.equal(result.ok,false);assert.equal(result.requestMayHaveSucceeded,true);assert.equal(result.retryable,false);
 assert.equal(h.native.length,0);assert.equal(h.renders.length,0);assert.equal(h.loads.length,0);
});

test("partial or contradictory stored timing is rejected before rendering or publication",async()=>{
 for(const timing of [{clipDurationSeconds:4},{soundtrackAssetDurationSeconds:24},{clipDurationSeconds:4,soundtrackAssetDurationSeconds:8},{clipDurationSeconds:8,soundtrackAssetDurationSeconds:24},{clipDurationSeconds:5,soundtrackAssetDurationSeconds:24},{clipDurationSeconds:"4",soundtrackAssetDurationSeconds:24},{clipDurationSeconds:null,soundtrackAssetDurationSeconds:null}]){
  const row=await legacyCheckpoint();Object.assign(row.payload,timing);const h=fixture(row),result=await h.run(legacyRef);assert.equal(result.ok,false,JSON.stringify(timing));assert.equal(h.native.length,0);assert.equal(h.renders.length,0);assert.equal(h.loads.length,0);
 }
});

test("Meta factories describe three seconds per Reel image and keep four- versus eight-second Story cache entries separate",async()=>{
 const downloads:string[]=[],load=runtimeModules({"@/lib/supabaseAdmin":{supabaseAdmin:{storage:{from:()=>({async download(key:string){downloads.push(key);return {data:new Blob([new Uint8Array(2048)],{type:"video/mp4"}),error:null}},getPublicUrl:(key:string)=>({data:{publicUrl:`https://storage.fixture.invalid/${key}`}})})}}}});
 const instagram=load<typeof import("../../lib/instagramImageMotionVideo.ts")>("lib/instagramImageMotionVideo.ts"),facebook=load<typeof import("../../lib/facebookImageMotionVideo.ts")>("lib/facebookImageMotionVideo.ts");
 const track=await assets.loadAiMediaSoundtrack("",{soundtrackId:trackId,durationSeconds:24});
 for(const create of [instagram.createInstagramImageMotionVideo,facebook.createFacebookImageMotionVideo]){
  for(const count of [1,2,3,5]){
   const args={accountId:account,publicationId:publication,imageStoragePaths:photos.slice(0,count).map(photo=>photo.storagePath),placement:"reel" as const,soundtrackPrompt:"",loadedSoundtrack:track},reel=await create(args);
   assert.equal(reel.duration,count*3);assert.equal(reel.sourceMetadata?.duration,count*3);assert.equal(reel.sourceMetadata?.frameRate,30);assert.equal(reel.sourceMetadata?.source,"instagram-image-motion-v4-media-timing");
   assert.equal((await create(args)).storagePath,reel.storagePath,"Identical retries retain the duration-specific cached media");
  }
  const storyArgs={accountId:account,publicationId:publication,imageStoragePaths:[photos[0].storagePath],placement:"story" as const,soundtrackPrompt:"",loadedSoundtrack:track},current=await create(storyArgs),legacy=await create({...storyArgs,durationSeconds:8});
  assert.equal(current.duration,4);assert.equal(legacy.duration,8);assert.notEqual(current.storagePath,legacy.storagePath,"Duration alone must prevent reuse of the old eight-second file");
  const before=downloads.length;
  await assert.rejects(create({...storyArgs,durationSeconds:3}),/meta_image_motion_timing_invalid/);
  await assert.rejects(create({...storyArgs,placement:"reel",imageStoragePaths:photos.map(photo=>photo.storagePath),durationSeconds:8}),/meta_image_motion_timing_invalid/);
  assert.equal(downloads.length,before,"Unsupported timing must fail before cache or renderer IO");
 }
});
