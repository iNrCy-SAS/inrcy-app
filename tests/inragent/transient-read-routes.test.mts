import assert from "node:assert/strict";
import test from "node:test";
import { runtimeModules } from "./runtime-module-loader.mts";

test("channel states retry a lost Auth read and do not turn a transient outage into logout",async()=>{
  for(const mode of ["recover","outage","unauthorized"] as const){
    let calls=0,states=0;
    const getUser=async()=>{
      calls++;
      if(mode==="unauthorized")return {data:{user:null},error:{status:401,message:"invalid JWT"}};
      if(mode==="outage"||calls===1)return {data:{user:null},error:{status:0,message:"fetch failed"}};
      return {data:{user:{id:"actor"}},error:null};
    };
    const load=runtimeModules({"next/server":{NextResponse:Response},"@/lib/supabaseServer":{createSupabaseServer:async()=>({auth:{getUser}})},
      "@/lib/multicompte/server":{resolveActiveInrcyAccountId:async()=>"account"},
      "@/lib/metaChannelRolloutServer":{isMetaChannelPilotEnabledForActorAndAccount:async()=>false},
      "@/lib/stats/metaPilotData":{withoutThreadsData:(data:unknown)=>data},
      "@/lib/channelConnectionState":{getChannelConnectionStates:async()=>{states++;return {facebook:"connected"};}}});
    const route=load<{GET():Promise<Response>}>("app/api/integrations/channel-states/route.ts");
    const response=await route.GET();
    assert.equal(response.status,mode==="recover"?200:mode==="outage"?503:401);
    assert.equal(calls,mode==="unauthorized"?1:2);
    assert.equal(states,mode==="recover"?1:0);
    if(mode==="outage")assert.equal(response.headers.get("retry-after"),"3");
  }
});

test("logo reads retry only transient failures and report a missing object as 404",async()=>{
  for(const mode of ["recover","outage","missing"] as const){
    let calls=0;
    const load=runtimeModules({"next/server":{NextResponse:Response},"@/lib/profileLogo":{LOGO_BUCKET:"logos"},
      "@/lib/supabaseAdmin":{supabaseAdmin:{storage:{from:()=>({download:async()=>{
        calls++;
        if(mode==="missing")return {data:null,error:{status:400,statusCode:"404",message:"Object not found"}};
        if(mode==="outage"||calls===1)throw new Error("fetch failed");
        return {data:new Blob(["png"],{type:"image/png"}),error:null};
      }})}}}});
    const route=load<{GET(request:Request):Promise<Response>}>("app/api/public/logo/route.ts");
    const response=await route.GET(new Request("https://app.inrcy.com/api/public/logo?path=11111111-1111-4111-8111-111111111111/logo.png&v=1"));
    assert.equal(response.status,mode==="recover"?200:mode==="missing"?404:503);
    assert.equal(calls,mode==="missing"?1:2);
    if(mode!=="recover")assert.equal(response.headers.get("cache-control"),"no-store");
  }
});
