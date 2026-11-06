import assert from "node:assert/strict";
import test from "node:test";
import { runtimeModules } from "./runtime-module-loader.mts";
import { preparedAgentChannelUsingExistingMedia } from "../../lib/inrAgentNewPublicationChannel.ts";

const USER="00000000-0000-4000-8000-000000000001";
const ACTION="00000000-0000-4000-8000-000000000003";
const image={id:"owned-image",kind:"image",url:"https://fixture.example/existing.jpg"};

test("new channel reuses existing images or video without changing the source payload",()=>{
  const payload={ images:[image], postByChannel:{facebook:{ content:"Keep" }} };
  const prepared=preparedAgentChannelUsingExistingMedia({channel:"instagram",post:{content:"New"},payload,imageAssets:[]});
  assert.ok("imagesByChannel" in prepared);
  assert.equal(prepared.imagesByChannel?.[0],image);
  assert.equal(prepared.mediaModeByChannel,"images");
  assert.deepEqual(payload,{images:[image],postByChannel:{facebook:{content:"Keep"}}});
  const video={id:"owned-video",kind:"video",url:"https://fixture.example/existing.mp4"};
  const withVideo=preparedAgentChannelUsingExistingMedia({channel:"tiktok",post:{content:"New"},payload:{mediaType:"video",video,mediaAsset:video},imageAssets:[]});
  assert.ok("videoByChannel" in withVideo);
  assert.equal(withVideo.videoByChannel,video);
  assert.equal(withVideo.mediaModeByChannel,"video");
});

test("the actual preparation endpoint generates only the missing channel text and commits atomically",async()=>{
  for(const scenario of ["pending_validation","scheduled","disconnected","stale","missing_rpc"]){
    let generations=0,mediaGenerations=0,reservations=0,committed=0,rolledBack=0;
    let rpcArgs:Record<string,unknown>|undefined;
    const row={id:ACTION,user_id:USER,automation_key:"publish",action_type:"publication",target_tool:"booster",title:"Existing publication",summary:"Keep the same verified topic",target_channels:["facebook"],image_assets:[image],payload:{selectedChannels:["facebook"],images:[image],postByChannel:{facebook:{content:"Do not replace me"}}},status:scenario==="scheduled"?"scheduled":"pending_validation",updated_at:"2026-10-19T12:00:00Z"};
    const database={from:()=>({select:()=>({eq:()=>({eq:()=>({maybeSingle:async()=>({data:row,error:null})})})})}),
      rpc:async(_name:string,args:Record<string,unknown>)=>{
        if(args.p_user_id===null) return scenario==="missing_rpc"
          ? {data:null,error:{code:"PGRST202"}}
          : {data:{outcome:"invalid_request"},error:null};
        rpcArgs=args;return scenario==="stale"?{data:{outcome:"stale"},error:null}:{data:{outcome:"saved",action:{...row,target_channels:["facebook","instagram"],payload:{...row.payload,postByChannel:{...row.payload.postByChannel,instagram:{content:"New Instagram text"}}}},scheduledActions:[]},error:null};}};
    const load=runtimeModules({
      "@/lib/requireUser":{requireUser:async()=>({supabase:database,activeUserId:USER,authUserId:USER,errorResponse:null})},
      "@/lib/supabaseAdmin":{supabaseAdmin:database},
      "@/lib/rateLimit":{enforceRateLimit:async()=>null},
      "@/lib/aiUsageQuota":{reserveAiCredits:async()=>{reservations++;return {reservation:{id:"quota"},errorResponse:null}},computeBoosterAiCredits:()=>1,commitAiCredits:async()=>{committed++},rollbackAiCredits:async()=>{rolledBack++}},
      "@/lib/boosterGenerationContext":{getBoosterGenerationContext:async()=>({profile:{},business:{},recentPublications:[]})},
      "@/lib/boosterCtaDefaultsServer":{loadBoosterCtaDefaults:async()=>({})},
      "@/lib/boosterCtaPreferences":{applySafePreferredCta:({post}:{post:unknown})=>post},
      "@/lib/boosterPublishGeneration":{generateSharedBoosterPosts:async(args:Record<string,unknown>)=>{generations++;assert.deepEqual(args.channels,["instagram"]);assert.match(String(args.idea),/TEXTE DE LA PUBLICATION EXISTANTE/);assert.match(String(args.idea),/Do not replace me/);return {versions:{instagram:{title:"Instagram",content:"New Instagram text"}}}}},
      "@/lib/inrAgentMediaGeneration":{generateInrAgentMedia:async()=>{mediaGenerations++;throw Error("Media generation forbidden");}},
      "@/lib/inrAgentMediaFormats":{},"@/lib/inrAgentMediaPreferencesServer":{},
      "@/lib/inrAgentEditorialPlanning":{INR_AGENT_IMAGES_PER_PUBLICATION:3},
      "@/app/api/booster/connected-channels/route":{GET:async()=>Response.json({channels:{instagram:scenario!=="disconnected"}})},
    });
    const {POST}=load<{POST:(request:Request)=>Promise<Response>}>("app/api/agent/actions/regenerate-channel/route.ts");
    const response=await POST(new Request("http://localhost/api/agent/actions/regenerate-channel",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({actionId:ACTION,channel:"instagram",kind:"content",scope:"channel",prepareMissingChannel:true})}));
    assert.equal(mediaGenerations,0);
    if(scenario==="disconnected") { assert.equal(response.status,409);assert.equal(generations,0);assert.equal(rpcArgs,undefined); }
    else if(scenario==="missing_rpc") { assert.equal(response.status,503);assert.equal(generations,0);assert.equal(reservations,0);assert.equal(rpcArgs,undefined); }
    else if(scenario==="stale") { assert.equal(response.ok,false);assert.equal(committed,0);assert.equal(rolledBack,1); }
    else { assert.equal(response.status,200);assert.equal(generations,1);assert.equal(committed,1);assert.equal(rolledBack,0);assert.deepEqual((rpcArgs?.p_prepared_channel as Record<string,unknown>).imagesByChannel,[image]);assert.deepEqual(rpcArgs?.p_channels,["facebook"]); }
  }
});

test("Instagram regeneration budgets the retained explicit CTA after generation while preserving every other channel",async()=>{
  let saved:Record<string,unknown>|undefined,generations=0;
  const url=`https://business.example.test/${"ancienne-destination-".repeat(45)}`;
  const oldInstagram={title:"Ancien titre",content:"Ancien contenu",cta:"Voir notre travail",ctaMode:"custom",ctaUrl:url,hashtags:["ancien"]};
  const facebook={title:"Facebook intact",content:"Ne pas modifier ce canal"};
  const row={id:ACTION,user_id:USER,automation_key:"publish",action_type:"publication",target_tool:"booster",title:"Existing publication",summary:"Projet préparé avec soin",target_channels:["instagram","facebook"],target_themes:["conseils"],image_assets:[image],payload:{selectedChannels:["instagram","facebook"],images:[image],postByChannel:{instagram:oldInstagram,facebook}},status:"pending_validation",updated_at:"2026-10-19T12:00:00Z"};
  const database={from:()=>({select:()=>({eq:()=>({eq:()=>({maybeSingle:async()=>({data:row,error:null})})})})})};
  const load=runtimeModules({
    "@/lib/requireUser":{requireUser:async()=>({supabase:database,activeUserId:USER,authUserId:USER,errorResponse:null})},
    "@/lib/supabaseAdmin":{supabaseAdmin:database},
    "@/lib/rateLimit":{enforceRateLimit:async()=>null},
    "@/lib/aiUsageQuota":{reserveAiCredits:async()=>({reservation:{id:"quota"},errorResponse:null}),computeBoosterAiCredits:()=>1,commitAiCredits:async()=>{},rollbackAiCredits:async()=>{}},
    "@/lib/boosterGenerationContext":{getBoosterGenerationContext:async()=>({profile:{},business:{},recentPublications:[]})},
    "@/lib/boosterCtaDefaultsServer":{loadBoosterCtaDefaults:async()=>({preferredWebsiteUrl:"https://new.example.test/",siteWebUrl:"",phone:"",preferredCta:"site"})},
    "@/lib/boosterPublishGeneration":{generateSharedBoosterPosts:async()=>{generations++;return{versions:{instagram:{title:"Un nouveau projet",content:"Une réalisation préparée avec soin. ".repeat(65),cta:"",hashtags:["renovation","artisan","projet"]}}}}},
    "@/lib/inrAgentMediaGeneration":{generateInrAgentMedia:async()=>{throw Error("No media generation");}},
    "@/lib/inrAgentMediaFormats":{},"@/lib/inrAgentMediaPreferencesServer":{},
    "@/lib/inrAgentEditorialPlanning":{INR_AGENT_IMAGES_PER_PUBLICATION:3},
    "@/lib/inrAgentPublicationRevisionServer":{saveInrAgentPublicationRevision:async(args:{payload:Record<string,unknown>;action:Record<string,unknown>})=>{saved=args.payload;return{...args.action,payload:args.payload}}},
  });
  const {POST}=load<{POST:(request:Request)=>Promise<Response>}>("app/api/agent/actions/regenerate-channel/route.ts");
  const response=await POST(new Request("http://localhost/api/agent/actions/regenerate-channel",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({actionId:ACTION,channel:"instagram",kind:"content",scope:"channel"})}));
  assert.equal(response.status,200);assert.equal(generations,1);assert.ok(saved);
  const posts=saved.postByChannel as Record<string,Record<string,unknown>>,next=posts.instagram;
  assert.equal(next.ctaUrl,url);assert.equal(next.ctaMode,"custom");assert.equal(next.cta,"Voir notre travail");
  assert.ok(String(next.content).length<1800);assert.equal(next.text,next.content);assert.equal(next.body,next.content);
  const {getBoosterInstagramCaptionState}=load<typeof import("../../lib/boosterCta.ts")>("lib/boosterCta.ts");
  assert.equal(getBoosterInstagramCaptionState(next).issue,null);
  assert.deepEqual(posts.facebook,facebook);assert.equal(row.payload.postByChannel.instagram,oldInstagram);
});
