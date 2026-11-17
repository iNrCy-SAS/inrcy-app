import assert from "node:assert/strict";
import test from "node:test";
import { runtimeModules } from "../inragent/runtime-module-loader.mts";

function harness(anonymous=false) {
 const reads:string[]=[],removed:string[][]=[];
 const normalized=Buffer.from("owned normalized image");
 const route=runtimeModules({
  "next/server":{NextResponse:{json:(body:unknown,init?:ResponseInit)=>Response.json(body,init)}},
  "@/lib/requireUser":{requireUser:async()=>anonymous?{errorResponse:Response.json({error:"unauthorized"},{status:401})}:{activeUserId:"account-a",errorResponse:null}},
  "@/lib/rateLimit":{enforceRateLimit:async()=>null},
  "@/lib/supabaseAdmin":{supabaseAdmin:{storage:{from:(bucket:string)=>{assert.equal(bucket,"inrcy-pro-media");return{
   download:async(key:string)=>{reads.push(key);return{data:new Blob(["owned source image"]),error:null};},
   remove:async(keys:string[])=>{removed.push(keys);return{error:null};},
  };}}}},
  "@/lib/mediaImageNormalizer":{
   normalizeImageEditMasterBuffer:async()=>({source:{width:32,height:32,hasAlpha:false},master:{width:32,height:32,mimeType:"image/png",buffer:normalized}}),
   normalizeImageAiPreviewBuffer:()=>assert.fail("edit-master does not need an AI preview"),
  },
 })<{POST:(request:Request)=>Promise<Response>;DELETE:(request:Request)=>Promise<Response>}>("app/api/media-generation/normalize-reference/route.ts");
 const send=(method:"POST"|"DELETE",storagePath:unknown)=>route[method](new Request("https://inrcy.test/api/media-generation/normalize-reference",{method,headers:{"content-type":"application/json"},body:JSON.stringify({storagePath,fileName:"source.png",mimeType:"image/png",purpose:"edit_master"})}));
 return{reads,removed,send,normalized};
}

test("reference import and cleanup reject noncanonical keys before privileged Storage access",async()=>{
 const prefix="users/account-a/studio-identity-reference/image/";
 const invalid:unknown[]=[null,17,"",prefix+"%2e/source.png",prefix+"%2f/source.png",prefix+"%25/source.png",prefix+"folder\\source.png",prefix+"./source.png",prefix+"../source.png",prefix+"nested//source.png",prefix+"source.png?x=1",prefix+"source.png#x",prefix+"file\u0000.png",prefix+"a".repeat(901),"/"+prefix+"source.png","users/account-b/studio-identity-reference/image/source.png"];
 for(const method of ["POST","DELETE"] as const)for(const key of invalid){const h=harness();const response=await h.send(method,key);assert.equal(response.status,400);assert.equal((await response.json()).code,"identity_reference_path_invalid");assert.deepEqual(h.reads,[]);assert.deepEqual(h.removed,[]);}
});
test("canonical imports keep their account binding, response bytes and confirmed cleanup",async()=>{
 const h=harness(),key="users/account-a/studio-identity-reference/image/2026-11-17_portrait-123.png";
 const response=await h.send("POST",key);assert.equal(response.status,200);assert.equal(response.headers.get("content-type"),"image/png");assert.deepEqual(Buffer.from(await response.arrayBuffer()),h.normalized);assert.deepEqual(h.reads,[key]);assert.deepEqual(h.removed,[[key]]);
 const deletion=harness();assert.equal((await deletion.send("DELETE",key)).status,200);assert.deepEqual(deletion.reads,[]);assert.deepEqual(deletion.removed,[[key]]);
});
test("anonymous reference reads and cleanup cannot touch any Storage object",async()=>{
 for(const method of ["POST","DELETE"] as const){const h=harness(true);assert.equal((await h.send(method,"users/account-a/studio-identity-reference/image/source.png")).status,401);assert.deepEqual(h.reads,[]);assert.deepEqual(h.removed,[]);}
});
