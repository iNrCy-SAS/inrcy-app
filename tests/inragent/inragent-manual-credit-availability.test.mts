import assert from "node:assert/strict";
import test from "node:test";
import { inrAgentManualCreditAvailability, inrAgentManualPublishCreditBudget } from "../../lib/inrAgentManualCreditPolicy.ts";
import { runtimeModules } from "./runtime-module-loader.mts";

test("the complete manual publication budget shares native formats and includes optional voiceover",()=>{
  const args={kind:"image" as const,imageCount:1,channels:["facebook","instagram","site_web"]};
  assert.equal(inrAgentManualPublishCreditBudget(args),7);
  assert.equal(inrAgentManualPublishCreditBudget({...args,channels:[...args.channels,"tiktok"]}),14);
  assert.equal(inrAgentManualPublishCreditBudget({...args,imageCount:3,channels:[...args.channels,"tiktok"]}),42);
  assert.equal(inrAgentManualPublishCreditBudget({...args,kind:"video",imageCount:0,channels:[...args.channels,"tiktok","youtube_shorts"]}),87);
});

test("manual availability rejects negative, zero and positive-but-insufficient balances",()=>{
  for(const remaining of [-200,0,6,41]) assert.equal(inrAgentManualCreditAvailability({ready:true,unlimited:false,remaining,required:42}).allowed,false);
  assert.equal(inrAgentManualCreditAvailability({ready:true,unlimited:false,remaining:42,required:42}).allowed,true);
  assert.equal(inrAgentManualCreditAvailability({ready:true,unlimited:true,remaining:-200,required:42}).allowed,true);
  assert.equal(inrAgentManualCreditAvailability({ready:false,unlimited:true,remaining:500,required:42}).allowed,false);
  assert.equal(inrAgentManualCreditAvailability({ready:true,unlimited:false,remaining:0,required:0}).allowed,false);
});

test("instant history and the availability check use the same next-publication mix, scoped to the account",async()=>{
  const filters:unknown[]=[];
  const supabase={from:(table:string)=>{
    assert.equal(table,"inr_agent_actions");const query={
      select:()=>query,eq:(key:string,value:unknown)=>{filters.push([key,value]);return query;},
      contains:(_key:string,value:unknown)=>{if((value as Record<string,unknown>).mediaType)return Promise.resolve({count:0,error:null});return query;},
      then:(resolve:(value:unknown)=>void)=>resolve({count:9,error:null}),
    };return query;
  }};
  const api=runtimeModules()<typeof import("../../lib/inrAgentInstantMediaState.ts")>("lib/inrAgentInstantMediaState.ts");
  const mix=await api.loadInstantMediaMixState(supabase,"account-A",{image:true,carousel:true,video:true});
  assert.equal(mix.mediaKind,"video");assert.equal(mix.historyAvailable,true);
  assert.equal(filters.filter(filter=>JSON.stringify(filter)===JSON.stringify(["user_id","account-A"])).length,2);
});
